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
//   SERVICE_ROLE_KEY                             exécution du pont public
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

  // ho_private n'est PAS exposé à PostgREST, et ne doit pas l'être : la clé service role
  // contourne RLS, pas la liste des schémas exposés. TOUS les accès passent donc par un
  // pont unique dans public, exécutable par le seul service_role.
  const pont = async (mode: string, accountId: string, recordId: string) => {
    const { data, error } = await admin.rpc("ho_registry_write_reservation", {
      p_mode: mode, p_account_id: accountId, p_record_id: recordId,
    });
    if (error) { console.error("RPC ho_registry_write_reservation:", error); return null; }
    const ligne = Array.isArray(data) ? data[0] : data;
    return (ligne ?? null) as { outcome: string; record_id: string | null } | null;
  };

  // Compte de la session authentifiée. `traiter` résout `compte` avant toute autre
  // dépendance et s'arrête sur 401 s'il est nul : `lire` ne peut donc être atteint
  // qu'après. Le garde rend cette dépendance d'ordre bruyante plutôt que silencieuse.
  let compteCourant: string | null = null;

  const deps: Deps = {
    env: (n) => Deno.env.get(n),

    compte: async (jeton) => {
      const { data, error } = await admin.auth.getUser(jeton);
      if (error || !data?.user?.id) { compteCourant = null; return null; }
      compteCourant = data.user.id;
      return compteCourant;
    },

    // Quota et insertion restent atomiques : le pont délègue à ho_private.reserve_record_id,
    // inchangée, où la vérification et l'insertion tiennent dans la même transaction sous
    // verrou du compte.
    reserver: async (accountId, recordId) => {
      const l = await pont("reserve", accountId, recordId);
      if (!l) return { reserved: false, reason: null };
      if (l.outcome === "reserved") return { reserved: true, reason: null };
      return { reserved: false, reason: l.outcome };
    },

    // Propriété contrôlée ET trace posée dans la MÊME instruction SQL. Le pont ne renvoie
    // jamais account_id : une réservation d'autrui est indiscernable d'une inexistante.
    lire: async (recordId) => {
      if (!compteCourant) throw new Error("pont appelé hors session authentifiée");
      const l = await pont("reissue", compteCourant, recordId);
      if (!l || l.outcome !== "reissued" || !l.record_id) return null;
      return { record_id: l.record_id, account_id: compteCourant } as Reservation;
    },

    // Sans objet : la trace est posée atomiquement par le pont, en mode « reissue ».
    // La dépendance subsiste pour ne rien changer au contrat du gestionnaire.
    marquerEmission: async (_recordId) => {},

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
