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
  console.log('=== Checking whatsapp_accounts table ===');
  const { data: waAccounts, error: waErr } = await supabase.from('whatsapp_accounts').select('*');
  if (waErr) console.error('waAccounts error:', waErr);
  else console.log('whatsapp_accounts rows:', JSON.stringify(waAccounts, null, 2));

  console.log('\n=== Checking sellers table fields ===');
  const { data: sellers, error: sErr } = await supabase.from('sellers').select('*');
  if (sErr) console.error('sellers error:', sErr);
  else {
    sellers.forEach(s => {
      console.log(`Seller: ${s.business_name} (${s.id})`);
      console.log(`  phone: ${s.phone}, onboarded: ${s.onboarded}, whatsapp_requested: ${s.whatsapp_requested}`);
    });
  }
}

check();
