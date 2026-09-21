-- Migration : pont public vers les réservations d'écriture au registre
-- HumanOrigin Registry Write Authorization v1
-- 2026-09-21
--
-- ho_private N'EST PAS exposé à PostgREST, et ne doit pas l'être. La clé service role
-- contourne RLS, mais pas la liste des schémas exposés : l'Edge Function ne peut donc pas
-- atteindre ho_private par .schema("ho_private"). C'est la cause du 503 observé.
--
-- Ce pont expose UNE seule fonction dans public, exécutable par le seul service_role. Elle
-- encapsule les trois accès d'origine sans rien changer à la sémantique :
--
--   mode 'reserve' : délègue à ho_private.reserve_record_id — quota et insertion restent
--                    atomiques, sous verrou du compte, dans la fonction privée inchangée.
--   mode 'reissue' : contrôle de propriété ET trace de ré-émission dans la MÊME instruction.
--                    La ligne d'un autre compte ne peut être ni touchée, ni distinguée d'une
--                    ligne inexistante : les deux cas rendent 'not_found'.
--
-- Elle ne retourne JAMAIS account_id : le compte est un filtre, pas une sortie.
-- Aucune table publique n'est créée. Aucun droit n'est accordé sur la table privée.

-- Garde de collision, AVANT toute création. « create or replace » remplacerait en silence
-- une fonction homonyme préexistante ; aucune introspection n'étant disponible hors ligne,
-- c'est la migration qui tranche, et elle refuse plutôt que d'écraser. La transaction
-- garantit qu'un refus ne laisse rien derrière lui.
do $$
begin
  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'ho_registry_write_reservation'
  ) then
    raise exception
      'public.ho_registry_write_reservation existe deja : refus de remplacer une fonction non prevue par cette migration';
  end if;
end $$;

create or replace function public.ho_registry_write_reservation(
  p_mode       text,
  p_account_id uuid,
  p_record_id  text
) returns table (outcome text, record_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserved boolean;
  v_reason   text;
  v_rid      text;
begin
  if p_account_id is null or p_record_id is null then
    return query select 'invalid_arguments'::text, null::text;
    return;
  end if;

  if p_mode = 'reserve' then
    select r.reserved, r.reason into v_reserved, v_reason
      from ho_private.reserve_record_id(p_account_id, p_record_id) as r;
    if v_reserved then
      return query select 'reserved'::text, p_record_id;
    else
      return query select coalesce(v_reason, 'reservation_failed')::text, null::text;
    end if;
    return;
  end if;

  if p_mode = 'reissue' then
    update ho_private.record_write_reservations as t
       set last_capability_issued_at = pg_catalog.now()
     where t.record_id  = p_record_id
       and t.account_id = p_account_id
    returning t.record_id into v_rid;

    if v_rid is null then
      return query select 'not_found'::text, null::text;
    else
      return query select 'reissued'::text, v_rid;
    end if;
    return;
  end if;

  return query select 'invalid_mode'::text, null::text;
end;
$$;

-- Droits. `create function` accorde EXECUTE à PUBLIC par défaut, et les privilèges par
-- défaut de Supabase sur le schéma public accordent en outre EXECUTE à anon et
-- authenticated. Ces trois révocations sont donc indispensables, et non décoratives.
-- Elles s'exécutent dans la MÊME transaction que la création : aucune session tierce
-- ne voit l'état intermédiaire.
revoke execute on function public.ho_registry_write_reservation(text, uuid, text) from public;
revoke execute on function public.ho_registry_write_reservation(text, uuid, text) from anon;
revoke execute on function public.ho_registry_write_reservation(text, uuid, text) from authenticated;
grant  execute on function public.ho_registry_write_reservation(text, uuid, text) to service_role;

-- Garde-fou : la migration échoue plutôt que de laisser un droit résiduel. Un test statique
-- ne peut pas observer la base ; ce contrôle, lui, s'exécute là où la vérité se trouve.
do $$
declare
  v_reste text;
begin
  select pg_catalog.string_agg(r, ', ') into v_reste
    from pg_catalog.unnest(array['anon', 'authenticated']) as r
   where pg_catalog.has_function_privilege(
           r, 'public.ho_registry_write_reservation(text, uuid, text)', 'EXECUTE');

  if v_reste is not null then
    raise exception 'droit EXECUTE résiduel sur le pont pour : %', v_reste;
  end if;

  if not pg_catalog.has_function_privilege(
           'service_role', 'public.ho_registry_write_reservation(text, uuid, text)', 'EXECUTE') then
    raise exception 'service_role ne peut pas exécuter le pont';
  end if;

  -- La table privée ne doit recevoir aucun droit, par ce pont ni autrement.
  if pg_catalog.has_table_privilege('anon', 'ho_private.record_write_reservations', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'ho_private.record_write_reservations', 'SELECT')
  then
    raise exception 'la table privée est devenue lisible par anon ou authenticated';
  end if;
end $$;
