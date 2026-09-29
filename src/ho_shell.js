// src/ho_shell.js — jetons et composants du Creator Shell.
//
// La planche validée est le contrat visuel. Ce module en porte le vocabulaire : couleurs,
// typographies, mesures, et les quelques formes qui reviennent d'un écran à l'autre. Les
// écrans, eux, vivent dans ho_desktop.js et ne redéfinissent jamais ces valeurs.
//
// Règle : UN ÉCRAN = UN ÉTAT. Aucun composant d'ici ne compose deux états.
import { put } from "./ho_ui.js";
// Marque : copie versionnée du paquet d'identité gelé, jamais redessinée.
import MOT_SYMBOLE_MARINE from "./brand/HumanOrigin_wordmark_navy.png";
import MOT_SYMBOLE_BLANC from "./brand/HumanOrigin_wordmark_white.png";

// ---------------------------------------------------------------- jetons
export const PAPIER = "#FBFAF7";   // ivoire, jamais le blanc clinique
export const CARTE = "#FFFFFF";
export const MARINE = "#012454";   // marine de marque, gelée par BRAND_SPEC
export const ENCRE = "#1A1E24";
export const ATONE = "#565E69";
export const LIGNE = "#E6E2D8";

// Médaillons : un fond très pâle, une encre soutenue. Jamais de couleur pleine.
export const TEINTES = {
  bleu:  { fond: "#E7EFF8", encre: "#2C5C8F" },
  vert:  { fond: "#E2F0E8", encre: "#3E8E5A" },
  ambre: { fond: "#FBF0DB", encre: "#A9762B" },
  rouge: { fond: "#FBE7E5", encre: "#B3392F" },
};

export const SERIF = 'ui-serif, Georgia, "Times New Roman", serif';
export const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
export const COLONNE = "436px";    // largeur de la colonne de contenu

export const el = (tag, decls, text) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (decls) put(n, decls);
  return n;
};

// ---------------------------------------------------------------- dessin
const NS = "http://www.w3.org/2000/svg";
const dessin = (taille, attrs) => {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", String(taille));
  s.setAttribute("height", String(taille));
  s.setAttribute("fill", "none");
  s.setAttribute("aria-hidden", "true");
  for (const [k, v] of Object.entries(attrs || {})) s.setAttribute(k, v);
  return s;
};
const trait = (p, d) => {
  const n = document.createElementNS(NS, "path");
  n.setAttribute("d", d);
  p.appendChild(n);
  return n;
};
const rond = (p, cx, cy, r) => {
  const n = document.createElementNS(NS, "circle");
  n.setAttribute("cx", cx); n.setAttribute("cy", cy); n.setAttribute("r", r);
  p.appendChild(n);
  return n;
};

/** Fabrique une icône au trait, dans la couleur demandée. */
function icone(taille, couleur, tracer) {
  const s = dessin(taille, { stroke: couleur, "stroke-width": "1.6",
    "stroke-linecap": "round", "stroke-linejoin": "round" });
  tracer(s);
  return s;
}

