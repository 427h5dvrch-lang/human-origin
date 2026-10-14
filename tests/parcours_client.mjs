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
        case "ho_word_setup_status": return { state: monde.etatWord
          || (monde.complementInstalle ? "installed" : "absent") };
        // Mise à niveau automatique de l'intégration Word. Le natif décide ; l'interface ne
        // redécide rien. Ici on rejoue les deux issues qui comptent.
        case "ho_word_setup_autoupgrade": {
          const etat = monde.etatWord || (monde.complementInstalle ? "installed" : "absent");
          if (etat === "outdated" && !monde.wordOuvert) {
            monde.etatWord = "installed"; monde.complementInstalle = true;
            return { state: "installed", upgraded: true, deferred_word_open: false };
          }
          return { state: etat, upgraded: false, deferred_word_open: etat === "outdated" && !!monde.wordOuvert };
        }
        // Pose explicite de l'intégration. Elle réussit : ce qui est mesuré ici, c'est ce
        // que l'interface fait APRÈS la réussite.
        case "ho_word_setup_install":
          monde.etatWord = "installed"; monde.complementInstalle = true;
          return { state: "installed" };
        case "ho_finalizer_get_folders": return monde.dossiers;
        // L'incident porte une cause TYPÉE, et `last_deposit` n'existe qu'après un dépôt
        // réel : l'écran se décide là-dessus, jamais sur une inférence.
        case "ho_finalizer_status": return {
          folders: monde.dossiers.length, active: !!monde.dossiers.length,
          incident: monde.incident, last_deposit: monde.dernierDepot,
          last_proof_at: monde.dernierePreuve };
        case "ho_versionable_documents": return monde.documents;
        // Documents DÉTECTÉS : cinq au plus, et chacun dit s'il est ouvert dans Word ou non.
        // Le natif plafonne ; le double le fait aussi pour que le banc voie la même chose.
        case "ho_recent_documents":
          return monde.documents.slice(0, 5).map((d) => ({
            record_id: d.record_id, name: d.name, open_in_word: d.open_in_word !== false }));
        // Les trois accès passent par l'IDENTIFIANT : aucun chemin ne traverse l'interface.
        case "ho_open_document_by_record":
          journal.push(["ouvre", args.recordId]);
          if (!monde.ouvertureMarche) throw "Ce document n'a pas pu être ouvert.";
          return null;
        case "ho_open_folder_by_record":
          journal.push(["dossier", args.recordId]); return null;
        case "ho_copy_verification_link":
          journal.push(["copie", args.recordId]);
          if (monde.copieMarche === false) throw "Le lien n'a pas pu être copié.";
          return null;
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
  wordSOuvre: true, ouvertureMarche: true, sourceIntacte: true, choixFichier: null,
  incident: null, dernierDepot: null, copieMarche: true, ...p });

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
      !b.ecran().includes("récents détectés"));

    await b.cliquer("Nouveau document");
    ck("le document est créé et le message le dit",
      b.ecran().includes("Document créé et ouvert dans Word"), b.ecran().slice(0, 60));

    // Hors application : il écrit dans Word, puis FINALISE. Le natif voit un versionnable.
    const nom = b.monde.crees[0];
    b.monde.documents = [{ name: nom, record_id: "HO-1", path: "/d/HumanOrigin/" + nom }];
    b.monde.dernierePreuve = new Date().toISOString();

    await b.revenirDeWord();
    ck("au retour de Word, l'accueil connaît le document finalisé",
      b.ecran().includes("récents détectés") && b.ecran().includes(nom), b.ecran().slice(0, 90));
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

  /**
   * Mise à niveau de l'intégration Word après une mise à jour de l'application.
   *
   * Mesuré physiquement le 2026-10-12 : l'ancien manifeste restait actif tant que
   * l'utilisateur n'avait pas cliqué. Or il porte le bouton de ruban qui faisait échouer W4,
   * donc le correctif était livré mais inopérant. Un correctif qui attend un clic n'est pas
   * livré, et c'est ce que ce scénario empêche de revenir.
   */
  async mise_a_niveau_word(ck) {
    // Word fermé : la mise à niveau se fait seule, et l'utilisateur ne voit jamais l'écran.
    let b = await demarrer(mondeNeuf({ etatWord: "outdated", wordOuvert: false }));
    ck("Word fermé : aucun écran d'installation, on arrive sur l'accueil",
      b.ecran().includes("Créez votre prochain document"), b.ecran().slice(0, 70));
    ck("la mise à niveau a bien été demandée au natif",
      b.back.journal.some((l) => l[1] === "ho_word_setup_autoupgrade"));
    ck("aucun bouton « Mettre à jour » n'est présenté",
      !b.actions().some((x) => /mettre à jour|installer dans word/i.test(x.l)),
      b.actions().map((x) => x.l).join(" | "));

    // Word ouvert : on ne touche à rien, et on dit la seule chose à faire.
    b = await demarrer(mondeNeuf({ etatWord: "outdated", wordOuvert: true }));
    ck("Word ouvert : la mise à niveau est différée, pas forcée",
      b.ecran().includes("Fermez Word pour terminer"), b.ecran().slice(0, 90));
    ck("et l'écran reste une sortie, pas un cul-de-sac", b.actions().length > 0,
      b.actions().map((x) => x.l).join(" | "));
  },

  /**
   * Le message de progression s'efface quand l'action réussit.
   *
   * `say` mémorise son texte dans VUE pour qu'un redraw ne l'escamote pas — c'est voulu, et
   * c'est ce qui rendait « Installation… » persistant : la réussite redessinait l'écran Prêt
   * et le message y réapparaissait, jusqu'au prochain lancement de l'application.
   */
  async le_message_d_installation_s_effface(ck) {
    const b = await demarrer(mondeNeuf({ complementInstalle: false, etatWord: "absent" }));
    ck("sans intégration, l'écran d'installation s'affiche",
      /installer dans word/i.test(b.actions().map((x) => x.l).join(" ")),
      b.actions().map((x) => x.l).join(" | "));

    await b.cliquer("Installer dans Word");
    ck("après la réussite, on est bien sur l'accueil",
      b.ecran().includes("Créez votre prochain document"), b.ecran().slice(0, 70));
    ck("et le message « Installation… » a disparu",
      !b.ecran().includes("Installation…"), b.ecran().slice(0, 120));

    // Et il ne revient pas au premier redraw : c'est là qu'il réapparaissait.
    await b.revenirDeWord();
    ck("il ne revient pas au redraw suivant",
      !b.ecran().includes("Installation…"), b.ecran().slice(0, 120));
  },

  /**
   * FINALISATION BLOQUÉE PAR WORD — attendre n'est pas échouer.
   *
   * Mesuré physiquement sur Windows le 2026-10-13 : finaliser pendant que Word tient le DOCX
   * rend `scrub_retry_pending` / `remplacement` / `os_error` 5. Windows refuse de remplacer un
   * fichier ouvert ailleurs ; le retrait fonctionne, et le balayage termine seul dès que Word
   * relâche. L'utilisateur a UNE chose à faire, et l'écran doit le dire.
   */
  async finalisation_bloquee_par_word(ck) {
    const VERROU = { cause: "scrub_retry_pending", document: "R.docx",
                     detail: { etape: "remplacement", os_error: 5 } };

    // 1. Fichier tenu par Word : une attente explicite.
    let b = await demarrer(mondeNeuf({ incident: VERROU }));
    ck("Word encore ouvert : on demande de fermer l'APPLICATION Word",
      b.ecran().includes("Fermez Microsoft Word"), b.ecran().slice(0, 95));
    ck("et pas seulement le document — fermer le document ne suffit pas",
      !b.ecran().includes("Fermez ce document"), b.ecran().slice(0, 95));
    ck("et on annonce que la suite se fera seule",
      b.ecran().includes("terminera automatiquement"));
    ck("le document concerné est nommé", b.ecran().includes("R.docx"));
    ck("ce n'est pas présenté comme une impossibilité",
      !/impossible/i.test(b.ecran()), b.ecran().slice(0, 95));
    ck("et aucun succès n'est annoncé pendant l'attente",
      !b.ecran().includes("Preuve créée"));

    // 2. Word relâche le document : le dépôt a lieu, l'écran passe au succès de lui-même.
    b.monde.incident = null;
    b.monde.dernierDepot = { record_id: "A", document: "R.docx", at: new Date().toISOString() };
    await b.revenirDeWord();
    ck("Word refermé : l'état devient « Preuve créée »",
      b.ecran().includes("Preuve créée"), b.ecran().slice(0, 95));
    ck("et l'attente a disparu", !b.ecran().includes("Fermez Microsoft Word"));
    ck("le document de la preuve est nommé", b.ecran().includes("R.docx"));

    // 3. FAIL-CLOSED. Sans dépôt enregistré, aucun succès ne peut s'afficher.
    b = await demarrer(mondeNeuf());
    ck("sans dépôt réel, aucun « Preuve créée »", !b.ecran().includes("Preuve créée"),
      b.ecran().slice(0, 95));

    // 4. Les autres causes restent de vraies erreurs : la porte de l'attente ne s'élargit pas.
    b = await demarrer(mondeNeuf({ incident: { cause: "scrub_refused", document: "R.docx" } }));
    ck("un refus de structure n'est pas une attente",
      !b.ecran().includes("Fermez Microsoft Word"));
    b = await demarrer(mondeNeuf({ incident: { cause: "scrub_retry_pending", document: "R.docx",
      detail: { etape: "ecriture", os_error: 28 } } }));
    ck("un échec d'écriture n'est pas une attente de fermeture",
      !b.ecran().includes("Fermez Microsoft Word"));
    b = await demarrer(mondeNeuf({ incident: { cause: "scrub_retry_pending", document: "R.docx",
      detail: { etape: "remplacement", os_error: 13 } } }));
    ck("un remplacement refusé pour une autre raison n'est pas une attente",
      !b.ecran().includes("Fermez Microsoft Word"));
  },

  /**
   * ACCÈS AU DOCUMENT, À SON DOSSIER, À SA PREUVE — et la garde du partage.
   *
   * Avant ce cycle, aucun écran ne permettait d'ouvrir le document qu'on venait de prouver :
   * le bouton existait mais cherchait un chemin que le natif ne rend pas, donc il ne
   * s'affichait jamais. Les trois accès passent désormais par l'IDENTIFIANT du Record.
   */
  async acces_et_partage(ck) {
    const docs = Array.from({ length: 7 }, (_, i) => ({
      name: "D" + (i + 1), record_id: "HO-00000000000" + (i + 1), open_in_word: i === 0 }));

    let b = await demarrer(mondeNeuf({ documents: docs }));
    ck("le libellé annonce des documents DÉTECTÉS, pas un historique",
      b.ecran().includes("récents détectés") && !b.ecran().includes("historique"),
      b.ecran().slice(0, 80));
    ck("cinq documents au plus sont listés",
      b.actions().filter((x) => /^D\d/.test(x.l)).length === 5,
      b.actions().filter((x) => /^D\d/.test(x.l)).map((x) => x.l).join(" | "));
    ck("celui que Word tient ouvert est marqué comme tel",
      b.actions().some((x) => /^D1 · ouvert dans Word/.test(x.l)),
      b.actions().map((x) => x.l).join(" | "));
    ck("et les autres ne le sont pas",
      !b.actions().some((x) => /^D2 · ouvert/.test(x.l)));

    await b.cliquer("D1");
    ck("les trois accès sont offerts sur le document choisi",
      ["Ouvrir ce document", "Ouvrir son dossier", "Copier le lien de vérification"]
        .every((l) => b.actions().some((x) => x.l === l)),
      b.actions().map((x) => x.l).join(" | "));
    ck("la conséquence du partage est visible AVANT toute copie",
      b.ecran().includes("Toute personne disposant de ce lien peut consulter cette preuve"),
      b.ecran().slice(0, 90));

    await b.cliquer("Ouvrir ce document");
    ck("l'ouverture passe par l'identifiant du Record",
      b.back.journal.some((l) => l[0] === "ouvre" && l[1] === "HO-000000000001"));
    ck("et JAMAIS par la porte qui prend un chemin",
      !b.back.journal.some((l) => l[1] === "ho_open_document"),
      b.back.journal.filter((l) => l[0] === "invoke").map((l) => l[1]).join(" "));

    await b.cliquer("Ouvrir son dossier");
    ck("le dossier aussi est désigné par l'identifiant",
      b.back.journal.some((l) => l[0] === "dossier" && l[1] === "HO-000000000001"));

    await b.cliquer("Copier le lien de vérification");
    ck("la copie est demandée au natif, par identifiant",
      b.back.journal.some((l) => l[0] === "copie" && l[1] === "HO-000000000001"));
    ck("et la confirmation redit la conséquence au moment où elle devient réelle",
      b.ecran().includes("Lien copié") &&
      b.ecran().includes("Toute personne disposant de ce lien"),
      b.ecran().slice(0, 110));

    // Une copie qui échoue le DIT, et ne laisse pas croire que le lien est dans le presse-papiers.
    b = await demarrer(mondeNeuf({ documents: docs, copieMarche: false }));
    await b.cliquer("D1");
    await b.cliquer("Copier le lien de vérification");
    ck("une copie qui échoue ne prétend pas avoir réussi",
      !b.ecran().includes("Lien copié"), b.ecran().slice(0, 90));
  },

  /**
   * A — « ouvert dans Word » ne s'écrit que si Word le tient vraiment.
   *
   * Mesuré physiquement le 2026-10-13 : l'application annonçait « Document créé et ouvert
   * dans Word » alors que Word n'affichait rien. Le natif confirme désormais par le fichier
   * verrou ; l'écran, lui, ne doit jamais devancer cette confirmation.
   */
  async ouverture_jamais_affirmee(ck) {
    let b = await demarrer(mondeNeuf());
    await b.cliquer("Nouveau document");
    ck("ouverture confirmée : on peut le dire",
      b.ecran().includes("Document créé et ouvert dans Word"), b.ecran().slice(0, 80));

    b = await demarrer(mondeNeuf({ wordSOuvre: false }));
    await b.cliquer("Nouveau document");
    ck("ouverture NON confirmée : on ne dit jamais « ouvert dans Word »",
      !b.ecran().includes("ouvert dans Word"), b.ecran().slice(0, 90));
    ck("et on dit ce qu'il reste à faire",
      b.ecran().includes("Ouvrez-le dans Word"), b.ecran().slice(0, 90));
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

    // LES TROIS ÉTATS DE LA SOURCE, à l'ARRIVÉE sur « Continuer ce document ? ».
    //
    // Mesuré physiquement le 2026-10-13 : après modification d'un document déjà finalisé,
    // cet écran se taisait jusqu'au clic. Il annonçait « Ce document a déjà une preuve » —
    // vrai de l'état scellé, mais lisible comme une couverture du contenu actuel.
    const unDoc = [{ name: "R.docx", record_id: "A", path: "/d/R.docx" }];

    // false — divergence CONSTATÉE : l'avertissement s'affiche sans qu'on ait rien cliqué.
    b = await demarrer(mondeNeuf({ sourceIntacte: false, documents: unDoc }));
    ck("source modifiée : l'avertissement s'affiche dès l'arrivée, sans clic",
      b.ecran().includes("Ce document a changé"), b.ecran().slice(0, 80));
    ck("et il dit la portée de l'ancienne preuve",
      b.ecran().includes("pour l’état qui avait été scellé"));
    ck("et il dit que la suite n'a pas été observée",
      b.ecran().includes("pas été observées par HumanOrigin"));
    voir(b, "source modifiée");
    ck("et sa sortie nomme sa destination",
      !!b.actions().find((x) => /retour à l’accueil|retour à l'accueil/i.test(x.l)),
      b.actions().map((x) => x.l).join(" | "));

    // true — rien n'a changé : le parcours actuel est conservé tel quel.
    b = await demarrer(mondeNeuf({ sourceIntacte: true, documents: unDoc }));
    ck("source intacte : on reste sur « Continuer ce document ? »",
      b.ecran().includes("Continuer ce document") && !b.ecran().includes("Ce document a changé"),
      b.ecran().slice(0, 80));

    // null — indéterminé. Ce n'est PAS une divergence : on n'en invente pas, et l'écran
    // neutre reste. Sans ce contrôle, un état inconnu alarmerait pour rien.
    b = await demarrer(mondeNeuf({ sourceIntacte: null, documents: unDoc }));
    ck("source indéterminée : aucune divergence inventée",
      b.ecran().includes("Continuer ce document") && !b.ecran().includes("Ce document a changé"),
      b.ecran().slice(0, 80));
    ck("et l'action reste offerte malgré l'indétermination",
      !!b.actions().find((x) => /créer une nouvelle version/i.test(x.l)),
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
