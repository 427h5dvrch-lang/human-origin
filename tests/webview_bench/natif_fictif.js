// Natif FICTIF, même monde que tests/parcours_client.mjs. Scénario choisi par l'URL :
//   ?scenario=continuer   un document prouvé → « Continuer ce document ? »
//   ?scenario=accueil     dernier dépôt réel → carte « Preuve créée »
//   &copie=echec          la copie native échoue
// Le lien n'existe jamais ici : comme le vrai natif, la copie ne rend rien à l'interface.
(function () {
  const q = new URLSearchParams(location.search);
  const scenario = q.get("scenario") || "continuer";
  const doc = { name: "Nouveau document HumanOrigin 38.docx", record_id: "HO-FICTIF0001", open_in_word: false };
  const monde = {
    documents: scenario === "continuer" ? [doc] : [],
    dernierDepot: scenario === "accueil" ? { record_id: doc.record_id, document: doc.name, at: new Date().toISOString() } : null,
    copieMarche: q.get("copie") !== "echec",
  };
  window.__HO_JOURNAL = [];
  window.__HO = {
    async invoke(cmd, args) {
      window.__HO_JOURNAL.push(cmd);
      switch (cmd) {
        case "take_pending_deep_link": return null;
        case "ho_word_setup_status": return { state: "installed" };
        case "ho_word_setup_autoupgrade": return { state: "installed", upgraded: false, deferred_word_open: false };
        case "ho_finalizer_get_folders": return ["/fictif/HumanOrigin"];
        case "ho_finalizer_status": return { folders: 1, active: true, incident: null, last_deposit: monde.dernierDepot, last_proof_at: null };
        case "ho_versionable_documents": return monde.documents;
        case "ho_recent_documents": return monde.documents.map((d) => ({ record_id: d.record_id, name: d.name, open_in_word: false }));
        case "ho_copy_verification_link":
          if (!monde.copieMarche) throw "Le lien n'a pas pu être copié.";
          return null;
        case "ho_open_document_by_record": case "ho_open_folder_by_record": return null;
        case "ho_version_source_state": return { source_matches_predecessor_final_state: true };
        case "ho_default_work_folder": return "/fictif/HumanOrigin";
        case "ho_check_work_folder": return { ok: true };
        default: throw "commande " + cmd + " non simulée";
      }
    },
  };
})();