export const ICONES = {
  feuille: (t, c) => icone(t, c, (s) => {
    trait(s, "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z");
    trait(s, "M14 3v5h5");
  }),
  feuilleLignes: (t, c) => icone(t, c, (s) => {
    trait(s, "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z");
    trait(s, "M14 3v5h5M8.5 13h7M8.5 16.5h4.5");
  }),
  copie: (t, c) => icone(t, c, (s) => {
    trait(s, "M9 9.5A2.5 2.5 0 0 1 11.5 7h6A2.5 2.5 0 0 1 20 9.5v6a2.5 2.5 0 0 1-2.5 2.5h-6A2.5 2.5 0 0 1 9 15.5z");
    trait(s, "M15 7V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H7");
  }),
  etincelle: (t, c) => icone(t, c, (s) => {
    trait(s, "M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-8");
    trait(s, "M13 3v5h5");
    trait(s, "M19.2 3.2l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z");
  }),
  coche: (t, c) => icone(t, c, (s) => { trait(s, "M5 12.6l4.6 4.6L19 7.8"); }),
  alerte: (t, c) => icone(t, c, (s) => {
    trait(s, "M12 4.2 2.6 20h18.8z");
    trait(s, "M12 10v4.2M12 17.2v.1");
  }),
  exclamation: (t, c) => icone(t, c, (s) => {
    rond(s, "12", "12", "8.6").setAttribute("stroke", c);
    trait(s, "M12 7.8v4.6M12 15.6v.1");
  }),
  lienExterne: (t, c) => icone(t, c, (s) => {
    trait(s, "M13.5 4.5H19.5v6");
    trait(s, "M19.5 4.5 11 13");
    trait(s, "M18 14.5v3.7A2.3 2.3 0 0 1 15.7 20.5H5.8A2.3 2.3 0 0 1 3.5 18.2V8.3A2.3 2.3 0 0 1 5.8 6h3.7");
  }),
  chaine: (t, c) => icone(t, c, (s) => {
    trait(s, "M10 13.8a3.6 3.6 0 0 0 5.4.4l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.5 1.5");
    trait(s, "M14 10.2a3.6 3.6 0 0 0-5.4-.4L6 12.4a3.6 3.6 0 0 0 5.1 5.1l1.5-1.5");
  }),
  horloge: (t, c) => icone(t, c, (s) => {
    rond(s, "12", "12", "8.4").setAttribute("stroke", c);
    trait(s, "M12 7.4V12l3 1.8");
  }),
  info: (t, c) => icone(t, c, (s) => {
    rond(s, "12", "12", "8.4").setAttribute("stroke", c);
    trait(s, "M12 11v5M12 8.1v.1");
  }),
  personne: (t, c) => icone(t, c, (s) => {
    rond(s, "12", "8", "3.4").setAttribute("stroke", c);
    trait(s, "M5.2 19.4a6.8 6.8 0 0 1 13.6 0");
  }),
  // Un anneau, un moyeu, huit dents courtes. Sans l'anneau, huit rayons isolés se lisent
  // comme un soleil — c'est ce que rendait la version précédente.
  engrenage: (t, c) => icone(t, c, (s) => {
    rond(s, "12", "12", "6.1").setAttribute("stroke", c);
    rond(s, "12", "12", "2.4").setAttribute("stroke", c);
    trait(s, "M12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4"
          + "M5.9 5.9l1.7 1.7M16.4 16.4l1.7 1.7M5.9 18.1l1.7-1.7M16.4 7.6l1.7-1.7");
  }),
  globe: (t, c) => icone(t, c, (s) => {
    rond(s, "12", "12", "8.4").setAttribute("stroke", c);
    trait(s, "M3.6 12h16.8M12 3.6a13 13 0 0 1 0 16.8a13 13 0 0 1 0-16.8");
  }),
  dossier: (t, c) => icone(t, c, (s) => {
    trait(s, "M3.8 7.4a2 2 0 0 1 2-2h3.1l1.8 2.2h7.5a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2z");
  }),
  bouclier: (t, c) => icone(t, c, (s) => {
    trait(s, "M12 3.2 5 6v5.4c0 4.2 2.9 7.6 7 9.4 4.1-1.8 7-5.2 7-9.4V6z");
  }),
  croix: (t, c) => icone(t, c, (s) => { trait(s, "M6.5 6.5l11 11M17.5 6.5l-11 11"); }),
};

/** Pastille Word. La marque de Microsoft n'est pas embarquée : sa couleur l'évoque. */
export const pastilleWord = (taille) => el("span", {
  width: taille + "px", height: taille + "px", "border-radius": "4px",
  background: "#2B579A", color: "#FFFFFF", display: "inline-flex",
  "align-items": "center", "justify-content": "center", "flex-shrink": "0",
  font: "700 " + Math.round(taille * 0.58) + "px/1 " + SANS,
}, "W");

// ---------------------------------------------------------------- marque
// Bornes du « O » dans le master 850 × 150, mesurées sur le fichier lui-même :
// x 446 → 576, y 0 → 137. Le rectangle ne contient QUE l'empreinte — l'encre des colonnes
// voisines plafonne à 9/255, et à 5/255 sous elle. Rien du « n » ni du « r » n'y entre.
const O_GAUCHE = "52.470588%";     // 446 / 850
const O_DROITE = "67.764706%";     // 576 / 850
const O_CENTRE = "60.117647% 45.666667%";   // centre optique du O, origine de l'impulsion
const MASQUE_MOT = "linear-gradient(to right, #000 0 " + O_GAUCHE + ", transparent "
  + O_GAUCHE + " " + O_DROITE + ", #000 " + O_DROITE + " 100%)";
