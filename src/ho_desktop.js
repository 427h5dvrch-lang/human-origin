// src/ho_desktop.js — la seule surface du Desktop HumanOrigin V1.
//
// Le Desktop n'est pas le produit : c'est un compagnon silencieux. Le travail se fait dans Word.
// Cet écran répond à une seule question — HumanOrigin est-il prêt et que surveille-t-il ?
// Il ne propose donc AUCUNE action de création de preuve.
import { invoke } from "@tauri-apps/api/tauri";
import { t } from "./ho_i18n.js";
import { open } from "@tauri-apps/api/dialog";
import { readTextFile } from "@tauri-apps/api/fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { PAPER, INK, MUTED, BLUE, put, mkButton } from "./ho_ui.js";
import { reserveRecordId, supabase } from "./ho_reserve.js";
import { listen } from "@tauri-apps/api/event";
import {
  PAPIER, CARTE, MARINE, ENCRE, ATONE, LIGNE, SERIF, SANS, COLONNE, ICONES,
  HumanOriginBrandMark, entete, colonne, medaillon, titre, sousTitre, corps,
  ctaPrincipal, ctaSecondaire, ctaWord, pilule, carteEtat, mention, page, pastilleWord,
  el as sh,
} from "./ho_shell.js";

const el = (tag, decls, text) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (decls) put(n, decls);
  return n;
};

/** Date de la dernière preuve finalisée, lue dans l'état du finalizer. Aucune statistique. */
async function lastProofAt() {
  try {
    const path = await join(await appDataDir(), "finalizer_state.json");
    const done = JSON.parse(await readTextFile(path)).done || {};
    const dates = Object.values(done).filter(Boolean).sort();
    if (!dates.length) return null;
    const d = new Date(dates[dates.length - 1]);
    return isNaN(d) ? null : d;
  } catch (e) { return null; }
}

const ERROR_INK = "#8C2F2F";
const SETUP_EXPLAIN = () => t("setup.word.explain");

/** Bouton secondaire : même aspect que « Modifier les dossiers ». */
function secondaryButton(label) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  put(b, {
    font: '500 13px/1 -apple-system, system-ui, sans-serif', padding: "7px 13px",
    "border-radius": "7px", cursor: "pointer", border: "1px solid #D9D5CC",
    background: "#FFFFFF", color: INK, "box-shadow": "0 1px 1px rgba(26,30,36,.05)",
    appearance: "none", "pointer-events": "auto",
  });
  return b;
}

const say = (node, text, isError) => {
  node.textContent = text || "";
  put(node, { color: isError ? ERROR_INK : MUTED });
};

/** L'installation (ou la réparation) est le SEUL moment où HumanOrigin accède au dossier de Word. */
async function runSetup(box, button, msg) {
  button.disabled = true;
  say(msg, t("setup.word.progress"));
  try {
    await invoke("ho_word_setup_install");
    await renderWord(box);
  } catch (e) {
    say(msg, String((e && (e.message || e)) || t("setup.word.failed")), true);
    button.disabled = false;
  }
}

// Mise à jour de la liste « Dossiers surveillés » après la création du premier document.
let refreshFolderList = async () => {};

const errorText = (e, fallback) => String((e && (e.message || e)) || fallback);

/** Crée le document ; `folder` n'est utilisé que si aucun emplacement n'est encore configuré. */
async function createDocument(button, msg, folder, proposalBox) {
  button.disabled = true;
  say(msg, folder ? t("document.creating") : "");
  try {
    // Réservation AVANT la commande native : sans identifiant réservé ni capability,
    // aucun document HumanOrigin n'est créé. Le jeton de session reste côté frontend.
    const { record_id, capability } = await reserveRecordId();
    const r = await invoke("ho_new_document", { folder, recordId: record_id, capability });
    if (proposalBox) proposalBox.textContent = "";
    say(msg, r.opened_in_word
      ? `« ${r.name} » a été créé dans ${r.folder} et s’ouvre dans Word.`
      : `« ${r.name} » a été créé dans ${r.folder}. Ouvrez-le dans Word.`);
    await refreshFolderList();
  } catch (e) {
    say(msg, errorText(e, t("document.failed")), true);
  } finally { button.disabled = false; }
}

/**
 * Versioning V1 — créer une nouvelle version d'un document déjà finalisé.
 *
 * Le déclenchement est ICI, et non dans Word : le volet Office ne peut pas réveiller
 * l'application (mesuré). L'application, elle, sait quels documents finalisés sont ouverts.
 *
 * Le chemin du fichier n'est jamais un concept d'interface : on n'affiche qu'un nom.
 */
async function creerNouvelleVersion(bouton, msg, fromRecordId) {
  bouton.disabled = true;
  say(msg, "Préparation de la nouvelle version…");
  try {
    // Réservation APRÈS l'avertissement éventuel, jamais avant : une réservation
    // consommée pour une création abandonnée serait un identifiant perdu.
    const { record_id, capability } = await reserveRecordId();
    const r = await invoke("ho_new_version", {
      fromRecordId, recordId: record_id, capability,
    });
    say(msg, r.opened_in_word
      ? `« ${r.name} » a été créé et s’ouvre dans Word.`
      : `« ${r.name} » a été créé. Ouvrez-le dans Word.`);
  } catch (e) {
    say(msg, errorText(e, "La nouvelle version n’a pas pu être créée."), true);
  } finally { bouton.disabled = false; }
}

