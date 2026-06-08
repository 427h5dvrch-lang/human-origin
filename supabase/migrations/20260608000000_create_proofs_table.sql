-- Migration: create proofs table for HumanOrigin server attestation
-- HO-JSON v1 — server_attestation countersign registry P0
-- 2026-06-08

create table if not exists public.proofs (
  proof_id              uuid          primary key,
  payload_sha256        text          not null unique,
  document_sha256       text,
  issued_at             timestamptz,
  server_signed_at      timestamptz   not null,
  app_version           text          not null,
  security_schema_version text        not null,
  issuer_account_id     uuid          not null,
  organization_id       uuid,
  visible_verdict       text          not null,
  server_key_id         text          not null,
  server_signature      text          not null,
  status                text          not null default 'active',
  revoked_at            timestamptz,
  revocation_reason     text,
  created_at            timestamptz   default now()
);

-- Indexes
create index if not exists proofs_issuer_account_id_idx
  on public.proofs (issuer_account_id);

create index if not exists proofs_status_idx
  on public.proofs (status);

create index if not exists proofs_server_signed_at_idx
  on public.proofs (server_signed_at desc);

-- RLS
alter table public.proofs enable row level security;

-- Authenticated users can only read their own proofs.
-- Service role (edge function) bypasses RLS and can insert freely.
create policy "Users can view own proofs"
  on public.proofs
  for select
  to authenticated
  using (issuer_account_id = auth.uid());

-- No direct insert/update/delete for end users — edge function uses service role.
