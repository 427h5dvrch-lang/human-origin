// src/ho_ui.js — palette et primitives communes aux deux surfaces du Desktop.
export const PAPER = "#FBFAF7";
export const INK   = "#1A1E24";
export const MUTED = "#565E69";
export const BLUE  = "#2C4A6E";
export const LAYER = "#0E1116";
export const TOP   = "2147483000";

/** Pose des déclarations en ligne, en priorité `important`. */
export const put = (el, decls) => {
  for (const [k, v] of Object.entries(decls)) el.style.setProperty(k, v, "important");
};

export function mkButton(label, primary) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  put(b, {
    font: '600 15px/1 -apple-system, system-ui, sans-serif', padding: "11px 16px",
    "border-radius": "6px", cursor: "pointer", border: "1px solid " + BLUE,
    background: primary ? BLUE : "transparent", color: primary ? PAPER : INK,
    "pointer-events": "auto", opacity: "1", visibility: "visible", appearance: "none",
  });
  return b;
}
