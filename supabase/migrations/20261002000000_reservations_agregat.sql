-- Agregat de reservations — AUCUN identifiant de compte n'en sort.
--
-- Ces chiffres se calculent sur ho_private.record_write_reservations, table qui existe
-- deja pour appliquer un quota : c'est une necessite technique, pas une mesure. Aucun
-- identifiant nouveau n'est cree, aucun cookie, aucune empreinte, et rien n'est envoye
-- vers les analytics.
--
-- NOMMAGE, et ce n'est pas un detail de style : il s'agit de RESERVATIONS, jamais de
-- preuves finalisees. Une reservation jamais finalisee gonfle ces chiffres. Mesurer la
-- finalisation exigerait de joindre l'etat du registre a l'identite du compte — la liaison
-- que la doctrine interdit. Si quelqu'un renomme ces colonnes en « preuve », le glissement
-- commence la.
--
-- La fonction rend UNE ligne de nombres. Elle ne peut pas rendre de lignes par compte.

create or replace function ho_private.reservations_agregat(
  depuis timestamptz default now() - interval '90 days'
)
returns table (
  accounts_with_first_reservation          bigint,
  accounts_with_second_reservation_by_d7   bigint,
  accounts_with_second_reservation_by_d30  bigint
)
language sql
security definer
set search_path = ho_private, pg_catalog
as $$
  with premieres as (
    select account_id,
           min(created_at) as premiere
    from ho_private.record_write_reservations
    where created_at >= depuis
    group by account_id
  ),
  secondes as (
    select p.account_id,
           p.premiere,
           min(r.created_at) as seconde
    from premieres p
    join ho_private.record_write_reservations r
      on r.account_id = p.account_id
     and r.created_at > p.premiere
    group by p.account_id, p.premiere
  )
  select
    (select count(*) from premieres)                                             as accounts_with_first_reservation,
    (select count(*) from secondes where seconde <= premiere + interval '7 days')  as accounts_with_second_reservation_by_d7,
    (select count(*) from secondes where seconde <= premiere + interval '30 days') as accounts_with_second_reservation_by_d30;
$$;

-- Personne d'autre que le role de service ne peut l'appeler, et elle ne rend de toute
-- facon que des nombres.
revoke all on function ho_private.reservations_agregat(timestamptz) from public, anon, authenticated;
