// Banc de la langue de l'application.
//
// Le 2026-10-03, le Language Launch Gate a établi que l'application livrée était inutilisable
// en anglais : le catalogue anglais ne portait que les 12 clés du compte, et `t()` rendait la
// clé elle-même quand elle manquait. Un Mac configuré en anglais affichait donc « fatal.title »
// ou « location.confirm » à l'écran — ni français, ni anglais. Le réglage « Langue » existait
// mais n'était pas cliquable, et `setLangue` n'était appelé nulle part.
//
// Ce banc empêche ces trois défauts de revenir : il exige des catalogues de mêmes clés, un
// repli qui donne toujours une phrase, et l'absence de français hors de `t()` dans les modules
// réellement chargés par index.html.
//
//   node tests/i18n_langue.mjs
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ici = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ici, "../src");

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? "  → " + d : ""}`); };

/** Un stockage local de test : il retient, et il peut aussi refuser, comme en navigation privée. */
function stockage(initial = {}, refuse = false) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (refuse ? (() => { throw new Error("refus"); })() : (m.has(k) ? m.get(k) : null)),
    setItem: (k, v) => { if (refuse) throw new Error("refus"); m.set(k, String(v)); },
    _m: m,
  };
}

// Le module lit `navigator.language` et `localStorage` à son chargement : pour éprouver
// plusieurs départs à froid, on réinstalle les globales puis on recharge le module.
let graine = 0;
async function charger({ locale = "en-US", initial = {}, refuse = false } = {}) {
  Object.defineProperty(globalThis, "navigator", { value: { language: locale }, configurable: true });
  const st = stockage(initial, refuse);
  Object.defineProperty(globalThis, "localStorage", { value: st, configurable: true });
  const mod = await import(`../src/ho_i18n.js?graine=${++graine}`);
  return { mod, st };
}

console.log("\n— Catalogues —");
{
  const { mod } = await charger();
  const fr = Object.keys(mod.CATALOGUE.fr), en = Object.keys(mod.CATALOGUE.en);
  ck("le catalogue français n'est pas vide", fr.length > 100, `${fr.length} clés`);
  ck("les deux catalogues portent les mêmes clés",
    mod.manquantes("en").length === 0 && mod.manquantes("fr").length === 0,
    `absentes en EN : ${mod.manquantes("en").length}, en FR : ${mod.manquantes("fr").length}`);
  const sup = en.filter((k) => !Object.prototype.hasOwnProperty.call(mod.CATALOGUE.fr, k));
  ck("aucune clé anglaise orpheline", sup.length === 0, sup.join(", "));
  const vides = fr.filter((k) => !String(mod.CATALOGUE.fr[k]).trim()
                              || !String(mod.CATALOGUE.en[k]).trim());
  ck("aucune valeur vide", vides.length === 0, vides.join(", "));

  // Du français resté dans le catalogue anglais est exactement ce que le gate a sanctionné.
  // L'apostrophe typographique n'en est pas un indice : « Word’s data » est de l'anglais
  // correctement composé. Seules les lettres accentuées et les mots français le sont.
  const ACCENTS = /[éèêëàâçùûôîïœÉÈÀÇ]/;
  const MOTS_FR = /\b(le|la|les|une|des|du|vous|votre|vos|est|sont|pas|dans|avec|pour|que|qui|cette|aucun|aucune|et|ou|ne|sur|votre)\b/i;
  const suspectes = en.filter((k) => {
    const v = String(mod.CATALOGUE.en[k]);
    return ACCENTS.test(v) || MOTS_FR.test(v);
  });
  ck("aucun français dans le catalogue anglais", suspectes.length === 0,
    suspectes.slice(0, 6).map((k) => `${k}="${mod.CATALOGUE.en[k]}"`).join(" | "));
}

console.log("\n— Rendu : jamais une clé brute —");
{
  const { mod } = await charger();
  for (const l of ["fr", "en"]) {
    mod.setLangue(l);
    const brutes = Object.keys(mod.CATALOGUE.fr).filter((k) => mod.t(k) === k
      && mod.CATALOGUE.fr[k] !== k);
    ck(`aucune clé rendue telle quelle en ${l.toUpperCase()}`, brutes.length === 0,
      brutes.slice(0, 5).join(", "));
  }
  // Une clé qui n'existerait qu'en français doit donner du français, pas son identifiant.
  mod.CATALOGUE.fr["banc.repli"] = "Texte de repli";
  mod.setLangue("en");
  ck("une clé absente de l'anglais se replie sur le français",
    mod.t("banc.repli") === "Texte de repli", mod.t("banc.repli"));
  delete mod.CATALOGUE.fr["banc.repli"];
  ck("une clé inconnue partout reste visible comme clé",
    mod.t("banc.inexistante") === "banc.inexistante");
  mod.setLangue("fr");
  ck("les variables sont substituées", mod.t("banc.inexistante", { x: 1 }) === "banc.inexistante");
}

console.log("\n— Langue par défaut, au démarrage à froid —");
{
  for (const [locale, attendu] of [["fr-FR", "fr"], ["fr", "fr"], ["fr-CA", "fr"],
                                   ["en-US", "en"], ["en-GB", "en"], ["de-DE", "en"],
                                   ["ja-JP", "en"], ["", "en"]]) {
    const { mod } = await charger({ locale });
    ck(`locale « ${locale || "(vide)"} » → ${attendu}`, mod.langue() === attendu, mod.langue());
  }
}

console.log("\n— Choix explicite, réversibilité, persistance —");
{
  const { mod, st } = await charger({ locale: "en-US" });
  ck("départ à froid en anglais", mod.langue() === "en");
  const vus = [];
  mod.onLangueChange((l) => vus.push(l));

  // La séquence exigée par le gate : EN → FR → EN → FR → EN, sans rechargement.
  const sequence = ["fr", "en", "fr", "en"];
  let reversible = true;
  for (const l of sequence) {
    mod.setLangue(l);
    if (mod.langue() !== l) reversible = false;
    // Un texte réel, pas seulement le drapeau de langue.
    const attendu = mod.CATALOGUE[l]["panel.title"];
    if (mod.t("panel.title") !== attendu) reversible = false;
  }
  ck("EN → FR → EN → FR → EN : chaque bascule prend effet", reversible);
  ck("chaque changement prévient les vues", vus.join(",") === sequence.join(","), vus.join(","));
  ck("le choix est écrit dans le stockage local", st._m.get("ho.langue") === "en",
    String(st._m.get("ho.langue")));

  // Réouverture : le choix survit, et il l'emporte sur la locale de l'hôte.
  const { mod: apres } = await charger({ locale: "fr-FR", initial: { "ho.langue": "en" } });
  ck("après réouverture, le choix explicite est repris", apres.langue() === "en", apres.langue());
  ck("le choix explicite l'emporte sur une locale française", apres.t("panel.title")
    === apres.CATALOGUE.en["panel.title"]);

  // Une valeur abîmée ne doit pas rendre l'application muette.
  const { mod: abime } = await charger({ locale: "fr-FR", initial: { "ho.langue": "klingon" } });
  ck("un choix mémorisé invalide est ignoré", abime.langue() === "fr", abime.langue());

  // Navigation privée : le stockage refuse, la session reste utilisable.
  const { mod: prive } = await charger({ locale: "en-US", refuse: true });
  prive.setLangue("fr");
  ck("un stockage qui refuse ne casse pas le changement de langue", prive.langue() === "fr");
}

console.log("\n— Locale de formatage des dates —");
{
  const { mod } = await charger();
  mod.setLangue("fr"); const lfr = mod.locale();
  mod.setLangue("en"); const len = mod.locale();
  ck("la locale de date suit la langue", lfr === "fr-FR" && len === "en-GB", `${lfr} / ${len}`);
  ck("aucune date n'est formatée en dur en fr-FR dans les modules vivants",
    !["ho_desktop.js", "ho_shell.js", "ho_reserve.js", "ho_ui.js"].some((f) =>
      fs.readFileSync(path.join(SRC, f), "utf8").includes('"fr-FR"')));
}

console.log("\n— Modules vivants : plus de français hors de t() —");
{
  // index.html ne charge que ho_desktop.js ; le graphe réel s'arrête à ces quatre modules.
  // main.js et ho_onboarding.js ne sont importés par personne et ne sont donc pas en cause.
  const VIVANTS = ["ho_desktop.js", "ho_shell.js", "ho_reserve.js", "ho_ui.js"];
  const ACCENTS = /[éèêëàâçùûôîïœÉÈÀÇ]|’/;
  const MOTS_FR = /\b(le|la|les|un|une|des|du|de|vous|votre|vos|est|sont|pas|dans|avec|pour|sur|que|qui|ce|cette|aucun|plus|et|ou|ne)\b/i;
  const CSS = /px|%|rgba?\(|#[0-9a-fA-F]{3,8}|monospace|sans-serif|inherit|transparent/;
  for (const f of VIVANTS) {
    const trouves = [];
    fs.readFileSync(path.join(SRC, f), "utf8").split("\n").forEach((ln, i) => {
      if (/^\s*(\*|\/\/|\/\*)/.test(ln)) return;            // commentaire : ce n'est pas de l'interface
      const fin = ln.includes("//") ? ln.indexOf("//") : ln.length;
      for (const m of ln.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        if (m.index >= fin) break;
        const s = m[1];
        if (s.length < 3 || CSS.test(s)) continue;
        if (!(ACCENTS.test(s) || (MOTS_FR.test(s) && s.includes(" ")))) continue;
        if (ln.slice(Math.max(0, m.index - 3), m.index).endsWith("t(")) continue;
        trouves.push(`L${i + 1} "${s.slice(0, 40)}"`);
      }
    });
    ck(`${f} : aucun texte français hors de t()`, trouves.length === 0, trouves.slice(0, 4).join(" | "));
  }
  ck("index.html ne charge bien que ho_desktop.js",
    (fs.readFileSync(path.join(ici, "../index.html"), "utf8").match(/<script[^>]*src=/g) || []).length === 1);
}

console.log("\n— Bundle construit —");
{
  // Le catalogue peut être complet dans les sources et absent du binaire livré : c'est le
  // bundle qui part dans le DMG. On vérifie donc l'anglais là où il compte vraiment.
  const dist = path.join(ici, "../dist/assets");
  if (!fs.existsSync(dist)) {
    console.log("  — dist absent : lancer `npm run build` pour contrôler le bundle livré");
  } else {
    const js = fs.readdirSync(dist).filter((f) => f.endsWith(".js"))
      .map((f) => fs.readFileSync(path.join(dist, f), "utf8")).join("\n");
    const temoins = ["HumanOrigin is ready", "Create the document here", "unknown error",
                     "Watched folders", "New version ready"];
    const absents = temoins.filter((t) => !js.includes(t));
    ck("le bundle construit embarque bien l'anglais", absents.length === 0, absents.join(" | "));
    const tfr = ["HumanOrigin est prêt", "Créer le document ici", "erreur inconnue"];
    ck("le bundle construit embarque toujours le français",
      tfr.every((t) => js.includes(t)));
  }
}

console.log("\n— Câblage de l'interface —");
{
  const desk = fs.readFileSync(path.join(SRC, "ho_desktop.js"), "utf8");
  ck("le réglage Langue appelle setLangue", /b\.onclick = \(\) => setLangue\(l\)/.test(desk));
  ck("un changement de langue redessine l'écran courant",
    /onLangueChange\(\(\) => \{ appliquerLangueAuDocument\(\); redessiner\(\)/.test(desk));
  ck("redessiner() n'efface pas le message courant", /async function redessiner\(\)/.test(desk)
    && !/function redessiner\(\)[\s\S]{0,400}VUE\.message = ""/.test(desk));
  ck("l'attribut lang du document suit la langue",
    /document\.documentElement\.lang = langue\(\)/.test(desk));
  ck("les rubriques de réglages ont des identifiants stables, non traduits",
    /const RUBRIQUES = \["account", "word", "documents", "language", "about", "diagnostic"\]/.test(desk));
  ck("aucune comparaison de rubrique sur un libellé français",
    !/nom === "(Compte|Documents|Langue|À propos|Microsoft Word)"/.test(desk));
}

console.log(`\n  ${ok} réussis · ${ko} échoués  =>  I18N_LANGUE = ${ko ? "FAIL" : "PASS"}\n`);
process.exit(ko ? 1 : 0);
