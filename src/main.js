import { LightUpGrid } from "./game/grid.js";
import { levels } from "./game/levels.js";
import {
  playPlace,
  playRemove,
  playError,
  playWin,
  playTargetSuccess,
  playTargetLost,
  playSynapseBreak,
  playSynapseRestore,
  playChargeFull,
  playChargeEmptied,
  playChargeOverload,
  setMasterVolume,
} from "./game/sound.js";
import { createBoardRenderer } from "./game/render.js";
import { initEditor } from "./editor.js";
import { findSolution } from "./game/solver.js";

let currentLevelIndex = 0;
let grid = null;
// Historique des coups (poses/retraits de lumière) pour le bouton
// "Annuler": pas de limite tant qu'on n'a pas tout remonté, vidé à chaque
// chargement/réinitialisation de niveau.
let moveHistory = [];

// Repère "par" (nombre de lumières d'une solution valide) utilisé comme
// seuil de notation par défaut quand un niveau ne fournit pas explicitement
// `starThresholds`. Calculé à la demande (au moment de la victoire, pas au
// chargement du niveau: certains niveaux prennent jusqu'à ~1s à résoudre,
// pas la peine de ralentir la navigation entre niveaux pour ça) et mis en
// cache par index de niveau pour ne jamais le recalculer deux fois.
const parCache = new Map();

function computeStars(moves, levelIndex) {
  const level = levels[levelIndex];
  if (Array.isArray(level.starThresholds) && level.starThresholds.length === 2) {
    const [threeMax, twoMax] = level.starThresholds;
    if (moves <= threeMax) return 3;
    if (moves <= twoMax) return 2;
    return 1;
  }
  let par = parCache.get(levelIndex);
  if (par === undefined) {
    const solution = findSolution(level, 400_000);
    par = solution ? solution.length : null;
    parCache.set(levelIndex, par);
  }
  if (par == null) return null;
  if (moves <= par) return 3;
  if (moves <= Math.ceil(par * 1.5)) return 2;
  return 1;
}

const boardEl = document.getElementById("board");
const levelNameEl = document.getElementById("level-name");
const winOverlay = document.getElementById("win-overlay");
const winStarsEl = document.getElementById("win-stars");
const btnUndo = document.getElementById("btn-undo");
const moveCountEl = document.getElementById("move-count");
const renderer = createBoardRenderer(boardEl);

const sounds = {
  targetSuccess: playTargetSuccess,
  targetLost: playTargetLost,
  synapseBreak: playSynapseBreak,
  synapseRestore: playSynapseRestore,
  chargeFull: playChargeFull,
  chargeEmptied: playChargeEmptied,
  chargeOverload: playChargeOverload,
};

// Le compteur affiché (et l'entrée du système d'étoiles) doit baisser
// quand on retire une lumière, pas monter: l'objectif est de résoudre le
// puzzle avec le moins de lumières posées possible, pas juste d'y arriver
// du premier coup. On utilise donc le nombre de lumières ACTUELLEMENT sur
// la grille (grid.getPlacedLightCount()) plutôt que la longueur de
// l'historique — chaque pose l'augmente de 1, chaque retrait (y compris via
// Annuler, qui mute directement `lights`) le diminue de 1, sans variable à
// garder synchronisée à la main. `getPlacedLightCount()` exclut les
// duplicatas de neurone miroir [expérimental]: ils n'ont pas été posés par
// le joueur, ils ne comptent donc pas comme un coup. `moveHistory`, lui,
// reste un journal complet et inchangé: c'est uniquement lui qui permet à
// Annuler/Ctrl+Z de retrouver l'état précédent.
function syncMoveUi() {
  btnUndo.disabled = moveHistory.length === 0;
  const n = grid.getPlacedLightCount();
  moveCountEl.textContent = `${n} coup${n === 1 ? "" : "s"}`;
}

function renderStars(stars) {
  if (stars == null) {
    winStarsEl.textContent = "";
    return;
  }
  winStarsEl.innerHTML = [1, 2, 3]
    .map((i) => `<span class="win-star ${i <= stars ? "win-star--filled" : ""}">★</span>`)
    .join("");
}

