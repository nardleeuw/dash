-- Deleting an organization (or a user whose memberships cascade) must not fail
-- on the audit trigger: rows removed by an organization-delete cascade would be
-- logged against an organization that no longer exists (FK violation). Their
-- audit trail is deleted with the organization anyway, so skip those inserts.
create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_changed jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    if (v_row ->> 'org_id') is not null
       and not exists (select 1 from public.organizations o where o.id = (v_row ->> 'org_id')::uuid) then
      return old;
    end if;
  else
    v_row := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_changed
    from jsonb_each(v_row)
    where key not in ('updated_at', 'body', 'alt_body', 'ciphertext')
      and v_old -> key is distinct from value;
    if v_changed = '{}'::jsonb then
      return new;
    end if;
  end if;

  insert into public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    (v_row ->> 'org_id')::uuid,
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', v_changed) else '{}'::jsonb end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
