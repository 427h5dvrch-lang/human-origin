// Verdict du banc UI : lit <dossier>/brut.json (hôte WebView2, Edge headless ou WKWebView),
// applique les MÊMES critères à chaque cas et écrit <dossier>/rapport.json.
//   node tests/webview_bench/verdict.mjs <dossier> <ETIQUETTE>
// Critères : vue CSS = taille demandée et densité = échelle ; bouton de copie ET message entiers,
// marge ≥ 8 px, aucun défilement ; message attendu ; copie demandée au natif au clavier ;
// role=status + aria-live=polite ; hiérarchie ; aucune clé ni lien ; aucune ressource hors
// origine ni navigation refusée ; aucune erreur.
import fs from "node:fs";
import path from "node:path";

const [DOSSIER, ETIQUETTE = "UI"] = process.argv.slice(2);
const MARGE_MIN = 8;
const OK = { fr: "Lien copié", en: "Link copied" };
const LIB = { fr: { copie: "Copier le lien de vérification", version: "Créer une nouvelle version" },
              en: { copie: "Copy the verification link", version: "Create a new version" } };
const brut = JSON.parse(fs.readFileSync(path.join(DOSSIER, "brut.json"), "utf8"));

const rapport = brut.map((c) => {
  const a = c.avant || {}, p = c.apres || {};
  const margeBouton = a.copie ? a.copie.marge : -999, margeMessage = p.zone ? p.zone.marge : -999;
  const vue = a.innerWidth === c.w && a.innerHeight === c.h && Math.abs((a.dpr || 0) - c.echelle) < 0.01;
  const texte = p.zoneTexte || "";
  const message = c.copie === "ok" ? texte.startsWith(OK[c.langue]) : (!!texte && !texte.startsWith(OK[c.langue]));
  const ordre = a.ordre || [];
  const hierarchie = c.scenario === "continuer"
    ? a.fondCopie !== a.fondVersion && ordre.indexOf(LIB[c.langue].copie) >= 0
      && ordre.indexOf(LIB[c.langue].copie) < ordre.indexOf(LIB[c.langue].version)
    : a.fondCopie !== a.fondNouveau;
  const isolement = [...(a.ressourcesHorsOrigine || []), ...(p.ressourcesHorsOrigine || []), ...(c.bloques || []), ...(c.refus || [])];
  const controles = {
    vueCss: vue, sansDefilement: (p.scrollY || 0) === 0,
    boutonMarge: margeBouton >= MARGE_MIN, messageMarge: margeMessage >= MARGE_MIN,
    messageAttendu: message, copieAuClavier: p.copiesDemandees === 1,
    annonce: p.role === "status" && p.live === "polite", hierarchie,
    aucuneCleNiLien: !a.cleOuLien && !p.cleOuLien, isolement: isolement.length === 0,
    aucuneErreur: (p.erreurs || []).length === 0,
  };
  const echecs = Object.entries(controles).filter(([, v]) => !v).map(([k]) => k);
  const verdict = echecs.length === 0 ? "PASS"
    : (echecs.every((k) => k === "boutonMarge" || k === "messageMarge") && margeBouton >= 0 && margeMessage >= 0 ? "BORDERLINE" : "FAIL");
  return { moteur: c.moteur, runtime: c.runtime, echelle: c.echelle, taille: `${c.w}x${c.h}`, scenario: c.scenario,
    langue: c.langue, copie: c.copie, verdict, echecs, margeBouton, margeMessage,
    vue: { innerWidth: a.innerWidth, innerHeight: a.innerHeight, dpr: a.dpr }, message: texte, isolement };
});

for (const r of rapport)
  console.log(`${r.verdict.padEnd(10)} ×${r.echelle.toFixed(1)} ${r.scenario.padEnd(9)} ${r.langue} ${r.taille} ${r.copie.padEnd(5)} bouton=${r.margeBouton}px message=${r.margeMessage}px vue=${r.vue.innerWidth}x${r.vue.innerHeight}@${r.vue.dpr}${r.echecs.length ? " échecs=" + r.echecs.join(",") : ""}`);
const parEchelle = {};
for (const r of rapport) {
  const e = (parEchelle[r.echelle.toFixed(1)] ||= { cas: 0, pass: 0, margeMin: Infinity });
  e.cas++; if (r.verdict === "PASS") e.pass++;
  e.margeMin = Math.min(e.margeMin, r.margeBouton, r.margeMessage);
}
const pass = rapport.filter((r) => r.verdict === "PASS").length;
const resume = { etiquette: ETIQUETTE, moteur: rapport[0]?.moteur, runtime: rapport[0]?.runtime, cas: rapport.length, pass, parEchelle,
  verdict: pass === rapport.length && rapport.length === 32 ? `${ETIQUETTE}_PASS` : `${ETIQUETTE}_FAIL` };
fs.writeFileSync(path.join(DOSSIER, "rapport.json"), JSON.stringify({ resume, cas: rapport }, null, 2));
console.log("\n" + JSON.stringify(resume));
process.exit(resume.verdict.endsWith("_PASS") ? 0 : 1);
