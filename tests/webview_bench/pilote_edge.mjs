// REPLI du banc UI Windows : Microsoft Edge headless (moteur Blink du Runtime WebView2), piloté par
// CDP, quand l'hôte WebView2 ne peut pas s'afficher dans la session CI. Ce n'est PAS l'hôte
// WebView2 : le verdict s'appelle WINDOWS_BLINK, pas WEBVIEW2.
// Toute requête hors http://127.0.0.1:5181 est refusée (Fetch). Profil temporaire, données fictives.
//   node tests/webview_bench/pilote_edge.mjs <sortie>
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ORIGINE = "http://127.0.0.1:5181";
const OUT = path.resolve(process.argv[2]);
fs.mkdirSync(OUT, { recursive: true });
const EDGE = [process.env.HO_EDGE, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find((p) => fs.existsSync(p));
if (!EDGE) { console.error("Edge introuvable : BLOCKED"); process.exit(4); }
const MESURE = fs.readFileSync(path.join(ICI, "mesure.js"), "utf8");
const PORT = 9400 + Math.floor(Math.random() * 90);
const profil = fs.mkdtempSync(path.join(os.tmpdir(), "ho-edge-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`,
  "--no-first-run", "--hide-scrollbars", "--inprivate", "about:blank"], { stdio: "ignore" });
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let cible;
for (let i = 0; i < 80 && !cible; i++) {
  await attendre(250);
  try { cible = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page"); } catch {}
}
const ws = new WebSocket(cible.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let n = 0; const att = new Map(); let bloques = [];
const cdp = (method, params = {}) => new Promise((r) => { const id = ++n; att.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && att.has(m.id)) { att.get(m.id)(m); att.delete(m.id); }
  if (m.method === "Fetch.requestPaused") {
    const u = m.params.request.url;
    if (u.startsWith(ORIGINE + "/")) cdp("Fetch.continueRequest", { requestId: m.params.requestId });
    else { bloques.push(u); cdp("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "BlockedByClient" }); }
  }
});
const evalue = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
await cdp("Page.enable"); await cdp("Runtime.enable");
// Sans fenêtre, la page n'a pas le focus clavier : on le lui donne, sinon Entrée n'active rien.
await cdp("Page.bringToFront"); await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
await cdp("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
const version = (await cdp("Browser.getVersion")).result.product;
console.log("Edge " + version);

const brut = [];
for (const echelle of [1, 1.5]) for (const [w, h] of [[400, 580], [380, 560]])
for (const scenario of ["continuer", "accueil"]) for (const l of ["fr", "en"]) for (const copie of ["ok", "echec"]) {
  bloques = [];
  await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: echelle, mobile: false });
  const s = (await cdp("Page.addScriptToEvaluateOnNewDocument", { source:
    `try{localStorage.setItem("ho.langue","${l}")}catch(e){};window.__erreurs=[];window.addEventListener("error",e=>window.__erreurs.push(String(e.message)));` })).result.identifier;
  await cdp("Page.navigate", { url: `${ORIGINE}/?scenario=${scenario}${copie === "echec" ? "&copie=echec" : ""}` });
  await attendre(2500);
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: s });
  const expr = `(${MESURE})(${JSON.stringify(l)})`;
  const avant = await evalue(expr);
  const nom = `edge_${echelle.toFixed(1)}_${scenario}_${l}_${w}x${h}_${copie}`;
  const capture = async (suffixe) => fs.writeFileSync(path.join(OUT, `${nom}_${suffixe}.png`),
    Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
  if (copie === "ok") await capture("1_initial");
  const libelle = l === "fr" ? "Copier le lien de vérification" : "Copy the verification link";
  await evalue(`([...document.querySelectorAll("button")].find(b => b.innerText.trim() === ${JSON.stringify(libelle)})?.focus(), 0)`);
  for (const type of ["keyDown", "keyUp"])
    await cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
      ...(type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  await attendre(800);
  const apres = await evalue(expr);
  await capture("2_apres_copie");
  brut.push({ moteur: "edge-headless", runtime: version, echelle, w, h, scenario, langue: l, copie, avant, apres, bloques: [...bloques], refus: [] });
  console.log("CAS " + nom + " fait");
}
fs.writeFileSync(path.join(OUT, "brut.json"), JSON.stringify(brut, null, 2));
ws.close(); edge.kill();
