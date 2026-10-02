// Capteur d'intégrité hors bande — PROTOTYPE, hors production.
//
// LA QUESTION : pendant une période d'observation active, le fichier peut être modifié par
// une source extérieure à l'adapter. Si cette modification est encore là à la fermeture,
// l'engagement la couvre et l'artefact ressort « concordant » alors qu'il contient du
// contenu jamais observé. C'est cette incorporation silencieuse qu'il faut empêcher.
//
// CE QUI A ÉTÉ ÉCARTÉ, ET POURQUOI
//
// L'hypothèse de départ était d'utiliser une surveillance de fichier comme capteur
// secondaire. Une sonde dans un vrai VS Code a montré que `createFileSystemWatcher` ne
// voit RIEN hors des dossiers du workspace — zéro événement, y compris pour une
// sauvegarde normale. Comme capteur d'intégrité, il est inutilisable tel quel.
//
// LA PRIMITIVE RETENUE : LA RÉCONCILIATION
//
// L'adapter connaît l'état que la chaîne observée implique : c'est le tampon de l'éditeur,
// puisque toute modification du tampon émet un événement que l'adapter enregistre. On
// compare donc cet état attendu aux octets réellement sur le disque.
//
//   octets du disque == état attendu  → l'écriture s'explique par la chaîne observée
//   octets du disque != état attendu  → quelque chose a écrit hors de cette chaîne
//
// LE FAUX POSITIF QUE J'AVAIS MANQUÉ
//
// J'ai d'abord cru que comparer l'état suffisait et ne pouvait pas produire de faux
// positif sur une sauvegarde. Le banc a montré le contraire : une sauvegarde normale de
// VS Code produit un instant où le fichier sur disque diffère du tampon — l'écriture est
// surprise en cours. Six sauvegardes successives ont produit un écart.
//
// La correction tient en une phrase : **une divergence instantanée pendant une écriture
// n'est pas une preuve de modification extérieure ; seule une divergence qui PERSISTE
// l'est.** Un écart n'est donc retenu qu'après confirmation, une fois l'écriture stabilisée.
//
// Le prix de cette correction est explicite : la fenêtre de stabilisation est aussi une
// fenêtre d'aveuglement. Une écriture étrangère qui apparaît et disparaît à l'intérieur ne
// sera pas vue. Voir le scénario 6.
//
// CE QUE LE CAPTEUR NE DIT JAMAIS
//   - qui a modifié ;
//   - comment ;
//   - ce qui a été modifié.
// Un écart détecté n'est JAMAIS converti en événement observé. Il est enregistré comme
// écart, dans un champ distinct des faits.

import fs from "node:fs";
import crypto from "node:crypto";

export const ETAT = {
  CONTINUE: "observation_continue",
  ECART: "changement_non_attribuable_detecte",
  INDETERMINE: "integrite_non_surveillee",
};

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

export class SondeIntegrite {
  /**
   * @param chemin        l'artefact surveillé
   * @param etatAttendu   fonction rendant le contenu que la chaîne observée implique
   *                      (pour un adapter d'éditeur : le texte du tampon)
   */
  constructor({ chemin, etatAttendu }) {
    this.chemin = chemin;
    this.etatAttendu = etatAttendu;
    this.ecarts = [];
    // Divergences vues pendant une écriture et NON retenues. Information, pas verdict.
    this.divergences_transitoires = 0;
    this.verifications = 0;
    this.ancrages = 0;
    this.etatConnu = null;
    // Délai de stabilisation. Trop court : on surprend les écritures. Trop long : on
    // aveugle d'autant la surveillance.
    this.stabilisation_ms = 200;
    this.surveille = false;
    this._w = null;
  }

  /**
   * Compare l'état du disque à celui qu'implique la chaîne observée.
   * `confirme` distingue un relevé brut d'un écart retenu : seul un relevé pris après
   * stabilisation peut valoir écart.
   */
  verifier(contexte = "controle", { confirme = true } = {}) {
    this.verifications++;
    let octets;
    try { octets = fs.readFileSync(this.chemin); }
    catch (e) {
      // Fichier absent un instant : c'est le cas pendant une sauvegarde atomique.
      // On ne conclut rien d'une absence.
      return { attribuable: null, raison: "fichier illisible a cet instant" };
    }
    const attendu = Buffer.from(this.etatAttendu(), "utf8");
    const egal = octets.equals(attendu);
    if (!egal && !confirme) {
      // Divergence vue pendant une écriture : on la compte, on ne la retient pas.
      this.divergences_transitoires++;
      return { attribuable: false, retenu: false };
    }
    if (!egal) {
      this.ecarts.push({
        at: new Date().toISOString(),
        contexte,
        empreinte_disque: sha(octets),
        empreinte_attendue: sha(attendu),
        octets_disque: octets.length,
        octets_attendus: attendu.length,
        mention: "l'etat du fichier ne s'explique pas par la chaine d'evenements observee ; " +
                 "ni l'auteur, ni la nature de cette modification ne sont connus",
      });
    }
    return { attribuable: egal };
  }

