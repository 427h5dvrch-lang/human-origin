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
import { sceller, commitBytes } from "./capture.mjs";

export const SCHEMA_PROTOTYPE = "ho-prototype-sidecar/0";

export function identifiantLocal() {
  return "HO-" + crypto.randomBytes(8).toString("base64url").slice(0, 12);
}

export function finaliser({ cheminArtefact, capture, recordId, cle }) {
  const octets = fs.readFileSync(cheminArtefact);
  const engagement = commitBytes(octets);

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
    observation: {
      periodes,
      evenements: faits.length,
      evenements_attribues_a_la_frappe: observes,
      source_de_capture: capture.sourceCapture,
      // Ce que cette source permet d'établir, dit sans l'embellir.
      ce_qui_est_etabli: capture.sourceCapture === "editeur"
        ? "des modifications ont ete annoncees par l'editeur pendant les periodes observees"
        : "le fichier a change entre deux releves ; la maniere dont il a change n'est pas observee",
      ce_qui_reste_inconnu: [
        "ce qui s'est passe hors des periodes observees",
        "l'identite reelle de la personne",
        "l'usage ou non d'outils d'aide a la redaction",
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
