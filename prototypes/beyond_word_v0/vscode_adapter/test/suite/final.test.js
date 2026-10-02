const assert = require("assert");
const path = require("path"); const fs = require("fs"); const os = require("os");
const vscode = require("vscode");
const { evenementVersFaits } = require("../../adapter.js");

let G, I;
before(async () => {
  G = await import(path.resolve(__dirname, "../../../capture.mjs"));
  I = await import(path.resolve(__dirname, "../../../integrite.mjs"));
});
const T = path.join(os.tmpdir(), "ho_final");
const pause = (ms) => new Promise(r => setTimeout(r, ms));

async function atelier(nom, initial = "", { verifierAvantSauvegarde = false } = {}) {
  fs.mkdirSync(T, { recursive: true });
  const chemin = path.join(T, nom);
  fs.writeFileSync(chemin, initial);
  const doc = await vscode.workspace.openTextDocument(chemin);
  const ed = await vscode.window.showTextDocument(doc);
  const cap = new G.Capture({ source: "editeur" });
  cap.ouvrirPeriode(doc.getText(), chemin);
  const sonde = new I.SondeIntegrite({ chemin, etatAttendu: () => doc.getText() });
  sonde.ancrer("ouverture");
  const abos = [];
  if (verifierAvantSauvegarde) sonde.demarrer();
  abos.push(vscode.workspace.onWillSaveTextDocument((e) => {
    if (e.document.uri.toString() !== doc.uri.toString()) return;
    // CONTROLER avant d'ouvrir la fenetre : une sauvegarde ne doit pas pouvoir blanchir
    // l'ecriture externe qui l'a precedee.
    if (verifierAvantSauvegarde) sonde.verifierDepuisAncrage("avant_sauvegarde");
    sonde.ouvrirFenetreEcriture();
  }));
  abos.push(vscode.workspace.onDidSaveTextDocument((d) => {
    if (d.uri.toString() !== doc.uri.toString()) return;
    if (verifierAvantSauvegarde) sonde.fermerFenetreEcriture(); else sonde.ancrer("sauvegarde_observee");
  }));
  abos.push(vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() !== doc.uri.toString()) return;
    for (const f of evenementVersFaits(e)) cap.changementAnnonceBrut(f);
  }));
  return { chemin, doc, ed, cap, sonde,
    async fin() { for (const a of abos) a.dispose(); await pause(250);
      this.sonde.verifierDepuisAncrage("fermeture"); this.sonde.arreter();
      this.cap.fermerPeriode(this.chemin); return this.sonde.bilan(); } };
}

