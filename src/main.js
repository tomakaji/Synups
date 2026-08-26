import { LightUpGrid } from "./game/grid.js";
import { levels } from "./game/levels.js";
import { findSolution } from "./game/solver.js";
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
import {
  createBoardRenderer,
  chargeIcon,
  synapseIcon,
  mirrorIcon,
  filterIcon,
  prismIcon,
  pyraIcon,
  mirrorNeuronIcon,
} from "./game/render.js";
import { initEditor } from "./editor.js";
import { initSommation, getSommationBadges, isPixelArtUnlocked } from "./sommation.js";
import { FEATURES } from "./game/generator.js";
import { requestLevel, ensureLevelBuffer, takeBufferedLevel } from "./game/infiniteClient.js";
import {
  loadPoints,
  savePoints,
  loadStoryProgress,
  saveStoryProgress,
  unlockedCount,
  currentStoryIndex,
  loadSettings,
  saveSettings,
  eraseAllProgress,
  loadProfile,
  saveProfile,
} from "./game/storage.js";
import {
  listLevels,
  getLevel,
  likedLevels,
  toggleLike,
  markPlayed,
  unpublishLevel,
  encodeShareCode,
  decodeShareCode,
  importSharedLevel,
  AVATAR_CHOICES,
} from "./game/community-store.js";

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
const boardContainerEl = document.getElementById("board-container");
const btnUndo = document.getElementById("btn-undo");
const renderer = createBoardRenderer(boardEl);

// ---------- Transition de fin de niveau (fondu, partagée Jouer/Infini) ----------
// Un niveau résolu n'affiche plus de menu bloquant ("Niveau suivant" à
// cliquer) : le plateau s'efface en fondu, le niveau suivant se charge
// PENDANT que l'écran est effacé, puis réapparaît en fondu — même logique
// dans les deux modes (retour utilisateur: "la logique standard pour passer
// d'un niveau à l'autre"), seule la façon d'obtenir le niveau suivant
// diffère (loadLevel() vs runGeneration()). BOARD_HOLD_MS garantit que
// l'écran reste effacé un minimum de temps même si le niveau suivant est
// prêt instantanément (cas courant en Infini via le buffer), pour éviter un
// clignotement — au total (fondu de sortie + pause + fondu d'entrée),
// une transition d'environ la durée du son de victoire (voir sound.js:
// playWin).
const BOARD_FADE_MS = 450;
const BOARD_HOLD_MS = 900;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Vrai entre la résolution d'un niveau et l'affichage effectif du suivant :
// bloque toute action de jeu pendant la transition (placer/retirer une
// lumière, Annuler, Réinitialiser, navigation) dans les DEUX modes — avant,
// seul le mode Infini avait un tel verrou (infiniteAdvancePending), le mode
// Jouer s'appuyait sur le menu bloquant pour empêcher les clics.
let boardLocked = false;

async function advanceAfterWin() {
  boardLocked = true;
  boardContainerEl.classList.add("board-fade");
  await wait(BOARD_FADE_MS);
  const holdStart = performance.now();
  if (mode === "infinite") {
    awardInfinitePoints(lastInfiniteResult?.measuredTier ?? lastInfiniteResult?.requestedTier ?? 1);
    await runGeneration({ intoBoard: true });
  } else if (mode === "community") {
    // Pas de "niveau suivant" prédéterminé en Communauté (contrairement à
    // Histoire/Infini) — voir plus bas: on revient au fil après la pause,
    // plutôt que de laisser le joueur sur un plateau résolu sans action
    // évidente à faire ensuite.
    if (currentCommunityLevel) markPlayed(currentCommunityLevel.id);
  } else {
    markStoryLevelCompleted(currentLevelIndex);
    loadLevel(currentLevelIndex + 1);
  }
  const elapsed = performance.now() - holdStart;
  if (elapsed < BOARD_HOLD_MS) await wait(BOARD_HOLD_MS - elapsed);
  boardContainerEl.classList.remove("board-fade");
  boardLocked = false;
  if (mode === "community" && currentCommunityLevel) {
    // On ne redemande QUE si le joueur n'a pas déjà aimé la grille pendant
    // la partie (bouton coeur du bandeau) — sinon la question serait
    // redondante. Voir openCommunityRateModal/btnCommunityRateLike.
    const fresh = getLevel(currentCommunityLevel.id);
    if (fresh?.likedByMe) goBack();
    else openCommunityRateModal(currentCommunityLevel);
  }
}

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

// ---------- Progression Histoire ----------
// Voir storage.js: `completed` est la SEULE source de vérité pour le
// déverrouillage (jamais un simple index stocké à part) — un niveau i est
// débloqué si tous les niveaux 0..i-1 sont dans `completed`.
let storyProgress = loadStoryProgress();

function markStoryLevelCompleted(index) {
  if (index < 0 || index >= levels.length) return; // garde-fou: index invalide (ne devrait pas arriver)
  if (storyProgress.has(index)) return; // déjà fait: rejouer un niveau ne change rien à la progression
  storyProgress.add(index);
  saveStoryProgress(storyProgress);
  renderTitleStoryProgress();
}

function renderTitleStoryProgress() {
  const total = levels.length;
  const fraction = total > 0 ? storyProgress.size / total : 0;
  storyProgressFillEl.style.width = `${Math.round(fraction * 100)}%`;
  storyProgressTextEl.textContent = `${storyProgress.size} / ${total}`;
}

// ---------- Points (gagnés en Infini, dépensés dans Remember) ----------
const INFINITE_POINTS_BY_TIER = { 1: 1, 2: 3, 3: 5 };

let infinitePoints = loadPoints();
const infinitePointsEl = document.getElementById("infinite-points");
const menuPointsBadgeEl = document.getElementById("menu-points-badge");
// Sommation (mode "Remember") partage désormais ce MÊME solde — retour
// utilisateur: "les points dans le mode Sommation sont les mêmes que dans le
// mode infinity". Inclus ici pour que renderPointsEverywhere() le maintienne
// à jour aussi, quelle que soit l'écran d'où provient la dépense/le gain.
const sommationPointsEl = document.getElementById("sommation-points");

function renderPointsEverywhere() {
  const label = `${infinitePoints} pt`;
  infinitePointsEl.textContent = label;
  menuPointsBadgeEl.textContent = label;
  if (sommationPointsEl) sommationPointsEl.textContent = label;
}

function awardInfinitePoints(tier) {
  const gain = INFINITE_POINTS_BY_TIER[tier] ?? 1;
  infinitePoints += gain;
  savePoints(infinitePoints);
  renderPointsEverywhere();
  // Retire puis rajoute la classe d'animation pour pouvoir la relancer même
  // si un gain précédent est encore en cours (un simple ajout ne rejouerait
  // pas le keyframe si la classe est déjà présente) — le reflow forcé entre
  // les deux garantit que le navigateur voit bien les deux mutations comme
  // séparées plutôt que de les fusionner dans la même frame.
  infinitePointsEl.classList.remove("points-gain");
  void infinitePointsEl.offsetWidth;
  infinitePointsEl.classList.add("points-gain");
}

