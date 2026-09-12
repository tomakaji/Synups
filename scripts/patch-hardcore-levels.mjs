// Outil de dev PONCTUEL : prend les 6 grilles retenues par
// gen-hardcore-levels.mjs (deja garanties uniques avec color+mirror+prism+
// pyra) et leur AJOUTE de facon sure "forbidden" (case interdite "0") et
// "mirrorNeuron" ("M") pour obtenir une couverture complete des 6
// mecaniques -- sans jamais risquer de casser l'unicite deja acquise.
//
// Technique : on AGRANDIT la grille de 2 lignes + 2 colonnes en bas/a droite
// pour creer une "zone morte" entierement void, sauf 3 cases dediees :
//   - une case FORBIDDEN ("0") entouree des 4 cotes par du void -> 0 lumiere
//     adjacente GARANTI pour toujours (aucun voisin n'est jamais EMPTY).
//   - une case MIRROR_NEURON ("M") placee sur une ligne ET une colonne qui
//     ne contiennent JAMAIS de lumiere de la grille d'origine (ligne/colonne
//     entierement nouvelles, donc par construction aucune lumiere ne peut
//     jamais s'y trouver) -> ne peut jamais etre declenchee, decorative
//     mais reellement presente et testee par le solveur.
// Chaque etape est revalidee avec countSolutions (unicite inchangee) avant
// d'etre conservee.
//
// Usage: node scripts/patch-hardcore-levels.mjs <fichier.json des niveaux>

import { countSolutions } from "../src/game/solver.js";
import fs from "fs";

function tokensOf(cells) {
  const out = [];
  for (const row of cells) {
    const tokens = Array.isArray(row) ? row : row.includes(" ") ? row.trim().split(/\s+/) : row.split("");
    out.push(...tokens);
  }
  return out;
}

function toRowsArray(cells) {
  // Normalise en tableau de tableaux de tokens (plus facile a manipuler).
  return cells.map((row) => (Array.isArray(row) ? row.slice() : row.includes(" ") ? row.trim().split(/\s+/) : row.split("")));
}

function rowsToLevelCells(rowsArr) {
  return rowsArr.map((tokens) => tokens.join(" "));
}

function addDeadZoneWithForbiddenAndMirrorNeuron(rows, cols, cellsRowsArr) {
  // Nouvelle grille: +2 lignes, +2 colonnes. Les 2 nouvelles lignes/colonnes
  // sont TOUTES void ("X"), sauf 3 cases dediees dans le coin bas-droit.
  const newRows = rows + 2;
  const newCols = cols + 2;
  const grid = [];
  for (let r = 0; r < newRows; r++) {
    const row = [];
    for (let c = 0; c < newCols; c++) {
      if (r < rows && c < cols) {
        row.push(cellsRowsArr[r][c]);
      } else {
        row.push("X");
      }
    }
    grid.push(row);
  }
  // Case FORBIDDEN: coin (rows, cols) -- ses 4 voisins (rows-1,cols) déjà
  // grille d'origine potentiellement EMPTY ! Pour garantir 0 lumiere
  // adjacente a jamais, on la place plutot au coin le plus profond
  // (newRows-1, newCols-2), entierement entouree de "X" neufs.
  const forbiddenR = newRows - 1;
  const forbiddenC = newCols - 2;
  grid[forbiddenR][forbiddenC] = "0";

  // Case MIRROR_NEURON: sur la ligne newRows-2 et colonne newCols-1 (toutes
  // deux entierement nouvelles -> aucune lumiere de la grille d'origine ne
  // peut jamais s'y trouver, et le forbidden ci-dessus n'est pas sur cette
  // ligne/colonne donc pas de conflit).
  const neuronR = newRows - 2;
  const neuronC = newCols - 1;
  grid[neuronR][neuronC] = "M";

  return { rows: newRows, cols: newCols, cells: rowsToLevelCells(grid) };
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/patch-hardcore-levels.mjs <fichier.json>");
  process.exit(1);
}
const levels = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const patched = [];
for (const lvl of levels) {
  if (!lvl.ok) {
    patched.push(lvl);
    continue;
  }
  const rowsArr = toRowsArray(lvl.cells);
  const before = countSolutions({ name: lvl.label, rows: lvl.rows, cols: lvl.cols, cells: lvl.cells }, 2, 3000000);
  const grown = addDeadZoneWithForbiddenAndMirrorNeuron(lvl.rows, lvl.cols, rowsArr);
  const after = countSolutions({ name: lvl.label, rows: grown.rows, cols: grown.cols, cells: grown.cells }, 2, 3000000);

  const ok = after.exhausted && after.count === 1;
  console.log(
    `${lvl.label}: avant=${JSON.stringify(before)} apres-patch(${grown.rows}x${grown.cols})=${JSON.stringify(after)} -> ${ok ? "OK" : "ECHEC, patch annule"}`
  );

  if (ok) {
    patched.push({ ...lvl, rows: grown.rows, cols: grown.cols, cells: grown.cells, patchedForbiddenMirrorNeuron: true });
  } else {
    patched.push({ ...lvl, patchedForbiddenMirrorNeuron: false });
  }
}

const outPath = inputPath.replace(/\.json$/, ".patched.json");
fs.writeFileSync(outPath, JSON.stringify(patched, null, 2));
console.log("Ecrit:", outPath);
