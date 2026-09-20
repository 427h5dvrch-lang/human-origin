// HumanOrigin — endpoint countersign-record, logique pure.
//
// Dépendances INJECTÉES : le gestionnaire ne connaît ni Deno ni Supabase, ce qui permet
// de le tester intégralement hors du runtime de production.
//
// Ce service ne reçoit JAMAIS le Record en clair. Son entrée utile tient en un condensé.
// Il n'atteste que ceci : « le service HumanOrigin a contre-signé cet engagement de
// Record. » Il ne prouve ni le client employé, ni la réalité d'une observation, ni un
// auteur humain, ni l'absence d'intelligence artificielle.

import { ALG, HEX64, VERSION, enonce, signerEnonce, horodatage } from "./protocol.ts";

export interface LigneAttestation {
  record_digest: string;
  account_id: string;
  key_id: string;
  version: number;
  server_signed_at: string;
  signature: string;
}

export interface Deps {
  /** Secrets du service. Absents → le service refuse de servir. */
  env: (nom: string) => string | undefined;
  /** Rend l'identifiant de compte, ou null si le jeton est absent ou invalide. */
  compte: (jeton: string) => Promise<string | null>;
  /** Lecture anti-rejeu. */
  lire: (digest: string) => Promise<LigneAttestation | null>;
  /** Écriture. Rend { conflit: true } si le digest existe déjà (contrainte d'unicité). */
  ecrire: (ligne: LigneAttestation) => Promise<{ conflit: boolean }>;
  /** Horodatage serveur. */
  maintenant: () => string;
  /** Clé privée de signature, importée depuis le secret. */
  cle: (pkcs8B64: string) => Promise<CryptoKey>;
}

const json = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "content-type": "application/json" },
  });

/** Réponse de conflit : générique, sans horodatage, sans compte, sans attestation. */
const conflit = () => json({ ok: false, error: "conflict" }, 409);

const attestationDe = (l: LigneAttestation) => ({
  version: l.version,
  alg: ALG,
  key_id: l.key_id,
  record_digest: l.record_digest,
  server_signed_at: horodatage(new Date(l.server_signed_at)),
  signature: l.signature,
});

export async function traiter(req: Request, d: Deps): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // --- Secrets : fail closed. Le service ne démarre pas sans sa clé.
  const pkcs8 = d.env("HUMANORIGIN_RECORD_SIGNING_PRIVATE_KEY_B64");
  const keyId = d.env("HUMANORIGIN_RECORD_KEY_ID");
  if (!pkcs8 || !keyId) return json({ ok: false, error: "record signing key not configured" }, 500);

  // --- Authentification : session existante, rien de nouveau côté utilisateur.
  const entete = req.headers.get("authorization") ?? "";
  const jeton = entete.replace(/^Bearer\s+/i, "").trim();
  if (!jeton) return json({ ok: false, error: "unauthorized" }, 401);
  const compte = await d.compte(jeton);
  if (!compte) return json({ ok: false, error: "unauthorized" }, 401);

  // --- Entrée : un condensé, et rien d'autre.
  let corps: unknown;
  try { corps = await req.json(); } catch { return json({ ok: false, error: "invalid_body" }, 400); }
  if (!corps || typeof corps !== "object" || Array.isArray(corps))
    return json({ ok: false, error: "invalid_body" }, 400);
  const champs = Object.keys(corps as Record<string, unknown>);
  const inattendus = champs.filter((k) => k !== "record_digest");
  if (inattendus.length) return json({ ok: false, error: "unexpected_fields" }, 400);
  const digest = (corps as Record<string, unknown>).record_digest;
  if (typeof digest !== "string" || !HEX64.test(digest))
    return json({ ok: false, error: "invalid_record_digest" }, 400);

  // --- Anti-rejeu, décision figée : une seule attestation par digest.
  //     Même compte  → l'attestation existante, à l'identique. Aucun nouvel événement
  //                    de signature, même horodatage, même signature, même key_id.
  //     Autre compte → 409 générique, sans rien révéler du propriétaire du digest.
  const deja = await d.lire(digest);
  if (deja) {
    if (deja.account_id !== compte) return conflit();
    return json({ ok: true, server_attestation: attestationDe(deja), idempotent: true });
  }

  // --- Valeurs de confiance : produites par le serveur, jamais choisies par le client.
  const signedAt = d.maintenant();
  const ligne: LigneAttestation = {
    record_digest: digest, account_id: compte, key_id: keyId,
    version: VERSION, server_signed_at: signedAt, signature: "",
  };
  let privee: CryptoKey;
  try { privee = await d.cle(pkcs8); }
  catch { return json({ ok: false, error: "record signing key not usable" }, 500); }
  ligne.signature = await signerEnonce(privee,
    enonce({ key_id: keyId, record_digest: digest, server_signed_at: signedAt, version: VERSION }));

  const res = await d.ecrire(ligne);
  if (res.conflit) {
    // Course : un autre appel a écrit le même digest entre la lecture et l'écriture.
    // On relit pour rester idempotent, sans jamais produire une seconde attestation.
    const relu = await d.lire(digest);
    if (!relu) return json({ ok: false, error: "storage_error" }, 500);
    if (relu.account_id !== compte) return conflit();
    return json({ ok: true, server_attestation: attestationDe(relu), idempotent: true });
  }

  return json({ ok: true, server_attestation: attestationDe(ligne) }, 201);
}
