// Banc de parcours client du Desktop HumanOrigin.
//
// Le 2026-10-09, un parcours joué de bout en bout a établi que l'application ne relisait
// JAMAIS la réalité : elle lisait son état une fois, au moment de dessiner, et plus jamais.
// Aucun sondage, aucun écouteur de focus. Or le travail se fait dans Word, donc dehors. On
// créait un document, on le finalisait, on revenait sur la fenêtre — l'écran était identique,
// « Ouverts dans Word » ignorait le document scellé, et l'accueil semblait ne rien savoir.
// L'application n'était pas perdue : elle était figée sur le monde tel qu'il était au dernier
// clic. Deux défauts tenaient avec : `say()` n'écrivait que dans le nœud, donc tout redessin
// effaçait le message ; et `VUE.ecran` restait nul sur les écrans DÉDUITS, donc un redessin
// pouvait redéduire et déplacer l'utilisateur d'écran sans qu'il ait rien demandé.
//
// Ce banc fait tourner le VRAI ho_desktop.js — Tauri et Supabase remplacés par des doublures
// pilotées — et clique comme un client. Il exige : un état mis à jour au retour de Word, sans
// navigation forcée ; un message qui survit au redessin et au changement de langue ; les
// Réglages laissés tranquilles ; aucun écran sans issue ; aucun libellé générique.
//
//   node tests/parcours_client.mjs            (tout)
//   HO_SCENARIO=retour_de_word node tests/parcours_client.mjs   (un seul, détaillé)
//
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ICI, "../src");

// ─────────────────────────────────────────────────────── doublures de plateforme
// Vite remplace `import.meta.env` à la compilation et résout les images ; Node ne connaît ni
// l'un ni l'autre. Les hooks font exactement ces substitutions, et rien de plus : le code de
// l'application n'est pas modifié pour être testé.
const HOOKS = `
const STUBS = {
  "@tauri-apps/api/tauri": 'export const invoke = (...a) => globalThis.__HO.invoke(...a);',
  "@tauri-apps/api/dialog": 'export const open = (...a) => globalThis.__HO.open(...a);',
  "@tauri-apps/api/fs": 'export const readTextFile = (...a) => globalThis.__HO.readTextFile(...a);',
  "@tauri-apps/api/path": 'export const appDataDir = async () => "/tmp/a/"; export const join = async (...p) => p.join("/");',
  "@tauri-apps/api/event": 'export const listen = async (c, h) => { (globalThis.__HO.ecouteurs[c] ||= []).push(h); return () => {}; };',
  "@tauri-apps/api/shell": 'export const open = async (...a) => globalThis.__HO.shellOpen(...a);',
};
export async function resolve(spec, ctx, next) {
  if (STUBS[spec]) return { url: "ho-stub:" + spec, shortCircuit: true, format: "module" };
  if (/\\.(png|svg|css)$/.test(spec)) return { url: "ho-asset:" + spec, shortCircuit: true, format: "module" };
  if (spec.includes("ho_reserve.js")) return { url: "ho-stub:reserve", shortCircuit: true, format: "module" };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.startsWith("ho-stub:")) {
    const k = url.slice(8);
    const src = k === "reserve"
      ? \`export const reserveRecordId = (...a) => globalThis.__HO.reserveRecordId(...a);
         export const supabase = { auth: { getSession: () => globalThis.__HO.getSession(),
           signOut: async () => ({}), setSession: async () => ({}),
           onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };\`
      : STUBS[k];
    return { format: "module", shortCircuit: true, source: src };
  }
  if (url.startsWith("ho-asset:")) return { format: "module", shortCircuit: true, source: 'export default "asset://x";' };
  const r = await next(url, ctx);
  if (/\\.js(\\?|$)/.test(url) && r.source)
    return { ...r, source: String(r.source).replaceAll("import.meta.env", "(globalThis.__VITE_ENV||{})") };
  return r;
}`;

