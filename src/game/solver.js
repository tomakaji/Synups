// Solveur, réutilisé à la fois par les outils de génération/validation de
// niveaux (scripts/) et potentiellement plus tard par un système d'indices
// en jeu. S'appuie entièrement sur LightUpGrid (toggleLight, isWon) pour
// ne jamais diverger des règles réelles du jeu.
//
// Contrairement à un simple backtracking "case par case dans l'ordre de
// lecture", ce solveur alterne à chaque noeud:
//   1) une passe de PROPAGATION qui déduit les placements forcés (cases
//      qu'on peut affirmer allumées ou éteintes avec certitude, sans
//      deviner), avant de brancher sur quoi que ce soit;
//   2) un choix de branchement qui privilégie la case appartenant à
//      l'indice le plus "serré" (le moins de combinaisons possibles), pour
//      heurter une contradiction ou une nouvelle déduction le plus vite
//      possible plutôt que d'explorer une zone ouverte au hasard.
//
// La propagation a deux niveaux :
//   - Stage 1 (par indice individuel) : si le nombre de cases libres
//     restantes égale exactement le nombre de lumières encore nécessaires,
//     elles sont toutes forcées allumées ; si le besoin restant est nul,
//     elles sont toutes forcées éteintes (cases interdites: toujours dans
//     ce second cas puisqu'elles exigent 0 lumière adjacente).
//   - Stage 2 (paires d'indices en interaction) : deux indices peuvent
//     "se contraindre" mutuellement quand certaines de leurs cases libres
//     se voient l'une l'autre (même ligne/colonne, sans obstacle entre
//     elles) — dans ce cas, au plus une des deux peut être allumée. En
//     énumérant les combinaisons valides pour la paire (respectant les
//     deux comptes ET ces exclusions croisées), on peut parfois déduire
//     qu'une case est allumée (ou éteinte) dans TOUTES les combinaisons
//     valides, donc forcément vraie, même si aucun des deux indices n'est
//     déterminé isolément. C'est une généralisation du raisonnement
//     "les deux neurones de 3 qui se gênent" (voir levels.js "All the
//     images").
//
// Ces déductions sont des conséquences NÉCESSAIRES (pas des paris) : les
// encoder comme des placements immédiats plutôt que comme des branches
// ne change jamais le nombre de solutions trouvées, seulement la vitesse
// pour y arriver. Chaque appel de propagation annule proprement ses propres
// effets si elle découvre une contradiction, et le backtracking annule les
// siens en sortant de chaque noeud — donc à tout moment, l'état de `grid`
// correspond exactement au chemin actuellement exploré.

import { LightUpGrid, CellType } from "./grid.js";

const DIRECTIONS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

class NodeBudgetExceeded extends Error {}

function anyClueError(grid) {
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cellAt(r, c);
      if (cell.type === CellType.CLUE && cell._state === "error") return true;
    }
  }
  return false;
}

function keyOf(r, c) {
  return `${r},${c}`;
}

/** Voisins EMPTY d'une case (r,c) déjà porteurs d'une lumière (décidés "allumés"). */
function litNeighborCount(grid, r, c) {
  let n = 0;
  for (const [dr, dc] of DIRECTIONS) {
    const nc = grid.cellAt(r + dr, c + dc);
    if (nc && nc.type === CellType.EMPTY && grid.hasLight(r + dr, c + dc)) n++;
  }
  return n;
}

/** Voisins EMPTY d'une case (r,c) ni allumés, ni exclus (encore "libres"). */
function freeUndecidedNeighbors(grid, r, c, excluded) {
  const result = [];
  for (const [dr, dc] of DIRECTIONS) {
    const nr = r + dr;
    const nc = c + dc;
    const cell = grid.cellAt(nr, nc);
    if (!cell || cell.type !== CellType.EMPTY) continue;
    if (grid.hasLight(nr, nc)) continue;
    if (excluded.has(keyOf(nr, nc))) continue;
    result.push([nr, nc]);
  }
  return result;
}

/** Toutes les cases EMPTY ni allumées, ni exclues: ce qui reste à décider. */
function getUndecided(grid, excluded) {
  const result = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cellAt(r, c);
      if (cell.type !== CellType.EMPTY) continue;
      if (grid.hasLight(r, c)) continue;
      if (excluded.has(keyOf(r, c))) continue;
      result.push([r, c]);
    }
  }
  return result;
}

