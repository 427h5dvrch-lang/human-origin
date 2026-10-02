// Banc V0.1 — P0 fenêtre d'observation, P1 baseline, P2 signaux.
import fs from "node:fs"; import crypto from "node:crypto";
import { Capture, signaux } from "./capture.mjs";
import { finaliser, ecrirePreuve, identifiantLocal } from "./finaliser.mjs";
import { verifier } from "./verifier.mjs";

const T = new URL(".tmp_tests", import.meta.url).pathname;
fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(T, { recursive: true });
let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };

// Atelier : écrit sous observation, puis ferme la période en prenant l'engagement.
function seance(nom, lignes, { texteInitial = "" } = {}) {
  const art = `${T}/${nom}`;
  fs.writeFileSync(art, texteInitial);
  const cle = crypto.randomBytes(32), recordId = identifiantLocal();
  const cap = new Capture({ source: "editeur" });
  cap.ouvrirPeriode(texteInitial);
  let texte = texteInitial;
  lignes.forEach((l) => {
    const t = texte === "" ? [] : texte.split("\n");
    t.push(l); texte = t.join("\n");
    fs.writeFileSync(art, texte);
    cap.changementAnnonce(texte, [`u${t.length - 1}`], "edited");
  });
  cap.fermerPeriode(art);          // ← P0 : l'engagement est pris ICI
  return { art, cle, recordId, cap };
}

console.log("\n-- P0 · la fenetre entre arret et finalisation --");
{
  const s = seance("p0_a.md", ["Une ligne", "Une autre"]);
  const p = finaliser({ cheminArtefact: s.art, capture: s.cap, recordId: s.recordId, cle: s.cle });
  const ch = `${s.art}.proof.json`; ecrirePreuve(p, ch);
  const v = verifier({ cheminPreuve: ch, cheminArtefact: s.art, cle: s.cle });
  ck("aucune modification apres arret → concordant", p.concordance.etat === "concordant");
  ck("aucune modification apres arret → VALIDE", v.verdict === "VALIDE");
}
{
  const s = seance("p0_b.md", ["Un debut"]);
  fs.appendFileSync(s.art, "\najoute apres l'arret");
  const p = finaliser({ cheminArtefact: s.art, capture: s.cap, recordId: s.recordId, cle: s.cle });
  const ch = `${s.art}.proof.json`; ecrirePreuve(p, ch);
  const v = verifier({ cheminPreuve: ch, cheminArtefact: s.art, cle: s.cle });
  ck("modification apres arret → non concordant", p.concordance.etat === "non_concordant");
  ck("modification apres arret → INVALIDE", v.verdict === "INVALIDE");
  let leve = false;
  try { finaliser({ cheminArtefact: s.art, capture: s.cap, recordId: s.recordId, cle: s.cle, strict: true }); }
  catch (e) { leve = e.concordance?.etat === "non_concordant"; }
  ck("mode strict → la finalisation refuse", leve);
}
{
  const s = seance("p0_c.md", ["Original"]);
  fs.writeFileSync(s.art, "Un contenu entierement different.");
  const p = finaliser({ cheminArtefact: s.art, capture: s.cap, recordId: s.recordId, cle: s.cle });
  ck("remplacement complet → non concordant", p.concordance.etat === "non_concordant");
}
{
  // Retour aux mêmes octets : comportement à documenter, pas à supposer.
  const s = seance("p0_d.md", ["Stable"]);
  const avant = fs.readFileSync(s.art);
  fs.appendFileSync(s.art, "\nmodification temporaire");
  fs.writeFileSync(s.art, avant);                       // on revient exactement en arrière
  const p = finaliser({ cheminArtefact: s.art, capture: s.cap, recordId: s.recordId, cle: s.cle });
  ck("retour aux memes octets → concordant (l'engagement porte sur les OCTETS, pas sur l'histoire)",
    p.concordance.etat === "concordant");
  console.log("     documente : un aller-retour qui restitue les octets exacts est indetectable");
  console.log("     par ce mecanisme. Il engage l'etat final, jamais le chemin parcouru.");
}
{
  const s = seance("p0_e.md", ["Sans engagement"]);
  s.cap.arret = null;                                   // période fermée sans engagement
  const p = finaliser({ cheminArtefact: s.art, capture: s.cap, recordId: s.recordId, cle: s.cle });
  const ch = `${s.art}.proof.json`; ecrirePreuve(p, ch);
  const v = verifier({ cheminPreuve: ch, cheminArtefact: s.art, cle: s.cle });
  ck("arret sans engagement → etat explicite, pas un silence", p.concordance.etat === "sans_engagement_d_arret");
  ck("arret sans engagement → INVALIDE", v.verdict === "INVALIDE");
}

