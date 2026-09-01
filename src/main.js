import { LightUpGrid } from "./game/grid.js";
import { levels } from "./game/levels.js";
import { findSolution } from "./game/solver.js";
// Round 20 (migration Capacitor/AdMob) — no-op silencieux hors app native
// (voir game/ads.js), donc sûr à appeler ici même pendant `npm run dev`.
import { initAds, showRewardedAd, showInterstitialAd } from "./game/ads.js";
// Round 24 (retour utilisateur: "retour haptique sur les boutons de
// navigation en général, et dans le jeu et le mode remember") — no-op
// silencieux hors app native (même garde que ads.js), donc sûr à appeler ici
// même pendant `npm run dev`.
import { hapticLight, hapticWarning, hapticSuccess } from "./game/haptics.js";
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
  refreshMusicTheme,
} from "./game/music.js";
import {
  createBoardRenderer,
  chargeIcon,
  synapseIcon,
  mirrorIcon,
  prismIcon,
  pyraIcon,
  mirrorNeuronIcon,
} from "./game/render.js";
import { initEditor } from "./editor.js";
import {
  initSommation,
  getSommationBadges,
  isPixelArtUnlocked,
  debugUnlockPixelArt,
  resetSommationProgress,
} from "./sommation.js";
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
  updateProfile,
  loadSeenMechanics,
  saveSeenMechanics,
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
  detectMechanics,
  AVATARS,
  isAvatarUnlocked,
  avatarUnlockLabel,
  getAvatarSvg,
  DEFAULT_AVATAR,
  initCommunityCloud,
  onLevelsChanged,
} from "./game/community-store.js";

// Round 24 (retour utilisateur: "retour haptique sur les boutons de
// navigation en général") — UN SEUL listener délégué plutôt que d'ajouter
// hapticLight() à chaque handler de bouton un par un (des dizaines, répartis
// entre main.js/editor.js/sommation.js): capture tout clic qui atteint un
// <button> non désactivé, y compris ceux créés dynamiquement (cartes
// Communauté, tuiles d'avatar...) puisque la délégation écoute sur document.
// Volontairement scopé aux <button> (jamais aux cases du plateau .cell ni
// aux générateurs Remember .som-cell, qui sont des <div>) — ceux-ci ont leur
// propre retour haptique dédié, plus riche (succès/échec), voir
// handleCellClick ci-dessous et sommation.js.
document.addEventListener(
  "click",
  (e) => {
    const btn = e.target.closest("button");
    if (btn && !btn.disabled) hapticLight();
  },
  { capture: true }
);

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
// Round 23 (retour utilisateur: "lorsqu'on termine une grille, on passe
// trop vite à la suivante [...] ça serait bien de marquer un temps avant de
// faire disparaître la grille actuelle afin que le joueur puisse intégrer
// l'information qu'il a réussi") — pause AVANT même le fondu de sortie
// (voir advanceAfterWin ci-dessous), le temps de voir la grille résolue au
// repos. Scopée au mode Histoire uniquement (c'est le seul cité par le
// retour utilisateur) — l'Infini enchaîne les grilles trop vite pour ce
// genre de pause sans nuire au rythme voulu, et Communauté redemande de
// toute façon une note juste après (voir openCommunityRateModal).
const STORY_WIN_HOLD_MS = 1100;

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
  if (mode === "story") await wait(STORY_WIN_HOLD_MS);
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

// Round 23 (retour utilisateur: "lors du mode histoire, dans la
// progression, ça n'est pas assez clair pour le joueur de comprendre les
// mécaniques [...] on pourrait essayer d'intégrer des 'schéma' qui
// expliquent les mécaniques de façon très simplifiée à chaque nouveau
// composant ajouté") — voir showMechanicSchemaModal() plus bas, appelée
// depuis loadLevel(). Un Set persisté (voir storage.js:
// loadSeenMechanics/saveSeenMechanics), même principe que storyProgress:
// une mécanique montrée une fois ne se réexplique plus jamais, sauf
// réinitialisation complète du jeu.
let seenMechanics = loadSeenMechanics();

