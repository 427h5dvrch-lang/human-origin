// src/ho_onboarding.js — premier lancement. L'utilisateur choisit explicitement les dossiers.
// Aucun accès global au disque n'est demandé. Ensuite, silence.
//
// Les styles sont posés EN LIGNE, en priorité `important` : une feuille injectée s'était révélée
// inopérante dans cette fenêtre, et rien de l'application ne doit pouvoir masquer cette couche.
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
import { PAPER, INK, MUTED, BLUE, LAYER, TOP, put, mkButton } from "./ho_ui.js";

export function showOnboarding() {
  return new Promise((resolve, reject) => {
    const folders = [];
    const root = document.createElement("div");
    root.id = "ho-onb";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    put(root, {
      position: "fixed", top: "0", right: "0", bottom: "0", left: "0",
      width: "100vw", height: "100vh", margin: "0", padding: "0",
      "z-index": TOP, display: "flex", "align-items": "center", "justify-content": "center",
      background: LAYER, opacity: "1", visibility: "visible", transform: "none",
      "pointer-events": "auto",
      font: '15px/1.55 -apple-system, system-ui, "Segoe UI", sans-serif',
    });

    const card = document.createElement("div");
    put(card, {
      background: PAPER, color: INK, "max-width": "460px", width: "calc(100% - 48px)",
      padding: "26px 28px", "border-radius": "10px", "box-shadow": "0 18px 60px rgba(0,0,0,.45)",
      "box-sizing": "border-box",
    });

    const h = document.createElement("h2");
    h.textContent = "Choisissez les dossiers dans lesquels HumanOrigin peut finaliser vos documents.";
    put(h, { font: "600 18px/1.4 inherit", margin: "0 0 10px", color: INK });

    const p = document.createElement("p");
    p.textContent = "HumanOrigin n'ouvrira que les documents qu'il a lui-même marqués, et seulement "
      + "dans ces dossiers. Rien d'autre n'est lu.";
    put(p, { margin: "0 0 16px", color: MUTED, font: "15px/1.55 inherit" });

    const list = document.createElement("ul");
    put(list, { margin: "0 0 18px", padding: "0 0 0 18px", color: MUTED,
      font: "13px/1.6 ui-monospace, Menlo, monospace" });

    const row = document.createElement("div");
    put(row, { display: "flex", gap: "8px", "align-items": "center" });
    const add = mkButton("Ajouter un dossier", false);
    const ok = mkButton("Terminer", true);

    const render = () => {
      list.textContent = "";
      if (!folders.length) {
        const li = document.createElement("li");
        li.textContent = "aucun dossier pour l'instant";
        list.appendChild(li);
      } else for (const f of folders) {
        const li = document.createElement("li");
        li.textContent = f;
        list.appendChild(li);
      }
      ok.disabled = folders.length === 0;
      put(ok, { opacity: ok.disabled ? "0.45" : "1", cursor: ok.disabled ? "default" : "pointer" });
    };

    add.addEventListener("click", async () => {
      try {
        const picked = await open({ directory: true, multiple: false });
        if (typeof picked === "string" && !folders.includes(picked)) { folders.push(picked); render(); }
      } catch (e) { reject(e); }
    });
    ok.addEventListener("click", async () => {
      ok.disabled = true;
      try {
        await invoke("ho_finalizer_set_folders", { folders, registry: null });
        root.remove();
        resolve(folders);
      } catch (e) { reject(e); }
    });

    row.appendChild(add); row.appendChild(ok);
    card.appendChild(h); card.appendChild(p); card.appendChild(list); card.appendChild(row);
    root.appendChild(card);
    document.body.appendChild(root);
    render();
    add.focus();
  });
}
