// Montée de version du produit.
//
// Une seule commande doit produire une version cohérente partout. Les six emplacements
// sont décrits par tools/release/version_coherence.mjs, qui sert aussi à les vérifier :
// la liste n'existe donc qu'une fois, et ce qui écrit est ce qui contrôle.
//
//   node bump_version.mjs 0.3.2 [--git] [--tag] [--cargo] [--dry-run] [--force]
//   npm run bump:git:cargo -- 0.3.2
//
// L'ORDRE DES ARGUMENTS NE DÉCIDE DE RIEN. `npm run` ajoute les arguments de
// l'utilisateur APRÈS ceux du script : la version arrive donc après les drapeaux. L'ancien
// code lisait argv[2] et prenait « --git » pour un numéro de version — puis le committait
// et le taguait, en annonçant trois succès. La version est désormais le premier argument
// qui n'est pas un drapeau, et tout drapeau inconnu fait échouer la commande.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  sources, lireVersions, incoherences, versionValide, SEMVER,
} from "./tools/release/version_coherence.mjs";

const DRAPEAUX = ["--git", "--tag", "--cargo", "--dry-run", "--force"];

/** Rend { version, drapeaux } ou lève. */
export function analyser(argv) {
  const positionnels = argv.filter((a) => !a.startsWith("--"));
  const drapeaux = argv.filter((a) => a.startsWith("--"));
  const inconnus = drapeaux.filter((d) => !DRAPEAUX.includes(d));
  if (inconnus.length) throw new Error(`drapeau inconnu : ${inconnus.join(", ")}`);
  if (positionnels.length === 0) throw new Error("version manquante");
  if (positionnels.length > 1) throw new Error(`une seule version attendue, reçu : ${positionnels.join(" ")}`);
  const version = positionnels[0];
  if (!versionValide(version)) {
    throw new Error(`« ${version} » n'est pas une version semver (X.Y.Z, préversion admise)`);
  }
  return { version, drapeaux: new Set(drapeaux) };
}

/** -1, 0 ou 1. Une préversion est antérieure à la version de même socle. */
export function comparer(a, b) {
  const part = (v) => {
    const [, x, y, z] = SEMVER.exec(v);
    return [Number(x), Number(y), Number(z), v.includes("-") ? 0 : 1];
  };
  const pa = part(a), pb = part(b);
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    const detail = String(e.stderr ?? "").trim() || e.message;
    console.error(`  \u2717 git ${args.join(" ")} : ${detail}`);
    process.exit(1);
  }
};

function principal(argv) {
  let analyse;
  try { analyse = analyser(argv); }
  catch (e) {
    console.error(`  ✗ ${e.message}`);
    console.error("    usage : node bump_version.mjs 0.3.2 [--git] [--tag] [--cargo] [--dry-run] [--force]");
    console.error("            npm run bump:git:cargo -- 0.3.2");
    process.exit(1);
  }
  const { version, drapeaux } = analyse;
  const sec = drapeaux.has("--dry-run");
  const avecGit = drapeaux.has("--git");
  const avecTag = drapeaux.has("--tag");

  if (avecTag && !avecGit) { console.error("  ✗ --tag exige --git"); process.exit(1); }

  // --cargo n'est plus une option : une version partielle n'est pas une version. Le
  // drapeau reste accepté pour ne pas casser les scripts npm existants, et ne fait rien.
  const tous = sources(".");
  for (const s of tous) {
    if (!fs.existsSync(s.chemin)) {
      console.error(`  ✗ ${s.nom} introuvable (${s.chemin}) — rien n'a été écrit`);
      process.exit(1);
    }
  }

  const avant = lireVersions(".");
  const actuelle = avant.find((v) => v.nom === "package.json")?.version;
  console.log(`  version actuelle : ${actuelle ?? "illisible"}`);
  console.log(`  version visée    : ${version}`);

  if (versionValide(actuelle) && comparer(version, actuelle) <= 0 && !drapeaux.has("--force")) {
    console.error(`  ✗ ${version} n'est pas postérieure à ${actuelle} (--force pour forcer)`);
    process.exit(1);
  }

  // Tag déjà présent : on refuse AVANT d'écrire, pour ne pas laisser l'arbre à moitié monté.
  if (avecTag) {
    const existants = git("tag", "--list", `v${version}`);
    if (existants) { console.error(`  ✗ le tag v${version} existe déjà`); process.exit(1); }
  }

  // Les fichiers à modifier doivent être propres : sinon le commit de release emporterait
  // un travail en cours. Le reste de l'arbre ne nous concerne pas, on n'y touche pas.
  const aEcrire = [...new Set(tous.map((s) => s.chemin))];
  if (avecGit) {
    const sales = git("status", "--porcelain", "--", ...aEcrire);
    if (sales) {
      console.error("  ✗ ces fichiers portent des modifications non committées :");
      console.error(sales.split("\n").map((l) => `      ${l}`).join("\n"));
      process.exit(1);
    }
  }

  if (sec) {
    console.log("\n  --dry-run : rien n'est écrit. Seraient mis à jour :");
    for (const s of tous) console.log(`      ${s.nom}`);
    if (avecGit) console.log(`      puis commit « chore(release): v${version} »`);
    if (avecTag) console.log(`      puis tag v${version}`);
    process.exit(0);
  }

  for (const s of tous) {
    try {
      s.ecrire(s.chemin, version);
    } catch (e) {
      // Une écriture partielle est pire qu'un refus : on le dit, et on nomme ce qui reste
      // à reprendre. « npm run version:check » donne l'état exact de chaque emplacement.
      console.error(`\n  ✗ ${s.nom} : ${e.message}`);
      console.error("    montée de version INCOMPLÈTE — « npm run version:check » donne l'état\n");
      process.exit(1);
    }
    console.log(`  ✓ ${s.nom} → ${version}`);
  }

  // Contrôle APRÈS écriture : on ne déclare pas une montée de version sans l'avoir relue.
  const ecarts = incoherences(lireVersions("."), version);
  if (ecarts.length) {
    console.error("\n  ✗ incohérence après écriture — aucun commit, aucun tag :");
    for (const e of ecarts) console.error(`      ${e.nom} = ${e.trouve}, attendu ${e.attendu}`);
    process.exit(1);
  }
  console.log(`  ✓ cohérence relue sur ${tous.length} emplacements`);

  if (!avecGit) {
    console.log("\n  Git ignoré. Ajoute --git (et --tag) pour committer et taguer.\n");
    return;
  }

  // Jamais `git add .` : uniquement les fichiers nommés ci-dessus.
  git("add", ...aEcrire);
  git("commit", "-m", `chore(release): v${version}`);
  console.log(`  ✓ commit ${git("rev-parse", "--short", "HEAD")} « chore(release): v${version} »`);

  if (avecTag) {
    git("tag", `v${version}`);
    console.log(`  ✓ tag v${version}`);
  }
  const branche = git("rev-parse", "--abbrev-ref", "HEAD");
  console.log(`\n  Reste à pousser, quand tu le décides :`);
  console.log(`      git push origin ${branche}${avecTag ? ` v${version}` : ""}\n`);
}

const estPrincipal = process.argv[1] && process.argv[1].endsWith("bump_version.mjs");
if (estPrincipal) principal(process.argv.slice(2));
