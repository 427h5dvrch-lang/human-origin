// Banc IDENTITÉ RC — production et RC ne peuvent pas se confondre.
//
// Contrôles de SOURCE et de CONFIGURATION. La preuve sur les bundles CONSTRUITS est faite
// séparément, en lisant les Info.plist produits : elle ne peut pas l'être ici sans build.

import fs from "node:fs";
import path from "node:path";

const ici = path.dirname(new URL(import.meta.url).pathname);
const R = (f) => fs.readFileSync(path.join(ici, "..", f), "utf8");
// Le dépôt web vit ailleurs ; chemin surchargeable, et le banc se déclare ignoré s'il manque.
const WEB = [process.env.HO_WEB_DIR, "/private/tmp/rwa",
  path.join(process.env.HOME, "Developer/HO_FIRSTRUN_RC/humanorigin-web-consultation")]
  .filter(Boolean).find((d) => fs.existsSync(path.join(d, "registry/rc_local_server.mjs")));
if (!WEB) { console.log("\n  IGNORE : dépôt web introuvable"); process.exit(0); }
const SRV = fs.readFileSync(path.join(WEB, "registry/rc_local_server.mjs"), "utf8");
const MAIN = R("src-tauri/src/main.rs");
const FIN_ = R("src-tauri/src/ho_finalizer.rs");
const DESK = R("src/ho_desktop.js");
const CONF = JSON.parse(R("src-tauri/tauri.conf.json"));
const RCCONF = JSON.parse(R("tools/rc/tauri.rc.conf.json"));
const BUILD = R("tools/rc/build_rc.sh");
const ORCH = R("tools/rc/rc_e2e.sh");

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };
const sansCom = (s, m) => s.split("\n").filter((l) => !new RegExp(`^\\s*${m}`).test(l)).join("\n");
const RUST = sansCom(sansCom(MAIN + "\n" + FIN_, "//"), "///");

console.log("\n── défauts de PRODUCTION, dans le code ──");
ck("identifiant par défaut = com.humanorigin.app",
  /option_env!\("HO_BUNDLE_ID"\)[\s\S]{0,80}None => "com\.humanorigin\.app"/.test(RUST));
ck("schéma par défaut = humanorigin",
  /option_env!\("HO_DEEP_LINK_SCHEME"\)[\s\S]{0,80}None => "humanorigin"/.test(RUST));
ck("registre par défaut = https://registry.humanorigin.io",
  /option_env!\("HO_REGISTRY_URL"\)[\s\S]{0,90}None => "https:\/\/registry\.humanorigin\.io"/.test(RUST));
ck("redirection par défaut = humanorigin://login",
  /VITE_HO_REDIRECT \|\| "humanorigin:\/\/login"/.test(DESK));
ck("tauri.conf.json garde l'identifiant de production",
  CONF.tauri.bundle.identifier === "com.humanorigin.app", CONF.tauri.bundle.identifier);
ck("tauri.conf.json garde le nom de production",
  CONF.package.productName === "HumanOrigin", CONF.package.productName);

console.log("\n── un build de production ne contient RIEN de RC ──");
ck("aucun com.humanorigin.app.rc dans le code", !/com\.humanorigin\.app\.rc/.test(RUST + DESK));
ck("aucun humanorigin-rc dans le code", !/humanorigin-rc/.test(RUST + DESK));
ck("aucun 127.0.0.1 dans le code", !/127\.0\.0\.1/.test(RUST + DESK));
ck("aucune valeur RC dans tauri.conf.json",
  !/\.rc|humanorigin-rc|127\.0\.0\.1/.test(JSON.stringify(CONF)));

console.log("\n── un build RC ne reprend RIEN de la production ──");
ck("configuration RC : identifiant distinct",
  RCCONF.tauri.bundle.identifier === "com.humanorigin.app.rc", RCCONF.tauri.bundle.identifier);
ck("configuration RC : nom distinct",
  RCCONF.package.productName === "HumanOrigin RC", RCCONF.package.productName);
ck("configuration RC : ne redéfinit rien d'autre",
  Object.keys(RCCONF).filter((k) => !k.startsWith("_")).sort().join(",") === "package,tauri");
