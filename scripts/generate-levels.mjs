// Outil d'aide à la conception de niveaux : génère une forme de grille
// (murs/void aléatoires mais reproductibles via seed), résout la grille par
// un remplissage glouton (garantit une couverture complète), puis transforme
// certains murs en indices numériques cohérents avec la solution trouvée.
//
// Ce script ne fait pas partie du jeu final : c'est un générateur de
// contenu à usage ponctuel, à relancer pour produire de nouveaux niveaux.
//
// Usage: node scripts/generate-levels.mjs

import { LightUpGrid, CellType } from "../src/game/grid.js";

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
      if (inCorner) {
        row += "X";
      } else {
        row += rand() < wallDensity ? "#" : ".";
      }
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

function assignClues(cells, grid, rows, cols, clueFraction, seed) {
  const rand = seededRandom(seed);
  const out = cells.map((row) => row.split(""));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (out[r][c] === "#" && rand() < clueFraction) {
        let count = 0;
        for (const [dr, dc] of DIRECTIONS) {
          const nr = r + dr;
          const nc = c + dc;
          const nCell = grid.cellAt(nr, nc);
          if (nCell && nCell.type === CellType.EMPTY && grid.hasLight(nr, nc)) {
            count++;
          }
        }
        out[r][c] = String(count);
      }
    }
  }
  return out.map((row) => row.join(""));
}

function generateLevel(params) {
  const { name, rows, cols, wallDensity, cornerVoid, clueFraction, seed } = params;
  const rawCells = buildLayout({ rows, cols, wallDensity, cornerVoid, seed });
  const { grid, lights } = greedySolve(rawCells, rows, cols);
  const finalCells = assignClues(rawCells, grid, rows, cols, clueFraction, seed + 1);

  // Vérification immédiate avec les indices en place (walls -> clues ne
  // change pas la propagation, mais on revérifie par sécurité).
  const finalGrid = new LightUpGrid({ rows, cols, cells: finalCells });
  for (const [r, c] of lights) finalGrid.toggleLight(r, c);
  const ok = finalGrid.isWon();

  return { name, rows, cols, cells: finalCells, solution: lights, ok };
}

const levelSpecs = [
  { name: "Dérive", rows: 6, cols: 6, wallDensity: 0.15, cornerVoid: 0, clueFraction: 0.4, seed: 101 },
  { name: "Veille", rows: 7, cols: 7, wallDensity: 0.18, cornerVoid: 0, clueFraction: 0.45, seed: 202 },
  { name: "Abîme", rows: 8, cols: 8, wallDensity: 0.2, cornerVoid: 1, clueFraction: 0.5, seed: 303 },
  { name: "Vertige", rows: 9, cols: 9, wallDensity: 0.22, cornerVoid: 1, clueFraction: 0.55, seed: 404 },
  { name: "Éclipse", rows: 10, cols: 10, wallDensity: 0.24, cornerVoid: 2, clueFraction: 0.6, seed: 505 },
];

for (const spec of levelSpecs) {
  const level = generateLevel(spec);
  console.log(`// ${level.name} (${level.ok ? "OK" : "ECHEC"})`);
  console.log(JSON.stringify({ name: level.name, rows: level.rows, cols: level.cols, cells: level.cells }, null, 2));
  console.log("solution:", JSON.stringify(level.solution));
  console.log("");
}
