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
import { PAPER, INK, MUTED, put, mkButton } from "./ho_ui.js";

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
    const r = await invoke("ho_new_document", { folder });
    if (proposalBox) proposalBox.textContent = "";
    say(msg, r.opened_in_word
      ? `« ${r.name} » a été créé dans ${r.folder} et s’ouvre dans Word.`
      : `« ${r.name} » a été créé dans ${r.folder}. Ouvrez-le dans Word.`);
    await refreshFolderList();
  } catch (e) {
    say(msg, errorText(e, t("document.failed")), true);
  } finally { button.disabled = false; }
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

  // --- Microsoft Word
  wrap.appendChild(el("h3", { font: "600 12px/1 inherit", margin: "0 0 12px",
    "letter-spacing": ".12em", "text-transform": "uppercase", color: MUTED }, t("panel.section.word")));
  const wordBox = el("div", { margin: "0 0 38px" });
  wrap.appendChild(wordBox);
  await renderWord(wordBox);

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
    await panel();
  } catch (e) {
    fatal(e);
  }
})();
