// Point d'entrée exigé par VS Code. Le banc n'active rien de visible : tout le travail se
// fait dans les tests, qui pilotent l'éditeur par son API.
function activate() { return require("./adapter.js"); }
function deactivate() {}
module.exports = { activate, deactivate };
