// Banc RESERVE-RECORD-ID. Dépendances simulées, aucun réseau, aucune base.
// La paire Ed25519 est générée EN MÉMOIRE : aucun matériel privé dans le dépôt.
import path from "node:path";
const ici = path.dirname(new URL(import.meta.url).pathname);
const { traiter } = await import(path.join(ici, "../handler.ts"));
const P = await import(path.join(ici, "../protocol.ts"));
// Le vérificateur du registre vit dans un autre dépôt. Chemin surchargeable, et le banc
// se déclare ignoré s'il est absent plutôt que de passer en silence.
const fsx = await import("node:fs");
const CANDIDATS = [
  process.env.HO_REGISTRY_DIR && path.join(process.env.HO_REGISTRY_DIR, "netlify/functions/capability.mjs"),
  "/tmp/rwa/registry/netlify/functions/capability.mjs",
  path.join(process.env.HOME, "Developer/HO_FIRSTRUN_RC/humanorigin-web-consultation/registry/netlify/functions/capability.mjs"),
].filter(Boolean);
const chemin = CANDIDATS.find((c) => fsx.existsSync(c));
const C = chemin ? await import(chemin) : null;

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log("  " + (c ? "OK   " : "ECHEC ") + n + (d ? "  -> " + d : "")); };

const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const PKCS8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
const PUB = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64");
const KEY_ID = "TEST-ONLY-ho-registry-write";
const T0 = new Date("2026-06-01T12:00:00.000Z");

function fabrique({ secrets = true, quota = 100 } = {}) {
  const base = new Map();       // record_id -> { record_id, account_id }
  const parCompte = new Map();  // account_id -> nombre
  const emissions = [];
  const deps = {
    env: (n) => !secrets ? undefined
      : n === "HUMANORIGIN_REGISTRY_WRITE_PRIVATE_KEY_B64" ? PKCS8
      : n === "HUMANORIGIN_REGISTRY_WRITE_KEY_ID" ? KEY_ID : undefined,
    compte: async (j) => (j === "jeton-a" ? "compte-a" : j === "jeton-b" ? "compte-b" : null),
    reserver: async (acc, rid) => {
      const n = parCompte.get(acc) || 0;
      if (n >= quota) return { reserved: false, reason: "quota_exceeded" };
      if (base.has(rid)) return { reserved: false, reason: "record_id_taken" };
      base.set(rid, { record_id: rid, account_id: acc });
      parCompte.set(acc, n + 1);
      return { reserved: true, reason: null };
    },
    lire: async (rid) => base.get(rid) ?? null,
    marquerEmission: async (rid) => { emissions.push(rid); },
    maintenant: () => T0,
    cle: (p) => P.importerClePrivee(p),
  };
  return { deps, base, emissions };
}
const POST = (corps, jeton) => new Request("https://x/functions/v1/reserve-record-id", {
  method: "POST",
  headers: jeton ? { authorization: "Bearer " + jeton, "content-type": "application/json" } : {},
  body: corps === undefined ? JSON.stringify({}) : JSON.stringify(corps),
});

console.log("\n-- authentification --");
{
  const { deps } = fabrique();
  ck("sans jeton -> 401", (await traiter(POST({}), deps)).status === 401);
  ck("jeton invalide -> 401", (await traiter(POST({}, "faux"), deps)).status === 401);
  ck("GET -> 405", (await traiter(new Request("https://x", { method: "GET" }), deps)).status === 405);
}

console.log("\n-- secrets absents : fail closed --");
{
  const { deps } = fabrique({ secrets: false });
  const r = await traiter(POST({}, "jeton-a"), deps);
  const b = await r.json();
  ck("500 « not configured », aucune capability",
    r.status === 500 && b.error === "registry write key not configured" && !b.capability, b.error);
}

console.log("\n-- réservation neuve --");
let cap1 = null, id1 = null;
{
  const { deps, base } = fabrique();
  const r = await traiter(POST({}, "jeton-a"), deps);
  const b = await r.json();
  id1 = b.record_id; cap1 = b.capability;
  ck("201 + identifiant + capability", r.status === 201 && !!id1 && !!cap1, "HTTP " + r.status);
  ck("l'identifiant est produit par le SERVEUR, pas par le client",
    /^HO-[A-Za-z0-9_-]{12}$/.test(id1), id1);
  ck("la réservation est inscrite sous le compte", base.get(id1)?.account_id === "compte-a");
  ck("aucune donnée utilisateur dans la réponse",
    !/account_id|user_id|email|"sub"|compte-a/i.test(JSON.stringify(b)));
  ck("champs de réponse attendus",
    Object.keys(b).sort().join(",") === "capability,max_bytes,ok,record_id");
}