/** Un document éligible : son nom, et l'action. L'avertissement précède la réservation. */
function ligneVersionnable(doc, plusieurs) {
  const bloc = el("div", { margin: plusieurs ? "0 0 16px" : "0" });
  if (plusieurs) {
    bloc.appendChild(el("p", { margin: "0 0 6px", color: INK }, doc.name));
  } else {
    bloc.appendChild(el("p", { margin: "0 0 2px", color: MUTED, font: "500 13px/1.4 inherit" },
      "Document finalisé"));
    bloc.appendChild(el("h4", { font: "600 17px/1.35 inherit", margin: "0 0 10px", color: INK },
      doc.name));
  }
  const msg = el("p", { margin: "8px 0 0", font: "13px/1.5 inherit", color: MUTED }, "");
  const bouton = secondaryButton("Créer une nouvelle version");
  bouton.onclick = async () => {
    bouton.disabled = true;
    let etat = null;
    try {
      const r = await invoke("ho_version_source_state", { fromRecordId: doc.record_id });
      etat = r.source_matches_predecessor_final_state;
    } catch (e) {
      say(msg, errorText(e, "L’état de ce document n’a pas pu être vérifié."), true);
      bouton.disabled = false;
      return;
    }
    // `null` — indéterminé — n'est PAS `false`. On n'avertit que d'une divergence constatée.
    if (etat === false) {
      bouton.remove();
      const avert = el("div", { margin: "10px 0 0" });
      avert.appendChild(el("p", { margin: "0 0 6px", color: INK },
        "Ce document a été modifié depuis sa finalisation."));
      avert.appendChild(el("p", { margin: "0 0 10px", color: MUTED, font: "13px/1.5 inherit" },
        "La preuve précédente reste valable pour l’état qui avait été scellé. "
        + "Les modifications intervenues depuis ne seront pas considérées comme observées."));
      const confirmer = secondaryButton("Créer la nouvelle version");
      confirmer.onclick = () => creerNouvelleVersion(confirmer, msg, doc.record_id);
      avert.appendChild(confirmer);
      bloc.insertBefore(avert, msg);
      return;
    }
    await creerNouvelleVersion(bouton, msg, doc.record_id);
  };
  bloc.appendChild(bouton);
  bloc.appendChild(msg);
  return bloc;
}

/**
 * Rend la section, ou rien du tout s'il n'y a aucun document éligible.
 *
 * « Aucun document » et « la commande a échoué » ne doivent JAMAIS se ressembler. Une
 * application dont le binaire a été remplacé mais qui n'a pas été relancée ne connaît pas
 * encore cette commande : l'échec se lisait alors comme « rien à proposer », et rien à
 * l'écran ne le disait. Observé le 2026-09-25, au prix d'un diagnostic complet.
 */
async function renderVersioning(box) {
  box.textContent = "";
  let docs = null;
  try {
    docs = (await invoke("ho_versionable_documents")) || [];
  } catch (e) {
    box.appendChild(el("p", { margin: "0", color: MUTED, font: "13px/1.5 inherit" },
      "Les documents finalisés n’ont pas pu être consultés. "
      + "Si HumanOrigin vient d’être mis à jour, quittez l’application et rouvrez-la."));
    return true;
  }
  if (!docs.length) return false;
  if (docs.length > 1) {
    box.appendChild(el("p", { margin: "0 0 14px", color: MUTED, font: "13px/1.5 inherit" },
      "Plusieurs documents finalisés sont ouverts."));
  }
  docs.forEach((d) => box.appendChild(ligneVersionnable(d, docs.length > 1)));
  return true;
}

/** Premier document : l'emplacement dédié est proposé, visible et modifiable, avant toute création. */
async function proposeLocation(box, msg) {
  let proposed = "";
  try { proposed = (await invoke("ho_default_work_folder")) || ""; } catch (e) { proposed = ""; }
  box.textContent = "";
  put(box, { margin: "16px 0 0", padding: "14px 16px", border: "1px solid #D9D5CC",
    "border-radius": "8px", background: "#FFFFFF" });
  box.appendChild(el("p", { margin: "0 0 4px", color: INK, font: "500 15px/1.5 inherit" },
    t("location.title")));
  const path = el("p", { margin: "0 0 10px", color: INK, "word-break": "break-all",
    font: "13px/1.5 ui-monospace, Menlo, monospace" }, proposed || t("location.none"));
  box.appendChild(path);
  box.appendChild(el("p", { margin: "0 0 14px", color: MUTED, font: "14px/1.5 inherit" },
      t("location.explain")))
  const row = el("div", { display: "flex", gap: "10px", "align-items": "center", "flex-wrap": "wrap" });
  const go = mkButton(t("location.confirm"), true);
  go.disabled = !proposed;
  const other = secondaryButton(t("location.other"));
  go.addEventListener("click", () => createDocument(go, msg, proposed, box));
  other.addEventListener("click", async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      const refusal = await invoke("ho_check_work_folder", { folder: picked });
      if (refusal) { say(msg, refusal, true); return; }
      proposed = picked;
      path.textContent = picked;
      go.disabled = false;
      say(msg, "");
    } catch (e) { say(msg, errorText(e, t("location.failed")), true); }
  });
  row.appendChild(go); row.appendChild(other);
  box.appendChild(row);
}

/** Section Microsoft Word. L'état vient uniquement de la sentinelle locale de l'application. */
async function renderWord(box) {
  box.textContent = "";
  let st = null;
  try { st = await invoke("ho_word_setup_status"); } catch (e) { st = null; }
  const msg = el("p", { margin: "12px 0 0", font: "14px/1.5 inherit", color: MUTED });

  if (!st || st.state !== "installed") {
    const outdated = st && st.state === "outdated";
    box.appendChild(el("p", { margin: "0 0 8px", color: INK, font: "500 15px/1.5 inherit" },
      outdated ? t("word.outdated") : t("word.notReady")));
    box.appendChild(el("p", { margin: "0 0 16px", color: MUTED }, SETUP_EXPLAIN()));
    const install = mkButton(outdated ? t("word.update") : t("word.install"), true);
    install.addEventListener("click", () => runSetup(box, install, msg));
    box.appendChild(install);
    box.appendChild(msg);
    return;
  }

  box.appendChild(el("p", { margin: "0 0 16px", color: INK, font: "500 15px/1.5 inherit" },
    t("word.ready")));
  const create = mkButton(t("word.newDocument"), true);
  const proposal = el("div");
  create.addEventListener("click", async () => {
    say(msg, "");
    let folders = [];
    try { folders = (await invoke("ho_finalizer_get_folders")) || []; } catch (e) { folders = []; }
    if (folders.length) return createDocument(create, msg, null, proposal);
    await proposeLocation(proposal, msg);
  });
  box.appendChild(create);
  box.appendChild(proposal);
  box.appendChild(msg);
  box.appendChild(el("p", { margin: "12px 0 18px", color: MUTED, font: "14px/1.5 inherit" },
    t("word.keepAppOpen")));

  // Action secondaire : elle accède de nouveau au dossier de Word, donc macOS peut redemander.
  const repair = secondaryButton(t("word.repair"));
  const confirmBox = el("div", { margin: "12px 0 0" });
  repair.addEventListener("click", () => {
    confirmBox.textContent = "";
    confirmBox.appendChild(el("p", { margin: "0 0 12px", color: MUTED, font: "14px/1.5 inherit" }, SETUP_EXPLAIN()));
    const go = mkButton("Continuer", true);
    go.addEventListener("click", () => runSetup(box, go, msg));
    confirmBox.appendChild(go);
  });
  box.appendChild(repair);
  box.appendChild(confirmBox);
}

