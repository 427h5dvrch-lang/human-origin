// supabase/functions/countersign-proof/index.ts
// HumanOrigin — Server countersign P0
// POST /functions/v1/countersign-proof
//
// Validates a HO-JSON v1 document (no document content), signs a server_attestation
// with the official HumanOrigin server key, and registers it in the proofs table.
//
// Environment secrets required:
//   HUMANORIGIN_SERVER_SIGNING_PRIVATE_KEY_B64  — base64 of 32-byte Ed25519 seed
//   HUMANORIGIN_SERVER_KEY_ID                   — opaque server key identifier
//   HUMANORIGIN_SERVER_PUBLIC_KEY_B64           — base64 of 32-byte Ed25519 public key
//   SERVICE_ROLE_KEY                            — Supabase service role key

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as ed from "https://esm.sh/@noble/ed25519@1.7.3";

const SUPABASE_URL = "https://bhlisgvozsgqxugrfsiu.supabase.co";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Recursive lexicographic key sort (RFC 8785 JCS). */
function canonicalize(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(canonicalize);
  return Object.fromEntries(
    Object.keys(obj as Record<string, unknown>)
      .sort()
      .map((k) => [k, canonicalize((obj as Record<string, unknown>)[k])])
  );
}

async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Bytes(str: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str)
  );
  return new Uint8Array(buf);
}

