-- Cadastro do cliente (Google). Cole no SQL Editor do Supabase e clique em Run.
-- Pode rodar mais de uma vez: não apaga agendamentos nem serviços.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  phone text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.appointments
  add column if not exists user_id uuid references auth.users(id);

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

drop policy if exists profiles_own_select on public.profiles;
drop policy if exists profiles_own_insert on public.profiles;
drop policy if exists profiles_own_update on public.profiles;

create policy profiles_own_select on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_own_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy profiles_own_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email,
        name = case
          when public.profiles.name = '' then excluded.name
          else public.profiles.name
        end,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.book_appointment(
  p_barber uuid, p_service uuid, p_starts timestamptz,
  p_name text, p_phone text, p_email text, p_notes text default null,
  p_user uuid default null
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
    (barber_id, service_id, client_name, client_phone, client_email, notes, starts_at, ends_at, user_id)
  values
    (p_barber, p_service, p_name, p_phone, p_email, p_notes, p_starts, v_ends, p_user)
  returning * into v_row;

  return v_row;
exception
  when exclusion_violation then
    raise exception 'horario_ocupado';
end;
$$;

revoke execute on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.book_appointment(uuid, uuid, timestamptz, text, text, text, text, uuid)
  to service_role;