describe("V0.4 — derniers angles morts", () => {

  it("1a · BLANCHIMENT : externe → reload → sauvegarde utilisateur, SANS controle prealable", async () => {
    const a = await atelier("b1.md", "origine\n");
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "observe\n"));
    await a.doc.save(); await pause(250);
    fs.writeFileSync(a.chemin, "CONTENU ETRANGER INJECTE\n");   // ecriture externe
    await pause(900);                                            // VS Code recharge
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "suite\n"));
    await a.doc.save(); await pause(300);                        // l'utilisateur sauvegarde
    const b = await a.fin();
    console.log(`      sans controle prealable : etat=${b.etat} ecarts=${b.ecarts.length}`);
    console.log(`      contenu final : ${JSON.stringify(fs.readFileSync(a.chemin, "utf8"))}`);
    console.log(`      → le contenu etranger est-il dans l'artefact final sans ecart ? ${b.ecarts.length === 0}`);
    assert.ok(true, "on consigne le resultat");
  });

  it("1b · le controle AVANT sauvegarde empeche-t-il le blanchiment ?", async () => {
    const a = await atelier("b2.md", "origine\n", { verifierAvantSauvegarde: true });
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "observe\n"));
    await a.doc.save(); await pause(250);
    fs.writeFileSync(a.chemin, "CONTENU ETRANGER INJECTE\n");
    await pause(900);
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "suite\n"));
    await a.doc.save(); await pause(300);
    const b = await a.fin();
    console.log(`      avec controle prealable : etat=${b.etat} ecarts=${b.ecarts.length}`);
    if (b.ecarts.length) console.log(`      contexte du premier ecart : ${b.ecarts[0].contexte}`);
    assert.ok(b.ecarts.length >= 1,
      "un controle avant sauvegarde DOIT voir l'ecriture externe qui precede");
  });

  it("2 · finalisation avec tampon non sauvegarde : quel etat est engage ?", async () => {
    const a = await atelier("ns.md", "");
    await a.ed.edit(b => b.insert(new vscode.Position(0, 0), "partie A\n"));
    await a.doc.save(); await pause(250);
    const disqueA = fs.readFileSync(a.chemin, "utf8");
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "partie B non sauvegardee\n"));
    await pause(150);
    assert.ok(a.doc.isDirty, "le tampon doit etre sale");
    const b = await a.fin();
    const engage = fs.readFileSync(a.chemin, "utf8");
    console.log(`      disque = ${JSON.stringify(disqueA)}`);
    console.log(`      tampon = ${JSON.stringify(a.doc.getText())}`);
    console.log(`      engage = ${JSON.stringify(engage)}  (${engage === disqueA ? "DISQUE" : "autre"})`);
    console.log(`      evenements enregistres : ${a.cap.faits.length}  → ils decrivent B, absent de l'artefact engage`);
    assert.strictEqual(engage, disqueA, "c'est l'etat DISQUE qui est engage, pas celui du tampon");

    // Le comportement sur : la finalisation doit REFUSER plutot que d'engager un etat
    // que les faits ne decrivent pas.
    const F = await import(path.resolve(__dirname, "../../../finaliser.mjs"));
    const crypto = require("crypto");
    let refuse = null;
    try {
      F.finaliser({ cheminArtefact: a.chemin, capture: a.cap, recordId: F.identifiantLocal(),
        cle: crypto.randomBytes(32), tamponNonSauvegarde: a.doc.isDirty });
    } catch (e) { refuse = e.concordance?.etat; }
    console.log(`      finalisation avec tampon sale → ${refuse}`);
    assert.strictEqual(refuse, "tampon_non_sauvegarde", "elle doit refuser");
  });

  it("4 · aller-retour aux memes octets, AVEC fenetre d'ecriture", async () => {
    const a = await atelier("ar.md", "stable\n", { verifierAvantSauvegarde: true });
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "observe\n"));
    await a.doc.save(); await pause(300);
    const avant = fs.readFileSync(a.chemin);
    fs.writeFileSync(a.chemin, "TRANSITOIRE ETRANGER\n");
    await pause(250);
    fs.writeFileSync(a.chemin, avant);                       // retour exact
    await pause(400);
    const b = await a.fin();
    console.log(`      aller-retour : etat=${b.etat} ecarts=${b.ecarts.length} verifications=${b.verifications}`);
    assert.ok(b.ecarts.length >= 1,
      "le controle a CHAQUE evenement doit voir le transitoire, meme annule ensuite");
  });

  it("5 · six sauvegardes atomiques AVEC fenetre d'ecriture : aucun faux positif", async () => {
    const a = await atelier("fp.md", "", { verifierAvantSauvegarde: true });
    for (let i = 0; i < 6; i++) {
      await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), `ligne ${i}\n`));
      await a.doc.save(); await pause(200);
    }
    const b = await a.fin();
    console.log(`      6 sauvegardes : etat=${b.etat} ecarts=${b.ecarts.length} transitoires_ignorees=${b.divergences_transitoires}`);
    assert.strictEqual(b.ecarts.length, 0, "la sauvegarde normale ne doit produire aucun ecart");
  });

  it("3 · watcher sur le DOSSIER PARENT : survit-il a la sauvegarde atomique ?", async () => {
    fs.mkdirSync(T, { recursive: true });
    const chemin = path.join(T, "parent.md");
    fs.writeFileSync(chemin, "depart\n");
    const doc = await vscode.workspace.openTextDocument(chemin);
    const ed = await vscode.window.showTextDocument(doc);

    const journal = [];
    const wFichier = fs.watch(chemin, { persistent: false }, (t) => journal.push(`fichier:${t}`));
    const wParent = fs.watch(T, { persistent: false }, (t, f) => { if (f === "parent.md") journal.push(`parent:${t}`); });
    const marques = [];
    const a1 = vscode.workspace.onWillSaveTextDocument(e => { if (e.document.uri.toString() === doc.uri.toString()) marques.push({ t: Date.now(), quoi: "willSave" }); });
    const a2 = vscode.workspace.onDidSaveTextDocument(d => { if (d.uri.toString() === doc.uri.toString()) marques.push({ t: Date.now(), quoi: "didSave" }); });

    for (let i = 0; i < 3; i++) {
      await ed.edit(b => b.insert(doc.positionAt(doc.getText().length), `s${i}\n`));
      await doc.save(); await pause(250);
    }
    const apresSauvegardes = journal.length;
    fs.writeFileSync(chemin, "ECRITURE EXTERNE\n"); await pause(400);
    const apresExterne = journal.length;
    const avant = fs.readFileSync(chemin);
    fs.writeFileSync(chemin, "TRANSITOIRE\n"); fs.writeFileSync(chemin, avant); await pause(400);

    wFichier.close(); wParent.close(); a1.dispose(); a2.dispose();
    const parDossier = journal.filter(x => x.startsWith("parent")).length;
    const parFichier = journal.filter(x => x.startsWith("fichier")).length;
    console.log(`      3 sauvegardes editeur : ${apresSauvegardes} evenements (${marques.length} marques will/did)`);
    console.log(`      + ecriture externe    : ${apresExterne - apresSauvegardes} evenements`);
    console.log(`      + aller-retour        : ${journal.length - apresExterne} evenements`);
    console.log(`      total  parent=${parDossier}  fichier=${parFichier}`);
    console.log(`      → le watcher de DOSSIER voit-il plus que celui de fichier ? ${parDossier > parFichier}`);
    assert.ok(true, "sonde : on consigne");
  });
});
