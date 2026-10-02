// Sonde : établir ce que VS Code fait VRAIMENT, avant de concevoir quoi que ce soit.
const assert = require("assert");
const path = require("path"); const fs = require("fs"); const os = require("os");
const vscode = require("vscode");

const T = path.join(os.tmpdir(), "ho_sonde");
const pause = (ms) => new Promise(r => setTimeout(r, ms));
function neuf(n, c = "") { fs.mkdirSync(T, { recursive: true }); const p = path.join(T, n); fs.writeFileSync(p, c); return p; }

describe("Sonde : comportement reel de VS Code", () => {

  it("modification sur disque, buffer PROPRE : l'editeur recharge-t-il, et emet-il un evenement ?", async () => {
    const p = neuf("propre.md", "ligne un\n");
    const doc = await vscode.workspace.openTextDocument(p);
    await vscode.window.showTextDocument(doc);
    const vus = [];
    const abo = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === doc.uri.toString())
        vus.push({ n: e.contentChanges.length, reason: e.reason, texte: e.document.getText().length });
    });
    fs.writeFileSync(p, "ligne un\nligne ajoutee par un autre processus\n");
    await pause(3000);                       // large, pour laisser VS Code reagir
    abo.dispose();
    console.log(`      evenements vus : ${vus.length}  ${JSON.stringify(vus)}`);
    console.log(`      texte du document apres : ${JSON.stringify(doc.getText())}`);
    console.log(`      document.isDirty : ${doc.isDirty}`);
    assert.ok(true, "sonde : on consigne, on n'echoue pas");
  });

  it("modification sur disque, buffer SALE : que dit l'editeur ?", async () => {
    const p = neuf("sale.md", "base\n");
    const doc = await vscode.workspace.openTextDocument(p);
    const ed = await vscode.window.showTextDocument(doc);
    await ed.edit(b => b.insert(new vscode.Position(0, 4), " modifie dans le buffer"));
    await pause(100);
    const vus = [];
    const abo = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === doc.uri.toString()) vus.push(e.contentChanges.length);
    });
    fs.writeFileSync(p, "ecrase sur le disque\n");
    await pause(3000);
    abo.dispose();
    console.log(`      isDirty : ${doc.isDirty}  evenements : ${vus.length}`);
    console.log(`      texte du buffer : ${JSON.stringify(doc.getText())}`);
    console.log(`      octets sur disque : ${JSON.stringify(fs.readFileSync(p, "utf8"))}`);
    assert.ok(true);
  });

  it("sauvegarde par VS Code : combien d'ecritures le systeme de fichiers voit-il ?", async () => {
    const p = neuf("save.md", "");
    const doc = await vscode.workspace.openTextDocument(p);
    const ed = await vscode.window.showTextDocument(doc);
    const w = vscode.workspace.createFileSystemWatcher(p.replace(/\\/g, "/"));
    const ev = [];
    w.onDidChange(() => ev.push("change"));
    w.onDidCreate(() => ev.push("create"));
    w.onDidDelete(() => ev.push("delete"));
    await ed.edit(b => b.insert(new vscode.Position(0, 0), "contenu enregistre normalement"));
    await doc.save();
    await pause(2000);
    w.dispose();
    console.log(`      evenements de fichier pour UNE sauvegarde normale : ${ev.length} → ${ev.join(",")}`);
    assert.ok(true);
  });
});
