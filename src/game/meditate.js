// Mode "Meditate" — retour utilisateur: mini-jeu de révélation façon
// "Touché-coulé" qui remplace l'ancien déblocage automatique par seuil
// d'Énergie des bannières Comète/Supernova (voir dailyChallenge.js:
// STAR_BADGE_DEFS/getStarBadges/debugUnlockStarBadges, RETIRÉS — round
// suivant). Désormais, la prochaine bannière à débloquer est toujours
// affichée (masquée) et se débloque en fouillant une grille avec de
// l'Énergie plutôt qu'en atteignant un simple seuil de solde.
import { loadMeditateState, saveMeditateState, spendStars } from "./storage.js";

/** Définitions figées des formes par bannière (retour utilisateur: "Les
 * découpes ne seront jamais aléatoires, on va les définir pour chaque
 * preview à découper. Mais leur positionnement ensuite dans la grille à
 * creuser sera aléatoire"). `division`: la preview de la bannière est
 * calée sur une grille division×division (même damier utilisé pour
 * l'affichage EN HAUT de l'écran, voir main.js: renderMeditatePreview) —
 * les coordonnées `cells` ci-dessous sont relatives à CETTE grille, jamais
 * à la grille de recherche (plus grande, voir searchSizeForDivision).
 * Chaque forme n'est JAMAIS pivotée/retournée au moment du placement (voir
 * placeShapes) — seul son ancrage varie d'une partie à l'autre.
 *
 * Nébuleuse (tier 6, division 2x2, retour utilisateur: "une troisième
 * bannière débloquable avec des éclairs, la première déblocable dans
 * Meditate" — volontairement plus simple que Comète/Supernova ci-dessous,
 * en guise d'introduction au mini-jeu): un tromino en L (3 cases) et une
 * case seule — vérifié pour couvrir exactement les 4 cases une seule fois
 * chacune (3+1=4). Pas de rétrocompatibilité nécessaire (retour
 * utilisateur: "c'est que du test y a pas de vrai joueur") — Comète/
 * Supernova simplement renumérotées 7/8 ci-dessous.
 *
 * Comète (tier 7, division 3x3, exemple donné par le retour utilisateur):
 * un T, une barre horizontale (2 cases), une barre verticale (2 cases) et
 * un carré seul — vérifié pour couvrir exactement les 9 cases une seule
 * fois chacune (4+2+2+1=9).
 *
 * Supernova (tier 8, division 4x4, découpage propre — pas donné par le
 * retour utilisateur, dessiné ici en suivant le même principe): un carré
 * 2x2, une barre verticale de 4 cases, un T, une barre verticale de 2
 * cases, et deux cases seules — vérifié pour couvrir exactement les 16
 * cases une seule fois chacune (4+4+4+2+1+1=16). */