  /**
   * ANCRAGE SUR LES SAUVEGARDES OBSERVÉES — la primitive retenue après deux échecs.
   *
   * L'adapter n'écrit jamais dans l'artefact. Les seules écritures légitimes sont donc
   * celles de l'éditeur, et l'adapter SAIT quand l'éditeur enregistre : l'événement de
   * sauvegarde est non ambigu, là où l'événement de changement ne l'est pas.
   *
   * La règle devient : après chaque sauvegarde observée, on relève l'état du fichier et
   * on le retient comme état connu. Toute divergence ultérieure, en l'absence de nouvelle
   * sauvegarde observée, est une écriture qui n'est pas venue de l'éditeur.
   *
   * Ce que cela règle, et que les deux tentatives précédentes ne réglaient pas :
   *   - la sauvegarde atomique ne produit plus de faux positif, quel que soit le nombre
   *     d'écritures intermédiaires, puisque l'état connu est repris APRÈS la sauvegarde ;
   *   - un rechargement après modification externe ne peut plus se faire passer pour une
   *     édition, puisqu'on ne compare plus au tampon mais à un état ancré.
   */
  ancrer(contexte = "sauvegarde_observee") {
    try { this.etatConnu = fs.readFileSync(this.chemin); this.ancrages++; }
    catch (e) { /* fichier momentanement absent : on n'ancre pas */ }
  }

  /** Compare l'état du disque à l'état ancré après la dernière sauvegarde observée. */
  verifierDepuisAncrage(contexte = "controle") {
    this.verifications++;
    if (!this.etatConnu) return { attribuable: null, raison: "aucun ancrage" };
    let octets;
    try { octets = fs.readFileSync(this.chemin); }
    catch (e) { return { attribuable: null, raison: "fichier illisible" }; }
    if (octets.equals(this.etatConnu)) return { attribuable: true };
    this.ecarts.push({
      at: new Date().toISOString(), contexte,
      empreinte_disque: sha(octets), empreinte_ancree: sha(this.etatConnu),
      octets_disque: octets.length, octets_ancres: this.etatConnu.length,
      mention: "le fichier a change depuis la derniere sauvegarde observee, sans qu'une " +
               "nouvelle sauvegarde ait ete observee ; ni l'auteur ni la nature de cette " +
               "modification ne sont connus",
    });
    return { attribuable: false };
  }

  /**
   * Surveillance continue. Elle sert UNIQUEMENT à déclencher des vérifications : c'est la
   * comparaison qui décide, jamais l'événement de fichier.
   */
  demarrer() {
    try {
      this._w = fs.watch(this.chemin, { persistent: false }, () => {
        // Relevé brut immédiat : il renseigne, il ne conclut pas.
        this.verifier("ecriture", { confirme: false });
        // Puis un relevé après stabilisation, le seul qui puisse retenir un écart.
        clearTimeout(this._t);
        this._t = setTimeout(() => this.verifier("ecriture_stabilisee"), this.stabilisation_ms);
      });
      this.surveille = true;
    } catch (e) { this.surveille = false; }
    return this.surveille;
  }

  /** Attend que les écritures en cours se posent, puis vérifie. */
  async verifierStabilise(contexte = "fermeture") {
    clearTimeout(this._t);
    await new Promise(r => setTimeout(r, this.stabilisation_ms));
    return this.verifier(contexte);
  }

  arreter() { clearTimeout(this._t); if (this._w) { this._w.close(); this._w = null; } }

  /**
   * Un changement est arrivé à l'artefact SANS passer par la chaîne observée — par
   * exemple un rechargement de l'éditeur après modification externe. Il est enregistré
   * comme écart, JAMAIS converti en événement observé.
   */
  noterChangementHorsChaine({ octets_avant, octets_apres, contexte = "hors_chaine" }) {
    this.ecarts.push({
      at: new Date().toISOString(),
      contexte,
      octets_avant, octets_apres,
      mention: "l'artefact a change sans que ce changement passe par la chaine observee ; " +
               "ni l'auteur, ni la nature de cette modification ne sont connus",
    });
  }

  /** Le verdict, et sa portée. */
  bilan() {
    const etat = this.verifications === 0 || this.ancrages === 0 ? ETAT.INDETERMINE
      : this.ecarts.length ? ETAT.ECART : ETAT.CONTINUE;
    return {
      etat,
      verifications: this.verifications,
      ancrages: this.ancrages,
      divergences_transitoires: this.divergences_transitoires,
      surveillance_continue: this.surveille,
      ecarts: this.ecarts,
      ce_que_cela_dit: {
        [ETAT.CONTINUE]:
          "a chaque verification, l'etat du fichier s'expliquait par la chaine d'evenements observee",
        [ETAT.ECART]:
          "a au moins une verification, l'etat du fichier ne s'expliquait pas par la chaine observee",
        [ETAT.INDETERMINE]:
          "aucune verification n'a eu lieu : rien n'est affirme sur l'integrite de la periode",
      }[etat],
      ce_que_cela_ne_dit_pas: [
        "qui a modifie le fichier",
        "comment, ni avec quel outil",
        "qu'aucune modification n'a eu lieu entre deux verifications",
        "qu'aucune modification n'a eu lieu A L'INTERIEUR d'une fenetre de stabilisation",
        "que chaque octet provient d'une frappe",
      ],
    };
  }
}
