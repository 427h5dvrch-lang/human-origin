# HO-JSON V2 — Spécification de compatibilité (mini-spec)

> Statut : **DRAFT figé — V2-M2**. Aucun changement runtime. Aucune structure signée modifiée.
> Ce document fige le vocabulaire et la **règle de compatibilité** avant tout futur champ média.

---

## 1. Objectif

HO-JSON V2 est un **superset non-rupture** de HO-JSON V1.

- Un `.ho.json` V1 existant reste **valide et vérifiable byte-pour-byte** après l'arrivée de V2.
- V2 ajoute la capacité de décrire d'autres médias que le PDF (image, vidéo, audio, code) **sans réécrire la cryptographie**.
- Le PDF actuel devient simplement le cas `media_type = "pdf"`.
- Canonicalisation **identique** (HO-CANON-V1 : tri récursif des clés, sérialisation compacte).
- Signature **identique** (Ed25519 sur le digest SHA256 du payload canonique).

**En V2-M2, rien de tout cela n'est appliqué au runtime.** On fige uniquement la règle et le vocabulaire.

---

## 2. Distinction de nommage — NE PAS CONFONDRE

Deux notions de « V2 » coexistent et n'ont **aucun rapport** :

| Terme | Signification | Où |
|---|---|---|
| **`CertificateVersion::V2`** | Marqueur de **chaînage** d'un certificat (V1 = premier certificat sans précédent ; V2 = certificat avec `previous_*`). **Existe déjà en V1.** | `work_certificate.rs:47-52` |
| **`schema_version = 2`** | Futur **numéro de schéma HO-JSON V2**. Vaut `1` aujourd'hui partout (`CERTIFICATE_SCHEMA_VERSION`, `CORE_EVIDENCE_SCHEMA_VERSION`, `PACKAGE_MANIFEST_SCHEMA_VERSION`). | constantes moteur |

> ⚠️ « HO-JSON V2 » = `schema_version` incrémenté à `2`. Cela n'a **rien** à voir avec l'enum `CertificateVersion::V2` déjà utilisé pour le chaînage.

---

## 3. Règle dure de compatibilité

> **Aucun champ ne peut être ajouté à une structure signée V1 sans l'attribut :**
> ```rust
> #[serde(default, skip_serializing_if = "Option::is_none")]
> ```

### Pourquoi (le mécanisme exact)

La signature couvre `canonical_bytes_excluding(value, &["signature"])` : **tous les champs sérialisés** entrent dans les octets signés. Or aujourd'hui **aucune** struct du moteur n'utilise `skip_serializing_if` ni `default`. Conséquence :

- Un champ `Option<T>` valant `None` est sérialisé en **`null`** (présent dans les octets canoniques).
- Ajouter ce champ à une struct signée **change les octets** d'un certificat V1 relu → **signature invalidée**.

Avec `#[serde(default, skip_serializing_if = "Option::is_none")]` :

- Le champ à `None` est **absent** de la sérialisation → un certificat V1 (qui ne le porte pas) produit **exactement les mêmes octets** qu'avant → signature préservée.
- Le champ n'apparaît que lorsqu'il est réellement rempli (nouveaux certificats V2).
- `default` garantit la **désérialisation** d'un ancien JSON qui ne contient pas le champ.

C'est **la seule voie non-rupture**. Tout ajout naïf (sans ces attributs) casse V1.

### Interdits absolus sur les structs signées V1
- ❌ Renommer un champ.
- ❌ Changer un type (ex. `u32` → `u64`).
- ❌ Changer le casing d'un enum sérialisé.
- ❌ Réordonner un `Vec` (les tableaux sont préservés en ordre par HO-CANON-V1).
- ❌ Retirer un champ.
- ❌ Ajouter un champ **sans** `skip_serializing_if`.

---

## 4. Champs futurs possibles (V2, non implémentés ici)

Portés comme `Option` skip-if-none sur les structures **publiques** appropriées, lors d'un ticket ultérieur (V2-M4) avec test de régression signature V1 :

| Champ | Rôle | Emplacement candidat |
|---|---|---|
| `media_type` | Type de média (`"pdf"`, `"image"`, …). PDF = valeur par défaut du cas actuel. | `PublicCoreEvidence` / `PublicDocumentRef` |
| `observed_object` | Référence stable de l'objet observé (id, media_type). | `PublicCoreEvidence` |
| `final_version` | État validé de l'objet (fingerprint, taille). Une nouvelle version = une nouvelle preuve. | `PublicCoreEvidence` |
| `media_specific` | Namespace de métadonnées propres au média (empreinte perceptuelle image/audio, etc.). | Sous-objet optionnel dédié |

---

## 5. Non-négociables de confidentialité et de claims (rappel)

Repris de `V2_risks_and_non_negotiables.md` — s'appliquent à tout champ V2 :

- **Contenu jamais embarqué.** Seules des empreintes/hashes sortent. Les octets du média ne sont jamais dans le `.ho.json`.
- **Chemins locaux jamais publics.** `document_path` reste dans la partie privée (`DocumentRef`), jamais dans `PublicDocumentRef`. Aucun champ V2 ne doit exposer de chemin local.
- **Identité jamais inférée.** `identity = LOCAL_DEVICE`. Aucun champ V2 ne doit permettre d'inférer une identité civile.
- **Claims multimodaux sobres.** L'empreinte perceptuelle (image/audio) est un **complément d'intégrité**, jamais une preuve « non-IA » ni d'originalité. Claim canonique : « Travail observé — preuve locale signée » / « Observed work — locally signed proof ».

---

## 6. Portée de V2-M2

- **Aucun changement runtime.**
- **Aucune** structure signée modifiée (`WorkCertificate`, `PublicCoreEvidence`, `ObservationPeriod`, `PackageManifest` intacts).
- Seuls livrables : ce document + un module `evidence_kernel.rs` de **types de vocabulaire read-only, non câblés** au runtime.
- Les champs de §4 seront introduits **plus tard** (V2-M4), avec la règle §3 et un test prouvant qu'un certificat V1 existant reste vérifiable byte-pour-byte.
