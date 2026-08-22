import { logger } from "@/lib/logger";
import OpenAI from "openai";
import { buildStaticSellerPrompt, formatDynamicContext, getFastPathGreeting } from "@/lib/ai/grounding";
import { vertexCacheManager } from "@/lib/ai/vertex-cache";

import type {
  AgentConfigRow,
  ChatMessage,
  GroundedReply,
  ProductRow,
  SellerRow,
  TokenUsageLog,
} from "@/lib/ai/types";

function handoff({
  config,
  userMessage = "",
}: {
  config?: AgentConfigRow;
  userMessage?: string;
} = {}): GroundedReply {
  const isPayment = /\b(pay|payment|easypaisa|jazzcash|card|bank|transfer|cod|cash)\b/i.test(userMessage);
  const isDelivery = /\b(delivery|shipping|rates|charges|multan|lahore|karachi|skardu|city|deliver|ship|hours|location|address)\b/i.test(userMessage);
  const isProduct = /\b(product|item|design|suit|dress|kurti|shirt|shoe|size|stock|available|color|colour)\b/i.test(userMessage);

  let customHandoff = config?.handoff_message?.trim();
  let replyText = "";

  if (customHandoff && customHandoff !== "I couldn't find that product in our catalogue.") {
    replyText = customHandoff;
  } else if (isPayment) {
    replyText = "I don't have our exact payment options listed right now. Let me connect you directly with the seller so they can confirm details with you!";
  } else if (isDelivery) {
    replyText = "I don't have our exact delivery rates or location coverage listed right now. Let me connect you directly with the seller to assist you!";
  } else if (isProduct) {
    replyText = "I couldn't find that product in our catalogue.";
  } else {
    replyText = "I don't have that exact detail in our store guide right now. I will notify the seller so they can assist you personally!";
  }

  return {
    reply: replyText,
    action: "handoff",
    evidenceIds: [],
  };
}



type ModelReply = {
  reply?: unknown;
  supported?: unknown;
  evidence_ids?: unknown;
};

function parseModelReply(value: string): ModelReply | null {

  const cleaned = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned) as ModelReply;
  } catch {
    return null;
  }
}

/**
 * Logs token usage metrics per request tagged by seller ID.
 * Tracks cached_tokens to measure actual cache hit rate before & after optimization.
 */
let globalTotalRequests = 0;
let globalCacheMisses = 0;

function logTokenUsage(metrics: TokenUsageLog): void {
  globalTotalRequests++;
  if (metrics.cachedTokens === 0) globalCacheMisses++;
  const requestMissRate = globalTotalRequests > 0 ? (globalCacheMisses / globalTotalRequests) * 100 : 0;
  logger.info(
    `\n[TOKEN_USAGE] Seller: ${metrics.sellerId} | Provider: ${metrics.provider.toUpperCase()} | ` +
      `Total: ${metrics.totalTokens} | Prompt: ${metrics.promptTokens} | ` +
      `Cached: ${metrics.cachedTokens} | Token Cache Hit Rate: ${metrics.cacheHitRate} | ` +
      `Request Miss Rate: ${requestMissRate.toFixed(1)}% (${globalCacheMisses}/${globalTotalRequests})`
  );
}

/**
 * Executes request via OpenAI (Primary Provider).
 * 
 * PROMPT CACHING DECISIONS (OPENAI):
 * 1. The static prompt (system instructions + seller policies + compacted catalog) is placed
 *    FIRST in the messages array as a 'system' message. For OpenAI, automatic prompt caching
 *    kicks in when the static prefix stays 100% byte-identical across requests and exceeds ~1024 tokens.
 * 2. We tag requests with `user: seller_${seller.id}` and pass custom prompt cache parameters
 *    so OpenAI's internal cache router routes requests for the same seller to the same cache worker.
 * 3. We use JSON response_format to enforce structured JSON output without extra tokens.
 */
