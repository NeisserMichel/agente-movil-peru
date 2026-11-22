-- =====================================================================
--  Aviso con sonido al teléfono del administrador (por la app "ntfy")
--  cuando un cliente solicita un crédito.
--  Reemplaza TU-CANAL-SECRETO por el nombre de tu canal de ntfy.
--  No publiques el nombre real de tu canal: quien lo conozca vería los avisos.
-- =====================================================================
create extension if not exists pg_net;

create or replace function public.push_new_loan()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select coalesce(full_name, email) into who from profiles where id = new.client_id;
  perform net.http_post(
    url     := 'https://ntfy.sh/',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object(
      'topic',    'TU-CANAL-SECRETO',
      'title',    'Nueva solicitud de préstamo',
      'message',  who || ' solicitó S/ ' || to_char(new.requested_amount, 'FM999G999G990D00')
                  || ' a ' || new.requested_days || ' días. Abre Agente Móvil para revisarla.',
      'priority', 4,
      'tags',     jsonb_build_array('moneybag')
    )
  );
  return new;
exception when others then
  return new;  -- si el aviso falla, la solicitud se guarda igual
end $$;

drop trigger if exists loans_push_after_insert on public.loans;
create trigger loans_push_after_insert after insert on public.loans
  for each row execute function public.push_new_loan();