function b64ToU8(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function u8ToB64(u8: Uint8Array): string {
  return btoa(String.fromCharCode(...u8));
}

/** Decode a lowercase hex string to raw bytes. */
function hexToU8(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

type Payload = Record<string, unknown>;

/**
 * Search for a string field in payload at depth 0 or 1.
 * Checks payload[key], then each direct object child's [key].
 */
function findField(payload: Payload, key: string): string | null {
  const top = payload[key];
  if (typeof top === "string") return top;
  for (const val of Object.values(payload)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = (val as Payload)[key];
      if (typeof nested === "string") return nested;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    // --- Server key + service role check (fail fast) ---
    const privKeyB64 = Deno.env.get(
      "HUMANORIGIN_SERVER_SIGNING_PRIVATE_KEY_B64"
    );
    const serverKeyId = Deno.env.get("HUMANORIGIN_SERVER_KEY_ID");
    const pubKeyB64 = Deno.env.get("HUMANORIGIN_SERVER_PUBLIC_KEY_B64");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!privKeyB64 || !serverKeyId || !pubKeyB64) {
      console.error("FATAL: server signing key not configured");
      return json({ ok: false, error: "server signing key not configured" }, 500);
    }
    if (!serviceRoleKey) {
      console.error("FATAL: SERVICE_ROLE_KEY manquant");
      return json({ ok: false, error: "Server configuration error" }, 500);
    }

    // --- Auth: extract and validate Bearer JWT ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ ok: false, error: "Unauthorized: no token" }, 401);

    const admin = createClient(SUPABASE_URL, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "Unauthorized: invalid token" }, 401);
    }
    const userId = userData.user.id;

    // --- Parse body ---
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    // Reject any attempt to send document content
    if ("document_content" in body || "document_bytes" in body || "file_content" in body) {
      return json(
        { ok: false, error: "Document content must not be sent to countersign endpoint" },
        400
      );
    }

    // --- Structural validation ---
    const format = body["format"];
    const version = body["version"];
    const payload = body["payload"] as Payload | null;
    const payloadSha256 = body["payload_sha256"];
    const signatures = body["signatures"];

    if (format !== "humanorigin-hojson") {
      return json({ ok: false, error: "Invalid format: expected humanorigin-hojson" }, 400);
    }
    if (!version || typeof version !== "string") {
      return json({ ok: false, error: "Missing or invalid version" }, 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ ok: false, error: "Missing or invalid payload" }, 400);
    }
    if (!payloadSha256 || typeof payloadSha256 !== "string") {
      return json({ ok: false, error: "Missing payload_sha256" }, 400);
    }
    if (!Array.isArray(signatures) || signatures.length === 0) {
      return json({ ok: false, error: "Missing or empty signatures array" }, 400);
    }

    const sig0 = signatures[0] as Record<string, unknown>;
    const localSig = sig0["signature"];
    const localPubKey = sig0["public_key"];

    if (!localSig || typeof localSig !== "string") {
      return json({ ok: false, error: "Missing local signature in signatures[0]" }, 400);
    }
    if (!localPubKey || typeof localPubKey !== "string") {
      return json({ ok: false, error: "Missing local public_key in signatures[0]" }, 400);
    }

    // --- Payload metadata checks ---
    const appVersion = findField(payload, "app_version");
    if (!appVersion) {
      return json({ ok: false, error: "Missing app_version in payload" }, 400);
    }

    const securitySchemaVersion = findField(payload, "security_schema_version");
    if (!securitySchemaVersion) {
      return json({ ok: false, error: "Missing security_schema_version in payload" }, 400);
    }

    const visibleVerdict = findField(payload, "visible_verdict");
    if (!visibleVerdict) {
      return json({ ok: false, error: "Missing visible_verdict in payload" }, 400);
    }

    // --- Recalculate payload_sha256 from canonical(payload) ---
    const canonicalPayload = JSON.stringify(canonicalize(payload));
    const recomputed = await sha256Hex(canonicalPayload);
    if (recomputed !== payloadSha256) {
      return json(
        {
          ok: false,
          error: "payload_sha256 mismatch: recomputed hash does not match",
        },
        400
      );
    }

    // --- Verify local Ed25519 signature ---
    // Message: raw 32 bytes of the SHA256 hash (hex-decoded payload_sha256)
    try {
      if (payloadSha256.length !== 64) {
        return json({ ok: false, error: "payload_sha256 is not a valid SHA256 hex string" }, 400);
      }
      const msgBytes = hexToU8(payloadSha256);
      const sigBytes = b64ToU8(localSig);
      const pubKeyBytes = b64ToU8(localPubKey);
      const isValid = await ed.verify(sigBytes, msgBytes, pubKeyBytes);
      if (!isValid) {
        return json({ ok: false, error: "Local Ed25519 signature verification failed" }, 400);
      }
    } catch (e) {
      console.error("Ed25519 verify error:", e);
      return json(
        { ok: false, error: "Local signature verification error: " + String(e) },
        400
      );
    }

    // --- Extract optional fields from payload ---
    const docSection = payload["document"] as Payload | null;
    const documentSha256 =
      typeof docSection?.["sha256"] === "string" ? (docSection["sha256"] as string) : null;

    const issuedAt = findField(payload, "issued_at") ??
      findField(payload, "created_at") ??
      null;

    // --- Anti-replay: check for existing proof ---
    const { data: existing, error: selectErr } = await admin
      .from("proofs")
      .select("proof_id, status")
      .eq("payload_sha256", payloadSha256)
      .maybeSingle();

    if (selectErr) {
      console.error("DB select error:", selectErr);
      return json({ ok: false, error: "Database error during duplicate check" }, 500);
    }
    if (existing) {
      return json(
        {
          ok: false,
          error: "Duplicate payload: a proof already exists for this payload_sha256",
          proof_id: (existing as Record<string, unknown>)["proof_id"],
        },
        409
      );
    }

    // --- Build server_attestation (without server_signature) ---
    const proofId = crypto.randomUUID();
    const serverSignedAt = new Date().toISOString();

    const attestationCore = {
      proof_id: proofId,
      payload_sha256: payloadSha256,
      document_sha256: documentSha256,
      local_signature: localSig,
      local_public_key: localPubKey,
      issuer_account_id: userId,
      organization_id: null,
      app_version: appVersion,
      security_schema_version: securitySchemaVersion,
      server_signed_at: serverSignedAt,
      server_key_id: serverKeyId,
      registry_url: null,
    };

    // Sign SHA256(canonical(attestationCore)) → 32 bytes message
    const attestationDigest = await sha256Bytes(
      JSON.stringify(canonicalize(attestationCore))
    );
    const privKeyBytes = b64ToU8(privKeyB64);
    const serverSigBytes = await ed.sign(attestationDigest, privKeyBytes);
    const serverSigB64 = u8ToB64(serverSigBytes);

    const serverAttestation = { ...attestationCore, server_signature: serverSigB64 };

    // --- Insert into proofs table ---
    const { error: insErr } = await admin.from("proofs").insert({
      proof_id: proofId,
      payload_sha256: payloadSha256,
      document_sha256: documentSha256,
      issued_at: issuedAt,
      server_signed_at: serverSignedAt,
      app_version: appVersion,
      security_schema_version: securitySchemaVersion,
      issuer_account_id: userId,
      organization_id: null,
      visible_verdict: visibleVerdict,
      server_key_id: serverKeyId,
      server_signature: serverSigB64,
      status: "active",
    });

    if (insErr) {
      if ((insErr as { code?: string }).code === "23505") {
        // Race condition: another request inserted the same payload_sha256 concurrently
        return json(
          { ok: false, error: "Duplicate payload: concurrent insert detected" },
          409
        );
      }
      console.error("DB insert error:", insErr);
      return json({ ok: false, error: "Database insert failed" }, 500);
    }

    return json({
      ok: true,
      proof_id: proofId,
      server_attestation: serverAttestation,
      status: "active",
    });
  } catch (e) {
    console.error("Unhandled function error:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
