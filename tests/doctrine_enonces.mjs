// doctrine_enonces.mjs — ce que les textes publics promettent, confronté à ce que le produit établit.
//
// Pourquoi ce banc n'existait pas, et pourquoi il manquait. Le dépôt a une barrière de marque —
// elle protège le dessin. Il n'en avait aucune sur les ÉNONCÉS. La phrase boussole, répliquée
// dans dix documents de `docs/public_release/`, disait :
//
//     « HumanOrigin prouve que vous avez travaillé sur ce document »
//
// Le sujet « vous » promet une identité. Or HumanOrigin établit des faits sur un processus
// observé — un appareil, un instant, des octets — et n'établit PAS qui tenait le clavier. La
// phrase la plus visible du produit promettait donc exactement ce que le produit refuse d'affirmer
// partout ailleurs.
//
// Ce banc rend cette dérive détectable, dans les deux langues.
//
//   node tests/doctrine_enonces.mjs
//
import fs from "node:fs";
import path from "node:path";

const ICI = path.dirname(new URL(import.meta.url).pathname);
const RACINE = path.join(ICI, "..");
const DOSSIER = path.join(RACINE, "docs", "public_release");

let p = 0, f = 0;
const ck = (n, c, d = "") => { c ? p++ : f++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };
const titre = (s) => console.log("\n── " + s + " ──");

// Les énoncés interdits. Chacun porte la raison de son interdiction, pour qu'un relecteur
// comprenne ce qui est refusé — et puisse le contester en connaissance de cause.
//
// Les formes NÉGATIVES sont permises et même souhaitées : « ne prouve pas l'identité » est une
// limite, pas une promesse. D'où les gardes qui excluent les tournures de négation.
const INTERDITS = [
  // L'impératif compte aussi — « Prouvez que vous avez travaillé » promet autant que « prouve
  // que vous avez travaillé ». Et la négation doit être cherchée AVANT le verbe : mon premier
  // motif attrapait « does not prove that you are the sole author », qui est une limite
  // correctement écrite. Un banc qui refuse une bonne limite apprend à être contourné.
  [/(?<!ne\s)(?<!n')(prouve|prouvez|prouver)\s+que\s+(vous|tu|il|elle)\s/i,
   "promet une identité : le sujet d'une preuve n'est pas établi"],
  [/(?<!not\s)(?<!n't\s)\bproves?\s+(that\s+)?(you|he|she|they)\s/i,
   "promet une identité (EN)"],
  [/prouve\s+l'identité|établit\s+(l'|son\s+)?auteur|certifie\s+l'auteur/i,
   "promet d'établir l'auteur"],
  [/proves?\s+(the\s+)?identity|establishes\s+(the\s+)?author/i,
   "promet d'établir l'auteur (EN)"],
  [/prouve\s+que\s+[^.]{0,40}(humain|une personne)/i, "promet une origine humaine"],
  [/\b(sans|absence d')\s*(intelligence artificielle|IA)\b(?![^.]{0,60}n'(est|établit) pas)/i,
   "promet l'absence d'IA"],
  [/\bAI-free\b|\bAI detect(or|ion)\b/i, "promet l'absence d'IA, ou se dit détecteur (EN)"],
  [/(scène|image|photo|vidéo)s?\s+(authentiques?|vraies?)/i, "promet la vérité de la scène"],
];

titre("les textes publics ne promettent pas d'identité");
{
  const fichiers = fs.existsSync(DOSSIER)
    ? fs.readdirSync(DOSSIER).filter((x) => x.endsWith(".md")) : [];
  ck("des textes publics sont trouvés", fichiers.length > 0, fichiers.length + " fichiers");

  // Reconnaître une limite correctement écrite. Sans cela le banc refuse « ne prouve pas
  // l'absence d'IA » — exactement la phrase qu'on veut voir dans les textes. Un banc qui refuse
  // une bonne limite apprend à être contourné, ce qui est pire que de ne rien vérifier.
  const NIE = /\b(ne\s+(?:le\s+)?prouven?t?\s+(?:\*\*)?pas|n'(?:établit|identifie|affirme|est)\s+pas|ne\s+(?:détecte|certifie|garantit)\s+pas|does\s+not\s+(?:\*\*)?(?:prove|establish|identify|detect|certify)|does\s+\*\*not\*\*\s+(?:prove|establish)|is\s+not\s+established|neither)\b/i;
  const fautes = [];
  for (const nom of fichiers) {
    const texte = fs.readFileSync(path.join(DOSSIER, nom), "utf8");
    for (const ligne of texte.split("\n")) {
      if (NIE.test(ligne)) continue;        // c'est une limite, pas une promesse
      for (const [motif, raison] of INTERDITS)
        if (motif.test(ligne)) fautes.push(`${nom} — ${raison}\n      « ${ligne.trim().slice(0, 96)} »`);
    }
  }
  ck("aucun énoncé interdit dans docs/public_release/", fautes.length === 0,
    fautes.length ? "\n    " + fautes.slice(0, 4).join("\n    ") : "");

  // Et la contrepartie : les limites doivent être ÉCRITES, pas seulement non contredites.
  const tout = fichiers.map((n) => fs.readFileSync(path.join(DOSSIER, n), "utf8")).join("\n");
  for (const [quoi, motif] of [
    ["l'identité ou l'auteur n'est pas établi",
     /n'(établit|identifie)\s+pas[^.]{0,40}(identité|auteur|qui)|ne\s+prouve\s+(?:\*\*)?pas[^.]{0,50}auteur|does\s+not\s+(?:\*\*)?(establish|identify|prove)[^.]{0,60}(identity|author)|does\s+\*\*not\*\*\s+prove[^.]{0,60}author/i],
    ["l'IA n'est pas détectée", /ne détecte pas[^.]{0,30}(l'IA|intelligence artificielle)|does not detect[^.]{0,20}AI/i],
  ])
    ck(`les textes disent que ${quoi}`, motif.test(tout));
}

titre("le banc sait refuser");
{
  const essai = (ligne) => INTERDITS.some(([m]) => m.test(ligne));
  ck("il prend l'ancienne phrase boussole",
    essai("HumanOrigin prouve que vous avez travaillé sur ce document — pas ce que vous avez écrit."));
  ck("il prend sa version anglaise",
    essai("HumanOrigin proves you worked on this document — not what you wrote."));
  ck("il prend « prouve l'identité »", essai("Le certificat prouve l'identité du créateur."));
  ck("il laisse passer une LIMITE correctement écrite",
    !essai("HumanOrigin ne prouve pas l'identité de l'auteur."));
  ck("et une limite anglaise", !essai("HumanOrigin does not establish the identity of the author."));
  ck("il laisse passer un énoncé de processus",
    !essai("HumanOrigin établit qu'un travail a été observé sur ce document."));
}

console.log(`\n  ${p} réussis · ${f} échoués  =>  DOCTRINE_ENONCES = ${f ? "ÉCHEC" : "PASS"}\n`);
process.exit(f ? 1 : 0);
