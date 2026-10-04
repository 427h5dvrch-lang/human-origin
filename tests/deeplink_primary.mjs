// Banc LIEN PROFOND — INSTANCE PRIMAIRE.  Blocker B1 du Pass 1 Windows.
//
// Observation réelle : HumanOrigin est ouvert, un second processus reçoit le lien
// d'authentification, se termine normalement en ~200 ms avec le code 0, et l'instance
// primaire ne traite jamais le lien. Le rappel d'authentification est perdu.
//
// Ce que ce banc vérifie, et que `desktop_auth.mjs` ne pouvait pas voir : celui-là appelle
// `brancherLiens()` LUI-MÊME, donc il prouve que la fonction marche — jamais que quelque
// chose l'appelle. Le défaut était exactement là.
//
// Trois niveaux, du plus structurel au plus comportemental :
//   1. le câblage : la réception est-elle atteignable depuis l'amorçage réel ;
//   2. le comportement : un lien reçu arrive-t-il UNE SEULE FOIS jusqu'à setSession ;
//   3. le natif : la mise de côté est-elle réellement récupérable.
//
//   node tests/deeplink_primary.mjs
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ici = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(ici, "../src/ho_desktop.js"), "utf8");
const RUST = fs.readFileSync(path.join(ici, "../src-tauri/src/main.rs"), "utf8");
const HTML = fs.readFileSync(path.join(ici, "../index.html"), "utf8");
const { CATALOGUE } = await import(path.join(ici, "../src/ho_i18n.js"));

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };

