import { useEffect, useState } from 'react';
import Booking from './pages/Booking.jsx';
import Cancel from './pages/Cancel.jsx';
import Admin from './pages/Admin.jsx';
import Join from './pages/Join.jsx';
import { configured, supabase } from './lib/supabase.js';
import { useAuth, googleName } from './lib/useAuth.js';
import { digits } from './lib/format.js';
import { SHOP } from './config.js';

const parse = () => window.location.hash.replace(/^#\/?/, '').split('/');

function profileComplete(row) {
  if (!row) return false;
  const ph = digits(row.phone || '');
  return String(row.name || '').trim().length >= 2 && ph.length >= 10;
}

export default function App() {
  const [route, setRoute] = useState(parse());
  const session = useAuth();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('name,phone,email')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!alive) return;
      const name = data?.name || googleName(session.user);
      const phone = data?.phone || '';
      const email = data?.email || session.user.email || '';
      setProfile({ name, phone, email, complete: profileComplete({ name, phone }) });
    })();
    return () => { alive = false; };
  }, [session]);

  const [page, arg] = route;
  const isAdmin = page === 'admin';
  const ready = Boolean(session && profile?.complete);

  let title = 'Agende seu horário';
  if (isAdmin) title = 'Painel da barbearia';
  else if (!session) title = SHOP.name;

  return (
    <>
      <header className="hero">
        <div className="hero-in">
          <img src="/logo.png" alt={SHOP.name} width="92" height="92" />
          <div>
            <h1>{title}</h1>
            <p>{SHOP.address}</p>
          </div>
        </div>
      </header>
      <div className="stitch" aria-hidden="true" />
      <main className="wrap">
        {!configured ? (
          <div className="notice">
            <h2>Falta configurar o Supabase</h2>
            <p>Copie o arquivo <code>.env.example</code> para <code>.env</code>, preencha as chaves e reinicie o site. O passo a passo está no README.</p>
          </div>
        ) : isAdmin ? (
          <Admin />
        ) : page === 'cancelar' ? (
          <Cancel token={arg} />
        ) : session === undefined || (session && profile === null) ? (
          <p className="muted">Carregando…</p>
        ) : ready ? (
          <Booking session={session} profile={profile} />
        ) : (
          <Join session={session} profile={profile} onSaved={setProfile} />
        )}
      </main>
      <footer className="foot">
        <a href={`https://instagram.com/${SHOP.instagram}`} target="_blank" rel="noreferrer">@{SHOP.instagram}</a>
        <a href={isAdmin ? '#/' : '#/admin'}>{isAdmin ? 'Voltar ao agendamento' : 'Acesso da barbearia'}</a>
      </footer>
    </>
  );
}
