import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const shop = searchParams.get('shop');

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!shop) {
      return NextResponse.json({ error: 'Missing shop parameter (e.g. mystore.myshopify.com)' }, { status: 400 });
    }

    const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const apiKey = process.env.SHOPIFY_API_KEY;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // Auto-save shopify domain connection in Supabase agent_configs for this seller
    const adminDb = createAdminClient();
    await adminDb.from('agent_configs').upsert({
      seller_id: user.id,
      shopify_connected: true,
      shopify_shop_domain: cleanShop,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'seller_id' });

    if (!apiKey) {
      // If Shopify OAuth API key is not configured in env yet, save store domain and redirect back smoothly
      const redirectUrl = new URL('/dashboard/setup', appUrl);
      redirectUrl.searchParams.set('tab', 'tools');
      redirectUrl.searchParams.set('shopify_connected', 'true');
      redirectUrl.searchParams.set('shop', cleanShop);
      return NextResponse.redirect(redirectUrl.toString());
    }

    const redirectUri = `${appUrl}/api/shopify/auth/callback`;
    const scopes = 'read_orders,write_orders,read_products,write_products';
    const state = user.id;

    const authUrl = `https://${cleanShop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    return NextResponse.redirect(authUrl);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'OAuth init failed' }, { status: 500 });
  }
}
