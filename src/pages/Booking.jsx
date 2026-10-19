import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { SHOP } from '../config.js';
import { brl, todayStr, addDays, weekdayOf, nowMinutes, WEEKDAYS_SHORT, fmtTime, fmtDayLong, digits, waLink } from '../lib/format.js';
import { buildSlots } from '../lib/slots.js';
import { callBooking, errorMessage } from '../lib/api.js';

const PERIODS = [
  ['Manhã', (h) => h < 12],
  ['Tarde', (h) => h >= 12 && h < 18],
  ['Noite', (h) => h >= 18],
];

const gcalLink = (startsAt, minutes, title) => {
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const s = new Date(startsAt);
  const e = new Date(s.getTime() + minutes * 60000);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(s)}/${f(e)}`, location: SHOP.address });
  return `https://calendar.google.com/calendar/render?${q}`;
};

export default function Booking() {
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(0);
  const [service, setService] = useState(null);
  const [barber, setBarber] = useState(null);
  const [date, setDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(null);

  const days = useMemo(() => Array.from({ length: SHOP.maxDaysAhead }, (_, i) => addDays(todayStr(), i)), []);

  useEffect(() => {
    (async () => {
      const [s, b, h] = await Promise.all([
        supabase.from('services').select('id,name,description,price_cents,duration_min').eq('active', true).order('sort'),
        supabase.from('barbers').select('id,name').eq('active', true).order('sort'),
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

  const slots = useMemo(() => {
    if (!catalog || !service || !date || busy === null) return [];
    return buildSlots({
      date,
      hours: catalog.hours[weekdayOf(date)],
      durationMin: service.duration_min,
      busy,
      stepMin: SHOP.slotStepMin,
      minNoticeMin: SHOP.minNoticeMin,
    });
  }, [catalog, service, date, busy]);

  if (loadError) return <div className="notice"><p>{loadError}</p></div>;
  if (!catalog) return <p className="muted">Carregando…</p>;

  const multi = catalog.barbers.length > 1;
  const steps = multi ? ['Serviço', 'Barbeiro', 'Horário', 'Seus dados'] : ['Serviço', 'Horário', 'Seus dados'];
  const current = steps[step];
  const progress = done ? 100 : ((step + 1) / steps.length) * 100;
  const timeStep = steps.indexOf('Horário');

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e = {};
    if (form.name.trim().length < 2) e.name = 'Informe seu nome.';
    const ph = digits(form.phone);
    if (ph.length < 10 || ph.length > 13) e.phone = 'Informe o WhatsApp com DDD.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = 'Informe um e-mail válido.';
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
        service_id: service.id,
        starts_at: slot.startsAt,
        name: form.name.trim(),
        phone: form.phone,
        email: form.email.trim(),
        notes: form.notes.trim(),
      });
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
    setService(null);
    setSlot(null);
    setStep(0);
    setForm({ name: '', phone: '', email: '', notes: '' });
    setRefresh((n) => n + 1);
  }

  const summary = service && barber && slot && (
    <div className="sum">
      <div className="sum-top">
        <strong>{service.name}</strong>
        <span>{brl(service.price_cents)}</span>
      </div>
      <div>com {barber.name}</div>
      <div>{fmtDayLong(slot.startsAt)}, {fmtTime(slot.startsAt)}</div>
    </div>
  );

  if (done) {
    const hasWa = digits(SHOP.whatsapp).length >= 12;
    const msg = `Oi! Agendei ${service.name} com ${barber.name} para ${fmtDayLong(slot.startsAt)}, ${fmtTime(slot.startsAt)}. Meu nome é ${form.name.trim()}.`;
    return (
      <>
        <Pole progress={100} steps={steps} step={steps.length - 1} />
        <h2>Horário reservado</h2>
        {summary}
        {done.emailSent && <p className="muted">Enviamos a confirmação para <b>{form.email.trim()}</b>.</p>}
        <div className="stack">
          {hasWa && <a className="btn" href={waLink(SHOP.whatsapp, msg)} target="_blank" rel="noreferrer">Avisar a barbearia no WhatsApp</a>}
          <a className="btn ghost" href={gcalLink(slot.startsAt, service.duration_min, `${service.name} na ${SHOP.name}`)} target="_blank" rel="noreferrer">Adicionar ao Google Agenda</a>
          <a className="link" href={`#/cancelar/${done.appointment.cancel_token}`}>Preciso cancelar</a>
          <button className="link" onClick={reset}>Fazer outro agendamento</button>
        </div>
      </>
    );
  }

  return (
    <>
      <Pole progress={progress} steps={steps} step={step} />
      {step > 0 && <button className="link back" onClick={() => setStep(step - 1)}>Voltar</button>}

      {current === 'Serviço' && (
        <section>
          <h2>Qual serviço?</h2>
          <div className="stack">
            {catalog.services.map((s) => (
              <button
                key={s.id}
                className="opt"
                aria-pressed={service?.id === s.id}
                onClick={() => { setService(s); setSlot(null); setStep(1); }}
              >
                <span>
                  <strong>{s.name}</strong>
                  {s.description && <small>{s.description}</small>}
                  <small>{s.duration_min} min</small>
                </span>
                <strong>{brl(s.price_cents)}</strong>
              </button>
            ))}
          </div>
        </section>
      )}

      {current === 'Barbeiro' && (
        <section>
          <h2>Com quem?</h2>
          <div className="stack">
            {catalog.barbers.map((b) => (
              <button
                key={b.id}
                className="opt"
                aria-pressed={barber?.id === b.id}
                onClick={() => { setBarber(b); setSlot(null); setStep(step + 1); }}
              >
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
              E-mail
              <input type="email" value={form.email} onChange={setField('email')} autoComplete="email" />
              {errors.email && <span className="error">{errors.email}</span>}
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