// API générique (montant explicite plutôt que par palier) exposée à
// Sommation — voir initSommation() plus bas — pour dépenser/injecter des
// points dans ce MÊME solde partagé sans dupliquer sa persistance ni son
// affichage (un seul point de vérité: infinitePoints ci-dessus).
function spendSharedPoints(amount) {
  if (infinitePoints < amount) return false;
  infinitePoints -= amount;
  savePoints(infinitePoints);
  renderPointsEverywhere();
  return true;
}

function addSharedPoints(amount) {
  infinitePoints += amount;
  savePoints(infinitePoints);
  renderPointsEverywhere();
}

renderPointsEverywhere();

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
  if (boardLocked) return;
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
    advanceAfterWin();
  }
}

function undoLastMove() {
  if (boardLocked) return;
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
}

btnUndo.onclick = undoLastMove;

// ---------- Indice (ampoule) ----------
// Stock volontairement EN MÉMOIRE seulement (pas dans storage.js): retour
// utilisateur explicite "pour l'instant on n'enregistre nulle part, si je
// fais F5 ça se réinit" — un futur ajout de persistance se ferait dans
// storage.js comme le reste, sans autre changement ici. Partagé entre
// Histoire et Infini (pas de remise à zéro au changement de niveau).
const HINT_HIGHLIGHT_MS = 2400;
const btnHint = document.getElementById("btn-hint");
const hintCountEl = document.getElementById("hint-count");
const hintModal = document.getElementById("hint-modal");
const btnHintWatchAd = document.getElementById("btn-hint-watch-ad");

let hintStock = 10;
let hintHighlightTimeout = null;

function renderHintUI() {
  hintCountEl.textContent = String(hintStock);
  // À zéro: l'icône affiche un indicateur "on peut en obtenir" (voir
  // style.css) plutôt que de se désactiver — le bouton reste cliquable,
  // cliquer dessus ouvre la modale au lieu de consommer un indice.
  btnHint.classList.toggle("hint-btn--empty", hintStock <= 0);
}

/** Cherche, dans UNE solution valide du niveau courant (unique en
 * pratique — voir verify.mjs/le générateur), la prochaine case-lumière que
 * le joueur n'a pas encore posée. L'ordre du tableau retourné par
 * findSolution() reflète l'ordre dans lequel le solveur les a lui-même
 * déduites/posées pendant sa recherche (voir solver.js: `lights` est un
 * Set alimenté au fil de toggleLight, itéré dans son ordre d'insertion) —
 * une approximation raisonnable de "la prochaine ampoule que le solveur
 * trouverait", sans dupliquer ici toute la logique de propagation
 * pas-à-pas de propagate()/pickBranchCell(). */
function findNextHintCell() {
  if (!currentLevel || !grid) return null;
  const solution = findSolution(currentLevel);
  if (!solution) return null;
  const placed = new Set(grid.getPlacedLights().map(([r, c]) => `${r},${c}`));
  for (const [r, c] of solution) {
    if (!placed.has(`${r},${c}`)) return [r, c];
  }
  return null; // grille déjà correcte: rien à indiquer
}

/** Pose la mise en valeur "halo sonar doré" (voir style.css:
 * .cell--hint/@keyframes cell-hint-sonar) sur une case pendant
 * HINT_HIGHLIGHT_MS, puis la retire — jamais persistante. Purement
 * cosmétique: la lumière elle-même est déjà posée par handleCellClick()
 * avant cet appel (voir btnHint.onclick), ce halo ne fait que signaler
 * "c'est l'indice qui vient de la poser ici". */
function showHintAt(r, c) {
  const el = renderer.cellElementAt(r, c);
  if (!el) return;
  if (hintHighlightTimeout) clearTimeout(hintHighlightTimeout);
  boardEl.querySelectorAll(".cell--hint").forEach((n) => n.classList.remove("cell--hint"));
  // Reflow forcé (même technique que awardInfinitePoints ci-dessus): permet
  // de relancer l'animation même si un indice précédent vient d'être
  // utilisé sur la MÊME case juste avant.
  void el.offsetWidth;
  el.classList.add("cell--hint");
  hintHighlightTimeout = setTimeout(() => {
    el.classList.remove("cell--hint");
    hintHighlightTimeout = null;
  }, HINT_HIGHLIGHT_MS);
}

function openHintModal() {
  hintModal.classList.remove("hidden");
}
function closeHintModal() {
  hintModal.classList.add("hidden");
}

btnHint.onclick = () => {
  if (boardLocked) return;
  if (hintStock <= 0) {
    openHintModal();
    return;
  }
  const next = findNextHintCell();
  if (!next) return;
  hintStock--;
  renderHintUI();
  // Un indice POSE directement la lumière (retour utilisateur: "l'indice
  // doit placer la lumière, pas juste indiquer la position") — on rejoue
  // exactement le chemin d'un clic joueur (son, historique Annuler, anim.
  // neurone miroir, détection de victoire), pour que le résultat soit
  // strictement indiscernable d'un coup joué à la main, puis on ajoute le
  // halo doré par-dessus pour signaler que c'était un indice.
  handleCellClick(next[0], next[1]);
  showHintAt(next[0], next[1]);
};

document.querySelectorAll("[data-hint-modal-close]").forEach((el) => (el.onclick = closeHintModal));

btnHintWatchAd.onclick = () => {
  // Gratuit pour l'instant, sans intégration publicitaire réelle (voir
  // demande utilisateur: "cet ajout se fait gratuitement... dans le but du
  // test") — seuls le design et le flux sont branchés.
  hintStock += 10;
  renderHintUI();
  closeHintModal();
};

renderHintUI();

// ---------- Réglages persistants (son/musique/thème PixelArt) ----------
// Un seul curseur de volume commun aux sons ET à la musique (retour
// utilisateur: "ajouter une barre de réglage volume qui regle les deux en
// même temps pour plus de cohérence"), plus deux icônes toggle indépendantes
// pour couper/rétablir chaque flux sans toucher au niveau réglé par le
// curseur — le tout persistant (voir storage.js), plus un toggle GLOBAL
// (`globalMuted`, bouton flottant visible sur tous les écrans) qui coupe/
// remet tout d'un coup SANS écraser ces réglages détaillés.
const volumeSlider = document.getElementById("volume-slider");
const btnSoundToggle = document.getElementById("btn-sound-toggle");
const btnMusicToggle = document.getElementById("btn-music-toggle");
const btnGlobalMute = document.getElementById("btn-global-mute");