async function generateViaOpenAI({
  sellerId,
  staticPrompt,
  dynamicMessages,
}: {
  sellerId: string;
  staticPrompt: string;
  dynamicMessages: ChatMessage[];
}): Promise<{ outputText: string; tokenUsage: TokenUsageLog }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing on the server.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: staticPrompt },
    ...dynamicMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  // OpenAI completion with prompt cache routing hint
  const completion = await client.chat.completions.create({
    model,
    messages,
    max_tokens: 300,
    temperature: 0.0,
    response_format: { type: "json_object" },
    user: `seller_${sellerId}`,
    // Custom header/param hint for cache affinity per seller
    ...({ prompt_cache_key: `seller_${sellerId}` } as any),
  });

  const outputText = completion.choices[0]?.message?.content || "";
  const usage = completion.usage;

  const promptTokens = usage?.prompt_tokens || 0;
  const completionTokens = usage?.completion_tokens || 0;
  const totalTokens = usage?.total_tokens || promptTokens + completionTokens;

  // Extract cached_tokens from OpenAI API response (usage.prompt_tokens_details.cached_tokens)
  const promptDetails = (usage as any)?.prompt_tokens_details;
  const cachedTokens = typeof promptDetails?.cached_tokens === "number" ? promptDetails.cached_tokens : 0;

  const hitRateRatio = promptTokens > 0 ? (cachedTokens / promptTokens) * 100 : 0;
  const cacheHitRate = `${hitRateRatio.toFixed(1)}%`;

  const tokenUsage: TokenUsageLog = {
    sellerId,
    provider: "openai",
    promptTokens,
    cachedTokens,
    completionTokens,
    totalTokens,
    cacheHitRate,
  };

  logTokenUsage(tokenUsage);
  return { outputText, tokenUsage };
}

/**
 * Executes request via Vertex AI / Gemini (Fallback Provider).
 * 
 * PROMPT CACHING DECISIONS (VERTEX AI / GEMINI):
 * 1. Explicit Context Caching: Uses CachedContent resource created per seller.
 * 2. When a cachedContent reference is available, the static block is stored server-side in Vertex AI,
 *    so we omit the system instructions from the dynamic message payload to avoid duplicate tokens.
 * 3. Extracts usageMetadata.cachedContentTokenCount from Gemini response.
 */
async function generateViaVertex({
  sellerId,
  staticPrompt,
  dynamicMessages,
}: {
  sellerId: string;
  staticPrompt: string;
  dynamicMessages: ChatMessage[];
}): Promise<{ outputText: string; tokenUsage: TokenUsageLog }> {
  const apiKey = process.env.VERTEX_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Neither VERTEX_API_KEY nor GEMINI_API_KEY is configured.");
  }

  const modelName = process.env.VERTEX_MODEL || "gemini-1.5-flash";

  // Check or lazily create CachedContent reference for seller (24h TTL)
  const cachedContentName = await vertexCacheManager.getOrCreateCache({
    sellerId,
    staticPrompt,
    modelName: `models/${modelName}`,
  });

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  // Format contents array for Gemini API
  const contents = dynamicMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const payload: Record<string, any> = {
    contents,
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 300,
      responseMimeType: "application/json",
    },
  };

  // If explicit cache exists, attach cachedContent resource reference
  if (cachedContentName) {
    payload.cachedContent = cachedContentName;
  } else {
    // Fallback: pass static prompt as systemInstruction if cachedContent unavailable
    payload.systemInstruction = {
      parts: [{ text: staticPrompt }],
    };
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Vertex AI API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const outputText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const usage = data.usageMetadata || {};

  const promptTokens = usage.promptTokenCount || 0;
  const completionTokens = usage.candidatesTokenCount || 0;
  const cachedTokens = usage.cachedContentTokenCount || 0;
  const totalTokens = usage.totalTokenCount || promptTokens + completionTokens;

  const hitRateRatio = promptTokens > 0 ? (cachedTokens / promptTokens) * 100 : 0;
  const cacheHitRate = `${hitRateRatio.toFixed(1)}%`;

  const tokenUsage: TokenUsageLog = {
    sellerId,
    provider: "vertex",
    promptTokens,
    cachedTokens,
    completionTokens,
    totalTokens,
    cacheHitRate,
  };

  logTokenUsage(tokenUsage);
  return { outputText, tokenUsage };
}

