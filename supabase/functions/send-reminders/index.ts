// Roda a cada 10 minutos (pg_cron): manda o lembrete para cliente e barbeiro.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { mails, sendEmail, type Details } from '../_shared/mail.ts';

const REMIND_MIN = Number(Deno.env.get('REMINDER_MINUTES') ?? '180');
const siteUrl = () => (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('unauthorized', { status: 401 });
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const now = new Date();
  const limit = new Date(now.getTime() + REMIND_MIN * 60000);

  const { data, error } = await db
    .from('appointments')
    .select('id,client_name,client_phone,client_email,notes,starts_at,cancel_token,barbers(name,email),services(name)')
    .eq('status', 'confirmed')
    .is('reminded_at', null)
    .gt('starts_at', now.toISOString())
    .lte('starts_at', limit.toISOString());

  if (error) {
    console.error(error);
    return new Response('erro', { status: 500 });
  }

  let sent = 0;
  for (const a of (data ?? []) as any[]) {
    const d: Details = {
      serviceName: a.services?.name ?? 'Serviço',
      barberName: a.barbers?.name ?? 'Barbeiro',
      startsAt: a.starts_at,
      clientName: a.client_name,
      clientPhone: a.client_phone,
      notes: a.notes,
      cancelUrl: siteUrl() ? `${siteUrl()}/#/cancelar/${a.cancel_token}` : undefined,
    };
    const barberEmail = a.barbers?.email || Deno.env.get('SHOP_EMAIL');
    const results = await Promise.all([
      sendEmail(a.client_email, mails.clientReminder(d)),
      sendEmail(barberEmail, mails.barberReminder(d)),
    ]);
    // Marca como enviado se ao menos um e-mail saiu; senão tenta de novo na próxima rodada.
    if (results.some(Boolean)) {
      await db.from('appointments').update({ reminded_at: new Date().toISOString() }).eq('id', a.id);
      sent++;
    }
  }

  return new Response(JSON.stringify({ checked: data?.length ?? 0, sent }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
