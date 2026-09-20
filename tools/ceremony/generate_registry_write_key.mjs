#!/usr/bin/env node
// HumanOrigin — cérémonie de clé ho-registry-write-v1.
//
// Génère la paire Ed25519 DÉDIÉE à l'autorisation d'écriture au registre, vérifie qu'elle
// fonctionne réellement, et n'émet la clé privée que vers la destination choisie.
//
// Clé strictement distincte de ho-record-server-v1 : protocoles séparés, rotation
// indépendante, rayon d'explosion borné. Ce fichier ne partage aucun code avec
// generate_record_key.mjs — celui-ci est la trace d'audit d'une clé DÉJÀ EN SERVICE et ne
// doit pas bouger parce qu'une autre cérémonie évolue.
//
// LA CLÉ PRIVÉE N'EST JAMAIS : affichée, journalisée, commitée, placée dans argv, ni
// intégrée à un binaire. Seuls le key_id, la clé publique et son empreinte SHA-256 sont
// destinés à être conservés et montrés.
//
// Deux destinations, à la différence de la cérémonie ho-record-server-v1 :
//   PRIVÉ  → secret Supabase, lu par la fonction reserve-record-id
//   PUBLIC → variable d'environnement Netlify, lue par le registre
//
// Modes — aucun par défaut, pour qu'aucune exécution accidentelle ne produise de clé :
//
//   --dry-run
//       Vérifie la chaîne complète avec une paire JETABLE étiquetée TEST-ONLY.
//       N'écrit aucun fichier, n'émet aucun contenu de secret. À lancer AVANT le réel.
//
//   --stdout-env
//       Émet le contenu .env sur la sortie standard, pour un tube direct :
//         node generate_registry_write_key.mjs --stdout-env --public-out ~/recu.txt \
//           | supabase secrets set --env-file /dev/stdin
//       La clé privée ne touche alors aucun disque et n'entre dans aucun historique.
//       Si la commande échoue, aucune clé n'est conservée : relancer la cérémonie.
//
//   --env-file <chemin>
//       Écrit le .env à ce chemin, en 0600. À importer puis à supprimer :
//         supabase secrets set --env-file <chemin>
//         node generate_registry_write_key.mjs --verify-deleted <chemin>
//
//   --public-out <chemin>
//       Écrit le REÇU PUBLIC : key_id, clé publique, empreinte, et la ligne d'environnement
//       Netlify prête à recopier. Ce fichier ne contient AUCUN secret.
//       Fortement recommandé avec --stdout-env : sans lui, fermer le terminal après un tube
//       réussi laisserait une clé privée chez Supabase dont la clé publique serait perdue —
//       `supabase secrets list` n'en restitue qu'un condensé.
//       NE PAS SUPPRIMER CE REÇU AVANT UN SMOKE TEST D'ÉCRITURE RÉUSSI.
//
//   --verify-deleted <chemin>
//       Contrôle qu'un fichier .env temporaire a bien disparu.
//
// Dans tous les cas, le récapitulatif public part sur stderr : il ne pollue pas le tube.

import fs from "node:fs";
import path from "node:path";

const KEY_ID = "ho-registry-write-v1";
const SECRET_PRIVEE = "HUMANORIGIN_REGISTRY_WRITE_PRIVATE_KEY_B64";
const SECRET_KEY_ID = "HUMANORIGIN_REGISTRY_WRITE_KEY_ID";
const VAR_PUBLIQUE = "HUMANORIGIN_REGISTRY_WRITE_PUBLIC_KEYS";
const DEFI = "HumanOrigin.RegistryWrite/v1 ceremony self-check";

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
const recuPublic = val("--public-out");
if (!dry && !versStdout && !versFichier) {
  err("Aucun mode choisi. Rien n'a été généré.");
  err("  --dry-run                 vérifie la chaîne, aucune clé conservée");
  err("  --stdout-env              émet le .env sur stdout, pour un tube");
  err("  --env-file <chemin>       écrit le .env en 0600");
  err("  --public-out <chemin>     écrit le reçu PUBLIC (aucun secret)");
  err("  --verify-deleted <chemin> contrôle qu'un fichier a bien disparu");
  process.exit(2);
}
if (versStdout && versFichier) { err("--stdout-env et --env-file sont exclusifs"); process.exit(2); }
if (a("--public-out") && !recuPublic) { err("--public-out attend un chemin"); process.exit(2); }

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
ck("base64 STANDARD, tel que le registre le décode par atob()",
  /^[A-Za-z0-9+/]+={0,2}$/.test(publiqueB64));