function markStoryLevelCompleted(index) {
  if (index < 0 || index >= levels.length) return; // garde-fou: index invalide (ne devrait pas arriver)
  if (storyProgress.has(index)) return; // déjà fait: rejouer un niveau ne change rien à la progression
  storyProgress.add(index);
  saveStoryProgress(storyProgress);
  renderTitleStoryProgress();
  // Round 22 (retour utilisateur): "les 3 suivants [avatars] se débloquent
  // dans le mode campagne (tous les 10 niveaux) [...] il faudra freeze le
  // jeu lors du déblocage [...] avec une animation en modale [...] pour
  // montrer au joueur qu'il a débloqué tel ou tel cosmétique" — un seul
  // avatar "story" peut correspondre à CE seuil précis (voir
  // community-store.js: AVATARS, unlock.type === "story"/level), jamais
  // recalculé depuis storyProgress.size ailleurs que dans avatarUnlocks().
  const unlockedAvatar = AVATARS.find((a) => a.unlock?.type === "story" && a.unlock.level === storyProgress.size);
  if (unlockedAvatar) {
    showCosmeticUnlockModal({
      kind: "avatar",
      avatarId: unlockedAvatar.id,
      title: `Avatar « ${unlockedAvatar.label} »`,
      subtitle: `Débloqué en terminant ${storyProgress.size} niveaux de l'Histoire !`,
    });
  }
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
  // Une fois PixelArt débloqué (5e et dernière récompense de Remember), le
  // mode est terminé (retour utilisateur round 12: "il sera marqué comme
  // terminé et ne sera plus jouable") — la carte du menu titre l'affiche à
  // la place du solde de points, qui n'a plus de sens ici (voir
  // enterRememberDirect ci-dessous: le clic ouvre quand même Remember, qui
  // affiche alors son propre état "terminé" — voir sommation.js: onShow()).
  menuPointsBadgeEl.textContent = isPixelArtUnlocked() ? "Terminé" : label;
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
  // Round 23: voir queueNewMechanicSchemas() plus bas — uniquement le mode
  // Histoire (seul mode qui appelle loadLevel(), voir plus haut).
  queueNewMechanicSchemas(currentLevel.cells);
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
  if (result === "placed") {
    playPlace();
    hapticLight();
  } else if (result === "removed") {
    playRemove();
    hapticLight();
  } else {
    playError();
    hapticWarning();
  }

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
    hapticSuccess();
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
  // Round 24: pas de hapticLight() ici — undoLastMove() est TOUJOURS déclenché
  // par btnUndo (un <button>), déjà couvert par le listener délégué global
  // (voir plus haut) ; un second appel ici ferait vibrer deux fois pour un
  // seul geste.
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
// Round 21 (retour utilisateur): stock de départ ET récompense par pub tous
// deux ramenés de 10 à 5 — voir btnHintWatchAd.onclick plus bas.
// Round 23 (retour utilisateur: "les 5 indices en regardant la pub ne
// s'accompagnent pas de 50 points [...] les 50 points en regardant la pub,
// c'est uniquement dans Remember") — plus de récompense en points ici,
// SOMMATION_AD_POINTS_REWARD (sommation.js) reste seul à en accorder.
const HINT_STARTING_STOCK = 5;
const HINT_AD_HINTS_REWARD = 5;
const btnHint = document.getElementById("btn-hint");
const hintCountEl = document.getElementById("hint-count");
const hintModal = document.getElementById("hint-modal");
const btnHintWatchAd = document.getElementById("btn-hint-watch-ad");
const hintAdStatusEl = document.getElementById("hint-ad-status");

let hintStock = HINT_STARTING_STOCK;
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

function setHintAdStatus(text, isError) {
  if (!hintAdStatusEl) return;
  hintAdStatusEl.textContent = text ?? "";
  hintAdStatusEl.classList.toggle("hidden", !text);
  hintAdStatusEl.classList.toggle("hint-ad-status--error", !!isError);
}

function openHintModal() {
  // Repart toujours propre (bouton actif, pas de message résiduel d'une
  // tentative précédente) — même principe que sommation.js: openAdModal().
  setHintAdStatus(null);
  btnHintWatchAd.disabled = false;
  btnHintWatchAd.textContent = `Regarder la pub (+${HINT_AD_HINTS_REWARD} indices)`;
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

// ---------- Modale "cosmétique débloqué" ----------
// Round 22 (retour utilisateur): "il faudra freeze le jeu lors du déblocage
// d'un objet cosmétique [...] pareillement pour les badges [...] avec une
// animation en modale transparente mais fond sombre pour montrer au joueur
// qu'il a débloqué tel ou tel cosmétique" — réutilise le même mécanisme
// .modal/.modal-backdrop que les autres modales de ce fichier: le fond
// semi-transparent sombre de .modal-backdrop EST le "freeze" demandé (plus
// rien sous la modale n'est cliquable tant qu'elle reste ouverte), aucune
// plomberie boardLocked séparée n'est nécessaire. Un seul point d'entrée
// pour les DEUX types de cosmétiques — voir markStoryLevelCompleted() et
// refreshProfileAvatarPicker() plus bas pour les avatars (campagne/achat),
// sommation.js: pointsApi.onBadgeEarned (voir plus bas, initSommation) pour
// les badges Remember.
const cosmeticUnlockModal = document.getElementById("cosmetic-unlock-modal");
const cosmeticUnlockKickerEl = document.getElementById("cosmetic-unlock-kicker");
const cosmeticUnlockRevealEl = document.getElementById("cosmetic-unlock-reveal");
const cosmeticUnlockTitleEl = document.getElementById("cosmetic-unlock-title");
const cosmeticUnlockTextEl = document.getElementById("cosmetic-unlock-text");

/** @param {{kind: "avatar"|"badge", avatarId?: string, badgeTier?: number, title: string, subtitle: string}} opts */
function showCosmeticUnlockModal({ kind, avatarId, badgeTier, title, subtitle }) {
  cosmeticUnlockKickerEl.textContent = kind === "badge" ? "Nouveau badge débloqué" : "Nouvel avatar débloqué";
  cosmeticUnlockRevealEl.innerHTML = "";
  if (kind === "avatar") {
    const bubble = document.createElement("span");
    bubble.className = "cosmetic-unlock-avatar";
    bubble.innerHTML = getAvatarSvg(avatarId);
    cosmeticUnlockRevealEl.appendChild(bubble);
  } else {
    // Même langage visuel que les carrés teaser de sélection Remember (voir
    // badges.css: .badge-teaser--tier-N.earned), juste agrandi ici — jamais
    // un composant dupliqué, cohérent avec ce que le joueur reverra ensuite
    // dans "Mon profil".
    const tile = document.createElement("span");
    tile.className = `cosmetic-unlock-badge badge-teaser badge-teaser--tier-${badgeTier} earned`;
    const deco = document.createElement("span");
    deco.className = "badge-teaser-deco";
    deco.setAttribute("aria-hidden", "true");
    tile.appendChild(deco);
    cosmeticUnlockRevealEl.appendChild(tile);
  }
  cosmeticUnlockTitleEl.textContent = title;
  cosmeticUnlockTextEl.textContent = subtitle;
  cosmeticUnlockModal.classList.remove("hidden");
}

document.querySelectorAll("[data-cosmetic-unlock-close]").forEach((el) => {
  el.onclick = () => cosmeticUnlockModal.classList.add("hidden");
});

// Round 21 (retour utilisateur: "intégrer une pub-récompense lorsqu'on
// demande à recharger les indices") — remplace l'ancien placeholder gratuit,
// même principe que sommation.js: adWatchBtn.onclick (showRewardedAd() ne
// résout `earned: true` QUE sur confirmation du SDK, jamais de façon
// optimiste : indices ET points ne sont donc crédités que dans ce cas
// précis, jamais avant ni en cas d'échec/fermeture anticipée de la pub).
btnHintWatchAd.onclick = async () => {
  btnHintWatchAd.disabled = true;
  btnHintWatchAd.textContent = "Chargement…";
  setHintAdStatus(null);
  const { earned, reason } = await showRewardedAd();
  if (earned) {
    hintStock += HINT_AD_HINTS_REWARD;
    renderHintUI();
    closeHintModal();
    return;
  }
  btnHintWatchAd.disabled = false;
  btnHintWatchAd.textContent = `Regarder la pub (+${HINT_AD_HINTS_REWARD} indices)`;
  setHintAdStatus(
    reason === "unavailable"
      ? "Pas de pub disponible pour l'instant — réessaie dans un instant."
      : "Pub fermée avant la fin — rien de crédité.",
    true
  );
};

renderHintUI();

// ---------- Réglages persistants (son/musique/thème PixelArt) ----------
// Un seul curseur de volume commun aux sons ET à la musique (retour
// utilisateur: "ajouter une barre de réglage volume qui regle les deux en
// même temps pour plus de cohérence"), le tout persistant (voir storage.js).
//
// Round 19 (retour utilisateur): remise à plat du modèle de coupure du son.
// - `settings.muted` est un SEUL état "coupé", piloté indifféremment par le
//   bouton flottant (btnGlobalMute) ET le bouton Options (btnSoundToggle) —
//   "elles appellent la même fonction et variable: si l'un est activé,
//   l'autre aussi, et vice versa" (voir setMuted ci-dessous, seul point
//   d'écriture de `settings.muted`). Coupe son ET musique, et ramène
//   visuellement le curseur à 0 (voir applyVolumes) — mais ne touche JAMAIS
//   `settings.volume` lui-même, qui reste la valeur réelle voulue par le
//   joueur : la réactivation retrouve donc exactement le volume ET l'état
//   "musique coupée ou non" (musicMuted, indépendant) d'avant la coupure,
//   sans avoir besoin d'une sauvegarde séparée à restaurer.
// - Bouger le curseur manuellement à 0 n'active PAS `settings.muted` (retour
//   utilisateur: "si on réduit simplement le slider du son à zéro, ça ne
//   veut pas dire qu'on coupe le son [...] le résultat est le même mais dans
//   la logique de l'applicatif non") — le son est bien silencieux (volume
//   réel à 0), mais l'état interne "coupé" reste faux. À l'inverse, bouger
//   le curseur PENDANT que `muted` est actif démute automatiquement (sinon
//   le curseur mentirait en affichant une valeur non nulle alors que le son
//   resterait coupé).
// - `musicMuted` reste un réglage à part, orthogonal: couper UNIQUEMENT la
//   musique en gardant les effets sonores (bouton "Musique" d'Options).
const volumeSlider = document.getElementById("volume-slider");
const btnSoundToggle = document.getElementById("btn-sound-toggle");
const btnMusicToggle = document.getElementById("btn-music-toggle");
const btnGlobalMute = document.getElementById("btn-global-mute");

const settings = loadSettings();
btnMusicToggle.classList.toggle("muted", settings.musicMuted);

function applyVolumes() {
  const level = Number(settings.volume) / 100;
  setMasterVolume(settings.muted ? 0 : level);
  setMusicVolume(settings.muted || settings.musicMuted ? 0 : level);
  volumeSlider.value = settings.muted ? "0" : String(settings.volume);
  btnSoundToggle.classList.toggle("muted", settings.muted);
  btnGlobalMute.classList.toggle("muted", settings.muted);
}

/** Seul point d'écriture de `settings.muted` — voir commentaire ci-dessus:
 * le bouton flottant ET celui d'Options appellent tous les deux CETTE MÊME
 * fonction, jamais chacun leur propre variable. */
function setMuted(value) {
  settings.muted = value;
  saveSettings(settings);
  applyVolumes();
}

volumeSlider.addEventListener("input", () => {
  settings.volume = Number(volumeSlider.value);
  if (settings.muted) settings.muted = false; // voir commentaire ci-dessus: bouger le curseur démute
  saveSettings(settings);
  applyVolumes();
});

btnSoundToggle.addEventListener("click", () => setMuted(!settings.muted));
btnGlobalMute.addEventListener("click", () => setMuted(!settings.muted));

btnMusicToggle.addEventListener("click", () => {
  settings.musicMuted = !settings.musicMuted;
  saveSettings(settings);
  btnMusicToggle.classList.toggle("muted", settings.musicMuted);
  applyVolumes();
});

applyVolumes();

// Round 20 (migration Capacitor/AdMob): init une seule fois au chargement —
// consentement RGPD + ATT iOS + préchargement de la première rewarded ad
// (voir game/ads.js). Ne bloque jamais le reste du chargement de l'app (pas
// de await ici), et ne fait rien tant qu'on n'est pas dans la coquille
// native Capacitor.
initAds();

// Round 20 (Firestore): démarre l'écoute temps réel du fil communautaire +
// l'authentification anonyme (voir game/community-store.js). Comme initAds()
// ci-dessus, ne bloque jamais le chargement (pas de await) — tant que la
// première réponse Firestore n'est pas arrivée, le fil affiche juste la
// seed, sans jamais planter faute de réseau.
initCommunityCloud();
// Ré-affiche l'écran Communauté/Mon profil s'il est actif quand le fil
// change (nouvelle grille publiée par vous ou un autre joueur, résolution de
// l'uid anonyme...) — même logique de rendu que showView() pour ces deux
// écrans (voir plus bas), pour ne jamais laisser un fil périmé à l'écran
// après un aller-retour Firestore qui arrive après coup.
onLevelsChanged(() => {
  const active = viewStack[viewStack.length - 1];
  if (active === "community") renderCommunityFeed();
  else if (active === "community-profile") renderCommunityProfile();
});

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

// Round 19 (retour utilisateur): "réinitialiser le profil joueur doit aussi
// réinitialiser le Remember + les bonus débloqués. La seule donnée conservée
// sera les niveaux dans Communauté [...], les réglages son et le pseudo" —
// en plus de eraseAllProgress() (Histoire/Infini/pixelartEnabled, voir
// storage.js), efface aussi la progression Remember (sommation.js) et remet
// à zéro avatar+badge actif du profil (des "bonus débloqués" au même titre
// que PixelArt) SANS toucher au pseudo — updateProfile fusionne, jamais
// saveProfile qui écraserait tout l'objet.
document.getElementById("btn-reset-confirm").onclick = () => {
  eraseAllProgress();
  resetSommationProgress();
  // Round 22: `ownedAvatars` (avatars achetés avec des points, voir
  // community-store.js: unlock.type === "purchase") est lui aussi un "bonus
  // débloqué" au même titre qu'avatar/activeBadge ci-dessous — les points
  // eux-mêmes sont déjà remis à zéro par eraseAllProgress().
  updateProfile({ avatar: DEFAULT_AVATAR, activeBadge: null, ownedAvatars: [] });
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
  // Le plateau (Histoire/Infini) peut déjà être construit en mémoire même si
  // l'écran affiché en ce moment est Options (voir renderer, singleton créé
  // une seule fois plus haut) — sans ce re-render explicite, ses icônes ne
  // se reskinneraient qu'au prochain coup joué plutôt qu'immédiatement.
  if (renderer.grid) renderer.render();
  // Idem côté musique (round 13): si la musique tourne déjà, on recharge les
  // 11 pistes sur le jeu chiptune/lisse correspondant sans couper le mix en
  // cours (voir music.js: refreshMusicTheme). Sans effet si la musique n'a
  // pas encore démarré (ensureBuilt prendra le bon thème au premier départ).
  refreshMusicTheme();
};

// Débug: force le déverrouillage pour tester le thème sans finir le
// mini-jeu Remember à chaque fois (retour utilisateur round 11). Toujours
// dans le DOM (pas seulement quand verrouillé) par simplicité — cliquer une
// fois débloqué n'a plus d'effet (debugUnlockPixelArt ne redescend jamais
// le compteur), donc pas besoin de le masquer une fois inutile.
const btnPixelartDebugUnlock = document.getElementById("btn-pixelart-debug-unlock");
if (btnPixelartDebugUnlock) {
  btnPixelartDebugUnlock.onclick = () => {
    debugUnlockPixelArt();
    renderPixelArtOption();
  };
}

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

// Round 21 (retour utilisateur: "publicités courtes [...] tous les 5
// niveaux du mode infinity" mais "ne pas comptabiliser [...] avant qu'il ait
// posé au moins 6 lampes, afin qu'il puisse re-générer des niveaux autant
// qu'il veut [...] sans être spammé/bloqué") — voir loadInfiniteLevel(): un
// niveau ne compte QUE s'il a reçu au moins INFINITE_AD_MIN_LAMPS lampes
// avant d'être quitté (peu importe la raison: victoire, "Niveau suivant",
// changement de réglages...). Compteur volontairement EN MÉMOIRE seulement
// (même choix que hintStock ci-dessus) — se réinitialise au rechargement de
// la page, jamais persisté.
const INFINITE_AD_EVERY_N_LEVELS = 5;
const INFINITE_AD_MIN_LAMPS = 6;
let infiniteLevelsPlayedSinceAd = 0;

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
  // "filter" retiré (round 22: feature jamais implémentée, voir generator.js).
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

// ---------- Modales "schéma" pédagogiques (mode Histoire) ----------
// Round 23 (retour utilisateur: "lors du mode histoire, dans la
// progression, ça n'est pas assez clair pour le joueur de comprendre les
// mécaniques. On pourrait essayer d'intégrer des 'schéma' qui expliquent
// les mécaniques de façon très simplifiée à chaque nouveau composant
// ajouté") — une entrée par mécanique DÉTECTABLE (voir community-store.js:
// detectMechanics, même vocabulaire que les icônes de cartes Communauté et
// FEATURE_ICON_HTML ci-dessus, réutilisé tel quel pour le schéma: même
// rendu que partout ailleurs dans le jeu, pas une illustration à part).
// Volontairement PAS d'entrée pour la règle de base (case numérotée +
// lumière) : c'est la mécanique fondatrice, apprise dès le niveau 1 par le
// jeu lui-même — ces modales couvrent seulement ce qui s'AJOUTE par-dessus.
const MECHANIC_SCHEMAS = {
  forbidden: {
    title: "Case interdite",
    text: "Une case interdite ne peut jamais avoir de lumière juste à côté (en haut, en bas, à gauche ou à droite).",
  },
  color: {
    title: "Couleurs",
    text: "Une charge colorée tire un rayon de sa couleur vers la première lumière rencontrée. Une case cible attend un mélange précis de rouge/vert/bleu pour s'allumer correctement.",
  },
  mirror: {
    title: "Miroir",
    text: "Un miroir dévie un rayon coloré de 90°, sans jamais s'allumer lui-même.",
  },
  prism: {
    title: "Prisme",
    text: "Un prisme teinte automatiquement une lumière dans chacune de ses 4 directions, dès qu'il en voit une sur sa ligne ou sa colonne.",
  },
  pyra: {
    title: "Pyra",
    text: "Pyra s'active dès qu'il a entre 1 et 3 lumières autour de lui (pas besoin d'un compte exact), et tire un rayon dont la couleur dépend de ce nombre.",
  },
  mirrorNeuron: {
    title: "Neurone miroir",
    text: "Un neurone miroir duplique en symétrie toute lumière qui l'éclaire directement.",
  },
};

const mechanicSchemaModal = document.getElementById("mechanic-schema-modal");
const mechanicSchemaIconEl = document.getElementById("mechanic-schema-icon");
const mechanicSchemaTitleEl = document.getElementById("mechanic-schema-title");
const mechanicSchemaTextEl = document.getElementById("mechanic-schema-text");
// File d'attente: un même niveau peut (rarement) introduire plusieurs
// mécaniques à la fois — on les montre une par une plutôt que de les
// entasser dans une seule modale, jamais plus d'une à l'écran en même
// temps (voir showNextMechanicSchema ci-dessous).
let mechanicSchemaQueue = [];

function showNextMechanicSchema() {
  const key = mechanicSchemaQueue.shift();
  if (!key) {
    mechanicSchemaModal.classList.add("hidden");
    return;
  }
  const schema = MECHANIC_SCHEMAS[key];
  if (!schema) {
    showNextMechanicSchema();
    return;
  }
  mechanicSchemaIconEl.innerHTML = FEATURE_ICON_HTML[key] ?? "";
  mechanicSchemaTitleEl.textContent = schema.title;
  mechanicSchemaTextEl.textContent = schema.text;
  mechanicSchemaModal.classList.remove("hidden");
}

/** Appelée par loadLevel() (mode Histoire uniquement): compare les
 * mécaniques de la grille qui vient de charger à celles déjà vues (voir
 * storage.js: loadSeenMechanics/saveSeenMechanics), enfile les nouvelles et
 * les marque vues IMMÉDIATEMENT (pas seulement à la fermeture de la
 * modale — même si le joueur quitte l'écran sans la fermer, elle ne doit
 * jamais réapparaître pour la même mécanique). */
function queueNewMechanicSchemas(cells) {
  const found = detectMechanics(cells);
  const fresh = found.filter((key) => MECHANIC_SCHEMAS[key] && !seenMechanics.has(key));
  if (fresh.length === 0) return;
  for (const key of fresh) seenMechanics.add(key);
  saveSeenMechanics(seenMechanics);
  const alreadyShowing = !mechanicSchemaModal.classList.contains("hidden");
  mechanicSchemaQueue.push(...fresh);
  if (!alreadyShowing) showNextMechanicSchema();
}

document.querySelectorAll("[data-mechanic-schema-close]").forEach((el) => {
  el.onclick = showNextMechanicSchema; // ferme celle-ci, enchaîne sur la suivante s'il y en a une
});

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

  // Round 21: compte le niveau qu'on s'apprête à QUITTER (celui encore dans
  // `grid` à cet instant) s'il a reçu assez de lampes — voir constantes
  // ci-dessus. `result !== lastInfiniteResult` exclut le cas "Réinitialiser"
  // (voir btn-reset: recharge intentionnellement le MÊME `result`), qui ne
  // doit jamais compter comme un niveau de plus. Fait AVANT d'écraser `grid`
  // juste en dessous, sinon getPlacedLights() lirait déjà le niveau suivant.
  if (mode === "infinite" && grid && result !== lastInfiniteResult && grid.getPlacedLights().length >= INFINITE_AD_MIN_LAMPS) {
    infiniteLevelsPlayedSinceAd++;
    if (infiniteLevelsPlayedSinceAd >= INFINITE_AD_EVERY_N_LEVELS) {
      infiniteLevelsPlayedSinceAd = 0;
      // Fire-and-forget (voir ads.js: showInterstitialAd) — l'interstitielle
      // s'affiche par-dessus pendant que le niveau suivant finit de se
      // charger juste en dessous, jamais de délai supplémentaire pour le
      // joueur.
      showInterstitialAd();
    }
  }

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

const profilePseudoTextEl = document.getElementById("profile-pseudo-text");
const profilePseudoEditEl = document.getElementById("profile-pseudo-edit");
const profilePseudoInput = document.getElementById("profile-pseudo-input");
const btnProfilePseudoConfirm = document.getElementById("btn-profile-pseudo-confirm");
const profileAvatarPicker = document.getElementById("profile-avatar-picker");
const profilePublishedEl = document.getElementById("profile-published");
const profilePublishedEmptyEl = document.getElementById("profile-published-empty");
const profileLikedEl = document.getElementById("profile-liked");
const profileLikedEmptyEl = document.getElementById("profile-liked-empty");
const profileBadgePreviewEl = document.getElementById("profile-badge-preview");
const profileSommationBadgesEl = document.getElementById("profile-sommation-badges");
const btnProfileBadgesDebugUnlock = document.getElementById("btn-profile-badges-debug-unlock");
const titleProfileBanner = document.getElementById("title-profile-banner");
const titleProfileIdentityEl = document.getElementById("title-profile-identity");

let communitySearch = "";
let communitySort = "recent";
let currentCommunityLevel = null; // grille en cours en mode "community" — voir loadCommunityLevel
let selectedProfileAvatar = AVATARS[0].id;
// Tier (1-5) du badge choisi pour affichage public, ou null ("aucun badge") —
// voir renderCommunityProfile/refreshProfileBadgePreview. Simple reflet local
// de profile.activeBadge, ré-synchronisé à chaque entrée dans "Mon profil".
let selectedActiveBadge = null;

/** État d'unlocks résolu ici (main.js reste le seul point qui connaît à la
 * fois community-store.js, sommation.js ET la progression Histoire/le
 * profil) — `isAvatarUnlocked(avatar, state)` (community-store.js) ne
 * connaît que cette forme `{ pixelart, storyCompleted, owned }`, jamais les
 * modules sources (sommation.js, storyProgress, storage.js) directement.
 * Round 22: `storyCompleted` (niveaux Histoire complétés, voir storyProgress
 * plus haut — PAS `unlockedCount`, qui compte l'accessible plutôt que le
 * complété) pour les avatars "story", `owned` (Set d'ids, voir
 * profile.ownedAvatars) pour les avatars "purchase". */
function avatarUnlocks() {
  return {
    pixelart: isPixelArtUnlocked(),
    storyCompleted: storyProgress.size,
    owned: new Set(loadProfile()?.ownedAvatars ?? []),
  };
}

/** Construit un "encadré" avatar+pseudo — la surface publique du badge actif
 * d'un joueur (retour utilisateur round 18: "visible par les autres joueurs
 * [...] lorsqu'on joue à un niveau de quelqu'un, son badge sera visible sous
 * forme d'un encadré autour de son pseudo + avatar"). `badgeTier` est soit le
 * tier (1-5) capturé dans `author.badge` au moment de la publication (voir
 * editor.js), soit celui actuellement sélectionné dans "Mon profil"
 * (prévisualisation en direct) — dans les deux cas un simple nombre opaque,
 * jamais recalculé depuis la progression Sommation de l'observateur. Sans
 * badge (null/undefined), le cadre reste neutre — même apparence qu'avant
 * cette fonctionnalité.
 *
 * Round 19: `avatarId` (pas un emoji) — voir community-store.js: AVATARS
 * stocke désormais un SVG par ID, jamais un caractère à afficher tel quel,
 * donc innerHTML (pas textContent) pour l'avatar. Cette même fonction sert
 * aussi de prévisualisation d'IDENTITÉ complète (avatar+pseudo+badge) en
 * haut de "Mon profil" (retour utilisateur: la prévisu remplace l'ancien
 * avatar dupliqué à côté du pseudo).
 *
 * Round 22 (retour utilisateur): `compact` ajoute le modificateur
 * `.badge-frame--compact` (voir badges.css) — pensé pour se substituer au
 * pseudo texte dans la byline des cartes "Communauté" et l'en-tête de jeu,
 * jamais utilisé pour la bannière de titre/prévisualisation "Mon profil",
 * qui gardent le format normal.
 *
 * Round 23 (retour utilisateur: "le badge/avatar/nom dans le menu [...] au
 * niveau visuel ça fait bizarre [...] le badge lui-même [doit être] le
 * bouton [...] on intègre l'icône '>' à l'intérieur"): `framed` ajoute le
 * fond/bordure "pilule" directement sur le cadre (voir badges.css:
 * .badge-frame--framed, définie avant les --tier-N pour qu'un badge actif
 * garde la priorité sur son propre décor) — utilisé pour la bannière de
 * titre ET pour la grande prévisualisation "Mon profil" (retour
 * utilisateur: "cohérente et similaire à l'apparence qu'il a dans le
 * menu"), même sans être cliquable. `chevron` ajoute EN PLUS un chevron ">"
 * comme dernier enfant, uniquement là où le cadre est réellement cliquable
 * vers le profil — le badge devient ainsi lui-même l'indice visuel
 * "cliquable", plutôt que d'être imbriqué dans un second bouton à
 * l'apparence redondante (voir renderTitleProfileBanner ci-dessous et
 * title.css: .title-profile-banner, désormais un simple wrapper sans
 * apparence propre). */
function buildBadgeFrame(avatarId, pseudoText, badgeTier, { compact = false, framed = false, chevron = false } = {}) {
  const frame = document.createElement("span");
  frame.className =
    "badge-frame" +
    (badgeTier ? ` badge-frame--tier-${badgeTier}` : "") +
    (compact ? " badge-frame--compact" : "") +
    (framed || chevron ? " badge-frame--framed" : "");
  const deco = document.createElement("span");
  deco.className = "badge-frame-deco";
  deco.setAttribute("aria-hidden", "true");
  const avatarEl = document.createElement("span");
  avatarEl.className = "badge-frame-avatar";
  avatarEl.innerHTML = getAvatarSvg(avatarId);
  const pseudoEl = document.createElement("span");
  pseudoEl.className = "badge-frame-pseudo";
  pseudoEl.textContent = pseudoText || "Joueur";
  frame.append(deco, avatarEl, pseudoEl);
  if (chevron) {
    const chevronEl = document.createElement("span");
    chevronEl.className = "badge-frame-chevron";
    chevronEl.setAttribute("aria-hidden", "true");
    chevronEl.innerHTML =
      '<svg viewBox="0 0 24 24" class="icon-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
    frame.appendChild(chevronEl);
  }
  return frame;
}

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
  byline.appendChild(
    buildBadgeFrame(level.author?.avatar, level.author?.pseudo ?? "Joueur", level.author?.badge, { compact: true })
  );

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
  communityLevelAuthorEl.innerHTML = "";
  communityLevelAuthorEl.appendChild(
    buildBadgeFrame(level.author?.avatar, level.author?.pseudo ?? "Joueur", level.author?.badge, { compact: true })
  );
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
// Round 19 (retour utilisateur): avatar/pseudo/badge forment un seul
// formulaire d'identité sans bouton "Enregistrer" — chaque choix persiste
// immédiatement (voir updateProfile ci-dessous, appelé directement par
// chaque handler). Les fonctions refreshXxx ci-dessous ne redessinent QUE
// leur propre morceau (jamais tout renderCommunityProfile) pour ne pas
// perturber un autre champ en cours d'édition (ex: cliquer un avatar
// pendant que le pseudo est en mode édition ne doit pas fermer ce dernier).

const profileAvatarPurchaseStatusEl = document.getElementById("profile-avatar-purchase-status");

function setProfileAvatarPurchaseStatus(text, isError) {
  if (!profileAvatarPurchaseStatusEl) return;
  profileAvatarPurchaseStatusEl.textContent = text ?? "";
  profileAvatarPurchaseStatusEl.classList.toggle("hidden", !text);
  profileAvatarPurchaseStatusEl.classList.toggle("profile-avatar-purchase-status--error", !!isError);
}

/** Round 22 (retour utilisateur): "ces quatre derniers avatars se
 * débloquent en les achetant avec des points en cliquant dessus (100, 200,
 * 400, 1000)" — un avatar "purchase" pas encore possédé N'EST PAS traité
 * comme les autres avatars verrouillés (voir .profile-avatar-btn.locked,
 * réservé aux avatars "story"/"pixelart" pas encore atteints): il reste
 * cliquable, le clic TENTE l'achat (spendSharedPoints) au lieu de simplement
 * sélectionner l'avatar — voir avatarUnlockLabel (community-store.js) pour
 * le texte d'indice affiché aux deux types de verrouillage. */
function refreshProfileAvatarPicker() {
  profileAvatarPicker.innerHTML = "";
  const unlocks = avatarUnlocks();
  for (const avatar of AVATARS) {
    const unlocked = isAvatarUnlocked(avatar, unlocks);
    const purchasable = !unlocked && avatar.unlock?.type === "purchase";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "profile-avatar-btn" +
      (avatar.id === selectedProfileAvatar ? " active" : "") +
      (unlocked ? "" : purchasable ? " purchasable" : " locked");
    btn.innerHTML = avatar.svg;
    btn.disabled = !unlocked && !purchasable;
    btn.title = unlocked ? avatar.label : `${avatar.label} — ${avatarUnlockLabel(avatar)}`;
    if (purchasable) {
      const price = document.createElement("span");
      price.className = "profile-avatar-price";
      price.textContent = String(avatar.unlock.cost);
      btn.appendChild(price);
    }
    if (unlocked) {
      btn.addEventListener("click", () => {
        selectedProfileAvatar = avatar.id;
        updateProfile({ avatar: avatar.id });
        refreshProfileAvatarPicker();
        refreshProfileBadgePreview();
      });
    } else if (purchasable) {
      btn.addEventListener("click", () => {
        setProfileAvatarPurchaseStatus(null);
        if (!spendSharedPoints(avatar.unlock.cost)) {
          setProfileAvatarPurchaseStatus(`Pas assez de points (${avatar.unlock.cost} nécessaires).`, true);
          return;
        }
        const owned = loadProfile()?.ownedAvatars ?? [];
        selectedProfileAvatar = avatar.id;
        updateProfile({ ownedAvatars: [...owned, avatar.id], avatar: avatar.id });
        refreshProfileAvatarPicker();
        refreshProfileBadgePreview();
        showCosmeticUnlockModal({
          kind: "avatar",
          avatarId: avatar.id,
          title: `Avatar « ${avatar.label} »`,
          subtitle: `Débloqué pour ${avatar.unlock.cost} points !`,
        });
      });
    }
    profileAvatarPicker.appendChild(btn);
  }
}

/** Bannière compacte avatar+pseudo tout en haut de l'écran titre (round 17,
 * retour utilisateur) — cliquer dessus mène à "Mon profil" (voir
 * titleProfileBanner.onclick plus bas). Retombe sur l'avatar par défaut +
 * un texte d'invite tant qu'aucun profil n'a encore été enregistré (voir
 * storage.js: loadProfile renvoie null), plutôt que d'afficher un pseudo
 * vide ou "undefined". Ré-exécutée à chaque retour au titre (showView),
 * même principe que renderPointsEverywhere: jamais figée sur un profil
 * modifié depuis (pseudo changé dans "Mon profil" puis retour ici).
 *
 * Round 22 (retour utilisateur): "l'avatar+pseudo dans le menu (en haut)
 * doit être aussi affiché avec le badge" — utilise désormais buildBadgeFrame
 * (même composant que la byline des cartes Communauté et la prévisualisation
 * "Mon profil") au lieu d'un simple avatar+texte bruts. */
function renderTitleProfileBanner() {
  const profile = loadProfile();
  titleProfileIdentityEl.innerHTML = "";
  titleProfileIdentityEl.appendChild(
    buildBadgeFrame(
      profile?.avatar ?? AVATARS[0].id,
      profile?.pseudo?.trim() || "Configurer mon profil",
      profile?.activeBadge,
      { chevron: true }
    )
  );
}

titleProfileBanner.onclick = () => pushView("community-profile");

/** Reconstruit l'encadré de prévisualisation "Mon profil" (avatar + pseudo,
 * encadrés par le badge actif) — appelée à chaque changement d'avatar, de
 * pseudo tapé, ou de badge sélectionné, toujours à partir de l'état
 * actuellement affiché dans le formulaire (pas forcément déjà enregistré :
 * le pseudo en cours de frappe s'y reflète avant même la validation par le
 * bouton check). */
function refreshProfileBadgePreview() {
  if (!profileBadgePreviewEl) return;
  profileBadgePreviewEl.innerHTML = "";
  const pseudo = profilePseudoInput.value.trim() || "Joueur";
  profileBadgePreviewEl.appendChild(buildBadgeFrame(selectedProfileAvatar, pseudo, selectedActiveBadge, { framed: true }));
}

/** Petits carrés "teaser" de sélection (retour utilisateur round 19: "moins
 * de place [...] juste représentés par une sorte de carré teaser [...] pas
 * juste une couleur, on veut une vraie identité") — chaque tier garde son
 * propre décor (voir style.css: .badge-teaser-deco), juste redimensionné,
 * plutôt qu'un simple aplat de couleur. Le pseudo n'apparaît plus ICI (déjà
 * visible dans la grande prévisualisation ci-dessus) : un badge gagné se
 * (dé)sélectionne d'un clic, sans confirmation séparée. */
function refreshProfileBadges() {
  if (!profileSommationBadgesEl) return;
  profileSommationBadgesEl.innerHTML = "";
  for (const badge of getSommationBadges()) {
    const tile = document.createElement(badge.earned ? "button" : "div");
    if (badge.earned) tile.type = "button";
    tile.className =
      `badge-teaser badge-teaser--tier-${badge.tier}` +
      (badge.earned ? " earned selectable" : " locked") +
      (badge.earned && selectedActiveBadge === badge.tier ? " selected" : "");

    const deco = document.createElement("span");
    deco.className = "badge-teaser-deco";
    deco.setAttribute("aria-hidden", "true");
    tile.appendChild(deco);

    const nameEl = document.createElement("span");
    nameEl.className = "badge-teaser-name";
    nameEl.textContent = badge.earned ? badge.name : "?";
    tile.appendChild(nameEl);

    if (badge.earned) {
      tile.title = selectedActiveBadge === badge.tier ? `${badge.name} (actif — cliquer pour retirer)` : badge.name;
      tile.addEventListener("click", () => {
        selectedActiveBadge = selectedActiveBadge === badge.tier ? null : badge.tier;
        updateProfile({ activeBadge: selectedActiveBadge });
        refreshProfileBadges();
        refreshProfileBadgePreview();
      });
    } else {
      tile.title = "Badge verrouillé";
    }

    profileSommationBadgesEl.appendChild(tile);
  }
}

/** Ré-exécutée à chaque affichage de l'écran (voir showView) — comme
 * renderLevelGrid/renderShop, jamais figée sur un rendu périmé (ex: un like
 * posé depuis le fil principal doit apparaître dans "Mes favoris" au
 * prochain passage ici). Contrairement aux refreshXxx ci-dessus (déclenchées
 * par une action ponctuelle), celle-ci resynchronise TOUT depuis le profil
 * enregistré — c'est pour ça que le mode édition du pseudo se referme ici
 * (voir exitPseudoEditMode): on ne veut pas rouvrir "Mon profil" avec une
 * frappe en cours d'une visite précédente. */
function renderCommunityProfile() {
  const profile = loadProfile();
  profilePseudoInput.value = profile?.pseudo ?? "";
  profilePseudoTextEl.textContent = profile?.pseudo?.trim() || "Configurer mon pseudo";
  exitPseudoEditMode();

  const savedAvatarUnlocked =
    profile?.avatar && isAvatarUnlocked(AVATARS.find((a) => a.id === profile.avatar) ?? {}, avatarUnlocks());
  selectedProfileAvatar = savedAvatarUnlocked ? profile.avatar : AVATARS[0].id;
  selectedActiveBadge = profile?.activeBadge ?? null;
  setProfileAvatarPurchaseStatus(null); // jamais un message d'achat resté d'une visite précédente

  refreshProfileAvatarPicker();
  refreshProfileBadges();
  refreshProfileBadgePreview();

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
}

// ---------- Pseudo: texte cliquable (lecture) <-> input + bouton check
// (édition) — retour utilisateur round 19: "pas de bouton enregistrer,
// cliquer sur un choix suffit [...] un simple texte cliquable [...] un
// bouton-icon valider qui prendra juste la forme d'un Check". ----------
function enterPseudoEditMode() {
  profilePseudoInput.value = loadProfile()?.pseudo ?? "";
  profilePseudoInput.classList.remove("input-error", "input-error--shake");
  profilePseudoTextEl.classList.add("hidden");
  profilePseudoEditEl.classList.remove("hidden");
  profilePseudoInput.focus();
  profilePseudoInput.select();
}

function exitPseudoEditMode() {
  profilePseudoEditEl.classList.add("hidden");
  profilePseudoTextEl.classList.remove("hidden");
}

function commitPseudo() {
  const pseudo = profilePseudoInput.value.trim();
  if (!pseudo) {
    profilePseudoInput.classList.remove("input-error--shake");
    void profilePseudoInput.offsetWidth;
    profilePseudoInput.classList.add("input-error", "input-error--shake");
    profilePseudoInput.focus();
    return;
  }
  updateProfile({ pseudo });
  profilePseudoTextEl.textContent = pseudo;
  exitPseudoEditMode();
  refreshProfileBadgePreview();
}

profilePseudoTextEl.addEventListener("click", enterPseudoEditMode);
profilePseudoTextEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    enterPseudoEditMode();
  }
});
btnProfilePseudoConfirm.addEventListener("click", commitPseudo);
profilePseudoInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") commitPseudo();
});
// Prévisualisation en direct dès que le pseudo est tapé, avant même la
// validation par le bouton check (retour utilisateur round 18, toujours
// valable round 19 malgré la disparition du bouton Enregistrer).
profilePseudoInput.addEventListener("input", refreshProfileBadgePreview);