const MASQUE_O = "linear-gradient(to right, transparent 0 " + O_GAUCHE + ", #000 "
  + O_GAUCHE + " " + O_DROITE + ", transparent " + O_DROITE + " 100%)";

/**
 * MARQUE HUMANORIGIN — POINT UNIQUE.
 *
 * Le paquet d'identité est gelé : `DO NOT REDRAW · DO NOT RECREATE FROM FONT ·
 * DO NOT SUBSTITUTE FINGERPRINT`. Le mot-symbole canonique porte **l'empreinte à la place du
 * « O » d'Origin** : c'est un seul raster, jamais une empreinte posée à gauche d'un
 * « HumanOrigin » écrit dans une police. Le sceau rond du marquage Record n'est pas un logo
 * d'application. Seule la HAUTEUR varie ici ; la largeur suit le ratio exact de l'asset.
 *
 * Deux calques du MÊME fichier, à la MÊME échelle : le mot privé de son O, puis le O seul.
 * Le rééchantillonnage est donc identique par construction, et le composite est pixel pour
 * pixel le raster intact — mesuré à 0/255 d'écart. Reposer le master empreinte, lui,
 * déviait de 97 à 176/255 : deux grilles de départ différentes, donc deux antialiasings.
 *
 * `sombre` ne sert qu'aux fonds sombres, où l'encre marine ne tiendrait pas.
 */
export function HumanOriginBrandMark(taille, sombre) {
  const src = sombre ? MOT_SYMBOLE_BLANC : MOT_SYMBOLE_MARINE;
  const m = document.createElement("span");
  m.className = "ho-marque";
  put(m, { position: "relative", display: "inline-block", "vertical-align": "top",
    "line-height": "0", "flex-shrink": "0" });

  const mot = document.createElement("img");
  mot.src = src;
  mot.alt = "HumanOrigin";
  put(mot, { height: taille + "px", width: "auto", display: "block",
    "-webkit-mask-image": MASQUE_MOT, "mask-image": MASQUE_MOT });

  // Le O. Il ne porte AUCUN style d'animation en ligne : `put` écrit en `!important` et
  // empêcherait toute règle de la feuille de style d'agir.
  const o = document.createElement("img");
  o.src = src;
  o.alt = "";
  o.setAttribute("aria-hidden", "true");
  o.className = "ho-o";
  put(o, { position: "absolute", left: "0", top: "0", height: taille + "px", width: "auto",
    display: "block", "transform-origin": O_CENTRE,
    "-webkit-mask-image": MASQUE_O, "mask-image": MASQUE_O });

  m.appendChild(mot);
  m.appendChild(o);
  return m;
}

/**
 * DÉPÔT — le passage de « rien » à « document HumanOrigin prêt ».
 *
 * Joué une fois, au succès réel de la création, et jamais rejoué au retour de focus :
 * personne ne l'appelle ailleurs. Purement CSS, donc rien n'attend : l'ouverture de Word
 * n'est pas retardée d'une milliseconde.
 */
export function jouerDepot() {
  const o = document.querySelector(".ho-marque .ho-o");
  if (!o) return;
  o.classList.remove("ho-depot");
  void o.offsetWidth;                      // force le recalcul : l'animation repart de zéro
  o.classList.add("ho-depot");
}

// ---------------------------------------------------------------- fond
/**
 * Paysage d'arrière-plan. Très pâle, ancré en bas : une présence, jamais un décor. Il ne
 * doit rien disputer au titre ni au bouton.
 */