// Le registre découpe « key_id:cle » au PREMIER deux-points, les paires étant séparées
// par des virgules : ni l'un ni l'autre ne doit apparaître dans le matériel.
ck("la valeur d'environnement reste analysable (ni ':' ni ',')",
  !publiqueB64.includes(":") && !publiqueB64.includes(",") &&
  !keyId.includes(":") && !keyId.includes(","));

const octets = (b64) => new Uint8Array(Buffer.from(b64, "base64"));
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

// --- 3. reçu public : aucun secret, jamais la clé privée
const ligneEnv = `${VAR_PUBLIQUE}=${keyId}:${publiqueB64}`;
const recu = [
  "# HumanOrigin — reçu PUBLIC de cérémonie. Aucun secret dans ce fichier.",
  `# émis le ${new Date().toISOString()}`,
  ...(dry ? ["#", "# ⚠ ESSAI À BLANC — paire JETABLE. Ce reçu n'a AUCUNE valeur de production.",
             "# Le key_id ci-dessous est volontairement inutilisable.", "#"] : []),
  "",
  `key_id      : ${keyId}`,
  `public_key  : ${publiqueB64}`,
  `fingerprint : ${empreinte}`,
  "",
  "# Variable d'environnement Netlify du site du registre, à recopier telle quelle.",
  "#   scope   : Functions",
  "#   contexte: Production",
  "# Toute modification de cette variable exige un NOUVEAU DEPLOY pour prendre effet,",
  "# puis la suppression des deploys portant encore l'ancienne valeur.",
  ligneEnv,
  "",
].join("\n");

if (dry) {
  err("\n── ESSAI À BLANC ──");
  err("  Aucune clé de production générée. Aucun fichier écrit. Aucun secret émis.");
  err(`  La paire jetable était étiquetée « ${keyId} » et disparaît avec ce processus.`);
  err("  La chaîne complète est vérifiée : génération, export, réimport, signature, rejet.");
  if (recuPublic) {
    // Le reçu EST écrit en essai à blanc : c'est ce qui rend ce chemin testable sans
    // jamais produire de matériel étiqueté production. Le key_id y vaut TEST-ONLY-dry-run.
    const p = path.resolve(recuPublic);
    fs.writeFileSync(p, recu, { mode: 0o600, flag: "wx" });
    err(`  reçu d'ESSAI écrit : ${p} — à supprimer, il ne vaut rien.`);
  }
  process.exit(0);
}

if (recuPublic) {
  const p = path.resolve(recuPublic);
  fs.writeFileSync(p, recu, { mode: 0o600, flag: "wx" });
  err(`\n  reçu public écrit : ${p}`);
}

// --- 4. sortie du SECRET
const contenuEnv = `${SECRET_PRIVEE}=${priveeB64}\n${SECRET_KEY_ID}=${keyId}\n`;

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

// --- 5. matériel public, seul à conserver et seul montrable
err("\n── matériel PUBLIC — les seules valeurs à conserver et à montrer ──");
err(`  key_id      : ${keyId}`);
err(`  public_key  : ${publiqueB64}`);
err(`  fingerprint : ${empreinte}`);
err("\n  ligne d'environnement Netlify — scope Functions, contexte Production :");
err(`  ${ligneEnv}`);
err("\n── suite ──");
if (versFichier) {
  err(`  supabase secrets set --env-file ${path.resolve(versFichier)}`);
  err(`  rm ${path.resolve(versFichier)}`);
  err(`  node ${path.relative(process.cwd(), process.argv[1])} --verify-deleted ${path.resolve(versFichier)}`);
} else {
  err("  le contenu du secret est parti sur stdout : rien n'a touché le disque.");
}
err(`  puis poser ${VAR_PUBLIQUE} chez Netlify, et REDÉPLOYER le registre.`);
if (recuPublic) {
  err(`\n  NE SUPPRIMEZ PAS ${path.resolve(recuPublic)} avant un smoke test d'écriture réussi.`);
} else {
  err("\n  ⚠ aucun --public-out : le matériel public n'existe que dans ce terminal.");
  err("    Recopiez-le MAINTENANT. Perdu, il impose de refaire la cérémonie.");
}
err("\n  LA CLÉ PRIVÉE N'A PAS ÉTÉ AFFICHÉE. Ne la copiez nulle part.\n");