// ---------------------------------------------------------------- compte
//
// L'authentification EXISTE depuis toujours dans main.js ; le pivot vers ce shell a laissé
// son interface derrière lui. On reprend ici le même flux Supabase, sans en inventer un
// autre : signInWithOtp vers humanorigin://login, puis reprise du lien profond.
//
// Une seule instance de client dans toute l'application : celle de ho_reserve.js. Le shell
// s'authentifie avec elle, et c'est elle qui réserve.

// Redirection d'authentification, fixée à la COMPILATION. Défaut production ; un build RC
// pose VITE_HO_REDIRECT et déclare le schéma correspondant. Aucun choix à l'exécution, et
// rien de lisible depuis un fichier de configuration.
const REDIRECTION = import.meta.env.VITE_HO_REDIRECT || "humanorigin://login";

async function sessionCourante() {
  try { return (await supabase.auth.getSession())?.data?.session ?? null; }
  catch (e) { return null; }
}

/**
 * Extrait les jetons d'une URL de retour, exactement comme le faisait main.js : les
 * paramètres se trouvent dans le fragment, à défaut dans la requête.
 *
 * Rien n'est accepté sans les DEUX jetons : un lien tronqué, expiré ou porteur d'une
 * erreur ne doit jamais produire un faux état connecté.
 */
