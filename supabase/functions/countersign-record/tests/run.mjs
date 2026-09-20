// Banc COUNTERSIGN-RECORD — logique du service, dépendances simulées.
// Aucune clé de production, aucun réseau, aucune base. La paire Ed25519 est générée
// EN MÉMOIRE à chaque exécution : aucun matériel privé n'existe dans le dépôt.
import path from "node:path"; import fs from "node:fs";
const ici = path.dirname(new URL(import.meta.url).pathname);
const { traiter } = await import(path.join(ici, "../handler.ts"));
const P = await import(path.join(ici, "../protocol.ts"));

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };

// --- paire TEST ONLY, en mémoire
const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
const pubB64 = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64");
const KEY_ID = "TEST-ONLY-ho-record-server-test";

// --- dépendances simulées
function fabrique({ secrets = true, compteValide = "compte-a", instant = "2026-01-01T00:00:00.000Z", roundTripTimestamptz = false } = {}) {
  const base = new Map();
  let signatures = 0;
  const deps = {
    env: (n) => !secrets ? undefined
      : n === "HUMANORIGIN_RECORD_SIGNING_PRIVATE_KEY_B64" ? pkcs8
      : n === "HUMANORIGIN_RECORD_KEY_ID" ? KEY_ID : undefined,
    compte: async (j) => (j === "jeton-a" ? "compte-a" : j === "jeton-b" ? "compte-b" : null),
    lire: async (d) => {
      const l = base.get(d);
      if (!l) return null;
      if (!roundTripTimestamptz) return l;
      return { ...l, server_signed_at: l.server_signed_at.replace(/Z$/, "+00:00") };
    },
    ecrire: async (l) => { if (base.has(l.record_digest)) return { conflit: true };
      base.set(l.record_digest, { ...l }); return { conflit: false }; },
    maintenant: () => { signatures++; return instant; },
    cle: (p) => P.importerClePrivee(p),
  };
  return { deps, base, nbSignatures: () => signatures };
}
const POST = (corps, jeton) => new Request("https://x/functions/v1/countersign-record", {
  method: "POST", headers: jeton ? { authorization: "Bearer " + jeton } : {},
  body: typeof corps === "string" ? corps : JSON.stringify(corps) });
const D = "a".repeat(64);

console.log("\n── authentification ──");
{
  const { deps } = fabrique();
  ck("JWT absent → 401", (await traiter(POST({ record_digest: D }), deps)).status === 401);
  ck("JWT invalide → 401", (await traiter(POST({ record_digest: D }, "jeton-faux"), deps)).status === 401);
  ck("méthode GET → 405", (await traiter(new Request("https://x", { method: "GET" }), deps)).status === 405);
}

console.log("\n── secrets absents : fail closed ──");
{
  const { deps } = fabrique({ secrets: false });
  const r = await traiter(POST({ record_digest: D }, "jeton-a"), deps);
  const b = await r.json();
  // La RAISON compte : sans elle, retirer le garde-fou de démarrage passerait inaperçu,
  // la suite échouant de toute façon plus loin avec un autre 500.
  ck("clé privée absente → 500 « not configured », aucune attestation",
    r.status === 500 && b.error === "record signing key not configured" && !b.server_attestation, b.error);
}

console.log("\n── validation de l'entrée ──");
{
  const { deps } = fabrique();
  const st = async (c) => (await traiter(POST(c, "jeton-a"), deps)).status;
  ck("digest trop court → 400", await st({ record_digest: "abc" }) === 400);
  ck("digest en majuscules → 400", await st({ record_digest: "A".repeat(64) }) === 400);
  ck("digest non hexadécimal → 400", await st({ record_digest: "z".repeat(64) }) === 400);
  ck("digest absent → 400", await st({}) === 400);
  ck("champ inattendu → 400", await st({ record_digest: D, server_signed_at: "2020-01-01T00:00:00.000Z" }) === 400);
  ck("corps illisible → 400", (await traiter(POST("{pas du json", "jeton-a"), deps)).status === 400);
}

