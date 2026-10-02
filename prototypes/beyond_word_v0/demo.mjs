// Démonstration : un contenu créé HORS Word, observé, lié à son état final, vérifié.
import fs from "node:fs"; import crypto from "node:crypto";
import { Capture } from "./capture.mjs";
import { finaliser, ecrirePreuve, identifiantLocal } from "./finaliser.mjs";
import { verifier } from "./verifier.mjs";

const T = new URL(".tmp", import.meta.url).pathname; fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(T, { recursive: true });
const ART = `${T}/notes.md`;          // ni .docx, ni Word : un fichier Markdown ordinaire
const PREUVE = `${T}/notes.md.hoproof.json`;

const cle = crypto.randomBytes(32);
const recordId = identifiantLocal();
const cap = new Capture({ source: "editeur" });

// L'« éditeur » : chaque frappe annonce l'unité modifiée, comme le fait le volet Word.
let texte = "";
const frapper = (ligne, idx) => {
  const lignes = texte.split("\n"); while (lignes.length <= idx) lignes.push("");
  lignes[idx] = ligne; texte = lignes.join("\n");
  fs.writeFileSync(ART, texte);
  cap.changementAnnonce(texte, [`u${idx}`], "edited");
};

console.log("\n-- redaction hors Word --");
cap.ouvrirPeriode(texte);
frapper("# Notes de terrain", 0);
frapper("# Notes de terrain", 0);
frapper("", 1);
frapper("Le detecteur estime apres coup.", 2);
frapper("Le detecteur estime apres coup. HumanOrigin observe pendant.", 2);
frapper("Trois paragraphes plus loin, la these tient.", 3);
cap.fermerPeriode();
console.log(`   ${cap.faits.length} evenements sur ${cap.periode} periode(s)`);

console.log("\n-- finalisation --");
const preuve = finaliser({ cheminArtefact: ART, capture: cap, recordId, cle });
ecrirePreuve(preuve, PREUVE);
console.log(`   record    : ${preuve.record_id}`);
console.log(`   artefact  : ${preuve.artefact.nom}  ${preuve.artefact.octets} octets`);
console.log(`   engagement: ${preuve.artefact.commitment.slice(0, 32)}…`);
console.log(`   preuve    : ${PREUVE}`);

console.log("\n-- verification independante --");
const v = verifier({ cheminPreuve: PREUVE, cheminArtefact: ART, cle });
for (const c of v.controles) console.log(`   ${c.resultat}  ${c.nom}${c.detail ? "  → " + c.detail : ""}`);
console.log(`\n   VERDICT : ${v.verdict}`);
console.log(`   ce que cela dit        : ${v.ce_que_cela_dit}`);
console.log(`   ce que cela ne dit pas : ${v.ce_que_cela_ne_dit_pas.join(" · ")}`);
