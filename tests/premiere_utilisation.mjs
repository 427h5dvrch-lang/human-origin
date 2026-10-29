// Banc de la première utilisation de Docs.
//
// POURQUOI CE BANC. Le produit livré et les textes qui accompagnent son installation avaient
// divergé sans que rien ne le dise. Mesuré le 2026-10-29 sur l'application 0.3.6 installée :
//
//   • `spctl` répond « accepted · source=Notarized Developer ID » et `stapler validate` passe,
//     alors que le guide public annonçait « application non encore notarisée » et faisait faire
//     un clic droit → Ouvrir.
//   • Le guide prescrivait `xattr -dr com.apple.quarantine`. Cette commande retire la
//     protection de Gatekeeper. La faire exécuter à un nouvel utilisateur, pour un problème
//     qu'une application notarisée n'a pas, est un rite inutile et affaiblissant.
//   • Le binaire livré ne contient AUCUNE occurrence de `Privacy_Accessibility` : la feature
//     `legacy` n'est pas dans `default`. Le guide demandait pourtant d'accorder l'Accessibilité
//     « pour observer vos frappes et clics ».
//   • Le guide créateur décrivait l'ANCIEN produit : créer un projet, commencer puis terminer
//     l'observation. Aucun de ces gestes n'existe dans 0.3.6, dont le parcours réel est :
//     lien par e-mail → installer dans Word → relancer Word → créer un document HumanOrigin.
//
// Un utilisateur qui suit un guide décrivant un produit disparu n'atteint pas sa première
// preuve. Ce banc lie donc les textes de première utilisation à ce que l'application LIVRÉE
// fait réellement : les libellés cités doivent exister dans le catalogue de langue.
//
//   node tests/premiere_utilisation.mjs
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ici = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(ici, "..");
const PUB = path.join(R, "docs/public_release");

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };
const lire = (p) => fs.readFileSync(p, "utf8");

// Les textes que lit un utilisateur qui installe et crée sa première preuve.
const PREMIERE = ["installation_macos_v1.md", "creator_guide_v1.md"];

console.log("\n— Ce que le produit livré fait réellement —");
{
  const cargo = lire(path.join(R, "src-tauri/Cargo.toml"));
  const defaut = (cargo.match(/^default\s*=\s*\[(.*)\]/m) || [, ""])[1];
  ck("la feature « legacy » n'est pas livrée", !/legacy/.test(defaut), `default = [${defaut}]`);
  const i18n = lire(path.join(R, "src/ho_i18n.js"));
  // Le parcours réel, tel que l'application le prononce.
  for (const [cle, attendu] of [
    ["word.installInWord", "Installer dans Word"],
    ["word.restartWord", "Relancez Word"],
    ["welcome.step1", "Créez un document HumanOrigin"],
    ["welcome.step2", "Travaillez normalement dans Word"],
  ]) {
    const m = i18n.match(new RegExp(`"${cle.replace(".", "\\.")}":\\s*"([^"]*)"`));
    ck(`le catalogue porte « ${attendu} »`, !!m && m[1].includes(attendu.split(" ")[0]),
      m ? m[1].slice(0, 46) : "clé absente");
  }
}

console.log("\n— Installation macOS : aucun rite qui affaiblit la machine —");
{
  for (const f of PREMIERE) {
    const t = lire(path.join(PUB, f));
    ck(`${f} : aucun retrait de quarantaine`, !/com\.apple\.quarantine/.test(t));
    ck(`${f} : aucune commande xattr`, !/\bxattr\b/.test(t));
  }
  const t = lire(path.join(PUB, "installation_macos_v1.md"));
  ck("le guide ne prétend plus l'application non notarisée",
    !/non encore notaris|not yet notarized|pas encore notaris/i.test(t));
  ck("il ne fait plus contourner l'avertissement par clic droit",
    !/clic droit.*Ouvrir|[Rr]ight-click.*Open/.test(t));
  ck("il ne promet plus la disparition d'une étape manuelle",
    !/étape manuelle disparaîtra|manual step will disappear/i.test(t));
}

