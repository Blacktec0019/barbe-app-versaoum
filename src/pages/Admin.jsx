import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { SHOP } from '../config.js';
import { brl, todayStr, addDays, toISO, fmtTime, fmtDayLong, waLink } from '../lib/format.js';

const STATUS = {
  confirmed: 'Agendado',
  done: 'Concluído',
  no_show: 'Faltou',
  cancelled: 'Cancelado',
  blocked: 'Bloqueado',
};

export default function Admin() {
  const [session, setSession] = useState(undefined);
  const [isAdmin, setIsAdmin] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setIsAdmin(null); return; }
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(Boolean(data)));
  }, [session]);

  if (session === undefined) return <p className="muted">Carregando…</p>;
  if (!session) return <Login />;
  if (isAdmin === null) return <p className="muted">Verificando acesso…</p>;
  if (!isAdmin) {
    return (
      <div className="notice">
        <h2>Sem acesso</h2>
        <p>O e-mail {session.user.email} não está na lista de administradores.</p>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
    );
  }
  return <Agenda />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) setError('E-mail ou senha incorretos.');
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="form">
      <h2>Entrar</h2>
      <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
      <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
    </form>
  );
}

function Agenda() {
  const [date, setDate] = useState(todayStr());
  const [barbers, setBarbers] = useState([]);
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const [reload, setReload] = useState(0);
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    supabase.from('barbers').select('id,name').order('sort').then(({ data }) => setBarbers(data || []));
  }, []);

  useEffect(() => {
    let alive = true;
    setRows(null);
    supabase
      .from('appointments')
      .select('id,barber_id,starts_at,ends_at,status,client_name,client_phone,notes,barbers(name),services(name,price_cents)')
      .gte('starts_at', toISO(date, '00:00'))
      .lt('starts_at', toISO(addDays(date, 1), '00:00'))
      .order('starts_at')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setMsg('Não foi possível carregar a agenda.');
        setRows(error ? [] : data);
      });
    return () => { alive = false; };
  }, [date, reload]);

  async function setStatus(id, status) {
    const { error } = await supabase.from('appointments').update({ status }).eq('id', id);
    if (error) setMsg('Não foi possível atualizar. Tente de novo.');
    else { setMsg(''); setReload((n) => n + 1); }
  }

  const visible = (rows || []).filter((r) => filter === 'all' || r.barber_id === filter);
  const counted = visible.filter((r) => ['confirmed', 'done'].includes(r.status) && r.services);
  const total = counted.reduce((sum, r) => sum + r.services.price_cents, 0);

  const remind = (r) =>
    waLink(
      r.client_phone,
      `Oi, ${r.client_name.split(' ')[0]}! Passando pra lembrar do seu horário na ${SHOP.name}: ${fmtDayLong(r.starts_at)}, ${fmtTime(r.starts_at)}. Te esperamos!`,
    );

  return (
    <>
      <div className="bar">
        <button className="link" onClick={() => setDate(addDays(date, -1))}>Dia anterior</button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Dia" />
        <button className="link" onClick={() => setDate(addDays(date, 1))}>Próximo dia</button>
      </div>
      <div className="bar">
        <button className="link" onClick={() => setDate(todayStr())}>Hoje</button>
        {barbers.length > 1 && (
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Barbeiro">
            <option value="all">Todos os barbeiros</option>
            {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <button className="link" onClick={() => setBlocking((v) => !v)}>{blocking ? 'Fechar bloqueio' : 'Bloquear horário'}</button>
      </div>

      {blocking && (
        <BlockForm
          barbers={barbers}
          date={date}
          onDone={(m) => { setMsg(m || ''); if (!m) { setBlocking(false); setReload((n) => n + 1); } }}
        />
      )}

      <h2>{fmtDayLong(toISO(date, '12:00'))}</h2>
      {counted.length > 0 && <p className="muted">{counted.length} atendimento(s), {brl(total)} previsto.</p>}
      {msg && <p className="error" role="alert">{msg}</p>}
      {rows === null && <p className="muted">Carregando…</p>}
      {rows !== null && visible.length === 0 && <p className="muted">Nenhum agendamento nesse dia.</p>}

      <ul className="agenda">
        {visible.map((r) => (
          <li key={r.id} className={`row ${r.status === 'cancelled' ? 'off' : ''}`}>
            <div className="time">{fmtTime(r.starts_at)}</div>
            <div>
              <strong>{r.status === 'blocked' ? 'Horário bloqueado' : r.client_name}</strong>
              <div className="muted">
                {r.status === 'blocked'
                  ? `${r.barbers?.name}, até ${fmtTime(r.ends_at)}`
                  : `${r.services?.name || 'Serviço'} com ${r.barbers?.name}`}
              </div>
              {r.notes && <div className="muted">Obs.: {r.notes}</div>}
              <div className="tags"><span className="tag">{STATUS[r.status]}</span></div>
              <div className="acts">
                {r.status === 'confirmed' && (
                  <>
                    {r.client_phone && <a className="link" href={remind(r)} target="_blank" rel="noreferrer">Lembrar no WhatsApp</a>}
                    <button className="link" onClick={() => setStatus(r.id, 'done')}>Concluído</button>
                    <button className="link" onClick={() => setStatus(r.id, 'no_show')}>Faltou</button>
                    <button className="link" onClick={() => window.confirm('Cancelar este agendamento?') && setStatus(r.id, 'cancelled')}>Cancelar</button>
                  </>
                )}
                {r.status === 'blocked' && <button className="link" onClick={() => setStatus(r.id, 'cancelled')}>Remover bloqueio</button>}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <button className="link" onClick={() => supabase.auth.signOut()}>Sair</button>
    </>
  );
}

function BlockForm({ barbers, date, onDone }) {
  const [barber, setBarber] = useState(barbers[0]?.id || '');
  const [from, setFrom] = useState('12:00');
  const [to, setTo] = useState('13:00');

  async function submit(e) {
    e.preventDefault();
    if (!barber || to <= from) return onDone('Confira o barbeiro e o intervalo de horas.');
    const { error } = await supabase.from('appointments').insert({
      barber_id: barber,
      client_name: 'Bloqueio',
      starts_at: toISO(date, from),
      ends_at: toISO(date, to),
      status: 'blocked',
    });
    if (error) onDone(error.code === '23P01' ? 'Já existe um agendamento nesse intervalo.' : 'Não foi possível bloquear.');
    else onDone('');
  }

  return (
    <form onSubmit={submit} className="form block">
      {barbers.length > 1 && (
        <label>Barbeiro
          <select value={barber} onChange={(e) => setBarber(e.target.value)}>
            {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      <div className="two">
        <label>De<input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Até<input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <button className="btn" type="submit">Bloquear nesse dia</button>
    </form>
  );
}
