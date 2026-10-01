// Banc des symboles libres du frontend natif.
//
// Vite assemble sans jamais vérifier qu'un identifiant est défini : un token importé par
// oubli passe le build et ne tombe qu'à l'exécution. Le 2026-09-28, `BLUE` était exporté
// par ho_ui.js sans être importé par ho_desktop.js ; l'application se lançait puis
// affichait « can't find variable: BLUE » avant d'avoir rien rendu.
//
// Ce banc lit chaque module, recense ce qu'il déclare et ce qu'il importe, puis signale
// tout identifiant employé qui ne vient ni de l'un, ni de l'autre, ni des globales connues.
//
//   node tests/frontend_symbols.mjs
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ici = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ici, "../src");
const MODULES = ["ho_desktop.js", "ho_ui.js", "ho_i18n.js", "ho_reserve.js", "ho_onboarding.js"]
  .filter((f) => fs.existsSync(path.join(SRC, f)));

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };

// Commentaires, chaînes et gabarits retirés : un mot dans une phrase n'est pas un symbole.
function code(src) {
  let out = "", i = 0, n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      i++; out += '""'; continue;
    }
    // Littéral d'expression régulière. Sans cela, `/\\/+$/` livrerait « $ » comme identifiant.
    // Un `/` qui suit un identifiant, un nombre, `)` ou `]` est une division, pas une regex.
    if (c === "/") {
      const avant = out.replace(/\s+$/, "").slice(-1);
      if (!/[\w$)\]]/.test(avant)) {
        i++;
        let classe = false;
        while (i < n) {
          const e = src[i];
          if (e === "\\") { i += 2; continue; }
          if (e === "[") classe = true;
          else if (e === "]") classe = false;
          else if (e === "/" && !classe) break;
          else if (e === "\n") break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/.test(src[i])) i++;   // drapeaux
        out += "/**/"; continue;
      }
    }
    out += c; i++;
  }
  return out;
}

const GLOBALES = new Set([
  "window", "document", "console", "navigator", "location", "localStorage", "sessionStorage",
  "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask",
  "Promise", "Object", "Array", "String", "Number", "Boolean", "Math", "JSON", "Date",
  "Map", "Set", "WeakMap", "WeakSet", "Error", "TypeError", "RangeError", "Symbol",
  "RegExp", "Intl", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "crypto",
  "Uint8Array", "Int8Array", "Uint16Array", "Uint32Array", "Float32Array", "Float64Array",
  "ArrayBuffer", "DataView", "atob", "btoa", "isNaN", "isFinite", "parseInt", "parseFloat",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "structuredClone",
  "Infinity", "NaN", "undefined", "globalThis", "Function", "Proxy", "Reflect", "BigInt",
  "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "CustomEvent", "Event",
  "AbortController", "Blob", "File", "FileReader", "Image", "alert", "confirm", "prompt", "import",
]);

const MOTS_CLES = new Set([
  "const", "let", "var", "function", "class", "return", "if", "else", "for", "while", "do",
  "switch", "case", "default", "break", "continue", "new", "delete", "typeof", "instanceof",
  "in", "of", "this", "super", "null", "true", "false", "void", "throw", "try", "catch",
  "finally", "async", "await", "yield", "export", "import", "from", "as", "extends", "static",
  "get", "set", "with", "debugger",
]);

for (const nom of MODULES) {
  const brut = fs.readFileSync(path.join(SRC, nom), "utf8");
  const src = code(brut);

  // Ce que le module reçoit de l'extérieur.
  const importes = new Set();
  for (const m of brut.matchAll(/import\s+([^;]+?)\s+from\s+/g)) {
    const clause = m[1];
    for (const x of clause.matchAll(/\{([^}]*)\}/g)) {
      for (const p of x[1].split(",")) {
        const n2 = p.trim().split(/\s+as\s+/).pop().trim();
        if (n2) importes.add(n2);
      }
    }
    const defaut = clause.replace(/\{[^}]*\}/g, "").replace(/,/g, "").trim();
    if (defaut && /^[A-Za-z_$][\w$]*$/.test(defaut)) importes.add(defaut);
  }

  // Ce que le module déclare lui-même, à n'importe quelle profondeur.
  const declares = new Set();
  const ajoute = (re, g = 1) => { for (const m of src.matchAll(re)) if (m[g]) declares.add(m[g]); };
  ajoute(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
  // Déclarations multiples : `const a = 1, b = 2` — seul `a` serait vu sinon.
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([^;\n]+)/g)) {
    for (const part of m[1].split(",")) {
      const n2 = part.split("=")[0].replace(/[[\]{}.]/g, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n2)) declares.add(n2);
    }
  }
  ajoute(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g);
  ajoute(/\bclass\s+([A-Za-z_$][\w$]*)/g);
  ajoute(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g);
  // Déstructurations et paramètres : on recense large, quitte à être indulgent.
  for (const m of src.matchAll(/(?:const|let|var)\s*[[{]([^\]}]*)[\]}]/g))
    for (const p of m[1].split(",")) {
      const n2 = p.split(":").pop().split("=")[0].replace(/\.\.\./, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n2)) declares.add(n2);
    }
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g))
    for (const p of m[1].split(",")) {
      const n2 = p.split("=")[0].replace(/[[\]{}.]/g, "").replace(/\.\.\./, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n2)) declares.add(n2);
    }
  for (const m of src.matchAll(/function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g))
    for (const p of m[1].split(",")) {
      const n2 = p.split("=")[0].replace(/[[\]{}.]/g, "").replace(/\.\.\./, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n2)) declares.add(n2);
    }
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) declares.add(m[1]);

  // Les usages : on écarte ce qui suit un point, ce qui précède deux-points — donc les
  // propriétés et les clés d'objet — et les mots-clés du langage.
  const libres = new Set();
  const sansProprietes = src.replace(/\?\.\s*[A-Za-z_$][\w$]*/g, "")
                            .replace(/\.\s*[A-Za-z_$][\w$]*/g, "");
  for (const m of sansProprietes.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*(:)?/g)) {
    const id = m[2];
    if (m[3] === ":") continue;              // clé d'objet ou libellé
    if (MOTS_CLES.has(id) || GLOBALES.has(id)) continue;
    if (declares.has(id) || importes.has(id)) continue;
    libres.add(id);
  }

  ck(nom + " : aucun symbole libre", libres.size === 0,
    libres.size ? [...libres].sort().join(", ") : "");
}

console.log(`\n  ${ok} réussis · ${ko} échoués  =>  FRONTEND_SYMBOLS = ${ko === 0 ? "PASS" : "FAIL"}\n`);
process.exit(ko === 0 ? 0 : 1);
