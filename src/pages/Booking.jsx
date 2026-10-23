import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { SHOP } from '../config.js';
import { brl, todayStr, addDays, weekdayOf, nowMinutes, WEEKDAYS_SHORT, fmtTime, fmtDayLong, digits, waLink } from '../lib/format.js';
import { buildSlots } from '../lib/slots.js';
import { callBooking, errorMessage } from '../lib/api.js';
import '../booking-extra.css';

const PERIODS = [
  ['Manhã', (h) => h < 12],
  ['Tarde', (h) => h >= 12 && h < 18],
  ['Noite', (h) => h >= 18],
];

// Planos mensais (preço em centavos). O botão abre o WhatsApp da barbearia.
const PLANS = [
  { id: 'completo', icon: '👑', tone: 'gold', name: 'Cabelo, barba e sobrancelha', price: 20000 },
  { id: 'cabelo', icon: '🏆', tone: 'silver', name: 'Cabelo e sobrancelha', price: 13000 },
  { id: 'barba', icon: '🥉', tone: 'bronze', name: 'Somente barba', price: 10000 },
];

const MAX_SERVICES = 8;

const minLabel = (m) => {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
};

const priceLabel = (s) => (s.price_cents > 0 ? brl(s.price_cents) : 'Consulte');

const totalOf = (list) => ({
  price: list.reduce((n, s) => n + s.price_cents, 0),
  minutes: list.reduce((n, s) => n + s.duration_min, 0),
  consult: list.some((s) => s.price_cents === 0),
});

const gcalLink = (startsAt, minutes, title) => {
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const s = new Date(startsAt);
  const e = new Date(s.getTime() + minutes * 60000);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(s)}/${f(e)}`, location: SHOP.address });
  return `https://calendar.google.com/calendar/render?${q}`;
};

