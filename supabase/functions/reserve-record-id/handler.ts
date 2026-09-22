// HumanOrigin — endpoint reserve-record-id, logique pure.
//
// Dépendances INJECTÉES : le gestionnaire ne connaît ni Deno ni Supabase, ce qui permet
// de le tester intégralement hors du runtime de production.
//
// Deux opérations, et rien d'autre :
//   réserver   le serveur produit l'identifiant, l'inscrit sous le compte, émet la capability
//   ré-émettre une nouvelle capability pour une réservation EXISTANTE du MÊME compte
//
// La connaissance d'un record_id n'est jamais une preuve de propriété : la ré-émission
// exige que la réservation appartienne au compte authentifié.

import { MAX_BYTES, emettre, nouveauRecordId } from "./protocol.ts";

export interface Reservation { record_id: string; account_id: string }

export interface Deps {
  env: (nom: string) => string | undefined;
  /** Identifiant de compte, ou null si le jeton est absent ou invalide. */
  compte: (jeton: string) => Promise<string | null>;
  /** Réservation atomique sous quota. */
  reserver: (accountId: string, recordId: string) => Promise<{ reserved: boolean; reason: string | null }>;
  /** Lecture d'une réservation existante. */
  lire: (recordId: string) => Promise<Reservation | null>;
  /** Trace de ré-émission ; sans effet sur l'autorisation. */
  marquerEmission: (recordId: string) => Promise<void>;
  maintenant: () => Date;
  cle: (pkcs8B64: string) => Promise<CryptoKey>;
}

// CORS. Le frontend est servi par Tauri sous tauri://localhost : pour Supabase c'est une
// origine CROISÉE, donc le moteur émet un préflight OPTIONS avant tout POST portant
// authorization, apikey et content-type. Sans réponse à ce préflight, le POST n'est JAMAIS
// émis, et l'application croit le service injoignable alors qu'il répond parfaitement.
//
// Allowlist stricte : une seule origine, jamais « * ». Une origine inconnue n'obtient aucune
// ouverture, et l'authentification serveur n'est en rien allégée — CORS ne protège que le
// navigateur, il ne remplace aucun contrôle.
const ORIGINE_AUTORISEE = "tauri://localhost";
// Exactement les en-têtes que reserveRecordId pose, et rien de plus.
const ENTETES_AUTORISES = "apikey, authorization, content-type";

/**
 * `Vary: Origin` est posé dans TOUS les cas : la réponse dépend de l'origine, un cache ne doit
 * donc pas servir à l'une ce qu'il a retenu pour l'autre. L'autorisation, elle, n'est ajoutée
 * que pour l'origine reconnue.
 *
 * Pas de `Access-Control-Allow-Credentials` : l'authentification passe par l'en-tête
 * Authorization, pas par un cookie tiers.
 */
const entetesCors = (origine: string | null): Record<string, string> =>
  origine === ORIGINE_AUTORISEE
    ? { "access-control-allow-origin": ORIGINE_AUTORISEE, "vary": "Origin" }
    : { "vary": "Origin" };

const json = (corps: unknown, statut = 200, origine: string | null = null) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "content-type": "application/json", ...entetesCors(origine) },
  });

const RID = /^[A-Za-z0-9_-]{6,64}$/;

export async function traiter(req: Request, d: Deps): Promise<Response> {
  const origine = req.headers.get("origin");

  // Préflight. Aucun effet de bord : rien n'est réservé, rien n'est lu.
  if (req.method === "OPTIONS") {
    if (origine !== ORIGINE_AUTORISEE) {
      return json({ ok: false, error: "method_not_allowed" }, 405, null);
    }
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": ORIGINE_AUTORISEE,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": ENTETES_AUTORISES,
        "access-control-max-age": "86400",
        "vary": "Origin",
      },
    });
  }

  // Toutes les réponses qui suivent portent l'autorisation quand l'origine est reconnue —
  // y compris les erreurs, sans quoi le navigateur masquerait un 401 derrière une panne réseau.
  const j = (corps: unknown, statut = 200) => json(corps, statut, origine);

  if (req.method !== "POST") return j({ ok: false, error: "method_not_allowed" }, 405);

  // Secrets : fail closed. Sans clé, le service ne sert pas.
  const pkcs8 = d.env("HUMANORIGIN_REGISTRY_WRITE_PRIVATE_KEY_B64");
  const keyId = d.env("HUMANORIGIN_REGISTRY_WRITE_KEY_ID");
  if (!pkcs8 || !keyId) return j({ ok: false, error: "registry write key not configured" }, 500);

  const entete = req.headers.get("authorization") ?? "";
  const jeton = entete.replace(/^Bearer\s+/i, "").trim();
  if (!jeton) return j({ ok: false, error: "unauthorized" }, 401);
  const compte = await d.compte(jeton);
  if (!compte) return j({ ok: false, error: "unauthorized" }, 401);

  let corps: unknown = {};
  if (req.headers.get("content-length") !== "0") {
    try { corps = await req.json(); } catch { corps = {}; }
  }
  if (!corps || typeof corps !== "object" || Array.isArray(corps))
    return j({ ok: false, error: "invalid_body" }, 400);
  const champs = Object.keys(corps as Record<string, unknown>);
  if (champs.some((k) => k !== "record_id")) return j({ ok: false, error: "unexpected_fields" }, 400);
  const demande = (corps as Record<string, unknown>).record_id;

  let privee: CryptoKey;
  try { privee = await d.cle(pkcs8); }
  catch { return j({ ok: false, error: "registry write key not usable" }, 500); }

  // --- ré-émission : le client présente une réservation existante
  if (demande !== undefined) {
    if (typeof demande !== "string" || !RID.test(demande))
      return j({ ok: false, error: "invalid_record_id" }, 400);
    const r = await d.lire(demande);
    // Réservation inconnue et réservation d'autrui rendent la MÊME réponse : le service
    // ne dit pas si un identifiant est pris, et par qui.
    if (!r || r.account_id !== compte) return j({ ok: false, error: "not_found" }, 404);
    const { jeton: cap } = await emettre(privee, keyId, demande, d.maintenant());
    await d.marquerEmission(demande);
    return j({ ok: true, record_id: demande, capability: cap, max_bytes: MAX_BYTES, reissued: true });
  }

  // --- réservation neuve : l'identifiant est produit par le SERVEUR
  const recordId = nouveauRecordId();
  const res = await d.reserver(compte, recordId);
  if (!res.reserved) {
    if (res.reason === "quota_exceeded") return j({ ok: false, error: "quota_exceeded" }, 429);
    return j({ ok: false, error: "reservation_failed" }, 503);
  }
  const { jeton: cap } = await emettre(privee, keyId, recordId, d.maintenant());
  return j({ ok: true, record_id: recordId, capability: cap, max_bytes: MAX_BYTES }, 201);
}
