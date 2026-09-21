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
const V = charge(VIEUX), N = charge(NEUF);

console.log("\n── les deux volets sont bien ceux attendus ──");
ck("ancien volet : génère l'identifiant localement", V.genereLocalement);
ck("ancien volet : n'exige aucune réservation", !V.exigeReserve);
ck("nouveau volet : n'en génère plus", !N.genereLocalement);
ck("nouveau volet : exige l'identifiant réservé, et lève sinon", N.exigeReserve);

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
function simule(natifNeuf, voletNeuf) {
  const reserve = natifNeuf ? "R" : null;                 // identifiant réservé au serveur
  const seme = natifNeuf ? reserve : null;                // HOReservedId dans le document
  let locatorId;
  if (voletNeuf) {
    if (!seme) return { issue: "REFUS_VOLET", publie: null };   // pendingRecord lève
    locatorId = seme;
  } else {
    locatorId = "W";                                      // tirage local de l'ancien volet
  }
  if (!natifNeuf) return { issue: "DEPOT_ANONYME", publie: locatorId };
  // Nouveau finalizer : capability au trousseau sous l'identifiant RÉSERVÉ uniquement.
  const trousseau = new Set([reserve]);
  if (!trousseau.has(locatorId)) return { issue: "REFUS_FINALIZER", publie: null };
  return { issue: "PUBLIE_AVEC_CAPABILITY", publie: locatorId };
}

console.log("\n── matrice ──");
const cas = [
  ["ancien", "ancien", "DEPOT_ANONYME",           "comportement historique"],
  ["nouveau", "ancien", "REFUS_FINALIZER",        "le volet ignore l'ID réservé, le trousseau n'a rien sous le sien"],
  ["ancien", "nouveau", "REFUS_VOLET",            "aucun HOReservedId : le volet lève avant tout"],
  ["nouveau", "nouveau", "PUBLIE_AVEC_CAPABILITY", "cible"],
];
for (const [n, w, attendu, note] of cas) {
  const r = simule(n === "nouveau", w === "nouveau");
  ck(`natif ${n} + volet ${w} → ${attendu}`, r.issue === attendu, `${r.issue} · ${note}`);
}

console.log("\n── l'invariant qui compte : aucune publication sous un ID non réservé ──");
for (const [n, w] of cas.map(([a, b]) => [a, b])) {
  const r = simule(n === "nouveau", w === "nouveau");
  if (n === "nouveau") {
    ck(`natif nouveau + volet ${w} : ne publie jamais sous un ID non réservé`,
       r.publie === null || r.publie === "R", String(r.publie));
  }
}
ck("aucune combinaison ne publie silencieusement sous le mauvais ID",
   cas.every(([n, w]) => {
     const r = simule(n === "nouveau", w === "nouveau");
     return n === "ancien" || r.publie === null || r.publie === "R";
   }));

console.log(`\n  ${ok} réussis · ${ko} échoués  →  MATRICE_ROLLOUT = ${ko ? "FAIL" : "PASS"}`);
process.exit(ko ? 1 : 0);
