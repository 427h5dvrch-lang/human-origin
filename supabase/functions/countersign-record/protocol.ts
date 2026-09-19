// HumanOrigin — Record Attestation v1, cœur de protocole.
//
// Module PUR : aucune dépendance Deno, Supabase ou réseau. Utilise uniquement WebCrypto,
// présent dans Deno comme dans Node, ce qui permet de le tester hors du runtime de
// production et évite une dépendance externe pour Ed25519.
//
// Norme : docs/HUMANORIGIN_TRUST_FOUNDATION_V1_SPEC.md.
// Ce profil de canonicalisation N'EST PAS RFC 8785 (JCS) et ne doit pas être nommé ainsi.
//
// Protocole DISTINCT de celui des certificats HO-JSON : format d'attestation différent,
// canonicalisation différente, signature directe sans pré-hachage, aucun identifiant de
// compte distribué. Les deux ne partagent ni clé ni endpoint.

export const DOMAINE = "HumanOrigin.RecordAttestation/v1";
export const VERSION = 1;
export const ALG = "ed25519";
export const HEX64 = /^[0-9a-f]{64}$/;

const MAX_ENTIER = 9007199254740991; // 2^53 − 1

function verifieSubstituts(s: string): void {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xDC00 && d <= 0xDFFF)) throw new Error("demi-substitut isolé refusé");
      i++;
    } else if (c >= 0xDC00 && c <= 0xDFFF) throw new Error("demi-substitut isolé refusé");
  }
}

function echappe(s: string): string {
  verifieSubstituts(s);
  let out = '"';
  for (const c of s) {
    const n = c.codePointAt(0)!;
    if (c === '"') out += '\\"';
    else if (c === "\\") out += "\\\\";
    else if (n === 8) out += "\\b";
    else if (n === 9) out += "\\t";
    else if (n === 10) out += "\\n";
    else if (n === 12) out += "\\f";
    else if (n === 13) out += "\\r";
    else if (n < 0x20) out += "\\u" + n.toString(16).padStart(4, "0");
    else out += c;
  }
  return out + '"';
}

// Tri par POINT DE CODE. Le .sort() natif trie en unités UTF-16 et diverge du producteur
// Rust hors du plan multilingue de base : un comparateur explicite est obligatoire.
function parPointDeCode(a: string, b: string): number {
  const A = [...a], B = [...b];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] === undefined ? -1 : A[i].codePointAt(0)!;
    const y = B[i] === undefined ? -1 : B[i].codePointAt(0)!;
    if (x !== y) return x - y;
  }
  return 0;
}

/** HumanOrigin Record Canonicalization v1. */
export function canonicalize(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    // Règle portée par la VALEUR, jamais par le jeton.
    if (!Number.isFinite(v) || !Number.isInteger(v)) throw new Error("nombre non entier refusé");
    if (v > MAX_ENTIER || v < -MAX_ENTIER) throw new Error("entier hors plage");
    if (Object.is(v, -0)) return "0";
    return String(v);
  }
  if (typeof v === "string") return echappe(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const cles = Object.keys(o).sort(parPointDeCode);
    return "{" + cles.map((k) => echappe(k) + ":" + canonicalize(o[k])).join(",") + "}";
  }
  throw new Error("type non sérialisable");
}

export interface ChampsEnonce {
  key_id: string;
  record_digest: string;
  server_signed_at: string;
  version?: number;
}

/**
 * Énoncé signé, versionné et séparé par domaine. Toutes les valeurs de confiance
 * — domaine, version, key_id, horodatage — sont produites par le serveur.
 */
export function enonce(c: ChampsEnonce): string {
  return canonicalize({
    domain: DOMAINE,
    key_id: c.key_id,
    record_digest: c.record_digest,
    server_signed_at: c.server_signed_at,
    version: c.version ?? VERSION,
  });
}

/**
 * Signature Ed25519 des octets UTF-8 de l'énoncé canonique, DIRECTEMENT.
 * Aucun SHA-256 intermédiaire : Ed25519 hache déjà en interne, et un pré-hachage
 * ajouterait une liaison plus faible.
 */
export async function signerEnonce(privee: CryptoKey, texte: string): Promise<string> {
  const sig = await crypto.subtle.sign("Ed25519", privee, new TextEncoder().encode(texte));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Importe une clé privée Ed25519 depuis sa forme PKCS#8 en base64. */
export async function importerClePrivee(pkcs8B64: string): Promise<CryptoKey> {
  const bin = atob(pkcs8B64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey("pkcs8", u, { name: "Ed25519" }, false, ["sign"]);
}

/** Horodatage serveur, RFC 3339 UTC à la milliseconde, suffixe Z. */
export function horodatage(d: Date = new Date()): string {
  return d.toISOString().replace(/\.(\d{3})\d*Z$/, ".$1Z");
}
