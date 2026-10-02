// Finalisation hors Word — PROTOTYPE, hors production.
//
// Démontre le point qui compte : la preuve n'a pas besoin de vivre DANS l'artefact.
// Aujourd'hui, les faits voyagent dans une partie customXml du .docx, et c'est ce qui
// enferme HumanOrigin dans Word. Ici ils voyagent dans un fichier de preuve à côté, et
// le lien avec l'artefact final est le MÊME que celui de la production : l'engagement
// sha256 sur l'encodage base64 des octets exacts du fichier.
//
// Cet engagement ne suppose rien du format. Il marche sur un .txt, un .py, un .png.
//
// SIMULÉ ET SIGNALÉ COMME TEL :
//   - la signature Ed25519 : remplacée par une empreinte, pour ne toucher à aucune clé
//     ni à aucun format de certificat de production ;
//   - le dépôt au registre : aucun appel réseau n'est fait ;
//   - l'identifiant de Record : tiré localement, non réservé.
// Rien de HO-JSON, de Verify ni du Registry n'est modifié ou appelé.

import fs from "node:fs";
import crypto from "node:crypto";
import { sceller, commitBytes, signaux } from "./capture.mjs";

export const SCHEMA_PROTOTYPE = "ho-prototype-sidecar/0";

export function identifiantLocal() {
  return "HO-" + crypto.randomBytes(8).toString("base64url").slice(0, 12);
}

/// `strict` fait lever plutot que produire une preuve non concordante. Les deux chemins
/// sont offerts a dessein : refuser est le comportement attendu d'un produit, mais une
/// preuve qui DIT son desaccord est plus utile a un banc qu'une exception.
export function finaliser({ cheminArtefact, capture, recordId, cle, strict = false,
                            tamponNonSauvegarde = false }) {
  const octets = fs.readFileSync(cheminArtefact);
  const engagement = commitBytes(octets);

  // ------------------------------------------------------------------ tampon non sauvegardé
  // Constaté au banc : si l'éditeur a des modifications non enregistrées, l'engagement
  // porte sur le DISQUE, pas sur ce que l'utilisateur voit. Les faits décrivent alors du
  // contenu absent de l'artefact engagé — la preuve se contredit elle-même.
  //
  // Comportement retenu : REFUSER. Enregistrer à la place de l'utilisateur modifierait son
  // document, ce qui n'est pas le rôle d'un observateur. La seule issue sûre est qu'il
  // enregistre lui-même, puis finalise.
  if (tamponNonSauvegarde) {
    const e = new Error("finalisation refusee : l'editeur a des modifications non enregistrees");
    e.concordance = {
      etat: "tampon_non_sauvegarde",
      explication: "l'engagement porterait sur l'etat du disque, alors que les faits decrivent " +
                   "l'etat du tampon. Enregistrez le document, puis finalisez.",
    };
    throw e;
  }

  // ------------------------------------------------------------------ P0 · concordance
  // L'engagement pris a l'arret de l'observation est compare a celui des octets presents
  // maintenant. Toute edition faite entre les deux apparait ici, et nulle part ailleurs.
  const arret = capture.arret;
  let concordance;
  if (!arret) {
    concordance = {
      etat: "sans_engagement_d_arret",
      explication: "l'observation s'est arretee sans prendre d'engagement : la fenetre entre " +
                   "l'arret et la finalisation n'est pas couverte",
    };
  } else if (arret.commitment === engagement) {
    concordance = {
      etat: "concordant",
      engagement_a_l_arret: arret.commitment,
      arret_at: arret.at,
      explication: "les octets presents sont ceux engages a l'arret de l'observation",
    };
  } else {
    concordance = {
      etat: "non_concordant",
      engagement_a_l_arret: arret.commitment,
      engagement_a_la_finalisation: engagement,
      arret_at: arret.at,
      octets_a_l_arret: arret.octets,
      octets_a_la_finalisation: octets.length,
      explication: "l'artefact a change entre l'arret de l'observation et la finalisation ; " +
                   "ce changement n'a pas ete observe",
    };
  }
  if (strict && concordance.etat !== "concordant") {
    const e = new Error(`finalisation refusee : ${concordance.etat}`);
    e.concordance = concordance;
    throw e;
  }

  const faits = capture.faits;
  const periodes = faits.length ? Math.max(...faits.map(f => f.period)) + 1 : 0;
  const observes = faits.filter(f => f.source === "local_editing").length;

  const preuve = {
    // Schéma DISTINCT de HO-JSON : ce prototype ne prétend pas en produire un.
    schema: SCHEMA_PROTOTYPE,
    record_id: recordId,
    artefact: {
      nom: cheminArtefact.split("/").pop(),
      octets: octets.length,
      // Le lien avec l'état final, identique à la production.
      commitment: engagement,
      commitment_algorithm: "sha256-over-base64-bytes",
    },
    // ------------------------------------------------------------------ P0
    concordance,
    // ------------------------------------------------------------------ intervalles
    // Ce qui s'est passe entre deux periodes d'observation. Une divergence constatee ici
    // ne rend pas la preuve invalide — elle est NORMALE et attendue — mais elle doit
    // rester lisible : une partie de l'artefact a change sans etre observee.
    intervalles_non_observes: capture.intervalles ?? [],
    // ------------------------------------------------------------------ P1 · preexistant
    // Ce qui etait la AVANT la premiere periode. Jamais presente comme observe.
    preexistant: capture.baseline ?? {
      octets: null, unites: null, observe: false,
      mention: "aucune periode d'observation n'a ete ouverte : rien n'est observe",
    },
    observation: {
      periodes,
      evenements: faits.length,
      evenements_attribues_a_la_frappe: observes,
      source_de_capture: capture.sourceCapture,
      // Ce que cette source permet d'établir, dit sans l'embellir.
      ce_qui_est_etabli: capture.sourceCapture === "editeur"
        ? "des modifications ont ete annoncees par l'editeur pendant les periodes observees"
        : "le fichier a change entre deux releves ; la maniere dont il a change n'est pas observee",
      // ------------------------------------------------------------------ P2
      signaux: signaux(faits),
      ce_qui_reste_inconnu: [
        "ce qui s'est passe hors des periodes observees",
        "l'identite reelle de la personne",
        "l'usage ou non d'outils d'aide a la redaction",
        "l'origine du contenu present avant la premiere periode d'observation",
      ],
    },
    faits_scelles: sceller(faits, recordId, cle),
    // Remplace la signature Ed25519 de production. SIMULÉ.
    integrite_simulee: crypto.createHash("sha256")
      .update(recordId + engagement + String(faits.length)).digest("hex"),
    avertissement: "PROTOTYPE — ni HO-JSON, ni Registry, ni Verify de production.",
  };
  return preuve;
}

export function ecrirePreuve(preuve, chemin) {
  fs.writeFileSync(chemin, JSON.stringify(preuve, null, 2));
  return chemin;
}