function jetonsDuLien(url) {
  let d;
  try { d = new URL(String(url).replace(/^humanorigin:\/\//, "https://humanorigin.invalid/")); }
  catch (e) { return null; }
  const p = new URLSearchParams((d.hash || "").replace(/^#/, "") || d.search.replace(/^\?/, ""));
  if (p.get("error") || p.get("error_description")) return null;
  const access_token = p.get("access_token"), refresh_token = p.get("refresh_token");
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

async function ouvrirSession(url) {
  const j = jetonsDuLien(url);
  if (!j) return false;
  try {
    const { error } = await supabase.auth.setSession(j);
    return !error;
  } catch (e) { return false; }
}

// Les quatre canaux sont ceux que main.js écoutait : on ne change pas le contrat natif.
const CANAUX = ["tauri://open-url", "scheme-request", "scheme-request-received", "deep-link://open-url"];

function urlDuPayload(payload) {
  if (Array.isArray(payload) && payload.length) return String(payload[0]);
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const u = payload.url || (Array.isArray(payload.urls) ? payload.urls[0] : null);
    if (u) return String(u);
  }
  return null;
}

let liensPrets = false;
async function brancherLiens(onSession) {
  if (liensPrets) return;
  liensPrets = true;
  const handler = async (ev) => {
    const u = urlDuPayload(ev?.payload);
    if (!u) return;
    await onSession(await ouvrirSession(u));
  };
  for (const c of CANAUX) { try { await listen(c, handler); } catch (e) { /* canal absent */ } }
  // Lien reçu avant que l'interface ne soit prête : le natif l'a mis de côté.
  try {
    const attente = await invoke("take_pending_deep_link");
    if (attente) await handler({ payload: attente });
  } catch (e) { /* aucun lien en attente */ }
}

async function renderAccount(box, session) {
  box.textContent = "";
  const msg = el("p", { margin: "10px 0 0", color: MUTED, font: "14px/1.5 inherit" });

  if (session) {
    const ligne = el("div", { display: "flex", "align-items": "center", gap: "12px",
      "flex-wrap": "wrap" });
    ligne.appendChild(el("span", { color: MUTED, font: "14px/1.5 inherit" },
      t("account.signedInAs")));
    ligne.appendChild(el("span", { color: INK, font: "500 15px/1.5 inherit" },
      session?.user?.email || ""));
    const out = secondaryButton(t("account.signOut"));
    out.addEventListener("click", async () => {
      out.disabled = true;
      try { await supabase.auth.signOut(); } catch (e) { say(msg, t("account.signOutFailed"), true); }
      out.disabled = false;
      await renderAccount(box, await sessionCourante());
    });
    ligne.appendChild(out);
    box.appendChild(ligne);
    box.appendChild(msg);
    return;
  }

  box.appendChild(el("p", { margin: "0 0 12px", color: MUTED }, t("account.signedOutHint")));
  const ligne = el("div", { display: "flex", gap: "10px", "flex-wrap": "wrap" });
  const champ = document.createElement("input");
  champ.type = "email";
  champ.placeholder = t("account.emailPlaceholder");
  put(champ, { font: "15px/1 -apple-system, system-ui, sans-serif", padding: "10px 12px",
    "border-radius": "7px", border: "1px solid #D9D5CC", background: "#FFFFFF", color: INK,
    "min-width": "240px", flex: "1 1 240px" });
  const envoyer = mkButton(t("account.sendLink"), true);

  envoyer.addEventListener("click", async () => {
    const email = String(champ.value || "").trim();
    if (!email) { say(msg, t("account.emailRequired"), true); return; }
    envoyer.disabled = true;
    say(msg, t("account.sending"), false);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email, options: { emailRedirectTo: REDIRECTION },
      });
      if (error) { envoyer.disabled = false; say(msg, t("account.sendFailed"), true); return; }
    } catch (e) {
      envoyer.disabled = false; say(msg, t("account.sendFailed"), true); return;
    }
    // État « lien envoyé » : pas d'écran supplémentaire, et l'adresse disparaît.
    box.textContent = "";
    box.appendChild(el("p", { margin: "0", color: MUTED }, t("account.linkSent")));
  });

  ligne.appendChild(champ);
  ligne.appendChild(envoyer);
  box.appendChild(ligne);
  box.appendChild(msg);
}

const frenchDate = (d) =>
  d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
  + " · " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

async function panel() {
  document.body.textContent = "";
  put(document.body, {
    margin: "0", background: PAPER, color: INK, "min-height": "100vh",
    font: '15px/1.6 -apple-system, system-ui, "Segoe UI", sans-serif',
  });

  const wrap = el("main", { "max-width": "560px", margin: "0 auto", padding: "54px 32px 40px" });

  wrap.appendChild(el("h1", { font: "600 15px/1 inherit", margin: "0 0 28px",
    "letter-spacing": ".14em", "text-transform": "uppercase", color: MUTED }, "HumanOrigin"));

  wrap.appendChild(el("h2", { font: "600 26px/1.25 inherit", margin: "0 0 10px", color: INK },
    t("panel.title")));
  wrap.appendChild(el("p", { margin: "0 0 38px", color: MUTED },
    t("panel.subtitle")));

  // --- compte, en tête : sans session, rien d'autre n'est réalisable
  wrap.appendChild(el("h3", { font: "600 12px/1 inherit", margin: "0 0 12px",
    "letter-spacing": ".12em", "text-transform": "uppercase", color: MUTED }, t("account.section")));
  const accountBox = el("div", { margin: "0 0 38px" });
  wrap.appendChild(accountBox);
  await renderAccount(accountBox, await sessionCourante());
  // Un retour de lien profond recompose le panneau : l'état connecté apparaît sans relance.
  await brancherLiens(async (ok) => { if (ok) await panel(); });

  // --- Microsoft Word
  wrap.appendChild(el("h3", { font: "600 12px/1 inherit", margin: "0 0 12px",
    "letter-spacing": ".12em", "text-transform": "uppercase", color: MUTED }, t("panel.section.word")));
  const wordBox = el("div", { margin: "0 0 38px" });
  wrap.appendChild(wordBox);
  await renderWord(wordBox);

  // --- nouvelle version : la section n'existe que s'il y a de quoi la proposer.
  const titreVersions = el("h3", { font: "600 12px/1 inherit", margin: "0 0 12px",
    "letter-spacing": ".12em", "text-transform": "uppercase", color: MUTED }, "NOUVELLE VERSION");
  const versionsBox = el("div", { margin: "0 0 38px" });
  wrap.appendChild(titreVersions);
  wrap.appendChild(versionsBox);
  if (!(await renderVersioning(versionsBox))) {
    titreVersions.remove();
    versionsBox.remove();
  }

  // --- dossiers surveillés
  wrap.appendChild(el("h3", { font: "600 12px/1 inherit", margin: "0 0 12px",
    "letter-spacing": ".12em", "text-transform": "uppercase", color: MUTED }, t("panel.section.folders")));

  let folders = [];
  try { folders = (await invoke("ho_finalizer_get_folders")) || []; } catch (e) { folders = []; }

  const list = el("ul", { margin: "0 0 20px", padding: "0", "list-style": "none" });
  // Le nom du dossier suffit à se reconnaître ; le chemin complet reste lisible, en retrait.
  const baseName = (p) => {
    const parts = String(p).replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || p;
  };
  const fill = () => {
    list.textContent = "";
    if (!folders.length) {
      list.appendChild(el("li", { color: MUTED, font: "15px/1.6 inherit" },
        t("panel.folders.none")));
      return;
    }
    for (const f of folders) {
      const li = el("li", { margin: "0 0 10px" });
      li.title = f;
      li.appendChild(el("div", { font: "500 15px/1.4 inherit", color: INK }, baseName(f)));
      li.appendChild(el("div", { font: "12px/1.5 ui-monospace, Menlo, monospace", color: MUTED,
        "word-break": "break-all", "margin-top": "2px" }, f));
      list.appendChild(li);
    }
  };
  fill();
  refreshFolderList = async () => {
    try { folders = (await invoke("ho_finalizer_get_folders")) || []; } catch (e) { folders = []; }
    fill();
  };
  wrap.appendChild(list);

  const modify = document.createElement("button");
  modify.type = "button";
  modify.textContent = t("panel.folders.edit");
  // Action inchangée. Aspect volontairement secondaire : ce n'est pas l'action principale du produit.
  put(modify, {
    font: '500 13px/1 -apple-system, system-ui, sans-serif', padding: "7px 13px",
    "border-radius": "7px", cursor: "pointer", border: "1px solid #D9D5CC",
    background: "#FFFFFF", color: INK, "box-shadow": "0 1px 1px rgba(26,30,36,.05)",
    appearance: "none", "pointer-events": "auto",
  });
  modify.addEventListener("click", async () => {
    modify.disabled = true;
    try {
      const picked = await open({ directory: true, multiple: true });
      if (picked) {
        const next = Array.isArray(picked) ? picked : [picked];
        await invoke("ho_finalizer_set_folders", { folders: next, registry: null });
        folders = (await invoke("ho_finalizer_get_folders")) || [];
        fill();
      }
    } catch (e) {
      list.appendChild(el("li", { color: ERROR_INK },
        typeof e === "string" ? e : t("panel.folders.saveFailed")));
    } finally { modify.disabled = false; }
  });
  wrap.appendChild(modify);

  // --- dernière activité
  wrap.appendChild(el("h3", { font: "600 12px/1 inherit", margin: "40px 0 12px",
    "letter-spacing": ".12em", "text-transform": "uppercase", color: MUTED }, t("panel.section.activity")));
  const when = await lastProofAt();
  if (when) {
    wrap.appendChild(el("p", { margin: "0 0 2px", color: MUTED, font: "15px/1.5 inherit" },
      t("panel.activity.lastProof")));
    wrap.appendChild(el("p", { margin: "0", color: INK, font: "500 15px/1.5 inherit" },
      frenchDate(when)));
  } else {
    wrap.appendChild(el("p", { margin: "0", color: MUTED },
      t("panel.activity.none")));
  }

  document.body.appendChild(wrap);
}

/** Une initialisation qui échoue doit se voir. Elle ne dit rien du document de l'utilisateur. */
// ---------------------------------------------------------------- Creator Shell V1 — états
// La planche validée est le contrat visuel. UN ÉCRAN = UN ÉTAT : aucun de ces écrans n'en
// compose deux, et aucun n'affiche de chemin de fichier ni d'information technique.
//
// Les composants et les jetons vivent dans ho_shell.js. Ici, seulement le branchement des
// états métier existants : aucune donnée n'est simulée, aucune commande n'est ajoutée.

/** Mémoire d'écran : ce que l'utilisateur vient de faire, pour l'état suivant. */
const VUE = { ecran: null, doc: null, message: "" };

const quandDate = (d) => {
  const a = new Date();
  const meme = d.toDateString() === a.toDateString();
  const jour = meme ? "Aujourd’hui"
    : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return jour + " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

/** Zone de message d'un écran : un seul endroit, discret, sous les actions. */
function zoneMessage() {
  return sh("p", { margin: "14px 0 0", font: "13px/1.5 " + SANS, color: ATONE,
    "text-align": "center" }, VUE.message || "");
}

// ---------------------------------------------------------------- 1 · PRÊT
async function ecranPret(ctx) {
  const p = page("accueil");
  p.appendChild(entete({ connecte: true, onReglages: () => router({ ecran: "reglages" }) }));

  const c = colonne({ padding: "38px 24px 0", "flex-grow": "1" });
  // Trois lignes, comme la planche : la mesure du titre est bornée pour que le rythme
  // ne dépende pas de la largeur exacte de la fenêtre.
  c.appendChild(sh("h1", { font: "400 28px/1.24 " + SERIF, color: MARINE, margin: "0 0 13px",
    "letter-spacing": "-.012em", "max-width": "250px" },
    "Créez votre prochain document HumanOrigin"));
  c.appendChild(corps(["Travaillez normalement dans Word.",
                       "HumanOrigin se charge de la preuve."], "left"));

  const cta = ctaPrincipal("Nouveau document", "feuille");
  const msg = zoneMessage();
  const proposition = sh("div", { margin: "14px 0 0" });
  cta.onclick = async () => {
    say(msg, "");
    let folders = [];
    try { folders = (await invoke("ho_finalizer_get_folders")) || []; } catch (e) { folders = []; }
    if (folders.length) return createDocument(cta, msg, null, proposition);
    await proposeLocation(proposition, msg);
  };
  c.appendChild(cta);
  c.appendChild(proposition);
  c.appendChild(msg);

  const cartes = sh("div", { display: "grid", "grid-template-columns": "1fr 1fr",
    gap: "9px", margin: "11px 0 0" });
  cartes.appendChild(carteEtat(pastilleWord(19), "Microsoft Word", "Prêt"));
  cartes.appendChild(carteEtat(ICONES.personne(19, ATONE), "Compte", "Connecté"));
  c.appendChild(cartes);
  p.appendChild(c);

  const d = await lastProofAt();
  const pied = colonne({ padding: "22px 24px", "margin-top": "26px" });
  pied.appendChild(sh("div", { height: "1px", background: LIGNE, margin: "0 0 15px" }));
  pied.appendChild(sh("p", { margin: "0 0 2px", font: "500 13px/1.4 " + SANS, color: ENCRE },
    "Dernière preuve créée"));
  pied.appendChild(sh("p", { margin: "0", font: "12.5px/1.4 " + SANS, color: ATONE },
    d ? quandDate(d) : "Aucune pour l’instant"));
  p.appendChild(pied);
}

// ---------------------------------------------------------------- 4 · CONTINUER CE DOCUMENT ?
async function ecranContinuer(ctx) {
  const doc = ctx.doc;
  const p = page();
  p.appendChild(entete({ connecte: true, onReglages: () => router({ ecran: "reglages" }) }));
  const c = colonne({ padding: "46px 24px 0", "flex-grow": "1" });
  c.appendChild(medaillon("copie", "bleu"));
  c.appendChild(titre("Continuer ce document ?"));
  c.appendChild(sousTitre(doc.name));
  c.appendChild(corps([
    "Ce document a déjà une preuve.",
    "Sa preuve actuelle restera inchangée.",
    "HumanOrigin peut créer une nouvelle version pour poursuivre votre travail."]));

  const msg = zoneMessage();
  const creer = ctaPrincipal("Créer une nouvelle version", "feuille");
  creer.onclick = async () => {
    creer.disabled = true;
    say(msg, "Vérification du document…");
    let etat = null;
    try {
      const r = await invoke("ho_version_source_state", { fromRecordId: doc.record_id });
      etat = r.source_matches_predecessor_final_state;
    } catch (e) {
      say(msg, errorText(e, "L’état de ce document n’a pas pu être vérifié."), true);
      creer.disabled = false;
      return;
    }
    // `null` — indéterminé — n'est PAS `false`. On n'avertit que d'une divergence constatée.
    if (etat === false) return router({ ecran: "source-modifiee", doc });
    await lancerNouvelleVersion(doc, msg, creer);
  };
  c.appendChild(creer);
  const annuler = ctaSecondaire("Annuler");
  put(annuler, { margin: "9px 0 0" });
  annuler.onclick = () => router({ ecran: "pret" });
  c.appendChild(annuler);
  c.appendChild(msg);
  p.appendChild(c);
}

// ---------------------------------------------------------------- 6 · SOURCE MODIFIÉE
async function ecranSourceModifiee(ctx) {
  const doc = ctx.doc;
  const p = page();
  p.appendChild(entete({ connecte: true, onReglages: () => router({ ecran: "reglages" }) }));
  const c = colonne({ padding: "42px 24px 0", "flex-grow": "1" });

  const tete = sh("div", { display: "flex", "align-items": "flex-start", gap: "14px",
    margin: "0 0 16px" });
  const rondAmbre = sh("div", { width: "48px", height: "48px", "border-radius": "50%",
    background: "#FBF0DB", display: "flex", "align-items": "center",
    "justify-content": "center", "flex-shrink": "0" });
  rondAmbre.appendChild(ICONES.alerte(22, "#A9762B"));
  tete.appendChild(rondAmbre);
  tete.appendChild(sh("h1", { font: "400 24px/1.25 " + SERIF, color: MARINE, margin: "4px 0 0",
    "letter-spacing": "-.012em" }, "Ce document a changé depuis sa finalisation"));
  c.appendChild(tete);

  c.appendChild(corps([
    "La preuve précédente reste valable",
    "pour l’état qui avait été scellé.",
    "Les modifications réalisées depuis n’ont",
    "pas été observées par HumanOrigin."], "left"));
  c.appendChild(pilule("Vous pouvez continuer à partir de l’état actuel dans une nouvelle version.",
    "ambre"));

  const msg = zoneMessage();
  const creer = ctaPrincipal("Créer une nouvelle version", "feuille");
  creer.onclick = () => lancerNouvelleVersion(doc, msg, creer);
  c.appendChild(creer);
  const annuler = ctaSecondaire("Annuler");
  put(annuler, { margin: "9px 0 0" });
  annuler.onclick = () => router({ ecran: "pret" });
  c.appendChild(annuler);
  c.appendChild(msg);
  p.appendChild(c);
}

/** Action commune aux écrans 4 et 6 : réserver, puis créer. Aucune logique nouvelle. */
async function lancerNouvelleVersion(doc, msg, bouton) {
  bouton.disabled = true;
  say(msg, "Préparation de la nouvelle version…");
  try {
    // Réservation APRÈS l'avertissement éventuel : une réservation consommée pour une
    // création abandonnée serait un identifiant perdu.
    const { record_id, capability } = await reserveRecordId();
    const r = await invoke("ho_new_version", {
      fromRecordId: doc.record_id, recordId: record_id, capability,
    });
    router({ ecran: "version-prete", doc: { name: r.name, path: r.path } });
  } catch (e) {
    say(msg, errorText(e, "La nouvelle version n’a pas pu être créée."), true);
    bouton.disabled = false;
  }
}

// ---------------------------------------------------------------- 5 · NOUVELLE VERSION PRÊTE
async function ecranVersionPrete(ctx) {
  const doc = ctx.doc;
  const p = page();
  p.appendChild(entete({ connecte: true, onReglages: () => router({ ecran: "reglages" }) }));
  const c = colonne({ padding: "46px 24px 0", "flex-grow": "1" });
  c.appendChild(medaillon("etincelle", "bleu"));
  c.appendChild(titre("Nouvelle version prête"));
  c.appendChild(corps(["Votre contenu a été conservé.",
                       "HumanOrigin observe les modifications",
                       "à partir de maintenant."]));
  c.appendChild(pilule("Le contenu déjà présent dans ce document n’a pas été observé dans cette version.",
    "bleu"));

  const msg = zoneMessage();
  const ouvrir = ctaWord("Ouvrir dans Word");
  ouvrir.onclick = async () => {
    try { await invoke("open_file", { path: doc.path }); }
    catch (e) { say(msg, errorText(e, "Le document n’a pas pu être ouvert."), true); }
  };
  // Une seule action, comme la planche. Ouvrir le document EST la suite naturelle ;
  // un second bouton de même poids ferait deux intentions sur un écran qui n'en a qu'une.
  c.appendChild(ouvrir);
  c.appendChild(msg);
  p.appendChild(c);
}

// ---------------------------------------------------------------- 9 · CONNEXION NÉCESSAIRE
async function ecranConnexion(ctx) {
  const p = page();
  p.appendChild(entete({ connecte: false }));
  const c = colonne({ padding: "56px 24px 0", "flex-grow": "1" });
  c.appendChild(medaillon("exclamation", "rouge"));
  c.appendChild(titre("Connexion nécessaire"));
  c.appendChild(corps(["Vous devez être connecté pour créer,",
                       "finaliser ou consulter une preuve."]));
  const msg = zoneMessage();
  const b = ctaPrincipal("Se connecter");
  b.onclick = () => router({ ecran: "premiere" });
  c.appendChild(b);
  c.appendChild(msg);
  c.appendChild(sh("p", { margin: "22px 0 0", "text-align": "center",
    font: "12.5px/1.5 " + SANS, color: ATONE }, "Un problème ?"));
  const aide = sh("p", { margin: "2px 0 0", "text-align": "center",
    font: "12.5px/1.5 " + SANS });
  const lien = sh("a", { color: MARINE, "text-decoration": "underline", cursor: "pointer" },
    "Besoin d’aide ?");
  lien.onclick = () => router({ ecran: "premiere" });
  aide.appendChild(lien);
  c.appendChild(aide);
  p.appendChild(c);
}

// ---------------------------------------------------------------- 8 · PREMIÈRE UTILISATION
async function ecranPremiere(ctx) {
  const p = page("accueil");
  const h = entete({ connecte: false });
  p.appendChild(h);
  const c = colonne({ padding: "44px 24px 0", "flex-grow": "1" });
  c.appendChild(sh("h1", { font: "400 27px/1.26 " + SERIF, color: MARINE, margin: "0 0 12px",
    "letter-spacing": "-.012em", "text-align": "center" }, "Bienvenue dans HumanOrigin"));
  c.appendChild(corps(["Produisez des documents accompagnés",
                       "d’une preuve vérifiable de leur processus observé."]));

  const liste = sh("div", { display: "flex", "flex-direction": "column", gap: "11px",
    margin: "0 0 24px" });
  const rang = (icone, texte) => {
    const r = sh("div", { display: "flex", "align-items": "center", gap: "11px" });
    const i = sh("span", { "flex-shrink": "0", display: "inline-flex" });
    i.appendChild(icone);
    r.appendChild(i);
    r.appendChild(sh("span", { font: "14px/1.45 " + SANS, color: ENCRE }, texte));
    return r;
  };
  liste.appendChild(rang(ICONES.feuilleLignes(19, ATONE), "Créez un document HumanOrigin"));
  liste.appendChild(rang(pastilleWord(19), "Travaillez normalement dans Word"));
  liste.appendChild(rang(ICONES.bouclier(19, ATONE), "HumanOrigin se charge de la preuve"));
  c.appendChild(liste);

  const msg = zoneMessage();
  const champ = document.createElement("input");
  champ.type = "email";
  champ.placeholder = "vous@exemple.com";
  put(champ, { width: "100%", "box-sizing": "border-box", padding: "13px 14px",
    "border-radius": "10px", border: "1px solid " + LIGNE, background: CARTE,
    font: "15px/1.2 " + SANS, color: ENCRE, margin: "0 0 9px", appearance: "none" });
  c.appendChild(champ);

  const b = ctaPrincipal("Continuer avec mon email");
  b.onclick = async () => {
    const email = String(champ.value || "").trim();
    if (!email) { say(msg, "Indiquez votre adresse email.", true); return; }
    b.disabled = true;
    say(msg, "Envoi du lien…");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email, options: { emailRedirectTo: REDIRECTION },
      });
      if (error) throw error;
      say(msg, "Lien envoyé. Ouvrez-le depuis cet appareil.");
    } catch (e) {
      say(msg, errorText(e, "Le lien n’a pas pu être envoyé."), true);
    } finally { b.disabled = false; }
  };
  c.appendChild(b);
  c.appendChild(msg);
  c.appendChild(sh("p", { margin: "12px 0 0", "text-align": "center",
    font: "12.5px/1.5 " + SANS, color: ATONE }, "Vous recevrez un lien de connexion sécurisé."));
  p.appendChild(c);
}

