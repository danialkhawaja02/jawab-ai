import { NextResponse } from 'next/server';
import { logoutWhatsAppClient } from '@/lib/whatsapp/client';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await logoutWhatsAppClient(user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[WhatsApp Logout API Error]', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