const settings = loadSettings();
volumeSlider.value = String(settings.volume);
btnSoundToggle.classList.toggle("muted", settings.soundMuted);
btnMusicToggle.classList.toggle("muted", settings.musicMuted);
btnGlobalMute.classList.toggle("muted", settings.globalMuted);

function applyVolumes() {
  const level = Number(volumeSlider.value) / 100;
  const globallyMuted = settings.globalMuted;
  setMasterVolume(globallyMuted || settings.soundMuted ? 0 : level);
  setMusicVolume(globallyMuted || settings.musicMuted ? 0 : level);
}

volumeSlider.addEventListener("input", () => {
  settings.volume = Number(volumeSlider.value);
  saveSettings(settings);
  applyVolumes();
});

btnSoundToggle.addEventListener("click", () => {
  settings.soundMuted = !settings.soundMuted;
  saveSettings(settings);
  btnSoundToggle.classList.toggle("muted", settings.soundMuted);
  applyVolumes();
});

btnMusicToggle.addEventListener("click", () => {
  settings.musicMuted = !settings.musicMuted;
  saveSettings(settings);
  btnMusicToggle.classList.toggle("muted", settings.musicMuted);
  applyVolumes();
});

// Toggle global (accessible partout, voir index.html): coupe/remet TOUT
// d'un coup sans toucher aux deux toggles détaillés ci-dessus — les rouvrir
// (désactiver le mute global) restaure exactement l'état qu'ils décrivaient
// avant, pas un état "tout remis à zéro".
btnGlobalMute.addEventListener("click", () => {
  settings.globalMuted = !settings.globalMuted;
  saveSettings(settings);
  btnGlobalMute.classList.toggle("muted", settings.globalMuted);
  applyVolumes();
});

applyVolumes();

// Précharge les 7 pistes dès le chargement de la page (pas besoin d'un
// geste utilisateur pour ÇA, seule la LECTURE l'exige — voir startMusic
// dans handleCellClick) pour qu'elles soient déjà prêtes au premier clic.
preloadMusic();

// ---------- Options: acheter le jeu (design seul) + réinitialiser ----------
// "Débloquer la version complète": maquette volontairement sans action pour
// l'instant (voir demande utilisateur — le paiement réel n'est pas encore
// développé), juste le bouton pour valider le design de la page.
document.getElementById("btn-buy-game").onclick = () => {};

// Modale intégrée plutôt que window.confirm() (retour utilisateur: "doit
// être une modale intégrée, pas une vraie pop-up de navigateur") — même
// principe que hint-modal (voir plus haut/index.html).
const resetConfirmModal = document.getElementById("reset-confirm-modal");

document.getElementById("btn-reset-save").onclick = () => {
  resetConfirmModal.classList.remove("hidden");
};

document.querySelectorAll("[data-reset-modal-close]").forEach((el) => {
  el.onclick = () => resetConfirmModal.classList.add("hidden");
});

document.getElementById("btn-reset-confirm").onclick = () => {
  eraseAllProgress();
  window.location.reload();
};

// ---------- Thème PixelArt (5e et dernière récompense de Remember) ----------
// Retour utilisateur round 10: "la 5eme et dernière récompense du jeu sera
// un theme PixelArt de tout le jeu + menus etc activable/desactivable dans
// Options et présent dès le début en grisé sous le nom de 'Remember ?'".
// Voir sommation.js: isPixelArtUnlocked (badgesEarned >= 5) et style.css:
// body.theme-pixelart pour le reskin lui-même.
const pixelartSectionEl = document.getElementById("options-pixelart-section");
const pixelartLabelEl = document.getElementById("options-pixelart-label");
const btnPixelartToggle = document.getElementById("btn-pixelart-toggle");
const pixelartHintEl = document.getElementById("options-pixelart-hint");

function applyPixelArtTheme() {
  document.body.classList.toggle("theme-pixelart", settings.pixelartEnabled === true);
}
applyPixelArtTheme();

/** Ré-exécutée à chaque affichage d'Options (voir showView) — le
 * déverrouillage peut survenir entre deux passages (le joueur vient de
 * décrocher sa 5e récompense dans Remember), donc jamais figé sur un état
 * périmé, même principe que renderLevelGrid/renderCommunityProfile. Grisé et
 * intitulé "Remember ?" tant que verrouillé (retour utilisateur: "présent
 * dès le début en grisé"), pour piquer la curiosité sans rien révéler. */
function renderPixelArtOption() {
  const unlocked = isPixelArtUnlocked();
  pixelartSectionEl.classList.toggle("locked", !unlocked);
  if (!unlocked) {
    pixelartLabelEl.textContent = "Remember ?";
    btnPixelartToggle.textContent = "Verrouillé";
    btnPixelartToggle.disabled = true;
    btnPixelartToggle.classList.remove("options-btn--accent");
    pixelartHintEl.textContent = "Débloqué à la 5e récompense de Remember.";
    return;
  }
  pixelartLabelEl.textContent = "Thème PixelArt";
  btnPixelartToggle.disabled = false;
  btnPixelartToggle.textContent = settings.pixelartEnabled ? "Activé" : "Désactivé";
  btnPixelartToggle.classList.toggle("options-btn--accent", settings.pixelartEnabled);
  pixelartHintEl.textContent = "Habillage rétro pour tout le jeu et les menus.";
}

btnPixelartToggle.onclick = () => {
  if (!isPixelArtUnlocked()) return;
  settings.pixelartEnabled = !settings.pixelartEnabled;
  saveSettings(settings);
  applyPixelArtTheme();
  renderPixelArtOption();
};

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

/** Icônes des mécaniques Infini: EXACTEMENT les mêmes images qu'en jeu
 * (retour utilisateur: "ca doit être exactement les mêmes images qu'en
 * jeu") — on appelle directement les fonctions d'icône de render.js
 * (chargeIcon/mirrorIcon/etc, désormais exportées) avec une fausse case
 * "figée" dans un état représentatif plutôt que de redessiner des glyphes
 * à part qui risqueraient de diverger du rendu réel. Chaque valeur est le
 * HTML retourné par la fonction, prêt à être injecté dans un `.cell-icon`
 * (même structure DOM que sur le plateau). */
const FEATURE_ICON_HTML = {
  forbidden: synapseIcon("intact"),
  // "Couleur (charges + cibles)": une charge colorée satisfaite (glow +
  // orbite) est le rendu le plus reconnaissable de la mécanique.
  color: chargeIcon({ number: 2, color: "r", _adjacentLights: 2 }),
  mirror: mirrorIcon({ orientation: "/", _mirrorColor: { r: false, g: false, b: true } }),
  filter: filterIcon({ filterColor: "g" }),
  prism: prismIcon({ firstColor: "r", _prismAdjacentCount: 0 }),
  pyra: pyraIcon({ _activeColor: "b", _state: "success" }),
  mirrorNeuron: mirrorNeuronIcon(),
};