// ---------------------------------------------------------------- 7 · RÉGLAGES
// La planche montre les réglages dans une fenêtre large, avec une barre latérale. À 400 px
// cette barre écrase le contenu — l'adresse se réduit à une lettre. Les six rubriques sont
// donc empilées dans la MÊME colonne et la même grille que les autres écrans. Le défilement
// vertical est admis ici.
async function ecranReglages(ctx) {
  document.body.textContent = "";
  put(document.body, { margin: "0", background: PAPIER, color: ENCRE, "min-height": "100vh",
    font: "15px/1.6 " + SANS, overflow: "hidden auto" });

  const cadre = sh("div", { display: "flex", "flex-direction": "column", "min-height": "100vh" });
  const h = sh("header", { display: "flex", "align-items": "center",
    "justify-content": "space-between", padding: "13px 18px",
    "border-bottom": "1px solid " + LIGNE, background: "rgba(251,250,247,.86)" });
  const g = sh("div", { display: "flex", "align-items": "center", gap: "9px" });
  g.appendChild(HumanOriginBrandMark(21));
  g.appendChild(sh("span", { font: "600 15px/1 " + SANS, color: ENCRE }, "HumanOrigin"));
  h.appendChild(g);
  const fermer = sh("button", { background: "transparent", border: "0", padding: "4px",
    cursor: "pointer", display: "inline-flex", appearance: "none", "pointer-events": "auto" });
  fermer.type = "button";
  fermer.setAttribute("aria-label", "Fermer");
  fermer.appendChild(ICONES.croix(17, ATONE));
  fermer.onclick = () => router({ ecran: null });
  h.appendChild(fermer);
  cadre.appendChild(h);

  const c = colonne({ padding: "20px 24px 28px", "flex-grow": "1" });
  for (const nom of ["Compte", "Microsoft Word", "Documents", "Langue", "À propos", "Diagnostic"]) {
    const bloc = sh("section", { margin: "0 0 20px" });
    bloc.appendChild(sh("h2", { font: "600 12.5px/1.3 " + SANS, color: ATONE,
      margin: "0 0 8px" }, nom));
    const dedans = sh("div");
    bloc.appendChild(dedans);
    c.appendChild(bloc);
    await rubrique(nom, dedans);
  }
  cadre.appendChild(c);
  document.body.appendChild(cadre);
}

