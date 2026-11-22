-- =====================================================================
--  AGENTE MÓVIL PERÚ · Base de datos (Supabase / PostgreSQL)
--  Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- =====================================================================

-- ---------- 1. PERFILES (un perfil por usuario registrado) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  dni         text,
  phone       text,
  role        text not null default 'cliente' check (role in ('cliente','admin')),
  created_at  timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando alguien se registra
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, dni, phone)
  values (new.id, new.email,
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'dni',
          new.raw_user_meta_data->>'phone');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ¿El usuario actual es administrador?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- 2. PRÉSTAMOS ----------
create table if not exists public.loans (
  id                bigint generated always as identity primary key,
  client_id         uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  -- lo que pide el cliente
  requested_amount  numeric(12,2) not null check (requested_amount > 0),
  requested_days    int not null check (requested_days between 1 and 365),
  purpose           text,
  -- lo que configura el administrador
  status            text not null default 'pendiente'
                    check (status in ('pendiente','depositado','rechazado','pagado')),
  approved_amount   numeric(12,2),
  daily_rate        numeric(6,3),          -- % diario, ej. 0.200 o 0.300
  term_days         int,
  total_interest    numeric(12,2),
  total_to_pay      numeric(12,2),
  start_date        date,
  due_date          date,
  admin_note        text,
  created_at        timestamptz not null default now(),
  decided_at        timestamptz,
  paid_at           timestamptz
);
create index if not exists loans_client_idx on public.loans(client_id);
create index if not exists loans_status_idx on public.loans(status);

-- ---------- 3. PAGOS / ABONOS ----------
create table if not exists public.payments (
  id          bigint generated always as identity primary key,
  loan_id     bigint not null references public.loans(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  paid_on     date not null default current_date,
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------- 4. NOTIFICACIONES ----------
create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  body        text,
  loan_id     bigint references public.loans(id) on delete cascade,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notif_user_idx on public.notifications(user_id, read);

-- Nueva solicitud -> avisar a todos los administradores
create or replace function public.notify_new_loan()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select coalesce(full_name, email) into who from profiles where id = new.client_id;
  insert into notifications (user_id, title, body, loan_id)
  select p.id, 'Nueva solicitud de préstamo',
         who || ' solicitó un préstamo por S/ ' || to_char(new.requested_amount, 'FM999G999G990D00')
             || ' a ' || new.requested_days || ' días.',
         new.id
  from profiles p where p.role = 'admin';
  return new;
end $$;

drop trigger if exists loans_after_insert on public.loans;
create trigger loans_after_insert after insert on public.loans
  for each row execute function public.notify_new_loan();

-- Cambio de estado -> avisar al cliente
create or replace function public.notify_loan_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into notifications (user_id, title, body, loan_id)
    values (new.client_id,
      case new.status
        when 'depositado' then '¡Tu crédito fue aprobado y depositado!'
        when 'rechazado'  then 'Tu solicitud no fue aprobada'
        when 'pagado'     then 'Crédito cancelado. ¡Gracias!'
        else 'Actualización de tu crédito' end,
      case new.status
        when 'depositado' then 'Se depositaron S/ ' || to_char(new.approved_amount, 'FM999G999G990D00')
             || '. Total a pagar: S/ ' || to_char(new.total_to_pay, 'FM999G999G990D00')
             || ' hasta el ' || to_char(new.due_date, 'DD/MM/YYYY') || '.'
        when 'rechazado'  then coalesce(new.admin_note, 'Comunícate con nosotros para más información.')
        when 'pagado'     then 'Tu préstamo quedó totalmente pagado.'
        else null end,
      new.id);
  end if;
  return new;
end $$;

drop trigger if exists loans_after_update on public.loans;
create trigger loans_after_update after update on public.loans
  for each row execute function public.notify_loan_status();

-- ---------- 5. SEGURIDAD (Row Level Security) ----------
alter table public.profiles      enable row level security;
alter table public.loans         enable row level security;
alter table public.payments      enable row level security;
alter table public.notifications enable row level security;

-- Perfiles: cada uno ve el suyo; el admin ve todos.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
-- El cliente solo puede cambiar estos campos (nunca su "role")
revoke update on public.profiles from authenticated;
grant update (full_name, dni, phone) on public.profiles to authenticated;

-- Préstamos: el cliente ve y crea los suyos; solo el admin los modifica.
drop policy if exists loans_select on public.loans;
create policy loans_select on public.loans for select
  using (client_id = auth.uid() or public.is_admin());
drop policy if exists loans_insert on public.loans;
create policy loans_insert on public.loans for insert
  with check (client_id = auth.uid() and status = 'pendiente');
drop policy if exists loans_update on public.loans;
create policy loans_update on public.loans for update
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists loans_delete on public.loans;
create policy loans_delete on public.loans for delete using (public.is_admin());
-- El cliente solo puede llenar estos campos al solicitar
revoke insert on public.loans from authenticated;
grant insert (requested_amount, requested_days, purpose) on public.loans to authenticated;

-- Pagos: el admin los registra; el cliente ve los de sus préstamos.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (public.is_admin() or exists (select 1 from public.loans l where l.id = loan_id and l.client_id = auth.uid()));
drop policy if exists payments_admin on public.payments;
create policy payments_admin on public.payments for all
  using (public.is_admin()) with check (public.is_admin());

-- Notificaciones: cada uno ve y marca como leídas las suyas.
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 6. TIEMPO REAL (notificaciones al instante) ----------
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.loans;
exception when duplicate_object then null; end $$;

-- =====================================================================
--  PASO FINAL (después de registrarte en la app con TU correo):
--  update public.profiles set role = 'admin' where email = 'tucorreo@ejemplo.com';
-- =====================================================================
