// Banc AUTHENTIFICATION DU SHELL — le bloc compte est EXTRAIT de ho_desktop.js et exécuté
// tel quel. Le banc ne peut donc pas diverger du produit sans qu'un contrôle tombe.
//
// Aucun réseau, aucune base, aucun Tauri : le client Supabase, listen() et invoke() sont
// simulés, et l'on observe ce que le code APPELLE.

import fs from "node:fs";
import path from "node:path";

const ici = path.dirname(new URL(import.meta.url).pathname);
const SRC = fs.readFileSync(path.join(ici, "../src/ho_desktop.js"), "utf8");
const { CATALOGUE } = await import(path.join(ici, "../src/ho_i18n.js"));

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };

// ---------------------------------------------------------------- DOM minimal
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
  const tous = (n, acc = []) => { acc.push(n); for (const c of n.children) tous(c, acc); return acc; };
  return { noeud, tous };
}

// ---------------------------------------------------------------- extraction du vrai code
const DEBUT = SRC.indexOf("async function sessionCourante()");
const FIN = SRC.indexOf("const frenchDate = (d) =>");
if (DEBUT < 0 || FIN < 0) { console.error("  extraction impossible"); process.exit(1); }
const BLOC = SRC.slice(DEBUT, FIN);
ck("la redirection est fixée à la compilation, défaut production",
  /const REDIRECTION = import\.meta\.env\.VITE_HO_REDIRECT \|\| "humanorigin:\/\/login";/.test(SRC));
ck("aucune redirection lisible à l'exécution",
  !/REDIRECTION\s*=\s*[^;]*(localStorage|config|JSON\.parse)/.test(SRC));
ck("le bloc compte est extrait du fichier de production",
  /async function renderAccount/.test(BLOC) && /async function brancherLiens/.test(BLOC)
  && /function jetonsDuLien/.test(BLOC));

function charger(faux) {
  const { noeud } = faireDOM();
  const document = { createElement: noeud, body: noeud("body") };
  const el = (tag, decls, text) => { const n = noeud(tag); if (text !== undefined) n.textContent = text; return n; };
  const put = () => {};
  const mkButton = (label) => { const b = noeud("button"); b.textContent = label; return b; };
  const secondaryButton = (label) => { const b = noeud("button"); b.textContent = label; return b; };
  const say = (n, texte) => { n.textContent = texte || ""; };
  const t = (k) => CATALOGUE.fr[k] ?? k;
  const f = new Function("document", "el", "put", "mkButton", "secondaryButton", "say", "t",
    "MUTED", "INK", "supabase", "listen", "invoke", "panel", "REDIRECTION",
    BLOC + "\nreturn { renderAccount, brancherLiens, jetonsDuLien, ouvrirSession, sessionCourante, CANAUX };");
  return { m: f(document, el, put, mkButton, secondaryButton, say, t, "#565E69", "#1A1E24",
                faux.supabase, faux.listen, faux.invoke, faux.panel, "humanorigin://login"), noeud };
}

function fauxClient(session = null) {
  const journal = [];
  return {
    journal,
    supabase: { auth: {
      getSession: async () => ({ data: { session } }),
      signInWithOtp: async (a) => { journal.push(["signInWithOtp", a]); return { error: null }; },
      setSession: async (a) => { journal.push(["setSession", a]); return { error: null }; },
      signOut: async () => { journal.push(["signOut"]); session = null; return { error: null }; },
    } },
    listen: async (c) => { journal.push(["listen", c]); },
    invoke: async (c) => { journal.push(["invoke", c]); return null; },
    panel: async () => { journal.push(["panel"]); },
  };
}
const textes = (n) => { const { tous } = faireDOM(); return tous(n).map((x) => x.textContent).join(" | "); };
const trouver = (n, tag) => { const { tous } = faireDOM(); return tous(n).filter((x) => x.tagName === tag); };

console.log("\n── déconnecté : le contrôle de connexion est là ──");
{
  const f = fauxClient(null); const { m, noeud } = charger(f);
  const box = noeud("div");
  await m.renderAccount(box, null);
  const champs = trouver(box, "INPUT"), boutons = trouver(box, "BUTTON");
  ck("un champ d'adresse est présent", champs.length === 1 && champs[0].type === "email");
  ck("un bouton d'envoi est présent", boutons.length === 1, boutons[0]?.textContent);
  ck("le bouton porte le libellé attendu", boutons[0]?.textContent === CATALOGUE.fr["account.sendLink"]);
  ck("l'invite explique pourquoi se connecter",
    textes(box).includes(CATALOGUE.fr["account.signedOutHint"]));

  console.log("\n── clic : le flux Supabase EXISTANT est appelé ──");
  champs[0].value = "essai@exemple.fr";
  await boutons[0].click();
  const appel = f.journal.find((e) => e[0] === "signInWithOtp");
  ck("signInWithOtp appelé", !!appel);
  ck("avec l'adresse saisie", appel?.[1]?.email === "essai@exemple.fr");
  ck("avec emailRedirectTo humanorigin://login",
    appel?.[1]?.options?.emailRedirectTo === "humanorigin://login", appel?.[1]?.options?.emailRedirectTo);
  ck("aucun autre mécanisme d'authentification employé",
    !f.journal.some((e) => !["signInWithOtp", "listen", "invoke"].includes(e[0])));

  console.log("\n── état « lien envoyé » ──");
  ck("l'état de confirmation est rendu", textes(box).includes(CATALOGUE.fr["account.linkSent"]));
  ck("l'adresse n'est plus affichée", trouver(box, "INPUT").length === 0);
  ck("aucun écran supplémentaire : le bloc reste unique", box.children.length === 1);

  console.log("\n── adresse vide ──");
  const f2 = fauxClient(null); const c2 = charger(f2);
  const box2 = c2.noeud("div");
  await c2.m.renderAccount(box2, null);
  await trouver(box2, "BUTTON")[0].click();
  ck("aucune requête sans adresse", !f2.journal.some((e) => e[0] === "signInWithOtp"));
  ck("un message le dit", textes(box2).includes(CATALOGUE.fr["account.emailRequired"]));
}

