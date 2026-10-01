// Banc de la marque HumanOrigin.
//
// Le paquet d'identité est gelé et le dit : DO NOT REDRAW · DO NOT RECREATE FROM FONT ·
// DO NOT SUBSTITUTE FINGERPRINT. Une version du Creator Shell avait pourtant tracé une
// empreinte en SVG, entourée d'un cercle que la spec exclut explicitement.
//
// Ce banc rend une telle dérive détectable : il vérifie que les assets versionnés sont
// bien, octet pour octet, ceux du paquet officiel, qu'un seul point de l'interface les
// emploie, et qu'aucun écran ne redessine la marque.
//
//   node tests/brand_assets.mjs
//
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ici = path.dirname(fileURLToPath(import.meta.url));
const BRAND = path.join(ici, "../src/brand");
const SRC = path.join(ici, "../src");

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

console.log("\n-- les assets sont ceux du paquet officiel, octet pour octet --");
const sommes = fs.readFileSync(path.join(BRAND, "SHA256SUMS.txt"), "utf8")
  .split("\n").filter(Boolean)
  .map((l) => { const m = l.trim().split(/\s+/); return { hex: m[0], nom: m[1] }; });
ck("des empreintes sont déclarées", sommes.length >= 1, sommes.length + " fichier(s)");
for (const { hex, nom } of sommes) {
  const p = path.join(BRAND, nom);
  ck(nom + " présent", fs.existsSync(p));
  if (fs.existsSync(p)) ck(nom + " conforme", sha(p) === hex, sha(p).slice(0, 16) + "…");
}