function loadLevel(index) {
  currentLevelIndex = ((index % levels.length) + levels.length) % levels.length;
  const level = levels[currentLevelIndex];
  grid = new LightUpGrid(level);
  moveHistory = [];
  syncMoveUi();
  levelNameEl.textContent = `${currentLevelIndex + 1}. ${level.name}`;
  renderer.build(grid, { onCellClick: handleCellClick, sounds });
  winOverlay.classList.add("hidden");
  renderStars(null);
}

function handleCellClick(r, c) {
  const result = grid.toggleLight(r, c);
  if (result === "placed" || result === "removed") {
    // Un seul clic peut affecter PLUSIEURS cases à la fois (neurone
    // miroir [expérimental]: l'origine + son duplicata) — on garde tout
    // le groupe dans une seule entrée d'historique pour qu'Annuler
    // reproduise/défasse le clic entier d'un coup, pas juste une moitié.
    moveHistory.push({ cells: grid.getLastAffectedCells() });
    syncMoveUi();
  }
  if (result === "placed") playPlace();
  else if (result === "removed") playRemove();
  else playError();

  renderer.render();

  if (grid.isWon()) {
    playWin();
    renderStars(computeStars(grid.getPlacedLightCount(), currentLevelIndex));
    winOverlay.classList.remove("hidden");
  }
}

function undoLastMove() {
  const last = moveHistory.pop();
  if (!last) return;
  // Restaure directement l'état précédent (voir setLightRaw) plutôt que de
  // rejouer toggleLight: une case redevenue "déjà illuminée" par une autre
  // lumière depuis ne doit pas empêcher de reposer la lumière qu'on annule.
  // Un son "placé" prime sur "retiré" si le groupe mélange les deux (ne
  // devrait pas arriver en pratique, mais reste cohérent si jamais).
  let anyPlaced = false;
  for (const { r, c, action, isDuplicate, originKey } of last.cells) {
    const restoringLight = action === "removed";
    if (restoringLight) anyPlaced = true;
    grid.setLightRaw(r, c, restoringLight, { isDuplicate, originKey });
  }
  // Après la mutation de `grid.lights`, pas avant: le compteur affiché lit
  // `grid.getPlacedLightCount()` (voir syncMoveUi), donc l'ordre importe ici.
  syncMoveUi();
  if (anyPlaced) playPlace();
  else playRemove();
  renderer.render();
  winOverlay.classList.add("hidden");
}

document.getElementById("btn-prev").onclick = () => loadLevel(currentLevelIndex - 1);
document.getElementById("btn-next").onclick = () => loadLevel(currentLevelIndex + 1);
document.getElementById("btn-next-win").onclick = () => loadLevel(currentLevelIndex + 1);
document.getElementById("btn-reset").onclick = () => loadLevel(currentLevelIndex);
btnUndo.onclick = undoLastMove;

// Réglage de volume simple: un seul curseur pour tous les sons (voir
// setMasterVolume dans sound.js, appliqué en amont de tous les synths).
const volumeSlider = document.getElementById("volume-slider");
setMasterVolume(Number(volumeSlider.value) / 100);
volumeSlider.addEventListener("input", () => {
  setMasterVolume(Number(volumeSlider.value) / 100);
});

// Bascule Jeu / Éditeur : deux vues superposées dans la même page, plutôt
// qu'un routage — c'est un prototype mono-page.
const playView = document.getElementById("play-view");
const editorView = document.getElementById("editor-view");
const btnMode = document.getElementById("btn-mode-toggle");

let editorActive = false;
function setMode(editing) {
  editorActive = editing;
  playView.classList.toggle("hidden", editing);
  editorView.classList.toggle("hidden", !editing);
  btnMode.textContent = editing ? "Jouer" : "Éditeur";
  if (editing) editorApi.onShow();
}
btnMode.onclick = () => setMode(!editorActive);

const editorApi = initEditor({ levels });

// Raccourci Ctrl+Z / Cmd+Z pour annuler, uniquement en jeu (pas en éditeur:
// on laisse le Ctrl+Z natif du navigateur fonctionner dans les champs de
// l'éditeur, ex. le nom du niveau) et jamais quand le focus est déjà sur un
// champ de saisie (même raison).
window.addEventListener("keydown", (e) => {
  const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z";
  if (!isUndo || editorActive) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  e.preventDefault();
  undoLastMove();
});

loadLevel(0);
