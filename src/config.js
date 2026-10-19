// Dados da barbearia e regras do agendamento. Serviços, barbeiros e horários ficam no Supabase.
export const SHOP = {
  name: 'Barbearia L.A',
  address: 'Rua da Lavoura, 214 - Centro',
  instagram: 'barbearia_l_a_',
  whatsapp: import.meta.env.VITE_SHOP_WHATSAPP || '',
  slotStepMin: 30,   // de quanto em quanto tempo aparece um horário
  minNoticeMin: 30,  // antecedência mínima para agendar
  maxDaysAhead: 14,  // quantos dias pra frente o cliente enxerga
};