console.log("\n-- deux réservations ne collisionnent pas --");
{
  const { deps } = fabrique();
  const a = await (await traiter(POST({}, "jeton-a"), deps)).json();
  const b = await (await traiter(POST({}, "jeton-a"), deps)).json();
  ck("identifiants distincts", a.record_id !== b.record_id);
  ck("capabilities distinctes", a.capability !== b.capability);
}

console.log("\n-- ré-émission --");
{
  const { deps, emissions } = fabrique();
  const a = await (await traiter(POST({}, "jeton-a"), deps)).json();
  const r = await traiter(POST({ record_id: a.record_id }, "jeton-a"), deps);
  const b = await r.json();
  ck("même compte -> 200 et nouvelle capability",
    r.status === 200 && b.reissued === true && !!b.capability, "HTTP " + r.status);
  ck("l'identifiant ne change pas", b.record_id === a.record_id);
  ck("l'émission est tracée", emissions.includes(a.record_id));

  const rb = await traiter(POST({ record_id: a.record_id }, "jeton-b"), deps);
  const bb = await rb.json();
  ck("compte B ne peut pas ré-émettre la capability de A", rb.status === 404, "HTTP " + rb.status);
  ck("le refus ne révèle rien du propriétaire",
    !bb.capability && !/compte-a|account/i.test(JSON.stringify(bb)), JSON.stringify(bb));

  const inc = await traiter(POST({ record_id: "HO-INEXISTANT1" }, "jeton-b"), deps);
  ck("connaître un identifiant ne vaut pas propriété : même réponse qu'un inconnu",
    inc.status === rb.status && JSON.stringify(await inc.json()) === JSON.stringify(bb));
}

console.log("\n-- quota --");
{
  const { deps } = fabrique({ quota: 2 });
  await traiter(POST({}, "jeton-a"), deps);
  await traiter(POST({}, "jeton-a"), deps);
  const r = await traiter(POST({}, "jeton-a"), deps);
  ck("dépassement -> 429", r.status === 429, "HTTP " + r.status);
  const autre = await traiter(POST({}, "jeton-b"), deps);
  ck("le quota est par compte", autre.status === 201, "HTTP " + autre.status);
}

console.log("\n-- entrée --");
{
  const { deps } = fabrique();
  const st = async (c) => (await traiter(POST(c, "jeton-a"), deps)).status;
  ck("record_id malformé -> 400", await st({ record_id: "x" }) === 400);
  ck("champ inattendu -> 400", await st({ record_id: "HO-ABCDEFGHIJKL", account_id: "x" }) === 400);
}

if (C) {
  console.log("\n-- la capability émise satisfait le vérificateur du registre --");
  const cles = new Map([[KEY_ID, PUB]]);
  const r = await C.verifier(cap1, id1, 1000, cles, T0.getTime());
  ck("acceptée par capability.mjs", r.ok, r.raison || "");
  const r2 = await C.verifier(cap1, "HO-AUTRE1234567", 1000, cles, T0.getTime());
  ck("refusée sur un autre identifiant", !r2.ok && r2.raison === "RECORD_ID_MISMATCH", r2.raison);
  const apres = T0.getTime() + 91 * 86400000;
  const r3 = await C.verifier(cap1, id1, 1000, cles, apres);
  ck("expirée après 90 jours", !r3.ok && r3.raison === "EXPIRED", r3.raison);
  const r4 = await C.verifier(cap1, id1, 300000, cles, T0.getTime());
  ck("refusée au-delà de max_bytes", !r4.ok && r4.raison === "TOO_LARGE", r4.raison);
} else {
  console.log("\n  IGNORE : vérificateur du registre introuvable. Chemins essayés :");
  CANDIDATS.forEach((c) => console.log("    " + c));
}

