import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { registerShopifyWebhook } from '@/lib/shopify/client';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const shop = searchParams.get('shop');
    const code = searchParams.get('code');
    const state = searchParams.get('state'); // sellerId

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const redirectTarget = new URL('/dashboard/setup', appUrl);
    redirectTarget.searchParams.set('tab', 'tools');

    if (!shop || !code || !state) {
      logger.error('[Shopify OAuth Callback] Missing parameters:', { shop, code, state });
      redirectTarget.searchParams.set('shopify_error', 'Invalid callback parameters');
      return NextResponse.redirect(redirectTarget.toString());
    }

    const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const apiKey = process.env.SHOPIFY_API_KEY;
    const apiSecret = process.env.SHOPIFY_API_SECRET;

    if (!apiKey || !apiSecret) {
      logger.error('[Shopify OAuth Callback] Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET in environment.');
      redirectTarget.searchParams.set('shopify_error', 'Server OAuth credentials missing');
      return NextResponse.redirect(redirectTarget.toString());
    }

    // Exchange authorization code for access token
    const tokenUrl = `https://${cleanShop}/admin/oauth/access_token`;
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      logger.error('[Shopify OAuth Callback] Token exchange failed:', errText);
      redirectTarget.searchParams.set('shopify_error', 'Token exchange failed');
      return NextResponse.redirect(redirectTarget.toString());
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Save token and shop domain in Supabase agent_configs
    const adminDb = createAdminClient();
    const { error: dbError } = await adminDb
      .from('agent_configs')
      .upsert({
        seller_id: state,
        shopify_connected: true,
        shopify_shop_domain: cleanShop,
        shopify_access_token: accessToken,
      }, { onConflict: 'seller_id' });

    if (dbError) {
      logger.error('[Shopify OAuth Callback] Failed to save shopify config to DB:', dbError);
    }

    // Register webhook for orders/create
    const webhookTarget = `${appUrl}/api/webhooks/shopify/orders-create?seller_id=${state}`;
    await registerShopifyWebhook({ shopDomain: cleanShop, accessToken }, 'orders/create', webhookTarget);

    redirectTarget.searchParams.set('shopify_connected', 'true');
    return NextResponse.redirect(redirectTarget.toString());
  } catch (err: any) {
    logger.error('[Shopify OAuth Callback Error]', err);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const redirectTarget = new URL('/dashboard/setup', appUrl);
    redirectTarget.searchParams.set('tab', 'tools');
    redirectTarget.searchParams.set('shopify_error', err.message || 'OAuth callback failed');
    return NextResponse.redirect(redirectTarget.toString());
  }
}
