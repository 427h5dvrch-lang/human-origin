# Premier testeur macOS — Pack d'envoi HumanOrigin

**Document interne**  
À utiliser pour 1 à 3 testeurs maximum.  
Ne pas diffuser publiquement.  
Windows non annoncé.

---

## Avant d'envoyer

- [ ] Le fichier DMG exact est identifié et son numéro de version est noté.
- [ ] Le lien de téléchargement a été testé depuis un navigateur sans compte GitHub ou Supabase.
- [ ] Le testeur est bien sur macOS 12 (Monterey) ou version ultérieure.
- [ ] Le testeur est prévenu que le test dure entre 15 et 20 minutes.
- [ ] Le testeur est prévenu que HumanOrigin n'est pas un détecteur d'IA.
- [ ] Le testeur est prévenu que l'activité clavier et souris est enregistrée localement pendant le test, uniquement sur sa machine.
- [ ] Le formulaire de retour est prêt et accessible.

---

## Message à envoyer — version email

> Bonjour [PRÉNOM],
>
> Je teste une première version macOS d'un outil que je développe, HumanOrigin, et j'aimerais avoir ton retour direct.
>
> En résumé : l'application observe localement une session de travail sur ton ordinateur — frappes clavier et souris — et produit une preuve vérifiable de signaux de travail humain observés pendant cette session, liée à un document. Ce n'est pas un détecteur d'IA. L'outil ne sait pas si tu as utilisé de l'IA, et n'essaie pas de le déterminer.
>
> Pour le test :
>
> 1. Télécharger l'application : [LIEN_DMG]
> 2. Suivre le guide d'installation (5 min) : [LIEN_GUIDE_INSTALLATION]
> 3. Faire le scénario de test (10–15 min) : [LIEN_SCÉNARIO_TEST]
> 4. Remplir le formulaire de retour (5 min) : [LIEN_FORMULAIRE_RETOUR]
>
> Durée totale estimée : 15 à 20 minutes.
>
> Le but est de voir si l'installation est claire, si le document labellisé produit est compréhensible, si le QR de vérification a du sens, et si l'outil inspire confiance ou non. Les retours honnêtes — y compris ce qui ne fonctionne pas ou semble peu crédible — me sont bien plus utiles que les compliments.
>
> Merci si tu peux y passer un moment.
>
> Philippe

---

## Message à envoyer — version courte (SMS / WhatsApp)

> Salut [PRÉNOM], je teste une première version Mac d'un outil que je développe. Ça prend 15–20 min. L'app observe une session de travail localement et produit une preuve vérifiable — ce n'est pas un détecteur d'IA. Téléchargement : [LIEN_DMG] / Guide : [LIEN_GUIDE_INSTALLATION] / Scénario : [LIEN_SCÉNARIO_TEST] / Formulaire de retour : [LIEN_FORMULAIRE_RETOUR]. Retours honnêtes bienvenus.

---

## Consigne orale — si le testeur demande "ça enregistre quoi ?"

Réponse à donner :

> "L'application enregistre ton activité clavier et souris pendant la session, uniquement en local sur ta machine. Les données de frappe et de souris observées ne sont pas transmises à un serveur. Le but est de prouver qu'un processus de travail humain a eu lieu — pas de surveiller ce que tu fais, et pas de certifier l'absence d'IA. Si ça te met mal à l'aise, tu peux arrêter le test à tout moment."

Points à ne pas omettre :

- Les données de frappe et de souris observées restent locales et ne sont pas transmises à un serveur.
- But : attester un processus humain observable.
- Pas un outil de surveillance.
- Pas une promesse d'absence d'IA.
- Arrêt possible à tout moment sans conséquence.

---

## Consigne orale — si le testeur voit "Preuve limitée"

Réponse à donner :

> "C'est normal pour une session courte. Ce n'est pas forcément un bug — ça signifie simplement que la durée ou les signaux observés étaient insuffisants pour produire une preuve standard. Note juste ce que tu as fait et ce que tu as compris. L'objectif du test est justement de mesurer si cette situation est claire ou confuse pour toi."

---

## Ce qu'on observe chez le testeur

| Moment | Signal à observer | Pourquoi c'est important |
|---|---|---|
| Ouverture du DMG | Hésitation, recherche de la fenêtre, confusion avec l'installation | Indique si le DMG est assez guidé |
| Première alerte macOS | Blocage, abandon, passage en autonomie ou appel | Indique si l'explication Gatekeeper est suffisante |
| Compréhension du concept | Ce que le testeur dit spontanément avant de commencer | Révèle le positionnement réel perçu |
| Choix du document | Type de fichier choisi, hésitation sur la liaison | Indique si le concept de liaison est compris |
| Lancement observation | Doute sur l'état actif, question sur ce qui se passe | Indique si le feedback visuel de l'app est clair |
| Export document HumanOrigin | Durée, blocages, questions sur les étapes | Indique si le flux export est compréhensible |
| Lecture du cartouche | Temps passé, commentaires spontanés, ce qui attire l'œil | Indique si le cartouche inspire confiance et se lit vite |
| Scan QR / verifier | Scan effectué ou non, compréhension de la page | Indique si la vérification publique est accessible |
| Réponse au formulaire | Phrases spontanées, longueur des réponses, ton | Indique les vraies frictions et les attentes |

---

## Ne pas dire

Ces formulations sont à éviter dans toute communication avec le testeur, quelle que soit la tournure.

- ❌ "Ça certifie que c'est 100 % humain."
- ❌ "Ça prouve qu'il n'y a pas d'IA."
- ❌ "C'est infalsifiable."
- ❌ "La version Windows est disponible."
- ❌ "On prépare un lancement public."

---

## Après le test

- [ ] Récupérer les réponses du formulaire.
- [ ] Noter les phrases spontanées dites par le testeur pendant ou après le test.
- [ ] Noter les blocages exacts : où, quand, pourquoi.
- [ ] Noter si la captation clavier/souris a créé une gêne ou une hésitation.
- [ ] Noter si le cartouche du PDF inspire confiance ou génère des questions.
- [ ] Noter si le QR code a été scanné et si la page de vérification a été comprise.
- [ ] Ne pas corriger le produit immédiatement sauf si un bug bloquant est confirmé sur plusieurs testeurs.
