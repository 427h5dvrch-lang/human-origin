// /src/ho_reserve.js — réservation d'identifiant de Record.
//
// Extrait de main.js SANS changement de logique. Motif : main.js n'est plus chargé par
// index.html depuis que le point d'entrée est ho_desktop.js, et la réservation y était
// donc devenue du code mort — window.__HO_RESERVE__ n'était jamais défini, et l'appel
// levait au premier document créé.
//
// Ce module ne porte QUE la réservation : le charger n'écrit rien dans le DOM et ne pose
// aucun écouteur, à la différence de main.js.
//
// Le jeton de session ne quitte pas ce module. Les deux constantes ci-dessous sont
// publiques par conception : l'URL du projet et la clé anon.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bhlisgvozsgqxugrfsiu.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJobGlzZ3ZvenNncXh1Z3Jmc2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNTI5NDEsImV4cCI6MjA4MzcyODk0MX0.L43rUuDFtg-QH7lVCFTFkJzMTjNUX7BWVXqmVMvIwZ0";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Réserve un identifiant de Record auprès du service, avec la session en cours.
 *
 * L'identifiant est produit par le SERVEUR : il existe, lié à un compte, avant
 * d'apparaître dans un document. C'est ce qui interdit la préemption.
 *
 * Le jeton de session ne quitte PAS cette fonction : seul le couple
 * { record_id, capability } est rendu, et c'est tout ce qui descend en natif.
 *
 * En cas d'échec, aucun document HumanOrigin n'est créé. Un document portant un
 * identifiant non réservé serait impubliable, et il le serait en silence.
 */
export async function reserveRecordId() {
  const { data } = await supabase.auth.getSession();
  const jeton = data?.session?.access_token;
  if (!jeton) {
    throw new Error("Connectez-vous pour créer un document HumanOrigin publiable.");
  }
  let r;
  try {
    r = await fetch(supabaseUrl + "/functions/v1/reserve-record-id", {
      method: "POST",
      headers: { authorization: "Bearer " + jeton, apikey: supabaseAnonKey,
                 "content-type": "application/json" },
      body: "{}",
    });
  } catch (e) {
    throw new Error("Le service HumanOrigin est injoignable. Réessayez une fois connecté au réseau.");
  }
  if (r.status === 429) {
    throw new Error("Trop de documents créés récemment. Réessayez plus tard.");
  }
  if (!r.ok) {
    // Le détail du service ne remonte pas à l'interface : il peut porter des informations
    // qui ne regardent pas cet écran.
    throw new Error("La réservation n’a pas abouti. Aucun document n’a été créé.");
  }
  const b = await r.json();
  if (!b?.record_id || !b?.capability) {
    throw new Error("Réponse inattendue du service. Aucun document n’a été créé.");
  }
  return { record_id: b.record_id, capability: b.capability };
}
