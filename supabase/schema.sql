-- Barbearia L.A: banco de dados do agendamento
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------- tabelas

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_cents int not null check (price_cents >= 0),
  duration_min int not null check (duration_min between 5 and 480),
  active boolean not null default true,
  sort int not null default 0
);

create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,        -- recebe os avisos e lembretes (se vazio, usa o SHOP_EMAIL)
  whatsapp text,     -- só dígitos, com 55
  active boolean not null default true,
  sort int not null default 0
);

-- Expediente por dia da semana (0 = domingo ... 6 = sábado). Dia sem linha = fechado.
create table public.working_hours (
  weekday int primary key check (weekday between 0 and 6),
  open_time time not null,
  close_time time not null,
  break_start time,
  break_end time,
  check (close_time > open_time)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id),
  service_id uuid references public.services(id),
  client_name text not null check (char_length(client_name) between 1 and 80),
  client_phone text,
  client_email text,
  notes text check (char_length(notes) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled', 'done', 'no_show', 'blocked')),
  cancel_token uuid not null default gen_random_uuid(),
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- o banco impede dois horários sobrepostos para o mesmo barbeiro
  constraint no_overlap exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('confirmed', 'blocked', 'done', 'no_show'))
);

create index appointments_starts_at_idx on public.appointments (starts_at);
create index appointments_token_idx on public.appointments (cancel_token);

-- Quem pode entrar no painel
create table public.admins (email text primary key);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- --------------------------------------------------------------- permissões

alter table public.services enable row level security;
alter table public.barbers enable row level security;
alter table public.working_hours enable row level security;
alter table public.appointments enable row level security;
alter table public.admins enable row level security;

revoke all on public.services, public.barbers, public.working_hours,
  public.appointments, public.admins from anon, authenticated;

-- visitantes só leem o catálogo (e do barbeiro, só id e nome)
grant select on public.services, public.working_hours to anon;
grant select (id, name, active, sort) on public.barbers to anon;

-- quem está logado como admin mexe em tudo, menos na tabela admins
grant select, insert, update, delete on public.services, public.barbers,
  public.working_hours, public.appointments to authenticated;
grant select on public.services, public.working_hours to authenticated;
grant select (id, name, active, sort) on public.barbers to authenticated;

create policy services_read on public.services for select using (active or public.is_admin());
create policy services_admin on public.services for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy barbers_read on public.barbers for select using (active or public.is_admin());
create policy barbers_admin on public.barbers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy hours_read on public.working_hours for select using (true);
create policy hours_admin on public.working_hours for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy appointments_admin on public.appointments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- barbers: o admin precisa ler email e whatsapp também
grant select (email, whatsapp) on public.barbers to authenticated;

-- ---------------------------------------------------------------- funções

-- Horários ocupados de um barbeiro num dia (sem dados do cliente)
create or replace function public.busy_slots(p_barber uuid, p_day date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.starts_at, a.ends_at
  from public.appointments a
  where a.barber_id = p_barber
    and a.status in ('confirmed', 'blocked', 'done', 'no_show')
    and a.starts_at < ((p_day + 1)::timestamp at time zone 'America/Sao_Paulo')
    and a.ends_at > (p_day::timestamp at time zone 'America/Sao_Paulo');
$$;

-- Dados básicos de um agendamento a partir do link de cancelamento
create or replace function public.appointment_by_token(p_token uuid)
returns table (starts_at timestamptz, status text, barber_name text, service_name text)
language sql stable security definer set search_path = public as $$
  select a.starts_at, a.status, b.name, s.name
  from public.appointments a
  join public.barbers b on b.id = a.barber_id
  left join public.services s on s.id = a.service_id
  where a.cancel_token = p_token;
$$;

-- Cria o agendamento validando expediente, intervalo e conflito.
-- Só a Edge Function (service_role) chama esta função.
create or replace function public.book_appointment(
  p_barber uuid, p_service uuid, p_starts timestamptz,
  p_name text, p_phone text, p_email text, p_notes text default null
) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  v_dur int;
  v_ends timestamptz;
  v_local timestamp;
  v_end_local timestamp;
  v_h public.working_hours;
  v_row public.appointments;
begin
  select duration_min into v_dur from public.services where id = p_service and active;
  if v_dur is null then raise exception 'servico_invalido'; end if;
  if not exists (select 1 from public.barbers where id = p_barber and active) then
    raise exception 'barbeiro_invalido';
  end if;
  if p_starts < now() then raise exception 'horario_passado'; end if;

  v_ends := p_starts + make_interval(mins => v_dur);
  v_local := p_starts at time zone 'America/Sao_Paulo';
  v_end_local := v_ends at time zone 'America/Sao_Paulo';

  select * into v_h from public.working_hours where weekday = extract(dow from v_local)::int;
  if not found then raise exception 'fechado'; end if;

  if v_end_local::date <> v_local::date
     or v_local::time < v_h.open_time
     or v_end_local::time > v_h.close_time then
    raise exception 'fora_do_expediente';
  end if;

  if v_h.break_start is not null
     and v_local::time < v_h.break_end
     and v_end_local::time > v_h.break_start then
    raise exception 'intervalo';
  end if;

  if (select count(*) from public.appointments
      where lower(client_email) = lower(p_email)
        and status = 'confirmed' and starts_at > now()) >= 3 then
    raise exception 'limite_agendamentos';
  end if;

  insert into public.appointments
    (barber_id, service_id, client_name, client_phone, client_email, notes, starts_at, ends_at)
  values
    (p_barber, p_service, p_name, p_phone, p_email, p_notes, p_starts, v_ends)
  returning * into v_row;

  return v_row;
exception
  when exclusion_violation then
    raise exception 'horario_ocupado';
end;
$$;

-- Cancelamento pelo link que o cliente recebe por e-mail
create or replace function public.cancel_by_token(p_token uuid)
returns public.appointments
language plpgsql security definer set search_path = public as $$
declare v_row public.appointments;
begin
  update public.appointments
     set status = 'cancelled'
   where cancel_token = p_token and status = 'confirmed' and starts_at > now()
  returning * into v_row;
  if v_row.id is null then raise exception 'nao_cancelavel'; end if;
  return v_row;
end;
$$;

revoke execute on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text)
  to service_role;

revoke execute on function public.cancel_by_token(uuid) from public, anon, authenticated;
grant execute on function public.cancel_by_token(uuid) to service_role;

grant execute on function public.busy_slots(uuid, date) to anon, authenticated;
grant execute on function public.appointment_by_token(uuid) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ------------------------------------------------------- dados iniciais
-- Valores de exemplo: ajuste preços, durações, barbeiros e horários.

insert into public.services (name, description, price_cents, duration_min, sort) values
  ('Corte', 'Corte com acabamento.', 4000, 30, 1),
  ('Barba', 'Barba alinhada.', 3000, 30, 2),
  ('Corte e barba', 'Os dois no mesmo horário.', 6500, 60, 3),
  ('Sobrancelha', 'Sobrancelha na navalha.', 1500, 30, 4);

insert into public.barbers (name, sort) values ('Laender', 1);

-- terça a sábado, sem intervalo (domingo e segunda fechado)
insert into public.working_hours (weekday, open_time, close_time) values
  (2, '09:00', '19:00'), (3, '09:00', '19:00'), (4, '09:00', '19:00'),
  (5, '09:00', '19:00'), (6, '09:00', '18:00');

-- Quem entra no painel: troque pelo seu e-mail (o mesmo do usuário que você criar em Authentication)
insert into public.admins (email) values ('troque-por-seu-email@exemplo.com');