console.log("\n── attestation valide ──");
let attestation = null;
{
  const { deps } = fabrique();
  const r = await traiter(POST({ record_digest: D }, "jeton-a"), deps);
  const b = await r.json();
  attestation = b.server_attestation;
  ck("digest valide → 201 + attestation", r.status === 201 && !!attestation);
  ck("version produite par le serveur", attestation.version === 1);
  ck("alg produit par le serveur", attestation.alg === "ed25519");
  ck("key_id produit par le serveur", attestation.key_id === KEY_ID);
  ck("horodatage produit par le serveur", attestation.server_signed_at === "2026-01-01T00:00:00.000Z");
  ck("le digest est repris tel quel", attestation.record_digest === D);
  const champs = Object.keys(attestation).sort().join(",");
  ck("aucun champ hors contrat",
    champs === "alg,key_id,record_digest,server_signed_at,signature,version", champs);
  const brut = JSON.stringify(b);
  ck("aucun identifiant de compte dans la réponse",
    !/compte-a|account_id|user_id|email/i.test(brut));
}

console.log("\n── signature ──");
{
  const enonce = P.enonce({ key_id: KEY_ID, record_digest: D,
    server_signed_at: attestation.server_signed_at, version: 1 });
  const sig = Buffer.from(attestation.signature, "base64");
  const pub = await crypto.subtle.importKey("raw", Buffer.from(pubB64, "base64"),
    { name: "Ed25519" }, false, ["verify"]);
  ck("signature vérifiable sur l'énoncé canonique",
    await crypto.subtle.verify("Ed25519", pub, sig, new TextEncoder().encode(enonce)));
  ck("l'énoncé porte sa séparation de domaine",
    enonce.startsWith('{"domain":"HumanOrigin.RecordAttestation/v1"'));
  // Signature DIRECTE : elle ne doit pas valider sur le condensé de l'énoncé.
  const preHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(enonce)));
  ck("la signature n'est pas celle d'un énoncé pré-haché",
    !(await crypto.subtle.verify("Ed25519", pub, sig, preHash)));
  // Un bit du digest change → l'énoncé change → la signature ne correspond plus.
  const autre = P.enonce({ key_id: KEY_ID, record_digest: "b" + D.slice(1),
    server_signed_at: attestation.server_signed_at, version: 1 });
  ck("un bit du digest invalide la signature",
    !(await crypto.subtle.verify("Ed25519", pub, sig, new TextEncoder().encode(autre))));
}

console.log("\n── anti-rejeu, décision figée ──");
{
  const { deps, nbSignatures } = fabrique();
  const r1 = await traiter(POST({ record_digest: D }, "jeton-a"), deps);
  const a1 = (await r1.json()).server_attestation;
  const r2 = await traiter(POST({ record_digest: D }, "jeton-a"), deps);
  const b2 = await r2.json();
  ck("même digest, même compte → 200 idempotent", r2.status === 200 && b2.idempotent === true);
  ck("attestation identique au caractère près",
    JSON.stringify(a1) === JSON.stringify(b2.server_attestation));
  ck("aucun nouvel événement de signature", nbSignatures() === 1, nbSignatures() + " horodatage(s)");

  const r3 = await traiter(POST({ record_digest: D }, "jeton-b"), deps);
  const b3 = await r3.json();
  ck("même digest, autre compte → 409", r3.status === 409);
  ck("le 409 ne porte aucune attestation", !b3.server_attestation);
  ck("le 409 ne porte aucun horodatage ni identifiant",
    !/server_signed_at|account|compte-a|user/i.test(JSON.stringify(b3)), JSON.stringify(b3));
  ck("une seule attestation stockée pour ce digest", nbSignatures() === 1);
}

console.log("\n── round-trip PostgreSQL timestamptz ──");
{
  const { deps, nbSignatures } = fabrique({ roundTripTimestamptz: true });
  const r1 = await traiter(POST({ record_digest: D }, "jeton-a"), deps);
  const a1 = (await r1.json()).server_attestation;
  const r2 = await traiter(POST({ record_digest: D }, "jeton-a"), deps);
  const b2 = await r2.json();

  ck("round-trip timestamptz → attestation strictement identique",
    JSON.stringify(a1) === JSON.stringify(b2.server_attestation));
  ck("round-trip timestamptz → aucun nouvel événement de signature",
    nbSignatures() === 1, nbSignatures() + " horodatage(s)");
}

