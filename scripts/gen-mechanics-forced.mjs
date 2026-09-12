// Outil de dev PONCTUEL (v2, suite au retour utilisateur : les mecaniques
// ajoutees doivent etre REELLEMENT necessaires a la resolution, jamais
// decoratives) -- utilise tryGenerateForced (ajout temporaire dans
// generator.js, a retirer apres usage) qui force TOUTES les mecaniques
// (forbidden/color/mirror/prism/pyra/mirrorNeuron) sur CHAQUE tentative au
// lieu de les tirer au hasard dans un budget de poids -- le moteur
// verifie encore, comme en jeu, que mirror/prism/pyra/mirrorNeuron sont
// "genuinely used" (pruneUnused*/pruneUnnecessaryPyra) avant de les
// garder : rien de decoratif ne peut survivre.
//
// Usage: node scripts/gen-mechanics-forced.mjs [indexPlanUnique]

import { tryGenerateForced } from "../src/game/generator.js";
import { countSolutions } from "../src/game/solver.js";

const ALL_FEATURES = ["forbidden", "color", "mirror", "prism", "pyra", "mirrorNeuron"];

function tokensOf(cells) {
  const out = [];
  for (const row of cells) {
    const tokens = Array.isArray(row) ? row : row.includes(" ") ? row.trim().split(/\s+/) : row.split("");
    out.push(...tokens);
  }
  return out;
}

function mechanicsPresent(cells) {
  const present = new Set();
  for (const t of tokensOf(cells)) {
    if (t === "0") present.add("forbidden");
    if (t === "/" || t === "\\") present.add("mirror");
    if (/^P([rgbw])?$/.test(t)) present.add("prism");
    if (t === "Y") present.add("pyra");
    if (t === "M") present.add("mirrorNeuron");
    if (/^[1-4][rgb]$/.test(t) || ["r", "g", "b", "y", "c", "m", "w"].includes(t)) present.add("color");
  }
  return present;
}

function runLevel({ label, sizeBoost, minBranchCount, seedCount, seedBase, wallBudgetMs, perAttemptTimeoutMs }) {
  let best = null;
  const wallDeadline = Date.now() + (wallBudgetMs ?? 130000);
  for (let i = 0; i < seedCount; i++) {
    if (Date.now() > wallDeadline) {
      console.log(`  [${label}] deadline globale atteinte, arret apres ${i} seed(s).`);
      break;
    }
    const seed = seedBase + i * 104729;
    const t0 = Date.now();
    const r = tryGenerateForced(seed, 3, Date.now() + (perAttemptTimeoutMs ?? 25000), sizeBoost);
    const ms = Date.now() - t0;
    if (!r) {
      console.log(`  [${label}] seed=${seed}: echec (null) [${ms}ms]`);
      continue;
    }
    const present = mechanicsPresent(r.cells);
    // Ne fait confiance qu'aux mecaniques REELLEMENT presentes en tokens ET
    // confirmees "genuinely used" par le moteur (featureSubset) -- les deux
    // doivent concorder pour mirror/prism/pyra/mirrorNeuron.
    const genuineCount = ALL_FEATURES.filter((k) => present.has(k) && r.featureSubset.includes(k)).length;
    const score = genuineCount * 1000000 + r.analysis.branchCount;
    console.log(
      `  [${label}] seed=${seed}: ${r.rows}x${r.cols} tokens=[${[...present].join(",")}] featureSubset=[${r.featureSubset.join(",")}] tier=${r.analysis.tier} branch=${r.analysis.branchCount} [${ms}ms]`
    );
    if (!best || score > best.score) best = { ...r, present, genuineCount, score, seed };
    if (genuineCount === ALL_FEATURES.length && r.analysis.branchCount >= minBranchCount) {
      console.log(`  [${label}] -> les 6 mecaniques GENUINEMENT utilisees + branchCount cible atteintes, on arrete.`);
      break;
    }
  }
  return best;
}

const ALL_PLANS = [
  { label: "Niveau A", sizeBoost: { rows: 0, cols: 0 }, minBranchCount: 300, seedCount: 200, seedBase: 555777, wallBudgetMs: 130000, perAttemptTimeoutMs: 12000 },
  { label: "Niveau B", sizeBoost: { rows: 1, cols: 1 }, minBranchCount: 500, seedCount: 200, seedBase: 20000, wallBudgetMs: 120000, perAttemptTimeoutMs: 15000 },
  { label: "Niveau C", sizeBoost: { rows: 2, cols: 2 }, minBranchCount: 800, seedCount: 200, seedBase: 930000, wallBudgetMs: 130000, perAttemptTimeoutMs: 18000 },
  { label: "Niveau D", sizeBoost: { rows: 4, cols: 3 }, minBranchCount: 1200, seedCount: 150, seedBase: 940777, wallBudgetMs: 130000, perAttemptTimeoutMs: 20000 },
  { label: "Niveau E", sizeBoost: { rows: 6, cols: 4 }, minBranchCount: 1800, seedCount: 100, seedBase: 141421, wallBudgetMs: 130000, perAttemptTimeoutMs: 15000 },
  { label: "Niveau F", sizeBoost: { rows: 7, cols: 5 }, minBranchCount: 1500, seedCount: 150, seedBase: 777001, wallBudgetMs: 132000, perAttemptTimeoutMs: 18000 },
];

const onlyIndex = process.argv[2] != null ? Number(process.argv[2]) : null;
const PLANS = onlyIndex != null ? [ALL_PLANS[onlyIndex]] : ALL_PLANS;

const results = [];
for (const plan of PLANS) {
  console.log(`\n=== ${plan.label} (sizeBoost rows+${plan.sizeBoost.rows}/cols+${plan.sizeBoost.cols}, minBranchCount=${plan.minBranchCount}) ===`);
  const t0 = Date.now();
  const best = runLevel(plan);
  const ms = Date.now() - t0;
  if (!best) {
    console.log(`${plan.label}: AUCUN CANDIDAT TROUVE en ${ms}ms`);
    results.push({ label: plan.label, ok: false });
    continue;
  }
  const verify = countSolutions({ name: plan.label, rows: best.rows, cols: best.cols, cells: best.cells }, 2, 3000000);
  console.log(
    `${plan.label}: RETENU ${best.rows}x${best.cols}, genuineCount=${best.genuineCount}/6, tokens=[${[...best.present].join(",")}], tier=${best.analysis.tier}, branch=${best.analysis.branchCount}, verify=${JSON.stringify(verify)} [recherche ${ms}ms]`
  );
  results.push({
    label: plan.label,
    ok: true,
    rows: best.rows,
    cols: best.cols,
    cells: best.cells,
    solution: best.analysis.solution,
    mechanics: [...best.present],
    genuineCount: best.genuineCount,
    tier: best.analysis.tier,
    branchCount: best.analysis.branchCount,
    verifyCount: verify.count,
    verifyExhausted: verify.exhausted,
  });
}

console.log("\n\n=== JSON FINAL ===");
console.log(JSON.stringify(results, null, 2));
