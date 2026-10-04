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
import fs from "node:fs";

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

const signature = fs.readFileSync(sig, "utf8").trim();
// Une signature minisign encodée en base64 fait 420 caractères dans cette chaîne de release.
// Un .sig vide ou tronqué produirait un latest.json que l'updater rejetterait en silence.
if (signature.length < 300 || /\s/.test(signature)) {
  console.error(`  signature suspecte : ${signature.length} caractères`);
  process.exit(2);
}

const url = `https://github.com/${depot}/releases/download/v${version}/${archive}`;
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

fs.writeFileSync(sortie, JSON.stringify(doc, null, 2) + "\n");
console.log(`  écrit : ${sortie}`);
console.log(`  version    : ${version}`);
console.log(`  archive    : ${archive}`);
console.log(`  signature  : ${signature.length} caractères, lue dans ${sig}`);
console.log(`  plateformes: ${Object.keys(doc.platforms).join(", ")}`);
