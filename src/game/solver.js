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
//
// Neurone miroir [expérimental] et solidité des déductions: `excluded`
// représente une HYPOTHÈSE DE BRANCHEMENT ("on essaie sans lumière ici"),
// PAS une certitude absolue — pour la plupart des cases c'est équivalent,
// mais pas pour une case qui se trouve sur la ligne/colonne d'un neurone
// miroir: elle peut très bien s'allumer plus tard MALGRÉ cette hypothèse,
// via un duplicata automatique déclenché par une lumière posée ailleurs
// (voir grid.js: `_computeMirrorDuplicates`, qui ignore la ligne de vue).
// Les déductions stage 1/2 qui s'appuient sur "cette case exclue restera
// forcément noire" pour en déduire que D'AUTRES cases libres du même
// indice doivent forcément être allumées (ou que le compte est
// impossible) seraient donc INCORRECTES pour un indice dont au moins un
// voisin exclu est sur la ligne/colonne d'un neurone miroir — voir
// `computeMirrorReachable` et son usage (paramètre `mirrorReachable`) dans
// `propagate`/`pairDeductions`. La direction inverse (compte déjà atteint
// ⇒ exclure les cases libres restantes) reste sûre dans tous les cas: si
// l'une d'elles s'allume quand même plus tard via un duplicata, la
// prochaine passe de `propagate` le détecte immédiatement (adjacentLights
// recalculé sur l'état réel de la grille) et remonte la contradiction.

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

/**
 * Vrai si (r,c) a au moins un voisin EMPTY non allumé, EXCLU par le
 * backtracking (hypothèse "pas de lumière ici"), ET atteignable par un
 * neurone miroir [expérimental] (`mirrorReachable`) — dans ce cas cette
 * exclusion n'est pas une certitude (voir commentaire en tête de fichier),
 * donc aucune déduction ne doit s'appuyer sur "ce voisin restera noir".
 */
function hasRiskyExcludedNeighbor(grid, r, c, excluded, mirrorReachable) {
  if (!mirrorReachable || mirrorReachable.size === 0) return false;
  for (const [dr, dc] of DIRECTIONS) {
    const nr = r + dr;
    const nc = c + dc;
    const cell = grid.cellAt(nr, nc);
    if (!cell || cell.type !== CellType.EMPTY) continue;
    if (grid.hasLight(nr, nc)) continue;
    const k = keyOf(nr, nc);
    if (excluded.has(k) && mirrorReachable.has(k)) return true;
  }
  return false;
}

/**
 * Cases EMPTY "atteignables" par au moins un neurone miroir [expérimental]:
 * situées sur la même ligne OU colonne qu'une case MIRROR_NEURON — donc
 * susceptibles de recevoir une lumière via duplicata automatique, MÊME si
 * le backtracking les a provisoirement "exclues" (voir commentaire en tête
 * de fichier). Calculé une seule fois par résolution (la géométrie de la
 * grille ne change pas), passé ensuite à `propagate`/`pairDeductions`.
 */
