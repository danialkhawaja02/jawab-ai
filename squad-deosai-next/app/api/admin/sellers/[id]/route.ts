import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppStatus } from '@/lib/whatsapp/client';
import { logger } from '@/lib/logger';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sellerId } = await params;
    const supabaseUserClient = await createClient();
    const { data: { user } } = await supabaseUserClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminDb = createAdminClient();

    // 1. Fetch seller profile using admin client (bypassing RLS)
    const { data: seller, error: sellerError } = await adminDb
      .from('sellers')
      .select('*')
      .eq('id', sellerId)
      .maybeSingle();

    if (sellerError || !seller) {
      return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
    }

    // 2. Fetch seller products from DB
    const { data: products } = await adminDb
      .from('products')
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    // 3. Fetch agent config for policies & knowledge
    const { data: config } = await adminDb
      .from('agent_configs')
      .select('*')
      .eq('seller_id', sellerId)
      .maybeSingle();

    // 4. Fetch WhatsApp conversations to verify active channel status
    const { data: waConvs } = await adminDb
      .from('conversations')
      .select('id')
      .eq('seller_id', sellerId)
      .eq('channel', 'whatsapp')
      .limit(1);

    const hasWaConvs = (waConvs || []).length > 0;
    const waState = getWhatsAppStatus(sellerId);
    const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${sellerId}`);
    const hasDiskSession = fs.existsSync(sessionPath);

    const isConnected =
      waState.status === 'connected' ||
      hasDiskSession ||
      seller.whatsapp_requested === true ||
      hasWaConvs;

    const createdAt = seller.created_at ? new Date(seller.created_at) : new Date();
    const memberSince = createdAt.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });

    // Parse onboarding profile if present in knowledge_items
    let policies = {
      delivery: 'Not set',
      returns: 'Not set',
      hours: 'Standard business hours',
    };

    let knowledgeItems = (config?.knowledge_items && Array.isArray(config.knowledge_items))
      ? (config.knowledge_items as any[]).filter((k) => k.id !== 'k_onboarding_profile')
      : [];

    if (config?.knowledge_items && Array.isArray(config.knowledge_items)) {
      const obItem = (config.knowledge_items as any[]).find((k) => k.id === 'k_onboarding_profile');
      if (obItem) {
        try {
          const parsed = JSON.parse(obItem.content);
          policies = {
            delivery: [parsed.deliveryCharges, parsed.deliveryTime].filter(Boolean).join(' | ') || 'Not set',
            returns: parsed.returnPolicy || 'Not set',
            hours: 'Standard business hours',
          };
        } catch {}
      }
    }

    if (products && products.length > 0 && !knowledgeItems.some((k: any) => k.id === 'k_products_table')) {
      knowledgeItems.unshift({
        id: 'k_products_table',
        type: 'document',
        name: `Supabase Products Table (${products.length} items)`,
        content: `Database catalogue containing ${products.length} products: ${products.map(p => p.name).slice(0, 5).join(', ')}...`,
      });
    }

    return NextResponse.json({
      seller: {
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
      },
      products: (products || []).map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        category: p.category,
        availability_status: p.availability_status,
        inStock: p.availability_status !== 'sold_out' && p.availability_status !== 'out_of_stock',
        description: p.description,
        imageUrl: p.image_url,
      })),
      knowledgeItems,
      policies,
    });
  } catch (err: any) {
    logger.error('[Admin API Seller Detail Error]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
