let lastTap = 0;
let intervals = [];

const input = document.getElementById('typing-area');
const resultsDiv = document.getElementById('results');
const diagEl = document.getElementById('diagnosis');
const speedEl = document.getElementById('speed');
const varEl = document.getElementById('variance');
const badgeEl = document.getElementById('badge');

input.addEventListener('input', (e) => {
    const now = Date.now();

    // Si c'est la toute première lettre ou après une longue pause (>1s), on reset
    if (lastTap === 0 || (now - lastTap) > 1000) {
        lastTap = now;
        return;
    }

    // Calcul du temps écoulé
    const delta = now - lastTap;
    lastTap = now;

    // On stocke l'intervalle
    intervals.push(delta);

    // ANALYSE EN TEMPS RÉEL (dès qu'on a 5 frappes)
    if (intervals.length > 5) {
        analyze();
    }
});

function analyze() {
    // 1. Calculs
    const count = intervals.length;
    const sum = intervals.reduce((a, b) => a + b, 0);
    const avg = sum / count;
    
    // Variance (Standard Deviation)
    const squareDiffs = intervals.map(val => Math.pow(val - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / count;
    const stdDev = Math.sqrt(avgSquareDiff);

    // 2. Affichage
    resultsDiv.classList.add('active');
    speedEl.innerText = avg.toFixed(0);
    varEl.innerText = stdDev.toFixed(1);

    // 3. Diagnostic
    diagEl.className = ""; // Reset couleur
    if (stdDev < 10) {
        diagEl.innerText = "ROBOT 🤖";
        diagEl.classList.add("robot");
        badgeEl.innerText = "RYTHME SUSPECT";
    } else if (stdDev < 25) {
        diagEl.innerText = "HYBRIDE 🦾";
        diagEl.classList.add("hybrid");
        badgeEl.innerText = "CONCENTRATION MAXIMALE";
    } else {
        diagEl.innerText = "HUMAIN 👤";
        diagEl.classList.add("human");
        badgeEl.innerText = "VARIATION NATURELLE DÉTECTÉE";
    }
}