export function paysage(intensite) {
  const k = intensite === "accueil" ? 1 : 0.72;
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 400 200");
  s.setAttribute("preserveAspectRatio", "xMidYMax slice");
  s.setAttribute("aria-hidden", "true");
  put(s, { position: "fixed", left: "0", right: "0", bottom: "0", width: "100%",
    height: "56%", "pointer-events": "none", "z-index": "0" });

  // Chaque couche se dissout vers le haut : c'est ce qui la fait lire comme une texture
  // et non comme un graphique. Des crêtes anguleuses et opaques dominaient la page.
  const defs = document.createElementNS(NS, "defs");
  s.appendChild(defs);
  const couches = [
    ["M0 96 C 48 62, 92 88, 138 60 S 224 92, 268 64 S 348 96, 400 70 L400 200 L0 200 Z", 0.085],
    ["M0 126 C 56 100, 108 124, 162 98 S 250 128, 302 104 S 372 126, 400 112 L400 200 L0 200 Z", 0.065],
    ["M0 156 C 70 138, 132 158, 198 140 S 320 160, 400 146 L400 200 L0 200 Z", 0.048],
  ];
  couches.forEach(([d, o], i) => {
    const g = document.createElementNS(NS, "linearGradient");
    g.setAttribute("id", "ho-paysage-" + i);
    g.setAttribute("x1", "0"); g.setAttribute("y1", "0");
    g.setAttribute("x2", "0"); g.setAttribute("y2", "1");
    for (const [offset, alpha] of [["0", o * k * 0.18], ["1", o * k]]) {
      const st = document.createElementNS(NS, "stop");
      st.setAttribute("offset", offset);
      st.setAttribute("stop-color", MARINE);
      st.setAttribute("stop-opacity", String(alpha.toFixed(4)));
      g.appendChild(st);
    }
    defs.appendChild(g);
    trait(s, d).setAttribute("fill", "url(#ho-paysage-" + i + ")");
  });
  return s;
}


// ---------------------------------------------------------------- composants
/** En-tête, identique sur tous les états normaux. */
export function entete({ connecte, onReglages }) {
  const h = el("header", {
    display: "flex", "align-items": "center", "justify-content": "space-between",
    padding: "13px 18px", "border-bottom": "1px solid " + LIGNE,
    background: "rgba(251,250,247,.86)", "backdrop-filter": "saturate(140%) blur(6px)",
    position: "relative", "z-index": "2",
  });
  // Le mot-symbole dit déjà le nom : aucun texte ne le double.
  h.appendChild(HumanOriginBrandMark(22));

  const d = el("div", { display: "flex", "align-items": "center", gap: "13px" });
  const etat = el("span", { display: "inline-flex", "align-items": "center", gap: "6px",
    font: "12.5px/1 " + SANS, color: ATONE });
  etat.appendChild(el("span", { width: "7px", height: "7px", "border-radius": "50%",
    background: connecte ? "#3E8E5A" : "#B3392F", display: "inline-block",
    "flex-shrink": "0" }));
  etat.appendChild(el("span", null, connecte ? "Connecté" : "Non connecté"));
  d.appendChild(etat);

  if (onReglages) {
    const b = el("button", { background: "transparent", border: "0", padding: "4px",
      cursor: "pointer", display: "inline-flex", "align-items": "center",
      "border-radius": "6px", appearance: "none", "pointer-events": "auto" });
    b.type = "button";
    b.title = "Réglages";
    b.setAttribute("aria-label", "Réglages");
    b.appendChild(ICONES.engrenage(17, ATONE));
    b.onclick = onReglages;
    d.appendChild(b);
  }
  h.appendChild(d);
  return h;
}

/** Colonne de contenu : même largeur et mêmes marges sur tous les écrans. */
export function colonne(decls) {
  return el("div", Object.assign({
    width: "100%", "max-width": COLONNE, margin: "0 auto", padding: "0 24px",
    "box-sizing": "border-box", position: "relative", "z-index": "1",
  }, decls || {}));
}

/** Médaillon : un disque pâle portant une icône. Centré, il ouvre les états d'événement. */
export function medaillon(nomIcone, teinte) {
  const t = TEINTES[teinte] || TEINTES.bleu;
  const d = el("div", {
    width: "76px", height: "76px", "border-radius": "50%", background: t.fond,
    display: "flex", "align-items": "center", "justify-content": "center",
    margin: "0 auto 22px",
  });
  d.appendChild(ICONES[nomIcone](31, t.encre));
  return d;
}

export const titre = (texte, aligne) => el("h1", {
  font: "400 27px/1.26 " + SERIF, color: MARINE, margin: "0 0 10px",
  "letter-spacing": "-.012em", "text-align": aligne || "center",
}, texte);

export const sousTitre = (texte) => el("p", {
  font: "500 15px/1.4 " + SANS, color: ENCRE, margin: "0 0 16px", "text-align": "center",
}, texte);

