// supabase/functions/sign-cert/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CONFIGURATION
const SUPABASE_URL = "https://bhlisgvozsgqxugrfsiu.supabase.co";

type ReqBody = {
  cert_unsigned: any;
  payload_hash: string;
  device_signature: any;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(resBody: unknown, status = 200) {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 👇 MODIFICATION ICI : On a enlevé "SUPABASE_" du nom pour éviter l'erreur CLI
    const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");
    
    if (!SERVICE_ROLE_KEY) {
      console.error("FATAL: SERVICE_ROLE_KEY manquant");
      return json({ error: "Server Configuration Error" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    
    if (!token) return json({ error: "Unauthorized: No token" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: "Unauthorized: Invalid token" }, 401);
    }
    const user = userData.user;

    const body = (await req.json()) as ReqBody;
    if (!body?.payload_hash || !body?.cert_unsigned) {
      return json({ error: "Missing payload_hash or cert_unsigned" }, 400);
    }

    const certId = crypto.randomUUID();
    const authoritySignature = `auth-v1:${body.payload_hash}:${user.id}:${new Date().toISOString()}`;

    const { error: insErr } = await admin.from("ho_certificates").insert({
      id: certId,
      user_id: user.id,
      project_id: body.cert_unsigned.meta?.project_id,
      session_id: body.cert_unsigned.meta?.session_id,
      issued_at: new Date().toISOString(),
      payload_hash: body.payload_hash,
      device_signature: body.device_signature,
      authority_signature: authoritySignature,
      cert_json: body.cert_unsigned,
    });

    if (insErr) {
      console.error("DB Insert Error:", insErr);
      return json({ error: "Database Insert Failed", details: insErr }, 500);
    }

    if (body.cert_unsigned.meta?.session_id) {
        await admin.from("ho_sessions").update({
            status: "CERTIFIED",
            cert_id: certId,
            certified_at: new Date().toISOString()
        }).eq("id", body.cert_unsigned.meta.session_id);
    }

    return json({ cert_id: certId, status: "signed_by_authority" }, 200);

  } catch (e) {
    console.error("Function Error:", e);
    return json({ error: String(e) }, 500);
  }
});