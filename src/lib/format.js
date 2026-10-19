// Brasília não tem horário de verão desde 2019, então o fuso fixo -03:00 é seguro.
export const TZ = 'America/Sao_Paulo';
export const OFFSET = '-03:00';
export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export const brl = (cents) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const nowMinutes = () => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date()).split(':').map(Number);
  return h * 60 + m;
};

export const weekdayOf = (dateStr) => new Date(`${dateStr}T12:00:00${OFFSET}`).getUTCDay();
export const toISO = (dateStr, hhmm) => `${dateStr}T${hhmm.slice(0, 5)}:00${OFFSET}`;

export const fmtTime = (iso) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export const fmtDayLong = (iso) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));

export const digits = (s) => (s || '').replace(/\D/g, '');
export const waLink = (phone, text) => `https://wa.me/${digits(phone)}?text=${encodeURIComponent(text)}`;
