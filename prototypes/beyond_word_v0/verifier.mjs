// Vérificateur indépendant — PROTOTYPE, hors production.
//
// Ne lit QUE le fichier de preuve et l'artefact. Il ne connaît ni la capture, ni la
// session qui les a produits : c'est la condition pour que la vérification signifie
// quelque chose.

import fs from "node:fs";
import { desceller, commitBytes } from "./capture.mjs";
import { SCHEMA_PROTOTYPE } from "./finaliser.mjs";

export function verifier({ cheminPreuve, cheminArtefact, cle }) {
  const r = { controles: [], verdict: "INDETERMINE" };
  const ok = (nom, vrai, detail = "") => { r.controles.push({ nom, resultat: vrai ? "PASS" : "FAIL", detail }); return vrai; };

  let p;
  try { p = JSON.parse(fs.readFileSync(cheminPreuve, "utf8")); }
  catch (e) { ok("la preuve est lisible", false, String(e)); r.verdict = "INVALIDE"; return r; }

  ok("schema attendu", p.schema === SCHEMA_PROTOTYPE, p.schema);

  // Le contrôle central : l'artefact présenté est-il celui qui a été engagé ?
  const octets = fs.readFileSync(cheminArtefact);
  const reel = commitBytes(octets);
  const lie = ok("l'artefact correspond a l'engagement", reel === p.artefact.commitment,
    reel === p.artefact.commitment ? "" : `attendu ${p.artefact.commitment.slice(0,16)}… obtenu ${reel.slice(0,16)}…`);
  ok("taille coherente", octets.length === p.artefact.octets, `${octets.length} vs ${p.artefact.octets}`);

  // P0 — le contrôle qui ferme la fenêtre. Une preuve non concordante est INVALIDE :
  // l'artefact présenté n'est pas celui qui existait quand l'observation s'est arrêtée.
  const c = p.concordance || { etat: "absent" };
  ok("l'artefact n'a pas change depuis l'arret de l'observation",
    c.etat === "concordant", c.etat);

  // P1 — ce qui préexistait doit être lisible, et jamais compté comme observé.
  const pre = p.preexistant || {};
  ok("le volume preexistant est declare", pre.octets !== undefined && pre.observe === false,
    pre.octets === null ? "aucune periode ouverte" : `${pre.octets} octets non observes`);

  // Les faits se descellent-ils avec cet identifiant ? Le record_id est en AAD : un blob
  // recopie depuis une autre preuve ne se descellera pas ici.
  let faits = null;
  try {
    faits = desceller(p.faits_scelles, p.record_id, cle);
    ok("les faits se descellent sous cet identifiant", true, `${faits.length} evenement(s)`);
  } catch (e) {
    ok("les faits se descellent sous cet identifiant", false, "scellement invalide ou identifiant different");
  }

  if (faits) {
    ok("le nombre d'evenements annonce correspond", faits.length === p.observation.evenements,
      `${faits.length} vs ${p.observation.evenements}`);
    const croissant = faits.every((f, i) => f.sequence === i);
    ok("les sequences sont completes et ordonnees", croissant);
  }

  r.verdict = r.controles.some(c => c.resultat === "FAIL") ? "INVALIDE" : (lie ? "VALIDE" : "INVALIDE");
  r.ce_que_cela_dit = p.observation?.ce_qui_est_etabli;
  r.preexistant_non_observe = pre.octets;
  r.signal_regularite = p.observation?.signaux?.signal_regularite;
  r.ce_que_cela_ne_dit_pas = p.observation?.ce_qui_reste_inconnu;
  return r;
}