/** Corps : une ligne par élément, jamais de paragraphe justifié. */
export function corps(lignes, aligne) {
  const p = el("p", { margin: "0 0 22px", color: ATONE, font: "14.5px/1.6 " + SANS,
    "text-align": aligne || "center" });
  lignes.forEach((l, i) => {
    if (i) p.appendChild(document.createElement("br"));
    p.appendChild(el("span", null, l));
  });
  return p;
}

function bouton(label, nomIcone, primaire) {
  const b = el("button", {
    display: "flex", "align-items": "center", "justify-content": "center", gap: "9px",
    width: "100%", font: "600 15px/1 " + SANS,
    color: primaire ? PAPIER : ENCRE,
    background: primaire ? MARINE : CARTE,
    border: "1px solid " + (primaire ? MARINE : LIGNE),
    "border-radius": "10px", padding: "14px 18px", cursor: "pointer",
    appearance: "none", "pointer-events": "auto",
    "box-shadow": primaire ? "0 1px 2px rgba(1,36,84,.16)" : "0 1px 1px rgba(26,30,36,.04)",
  });
  b.type = "button";
  if (nomIcone) b.appendChild(ICONES[nomIcone](17, primaire ? PAPIER : ENCRE));
  b.appendChild(el("span", null, label));
  return b;
}
export const ctaPrincipal = (label, nomIcone) => bouton(label, nomIcone, true);
export const ctaSecondaire = (label, nomIcone) => bouton(label, nomIcone, false);

/** Bouton portant la pastille Word plutôt qu'une icône au trait. */
export function ctaWord(label) {
  const b = ctaSecondaire(label, null);
  b.insertBefore(pastilleWord(18), b.firstChild);
  return b;
}

/** Pilule d'information : une icône, une phrase. Jamais une alerte criante. */
export function pilule(texte, teinte) {
  const t = TEINTES[teinte] || TEINTES.bleu;
  const d = el("div", {
    display: "flex", "align-items": "flex-start", gap: "9px", padding: "11px 13px",
    background: t.fond, "border-radius": "9px", margin: "0 0 14px", "text-align": "left",
  });
  const i = ICONES.info(16, t.encre);
  put(i, { "flex-shrink": "0", "margin-top": "1px" });
  d.appendChild(i);
  d.appendChild(el("span", { font: "13px/1.5 " + SANS, color: ENCRE }, texte));
  return d;
}

/** Carte d'état : une icône, un libellé, une valeur. Jamais une métrique. */
export function carteEtat(icone, libelle, valeur) {
  const c = el("div", {
    display: "flex", "align-items": "center", gap: "10px", padding: "11px 13px",
    background: CARTE, border: "1px solid " + LIGNE, "border-radius": "10px",
    "box-shadow": "0 1px 1px rgba(26,30,36,.03)",
  });
  c.appendChild(icone);
  const t = el("div", { display: "flex", "flex-direction": "column", gap: "1px",
    "min-width": "0" });
  t.appendChild(el("span", { font: "12.5px/1.3 " + SANS, color: ATONE }, libelle));
  t.appendChild(el("span", { font: "500 13.5px/1.3 " + SANS, color: ENCRE }, valeur));
  c.appendChild(t);
  return c;
}

/** Ligne de pied discrète : une icône, une phrase, centrées. */
export function mention(nomIcone, texte) {
  const d = el("div", { display: "flex", "align-items": "center", "justify-content": "center",
    gap: "7px", margin: "18px 0 0", font: "12.5px/1.4 " + SANS, color: ATONE });
  d.appendChild(ICONES[nomIcone](14, ATONE));
  d.appendChild(el("span", null, texte));
  return d;
}

/** Prépare la page : papier, paysage, et une colonne verticale. */
export function page(intensite) {
  document.body.textContent = "";
  put(document.body, {
    margin: "0", background: PAPIER, color: ENCRE, "min-height": "100vh",
    font: "15px/1.6 " + SANS, overflow: "hidden auto",
  });
  document.body.appendChild(paysage(intensite));
  const p = el("div", { position: "relative", "z-index": "1", display: "flex",
    "flex-direction": "column", "min-height": "100vh" });
  document.body.appendChild(p);
  return p;
}
