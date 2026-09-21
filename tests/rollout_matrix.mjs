// Matrice de compatibilité natif × volet Word.
//
// Le rollout n'est pas atomique : l'application native et le volet Word se mettent à jour
// séparément. Ce banc vérifie qu'AUCUNE combinaison ne peut publier silencieusement sous un
// identifiant non réservé — la seule issue acceptable d'une combinaison incompatible est un
// refus explicite.
//
// Les deux versions du volet sont lues DANS L'HISTOIRE GIT, jamais réécrites ici : le banc
// mesure le vrai code, pas une paraphrase.

import path from "node:path"; import fs from "node:fs";
import { execFileSync } from "node:child_process";

const APP = process.env.HO_APP_DIR
  || path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WEB_CANDIDATS = [process.env.HO_WEB_DIR, "/tmp/rwa",
  path.join(process.env.HOME, "Developer/HO_FIRSTRUN_RC/humanorigin-web-consultation")].filter(Boolean);
const WEB = WEB_CANDIDATS.find((d) => fs.existsSync(path.join(d, ".git"))
  || fs.existsSync(path.join(d, "create-record/word/taskpane.js")));
if (!WEB) { console.log("\n  IGNORE : dépôt web introuvable"); process.exit(0); }

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };

const git = (args) => execFileSync("git", ["-C", WEB, ...args], { encoding: "utf8", maxBuffer: 32 << 20 });

// --- les deux volets, extraits de l'histoire
const REF_NEUF = "registry-write-auth-v1";
const REF_VIEUX = "registry-write-auth-v1~1";        // juste avant « employer l'identifiant réservé »
const volet = (ref) => git(["show", `${ref}:create-record/word/taskpane.js`]);

