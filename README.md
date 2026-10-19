# Barbearia L.A: agendamento online

Site de agendamento para a Barbearia L.A. O cliente escolhe serviço, barbeiro, dia e horário. O sistema:

- impede dois agendamentos no mesmo horário (a regra fica no banco, não só na tela);
- manda e-mail de confirmação para o cliente e aviso para o barbeiro;
- manda lembrete por e-mail para os dois, antes do horário;
- deixa o cliente cancelar pelo link do e-mail;
- oferece um painel (`#/admin`) com a agenda do dia, bloqueio de horários, cancelamento e botão de lembrete no WhatsApp.

Stack: React + Vite, Supabase (banco, login e funções) e Resend (e-mails).

## 1. Rodar no seu computador

Precisa do Node 18 ou mais novo.

```bash
npm install
cp .env.example .env     # preencha depois do passo 2
npm run dev              # abre em http://localhost:5173
npm test                 # testes das regras de horário
```

## 2. Supabase (banco e login)

1. Crie um projeto em supabase.com.
2. Abra **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
   Antes, na última linha, troque `troque-por-seu-email@exemplo.com` pelo e-mail que vai entrar no painel.
3. Em **Authentication > Users > Add user**, crie esse mesmo e-mail com uma senha (marque "Auto Confirm User").
   Opcional: em **Authentication > Sign In / Providers**, desative "Allow new users to sign up".
4. Em **Project Settings > API**, copie a URL e a chave `anon` (ou `publishable`) para o `.env`.
5. Em **Table Editor**, ajuste `services` (preço e duração), `barbers` (preencha `email` e `whatsapp` do barbeiro) e `working_hours` (0 = domingo ... 6 = sábado; dia sem linha = fechado; intervalo opcional).

Os serviços, preços e horários que vêm no SQL são exemplos.

## 3. E-mails (Resend)

1. Crie uma conta em resend.com e gere uma API key.
2. Para enviar a clientes (e não só para o seu próprio e-mail), o Resend exige um domínio verificado. Adicione o domínio em **Domains** e crie os registros DNS que ele mostrar.
3. O plano gratuito tem limite diário de 100 e-mails. Cada agendamento gera até 4 (confirmação e lembrete, para cliente e barbeiro).

Para trocar de provedor, mexa só na função `sendEmail` em `supabase/functions/_shared/mail.ts`.

## 4. Funções do Supabase

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF   # o código que aparece na URL do projeto
npx supabase secrets set \
  RESEND_API_KEY=re_xxxxxxxx \
  MAIL_FROM="Barbearia L.A <agendamentos@seudominio.com.br>" \
  SHOP_EMAIL=email-do-dono@exemplo.com \
  SITE_URL=https://seu-site.vercel.app \
  CRON_SECRET=uma-senha-longa-qualquer
npx supabase functions deploy booking
npx supabase functions deploy send-reminders --no-verify-jwt
```

- `SHOP_EMAIL` recebe os avisos quando o barbeiro não tem e-mail cadastrado.
- `SITE_URL` é o endereço público do site (entra no link de cancelamento dos e-mails). Se ainda não publicou, rode o comando de novo depois.
- `REMINDER_MINUTES` (opcional, padrão 180) define quanto tempo antes do horário o lembrete sai.
- Se o CLI reclamar do `supabase/config.toml`, apague o arquivo e rode `npx supabase init`.

## 5. Lembretes automáticos

No **SQL Editor**, rode (trocando os dois valores):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('lembretes-barbearia', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'A_MESMA_CRON_SECRET')
  );
$$);
```

A cada 10 minutos o sistema procura agendamentos que começam dentro da janela de lembrete e ainda não foram avisados.

## 6. Publicar (GitHub e Vercel)

1. Suba a pasta no GitHub (o `.env` já está no `.gitignore`).
2. Na Vercel: **Add New Project**, escolha o repositório e, em **Environment Variables**, cadastre `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_SHOP_WHATSAPP` (só dígitos, com 55 e DDD).
3. Deploy. Depois atualize o `SITE_URL` no passo 4 com o endereço final.

As rotas usam `#` (ex.: `/#/admin`), então não precisa de configuração extra de redirecionamento.

## 7. Teste completo (5 minutos)

1. Faça um agendamento com o seu e-mail. Confira a confirmação, o aviso no e-mail do barbeiro e a tela final.
2. Tente reservar o mesmo horário de outro navegador: tem que ser recusado.
3. Entre em `/#/admin`, veja o agendamento, teste "Lembrar no WhatsApp" e "Bloquear horário".
4. Abra o link "Cancele por aqui" do e-mail, cancele e veja o horário voltar a ficar livre.
5. Para testar o lembrete sem esperar, marque um horário para daqui a 3 horas ou mais, apague o valor de `reminded_at` dessa linha no Table Editor e espere a próxima rodada de 10 minutos.

## Onde mexer

| O quê | Onde |
|---|---|
| Nome, endereço, Instagram, passo dos horários, antecedência mínima | `src/config.js` |
| Cores, fontes, visual | `src/styles.css` |
| Textos dos e-mails | `supabase/functions/_shared/mail.ts` |
| Serviços, barbeiros, horários | Table Editor do Supabase |
| Regras de agendamento | `supabase/schema.sql` (função `book_appointment`) |

## Fica para as próximas versões

- WhatsApp automático (hoje há o botão que abre o WhatsApp com a mensagem pronta).
- Painel para editar serviços, barbeiros e horários sem passar pelo Supabase.
- Mais de um serviço por agendamento, e a opção "sem preferência" de barbeiro.
- Avisar o cliente quando a barbearia cancela pelo painel.
- Pagamento por Pix ou sinal.
