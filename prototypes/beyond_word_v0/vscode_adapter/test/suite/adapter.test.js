const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const vscode = require("vscode");
const { evenementVersFaits } = require("../../adapter.js");

// Le modèle générique est en ESM ; on l'importe dynamiquement une fois.
let G;
before(async () => { G = await import(path.resolve(__dirname, "../../../capture.mjs")); });

const T = path.join(os.tmpdir(), "ho_vscode_bench");
function neuf(nom, contenu = "") {
  fs.mkdirSync(T, { recursive: true });
  const p = path.join(T, nom);
  fs.writeFileSync(p, contenu);
  return p;
}

/** Ouvre un fichier, branche l'adapter sur une Capture, et rend de quoi piloter. */
async function atelier(nom, initial = "") {
  const chemin = neuf(nom, initial);
  const doc = await vscode.workspace.openTextDocument(chemin);
  const ed = await vscode.window.showTextDocument(doc);
  const cap = new G.Capture({ source: "editeur" });
  cap.ouvrirPeriode(doc.getText());
  const abo = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() !== doc.uri.toString()) return;
    for (const f of evenementVersFaits(e)) cap.changementAnnonceBrut(f);
  });
  return { chemin, doc, ed, cap, abo };
}
const pause = (ms) => new Promise(r => setTimeout(r, ms));

