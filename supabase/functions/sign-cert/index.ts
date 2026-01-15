import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --------------------
// Helpers
// --------------------
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function hexToBytes32(hex: string): Uint8Array {
  const s = hex.trim();
  if (s.length !== 64) throw new Error("payload_hash must be 64 hex chars");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const byteStr = s.slice(i * 2, i * 2 + 2);
    const v = Number.parseInt(byteStr, 16);
    if (Number.isNaN(v)) throw new Error("payload_hash invalid hex");
    out[i] = v;
  }
  return out;
}

// Canonical stringify (tri des clés) => même hash partout (browser / Deno)
function canonicalStringify(value: any): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(value[k]));
  return "{" + parts.join(",") + "}";
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256B64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToB64(new Uint8Array(sig));
}

// --------------------
// Main (ONE server to rule them all)
// --------------------
serve(async (req) => {
  // ✅ 1. GESTION CORS (Preflight)
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    // ✅ 2. GESTION METHODE (Seul POST est autorisé pour la logique)
    if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const AUTHORITY_HMAC_SECRET = Deno.env.get("HO_AUTHORITY_HMAC_SECRET") ?? "";

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "Missing Supabase env vars" }, 500);
    }
    if (!AUTHORITY_HMAC_SECRET) {
      return jsonResponse({ error: "Missing HO_AUTHORITY_HMAC_SECRET" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing Authorization Bearer token" }, 401);
    }
    const jwt = authHeader.replace("Bearer ", "").trim();

    // Client (JWT validation)
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Invalid JWT", details: userErr?.message }, 401);
    }
    const user = userData.user;

    // Admin (DB write)
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ✅ 3. PARSING DU BODY
    const body = await req.json();

    const certUnsigned = body?.cert_unsigned;
    const payloadHash = String(body?.payload_hash || "").trim();
    const deviceSigStr = String(body?.device_signature || "");

    if (!certUnsigned || typeof certUnsigned !== "object") {
      return jsonResponse({ error: "cert_unsigned missing" }, 400);
    }
    if (!payloadHash) return jsonResponse({ error: "payload_hash missing" }, 400);
    if (!deviceSigStr) return jsonResponse({ error: "device_signature missing" }, 400);

    // Ownership check
    if (!certUnsigned?.meta?.user_id || certUnsigned.meta.user_id !== user.id) {
      return jsonResponse({ error: "user_id mismatch" }, 403);
    }

    // Canonical cert hash
    const certCanonical = canonicalStringify(certUnsigned);
    const certHash = await sha256Hex(certCanonical);

    // Parse device signature JSON
    let deviceSig: any;
    try {
      deviceSig = JSON.parse(deviceSigStr);
    } catch {
      return jsonResponse({ error: "device_signature must be JSON string" }, 400);
    }

    if (deviceSig?.alg !== "ed25519") {
      return jsonResponse({ error: "device_signature.alg must be ed25519" }, 400);
    }

    const devicePubB64 = String(deviceSig?.public_key || "");
    const deviceSigB64 = String(deviceSig?.signature || "");
    const deviceKeyId = String(deviceSig?.key_id || "device-key-v1");

    if (!devicePubB64 || !deviceSigB64) {
      return jsonResponse({ error: "device_signature missing public_key/signature" }, 400);
    }

    // Verify device signature
    const msgBytes = hexToBytes32(payloadHash);
    const sigBytes = b64ToBytes(deviceSigB64);
    const pubBytes = b64ToBytes(devicePubB64);

    const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);
    if (!ok) return jsonResponse({ error: "Device signature invalid" }, 400);

    // Authority signature (HMAC)
    const serverReceivedAt = new Date().toISOString();
    const authorityKeyId = "ho-edge-key-v1";
    const authorityMsg = `ho3|${user.id}|${certUnsigned.meta.project_id}|${certUnsigned.meta.session_id}|${payloadHash}|${certHash}|${serverReceivedAt}`;
    const authoritySignature = await hmacSha256B64(AUTHORITY_HMAC_SECRET, authorityMsg);

    // Final cert JSON
    const finalCert = {
      ...certUnsigned,
      integrity: {
        payload_hash: payloadHash,
        cert_hash: certHash,
        device_key_id: deviceKeyId,
        device_pubkey: devicePubB64,
        device_signature: deviceSigB64,
      },
      authority: {
        server_received_at: serverReceivedAt,
        authority_key_id: authorityKeyId,
        authority_signature: authoritySignature,
        authority_message: authorityMsg,
      },
    };

    const insertRow = {
      user_id: user.id,
      project_id: certUnsigned.meta.project_id,
      session_id: certUnsigned.meta.session_id,
      scp_score: certUnsigned.scores?.scp ?? null,
      evidence_score: certUnsigned.scores?.evidence ?? null,
      payload_hash: payloadHash,
      signature: authoritySignature,
      protocol: certUnsigned.protocol ?? "ho-cert-v1",
      device_key_id: deviceKeyId,
      device_pubkey: devicePubB64,
      device_signature: deviceSigB64,
      authority_key_id: authorityKeyId,
      authority_signature: authoritySignature,
      cert_json: finalCert,
    };

    const { data: certRow, error: dbErr } = await supabaseAdmin
      .from("ho_certificates")
      .insert(insertRow)
      .select("id, issued_at")
      .single();

    if (dbErr) {
      console.error("DB insert failed:", dbErr);
      return jsonResponse({ error: "DB insert failed", details: dbErr.message }, 500);
    }

    return jsonResponse({
      ok: true,
      cert_id: certRow.id,
      issued_at: certRow.issued_at,
      authority_key_id: authorityKeyId,
    });

  } catch (e) {
    console.error("Unhandled:", e);
    // Important : même en cas de crash, on renvoie les headers CORS
    return jsonResponse({ error: "Unhandled", details: String(e?.message || e) }, 500);
  }
});