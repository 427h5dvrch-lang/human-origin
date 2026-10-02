// Red-team : on essaie de casser le prototype. Chaque attaque dit ce qu'on DÉTECTE et ce
// qu'on ne détecte pas. Une attaque non détectée n'est pas un échec du banc : c'est une
// limite du modèle, et elle doit être écrite.

import fs from "node:fs"; import crypto from "node:crypto";
import { Capture } from "./capture.mjs";
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
  cap.fermerPeriode();
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
  const morceaux = Array.from({ length: 40 }, (_, i) => "y".repeat(100) + i);
  const a = atelier("m6.md", morceaux);
  const bas = a.cap.faits.filter(f => f.capture_assurance === "low").length;
  return { detecte: bas > 0,
    quoi: `${a.cap.faits.length} evenements, dont ${bas} signales. ${a.cap.faits.length - bas} passent pour de la frappe.`,
    limite: "DEFAUT REEL du modele actuel, deja present dans le volet Word : le seuil est une quantite par evenement, pas un rythme. Un collage decoupe est indiscernable d'une frappe rapide." };
});

scenario("Import d'un contenu preexistant au depart", () => {
  const art = `${T}/m7.md`;
  const prealable = "Un texte ecrit ailleurs, hier, par n'importe qui.\n".repeat(20);
  fs.writeFileSync(art, prealable);
  const cle = crypto.randomBytes(32), recordId = identifiantLocal();
  const cap = new Capture({ source: "editeur" });
  cap.ouvrirPeriode(prealable);              // l'observation demarre SUR ce contenu
  let texte = prealable + "Et une phrase ajoutee sous observation.";
  fs.writeFileSync(art, texte);
  cap.changementAnnonce(texte, ["u20"], "edited");
  cap.fermerPeriode();
  const p = finaliser({ cheminArtefact: art, capture: cap, recordId, cle });
  const chemin = `${art}.hoproof.json`; ecrirePreuve(p, chemin);
  const v = verifier({ cheminPreuve: chemin, cheminArtefact: art, cle });
  return { detecte: false,
    quoi: `verdict ${v.verdict} : la preuve est valide, et elle ne couvre qu'un evenement pour ${prealable.length} caracteres deja presents.`,
    limite: "NON DETECTE, et c'est structurel. L'observation commence quand elle commence. La preuve ne dit jamais que tout le contenu a ete observe — mais rien dans ce prototype ne quantifie la part non observee. A corriger : exposer le volume initial comme un fait." };
});

scenario("Fermeture puis reprise", () => {
  const a = atelier("m8.md", ["Premiere seance"]);
  // Reprise : nouvelle periode sur le meme artefact.
  a.cap.ouvrirPeriode(fs.readFileSync(a.art, "utf8"));
  const t = fs.readFileSync(a.art, "utf8") + "\nSeconde seance.";
  fs.writeFileSync(a.art, t); a.cap.changementAnnonce(t, ["u1"], "edited"); a.cap.fermerPeriode();
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
  return { detecte: false,
    quoi: `verdict ${v.verdict} : re-finaliser apres une edition externe produit une preuve VALIDE, qui engage le nouveau fichier avec les anciens faits.`,
    limite: "NON DETECTE, et c'est la faiblesse la plus serieuse trouvee. Rien ne lie les faits a l'etat final AUTREMENT que par le moment de la finalisation. En production, le volet scelle et ferme le document pour fermer cette fenetre ; le prototype ne le fait pas. A traiter avant tout usage reel." };
});

scenario("Capture par surveillance de fichier plutot que par l'editeur", () => {
  const a = atelier("m10.md", ["Une ligne", "Deux lignes", "Trois lignes"], "fichier");
  const frappe = a.cap.faits.filter(f => f.source === "local_editing").length;
  return { detecte: frappe === 0,
    quoi: `${a.cap.faits.length} evenements, ${frappe} attribue a la frappe — par construction, aucun.`,
    limite: "la surveillance de fichier ne peut JAMAIS etablir qu'un contenu a ete tape. Elle constate des etats, pas un processus. C'est pourquoi elle ne peut pas etre le chemin principal." };
});

console.log(`\n=== ${detecte} attaque(s) detectee(s) · ${nonDetecte} non detectee(s) ===`);
