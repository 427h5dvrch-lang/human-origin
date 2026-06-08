// supabase/functions/proof-registry/index.ts
// HumanOrigin — Public proof registry lookup P0
// GET /functions/v1/proof-registry?id={proof_id}
//
// Public endpoint (verify_jwt = false). Returns minimal public fields only.
// Never exposes: issuer_account_id, organization_id, server_signature,
//                payload_sha256, document_sha256, local keys.
//
// Environment secrets required:
//   SERVICE_ROLE_KEY  — Supabase service role key (to bypass RLS for read)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://bhlisgvozsgqxugrfsiu.supabase.co";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    console.error("FATAL: SERVICE_ROLE_KEY manquant");
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  const url = new URL(req.url);
  const proofId = url.searchParams.get("id");

  if (!proofId) {
    return json({ ok: false, error: "Missing required parameter: id" }, 400);
  }

  if (!UUID_RE.test(proofId)) {
    return json({ ok: false, error: "Invalid proof_id format" }, 400);
  }

  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Explicitly select only public fields — never expose private identifiers
  const { data, error } = await admin
    .from("proofs")
    .select(
      "proof_id, status, server_signed_at, visible_verdict, server_key_id, app_version, security_schema_version, revoked_at, revocation_reason"
    )
    .eq("proof_id", proofId)
    .maybeSingle();

  if (error) {
    console.error("DB select error:", error);
    return json({ ok: false, error: "Database error" }, 500);
  }

  if (!data) {
    return json({ ok: false, error: "proof_not_found" }, 404);
  }

  const row = data as Record<string, unknown>;

  return json({
    ok: true,
    proof_id: row["proof_id"],
    status: row["status"],
    server_signed_at: row["server_signed_at"],
    visible_verdict: row["visible_verdict"],
    server_key_id: row["server_key_id"],
    app_version: row["app_version"],
    security_schema_version: row["security_schema_version"],
    revoked_at: row["revoked_at"] ?? null,
    revocation_reason: row["revocation_reason"] ?? null,
  });
});
