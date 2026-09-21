// Banc PONT PUBLIC — ho_private reste hors des schémas exposés.
//
// Deux natures de contrôle, distinguées sans ambiguïté :
//
//   STATIQUE      lecture de la migration et de index.ts. Ne touche aucune base.
//                 Le contrôle équivalent CÔTÉ BASE est le bloc `do $$` de la migration,
//                 qui fait échouer l'application si un droit résiduel subsiste.
//
//   COMPORTEMENT  le gestionnaire est exercé à travers un pont SIMULÉ qui reproduit la
//                 sémantique SQL : filtre par compte, trace atomique, jamais d'account_id
//                 en sortie. Aucun réseau, aucune base.

import path from "node:path";
import fs from "node:fs";

const ici = path.dirname(new URL(import.meta.url).pathname);
const RACINE = path.join(ici, "../../../..");
const MIG = fs.readFileSync(path.join(RACINE,
  "supabase/migrations/20260921000000_bridge_registry_write_reservation.sql"), "utf8");
const INDEX = fs.readFileSync(path.join(ici, "../index.ts"), "utf8");
const { traiter } = await import(path.join(ici, "../handler.ts"));

let ok = 0, ko = 0;
const ck = (n, c, d = "") => { c ? ok++ : ko++; console.log("  " + (c ? "OK   " : "ECHEC ") + n + (d ? "  -> " + d : "")); };

// Le corps sans commentaires : un contrôle ne doit jamais être satisfait par une ligne de
// commentaire qui mentionne ce qu'on cherche.
const sansCommentaires = (s) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const SQL = sansCommentaires(MIG);
const SIG = "public.ho_registry_write_reservation(text, uuid, text)";

console.log("\n=== STATIQUE : la migration du pont ===");
ck("fonction créée dans public", /create or replace function public\.ho_registry_write_reservation/.test(SQL));
ck("SECURITY DEFINER", /\bsecurity definer\b/.test(SQL));
ck("SET search_path = '' (vide)", /set search_path = ''/.test(SQL));
ck("aucune nouvelle table", !/\bcreate\s+table\b/i.test(SQL));
ck("un seul objet créé", (SQL.match(/^\s*create\s+(or replace\s+)?(function|table|view|index|schema)/gim) || []).length === 1,
   String((SQL.match(/^\s*create\s+(or replace\s+)?(function|table|view|index|schema)/gim) || []).length));

console.log("\n  -- qualification explicite --");
for (const obj of ["ho_private.reserve_record_id", "ho_private.record_write_reservations"])
  ck(`${obj} qualifié par son schéma`, SQL.includes(obj));
ck("now() qualifié en pg_catalog.now()", /pg_catalog\.now\(\)/.test(SQL) && !/[^.]\bnow\(\)/.test(SQL.replace(/pg_catalog\.now\(\)/g, "")));
ck("aucune référence non qualifiée à record_write_reservations",
   !/(^|[^.\w])record_write_reservations/m.test(SQL.replace(/ho_private\.record_write_reservations/g, "")));

console.log("\n  -- droits --");
for (const r of ["public", "anon", "authenticated"])
  ck(`revoke execute ... from ${r}`, new RegExp(`revoke execute on function ${SIG.replace(/[().]/g, "\\$&")} from ${r};`).test(SQL));
ck("grant execute ... to service_role",
   new RegExp(`grant\\s+execute on function ${SIG.replace(/[().]/g, "\\$&")} to service_role;`).test(SQL));
ck("aucun grant vers anon ou authenticated", !/grant[^;]*\bto\b[^;]*\b(anon|authenticated)\b/i.test(SQL));
ck("aucun droit accordé sur la table privée",
   !/grant[^;]*record_write_reservations/i.test(SQL));
ck("garde-fou de droits résiduels dans la migration",
   /has_function_privilege/.test(SQL) && /raise exception/.test(SQL));
ck("garde de collision AVANT la création",
   /pg_catalog\.pg_proc[\s\S]{0,300}?refus de remplacer/.test(SQL)
   && SQL.indexOf("refus de remplacer") < SQL.indexOf("create or replace function public."));
