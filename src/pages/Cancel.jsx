import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { callBooking, errorMessage } from '../lib/api.js';
import { fmtDayLong, fmtTime } from '../lib/format.js';

export default function Cancel({ token }) {
  const [info, setInfo] = useState(undefined);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.rpc('appointment_by_token', { p_token: token || '' }).then(({ data, error: err }) => {
      setInfo(err || !data?.length ? null : data[0]);
    });
  }, [token]);

  async function cancel() {
    setState('working');
    setError('');
    try {
      await callBooking({ action: 'cancel', token });
      setState('done');
    } catch (e) {
      setError(errorMessage(e.message));
      setState('idle');
    }
  }

  if (info === undefined) return <p className="muted">Carregando…</p>;
  if (info === null) {
    return (
      <div className="notice">
        <h2>Link inválido</h2>
        <p>Não encontramos esse agendamento. Use o link do e-mail de confirmação.</p>
        <a className="link" href="#/">Fazer um agendamento</a>
      </div>
    );
  }

  const when = `${fmtDayLong(info.starts_at)}, ${fmtTime(info.starts_at)}`;

  if (state === 'done' || info.status === 'cancelled') {
    return (
      <>
        <h2>Agendamento cancelado</h2>
        <p className="muted">Quando quiser, é só marcar outro horário.</p>
        <a className="btn" href="#/">Fazer um agendamento</a>
      </>
    );
  }

  return (
    <>
      <h2>Cancelar agendamento</h2>
      <div className="sum">
        <div className="sum-top"><strong>{info.service_name || 'Serviço'}</strong></div>
        <div>com {info.barber_name}</div>
        <div>{when}</div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="stack">
        <button className="btn" onClick={cancel} disabled={state === 'working'}>
          {state === 'working' ? 'Cancelando…' : 'Cancelar agendamento'}
        </button>
        <a className="link" href="#/">Manter meu horário</a>
      </div>
    </>
  );
}
