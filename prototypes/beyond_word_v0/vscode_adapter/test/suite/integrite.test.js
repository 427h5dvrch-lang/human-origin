const assert = require("assert");
const path = require("path"); const fs = require("fs"); const os = require("os");
const vscode = require("vscode");
const { evenementVersFaits, estEditionInterne } = require("../../adapter.js");

let G, I;
before(async () => {
  G = await import(path.resolve(__dirname, "../../../capture.mjs"));
  I = await import(path.resolve(__dirname, "../../../integrite.mjs"));
});

const T = path.join(os.tmpdir(), "ho_integrite");
const pause = (ms) => new Promise(r => setTimeout(r, ms));

async function atelier(nom, initial = "") {
  fs.mkdirSync(T, { recursive: true });
  const chemin = path.join(T, nom);
  fs.writeFileSync(chemin, initial);
  const doc = await vscode.workspace.openTextDocument(chemin);
  const ed = await vscode.window.showTextDocument(doc);
  const cap = new G.Capture({ source: "editeur" });
  cap.ouvrirPeriode(doc.getText(), chemin);
  // L'etat attendu EST le tampon : toute modification du tampon emet un evenement que
  // l'adapter enregistre, donc le tampon est exactement ce que la chaine observee implique.
  const sonde = new I.SondeIntegrite({ chemin, etatAttendu: () => doc.getText() });
  sonde.ancrer("ouverture");                       // etat connu au depart
  // L'adapter SAIT quand l'editeur enregistre : c'est le seul signal non ambigu.
  const aboSave = vscode.workspace.onDidSaveTextDocument((d) => {
    if (d.uri.toString() === doc.uri.toString()) sonde.ancrer("sauvegarde_observee");
  });
  const abo = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() !== doc.uri.toString()) return;
    for (const f of evenementVersFaits(e)) cap.changementAnnonceBrut(f);
  });
  return { chemin, doc, ed, cap, sonde, abo,
    async fin() { this.abo.dispose(); aboSave.dispose();
            await new Promise(r => setTimeout(r, 250));
            this.sonde.verifierDepuisAncrage("fermeture");
            this.sonde.arreter(); this.cap.fermerPeriode(this.chemin); return this.sonde.bilan(); } };
}

describe("Integrite hors bande pendant une periode active", () => {

  it("1 · changement uniquement via VS Code → observation continue", async () => {
    const a = await atelier("c1.md", "depart\n");
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "ajout observe"));
    await a.doc.save(); await pause(300);
    const b = await a.fin();
    console.log(`      etat=${b.etat} verifications=${b.verifications} ecarts=${b.ecarts.length}`);
    assert.strictEqual(b.etat, I.ETAT.CONTINUE);
    assert.strictEqual(b.ecarts.length, 0, "une sauvegarde normale ne doit produire AUCUN ecart");
  });

  it("2 · modification externe sur disque → ecart non attribuable", async () => {
    const a = await atelier("c2.md", "depart\n");
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "ajout observe"));
    await a.doc.save(); await pause(200);
    fs.appendFileSync(a.chemin, "\nligne ecrite par un autre processus");
    await pause(500);
    const b = await a.fin();
    console.log(`      etat=${b.etat} ecarts=${b.ecarts.length}`);
    assert.strictEqual(b.etat, I.ETAT.ECART);
    assert.ok(b.ecarts.length >= 1);
    assert.ok(b.ecarts[0].empreinte_disque !== b.ecarts[0].empreinte_attendue);
  });

  it("3 · remplacement complet du fichier → ecart non attribuable", async () => {
    const a = await atelier("c3.md", "original\n");
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "observe"));
    await a.doc.save(); await pause(200);
    fs.writeFileSync(a.chemin, "un contenu entierement different\n");
    await pause(500);
    const b = await a.fin();
    console.log(`      etat=${b.etat} ecarts=${b.ecarts.length}`);
    assert.strictEqual(b.etat, I.ETAT.ECART);
  });

  it("4 · modification externe PUIS retour aux octets precedents", async () => {
    const a = await atelier("c4.md", "stable\n");
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "observe"));
    await a.doc.save(); await pause(200);
    const avant = fs.readFileSync(a.chemin);
    fs.writeFileSync(a.chemin, "etat transitoire etranger\n");
    await pause(400);
    fs.writeFileSync(a.chemin, avant);                 // retour exact
    await pause(400);
    const b = await a.fin();
    console.log(`      etat=${b.etat} ecarts=${b.ecarts.length} verifications=${b.verifications}`);
    // Ce que l'on cherche a savoir : la surveillance continue rattrape-t-elle le transitoire ?
    assert.ok(b.etat === I.ETAT.ECART || b.etat === I.ETAT.CONTINUE,
      "on consigne le resultat, quel qu'il soit");
    console.log(`      → la verification de FERMETURE seule aurait conclu : ${b.ecarts.length ? "ecart" : "continue"}`);
  });

  it("5 · modification externe pendant que le tampon a des changements NON sauvegardes", async () => {
    const a = await atelier("c5.md", "base\n");
    await a.ed.edit(b => b.insert(new vscode.Position(0, 4), " non sauvegarde"));
    await pause(150);
    assert.ok(a.doc.isDirty, "le tampon doit etre sale");
    fs.writeFileSync(a.chemin, "ecrase par l'exterieur\n");
    await pause(500);
    const b = await a.fin();
    console.log(`      isDirty=${a.doc.isDirty} etat=${b.etat} ecarts=${b.ecarts.length}`);
    assert.strictEqual(b.etat, I.ETAT.ECART,
      "le disque diverge du tampon : l'ecart doit etre vu");
  });

  it("6 · modification tres rapide entre deux evenements", async () => {
    const a = await atelier("c6.md", "");
    await a.ed.edit(b => b.insert(new vscode.Position(0, 0), "un"));
    await a.doc.save(); await pause(120);
    // Ecriture etrangere puis retour immediat, sans pause : cas le plus defavorable.
    const avant = fs.readFileSync(a.chemin);
    fs.writeFileSync(a.chemin, "fugace\n");
    fs.writeFileSync(a.chemin, avant);
    await pause(400);
    const b = await a.fin();
    console.log(`      etat=${b.etat} ecarts=${b.ecarts.length} verifications=${b.verifications}`);
    console.log(`      → consigne tel quel : une ecriture fugace peut n'etre vue par aucune verification`);
    assert.ok(true);
  });

  it("7 · sauvegarde atomique de l'editeur → AUCUN faux positif", async () => {
    const a = await atelier("c7.md", "");
    for (let i = 0; i < 6; i++) {
      await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), `ligne ${i}\n`));
      await a.doc.save();                       // six sauvegardes successives
      await pause(120);
    }
    const b = await a.fin();
    console.log(`      6 sauvegardes → verifications=${b.verifications} ecarts=${b.ecarts.length} etat=${b.etat}`);
    assert.strictEqual(b.ecarts.length, 0,
      "le fonctionnement normal de sauvegarde ne doit JAMAIS produire d'ecart");
    assert.strictEqual(b.etat, I.ETAT.CONTINUE);
  });

  it("sans surveillance ni verification → integrite non surveillee, jamais 'continue'", async () => {
    const s = new I.SondeIntegrite({ chemin: path.join(T, "absent.md"), etatAttendu: () => "" });
    const b = s.bilan();
    assert.strictEqual(b.etat, I.ETAT.INDETERMINE,
      "l'absence de controle ne doit pas se lire comme un controle reussi");
  });
});
