// Adapter VS Code → modèle générique HumanOrigin — PROTOTYPE, hors production.
//
// CE QUE L'ADAPTER PEUT DIRE, ET RIEN DE PLUS
//
// Un événement reçu ici établit exactement ceci : « une modification a été observée par
// cet adapter, dans cet environnement, à cet instant ». Il n'établit PAS qu'une touche a
// été frappée, PAS qu'une personne a agi, PAS qu'aucun outil n'est intervenu. Ces quatre
// choses sont distinctes et l'adapter n'en voit qu'une.
//
// Ce que l'API de VS Code donne réellement, vérifié dans vscode.d.ts :
//   - TextDocumentContentChangeEvent : range, rangeOffset, rangeLength, text
//     → insertion / suppression / remplacement se déduisent exactement.
//   - TextDocumentChangeEvent.reason : Undo = 1, Redo = 2, sinon undefined.
//     → l'annulation et le rétablissement SONT observables. Word ne le permet pas.
//   - AUCUN événement de collage. `DocumentPasteEditProvider` existe, mais c'est une API
//     de PARTICIPATION au collage, pas d'observation : s'en servir changerait le
//     comportement de l'éditeur. L'adapter ne s'en sert pas.
//   - L'événement de changement ne porte aucune information de périphérique d'entrée.
//     → « tapé au clavier » n'est pas observable. Jamais.

const TYPE = { INSERTION: "insertion", SUPPRESSION: "suppression", REMPLACEMENT: "remplacement" };

/** Classe un changement d'après ce que l'API donne, sans rien supposer au-delà. */
function classer(c) {
  const supprime = c.rangeLength > 0;
  const ajoute = c.text.length > 0;
  if (supprime && ajoute) return TYPE.REMPLACEMENT;
  if (supprime) return TYPE.SUPPRESSION;
  if (ajoute) return TYPE.INSERTION;
  return null; // changement vide : l'API en émet parfois, ils ne disent rien
}

/**
 * Un rechargement depuis le disque est-il distinguable d'une édition ?
 *
 * Constaté dans un vrai VS Code : quand le fichier change hors de l'éditeur, VS Code
 * recharge le document et émet un `onDidChangeTextDocument` ORDINAIRE — `reason` indéfini,
 * un changement qui remplace tout. Rien dans l'événement ne le distingue d'une édition.
 * Sans discriminant, un changement extérieur entrerait dans la chaîne observée comme s'il
 * avait été observé. C'est exactement l'incorporation silencieuse à empêcher.
 *
 * Le seul discriminant trouvé : l'état « modifié » du tampon AU MOMENT de l'événement.
 * Une édition dans l'éditeur salit le tampon ; un rechargement le laisse propre.
 *
 *   edition interne  → isDirty = true
 *   rechargement     → isDirty = false
 *
 * Ce n'est pas une preuve, c'est un discriminant observé, et il a ses angles morts :
 * un document en sauvegarde automatique très agressive, ou une édition programmatique
 * suivie d'une sauvegarde dans le même tour, pourraient le mettre en défaut. Il est donc
 * doublé par la réconciliation à la fermeture, qui ne dépend pas de lui.
 */
function estEditionInterne(e) {
  if (e.reason === 1 || e.reason === 2) return true;  // undo/redo : opérations de l'éditeur
  return e.document.isDirty === true;
}

/**
 * Traduit un TextDocumentChangeEvent en faits du modèle générique.
 * `seuilGrand` reprend le seuil du volet de production.
 */
function evenementVersFaits(e, { seuilGrand = 120 } = {}) {
  const raison = e.reason === 1 ? "undo" : e.reason === 2 ? "redo" : null;
  const faits = [];
  for (const c of e.contentChanges) {
    const type = classer(c);
    if (!type) continue;
    const delta = c.text.length - c.rangeLength;
    const grand = Math.abs(delta) >= seuilGrand;

    faits.push({
      // Les unités du modèle générique. Ici, la ligne de départ du changement : VS Code
      // donne une position exacte, là où Word donne un identifiant de paragraphe.
      unites: [`L${c.range.start.line}`],
      length_delta: delta,
      // `kind` reste descriptif, comme dans le volet.
      kind: raison ? raison : type,
      // La source. JAMAIS "local_editing" pour un undo/redo : ce n'est pas de la saisie,
      // c'est une opération de l'éditeur qui rejoue un état antérieur.
      source: raison ? "editor_operation" : (grand ? "unknown" : "local_editing"),
      capture_assurance: raison ? "medium" : (grand ? "low" : "medium"),
      // Détail propre à cet adapter, conservé parce que l'API le donne vraiment.
      detail_adapter: {
        type,
        offset: c.rangeOffset,
        caracteres_retires: c.rangeLength,
        caracteres_ajoutes: c.text.length,
        raison_editeur: raison,
        // Dit explicitement ce qui n'est PAS observable, pour que l'absence ne passe pas
        // pour une négation.
        collage_observable: false,
        frappe_clavier_observable: false,
      },
    });
  }
  return faits;
}

/** Branche l'adapter sur une Capture générique déjà ouverte. */
function brancher(vscode, capture, { document, seuilGrand = 120 } = {}) {
  return vscode.workspace.onDidChangeTextDocument((e) => {
    if (document && e.document.uri.toString() !== document.uri.toString()) return;
    for (const f of evenementVersFaits(e, { seuilGrand })) {
      capture.changementAnnonceBrut(f);
    }
  });
}

module.exports = { TYPE, classer, estEditionInterne, evenementVersFaits, brancher };
