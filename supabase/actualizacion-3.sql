-- =====================================================================
--  AGENTE MÓVIL PERÚ · Actualización 3: créditos en "tiempo libre"
--  Pegar TODO en Supabase > SQL Editor > Run. Se puede ejecutar más de una vez.
--  Reemplaza TU-CANAL-SECRETO por el nombre de tu canal de ntfy.
-- =====================================================================

-- Un crédito en tiempo libre no tiene número de días
alter table public.loans alter column requested_days drop not null;

create or replace function public.notify_new_loan()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.client_id is null then return new; end if;
  select coalesce(full_name, email) as nombre, coalesce(dni, '—') as dni, coalesce(phone, '—') as cel
    into p from profiles where id = new.client_id;
  insert into notifications (user_id, title, body, loan_id)
  select a.id, 'Nueva solicitud de préstamo',
         p.nombre || ' (DNI ' || p.dni || ', cel. ' || p.cel || ') solicitó un préstamo por S/ '
           || to_char(new.requested_amount, 'FM999G999G990D00')
           || case when new.requested_days is null then ' en tiempo libre.' else ' a ' || new.requested_days || ' días.' end,
         new.id
  from profiles a where a.role = 'admin';
  return new;
end $$;

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
           || '. Interés ' || trim(to_char(new.daily_rate, 'FM990D0')) || '% diario. '
           || case when new.due_date is null then 'Tiempo libre: paga el total de tu deuda cuando quieras.'
                   else 'Si pagas el ' || to_char(new.due_date, 'DD/MM/YYYY') || ', el total será S/ '
                        || to_char(new.total_to_pay, 'FM999G999G990D00') || '.' end
      when 'rechazado'  then coalesce(new.admin_note, 'Comunícate con nosotros para más información.')
      when 'pagado'     then 'Tu préstamo quedó totalmente pagado.'
      else null end,
    new.id);
  return new;
end $$;

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
                  || to_char(new.requested_amount, 'FM999G999G990D00')
                  || case when new.requested_days is null then ' en tiempo libre' else ' por ' || new.requested_days || ' días' end
                  || '. Abre Agente Móvil para revisarla.',
      'priority', 4,
      'tags',     jsonb_build_array('moneybag')));
  return new;
exception when others then
  return new;
end $$;
