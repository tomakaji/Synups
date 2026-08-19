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
import { FEATURES } from "./game/generator.js";
import { requestLevel } from "./game/infiniteClient.js";

let currentLevelIndex = 0;
// Le niveau EFFECTIVEMENT en cours, statique (`levels[currentLevelIndex]`)
// ou généré à la volée (mode Infini) — voir loadLevel/loadInfiniteLevel.
// `computeStars` travaille sur cet objet directement plutôt que sur un
// index, pour ne pas dépendre du tableau `levels` quand la source est le
// générateur.
let currentLevel = null;
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
// cache par OBJET niveau (Map à clé objet: fonctionne aussi bien pour un
// niveau statique que pour un niveau généré, jamais deux fois le même objet
// en mémoire pour deux niveaux différents). Les niveaux générés par le mode
// Infini fournissent déjà `starThresholds` explicitement (voir
// generator.js), donc ce chemin de secours ne les concerne en pratique
// jamais — gardé quand même par cohérence/robustesse.
const parCache = new Map();

function computeStars(moves, level) {
  if (Array.isArray(level.starThresholds) && level.starThresholds.length === 2) {
    const [threeMax, twoMax] = level.starThresholds;
    if (moves <= threeMax) return 3;
    if (moves <= twoMax) return 2;
    return 1;
  }
  let par = parCache.get(level);
  if (par === undefined) {
    const solution = findSolution(level, 400_000);
    par = solution ? solution.length : null;
    parCache.set(level, par);
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

/** Commun aux niveaux statiques et générés: prépare le plateau une fois
 * `grid`/`currentLevel` déjà positionnés par l'appelant. */
function startBoard() {
  moveHistory = [];
  syncMoveUi();
  renderer.build(grid, { onCellClick: handleCellClick, sounds });
  winOverlay.classList.add("hidden");
  renderStars(null);
}

function loadLevel(index) {
  currentLevelIndex = ((index % levels.length) + levels.length) % levels.length;
  currentLevel = levels[currentLevelIndex];
  grid = new LightUpGrid(currentLevel);
  levelNameEl.textContent = `${currentLevelIndex + 1}. ${currentLevel.name}`;
  startBoard();
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

  // Neurone miroir [expérimental]: animation éphémère (jamais persistante,
  // purement cosmétique) qui montre soit la duplication qui vient de
  // réussir, soit — si le clic a été refusé — QUEL neurone a bloqué le
  // mouvement et dans quelle direction, plutôt qu'un simple son d'erreur
  // générique. Voir grid.js: getLastMirrorLinks/getLastMirrorFailure.
  if (result === "placed") {
    const links = grid.getLastMirrorLinks();
    if (links.length) renderer.playMirrorSuccess(links);
  } else if (result === false) {
    const failure = grid.getLastMirrorFailure();
    if (failure) renderer.playMirrorFailure(failure);
  }

  if (grid.isWon()) {
    playWin();
    renderStars(computeStars(grid.getPlacedLightCount(), currentLevel));
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

btnUndo.onclick = undoLastMove;

// Réglage de volume simple: un seul curseur pour tous les sons (voir
// setMasterVolume dans sound.js, appliqué en amont de tous les synths).
const volumeSlider = document.getElementById("volume-slider");
setMasterVolume(Number(volumeSlider.value) / 100);
volumeSlider.addEventListener("input", () => {
  setMasterVolume(Number(volumeSlider.value) / 100);
});

// ---------- Mode Infini ----------
// Voir docs/infinite-mode-design.md. Un niveau généré est un objet niveau
// STANDARD (comme n'importe quelle entrée de levels.js) : une fois obtenu,
// il traverse exactement le même chemin (`grid`/`renderer`/`handleCellClick`)
// qu'un niveau statique — seule la façon dont on l'obtient diffère.

const navStaticEl = document.getElementById("nav-static");
const navInfiniteEl = document.getElementById("nav-infinite");
const infiniteLevelLabelEl = document.getElementById("infinite-level-label");
const infiniteBadgeEl = document.getElementById("infinite-badge");
const btnInfiniteSettings = document.getElementById("btn-infinite-settings");
const btnInfiniteNext = document.getElementById("btn-infinite-next");
const infiniteConfigView = document.getElementById("infinite-config-view");
const infiniteFeaturesEl = document.getElementById("infinite-features");
const btnInfiniteGenerate = document.getElementById("btn-infinite-generate");
const infiniteStatusEl = document.getElementById("infinite-status");

let infiniteDifficulty = 1;
// Cochées par défaut: seules les features déjà implémentées (voir
// generator.js) ont un sens à activer d'office ; les autres sont visibles
// (roadmap) mais grisées tant qu'elles ne sont pas encore génératrices.
let infiniteEnabledFeatures = new Set(Object.keys(FEATURES).filter((k) => FEATURES[k].implemented));
let lastInfiniteResult = null; // dernier niveau généré (pour "Réglages" -> retour au jeu sans perdre la partie)
let infiniteRequestInFlight = false;

document.querySelectorAll(".infinite-star-btn").forEach((btn) => {
  btn.onclick = () => {
    infiniteDifficulty = Number(btn.dataset.difficulty);
    document.querySelectorAll(".infinite-star-btn").forEach((b) => b.classList.toggle("active", b === btn));
  };
});

/** Construit la liste de checkboxes features à partir de FEATURES (voir
 * generator.js) — une feature non `implemented` reste visible (roadmap)
 * mais désactivée ; une feature avec `requires` se grise/se décoche
 * automatiquement tant que sa dépendance n'est pas cochée. */
function buildFeatureChecklist() {
  infiniteFeaturesEl.innerHTML = "";
  for (const [key, feature] of Object.entries(FEATURES)) {
    const row = document.createElement("label");
    row.className = "infinite-feature-row";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.featureKey = key;
    input.checked = infiniteEnabledFeatures.has(key);
    input.disabled = !feature.implemented;

    const span = document.createElement("span");
    span.textContent = feature.label;

    row.append(input, span);

    if (!feature.implemented) {
      const tag = document.createElement("span");
      tag.className = "infinite-feature-tag";
      tag.textContent = "bientôt";
      row.append(tag);
      row.classList.add("disabled");
    }

    input.addEventListener("change", () => {
      if (input.checked) infiniteEnabledFeatures.add(key);
      else infiniteEnabledFeatures.delete(key);
      refreshFeatureDependencies();
    });

    infiniteFeaturesEl.appendChild(row);
  }
  refreshFeatureDependencies();
}

/** Grise/décoche une feature dont la dépendance (`requires`) n'est plus
 * cochée — voir FEATURES dans generator.js (ex: Miroir/Filtre/Prisme
 * dépendent tous de Couleur). */
function refreshFeatureDependencies() {
  for (const [key, feature] of Object.entries(FEATURES)) {
    if (!feature.requires) continue;
    const input = infiniteFeaturesEl.querySelector(`input[data-feature-key="${key}"]`);
    if (!input) continue;
    const dependencyMet = infiniteEnabledFeatures.has(feature.requires);
    const row = input.closest(".infinite-feature-row");
    if (!dependencyMet && input.checked) {
      input.checked = false;
      infiniteEnabledFeatures.delete(key);
    }
    const shouldDisable = !feature.implemented || !dependencyMet;
    input.disabled = shouldDisable;
    row.classList.toggle("disabled", shouldDisable);
  }
}

buildFeatureChecklist();

function starsLabel(tier) {
  return "★".repeat(tier) + "☆".repeat(3 - tier);
}

function loadInfiniteLevel(result) {
  lastInfiniteResult = result;
  currentLevelIndex = -1;
  currentLevel = result.level;
  grid = new LightUpGrid(currentLevel);
  const shownTier = result.measuredTier ?? result.requestedTier;
  infiniteLevelLabelEl.textContent = `∞ · ${starsLabel(shownTier)}`;
  infiniteBadgeEl.classList.toggle("hidden", result.confirmedUnique);
  startBoard();
}

async function runGeneration({ intoBoard }) {
  if (infiniteRequestInFlight) return;
  infiniteRequestInFlight = true;
  btnInfiniteGenerate.disabled = true;
  btnInfiniteNext.disabled = true;
  const statusTarget = intoBoard ? infiniteLevelLabelEl : infiniteStatusEl;
  const previousLabel = statusTarget.textContent;
  statusTarget.textContent = intoBoard ? "∞ · génération…" : "Génération en cours…";

  try {
    const result = await requestLevel({
      difficulty: infiniteDifficulty,
      enabledFeatureKeys: Array.from(infiniteEnabledFeatures),
    });
    if (!result) {
      statusTarget.textContent = intoBoard
        ? previousLabel
        : "Échec de génération avec ces réglages — réessaie (ou change les réglages).";
      return;
    }
    infiniteConfigView.classList.add("hidden");
    navStaticEl.classList.add("hidden");
    navInfiniteEl.classList.remove("hidden");
    playView.classList.remove("hidden");
    loadInfiniteLevel(result);
    infiniteStatusEl.textContent = "";
  } catch (err) {
    statusTarget.textContent = "Erreur du générateur — réessaie.";
    console.error(err);
  } finally {
    infiniteRequestInFlight = false;
    btnInfiniteGenerate.disabled = false;
    btnInfiniteNext.disabled = false;
  }
}

btnInfiniteGenerate.onclick = () => runGeneration({ intoBoard: false });
btnInfiniteNext.onclick = () => runGeneration({ intoBoard: true });
btnInfiniteSettings.onclick = () => {
  infiniteConfigView.classList.remove("hidden");
  playView.classList.add("hidden");
};

// ---------- Navigation haut / bas selon le mode courant ----------
// btn-reset et le bouton "Niveau suivant" de l'écran de victoire sont
// partagés entre les modes Jouer et Infini (contrairement à prev/next,
// masqués en Infini avec #nav-static) — leur comportement dépend donc du
// mode courant plutôt que d'appeler systématiquement loadLevel().

document.getElementById("btn-prev").onclick = () => loadLevel(currentLevelIndex - 1);
document.getElementById("btn-next").onclick = () => loadLevel(currentLevelIndex + 1);

document.getElementById("btn-next-win").onclick = () => {
  if (mode === "infinite") runGeneration({ intoBoard: true });
  else loadLevel(currentLevelIndex + 1);
};

document.getElementById("btn-reset").onclick = () => {
  if (mode === "infinite" && lastInfiniteResult) loadInfiniteLevel(lastInfiniteResult);
  else loadLevel(currentLevelIndex);
};

// ---------- Bascule Jouer / Infini / Éditeur ----------
// Trois vues superposées dans la même page, plutôt qu'un routage — c'est un
// prototype mono-page.
const playView = document.getElementById("play-view");
const editorView = document.getElementById("editor-view");
const modeSwitchEl = document.getElementById("mode-switch");

let mode = "play";
function setMode(next) {
  mode = next;
  document.querySelectorAll(".mode-switch-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === next));

  editorView.classList.toggle("hidden", next !== "editor");
  if (next === "editor") {
    playView.classList.add("hidden");
    infiniteConfigView.classList.add("hidden");
    editorApi.onShow();
    return;
  }

  if (next === "play") {
    infiniteConfigView.classList.add("hidden");
    navStaticEl.classList.remove("hidden");
    navInfiniteEl.classList.add("hidden");
    playView.classList.remove("hidden");
    return;
  }

  // next === "infinite": si une partie est déjà en cours, on la retrouve
  // telle quelle (ne jamais perdre une génération pour un simple aller-retour
  // de mode) ; sinon on ouvre directement le panneau de réglages.
  navStaticEl.classList.add("hidden");
  if (lastInfiniteResult) {
    navInfiniteEl.classList.remove("hidden");
    playView.classList.remove("hidden");
    infiniteConfigView.classList.add("hidden");
  } else {
    navInfiniteEl.classList.add("hidden");
    playView.classList.add("hidden");
    infiniteConfigView.classList.remove("hidden");
  }
}
modeSwitchEl.querySelectorAll(".mode-switch-btn").forEach((btn) => {
  btn.onclick = () => setMode(btn.dataset.mode);
});

const editorApi = initEditor({ levels });

// Raccourci Ctrl+Z / Cmd+Z pour annuler, en jeu comme en Infini (pas en
// éditeur: on laisse le Ctrl+Z natif du navigateur fonctionner dans les
// champs de l'éditeur, ex. le nom du niveau) et jamais quand le focus est
// déjà sur un champ de saisie (même raison).
window.addEventListener("keydown", (e) => {
  const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z";
  if (!isUndo || mode === "editor") return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  e.preventDefault();
  undoLastMove();
});

loadLevel(0);
