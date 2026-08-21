import { logger } from '@/lib/logger';

interface ShopifyConfig {
  shopDomain: string;
  accessToken: string;
}

export async function cancelShopifyOrder(
  config: ShopifyConfig,
  orderId: string | number,
  reason: string = 'customer'
) {
  try {
    const cleanDomain = config.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const url = `https://${cleanDomain}/admin/api/2024-01/orders/${orderId}/cancel.json`;

    logger.info(`[Shopify API] Cancelling order ${orderId} on store ${cleanDomain}...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': config.accessToken,
      },
      body: JSON.stringify({
        reason,
        email: true,
        restock: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`[Shopify API] Failed to cancel order ${orderId}: ${response.status} - ${errText}`);
      return { success: false, error: errText };
    }

    const data = await response.json();
    logger.info(`[Shopify API] ✅ Order ${orderId} successfully cancelled on Shopify.`);
    return { success: true, data };
  } catch (err: any) {
    logger.error(`[Shopify API] Error cancelling order ${orderId}:`, err);
    return { success: false, error: err.message };
  }
}

export async function addShopifyOrderTag(
  config: ShopifyConfig,
  orderId: string | number,
  tagToAdd: string
) {
  try {
    const cleanDomain = config.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const getUrl = `https://${cleanDomain}/admin/api/2024-01/orders/${orderId}.json?fields=id,tags`;

    const getRes = await fetch(getUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': config.accessToken,
      },
    });

    let existingTags = '';
    if (getRes.ok) {
      const data = await getRes.json();
      existingTags = data.order?.tags || '';
    }

    const tagsArray = existingTags.split(',').map((t) => t.trim()).filter(Boolean);
    if (!tagsArray.includes(tagToAdd)) {
      tagsArray.push(tagToAdd);
    }
    const newTagsStr = tagsArray.join(', ');

    const putUrl = `https://${cleanDomain}/admin/api/2024-01/orders/${orderId}.json`;
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': config.accessToken,
      },
      body: JSON.stringify({
        order: {
          id: orderId,
          tags: newTagsStr,
        },
      }),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      logger.error(`[Shopify API] Failed to add tag '${tagToAdd}' to order ${orderId}: ${putRes.status} - ${errText}`);
      return { success: false, error: errText };
    }

    logger.info(`[Shopify API] ✅ Added tag '${tagToAdd}' to Shopify order ${orderId}.`);
    return { success: true };
  } catch (err: any) {
    logger.error(`[Shopify API] Error adding tag to order ${orderId}:`, err);
    return { success: false, error: err.message };
  }
}

export async function registerShopifyWebhook(
  config: ShopifyConfig,
  topic: string,
  targetUrl: string
) {
  try {
    const cleanDomain = config.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const url = `https://${cleanDomain}/admin/api/2024-01/webhooks.json`;

    logger.info(`[Shopify API] Registering webhook '${topic}' -> ${targetUrl} on ${cleanDomain}...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': config.accessToken,
      },
      body: JSON.stringify({
        webhook: {
          topic,
          address: targetUrl,
          format: 'json',
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.warn(`[Shopify API] Webhook registration response: ${response.status} - ${errText}`);
      return { success: false, error: errText };
    }

    const data = await response.json();
    logger.info(`[Shopify API] ✅ Webhook '${topic}' successfully registered.`);
    return { success: true, data };
  } catch (err: any) {
    logger.error(`[Shopify API] Error registering webhook:`, err);
    return { success: false, error: err.message };
  }
}