// Round 17 (retour utilisateur): bouton admin temporaire pour tester les
// badges sans finir Remember — même fonction que le bouton équivalent
// d'Options (voir plus haut btnPixelartDebugUnlock), donc même effet de
// bord accepté (débloque aussi le thème PixelArt en même temps).
if (btnProfileBadgesDebugUnlock) {
  btnProfileBadgesDebugUnlock.onclick = () => {
    debugUnlockPixelArt();
    renderCommunityProfile();
  };
}

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
// Tier auquel Remember débloque le thème PixelArt EN MÊME TEMPS que son
// dernier badge (voir sommation.js: PIXELART_BADGE_TIER/BADGE_DEFS.length,
// gardées volontairement égales là-bas) — dupliqué ici uniquement pour le
// texte de la modale de révélation ci-dessous, jamais pour une logique de
// déblocage réelle (toujours isPixelArtUnlocked() côté sommation.js).
const PIXELART_BADGE_UNLOCK_TIER = 5;

const sommationApi = initSommation({
  getPoints: () => infinitePoints,
  spendPoints: spendSharedPoints,
  addPoints: addSharedPoints,
  // Round 19 (retour utilisateur): bouton "Mon profil" sous le message
  // "terminé" — voir sommation.js: onShow().
  goToProfile: () => pushView("community-profile"),
  // Round 22: voir buildBadgeFrame() plus haut — passé tel quel pour que
  // sommation.js affiche le MÊME composant avatar+pseudo+badge sur son
  // écran "terminé" sans dépendre de main.js directement.
  buildBadgeFrame,
  // Round 22 (retour utilisateur): "il faudra freeze le jeu lors du
  // déblocage d'un objet cosmétique [...] pareillement pour les badges" —
  // voir showCosmeticUnlockModal() plus bas.
  onBadgeEarned: (tier, name) =>
    showCosmeticUnlockModal({
      kind: "badge",
      badgeTier: tier,
      title: name ? `Badge « ${name} »` : "Nouveau badge",
      subtitle:
        tier >= PIXELART_BADGE_UNLOCK_TIER
          ? "Nouveau badge débloqué, et le thème PixelArt avec !"
          : "Nouveau badge débloqué !",
    }),
});

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

