import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppStatus, whatsappClients } from '@/lib/whatsapp/client';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sellerId = searchParams.get('seller_id');
    const rawPayload = await request.text();

    if (!rawPayload) {
      return NextResponse.json({ error: 'Empty payload' }, { status: 400 });
    }

    const order = JSON.parse(rawPayload);
    const shopDomainHeader = request.headers.get('x-shopify-shop-domain') || '';

    logger.info(`[Shopify Webhook] 📥 Received orders/create webhook for order #${order.order_number || order.id} (Shop: ${shopDomainHeader})`);

    const adminDb = createAdminClient();

    // Locate target seller configuration
    let targetSellerId = sellerId;
    let configRow: any = null;

    if (targetSellerId) {
      const { data } = await adminDb
        .from('agent_configs')
        .select('*')
        .eq('seller_id', targetSellerId)
        .maybeSingle();
      configRow = data;
    }

    if (!configRow && shopDomainHeader) {
      const cleanShopHeader = shopDomainHeader.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const { data } = await adminDb
        .from('agent_configs')
        .select('*')
        .eq('shopify_shop_domain', cleanShopHeader)
        .maybeSingle();
      if (data) {
        configRow = data;
        targetSellerId = data.seller_id;
      }
    }

    if (!targetSellerId || !configRow) {
      logger.warn(`[Shopify Webhook] ⚠️ Seller config not found for shop: ${shopDomainHeader} / seller_id: ${sellerId}`);
      return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
    }

    // Check if COD Auto Confirm is enabled
    if (configRow.cod_auto_confirm === false) {
      logger.info(`[Shopify Webhook] COD Auto Confirm is disabled for seller ${targetSellerId}. Skipping.`);
      return NextResponse.json({ status: 'skipped_disabled' });
    }

    // Determine if this is a Cash-on-Delivery (COD) order
    const gateway = (order.gateway || order.payment_gateway_names?.[0] || '').toLowerCase();
    const financialStatus = (order.financial_status || '').toLowerCase();
    const isCod =
      financialStatus === 'pending' ||
      gateway.includes('cod') ||
      gateway.includes('cash') ||
      gateway.includes('manual') ||
      gateway.includes('delivery');

    if (!isCod) {
      logger.info(`[Shopify Webhook] Order #${order.order_number} is prepaid (${gateway} / ${financialStatus}). Skipping COD confirmation.`);
      return NextResponse.json({ status: 'skipped_prepaid' });
    }

    // Extract customer phone number
    let rawPhone =
      order.phone ||
      order.customer?.phone ||
      order.shipping_address?.phone ||
      order.billing_address?.phone ||
      '';

    if (!rawPhone) {
      logger.warn(`[Shopify Webhook] Order #${order.order_number} has no phone number. Cannot send WhatsApp COD confirmation.`);
      return NextResponse.json({ status: 'skipped_no_phone' });
    }

    let cleanDigits = rawPhone.replace(/[^0-9]/g, '');
    if (cleanDigits.startsWith('03') && cleanDigits.length === 11) {
      cleanDigits = '92' + cleanDigits.substring(1);
    } else if (cleanDigits.startsWith('3') && cleanDigits.length === 10) {
      cleanDigits = '92' + cleanDigits;
    }

    const formattedPhone = '+' + cleanDigits;
    const waChatId = cleanDigits + '@c.us';

    // Fetch seller business name
    const { data: sellerData } = await adminDb
      .from('sellers')
      .select('business_name')
      .eq('id', targetSellerId)
      .maybeSingle();

    const storeName = sellerData?.business_name || 'Our Store';
    const customerName =
      order.customer?.first_name ||
      order.shipping_address?.first_name ||
      order.shipping_address?.name ||
      'Valued Customer';

    const orderNumber = String(order.order_number || order.name || order.id);
    const totalPrice = String(order.total_price || order.current_total_price || '0');
    const itemsList = (order.line_items || [])
      .map((i: any) => `${i.quantity}x ${i.title || i.name}`)
      .join(', ') || 'Item(s)';

    // Build message template
    const defaultTemplate =
      'Hi {customer_name}! Thank you for your order #{order_number} ({items}) for Rs. {total} at {store_name}.\n\nPlease reply CONFIRM to confirm your Cash-on-Delivery order, or CANCEL to cancel it.';

    const template = configRow.cod_message_template || defaultTemplate;
    const messageText = template
      .replace(/{customer_name}/g, customerName)
      .replace(/{order_number}/g, orderNumber)
      .replace(/{items}/g, itemsList)
      .replace(/{total}/g, totalPrice)
      .replace(/{store_name}/g, storeName);

    // Save order in Jawab AI orders table
    await adminDb.from('orders').insert({
      seller_id: targetSellerId,
      customer_name: customerName,
      customer_phone: formattedPhone,
      items: itemsList,
      total_amount: parseFloat(totalPrice) || 0,
      status: 'pending',
      shopify_order_id: String(order.id),
      created_at: new Date().toISOString(),
    });

    // Check if Jawab AI WhatsApp backend client is connected for this seller
    const waClientState = getWhatsAppStatus(targetSellerId);
    const activeClient = whatsappClients.get(targetSellerId)?.client;

    if (waClientState.status === 'connected' && activeClient) {
      logger.info(`[Shopify Webhook] 📤 Sending WhatsApp COD message to ${formattedPhone} for order #${orderNumber}...`);
      await activeClient.sendMessage(waChatId, messageText);

      // Save conversation in inbox
      let { data: conversation } = await adminDb
        .from('conversations')
        .select('id, unread_count')
        .eq('seller_id', targetSellerId)
        .eq('external_id', waChatId)
        .maybeSingle();

      if (!conversation) {
        const { data: newConv } = await adminDb
          .from('conversations')
          .insert({
            seller_id: targetSellerId,
            channel: 'whatsapp',
            external_id: waChatId,
            customer_name: customerName,
            customer_phone: formattedPhone,
            status: 'needs-you',
            last_message_at: new Date().toISOString(),
            unread_count: 0,
          })
          .select('id, unread_count')
          .single();
        conversation = newConv;
      }

      if (conversation) {
        await adminDb.from('messages').insert({
          seller_id: targetSellerId,
          conversation_id: conversation.id,
          sender_type: 'bot',
          content: messageText,
          read: true,
        });
      }

      return NextResponse.json({ success: true, status: 'sent', phone: formattedPhone });
    } else {
      logger.warn(`[Shopify Webhook] ⚠️ Seller ${targetSellerId} WhatsApp is not connected. Pending COD order saved in DB.`);
      return NextResponse.json({ success: true, status: 'saved_pending_wa_disconnected' });
    }
  } catch (err: any) {
    logger.error('[Shopify Webhook Error]', err);
    return NextResponse.json({ error: err.message || 'Webhook processing failed' }, { status: 500 });
  }
}
