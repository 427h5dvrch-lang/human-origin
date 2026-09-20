// Chemin complet, local : reserve -> capability -> HOReservedId -> Word -> finalizer -> Registry.
import path from "node:path"; import fs from "node:fs";
// Chemins surchargeables : le registre vit dans un autre dépôt.
const APP = process.env.HO_APP_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REG_CANDIDATS = [process.env.HO_REGISTRY_DIR, "/tmp/rwa/registry",
  path.join(process.env.HOME, "Developer/HO_FIRSTRUN_RC/humanorigin-web-consultation/registry")].filter(Boolean);

const { traiter } = await import(path.join(APP, "supabase/functions/reserve-record-id/handler.ts"));
const P = await import(path.join(APP, "supabase/functions/reserve-record-id/protocol.ts"));
const REG = REG_CANDIDATS.find((d) => fs.existsSync(path.join(d, "netlify/functions/capability.mjs")));
if (!REG) { console.log("\n  IGNORE : registre introuvable"); process.exit(0); }
const C = await import(path.join(REG, "netlify/functions/capability.mjs"));
let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };

const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const PKCS8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
const PUB = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64");
const KEY_ID = "TEST-ONLY-ho-registry-write";
const T0 = new Date("2026-06-01T12:00:00.000Z");

// --- 1. réservation
const base = new Map(), parCompte = new Map();
const deps = {
  env: (n) => n === "HUMANORIGIN_REGISTRY_WRITE_PRIVATE_KEY_B64" ? PKCS8
            : n === "HUMANORIGIN_REGISTRY_WRITE_KEY_ID" ? KEY_ID : undefined,
  compte: async (j) => (j === "jeton-a" ? "compte-a" : null),
  reserver: async (a, r) => { base.set(r, { record_id: r, account_id: a });
    parCompte.set(a, (parCompte.get(a) || 0) + 1); return { reserved: true, reason: null }; },
  lire: async (r) => base.get(r) ?? null,
  marquerEmission: async () => {},
  maintenant: () => T0,
  cle: (p) => P.importerClePrivee(p),
};
console.log("\n── 1. réservation ──");
const rr = await traiter(new Request("https://x", { method: "POST",
  headers: { authorization: "Bearer jeton-a" }, body: "{}" }), deps);
const b1 = await rr.json();
ck("identifiant réservé, produit par le serveur", rr.status === 201 && /^HO-/.test(b1.record_id), b1.record_id);
const RID = b1.record_id, CAP = b1.capability;

console.log("\n── 2. le document porte l'identifiant, jamais la capability ──");
// Le DOCX est produit par le test natif Rust ; ici on vérifie le contrat de propriété.
const custom = fs.readFileSync(path.join(APP, "src-tauri/src/ho_word_setup.rs"), "utf8");
ck("la propriété semée est HOReservedId", custom.includes('RESERVED_ID_PROP: &str = "HOReservedId"'));
ck("la capability n'est pas un paramètre de bootstrap_docx",
  /fn bootstrap_docx\(work_folders: &\[String\], record_id: &str\)/.test(custom));

console.log("\n── 3. le volet compose le locator ──");
const pane = fs.readFileSync(path.join(REG, "../create-record/word/taskpane.js"), "utf8");
ck("le volet lit HOReservedId", pane.includes('it.key === "HOReservedId"'));
ck("le volet ne génère plus d'identifiant", !/getRandomValues\(new Uint8Array\(9\)\)/.test(pane));

console.log("\n── 4. le finalizer relit le trousseau ──");
const fin = fs.readFileSync(path.join(APP, "src-tauri/src/ho_finalizer.rs"), "utf8");
ck("lecture de la capability avant tout travail", fin.includes("ho_capability::lire(&m.record_id)?"));
ck("aucune publication sans capability", !/put_record\(registry, &m\.record_id, &record\)/.test(fin));

console.log("\n── 5. le registre accepte, une seule fois ──");
const cles = new Map([[KEY_ID, PUB]]);
const v1 = await C.verifier(CAP, RID, 1200, cles, T0.getTime());
ck("capability acceptée pour cet identifiant", v1.ok, v1.raison || "");
const v2 = await C.verifier(CAP, "HO-AUTRE1234567", 1200, cles, T0.getTime());
ck("refusée sur un autre identifiant", !v2.ok && v2.raison === "RECORD_ID_MISMATCH");
const v3 = await C.verifier(CAP, RID, 1200, cles, T0.getTime() + 91 * 86400000);
ck("refusée après 90 jours", !v3.ok && v3.raison === "EXPIRED");

console.log("\n── 6. ré-émission : même compte seulement ──");
const re = await traiter(new Request("https://x", { method: "POST",
  headers: { authorization: "Bearer jeton-a" }, body: JSON.stringify({ record_id: RID }) }), deps);
const b2 = await re.json();
ck("le même compte obtient une nouvelle capability", re.status === 200 && !!b2.capability);
ck("l'identifiant ne change pas", b2.record_id === RID);
const v4 = await C.verifier(b2.capability, RID, 1200, cles, T0.getTime());
ck("la capability ré-émise est acceptée", v4.ok, v4.raison || "");
const autre = { ...deps, compte: async () => "compte-b" };
const reb = await traiter(new Request("https://x", { method: "POST",
  headers: { authorization: "Bearer jeton-a" }, body: JSON.stringify({ record_id: RID }) }), autre);
ck("un autre compte n'obtient rien", reb.status === 404);

console.log("\n── 7. la paire est réutilisée, pas renouvelée ──");
ck("une erreur native ne déclenche aucune réservation automatique",
  !fs.readFileSync(path.join(APP, "src/ho_desktop.js"), "utf8")
    .includes("retry") && parCompte.get("compte-a") === 1,
  "réservations pour ce compte : " + parCompte.get("compte-a"));

console.log(`\n  ${ok} réussis · ${ko} échoués  →  CHEMIN_COMPLET = ${ko === 0 ? "PASS" : "FAIL"}\n`);
process.exit(ko === 0 ? 0 : 1);