/** Carte de réglage : une icône, un texte, et au plus une action. */
function carteReglage(icone, principal, secondaire, action) {
  const l = sh("div", { display: "flex", "align-items": "center", gap: "10px",
    "justify-content": "space-between", padding: "11px 13px", background: CARTE,
    border: "1px solid " + LIGNE, "border-radius": "10px",
    "box-shadow": "0 1px 1px rgba(26,30,36,.03)" });
  const g = sh("div", { display: "flex", "align-items": "center", gap: "10px",
    "min-width": "0" });
  if (icone) g.appendChild(icone);
  const t = sh("div", { "min-width": "0" });
  t.appendChild(sh("p", { margin: "0", font: "13.5px/1.35 " + SANS, color: ENCRE,
    overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }, principal));
  if (secondaire) {
    t.appendChild(sh("p", { margin: "1px 0 0", font: "12.5px/1.35 " + SANS, color: ATONE,
      overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }, secondaire));
  }
  g.appendChild(t);
  l.appendChild(g);
  if (action) {
    put(action, { width: "auto", padding: "8px 12px", font: "500 13px/1 " + SANS,
      "flex-shrink": "0" });
    l.appendChild(action);
  }
  return l;
}

const pastilleEtat = (vert) => sh("span", { width: "7px", height: "7px",
  "border-radius": "50%", background: vert ? "#3E8E5A" : "#A9762B",
  display: "inline-block", "flex-shrink": "0" });