/** Construit la grille de tuiles-icônes des mécaniques, à partir de
 * FEATURES (voir generator.js) — une feature non `implemented` reste
 * visible (roadmap) mais désactivée ; une feature avec `requires` se
 * désélectionne/se grise automatiquement tant que sa dépendance n'est pas
 * sélectionnée. Chaque tuile EST le bouton de bascule (comme
 * .infinite-star-btn), pas une case à cocher séparée. Classes `cell
 * cell--empty` réutilisées telles quelles (retour utilisateur: "mets-les
 * dans des cases, ça ressemble bien au jeu") pour que fond/bordure/taille
 * soient IDENTIQUES à une case du plateau, pas une imitation à part — voir
 * style.css: `.infinite-feature-tile` ne fait plus qu'ajouter les états de
 * sélection par-dessus. */
function buildFeatureChecklist() {
  infiniteFeaturesEl.innerHTML = "";
  for (const [key, feature] of Object.entries(FEATURES)) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "cell cell--empty infinite-feature-tile";
    tile.dataset.featureKey = key;
    tile.setAttribute("aria-label", feature.label);
    tile.title = feature.label;
    tile.innerHTML = `<span class="cell-icon">${FEATURE_ICON_HTML[key] ?? ""}</span>`;

    tile.addEventListener("click", () => {
      if (infiniteEnabledFeatures.has(key)) infiniteEnabledFeatures.delete(key);
      else infiniteEnabledFeatures.add(key);
      refreshFeatureDependencies();
      ensureLevelBuffer(infiniteConfig()); // voir commentaire sur le bouton étoile
    });

    infiniteFeaturesEl.appendChild(tile);
  }
  refreshFeatureDependencies();
}

/** Grise/désélectionne une feature dont la dépendance (`requires`) n'est
 * plus sélectionnée — voir FEATURES dans generator.js (ex: Miroir/Filtre/
 * Prisme dépendent tous de Couleur). `tile.disabled` (natif) bloque aussi
 * le clic lui-même, pas seulement l'apparence. */
function refreshFeatureDependencies() {
  for (const [key, feature] of Object.entries(FEATURES)) {
    const tile = infiniteFeaturesEl.querySelector(`[data-feature-key="${key}"]`);
    if (!tile) continue;
    const dependencyMet = !feature.requires || infiniteEnabledFeatures.has(feature.requires);
    if (!dependencyMet && infiniteEnabledFeatures.has(key)) {
      infiniteEnabledFeatures.delete(key);
    }
    const shouldDisable = !feature.implemented || !dependencyMet;
    tile.disabled = shouldDisable;
    tile.classList.toggle("disabled", shouldDisable);
    tile.classList.toggle("active", infiniteEnabledFeatures.has(key) && !shouldDisable);
  }
}

buildFeatureChecklist();

// Amorce le buffer de niveaux Infini dès le chargement de l'app (pas
// seulement au premier changement de réglage) — retour utilisateur: "je
// veux qu'on preload les niveaux dès le chargement de l'app", pour que
// cliquer "Infini" depuis le menu titre (qui saute désormais directement
// au jeu, voir enterInfiniteDirect) ait de bonnes chances de trouver un
// niveau déjà prêt plutôt que d'afficher "génération…" à l'écran.
ensureLevelBuffer(infiniteConfig());

function starsLabel(tier) {
  return "★".repeat(tier) + "☆".repeat(3 - tier);
}

function loadInfiniteLevel(result) {
  // Ne touche PAS à `boardLocked` ici: son cycle de vie complet (pose à
  // `true`, attente du fondu de sortie, chargement, pause, fondu d'entrée,
  // repasse à `false`) est géré de bout en bout par `advanceAfterWin` — un
  // reset prématuré ici déverrouillerait le plateau AVANT la fin du fondu
  // d'entrée quand ce chargement vient d'elle (cas normal après une
  // victoire). Les appels manuels (clic sur "Nouveau niveau", Réinitialiser)
  // ne passent jamais par `advanceAfterWin`, donc `boardLocked` y vaut déjà
  // `false` et n'a rien à réinitialiser.
  lastInfiniteResult = result;
  currentLevelIndex = -1;
  currentLevel = result.level;
  grid = new LightUpGrid(currentLevel);
  const shownTier = result.measuredTier ?? result.requestedTier;
  infiniteLevelLabelEl.textContent = `∞ · ${starsLabel(shownTier)}`;
  infiniteBadgeEl.classList.toggle("hidden", result.confirmedUnique);
  startBoard();
}

/** Révèle le plateau Infini après une génération lancée depuis l'écran de
 * réglages ("Réglages" -> "Générer"): si "infinite-config" est le sommet
 * courant de la pile (poussé par btnInfiniteSettings), on le dépile pour
 * retrouver le "play" déjà présent en dessous plutôt que d'empiler un
 * second "play" par-dessus ou de laisser "infinite-config" au sommet — sans
 * ça, showView("play", ...) mettait bien le niveau à jour en mémoire mais
 * l'écran affiché restait "infinite-config" (renderActiveScreen() se fie
 * TOUJOURS au sommet de pile, jamais au nom passé à showView), ce qui
 * donnait l'impression que "Générer" ne faisait rien. Sans effet si l'appel
 * vient d'ailleurs (Niveau suivant, victoire): le sommet est alors déjà
 * "play", rien à dépiler. */
