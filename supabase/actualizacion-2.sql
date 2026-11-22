-- =====================================================================
--  AGENTE MÓVIL PERÚ · Actualización 2 de la base de datos
--  Pegar TODO en Supabase > SQL Editor > Run. Se puede ejecutar más de una vez.
--  Reemplaza TU-CANAL-SECRETO por el nombre de tu canal de ntfy.
-- =====================================================================

-- 1. Solicitudes externas y cuenta de destino del depósito
alter table public.loans alter column client_id drop not null;
alter table public.loans
  add column if not exists ext_name text,
  add column if not exists ext_dni text,
  add column if not exists ext_phone text,
  add column if not exists deposit_method text,
  add column if not exists deposit_number text,
  add column if not exists deposit_bank text,
  add column if not exists deposit_holder text;

grant insert (requested_amount, requested_days, purpose, client_id,
              ext_name, ext_dni, ext_phone,
              deposit_method, deposit_number, deposit_bank, deposit_holder)
  on public.loans to authenticated;

-- El cliente crea solo sus propias solicitudes; el admin también las externas
drop policy if exists loans_insert on public.loans;
create policy loans_insert on public.loans for insert
  with check (status = 'pendiente' and (
    (client_id = auth.uid() and ext_name is null) or public.is_admin()));

-- El cliente puede eliminar sus solicitudes mientras están en revisión
drop policy if exists loans_delete on public.loans;
create policy loans_delete on public.loans for delete
  using (public.is_admin() or (client_id = auth.uid() and status = 'pendiente'));

-- 2. No permitir dos cuentas con el mismo número de celular
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare tel text := nullif(trim(new.raw_user_meta_data->>'phone'), '');
begin
  if tel is not null and exists (select 1 from public.profiles where phone = tel) then
    raise exception 'Ese número de celular ya está registrado';
  end if;
  insert into public.profiles (id, email, full_name, dni, phone)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'dni', tel);
  return new;
end $$;

-- 3. Notificación al admin con los datos completos del solicitante
create or replace function public.notify_new_loan()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.client_id is null then return new; end if;   -- solicitud externa: la creó el admin
  select coalesce(full_name, email) as nombre, coalesce(dni, '—') as dni, coalesce(phone, '—') as cel
    into p from profiles where id = new.client_id;
  insert into notifications (user_id, title, body, loan_id)
  select a.id, 'Nueva solicitud de préstamo',
         p.nombre || ' (DNI ' || p.dni || ', cel. ' || p.cel || ') solicitó un préstamo por S/ '
           || to_char(new.requested_amount, 'FM999G999G990D00') || ' a ' || new.requested_days || ' días.',
         new.id
  from profiles a where a.role = 'admin';
  return new;
end $$;

-- 4. Aviso al cliente cuando cambia el estado (no aplica a solicitudes externas)
create or replace function public.notify_loan_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is null or new.status is not distinct from old.status then return new; end if;
  insert into notifications (user_id, title, body, loan_id)
  values (new.client_id,
    case new.status
      when 'depositado' then '¡Tu crédito fue aprobado y depositado!'
      when 'rechazado'  then 'Tu solicitud no fue aprobada'
      when 'pagado'     then 'Crédito cancelado. ¡Gracias!'
      else 'Actualización de tu crédito' end,
    case new.status
      when 'depositado' then 'Se depositaron S/ ' || to_char(new.approved_amount, 'FM999G999G990D00')
           || '. Interés ' || trim(to_char(new.daily_rate, 'FM990D0')) || '% diario. Si pagas el '
           || to_char(new.due_date, 'DD/MM/YYYY') || ', el total será S/ ' || to_char(new.total_to_pay, 'FM999G999G990D00') || '.'
      when 'rechazado'  then coalesce(new.admin_note, 'Comunícate con nosotros para más información.')
      when 'pagado'     then 'Tu préstamo quedó totalmente pagado.'
      else null end,
    new.id);
  return new;
end $$;

-- 5. Aviso con sonido al teléfono del admin (ntfy), con DNI y celular
create extension if not exists pg_net;
create or replace function public.push_new_loan()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.client_id is null then return new; end if;
  select coalesce(full_name, email) as nombre, coalesce(dni, '—') as dni, coalesce(phone, '—') as cel
    into p from profiles where id = new.client_id;
  perform net.http_post(
    url     := 'https://ntfy.sh/',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object(
      'topic',    'TU-CANAL-SECRETO',
      'title',    'Nueva solicitud de préstamo',
      'message',  p.nombre || ' (DNI ' || p.dni || ', cel. ' || p.cel || ') solicitó S/ '
                  || to_char(new.requested_amount, 'FM999G999G990D00') || ' por ' || new.requested_days
                  || ' días. Abre Agente Móvil para revisarla.',
      'priority', 4,
      'tags',     jsonb_build_array('moneybag')));
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists loans_push_after_insert on public.loans;
create trigger loans_push_after_insert after insert on public.loans
  for each row execute function public.push_new_loan();
