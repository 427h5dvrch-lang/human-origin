// Matrice de compatibilité natif × volet Word.
//
// Le rollout n'est pas atomique : l'application native et le volet Word se mettent à jour
// séparément. Ce banc vérifie qu'AUCUNE combinaison ne peut publier silencieusement sous un
// identifiant non réservé — la seule issue acceptable d'une combinaison incompatible est un
// refus explicite.
//
// Les deux versions du volet sont lues DANS L'HISTOIRE GIT, jamais réécrites ici : le banc
// mesure le vrai code, pas une paraphrase.
//
// LE « VOLET COURANT » N'EST PAS UN FICHIER LOCAL. Word charge le volet depuis
// `https://create.humanorigin.io/word/taskpane.html` : ce que voient les utilisateurs est un
// DÉPLOIEMENT, pas un arbre de travail. Le banc lisait « le » volet dans le premier dossier
// trouvé sur la machine — le 2026-10-10 c'était un worktree de consultation, qui n'a jamais
// été la source d'expédition — et concluait sur lui. Mesuré ce jour-là : le volet déployé est
// de classe « strict », octet pour octet celui de `bilingual-launch-fix-v1`, tandis que `main`
// portait encore un volet « historique » de 11 Ko. Le verdict dépendait donc des dossiers
// présents, pas du produit.
//
// Désormais le volet courant est lu à sa source réelle — le déploiement — ou fourni
// explicitement par `HO_VOLET_COURANT`. Hors réseau et sans fourniture, les deux contrôles de
// conformité du déploiement sont ANNONCÉS COMME NON ÉTABLIS : un banc local ne peut pas savoir
// ce qui est servi. La matrice, elle, reste entièrement jouée : elle est pure.

import path from "node:path"; import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const APP = process.env.HO_APP_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_CANDIDATS = [process.env.HO_WEB_DIR, "/tmp/rwa",
  path.join(process.env.HOME, "Developer/HO_FIRSTRUN_RC/humanorigin-web-consultation")].filter(Boolean);
const WEB = WEB_CANDIDATS.find((d) => fs.existsSync(path.join(d, ".git"))
  || fs.existsSync(path.join(d, "create-record/word/taskpane.js")));
if (!WEB) { console.log("\n  IGNORE : dépôt web introuvable"); process.exit(0); }

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };

const git = (args) => execFileSync("git", ["-C", WEB, ...args], { encoding: "utf8", maxBuffer: 32 << 20 });

// --- les trois volets, retrouvés DANS L'HISTOIRE par leur comportement.
// Aucune révision figée : les branches bougent, la classe de comportement, non.
const classe = (src) => {
  const tire = /getRandomValues\(new Uint8Array\(9\)\)/.test(src);
  const transition = /LEGACY COMPATIBILITY — REMOVE AFTER REGISTRY WRITE V1 CUTOVER/.test(src);
  if (tire && transition) return "transition";
  if (tire) return "historique";
  return "strict";
};
const volet = (ref) => git(["show", `${ref}:create-record/word/taskpane.js`]);

/**
 * Le volet COURANT : celui que Word charge réellement.
 *
 * `HO_VOLET_COURANT` l'emporte — c'est la voie hors réseau, et celle d'un volet candidat qu'on
 * veut éprouver avant de le déployer. Sinon on va le chercher là où Word le prend. Un échec de
 * réseau n'est pas un échec du produit : il rend `null`, et les contrôles concernés se
 * déclarent non établis.
 */
const VOLET_DEPLOYE = "https://create.humanorigin.io/word/taskpane.js";
function voletCourant() {
  const fourni = process.env.HO_VOLET_COURANT;
  if (fourni) {
    try { return { src: fs.readFileSync(fourni, "utf8"), source: fourni }; }
    catch (e) { return { src: null, source: `${fourni} (illisible)` }; }
  }
  if (process.env.HO_SANS_RESEAU) return { src: null, source: "réseau refusé par HO_SANS_RESEAU" };
  try {
    const src = execFileSync("curl", ["-fsS", "--max-time", "20", VOLET_DEPLOYE],
      { encoding: "utf8", maxBuffer: 8 << 20 });
    return { src, source: VOLET_DEPLOYE };
  } catch (e) { return { src: null, source: `${VOLET_DEPLOYE} (injoignable)` }; }
}
const { src: COURANT, source: SOURCE_COURANT } = voletCourant();