ck("l'appel à la fonction privée passe exactement deux arguments",
   /ho_private\.reserve_record_id\(p_account_id, p_record_id\)/.test(SQL));
ck("aucun quota ni fenêtre redéfinis par le pont",
   !/p_quota|p_window|'24 hours'|\b100\b/.test(SQL));
ck("garde-fou sur l'illisibilité de la table privée",
   /has_table_privilege\(\s*'anon'/.test(SQL) && /has_table_privilege\(\s*'authenticated'/.test(SQL));

console.log("\n  -- surface de sortie --");
ck("la signature ne retourne que outcome et record_id",
   /returns table \(outcome text, record_id text\)/.test(SQL));
ck("account_id n'apparaît jamais en sortie",
   !/(return query select[^;]*account_id|returning[^;]*account_id)/i.test(SQL));
ck("account_id sert de filtre", /where[\s\S]{0,200}t\.account_id\s*=\s*p_account_id/i.test(SQL));
ck("propriété et trace dans la MÊME instruction",
   /update ho_private\.record_write_reservations[\s\S]{0,400}?returning t\.record_id/i.test(SQL));

console.log("\n=== STATIQUE : l'Edge Function ===");
const TS = sansCommentaires(INDEX);
ck("plus aucun .schema(\"ho_private\")", !/schema\(\s*["']ho_private["']\s*\)/.test(TS));
ck("appelle le pont public", /admin\.rpc\(\s*["']ho_registry_write_reservation["']/.test(TS));
ck("un seul point d'accès à la base", (TS.match(/admin\.rpc\(/g) || []).length === 1,
   String((TS.match(/admin\.rpc\(/g) || []).length));
ck("garde d'ordre : pont hors session authentifiée refusé",
   /pont appelé hors session authentifiée/.test(INDEX));
ck("le compte vient de la session, pas du client",
   /admin\.auth\.getUser\(jeton\)/.test(TS) && !/p_account_id:\s*corps/.test(TS));

// ---------------------------------------------------------------- pont simulé
// Reproduit la sémantique SQL, et RIEN de plus : mêmes sorties, mêmes filtres.
function fabriquePont({ quota = 100 } = {}) {
  const lignes = new Map();          // record_id -> { account_id, created_at, last }
  const sorties = [];
  const appel = (mode, accountId, recordId) => {
    let r;
    if (!accountId || !recordId) r = { outcome: "invalid_arguments", record_id: null };
    else if (mode === "reserve") {
      const n = [...lignes.values()].filter((l) => l.account_id === accountId).length;
      if (n >= quota) r = { outcome: "quota_exceeded", record_id: null };
      else if (lignes.has(recordId)) r = { outcome: "record_id_taken", record_id: null };
      else { lignes.set(recordId, { account_id: accountId, created_at: Date.now(), last: Date.now() });
             r = { outcome: "reserved", record_id: recordId }; }
    } else if (mode === "reissue") {
      const l = lignes.get(recordId);
      // Filtre par compte DANS l'instruction : la ligne d'autrui n'est ni lue ni touchée.
      if (l && l.account_id === accountId) { l.last = Date.now(); r = { outcome: "reissued", record_id: recordId }; }
      else r = { outcome: "not_found", record_id: null };
    } else r = { outcome: "invalid_mode", record_id: null };
    sorties.push(r);
    return r;
  };
  return { lignes, sorties, appel };
}

// Mêmes dépendances que index.ts, construites au-dessus du pont simulé.
const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const PKCS8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");

function fabrique(opts = {}) {
  const P = fabriquePont(opts);
  let compteCourant = null;
  const deps = {
    env: (n) => ({ HUMANORIGIN_REGISTRY_WRITE_PRIVATE_KEY_B64: PKCS8,
                   HUMANORIGIN_REGISTRY_WRITE_KEY_ID: "TEST-ONLY-ho-registry-write" })[n],
    compte: async (j) => { compteCourant = j === "jeton-a" ? "compte-A" : j === "jeton-b" ? "compte-B" : null; return compteCourant; },
    reserver: async (acc, rid) => {
      const l = P.appel("reserve", acc, rid);
      return l.outcome === "reserved" ? { reserved: true, reason: null } : { reserved: false, reason: l.outcome };
    },
    lire: async (rid) => {
      if (!compteCourant) throw new Error("pont appelé hors session authentifiée");
      const l = P.appel("reissue", compteCourant, rid);
      if (l.outcome !== "reissued" || !l.record_id) return null;
      return { record_id: l.record_id, account_id: compteCourant };
    },
    marquerEmission: async () => {},
    maintenant: () => new Date("2026-06-01T12:00:00.000Z"),
    cle: (b64) => crypto.subtle.importKey("pkcs8",
      Uint8Array.from(Buffer.from(b64, "base64")), { name: "Ed25519" }, false, ["sign"]),
  };
  return { deps, P };
}
const POST = (corps, jeton) => new Request("https://x/functions/v1/reserve-record-id", {
  method: "POST", headers: jeton ? { authorization: "Bearer " + jeton, "content-type": "application/json" }
                                 : { "content-type": "application/json" },
  body: JSON.stringify(corps),
});

console.log("\n=== COMPORTEMENT à travers le pont ===");
{
  const { deps, P } = fabrique();
  const a = await (await traiter(POST({}, "jeton-a"), deps)).json();
  ck("réservation initiale acceptée", a.ok === true && typeof a.record_id === "string");
  ck("une seule ligne en base", P.lignes.size === 1, String(P.lignes.size));

  const avant = P.lignes.get(a.record_id).last;
  const r = await traiter(POST({ record_id: a.record_id }, "jeton-a"), deps);
  const rb = await r.json();
  ck("ré-émission par le propriétaire acceptée", r.status === 200 && rb.reissued === true, String(r.status));
  ck("même record_id renvoyé", rb.record_id === a.record_id);
  ck("AUCUN second identifiant créé", P.lignes.size === 1, String(P.lignes.size));
  ck("la trace de ré-émission a été posée", P.lignes.get(a.record_id).last >= avant);

  const avantB = P.lignes.get(a.record_id).last;
  const autre = await traiter(POST({ record_id: a.record_id }, "jeton-b"), deps);
  const corpsAutre = await autre.json();
  ck("compte différent refusé", autre.status === 404, String(autre.status));
  ck("la ligne d'autrui n'est PAS touchée", P.lignes.get(a.record_id).last === avantB);

  const inconnu = await traiter(POST({ record_id: "HO-INEXISTANT1" }, "jeton-b"), deps);
  ck("inconnu et propriété d'autrui : réponse IDENTIQUE, aucun oracle",
     autre.status === inconnu.status
     && JSON.stringify(corpsAutre) === JSON.stringify(await inconnu.json()),
     `${autre.status} vs ${inconnu.status}`);

  ck("aucune sortie du pont ne porte account_id",
     P.sorties.every((s) => Object.keys(s).sort().join(",") === "outcome,record_id"));
  ck("aucun account_id ni email dans les réponses HTTP",
     !/account_id|user_id|e-?mail/i.test(JSON.stringify([a, rb, corpsAutre])));
}
{
  const { deps, P } = fabrique({ quota: 2 });
  await traiter(POST({}, "jeton-a"), deps);
  await traiter(POST({}, "jeton-a"), deps);
  const trop = await traiter(POST({}, "jeton-a"), deps);
  ck("quota atomique conservé : 3e réservation -> 429", trop.status === 429, String(trop.status));
  ck("aucune ligne au-delà du quota", P.lignes.size === 2, String(P.lignes.size));
  const autreCompte = await traiter(POST({}, "jeton-b"), deps);
  ck("le quota est par compte", autreCompte.status === 201, String(autreCompte.status));
}
{
  // Le garde d'ordre doit être bruyant : le pont ne s'appelle pas sans session.
  const { deps } = fabrique();
  let leve = false;
  try { await deps.lire("HO-QUELCONQUE"); } catch (e) { leve = /hors session authentifiée/.test(e.message); }
  ck("le pont refuse d'être appelé hors session authentifiée", leve);
}

console.log("\n  " + ok + " reussis - " + ko + " echoues  =>  PONT = " + (ko ? "FAIL" : "PASS"));
process.exit(ko ? 1 : 0);
