// Outil de dev PONCTUEL (v3). Comme gen-mechanics-forced.mjs (v2), mais la
// selection du "genuineCount" ne fait plus confiance au featureSubset
// interne du generateur (qui s'est revele avoir des faux positifs ET des
// faux negatifs sur des petites grilles -- verifie empiriquement lors du
// retour utilisateur du 11 sept: un prisme "genuinely used" par le moteur
// ne changeait RIEN au retirer, et un neurone miroir NON marque "genuinely
// used" changeait tout au retirer). Ici on neutralise physiquement chaque
// mecanique presente (categorie par categorie) et on recompte les
// solutions avec countSolutions -- si le compte ne change pas du tout,
// la mecanique est decorative et ne compte pas comme "genuine", peu
// importe ce que dit featureSubset.
import { tryGenerateForced } from "../src/game/generator.js";
import { countSolutions } from "../src/game/solver.js";

const ALL_FEATURES = ["forbidden", "color", "mirror", "prism", "pyra", "mirrorNeuron"];

function tokensOf(row) {
  return row.includes(" ") ? row.trim().split(/\s+/) : row.split("");
}
function classify(tok) {
  if (tok === "0") return "forbidden";
  if (tok === "/" || tok === "\\") return "mirror";
  if (/^P([rgbw])?$/.test(tok)) return "prism";
  if (tok === "Y") return "pyra";
  if (tok === "M") return "mirrorNeuron";
  if (/^[1-4][rgb]$/.test(tok)) return "color";
  if (["r", "g", "b", "y", "c", "m", "w"].includes(tok)) return "color";
  return null;
}
function neutralize(tok, category) {
  if (category === "color") {
    const m = /^([1-4])([rgb])$/.exec(tok);
    if (m) return m[1];
    return ".";
  }
  return ".";
}
function neutralizeGrid(cells, category) {
  return cells.map((row) => tokensOf(row).map((t) => (classify(t) === category ? neutralize(t, category) : t)).join(" "));
}
function presentCategories(cells) {
  const s = new Set();
  for (const row of cells) for (const t of tokensOf(row)) { const c = classify(t); if (c) s.add(c); }
  return s;
}

// Retourne { trueGenuine: Set, trueCount, baseVerify }
function empiricalNecessity(rows, cols, cells) {
  const baseVerify = countSolutions({ name: "cand", rows, cols, cells }, 3, 800000);
  if (baseVerify.count !== 1 || !baseVerify.exhausted) return null; // pas unique -> rejeter
  const present = presentCategories(cells);
  const trueGenuine = new Set();
  for (const cat of ALL_FEATURES) {
    if (!present.has(cat)) continue;
    const modCells = neutralizeGrid(cells, cat);
    const v = countSolutions({ name: "cand-no-" + cat, rows, cols, cells: modCells }, 3, 800000);
    const changed = v.count !== baseVerify.count || !v.exhausted !== !baseVerify.exhausted;
    if (changed) trueGenuine.add(cat);
  }
  return { trueGenuine, baseVerify, present };
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
    const r = tryGenerateForced(seed, 3, Date.now() + (perAttemptTimeoutMs ?? 15000), sizeBoost);
    const ms = Date.now() - t0;
    if (!r) { console.log(`  [${label}] seed=${seed}: echec (null) [${ms}ms]`); continue; }
    const emp = empiricalNecessity(r.rows, r.cols, r.cells);
    if (!emp) { console.log(`  [${label}] seed=${seed}: pas unique apres tryGenerateForced (bizarre), skip [${ms}ms]`); continue; }
    const trueCount = emp.trueGenuine.size;
    const score = trueCount * 1000000 + r.analysis.branchCount;
    console.log(
      `  [${label}] seed=${seed}: ${r.rows}x${r.cols} present=[${[...emp.present].join(",")}] trueGenuine=[${[...emp.trueGenuine].join(",")}] tier=${r.analysis.tier} branch=${r.analysis.branchCount} [${ms}ms]`
    );
    if (!best || score > best.score) best = { ...r, present: emp.present, trueGenuine: emp.trueGenuine, trueCount, score, seed };
    if (trueCount === ALL_FEATURES.length && r.analysis.branchCount >= minBranchCount) {
      console.log(`  [${label}] -> 6/6 VRAIMENT necessaires + branchCount cible, on arrete.`);
      break;
    }
  }
  return best;
}

const ALL_PLANS = [
  { label: "Niveau A", sizeBoost: { rows: 0, cols: 0 }, minBranchCount: 300, seedCount: 400, seedBase: 2024001, wallBudgetMs: 135000, perAttemptTimeoutMs: 10000 },
  { label: "Niveau B", sizeBoost: { rows: 1, cols: 1 }, minBranchCount: 500, seedCount: 300, seedBase: 3033001, wallBudgetMs: 135000, perAttemptTimeoutMs: 12000 },
  { label: "Niveau C", sizeBoost: { rows: 2, cols: 2 }, minBranchCount: 800, seedCount: 250, seedBase: 4044001, wallBudgetMs: 135000, perAttemptTimeoutMs: 15000 },
];

const onlyIndex = process.argv[2] != null ? Number(process.argv[2]) : null;
const PLANS = onlyIndex != null ? [ALL_PLANS[onlyIndex]] : ALL_PLANS;

const results = [];
for (const plan of PLANS) {
  console.log(`\n=== ${plan.label} (sizeBoost rows+${plan.sizeBoost.rows}/cols+${plan.sizeBoost.cols}, minBranchCount=${plan.minBranchCount}) ===`);
  const t0 = Date.now();
  const best = runLevel(plan);
  const ms = Date.now() - t0;
  if (!best) { console.log(`${plan.label}: AUCUN CANDIDAT TROUVE en ${ms}ms`); results.push({ label: plan.label, ok: false }); continue; }
  const verify = countSolutions({ name: plan.label, rows: best.rows, cols: best.cols, cells: best.cells }, 2, 3000000);
  console.log(
    `${plan.label}: RETENU ${best.rows}x${best.cols}, trueGenuine=${best.trueCount}/6 [${[...best.trueGenuine].join(",")}], present=[${[...best.present].join(",")}], tier=${best.analysis.tier}, branch=${best.analysis.branchCount}, verify=${JSON.stringify(verify)} [recherche ${ms}ms]`
  );
  results.push({
    label: plan.label, ok: true, rows: best.rows, cols: best.cols, cells: best.cells,
    trueGenuine: [...best.trueGenuine], present: [...best.present], trueCount: best.trueCount,
    tier: best.analysis.tier, branchCount: best.analysis.branchCount,
    verifyCount: verify.count, verifyExhausted: verify.exhausted,
  });
}
console.log("\n\n=== JSON FINAL ===");
console.log(JSON.stringify(results, null, 2));