console.log("\n-- un seul point d'entrée dans l'interface --");
const modules = fs.readdirSync(SRC).filter((f) => f.endsWith(".js"));
const importeurs = modules.filter((f) =>
  /from\s+["'][^"']*brand\/[^"']+["']/.test(fs.readFileSync(path.join(SRC, f), "utf8")));
ck("un seul module importe la marque", importeurs.length === 1, importeurs.join(", "));

// La marque vit dans le module de composants : c'est lui, et lui seul, qui l'importe et
// la pose. Les écrans passent par HumanOriginBrandMark, jamais par l'asset.
const shell = fs.readFileSync(path.join(SRC, "ho_shell.js"), "utf8");
ck("elle passe par HumanOriginBrandMark", /function HumanOriginBrandMark\(/.test(shell));
for (const jeton of ["MOT_SYMBOLE_MARINE", "MOT_SYMBOLE_BLANC"]) {
  const n = (shell.match(new RegExp(jeton, "g")) || []).length;
  ck(jeton + " : importé puis posé, nulle part ailleurs", n === 2, String(n));
}
// Le mot-symbole est celui du paquet gelé, pas l'empreinte seule : dans l'interface, la
// marque porte le nom. L'empreinte seule ne sert que à l'icône de l'application, hors du
// frontend.
ck("c'est le mot-symbole qui entre dans l'interface",
  /brand\/HumanOrigin_wordmark_navy\.png/.test(shell));
ck("aucune empreinte seule dans le frontend", !/brand\/HumanOrigin_fingerprint/.test(shell));
// Les écrans n'ont AUCUN accès direct à l'asset : ils passent par le composant.
const ecrans = fs.readFileSync(path.join(SRC, "ho_desktop.js"), "utf8");
ck("les écrans ne touchent pas l'asset", !/MOT_SYMBOLE_|brand\//.test(ecrans));
ck("les écrans passent par le composant", /HumanOriginBrandMark\(/.test(ecrans));

console.log("\n-- le nom n'est jamais réécrit à côté de la marque --");
// Le défaut corrigé le 2026-09-28 : une empreinte posée à gauche d'un « HumanOrigin »
// composé en police système. Le mot-symbole canonique CONTIENT déjà le nom, empreinte en
// « O » comprise ; le doubler d'un texte, c'est le recomposer. On regarde donc le
// voisinage immédiat de chaque pose de la marque.
for (const [nom, src] of [["ho_shell.js", shell], ["ho_desktop.js", ecrans]]) {
  const fautes = [...src.matchAll(/HumanOriginBrandMark\s*\(/g)]
    // La déclaration du composant porte le nom accessible `alt` : c'est sa place.
    .filter((m) => src.slice(Math.max(0, m.index - 9), m.index) !== "function ")
    .filter((m) => {
      const autour = src.slice(m.index, m.index + 260);
      return /["'\u0060]HumanOrigin["'\u0060]/.test(autour);
    });
  ck(nom + " : le nom n'est pas recomposé près de la marque", fautes.length === 0,
    fautes.length ? fautes.length + " passage(s)" : "");
}

console.log("\n-- l'icône de l'application descend du master gelé --");
{
  const OUTIL = path.join(ici, "../tools/generer_icone_app.py");
  ck("le générateur est versionné", fs.existsSync(OUTIL));
  if (fs.existsSync(OUTIL)) {
    const py = fs.readFileSync(OUTIL, "utf8");
    const attendue = (py.match(/EMPREINTE_ATTENDUE\s*=\s*"([0-9a-f]{64})"/) || [])[1];
    const declaree = (sommes.find((x) => x.nom === "HumanOrigin_fingerprint_white.png") || {}).hex;
    ck("il part de l'empreinte déclarée", !!attendue && attendue === declaree,
      attendue ? attendue.slice(0, 16) + "…" : "absente");
    ck("il ne lit que le master blanc",
      /HumanOrigin_fingerprint_white\.png/.test(py) && !/wordmark/.test(py));
  }
  ck("la source 1024 est versionnée",
    fs.existsSync(path.join(ici, "../tools/HumanOrigin_app_icon_1024.png")));
}

console.log("\n-- aucune marque redessinée --");
// Le contrôle porte sur le CODE : un commentaire qui PARLE de la marque ne la dessine pas,
// et mon propre commentaire, voisin d'une aide SVG, faisait tomber le banc à tort.
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

// L'empreinte est faite d'arcs ; un <path> ou un <circle> tracé près du mot « marque »,
// « empreinte » ou « fingerprint » serait une recréation.
for (const f of modules) {
  const s = sansCommentaires(fs.readFileSync(path.join(SRC, f), "utf8"));
  const suspects = [...s.matchAll(/(empreinte|fingerprint|marque)/gi)]
    .filter((m) => {
      const autour = s.slice(Math.max(0, m.index - 220), m.index + 220);
      // Les aides locales comptent autant que le DOM brut : le faux symbole d'origine
      // passait par `svg()` et `trace()`, jamais par createElementNS directement.
      return /createElementNS|<svg|<path|<circle|\bsvg\(|\btrace\(/.test(autour)
        && !/HumanOriginBrandMark|brand\//.test(autour);
    });
  ck(f + " : aucune marque tracée à la main", suspects.length === 0,
    suspects.length ? suspects.length + " passage(s)" : "");
}

console.log("\n-- seule la taille varie, et le composite vaut le raster intact --");
{
  const d = shell.indexOf("function HumanOriginBrandMark(");
  const corps = shell.slice(d, shell.indexOf("\n}", d));
  ck("hauteur paramétrée sur les deux calques",
    (corps.match(/height: taille/g) || []).length === 2);
  ck("largeur laissée au ratio de l'asset",
    (corps.match(/width: "auto"/g) || []).length === 2);
  // `transform-origin` ne déforme rien : il nomme le pivot de l'impulsion. C'est
  // `transform:` qui serait une retouche du raster.
  for (const interdit of ["filter", "border-radius", "clip-path", "background", "transform:"]) {
    ck("aucune retouche « " + interdit + " »", !corps.includes(interdit));
  }
  ck("aucune opacité posée en ligne", !/opacity/.test(corps),
    "put() écrit en !important et bloquerait l'animation");
  ck("deux calques", (corps.match(/document\.createElement\("img"\)/g) || []).length === 2);
  ck("les deux calques sont le MÊME fichier",
    (corps.match(/\.src = src;/g) || []).length === 2 && /const src = sombre \?/.test(corps));
  ck("bornes du O mesurées sur le master",
    shell.includes('O_GAUCHE = "52.470588%"') && shell.includes('O_DROITE = "67.764706%"'));
  ck("origine de l'impulsion au centre optique",
    shell.includes('O_CENTRE = "60.117647% 45.666667%"'));
  ck("le mot est privé de son O, le O seul est reposé",
    shell.includes('MASQUE_MOT = "linear-gradient(to right, #000 0 "')
    && shell.includes('MASQUE_O = "linear-gradient(to right, transparent 0 "'));
}

console.log("\n-- le Dépôt se joue une fois, au succès réel --");
{
  ck("un seul point de déclenchement", (ecrans.match(/jouerDepot\(\)/g) || []).length === 1);
  const i = ecrans.indexOf("jouerDepot()");
  const j = ecrans.indexOf('invoke("ho_new_document"');
  ck("après la réussite de ho_new_document", j > 0 && i > j);
  ck("jamais sur un retour de focus",
    !/(visibilitychange|"focus")[\s\S]{0,200}jouerDepot/.test(ecrans));
  ck("l'animation est du CSS, pas du JS",
    !/requestAnimationFrame|\.animate\(/.test(shell + ecrans));
  const html = fs.readFileSync(path.join(ici, "../index.html"), "utf8");
  ck("les images-clés sont dans la feuille de l'application", /@keyframes ho-depot/.test(html));
  ck("le O ne grandit jamais au-delà de sa place",
    !/@keyframes ho-depot[\s\S]*?scale\(1\.\d/.test(html));
  ck("prefers-reduced-motion neutralise tout",
    /@media \(prefers-reduced-motion: reduce\)/.test(html)
    && /animation: none !important/.test(html));
}

console.log(`\n  ${ok} réussis · ${ko} échoués  =>  BRAND_ASSETS = ${ko === 0 ? "PASS" : "FAIL"}\n`);
process.exit(ko === 0 ? 0 : 1);
