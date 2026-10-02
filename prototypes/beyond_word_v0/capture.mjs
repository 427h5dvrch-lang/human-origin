// Couche de capture générique — PROTOTYPE, hors production.
//
// Produit exactement les mêmes faits que le volet Word, à partir d'une source qui n'est
// pas Word. Le format des faits n'est pas inventé ici : il est recopié du volet de
// production (taskpane.js, fonction onChange).
//
//   { sequence, period, kind, at, paragraphs[], length_delta, source, capture_assurance }
//
// Deux sources de capture sont implémentées, et elles ne se valent pas :
//
//   "editeur"  — l'éditeur annonce lui-même ce qui a changé. C'est le modèle du volet
//                Word, et le seul qui distingue une frappe d'un collage.
//   "fichier"  — on surveille le fichier sur le disque et on compare deux états. On voit
//                qu'il a changé, jamais comment. Implémenté exprès, pour montrer ce que
//                cela coûte en force de preuve. Voir red_team.mjs.
//
// SIMULÉ dans ce prototype : rien du format des faits. La seule simulation est le
// découpage en « unités » — ici les lignes, là où Word utilise ses paragraphes et leur
// uniqueLocalId.

import fs from "node:fs";
import crypto from "node:crypto";

// Seuil du volet de production : au-delà, la variation n'est plus attribuée à la frappe.
export const LARGE = 120;

export function unites(texte) {
  // Une unité = une ligne. Son identité est stable tant que son contenu ne change pas de
  // place : c'est l'équivalent le plus simple de uniqueLocalId, et c'est volontairement
  // plus faible — un vrai éditeur donne une identité qui survit à l'édition.
  const m = new Map();
  texte.split("\n").forEach((l, i) => m.set(`u${i}`, l.length));
  return m;
}

export class Capture {
  constructor({ source = "editeur" } = {}) {
    if (!["editeur", "fichier"].includes(source)) throw new Error("source inconnue");
    this.sourceCapture = source;
    this.seq = 0;
    this.periode = 0;
    this.faits = [];
    this.longueurs = new Map();
    this.ouverte = false;
  }

  ouvrirPeriode(texteInitial = "") {
    this.longueurs = unites(texteInitial);
    this.ouverte = true;
    this.debutPeriode = new Date().toISOString();
  }

  fermerPeriode() {
    this.ouverte = false;
    this.periode += 1;
  }

  // L'éditeur annonce : « ces unités ont changé ». C'est le contrat du volet Word.
  changementAnnonce(texteApres, idsChanges, kind = "edited") {
    if (!this.ouverte) return;
    const maintenant = unites(texteApres);
    let delta = 0;
    for (const id of idsChanges) delta += (maintenant.get(id) || 0) - (this.longueurs.get(id) || 0);
    const grand = Math.abs(delta) >= LARGE;
    this.faits.push({
      sequence: this.seq++, period: this.periode, kind, at: new Date().toISOString(),
      paragraphs: idsChanges.slice(0, 20), length_delta: delta,
      source: grand ? "unknown" : "local_editing",
      capture_assurance: grand ? "low" : "medium",
    });
    for (const id of idsChanges) {
      if (maintenant.has(id)) this.longueurs.set(id, maintenant.get(id));
      else this.longueurs.delete(id);
    }
  }

  // On ne sait que ceci : le fichier n'est plus le même. Rien sur la façon dont il a changé.
  changementConstate(texteApres) {
    if (!this.ouverte) return;
    const maintenant = unites(texteApres);
    const ids = new Set([...maintenant.keys(), ...this.longueurs.keys()]);
    const changes = [...ids].filter(id => (maintenant.get(id) || 0) !== (this.longueurs.get(id) || 0));
    let delta = 0;
    for (const id of changes) delta += (maintenant.get(id) || 0) - (this.longueurs.get(id) || 0);
    this.faits.push({
      sequence: this.seq++, period: this.periode, kind: "file_changed",
      at: new Date().toISOString(), paragraphs: changes.slice(0, 20), length_delta: delta,
      // Jamais "local_editing" : par construction, cette source ne peut pas l'établir.
      source: "unknown",
      capture_assurance: "low",
    });
    this.longueurs = maintenant;
  }
}

// Scellement : AES-256-GCM, record_id en données authentifiées additionnelles.
// Même primitive et même rôle que la production — la clé ne quitte jamais la preuve.
export function sceller(faits, recordId, cle) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", cle, iv);
  c.setAAD(Buffer.from(recordId, "utf8"));
  const chiffre = Buffer.concat([c.update(JSON.stringify(faits), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), chiffre]).toString("base64");
}

export function desceller(blob, recordId, cle) {
  const b = Buffer.from(blob, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", cle, b.subarray(0, 12));
  d.setAAD(Buffer.from(recordId, "utf8"));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
}

// Engagement de fin de processus. Primitive EXACTE de la production :
// sha256 sur l'encodage base64 des octets du fichier. Elle ne suppose rien du format.
export function commitBytes(octets) {
  return crypto.createHash("sha256").update(Buffer.from(octets).toString("base64")).digest("hex");
}

export function lireFichier(p) { return fs.readFileSync(p); }