/** Le nom du dossier suffit à se reconnaître : aucun chemin système n'est montré. */
const nomDeDossier = (p) => {
  const bouts = String(p || "").replace(/\/+$/, "").split("/");
  return bouts[bouts.length - 1] || "";
};

async function rubrique(nom, hote) {
  const msg = sh("p", { margin: "8px 0 0", font: "12.5px/1.5 " + SANS, color: ATONE });

  if (nom === "Compte") {
    const session = await sessionCourante();
    let action = null;
    if (session) {
      action = ctaSecondaire("Se déconnecter");
      action.onclick = async () => {
        action.disabled = true;
        try { await supabase.auth.signOut(); router({ ecran: null }); }
        catch (e) { say(msg, errorText(e, "La déconnexion a échoué."), true); action.disabled = false; }
      };
    }
    hote.appendChild(carteReglage(ICONES.personne(17, ATONE),
      (session && session.user && session.user.email) || "Non connecté", null, action));
    hote.appendChild(msg);
    return;
  }

  if (nom === "Microsoft Word") {
    let st = null;
    try { st = await invoke("ho_word_setup_status"); } catch (e) { st = null; }
    const pret = st && st.state === "installed";
    const action = ctaSecondaire(pret ? "Réparer" : "Installer");
    action.onclick = () => runSetup(hote, action, msg);
    hote.appendChild(carteReglage(pastilleEtat(pret),
      pret ? "Intégration opérationnelle" : "Intégration à installer", null, action));
    hote.appendChild(msg);
    return;
  }

  if (nom === "Documents") {
    let folders = [];
    try { folders = (await invoke("ho_finalizer_get_folders")) || []; } catch (e) { folders = []; }
    const action = ctaSecondaire("Modifier");
    action.onclick = async () => {
      const choisi = await open({ directory: true, multiple: false });
      if (!choisi) return;
      const refus = await invoke("ho_check_work_folder", { folder: choisi });
      if (refus) { say(msg, refus, true); return; }
      await invoke("ho_finalizer_set_folders", { folders: [choisi], registry: null });
      hote.textContent = ""; rubrique("Documents", hote);
    };
    hote.appendChild(carteReglage(ICONES.dossier(17, ATONE),
      nomDeDossier(folders[0]) || "Aucun dossier choisi", "Dossier de vos documents", action));
    hote.appendChild(msg);
    return;
  }

  if (nom === "Langue") {
    hote.appendChild(carteReglage(ICONES.globe(17, ATONE), "Français", null, null));
    return;
  }

  if (nom === "À propos") {
    hote.appendChild(carteReglage(ICONES.bouclier(17, ATONE), "HumanOrigin",
      "Une preuve vérifiable du processus observé.", null));
    return;
  }

  // Diagnostic : relecture des contrôles déjà existants, rien de nouveau.
  const bloc = sh("div");
  const peindre = async () => {
    bloc.textContent = "";
    let st = null, actif = null;
    try { st = await invoke("ho_word_setup_status"); } catch (e) { st = null; }
    try { actif = await invoke("ho_finalizer_status"); } catch (e) { actif = null; }
    const revoir = ctaSecondaire("Vérifier");
    revoir.onclick = () => peindre();
    bloc.appendChild(carteReglage(pastilleEtat(!!(actif && actif.active)),
      actif && actif.active ? "Surveillance de vos documents active"
                            : "Aucun dossier surveillé", null, revoir));
    const d2 = sh("div", { margin: "8px 0 0" });
    d2.appendChild(carteReglage(pastilleEtat(!!(st && st.state === "installed")),
      st && st.state === "installed" ? "Word répond" : "Word ne répond pas", null, null));
    bloc.appendChild(d2);
  };
  hote.appendChild(bloc);
  await peindre();
}