console.log("\n── course à l'écriture ──");
{
  const { deps } = fabrique();
  // Le digest apparaît entre la lecture et l'écriture : la reprise doit rester idempotente.
  const vraiEcrire = deps.ecrire;
  let premier = true;
  deps.ecrire = async (l) => { if (premier) { premier = false; await vraiEcrire(l); return { conflit: true }; }
    return vraiEcrire(l); };
  const r = await traiter(POST({ record_digest: D }, "jeton-a"), deps);
  const b = await r.json();
  ck("conflit d'écriture → relecture idempotente, pas de seconde attestation",
    r.status === 200 && b.idempotent === true && !!b.server_attestation);
}

console.log("\n── les valeurs de confiance viennent du serveur, jamais du corps ──");
{
  const src = fs.readFileSync(path.join(ici, "../handler.ts"), "utf8");
  // Invariant de source : le gestionnaire ne lit du corps QUE record_digest. Sans cela,
  // une relaxation future du contrôle de champs rendrait l'horodatage manipulable.
  const lectures = [...src.matchAll(/corps\s*(?:as [^)]*\))?\s*\)?\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map(m => m[1]).filter(k => k !== "record_digest");
  ck("le gestionnaire ne lit aucun champ du corps hors record_digest",
    lectures.length === 0, lectures.join(", "));
  for (const v of ["server_signed_at", "key_id", "version", "domain", "alg"])
    ck(`« ${v} » n'est jamais lu depuis le corps`,
      !new RegExp("corps[^;\\n]*\\b" + v + "\\b").test(src));
  // Et l'horodatage rendu est bien celui produit par le serveur.
  const { deps } = fabrique({ instant: "2029-12-31T23:59:59.999Z" });
  const rr = await traiter(POST({ record_digest: "c".repeat(64) }, "jeton-a"), deps);
  const bb = await rr.json();
  ck("l'horodatage rendu est celui du serveur",
    bb.server_attestation.server_signed_at === "2029-12-31T23:59:59.999Z");
}

console.log("\n── le protocole HO-JSON n'est pas touché ──");
{
  const racine = path.resolve(ici, "../../../..");
  const src = fs.readFileSync(path.join(racine, "supabase/functions/countersign-proof/index.ts"), "utf8");
  ck("countersign-proof ne référence pas le protocole Record",
    !src.includes("RecordAttestation") && !src.includes("countersign-record"));
  ck("countersign-proof garde son pré-hachage historique",
    src.includes("sha256Bytes") && src.includes("attestationDigest"));
  ck("countersign-proof garde issuer_account_id", src.includes("issuer_account_id"));
  ck("les deux endpoints ont des secrets de clé distincts",
    src.includes("HUMANORIGIN_SERVER_SIGNING_PRIVATE_KEY_B64")
    && fs.readFileSync(path.join(ici, "../index.ts"), "utf8")
        .includes("HUMANORIGIN_RECORD_SIGNING_PRIVATE_KEY_B64"));
  ck("aucune mention fausse de RFC 8785 dans countersign-proof",
    !/RFC\s*8785 JCS\s*\.?\s*\*\//.test(src) && !/RFC 8785 JCS\)/.test(src));
}

console.log("\n── aucun matériel privé dans le dépôt ──");
{
  const dossier = path.resolve(ici, "..");
  const fichiers = [];
  (function marche(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name); f.isDirectory() ? marche(p) : fichiers.push(p); } })(dossier);
  const src = fichiers.map(f => fs.readFileSync(f, "utf8")).join("\n");
  const litteraux = [...src.matchAll(/["'`]([A-Za-z0-9+/]{40,}={0,2})["'`]/g)].map(m => m[1]);
  ck("aucune constante pouvant porter une clé privée", litteraux.length === 0,
    litteraux.map(x => x.slice(0, 12) + "…").join(", "));
  ck("aucun bloc PEM de clé privée", !/BEGIN [A-Z ]*PRIVATE KEY/.test(src));
  ck("aucun fichier de clé versionné",
    !fichiers.some(f => /key\.json$|\.pem$|\.p8$/.test(f)), "");
}

console.log(`\n  ${ok} réussis · ${ko} échoués  →  COUNTERSIGN_RECORD = ${ko === 0 ? "PASS" : "FAIL"}\n`);
process.exit(ko === 0 ? 0 : 1);
