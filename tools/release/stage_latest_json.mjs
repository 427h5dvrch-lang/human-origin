// Fabrique latest.json pour une release macOS, à partir des artefacts réels.
//
// Pourquoi un script : la signature minisign fait 420 caractères. La recopier à la main est
// une invitation à l'erreur silencieuse — un updater qui refuse la mise à jour, et personne
// qui comprend pourquoi. Ici, elle est lue dans le fichier .sig, jamais retapée.
//
// Le fichier produit n'est PAS publié. Il est écrit où on le lui dit, et c'est tout.
//
//   node tools/release/stage_latest_json.mjs --version 0.3.3 \
//        --sig <chemin du .sig> --sortie <chemin de latest.json> [--date <RFC3339>] [--notes "..."]
//
// Windows (facultatif, et SANS AUCUN effet sur la sortie macOS quand il est absent) :
//        --win-archive HumanOrigin_<v>_x64-setup.nsis.zip --win-sig <chemin du .sig>
//
// Avant d'ecrire, le manifeste est verifie sur CINQ axes : plateforme, archive, signature,
// URL, version. latest.json decide ce que les machines deja installees telechargent et
// executent : une entree incoherente ne se voit pas a la lecture, elle se decouvre quand une
// mise a jour echoue — ou, pire, reussit avec le mauvais binaire.
//
import fs from "node:fs";
import path from "node:path";

const arg = (nom, defaut = null) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};

const version = arg("version");
const sig = arg("sig");
const sortie = arg("sortie");
const notes = arg("notes", "Release signed (Developer ID) and notarized.");
const date = arg("date", new Date().toISOString().replace("Z", "000Z").replace(/(\.\d{3})000Z$/, "$1000Z"));
const depot = arg("depot", "427h5dvrch-lang/human-origin");
const archive = arg("archive", "HumanOrigin_aarch64.app.tar.gz");
const winArchive = arg("win-archive");
const winSig = arg("win-sig");

if (!version || !sig || !sortie) {
  console.error("  il manque --version, --sig ou --sortie");
  process.exit(2);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`  version invalide : ${version}`);
  process.exit(2);
}
if (!fs.existsSync(sig)) {
  console.error(`  signature introuvable : ${sig}`);
  process.exit(2);
}

// Les deux options Windows vont ensemble : une archive sans signature produirait une entree
// que l'updater refuserait, et une signature sans archive ne designerait rien.
if ((winArchive && !winSig) || (!winArchive && winSig)) {
  console.error("  --win-archive et --win-sig vont ensemble");
  process.exit(2);
}
if (winSig && !fs.existsSync(winSig)) {
  console.error(`  signature Windows introuvable : ${winSig}`);
  process.exit(2);
}

const signature = fs.readFileSync(sig, "utf8").trim();
// Une signature minisign encodée en base64 fait 420 caractères dans cette chaîne de release.
// Un .sig vide ou tronqué produirait un latest.json que l'updater rejetterait en silence.
if (signature.length < 300 || /\s/.test(signature)) {
  console.error(`  signature suspecte : ${signature.length} caractères`);
  process.exit(2);
}

const lien = (nom) => `https://github.com/${depot}/releases/download/v${version}/${nom}`;
const url = lien(archive);
const plateforme = { signature, url };
const doc = {
  version,
  notes,
  pub_date: date,
  platforms: {
    "darwin-aarch64": plateforme,
    "darwin-aarch64-app": plateforme,
  },
};

// --- Windows, ajoute seulement si demande. L'ordre des cles macOS reste inchange.
let winSignature = null;
if (winArchive) {
  winSignature = fs.readFileSync(winSig, "utf8").trim();
  if (winSignature.length < 300 || /\s/.test(winSignature)) {
    console.error(`  signature Windows suspecte : ${winSignature.length} caracteres`);
    process.exit(2);
  }
  doc.platforms["windows-x86_64"] = { signature: winSignature, url: lien(winArchive) };
}

// --- Verification sur cinq axes. Rien n'est ecrit si un seul manquement subsiste.
// Conventions constatees sur les artefacts REELS, jamais supposees :
//   darwin  HumanOrigin_aarch64.app.tar.gz            ne porte pas la version
//   windows HumanOrigin_<v>_x64-setup.nsis|msi.zip    porte la version
const CONNUES = {
  "darwin-aarch64":     { suffixes: [".app.tar.gz"], porteVersion: false },
  "darwin-aarch64-app": { suffixes: [".app.tar.gz"], porteVersion: false },
  "windows-x86_64":     { suffixes: [".nsis.zip", ".msi.zip"], porteVersion: true },
};
const PREFIXE_MINISIGN = "dW50cnVzdGVkIGNvbW1lbnQ6";   // base64 de « untrusted comment: »

// Un .sig Tauri, decode, contient quatre lignes dont deux exploitables ici :
//   [1] algo (2 octets) + key id (8 octets) + signature
//   [3] « trusted comment: timestamp:... file:<nom de l archive> »
// Le commentaire de confiance est SIGNE : il nomme le fichier reellement signe. C est le seul
// controle non circulaire disponible sans faire de cryptographie, et il attrape exactement
// l erreur dangereuse — recopier le .sig d un AUTRE artefact.
function detaillerSignature(signatureBase64) {
  let lignes;
  try { lignes = Buffer.from(signatureBase64, "base64").toString("utf8").split(/\r?\n/); }
  catch { return null; }
  const corps = lignes[1];
  const confiance = lignes.find((l) => l.startsWith("trusted comment:")) || "";
  const m = /file:(\S+)/.exec(confiance);
  let keyId = null;
  try { keyId = Buffer.from(corps, "base64").subarray(2, 10).toString("hex"); } catch { /* laisse null */ }
  return { keyId, fichierSigne: m ? m[1] : null };
}