// ---------------------------------------------------------------- routage
// UN ÉCRAN = UN ÉTAT. Le routeur choisit à partir des seules données réelles.
async function router(cible) {
  if (cible && cible.ecran) {
    VUE.ecran = cible.ecran; VUE.doc = cible.doc || null; VUE.message = "";
    const table = {
      "pret": ecranPret, "continuer": ecranContinuer, "source-modifiee": ecranSourceModifiee,
      "version-prete": ecranVersionPrete, "connexion": ecranConnexion,
      "premiere": ecranPremiere, "reglages": ecranReglages,
    };
    if (cible.ecran === "pret") return etatCourant();
    return table[cible.ecran]({ doc: VUE.doc });
  }
  return etatCourant();
}

/** L'état réel, déduit des seules données dont l'application dispose. */
async function etatCourant() {
  const session = await sessionCourante();
  if (!session) {
    let folders = [];
    try { folders = (await invoke("ho_finalizer_get_folders")) || []; } catch (e) { folders = []; }
    let st = null;
    try { st = await invoke("ho_word_setup_status"); } catch (e) { st = null; }
    // Rien n'est encore configuré : c'est une première utilisation, pas une déconnexion.
    const vierge = !folders.length && !(st && st.state === "installed");
    return vierge ? ecranPremiere({}) : ecranConnexion({});
  }
  let st = null;
  try { st = await invoke("ho_word_setup_status"); } catch (e) { st = null; }
  if (!st || st.state !== "installed") return ecranPremiere({});

  // Un document finalisé ouvert dans Word appelle son propre écran.
  let docs = [];
  try { docs = (await invoke("ho_versionable_documents")) || []; } catch (e) { docs = []; }
  if (docs.length === 1) return ecranContinuer({ doc: docs[0] });
  if (docs.length > 1) return ecranContinuer({ doc: docs[0] });

  return ecranPret({});
}

function fatal(e) {
  document.body.textContent = "";
  put(document.body, { margin: "0", background: PAPER, color: INK,
    font: '15px/1.6 -apple-system, system-ui, sans-serif' });
  const w = el("main", { "max-width": "520px", margin: "0 auto", padding: "60px 32px" });
  w.appendChild(el("h2", { font: "600 20px/1.3 inherit", margin: "0 0 10px" },
    t("fatal.title")));
  w.appendChild(el("p", { margin: "0 0 14px", color: MUTED },
    t("fatal.body")));
  w.appendChild(el("pre", { margin: "0", padding: "12px 14px", "border-radius": "8px",
    background: "#F2F0EA", color: INK, font: "12px/1.5 ui-monospace, Menlo, monospace",
    "white-space": "pre-wrap" }, String((e && (e.message || e)) || t("fatal.unknown"))));
  document.body.appendChild(w);
}

(async () => {
  try {
    // Aucun choix de dossier au démarrage : l'emplacement est proposé au premier document.
    await router();
  } catch (e) {
    fatal(e);
  }
})();
