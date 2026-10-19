const TZ = 'America/Sao_Paulo';

export const SHOP = {
  name: Deno.env.get('SHOP_NAME') ?? 'Barbearia L.A',
  address: Deno.env.get('SHOP_ADDRESS') ?? 'Rua da Lavoura, 214 - Centro',
};

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const when = (iso: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
  }).format(d);
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit',
  }).format(d);
  return `${day} às ${time}`;
};

const row = (label: string, value: string) =>
  `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(label)}</td><td style="padding:4px 0"><b>${esc(value)}</b></td></tr>`;

function layout(title: string, inner: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">
<div style="background:#000;color:#fff;padding:20px 24px;font-family:Georgia,serif;font-size:22px">${esc(SHOP.name)}</div>
<div style="padding:24px;border:1px solid #e5e5e5;border-top:0">
<h2 style="margin:0 0 16px;font-size:20px">${esc(title)}</h2>${inner}
<p style="margin:24px 0 0;color:#666;font-size:13px">${esc(SHOP.address)}</p>
</div></div>`;
}

export type Details = {
  serviceName: string;
  barberName: string;
  startsAt: string;
  clientName?: string;
  clientPhone?: string;
  notes?: string | null;
  cancelUrl?: string;
};

function table(d: Details, withClient: boolean) {
  const rows = [
    row('Serviço', d.serviceName),
    row('Barbeiro', d.barberName),
    row('Quando', when(d.startsAt)),
  ];
  if (withClient) {
    rows.push(row('Cliente', d.clientName ?? ''));
    if (d.clientPhone) rows.push(row('WhatsApp', d.clientPhone));
    if (d.notes) rows.push(row('Observação', d.notes));
  }
  return `<table style="border-collapse:collapse;font-size:15px">${rows.join('')}</table>`;
}

const cancelBlock = (url?: string) =>
  url
    ? `<p style="margin:20px 0 0;font-size:14px">Precisa cancelar? <a href="${esc(url)}" style="color:#000">Cancele por aqui</a>.</p>`
    : '';

export const mails = {
  clientConfirmation: (d: Details) => ({
    subject: `Horário confirmado: ${when(d.startsAt)}`,
    html: layout('Seu horário está confirmado', `<p>Oi, ${esc(d.clientName)}! Te esperamos.</p>${table(d, false)}${cancelBlock(d.cancelUrl)}`),
  }),
  barberNew: (d: Details) => ({
    subject: `Novo agendamento: ${d.clientName}, ${when(d.startsAt)}`,
    html: layout('Novo agendamento', table(d, true)),
  }),
  clientReminder: (d: Details) => ({
    subject: `Lembrete: seu horário é ${when(d.startsAt)}`,
    html: layout('Seu horário está chegando', `<p>Oi, ${esc(d.clientName)}! Passando pra lembrar do seu horário.</p>${table(d, false)}${cancelBlock(d.cancelUrl)}`),
  }),
  barberReminder: (d: Details) => ({
    subject: `Próximo cliente: ${d.clientName}, ${when(d.startsAt)}`,
    html: layout('Lembrete de atendimento', table(d, true)),
  }),
  clientCancelled: (d: Details) => ({
    subject: 'Agendamento cancelado',
    html: layout('Agendamento cancelado', `<p>Seu horário foi cancelado. Quando quiser, é só agendar de novo.</p>${table(d, false)}`),
  }),
  barberCancelled: (d: Details) => ({
    subject: `Cancelado: ${d.clientName}, ${when(d.startsAt)}`,
    html: layout('Agendamento cancelado pelo cliente', table(d, true)),
  }),
};

// Envio pelo Resend. Para trocar de provedor, mexa só nesta função.
export async function sendEmail(
  to: string | null | undefined,
  mail: { subject: string; html: string },
): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  if (!to || !key || !from) {
    console.error('E-mail não enviado: falta destinatário, RESEND_API_KEY ou MAIL_FROM.');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: mail.subject, html: mail.html }),
    });
    if (!res.ok) {
      console.error('Resend recusou o envio:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('Falha ao chamar o Resend:', e);
    return false;
  }
}