export default function Booking({ session, profile }) {
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState([]); // ids dos serviços, na ordem do clique
  const [barber, setBarber] = useState(null);
  const [date, setDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState({
    name: profile?.name || '',
    phone: profile?.phone || '',
    email: profile?.email || session?.user?.email || '',
    notes: '',
  });
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(null);

  const days = useMemo(() => Array.from({ length: SHOP.maxDaysAhead }, (_, i) => addDays(todayStr(), i)), []);

  useEffect(() => {
    (async () => {
      const [s, b, h] = await Promise.all([
        supabase.from('services').select('id,name,description,price_cents,duration_min,category').eq('active', true).order('sort'),
        supabase.from('barbers').select('id,name,photo_url').eq('active', true).order('sort'),
        supabase.from('working_hours').select('*'),
      ]);
      if (s.error || b.error || h.error) {
        setLoadError('Não foi possível carregar os horários. Atualize a página.');
        return;
      }
      setCatalog({ services: s.data, barbers: b.data, hours: Object.fromEntries(h.data.map((r) => [r.weekday, r])) });
      if (b.data.length === 1) setBarber(b.data[0]);
      // primeiro dia aberto; hoje só conta se ainda dá tempo de agendar
      const stillOpen = (d) => {
        const row = h.data.find((r) => r.weekday === weekdayOf(d));
        if (!row) return false;
        if (d !== todayStr()) return true;
        const [hh, mm] = row.close_time.split(':').map(Number);
        return nowMinutes() + SHOP.minNoticeMin < hh * 60 + mm;
      };
      setDate(days.find(stillOpen) || null);
    })();
  }, [days]);

  useEffect(() => {
    if (!barber || !date) return;
    let alive = true;
    setBusy(null);
    setSlot(null);
    supabase.rpc('busy_slots', { p_barber: barber.id, p_day: date }).then(({ data, error }) => {
      if (alive) setBusy(error ? [] : data);
    });
    return () => { alive = false; };
  }, [barber, date, refresh]);

  const picked = useMemo(
    () => (catalog ? chosen.map((id) => catalog.services.find((s) => s.id === id)).filter(Boolean) : []),
    [catalog, chosen],
  );
  const total = useMemo(() => totalOf(picked), [picked]);

  const slots = useMemo(() => {
    if (!catalog || !picked.length || !date || busy === null) return [];
    return buildSlots({
      date,
      hours: catalog.hours[weekdayOf(date)],
      durationMin: total.minutes,
      busy,
      stepMin: SHOP.slotStepMin,
      minNoticeMin: SHOP.minNoticeMin,
    });
  }, [catalog, picked, total, date, busy]);

  if (loadError) return <div className="notice"><p>{loadError}</p></div>;
  if (!catalog) return <p className="muted">Carregando…</p>;

  const multi = catalog.barbers.length > 1;
  const steps = multi ? ['Serviço', 'Barbeiro', 'Horário', 'Seus dados'] : ['Serviço', 'Horário', 'Seus dados'];
  const current = steps[step];
  const progress = done ? 100 : ((step + 1) / steps.length) * 100;
  const timeStep = steps.indexOf('Horário');
  const hasWa = digits(SHOP.whatsapp).length >= 12;
  const namesText = picked.map((s) => s.name).join(' + ');
  const totalText = `${brl(total.price)}${total.consult ? ' + a combinar' : ''}`;

  const groups = [];
  for (const s of catalog.services) {
    const key = s.category || 'Cortes';
    let g = groups.find((x) => x.name === key);
    if (!g) {
      g = { name: key, items: [] };
      groups.push(g);
    }
    g.items.push(s);
  }

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function toggleService(id) {
    setChosen((c) => {
      if (c.includes(id)) return c.filter((x) => x !== id);
      if (c.length >= MAX_SERVICES) return c;
      return [...c, id];
    });
    setSlot(null);
  }

  function validate() {
    const e = {};
    if (form.name.trim().length < 2) e.name = 'Informe seu nome.';
    const ph = digits(form.phone);
    if (ph.length < 10 || ph.length > 13) e.phone = 'Informe o WhatsApp com DDD.';
    return e;
  }

  async function submit(ev) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setSending(true);
    setSubmitError('');
    try {
      const res = await callBooking({
        action: 'book',
        barber_id: barber.id,
        service_ids: picked.map((s) => s.id),
        starts_at: slot.startsAt,
        name: form.name.trim(),
        phone: form.phone,
        notes: form.notes.trim(),
      });
      if (session?.user?.id) {
        await supabase.from('profiles').upsert({
          id: session.user.id,
          name: form.name.trim(),
          phone: digits(form.phone),
          email: session.user.email,
        }, { onConflict: 'id' });
      }
      setDone(res);
    } catch (err) {
      setSubmitError(errorMessage(err.message));
      if (['horario_ocupado', 'horario_passado'].includes(err.message)) {
        setRefresh((n) => n + 1);
        setStep(timeStep);
      }
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setDone(null);
    setChosen([]);
    setSlot(null);
    setStep(0);
    setForm({
      name: profile?.name || form.name,
      phone: profile?.phone || form.phone,
      email: profile?.email || session?.user?.email || '',
      notes: '',
    });
    setRefresh((n) => n + 1);
  }

  const summary = picked.length > 0 && barber && slot && (
    <div className="sum">
      {picked.map((s) => (
        <div key={s.id} className="sum-top">
          <span>{s.name}</span>
          <span>{priceLabel(s)}</span>
        </div>
      ))}
      {picked.length > 1 && (
        <div className="sum-top">
          <strong>Total</strong>
          <strong>{totalText}</strong>
        </div>
      )}
      <div>com {barber.name}</div>
      <div>{fmtDayLong(slot.startsAt)}, {fmtTime(slot.startsAt)} ({minLabel(total.minutes)})</div>
    </div>
  );

  if (done) {
    const msg = `Oi! Agendei ${namesText} com ${barber.name} para ${fmtDayLong(slot.startsAt)}, ${fmtTime(slot.startsAt)}. Meu nome é ${form.name.trim()}.`;
    return (
      <>
        <Pole progress={100} steps={steps} step={steps.length - 1} />
        <h2>Horário reservado</h2>
        {summary}
        {done.emailSent && <p className="muted">Enviamos a confirmação para <b>{session?.user?.email}</b>.</p>}
        <div className="stack">
          {hasWa && <a className="btn" href={waLink(SHOP.whatsapp, msg)} target="_blank" rel="noreferrer">Avisar a barbearia no WhatsApp</a>}
          <a className="btn ghost" href={gcalLink(slot.startsAt, total.minutes, `${namesText} na ${SHOP.name}`)} target="_blank" rel="noreferrer">Adicionar ao Google Agenda</a>
          <a className="link" href={`#/cancelar/${done.appointment.cancel_token}`}>Preciso cancelar</a>
          <button className="link" onClick={reset}>Fazer outro agendamento</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="account">
        <span>Olá, {form.name.split(' ')[0] || 'cliente'}</span>
        <button className="link" type="button" onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
      <Pole progress={progress} steps={steps} step={step} />
      {step > 0 && <button className="link back" onClick={() => setStep(step - 1)}>Voltar</button>}

      {current === 'Serviço' && (
        <section>
          <h2>Quais serviços?</h2>
          <p className="muted">Pode marcar mais de um. Todos ficam no mesmo horário.</p>

          {groups.map((g) => (
            <div key={g.name} className="cat">
              <h3>{g.name}</h3>
              <div className="stack">
                {g.items.map((s) => {
                  const on = chosen.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className="opt"
                      aria-pressed={on}
                      onClick={() => toggleService(s.id)}
                    >
                      <span className="opt-main">
                        <span className="tick" aria-hidden="true">{on ? '✓' : ''}</span>
                        <span>
                          <strong>{s.name}</strong>
                          {s.description && <small>{s.description}</small>}
                          <small>{minLabel(s.duration_min)}</small>
                        </span>
                      </span>
                      <strong>{priceLabel(s)}</strong>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="plans">
            <h3>Plano mensal</h3>
            <p className="muted">Toque no plano para combinar com a barbearia pelo WhatsApp.</p>
            <div className="plan-list">
              {PLANS.map((p) => (
                <a
                  key={p.id}
                  className={`plan plan-${p.tone}`}
                  href={hasWa ? waLink(SHOP.whatsapp, `Oi! Quero o plano mensal: ${p.name} (${brl(p.price)}).`) : undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="plan-ico" aria-hidden="true">{p.icon}</span>
                  <span className="plan-name">{p.name}</span>
                  <span className="plan-price">{brl(p.price)}<small>/mês</small></span>
                </a>
              ))}
            </div>
          </div>

          <div className="cart">
            <div className="cart-info">
              {picked.length === 0 ? (
                <span>Escolha pelo menos um serviço</span>
              ) : (
                <>
                  <strong>{picked.length} {picked.length === 1 ? 'serviço' : 'serviços'}</strong>
                  <span>{totalText}</span>
                  <span>{minLabel(total.minutes)}</span>
                </>
              )}
            </div>
            <button className="btn" type="button" disabled={!picked.length} onClick={() => setStep(step + 1)}>
              Continuar
            </button>
          </div>
        </section>
      )}

      {current === 'Barbeiro' && (
        <section>
          <h2>Com quem?</h2>
          <div className="pros">
            {catalog.barbers.map((b) => (
              <button
                key={b.id}
                type="button"
                className="pro"
                aria-pressed={barber?.id === b.id}
                onClick={() => { setBarber(b); setSlot(null); setStep(step + 1); }}
              >
                {b.photo_url
                  ? <img className="pro-photo" src={b.photo_url} alt="" width="88" height="88" />
                  : <span className="pro-photo pro-initial">{b.name.slice(0, 1)}</span>}
                <strong>{b.name}</strong>
              </button>
            ))}
          </div>
        </section>
      )}

      {current === 'Horário' && (
        <section>
          <h2>Qual dia e horário?</h2>
          <div className="days" role="group" aria-label="Dia">
            {days.map((d) => {
              const open = Boolean(catalog.hours[weekdayOf(d)]);
              return (
                <button key={d} className="day" disabled={!open} aria-pressed={date === d} onClick={() => setDate(d)}>
                  <small>{WEEKDAYS_SHORT[weekdayOf(d)]}</small>
                  <strong>{Number(d.slice(8))}</strong>
                </button>
              );
            })}
          </div>

          {submitError && <p className="error" role="alert">{submitError}</p>}
          {busy === null && <p className="muted">Buscando horários…</p>}
          {busy !== null && slots.length === 0 && <p className="muted">Sem horários livres nesse dia. Tente outro dia.</p>}
          {busy !== null && PERIODS.map(([label, test]) => {
            const list = slots.filter((s) => test(Number(s.time.slice(0, 2))));
            if (!list.length) return null;
            return (
              <div key={label} className="period">
                <h3>{label}</h3>
                <div className="slots">
                  {list.map((s) => (
                    <button
                      key={s.time}
                      className="slot"
                      aria-pressed={slot?.time === s.time}
                      onClick={() => { setSlot(s); setSubmitError(''); setStep(step + 1); }}
                    >
                      {s.time}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {current === 'Seus dados' && (
        <section>
          <h2>Seus dados</h2>
          {summary}
          <form onSubmit={submit} noValidate className="form">
            <label>
              Nome
              <input value={form.name} onChange={setField('name')} autoComplete="name" maxLength={80} />
              {errors.name && <span className="error">{errors.name}</span>}
            </label>
            <label>
              WhatsApp com DDD
              <input value={form.phone} onChange={setField('phone')} inputMode="tel" autoComplete="tel" placeholder="(32) 99999-9999" />
              {errors.phone && <span className="error">{errors.phone}</span>}
            </label>
            <label>
              E-mail (conta Google)
              <input type="email" value={session?.user?.email || ''} readOnly />
            </label>
            <label>
              Observação (opcional)
              <textarea value={form.notes} onChange={setField('notes')} rows={2} maxLength={200} />
            </label>
            <p className="muted">Enviamos a confirmação e um lembrete por e-mail.</p>
            {submitError && <p className="error" role="alert">{submitError}</p>}
            <button className="btn" type="submit" disabled={sending}>{sending ? 'Reservando…' : 'Confirmar agendamento'}</button>
          </form>
        </section>
      )}
    </>
  );
}

function Pole({ progress, steps, step }) {
  return (
    <div className="pole">
      <div className="pole-track"><div className="pole-fill" style={{ width: `${progress}%` }} /></div>
      <ol className="steps">
        {steps.map((s, i) => <li key={s} className={i === step ? 'on' : ''}>{s}</li>)}
      </ol>
    </div>
  );
}