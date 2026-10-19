import { supabase } from './supabase.js';

export async function callBooking(payload) {
  const { data, error } = await supabase.functions.invoke('booking', { body: payload });
  if (error) {
    let code = 'erro_interno';
    try {
      code = (await error.context.json()).error || code;
    } catch { /* resposta sem JSON */ }
    throw new Error(code);
  }
  return data;
}

const MESSAGES = {
  horario_ocupado: 'Esse horário acabou de ser reservado. Escolha outro.',
  horario_passado: 'Esse horário já passou. Escolha outro.',
  fechado: 'A barbearia fecha nesse dia. Escolha outro dia.',
  fora_do_expediente: 'Esse horário está fora do expediente.',
  intervalo: 'Esse horário cai no intervalo da barbearia.',
  limite_agendamentos: 'Você já tem 3 agendamentos em aberto com esse e-mail.',
  dados_invalidos: 'Confira seus dados e tente de novo.',
  nao_cancelavel: 'Esse agendamento não pode mais ser cancelado por aqui. Fale com a barbearia.',
};

export const errorMessage = (code) =>
  MESSAGES[code] || 'Algo deu errado do nosso lado. Tente de novo em instantes.';