// Key id de la cle publique de l updater, lue dans la configuration : la signature doit en venir.
function keyIdAttendu() {
  try {
    const conf = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const lignes = Buffer.from(conf.tauri.updater.pubkey, "base64").toString("utf8").split(/\r?\n/);
    return Buffer.from(lignes[1], "base64").subarray(2, 10).toString("hex");
  } catch { return null; }
}
const KEY_ID = keyIdAttendu();

const attendus = { "darwin-aarch64": { nom: archive, sigPath: sig },
                   "darwin-aarch64-app": { nom: archive, sigPath: sig } };
if (winArchive) attendus["windows-x86_64"] = { nom: winArchive, sigPath: winSig };

const manquements = [];
const ko = (axe, m) => manquements.push(`${axe} : ${m}`);
for (const [clef, p] of Object.entries(doc.platforms)) {
  const spec = CONNUES[clef], att = attendus[clef];
  if (!spec) { ko("plateforme", `cle « ${clef} » inconnue de l'updater`); continue; }
  if (!spec.suffixes.some((x) => att.nom.endsWith(x)))
    ko("plateforme", `« ${clef} » : archive « ${att.nom} » hors des suffixes ${spec.suffixes.join(" ou ")}`);
  const base = String(p.url).split("/").pop();
  if (base !== att.nom) ko("archive", `« ${clef} » : l'URL designe « ${base} », l'archive est « ${att.nom} »`);
  if (p.url !== lien(att.nom)) ko("url", `« ${clef} » : URL inattendue — ${p.url}`);
  if (!p.signature.startsWith(PREFIXE_MINISIGN))
    ko("signature", `« ${clef} » : la signature n'est pas un bloc minisign`);
  // Le .sig emis par Tauri porte le nom de son archive, suffixe de « .sig ». Un fichier de
  // signature qui ne respecte pas cette correspondance ne designe pas cette archive.
  //
  // Ce controle n'est PAS une verification cryptographique : seule la cle publique de
  // l'updater pourrait l'etablir, et c'est l'updater qui le fait a l'installation. Ce que l'on
  // verifie ici, c'est qu'on n'a pas recopie le .sig d'un AUTRE artefact — l'erreur reelle,
  // celle qui produit un manifeste d'apparence correcte et une mise a jour qui echoue.
  if (path.basename(att.sigPath) !== att.nom + ".sig")
    ko("signature", `« ${clef} » : « ${path.basename(att.sigPath)} » n'est pas le .sig de « ${att.nom} »`);
  const d = detaillerSignature(p.signature);
  if (!d) ko("signature", `« ${clef} » : signature illisible`);
  else {
    // Le nom que la signature DECLARE avoir signe doit etre l archive du manifeste.
    if (d.fichierSigne && d.fichierSigne !== att.nom)
      ko("signature", `« ${clef} » : la signature a ete emise pour « ${d.fichierSigne} », pas pour « ${att.nom} »`);
    // Et elle doit venir de la cle updater configuree, pas d une autre.
    if (KEY_ID && d.keyId && d.keyId !== KEY_ID)
      ko("signature", `« ${clef} » : signature emise par la cle ${d.keyId}, attendue ${KEY_ID}`);
  }
  if (spec.porteVersion && !att.nom.includes(version))
    ko("version", `« ${clef} » : l'archive « ${att.nom} » ne porte pas la version ${version}`);
}
if (doc.version !== version) ko("version", `manifeste « ${doc.version} » != attendu « ${version} »`);
// Deux plateformes signent deux artefacts differents : une meme signature sur les deux est
// forcement une recopie.
const parSignature = {};
for (const [clef, p] of Object.entries(doc.platforms)) {
  const nom = attendus[clef] && attendus[clef].nom;
  (parSignature[p.signature] = parSignature[p.signature] || []).push(nom);
}
for (const [, noms] of Object.entries(parSignature)) {
  const distincts = [...new Set(noms)];
  if (distincts.length > 1)
    ko("signature", `une seule signature pour des archives differentes : ${distincts.join(" et ")}`);
}
if (manquements.length) {
  console.error("  MANIFESTE REFUSE — rien n'a ete ecrit :");
  for (const m of manquements) console.error("    " + m);
  process.exit(3);
}

fs.writeFileSync(sortie, JSON.stringify(doc, null, 2) + "\n");
console.log(`  écrit : ${sortie}`);
console.log(`  version    : ${version}`);
console.log(`  archive    : ${archive}`);
console.log(`  signature  : ${signature.length} caractères, lue dans ${sig}`);
if (winArchive) {
  console.log(`  archive win: ${winArchive}`);
  console.log(`  signature w: ${winSignature.length} caracteres, lue dans ${winSig}`);
}
console.log(`  plateformes: ${Object.keys(doc.platforms).join(", ")}`);
console.log(`  verifie    : plateforme, archive, signature, URL, version — 0 manquement`);
