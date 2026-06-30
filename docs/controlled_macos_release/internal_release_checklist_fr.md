# Checklist interne — Avant envoi à un testeur macOS

À compléter avant chaque envoi du kit beta à un testeur externe.

---

## DMG et version

- [ ] Le DMG est bien la dernière version buildée (`v0.1.XX`).
- [ ] Le DMG est notarisé et staplé par Apple (vérifiable via `xcrun stapler validate`).
- [ ] Le nom du fichier DMG inclut le numéro de version (`HumanOrigin_X.X.X.dmg`).
- [ ] Le lien de téléchargement pointe vers cette version, et uniquement celle-là.
- [ ] Le lien de téléchargement fonctionne depuis un navigateur sans compte GitHub ou Supabase.

---

## Compatibilité

- [ ] Le testeur est sur macOS 12 (Monterey) ou version ultérieure.
- [ ] Le testeur est sur Mac Intel ou Apple Silicon (l'un et l'autre sont supportés si le build est universel).
- [ ] L'architecture du build correspond à la machine du testeur si le build n'est pas universel.

---

## Message d'invitation

- [ ] Le message ne promet pas "absence d'IA" ou "détection d'IA".
- [ ] Le message ne promet pas "authenticité du contenu".
- [ ] Le message décrit clairement : preuve de processus humain, lié à un document.
- [ ] Le message précise que les retours honnêtes sont attendus, pas les retours positifs.
- [ ] Le message ne mentionne pas Windows comme disponible.

---

## Kit testeur

- [ ] Le guide d'installation est joint ou lié.
- [ ] Le scénario de test est joint ou lié.
- [ ] Le questionnaire de retour est joint ou lié.
- [ ] Les documents sont lisibles (Markdown ou PDF, pas de format propriétaire requis).

---

## Collecte des retours

- [ ] Un canal est prévu pour recevoir les retours (email, formulaire, appel).
- [ ] Le testeur sait comment te contacter en cas de problème bloquant.
- [ ] Les retours sont collectés avant de diffuser à un testeur suivant.

---

## Ce qui N'est PAS annoncé

- [ ] Windows n'est pas mentionné comme disponible ou imminent.
- [ ] L'App Store n'est pas mentionné.
- [ ] La vérification publique n'est pas présentée comme définitive si le vérificateur est encore en test.
- [ ] Aucun délai ou roadmap n'est communiqué.

---

## Signature finale

Checklist validée par : _______________  
Date : _______________  
Testeur destinataire : _______________  
Version envoyée : _______________
