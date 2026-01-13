use reqwest::Client;
use serde_json::json;

pub struct SupabaseService {
    url: String,
    key: String,
    client: Client,
}

impl SupabaseService {
    pub fn new() -> Self {
        // TES INFOS SONT LÀ 👇
        let url = "https://bhlisgvozsgqxugrfsiu.supabase.co".to_string(); 
        let key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJobGlzZ3ZvenNncXh1Z3Jmc2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNTI5NDEsImV4cCI6MjA4MzcyODk0MX0.L43rUuDFtg-QH7lVCFTFkJzMTjNUX7BWVXqmVMvIwZ0".to_string();

        SupabaseService {
            url,
            key,
            client: Client::new(),
        }
    }

    // Fonction de test (Ping)
    pub async fn test_connexion(&self) -> Result<String, String> {
        // On vérifie juste si le serveur répond (ping basic)
        let endpoint = format!("{}/auth/v1/health", self.url); 

        let response = self.client
            .get(&endpoint)
            .header("apikey", &self.key)
            .send()
            .await
            .map_err(|e| format!("Erreur réseau : {}", e))?;

        if response.status().is_success() {
            Ok("✅ Connexion Supabase RÉUSSIE ! (Serveur actif)".to_string())
        } else {
            Err(format!("❌ Erreur Supabase : Code {}", response.status()))
        }
    }
}