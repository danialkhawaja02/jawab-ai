import { logger } from "@/lib/logger";
import { Client, LocalAuth } from 'whatsapp-web.js';
// @ts-ignore
import qrcodeTerminal from 'qrcode-terminal';
import qrcode from 'qrcode';
import { handleIncomingMessage } from './handlers';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export type WhatsAppStatus = 'disconnected' | 'initializing' | 'qr_ready' | 'connected';

export interface WhatsAppClientState {
  status: WhatsAppStatus;
  qrDataUrl?: string;
  client?: Client;
}

// Global singleton in-memory store for clients across Next.js API route bundles.
const globalForWhatsApp = globalThis as unknown as {
  whatsappClients: Map<string, WhatsAppClientState>;
};

if (!globalForWhatsApp.whatsappClients) {
  globalForWhatsApp.whatsappClients = new Map<string, WhatsAppClientState>();
}

export const whatsappClients = globalForWhatsApp.whatsappClients;

function getPuppeteerExecutablePath(): string | undefined {
  // Environment variable takes priority
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    const path = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (fs.existsSync(path)) {
      logger.info(`[WhatsApp] Using PUPPETEER_EXECUTABLE_PATH from env: ${path}`);
      return path;
    } else {
      logger.warn(`[WhatsApp] PUPPETEER_EXECUTABLE_PATH set but not found: ${path}`);
    }
  }
  
  // Windows path
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  
  // Linux paths - check in order of preference
  const knownLinuxPaths = [
    '/usr/bin/chromium-browser',     // Alpine Linux (Dockerfile)
    '/usr/bin/chromium',             // Debian/Ubuntu
    '/usr/bin/google-chrome',        // Google Chrome
    '/usr/bin/google-chrome-stable', // Google Chrome stable
  ];
  
  for (const p of knownLinuxPaths) {
    if (fs.existsSync(p)) {
      logger.info(`[WhatsApp] Found Linux Chromium binary at: ${p}`);
      return p;
    }
  }
  
  logger.warn('[WhatsApp] No Chromium binary found in standard paths. Puppeteer will attempt to download.');
  return undefined;
}

async function cleanupWhatsAppSession(sellerId: string) {
  // Delete session folder for this seller when explicitly logged out
  const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${sellerId}`);
  if (fs.existsSync(sessionPath)) {
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      logger.info(`[WhatsApp] Deleted session folder for ${sellerId}`);
    } catch (err) {
      logger.error(`[WhatsApp] Error deleting session folder for ${sellerId}:`, err);
    }
  }
}

export async function initializeWhatsAppClient(sellerId: string): Promise<WhatsAppClientState> {
  const existing = whatsappClients.get(sellerId);
  if (existing && existing.status !== 'disconnected') {
    return existing;
  }

  const state: WhatsAppClientState = { status: 'initializing' };
  whatsappClients.set(sellerId, state);

  logger.info(`[WhatsApp] Initializing client for seller ${sellerId}...`);

  const executablePath = getPuppeteerExecutablePath();
  logger.info(`[WhatsApp] Platform: ${process.platform}, Using executable path: ${executablePath || 'default (Puppeteer will download)'}`);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sellerId }),
    puppeteer: {
      ...(executablePath && { executablePath }),
      protocolTimeout: 300000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--disable-plugins',
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      ],
      headless: true,
    },
  });

  state.client = client;

  client.on('qr', async (qr: string) => {
    logger.info(`[WhatsApp] QR generated for seller ${sellerId}`);
    qrcodeTerminal.generate(qr, { small: true });

    try {
      const qrDataUrl = await qrcode.toDataURL(qr);
      state.status = 'qr_ready';
      state.qrDataUrl = qrDataUrl;
      logger.info(`[WhatsApp] QR data URL set for seller ${sellerId}`);
    } catch (err) {
      logger.error('[WhatsApp] Failed to generate QR data URL:', err);
    }
  });

  client.on('ready', () => {
    logger.info(`[WhatsApp] Client ready for seller ${sellerId}`);
    state.status = 'connected';
    state.qrDataUrl = undefined;
  });

  client.on('authenticated', () => {
    logger.info(`[WhatsApp] Authenticated for seller ${sellerId}`);
    state.status = 'connected';
    state.qrDataUrl = undefined;
  });

  client.on('auth_failure', async (msg: any) => {
    logger.error(`[WhatsApp] Authentication failure for seller ${sellerId}:`, msg);
    state.status = 'disconnected';
    state.qrDataUrl = undefined;
    whatsappClients.delete(sellerId);
    await cleanupWhatsAppSession(sellerId);
  });

  client.on('disconnected', async (reason: any) => {
    logger.info(`[WhatsApp] Client disconnected for seller ${sellerId}:`, reason);
    state.status = 'disconnected';
    state.qrDataUrl = undefined;
    whatsappClients.delete(sellerId);
    await cleanupWhatsAppSession(sellerId);
  });

  client.on('message', async (msg) => {
    await handleIncomingMessage(msg, sellerId);
  });

  try {
    logger.info(`[WhatsApp] Calling client.initialize() for seller ${sellerId}...`);
    await Promise.race([
      client.initialize(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('WhatsApp client initialization timed out after 120s')), 120000)
      ),
    ]);
    logger.info(`[WhatsApp] Client.initialize() completed for seller ${sellerId}`);
  } catch (err) {
    logger.error(`[WhatsApp] Failed to initialize for seller ${sellerId}:`, err);
    state.status = 'disconnected';
    whatsappClients.delete(sellerId);
    try {
      await client.destroy();
    } catch {}
    await cleanupWhatsAppSession(sellerId);
    throw err;
  }

  return state;
}

export function getWhatsAppStatus(sellerId: string): WhatsAppClientState {
  const state = whatsappClients.get(sellerId);
  if (state) return state;

  // Check if session directory exists on disk for this seller
  const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${sellerId}`);
  if (fs.existsSync(sessionPath)) {
    // Set initializing state in map to avoid duplicate concurrent initialization calls
    const newState: WhatsAppClientState = { status: 'initializing' };
    whatsappClients.set(sellerId, newState);

    // Session folder exists on disk: auto-restore client session in background
    initializeWhatsAppClient(sellerId).catch((err) => {
      logger.error(`[WhatsApp] Failed to auto-restore session for ${sellerId}:`, err);
      newState.status = 'disconnected';
      whatsappClients.delete(sellerId);
      cleanupWhatsAppSession(sellerId).catch(() => {});
    });
    return newState;
  }

  return { status: 'disconnected' };
}

export async function logoutWhatsAppClient(sellerId: string): Promise<void> {
  const existing = whatsappClients.get(sellerId);
  if (existing?.client) {
    try {
      await existing.client.destroy();
      logger.info(`[WhatsApp] Destroyed client for ${sellerId}`);
    } catch (err) {
      logger.error(`[WhatsApp] Error destroying client for ${sellerId}:`, err);
    }
  }
  whatsappClients.delete(sellerId);

  await cleanupWhatsAppSession(sellerId);
}


