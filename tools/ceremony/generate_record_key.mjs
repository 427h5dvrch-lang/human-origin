#!/usr/bin/env node
// HumanOrigin — cérémonie de clé ho-record-server-v1.
//
// Génère une paire Ed25519 pour l'endpoint countersign-record, vérifie qu'elle
// fonctionne réellement, et n'émet la clé privée que vers la destination choisie.
//
// LA CLÉ PRIVÉE N'EST JAMAIS : affichée, journalisée, commitée, placée dans argv,
// ni intégrée à un binaire. Seules la clé publique, le key_id et l'empreinte SHA-256
// de la clé publique sont destinés à être conservés et montrés.
//
// Modes — aucun par défaut, pour qu'aucune exécution accidentelle ne produise de clé :
//
//   --dry-run
//       Vérifie la chaîne complète avec une paire JETABLE étiquetée TEST-ONLY.
//       N'écrit aucun fichier, n'émet aucun contenu de secret. À lancer AVANT le réel.
//
//   --stdout-env
//       Émet le contenu .env sur la sortie standard, pour un tube direct :
//         node generate_record_key.mjs --stdout-env | supabase secrets set --env-file /dev/stdin
//       La clé privée ne touche alors aucun disque et n'entre dans aucun historique.
//       Si la commande échoue, aucune clé n'est conservée : relancer la cérémonie.
//
//   --env-file <chemin>
//       Écrit le .env à ce chemin, en 0600. À importer puis à supprimer :
//         supabase secrets set --env-file <chemin> && node generate_record_key.mjs --verify-deleted <chemin>
//
// Dans tous les cas, le récapitulatif public part sur stderr : il ne pollue pas le tube.

import fs from "node:fs";
import path from "node:path";

const KEY_ID = "ho-record-server-v1";
const SECRET_PRIVEE = "HUMANORIGIN_RECORD_SIGNING_PRIVATE_KEY_B64";
const SECRET_KEY_ID = "HUMANORIGIN_RECORD_KEY_ID";
const DEFI = "HumanOrigin.RecordAttestation/v1 ceremony self-check";

const args = process.argv.slice(2);
const a = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const err = (...m) => console.error(...m);

// --- vérification de suppression, mode autonome
if (a("--verify-deleted")) {
  const p = val("--verify-deleted");
  if (!p) { err("chemin manquant"); process.exit(2); }
  if (fs.existsSync(p)) {
    err("✗ LE FICHIER EXISTE ENCORE :", p);
    err("  supprimez-le, puis relancez cette vérification.");
    process.exit(1);
  }
  err("✓ fichier absent :", p);
  err("  note : sur APFS, une suppression ne garantit pas l'effacement des blocs.");
  err("  la seule voie sans résidu disque est --stdout-env.");
  process.exit(0);
}

const dry = a("--dry-run");
const versStdout = a("--stdout-env");
const versFichier = val("--env-file");
if (!dry && !versStdout && !versFichier) {
  err("Aucun mode choisi. Rien n'a été généré.");
  err("  --dry-run                 vérifie la chaîne, aucune clé conservée");
  err("  --stdout-env              émet le .env sur stdout, pour un tube");
  err("  --env-file <chemin>       écrit le .env en 0600");
  err("  --verify-deleted <chemin> contrôle qu'un fichier a bien disparu");
  process.exit(2);
}
if (versStdout && versFichier) { err("--stdout-env et --env-file sont exclusifs"); process.exit(2); }

const keyId = dry ? "TEST-ONLY-dry-run" : KEY_ID;

// --- 1. génération, CSPRNG du système, aucune graine déterministe
const paire = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const priveeB64 = Buffer.from(await crypto.subtle.exportKey("pkcs8", paire.privateKey)).toString("base64");
const publiqueBrute = new Uint8Array(await crypto.subtle.exportKey("raw", paire.publicKey));
const publiqueB64 = Buffer.from(publiqueBrute).toString("base64");