function computeMirrorReachable(grid) {
  const reachable = new Set();
  const neuronRows = new Set();
  const neuronCols = new Set();
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.cellAt(r, c).type === CellType.MIRROR_NEURON) {
        neuronRows.add(r);
        neuronCols.add(c);
      }
    }
  }
  if (neuronRows.size === 0 && neuronCols.size === 0) return reachable;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.cellAt(r, c).type !== CellType.EMPTY) continue;
      if (neuronRows.has(r) || neuronCols.has(c)) reachable.add(keyOf(r, c));
    }
  }
  return reachable;
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
function pairDeductions(grid, clueA, clueB, excluded, mirrorReachable) {
  const [ar, ac, aNumber] = clueA;
  const [br, bc, bNumber] = clueB;

  const neededA = aNumber - litNeighborCount(grid, ar, ac);
  const neededB = bNumber - litNeighborCount(grid, br, bc);
  const freeA = freeUndecidedNeighbors(grid, ar, ac, excluded);
  const freeB = freeUndecidedNeighbors(grid, br, bc, excluded);
  if (freeA.length === 0 || freeB.length === 0) return null;
  if (neededA < 0 || neededB < 0) return { ok: false };

  // Voir le commentaire en tête de fichier: si l'un des deux indices a un
  // voisin exclu par hypothèse de branchement mais atteignable par un
  // neurone miroir, on ne peut se fier ni à `freeA.length`/`freeB.length`
  // (une case "exclue" peut encore s'allumer plus tard), ni donc à aucune
  // déduction qui en dépend — on s'abstient plutôt que de risquer une
  // fausse certitude.
  if (hasRiskyExcludedNeighbor(grid, ar, ac, excluded, mirrorReachable)) return null;
  if (hasRiskyExcludedNeighbor(grid, br, bc, excluded, mirrorReachable)) return null;

  if (neededA > freeA.length || neededB > freeB.length) {
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
function propagate(grid, excluded, mirrorReachable, stats) {
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

        if (needed < 0) {
          undo();
          return { ok: false };
        }
        // Voir le commentaire en tête de fichier: un voisin exclu mais
        // atteignable par un neurone miroir peut encore s'allumer plus
        // tard — ni la contradiction "besoin > cases libres" ni la
        // déduction "besoin === cases libres ⇒ toutes allumées" ne sont
        // fiables dans ce cas, on s'abstient des deux pour cet indice. La
        // direction inverse (besoin déjà comblé ⇒ exclure le reste) reste
        // sûre dans tous les cas (auto-corrigée à la prochaine passe si un
        // duplicata prouve le contraire), donc jamais gardée.
        if (needed === 0 && free.length > 0) {
          for (const [fr, fc] of free) forceExcluded(fr, fc);
          changed = true;
          continue;
        }
        if (hasRiskyExcludedNeighbor(grid, r, c, excluded, mirrorReachable)) continue;
        if (needed > free.length) {
          undo();
          return { ok: false };
        }
        if (needed > 0 && needed === free.length) {
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
        const result = pairDeductions(grid, clues[i], clues[j], excluded, mirrorReachable);
        if (!result) continue;
        if (!result.ok) {
          undo();
          return { ok: false };
        }
        if (stats && (result.forcedLit.length > 0 || result.forcedDark.length > 0)) {
          // Voir analyzeSolve(): une déduction Stage 2 a été NÉCESSAIRE pour
          // avancer ici (Stage 1 seul ne suffisait plus) — signal utilisé
          // pour noter la difficulté réelle du niveau, indépendant de la
          // recherche de solution elle-même (stats est toujours `undefined`
          // pour countSolutions/enumerateSolutions/findSolution).
          stats.stage2Used = true;
          stats.stage2Count++;
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
  const mirrorReachable = computeMirrorReachable(grid);
  let count = 0;
  let nodes = 0;

  function search() {
    if (count >= cap) return;
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded, mirrorReachable);
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
  const mirrorReachable = computeMirrorReachable(grid);
  const found = [];
  let nodes = 0;

  // Exclut les duplicatas de neurone miroir [expérimental]: ils
  // apparaissent automatiquement dès qu'on pose leur origine (voir
  // grid.js: toggleLight), une solution ne doit donc lister que les coups
  // réellement joués par le joueur — cohérent avec getPlacedLightCount().
  function currentLights() {
    return grid.getPlacedLights();
  }

  function search() {
    if (found.length >= cap) return;
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded, mirrorReachable);
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
  const mirrorReachable = computeMirrorReachable(grid);
  let nodes = 0;
  let solution = null;

  // Exclut les duplicatas de neurone miroir [expérimental]: ils
  // apparaissent automatiquement dès qu'on pose leur origine (voir
  // grid.js: toggleLight), une solution ne doit donc lister que les coups
  // réellement joués par le joueur — cohérent avec getPlacedLightCount().
  function currentLights() {
    return grid.getPlacedLights();
  }

  function search() {
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded, mirrorReachable);
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

/**
 * Comme `findSolution`, mais mesure AUSSI quelles techniques de résolution
 * ont été nécessaires — utilisé par le mode Infini (voir docs/
 * infinite-mode-design.md, section 6) pour noter la difficulté RÉELLE d'un
 * niveau généré plutôt que de deviner à partir de sa taille/densité, même
 * principe que les notations de difficulté Sudoku ("quelle est la technique
 * la plus avancée nécessaire, pas juste combien de chiffres manquent").
 *
 * Duplique volontairement la recherche de `findSolution` plutôt que de la
 * réutiliser: `propagate`/`search` sont déjà minces, et éviter de complexifier
 * les trois fonctions déjà en prod (countSolutions/enumerateSolutions/
 * findSolution) avec un paramètre `stats` qu'elles n'utilisent jamais réduit
 * le risque de régression. Une fusion des quatre en un seul coeur de
 * recherche partagé reste une amélioration future raisonnable (voir le doc),
 * pas nécessaire pour une première version.
 *
 * Retourne `null` si aucune solution n'est trouvée dans `maxNodes`, sinon
 * `{ solution, moves, stage2Used, stage2Count, branchCount, tier }`:
 * - `stage2Used` / `stage2Count`: au moins une déduction Stage 2 (paire
 *   d'indices) a servi, et combien de fois. C'est le signal de "lieu de
 *   doute" : une case où la logique indice-par-indice (Stage 1) ne suffit
 *   plus et où il faut croiser deux indices pour trancher.
 * - `branchCount`: nombre de fois où propagate seul n'a pas suffi et où il a
 *   fallu émettre une hypothèse de branchement (compté sur tout l'arbre de
 *   recherche exploré, pas seulement le chemin gagnant — un niveau mal
 *   contraint qui force beaucoup de tâtonnement, même sur des impasses,
 *   n'est pas un niveau "évident").
 * - `tier`: la taille de grille seule ne fait PAS la difficulté — un grand
 *   plateau avec une zone ouverte non couverte par des indices peut avoir un
 *   `branchCount` élevé sans jamais nécessiter de déduction Stage 2 (aucun
 *   "lieu de doute", juste du tâtonnement dans du vide). Le tier reflète donc
 *   d'abord `stage2Used` :
 *     - tier 1 : jamais de Stage 2, et peu de branchement (`branchCount<=25`).
 *     - tier 2 : soit du branchement sans Stage 2 (grille ouverte mais pas
 *       vraiment "piégeuse"), soit du Stage 2 avec branchement modéré
 *       (`<=250`).
 *     - tier 3 : Stage 2 nécessaire ET branchement important (`>250`) — la
 *       résolution demande de repérer des lieux de doute ET de creuser
 *       dedans, pas juste un enchaînement de déductions lisibles.
 *   Seuils calibrés empiriquement sur des plateaux 5x5 à 9x9 (voir
 *   docs/infinite-mode-design.md, section 10) — pas des lois figées, à
 *   réajuster à l'usage.
 */
export function analyzeSolve(level, maxNodes = 2_000_000) {
  const grid = new LightUpGrid(level);
  const excluded = new Set();
  const mirrorReachable = computeMirrorReachable(grid);
  const stats = { stage2Used: false, stage2Count: 0, branchCount: 0 };
  let nodes = 0;
  let solution = null;

  function currentLights() {
    return grid.getPlacedLights();
  }

  function search() {
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded, mirrorReachable, stats);
    let found = false;

    if (prop.ok) {
      const undecided = getUndecided(grid, excluded);

      if (undecided.length === 0) {
        if (grid.isWon()) {
          solution = currentLights();
          found = true;
        }
      } else {
        stats.branchCount++;
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

  let solved;
  try {
    solved = search();
  } catch (e) {
    if (e instanceof NodeBudgetExceeded) return null;
    throw e;
  }
  if (!solved) return null;

  // Le tier 2 et le tier 3 exigent tous les deux qu'au moins une déduction
  // Stage 2 (paire d'indices) ait été NÉCESSAIRE pendant la résolution — pas
  // seulement une grille de grande taille. Un niveau qui se résout entièrement
  // par Stage 1 (chaîne de déductions "évidentes", case par case) reste tier 1
  // même s'il génère un branchCount élevé (grande zone non couverte par des
  // indices, mais sans "lieu de doute" réel : aucune paire d'indices n'a dû
  // être croisée pour progresser). Voir docs/infinite-mode-design.md §10.
  const tier = !stats.stage2Used
    ? (stats.branchCount <= 25 ? 1 : 2)
    : (stats.branchCount <= 250 ? 2 : 3);
  return {
    solution,
    moves: solution.length,
    stage2Used: stats.stage2Used,
    stage2Count: stats.stage2Count,
    branchCount: stats.branchCount,
    tier,
  };
}

/**
 * Fusion de `countSolutions` et `analyzeSolve` en UNE seule recherche —
 * ajoutée pour le mode Infini (generator.js), qui pour chaque candidat
 * accepté payait deux arbres de recherche complets sur le même plateau :
 * un pour prouver l'unicité, un second (relancé de zéro) juste pour
 * mesurer la difficulté. Sur les plateaux 3★ (peu denses, arbre large),
 * c'était la moitié du temps de génération perdue en travail redondant.
 *
 * Le tour de passe-passe qui rend ça sûr : `stage2Used`/`stage2Count`/
 * `branchCount` ne doivent refléter QUE le chemin nécessaire pour *trouver*
 * une solution (pas l'exploration supplémentaire nécessaire pour *prouver*
 * qu'il n'y en a pas d'autre) — sinon les seuils de tier calibrés contre
 * l'ancien `analyzeSolve` (qui s'arrêtait à la première solution trouvée)
 * ne voudraient plus rien dire. Cette recherche explore exactement dans le
 * même ordre que `countSolutions`/`findSolution` (branche "exclue" toujours
 * tentée avant "posée", même heuristique de branchement) — donc la séquence
 * de noeuds visités jusqu'à la PREMIÈRE solution trouvée est rigoureusement
 * identique à ce que ferait `analyzeSolve` seul. On "gèle" donc les stats
 * dès cette première solution (on arrête de les incrémenter, sans arrêter
 * la recherche elle-même) : tout ce qui est visité ENSUITE pour vérifier
 * l'absence d'une 2e solution ne pollue plus les stats — le résultat est
 * numériquement identique à l'ancien `countSolutions(...)` +
 * `analyzeSolve(...)` séparés, pour un seul arbre parcouru au lieu de deux.
 *
 * Retourne `{ count, exhausted, solution, moves, stage2Used, stage2Count,
 * branchCount, tier }` — `solution`/`stage2*`/`branchCount`/`tier` valent
 * `null` si aucune solution n'a été trouvée du tout (mêmes conditions que
 * `countSolutions`/`analyzeSolve` pris séparément).
 */
export function analyzeAndCount(level, cap = 2, maxNodes = 2_000_000, options = {}) {
  const grid = new LightUpGrid(level);
  const excluded = new Set();
  const mirrorReachable = computeMirrorReachable(grid);
  const stats = { stage2Used: false, stage2Count: 0, branchCount: 0 };
  let frozen = false; // true dès qu'une 1re solution a été trouvée: stats figées
  let firstSolution = null;
  let count = 0;
  let nodes = 0;

  function currentLights() {
    return grid.getPlacedLights();
  }

  function search() {
    if (count >= cap) return;
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded, mirrorReachable, frozen ? undefined : stats);
    if (!prop.ok) return;

    const undecided = getUndecided(grid, excluded);

    if (undecided.length === 0) {
      if (grid.isWon(options)) {
        count++;
        if (!frozen) {
          firstSolution = currentLights();
          frozen = true;
        }
      }
    } else {
      if (!frozen) stats.branchCount++;
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

  let exhausted;
  try {
    search();
    exhausted = true;
  } catch (e) {
    if (e instanceof NodeBudgetExceeded) exhausted = false;
    else throw e;
  }

  const tier = firstSolution
    ? !stats.stage2Used
      ? stats.branchCount <= 25
        ? 1
        : 2
      : stats.branchCount <= 250
        ? 2
        : 3
    : null;

  return {
    count,
    exhausted,
    solution: firstSolution,
    moves: firstSolution ? firstSolution.length : null,
    stage2Used: firstSolution ? stats.stage2Used : null,
    stage2Count: firstSolution ? stats.stage2Count : null,
    branchCount: firstSolution ? stats.branchCount : null,
    tier,
  };
}