/**
 * Deux cases sont "mutuellement visibles" si elles sont sur la même
 * ligne/colonne sans aucun obstacle (case non-EMPTY) entre elles — dans ce
 * cas, au plus une des deux peut porter une lumière (une case déjà
 * éclairée ne peut pas en recevoir une autre). Propriété purement
 * structurelle: ne dépend pas des lumières actuellement posées.
 */
function mutuallyVisible(grid, [r1, c1], [r2, c2]) {
  if (r1 === r2) {
    const [lo, hi] = c1 < c2 ? [c1, c2] : [c2, c1];
    for (let c = lo + 1; c < hi; c++) {
      if (grid.cellAt(r1, c).type !== CellType.EMPTY) return false;
    }
    return true;
  }
  if (c1 === c2) {
    const [lo, hi] = r1 < r2 ? [r1, r2] : [r2, r1];
    for (let r = lo + 1; r < hi; r++) {
      if (grid.cellAt(r, c1).type !== CellType.EMPTY) return false;
    }
    return true;
  }
  return false;
}

/**
 * Déductions "stage 2" pour une paire d'indices (clues) en interaction.
 * Retourne `null` si la paire n'a rien à apporter (un des deux n'a plus de
 * case libre — déjà couvert par stage 1), `{ ok:false }` si aucune
 * combinaison jointe n'est possible (contradiction), ou
 * `{ ok:true, forcedLit, forcedDark }` avec les cases qui prennent la même
 * valeur dans TOUTES les combinaisons valides (donc certaines).
 */
function pairDeductions(grid, clueA, clueB, excluded) {
  const [ar, ac, aNumber] = clueA;
  const [br, bc, bNumber] = clueB;

  const neededA = aNumber - litNeighborCount(grid, ar, ac);
  const neededB = bNumber - litNeighborCount(grid, br, bc);
  const freeA = freeUndecidedNeighbors(grid, ar, ac, excluded);
  const freeB = freeUndecidedNeighbors(grid, br, bc, excluded);
  if (freeA.length === 0 || freeB.length === 0) return null;
  if (neededA < 0 || neededA > freeA.length || neededB < 0 || neededB > freeB.length) {
    return { ok: false };
  }

  // Variables combinées, dédupliquées si une case est adjacente aux DEUX indices.
  const varIndex = new Map();
  const vars = [];
  for (const cell of [...freeA, ...freeB]) {
    const k = keyOf(cell[0], cell[1]);
    if (!varIndex.has(k)) {
      varIndex.set(k, vars.length);
      vars.push(cell);
    }
  }
  const idxA = freeA.map(([r, c]) => varIndex.get(keyOf(r, c)));
  const idxB = freeB.map(([r, c]) => varIndex.get(keyOf(r, c)));

  const n = vars.length;
  if (n > 12) return null; // garde-fou: 2^12 reste trivial, au-delà on laisse le stage1/le branchement gérer

  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (mutuallyVisible(grid, vars[i], vars[j])) edges.push([i, j]);
    }
  }

  const validMasks = [];
  const total = 1 << n;
  for (let mask = 0; mask < total; mask++) {
    let countA = 0;
    for (const i of idxA) if ((mask >> i) & 1) countA++;
    if (countA !== neededA) continue;
    let countB = 0;
    for (const i of idxB) if ((mask >> i) & 1) countB++;
    if (countB !== neededB) continue;
    let edgesOk = true;
    for (const [i, j] of edges) {
      if ((mask >> i) & 1 && (mask >> j) & 1) {
        edgesOk = false;
        break;
      }
    }
    if (edgesOk) validMasks.push(mask);
  }

  if (validMasks.length === 0) return { ok: false };

  const forcedLit = [];
  const forcedDark = [];
  for (let i = 0; i < n; i++) {
    const allLit = validMasks.every((m) => (m >> i) & 1);
    const allDark = !allLit && validMasks.every((m) => !((m >> i) & 1));
    if (allLit) forcedLit.push(vars[i]);
    else if (allDark) forcedDark.push(vars[i]);
  }
  return { ok: true, forcedLit, forcedDark };
}

/**
 * Fait progresser toutes les déductions certaines jusqu'à point fixe.
 * Retourne `{ ok:false }` (déjà annulé en interne) en cas de contradiction,
 * ou `{ ok:true, litAdded, excludedAdded }` sinon — l'appelant doit annuler
 * `litAdded`/`excludedAdded` lui-même une fois le noeud terminé.
 */
