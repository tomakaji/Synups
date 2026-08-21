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
import {
  preloadMusic,
  startMusic,
  resetLayers as resetMusicLayers,
  applyMechanicCounts,
  enterFailure,
  exitFailure,
  setMusicVolume,
} from "./game/music.js";
import { createBoardRenderer } from "./game/render.js";
import { initEditor } from "./editor.js";
import { FEATURES } from "./game/generator.js";
import { requestLevel, ensureLevelBuffer, takeBufferedLevel } from "./game/infiniteClient.js";

let currentLevelIndex = 0;
// Le niveau EFFECTIVEMENT en cours, statique (`levels[currentLevelIndex]`)
// ou généré à la volée (mode Infini) — voir loadLevel/loadInfiniteLevel.
let currentLevel = null;
let grid = null;
// Historique des coups (poses/retraits de lumière) pour le bouton
// "Annuler": pas de limite tant qu'on n'a pas tout remonté, vidé à chaque
// chargement/réinitialisation de niveau.
let moveHistory = [];

const boardEl = document.getElementById("board");
const levelNameEl = document.getElementById("level-name");
const winOverlay = document.getElementById("win-overlay");
const btnUndo = document.getElementById("btn-undo");
const renderer = createBoardRenderer(boardEl);

// Musique par calques [voir music.js]: `mechanicCounts` est appelé une fois
// PAR FRAME par render.js avec l'état COURANT (pas edge-triggered comme les
// autres callbacks ci-dessous) — c'est lui qui pilote le démute/remute de
// toutes les couches mécaniques (y compris les paliers "couche 2"), donc
// aucun des callbacks edge-triggered n'a plus besoin de toucher à la
// musique directement (contrairement à avant).
const sounds = {
  targetSuccess: playTargetSuccess,
  targetLost: playTargetLost,
  synapseBreak: () => {
    playSynapseBreak();
    enterFailure();
  },
  synapseRestore: () => {
    playSynapseRestore();
    exitFailure();
  },
  chargeFull: playChargeFull,
  chargeEmptied: playChargeEmptied,
  chargeOverload: () => {
    playChargeOverload();
    enterFailure();
  },
  chargeOverloadResolved: () => exitFailure(),
  mechanicCounts: applyMechanicCounts,
};

// ---------- Points Infini ----------
// Le mode Infini n'a plus de notation par étoiles basée sur le nombre de
// coups (voir le retrait de computeStars/winOverlay dans handleCellClick
// plus bas) : à la place, terminer un niveau rapporte un nombre fixe de
// points selon SON palier de difficulté mesuré (measuredTier), cumulés dans
// un total persistant (localStorage, même approche que STORAGE_KEY dans
// editor.js). L'utilité de ce total reste à définir (voir discussion) — pour
// l'instant, seuls le gain et l'affichage permanent sont câblés.
const INFINITE_POINTS_BY_TIER = { 1: 1, 2: 3, 3: 5 };
const POINTS_STORAGE_KEY = "lightup-infinite-points";