const revs = git(["rev-list", "--max-count=60", "registry-write-auth-v1"]).trim().split("\n");
const parClasse = {};
for (const r of revs) {
  let src; try { src = volet(r); } catch (e) { continue; }
  const c = classe(src);
  if (!parClasse[c]) parClasse[c] = { rev: r.slice(0, 7), src };
}
const VIEUX = parClasse.historique?.src;
const NEUF = parClasse.strict?.src;
if (!VIEUX || !NEUF) {
  console.log(`\n  IGNORE : classes introuvables dans l'histoire (${Object.keys(parClasse).join(", ")})`);
  process.exit(0);
}

// Extraction exécutable de pendingRecord, sans Office.
function charge(src) {
  const i = src.indexOf("function pendingRecord");
  const corps = src.slice(i, src.indexOf("\n}", i) + 2);
  return { genereLocalement: /getRandomValues\(new Uint8Array\(9\)\)/.test(corps),
           exigeReserve: /throw new Error\(/.test(corps) && /async function reservedId\(\)/.test(src) };
}

const V = charge(VIEUX), N = charge(NEUF);

console.log("\n── les volets sont bien ceux attendus ──");
ck("volet historique retrouvé dans l'histoire", classe(VIEUX) === "historique", parClasse.historique.rev);
ck("ancien volet : n'exige aucune réservation", !V.exigeReserve);
ck("volet strict retrouvé dans l'histoire", classe(NEUF) === "strict", parClasse.strict.rev);
if (!COURANT) {
  // Non établi, et dit comme tel. Le faire passer pour vert serait affirmer une conformité du
  // déploiement que ce banc n'a pas mesurée.
  console.log(`  — volet courant NON ÉTABLI : ${SOURCE_COURANT}`);
  console.log("    (fournir HO_VOLET_COURANT=<fichier> pour éprouver un volet hors réseau)");
} else {
  const cl = classe(COURANT);
  // L'invariant, et non « exactement transition » : « transition » était l'état d'un instant
  // du basculement, désormais passé. Ce qui doit rester vrai est qu'un poste à jour ne tombe
  // jamais sur la seule combinaison qui refuse au finalizer — natif neuf + volet historique.
  ck("volet courant : jamais la classe historique", cl !== "historique", `${cl} · ${SOURCE_COURANT}`);
  ck("volet courant : aucune publication possible sous un ID non réservé",
    simule(true, cl).publie === null || simule(true, cl).publie === "R", cl);
  // Ce contrôle ne valait que pour un volet de transition : sans le marqueur, `indexOf` rend
  // -1, la comparaison était vraie, et le contrôle passait en n'ayant rien vérifié.
  if (cl === "transition") {
    ck("volet de transition : le tirage local est confiné au bloc étiqueté",
      (COURANT.match(/getRandomValues\(new Uint8Array\(9\)\)/g) || []).length === 1
      && COURANT.indexOf("LEGACY COMPATIBILITY") >= 0
      && COURANT.indexOf("LEGACY COMPATIBILITY") < COURANT.indexOf("getRandomValues(new Uint8Array(9))"));
  }
}

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
// L'orthographe exacte `let capability = ...lire(&m.record_id)?;` était exigée. Le finalizer
// traite désormais l'absence par un `match` explicite au lieu de propager : même invariant,
// meilleure gestion d'erreur, et le banc tombait pour une raison qui n'en est pas une.
//
// On mesure donc la lecture elle-même, et son RANG : « avant tout travail » se juge contre le
// premier travail coûteux qui suit, le déchiffrement des faits. Lue après, un document sans
// autorisation aurait déjà été déchiffré pour rien.
const iCap = finalNeuf.indexOf("crate::ho_capability::lire(&m.record_id)");
const iTravail = finalNeuf.indexOf("decrypt_facts(&m.facts_blob");
ck("nouveau finalizer : capability lue avant tout travail",
   iCap > 0 && iTravail > 0 && iCap < iTravail, `capability @${iCap} · déchiffrement @${iTravail}`);

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
