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

const ici = path.dirname(new URL(import.meta.url).pathname);
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
ck("l'asset n'est lu qu'à cet endroit",
  (shell.match(/EMPREINTE_MARINE/g) || []).length === 2,
  String((shell.match(/EMPREINTE_MARINE/g) || []).length));
// Les écrans n'ont AUCUN accès direct à l'asset : ils passent par le composant.
const ecrans = fs.readFileSync(path.join(SRC, "ho_desktop.js"), "utf8");
ck("les écrans ne touchent pas l'asset", !/EMPREINTE_MARINE|brand\//.test(ecrans));
ck("les écrans passent par le composant", /HumanOriginBrandMark\(/.test(ecrans));

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

console.log("\n-- seule la taille varie --");
{
  const d = shell.indexOf("function HumanOriginBrandMark(");
  const corps = shell.slice(d, shell.indexOf("\n}", d));
  ck("hauteur paramétrée", /height: taille/.test(corps));
  ck("largeur laissée au ratio de l'asset", /width: "auto"/.test(corps));
  for (const interdit of ["filter", "border-radius", "clip-path", "background", "transform"]) {
    ck("aucune retouche « " + interdit + " »", !new RegExp(interdit).test(corps));
  }
}

console.log(`\n  ${ok} réussis · ${ko} échoués  =>  BRAND_ASSETS = ${ko === 0 ? "PASS" : "FAIL"}\n`);
process.exit(ko === 0 ? 0 : 1);
