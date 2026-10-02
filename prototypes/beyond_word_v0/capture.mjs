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

// Engagement de fin de processus. Primitive EXACTE de la production :
// sha256 sur l'encodage base64 des octets du fichier. Elle ne suppose rien du format.
export function commitBytes(octets) {
  return crypto.createHash("sha256").update(Buffer.from(octets).toString("base64")).digest("hex");
}

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
    // P1 — ce qui existait AVANT la premiere periode. Jamais observe, et doit rester
    // lisible comme tel dans la preuve.
    this.baseline = null;
    // P0 — engagement pris a l'instant exact ou l'observation s'arrete.
    this.arret = null;
  }

  ouvrirPeriode(texteInitial = "") {
    if (this.baseline === null) {
      // Premiere ouverture : on fige ce qui preexiste. Un fichier vide donne une baseline
      // vide — c'est un cas normal, pas une absence de baseline.
      const octets = Buffer.from(texteInitial, "utf8");
      this.baseline = {
        octets: octets.length,
        unites: texteInitial === "" ? 0 : unites(texteInitial).size,
        empreinte: crypto.createHash("sha256").update(octets).digest("hex"),
        observe: false,
        mention: "ce volume etait present avant la premiere periode d'observation ; il n'a pas ete observe",
      };
    }
    this.longueurs = unites(texteInitial);
    this.ouverte = true;
    this.debutPeriode = new Date().toISOString();
  }

  /// P0 — la fenetre se ferme ICI, pas a la finalisation.
  ///
  /// Tant que l'engagement n'etait pris qu'au moment de finaliser, on pouvait editer hors
  /// observation puis finaliser : la preuve sortait valide. En prenant l'engagement a
  /// l'arret, toute modification ulterieure devient detectable par simple comparaison.
  fermerPeriode(cheminArtefact = null) {
    this.ouverte = false;
    this.periode += 1;
    if (cheminArtefact) {
      const octets = fs.readFileSync(cheminArtefact);
      this.arret = {
        at: new Date().toISOString(),
        commitment: commitBytes(octets),
        octets: octets.length,
      };
    }
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

export function lireFichier(p) { return fs.readFileSync(p); }

// ---------------------------------------------------------------- P2 · signaux de capture
//
// AVERTISSEMENT, qui n'est pas une formule de politesse :
// ce qui suit décrit la FORME des événements observés. Rien ici n'établit qu'une personne
// a écrit, ni qu'un outil n'a pas été utilisé. Ce sont des faits descriptifs et des
// signaux d'assurance — jamais une preuve d'auteur. Un rythme régulier n'accuse personne,
// et un rythme irrégulier n'innocente personne.
//
// Aucun libellé de production n'est touché : ces signaux vivent dans le prototype.

function mediane(xs) {
  if (!xs.length) return 0;
  const t = [...xs].sort((a, b) => a - b), m = t.length >> 1;
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

function coefficientDeVariation(xs) {
  if (xs.length < 2) return null;
  const moy = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (moy === 0) return null;
  const v = xs.reduce((a, b) => a + (b - moy) ** 2, 0) / xs.length;
  return Math.sqrt(v) / moy;
}

export const RAFALE_MS = 2000;        // deux événements plus proches que cela : même rafale
export const REGULARITE_SUSPECTE = 0.25; // en deçà, les intervalles sont anormalement réguliers
export const MIN_POUR_JUGER = 8;      // sous ce nombre d'événements, on ne conclut rien

export function signaux(faits) {
  const t = faits.map(f => Date.parse(f.at));
  const intervalles = t.slice(1).map((x, i) => x - t[i]).filter(x => x >= 0);
  const insertions = faits.map(f => f.length_delta).filter(d => d > 0);

  // Rafales : suites d'événements séparés de moins de RAFALE_MS.
  const rafales = [];
  let courante = 1;
  for (const d of intervalles) {
    if (d < RAFALE_MS) courante++;
    else { if (courante > 1) rafales.push(courante); courante = 1; }
  }
  if (courante > 1) rafales.push(courante);

  const dureeMs = t.length > 1 ? t[t.length - 1] - t[0] : 0;
  const cvIntervalles = coefficientDeVariation(intervalles);
  const cvTailles = coefficientDeVariation(insertions);

  // Le collage fractionné, qu'un seuil par événement ne voit pas : beaucoup d'insertions
  // de taille très proche, arrivant à intervalles très réguliers. C'est la REGULARITE qui
  // le trahit, pas la quantité.
  const assezDeMatiere = faits.length >= MIN_POUR_JUGER;
  const tresRegulier = assezDeMatiere
    && cvIntervalles !== null && cvIntervalles < REGULARITE_SUSPECTE
    && cvTailles !== null && cvTailles < REGULARITE_SUSPECTE;

  return {
    evenements: faits.length,
    duree_ms: dureeMs,
    cadence_par_minute: dureeMs > 0 ? +(faits.length / (dureeMs / 60000)).toFixed(1) : null,
    rafales: { nombre: rafales.length, plus_longue: rafales.length ? Math.max(...rafales) : 0 },
    insertions: {
      nombre: insertions.length,
      mediane: mediane(insertions),
      maximum: insertions.length ? Math.max(...insertions) : 0,
    },
    regularite: {
      intervalles: cvIntervalles === null ? null : +cvIntervalles.toFixed(3),
      tailles: cvTailles === null ? null : +cvTailles.toFixed(3),
      // Plus le coefficient est bas, plus la suite est régulière.
      lecture: "coefficient de variation ; une valeur basse signale une regularite inhabituelle",
    },
    repartition_source: faits.reduce((a, f) => { a[f.source] = (a[f.source] || 0) + 1; return a; }, {}),
    // Le signal, et sa portée, dits ensemble pour qu'ils ne se séparent jamais.
    signal_regularite: tresRegulier ? "inhabituelle" : (assezDeMatiere ? "ordinaire" : "indeterminee"),
    portee_du_signal:
      "signal descriptif sur la forme des evenements. N'etablit ni l'auteur, ni l'absence d'outil, " +
      "ni la presence d'un collage : une suite reguliere peut venir d'une saisie reguliere.",
  };
}