// ─────────────────────────────────────────────────────── DOM minimal
// Exactement les API que ho_desktop / ho_shell / ho_ui emploient. Aucune bibliothèque : un
// banc de parcours qui dépendrait d'un navigateur complet ne serait pas lancé.
class Nd {
  constructor(tag) {
    this.tagName = String(tag || "").toUpperCase();
    this.children = []; this.parentNode = null; this._text = ""; this.attrs = {};
    this.style = { setProperty: (k, v) => { this.attrs["style:" + k] = v; } };
    this.classList = { add() {}, remove() {}, contains: () => false };
    this.listeners = {}; this.disabled = false; this.onclick = null; this.value = "";
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  insertBefore(n, r) { n.parentNode = this; const i = this.children.indexOf(r);
    i < 0 ? this.children.push(n) : this.children.splice(i, 0, n); return n; }
  remove() { const p = this.parentNode; if (!p) return;
    const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); this.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(e, f) { (this.listeners[e] ||= []).push(f); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  /** Ce que l'œil voit : ni le contenu des <svg>, ni les styles. */
  get vu() {
    if (this.tagName === "SVG" || this.tagName === "STYLE") return "";
    return this.children.length ? this.children.map((c) => c.vu).join(" ") : this._text;
  }
  async click() {
    for (const f of this.listeners.click || []) await f({ preventDefault() {} });
    if (this.onclick) await this.onclick({ preventDefault() {} });
  }
}

function installerDom() {
  const d = { documentElement: new Nd("html"), body: new Nd("body"), head: new Nd("head"),
    createElement: (t) => new Nd(t), createElementNS: (_n, t) => new Nd(t),
    createTextNode: (x) => { const n = new Nd("#text"); n.textContent = x; return n; },
    querySelector: () => null, addEventListener() {} };
  const ecoutesFenetre = {};
  globalThis.document = d;
  globalThis.window = { location: { search: "", href: "tauri://localhost" },
    addEventListener: (e, f) => { (ecoutesFenetre[e] ||= []).push(f); },
    matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const faux = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.localStorage = faux; globalThis.window.localStorage = faux;
  try { Object.defineProperty(globalThis, "navigator",
    { value: { language: "fr-FR", languages: ["fr-FR"] }, configurable: true }); } catch (e) {}
  return { d, ecoutesFenetre };
}

// ─────────────────────────────────────────────────────── doublure du natif
function faireBackend(monde) {
  const journal = [];
  return {
    journal, ecouteurs: {}, monde,
    async getSession() { return { data: { session: monde.connecte
      ? { access_token: "j", user: { email: "moi@example.test" } } : null } }; },
    async reserveRecordId() { return { record_id: "HO-" + (++monde.compteur), capability: "cap" }; },
    async readTextFile(chemin) {
      journal.push(["readTextFile", chemin]);
      // `lastProofAt()` lit l'état du finalizer dans un fichier, et non par une commande.
      if (String(chemin).endsWith("finalizer_state.json") && monde.dernierePreuve)
        return JSON.stringify({ done: { "HO-1": monde.dernierePreuve } });
      throw new Error("absent");
    },
    async open() { journal.push(["dialog.open"]); return monde.choixFichier; },
    async shellOpen(u) { journal.push(["shell.open", u]); return true; },
    async invoke(cmd, args) {
      journal.push(["invoke", cmd]);
      switch (cmd) {
        case "take_pending_deep_link": return null;
        case "ho_word_setup_status": return { state: monde.complementInstalle ? "installed" : "absent" };
        case "ho_finalizer_get_folders": return monde.dossiers;
        case "ho_finalizer_status": return { last_proof_at: monde.dernierePreuve };
        case "ho_versionable_documents": return monde.documents;
        case "ho_default_work_folder": return "/d/HumanOrigin";
        case "ho_check_work_folder": return { ok: true };
        case "ho_finalizer_set_folders": monde.dossiers = args.folders; return null;
        case "ho_new_document": {
          const n = "Document HumanOrigin " + (monde.crees.length + 1) + ".docx";
          monde.crees.push(n);
          return { name: n, path: "/d/HumanOrigin/" + n, opened_in_word: monde.wordSOuvre };
        }
        case "ho_version_source_state":
          return { source_matches_predecessor_final_state: monde.sourceIntacte };
        case "ho_new_version":
          return { name: "Document v2.docx", path: "/d/HumanOrigin/Document v2.docx",
                   opened_in_word: monde.wordSOuvre };
        case "ho_open_document":
          if (!monde.ouvertureMarche) throw "Word n'a pas pu ouvrir ce document.";
          return null;
        default: throw "command " + cmd + " not found";
      }
    },
  };
}

const mondeNeuf = (p = {}) => ({ connecte: true, complementInstalle: true,
  dossiers: ["/d/HumanOrigin"], documents: [], crees: [], compteur: 0, dernierePreuve: null,
  wordSOuvre: true, ouvertureMarche: true, sourceIntacte: true, choixFichier: null, ...p });

// ─────────────────────────────────────────────────────── le banc
let graine = 0;
async function demarrer(monde) {
  const { register } = await import("node:module");
  register("data:text/javascript," + encodeURIComponent(HOOKS));
  const { d, ecoutesFenetre } = installerDom();
  const back = faireBackend(monde);
  globalThis.__HO = back;
  // Le module porte un état propre (VUE, branchements) : chaque scénario en veut un neuf.
  await import(pathToFileURL(path.join(SRC, "ho_desktop.js")).href + "?n=" + (++graine));
  const reposer = async (n = 60) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
  await reposer();

  const ecran = () => d.body.vu.replace(/\s+/g, " ").trim();
  const actions = () => {
    const out = [];
    (function w(n) {
      if (n.tagName === "BUTTON" || n.tagName === "A") {
        // Un bouton peut n'avoir qu'une icône : son nom est alors dans `aria-label` ou `title`.
        const l = (n.vu.replace(/\s+/g, " ").trim() || n.getAttribute("aria-label") || n.title || "").trim();
        if (l) out.push({ l, n });
      }
      n.children.forEach(w);
    })(d.body);
    return out;
  };
  const cliquer = async (motif) => {
    const b = actions().find((x) => x.l.toLowerCase().includes(motif.toLowerCase()));
    if (!b) throw new Error(`aucun bouton « ${motif} » ; présents : ${actions().map((x) => x.l).join(" | ")}`);
    await b.n.click(); await reposer(); return b.l;
  };
  // Revenir de Word, par les deux voies qui annoncent le même retour.
  const revenirDeWord = async () => {
    for (const f of ecoutesFenetre.focus || []) await f({});
    for (const f of back.ecouteurs["tauri://focus"] || []) await f({});
    await reposer();
  };
  return { d, back, monde, ecran, actions, cliquer, revenirDeWord, reposer };
}

// ─────────────────────────────────────────────────────── scénarios
const SCENARIOS = {
  /**
   * LE PARCOURS DU TICKET : création → Word → finalisation → retour desktop.
   * L'état doit être à jour, et l'utilisateur ne doit pas avoir changé d'écran.
   */
  async retour_de_word(ck) {
    const b = await demarrer(mondeNeuf());
    ck("au lancement, l'accueil", b.ecran().includes("Créez votre prochain document"));
    ck("aucun document n'est annoncé comme ouvert dans Word",
      !b.ecran().includes("Ouverts dans Word"));

    await b.cliquer("Nouveau document");
    ck("le document est créé et le message le dit",
      b.ecran().includes("Document créé et ouvert dans Word"), b.ecran().slice(0, 60));

    // Hors application : il écrit dans Word, puis FINALISE. Le natif voit un versionnable.
    const nom = b.monde.crees[0];
    b.monde.documents = [{ name: nom, record_id: "HO-1", path: "/d/HumanOrigin/" + nom }];
    b.monde.dernierePreuve = new Date().toISOString();

    await b.revenirDeWord();
    ck("au retour de Word, l'accueil connaît le document finalisé",
      b.ecran().includes("Ouverts dans Word") && b.ecran().includes(nom), b.ecran().slice(0, 90));
    ck("AUCUNE navigation forcée : on est toujours sur l'accueil",
      b.ecran().includes("Créez votre prochain document")
      && !b.ecran().includes("Continuer ce document"));
    ck("le document finalisé est atteignable d'un clic",
      !!b.actions().find((x) => x.l.includes(nom)));
    ck("le message de l'action précédente a survécu au réveil",
      b.ecran().includes("Document créé et ouvert dans Word"));
    ck("la date de dernière preuve n'est plus « aucune »",
      !b.ecran().includes("Aucune pour l’instant"), b.ecran().slice(-70));
  },

  /** Le réveil ne déplace pas depuis un écran déduit qui n'est pas l'accueil. */
  async reveil_ne_deplace_pas(ck) {
    const b = await demarrer(mondeNeuf({ documents:
      [{ name: "Rapport.docx", record_id: "HO-A", path: "/d/Rapport.docx" }] }));
    ck("un seul document finalisé mène à « Continuer ce document ? »",
      b.ecran().includes("Continuer ce document"));
    // Un second document est finalisé pendant qu'il lit cet écran.
    b.monde.documents = [...b.monde.documents,
      { name: "Note.docx", record_id: "HO-B", path: "/d/Note.docx" }];
    await b.revenirDeWord();
    ck("au retour, il est TOUJOURS sur « Continuer ce document ? »",
      b.ecran().includes("Continuer ce document") && !b.ecran().includes("Vos documents HumanOrigin"),
      b.ecran().slice(0, 70));
    ck("et le document affiché est resté le même", b.ecran().includes("Rapport.docx"));
  },

  /** Les Réglages sont exclus : rien n'est relu, rien n'est redessiné sous les doigts. */
  async reglages_exclus(ck) {
    const b = await demarrer(mondeNeuf());
    await b.cliquer("Réglages").catch(async () => {
      // La roue crantée n'a pas de texte : on l'atteint par l'en-tête.
      const roue = b.actions().find((x) => !x.l || x.l.length < 3);
      if (roue) { await roue.n.click(); await b.reposer(); }
    });
    const avant = b.back.journal.length;
    const dessin = b.ecran();
    await b.revenirDeWord();
    ck("sur les Réglages, le réveil ne relit rien",
      b.back.journal.length === avant, `${avant} → ${b.back.journal.length}`);
    ck("et ne redessine pas l'écran", b.ecran() === dessin);
  },

  /** Le message survit au changement de langue. */
  async message_survit_a_la_langue(ck) {
    const b = await demarrer(mondeNeuf());
    await b.cliquer("Nouveau document");
    ck("message affiché", b.ecran().includes("Document créé et ouvert dans Word"));
    const i18n = await import(pathToFileURL(path.join(SRC, "ho_i18n.js")).href);
    i18n.setLangue("en");
    await b.reposer();
    ck("après bascule en anglais, l'écran est en anglais",
      b.ecran().includes("Create your next"), b.ecran().slice(0, 60));
    // Le message reste dans la langue où il a été produit : il est retenu rendu, pas en clé.
    // Le faire disparaître serait pire — l'application n'aurait plus répondu à l'action.
    ck("et le message est toujours affiché",
      b.ecran().includes("Document créé et ouvert dans Word"), b.ecran().slice(-120));
    i18n.setLangue("fr");
  },

  /** Aucun écran n'est un cul-de-sac, et aucun libellé n'est générique. */
  async aucun_cul_de_sac(ck) {
    const GENERIQUE = /^(annuler|cancel|ok|retour)$/i;
    const visites = [];
    const voir = (b, nom) => {
      const a = b.actions();
      visites.push(nom);
      ck(`« ${nom} » offre au moins une action`, a.length > 0,
        a.map((x) => x.l).join(" | ") || "AUCUNE");
      const g = a.find((x) => GENERIQUE.test(x.l));
      ck(`« ${nom} » n'a aucun libellé générique`, !g, g ? g.l : "");
    };

    let b = await demarrer(mondeNeuf({ connecte: false, complementInstalle: false, dossiers: [] }));
    voir(b, "première utilisation");

    b = await demarrer(mondeNeuf({ complementInstalle: false }));
    voir(b, "complément absent");

    b = await demarrer(mondeNeuf());
    voir(b, "accueil");

    b = await demarrer(mondeNeuf({ documents: [{ name: "R.docx", record_id: "A", path: "/d/R.docx" }] }));
    voir(b, "continuer ce document");
    await b.cliquer("Ouvrir un autre document");
    voir(b, "sélecteur de documents");

    b = await demarrer(mondeNeuf({ documents: [{ name: "R.docx", record_id: "A", path: "/d/R.docx" }] }));
    await b.cliquer("Créer une nouvelle version");
    voir(b, "nouvelle version prête");
    b.monde.ouvertureMarche = false;
    await b.cliquer("Ouvrir dans Word");
    ck("un échec d'ouverture Word s'affiche sans bloquer la sortie",
      /n'a pas pu ouvrir/i.test(b.ecran()) && !!b.actions().find((x) => /accueil/i.test(x.l)));

    b = await demarrer(mondeNeuf({ sourceIntacte: false,
      documents: [{ name: "R.docx", record_id: "A", path: "/d/R.docx" }] }));
    await b.cliquer("Créer une nouvelle version");
    ck("source modifiée : l'écran d'avertissement s'affiche",
      b.ecran().includes("Ce document a changé"));
    voir(b, "source modifiée");
    ck("et sa sortie nomme sa destination",
      !!b.actions().find((x) => /retour à l’accueil|retour à l'accueil/i.test(x.l)),
      b.actions().map((x) => x.l).join(" | "));
  },
};

// ─────────────────────────────────────────────────────── exécution
// Chaque scénario tourne dans son propre processus : les modules de l'application portent un
// état global, et deux scénarios dans le même processus se marcheraient dessus.
const voulu = process.env.HO_SCENARIO;
if (voulu) {
  if (!SCENARIOS[voulu]) { console.error(`scénario inconnu : ${voulu}`); process.exit(2); }
  let ok = 0, ko = 0;
  const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };
  try { await SCENARIOS[voulu](ck); }
  catch (e) { ko++; console.log(`  ✗ ${voulu} a levé  → ${e && (e.message || e)}`); }
  console.log(`__BILAN__ ${ok} ${ko}`);
  process.exit(ko ? 1 : 0);
} else {
  let ok = 0, ko = 0;
  for (const nom of Object.keys(SCENARIOS)) {
    console.log(`\n${nom}`);
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)],
      { env: { ...process.env, HO_SCENARIO: nom }, encoding: "utf8" });
    const sortie = (r.stdout || "") + (r.stderr || "");
    const bilan = /__BILAN__ (\d+) (\d+)/.exec(sortie);
    process.stdout.write(sortie.replace(/__BILAN__.*\n?/, ""));
    if (bilan) { ok += +bilan[1]; ko += +bilan[2]; }
    else { ko++; console.log("  ✗ le scénario n'a pas rendu de bilan"); }
  }
  console.log(`\nParcours client : ${ok} vérifications passées, ${ko} échouées.`);
  process.exit(ko ? 1 : 0);
}
