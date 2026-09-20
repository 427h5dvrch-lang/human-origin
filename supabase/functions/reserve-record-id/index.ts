// supabase/functions/reserve-record-id/index.ts
// HumanOrigin — réservation d'un record_id et émission de la capability d'écriture.
// POST /functions/v1/reserve-record-id          {}                  -> réservation neuve
// POST /functions/v1/reserve-record-id          { "record_id": … }  -> ré-émission
//
// L'identifiant est produit par le SERVEUR. Le client n'en propose jamais un nouveau.
//
// Secrets requis (absents -> 500, le service ne sert pas) :
//   HUMANORIGIN_REGISTRY_WRITE_PRIVATE_KEY_B64   clé privée Ed25519, PKCS#8 base64
//   HUMANORIGIN_REGISTRY_WRITE_KEY_ID            ho-registry-write-v1
//   SERVICE_ROLE_KEY                             accès au schéma privé
//
// Clé STRICTEMENT distincte de ho-record-server-v1 : les deux protocoles ne partagent
// ni endpoint, ni clé, ni table.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { traiter, type Deps, type Reservation } from "./handler.ts";
import { importerClePrivee } from "./protocol.ts";

const SUPABASE_URL = "https://bhlisgvozsgqxugrfsiu.supabase.co";

Deno.serve(async (req: Request) => {
  const serviceRole = Deno.env.get("SERVICE_ROLE_KEY");
  if (!serviceRole) {
    console.error("FATAL: SERVICE_ROLE_KEY manquant");
    return new Response(JSON.stringify({ ok: false, error: "server configuration error" }),
      { status: 500, headers: { "content-type": "application/json" } });
  }
  const admin = createClient(SUPABASE_URL, serviceRole, { auth: { persistSession: false } });

  const deps: Deps = {
    env: (n) => Deno.env.get(n),

    compte: async (jeton) => {
      const { data, error } = await admin.auth.getUser(jeton);
      if (error || !data?.user?.id) return null;
      return data.user.id;
    },

    // Quota et insertion dans la MÊME transaction, côté base : deux appels simultanés
    // d'un même compte ne peuvent pas dépasser le quota ensemble.
    reserver: async (accountId, recordId) => {
      const { data, error } = await admin.schema("ho_private")
        .rpc("reserve_record_id", { p_account_id: accountId, p_record_id: recordId });
      if (error) { console.error("RPC reserve_record_id:", error); return { reserved: false, reason: null }; }
      const ligne = Array.isArray(data) ? data[0] : data;
      return { reserved: !!ligne?.reserved, reason: ligne?.reason ?? null };
    },

    lire: async (recordId) => {
      const { data, error } = await admin.schema("ho_private")
        .from("record_write_reservations")
        .select("record_id, account_id")
        .eq("record_id", recordId)
        .maybeSingle();
      if (error || !data) return null;
      return data as Reservation;
    },

    marquerEmission: async (recordId) => {
      await admin.schema("ho_private")
        .from("record_write_reservations")
        .update({ last_capability_issued_at: new Date().toISOString() })
        .eq("record_id", recordId);
    },

    maintenant: () => new Date(),
    cle: (pkcs8) => importerClePrivee(pkcs8),
  };

  try {
    return await traiter(req, deps);
  } catch (e) {
    console.error("Unhandled function error:", e);
    return new Response(JSON.stringify({ ok: false, error: "internal_error" }),
      { status: 500, headers: { "content-type": "application/json" } });
  }
});
