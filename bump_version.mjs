import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const newVersion = process.argv[2];
const doGit = process.argv.includes("--git");
const doTag = process.argv.includes("--tag"); // nécessite --git
const doCargo = process.argv.includes("--cargo"); // optionnel

if (!newVersion) {
  console.log("Usage: node bump_version.mjs 0.1.1 [--git --tag --cargo]");
  process.exit(1);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}
function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}
function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

// 1) package.json
const pkgPath = path.resolve("./package.json");
const pkg = readJson(pkgPath);
pkg.version = newVersion;
writeJson(pkgPath, pkg);
console.log(`✅ package.json → ${newVersion}`);

// 2) src-tauri/tauri.conf.json (JSON only)
const tauriPath = path.resolve("./src-tauri/tauri.conf.json");
if (exists(tauriPath)) {
  const tauri = readJson(tauriPath);
  tauri.package ??= {};
  tauri.package.version = newVersion;
  writeJson(tauriPath, tauri);
  console.log(`✅ src-tauri/tauri.conf.json → ${newVersion}`);
} else {
  console.warn("⚠️ src-tauri/tauri.conf.json introuvable (skip)");
}

// 3) Cargo.toml (optionnel)
if (doCargo) {
  const cargoPath = path.resolve("./src-tauri/Cargo.toml");
  if (exists(cargoPath)) {
    const txt = fs.readFileSync(cargoPath, "utf8");
    const next = txt.replace(/(^version\s*=\s*")([^"]+)(")/m, `$1${newVersion}$3`);
    fs.writeFileSync(cargoPath, next);
    console.log(`✅ src-tauri/Cargo.toml → ${newVersion}`);
  } else {
    console.warn("⚠️ src-tauri/Cargo.toml introuvable (skip)");
  }
}

// 4) Git (optionnel)
if (doGit) {
  console.log("📦 Git add/commit...");
  run("git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml 2>/dev/null || true");

  try {
    run(`git commit -m "chore(release): v${newVersion}"`);
  } catch {
    console.warn("⚠️ Commit non créé (rien à commit ou erreur).");
  }

  if (doTag) {
    console.log(`🏷️ Tag v${newVersion}`);
    try {
      run(`git tag v${newVersion}`);
    } catch {
      console.warn("⚠️ Tag non créé (existe déjà ?).");
    }
  }

  console.log(`🚀 Push: git push origin main${doTag ? " --tags" : ""}`);
} else {
  console.log("ℹ️ Git skip. Ajoute --git (et --tag) si tu veux automatiser.");
}
