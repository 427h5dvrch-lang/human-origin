// La question décisive : quand VS Code recharge un document modifié sur disque, émet-il
// des événements de changement ? Si oui, un changement EXTERIEUR entrerait dans la chaîne
// observée comme s'il avait été observé. C'est le pire cas possible.
const assert = require("assert");
const path = require("path"); const fs = require("fs"); const os = require("os");
const vscode = require("vscode");

const T = path.join(os.tmpdir(), "ho_sonde2");
const pause = (ms) => new Promise(r => setTimeout(r, ms));

describe("Sonde 2 : le rechargement est-il observable ?", () => {
  it("modification externe apres sauvegarde : evenements, tampon, disque", async () => {
    fs.mkdirSync(T, { recursive: true });
    const p = path.join(T, "reload.md");
    fs.writeFileSync(p, "depart\n");
    const doc = await vscode.workspace.openTextDocument(p);
    const ed = await vscode.window.showTextDocument(doc);

    // Un "shadow" tenu par NOUS, à partir des seuls événements reçus.
    let shadow = doc.getText();
    const journal = [];
    const abo = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== doc.uri.toString()) return;
      journal.push({ n: e.contentChanges.length, reason: e.reason,
        apercu: e.contentChanges.map(c => `@${c.rangeOffset} -${c.rangeLength} +${c.text.length}`).join(" ") });
      // Appliquer les changements au shadow, dans l'ordre inverse des offsets.
      const cs = [...e.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);
      for (const c of cs) shadow = shadow.slice(0, c.rangeOffset) + c.text + shadow.slice(c.rangeOffset + c.rangeLength);
    });

    await ed.edit(b => b.insert(doc.positionAt(doc.getText().length), "ecrit sous observation\n"));
    await doc.save(); await pause(300);
    console.log(`      apres edition observee : shadow==buffer ? ${shadow === doc.getText()}`);

    const avantExterne = journal.length;
    fs.writeFileSync(p, "CONTENU ENTIEREMENT ETRANGER\n");
    for (const d of [300, 1000, 2500]) {
      await pause(d === 300 ? 300 : d - (d === 1000 ? 300 : 1000));
      console.log(`      +${d}ms : evenements=${journal.length - avantExterne}  buffer=${JSON.stringify(doc.getText().slice(0, 30))}  disque=${JSON.stringify(fs.readFileSync(p, "utf8").slice(0, 30))}`);
    }
    abo.dispose();
    console.log(`      shadow == buffer ? ${shadow === doc.getText()}`);
    console.log(`      shadow == disque ? ${shadow === fs.readFileSync(p, "utf8")}`);
    console.log(`      evenements dus au rechargement : ${journal.length - avantExterne}`);
    if (journal.length > avantExterne) {
      console.log(`      detail : ${JSON.stringify(journal.slice(avantExterne))}`);
    }
    assert.ok(true, "sonde : on consigne");
  });
});