function renderActiveScreen() {
  const active = viewStack[viewStack.length - 1];
  for (const [name, id] of Object.entries(SCREEN_IDS)) {
    document.getElementById(id).classList.toggle("hidden", name !== active);
  }
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
  // Rafraîchit la carte "Remember" du menu titre (points vs "Terminé") à
  // chaque retour — le déverrouillage de PixelArt peut survenir entre deux
  // passages sans forcément s'accompagner d'un changement de points (voir
  // renderPointsEverywhere), donc jamais figé sur un état périmé, même
  // principe que renderPixelArtOption()/renderLevelGrid().
  if (name === "title") {
    renderPointsEverywhere();
    renderTitleProfileBanner();
  }
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
 * Secrets a été retirée) et "Retour" ramène directement au menu titre.
 *
 * Round 12: une fois PixelArt débloqué, Remember est terminé et non-
 * rejouable (retour utilisateur: "ça veut dire qu'on a terminé Remember
 * donc il sera marqué comme terminé et ne sera plus jouable").
 *
 * Round 18 (retour utilisateur): "j'aimerais juste que ça ouvre la page
 * remember mais qu'à la place du jeu on a une page de réussite, de jeu
 * terminé" — donc on ouvre TOUJOURS l'écran Sommation (jamais Mon profil,
 * contrairement à avant ce round): c'est sommation.js: onShow() qui bascule
 * lui-même vers l'état "terminé" (#som-done-state) une fois PixelArt
 * débloqué, plutôt que main.js qui redirige ailleurs. */
function enterRememberDirect() {
  viewStack = ["title", "sommation"];
  showView("sommation");
}

document.getElementById("menu-story").onclick = enterStoryDirect;
document.getElementById("menu-infinite").onclick = enterInfiniteDirect;
document.getElementById("menu-community").onclick = () => pushView("community");
document.getElementById("menu-remember").onclick = enterRememberDirect;
document.getElementById("menu-options").onclick = () => pushView("options");

renderActiveScreen();
renderTitleStoryProgress();
renderTitleProfileBanner();

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
