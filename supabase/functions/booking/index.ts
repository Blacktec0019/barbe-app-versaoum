// Cria e cancela agendamentos e envia os e-mails.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { mails, sendEmail, type Details } from '../_shared/mail.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const KNOWN_ERRORS = [
  'horario_ocupado', 'horario_passado', 'fechado', 'fora_do_expediente', 'intervalo',
  'limite_agendamentos', 'servico_invalido', 'barbeiro_invalido', 'nao_cancelavel',
];
const REMIND_MIN = Number(Deno.env.get('REMINDER_MINUTES') ?? '180');
const siteUrl = () => (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rpcError(message: string) {
  const code = KNOWN_ERRORS.find((k) => message.includes(k));
  return json({ error: code ?? 'erro_interno' }, code ? 409 : 500);
}

async function details(a: Record<string, any>) {
  const [{ data: barber }, { data: service }] = await Promise.all([
    db.from('barbers').select('name,email').eq('id', a.barber_id).single(),
    db.from('services').select('name').eq('id', a.service_id).single(),
  ]);
  const d: Details = {
    serviceName: service?.name ?? 'Serviço',
    barberName: barber?.name ?? 'Barbeiro',
    startsAt: a.starts_at,
    clientName: a.client_name,
    clientPhone: a.client_phone,
    notes: a.notes,
    cancelUrl: siteUrl() ? `${siteUrl()}/#/cancelar/${a.cancel_token}` : undefined,
  };
  return { d, barberEmail: barber?.email || Deno.env.get('SHOP_EMAIL') };
}

async function userFrom(req: Request) {
  const raw = req.headers.get('Authorization') || '';
  const jwt = raw.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user?.email) return null;
  return data.user;
}

async function book(body: Record<string, any>, req: Request) {
  const user = await userFrom(req);
  if (!user) return json({ error: 'nao_autenticado' }, 401);

  const name = String(body.name ?? '').trim();
  const email = String(user.email).trim().toLowerCase();
  let phone = String(body.phone ?? '').replace(/\D/g, '');
  const notes = String(body.notes ?? '').trim().slice(0, 200) || null;
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;

  if (
    name.length < 2 || name.length > 80 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    phone.length < 12 || phone.length > 13 ||
    !UUID.test(String(body.barber_id)) || !UUID.test(String(body.service_id)) ||
    Number.isNaN(Date.parse(String(body.starts_at)))
  ) return json({ error: 'dados_invalidos' }, 400);

  const { data, error } = await db.rpc('book_appointment', {
    p_barber: body.barber_id,
    p_service: body.service_id,
    p_starts: new Date(body.starts_at).toISOString(),
    p_name: name,
    p_phone: phone,
    p_email: email,
    p_notes: notes,
    p_user: user.id,
  });
  if (error) return rpcError(error.message);

  // Reserva em cima da hora: a confirmação já serve de lembrete.
  if ((Date.parse(data.starts_at) - Date.now()) / 60000 <= REMIND_MIN) {
    await db.from('appointments').update({ reminded_at: new Date().toISOString() }).eq('id', data.id);
  }

  const { d, barberEmail } = await details(data);
  const [clientOk] = await Promise.all([
    sendEmail(email, mails.clientConfirmation(d)),
    sendEmail(barberEmail, mails.barberNew(d)),
  ]);

  return json({
    appointment: { id: data.id, starts_at: data.starts_at, cancel_token: data.cancel_token },
    emailSent: clientOk,
  });
}

async function cancel(body: Record<string, any>) {
  if (!UUID.test(String(body.token))) return json({ error: 'nao_cancelavel' }, 409);
  const { data, error } = await db.rpc('cancel_by_token', { p_token: body.token });
  if (error) return rpcError(error.message);

  const { d, barberEmail } = await details(data);
  await Promise.all([
    sendEmail(data.client_email, mails.clientCancelled(d)),
    sendEmail(barberEmail, mails.barberCancelled(d)),
  ]);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json();
    return body.action === 'cancel' ? await cancel(body) : await book(body, req);
  } catch (e) {
    console.error(e);
    return json({ error: 'erro_interno' }, 500);
  }
});