function propagate(grid, excluded) {
  const litAdded = [];
  const excludedAdded = [];

  function undo() {
    for (let i = litAdded.length - 1; i >= 0; i--) {
      grid.toggleLight(litAdded[i][0], litAdded[i][1]);
    }
    for (const k of excludedAdded) excluded.delete(k);
  }

  function forceLit(r, c) {
    if (grid.hasLight(r, c)) return true;
    const placed = grid.toggleLight(r, c) === "placed";
    if (placed) litAdded.push([r, c]);
    return placed;
  }

  function forceExcluded(r, c) {
    const k = keyOf(r, c);
    if (!excluded.has(k)) {
      excluded.add(k);
      excludedAdded.push(k);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;

    // Stage 1: chaque indice/interdiction, isolément.
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cellAt(r, c);
        const isClue = cell.type === CellType.CLUE;
        const isForbidden = cell.type === CellType.FORBIDDEN;
        if (!isClue && !isForbidden) continue;

        const number = isForbidden ? 0 : cell.number;
        const needed = number - litNeighborCount(grid, r, c);
        const free = freeUndecidedNeighbors(grid, r, c, excluded);

        if (needed < 0 || needed > free.length) {
          undo();
          return { ok: false };
        }
        if (needed === 0 && free.length > 0) {
          for (const [fr, fc] of free) forceExcluded(fr, fc);
          changed = true;
        } else if (needed > 0 && needed === free.length) {
          for (const [fr, fc] of free) {
            if (!forceLit(fr, fc)) {
              undo();
              return { ok: false };
            }
          }
          changed = true;
        }
      }
    }
    if (changed) continue; // relance stage 1 avant de tenter stage 2

    // Stage 2: paires d'indices dont certaines cases libres s'excluent mutuellement.
    const clues = [];
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cellAt(r, c);
        if (cell.type === CellType.CLUE) clues.push([r, c, cell.number]);
      }
    }
    outer: for (let i = 0; i < clues.length; i++) {
      for (let j = i + 1; j < clues.length; j++) {
        const result = pairDeductions(grid, clues[i], clues[j], excluded);
        if (!result) continue;
        if (!result.ok) {
          undo();
          return { ok: false };
        }
        for (const [fr, fc] of result.forcedLit) {
          if (!forceLit(fr, fc)) {
            undo();
            return { ok: false };
          }
          changed = true;
        }
        for (const [fr, fc] of result.forcedDark) {
          forceExcluded(fr, fc);
          changed = true;
        }
        if (changed) break outer; // repart de stage 1 avec les nouvelles infos
      }
    }
  }

  return { ok: true, litAdded, excludedAdded };
}

function binom(n, k) {
  if (k < 0 || k > n) return Infinity;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/**
 * Choisit la prochaine case sur laquelle brancher: celle qui appartient à
 * l'indice le plus "serré" (le moins de combinaisons possibles restantes,
 * ex: choisir entre 2 plutôt qu'entre 3) plutôt que la première case
 * trouvée. Sans indice encore actif à proximité (zone complètement
 * ouverte), on retombe sur la première case non décidée.
 */
function pickBranchCell(grid, undecided, excluded) {
  let bestCell = null;
  let bestScore = Infinity;
  let bestFreeLen = Infinity;

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cellAt(r, c);
      if (cell.type !== CellType.CLUE) continue;
      const needed = cell.number - litNeighborCount(grid, r, c);
      if (needed <= 0) continue;
      const free = freeUndecidedNeighbors(grid, r, c, excluded);
      if (free.length === 0) continue;
      const score = binom(free.length, needed);
      if (score < bestScore || (score === bestScore && free.length < bestFreeLen)) {
        bestScore = score;
        bestFreeLen = free.length;
        bestCell = free[0];
      }
    }
  }

  return bestCell || undecided[0];
}

/**
 * Retourne le nombre de solutions valides, plafonné à `cap` (par défaut 2 :
 * juste assez pour distinguer "aucune", "unique" et "plusieurs").
 *
 * `maxNodes` limite l'exploration pour éviter un blocage sur une grille peu
 * contrainte : au-delà, on renvoie `{ count, exhausted: false }` (résultat
 * partiel, non concluant) plutôt que de tourner indéfiniment.
 */