export const MEDITATE_BADGE_DEFS = [
  {
    tier: 6,
    name: "Nébuleuse",
    division: 2,
    shapes: [
      { id: "l", cells: [[0, 0], [0, 1], [1, 1]] }, // tromino en L
      { id: "solo", cells: [[1, 0]] }, // case seule
    ],
  },
  {
    tier: 7,
    name: "Comète",
    division: 3,
    shapes: [
      { id: "t", cells: [[0, 0], [0, 1], [0, 2], [1, 1]] }, // T
      { id: "carre", cells: [[1, 0]] }, // carré seul
      { id: "verticale", cells: [[1, 2], [2, 2]] }, // barre verticale (2 cases)
      { id: "horizontale", cells: [[2, 0], [2, 1]] }, // barre horizontale (2 cases)
    ],
  },
  {
    tier: 8,
    name: "Supernova",
    division: 4,
    shapes: [
      { id: "carre", cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
      { id: "i", cells: [[0, 3], [1, 3], [2, 3], [3, 3]] },
      { id: "t", cells: [[2, 0], [2, 1], [2, 2], [3, 1]] },
      { id: "verticale", cells: [[0, 2], [1, 2]] },
      { id: "solo1", cells: [[3, 0]] },
      { id: "solo2", cells: [[3, 2]] },
    ],
  },
];

/** Taille de la grille de recherche pour une "division" donnée — formule
 * donnée par le retour utilisateur: 2×division-1 (3->5, 4->7, 5->9...). */
function searchSizeForDivision(division) {
  return division * 2 - 1;
}

function cellIndex(size, row, col) {
  return row * size + col;
}

/** Place TOUTES les formes d'une définition sur une grille size×size, à des
 * ancrages aléatoires SANS chevauchement (retry-until-fits) — jamais de
 * rotation/retournement des formes (voir MEDITATE_BADGE_DEFS ci-dessus).
 * Retourne une Map<cellIndex, shapeId>. La grille de recherche étant
 * toujours largement plus grande que la surface totale des formes (voir
 * searchSizeForDivision), l'échec total (retour d'une Map vide) n'arrive
 * normalement jamais — gardé comme filet de sécurité plutôt que de risquer
 * une boucle infinie. */
function placeShapes(def, size) {
  const maxAttempts = 300;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const occupied = new Map();
    let ok = true;
    for (const shape of def.shapes) {
      const rows = shape.cells.map((c) => c[0]);
      const cols = shape.cells.map((c) => c[1]);
      // BUG corrigé (retour utilisateur: "j'ai l'impression qu'à chaque
      // fois dans la grille les pièces sont toutes adjacentes [...] leur
      // placement doit être complètement aléatoire, la seule retenue c'est
      // qu'elles puissent toutes rentrer à l'intérieur") — `shape.cells`
      // (MEDITATE_BADGE_DEFS) contient des coordonnées ABSOLUES dans la
      // grille de preview division×division (nécessaire pour l'affichage,
      // voir main.js: renderMeditatePreview), PAS des coordonnées déjà
      // normalisées à l'origine (0,0) de la forme. Sans ce `minRow`/
      // `minCol` (soustraits ci-dessous), une forme comme "verticale"
      // ([[1,2],[2,2]] dans Comète) se voyait attribuer une boîte
      // englobante 3×3 au lieu de 2×1 réels — réduisant à tort la plage
      // d'ancrage ET conservant son décalage D'ORIGINE dans le preview une
      // fois "replacée" dans la grille de recherche (anchorRow + r avec r
      // non ramené à 0), au lieu d'un vrai placement libre sur TOUTE la
      // grille. Plusieurs formes se retrouvaient ainsi systématiquement
      // décalées vers la même zone (bas/droite selon leur position
      // d'origine dans le preview) à chaque partie, jamais réparties
      // uniformément.
      const minRow = Math.min(...rows);
      const minCol = Math.min(...cols);
      const shapeH = Math.max(...rows) - minRow + 1;
      const shapeW = Math.max(...cols) - minCol + 1;
      const maxRow = size - shapeH;
      const maxCol = size - shapeW;
      if (maxRow < 0 || maxCol < 0) {
        ok = false;
        break;
      }
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const anchorRow = Math.floor(Math.random() * (maxRow + 1));
        const anchorCol = Math.floor(Math.random() * (maxCol + 1));
        // r - minRow / c - minCol: ramène chaque cellule à un décalage
        // RELATIF à la forme (0-based) avant d'appliquer l'ancrage — la
        // forme garde exactement la même géométrie interne, mais peut
        // désormais être ancrée n'importe où dans la grille, pas seulement
        // près de sa position d'origine dans le preview.
        const targetCells = shape.cells.map(([r, c]) => cellIndex(size, anchorRow + (r - minRow), anchorCol + (c - minCol)));
        if (targetCells.every((idx) => !occupied.has(idx))) {
          // Retient, en plus de l'identifiant de forme, la case D'ORIGINE
          // dans la grille de preview division×division (shape.cells[i]
          // lui-même) — nécessaire pour reconstruire le BON fragment
          // d'image au moment de la révélation (voir main.js:
          // renderMeditateSearchGrid), puisque plusieurs cases de recherche
          // partagent le même shapeId mais pas la même origine.
          shape.cells.forEach(([r, c], i) => {
            occupied.set(targetCells[i], { shapeId: shape.id, originRow: r, originCol: c });
          });
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return occupied;
  }
  return new Map();
}

/** Construit une nouvelle grille de recherche pour la bannière `def` —
 * chaque case porte soit `shapeId: null` (rien à trouver ici), soit
 * l'identifiant de la forme à laquelle elle appartient PLUS ses coordonnées
 * d'origine (`originRow`/`originCol`) dans la grille de preview
 * division×division, ce qui permet à main.js de reconstruire directement
 * le bon fragment d'image au moment d'afficher une case révélée (voir
 * renderMeditateSearchGrid). */
function generateGrid(def) {
  const size = searchSizeForDivision(def.division);
  const occupied = placeShapes(def, size);
  const cells = [];
  for (let i = 0; i < size * size; i++) {
    const entry = occupied.get(i);
    cells.push({
      shapeId: entry ? entry.shapeId : null,
      originRow: entry ? entry.originRow : null,
      originCol: entry ? entry.originCol : null,
      revealed: false,
    });
  }
  return { tier: def.tier, size, cells };
}

/** État courant, relu depuis storage.js à chaque appel (jamais mis en
 * cache en mémoire ici) — même principe que dailyChallenge.js: readState().
 * Forme par défaut si rien n'est encore stocké: on commence à la première
 * bannière (index 0 de MEDITATE_BADGE_DEFS), aucune grille générée, aucune
 * bannière débloquée par ce système. */
function readState() {
  const raw = loadMeditateState();
  if (raw && typeof raw.bannerIndex === "number" && Array.isArray(raw.unlockedTiers)) return raw;
  return { bannerIndex: 0, grid: null, unlockedTiers: [] };
}

export function getCurrentDef() {
  const state = readState();
  if (state.bannerIndex >= MEDITATE_BADGE_DEFS.length) return null;
  return MEDITATE_BADGE_DEFS[state.bannerIndex];
}

export function isAllUnlocked() {
  return readState().bannerIndex >= MEDITATE_BADGE_DEFS.length;
}

/** Prépare (et persiste) une grille pour la bannière EN COURS si elle
 * n'existe pas déjà — à appeler à chaque entrée sur l'écran (voir main.js:
 * showView) pour ne jamais régénérer une grille déjà en cours de fouille,
 * ni en garder une périmée (bannière déjà débloquée entre-temps). Retourne
 * `null` si tout le contenu de Meditate est déjà débloqué. */
export function ensureCurrentGrid() {
  const state = readState();
  if (state.bannerIndex >= MEDITATE_BADGE_DEFS.length) return null;
  const def = MEDITATE_BADGE_DEFS[state.bannerIndex];
  if (!state.grid || state.grid.tier !== def.tier) {
    state.grid = generateGrid(def);
    saveMeditateState(state);
  }
  return state.grid;
}

/** Une forme est "trouvée" quand TOUTES ses cases (retrouvées via
 * grid.cells, jamais mises en cache séparément) sont révélées — peu
 * importe l'ordre de découverte. */
function shapeRevealState(def, grid) {
  const result = {};
  for (const shape of def.shapes) {
    const cellIdxs = [];
    grid.cells.forEach((cell, idx) => {
      if (cell.shapeId === shape.id) cellIdxs.push(idx);
    });
    result[shape.id] = cellIdxs.length > 0 && cellIdxs.every((idx) => grid.cells[idx].revealed);
  }
  return result;
}

/** `{shapeId: bool}` pour la bannière/grille en cours — voir main.js:
 * renderMeditatePreview (pour "activer" une forme entièrement trouvée sur
 * la preview du haut, retour utilisateur: "lorsque le joueur a découvert
 * entièrement une forme, elle se 'enable' sur la preview en haut"). */
export function getShapeRevealState() {
  const def = getCurrentDef();
  const state = readState();
  if (!def || !state.grid) return {};
  return shapeRevealState(def, state.grid);
}

/** Révèle une case de la grille de recherche en dépensant 1 Énergie (retour
 * utilisateur: "ça découvre la case [...] en payant un Éclair") — même coût
 * que la case contienne un fragment ou non, jamais de remboursement.
 * Retourne un rapport détaillé pour que main.js sache quoi animer/afficher
 * (fragment révélé, forme complétée, bannière débloquée, tout débloqué). */
export function revealCell(index) {
  const state = readState();
  const def = getCurrentDef();
  if (!def || !state.grid) return { ok: false, reason: "no-grid" };
  const cell = state.grid.cells[index];
  if (!cell || cell.revealed) return { ok: false, reason: "already-revealed" };
  if (!spendStars(1)) return { ok: false, reason: "not-enough-energy" };

  cell.revealed = true;

  const revealState = shapeRevealState(def, state.grid);
  const shapeCompleted = cell.shapeId != null && revealState[cell.shapeId] === true;
  const puzzleCompleted = def.shapes.every((shape) => revealState[shape.id]);

  let bannerUnlocked = false;
  let allDone = false;
  if (puzzleCompleted) {
    bannerUnlocked = true;
    state.unlockedTiers = Array.from(new Set([...state.unlockedTiers, def.tier]));
    state.bannerIndex += 1;
    state.grid = null; // reconstruite au prochain ensureCurrentGrid() (bannière suivante, ou plus rien si allDone)
    allDone = state.bannerIndex >= MEDITATE_BADGE_DEFS.length;
  }

  saveMeditateState(state);

  return {
    ok: true,
    shapeId: cell.shapeId,
    shapeCompleted,
    puzzleCompleted,
    bannerUnlocked,
    unlockedTier: bannerUnlocked ? def.tier : null,
    unlockedName: bannerUnlocked ? def.name : null,
    allDone,
  };
}

/** Même forme que l'ancien getStarBadges() (dailyChallenge.js, retiré) —
 * `{name, earned, tier}[]` — pour que main.js:refreshProfileBadges()
 * continue à fusionner ce lot avec getSommationBadges() sans traitement
 * spécial. */
export function getMeditateBadges() {
  const state = readState();
  const unlocked = new Set(state.unlockedTiers);
  return MEDITATE_BADGE_DEFS.map((def) => ({ name: def.name, earned: unlocked.has(def.tier), tier: def.tier }));
}

/** Débogage: débloque instantanément toutes les bannières Meditate — même
 * bouton que debugUnlockPixelArt/l'ancien debugUnlockStarBadges (voir
 * main.js). Fait avancer l'état RÉEL (bannerIndex + unlockedTiers) plutôt
 * que de simuler un affichage à part, donc rien à désynchroniser ailleurs. */
export function debugUnlockMeditateBadges() {
  saveMeditateState({
    bannerIndex: MEDITATE_BADGE_DEFS.length,
    grid: null,
    unlockedTiers: MEDITATE_BADGE_DEFS.map((def) => def.tier),
  });
}
