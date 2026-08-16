// Outil de dev : cherche des niveaux à SOLUTION UNIQUE.
//
// Boucle: génère une forme (murs/void), la résout par remplissage glouton
// pour obtenir une solution candidate, transforme les murs en indices
// numériques dérivés de cette solution (ce qui contraint fortement le
// puzzle), puis vérifie l'unicité avec le solveur par backtracking. Si ce
// n'est pas unique, on réessaie avec un autre seed, jusqu'à trouver un
// niveau valide ou épuiser le nombre d'essais.
//
// Usage: node scripts/generate-unique-levels.mjs

import { LightUpGrid, CellType } from "../src/game/grid.js";
import { countSolutions } from "../src/game/solver.js";

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function buildLayout({ rows, cols, wallDensity, cornerVoid = 0, seed }) {
  const rand = seededRandom(seed);
  const rowsOut = [];
  for (let r = 0; r < rows; r++) {
    let row = "";
    for (let c = 0; c < cols; c++) {
      const inCorner =
        cornerVoid > 0 &&
        (r < cornerVoid || r >= rows - cornerVoid) &&
        (c < cornerVoid || c >= cols - cornerVoid);
      row += inCorner ? "X" : rand() < wallDensity ? "#" : ".";
    }
    rowsOut.push(row);
  }
  return rowsOut;
}

const DIRECTIONS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

function greedySolve(cells, rows, cols) {
  const grid = new LightUpGrid({ rows, cols, cells });
  const lights = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid.cellAt(r, c);
      if (cell.type === CellType.EMPTY && !cell._illuminated) {
        const res = grid.toggleLight(r, c);
        if (res === "placed") lights.push([r, c]);
      }
    }
  }
  return { grid, lights };
}

function wallsToClues(cells, grid, rows, cols, fraction, seed) {
  const rand = seededRandom(seed);
  const out = cells.map((row) => row.split(""));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (out[r][c] === "#" && rand() < fraction) {
        let count = 0;
        for (const [dr, dc] of DIRECTIONS) {
          const nCell = grid.cellAt(r + dr, c + dc);
          if (nCell && nCell.type === CellType.EMPTY && grid.hasLight(r + dr, c + dc)) count++;
        }
        out[r][c] = String(count);
      }
    }
  }
  return out.map((row) => row.join(""));
}

function tryGenerate(spec, seed) {
  const { rows, cols, wallDensity, cornerVoid, clueFraction } = spec;
  const rawCells = buildLayout({ rows, cols, wallDensity, cornerVoid, seed });
  const { grid, lights } = greedySolve(rawCells, rows, cols);
  if (lights.length === 0) return null;

  const finalCells = wallsToClues(rawCells, grid, rows, cols, clueFraction, seed + 999);
  const level = { rows, cols, cells: finalCells };

  const { count, exhausted } = countSolutions(level, 2, spec.nodeBudget || 500_000);
  if (!exhausted || count !== 1) return null;

  return { ...level, solution: lights };
}

const specs = (process.env.LEVEL_SPECS ? JSON.parse(process.env.LEVEL_SPECS) : [
  { name: "Miroir", rows: 5, cols: 5, wallDensity: 0.22, cornerVoid: 0, clueFraction: 1, nodeBudget: 300000 },
  { name: "Silence", rows: 5, cols: 5, wallDensity: 0.28, cornerVoid: 0, clueFraction: 1, nodeBudget: 300000 },
  { name: "Résonance", rows: 6, cols: 6, wallDensity: 0.24, cornerVoid: 0, clueFraction: 1, nodeBudget: 500000 },
  { name: "Labyrinthe", rows: 6, cols: 6, wallDensity: 0.3, cornerVoid: 1, clueFraction: 1, nodeBudget: 500000 },
  { name: "Zénith", rows: 7, cols: 7, wallDensity: 0.28, cornerVoid: 1, clueFraction: 1, nodeBudget: 800000 },
]);

const results = [];
for (const spec of specs) {
  let found = null;
  const maxAttempts = 400;
  for (let attempt = 0; attempt < maxAttempts && !found; attempt++) {
    const seedBase = Number(process.env.SEED_BASE || 1000);
    const seed = seedBase * (specs.indexOf(spec) + 1) + attempt;
    found = tryGenerate(spec, seed);
  }
  results.push({ name: spec.name, ...spec, result: found });
  console.log(
    found
      ? `${spec.name}: trouvé (${found.rows}x${found.cols}, ${found.solution.length} lumières)`
      : `${spec.name}: ÉCHEC après ${maxAttempts} essais`
  );
}

console.log("\n--- Détails ---\n");
for (const r of results) {
  if (!r.result) continue;
  console.log(`// ${r.name}`);
  console.log(
    JSON.stringify(
      { name: r.name, rows: r.result.rows, cols: r.result.cols, cells: r.result.cells },
      null,
      2
    )
  );
  console.log("solution:", JSON.stringify(r.result.solution));
  console.log("");
}
