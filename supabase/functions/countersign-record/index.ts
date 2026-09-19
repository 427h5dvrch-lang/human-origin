// supabase/functions/countersign-record/index.ts
// HumanOrigin — contre-signature d'un engagement de Record (ho-evidence).
// POST /functions/v1/countersign-record   { "record_digest": "<64 hex>" }
//
// ENDPOINT DISTINCT de countersign-proof. Les deux ne partagent ni protocole, ni format
// d'attestation, ni canonicalisation, ni clé. Aucune modification du chemin HO-JSON.
//
// Le service ne reçoit jamais le Record en clair, seulement son condensé. Il n'atteste
// que la contre-signature d'un engagement : ni client officiel, ni observation réelle,
// ni auteur humain, ni absence d'intelligence artificielle.
//
// Secrets requis (absents → 500, le service ne sert pas) :
//   HUMANORIGIN_RECORD_SIGNING_PRIVATE_KEY_B64  clé privée Ed25519, PKCS#8 base64
//   HUMANORIGIN_RECORD_KEY_ID                   ex. ho-record-server-v1
//   SERVICE_ROLE_KEY                            accès base pour l'anti-rejeu
//
// La clé est générée HORS LIGNE lors d'une cérémonie dédiée et déposée en secret.
// Elle n'est jamais générée à la volée, jamais dans un binaire distribué.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { traiter, type Deps, type LigneAttestation } from "./handler.ts";
import { horodatage, importerClePrivee } from "./protocol.ts";

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

    lire: async (digest) => {
      const { data, error } = await admin
        .from("record_attestations")
        .select("record_digest, account_id, key_id, version, server_signed_at, signature")
        .eq("record_digest", digest)
        .maybeSingle();
      if (error || !data) return null;
      return data as LigneAttestation;
    },

    ecrire: async (ligne) => {
      const { error } = await admin.from("record_attestations").insert(ligne);
      if (!error) return { conflit: false };
      // 23505 : violation de la contrainte d'unicité sur record_digest.
      if ((error as { code?: string }).code === "23505") return { conflit: true };
      console.error("DB insert error:", error);
      throw new Error("storage_error");
    },

    maintenant: () => horodatage(),
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