function loadInfinitePoints() {
  try {
    const raw = localStorage.getItem(POINTS_STORAGE_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

let infinitePoints = loadInfinitePoints();
const infinitePointsEl = document.getElementById("infinite-points");

function renderInfinitePoints() {
  infinitePointsEl.textContent = `${infinitePoints} pt`;
}

function awardInfinitePoints(tier) {
  const gain = INFINITE_POINTS_BY_TIER[tier] ?? 1;
  infinitePoints += gain;
  try {
    localStorage.setItem(POINTS_STORAGE_KEY, String(infinitePoints));
  } catch {
    // Stockage indisponible (navigation privée, quota...) : le total reste
    // correct en mémoire pour la session en cours, simplement pas persisté.
  }
  renderInfinitePoints();
  // Retire puis rajoute la classe d'animation pour pouvoir la relancer même
  // si un gain précédent est encore en cours (un simple ajout ne rejouerait
  // pas le keyframe si la classe est déjà présente) — le reflow forcé entre
  // les deux garantit que le navigateur voit bien les deux mutations comme
  // séparées plutôt que de les fusionner dans la même frame.
  infinitePointsEl.classList.remove("points-gain");
  void infinitePointsEl.offsetWidth;
  infinitePointsEl.classList.add("points-gain");
}

renderInfinitePoints();

// Journal complet des coups: c'est uniquement lui qui permet à Annuler/
// Ctrl+Z de retrouver l'état précédent (le compteur de coups affiché et la
// notation par étoiles qui en dépendait ont été retirés — feature jugée
// obsolète).
function syncMoveUi() {
  btnUndo.disabled = moveHistory.length === 0;
}

/** Commun aux niveaux statiques et générés: prépare le plateau une fois
 * `grid`/`currentLevel` déjà positionnés par l'appelant. */
function startBoard() {
  moveHistory = [];
  syncMoveUi();
  renderer.build(grid, { onCellClick: handleCellClick, sounds });
  winOverlay.classList.add("hidden");
  // Musique par calques: le déblocage reflète la progression du niveau qui
  // commence, pas un cumul avec le précédent — la lecture elle-même
  // continue sans interruption (voir music.js: resetLayers).
  resetMusicLayers();
}

function loadLevel(index) {
  currentLevelIndex = ((index % levels.length) + levels.length) % levels.length;
  currentLevel = levels[currentLevelIndex];
  grid = new LightUpGrid(currentLevel);
  levelNameEl.textContent = `${currentLevelIndex + 1}. ${currentLevel.name}`;
  startBoard();
}

function handleCellClick(r, c) {
  if (mode === "infinite" && infiniteAdvancePending) return;
  // Musique par calques: démarre au premier vrai geste utilisateur (voir
  // music.js — Tone.js exige un clic avant de pouvoir jouer du son, même
  // règle que ensureStarted() dans sound.js). Sans effet si déjà démarrée.
  startMusic();
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
    if (mode === "infinite") {
      // Mode Infini: plus de notation par étoiles basée sur les coups ni
      // d'écran de victoire bloquant (retrait demandé — voir
      // docs/infinite-mode-design.md) : gain de points selon le palier
      // mesuré du niveau, puis enchaînement direct sur le suivant (servi
      // instantanément depuis le buffer dans le cas courant — voir
      // runGeneration/infiniteClient.js). Le petit délai laisse le temps de
      // percevoir le son de victoire et l'animation de gain avant la
      // transition, plutôt qu'un changement de plateau instantané et brutal.
      infiniteAdvancePending = true;
      awardInfinitePoints(lastInfiniteResult?.measuredTier ?? lastInfiniteResult?.requestedTier ?? 1);
      setTimeout(() => runGeneration({ intoBoard: true }), 500);
    } else {
      winOverlay.classList.remove("hidden");
    }
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

// Un seul curseur de volume commun aux sons ET à la musique (retour
// utilisateur: "ajouter une barre de réglage volume qui regle les deux en
// même temps pour plus de cohérence"), plus deux icônes toggle indépendantes
// pour couper/rétablir chaque flux sans toucher au niveau réglé par le
// curseur — on retient donc juste un booléen muet par flux et on ré-applique
// `niveau du curseur` (ou 0 si muet) à chaque changement de l'un ou l'autre.
const volumeSlider = document.getElementById("volume-slider");
const btnSoundToggle = document.getElementById("btn-sound-toggle");
const btnMusicToggle = document.getElementById("btn-music-toggle");

let soundMuted = false;
let musicMuted = false;

function applyVolumes() {
  const level = Number(volumeSlider.value) / 100;
  setMasterVolume(soundMuted ? 0 : level);
  setMusicVolume(musicMuted ? 0 : level);
}

volumeSlider.addEventListener("input", applyVolumes);

btnSoundToggle.addEventListener("click", () => {
  soundMuted = !soundMuted;
  btnSoundToggle.classList.toggle("muted", soundMuted);
  applyVolumes();
});

btnMusicToggle.addEventListener("click", () => {
  musicMuted = !musicMuted;
  btnMusicToggle.classList.toggle("muted", musicMuted);
  applyVolumes();
});

applyVolumes();

// Précharge les 7 pistes dès le chargement de la page (pas besoin d'un
// geste utilisateur pour ÇA, seule la LECTURE l'exige — voir startMusic
// dans handleCellClick) pour qu'elles soient déjà prêtes au premier clic.
preloadMusic();

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
// Vrai entre le moment où un niveau Infini vient d'être résolu et celui où
// le niveau suivant est effectivement chargé (voir le court délai dans
// handleCellClick) : sans overlay bloquant pour couvrir le plateau pendant
// ce court délai (retiré avec le compteur de coups), le joueur pourrait
// continuer à cliquer sur la grille déjà résolue — ce garde-fou ignore ces
// clics et empêche surtout un double gain de points si `isWon()` reste vrai
// et qu'un nouveau clic redéclenche la branche de victoire avant la
// transition. Remis à `false` dans loadInfiniteLevel, point de passage commun
// à chaque (re)chargement d'un niveau Infini.
let infiniteAdvancePending = false;

/** Config courante, telle que passée à requestLevel/ensureLevelBuffer/
 * takeBufferedLevel — un seul endroit pour construire cet objet, pour ne
 * jamais désynchroniser la signature utilisée pour lire/écrire le buffer. */
function infiniteConfig() {
  return { difficulty: infiniteDifficulty, enabledFeatureKeys: Array.from(infiniteEnabledFeatures) };
}

document.querySelectorAll(".infinite-star-btn").forEach((btn) => {
  btn.onclick = () => {
    infiniteDifficulty = Number(btn.dataset.difficulty);
    document.querySelectorAll(".infinite-star-btn").forEach((b) => b.classList.toggle("active", b === btn));
    // Amorce le buffer dès le changement de réglage (pas seulement une fois
    // en jeu) : si le joueur clique "Générer" juste après, le premier niveau
    // a une chance d'être déjà prêt lui aussi.
    ensureLevelBuffer(infiniteConfig());
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
      ensureLevelBuffer(infiniteConfig()); // voir commentaire sur le bouton étoile
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
  infiniteAdvancePending = false;
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

  const config = infiniteConfig();

  // Buffer d'abord (voir infiniteClient.js) : si un niveau pour cette config
  // exacte est déjà prêt, on le sert INSTANTANÉMENT, sans passer par l'état
  // "génération en cours" ni bloquer sur une Promise — c'est tout l'intérêt
  // du buffer. On relance ensuite un remplissage (déjà fait par
  // takeBufferedLevel) pendant que le joueur enchaîne sur ce niveau.
  const buffered = takeBufferedLevel(config);
  if (buffered) {
    infiniteConfigView.classList.add("hidden");
    navStaticEl.classList.add("hidden");
    navInfiniteEl.classList.remove("hidden");
    playView.classList.remove("hidden");
    loadInfiniteLevel(buffered);
    infiniteStatusEl.textContent = "";
    return;
  }

  infiniteRequestInFlight = true;
  btnInfiniteGenerate.disabled = true;
  btnInfiniteNext.disabled = true;
  const statusTarget = intoBoard ? infiniteLevelLabelEl : infiniteStatusEl;
  const previousLabel = statusTarget.textContent;
  statusTarget.textContent = intoBoard ? "∞ · génération…" : "Génération en cours…";

  try {
    const result = await requestLevel(config);
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
    // Le résultat servi ici ne venait PAS du buffer (sinon on serait déjà
    // sorti plus haut) : on lance quand même un remplissage pour préparer
    // les prochains "Niveau suivant" pendant que le joueur résout celui-ci.
    ensureLevelBuffer(config);
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
