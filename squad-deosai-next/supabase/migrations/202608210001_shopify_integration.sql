-- Migration: Shopify Integration & COD Confirmation System
alter table public.agent_configs
add column if not exists shopify_connected boolean default false,
add column if not exists shopify_shop_domain text,
add column if not exists shopify_access_token text,
add column if not exists cod_auto_confirm boolean default true,
add column if not exists cod_message_template text default 'Hi {customer_name}! Thank you for placing your order #{order_number} for Rs. {total} on {store_name}. Please reply CONFIRM to verify your Cash-on-Delivery order, or CANCEL to cancel it.';
