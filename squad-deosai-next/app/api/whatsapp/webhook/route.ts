import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { generateGroundedReply } from "@/lib/ai/generate-reply";
import type {
  AgentConfigRow,
  KnowledgeItem,
  ProductRow,
  SellerRow,
} from "@/lib/ai/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWhatsAppProvider } from "@/lib/whatsapp";
import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetaWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
        }>;
      };
    }>;
  }>;
};

const DEFAULT_HANDOFF =
  "I do not have enough verified information to answer that accurately. I will ask the seller to reply personally.";

function verifySignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function extractIncomingMessage(payload: MetaWebhookPayload): IncomingWhatsAppMessage | null {
  const value = payload.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (
    !message?.id ||
    !message.from ||
    message.type !== "text" ||
    !message.text?.body ||
    !phoneNumberId
  ) {
    return null;
  }

  return {
    messageId: message.id,
    phoneNumberId,
    from: message.from,
    customerName: value?.contacts?.[0]?.profile?.name || null,
    text: message.text.body.trim(),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Webhook verification failed", { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appSecret) {
    return NextResponse.json(
      { error: "WhatsApp app secret is not configured." },
      { status: 503 },
    );
  }

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch (error: any) {
    logger.error("[WhatsApp Webhook Error] Invalid webhook JSON.", { error });
    return NextResponse.json({ error: "Invalid webhook JSON." }, { status: 400 });
  }

  const incoming = extractIncomingMessage(payload);
  if (!incoming) {
    return NextResponse.json({ received: true, ignored: true });
  }

  try {
    const supabase = createAdminClient();
    const { error: eventError } = await supabase.from("webhook_events").insert({
      provider: "meta",
      external_event_id: incoming.messageId,
      payload,
    });

    if (eventError?.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (eventError) throw eventError;

    const { data: account, error: accountError } = await supabase
      .from("whatsapp_accounts")
      .select("seller_id")
      .eq("phone_number_id", incoming.phoneNumberId)
      .eq("status", "connected")
      .single();

    if (accountError || !account) {
      throw new Error("No connected seller is mapped to this WhatsApp number.");
    }

    const [sellerResult, configResult, productsResult] = await Promise.all([
      supabase
        .from("sellers")
        .select("id,business_name,industry,website")
        .eq("id", account.seller_id)
        .single(),
      supabase
        .from("agent_configs")
        .select("*")
        .eq("seller_id", account.seller_id)
        .maybeSingle(),
      supabase
        .from("products")
        .select("id,name,price,category,availability_status,description,metadata")
        .eq("seller_id", account.seller_id)
        .limit(250),
    ]);

    if (sellerResult.error || productsResult.error || !sellerResult.data) {
      throw new Error("Seller context could not be loaded.");
    }

    const seller = sellerResult.data as SellerRow;
    const remoteConfig = configResult.data as AgentConfigRow | null;
    const config: AgentConfigRow = {
      seller_id: account.seller_id,
      agent_prompt: remoteConfig?.agent_prompt || "You are a helpful customer support assistant.",
      agent_never_do: remoteConfig?.agent_never_do || "Never guess.",
      agent_memory: remoteConfig?.agent_memory || "",
      knowledge_items: Array.isArray(remoteConfig?.knowledge_items)
        ? (remoteConfig.knowledge_items as KnowledgeItem[])
        : [],
      tone_guidelines: Array.isArray(remoteConfig?.tone_guidelines)
        ? remoteConfig.tone_guidelines
        : ["Keep messages short and friendly"],
      conciseness: remoteConfig?.conciseness || "concise",
      hinglish_support: remoteConfig?.hinglish_support ?? true,
      handoff_message: remoteConfig?.handoff_message || DEFAULT_HANDOFF,
    };

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .upsert(
        {
          seller_id: account.seller_id,
          channel: "whatsapp",
          external_id: incoming.from,
          customer_name: incoming.customerName,
          customer_phone: incoming.from,
          status: "open",
          last_message_at: new Date().toISOString(),
        },
        { onConflict: "seller_id,channel,external_id" },
      )
      .select("id")
      .single();

    if (conversationError || !conversation) throw conversationError;

    await supabase.from("messages").insert({
      seller_id: account.seller_id,
      conversation_id: conversation.id,
      external_message_id: incoming.messageId,
      direction: "inbound",
      author: "customer",
      body: incoming.text,
      status: "received",
    });

    let result;
    try {
      result = await generateGroundedReply({
        message: incoming.text,
        seller,
        config,
        products: (productsResult.data || []) as ProductRow[],
      });
    } catch {
      result = { reply: config.handoff_message, action: "handoff" as const, evidenceIds: [] };
    }

    const sendResult = await getWhatsAppProvider().sendText({
      to: incoming.from,
      text: result.reply,
      phoneNumberId: incoming.phoneNumberId,
      replyToMessageId: incoming.messageId,
    });

    await supabase.from("messages").insert({
      seller_id: account.seller_id,
      conversation_id: conversation.id,
      external_message_id: sendResult.messageId,
      direction: "outbound",
      author: "bot",
      body: result.reply,
      action: result.action,
      status: sendResult.status,
      metadata: { evidence_ids: result.evidenceIds },
    });

    await supabase
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("external_event_id", incoming.messageId);

    return NextResponse.json({ received: true, action: result.action });
  } catch (error: any) {
    logger.error("[WhatsApp Webhook Processing Error]", { error });
    // A non-2xx response asks Meta to retry transient failures.
    return NextResponse.json(
      { error: "Webhook processing is not configured or temporarily failed." },
      { status: 503 },
    );
  }
}
