// HumanOrigin — Registry Write Capability v1, cœur de protocole.
//
// Module PUR : aucune dépendance Deno, Supabase ou réseau. WebCrypto seulement, ce qui
// permet de le tester hors du runtime de production.
//
// Clé DÉDIÉE ho-registry-write-v1, strictement distincte de ho-record-server-v1 :
// protocoles séparés, rotation indépendante, rayon d'explosion borné.
//
// Ce que la capability atteste : un compte authentifié a réservé cet identifiant.
// Ce qu'elle n'atteste PAS : le logiciel employé, la réalité d'un processus observé,
// un auteur humain, l'absence d'intelligence artificielle.

export const DOMAINE = "HumanOrigin.RegistryWrite/v1";
export const PURPOSE = "registry.write.v1";
export const ALG = "ed25519";
export const VERSION = 1;
export const MAX_BYTES = 262144;
export const DUREE_JOURS = 90;

const MAX_ENTIER = 9007199254740991;

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
function parPointDeCode(a: string, b: string): number {
  const A = [...a], B = [...b];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] === undefined ? -1 : A[i].codePointAt(0)!;
    const y = B[i] === undefined ? -1 : B[i].codePointAt(0)!;
    if (x !== y) return x - y;
  }
  return 0;
}
export function canonicalize(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v) || !Number.isInteger(v)) throw new Error("nombre non entier refusé");
    if (v > MAX_ENTIER || v < -MAX_ENTIER) throw new Error("entier hors plage");
    if (Object.is(v, -0)) return "0";
    return String(v);
  }
  if (typeof v === "string") return echappe(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort(parPointDeCode)
      .map((k) => echappe(k) + ":" + canonicalize(o[k])).join(",") + "}";
  }
  throw new Error("type non sérialisable");
}

export interface Claims {
  version: number; alg: string; key_id: string; purpose: string;
  record_id: string; issued_at: string; expires_at: string; max_bytes: number;
}

/** Énoncé signé. Aucune donnée utilisateur, par construction. */
export function enonce(c: Claims): string {
  return canonicalize({
    domain: DOMAINE,
    expires_at: c.expires_at,
    issued_at: c.issued_at,
    key_id: c.key_id,
    max_bytes: c.max_bytes,
    purpose: PURPOSE,
    record_id: c.record_id,
    version: c.version,
  });
}

const b64u = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Identifiant produit par le SERVEUR, jamais par le client. 9 octets CSPRNG = 72 bits. */
export function nouveauRecordId(): string {
  const o = new Uint8Array(9);
  crypto.getRandomValues(o);
  return "HO-" + b64u(o);
}

export function horodatage(d: Date = new Date()): string {
  return d.toISOString().replace(/\.(\d{3})\d*Z$/, ".$1Z");
}

export async function importerClePrivee(pkcs8B64: string): Promise<CryptoKey> {
  const bin = atob(pkcs8B64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey("pkcs8", u, { name: "Ed25519" }, false, ["sign"]);
}

/**
 * Émet une capability. Signature DIRECTE sur les octets UTF-8 de l'énoncé, sans
 * pré-hachage. Le transport est compact et en base64url : aucun JSON brut en en-tête.
 */
export async function emettre(
  privee: CryptoKey, keyId: string, recordId: string, maintenant: Date,
): Promise<{ jeton: string; claims: Claims & { signature: string } }> {
  const expire = new Date(maintenant.getTime() + DUREE_JOURS * 86400000);
  const c: Claims = {
    version: VERSION, alg: ALG, key_id: keyId, purpose: PURPOSE,
    record_id: recordId,
    issued_at: horodatage(maintenant),
    expires_at: horodatage(expire),
    max_bytes: MAX_BYTES,
  };
  const sig = await crypto.subtle.sign("Ed25519", privee, new TextEncoder().encode(enonce(c)));
  const claims = { ...c, signature: b64u(new Uint8Array(sig)) };
  return { jeton: b64u(new TextEncoder().encode(JSON.stringify(claims))), claims };
}
