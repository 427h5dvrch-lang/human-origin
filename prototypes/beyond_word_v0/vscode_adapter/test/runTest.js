// Télécharge une build de VS Code DANS ce dossier et l'exécute avec un profil isolé.
// Le VS Code de Philippe et ses extensions ne sont jamais touchés.
const path = require("path");
const { runTests } = require("@vscode/test-electron");
const os = require("os");
const fs = require("fs");

// Profil isole et COURT. Le VS Code de l'utilisateur et ses extensions ne sont jamais
// touches : ce banc ne lit ni n'ecrit dans ~/Library/Application Support/Code.
const profil = path.join(os.homedir(), ".ho-vsc");
fs.mkdirSync(profil, { recursive: true });

(async () => {
  try {
    // Ce banc peut etre lance depuis un hote d'extensions VS Code, qui positionne
    // ELECTRON_RUN_AS_NODE=1. Herite tel quel, le binaire telecharge demarre en
    // interpreteur Node et rejette toutes les options de VS Code comme « bad option ».
    // Il faut retirer la variable AVANT de lancer.
    delete process.env.ELECTRON_RUN_AS_NODE;
    await runTests({
      // Version EPINGLEE. VS Code 1.140 sur macOS place un lanceur de 67 Ko dans
      // Contents/MacOS/Code, qui n'accepte aucune option Electron : test-electron 3.1 ne
      // sait pas le piloter. Une version anterieure garde la structure attendue.
      version: "1.96.4",
      extensionDevelopmentPath: path.resolve(__dirname, ".."),
      extensionTestsPath: path.resolve(__dirname, "./suite/index.js"),
      launchArgs: [
        // La forme avec « = » est la seule que le binaire accepte ici. Et le chemin doit
        // rester COURT : VS Code y cree un socket IPC dont le nom est plafonne a 103
        // caracteres. Un profil pose dans l'arborescence du depot depasse cette limite.
        `--user-data-dir=${profil}`,
        `--extensions-dir=${path.join(profil, "ext")}`,
        "--disable-extensions",      // aucune autre extension : l'observation reste propre
        "--disable-gpu",
        "--no-sandbox",
      ],
    });
  } catch (e) {
    console.error("echec du banc :", e);
    process.exit(1);
  }
})();
