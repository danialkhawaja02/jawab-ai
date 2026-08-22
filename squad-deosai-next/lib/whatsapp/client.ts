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
  failedInitializations: Set<string>;
};

if (!globalForWhatsApp.whatsappClients) {
  globalForWhatsApp.whatsappClients = new Map<string, WhatsAppClientState>();
}
if (!globalForWhatsApp.failedInitializations) {
  globalForWhatsApp.failedInitializations = new Set<string>();
}

export const whatsappClients = globalForWhatsApp.whatsappClients;
export const failedInitializations = globalForWhatsApp.failedInitializations;

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

async function cleanupWhatsAppSession(sellerId: string, client?: Client) {
  if (client) {
    try {
      const pupBrowser = (client as any)?.pupBrowser;
      if (pupBrowser) {
        try {
          const proc = pupBrowser.process();
          if (proc) {
            proc.kill('SIGKILL');
          }
        } catch {}
        await pupBrowser.close().catch(() => {});
      }
    } catch {}
    try {
      await client.destroy();
    } catch {}
  }

  // Allow OS to release file locks on session directory
  await new Promise((resolve) => setTimeout(resolve, 500));

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

  // Clear any previous failure tracking so fresh explicit initialization is attempted
  failedInitializations.delete(sellerId);

  const state: WhatsAppClientState = { status: 'initializing' };
  whatsappClients.set(sellerId, state);

  logger.info(`[WhatsApp] Initializing client for seller ${sellerId}...`);

  const executablePath = getPuppeteerExecutablePath();
  logger.info(`[WhatsApp] Platform: ${process.platform}, Using executable path: ${executablePath || 'default (Puppeteer will download)'}`);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sellerId }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1014111620-alpha.html',
    },
    puppeteer: {
      ...(executablePath && { executablePath }),
      protocolTimeout: 300000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--disable-plugins',
        '--disable-site-isolation-trials',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
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
    failedInitializations.delete(sellerId);
  });

  client.on('authenticated', () => {
    logger.info(`[WhatsApp] Authenticated for seller ${sellerId}`);
    state.status = 'connected';
    state.qrDataUrl = undefined;
    failedInitializations.delete(sellerId);
  });

  client.on('auth_failure', async (msg: any) => {
    logger.error(`[WhatsApp] Authentication failure for seller ${sellerId}:`, msg);
    state.status = 'disconnected';
    state.qrDataUrl = undefined;
    whatsappClients.delete(sellerId);
    failedInitializations.add(sellerId);
    await cleanupWhatsAppSession(sellerId, client);
  });

  client.on('disconnected', async (reason: any) => {
    logger.info(`[WhatsApp] Client disconnected for seller ${sellerId}:`, reason);
    state.status = 'disconnected';
    state.qrDataUrl = undefined;
    whatsappClients.delete(sellerId);
    failedInitializations.add(sellerId);
    await cleanupWhatsAppSession(sellerId, client);
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
    failedInitializations.add(sellerId);
    await cleanupWhatsAppSession(sellerId, client);
    throw err;
  }

  return state;
}

export function getWhatsAppStatus(sellerId: string, autoRestore = false): WhatsAppClientState {
  const state = whatsappClients.get(sellerId);
  if (state) return state;

  // Check if session directory exists on disk for this seller
  const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${sellerId}`);
  if (fs.existsSync(sessionPath)) {
    // If autoRestore is disabled or initialization previously failed for this seller, do NOT spawn Puppeteer
    if (!autoRestore || failedInitializations.has(sellerId)) {
      return { status: 'disconnected' };
    }

    // Set initializing state in map to avoid duplicate concurrent initialization calls
    const newState: WhatsAppClientState = { status: 'initializing' };
    whatsappClients.set(sellerId, newState);

    // Session folder exists on disk: auto-restore client session in background
    initializeWhatsAppClient(sellerId).catch((err) => {
      logger.error(`[WhatsApp] Failed to auto-restore session for ${sellerId}:`, err);
      newState.status = 'disconnected';
      whatsappClients.delete(sellerId);
      failedInitializations.add(sellerId);
    });
    return newState;
  }

  return { status: 'disconnected' };
}

export async function logoutWhatsAppClient(sellerId: string): Promise<void> {
  const existing = whatsappClients.get(sellerId);
  whatsappClients.delete(sellerId);
  failedInitializations.delete(sellerId);

  await cleanupWhatsAppSession(sellerId, existing?.client);
}



