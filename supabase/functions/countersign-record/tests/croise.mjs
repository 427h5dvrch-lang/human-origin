// Test croisé C↔B : une attestation produite par countersign-record doit être acceptée
// par le module de vérification de Verify, et donner SERVER_ATTESTED.
// Le module de Verify vit dans un autre dépôt : le test se déclare ignoré s'il est absent.
import path from "node:path"; import fs from "node:fs"; import vm from "node:vm";
const ici = path.dirname(new URL(import.meta.url).pathname);
const { traiter } = await import(path.join(ici, "../handler.ts"));
const P = await import(path.join(ici, "../protocol.ts"));
let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };

const verifyRacine = path.resolve(ici, "../../../../../humanorigin-web-consultation/verify-record");
const modB = path.join(verifyRacine, "src/record_attestation.js");
if (!fs.existsSync(modB)) {
  console.log("\n  ⚠ module de Verify absent — test croisé ignoré\n     attendu :", modB);
  process.exit(0);
}

const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
const pubB64 = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64");
const KEY_ID = "TEST-ONLY-ho-record-server-test";

vm.runInThisContext(fs.readFileSync(path.join(verifyRacine, "src/record_attestation.js"), "utf8"));
const A = globalThis.HO_ATTESTATION;

// Record synthétique, celui du banc de canonicalisation.
const rec = JSON.parse(fs.readFileSync(
  path.join(verifyRacine, "tests/record_attestation_v1/record_synthetic.json"), "utf8"));
const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))]
  .map(x => x.toString(16).padStart(2, "0")).join("");
rec.chain_head_hash = await sha(JSON.stringify(rec.events));

console.log("\n── canonicalisation : le service et Verify s'accordent ──");
const canonC = P.canonicalize(rec), canonB = A.canonicalize(rec);
ck("forme canonique identique entre countersign-record et Verify", canonC === canonB);
const digest = await sha(canonC);

console.log("\n── le service produit l'attestation ──");
const base = new Map();
const deps = {
  env: (n) => n === "HUMANORIGIN_RECORD_SIGNING_PRIVATE_KEY_B64" ? pkcs8
            : n === "HUMANORIGIN_RECORD_KEY_ID" ? KEY_ID : undefined,
  compte: async (j) => (j === "jeton-a" ? "compte-a" : null),
  lire: async (d) => base.get(d) ?? null,
  ecrire: async (l) => { if (base.has(l.record_digest)) return { conflit: true };
    base.set(l.record_digest, { ...l }); return { conflit: false }; },
  maintenant: () => P.horodatage(new Date("2026-06-01T09:30:00.000Z")),
  cle: (p) => P.importerClePrivee(p),
};
const r = await traiter(new Request("https://x", { method: "POST",
  headers: { authorization: "Bearer jeton-a" }, body: JSON.stringify({ record_digest: digest }) }), deps);
const att = (await r.json()).server_attestation;
ck("attestation produite", r.status === 201 && !!att, att && att.key_id);

console.log("\n── Verify accepte la sortie du service ──");
globalThis.HO_TRUST_KEYS = Object.freeze({ spec: "HumanOrigin.ServerTrustKeys/v1",
  keys: Object.freeze([{ key_id: KEY_ID, alg: "ed25519", public_key: pubB64,
    status: "test", valid_from: "2020-01-01T00:00:00.000Z", retired_at: null }]) });
const attestee = { ...rec, server_attestation: att };
const v = await A.verifierAttestation(attestee);
ck("STEP B VERIFIES STEP C OUTPUT", v.attestation_state === A.SERVER_ATTESTED,
  v.attestation_state + (v.reason ? " / " + v.reason : ""));
ck("condensé recalculé par Verify identique", v.record_digest_computed === digest);
ck("chaîne d'événements recalculée", v.checks.chain_head === true);
ck("les cinq contrôles passent",
  ["shape","version","alg","key_known","digest","signature","chain_head"].every(k => v.checks[k] === true));

console.log("\n── et un bit modifié casse la chaîne ──");
{
  const t = JSON.parse(JSON.stringify(attestee));
  t.process_evidence.blind_spots[0].fact_id += "X";
  const w = await A.verifierAttestation(t);
  ck("Record altéré après attestation → ATTESTATION_PROBLEM",
    w.attestation_state === A.ATTESTATION_PROBLEM && w.reason === "DIGEST_MISMATCH", w.reason);
}

console.log(`\n  ${ok} réussis · ${ko} échoués  →  CROSS_STEP_B_C = ${ko === 0 ? "PASS" : "FAIL"}\n`);
process.exit(ko === 0 ? 0 : 1);
