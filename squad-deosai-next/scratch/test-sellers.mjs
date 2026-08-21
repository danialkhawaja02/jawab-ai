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

console.log('Testing with URL:', url);
console.log('Using secret key length:', secretKey ? secretKey.length : 0);

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function test() {
  const { data, error } = await supabase.from('sellers').select('*');
  if (error) {
    console.error('Error fetching sellers:', error);
  } else {
    console.log('Total sellers found in DB:', data.length);
    data.forEach(s => console.log(' - Seller:', s.id, s.business_name, s.email, s.phone));
  }
}

test();
