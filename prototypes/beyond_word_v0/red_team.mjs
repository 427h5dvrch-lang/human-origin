// Red-team : on essaie de casser le prototype. Chaque attaque dit ce qu'on DÉTECTE et ce
// qu'on ne détecte pas. Une attaque non détectée n'est pas un échec du banc : c'est une
// limite du modèle, et elle doit être écrite.

import fs from "node:fs"; import crypto from "node:crypto";
import { Capture, signaux } from "./capture.mjs";
import { finaliser, ecrirePreuve, identifiantLocal } from "./finaliser.mjs";
import { verifier } from "./verifier.mjs";

const T = new URL(".tmp_rt", import.meta.url).pathname;
fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(T, { recursive: true });
let detecte = 0, nonDetecte = 0;

function scenario(nom, fn) {
  const r = fn();
  const marque = r.detecte ? "DETECTE    " : "NON DETECTE";
  if (r.detecte) detecte++; else nonDetecte++;
  console.log(`\n${marque}  ${nom}`);
  console.log(`   ${r.quoi}`);
  if (r.limite) console.log(`   limite : ${r.limite}`);
}

// Un petit atelier pour fabriquer des cas.
function atelier(nomFichier, lignes, source = "editeur") {
  const art = `${T}/${nomFichier}`;
  const cle = crypto.randomBytes(32), recordId = identifiantLocal();
  const cap = new Capture({ source });
  let texte = ""; cap.ouvrirPeriode(texte);
  lignes.forEach((l, i) => {
    const t = texte.split("\n"); while (t.length <= i) t.push("");
    t[i] = l; texte = t.join("\n"); fs.writeFileSync(art, texte);
    if (source === "editeur") cap.changementAnnonce(texte, [`u${i}`], "edited");
    else cap.changementConstate(texte);
  });
  cap.fermerPeriode(art);
  const preuve = finaliser({ cheminArtefact: art, capture: cap, recordId, cle });
  const chemin = `${art}.hoproof.json`; ecrirePreuve(preuve, chemin);
  return { art, chemin, cle, preuve, cap };
}

console.log("=== RED-TEAM — prototype Beyond Word V0 ===");

scenario("Modification externe apres finalisation", () => {
  const a = atelier("m1.md", ["Un debut", "Une suite"]);
  fs.appendFileSync(a.art, "\nAjoute apres coup, sans observation.");
  const v = verifier({ cheminPreuve: a.chemin, cheminArtefact: a.art, cle: a.cle });
  return { detecte: v.verdict === "INVALIDE",
    quoi: `verdict ${v.verdict} — l'engagement ne correspond plus aux octets presents.` };
});

scenario("Remplacement complet du fichier", () => {
  const a = atelier("m2.md", ["Original"]);
  fs.writeFileSync(a.art, "Un tout autre contenu, de meme longueur ou non.");
  const v = verifier({ cheminPreuve: a.chemin, cheminArtefact: a.art, cle: a.cle });
  return { detecte: v.verdict === "INVALIDE",
    quoi: `verdict ${v.verdict} — l'engagement porte sur les octets exacts, pas sur une ressemblance.` };
});

scenario("Preuve recopiee depuis un autre Record", () => {
  const a = atelier("m3.md", ["Contenu A"]);
  const b = atelier("m4.md", ["Contenu B"]);
  // On colle le blob de faits de A dans la preuve de B, en gardant l'identifiant de B.
  const pb = JSON.parse(fs.readFileSync(b.chemin, "utf8"));
  pb.faits_scelles = a.preuve.faits_scelles;
  fs.writeFileSync(b.chemin, JSON.stringify(pb, null, 2));
  const v = verifier({ cheminPreuve: b.chemin, cheminArtefact: b.art, cle: b.cle });
  return { detecte: v.verdict === "INVALIDE",
    quoi: `verdict ${v.verdict} — le record_id est en donnees authentifiees : le blob d'un autre Record ne se descelle pas ici.` };
});

scenario("Collage massif pendant l'observation", () => {
  const gros = "x".repeat(4000);
  const a = atelier("m5.md", ["Un debut honnete", gros]);
  const f = a.cap.faits.find(f => Math.abs(f.length_delta) >= 120);
  return { detecte: !!f && f.source === "unknown" && f.capture_assurance === "low",
    quoi: `l'evenement de ${f.length_delta} caracteres est marque source=${f.source}, capture_assurance=${f.capture_assurance}.`,
    limite: "le collage est SIGNALE, jamais empeche ni prouve. Un collage lent, par petits morceaux sous le seuil de 120, passe en local_editing." };
});

