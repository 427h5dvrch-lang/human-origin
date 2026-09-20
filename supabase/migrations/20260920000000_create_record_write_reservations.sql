-- Migration : réservations d'écriture au registre
-- HumanOrigin Registry Write Authorization v1
-- 2026-09-20
--
-- Une réservation lie un record_id à un compte, AVANT que l'identifiant n'existe
-- dans un document. C'est ce qui interdit la préemption : un tiers obtenant ensuite
-- le document, l'identifiant et la clé AES ne peut toujours pas publier.
--
-- Schéma PRIVÉ : aucune exposition PostgREST. Seule la fonction edge y accède, avec
-- la clé service role. account_id sert uniquement à l'autorisation et à la
-- ré-émission ; il n'est jamais exposé par le registre ni intégré au Record.
--
-- Pas d'état « published » en V1, pas d'expiration ni de réattribution de la
-- réservation : seule la capability expire, et elle se ré-émet.

create schema if not exists ho_private;
revoke all on schema ho_private from public, anon, authenticated;

create table ho_private.record_write_reservations (
  record_id                 text primary key
                            check (record_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  account_id                uuid        not null,
  created_at                timestamptz not null default now(),
  last_capability_issued_at timestamptz
);

-- Quota par compte et fenêtre glissante : la lecture doit être bornée, pas un scan.
create index record_write_reservations_account_idx
  on ho_private.record_write_reservations (account_id, created_at desc);

revoke all on ho_private.record_write_reservations from public, anon, authenticated;

-- Quota de nouvelles réservations, par compte et par fenêtre. Atomique : la vérification
-- et l'insertion se font dans la MÊME transaction, sous verrou du compte. Deux appels
-- simultanés ne peuvent pas dépasser le quota ensemble.
--
-- La valeur par défaut n'est pas une constante protocolaire : elle est portée par un
-- paramètre, pour être ajustable sans migration.
create or replace function ho_private.reserve_record_id(
  p_account_id uuid,
  p_record_id  text,
  p_quota      integer default 100,
  p_window     interval default '24 hours'
) returns table (reserved boolean, reason text)
language plpgsql
security definer
set search_path = ho_private, pg_catalog
as $$
declare
  v_count integer;
begin
  -- Verrou consultatif par compte : sérialise les réservations concurrentes d'un même
  -- compte sans bloquer les autres.
  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 0));

  select count(*) into v_count
    from ho_private.record_write_reservations
   where account_id = p_account_id
     and created_at > now() - p_window;

  if v_count >= p_quota then
    return query select false, 'quota_exceeded'::text;
    return;
  end if;

  insert into ho_private.record_write_reservations (record_id, account_id, last_capability_issued_at)
  values (p_record_id, p_account_id, now());

  return query select true, null::text;
exception
  when unique_violation then
    -- L'identifiant est produit par le serveur : une collision relève de l'anomalie.
    return query select false, 'record_id_taken'::text;
end;
$$;

revoke all on function ho_private.reserve_record_id(uuid, text, integer, interval)
  from public, anon, authenticated;
