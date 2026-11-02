// Banc UI Windows / WebKit — serveur LOCAL des vrais index.html et src/ho_desktop.js, portes
// natives remplacées par des doublures fictives (window.__HO). Aucun Tauri, aucun Supabase,
// aucun registre : `@tauri-apps/api/*` et `ho_reserve.js` ne quittent jamais la page.
//   HO_RACINE=<racine du dépôt> vite --config tests/webview_bench/vite.config.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const STUBS = {
  "@tauri-apps/api/tauri": "export const invoke = (...a) => window.__HO.invoke(...a);",
  "@tauri-apps/api/dialog": "export const open = async () => null;",
  "@tauri-apps/api/fs": "export const readTextFile = async () => { throw new Error('absent'); };",
  "@tauri-apps/api/path": "export const appDataDir = async () => '/fictif/'; export const join = async (...p) => p.join('/');",
  "@tauri-apps/api/event": "export const listen = async () => () => {};",
  "@tauri-apps/api/shell": "export const open = async () => true;",
};
const RESERVE = `export const reserveRecordId = async () => ({ record_id: "HO-FICTIF", capability: "x" });
export const supabase = { auth: {
  getSession: async () => ({ data: { session: { access_token: "fictif", user: { email: "test@example.test" } } } }),
  signOut: async () => ({}), setSession: async () => ({}),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };`;

export default {
  root: process.env.HO_RACINE || path.resolve(ICI, "..", ".."),
  logLevel: "warn",
  server: { port: 5181, strictPort: true, host: "127.0.0.1", hmr: false },
  plugins: [{
    name: "ho-doublures",
    enforce: "pre",
    resolveId(id) {
      if (STUBS[id]) return "\0ho:" + id;
      if (/ho_reserve\.js$/.test(id)) return "\0ho:reserve";
      return null;
    },
    load(id) {
      if (!id.startsWith("\0ho:")) return null;
      const k = id.slice(4);
      return k === "reserve" ? RESERVE : STUBS[k];
    },
    transformIndexHtml(html) {
      return html.replace("<body>", "<body>\n<script>" + fs.readFileSync(path.join(ICI, "natif_fictif.js"), "utf8") + "</script>");
    },
  }],
};
