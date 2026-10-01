// Cohérence de version — source unique de vérité pour la release.
//
// Cinq endroits déclarent la version du produit, et un sixième la nomme : le tag Git.
// Une release n'est reproductible que si les six concordent. Ce module les lit, les
// compare, et refuse le moindre écart. Il est employé par `bump_version.mjs` avant
// d'écrire, et par la CI avant de construire quoi que ce soit.
//
//   node tools/release/version_coherence.mjs [--tag v0.3.2] [--racine .]
//
// Sortie 0 si tout concorde, 1 sinon, avec le détail de chaque écart.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Semver, préversion admise, métadonnée de build refusée : Tauri ne l'accepte pas. */
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export function versionValide(v) {
  return typeof v === "string" && SEMVER.test(v);
}

/** « v0.3.2 » -> « 0.3.2 ». Rend null si ce n'est pas un tag de version. */
export function versionDuTag(tag) {
  if (typeof tag !== "string") return null;
  const m = /^v(.+)$/.exec(tag.trim());
  return m && versionValide(m[1]) ? m[1] : null;
}

// --- lecture des sources ------------------------------------------------------------
// Chaque source est décrite par son chemin, la façon de lire la version, et la façon de
// l'écrire. bump_version.mjs se sert des deux : aucune liste de fichiers n'est dupliquée.

const litJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const ecritJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");

/** Remplace la version du paquet nommé dans un Cargo.lock, et lui seul. */
export function remplaceVersionDansLock(texte, nomPaquet, version) {
  const ancre = `name = "${nomPaquet}"`;
  const i = texte.indexOf(ancre);
  if (i < 0) throw new Error(`paquet « ${nomPaquet} » absent du Cargo.lock`);
  if (texte.indexOf(ancre, i + 1) >= 0) throw new Error(`paquet « ${nomPaquet} » en double`);
  const j = texte.indexOf("version = \"", i);
  if (j < 0) throw new Error("ligne version absente après le nom du paquet");
  const fin = texte.indexOf("\"", j + 11);
  return texte.slice(0, j) + `version = "${version}"` + texte.slice(fin + 1);
}

export function lireVersionDansLock(texte, nomPaquet) {
  const i = texte.indexOf(`name = "${nomPaquet}"`);
  if (i < 0) return null;
  const m = /version = "([^"]+)"/.exec(texte.slice(i));
  return m ? m[1] : null;
}

export function sources(racine = ".") {
  const p = (...x) => path.resolve(racine, ...x);
  return [
    {
      nom: "package.json", chemin: p("package.json"), requis: true,
      lire: (f) => litJson(f).version,
      ecrire: (f, v) => { const o = litJson(f); o.version = v; ecritJson(f, o); },
    },
    {
      nom: 'package-lock.json (racine)', chemin: p("package-lock.json"), requis: true,
      lire: (f) => litJson(f).version,
      ecrire: (f, v) => { const o = litJson(f); o.version = v; ecritJson(f, o); },
    },
    {
      nom: 'package-lock.json (packages[""])', chemin: p("package-lock.json"), requis: true,
      lire: (f) => (litJson(f).packages?.[""] ?? {}).version,
      ecrire: (f, v) => {
        const o = litJson(f);
        if (!o.packages || !o.packages[""]) throw new Error('packages[""] absent du lock npm');
        o.packages[""].version = v; ecritJson(f, o);
      },
    },
    {
      nom: "src-tauri/tauri.conf.json", chemin: p("src-tauri/tauri.conf.json"), requis: true,
      lire: (f) => (litJson(f).package ?? {}).version,
      ecrire: (f, v) => { const o = litJson(f); (o.package ??= {}).version = v; ecritJson(f, o); },
    },
    {
      nom: "src-tauri/Cargo.toml", chemin: p("src-tauri/Cargo.toml"), requis: true,
      lire: (f) => (/^version\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(f, "utf8")) ?? [])[1],
      ecrire: (f, v) => {
        const t = fs.readFileSync(f, "utf8");
        // On exige la PRÉSENCE d'une ligne version, pas un changement : réécrire la même
        // version est licite, et doit rester un no-op silencieux plutôt qu'une erreur.
        if (!/^version\s*=\s*"[^"]+"/m.test(t)) {
          throw new Error("aucune ligne version dans Cargo.toml");
        }
        fs.writeFileSync(f, t.replace(/(^version\s*=\s*")([^"]+)(")/m, `$1${v}$3`));
      },
    },
    {
      nom: "src-tauri/Cargo.lock", chemin: p("src-tauri/Cargo.lock"), requis: true,
      lire: (f) => lireVersionDansLock(fs.readFileSync(f, "utf8"), "human-origin"),
      ecrire: (f, v) => fs.writeFileSync(f,
        remplaceVersionDansLock(fs.readFileSync(f, "utf8"), "human-origin", v)),
    },
  ];
}

/** Rend [{ nom, version }] ; version vaut null si la source est illisible. */
export function lireVersions(racine = ".") {
  return sources(racine).map((s) => {
    if (!fs.existsSync(s.chemin)) return { nom: s.nom, version: null, absent: true };
    try { return { nom: s.nom, version: s.lire(s.chemin) ?? null }; }
    catch (e) { return { nom: s.nom, version: null, erreur: e.message }; }
  });
}

/**
 * Écarts par rapport à `attendue`. Sans `attendue`, c'est package.json qui fait foi.
 * Rend [] quand tout concorde — et JAMAIS [] quand une source est illisible.
 */
export function incoherences(versions, attendue = null) {
  const reference = attendue ?? versions.find((v) => v.nom === "package.json")?.version ?? null;
  const ecarts = [];
  if (!versionValide(reference)) {
    ecarts.push({ nom: "référence", trouve: reference, attendu: "une version semver" });
    return ecarts;
  }
  for (const v of versions) {
    if (v.version !== reference) {
      ecarts.push({ nom: v.nom, trouve: v.absent ? "fichier absent" : (v.erreur ?? v.version), attendu: reference });
    }
  }
  return ecarts;
}

// --- CLI ----------------------------------------------------------------------------
const estPrincipal = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (estPrincipal) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const racine = arg("--racine") ?? ".";
  const tag = arg("--tag");

  let attendue = null;
  if (tag) {
    attendue = versionDuTag(tag);
    if (!attendue) {
      console.error(`  ✗ tag « ${tag} » : attendu la forme vX.Y.Z (préversion admise)`);
      process.exit(1);
    }
  }

  const versions = lireVersions(racine);
  for (const v of versions) {
    console.log(`  ${String(v.version ?? v.erreur ?? "absent").padEnd(14)} ${v.nom}`);
  }
  if (tag) console.log(`  ${attendue.padEnd(14)} tag Git (${tag})`);

  const ecarts = incoherences(versions, attendue);
  if (ecarts.length === 0) {
    console.log(`\n  ✓ cohérent : ${attendue ?? versions[0].version}\n`);
    process.exit(0);
  }
  console.error("\n  ✗ incohérences :");
  for (const e of ecarts) console.error(`      ${e.nom} = ${e.trouve}, attendu ${e.attendu}`);
  console.error("");
  process.exit(1);
}
