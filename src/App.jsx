import { useEffect, useState } from 'react';
import Booking from './pages/Booking.jsx';
import Cancel from './pages/Cancel.jsx';
import Admin from './pages/Admin.jsx';
import { configured } from './lib/supabase.js';
import { SHOP } from './config.js';

const parse = () => window.location.hash.replace(/^#\/?/, '').split('/');

export default function App() {
  const [route, setRoute] = useState(parse());
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const [page, arg] = route;
  const isAdmin = page === 'admin';

  return (
    <>
      <header className="hero">
        <div className="hero-in">
          <img src="/logo.png" alt={SHOP.name} width="92" height="92" />
          <div>
            <h1>{isAdmin ? 'Painel da barbearia' : 'Agende seu horário'}</h1>
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
        ) : (
          <Booking />
        )}
      </main>
      <footer className="foot">
        <a href={`https://instagram.com/${SHOP.instagram}`} target="_blank" rel="noreferrer">@{SHOP.instagram}</a>
        <a href={isAdmin ? '#/' : '#/admin'}>{isAdmin ? 'Voltar ao agendamento' : 'Acesso da barbearia'}</a>
      </footer>
    </>
  );
}
