const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const VAULT_DIR = path.join(__dirname, "vaults");
if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR);

console.log("📂 Stockage des coffres dans :", VAULT_DIR);

app.post("/vault/:alias", (req, res) => {
  const alias = req.params.alias;
  const safeAlias = alias.replace(/[^a-z0-9-_]/gi, '_');
  const filePath = path.join(VAULT_DIR, `${safeAlias}.hoid`);
  console.log(`📥 Réception du coffre pour : ${safeAlias}`);
  fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2));
  res.json({ status: "success", message: "Coffre sécurisé." });
});

app.get("/vault/:alias", (req, res) => {
  const alias = req.params.alias;
  const safeAlias = alias.replace(/[^a-z0-9-_]/gi, '_');
  const filePath = path.join(VAULT_DIR, `${safeAlias}.hoid`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Introuvable" });
  }
  console.log(`📤 Envoi du coffre pour : ${safeAlias}`);
  const content = fs.readFileSync(filePath, "utf-8");
  res.json(JSON.parse(content));
});

app.listen(3000, () => {
  console.log("🚀 HumanOrigin Cloud running on http://localhost:3000");
});