-- Migration : table des attestations de Record (ho-evidence)
-- HumanOrigin Record Attestation v1 — endpoint countersign-record
-- 2026-09-19
--
-- Table DISTINCTE de public.proofs, qui sert le protocole HO-JSON. Les deux ne
-- partagent ni schéma, ni clé de signature, ni endpoint.
--
-- record_digest est unique : une seule attestation par engagement de Record.
-- account_id reste côté serveur, pour l'anti-abus et l'audit ; il n'apparaît
-- jamais dans l'attestation distribuée.

create table if not exists public.record_attestations (
  record_digest     text          primary key
                    check (record_digest ~ '^[0-9a-f]{64}$'),
  account_id        uuid          not null,
  key_id            text          not null,
  version           integer       not null default 1,
  server_signed_at  timestamptz   not null,
  signature         text          not null,
  created_at        timestamptz   not null default now()
);

-- Recherche par compte, pour l'anti-abus. Jamais exposée publiquement.
create index if not exists record_attestations_account_idx
  on public.record_attestations (account_id, created_at desc);

-- Aucun accès direct : la fonction edge opère avec la clé service role.
alter table public.record_attestations enable row level security;