/**
 * Main grounded reply generator.
 * 
 * CACHING & TOKEN MINIMIZATION FLOW:
 * 1. Checks fast-path greeting interceptor (0-tokens for "helo", "hi", "salam").
 * 2. Builds 100% byte-identical static prompt per seller (instructions + stripped catalog + policies).
 * 3. Formats dynamic message context (capped at 6 messages / 3 turns, preserving prompt prefix).
 * 4. Attempts primary provider (OpenAI with automatic prompt caching).
 * 5. On failure or credit exhaustion, falls back seamlessly to Vertex AI (Gemini with explicit CachedContent).
 * 6. Returns parsed structured JSON reply and token usage metrics.
 */
export async function generateGroundedReply({
  message,
  seller,
  config,
  products,
  conversationHistory = [],
}: {
  message: string;
  seller: SellerRow;
  config: AgentConfigRow;
  products: ProductRow[];
  conversationHistory?: ChatMessage[];
}): Promise<GroundedReply> {
  // 1. FAST-PATH ZERO-TOKEN INTERCEPTOR FOR PURE GREETINGS (including typos like "Helo")
  const fastGreeting = getFastPathGreeting({
    message,
    sellerId: seller.id,
    businessName: seller.business_name,
  });
  if (fastGreeting) return fastGreeting;

  // 2. Build byte-identical static prompt per seller

  const staticPrompt = buildStaticSellerPrompt({ seller, config, products });

  // 2. Format dynamic conversation turns (strictly bounded, appending newest turn at end)
  const dynamicMessages = formatDynamicContext({
    history: conversationHistory,
    currentMessage: message,
  });

  const preferredProvider = process.env.AI_PROVIDER || "openai";
  let resultText = "";
  let tokenUsage: TokenUsageLog | undefined;

  // 3. Provider Execution with Fallback
  if (preferredProvider === "openai") {
    try {
      const res = await generateViaOpenAI({
        sellerId: seller.id,
        staticPrompt,
        dynamicMessages,
      });
      resultText = res.outputText;
      tokenUsage = res.tokenUsage;
    } catch (err: any) {
      logger.warn(`[AI Provider Fallback] OpenAI call failed (${err?.message || err}). Falling back to Vertex AI (Gemini)...`);
      try {
        const res = await generateViaVertex({
          sellerId: seller.id,
          staticPrompt,
          dynamicMessages,
        });
        resultText = res.outputText;
        tokenUsage = res.tokenUsage;
      } catch (vertexErr: any) {
        logger.error(`[AI Provider Error] Vertex AI fallback also failed:`, vertexErr);
        return handoff({ config, userMessage: message });
      }
    }
  } else {
    // Direct Vertex AI path if AI_PROVIDER="vertex"
    try {
      const res = await generateViaVertex({
        sellerId: seller.id,
        staticPrompt,
        dynamicMessages,
      });
      resultText = res.outputText;
      tokenUsage = res.tokenUsage;
    } catch (err) {
      logger.error(`[AI Provider Error] Vertex AI generation failed:`, err);
      return handoff({ config, userMessage: message });
    }
  }

  // 4. Parse structured model output
  const parsed = parseModelReply(resultText);
  if (!parsed || typeof parsed.reply !== "string") {
    return { ...handoff({ config, userMessage: message }), tokenUsage };
  }

  const reply = parsed.reply.trim();
  const supported = parsed.supported === true;
  const evidenceIds = Array.isArray(parsed.evidence_ids)
    ? parsed.evidence_ids.filter((id): id is string => typeof id === "string")
    : [];

  if (!reply || reply.length > 900) {
    return { ...handoff({ config, userMessage: message }), tokenUsage };
  }

  const isHandoffPhrase = /connect you directly with the seller|notify the seller|ask the seller|couldn't find that product/i.test(reply);

  return {
    reply,
    action: isHandoffPhrase || !supported ? "handoff" : "reply",
    evidenceIds,
    tokenUsage,
  };
}