function revealPlayAfterGeneration() {
  if (viewStack[viewStack.length - 1] === "infinite-config") viewStack.pop();
  showView("play", { mode: "infinite" });
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
    revealPlayAfterGeneration();
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
    revealPlayAfterGeneration();
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
btnInfiniteNext.onclick = () => {
  // Bloqué pendant la transition de fin de niveau (boardLocked): sinon un
  // double appel à runGeneration (celui-ci + celui déjà en cours dans
  // advanceAfterWin) pourrait charger deux niveaux à la suite.
  if (!boardLocked) runGeneration({ intoBoard: true });
};
btnInfiniteSettings.onclick = () => {
  // "Réglages" pousse un NOUVEL écran (pas juste un panneau interne): Retour
  // depuis les réglages doit ramener au plateau en cours, pas au menu titre
  // — voir goBack()/showView().
  pushView("infinite-config");
};

document.getElementById("btn-prev").onclick = () => {
  if (!boardLocked) loadLevel(currentLevelIndex - 1);
};
document.getElementById("btn-next").onclick = () => {
  if (!boardLocked) loadLevel(currentLevelIndex + 1);
};

document.getElementById("btn-reset").onclick = () => {
  if (boardLocked) return;
  if (mode === "infinite" && lastInfiniteResult) loadInfiniteLevel(lastInfiniteResult);
  else loadLevel(currentLevelIndex);
};

// ---------- Sélection de niveau (Histoire) ----------
const levelGridEl = document.getElementById("level-grid");
const storyProgressFillEl = document.getElementById("story-progress-fill");
const storyProgressTextEl = document.getElementById("story-progress-text");

function renderLevelGrid() {
  levelGridEl.innerHTML = "";
  const unlocked = unlockedCount(storyProgress, levels.length);
  for (let i = 0; i < levels.length; i++) {
    const tile = document.createElement("button");
    const isUnlocked = i < unlocked;
    const isDone = storyProgress.has(i);
    tile.className = "level-tile" + (isDone ? " level-tile--done" : "") + (isUnlocked ? "" : " level-tile--locked");
    tile.disabled = !isUnlocked;
    if (isUnlocked) {
      tile.onclick = () => {
        pushView("play", { mode: "story", levelIndex: i });
      };
    }
    const num = document.createElement("span");
    num.className = "level-tile-num";
    num.textContent = String(i + 1);
    tile.appendChild(num);
    // Le badge "check" des niveaux terminés a été retiré (retour
    // utilisateur: "je suis pas fan") — .level-tile--done (voir le
    // className plus haut) suffit à les distinguer visuellement.
    if (!isDone && !isUnlocked) {
      const lock = document.createElement("span");
      lock.className = "level-tile-lock";
      lock.innerHTML =
        '<svg viewBox="0 0 24 24" class="icon-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
      tile.appendChild(lock);
    }
    levelGridEl.appendChild(tile);
  }
}

const btnLevelGrid = document.getElementById("btn-level-grid");

btnLevelGrid.onclick = () => {
  if (boardLocked) return;
  pushView("story-select");
};

// ---------- Communauté (créer / partager / jouer, tout local) ----------
// Voir game/community-store.js: aucun vrai backend pour l'instant (retour
// utilisateur — "tout local, feed simulé") — ce fichier n'affiche/filtre que
// ce que ce module calcule, jamais de logique de stockage ici. Réutilise
// FEATURE_ICON_HTML (voir Mode Infini ci-dessus) pour les icônes de
// mécaniques des cartes, exactement comme les tuiles de réglages Infini —
// même raison: cohérence visuelle avec le jeu plutôt que des glyphes à part.
const communitySearchEl = document.getElementById("community-search");
const communitySortEl = document.getElementById("community-sort");
const communityFeedEl = document.getElementById("community-feed");
const communityEmptyEl = document.getElementById("community-empty");
const btnCommunityCreate = document.getElementById("btn-community-create");
const btnCommunityImport = document.getElementById("btn-community-import");
const btnCommunityProfile = document.getElementById("btn-community-profile");

const communityImportModal = document.getElementById("community-import-modal");
const communityImportInputEl = document.getElementById("community-import-input");
const communityImportStatusEl = document.getElementById("community-import-status");
const btnCommunityImportConfirm = document.getElementById("btn-community-import-confirm");

const communityShareModal = document.getElementById("community-share-modal");
const communityShareOutputEl = document.getElementById("community-share-output");

const communityRateModal = document.getElementById("community-rate-modal");
const communityRateTextEl = document.getElementById("community-rate-text");
const btnCommunityRateLike = document.getElementById("btn-community-rate-like");

const navCommunityEl = document.getElementById("nav-community");
const communityLevelTitleEl = document.getElementById("community-level-title");
const communityLevelAuthorEl = document.getElementById("community-level-author");
const btnCommunityLike = document.getElementById("btn-community-like");

const profileAvatarPreviewEl = document.getElementById("profile-avatar-preview");
const profilePseudoInput = document.getElementById("profile-pseudo");
const profileAvatarPicker = document.getElementById("profile-avatar-picker");
const btnProfileSave = document.getElementById("btn-profile-save");
const profileStatusEl = document.getElementById("profile-status");
const profilePublishedEl = document.getElementById("profile-published");
const profilePublishedEmptyEl = document.getElementById("profile-published-empty");
const profileLikedEl = document.getElementById("profile-liked");
const profileLikedEmptyEl = document.getElementById("profile-liked-empty");
const profileSommationBadgesEl = document.getElementById("profile-sommation-badges");

let communitySearch = "";
let communitySort = "recent";
let currentCommunityLevel = null; // grille en cours en mode "community" — voir loadCommunityLevel
let selectedProfileAvatar = AVATAR_CHOICES[0];

/** Carte d'une grille communautaire — réutilisée à l'identique dans le fil
 * principal et dans "Mon profil" (mes publications / mes favoris). Le
 * bouton "Retirer" (showUnpublish) n'apparaît que sur vos propres créations
 * listées depuis votre profil — jamais sur le fil principal, pour éviter
 * qu'il se confonde avec une action de modération sur les grilles des
 * autres. `onChange` permet à l'appelant de se re-rendre après une action
 * (like/retrait) sans dupliquer cette logique à chaque site d'appel. */
function buildCommunityCard(level, { showUnpublish = false, onChange } = {}) {
  const card = document.createElement("div");
  card.className = "community-card";

  const top = document.createElement("div");
  top.className = "community-card-top";
  const title = document.createElement("span");
  title.className = "community-card-title";
  title.textContent = level.title || "(sans titre)";
  const difficulty = document.createElement("span");
  difficulty.className = "community-card-difficulty";
  difficulty.textContent = starsLabel(level.difficulty ?? 1);
  top.append(title, difficulty);

  const byline = document.createElement("div");
  byline.className = "community-card-byline";
  const avatar = document.createElement("span");
  avatar.className = "community-avatar";
  avatar.textContent = level.author?.avatar ?? "🙂";
  const pseudo = document.createElement("span");
  pseudo.textContent = level.author?.pseudo ?? "Joueur";
  byline.append(avatar, pseudo);

  const mechanicsRow = document.createElement("div");
  mechanicsRow.className = "community-card-mechanics";
  for (const key of level.mechanics || []) {
    const icon = document.createElement("span");
    icon.className = "community-mechanic-icon";
    icon.title = FEATURES[key]?.label ?? key;
    icon.innerHTML = `<span class="cell-icon">${FEATURE_ICON_HTML[key] ?? ""}</span>`;
    mechanicsRow.appendChild(icon);
  }

  const bottom = document.createElement("div");
  bottom.className = "community-card-bottom";

  const likeBtn = document.createElement("button");
  likeBtn.type = "button";
  likeBtn.className = "community-card-like" + (level.likedByMe ? " liked" : "");
  likeBtn.setAttribute("aria-label", "Aimer cette grille");
  likeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" class="icon-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.9a5.5 5.5 0 0 0-7.8 0L12 5.9l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.5l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8Z"></path></svg>';
  likeBtn.addEventListener("click", () => {
    toggleLike(level.id);
    onChange?.();
  });

  const likesStat = document.createElement("span");
  likesStat.className = "community-card-stat";
  likesStat.textContent = `${level.likes} ❤`;
  const playsStat = document.createElement("span");
  playsStat.className = "community-card-stat";
  playsStat.textContent = `${level.plays} partie${level.plays === 1 ? "" : "s"}`;

  const spacer = document.createElement("span");
  spacer.className = "community-card-spacer";

  bottom.append(likeBtn, likesStat, playsStat, spacer);

  if (level.source === "local") {
    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.className = "community-card-btn";
    shareBtn.textContent = "Partager";
    shareBtn.addEventListener("click", () => openShareModal(level));
    bottom.appendChild(shareBtn);
  }

  if (showUnpublish) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "community-card-btn";
    removeBtn.textContent = "Retirer";
    removeBtn.addEventListener("click", () => {
      unpublishLevel(level.id);
      onChange?.();
    });
    bottom.appendChild(removeBtn);
  }

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "community-card-btn";
  playBtn.textContent = "Jouer";
  playBtn.addEventListener("click", () => {
    loadCommunityLevel(level);
    pushView("play", { mode: "community" });
  });
  bottom.appendChild(playBtn);

  card.append(top, byline);
  if (mechanicsRow.childElementCount > 0) card.appendChild(mechanicsRow);
  card.appendChild(bottom);
  return card;
}