// ---------------------------------------------------------------- outillage statique
/** Retire commentaires et chaînes : une mention en commentaire n'est pas un appel. */
function codeSeul(src) {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { const f = src.indexOf("*/", i + 2); i = f < 0 ? src.length : f + 2; continue; }
    // Littéral d'expression régulière. Sans ce cas, « /^a:\/\// » passe pour un commentaire,
    // la fin de ligne disparaît avec ses accolades, et le graphe d'appels devient faux.
    if (c === "/" && /[=(,:[!&|?{};\n]\s*$/.test(out)) {
      let j = i + 1, classe = false;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") classe = true;
        else if (src[j] === "]") classe = false;
        else if (src[j] === "/" && !classe) break;
        else if (src[j] === "\n") break;
        j++;
      }
      out += " "; i = j + 1; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === c) break; j++; }
      out += " "; i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

/** Corps de chaque fonction nommée, par appariement d'accolades. */
function definitions(code) {
  const defs = new Map();
  for (const m of code.matchAll(/(?:^|[\n;}])\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const i = code.indexOf("{", m.index + m[0].length - 1);
    if (i < 0) continue;
    let p = 0, j = i;
    for (; j < code.length; j++) {
      if (code[j] === "{") p++;
      else if (code[j] === "}") { p--; if (p === 0) break; }
    }
    defs.set(m[1], code.slice(i, j + 1));
  }
  return defs;
}

const CODE = codeSeul(SRC);
const DEFS = definitions(CODE);

/** L'amorçage réel : l'expression immédiatement invoquée en fin de fichier. */
const iAmorce = CODE.lastIndexOf("(async () =>");
const AMORCE = iAmorce < 0 ? "" : CODE.slice(iAmorce);

/** Noms atteignables depuis l'amorçage, en suivant les références d'identifiants. */
function atteignables(depart) {
  const vus = new Set();
  const file = [];
  const refs = (corps) => [...DEFS.keys()].filter((n) => new RegExp(`\\b${n}\\b`).test(corps));
  for (const n of refs(depart)) file.push(n);
  while (file.length) {
    const n = file.shift();
    if (vus.has(n)) continue;
    vus.add(n);
    for (const m of refs(DEFS.get(n) || "")) if (!vus.has(m)) file.push(m);
  }
  return vus;
}

console.log("\n── 1 · le câblage : la réception est-elle atteignable depuis l'amorçage ──");
{
  ck("le point d'entrée réel est ho_desktop.js", /src="\/src\/ho_desktop\.js"/.test(HTML));
  ck("main.js n'est plus chargé par index.html", !/src="\/src\/main\.js"/.test(HTML));
  ck("l'amorçage est trouvé", AMORCE.length > 0 && /router\(\)/.test(AMORCE));
  ck("brancherLiens est défini", DEFS.has("brancherLiens"));

  const joignables = atteignables(AMORCE);

  // LE contrôle de B1. Sans lui, rien n'écoute le retour d'authentification, et la preuve
  // que `brancherLiens` fonctionne ne vaut rien : personne ne l'appelle.
  ck("la réception des liens est atteignable depuis l'amorçage",
    joignables.has("brancherLiens"),
    joignables.has("brancherLiens") ? "" : "brancherLiens n'est atteint par aucun chemin");

  // Contrôle non ambigu, insensible à l'appariement d'accolades : l'amorçage lui-même, ou
  // une fonction qu'il atteint en un saut, doit nommer la réception.
  const premiers = [...DEFS.keys()].filter((n) => new RegExp(`\\b${n}\\b`).test(AMORCE));
  const directement = /\bbrancherLiens\b/.test(AMORCE)
    || premiers.some((n) => /\bbrancherLiens\b/.test(DEFS.get(n) || ""));
  ck("l'amorçage branche la réception sans détour", directement);

  // Et la réception ne doit plus dépendre d'un écran mort.
  const appelants = [...DEFS.entries()]
    .filter(([n, c]) => n !== "brancherLiens" && /\bbrancherLiens\s*\(/.test(c)).map(([n]) => n);
  const vivants = appelants.filter((n) => joignables.has(n));
  ck("la réception a au moins un appelant vivant",
    vivants.length > 0 || /\bbrancherLiens\s*\(/.test(AMORCE),
    appelants.length ? `appelants: ${appelants.join(", ")}` : "aucun appelant");
  const mortes = appelants.filter((n) => !joignables.has(n));
  if (mortes.length) console.log(`  · appelants morts, sans effet : ${mortes.join(", ")}`);
}

console.log("\n── 2 · le comportement : le lien arrive UNE SEULE FOIS ──");

// Le bloc compte est extrait du produit et exécuté tel quel, comme dans desktop_auth.mjs.
const DEBUT = SRC.indexOf("async function sessionCourante()");
const FIN = SRC.indexOf("const frenchDate = (d) =>");
if (DEBUT < 0 || FIN < 0) { console.error("  extraction impossible"); process.exit(1); }
const BLOC = SRC.slice(DEBUT, FIN);

function faireDOM() {
  const noeud = (tag) => ({
    tagName: String(tag).toUpperCase(), children: [], style: { setProperty() {} },
    _text: "", type: "", placeholder: "", value: "", disabled: false, _ecouteurs: {},
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); if (v === "") this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(e, f) { (this._ecouteurs[e] ||= []).push(f); },
    async click() { for (const f of this._ecouteurs.click || []) await f(); },
  });
  return { noeud };
}

/**
 * Pont natif simulé. `emettre` joue ce que fait le Rust quand le second processus a
 * transmis son argv : le plugin remet une CHAÎNE NUE, pas un tableau ni un objet.
 */
function pontNatif({ enAttente = null } = {}) {
  const journal = [];
  const ecouteurs = new Map();
  return {
    journal,
    listen: async (canal, fn) => { journal.push(["listen", canal]); (ecouteurs.get(canal) ?? ecouteurs.set(canal, []).get(canal)).push(fn); },
    invoke: async (cmd) => {
      journal.push(["invoke", cmd]);
      if (cmd === "take_pending_deep_link") { const v = enAttente; enAttente = null; return v; }
      return null;
    },
    emettre: async (canal, payload) => {
      for (const fn of ecouteurs.get(canal) || []) await fn({ payload });
    },
    aEcoute: (canal) => (ecouteurs.get(canal) || []).length > 0,
  };
}

function charger(pont, session = null) {
  const { noeud } = faireDOM();
  const document = { createElement: noeud, body: noeud("body") };
  const el = (tag, decls, text) => { const n = noeud(tag); if (text !== undefined) n.textContent = text; return n; };
  const mkButton = (label) => { const b = noeud("button"); b.textContent = label; return b; };
  const say = (n, texte) => { n.textContent = texte || ""; };
  const t = (k) => CATALOGUE.fr[k] ?? k;
  const supabase = { auth: {
    getSession: async () => ({ data: { session } }),
    signInWithOtp: async (a) => { pont.journal.push(["signInWithOtp", a]); return { error: null }; },
    setSession: async (a) => { pont.journal.push(["setSession", a]); return { error: null }; },
    signOut: async () => { pont.journal.push(["signOut"]); return { error: null }; },
  } };
  const f = new Function("document", "el", "put", "mkButton", "secondaryButton", "say", "t",
    "MUTED", "INK", "supabase", "listen", "invoke", "panel", "REDIRECTION", "router",
    BLOC + "\nreturn { brancherLiens, jetonsDuLien, ouvrirSession };");
  return f(document, el, () => {}, mkButton, mkButton, say, t, "#565E69", "#1A1E24",
           supabase, pont.listen, pont.invoke, async () => {}, "humanorigin://login",
           async () => { pont.journal.push(["router"]); });
}

const URL_AUTH = "humanorigin://login#access_token=AAA&refresh_token=BBB&type=magiclink";
const sessions = (p) => p.journal.filter((e) => e[0] === "setSession");

{
  console.log("\n  -- a · instance primaire ouverte, le second processus transmet l'URL --");
  const pont = pontNatif();
  const m = charger(pont);
  let reprises = 0;
  await m.brancherLiens(async (ok) => { if (ok) reprises++; });
  ck("le canal du natif est écouté", pont.aEcoute("scheme-request"));

  // C'est exactement ce que le Rust émet : serde_json::to_value(&String).
  await pont.emettre("scheme-request", URL_AUTH);
  ck("setSession appelé exactement une fois", sessions(pont).length === 1, String(sessions(pont).length));
  ck("avec les deux jetons du lien",
    sessions(pont)[0]?.[1]?.access_token === "AAA" && sessions(pont)[0]?.[1]?.refresh_token === "BBB");
  ck("la reprise d'interface est déclenchée une fois", reprises === 1, String(reprises));
}

{
  console.log("\n  -- b · démarrage à froid : le lien attendait côté natif --");
  const pont = pontNatif({ enAttente: URL_AUTH });
  const m = charger(pont);
  let reprises = 0;
  await m.brancherLiens(async (ok) => { if (ok) reprises++; });
  ck("la mise de côté est consultée",
    pont.journal.some((e) => e[0] === "invoke" && e[1] === "take_pending_deep_link"));
  ck("setSession appelé exactement une fois", sessions(pont).length === 1, String(sessions(pont).length));
  ck("la reprise d'interface est déclenchée une fois", reprises === 1, String(reprises));
}

{
  console.log("\n  -- c · les DEUX chemins livrent le même lien : une seule fois quand même --");
  const pont = pontNatif({ enAttente: URL_AUTH });
  const m = charger(pont);
  await m.brancherLiens(async () => {});
  await pont.emettre("scheme-request", URL_AUTH);
  ck("setSession n'est pas appelé deux fois", sessions(pont).length === 1, String(sessions(pont).length));
}

{
  console.log("\n  -- d · un second lien, réellement différent, doit passer --");
  const pont = pontNatif();
  const m = charger(pont);
  await m.brancherLiens(async () => {});
  await pont.emettre("scheme-request", URL_AUTH);
  await pont.emettre("scheme-request",
    "humanorigin://login#access_token=CCC&refresh_token=DDD&type=magiclink");
  ck("les deux liens distincts sont honorés", sessions(pont).length === 2, String(sessions(pont).length));
}

{
  console.log("\n  -- e · contrôles négatifs : aucun faux état connecté --");
  const pont = pontNatif();
  const m = charger(pont);
  await m.brancherLiens(async () => {});
  for (const mauvais of ["humanorigin://login", "humanorigin://login#error=access_denied",
                         "pas une url", "", null]) {
    await pont.emettre("scheme-request", mauvais);
  }
  ck("aucun setSession sur un lien sans jetons", sessions(pont).length === 0, String(sessions(pont).length));
}

console.log("\n── 3 · le natif : la mise de côté doit être récupérable ──");
{
  ck("le handler natif remplit la mise de côté",
    /pending_for_deep_link\.lock\(\)/.test(RUST) && /\*guard = Some\(payload/.test(RUST));

  const iFn = RUST.indexOf("fn take_pending_deep_link");
  ck("la commande de récupération existe", iFn > 0);
  const avant = RUST.slice(Math.max(0, iFn - 200), iFn);
  ck("elle n'est pas compilée hors du produit",
    !/cfg\(feature\s*=\s*"legacy"\)/.test(avant),
    /cfg\(feature\s*=\s*"legacy"\)/.test(avant) ? "derrière #[cfg(feature = \"legacy\")]" : "");

  const iH = RUST.indexOf("generate_handler!");
  const liste = iH < 0 ? "" : RUST.slice(iH, RUST.indexOf("])", iH));
  ck("elle est exposée dans generate_handler",
    /\btake_pending_deep_link\b/.test(liste),
    /\btake_pending_deep_link\b/.test(liste) ? "" : "absente de la liste");
}

console.log(`\n  ${ok} réussis · ${ko} échoués  →  DEEPLINK_PRIMARY = ${ko ? "FAIL" : "PASS"}`);
process.exit(ko ? 1 : 0);
