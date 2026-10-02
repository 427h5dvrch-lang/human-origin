// Un rechargement est-il distinguable d'une edition par autre chose que l'evenement ?
// Candidat : l'etat « modifie » du tampon. Une edition dans l'editeur salit le tampon ;
// un rechargement depuis le disque le laisse propre.
const assert = require("assert");
const path = require("path"); const fs = require("fs"); const os = require("os");
const vscode = require("vscode");
const T = path.join(os.tmpdir(), "ho_sonde3");
const pause = (ms) => new Promise(r => setTimeout(r, ms));

describe("Sonde 3 : discriminant edition / rechargement", () => {
  it("isDirty au moment de l'evenement", async () => {
    fs.mkdirSync(T, { recursive: true });
    const p = path.join(T, "d.md"); fs.writeFileSync(p, "depart\n");
    const doc = await vscode.workspace.openTextDocument(p);
    const ed = await vscode.window.showTextDocument(doc);
    const vus = [];
    const abo = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== doc.uri.toString()) return;
      vus.push({ etiquette: null, isDirty: e.document.isDirty, version: e.document.version,
                 n: e.contentChanges.length,
                 total: e.contentChanges.map(c => `-${c.rangeLength}+${c.text.length}`).join(" ") });
    });

    // (a) edition dans l'editeur
    await ed.edit(b => b.insert(doc.positionAt(doc.getText().length), "edition interne\n"));
    await pause(200);
    if (vus.length) vus[vus.length - 1].etiquette = "edition_interne";

    await doc.save(); await pause(250);

    // (b) modification externe, puis rechargement
    fs.writeFileSync(p, "CONTENU ETRANGER\n");
    await pause(1500);
    for (let i = 0; i < vus.length; i++) if (!vus[i].etiquette) vus[i].etiquette = "rechargement?";

    abo.dispose();
    for (const v of vus) console.log(`      ${String(v.etiquette).padEnd(18)} isDirty=${String(v.isDirty).padEnd(5)} version=${v.version} changements=${v.n} (${v.total})`);
    console.log(`      isDirty final : ${doc.isDirty}`);
    assert.ok(true);
  });
});