// --- 2. contrôles : la paire doit réellement fonctionner, sous les formes exportées
const controles = [];
const ck = (n, c) => { controles.push([n, c]); };

ck("clé publique de 32 octets", publiqueBrute.length === 32);
ck("base64 standard, accepté par Verify", /^[A-Za-z0-9+/]+={0,2}$/.test(publiqueB64));

const octets = (b64) => { const u = Buffer.from(b64, "base64"); return new Uint8Array(u); };
const privRe = await crypto.subtle.importKey("pkcs8", octets(priveeB64), { name: "Ed25519" }, false, ["sign"]);
const pubRe = await crypto.subtle.importKey("raw", octets(publiqueB64), { name: "Ed25519" }, false, ["verify"]);
const msg = new TextEncoder().encode(DEFI);
const sig = await crypto.subtle.sign("Ed25519", privRe, msg);

ck("les formes exportées se réimportent", true);
ck("le défi signé se vérifie avec la clé publique",
  await crypto.subtle.verify("Ed25519", pubRe, sig, msg));
ck("la signature est de 64 octets", new Uint8Array(sig).length === 64);

const autre = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
ck("une autre clé publique ne vérifie pas ce défi",
  !(await crypto.subtle.verify("Ed25519", autre.publicKey, sig, msg)));
ck("un défi modifié ne se vérifie pas",
  !(await crypto.subtle.verify("Ed25519", pubRe, sig, new TextEncoder().encode(DEFI + "x"))));

const empreinte = [...new Uint8Array(await crypto.subtle.digest("SHA-256", publiqueBrute))]
  .map((x) => x.toString(16).padStart(2, "0")).join("");

err("\n── contrôles de la cérémonie ──");
for (const [n, c] of controles) err(`  ${c ? "✓" : "✗"} ${n}`);
if (controles.some(([, c]) => !c)) {
  err("\n✗ CONTRÔLE EN ÉCHEC — rien n'a été émis. Ne pas utiliser cette paire.");
  process.exit(1);
}

// --- 3. sortie
const contenuEnv = `${SECRET_PRIVEE}=${priveeB64}\n${SECRET_KEY_ID}=${keyId}\n`;

if (dry) {
  err("\n── ESSAI À BLANC ──");
  err("  Aucune clé de production générée. Aucun fichier écrit. Aucun secret émis.");
  err(`  La paire jetable était étiquetée « ${keyId} » et disparaît avec ce processus.`);
  err("  La chaîne complète est vérifiée : génération, export, réimport, signature, rejet.");
  process.exit(0);
}

if (versStdout) {
  process.stdout.write(contenuEnv);
} else {
  const p = path.resolve(versFichier);
  fs.writeFileSync(p, contenuEnv, { mode: 0o600, flag: "wx" });
  fs.chmodSync(p, 0o600);
  const m = (fs.statSync(p).mode & 0o777).toString(8);
  err(`\n  fichier écrit : ${p}  (permissions ${m})`);
  if (m !== "600") { err("  ✗ permissions inattendues — supprimez ce fichier et recommencez."); process.exit(1); }
}

// --- 4. matériel public, seul à conserver et seul montrable
err("\n── matériel PUBLIC — les seules valeurs à conserver et à montrer ──");
err(`  key_id                      : ${keyId}`);
err(`  public_key                  : ${publiqueB64}`);
err(`  public_key_sha256_fingerprint: ${empreinte}`);
err("\n── suite ──");
if (versFichier) {
  err(`  supabase secrets set --env-file ${path.resolve(versFichier)}`);
  err(`  rm ${path.resolve(versFichier)}`);
  err(`  node ${path.relative(process.cwd(), process.argv[1])} --verify-deleted ${path.resolve(versFichier)}`);
} else {
  err("  le contenu du secret est parti sur stdout : rien n'a touché le disque.");
}
err("  puis ajouter l'entrée publique dans verify-record/src/trust_keys.js.");
err("\n  LA CLÉ PRIVÉE N'A PAS ÉTÉ AFFICHÉE. Ne la copiez nulle part.\n");
