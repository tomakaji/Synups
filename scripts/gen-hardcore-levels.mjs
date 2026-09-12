// Outil de dev PONCTUEL (pas committe comme feature) : cherche, pour six
// paliers de difficulte croissante bien au-dela du 3 etoiles normal, un
// niveau genere par le moteur Infini/Defi Quotidien (generator.js) qui
// couvre le plus de mecaniques possible (idealement les 6 :
// forbidden/color/mirror/prism/pyra/mirrorNeuron), avec un budget de
// features TEMPORAIREMENT elargi (voir DIFFICULTY_PRESETS[3].budget dans
// generator.js, a revert apres usage) pour que les 6 features aient une
// vraie chance de coexister sur un meme plateau au lieu d'etre plafonnees a
// ~5 par le budget de poids normal.
//
// Usage: node scripts/gen-hardcore-levels.mjs

import { generateLevel } from "../src/game/generator.js";
import { countSolutions } from "../src/game/solver.js";

const ALL_FEATURES = ["forbidden", "color", "mirror", "prism", "pyra", "mirrorNeuron"];
// forbidden et mirrorNeuron sont retires de la RECHERCHE elle-meme : ils
// seront patches a la main apres coup (voir scripts/patch-hardcore-levels.mjs),
// de facon garantie et sans risque plutot que de compter sur le hasard du
// budget de poids (mirrorNeuron=5 est lourd, entre souvent en conflit avec
// les 4 autres) -- laisse plus de budget/probabilite aux 4 mecaniques qui
// doivent, elles, etre GENUINEMENT necessaires (verifiees par le moteur).
const SEARCH_FEATURES = ["color", "mirror", "prism", "pyra"];

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

function runLevel({ label, sizeBoost, minBranchCount, seedCount, maxAttempts, maxTimeMs, seedBase, wallDeadline }) {
  let best = null;
  for (let i = 0; i < seedCount; i++) {
    if (wallDeadline && Date.now() > wallDeadline) {
      console.log(`  [${label}] deadline globale atteinte, arret apres ${i} seed(s).`);
      break;
    }
    const seed = seedBase + i * 104729;
    const t0 = Date.now();
    const result = generateLevel({
      difficulty: 3,
      enabledFeatureKeys: SEARCH_FEATURES,
      seed,
      maxAttempts,
      maxTimeMs,
      sizeBoost,
      minBranchCount,
    });
    const ms = Date.now() - t0;
    if (!result) {
      console.log(`  [${label}] seed=${seed}: echec generateLevel (null) [${ms}ms]`);
      continue;
    }
    const present = mechanicsPresent(result.level.cells);
    const score = present.size * 1000000 + result.branchCount;
    console.log(
      `  [${label}] seed=${seed}: ${result.level.rows}x${result.level.cols} mecaniques=[${[...present].join(",")}] tier=${result.measuredTier} branch=${result.branchCount} lights=${result.solution.length} [${ms}ms]`
    );
    if (!best || score > best.score) best = { ...result, present, score, seed };
    if (present.size === SEARCH_FEATURES.length && result.branchCount >= minBranchCount) {
      console.log(`  [${label}] -> toutes les mecaniques + branchCount cible atteintes, on arrete.`);
      break;
    }
  }
  return best;
}

const ALL_PLANS = [
  { label: "Niveau A", sizeBoost: { rows: 1, cols: 1 }, minBranchCount: 400, seedCount: 15, maxAttempts: 40, maxTimeMs: 12000, seedBase: 1000000, wallBudgetMs: 130000 },
  { label: "Niveau B", sizeBoost: { rows: 2, cols: 2 }, minBranchCount: 700, seedCount: 15, maxAttempts: 40, maxTimeMs: 15000, seedBase: 2000000, wallBudgetMs: 130000 },
  { label: "Niveau C", sizeBoost: { rows: 4, cols: 3 }, minBranchCount: 1200, seedCount: 15, maxAttempts: 40, maxTimeMs: 18000, seedBase: 3000000, wallBudgetMs: 130000 },
  { label: "Niveau D", sizeBoost: { rows: 6, cols: 4 }, minBranchCount: 2000, seedCount: 15, maxAttempts: 50, maxTimeMs: 20000, seedBase: 4000000, wallBudgetMs: 120000 },
  { label: "Niveau E", sizeBoost: { rows: 9, cols: 6 }, minBranchCount: 3000, seedCount: 15, maxAttempts: 60, maxTimeMs: 25000, seedBase: 5000000, wallBudgetMs: 110000 },
  { label: "Niveau F", sizeBoost: { rows: 13, cols: 9 }, minBranchCount: 4500, seedCount: 20, maxAttempts: 80, maxTimeMs: 30000, seedBase: 6000000, wallBudgetMs: 100000 },
];

// Usage: node scripts/gen-hardcore-levels.mjs [indexPlanUnique]
const onlyIndex = process.argv[2] != null ? Number(process.argv[2]) : null;
const PLANS = onlyIndex != null ? [ALL_PLANS[onlyIndex]] : ALL_PLANS;

const results = [];
for (const plan of PLANS) {
  console.log(`\n=== ${plan.label} (sizeBoost rows+${plan.sizeBoost.rows}/cols+${plan.sizeBoost.cols}, minBranchCount=${plan.minBranchCount}) ===`);
  const t0 = Date.now();
  const best = runLevel({ ...plan, wallDeadline: t0 + (plan.wallBudgetMs ?? 150000) });
  const ms = Date.now() - t0;
  if (!best) {
    console.log(`${plan.label}: AUCUN CANDIDAT TROUVE en ${ms}ms`);
    results.push({ label: plan.label, ok: false });
    continue;
  }
  const verify = countSolutions({ name: plan.label, rows: best.level.rows, cols: best.level.cols, cells: best.level.cells }, 2, 3000000);
  console.log(
    `${plan.label}: RETENU ${best.level.rows}x${best.level.cols}, mecaniques=[${[...best.present].join(",")}], tier=${best.measuredTier}, branch=${best.branchCount}, lights=${best.solution.length}, verify=${JSON.stringify(verify)} [recherche ${ms}ms]`
  );
  results.push({
    label: plan.label,
    ok: true,
    rows: best.level.rows,
    cols: best.level.cols,
    cells: best.level.cells,
    solution: best.solution,
    mechanics: [...best.present],
    tier: best.measuredTier,
    branchCount: best.branchCount,
    verifyCount: verify.count,
    verifyExhausted: verify.exhausted,
  });
}

console.log("\n\n=== JSON FINAL ===");
console.log(JSON.stringify(results, null, 2));