console.log("\n-- aucun matériel privé dans les sources --");
{
  const fs = await import("node:fs");
  const src = fs.readdirSync(path.join(ici, "..")).filter(x => x.endsWith(".ts"))
    .map(x => fs.readFileSync(path.join(ici, "..", x), "utf8")).join("\n");
  const b64 = [...src.matchAll(/["\'`]([A-Za-z0-9+/]{40,}={0,2})["\'`]/g)].map(m => m[1])
    .filter(x => !/^[0-9a-f]{40,}$/.test(x));
  ck("aucune constante pouvant porter une clé", b64.length === 0, b64.join(", "));
}

console.log("\n-- CORS : le prefligth du webview, et rien de plus --");
{
  const ORIG = "tauri://localhost";
  const { deps, base } = fabrique();
  const avant = base.size;

  const pre = async (origine, entetes) => {
    const h = {};
    if (origine) h.origin = origine;
    if (entetes) h["access-control-request-headers"] = entetes;
    h["access-control-request-method"] = "POST";
    return traiter(new Request("https://x/functions/v1/reserve-record-id", { method: "OPTIONS", headers: h }), deps);
  };

  const r = await pre(ORIG, "apikey,authorization,content-type");
  ck("OPTIONS depuis tauri://localhost -> 204", r.status === 204, String(r.status));
  ck("Access-Control-Allow-Origin = tauri://localhost",
    r.headers.get("access-control-allow-origin") === ORIG, String(r.headers.get("access-control-allow-origin")));
  ck("jamais d'autorisation generique", r.headers.get("access-control-allow-origin") !== "*");
  ck("Methods = POST, OPTIONS",
    r.headers.get("access-control-allow-methods") === "POST, OPTIONS", String(r.headers.get("access-control-allow-methods")));
  const hh = (r.headers.get("access-control-allow-headers") || "").toLowerCase();
  for (const e of ["apikey", "authorization", "content-type"])
    ck(`Allow-Headers couvre ${e}`, hh.includes(e), hh);
  ck("Vary: Origin present", (r.headers.get("vary") || "").toLowerCase().includes("origin"));
  ck("pas de Allow-Credentials", !r.headers.get("access-control-allow-credentials"));
  ck("le preflight ne cree AUCUNE reservation", base.size === avant, `${base.size} vs ${avant}`);

  for (const mauvaise of ["https://exemple.test", "http://localhost:1420", "tauri://autre", "null"]) {
    const x = await pre(mauvaise, "authorization");
    ck(`origine ${mauvaise} -> aucune ouverture CORS`,
      x.status !== 204 && !x.headers.get("access-control-allow-origin"), String(x.status));
  }

  console.log("\n-- CORS sur les reponses POST --");
  const post = async (origine, jeton) => {
    const h = { "content-type": "application/json" };
    if (origine) h.origin = origine;
    if (jeton) h.authorization = "Bearer " + jeton;
    return traiter(new Request("https://x/functions/v1/reserve-record-id",
      { method: "POST", headers: h, body: "{}" }), deps);
  };
  const okp = await post(ORIG, "jeton-a");
  ck("POST autorise -> 201 avec ACAO",
    okp.status === 201 && okp.headers.get("access-control-allow-origin") === ORIG, String(okp.status));
  const ko401 = await post(ORIG, null);
  ck("401 reste LISIBLE par le navigateur : ACAO present",
    ko401.status === 401 && ko401.headers.get("access-control-allow-origin") === ORIG, String(ko401.status));
  const etranger = await post("https://exemple.test", "jeton-a");
  ck("POST d'une origine etrangere : aucune ouverture CORS",
    !etranger.headers.get("access-control-allow-origin"));
  ck("mais l'authentification serveur n'est PAS allegee",
    (await post("https://exemple.test", null)).status === 401);

  console.log("\n-- client non navigateur : comportement historique --");
  const sans = await post(null, "jeton-a");
  ck("POST sans Origin -> 201 comme avant", sans.status === 201, String(sans.status));
  ck("aucune ouverture CORS sans Origin", !sans.headers.get("access-control-allow-origin"));
  ck("Vary: Origin quand meme pose", (sans.headers.get("vary") || "").toLowerCase().includes("origin"));
}

console.log("\n  " + ok + " reussis - " + ko + " echoues  =>  RESERVE_RECORD_ID = " + (ko === 0 ? "PASS" : "FAIL") + "\n");
process.exit(ko === 0 ? 0 : 1);
