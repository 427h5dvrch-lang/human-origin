// /src/helpers.js — Helpers frontend PURS (entrée -> sortie, aucun effet de bord).
// Extraits de src/main.js (V2-FE-3) sans changement de logique.
// Aucun accès à window/document/Tauri/état global. Ne pas y ajouter d'effet de bord.

export function shortId(uuid) {
  const s = String(uuid || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return s ? s.slice(0, 10) : "HO";
}

export function shortHash(h) {
  const s = String(h || "");
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s || "—";
}

export function formatDisplayDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function basenameAnyPath(p) {
  return String(p ?? "").split(/[\\/]/).pop() || "document";
}

export function guessMime(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const map = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    txt: "text/plain",
    md: "text/markdown",
    html: "text/html",
    htm: "text/html",
    json: "application/json",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] || "application/octet-stream";
}
