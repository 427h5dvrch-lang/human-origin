// src/ho_desktop.js — la seule surface du Desktop HumanOrigin V1.
//
// Le Desktop n'est pas le produit : c'est un compagnon silencieux. Le travail se fait dans Word.
// Cet écran répond à une seule question — HumanOrigin est-il prêt et que surveille-t-il ?
// Il ne propose donc AUCUNE action de création de preuve.
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
import { readTextFile } from "@tauri-apps/api/fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { PAPER, INK, MUTED, put, mkButton } from "./ho_ui.js";
import { showOnboarding } from "./ho_onboarding.js";

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
const SETUP_EXPLAIN = "HumanOrigin doit préparer Microsoft Word. macOS va vous demander l’autorisation "
  + "d’accéder aux données de Word.";

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
  say(msg, "Préparation de Word… Répondez à la demande de macOS si elle s’affiche.");
  try {
    await invoke("ho_word_setup_install");
    await renderWord(box);
  } catch (e) {
    say(msg, String((e && (e.message || e)) || "La préparation de Word a échoué."), true);
    button.disabled = false;
  }
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
      outdated ? "L’intégration Word doit être mise à jour." : "Word n’est pas encore prêt pour HumanOrigin."));
    box.appendChild(el("p", { margin: "0 0 16px", color: MUTED }, SETUP_EXPLAIN));
    const install = mkButton(outdated ? "Mettre à jour l’intégration Word" : "Installer l’intégration Word", true);
    install.addEventListener("click", () => runSetup(box, install, msg));
    box.appendChild(install);
    box.appendChild(msg);
    return;
  }

  box.appendChild(el("p", { margin: "0 0 16px", color: INK, font: "500 15px/1.5 inherit" },
    "Microsoft Word est prêt."));
  const create = mkButton("Nouveau document HumanOrigin", true);
  create.addEventListener("click", async () => {
    create.disabled = true;
    say(msg, "");
    try {
      const r = await invoke("ho_new_document");
      say(msg, r.opened_in_word
        ? `« ${r.name} » a été créé dans votre dossier de travail et s’ouvre dans Word.`
        : `« ${r.name} » a été créé dans votre dossier de travail. Ouvrez-le dans Word.`);
    } catch (e) {
      say(msg, String((e && (e.message || e)) || "Le document n’a pas pu être créé."), true);
    } finally { create.disabled = false; }
  });
  box.appendChild(create);
  box.appendChild(msg);
  box.appendChild(el("p", { margin: "12px 0 18px", color: MUTED, font: "14px/1.5 inherit" },
    "Gardez l’application HumanOrigin ouverte pendant votre travail."));

  // Action secondaire : elle accède de nouveau au dossier de Word, donc macOS peut redemander.
  const repair = secondaryButton("Réparer l’intégration Word");
  const confirmBox = el("div", { margin: "12px 0 0" });
  repair.addEventListener("click", () => {
    confirmBox.textContent = "";
    confirmBox.appendChild(el("p", { margin: "0 0 12px", color: MUTED, font: "14px/1.5 inherit" }, SETUP_EXPLAIN));
    const go = mkButton("Continuer", true);
    go.addEventListener("click", () => runSetup(box, go, msg));
    confirmBox.appendChild(go);
  });
  box.appendChild(repair);
  box.appendChild(confirmBox);
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
    "HumanOrigin est prêt"));
  wrap.appendChild(el("p", { margin: "0 0 38px", color: MUTED },
    "HumanOrigin fonctionne en arrière-plan lorsque vous finalisez un document depuis Word."));

  // --- Microsoft Word
  wrap.appendChild(el("h3", { font: "600 12px/1 inherit", margin: "0 0 12px",
    "letter-spacing": ".12em", "text-transform": "uppercase", color: MUTED }, "Microsoft Word"));
  const wordBox = el("div", { margin: "0 0 38px" });
  wrap.appendChild(wordBox);
  await renderWord(wordBox);

  // --- dossiers surveillés
  wrap.appendChild(el("h3", { font: "600 12px/1 inherit", margin: "0 0 12px",
    "letter-spacing": ".12em", "text-transform": "uppercase", color: MUTED }, "Dossiers surveillés"));

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
      list.appendChild(el("li", { color: MUTED, font: "15px/1.6 inherit" }, "aucun dossier configuré"));
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
  wrap.appendChild(list);

  const modify = document.createElement("button");
  modify.type = "button";
  modify.textContent = "Modifier les dossiers";
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
        typeof e === "string" ? e : "La modification n'a pas pu être enregistrée."));
    } finally { modify.disabled = false; }
  });
  wrap.appendChild(modify);

  // --- dernière activité
  wrap.appendChild(el("h3", { font: "600 12px/1 inherit", margin: "40px 0 12px",
    "letter-spacing": ".12em", "text-transform": "uppercase", color: MUTED }, "Dernière activité"));
  const when = await lastProofAt();
  if (when) {
    wrap.appendChild(el("p", { margin: "0 0 2px", color: MUTED, font: "15px/1.5 inherit" },
      "Dernière preuve finalisée"));
    wrap.appendChild(el("p", { margin: "0", color: INK, font: "500 15px/1.5 inherit" },
      frenchDate(when)));
  } else {
    wrap.appendChild(el("p", { margin: "0", color: MUTED },
      "Aucune preuve finalisée pour le moment."));
  }

  document.body.appendChild(wrap);
}

/** Une initialisation qui échoue doit se voir. Elle ne dit rien du document de l'utilisateur. */
function fatal(e) {
  document.body.textContent = "";
  put(document.body, { margin: "0", background: PAPER, color: INK,
    font: '15px/1.6 -apple-system, system-ui, sans-serif' });
  const w = el("main", { "max-width": "520px", margin: "0 auto", padding: "60px 32px" });
  w.appendChild(el("h2", { font: "600 20px/1.3 inherit", margin: "0 0 10px" },
    "HumanOrigin n'a pas pu démarrer"));
  w.appendChild(el("p", { margin: "0 0 14px", color: MUTED },
    "L'application n'a pas pu lire sa configuration. Relancez-la ; si le problème persiste, "
    + "ce message aidera à l'identifier."));
  w.appendChild(el("pre", { margin: "0", padding: "12px 14px", "border-radius": "8px",
    background: "#F2F0EA", color: INK, font: "12px/1.5 ui-monospace, Menlo, monospace",
    "white-space": "pre-wrap" }, String((e && (e.message || e)) || "erreur inconnue")));
  document.body.appendChild(w);
}

(async () => {
  try {
    const st = await invoke("ho_finalizer_status");
    if (!st || !st.active) await showOnboarding();
    await panel();
  } catch (e) {
    fatal(e);
  }
})();