export function countSolutions(level, cap = 2, maxNodes = 2_000_000, options = {}) {
  const grid = new LightUpGrid(level);
  const excluded = new Set();
  let count = 0;
  let nodes = 0;

  function search() {
    if (count >= cap) return;
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded);
    if (!prop.ok) return;

    const undecided = getUndecided(grid, excluded);

    if (undecided.length === 0) {
      if (grid.isWon(options)) count++;
    } else {
      const [r, c] = pickBranchCell(grid, undecided, excluded);
      const key = keyOf(r, c);

      excluded.add(key);
      search();
      excluded.delete(key);

      if (count < cap) {
        const result = grid.toggleLight(r, c);
        if (result === "placed") {
          if (!anyClueError(grid)) search();
          grid.toggleLight(r, c);
        }
      }
    }

    for (let i = prop.litAdded.length - 1; i >= 0; i--) {
      grid.toggleLight(prop.litAdded[i][0], prop.litAdded[i][1]);
    }
    for (const k of prop.excludedAdded) excluded.delete(k);
  }

  try {
    search();
    return { count, exhausted: true };
  } catch (e) {
    if (e instanceof NodeBudgetExceeded) return { count, exhausted: false };
    throw e;
  }
}

/**
 * Retourne jusqu'à `cap` solutions distinctes (chacune une liste de
 * coordonnées de lumières), utile pour comparer deux solutions et trouver
 * les cases où elles diffèrent (voir scripts/diff-solutions.mjs).
 */
export function enumerateSolutions(level, cap = 5, maxNodes = 3_000_000, options = {}) {
  const grid = new LightUpGrid(level);
  const excluded = new Set();
  const found = [];
  let nodes = 0;

  function currentLights() {
    return Array.from(grid.lights).map((k) => k.split(",").map(Number));
  }

  function search() {
    if (found.length >= cap) return;
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded);
    if (!prop.ok) return;

    const undecided = getUndecided(grid, excluded);

    if (undecided.length === 0) {
      if (grid.isWon(options)) found.push(currentLights());
    } else {
      const [r, c] = pickBranchCell(grid, undecided, excluded);
      const key = keyOf(r, c);

      excluded.add(key);
      search();
      excluded.delete(key);

      if (found.length < cap) {
        const result = grid.toggleLight(r, c);
        if (result === "placed") {
          if (!anyClueError(grid)) search();
          grid.toggleLight(r, c);
        }
      }
    }

    for (let i = prop.litAdded.length - 1; i >= 0; i--) {
      grid.toggleLight(prop.litAdded[i][0], prop.litAdded[i][1]);
    }
    for (const k of prop.excludedAdded) excluded.delete(k);
  }

  try {
    search();
    return { solutions: found, exhausted: true };
  } catch (e) {
    if (e instanceof NodeBudgetExceeded) return { solutions: found, exhausted: false };
    throw e;
  }
}

/** Trouve une solution (liste de coordonnées) si elle existe, sinon null. */
export function findSolution(level, maxNodes = 2_000_000) {
  const grid = new LightUpGrid(level);
  const excluded = new Set();
  let nodes = 0;
  let solution = null;

  function currentLights() {
    return Array.from(grid.lights).map((k) => k.split(",").map(Number));
  }

  function search() {
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded);
    let found = false;

    if (prop.ok) {
      const undecided = getUndecided(grid, excluded);

      if (undecided.length === 0) {
        if (grid.isWon()) {
          solution = currentLights();
          found = true;
        }
      } else {
        const [r, c] = pickBranchCell(grid, undecided, excluded);
        const key = keyOf(r, c);

        excluded.add(key);
        found = search();
        excluded.delete(key);

        if (!found) {
          const result = grid.toggleLight(r, c);
          if (result === "placed") {
            if (!anyClueError(grid)) found = search();
            if (!found) grid.toggleLight(r, c);
          }
        }
      }

      if (!found) {
        for (let i = prop.litAdded.length - 1; i >= 0; i--) {
          grid.toggleLight(prop.litAdded[i][0], prop.litAdded[i][1]);
        }
        for (const k of prop.excludedAdded) excluded.delete(k);
      }
    }

    return found;
  }

  try {
    const solved = search();
    return solved ? solution : null;
  } catch (e) {
    if (e instanceof NodeBudgetExceeded) return null;
    throw e;
  }
}