console.log("\n── connecté : état visible, message rouge disparu ──");
{
  const session = { user: { email: "essai@exemple.fr" } };
  const f = fauxClient(session); const { m, noeud } = charger(f);
  const box = noeud("div");
  await m.renderAccount(box, session);
  ck("l'adresse du compte est affichée", textes(box).includes("essai@exemple.fr"));
  ck("l'invite de connexion a disparu",
    !textes(box).includes(CATALOGUE.fr["account.signedOutHint"]));
  ck("aucun champ d'adresse", trouver(box, "INPUT").length === 0);
  const out = trouver(box, "BUTTON");
  ck("un bouton de déconnexion est présent",
    out.length === 1 && out[0].textContent === CATALOGUE.fr["account.signOut"]);

  console.log("\n── déconnexion ──");
  await out[0].click();
  ck("signOut appelé", f.journal.some((e) => e[0] === "signOut"));
  ck("retour à l'état déconnecté", trouver(box, "INPUT").length === 1);
}

console.log("\n── session existante au démarrage ──");
{
  const session = { user: { email: "deja@exemple.fr" } };
  const f = fauxClient(session); const { m, noeud } = charger(f);
  const s = await m.sessionCourante();
  ck("la session est relue du client", s === session);
  const box = noeud("div");
  await m.renderAccount(box, s);
  ck("l'interface connectée est rendue sans action", textes(box).includes("deja@exemple.fr"));
}

console.log("\n── retour de lien profond ──");
{
  const f = fauxClient(null); const { m } = charger(f);
  const bon = "humanorigin://login#access_token=AAA&refresh_token=BBB&type=magiclink";
  ck("les deux jetons sont extraits", JSON.stringify(m.jetonsDuLien(bon))
    === JSON.stringify({ access_token: "AAA", refresh_token: "BBB" }));
  ck("setSession appelé sur un lien valide", (await m.ouvrirSession(bon)) === true
    && f.journal.some((e) => e[0] === "setSession"));

  console.log("\n  -- CONTRÔLES NÉGATIFS : aucun faux état connecté --");
  const f2 = fauxClient(null); const m2 = charger(f2).m;
  for (const [lib, url] of [
    ["aucun jeton", "humanorigin://login"],
    ["access_token seul", "humanorigin://login#access_token=AAA"],
    ["refresh_token seul", "humanorigin://login#refresh_token=BBB"],
    ["jetons vides", "humanorigin://login#access_token=&refresh_token="],
    ["erreur du serveur", "humanorigin://login#error=access_denied&error_description=expired"],
    ["code PKCE seul", "humanorigin://login?code=abc123"],
    ["URL illisible", "pas une url"],
    // Le cas pour lequel le garde sur « error » existe : des jetons PRÉSENTS, accompagnés
    // d'une erreur. Sans ce garde, le contrôle de jetons laisserait passer.
    ["erreur ET jetons", "humanorigin://login#error=access_denied&access_token=AAA&refresh_token=BBB"],
    ["description d'erreur ET jetons",
     "humanorigin://login#error_description=expired&access_token=AAA&refresh_token=BBB"],
  ]) {
    ck(`${lib} → refusé`, m2.jetonsDuLien(url) === null);
    ck(`${lib} → aucune ouverture de session`, (await m2.ouvrirSession(url)) === false);
  }
  ck("aucun setSession n'a été tenté sur ces liens",
    !f2.journal.some((e) => e[0] === "setSession"));

  const f3 = fauxClient(null);
  f3.supabase.auth.setSession = async () => ({ error: { message: "refusé" } });
  const m3 = charger(f3).m;
  ck("un setSession refusé par le serveur ne connecte pas",
    (await m3.ouvrirSession(bon)) === false);
}

console.log("\n── branchement des canaux natifs ──");
{
  const f = fauxClient(null); const { m } = charger(f);
  await m.brancherLiens(async () => {});
  const ecoutes = f.journal.filter((e) => e[0] === "listen").map((e) => e[1]);
  for (const c of ["tauri://open-url", "scheme-request", "scheme-request-received", "deep-link://open-url"])
    ck(`canal écouté : ${c}`, ecoutes.includes(c));
  ck("take_pending_deep_link consulté",
    f.journal.some((e) => e[0] === "invoke" && e[1] === "take_pending_deep_link"));
  ck("les canaux sont ceux de main.js, et rien de plus", ecoutes.length === 4, String(ecoutes.length));
}

console.log(`\n  ${ok} réussis · ${ko} échoués  →  DESKTOP_AUTH = ${ko ? "FAIL" : "PASS"}`);
process.exit(ko ? 1 : 0);