scenario("Collage fractionne sous le seuil", () => {
  // 40 blocs de 100 caracteres, cadence metronomique. Aucun ne franchit le seuil de 120 :
  // le controle par quantite ne voit rien. Le signal de REGULARITE, lui, voit.
  const base = Date.parse("2026-10-02T10:00:00Z");
  const faits = Array.from({ length: 40 }, (_, i) =>
    ({ at: new Date(base + i * 180).toISOString(), length_delta: 100, source: "local_editing" }));
  const sg = signaux(faits);
  const vuParLeSeuil = faits.some(f => Math.abs(f.length_delta) >= 120);
  return { detecte: sg.signal_regularite === "inhabituelle",
    quoi: `le seuil ne signale rien (${vuParLeSeuil}) ; la regularite est ${sg.signal_regularite} — cv_intervalles=${sg.regularite.intervalles}, cv_tailles=${sg.regularite.tailles}.`,
    limite: "le signal DECRIT une forme, il n'etablit rien. Un collage fractionne a intervalles volontairement irreguliers le contournerait, et une saisie naturellement reguliere le declencherait a tort. C'est un signal d'assurance, jamais une accusation." };
});

scenario("Import d'un contenu preexistant au depart", () => {
  const art = `${T}/m7.md`;
  const prealable = "Un texte ecrit ailleurs, hier, par n'importe qui.\n".repeat(20);
  fs.writeFileSync(art, prealable);
  const cle = crypto.randomBytes(32), recordId = identifiantLocal();
  const cap = new Capture({ source: "editeur" });
  cap.ouvrirPeriode(prealable);
  const texte = prealable + "Et une phrase ajoutee sous observation.";
  fs.writeFileSync(art, texte);
  cap.changementAnnonce(texte, ["u20"], "edited");
  cap.fermerPeriode(art);
  const p = finaliser({ cheminArtefact: art, capture: cap, recordId, cle });
  const chemin = `${art}.hoproof.json`; ecrirePreuve(p, chemin);
  const v = verifier({ cheminPreuve: chemin, cheminArtefact: art, cle });
  const declare = p.preexistant.octets === prealable.length && p.preexistant.observe === false;
  return { detecte: declare,
    quoi: `verdict ${v.verdict}, et la preuve declare ${p.preexistant.octets} octets preexistants NON observes pour ${p.observation.evenements} evenement(s). Le volume importe est lisible, il n'est plus noyé.`,
    limite: "la preuve dit COMBIEN preexistait, jamais D'OU cela venait. L'origine du contenu importe reste inconnue, et c'est maintenant ecrit dans ce_qui_reste_inconnu." };
});

scenario("Fermeture puis reprise", () => {
  const a = atelier("m8.md", ["Premiere seance"]);
  // Reprise : nouvelle periode sur le meme artefact.
  a.cap.ouvrirPeriode(fs.readFileSync(a.art, "utf8"));
  const t = fs.readFileSync(a.art, "utf8") + "\nSeconde seance.";
  fs.writeFileSync(a.art, t); a.cap.changementAnnonce(t, ["u1"], "edited"); a.cap.fermerPeriode(a.art);
  const p = finaliser({ cheminArtefact: a.art, capture: a.cap, recordId: a.preuve.record_id, cle: a.cle });
  return { detecte: p.observation.periodes === 2,
    quoi: `${p.observation.periodes} periodes distinctes enregistrees ; l'intervalle entre elles n'est pas observe et se voit.`,
    limite: "ce qui se passe ENTRE deux periodes reste inconnu. C'est dit, ce n'est pas comble." };
});

scenario("Edition par une application non observee", () => {
  const a = atelier("m9.md", ["Ecrit sous observation"]);
  // Une autre application modifie le fichier, puis on re-finalise sans nouvelle observation.
  fs.appendFileSync(a.art, "\nAjoute par un autre editeur, hors de toute observation.");
  const p2 = finaliser({ cheminArtefact: a.art, capture: a.cap, recordId: a.preuve.record_id, cle: a.cle });
  const chemin2 = `${a.art}.hoproof2.json`; ecrirePreuve(p2, chemin2);
  const v = verifier({ cheminPreuve: chemin2, cheminArtefact: a.art, cle: a.cle });
  let refuse = false;
  try { finaliser({ cheminArtefact: a.art, capture: a.cap, recordId: a.preuve.record_id, cle: a.cle, strict: true }); }
  catch (e) { refuse = true; }
  return { detecte: p2.concordance.etat === "non_concordant" && v.verdict === "INVALIDE" && refuse,
    quoi: `concordance ${p2.concordance.etat}, verdict ${v.verdict}, et le mode strict refuse de finaliser. L'engagement pris a l'arret de l'observation ferme la fenetre.`,
    limite: "un aller-retour qui restitue les OCTETS EXACTS reste indetectable : l'engagement porte sur l'etat final, jamais sur le chemin parcouru." };
});

scenario("Capture par surveillance de fichier plutot que par l'editeur", () => {
  const a = atelier("m10.md", ["Une ligne", "Deux lignes", "Trois lignes"], "fichier");
  const frappe = a.cap.faits.filter(f => f.source === "local_editing").length;
  return { detecte: frappe === 0,
    quoi: `${a.cap.faits.length} evenements, ${frappe} attribue a la frappe — par construction, aucun.`,
    limite: "la surveillance de fichier ne peut JAMAIS etablir qu'un contenu a ete tape. Elle constate des etats, pas un processus. C'est pourquoi elle ne peut pas etre le chemin principal." };
});

console.log(`\n=== ${detecte} attaque(s) detectee(s) · ${nonDetecte} non detectee(s) ===`);
