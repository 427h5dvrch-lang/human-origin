// Langue de l'application. Une seule règle, et elle est figée :
//
//     choix explicite de la personne  >  locale de l'hôte  >  anglais
//
// Aucun repli vers une chaîne française codée en dur : une clé absente de la langue demandée est
// cherchée en anglais, et nulle part ailleurs. Si elle manque aussi en anglais, la clé elle-même
// est rendue — visible, donc corrigeable, plutôt que silencieusement remplacée.
//
// Les clés sont sémantiques et stables : elles décrivent l'endroit et le rôle du texte, jamais son
// contenu. Une reformulation ne change donc pas de clé.

const CHOIX = "ho.langue";                 // mémorisé localement, par surface, sans compte ni suivi

export const CATALOGUE = {
  fr: {
    "setup.word.explain": "HumanOrigin doit préparer Microsoft Word. macOS va vous demander l’autorisation d’accéder aux données de Word.",
    "setup.word.progress": "Préparation de Word… Répondez à la demande de macOS si elle s’affiche.",
    "setup.word.failed": "La préparation de Word a échoué.",

    "document.creating": "Préparation de l’emplacement et création du document…",
    "document.failed": "Le document n’a pas pu être créé.",

    "location.title": "Emplacement de vos documents HumanOrigin",
    "location.none": "aucun emplacement proposé",
    "location.explain": "HumanOrigin crée ce dossier s’il n’existe pas, y enregistre vos documents HumanOrigin et ne surveille que lui. Vous pourrez le changer plus tard. macOS peut vous demander d’autoriser HumanOrigin à accéder à cet emplacement.",
    "location.confirm": "Créer le document ici",
    "location.other": "Choisir un autre emplacement…",
    "location.failed": "L’emplacement n’a pas pu être choisi.",

    "word.outdated": "L’intégration Word doit être mise à jour.",
    "word.notReady": "Word n’est pas encore prêt pour HumanOrigin.",
    "word.update": "Mettre à jour l’intégration Word",
    "word.install": "Installer l’intégration Word",
    "word.ready": "Microsoft Word est prêt.",
    "word.newDocument": "Nouveau document HumanOrigin",
    "word.keepAppOpen": "Gardez l’application HumanOrigin ouverte pendant votre travail.",
    "word.repair": "Réparer l’intégration Word",

    "panel.title": "HumanOrigin est prêt",
    "panel.subtitle": "HumanOrigin fonctionne en arrière-plan lorsque vous finalisez un document depuis Word.",
    "panel.section.word": "Microsoft Word",
    "panel.section.folders": "Dossiers surveillés",
    "panel.folders.none": "Aucun pour l’instant. Un emplacement vous sera proposé à la création de votre premier document.",
    "panel.folders.edit": "Modifier les dossiers",
    "panel.folders.saveFailed": "La modification n'a pas pu être enregistrée.",
    "panel.section.activity": "Dernière activité",
    "panel.activity.lastProof": "Dernière preuve finalisée",
    "panel.activity.none": "Aucune preuve finalisée pour le moment.",

    "fatal.title": "HumanOrigin n'a pas pu démarrer",
    "fatal.body": "L'application n'a pas pu lire sa configuration. Relancez-la ; si le problème persiste, ce message aidera à l'identifier.",
    "fatal.unknown": "erreur inconnue",

    "onboarding.folders.title": "Choisissez les dossiers dans lesquels HumanOrigin peut finaliser vos documents.",
    "onboarding.folders.explain": "HumanOrigin n'ouvrira que les documents qu'il a lui-même marqués, et seulement dans ces dossiers. Rien d'autre n'est lu.",
    "onboarding.folders.add": "Ajouter un dossier",
    "onboarding.folders.none": "aucun dossier pour l'instant",
  },
  // Phase 2 : l'anglais est rédigé puis soumis à revue avant d'être figé. Les clés marquées
  // « revue doctrinale » dans le glossaire ne seront pas intégrées sans cette revue.
  en: {},
};

let choisie = null;
try { choisie = localStorage.getItem(CHOIX); } catch (e) { choisie = null; }

/** Locale de l'hôte : celle du système, telle que la vue la reçoit. */
function hote() {
  try { return String(navigator.language || ""); } catch (e) { return ""; }
}

/** Français si la locale est française ; anglais pour toute autre locale en V1. */
export function langue() {
  if (choisie === "fr" || choisie === "en") return choisie;
  return hote().toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function setLangue(l) {
  if (l !== "fr" && l !== "en") return;
  choisie = l;
  try { localStorage.setItem(CHOIX, l); } catch (e) { /* refus de stockage : la session reste valide */ }
}

/** Rend le texte d'une clé. Anglais en repli, jamais le français. */
export function t(cle, vars) {
  const l = langue();
  let s = CATALOGUE[l] && CATALOGUE[l][cle];
  if (s === undefined) s = CATALOGUE.en[cle];
  if (s === undefined) return cle;
  if (vars) for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
}

/** Clés absentes d'une langue : sert au contrôle de complétude, pas au produit. */
export function manquantes(l) {
  const ref = Object.keys(CATALOGUE.fr);
  return ref.filter((k) => !(CATALOGUE[l] || {})[k]);
}