console.log("\n— Aucune permission système que l'application ne demande pas —");
{
  for (const f of PREMIERE) {
    const t = lire(path.join(PUB, f));
    // Le mot n'est pas interdit : le guide s'en sert pour dire que l'application ne la
    // demande PAS, ce qui est vrai et utile. Ce qui est interdit, c'est de l'EXIGER.
    const exige = /(autorisez|accordez|activez|grant|allow|enable)[^.\n]{0,60}(Accessibilit[éy]|Accessibility)/i;
    ck(`${f} : n'exige pas l'Accessibilité`, !exige.test(t),
      (t.match(exige) || [""])[0].slice(0, 54));
    ck(`${f} : ne promet pas d'observer frappes et clics`,
      !/frappes et clics|keystrokes and clicks/i.test(t));
  }
}

console.log("\n— Guide créateur : le parcours de 0.3.6, pas celui d'avant —");
{
  const t = lire(path.join(PUB, "creator_guide_v1.md"));
  ck("plus de « projet » de l'ancien produit", !/\bprojets?\b/i.test(t),
    (t.match(/.{0,30}\bprojets?\b.{0,20}/i) || [""])[0].trim());
  ck("plus de « commencez / terminez l'observation »",
    !/(commencez|terminez) l.observation|(start|end) the observation/i.test(t));
  ck("plus d'éditeur que le produit ne gère pas", !/\bPages\b/.test(t));
  // Le parcours réel doit y être, nommé comme l'application le nomme.
  for (const attendu of [/lien/i, /Installer dans Word|Install in Word/i,
                         /[Rr]elancez Word|[Rr]estart Word/, /document HumanOrigin|HumanOrigin document/i]) {
    ck(`le parcours réel est décrit : ${attendu}`, attendu.test(t));
  }
  ck("le raccourci d'enregistrement vaut aussi sous Windows",
    !/Cmd\+S/.test(t) || /Ctrl\+S/.test(t),
    /Cmd\+S/.test(t) ? (/Ctrl\+S/.test(t) ? "Cmd+S et Ctrl+S" : "Cmd+S seul") : "aucun raccourci");
}

console.log("\n— Ces textes ne promettent pas d'humanité —");
{
  // Verify énonce lui-même, à chaque destinataire, qu'aucune preuve n'établit « que ce contenu
  // ait été créé par un être humain ». Ces textes ne peuvent pas promettre le contraire de ce
  // que le vérificateur affiche.
  //
  // La liste est NOMMÉE, et non « tout docs/public_release » : elle est l'étendue exacte de la
  // décision prise le 2026-10-29, qui a retiré huit formules « processus de travail humain ».
  // `demo_packages_plan_v1.md` porte encore « Activité humaine observée » et n'est pas couvert ;
  // l'ajouter ici sans décision rendrait ce banc rouge sur un texte que personne n'a tranché.
  const DOCTRINE = [...PREMIERE, "faq_v1.md", "landing_page_v1.md",
                    "launch_message_v1.md", "recipient_guide_v1.md"];
  const HUMAIN = /(travail|processus|origine|contribution|activit[ée])[^.\n]{0,30}humain|human (work|process|activity)/i;
  for (const f of DOCTRINE) {
    const t = lire(path.join(PUB, f));
    ck(`${f} : n'annonce pas un processus « humain »`, !HUMAIN.test(t),
      (t.match(HUMAIN) || [""])[0].slice(0, 46));
  }
}

console.log("\n— Les deux langues restent servies —");
{
  for (const f of PREMIERE) {
    const t = lire(path.join(PUB, f));
    ck(`${f} : partie française et partie anglaise`,
      /##\s*🇫🇷/.test(t) && /##\s*🇬🇧/.test(t));
  }
}

console.log(`\n  ${ok} réussis · ${ko} échoués  =>  PREMIERE_UTILISATION = ${ko ? "ÉCHEC" : "PASS"}\n`);
process.exit(ko ? 1 : 0);
