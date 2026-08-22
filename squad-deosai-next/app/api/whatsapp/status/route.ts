import { NextResponse } from 'next/server';
import { getWhatsAppStatus } from '@/lib/whatsapp/client';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const state = getWhatsAppStatus(user.id, true);
    return NextResponse.json({
      status: state.status,
      qrDataUrl: state.qrDataUrl,
    });
  } catch (error) {
    logger.error('[WhatsApp Status API Error]', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