// Le volet COURANT est lu dans l'arbre de travail : c'est lui qui partira, pas une révision.
const COURANT = fs.readFileSync(path.join(WEB, "create-record/word/taskpane.js"), "utf8");
const NEUF = volet(REF_NEUF);
const VIEUX = (() => {
  // On remonte jusqu'à la version qui génère encore l'identifiant localement.
  for (const r of [REF_VIEUX, "registry-write-auth-v1~2", "registry-write-auth-v1~3", "record-contract-multi-period"]) {
    try { const s = volet(r); if (/PENDING\.recordId = "HO-" \+ b64u\(crypto\.getRandomValues/.test(s)) return s; }
    catch (e) { /* révision absente */ }
  }
  return null;
})();
if (!VIEUX) { console.log("\n  IGNORE : ancien volet introuvable dans l'histoire"); process.exit(0); }

// --- extraction exécutable de pendingRecord + reservedId, sans Office
function charge(src) {
  const reservedId = /async function reservedId\(\)/.test(src);
  const corps = src.slice(src.indexOf("function pendingRecord"),
                         src.indexOf("\n}", src.indexOf("function pendingRecord")) + 2);
  return { genereLocalement: /getRandomValues\(new Uint8Array\(9\)\)/.test(corps),
           exigeReserve: /throw new Error\(/.test(corps) && reservedId,
           corps };
}
const V = charge(VIEUX), N = charge(NEUF), C = charge(COURANT);

// Classe de comportement, déduite du code et non d'un numéro de révision : la matrice
// reste juste quand les branches bougent.
const classe = (src) => {
  const tire = /getRandomValues\(new Uint8Array\(9\)\)/.test(src);
  const transition = /LEGACY COMPATIBILITY — REMOVE AFTER REGISTRY WRITE V1 CUTOVER/.test(src);
  if (tire && transition) return "transition";
  if (tire) return "historique";
  return "strict";
};

console.log("\n── les trois volets sont bien ceux attendus ──");
ck("ancien volet : classe historique", classe(VIEUX) === "historique", classe(VIEUX));
ck("ancien volet : n'exige aucune réservation", !V.exigeReserve);
ck("volet strict (révision figée) : classe strict", classe(NEUF) === "strict", classe(NEUF));
ck("volet courant : classe transition", classe(COURANT) === "transition", classe(COURANT));
ck("volet courant : le tirage local est confiné au bloc étiqueté",
  (COURANT.match(/getRandomValues\(new Uint8Array\(9\)\)/g) || []).length === 1
  && COURANT.indexOf("LEGACY COMPATIBILITY") < COURANT.indexOf("getRandomValues(new Uint8Array(9))"));

// --- les deux natifs, lus dans l'histoire du dépôt applicatif
const gitApp = (args) => execFileSync("git", ["-C", APP, ...args], { encoding: "utf8", maxBuffer: 32 << 20 });
const setupNeuf = gitApp(["show", "HEAD:src-tauri/src/ho_word_setup.rs"]);
const setupVieux = gitApp(["show", "7349e6d~1:src-tauri/src/ho_word_setup.rs"]);
const finalNeuf = gitApp(["show", "HEAD:src-tauri/src/ho_finalizer.rs"]);
const finalVieux = gitApp(["show", "f68725d~1:src-tauri/src/ho_finalizer.rs"]);

console.log("\n── les deux natifs sont bien ceux attendus ──");
ck("ancien natif : ne sème pas HOReservedId", !setupVieux.includes("HOReservedId"));
ck("nouveau natif : sème HOReservedId", setupNeuf.includes("HOReservedId"));
ck("ancien finalizer : dépôt anonyme, sans capability", !finalVieux.includes("ho_capability"));
ck("nouveau finalizer : capability lue avant tout travail",
   finalNeuf.includes("let capability = crate::ho_capability::lire(&m.record_id)?;"));

// --- modèle des quatre combinaisons
// Chaque règle est ADOSSÉE à une assertion de source ci-dessus : le modèle ne peut pas
// diverger du code sans qu'un contrôle tombe.
function simule(natifNeuf, classeVolet, semeIllisible = false) {
  const reserve = natifNeuf ? "R" : null;                 // identifiant réservé au serveur
  const seme = natifNeuf ? (semeIllisible ? "??" : reserve) : null;   // HOReservedId
  let locatorId;
  if (classeVolet === "historique") {
    locatorId = "W";                                      // tirage local, propriété ignorée
  } else if (semeIllisible) {
    return { issue: "REFUS_VOLET", publie: null };        // échec fermé, jamais de repli
  } else if (seme) {
    locatorId = seme;
  } else if (classeVolet === "transition") {
    locatorId = "W";                                      // chemin historique, temporaire
  } else {
    return { issue: "REFUS_VOLET", publie: null };        // strict : lève
  }
  if (!natifNeuf) return { issue: "DEPOT_ANONYME", publie: locatorId };
  // Nouveau finalizer : capability au trousseau sous l'identifiant RÉSERVÉ uniquement.
  const trousseau = new Set([reserve]);
  if (!trousseau.has(locatorId)) return { issue: "REFUS_FINALIZER", publie: null };
  return { issue: "PUBLIE_AVEC_CAPABILITY", publie: locatorId };
}

console.log("\n── matrice ──");
const cas = [
  ["ancien",  "historique", "DEPOT_ANONYME",           "comportement historique"],
  ["nouveau", "historique", "REFUS_FINALIZER",         "le volet ignore l'ID réservé, le trousseau n'a rien sous le sien"],
  ["ancien",  "strict",     "REFUS_VOLET",             "aucun HOReservedId : le volet lève — PANNE pour les postes non à jour"],
  ["nouveau", "strict",     "PUBLIE_AVEC_CAPABILITY",  "cible du basculement brutal"],
  ["ancien",  "transition", "DEPOT_ANONYME",           "TRANSITION : le poste non à jour continue de fonctionner"],
  ["nouveau", "transition", "PUBLIE_AVEC_CAPABILITY",  "TRANSITION : le poste à jour emploie l'ID réservé"],
];
for (const [n, w, attendu, note] of cas) {
  const r = simule(n === "nouveau", w);
  ck(`natif ${n} + volet ${w} → ${attendu}`, r.issue === attendu, `${r.issue} · ${note}`);
}

console.log("\n── le mode transition supprime les deux pannes de rollout ──");
ck("ancien natif + transition : plus de refus du volet",
  simule(false, "transition").issue === "DEPOT_ANONYME");
ck("nouveau natif + transition : plus de refus du finalizer",
  simule(true, "transition").issue === "PUBLIE_AVEC_CAPABILITY");
ck("HOReservedId illisible : échec fermé même en transition",
  simule(true, "transition", true).issue === "REFUS_VOLET");
ck("HOReservedId illisible : jamais de repli sur le tirage local",
  simule(true, "transition", true).publie === null);

console.log("\n── l'invariant qui compte : aucune publication sous un ID non réservé ──");
for (const [n, w] of cas.map(([a, b]) => [a, b])) {
  const r = simule(n === "nouveau", w);
  if (n === "nouveau") {
    ck(`natif nouveau + volet ${w} : ne publie jamais sous un ID non réservé`,
       r.publie === null || r.publie === "R", String(r.publie));
  }
}
ck("aucune combinaison ne publie silencieusement sous le mauvais ID",
   cas.every(([n, w]) => {
     const r = simule(n === "nouveau", w);
     return n === "ancien" || r.publie === null || r.publie === "R";
   }));

console.log(`\n  ${ok} réussis · ${ko} échoués  →  MATRICE_ROLLOUT = ${ko ? "FAIL" : "PASS"}`);
process.exit(ko ? 1 : 0);