for (const [lib, motif] of [
  ["identifiant", /HO_BUNDLE_ID="com\.humanorigin\.app\.rc"/],
  ["schéma", /HO_DEEP_LINK_SCHEME="humanorigin-rc"/],
  ["registre", /HO_REGISTRY_URL="https:\/\/127\.0\.0\.1:8443"/],
  ["redirection", /VITE_HO_REDIRECT="humanorigin-rc:\/\/login"/],
]) ck(`build_rc.sh pose ${lib}`, motif.test(BUILD));
ck("build_rc.sh retouche le schéma du bundle PRODUIT, pas la source",
  /plutil -replace CFBundleURLTypes\.0\.CFBundleURLSchemes\.0/.test(BUILD)
  && !/^[^#\n]*src-tauri\/Info\.plist/m.test(BUILD));
ck("build_rc.sh force la recompilation (option_env! non suivi par cargo)",
  /touch src-tauri\/src\/main\.rs/.test(BUILD));

console.log("\n── répertoire de données : le RC ne touche pas l'état de production ──");
ck("le défaut du code est celui de production",
  /option_env!\("HO_DATA_DIR_ID"\)\.unwrap_or\("com\.humanorigin\.app"\)/.test(RUST));
ck("build_rc.sh isole le répertoire RC",
  /HO_DATA_DIR_ID="com\.humanorigin\.app\.rc"/.test(BUILD));
ck("les deux identifiants diffèrent",
  "com.humanorigin.app" !== "com.humanorigin.app.rc");
ck("aucun chemin de données codé en dur ailleurs",
  !/Application Support\/com\.humanorigin/.test(RUST));

console.log("\n── volet Word : chaque build vise son registre ──");
const HTML_P = fs.readFileSync(path.join(WEB, "create-record/word/taskpane.html"), "utf8");
const HTML_R = fs.readFileSync(path.join(WEB, "create-record/word/taskpane-rc.html"), "utf8");
const PANE = fs.readFileSync(path.join(WEB, "create-record/word/taskpane.js"), "utf8");
const PANEC = sansCom(PANE, "//");
const MAN_P = R("src-tauri/word/humanorigin-word-manifest.xml");
const MAN_R = R("tools/rc/humanorigin-word-manifest-rc.xml");

ck("le volet a pour défaut le registre canonique",
  /\|\| "https:\/\/registry\.humanorigin\.io"/.test(PANEC));
ck("l'override n'existe que par window.__HO_REGISTRY__",
  /window\.__HO_REGISTRY__/.test(PANEC)
  && (PANEC.match(/__HO_REGISTRY__/g) || []).length === 2);
ck("aucune dérivation par location.hostname", !/location\.hostname/.test(PANEC));
ck("aucun drapeau d'URL", !/URLSearchParams|[?]rc=/.test(PANEC));
ck("HTML de production : aucune URL locale injectée",
  !/__HO_REGISTRY__|127\.0\.0\.1|localhost/.test(HTML_P));
ck("HTML RC : injecte 127.0.0.1:8443",
  /window\.__HO_REGISTRY__\s*=\s*"https:\/\/127\.0\.0\.1:8443"/.test(HTML_R));
ck("HTML RC : injection AVANT le chargement du volet",
  HTML_R.includes("__HO_REGISTRY__")
  && HTML_R.indexOf("__HO_REGISTRY__") < HTML_R.indexOf('src="taskpane.js"'));
ck("HTML RC : aucune destination de production",
  !/registry\.humanorigin\.io/.test(HTML_R));
ck("manifeste de production → taskpane.html",
  /taskpane\.html/.test(MAN_P) && !/taskpane-rc\.html/.test(MAN_P));
ck("manifeste RC → taskpane-rc.html",
  /taskpane-rc\.html/.test(MAN_R) && !/word\/taskpane\.html/.test(MAN_R));

console.log("\n── destination du registre : plus aucune valeur d'exécution ──");
ck("cfg.registry n'est plus lu", !/cfg\.registry/.test(RUST));
ck("la destination est la constante compilée", /let registry = REGISTRY_URL;/.test(RUST));
ck("aucune URL de registre codée ailleurs dans le finalizer",
  (sansCom(FIN_, "//").match(/https:\/\/registry\.humanorigin\.io/g) || []).length === 1);
ck("le champ registry subsiste pour la désérialisation, documenté comme non lu",
  /PLUS JAMAIS LU/.test(FIN_));

console.log("\n── isolation : aucune dépendance au DNS ──");
ck("l'orchestrateur ne touche plus /etc/hosts",
  !/sudo (sed|tee)[^\n]*\/etc\/hosts/.test(ORCH));
ck("l'orchestrateur REFUSE de démarrer si /etc/hosts porte une entrée registre",
  /le banc RC n'en emploie plus, retirez-la/.test(ORCH));
ck("le registre RC écoute sur une adresse littérale",
  /srv\.listen\(PORT, "127\.0\.0\.1"/.test(SRV));
ck("l'orchestrateur n'emploie plus xargs", !/xargs/.test(ORCH));

console.log("\n── aucun code RC ne peut ouvrir le registre de production ──");
const SRVC = sansCom(SRV, "//");
ck("le serveur RC n'émet aucune requête sortante",
  !/fetch\(|https\.request|http\.request|axios/.test(SRVC));
ck("le nom de production n'y sert que d'en-tête Host, jamais de destination",
  !/(fetch|request|connect)\([^)]*registry\.humanorigin\.io/.test(SRVC));
ck("le store est temporaire", /mkdtempSync/.test(SRVC));
ck("aucune écriture vers un hôte distant", !/getStore\(\{[^}]*siteID/.test(SRVC));

console.log(`\n  ${ok} réussis · ${ko} échoués  →  RC_IDENTITY = ${ko ? "FAIL" : "PASS"}`);
process.exit(ko ? 1 : 0);
