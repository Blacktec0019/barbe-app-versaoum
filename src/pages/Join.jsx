import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { SHOP } from '../config.js';
import { digits } from '../lib/format.js';
import { googleName } from '../lib/useAuth.js';

const PERKS = [
  'Confirmação no e-mail real da sua conta Google',
  'Lembrete antes do horário, para não esquecer',
  'Cancelamento pelo link, se algo mudar',
];

export default function Join({ session, profile, onSaved }) {
  if (session && !profile?.complete) {
    return <CompleteProfile session={session} profile={profile} onSaved={onSaved} />;
  }
  return <Welcome />;
}

function Welcome() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('error')) setError('O Google não concluiu o login. Tente de novo.');
  }, []);

  async function enterGoogle() {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (err) {
      setError('Não foi possível abrir o Google agora. Tente de novo em instantes.');
      setBusy(false);
    }
  }

  return (
    <section className="join">
      <div className="join-card">
        <div className="join-pole" aria-hidden="true" />
        <p className="join-eyebrow">{SHOP.name}</p>
        <h2>Sua cadeira espera por você</h2>
        <p className="join-lead">
          Entre com o Google para garantir que a confirmação do horário chegue no e-mail certo.
          Leva poucos segundos e você já pode escolher o serviço.
        </p>
        <ul className="join-perks">
          {PERKS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-google" type="button" onClick={enterGoogle} disabled={busy}>
          <GoogleMark />
          {busy ? 'Abrindo o Google…' : 'Continuar com Google'}
        </button>
        <p className="join-note">Usamos só nome, e-mail e foto da sua conta para o agendamento. Sem spam.</p>
      </div>
      <p className="join-quote">“Corte certo, no horário certo.” · {SHOP.address}</p>
    </section>
  );
}

function CompleteProfile({ session, profile, onSaved }) {
  const [name, setName] = useState(profile?.name || googleName(session.user) || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const email = session.user.email || '';

  async function save(e) {
    e.preventDefault();
    const cleanName = name.trim();
    const ph = digits(phone);
    if (cleanName.length < 2) return setError('Informe seu nome.');
    if (ph.length < 10 || ph.length > 13) return setError('Informe o WhatsApp com DDD.');
    setBusy(true);
    setError('');
    const row = {
      id: session.user.id,
      name: cleanName,
      phone: ph.length <= 11 ? `55${ph}` : ph,
      email,
    };
    const { error: err } = await supabase.from('profiles').upsert(row, { onConflict: 'id' });
    setBusy(false);
    if (err) {
      setError('Não foi possível salvar seus dados. Atualize a página e tente de novo.');
      return;
    }
    onSaved({ name: row.name, phone: row.phone, email, complete: true });
  }

  return (
    <section className="join">
      <div className="join-card join-card-light">
        <p className="join-eyebrow">Quase lá</p>
        <h2>Complete seu cadastro</h2>
        <p className="join-lead dark">
          Sua conta Google já está ligada. Falta só o WhatsApp para a barbearia te encontrar se precisar.
        </p>
        <form onSubmit={save} className="form" noValidate>
          <label>
            Nome
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
          </label>
          <label>
            WhatsApp com DDD
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="(32) 99999-9999" />
          </label>
          <label>
            E-mail (conta Google)
            <input type="email" value={email} readOnly />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Entrar para agendar'}</button>
        </form>
        <button className="link" type="button" onClick={() => supabase.auth.signOut()}>Usar outra conta</button>
      </div>
    </section>
  );
}

function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.5 5.6-6.7 7.1l6.3 5.3C37.3 38.3 44 33.5 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}
