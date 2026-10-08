// Banc de stage_latest_json. Le script n'était couvert par aucun test : il fabrique pourtant
// le seul fichier qui décide ce que les machines déjà installées téléchargent et exécutent.
//
// Deux exigences, dans cet ordre :
//   1. FIDÉLITÉ — sans option Windows, la sortie doit être IDENTIQUE au manifeste public 0.3.4.
//      Sans cette preuve, rien ne garantit que l'ajout de Windows ne déforme pas macOS.
//   2. EXTENSION — avec les options Windows, macOS reste identique et windows-x86_64 s'ajoute.
//
// Les entrées Windows viennent du dry run CI (BANC_DIR), ou de tout dossier contenant
// l'archive *-setup.nsis.zip et son .sig.
//   node tools/release/tests/stage_latest_json.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ICI = path.dirname(new URL(import.meta.url).pathname);
const RACINE = path.join(ICI, "..", "..", "..");
const FIX = path.join(ICI, "fixtures");
const SCRIPT = path.join(RACINE, "tools", "release", "stage_latest_json.mjs");
const BANC = process.env.BANC_DIR || "/tmp/winart/banc";
const BAC = fs.mkdtempSync("/tmp/manifeste-");

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };

const PUBLIC = JSON.parse(fs.readFileSync(path.join(FIX, "latest_public_0.3.4.json"), "utf8"));
const SIG_MAC = path.join(FIX, "HumanOrigin_aarch64.app.tar.gz.sig");
const V = "0.3.4";

function lancer(args) {
  try { return { code: 0, sortie: execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" }) }; }
  catch (e) { return { code: e.status, sortie: (e.stdout || "") + (e.stderr || "") }; }
}
const base = (sortie) => ["--version", V, "--sig", SIG_MAC, "--sortie", sortie,
  "--date", PUBLIC.pub_date, "--notes", PUBLIC.notes];

console.log("\n── 1. fidélité : macOS seul reproduit le manifeste public");
let f = path.join(BAC, "mac.json");
let r = lancer(base(f));
ck("le script réussit", r.code === 0, r.sortie.trim().split("\n").pop());
ck("sortie identique au manifeste public, au caractère près",
   JSON.stringify(JSON.parse(fs.readFileSync(f, "utf8"))) === JSON.stringify(PUBLIC));

console.log("\n── 2. extension windows-x86_64 sur artefacts réels");
const ARCH = fs.existsSync(BANC)
  ? (fs.readdirSync(BANC).find((x) => x.endsWith(".nsis.zip")) || null) : null;
const SIG_WIN = ARCH ? path.join(BANC, ARCH + ".sig") : null;
const dispo = !!(ARCH && fs.existsSync(SIG_WIN));
ck("archive Windows et sa signature présentes", dispo, dispo ? `${ARCH} (${(fs.statSync(path.join(BANC, ARCH)).size / 1048576).toFixed(1)} Mo)` : `absentes de ${BANC}`);
if (!dispo) { console.log("\n  banc interrompu : fournir BANC_DIR\n"); process.exit(2); }

f = path.join(BAC, "win.json");
r = lancer([...base(f), "--win-archive", ARCH, "--win-sig", SIG_WIN]);
ck("le script réussit avec Windows", r.code === 0, r.sortie.trim().split("\n").pop());
const etendu = JSON.parse(fs.readFileSync(f, "utf8"));
ck("windows-x86_64 présent", "windows-x86_64" in etendu.platforms);
ck("les entrées macOS restent identiques au public",
   Object.keys(PUBLIC.platforms).every((k) =>
     JSON.stringify(etendu.platforms[k]) === JSON.stringify(PUBLIC.platforms[k])));
ck("la signature Windows vient du .sig de CETTE archive",
   etendu.platforms["windows-x86_64"].signature === fs.readFileSync(SIG_WIN, "utf8").trim());
ck("l'URL Windows désigne l'archive et le bon tag",
   etendu.platforms["windows-x86_64"].url ===
   `https://github.com/427h5dvrch-lang/human-origin/releases/download/v${V}/${ARCH}`);

console.log("\n── 3. incohérences : rien ne doit être écrit");
const autreSig = path.join(BAC, "autre.sig");
fs.copyFileSync(SIG_MAC, autreSig);
const cas = [
  ["--win-archive sans --win-sig", [...base(path.join(BAC, "a.json")), "--win-archive", ARCH]],
  ["--win-sig sans --win-archive", [...base(path.join(BAC, "b.json")), "--win-sig", SIG_WIN]],
  ["signature Windows introuvable", [...base(path.join(BAC, "c.json")), "--win-archive", ARCH, "--win-sig", path.join(BAC, "absent.sig")]],
  ["archive Windows au mauvais suffixe", [...base(path.join(BAC, "d.json")), "--win-archive", "HumanOrigin_0.3.4_x64-setup.exe", "--win-sig", SIG_WIN]],
  ["archive Windows sans la version", [...base(path.join(BAC, "e.json")), "--win-archive", "HumanOrigin_x64-setup.nsis.zip", "--win-sig", SIG_WIN]],
  ["signature d'un AUTRE artefact", [...base(path.join(BAC, "f.json")), "--win-archive", ARCH, "--win-sig", autreSig]],
  ["version non sémantique", ["--version", "0.3", "--sig", SIG_MAC, "--sortie", path.join(BAC, "g.json")]],
  ["signature macOS introuvable", ["--version", V, "--sig", path.join(BAC, "rien.sig"), "--sortie", path.join(BAC, "h.json")]],
];
for (const [nom, args] of cas) {
  const rr = lancer(args);
  const sortie = args[args.indexOf("--sortie") + 1];
  const refuse = rr.code !== 0 && !fs.existsSync(sortie);
  ck(`refuse : ${nom}`, refuse,
     refuse ? (rr.sortie.trim().split("\n").pop() || "").slice(0, 66) : `code=${rr.code}, fichier écrit=${fs.existsSync(sortie)}`);
}

console.log("\n── 4. le manifeste public n'est jamais touché");
ck("la fixture publique est inchangée",
   JSON.stringify(JSON.parse(fs.readFileSync(path.join(FIX, "latest_public_0.3.4.json"), "utf8"))) === JSON.stringify(PUBLIC));
ck("tout a été écrit dans un bac à sable", BAC.startsWith("/tmp/"), BAC);

console.log(`\n  ${ok} réussis · ${ko} échoués  =>  MANIFESTE_WINDOWS = ${ko ? "NON PRET" : "PRET"}\n`);
process.exit(ko ? 1 : 0);
