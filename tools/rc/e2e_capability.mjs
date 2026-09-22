// Émetteur de capability POUR LE BANC E2E UNIQUEMENT.
//
// Il génère une paire Ed25519 en mémoire et signe une capability avec le MÊME énoncé
// canonique que le registre — en important `capability.mjs` du registre, jamais en le
// réimplémentant : une divergence de canonicalisation rendrait le banc mensonger.
//
// Aucun secret de production n'intervient : cette paire ne vaut que pour le registre RC
// local, qui ne reçoit que sa clé publique. Sortie JSON sur stdout, à consommer par un pipe.
//
//   node e2e_capability.mjs <chemin du dépôt registre> <record_id>
//
import path from "node:path";

const [, , REG, RECORD_ID] = process.argv;
if (!REG || !RECORD_ID) { console.error("usage: e2e_capability.mjs <registre> <record_id>"); process.exit(2); }

const { enonce, PURPOSE } = await import(path.join(REG, "netlify/functions/capability.mjs"));

const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const pub = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64");
const b64u = (b) => Buffer.from(b).toString("base64url").replace(/=+$/, "");

const now = Date.now();
const c = {
  version: 1, alg: "ed25519", key_id: "ho-registry-write-v1", purpose: PURPOSE,
  record_id: RECORD_ID, max_bytes: 262144,
  issued_at: new Date(now).toISOString(),
  expires_at: new Date(now + 3600_000).toISOString(),
};
const sig = await crypto.subtle.sign("Ed25519", kp.privateKey, new TextEncoder().encode(enonce(c)));
const capability = b64u(new TextEncoder().encode(JSON.stringify({ ...c, signature: b64u(new Uint8Array(sig)) })));

process.stdout.write(JSON.stringify({ pub, capability }));