function renderCommunityFeed() {
  const query = communitySearch.trim().toLowerCase();
  let list = listLevels().filter((level) => {
    if (!query) return true;
    return level.title?.toLowerCase().includes(query) || level.author?.pseudo?.toLowerCase().includes(query);
  });

  list = list.slice().sort((a, b) => {
    if (communitySort === "likes") return b.likes - a.likes;
    if (communitySort === "plays") return b.plays - a.plays;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  communityFeedEl.innerHTML = "";
  for (const level of list) {
    communityFeedEl.appendChild(buildCommunityCard(level, { onChange: renderCommunityFeed }));
  }
  communityEmptyEl.classList.toggle("hidden", list.length > 0);
}

btnCommunityCreate.onclick = () => pushView("editor");
btnCommunityProfile.onclick = () => pushView("community-profile");

communitySearchEl.addEventListener("input", () => {
  communitySearch = communitySearchEl.value;
  renderCommunityFeed();
});
communitySortEl.addEventListener("change", () => {
  communitySort = communitySortEl.value;
  renderCommunityFeed();
});

btnCommunityImport.onclick = () => {
  communityImportInputEl.value = "";
  communityImportStatusEl.textContent = "";
  communityImportModal.classList.remove("hidden");
};
document.querySelectorAll("[data-community-import-close]").forEach((el) => {
  el.onclick = () => communityImportModal.classList.add("hidden");
});
btnCommunityImportConfirm.onclick = () => {
  const { level, error } = decodeShareCode(communityImportInputEl.value);
  if (error) {
    communityImportStatusEl.textContent = error;
    return;
  }
  importSharedLevel(level);
  communityImportModal.classList.add("hidden");
  renderCommunityFeed();
};

/** Affiche le code de partage d'UNE de vos grilles (voir community-store.js:
 * encodeShareCode) — jamais pour une grille seed/d'un autre joueur (voir
 * buildCommunityCard: le bouton n'existe que quand `source === "local"`). */
function openShareModal(level) {
  communityShareOutputEl.value = encodeShareCode(level);
  communityShareModal.classList.remove("hidden");
  communityShareOutputEl.focus();
  communityShareOutputEl.select();
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(communityShareOutputEl.value).catch(() => {});
  }
}
document.querySelectorAll("[data-community-share-close]").forEach((el) => {
  el.onclick = () => communityShareModal.classList.add("hidden");
});

/** Demande explicitement au joueur s'il a aimé la grille qu'il vient de
 * résoudre (retour utilisateur: on avait dit qu'on demanderait, la V1 ne
 * faisait que laisser un bouton "aimer" disponible pendant la partie sans
 * jamais relancer la question) — voir advanceAfterWin: n'est appelée QUE si
 * la grille n'est pas déjà aimée (pas la peine de redemander sinon). */
function openCommunityRateModal(level) {
  communityRateTextEl.textContent = `"${level.title}" — de ${level.author?.pseudo ?? "Joueur"}.`;
  communityRateModal.classList.remove("hidden");
}
function closeCommunityRateModal() {
  communityRateModal.classList.add("hidden");
}
document.querySelectorAll("[data-community-rate-skip]").forEach((el) => {
  el.onclick = () => {
    closeCommunityRateModal();
    goBack();
  };
});
btnCommunityRateLike.onclick = () => {
  if (currentCommunityLevel) toggleLike(currentCommunityLevel.id);
  closeCommunityRateModal();
  goBack();
};

/** Charge une grille communautaire dans le plateau de jeu partagé — même
 * chemin que loadLevel/loadInfiniteLevel (grid/renderer/handleCellClick
 * strictement identiques), seule la provenance de la grille change. */
function loadCommunityLevel(level) {
  currentCommunityLevel = level;
  currentLevelIndex = -1;
  currentLevel = { name: level.title, rows: level.rows, cols: level.cols, cells: level.cells };
  grid = new LightUpGrid(currentLevel);
  communityLevelTitleEl.textContent = level.title;
  communityLevelAuthorEl.textContent = `${level.author?.avatar ?? ""} ${level.author?.pseudo ?? "Joueur"}`;
  refreshCommunityLikeButton();
  startBoard();
}

/** Relit toujours l'état depuis community-store.js (jamais mis en cache
 * localement) — un like posé depuis "Mon profil" juste avant, par exemple,
 * doit se refléter ici sans action supplémentaire. */
function refreshCommunityLikeButton() {
  if (!currentCommunityLevel) return;
  const fresh = getLevel(currentCommunityLevel.id);
  btnCommunityLike.classList.toggle("liked", !!fresh?.likedByMe);
}

btnCommunityLike.onclick = () => {
  if (!currentCommunityLevel) return;
  toggleLike(currentCommunityLevel.id);
  refreshCommunityLikeButton();
};

// ---------- Mon profil ----------
function refreshProfileAvatarPicker() {
  profileAvatarPicker.innerHTML = "";
  for (const avatar of AVATAR_CHOICES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "profile-avatar-btn" + (avatar === selectedProfileAvatar ? " active" : "");
    btn.textContent = avatar;
    btn.addEventListener("click", () => {
      selectedProfileAvatar = avatar;
      profileAvatarPreviewEl.textContent = avatar;
      refreshProfileAvatarPicker();
    });
    profileAvatarPicker.appendChild(btn);
  }
}

/** Ré-exécutée à chaque affichage de l'écran (voir showView) — comme
 * renderLevelGrid/renderShop, jamais figée sur un rendu périmé (ex: un like
 * posé depuis le fil principal doit apparaître dans "Mes favoris" au
 * prochain passage ici). */
function renderCommunityProfile() {
  const profile = loadProfile();
  profilePseudoInput.value = profile?.pseudo ?? "";
  selectedProfileAvatar = profile?.avatar ?? AVATAR_CHOICES[0];
  profileAvatarPreviewEl.textContent = selectedProfileAvatar;
  refreshProfileAvatarPicker();
  profileStatusEl.textContent = "";

  const mine = listLevels().filter((l) => l.source === "local");
  profilePublishedEl.innerHTML = "";
  for (const level of mine) {
    profilePublishedEl.appendChild(
      buildCommunityCard(level, { showUnpublish: true, onChange: renderCommunityProfile })
    );
  }
  profilePublishedEmptyEl.classList.toggle("hidden", mine.length > 0);

  const liked = likedLevels();
  profileLikedEl.innerHTML = "";
  for (const level of liked) {
    profileLikedEl.appendChild(buildCommunityCard(level, { onChange: renderCommunityProfile }));
  }
  profileLikedEmptyEl.classList.toggle("hidden", liked.length > 0);

  // Bannières Remember — retour utilisateur round 10: "les badges doivent
  // être progressifs et englober le pseudo du joueur (comme une sorte de
  // bannière)". Construites via DOM API (pas innerHTML) pour que le pseudo,
  // saisi librement par le joueur, ne soit jamais interprété comme du HTML
  // — même principe que buildCommunityCard: pseudo/textContent (voir plus
  // bas). Le tier (1-4, voir sommation.js: getSommationBadges) pilote
  // uniquement l'habillage CSS (.badge-banner--tier-N), de plus en plus
  // élaboré à mesure que le joueur progresse.
  if (profileSommationBadgesEl) {
    profileSommationBadgesEl.innerHTML = "";
    const pseudo = profile?.pseudo?.trim() || "Joueur";
    for (const badge of getSommationBadges()) {
      const banner = document.createElement("div");
      banner.className =
        `badge-banner badge-banner--tier-${badge.tier}` + (badge.earned ? " earned" : " locked");

      const deco = document.createElement("div");
      deco.className = "badge-banner-deco";
      deco.setAttribute("aria-hidden", "true");
      banner.appendChild(deco);

      const pseudoEl = document.createElement("span");
      pseudoEl.className = "badge-banner-pseudo";
      pseudoEl.textContent = badge.earned ? pseudo : "?????";
      banner.appendChild(pseudoEl);

      const nameEl = document.createElement("span");
      nameEl.className = "badge-banner-name";
      nameEl.textContent = badge.earned ? badge.name : "Verrouillé";
      banner.appendChild(nameEl);

      profileSommationBadgesEl.appendChild(banner);
    }
  }
}

btnProfileSave.onclick = () => {
  const pseudo = profilePseudoInput.value.trim();
  if (!pseudo) {
    profileStatusEl.textContent = "Choisis un pseudo avant d'enregistrer.";
    return;
  }
  saveProfile({ pseudo, avatar: selectedProfileAvatar });
  profileStatusEl.textContent = "Profil enregistré.";
};

// ---------- Bascule Jouer / Infini / Éditeur ----------
const playView = document.getElementById("play-view");
const editorView = document.getElementById("editor-view");

let mode = "play";

/** Bascule l'affichage à l'intérieur de l'écran "play" (déjà visible) entre
 * le plateau statique et le plateau/bandeau Infini — ne touche PAS à la
 * navigation (voir showView) ni à quel niveau est chargé. Bascule aussi les
 * deux boutons icône juste à côté du bouton Retour (sélection de niveau en
 * Histoire, réglages en Infini — retour utilisateur: "juste à côté du
 * bouton retour, même format"), qui vivent désormais dans l'en-tête plutôt
 * que dans nav-static/nav-infinite. */
function setMode(next) {
  mode = next;
  if (next === "story") {
    navStaticEl.classList.remove("hidden");
    navInfiniteEl.classList.add("hidden");
    navCommunityEl.classList.add("hidden");
    btnLevelGrid.classList.remove("hidden");
    btnInfiniteSettings.classList.add("hidden");
    btnInfiniteNext.classList.add("hidden");
    btnCommunityLike.classList.add("hidden");
    playView.classList.remove("hidden");
    return;
  }
  if (next === "community") {
    navStaticEl.classList.add("hidden");
    navInfiniteEl.classList.add("hidden");
    navCommunityEl.classList.remove("hidden");
    btnLevelGrid.classList.add("hidden");
    btnInfiniteSettings.classList.add("hidden");
    btnInfiniteNext.classList.add("hidden");
    btnCommunityLike.classList.remove("hidden");
    playView.classList.remove("hidden");
    return;
  }
  // next === "infinite"
  navStaticEl.classList.add("hidden");
  navInfiniteEl.classList.remove("hidden");
  navCommunityEl.classList.add("hidden");
  btnLevelGrid.classList.add("hidden");
  btnInfiniteSettings.classList.remove("hidden");
  btnInfiniteNext.classList.remove("hidden");
  btnCommunityLike.classList.add("hidden");
  playView.classList.remove("hidden");
}

const editorApi = initEditor({ levels });
const sommationApi = initSommation({ getPoints: () => infinitePoints, spendPoints: spendSharedPoints, addPoints: addSharedPoints });

// ---------- Navigation (pile d'écrans + bouton Retour générique) ----------
// Prototype mono-page: tous les écrans coexistent dans le DOM, un seul est
// visible à la fois (classe .screen, voir style.css). Plutôt qu'un vrai
// routeur, une pile en mémoire (`viewStack`) suffit: `pushView` empile et
// affiche, `goBack` dépile et réaffiche l'écran juste en dessous. Le titre
// est toujours la racine (jamais dépilé au-delà).
//
// Cas particulier Histoire (retour utilisateur: "quand on sélectionne
// Campagne dans le menu on saute l'étape de sélection et on arrive
// directement dans le niveau en cours [...] finalement, lorsqu'on fait
// Retour depuis là, on revient directement au menu, pas à la sélection de
// niveaux, on a déjà un bouton pour ça"): le raccourci "Histoire" depuis le
// menu titre n'empile PAS "story-select" — Retour va donc directement au
// menu. La sélection de niveaux reste accessible à tout moment via le
// bouton dédié dans l'en-tête du jeu (`btn-level-grid`, voir plus bas), qui
// lui EMPILE normalement "story-select" — Retour depuis LÀ revient bien au
// jeu, cette fois.
const SCREEN_IDS = {
  title: "view-title",
  "story-select": "view-story-select",
  play: "view-play",
  "infinite-config": "view-infinite-config",
  options: "view-options",
  community: "view-community",
  "community-profile": "view-community-profile",
  editor: "view-editor",
  sommation: "view-sommation",
};

let viewStack = ["title"];

const btnFloatingEditor = document.getElementById("btn-floating-editor");

function renderActiveScreen() {
  const active = viewStack[viewStack.length - 1];
  for (const [name, id] of Object.entries(SCREEN_IDS)) {
    document.getElementById(id).classList.toggle("hidden", name !== active);
  }
  // Éditeur (outil développeur): le bouton flottant qui y mène ne doit
  // apparaître qu'à l'écran titre (voir style.css) — inutile ailleurs et
  // risquerait de gêner le jeu.
  btnFloatingEditor.classList.toggle("hidden", active !== "title");
}

/** Affiche un écran SANS toucher à la pile (utilisé par les raccourcis qui
 * ont déjà préparé la pile eux-mêmes, ex. enterStoryDirect/enterInfinite).
 * Ré-exécutée à CHAQUE affichage d'un écran (push, retour, ou pile préparée
 * à la main) — pas seulement au premier passage — pour qu'un écran comme
 * "story-select" ne reste jamais figé sur un rendu périmé. Corrige un bug
 * observé: "Histoire" (raccourci direct) puis "Retour" affichait une
 * grille de sélection vide, faute d'avoir jamais appelé renderLevelGrid()
 * sur ce chemin (seul pushView() le faisait auparavant). */
function showView(name, opts) {
  // Si `opts.mode` n'est pas fourni (ex: goBack() qui rappelle showView
  // sans opts), on garde le mode DÉJÀ actif plutôt que de retomber sur
  // "story" par défaut — sinon "Retour" depuis les réglages Infini
  // ramenait au plateau Histoire au lieu du plateau Infini en cours.
  if (name === "play") setMode(opts?.mode ?? mode);
  if (opts?.levelIndex != null) loadLevel(opts.levelIndex);
  if (name === "story-select") renderLevelGrid();
  if (name === "community") renderCommunityFeed();
  if (name === "community-profile") renderCommunityProfile();
  if (name === "editor") editorApi.onShow();
  if (name === "sommation") sommationApi.onShow();
  if (name === "options") renderPixelArtOption();
  renderActiveScreen();
}

/** Empile et affiche un nouvel écran — c'est la navigation "normale" (un
 * clic qui va vers l'avant). */
function pushView(name, opts) {
  viewStack.push(name);
  showView(name, opts);
}

/** Bouton Retour générique: dépile UN écran (jamais en dessous de "title",
 * la racine). Bloqué pendant la transition de fin de niveau, comme les
 * autres actions de navigation en jeu. */
function goBack() {
  if (boardLocked) return;
  if (viewStack.length <= 1) return;
  viewStack.pop();
  showView(viewStack[viewStack.length - 1]);
}

document.querySelectorAll("[data-back]").forEach((btn) => (btn.onclick = goBack));

/** "Histoire" depuis le menu titre: saute l'étape de sélection (voir
 * commentaire plus haut) — empile directement "play" sur "title", sans
 * "story-select" intermédiaire : Retour va donc droit au menu (la
 * sélection de niveaux reste un aller simple depuis le bouton dédié dans
 * le jeu, pas une étape que Retour doit retrouver). */
function enterStoryDirect() {
  const target = currentStoryIndex(storyProgress, levels.length);
  viewStack = ["title", "play"];
  showView("play", { mode: "story", levelIndex: target });
}

/** "Infini" depuis le menu titre: même principe que l'Histoire — on saute
 * TOUJOURS l'écran de réglages et on arrive directement dans le jeu (retour
 * utilisateur: "je veux directement arriver au jeu, on passe la page de
 * réglages"), qui reste accessible ensuite via "Réglages" depuis le
 * plateau. Si une partie est déjà en cours, on la retrouve telle quelle ;
 * sinon on génère un niveau à la volée — quasi instantané en pratique grâce
 * au buffer amorcé dès le chargement de l'app (voir ensureLevelBuffer plus
 * bas), le plateau affiche "génération…" le temps très bref où il ne
 * l'est pas encore. */
function enterInfiniteDirect() {
  viewStack = ["title", "play"];
  if (lastInfiniteResult) {
    showView("play", { mode: "infinite" });
  } else {
    setMode("infinite");
    renderActiveScreen();
    runGeneration({ intoBoard: true });
  }
}

/** "Remember" depuis le menu titre — retour utilisateur: "le mode Sommation
 * va prendre la place de Secrets... on arrive directement dans le mode
 * Sommation". Même principe que enterStoryDirect/enterInfiniteDirect: on
 * saute toute étape intermédiaire (il n'y en a plus, l'ancienne boutique
 * Secrets a été retirée) et "Retour" ramène directement au menu titre. */
function enterRememberDirect() {
  viewStack = ["title", "sommation"];
  showView("sommation");
}

document.getElementById("menu-story").onclick = enterStoryDirect;
document.getElementById("menu-infinite").onclick = enterInfiniteDirect;
document.getElementById("menu-community").onclick = () => pushView("community");
document.getElementById("menu-remember").onclick = enterRememberDirect;
document.getElementById("menu-options").onclick = () => pushView("options");
document.getElementById("btn-floating-editor").onclick = () => pushView("editor");

renderActiveScreen();
renderTitleStoryProgress();

// Raccourci Ctrl+Z / Cmd+Z pour annuler, en jeu comme en Infini (pas en
// éditeur: on laisse le Ctrl+Z natif du navigateur fonctionner dans les
// champs de l'éditeur, ex. le nom du niveau) et jamais quand le focus est
// déjà sur un champ de saisie (même raison).
window.addEventListener("keydown", (e) => {
  const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z";
  if (!isUndo || viewStack[viewStack.length - 1] === "editor") return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  e.preventDefault();
  undoLastMove();
});

// --cell-size est désormais responsive (voir style.css: #board), donc un
// redimensionnement/changement d'orientation sur mobile peut faire changer
// la taille réelle des cases après coup. Les lasers/fils de neurone miroir
// sont positionnés en pixels absolus (voir game/render.js: cellCenter, qui
// mesure la case via getBoundingClientRect) — sans ce re-rendu, ils
// resteraient figés à l'ancienne taille jusqu'au prochain coup. Debounce
// pour ne pas re-rendre à chaque pixel pendant un redimensionnement en
// continu (resize de fenêtre desktop).
let resizeDebounceId = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeDebounceId);
  resizeDebounceId = setTimeout(() => renderer.render(), 120);
});

// Charge le niveau Histoire courant en mémoire dès le départ (pas encore
// affiché tant que l'écran titre est actif) pour que le plateau soit déjà
// prêt si le joueur clique "Histoire" — évite un plateau vide entraperçu au
// tout premier changement d'écran. `enterStoryDirect`/`showView` rechargeront
// ce même niveau au clic (redondant mais inoffensif) plutôt que de dupliquer
// ici la logique de mise en visibilité de setMode.
setMode("story");
loadLevel(currentStoryIndex(storyProgress, levels.length));