console.log("\n-- P1 · ce qui preexistait a l'observation --");
{
  const s = seance("p1_vide.md", ["premiere ligne"], { texteInitial: "" });
  const p = finaliser({ cheminArtefact: s.art, capture: s.cap, recordId: s.recordId, cle: s.cle });
  ck("fichier vide → baseline de 0 octet, declaree", p.preexistant.octets === 0 && p.preexistant.observe === false);
}
{
  const prealable = "x".repeat(1000);
  const s = seance("p1_1000.md", ["ajout sous observation"], { texteInitial: prealable });
  const p = finaliser({ cheminArtefact: s.art, capture: s.cap, recordId: s.recordId, cle: s.cle });
  const ch = `${s.art}.proof.json`; ecrirePreuve(p, ch);
  const v = verifier({ cheminPreuve: ch, cheminArtefact: s.art, cle: s.cle });
  ck("1000 caracteres preexistants → declares et non observes",
    p.preexistant.octets === 1000 && p.preexistant.observe === false, `${p.preexistant.octets} octets`);
  ck("la preuve nomme l'origine inconnue du preexistant",
    p.observation.ce_qui_reste_inconnu.some(x => x.includes("avant la premiere periode")));
  ck("le verificateur expose le volume non observe", v.preexistant_non_observe === 1000);
  // Le point qui compte : rien ne doit laisser croire que ces 1000 caractères sont observés.
  const total = fs.readFileSync(s.art).length;
  ck("le preexistant n'est pas compte dans les evenements observes",
    p.observation.evenements === 1 && total > 1000, `${p.observation.evenements} evenement pour ${total} octets`);
}
{
  const prealable = "ligne preexistante\n".repeat(30);
  const art = `${T}/p1_partiel.md`; fs.writeFileSync(art, prealable);
  const cle = crypto.randomBytes(32), recordId = identifiantLocal();
  const cap = new Capture({ source: "editeur" });
  cap.ouvrirPeriode(prealable);
  const t = prealable.split("\n"); t[5] = "ligne MODIFIEE sous observation";
  const texte = t.join("\n"); fs.writeFileSync(art, texte);
  cap.changementAnnonce(texte, ["u5"], "edited");
  cap.fermerPeriode(art);
  const p = finaliser({ cheminArtefact: art, capture: cap, recordId, cle });
  ck("modification partielle d'un preexistant → baseline conservee",
    p.preexistant.octets === prealable.length, `${p.preexistant.octets} octets preexistants`);
  ck("modification partielle → un seul evenement observe", p.observation.evenements === 1);
}

console.log("\n-- P2 · signaux, et collage fractionne --");
{
  const base = Date.parse("2026-10-02T10:00:00Z");
  const humain = Array.from({ length: 24 }, (_, i) =>
    ({ at: new Date(base + i * (600 + Math.floor(Math.random() * 2400))).toISOString(),
       length_delta: 2 + Math.floor(Math.random() * 30), source: "local_editing" }));
  const fractionne = Array.from({ length: 40 }, (_, i) =>
    ({ at: new Date(base + i * 180).toISOString(), length_delta: 100, source: "local_editing" }));
  const sh = signaux(humain), sf = signaux(fractionne);
  ck("frappe irreguliere → regularite ordinaire", sh.signal_regularite === "ordinaire",
    `cv_intervalles=${sh.regularite.intervalles} cv_tailles=${sh.regularite.tailles}`);
  ck("collage fractionne sous le seuil → regularite inhabituelle", sf.signal_regularite === "inhabituelle",
    `cv_intervalles=${sf.regularite.intervalles} cv_tailles=${sf.regularite.tailles}`);
  ck("aucun evenement fractionne n'etait pourtant signale par le seuil",
    fractionne.every(f => f.length_delta < 120), "40 x 100 caracteres, tous sous 120");
  ck("peu d'evenements → aucun jugement", signaux(humain.slice(0, 4)).signal_regularite === "indeterminee");
  ck("la portee du signal est portee AVEC lui",
    /n'etablit ni l'auteur/i.test(sh.portee_du_signal));
}

console.log(`\n  ${ok} reussis · ${ko} echoues  =>  BEYOND_WORD_V0_1 = ${ko ? "FAIL" : "PASS"}`);
process.exit(ko ? 1 : 0);