describe("Adapter VS Code → modele generique", () => {

  it("saisie normale : insertions vues une a une", async () => {
    const a = await atelier("saisie.md");
    for (const mot of ["Bonjour", " le", " monde"]) {
      await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), mot));
      await pause(40);
    }
    a.abo.dispose();
    assert.ok(a.cap.faits.length >= 3, `${a.cap.faits.length} faits`);
    const t = a.cap.faits.map(f => f.detail_adapter.type);
    assert.ok(t.every(x => x === "insertion"), `types vus : ${t.join(",")}`);
    assert.ok(a.cap.faits.every(f => f.source === "local_editing"));
  });

  it("suppression et remplacement sont distingues", async () => {
    const a = await atelier("modif.md", "alpha beta gamma");
    await a.ed.edit(b => b.delete(new vscode.Range(0, 0, 0, 6)));      // suppression
    await pause(40);
    await a.ed.edit(b => b.replace(new vscode.Range(0, 0, 0, 4), "DELTA")); // remplacement
    await pause(40);
    a.abo.dispose();
    const t = a.cap.faits.map(f => f.detail_adapter.type);
    assert.ok(t.includes("suppression"), `types : ${t.join(",")}`);
    assert.ok(t.includes("remplacement"), `types : ${t.join(",")}`);
  });

  it("collage massif : vu comme UNE insertion, jamais comme un collage", async () => {
    const a = await atelier("collage.md");
    const gros = "x".repeat(4000);
    await a.ed.edit(b => b.insert(new vscode.Position(0, 0), gros));
    await pause(60);
    a.abo.dispose();
    const f = a.cap.faits.find(x => Math.abs(x.length_delta) >= 120);
    assert.ok(f, "aucun grand evenement");
    assert.strictEqual(f.source, "unknown");
    assert.strictEqual(f.detail_adapter.collage_observable, false,
      "l'adapter ne doit JAMAIS pretendre observer un collage");
  });

  it("collage fractionne regulier : indiscernable d'une saisie", async () => {
    const a = await atelier("frac_reg.md");
    for (let i = 0; i < 25; i++) {
      await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "y".repeat(100)));
      await pause(30);
    }
    a.abo.dispose();
    const signales = a.cap.faits.filter(f => f.capture_assurance === "low").length;
    assert.strictEqual(signales, 0, "aucun ne franchit le seuil, par construction");
    // Ce que l'adapter voit : 25 insertions. Rien de plus. Il ne les qualifie pas.
    assert.ok(a.cap.faits.every(f => f.detail_adapter.type === "insertion"));
  });

  it("collage fractionne IRREGULIER : l'adapter ne voit toujours rien de plus", async () => {
    const a = await atelier("frac_irr.md");
    for (let i = 0; i < 20; i++) {
      const n = 40 + Math.floor(Math.random() * 70);
      await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "z".repeat(n)));
      await pause(20 + Math.floor(Math.random() * 300));
    }
    a.abo.dispose();
    assert.ok(a.cap.faits.every(f => f.detail_adapter.collage_observable === false));
    assert.ok(a.cap.faits.every(f => f.detail_adapter.frappe_clavier_observable === false));
  });

  it("undo et redo SONT observables, et ne sont pas de la saisie", async () => {
    const a = await atelier("undo.md", "base");
    await a.ed.edit(b => b.insert(new vscode.Position(0, 4), " ajout"));
    await pause(80);
    await vscode.commands.executeCommand("undo");
    await pause(150);
    await vscode.commands.executeCommand("redo");
    await pause(150);
    a.abo.dispose();
    const raisons = a.cap.faits.map(f => f.detail_adapter.raison_editeur).filter(Boolean);
    assert.ok(raisons.includes("undo"), `raisons vues : ${raisons.join(",") || "aucune"}`);
    const ops = a.cap.faits.filter(f => f.source === "editor_operation");
    assert.ok(ops.length > 0, "undo/redo doivent sortir du local_editing");
  });

  it("replace-all : vu comme plusieurs changements dans UN evenement", async () => {
    const a = await atelier("replaceall.md", "aa\nbb\naa\ncc\naa");
    const ed = new vscode.WorkspaceEdit();
    const txt = a.doc.getText();
    let i = -1; const pos = [];
    while ((i = txt.indexOf("aa", i + 1)) !== -1) pos.push(i);
    for (const o of pos) ed.replace(a.doc.uri, new vscode.Range(a.doc.positionAt(o), a.doc.positionAt(o + 2)), "ZZ");
    await vscode.workspace.applyEdit(ed);
    await pause(80);
    a.abo.dispose();
    assert.ok(a.cap.faits.length >= 3, `${a.cap.faits.length} faits pour ${pos.length} remplacements`);
    assert.ok(a.cap.faits.every(f => f.detail_adapter.type === "remplacement"));
  });

  it("modification hors VS Code pendant l'observation : INVISIBLE a l'adapter", async () => {
    const a = await atelier("dehors.md", "contenu");
    const avant = a.cap.faits.length;
    fs.appendFileSync(a.chemin, "\najoute par un autre processus");
    await pause(400);
    a.abo.dispose();
    assert.strictEqual(a.cap.faits.length, avant,
      "l'adapter ne doit RIEN inventer : il n'a pas vu cette modification");
  });

  it("multi-periodes : l'intervalle non observe est rendu explicite", async () => {
    const F = await import(path.resolve(__dirname, "../../../finaliser.mjs"));
    const V = await import(path.resolve(__dirname, "../../../verifier.mjs"));
    const crypto = require("crypto");
    const cle = crypto.randomBytes(32);

    // --- session A ---
    const a = await atelier("multi.md", "depart\n");
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "ecrit en session A"));
    await pause(60);
    await a.doc.save();
    a.abo.dispose();
    a.cap.fermerPeriode(a.chemin);                 // engagement pris a la fermeture de A
    const engagementA = a.cap.arret.commitment;

    // --- modification HORS observation, et hors VS Code ---
    fs.appendFileSync(a.chemin, "\nmodifie entre les deux sessions, sans observation");

    // --- session B, sur le meme artefact ---
    const doc2 = await vscode.workspace.openTextDocument(a.chemin);
    const ed2 = await vscode.window.showTextDocument(doc2);
    a.cap.ouvrirPeriode(doc2.getText(), a.chemin); // <- constate l'etat reel a l'ouverture
    const abo2 = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== doc2.uri.toString()) return;
      for (const f of evenementVersFaits(e)) a.cap.changementAnnonceBrut(f);
    });
    await ed2.edit(b => b.insert(doc2.positionAt(doc2.getText().length), "\necrit en session B"));
    await pause(60);
    await doc2.save();
    abo2.dispose();
    a.cap.fermerPeriode(a.chemin);

    const p = F.finaliser({ cheminArtefact: a.chemin, capture: a.cap, recordId: F.identifiantLocal(), cle });
    const ch = a.chemin + ".proof.json"; F.ecrirePreuve(p, ch);
    const v = V.verifier({ cheminPreuve: ch, cheminArtefact: a.chemin, cle });

    assert.strictEqual(p.observation.periodes, 2, "deux periodes attendues");
    assert.strictEqual(p.intervalles_non_observes.length, 1, "un intervalle entre A et B");
    const iv = p.intervalles_non_observes[0];
    assert.strictEqual(iv.etat, "modifie_hors_observation",
      "la divergence entre la fin engagee de A et le debut de B doit etre NOMMEE");
    assert.strictEqual(iv.engagement_a_la_fermeture, engagementA);
    assert.notStrictEqual(iv.engagement_a_la_reouverture, engagementA);
    // La preuve reste valide : un intervalle non observe est normal. Il doit etre LISIBLE,
    // pas disqualifiant.
    assert.strictEqual(v.verdict, "VALIDE", "un intervalle declare n'invalide pas la preuve");
    assert.strictEqual(v.intervalles_avec_modification, 1);
  });

  it("fichier preexistant : la baseline le declare non observe", async () => {
    const pre = "ligne preexistante\n".repeat(50);
    const a = await atelier("preexistant.md", pre);
    await a.ed.edit(b => b.insert(a.doc.positionAt(a.doc.getText().length), "une ligne sous observation"));
    await pause(60);
    a.abo.dispose();
    assert.strictEqual(a.cap.baseline.octets, Buffer.byteLength(pre));
    assert.strictEqual(a.cap.baseline.observe, false);
    assert.ok(a.cap.faits.length <= 2, `${a.cap.faits.length} evenements pour ${pre.length} octets preexistants`);
  });
});
