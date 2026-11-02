// Mesure partagée par tous les hôtes du banc (WebView2, Edge headless, WKWebView) : une seule
// définition de ce qui est contrôlé. Évaluée dans la page sous la forme `(<ce fichier>)("fr")`.
// Elle ne lit que le DOM et `window.__HO_JOURNAL` (doublure native) ; elle n'écrit rien.
(function (l) {
  const LIB = {
    fr: { copie: "Copier le lien de vérification", version: "Créer une nouvelle version" },
    en: { copie: "Copy the verification link", version: "Create a new version" },
  }[l];
  const H = document.documentElement.clientHeight;
  const vis = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { haut: Math.round(r.top), bas: Math.round(r.bottom), marge: Math.round(H - r.bottom), hauteur: Math.round(r.height) };
  };
  const btns = [...document.querySelectorAll("button")];
  const parTexte = (t) => btns.find((b) => b.innerText.trim() === t);
  const copie = parTexte(LIB.copie), version = parTexte(LIB.version);
  const zone = copie && copie.nextElementSibling;
  const nouveau = btns.find((b) => /^(Nouveau document|New document)$/.test(b.innerText.trim()));
  const fond = (b) => (b ? getComputedStyle(b).backgroundColor : null);
  const origine = location.origin;
  return {
    innerWidth, innerHeight, dpr: window.devicePixelRatio, H, scrollY,
    hauteurPage: document.documentElement.scrollHeight,
    copie: vis(copie), zone: vis(zone), zoneTexte: zone ? zone.innerText.trim() : null,
    role: zone && zone.getAttribute("role"), live: zone && zone.getAttribute("aria-live"),
    fondCopie: fond(copie), fondVersion: fond(version), fondNouveau: fond(nouveau),
    ordre: btns.map((b) => b.innerText.trim()).filter(Boolean),
    focus: document.activeElement && document.activeElement.innerText ? document.activeElement.innerText.trim() : null,
    cleOuLien: /verify\.humanorigin\.io|#k=|ho1\./.test(document.documentElement.outerHTML),
    ressourcesHorsOrigine: performance.getEntriesByType("resource").map((e) => e.name).filter((n) => !n.startsWith(origine)),
    erreurs: window.__erreurs || [],
    copiesDemandees: (window.__HO_JOURNAL || []).filter((c) => c === "ho_copy_verification_link").length,
  };
})
