import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
  if (match) {
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[match[1]] = val;
  }
});

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(url, secretKey);

async function check() {
  console.log('=== Checking conversations count per seller ===');
  const { data: convs, error: convErr } = await supabase.from('conversations').select('seller_id, id, channel, status');
  if (convErr) console.error(convErr);
  else console.log('Conversations:', convs);

  console.log('=== Checking agent_configs per seller ===');
  const { data: configs, error: cfgErr } = await supabase.from('agent_configs').select('seller_id, shopify_connected');
  if (cfgErr) console.error(cfgErr);
  else console.log('Agent configs:', configs);
}

check();
