import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppStatus, logoutWhatsAppClient, initializeWhatsAppClient } from '@/lib/whatsapp/client';
import { logger } from '@/lib/logger';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabaseUserClient = await createClient();
    const { data: { user } } = await supabaseUserClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use admin client (service role) to bypass RLS and fetch ALL sellers from Supabase
    const adminDb = createAdminClient();
    const { data: sellers, error } = await adminDb
      .from('sellers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('[Admin API Sellers] Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch sellers' }, { status: 500 });
    }

    // Query conversations table for active WhatsApp channels to accurately detect connected sellers
    const { data: waConvs } = await adminDb
      .from('conversations')
      .select('seller_id')
      .eq('channel', 'whatsapp');

    const activeWaSellerIds = new Set((waConvs || []).map((c) => c.seller_id));

    // Map each seller with live WhatsApp status
    const result = (sellers || []).map((seller) => {
      const waState = getWhatsAppStatus(seller.id);
      const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${seller.id}`);
      const hasDiskSession = fs.existsSync(sessionPath);

      const isConnected =
        waState.status === 'connected' ||
        hasDiskSession ||
        seller.whatsapp_requested === true ||
        activeWaSellerIds.has(seller.id);

      const createdAt = seller.created_at ? new Date(seller.created_at) : new Date();
      const memberSince = createdAt.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });

      return {
        id: seller.id,
        businessName: seller.business_name || seller.owner_name || seller.email || 'Unnamed Store',
        ownerName: seller.owner_name || '—',
        email: seller.email || 'No email',
        phone: seller.phone || 'No phone',
        plan: seller.plan || 'Early Access',
        role: seller.role || 'seller',
        industry: seller.industry || '',
        whatsappNumber: seller.phone || '',
        whatsappConnected: isConnected,
        whatsappStatus: isConnected ? 'connected' : waState.status,
        memberSince,
        onboarded: seller.onboarded || false,
      };
    });

    return NextResponse.json({ sellers: result });
  } catch (err: any) {
    logger.error('[Admin API Sellers Error]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabaseUserClient = await createClient();
    const { data: { user } } = await supabaseUserClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sellerId, action } = await request.json();

    if (!sellerId) {
      return NextResponse.json({ error: 'Seller ID is required' }, { status: 400 });
    }

    const adminDb = createAdminClient();

    if (action === 'disconnect') {
      await logoutWhatsAppClient(sellerId);
      await adminDb
        .from('sellers')
        .update({ whatsapp_requested: false })
        .eq('id', sellerId);

      return NextResponse.json({ success: true, status: 'disconnected' });
    } else if (action === 'connect') {
      await adminDb
        .from('sellers')
        .update({ whatsapp_requested: true })
        .eq('id', sellerId);

      initializeWhatsAppClient(sellerId).catch((e) => {
        logger.error('[Admin WhatsApp Connect Error]', e);
      });

      return NextResponse.json({ success: true, status: getWhatsAppStatus(sellerId).status });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    logger.error('[Admin API Seller Action Error]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
