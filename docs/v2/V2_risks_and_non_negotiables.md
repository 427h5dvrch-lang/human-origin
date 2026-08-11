# HumanOrigin V2 — Risques & non-négociables

> Blueprint. Registre froid des risques majeurs et des invariants produit. Sert de garde-fou
> à toute décision V2. Aucune implémentation engagée.

## 1. Risques majeurs

### R1 — Fausses promesses / surclaim
Le risque le plus destructeur. Dès que le langage dépasse la preuve (« garanti humain »), la confiance devient non réversible et le produit se disqualifie juridiquement et réputationnellement.
- *Mitigation* : lexique verrouillé, tests automatiques anti-claims, revue de tout texte public.

### R2 — Confusion « anti-IA » / détecteur d'IA
Le marché voudra lire HumanOrigin comme un détecteur d'IA. C'est faux et dangereux (les détecteurs d'IA sont faillibles ; s'y assimiler importe leur discrédit).
- *Mitigation* : dire explicitement « ne détecte pas l'IA » ; cadrer « preuve de processus », pas « analyse de contenu ».

### R3 — Vie privée
L'observation d'activité peut devenir intrusive (contenu des frappes, apps, écran). Un dérapage privacy tue l'adoption et expose légalement (RGPD & équivalents).
- *Mitigation* : n'observer que ce qui est nécessaire ; jamais de contenu d'écran ; tout local par défaut ; transparence sur ce qui est capté.

### R4 — Adoption / valeur perçue
Une preuve de processus peut sembler abstraite hors contextes à enjeux. Risque de « solution en quête de problème ».
- *Mitigation* : cibler d'abord des contextes où le processus **a** une valeur (école, presse, contrats, création pro).

### R5 — Falsification
Un acteur peut simuler de l'activité ou rejouer une observation. La preuve augmente le coût de la fraude, ne l'annule pas.
- *Mitigation* : l'énoncer publiquement ; renforcer par densité/continuité d'observation ; ne jamais prétendre l'infalsifiabilité.

### R6 — Surclaim juridique
Présenter la preuve comme une attestation légale d'auteur/originalité créerait une responsabilité et des litiges.
- *Mitigation* : disclaimers ; positionnement « trace technique », pas « acte juridique » ; revue juridique avant tout langage « certifié/officiel ».

### R7 — Friction permissions
Les autorisations OS (accessibilité, entrée) freinent l'onboarding ; sur mobile/navigateur c'est pire.
- *Mitigation* : guidage clair ; dégradation gracieuse ; expliquer *pourquoi* chaque permission.

### R8 — Dépendance plateformes
Les intégrations (Office, iOS, navigateurs, DAW) créent des dépendances de distribution et de politique (stores) hors de notre contrôle.
- *Mitigation* : noyau autonome ; adaptateurs isolés remplaçables ; ne jamais mettre le cœur cryptographique dans une dépendance tierce.

### R9 — Preuves partielles
Observations fragmentées/interrompues → preuves faibles mal comprises.
- *Mitigation* : statut honnête (« partiel ») ; consolidation robuste des périodes ; UX qui guide vers une observation continue.

## 2. Non-négociables produit (invariants)

1. **Privacy locale par défaut.** Rien ne quitte la machine sans action explicite. Jamais de contenu utilisateur en cloud par défaut.
2. **Preuve positive.** On atteste d'un processus observé, jamais d'une absence (« pas d'IA »).
3. **Claims sobres et verrouillés.** Lexique autorisé/interdit appliqué partout (UI, cartouche, Record, docs), avec tests automatiques.
4. **Auditabilité.** Preuve re-vérifiable hors ligne via `.ho.json` + clé publique ; l'autorité est cryptographique, pas un serveur.
5. **Expérience simple.** Un seul parcours clair par défaut ; pas de jargon exposé (Work, hash, gate, Ed25519).
6. **Compatibilité export portable.** HO-JSON reste rétro-compatible ; aucun QR/preuve passé n'est jamais invalidé.
7. **Noyau intouchable sans rituel.** La cryptographie (canonicalisation, signature, certificat) ne se modifie que par ticket explicite + tests + revue ; les adaptateurs média ne touchent jamais le cœur.
8. **Local d'abord, cloud en supplément.** Un futur registre officiel **ajoute** une garantie ; il ne remplace ni ne déprécie la preuve locale.

## 3. Règle de tranchage

En cas de conflit entre **ambition** et **prouvabilité**, la prouvabilité gagne. En cas de conflit entre **adoption** et **vie privée / sobriété des claims**, la vie privée et la sobriété gagnent. Ces priorités ne sont pas négociables : ce sont elles qui rendent la preuve crédible.
