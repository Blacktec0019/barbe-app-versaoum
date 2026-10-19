import { toISO } from './format.js';

const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const pad = (n) => String(n).padStart(2, '0');
export const minToHHMM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// Gera os horários livres de um dia para um serviço de `durationMin` minutos.
// hours: linha de working_hours do dia (ou undefined se a barbearia fecha).
// busy: [{ starts_at, ends_at }] já ocupados pelo barbeiro.
export function buildSlots({ date, hours, durationMin, busy = [], stepMin = 30, minNoticeMin = 30, now = new Date() }) {
  if (!hours) return [];
  const open = toMin(hours.open_time);
  const close = toMin(hours.close_time);
  const breakStart = hours.break_start ? toMin(hours.break_start) : null;
  const breakEnd = hours.break_end ? toMin(hours.break_end) : null;
  const earliest = now.getTime() + minNoticeMin * 60000;
  const busyMs = busy.map((b) => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()]);

  const out = [];
  for (let t = open; t + durationMin <= close; t += stepMin) {
    if (breakStart !== null && t < breakEnd && t + durationMin > breakStart) continue;
    const time = minToHHMM(t);
    const startsAt = toISO(date, time);
    const s = new Date(startsAt).getTime();
    const e = s + durationMin * 60000;
    if (s < earliest) continue;
    if (busyMs.some(([from, to]) => s < to && e > from)) continue;
    out.push({ time, startsAt });
  }
  return out;
}
