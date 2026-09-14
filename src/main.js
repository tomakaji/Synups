import { LightUpGrid } from "./game/grid.js";
import { levels } from "./game/levels.js";
import { findSolution } from "./game/solver.js";
// Round 20 (migration Capacitor/AdMob) — no-op silencieux hors app native
// (voir game/ads.js), donc sûr à appeler ici même pendant `npm run dev`.
import { initAds, showRewardedAd, showInterstitialAd, showBannerAd, hideBannerAd, onBannerHeightChange } from "./game/ads.js";
// Round 24 (retour utilisateur: "retour haptique sur les boutons de
// navigation en général, et dans le jeu et le mode remember") — no-op
// silencieux hors app native (même garde que ads.js), donc sûr à appeler ici
// même pendant `npm run dev`.
import { hapticLight, hapticWarning, hapticSuccess } from "./game/haptics.js";
import { trackEvent } from "./game/analytics.js";
import {
  isAvailable as isPlayGamesAvailable,
  isSignedIn as isPlayGamesSignedIn,
  refreshStatus as refreshPlayGamesStatus,
  signIn as signInToPlayGames,
  getPlayerDisplayName as getPlayGamesDisplayName,
  saveProgressToCloud,
  restoreProgressFromCloud,
} from "./game/playGamesServices.js";
import {
  isTodayReady as isDailyChallengeReady,
  isTodayCompleted as isDailyChallengeCompleted,
  getTodayLevel as getDailyChallengeLevel,
  ensureTodayChallenge,
  completeTodayChallenge,
  getReplayCooldownRemainingMs,
  regenerateTodayChallengeViaAd,
} from "./game/dailyChallenge.js";
// Mode Meditate (retour utilisateur) — remplace l'ancien déblocage par
// seuil d'Énergie des bannières Comète/Supernova (voir dailyChallenge.js,
// getStarBadges/debugUnlockStarBadges retirés) par un mini-jeu de
// révélation, voir game/meditate.js pour toute la logique.
import {
  getCurrentDef as getMeditateCurrentDef,
  isAllUnlocked as isMeditateAllUnlocked,
  ensureCurrentGrid as ensureMeditateGrid,
  getShapeRevealState as getMeditateShapeRevealState,
  revealCell as revealMeditateCell,
  getMeditateBadges,
  debugUnlockMeditateBadges,
} from "./game/meditate.js";
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
  playMeditateEmpty,
  playMeditateFragment,
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
  enterBackgroundMuffle,
  exitBackgroundMuffle,
} from "./game/music.js";
import {
  createBoardRenderer,
  chargeIcon,
  synapseIcon,
  mirrorIcon,
  prismIcon,
  pyraIcon,
  mirrorNeuronIcon,
  neuronIcon,
} from "./game/render.js";
import { initEditor } from "./editor.js";
// Renommage joueur (retour utilisateur): "points" -> "Étoile(s)" (icône
// étoile bleue), "étoiles" (Défi Quotidien) -> "Énergie" (icône éclair
// jaune) — voir game/currencyIcons.js pour le détail de la décision
// (identifiants internes/localStorage volontairement inchangés).
import { starLabel, boltLabel, starIconSVG, boltIconSVG } from "./game/currencyIcons.js";
import {
  initSommation,
  getSommationBadges,
  isPixelArtUnlocked,
  debugUnlockPixelArt,
  resetSommationProgress,
} from "./sommation.js";
import { FEATURES } from "./game/generator.js";
import { requestLevel, ensureLevelBuffer, takeBufferedLevel, hasBufferedLevel } from "./game/infiniteClient.js";
import { initAdminToggle, isAdminModeOn, onAdminModeChange, mountAdminButton } from "./admin.js";
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
  loadStars,
  spendStars,
  addStars,
  resetMeditateProgress,
  isStoryMasteryUnlocked,
  markStoryMasteryUnlocked,
  sanitizePlayerText,
} from "./game/storage.js";
import {
  listLevels,
  getLevel,
  likedLevels,
  toggleLike,
  markPlayed,
  unpublishLevel,
  detectMechanics,
  AVATARS,
  isAvatarUnlocked,
  avatarUnlockLabel,
  getAvatarSvg,
  DEFAULT_AVATAR,
  refreshCommunityCloud,
  onLevelsChanged,
  syncAuthorToPublishedLevels,
} from "./game/community-store.js";
import { t, applyI18n, setLocale, getLocale, detectSystemLocale, isLocaleSupported, getSupportedLocales } from "./game/i18n.js";

// i18n (retour utilisateur: "il faut extraire tous les textes dans un
// endroit et les utiliser via des clés" puis, une fois les 11 langues
// traduites: "intégrer les traductions dans les autres langues avec i18n"
// puis enfin: "init en dur sur l'anglais (fallback), init dynamique par la
// détection [...] puis on ajoute dans options la possibilité de changer la
// langue") — TOUT PREMIER appel du fichier, avant même le reste de l'init:
// <script type="module"> est différé par le navigateur (comme `defer`),
// donc le HTML de index.html est déjà entièrement parsé ici — pas besoin
// d'attendre un DOMContentLoaded.
//
// Résolution de la langue initiale: si le joueur a DÉJÀ choisi une langue
// explicitement dans Options (settings.locale, voir plus bas dans ce
// fichier: le <select> #options-language-select), ce choix prime toujours.
// Sinon, on retombe sur la détection dynamique (detectSystemLocale, langue
// du système/navigateur) — qui elle-même ne retombe sur l'anglais "en dur"
// (DEFAULT_LOCALE, voir game/i18n.js) que si la langue système n'a aucune
// traduction. loadSettings() est appelée ICI en plus de son usage habituel
// plus bas (déclaration de `settings`) car cette résolution doit se faire
// avant tout le reste de l'init, alors que `settings` n'existe pas encore à
// ce stade du fichier — les deux lectures portent sur la même clé
// localStorage, donc jamais désynchronisées.
const savedLocale = loadSettings().locale;
setLocale(savedLocale && isLocaleSupported(savedLocale) ? savedLocale : detectSystemLocale());
// applyI18n() écrase le texte français déjà présent dans index.html
// (data-i18n/data-i18n-attr) par celui de la langue active: à partir d'ici,
// locales/<code>.js est la SEULE source de vérité pour tout texte statique
// — voir game/i18n.js pour le détail du mécanisme.
applyI18n();

// ---------- Écran de démarrage (calque de fondu) ----------
// Retour utilisateur: "l'écran de démarrage de l'app affiche juste le logo,
// ça serait bien d'afficher le Titre avec, dans le même design que sur le
// menu, mais en plus gros et bien centré [...] qu'il apparaisse en fondu" —
// le splash NATIF (Android/iOS, voir index.html <head>) reste une simple
// image statique, aucun plugin @capacitor/splash-screen n'est utilisé ici
// pour l'animer. #boot-splash (voir index.html, même fond que <body>: pas de
// coupure visuelle avec le splash natif dessous) prend le relais dès que la
// WebView peint sa première frame — logo puis titre apparaissent en fondu
// (voir base.css: .boot-splash-mark/.boot-splash-title), restent un court
// instant, puis le calque entier se retire pour révéler le menu. Durée FIXE
// (jamais accrochée à un événement réseau/chargement): rien à attendre ici,
// juste le temps que l'animation soit perçue.
const bootSplashEl = document.getElementById("boot-splash");
if (bootSplashEl) {
  const BOOT_SPLASH_VISIBLE_MS = 1500;
  const BOOT_SPLASH_FADE_OUT_MS = 500; // voir base.css: .boot-splash transition
  setTimeout(() => {
    bootSplashEl.classList.add("boot-splash--hidden");
    // Retiré du DOM (pas juste caché) une fois le fondu de sortie terminé:
    // plus jamais besoin d'y penser ensuite (pas de calque résiduel
    // invisible mais toujours présent, pas de z-index à gérer plus tard).
    setTimeout(() => bootSplashEl.remove(), BOOT_SPLASH_FADE_OUT_MS);
  }, BOOT_SPLASH_VISIBLE_MS);
}

// Notification transitoire générique (voir index.html: #toast, base.css:
// .toast/@keyframes toast-in-out) — retour utilisateur: "rediriger vers
// communauté avec une notif de reussite" après publication d'une grille
// (voir editor.js: initEditor({ onPublished })). Un SEUL élément réutilisé
// pour tout futur toast plutôt qu'un par déclencheur : `toastHideTimer`
// annule un appel précédent encore affiché pour que deux toasts en rafale
// ne se marchent jamais dessus (le second remplace/relance proprement le
// premier plutôt que de laisser le timer du premier fermer le second en
// avance). Basculer `.hidden` (display:none <-> block) suffit à rejouer
// l'animation CSS à chaque appel (contrairement à `.screen--enter`, une
// animation ne tourne JAMAIS pendant `display:none` — la ré-afficher la
// relance forcément depuis le début, pas besoin d'un reflow forcé en plus).
const toastEl = document.getElementById("toast");
let toastHideTimer = null;
const TOAST_VISIBLE_MS = 2600; // doit rester synchronisé avec la durée de @keyframes toast-in-out (base.css)

function showToast(message) {
  if (!toastEl) return;
  clearTimeout(toastHideTimer);
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  toastHideTimer = setTimeout(() => {
    toastEl.classList.add("hidden");
  }, TOAST_VISIBLE_MS);
}

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
const boardGeneratingOverlayEl = document.getElementById("board-generating-overlay");
const btnUndo = document.getElementById("btn-undo");
// Retour utilisateur (zoom tactile): "on ne peut pas déplacer la grille en
// touchant le vide autour d'elle" — voir render.js: createBoardRenderer,
// `panSurfaceEl` capte les gestes sur toute la zone de jeu (#play-view,
// jamais transformée elle-même) plutôt que seulement sur #board (qui, lui,
// rétrécit visuellement autour de son centre une fois dézoomé/déplacé).
const renderer = createBoardRenderer(boardEl, { panSurfaceEl: document.getElementById("play-view") });

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
// Retour utilisateur: "la durée de transition à la victoire est un chouilla
// trop longue" — réduite de 900 à 700ms (durée MINIMUM d'affichage du
// plateau vide/niveau suivant en cours de génération, voir plus bas).
const BOARD_HOLD_MS = 700;
// Round 23 (retour utilisateur: "lorsqu'on termine une grille, on passe
// trop vite à la suivante [...] ça serait bien de marquer un temps avant de
// faire disparaître la grille actuelle afin que le joueur puisse intégrer
// l'information qu'il a réussi") — pause AVANT même le fondu de sortie
// (voir advanceAfterWin ci-dessous), le temps de voir la grille résolue au
// repos. Scopée au mode Histoire uniquement (c'est le seul cité par le
// retour utilisateur) — l'Infini enchaîne les grilles trop vite pour ce
// genre de pause sans nuire au rythme voulu, et Communauté redemande de
// toute façon une note juste après (voir openCommunityRateModal).
// Retour utilisateur (round suivant): "un chouilla trop longue" — réduite
// de 1100 à 850ms.
const STORY_WIN_HOLD_MS = 850;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Vrai entre la résolution d'un niveau et l'affichage effectif du suivant :
// bloque toute action de jeu pendant la transition (placer/retirer une
// lumière, Annuler, Réinitialiser, navigation) dans les DEUX modes — avant,
// seul le mode Infini avait un tel verrou (infiniteAdvancePending), le mode
// Jouer s'appuyait sur le menu bloquant pour empêcher les clics.
let boardLocked = false;

// Vrai uniquement pendant l'attente d'une génération Infini SANS niveau
// préchargé en stock (buffer vide, voir infiniteClient.js:
// hasBufferedLevel) déclenchée par un clic MANUEL sur "Nouvelle grille" —
// voir setInfiniteGeneratingOverlay ci-dessous. Un flag SÉPARÉ de
// `boardLocked` (pas juste "boardLocked = true" ici) parce que `goBack()`
// vérifie ce dernier pour bloquer la navigation PENDANT la transition de
// fin de niveau — un comportement voulu là-bas, mais pas ici (retour
// utilisateur: "lock les boutons [...] sauf bouton retour", le joueur doit
// pouvoir quitter Infini plutôt que d'attendre le générateur).
let infiniteGenerationPending = false;

async function advanceAfterWin() {
  boardLocked = true;
  // Défi Quotidien: même pause que Histoire (voir STORY_WIN_HOLD_MS
  // ci-dessus) — laisser le temps de voir la grande grille résolue au repos
  // avant de repartir vers le menu, plutôt qu'un retour instantané.
  if (mode === "story" || mode === "daily") await wait(STORY_WIN_HOLD_MS);
  boardContainerEl.classList.add("board-fade");
  await wait(BOARD_FADE_MS);
  const holdStart = performance.now();
  if (mode === "infinite") {
    // Retour utilisateur: "l'animation d'addition d'étoiles [...] ne se
    // déclenche pas" — BUG CORRIGÉ: le gain était crédité (et l'animation
    // déclenchée) AVANT `runGeneration`, qui enchaîne aussitôt (chemin
    // "buffered", le cas courant — voir runGeneration) sur
    // loadInfiniteLevel/startBoard/renderer.build: une reconstruction
    // SYNCHRONE de tout le plateau (potentiellement de nombreux nœuds DOM/
    // SVG), dans la MÊME tâche JS, juste après avoir ajouté la classe
    // d'animation. Le navigateur ne peint qu'UNE fois cette tâche terminée:
    // si elle prend plus de temps que la durée de l'animation, celle-ci n'a
    // jamais l'occasion de s'exécuter — son propre temps s'écoule "à vide"
    // pendant que le thread est occupé. Le palier (pour calculer le gain)
    // est capturé AVANT `runGeneration` (sinon `lastInfiniteResult` a déjà
    // été écrasé par le niveau SUIVANT une fois `awardInfinitePoints` appelé
    // après) mais le crédit + le déclenchement de l'animation n'arrivent
    // QU'APRÈS: le plateau suivant est alors déjà construit, le thread est
    // libre, l'animation démarre sur une frame propre et joue vraiment.
    const wonTier = lastInfiniteResult?.measuredTier ?? lastInfiniteResult?.requestedTier ?? 1;
    await runGeneration({ intoBoard: true });
    awardInfinitePoints(wonTier);
  } else if (mode === "community") {
    // Pas de "niveau suivant" prédéterminé en Communauté (contrairement à
    // Histoire/Infini) — voir plus bas: on revient au fil après la pause,
    // plutôt que de laisser le joueur sur un plateau résolu sans action
    // évidente à faire ensuite.
    if (currentCommunityLevel) markPlayed(currentCommunityLevel.id);
  } else if (mode === "daily") {
    // completeTodayChallenge() se protège elle-même contre un double-crédit
    // (voir dailyChallenge.js) — sans risque même si advanceAfterWin était
    // rappelée deux fois pour la même victoire. On ne montre la popup de
    // récompense (retour utilisateur: "à la victoire on utilise la pop up
    // de récompense pour montrer qu'on a gagné une étoile") QUE la première
    // fois, jamais sur un second appel accidentel qui ne créditerait rien.
    // Retour utilisateur: la monnaie "étoile" du Défi Quotidien s'affiche
    // désormais "Énergie" (icône éclair, jaune) — kind reste "star" en
    // interne (voir currencyIcons.js: décision d'architecture).
    const alreadyDone = isDailyChallengeCompleted();
    const totalStars = completeTodayChallenge();
    renderDailyChallengeButton();
    if (!alreadyDone) {
      showCosmeticUnlockModal({
        kind: "star",
        title: "+1 Énergie",
        subtitle: `Tu as maintenant ${totalStars} Énergie — reviens demain pour un nouveau défi.`,
      });
    }
  } else {
    // `levels.length` peut grandir plus tard (retour utilisateur: "42
    // actuellement mais pourrait changer à l'avenir") — capturé AVANT
    // loadLevel() ci-dessous, qui mute currentLevelIndex, pour que la
    // détection "était-ce le DERNIER niveau" reste correcte sans jamais
    // dépendre d'une constante en dur.
    const wasLastLevel = currentLevelIndex === levels.length - 1;
    markStoryLevelCompleted(currentLevelIndex, {
      onDone: () => {
        if (wasLastLevel) triggerCampaignFinished();
      },
    });
    loadLevel(currentLevelIndex + 1);
  }
  const elapsed = performance.now() - holdStart;
  if (elapsed < BOARD_HOLD_MS) await wait(BOARD_HOLD_MS - elapsed);
  boardContainerEl.classList.remove("board-fade");
  boardLocked = false;
  if (mode === "community" && currentCommunityLevel) {
    // On ne redemande QUE si le joueur n'a pas déjà aimé la grille pendant
    // la partie (bouton coeur du bandeau) — sinon la question serait
    // redondante. Voir openCommunityRateModal/btnCommunityRateLike. On ne
    // redemande jamais non plus sur sa PROPRE grille publiée (retour
    // utilisateur: "on ne doit pas pouvoir liker sa propre grille publiée
    // dans communauté") — `likedByMe` ne peut de toute façon jamais être vrai
    // sur ses propres grilles, mais sans ce garde-fou la modale de notation
    // s'ouvrirait quand même en lui proposant de "liker" sa propre création.
    const fresh = getLevel(currentCommunityLevel.id);
    if (fresh?.likedByMe || fresh?.source === "local") goBack();
    else openCommunityRateModal(currentCommunityLevel);
  }
  // Défi Quotidien: pas de "niveau suivant" (une seule grille/jour, voir
  // ci-dessus) — retour direct au menu titre une fois l'étoile créditée.
  // Retour utilisateur: "à la fin du niveau quotidien, on place une pub
  // interstitielle courte avant de revenir au menu" — voir ads.js:
  // showInterstitialAd(), qui retourne désormais une Promise résolue une
  // fois l'interstitielle réglée (affichée puis fermée, échec d'affichage,
  // ou immédiatement en no-op sur web/sans pub prête) précisément pour ce
  // genre d'appelant qui doit enchaîner APRÈS coup — contrairement au
  // palier Infini (voir loadInfiniteLevel) qui reste fire-and-forget.
  if (mode === "daily") {
    await showInterstitialAd();
    goBack();
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

// Round "Fusion" (retour utilisateur: prévoir la suite après un
// déblocage d'avatar palier) — `onDone` est optionnel et sert à CHAÎNER une
// action après la récompense (voir advanceAfterWin: déclencher
// triggerCampaignFinished() seulement APRÈS que la modale avatar palier 40
// éventuelle ait été refermée, jamais en parallèle). Invoqué immédiatement
// dans les cas où aucune modale n'est affichée (garde-fous / déjà fait /
// pas de palier atteint), ou différé via onClose sinon — jamais les deux.
function markStoryLevelCompleted(index, { onDone } = {}) {
  if (index < 0 || index >= levels.length) { onDone?.(); return; } // garde-fou: index invalide (ne devrait pas arriver)
  if (storyProgress.has(index)) { onDone?.(); return; } // déjà fait: rejouer un niveau ne change rien à la progression
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
      title: t("cosmeticUnlockBadgeTitle", { name: t(`avatar.${unlockedAvatar.id}`) }),
      subtitle: t("cosmeticUnlockStorySubtitle", { count: storyProgress.size }),
      onClose: onDone,
    });
  } else {
    onDone?.();
  }
}

// Tier "badge-frame"/"badge-teaser" de la bannière Fusion (voir badges.css)
// — volontairement PAS 0: buildBadgeFrame() fait `badgeTier ? ... : ""`
// (vérité JS), donc un tier 0 serait traité comme "aucun badge" et
// perdrait sa classe CSS. 9 choisi car libre (tiers 1-5 Remember, 6-8
// Meditate, voir sommation.js/meditate.js).
const STORY_MASTERY_BADGE_TIER = 9;

// Retour utilisateur: "il faut ajouter une banniere qu'on débloque à la fin
// du mode Jouer [...] positionnée en premier dans la liste [...] les 3
// couleurs [...] proposer au joueur (apres les récompenses) de noter
// l'application" — appelée depuis advanceAfterWin() UNIQUEMENT une fois la
// modale avatar palier 40 (éventuelle) refermée, jamais avant/en parallèle
// (voir onDone ci-dessus). isStoryMasteryUnlocked()/markStoryMasteryUnlocked()
// (storage.js) gardent CETTE fonction idempotente indépendamment du nombre
// de fois où le joueur rejoue le dernier niveau après coup.
function triggerCampaignFinished() {
  if (isStoryMasteryUnlocked()) return; // déjà fait: ne jamais re-proposer
  markStoryMasteryUnlocked();
  refreshProfileBadges();
  showCosmeticUnlockModal({
    kind: "badge",
    badgeTier: STORY_MASTERY_BADGE_TIER,
    title: t("cosmeticUnlockStoryMasteryTitle"),
    subtitle: t("cosmeticUnlockStoryMasterySubtitle"),
    onClose: () => openRateAppModal(),
  });
}

function renderTitleStoryProgress() {
  const total = levels.length;
  const fraction = total > 0 ? storyProgress.size / total : 0;
  storyProgressFillEl.style.width = `${Math.round(fraction * 100)}%`;
  storyProgressTextEl.textContent = `${storyProgress.size} / ${total}`;
  updateFeaturedModeCard();
}

/** Retour utilisateur: "le bouton Jouer doit prendre davantage le regard du
 * joueur que les autres [...] une fois le mode Jouer terminé, on change
 * cette mise en avant pour montrer plutot le mode Arcade" — Jouer (Histoire)
 * est LE mode principal tant que la campagne n'est pas finie ; une fois les
 * `levels.length` niveaux tous réussis (même critère que la barre de
 * progression ci-dessus), le regard du joueur n'a plus de raison d'être
 * attiré là (il n'y a plus rien à y débloquer) donc on bascule la mise en
 * avant sur Arcade (mode "à volonté", le plus proche substitut). */
function isStoryComplete() {
  return levels.length > 0 && storyProgress.size >= levels.length;
}

function updateFeaturedModeCard() {
  const storyDone = isStoryComplete();
  menuStoryBtn.classList.toggle("menu-card--featured", !storyDone);
  menuInfiniteBtn.classList.toggle("menu-card--featured", storyDone);
}

// ---------- Points (gagnés en Infini, dépensés dans Remember) ----------
const INFINITE_POINTS_BY_TIER = { 1: 1, 2: 3, 3: 5 };

let infinitePoints = loadPoints();
const infinitePointsEl = document.getElementById("infinite-points");
// Sommation (mode "Remember") partage désormais ce MÊME solde — retour
// utilisateur: "les points dans le mode Sommation sont les mêmes que dans le
// mode infinity". Inclus ici pour que renderPointsEverywhere() le maintienne
// à jour aussi, quelle que soit l'écran d'où provient la dépense/le gain.
const sommationPointsEl = document.getElementById("sommation-points");

// Retour utilisateur: "lorsqu'on change la valeur des etoiles affichées dans
// le header, ce compteur emet une animation qui signifie un changement [...]
// une animation lorsqu'on perd des etoiles [...] et une lorsqu'on en gagne"
// — mémorise la dernière valeur RENDUE pour détecter un delta à chaque appel
// de renderPointsEverywhere(), point de passage UNIQUE des trois mutateurs de
// solde (award/spend/add, voir plus bas): centralise ainsi le déclenchement
// de l'animation une seule fois plutôt que de le dupliquer à chaque site
// d'appel (et de risquer d'oublier un futur nouveau mutateur). Initialisée
// AVANT le tout premier appel de renderPointsEverywhere() (voir plus bas) pour
// que ce rendu initial (chargement de page) n'anime rien.
let lastRenderedPoints = infinitePoints;

// Durée des keyframes points-pulse/points-pulse-loss (voir
// mode-infinite.css) — dupliquée ici UNIQUEMENT pour programmer le nettoyage
// ci-dessous, jamais pour piloter l'animation elle-même (toujours définie en
// CSS pur).
const POINTS_ANIM_MS = 600;

// Retire puis rajoute la classe d'animation pour pouvoir la relancer même si
// une précédente est encore en cours (un simple ajout ne rejouerait pas le
// keyframe si la classe est déjà présente) — le reflow forcé entre les deux
// garantit que le navigateur voit bien les deux mutations comme séparées
// plutôt que de les fusionner dans la même frame.
//
// Bug corrigé (retour utilisateur: "si je vais dans les paramètres puis
// reviens à la grille sans rien changer [...] on voit l'animation de gain
// d'étoiles [rejouée], seulement après avoir déjà gagné une grille") : la
// classe n'était JAMAIS retirée une fois le keyframe terminé — sans effet
// tant que l'élément restait affiché, mais un `.screen` masqué
// (`display:none`, voir navigation.css) puis réaffiché (Réglages -> Retour,
// ou menu -> Infini) retire puis réinsère l'élément du rendu, ce qui REJOUE
// l'animation CSS depuis le début même si aucun JS ne l'a redéclenchée —
// donnant l'impression d'un second gain qui n'a jamais eu lieu. Nettoyée ici
// via un timer (pas un `animationend`: ne se déclencherait pas si
// l'animation est interrompue en plein vol par ce même passage à
// `display:none`, laissant la classe traîner malgré tout) — le timer
// précédent est annulé avant d'en programmer un nouveau pour qu'un
// redéclenchement rapproché (gain suivi de près par une dépense) ne coupe
// jamais la nouvelle animation en cours de route.
function triggerPointsAnim(el, cls) {
  if (!el) return;
  if (el._pointsAnimTimeout != null) clearTimeout(el._pointsAnimTimeout);
  // Retire aussi energy-gain/energy-loss (base.css): cette fonction est
  // désormais partagée avec renderMeditateEnergy() ci-dessous (retour
  // utilisateur: "l'animation d'addition/soustraction sur les éclairs [...]
  // ça devrait faire comme pour les étoiles"), jamais les deux paires de
  // classes en même temps sur le même élément.
  el.classList.remove("points-gain", "points-loss", "energy-gain", "energy-loss");
  void el.offsetWidth;
  el.classList.add(cls);
  el._pointsAnimTimeout = setTimeout(() => {
    el.classList.remove(cls);
    el._pointsAnimTimeout = null;
  }, POINTS_ANIM_MS);
}

function renderPointsEverywhere() {
  // Retour utilisateur: "points" -> "Étoile(s)" (icône étoile bleue, plus
  // d'abréviation "pt") — innerHTML (pas textContent) car starLabel()
  // préfixe le nombre par l'icône SVG (voir currencyIcons.js).
  const label = starLabel(infinitePoints);
  infinitePointsEl.innerHTML = label;
  if (sommationPointsEl) sommationPointsEl.innerHTML = label;

  const delta = infinitePoints - lastRenderedPoints;
  lastRenderedPoints = infinitePoints;
  if (delta !== 0) {
    const cls = delta > 0 ? "points-gain" : "points-loss";
    triggerPointsAnim(infinitePointsEl, cls);
    triggerPointsAnim(sommationPointsEl, cls);
  }
}

function awardInfinitePoints(tier) {
  const gain = INFINITE_POINTS_BY_TIER[tier] ?? 1;
  infinitePoints += gain;
  savePoints(infinitePoints);
  renderPointsEverywhere();
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
  // Retour utilisateur: zoom tactile — un VRAI changement de niveau
  // réinitialise le zoom/pan (voir render.js: resetZoom, jamais appelé
  // automatiquement par build() lui-même).
  renderer.resetZoom();
  renderer.build(grid, { onCellClick: handleCellClick, sounds });
  // Musique par calques: le déblocage reflète la progression du niveau qui
  // commence, pas un cumul avec le précédent — la lecture elle-même
  // continue sans interruption (voir music.js: resetLayers).
  resetMusicLayers();
}

/** `silent` (retour utilisateur: "les tutos [...] se déclenchent pas du
 * tout sur les bons niveaux, ex: le tuto couleur arrive bien avant les
 * niveaux utilisant la couleur") — BUG CORRIGÉ: tout en bas de ce fichier,
 * `loadLevel(...)` est appelée dès le lancement de l'appli pour
 * précharger en mémoire le niveau Histoire courant PENDANT QUE L'ÉCRAN
 * TITRE EST ENCORE AFFICHÉ (voir le commentaire à cet appel — le joueur n'a
 * pas encore cliqué "Histoire", #view-play reste masqué). Sans `silent`,
 * cet appel déclenchait quand même queueNewMechanicSchemas() : la modale
 * "schéma" s'affichait par-dessus le menu TITRE dès l'ouverture de l'appli,
 * et marquait immédiatement la mécanique comme "vue" (voir seenMechanics)
 * — bien avant que le joueur atteigne réellement ce niveau en jeu, donc
 * elle ne réapparaissait plus jamais au bon moment. `silent` saute
 * uniquement cette étape ; `enterStoryDirect`/`showView` rappellent
 * loadLevel() (non silencieux, cette fois) au clic réel sur "Histoire", qui
 * est le seul moment où la modale doit pouvoir s'ouvrir. */
function loadLevel(index, { silent = false } = {}) {
  currentLevelIndex = ((index % levels.length) + levels.length) % levels.length;
  currentLevel = levels[currentLevelIndex];
  grid = new LightUpGrid(currentLevel);
  // Retour utilisateur: "on va retirer le nom des niveaux [...] à droite,
  // on affiche juste le numéro du niveau avec un dièse devant et sur deux
  // chiffres (ex: '#13' ou '#06')" — remplace l'ancien
  // "${index+1}. ${currentLevel.name}" (nom du niveau visible).
  levelNameEl.textContent = `#${String(currentLevelIndex + 1).padStart(2, "0")}`;
  updateLevelNavLock();
  startBoard();
  // Round 23: voir queueNewMechanicSchemas() plus bas — uniquement le mode
  // Histoire (seul mode qui appelle loadLevel(), voir plus haut).
  if (!silent) queueNewMechanicSchemas(currentLevel.cells);
}

function handleCellClick(r, c) {
  if (boardLocked || infiniteGenerationPending) return;
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
    trackEvent("level_complete", { mode, moves: grid.getPlacedLightCount?.() ?? null });
    // Sauvegarde cloud best-effort après chaque niveau réussi (voir
    // playGamesServices.js: no-op silencieux si pas connecté/pas Android —
    // jamais besoin de vérifier isPlayGamesSignedIn() ici, saveProgressToCloud
    // le fait déjà en interne).
    saveProgressToCloud();
    advanceAfterWin();
  }
}

function undoLastMove() {
  if (boardLocked || infiniteGenerationPending) return;
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

// Retour utilisateur ("sur la grille 42 [...] les indices mettent beaucoup
// de temps de calcul [...] préload la solution [...] plutot que la
// calculer à chaque fois"): findSolution() résout TOUJOURS depuis l'état
// INITIAL du niveau (voir solver.js: `new LightUpGrid(level)`), jamais
// depuis les impulsions déjà posées par le joueur — son résultat est donc
// 100% déterministe pour un même objet `level` (pas de Math.random dans le
// solveur), et strictement identique qu'on le recalcule maintenant ou dans
// 10 clics. Rien ne justifiait de relancer tout le DFS/backtracking (qui
// peut prendre plusieurs secondes sur les niveaux les plus costauds, ex.
// la grille 42) à CHAQUE pression du bouton Indice, ni de le calculer DEUX
// fois de suite quand findNextHintCell() puis findWrongPlacedCell()
// tombent toutes les deux dans le même clic (repli "grille pleine
// d'erreurs" ci-dessous). Invalidé par simple égalité de référence avec
// `currentLevel` — tout site qui change de niveau (loadLevel, Infini,
// Communauté, Défi Quotidien) réassigne déjà `currentLevel` à un nouvel
// objet, rien d'autre à synchroniser ici. Le résultat `null` (niveau non
// résolu dans le budget de nœuds) est mis en cache lui aussi: le
// recalculer donnerait exactement le même résultat, pour le même coût.
let cachedSolutionLevel = null;
let cachedSolution = null;

function getCurrentLevelSolution() {
  if (cachedSolutionLevel !== currentLevel) {
    cachedSolutionLevel = currentLevel;
    cachedSolution = currentLevel ? findSolution(currentLevel) : null;
  }
  return cachedSolution;
}

/** Cherche, dans UNE solution valide du niveau courant (unique en
 * pratique — voir verify.mjs/le générateur), la prochaine case-lumière que
 * le joueur n'a pas encore posée. L'ordre du tableau retourné par
 * findSolution() reflète l'ordre dans lequel le solveur les a lui-même
 * déduites/posées pendant sa recherche (voir solver.js: `lights` est un
 * Set alimenté au fil de toggleLight, itéré dans son ordre d'insertion) —
 * une approximation raisonnable de "la prochaine ampoule que le solveur
 * trouverait", sans dupliquer ici toute la logique de propagation
 * pas-à-pas de propagate()/pickBranchCell().
 *
 * Retour utilisateur ("les indices ne fonctionnent pas si on a rempli une
 * grille avec des erreurs"): une case-solution pas encore posée peut malgré
 * tout être IMPOSSIBLE à poser MAINTENANT si une lumière mal placée
 * ailleurs l'illumine déjà (règle du jeu: pas de pose sur une case
 * illuminée, voir grid.js: toggleLight). Sans le filtre `canPlaceLightAt`
 * ci-dessous, l'indice proposait quand même cette case, la dépensait, puis
 * `handleCellClick` échouait silencieusement (son d'erreur, rien de posé) —
 * indice consommé pour rien. On ne propose donc plus qu'une case
 * RÉELLEMENT posable tout de suite ; si aucune ne l'est, `findWrongPlacedCell`
 * prend le relais (voir btnHint.onclick). */
function findNextHintCell() {
  if (!currentLevel || !grid) return null;
  const solution = getCurrentLevelSolution();
  if (!solution) return null;
  const placed = new Set(grid.getPlacedLights().map(([r, c]) => `${r},${c}`));
  for (const [r, c] of solution) {
    if (!placed.has(`${r},${c}`) && grid.canPlaceLightAt(r, c)) return [r, c];
  }
  return null; // grille déjà correcte, ou plus aucune case-solution posable
}

/** Repère une impulsion posée par le joueur qui n'appartient PAS à la
 * solution (une erreur), pour la retirer. Retour utilisateur: "je préfère
 * qu'en priorité on retire une impulsion mal placée plutôt que de placer
 * une bonne impulsion, c'est plus important d'avoir une grille propre" —
 * consultée EN PREMIER par applyHint(), avant même findNextHintCell()
 * ci-dessus. Ce type de lumière mal placée, en illuminant une case-
 * solution voisine, bloque de toute façon souvent la suite (voir
 * findNextHintCell) — la retirer débloque la grille pour qu'un prochain
 * indice puisse ensuite proposer une pose normale. Retourne `null` si la
 * grille est déjà entièrement correcte (rien à retirer). */
function findWrongPlacedCell() {
  if (!currentLevel || !grid) return null;
  const solution = getCurrentLevelSolution();
  if (!solution) return null;
  const solutionSet = new Set(solution.map(([r, c]) => `${r},${c}`));
  for (const [r, c] of grid.getPlacedLights()) {
    if (!solutionSet.has(`${r},${c}`)) return [r, c];
  }
  return null;
}

/** Pose la mise en valeur "halo sonar" (voir hint-modal.css:
 * .cell--hint/.cell--hint-remove/@keyframes cell-hint-sonar) sur une case
 * pendant HINT_HIGHLIGHT_MS, puis la retire — jamais persistante. Purement
 * cosmétique: la lumière elle-même est déjà posée/retirée par
 * handleCellClick() avant cet appel (voir btnHint.onclick).
 * `remove` (round "grille pleine d'erreurs"): bascule sur le halo rouge
 * `.cell--hint-remove` plutôt que le halo doré `.cell--hint`, pour
 * distinguer sans ambiguïté "l'indice vient de RETIRER une impulsion
 * erronée ici" de son sens habituel "l'indice vient d'en POSER une ici". */
function showHintAt(r, c, { remove = false } = {}) {
  const el = renderer.cellElementAt(r, c);
  if (!el) return;
  if (hintHighlightTimeout) clearTimeout(hintHighlightTimeout);
  boardEl
    .querySelectorAll(".cell--hint, .cell--hint-remove")
    .forEach((n) => n.classList.remove("cell--hint", "cell--hint-remove"));
  // Reflow forcé (même technique que awardInfinitePoints ci-dessus): permet
  // de relancer l'animation même si un indice précédent vient d'être
  // utilisé sur la MÊME case juste avant.
  void el.offsetWidth;
  const cls = remove ? "cell--hint-remove" : "cell--hint";
  el.classList.add(cls);
  hintHighlightTimeout = setTimeout(() => {
    el.classList.remove(cls);
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

/** Cœur du clic Indice (pose la prochaine case-solution, ou retire une
 * erreur en repli) — extrait de btnHint.onclick pour pouvoir être différé
 * d'une frame (voir plus bas), sans dupliquer cette logique. */
function applyHint() {
  // Retour utilisateur: "je préfère qu'en priorité on retire une impulsion
  // mal placée plutôt que de placer une bonne impulsion. C'est plus
  // important d'avoir une grille propre." — inversion de l'ordre précédent
  // (qui posait en priorité, et ne retirait qu'en repli si plus aucune
  // case-solution n'était posable, voir plus bas): on regarde D'ABORD s'il
  // existe une impulsion mal placée (findWrongPlacedCell) et on la retire
  // si oui, avant même de chercher une case-solution à poser. Les deux
  // fonctions sont de simples lectures de l'état courant (aucun effet de
  // bord), donc les appeler dans cet ordre ne change que la PRIORITÉ, pas
  // leur résultat individuel.
  const wrong = findWrongPlacedCell();
  if (wrong) {
    hintStock--;
    renderHintUI();
    // Un indice POSE/RETIRE directement la lumière (retour utilisateur:
    // "l'indice doit placer la lumière, pas juste indiquer la position") —
    // on rejoue exactement le chemin d'un clic joueur (son, historique
    // Annuler, anim. neurone miroir, détection de victoire), pour que le
    // résultat soit strictement indiscernable d'un coup joué à la main,
    // puis on ajoute le halo rouge par-dessus pour signaler que c'était un
    // indice de RETRAIT.
    handleCellClick(wrong[0], wrong[1]);
    showHintAt(wrong[0], wrong[1], { remove: true });
    return;
  }
  // Repli: aucune impulsion erronée à retirer (grille propre jusqu'ici) —
  // on peut proposer la pose d'une case-solution normalement. Reste utile
  // même seul dans le cas historique ("les indices ne fonctionnent pas si
  // on a rempli une grille avec des erreurs, puisqu'il ne peut pas
  // proposer le prochain mouvement dans ce cas", voir findNextHintCell):
  // avec la nouvelle priorité, ce cas ne peut de toute façon plus se
  // produire, puisque toute erreur est retirée avant d'en arriver ici.
  const next = findNextHintCell();
  if (!next) return; // grille déjà entièrement correcte: rien à faire
  hintStock--;
  renderHintUI();
  handleCellClick(next[0], next[1]);
  showHintAt(next[0], next[1]);
}

btnHint.onclick = () => {
  if (boardLocked || infiniteGenerationPending || btnHint.disabled) return;
  if (hintStock <= 0) {
    openHintModal();
    return;
  }
  // Retour utilisateur: "si ça charge encore il faut qu'il passe en état
  // loading/disable pour éviter le spam" — sur le TOUT PREMIER indice
  // demandé pour un niveau, getCurrentLevelSolution()/findSolution()
  // (appelée par applyHint ci-dessus) peut bloquer le thread principal
  // plusieurs secondes sur les niveaux les plus costauds (voir son
  // commentaire, ex. la grille 42) avant d'être mise en cache. Sans ce
  // verrou, chaque clic supplémentaire fait PENDANT ce blocage reste en
  // file d'attente côté navigateur et se déclenche d'un coup dès que le
  // calcul se termine, chacun consommant un indice au passage — un vrai
  // spam involontaire plutôt qu'un vrai geste du joueur.
  // Désactivé AVANT tout calcul, dans un setTimeout(0): le navigateur a
  // ainsi l'occasion de peindre l'état "chargement" (voir hint-modal.css:
  // .hint-btn--loading) ET d'enregistrer `disabled` avant que le blocage ne
  // démarre — un bouton désactivé ne déclenche plus du tout son onclick,
  // donc les clics faits pendant le calcul sont ignorés au lieu de
  // s'empiler. Sur le chemin RAPIDE (solution déjà en cache), ce délai
  // ajoute ~0 à quelques ms, imperceptible.
  btnHint.disabled = true;
  btnHint.classList.add("hint-btn--loading");
  setTimeout(() => {
    try {
      applyHint();
    } finally {
      btnHint.disabled = false;
      btnHint.classList.remove("hint-btn--loading");
    }
  }, 0);
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

// Retour utilisateur (Meditate): "on passe à la grille suivante une fois
// qu'on a fermé la modale de récompense" — callback optionnel exécuté à la
// fermeture (croix/bouton/clic extérieur, voir plus bas), jamais à
// l'ouverture: seul onMeditateCellClick s'en sert pour l'instant (bascule
// vers la bannière suivante/l'écran de fin SEULEMENT une fois la modale
// refermée), mais généralisé ici plutôt que codé en dur pour Meditate, au
// cas où un futur appelant en ait besoin aussi.
let cosmeticUnlockOnClose = null;

// Retour utilisateur (renommage): "avatar" (code, community-store.js:
// AVATARS) s'appelle désormais "Badge" côté joueur, et l'ancien "badge"
// (tier/cadre, sommation.js/dailyChallenge.js) s'appelle désormais
// "Bannière" — jamais renommé dans le CODE (trop de surface, aucune valeur
// pour un simple changement de vocabulaire visible), seulement dans les
// libellés affichés ci-dessous et ailleurs dans ce fichier.
/** @param {{kind: "avatar"|"badge"|"star", avatarId?: string, badgeTier?: number, title: string, subtitle: string}} opts */
function showCosmeticUnlockModal({ kind, avatarId, badgeTier, title, subtitle, onClose }) {
  cosmeticUnlockOnClose = typeof onClose === "function" ? onClose : null;
  cosmeticUnlockKickerEl.textContent =
    kind === "badge"
      ? "Nouvelle bannière débloquée"
      : kind === "star"
      ? "Défi quotidien réussi"
      : "Nouveau badge débloqué";
  cosmeticUnlockRevealEl.innerHTML = "";
  if (kind === "avatar") {
    const bubble = document.createElement("span");
    bubble.className = "cosmetic-unlock-avatar";
    bubble.innerHTML = getAvatarSvg(avatarId);
    cosmeticUnlockRevealEl.appendChild(bubble);
  } else if (kind === "star") {
    // Défi Quotidien (retour utilisateur): "à la victoire on utilise la pop
    // up de récompense pour montrer qu'on a gagné une étoile" — réutilise
    // EXACTEMENT ce même mécanisme .modal/.cosmetic-unlock-* plutôt qu'une
    // modale dédiée, juste une 3e variante de bulle de révélation (même
    // structure que .cosmetic-unlock-avatar, voir hint-modal.css). Icône
    // éclair (retour utilisateur: "étoile" -> "Énergie") — même tracé que
    // le bouton flottant du Défi Quotidien (voir currencyIcons.js: boltIconSVG).
    const bubble = document.createElement("span");
    bubble.className = "cosmetic-unlock-avatar cosmetic-unlock-star";
    bubble.innerHTML = boltIconSVG();
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
  el.onclick = () => {
    cosmeticUnlockModal.classList.add("hidden");
    // Exécute puis efface le callback AVANT de le lancer (pas après): s'il
    // rouvrait lui-même une modale/déclenchait une nouvelle navigation, on
    // ne veut jamais qu'un `cosmeticUnlockOnClose = null` tardif efface un
    // callback entre-temps réassigné par ce nouvel appel.
    const onClose = cosmeticUnlockOnClose;
    cosmeticUnlockOnClose = null;
    if (onClose) onClose();
  };
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
    trackEvent("rewarded_ad_completed", { placement: "hint" });
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

// Retour utilisateur: "on peut appliquer le fondu inverse lorsqu'on coupe la
// musique [...] applique cette logique aussi sur le bouton couper le
// son/remettre le son" — même fondu rapide que celui déjà utilisé au
// retour de pause/perte de focus (voir music.js: TRANSPORT_FADE_MS), pour
// que couper/rétablir le son via ce bouton n'ait pas non plus le petit
// crachat d'un saut de volume instantané. Volontairement PAS appliqué au
// curseur de volume (glissement du doigt, déjà progressif par nature — un
// fondu y ajouterait juste un temps de retard perceptible et inutile).
const MUTE_FADE_MS = 180;

function applyVolumes({ fade = false } = {}) {
  const level = Number(settings.volume) / 100;
  setMasterVolume(settings.muted ? 0 : level);
  setMusicVolume(settings.muted || settings.musicMuted ? 0 : level, fade ? MUTE_FADE_MS : undefined);
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
  applyVolumes({ fade: true });
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
trackEvent("app_open");

// Round 25 (retour utilisateur: "lorsqu'on joue une grille (histoire ou
// infinity) ou au mode bonus, on veut afficher un bandeau publicitaire tout
// en bas de l'écran en même temps") — réserve EXACTEMENT la hauteur réelle
// du bandeau (voir game/ads.js: onBannerHeightChange) sous le plateau/
// Remember pendant qu'il est affiché, jamais un espace deviné qui laisserait
// un vide ou chevaucherait le jeu. 0 = bandeau caché/pas chargé/échoué,
// retombe alors sur aucun espace réservé. Voir showView() plus bas pour
// quand le bandeau est montré/caché.
// Retour utilisateur: "la pub bandeau en bas en jeu mange trop sur
// l'interface, il faudrait ajouter une marge" — marge ajoutée UNIQUEMENT
// quand un bandeau est réellement affiché (px > 0), jamais quand il est
// caché/pas chargé (web/dev), pour ne rien décaler dans ce cas.
// Retour utilisateur (rounds suivants): "encore davantage de marge" —
// 10px puis 28px jugés encore insuffisants, remonté à 36px.
const AD_BANNER_MARGIN = 36;
onBannerHeightChange((px) => {
  document.documentElement.style.setProperty("--ad-banner-height", `${px > 0 ? px + AD_BANNER_MARGIN : 0}px`);
});

// Round "audit coûts serveur" (retour utilisateur: "j'aimerais que le
// serveur tienne bien") — plus d'écoute temps réel démarrée ici au
// chargement: voir showView() plus bas, refreshCommunityCloud() n'est
// appelée QUE quand le joueur entre vraiment sur l'écran Communauté/Mon
// profil (démarrage paresseux : un joueur qui ne visite jamais ces écrans
// ne déclenche plus aucune lecture Firestore au lancement de l'app).
// Ré-affiche l'écran Communauté/Mon profil s'il est actif quand le fil
// change (nouvelle grille publiée par vous ou un autre joueur, résolution de
// l'uid anonyme, retour d'un refreshCommunityCloud()...) — même logique de
// rendu que showView() pour ces deux écrans (voir plus bas), pour ne jamais
// laisser un fil périmé à l'écran après un aller-retour Firestore qui arrive
// après coup.
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
// "Désactiver les publicités" / "Soutenir le développeur" (retour
// utilisateur: wording changé depuis "Débloquer la version complète" /
// "retire les publicités") : maquette volontairement sans action pour
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
document.getElementById("btn-reset-confirm").onclick = async () => {
  eraseAllProgress();
  resetSommationProgress();
  // Round suivant (retour utilisateur, "Reset complet" plutôt que migrer
  // l'ancien seuil d'Énergie): la progression Meditate (bannière en cours,
  // grille en cours, Comète/Supernova déjà débloquées par ce système) est
  // elle aussi un "bonus débloqué" au même titre que Remember ci-dessus.
  resetMeditateProgress();
  // Round 22: `ownedAvatars` (avatars achetés avec des points, voir
  // community-store.js: unlock.type === "purchase") est lui aussi un "bonus
  // débloqué" au même titre qu'avatar/activeBadge ci-dessous — les points
  // eux-mêmes sont déjà remis à zéro par eraseAllProgress().
  updateProfile({ avatar: DEFAULT_AVATAR, activeBadge: null, ownedAvatars: [] });
  // Avatar/badge remis à zéro ci-dessus: propage aussi ce reset aux grilles
  // déjà publiées (voir syncMyAuthorEverywhere) — `await` nécessaire ICI
  // (voir son commentaire) car window.location.reload() suit immédiatement.
  await syncMyAuthorEverywhere();
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

// Mode Admin [dev uniquement] — voir admin.js pour la justification
// complète de ce `if (import.meta.env.DEV)`: en build de production, cette
// branche entière est du code mort (littéralement `if (false)`) éliminé du
// bundle par esbuild, le bouton n'existe donc plus du tout, ni dans le DOM
// ni dans le JS livré. Auparavant un bouton statique d'index.html
// (#btn-pixelart-debug-unlock), toujours présent y compris en prod — ce
// chantier le recrée dynamiquement ici à la place, visible seulement une
// fois le mode admin activé via le toggle flottant (voir admin.js:
// initAdminToggle). Cliquer une fois débloqué n'a plus d'effet
// (debugUnlockPixelArt ne redescend jamais le compteur), donc pas besoin de
// le retirer après usage.
if (import.meta.env.DEV) {
  mountAdminButton("#options-pixelart-section", "Débloquer (débug)", null, () => {
    debugUnlockPixelArt();
    renderPixelArtOption();
  });
}

// ---------- Langue ----------
// Retour utilisateur: "init en dur sur l'anglais (fallback), init dynamique
// par la détection [...] puis on ajoute dans options la possibilité de
// changer la langue" — la résolution de la langue AU DÉMARRAGE est faite
// tout en haut de ce fichier (voir savedLocale/setLocale juste après les
// imports) ; ce <select> ne fait que permettre au joueur de la changer
// ENSUITE, à tout moment, et persiste son choix explicite (settings.locale)
// qui prime alors sur la détection à chaque futur démarrage.
const languageSelect = document.getElementById("options-language-select");

/** Peuple le <select> une seule fois (les langues disponibles ne changent
 * jamais en cours de session) à partir de getSupportedLocales() — jamais de
 * liste dupliquée en dur dans index.html, même raisonnement que le reste de
 * cette section: LOCALES/LOCALE_NAMES (game/i18n.js) restent la SEULE source
 * de vérité sur les langues supportées. */
function populateLanguageSelect() {
  languageSelect.innerHTML = "";
  for (const { code, name } of getSupportedLocales()) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = name;
    languageSelect.appendChild(opt);
  }
}
populateLanguageSelect();

/** Ré-exécutée à chaque affichage d'Options (voir showView), même principe
 * que renderColorblindOption/renderPlayGamesSection ci-dessous: reflète la
 * langue RÉELLEMENT active (pas seulement settings.locale, qui peut être
 * `null` si le joueur n'a jamais rien choisi et que la langue vient de la
 * détection système). */
function renderLanguageOption() {
  languageSelect.value = getLocale();
}
renderLanguageOption();

languageSelect.onchange = () => {
  const code = languageSelect.value;
  setLocale(code);
  settings.locale = code;
  saveSettings(settings);
  trackEvent("language_changed", { locale: code });
  // Ré-applique tous les data-i18n/data-i18n-attr du document ENTIER (pas
  // seulement l'écran Options affiché) — même mécanisme qu'au démarrage
  // (voir tout en haut de ce fichier), pour que les autres écrans affichent
  // déjà le bon texte dès qu'on y navigue, sans re-render dédié par écran.
  applyI18n();
};

// ---------- Mode daltonien ----------
// Toujours disponible (pas de déblocage, contrairement à PixelArt
// ci-dessus) — voir colorblind.js: purement un calque d'affichage, aucune
// des couleurs/règles réelles (colors.js/grid.js) n'est modifiée.
const btnColorblindToggle = document.getElementById("btn-colorblind-toggle");

function renderColorblindOption() {
  btnColorblindToggle.textContent = settings.colorblindEnabled ? "Activé" : "Désactivé";
  btnColorblindToggle.classList.toggle("options-btn--accent", settings.colorblindEnabled);
}
renderColorblindOption();

btnColorblindToggle.onclick = () => {
  settings.colorblindEnabled = !settings.colorblindEnabled;
  saveSettings(settings);
  trackEvent("colorblind_mode_toggled", { enabled: settings.colorblindEnabled });
  renderColorblindOption();
  // Même raisonnement que applyPixelArtTheme ci-dessus: le plateau peut déjà
  // être construit en mémoire même si Options est l'écran affiché, donc un
  // re-render explicite est nécessaire pour voir l'effet immédiatement.
  if (renderer.grid) renderer.render();
};

// ---------- Compte Google Play Games ----------
// Retour utilisateur: "pour la sauvegarde de la progression [...] utiliser
// [...] GooglePlay à travers l'auth qu'ils fournissent" — voir
// playGamesServices.js pour le détail (module isolé, Android uniquement, ne
// throw jamais). Section entière masquée sur web/dev/iOS (voir
// renderPlayGamesSection ci-dessous), donc jamais de bouton mort à l'écran
// sur une plateforme où la fonctionnalité n'existe pas.
const playgamesSectionEl = document.getElementById("options-playgames-section");
const btnPlaygamesSignin = document.getElementById("btn-playgames-signin");
const playgamesSyncActionsEl = document.getElementById("playgames-sync-actions");
const btnPlaygamesSave = document.getElementById("btn-playgames-save");
const btnPlaygamesRestore = document.getElementById("btn-playgames-restore");
const playgamesHintEl = document.getElementById("options-playgames-hint");

/** Ré-exécutée à chaque affichage d'Options (voir showView), même principe
 * que renderPixelArtOption()/renderColorblindOption() — l'état de connexion
 * peut changer entre deux passages (connexion réussie, session expirée). */
function renderPlayGamesSection() {
  if (!isPlayGamesAvailable()) {
    playgamesSectionEl.classList.add("hidden");
    return;
  }
  playgamesSectionEl.classList.remove("hidden");
  const signedIn = isPlayGamesSignedIn();
  btnPlaygamesSignin.classList.toggle("hidden", signedIn);
  playgamesSyncActionsEl.classList.toggle("hidden", !signedIn);
  playgamesHintEl.textContent = signedIn
    ? "Connecté — ta progression peut être sauvegardée/restaurée à tout moment."
    : "Connecte-toi pour sauvegarder ta progression dans le cloud.";
}

/** Retour utilisateur: "si un joueur change son pseudo, il faudra le
 * changer aussi dans l'affichage du pseudo du créateur d'une grille [...]
 * (ou avatar ou badge)" — BUG CORRIGÉ: community-store.js expose depuis
 * longtemps `syncAuthorToPublishedLevels(author)` pour ça (voir son
 * commentaire), documentée comme appelée "chaque fois que pseudo/avatar/
 * badge change" par une fonction `updateProfileAndSyncAuthor` — qui
 * n'existait en réalité NULLE PART dans ce fichier: aucun des 5 points où
 * `updateProfile()` touche pseudo/avatar/badge (adoption pseudo Google Play,
 * sélection/achat d'avatar, bascule de badge, validation du pseudo) ne
 * l'appelait. Ce petit wrapper centralise l'appel (toujours après
 * `updateProfile`, jamais avant: relit le profil pour être sûr d'envoyer
 * l'état FINAL) — un seul endroit à appeler aux 5 sites plutôt que de
 * reconstruire cette forme `{pseudo, avatar, badge}` à chaque fois (même
 * shape que editor.js au moment de la publication). Best-effort comme
 * syncAuthorToPublishedLevels lui-même: ne bloque jamais l'UI, aucun retour
 * à gérer par l'appelant. */
function syncMyAuthorEverywhere() {
  const profile = loadProfile();
  const pseudo = profile?.pseudo?.trim();
  if (!pseudo) return Promise.resolve(); // pas encore de pseudo choisi: aucune grille n'a pu être publiée sous ce profil
  // Retourne la Promise (async côté community-store.js) plutôt que de
  // l'ignorer: le site d'appel "Réinitialiser le profil" ci-dessous fait un
  // window.location.reload() juste après — sans `await` sur cette Promise
  // à CET endroit précis, le rechargement de page annulerait la requête
  // réseau en plein vol avant qu'elle ait pu partir. Les 4 autres sites
  // d'appel restent volontairement "fire and forget" (aucun reload derrière
  // eux, pas besoin d'attendre).
  return syncAuthorToPublishedLevels({
    pseudo,
    avatar: profile.avatar ?? DEFAULT_AVATAR,
    badge: profile.activeBadge ?? null,
  });
}

/** Retour utilisateur: "par défaut, on récupère le pseudo fourni par Google
 * Play via le profil joueur" — appelée juste après une connexion réussie
 * (au démarrage via refreshStatus si une session était déjà active, ou après
 * un clic explicite sur "Se connecter"). Ne touche JAMAIS un pseudo déjà
 * choisi par le joueur (voir la garde `!profile?.pseudo?.trim()` ci-dessous):
 * c'est un préremplissage par défaut, pas une synchronisation forcée — un
 * joueur qui a délibérément choisi un pseudo différent du sien sur Google
 * Play garde le sien. Best-effort comme le reste du module: aucune erreur
 * visible si le nom n'a pas pu être récupéré. */
async function maybeAdoptPlayGamesPseudo() {
  if (!isPlayGamesSignedIn()) return;
  const profile = loadProfile();
  if (profile?.pseudo?.trim()) return;
  // Sanitisé comme tout pseudo saisi à la main (voir sanitizeInputInPlace/
  // storage.js: sanitizePlayerText) — le nom Google Play Games peut contenir
  // des chiffres/symboles qu'on ne veut pas voir ressortir publiquement dans
  // la Communauté, même quand il n'est pas tapé par le joueur lui-même.
  const displayName = sanitizePlayerText(await getPlayGamesDisplayName());
  if (!displayName) return;
  updateProfile({ pseudo: displayName });
  syncMyAuthorEverywhere();
  // Rafraîchit tout affichage déjà visible du pseudo — la bannière de titre
  // (toujours montée) et, si le joueur est déjà sur "Mon profil", le champ
  // texte + la prévisu (sinon renderCommunityProfile les reconstruira à la
  // prochaine ouverture de l'écran de toute façon).
  renderTitleProfileBanner();
  if (profilePseudoLabelEl) profilePseudoLabelEl.textContent = displayName;
  if (profilePseudoInput) profilePseudoInput.value = displayName;
  refreshProfileBadgePreview();
}

btnPlaygamesSignin.onclick = async () => {
  btnPlaygamesSignin.disabled = true;
  btnPlaygamesSignin.textContent = "Connexion…";
  const { isAuthenticated } = await signInToPlayGames();
  btnPlaygamesSignin.disabled = false;
  btnPlaygamesSignin.textContent = "Se connecter";
  renderPlayGamesSection();
  // Première sauvegarde automatique juste après la connexion (best-effort,
  // silencieuse — voir saveProgressToCloud) : évite qu'un joueur qui vient
  // de se connecter reste sans sauvegarde cloud tant qu'il n'a pas cliqué
  // explicitement "Sauvegarder".
  if (isAuthenticated) {
    saveProgressToCloud();
    maybeAdoptPlayGamesPseudo();
  }
};

btnPlaygamesSave.onclick = async () => {
  btnPlaygamesSave.disabled = true;
  const original = btnPlaygamesSave.textContent;
  btnPlaygamesSave.textContent = "Sauvegarde…";
  const { ok } = await saveProgressToCloud();
  btnPlaygamesSave.disabled = false;
  btnPlaygamesSave.textContent = original;
  playgamesHintEl.textContent = ok
    ? "Progression sauvegardée."
    : "Échec de la sauvegarde — réessaie plus tard.";
};

// Restaurer ÉCRASE la progression locale (voir playGamesServices.js:
// restoreProgressFromCloud) — confirmation native `confirm()` plutôt qu'une
// modale dédiée (voir #reset-confirm-modal pour le pattern existant): action
// rare, `confirm()` suffit et reste cohérent avec une WebView Android.
btnPlaygamesRestore.onclick = async () => {
  const sure = window.confirm(
    "Restaurer va remplacer ta progression actuelle sur cet appareil par celle sauvegardée dans le cloud. Continuer ?"
  );
  if (!sure) return;
  btnPlaygamesRestore.disabled = true;
  const original = btnPlaygamesRestore.textContent;
  btnPlaygamesRestore.textContent = "Restauration…";
  const { ok } = await restoreProgressFromCloud();
  btnPlaygamesRestore.disabled = false;
  btnPlaygamesRestore.textContent = original;
  if (ok) {
    // Toute la progression locale vient de changer sous les pieds de l'app
    // (points/story/profil/Remember) — un rechargement complet est plus sûr
    // qu'un rafraîchissement partiel de chaque écran concerné (même choix
    // que btn-reset-confirm ci-dessus: window.location.reload()).
    window.location.reload();
  } else {
    playgamesHintEl.textContent = "Échec de la restauration — réessaie plus tard.";
  }
};

// Vérifie la session au démarrage (silencieux, jamais de popup — voir
// playGamesServices.js: refreshStatus) puis met à jour la section si le
// joueur est déjà sur Options au moment où ça résout (cas rare, mais safe).
// Round suivant (retour utilisateur): si une session Google Play était déjà
// active (reconnexion silencieuse), c'est ICI — pas seulement après un clic
// explicite sur "Se connecter" — qu'il faut tenter le préremplissage du
// pseudo, sinon un joueur déjà connecté d'une session précédente ne le
// verrait jamais appliqué automatiquement.
refreshPlayGamesStatus().then(() => {
  renderPlayGamesSection();
  maybeAdoptPlayGamesPseudo();
});

// ---------- Mode Infini ----------
// Voir docs/infinite-mode-design.md. Un niveau généré est un objet niveau
// STANDARD (comme n'importe quelle entrée de levels.js) : une fois obtenu,
// il traverse exactement le même chemin (`grid`/`renderer`/`handleCellClick`)
// qu'un niveau statique — seule la façon dont on l'obtient diffère.

const navStaticEl = document.getElementById("nav-static");
const navInfiniteEl = document.getElementById("nav-infinite");
const navDailyEl = document.getElementById("nav-daily");
// Retour utilisateur: "le titre '⚡ Défi Quotidien' [...] n'est pas aligné a
// gauche alors qu'il devrait" — voir setMode() plus bas: .play-controls
// (screen-header.css) est poussé à l'extrémité droite du header par défaut
// (margin-left:auto), pensé pour les modes où .header-actions affiche un
// bouton à gauche (sélection de niveau en Histoire, réglages en Infini) —
// titre à droite, bouton à gauche. En mode Défi Quotidien, AUCUN bouton
// n'est affiché dans .header-actions (ni sélection de niveau, ni réglages,
// ni "nouveau niveau" — une seule grille par jour, voir setMode), donc rien
// ne justifie de pousser le titre à droite: il doit rester juste après le
// bouton Retour, comme un .screen-title classique.
const playControlsEl = document.querySelector(".play-controls");
const infiniteLevelLabelEl = document.getElementById("infinite-level-label");
const infiniteBadgeEl = document.getElementById("infinite-badge");
// Retour utilisateur: "+1/+3/+5 en fonction de la difficulté choisie en
// dessous du compte d'étoiles" — voir loadInfiniteLevel() plus bas.
const infiniteGainEl = document.getElementById("infinite-gain");
const btnInfiniteSettings = document.getElementById("btn-infinite-settings");
const btnInfiniteNext = document.getElementById("btn-infinite-next");
const infiniteFeaturesEl = document.getElementById("infinite-features");
const btnInfiniteGenerate = document.getElementById("btn-infinite-generate");
const infiniteStatusEl = document.getElementById("infinite-status");
// Voir runGeneration(): panneau entier grisé pendant une génération (pas
// seulement le bouton) — voir mode-infinite.css: .infinite-config.is-generating.
const infiniteConfigPanelEl = document.querySelector(".infinite-config");
// Retour utilisateur: "le chargement peut être long donc ce serait bien
// d'avoir un état de loading joli et simple" — un spinner CSS (voir
// mode-infinite.css: .infinite-spinner) plutôt qu'un simple texte qui
// change, pour qu'une génération de plusieurs secondes (paliers élevés,
// voir generator.js: DEFAULT_MAX_TIME_MS_BY_TIER) se lise clairement comme
// "en cours" et pas comme un gel de l'appli.
const INFINITE_SPINNER_HTML = '<span class="infinite-spinner" aria-hidden="true"></span>';

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
  // Retour utilisateur: "afficher le nombre de points à gagner par niveau
  // en fonction [de la difficulté]" — rempli ici plutôt qu'en dur dans
  // index.html: INFINITE_POINTS_BY_TIER (ci-dessus) reste l'UNIQUE source
  // du barème, à la fois pour ce texte et pour le vrai gain (voir
  // awardInfinitePoints) — jamais deux valeurs à tenir manuellement
  // synchronisées.
  const tier = Number(btn.dataset.difficulty);
  const pointsEl = btn.querySelector(".infinite-star-points");
  // Retour utilisateur: icône étoile au lieu de l'abréviation "pt".
  if (pointsEl) pointsEl.innerHTML = `+${starLabel(INFINITE_POINTS_BY_TIER[tier] ?? 1)}/niveau`;

  btn.onclick = () => {
    infiniteDifficulty = tier;
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
  // Règle de base — une impulsion "neutre" (les 3 canaux allumés: c'est la
  // couleur par défaut d'une impulsion posée sans neurone coloré à
  // proximité, voir grid.js), même rendu qu'en jeu (voir render.js:
  // neuronIcon, désormais exportée). N'apparaît PAS dans FEATURES
  // (generator.js): ce n'est pas une mécanique optionnelle du mode Infini,
  // donc pas de tuile dans buildFeatureChecklist() pour cette clé — utilisée
  // UNIQUEMENT par MECHANIC_SCHEMAS.base ci-dessous.
  base: neuronIcon({ r: true, g: true, b: true }),
  // Retour utilisateur: "il faut une pop up explicative pour le Neurone
  // (sans couleur)" — dédiée, séparée de "base" (qui n'explique que la
  // règle de pose de l'impulsion) : un neurone satisfait SANS couleur
  // (aucune clé `color`), même rendu que sur le plateau (voir render.js:
  // chargeIcon). Déclenchée par détection réelle (voir
  // queueNewMechanicSchemas: hasPlainNeuron), pas forcée — le premier
  // neurone n'apparaît qu'au niveau 3, jamais au niveau 1.
  neuron: chargeIcon({ number: 2, _adjacentLights: 2 }),
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
    // i18n: FEATURES (generator.js) reste un module de logique pure, sans
    // dépendance à i18n.js — `feature.label` (français en dur) n'y sert que
    // de nom interne/repli; le texte réellement affiché passe par une clé
    // dédiée "feature.<key>" (voir locales/fr.js) résolue ici, seul endroit
    // qui consomme ce label pour de l'affichage.
    const featureLabel = t(`feature.${key}`);
    tile.setAttribute("aria-label", featureLabel);
    tile.title = featureLabel;
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
//
// "base" ET "neuron" (retour utilisateur: "il faut une pop up explicative
// pour le Neurone (sans couleur)") — deux entrées DISTINCTES pour deux
// règles distinctes (poser une impulsion / lire un neurone), contrairement
// aux autres entrées ci-dessous elles ne sont jamais retournées par
// detectMechanics (présentes dans TOUS les niveaux dès le niveau 1, pas une
// mécanique optionnelle détectable au cas par cas) : voir
// queueNewMechanicSchemas ci-dessous, qui les ajoute systématiquement à la
// liste de candidats plutôt que de les dériver du contenu de la grille —
// seul `seenMechanics` (voir plus bas) garantit que chacune ne s'affiche
// qu'une fois, comme les autres.
//
// Terminologie (retour utilisateur, round 27 — remplace la convention
// "lumière"/"neurone" du round précédent, voir git log pour l'historique):
// "La lumière c'est une impulsion. Les éléments à charge sont des neurones.
// Il y a donc des neurones colorés, et aussi des neurones miroirs." —
// ce que le joueur POSE (voir grid.js/toggleLight) s'appelle désormais une
// "impulsion", jamais une "lumière". Une case à charge numérotée (colorée
// ou non) est un "neurone" — "neurone coloré" pour la variante qui tire un
// rayon, "neurone miroir" pour l'obstacle FIXE qui duplique une impulsion
// (MIRROR_NEURON, un neurone lui aussi dans cette terminologie, bien que
// distinct des neurones à charge). Comme pour le round précédent, ce
// renommage reste UNIQUEMENT côté texte/UI : les noms internes (CellType,
// grid.js, generator.js, `charge`/`light` dans le code) ne sont pas
// retouchés, seul ce que voit le joueur change.
// i18n: titre/texte de chaque tuto vivent maintenant dans locales/fr.js
// (clés "mechanic.<key>.title"/"mechanic.<key>.text") — MECHANIC_SCHEMAS ne
// garde que la structure (quelles clés existent) et résout via t() au
// moment de l'affichage (voir showNextMechanicSchema/renderMechanicsReference
// ci-dessous), pour que modifier un texte de tuto se fasse désormais dans
// fr.js, jamais ici.
const MECHANIC_SCHEMAS = {
  base: { titleKey: "mechanic.base.title", textKey: "mechanic.base.text" },
  neuron: { titleKey: "mechanic.neuron.title", textKey: "mechanic.neuron.text" },
  forbidden: { titleKey: "mechanic.forbidden.title", textKey: "mechanic.forbidden.text" },
  color: { titleKey: "mechanic.color.title", textKey: "mechanic.color.text" },
  mirror: { titleKey: "mechanic.mirror.title", textKey: "mechanic.mirror.text" },
  prism: { titleKey: "mechanic.prism.title", textKey: "mechanic.prism.text" },
  pyra: { titleKey: "mechanic.pyra.title", textKey: "mechanic.pyra.text" },
  mirrorNeuron: { titleKey: "mechanic.mirrorNeuron.title", textKey: "mechanic.mirrorNeuron.text" },
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
  mechanicSchemaTitleEl.textContent = t(schema.titleKey);
  mechanicSchemaTextEl.textContent = t(schema.textKey);
  mechanicSchemaModal.classList.remove("hidden");
}

/** Vrai si `cells` contient au moins un neurone à charge SANS couleur (un
 * simple chiffre 1-4 — jamais "0", réservé à "case interdite", ni un token
 * à 2+ caractères type "2r", réservé à detectMechanics/"color"). Même
 * tokenisation compacte-vs-espacée que detectMechanics ci-dessus (voir son
 * commentaire) pour rester cohérent avec le vrai parseur du jeu (grid.js).
 *
 * BUG CORRIGÉ (retour utilisateur: "la description du neurone arrive au
 * lvl 1 alors qu'elle devrait arriver au level 3") : `queueNewMechanicSchemas`
 * forçait "neuron" en tête de liste dès le tout premier niveau, sur la foi
 * d'un commentaire ("un neurone est présent dès le niveau 1") qui s'est
 * révélé faux — le niveau 1 (`["..", ".."]`) n'a AUCUN chiffre, le premier
 * neurone n'apparaît qu'au niveau 3 (`["..2..", ".XXXX"]`, voir levels.js).
 * Remplacé par cette détection réelle, exactement comme "color" avait déjà
 * dû l'être plus haut pour un bug similaire (voir le commentaire de
 * detectMechanics: "la popup [...] arrive au niveau 4 alors que [...]
 * seulement au niveau 9"). */
function hasPlainNeuron(cells) {
  for (const row of cells) {
    const tokens = Array.isArray(row)
      ? row
      : String(row).includes(" ")
      ? String(row).trim().split(/\s+/)
      : String(row).trim().split("");
    for (const token of tokens) {
      if (/^[1-4]$/.test(token)) return true;
    }
  }
  return false;
}

/** Appelée par loadLevel() (mode Histoire uniquement): compare les
 * mécaniques de la grille qui vient de charger à celles déjà vues (voir
 * storage.js: loadSeenMechanics/saveSeenMechanics), enfile les nouvelles et
 * les marque vues IMMÉDIATEMENT (pas seulement à la fermeture de la
 * modale — même si le joueur quitte l'écran sans la fermer, elle ne doit
 * jamais réapparaître pour la même mécanique). */
function queueNewMechanicSchemas(cells) {
  // "base" ne dépend d'aucune détection (toujours pertinente dès la
  // première case vide, donc toujours en tête) — "neuron", elle, doit
  // attendre la première VRAIE apparition d'un neurone sans couleur (voir
  // hasPlainNeuron ci-dessus), jamais forcée. `seenMechanics` (juste en
  // dessous) se charge seule de ne montrer chacune qu'une fois passé ce cap.
  const found = ["base", ...(hasPlainNeuron(cells) ? ["neuron"] : []), ...detectMechanics(cells)];
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

// ---------- Aide-mémoire "Mécaniques découvertes" (Options) ----------
// Retour utilisateur: "il faudrait pouvoir retrouver toutes les mécaniques
// dans un des onglets au cas où on oublie" — liste en lecture seule des
// modales pédagogiques ci-dessus (MECHANIC_SCHEMAS) déjà vues par le joueur
// (voir seenMechanics), jamais celles à venir (pas de spoil de la
// progression Histoire). Contrairement à mechanic-schema-modal, purement
// consultée à la demande: fermable par la croix ET par un clic en dehors
// (voir index.html), rien à protéger d'un misclick ici.
const mechanicsReferenceModal = document.getElementById("mechanics-reference-modal");
const mechanicsReferenceListEl = document.getElementById("mechanics-reference-list");
const btnMechanicsReference = document.getElementById("btn-mechanics-reference");

function renderMechanicsReference() {
  mechanicsReferenceListEl.innerHTML = "";
  // Même ordre que la déclaration de MECHANIC_SCHEMAS (stable, pas l'ordre
  // de découverte du joueur) — filtré à `seenMechanics` uniquement.
  const keys = Object.keys(MECHANIC_SCHEMAS).filter((key) => seenMechanics.has(key));
  if (keys.length === 0) {
    const empty = document.createElement("p");
    empty.className = "mechanics-reference-empty";
    empty.textContent = t("mechanicsReferenceEmpty");
    mechanicsReferenceListEl.appendChild(empty);
    return;
  }
  for (const key of keys) {
    const schema = MECHANIC_SCHEMAS[key];
    const item = document.createElement("div");
    item.className = "mechanics-reference-item";
    const icon = document.createElement("div");
    icon.className = "cell cell--empty mechanics-reference-icon";
    icon.innerHTML = FEATURE_ICON_HTML[key] ?? "";
    const copy = document.createElement("div");
    copy.className = "mechanics-reference-copy";
    const h4 = document.createElement("h4");
    h4.textContent = t(schema.titleKey);
    const p = document.createElement("p");
    p.textContent = t(schema.textKey);
    copy.append(h4, p);
    item.append(icon, copy);
    mechanicsReferenceListEl.appendChild(item);
  }
}

btnMechanicsReference.onclick = () => {
  renderMechanicsReference();
  mechanicsReferenceModal.classList.remove("hidden");
};
document.querySelectorAll("[data-mechanics-reference-close]").forEach((el) => {
  el.onclick = () => mechanicsReferenceModal.classList.add("hidden");
});

// ---------- Modale "Noter sur Google Play" (fin du mode Jouer) ----------
// Retour utilisateur: "proposer au joueur (apres les récompenses) de noter
// l'application si il a aimé sur googleplay" — approche "modale simple +
// lien Play Store" plutôt qu'un plugin natif d'avis in-app (pas de
// garantie d'affichage même testé, et demanderait un rebuild Android) —
// window.open() fonctionne aussi bien en WebView Capacitor que sur le web.
const rateAppModal = document.getElementById("rate-app-modal");
const RATE_APP_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.synups.game";

function openRateAppModal() {
  rateAppModal.classList.remove("hidden");
}
document.querySelectorAll("[data-rate-app-close]").forEach((el) => {
  el.onclick = () => rateAppModal.classList.add("hidden");
});
document.getElementById("btn-rate-app-now").onclick = () => {
  window.open(RATE_APP_PLAY_STORE_URL, "_blank");
  rateAppModal.classList.add("hidden");
};

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
  // Retour utilisateur: "retire le bloc qui indique la difficulté et montre
  // le caractère infini" — #infinite-level-label ne réaffiche plus "∞ ·
  // ★★☆" au repos (vidé ici pour effacer un éventuel texte transitoire
  // "génération…" encore affiché, voir runGeneration ci-dessous, qui reste
  // le SEUL cas où cet élément affiche encore du texte). Le palier reste
  // visible via le nouveau +N sous le compte d'étoiles (voir
  // infiniteGainEl ci-dessous) plutôt que via ce label.
  infiniteLevelLabelEl.textContent = "";
  // Retour utilisateur: "+1/+3/+5 en fonction de la difficulté choisie" —
  // même barème que le vrai gain (voir awardInfinitePoints/
  // INFINITE_POINTS_BY_TIER), basé sur le palier RÉELLEMENT obtenu
  // (shownTier, mesuré si dispo) plutôt que sur le réglage demandé, pour
  // rester cohérent avec le gain effectif à la victoire de CE niveau.
  // Round suivant (retour utilisateur): "+1★" plutôt qu'un simple "+1" sans
  // unité — innerHTML (pas textContent) pour injecter l'icône étoile après
  // le chiffre (voir mode-infinite.css: .infinite-points-row/.infinite-gain,
  // désormais affiché À DROITE du solde plutôt qu'en dessous).
  infiniteGainEl.innerHTML = `+${INFINITE_POINTS_BY_TIER[shownTier] ?? 1}${starIconSVG()}`;
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
  if (intoBoard) {
    statusTarget.textContent = "∞ · génération…";
  } else {
    // Voir mode-infinite.css: .infinite-status--loading/.infinite-spinner —
    // spinner + grisage du panneau de réglages plutôt qu'un simple texte
    // qui change, pour qu'une génération longue (paliers élevés) se lise
    // clairement comme "en cours" plutôt que comme un gel de l'appli.
    infiniteConfigPanelEl?.classList.add("is-generating");
    statusTarget.classList.add("infinite-status--loading");
    statusTarget.innerHTML = `${INFINITE_SPINNER_HTML}<span>Génération en cours…</span>`;
  }

  try {
    const result = await requestLevel(config);
    if (!result) {
      if (intoBoard) {
        statusTarget.textContent = previousLabel;
      } else {
        statusTarget.classList.remove("infinite-status--loading");
        statusTarget.textContent = "Échec de génération avec ces réglages — réessaie (ou change les réglages).";
      }
      return;
    }
    revealPlayAfterGeneration();
    loadInfiniteLevel(result);
    infiniteStatusEl.classList.remove("infinite-status--loading");
    infiniteStatusEl.textContent = "";
    // Le résultat servi ici ne venait PAS du buffer (sinon on serait déjà
    // sorti plus haut) : on lance quand même un remplissage pour préparer
    // les prochains "Niveau suivant" pendant que le joueur résout celui-ci.
    ensureLevelBuffer(config);
  } catch (err) {
    if (intoBoard) {
      statusTarget.textContent = "Erreur du générateur — réessaie.";
    } else {
      statusTarget.classList.remove("infinite-status--loading");
      statusTarget.textContent = "Erreur du générateur — réessaie.";
    }
    console.error(err);
  } finally {
    infiniteRequestInFlight = false;
    btnInfiniteGenerate.disabled = false;
    btnInfiniteNext.disabled = false;
    infiniteConfigPanelEl?.classList.remove("is-generating");
  }
}

/** Retour utilisateur: "lorsqu'on clique sur Nouvelle grille et qu'on n'en a
 * plus en stock (aucune grille préchargée), on ne devrait pas pouvoir
 * continuer de jouer la grille actuelle, mais [...] lock les boutons pour
 * éviter le spam (sauf bouton retour) et mettre un gros Loader à la place
 * de la grille". N'est appelée QUE quand `hasBufferedLevel` a déjà répondu
 * non (voir btnInfiniteNext.onclick) — le chemin buffer (cas courant) reste
 * instantané et ne passe jamais par ici, exactement comme avant.
 *
 * Verrouille via `infiniteGenerationPending` (pas `boardLocked`, voir sa
 * déclaration) pour que goBack() reste fonctionnel pendant l'attente — le
 * plateau lui-même est de toute façon totalement recouvert par le loader
 * (voir mode-infinite.css: #board-generating-overlay, opaque et au-dessus
 * de #board), donc masquer les cases ne dépend pas QUE de ce flag. Les
 * boutons de la barre du haut/du bas (hors Retour) sont en plus rendus
 * `disabled` pour un retour visuel immédiat (curseur, grisage) plutôt que
 * de compter uniquement sur un clic qui ne ferait rien.
 */
function setInfiniteGeneratingOverlay(active) {
  infiniteGenerationPending = active;
  boardGeneratingOverlayEl?.classList.toggle("hidden", !active);
  btnInfiniteSettings.disabled = active;
  btnInfiniteNext.disabled = active;
  btnHint.disabled = active;
  document.getElementById("btn-reset").disabled = active;
  // btn-undo a son propre état "activable" indépendant (voir syncMoveUi:
  // désactivé tant qu'il n'y a rien à annuler) — le forcer à `false` en
  // sortie afficherait un bouton cliquable même sans historique. On le
  // force seulement à `true` en entrée (toujours sûr: jamais d'annulation
  // possible pendant l'attente) et on laisse syncMoveUi() restaurer son
  // état réel à la sortie.
  if (active) btnUndo.disabled = true;
  else syncMoveUi();
}

btnInfiniteGenerate.onclick = () => runGeneration({ intoBoard: false });
btnInfiniteNext.onclick = async () => {
  // Bloqué pendant la transition de fin de niveau (boardLocked) ou une
  // attente de génération déjà en cours (infiniteGenerationPending): sinon
  // un double appel à runGeneration (celui-ci + celui déjà en cours dans
  // advanceAfterWin, ou un second clic pendant l'attente) pourrait charger
  // deux niveaux à la suite.
  if (boardLocked || infiniteGenerationPending) return;
  // Buffer non vide: runGeneration servira le niveau INSTANTANÉMENT (voir
  // takeBufferedLevel) — rien à verrouiller ni à faire attendre, comme
  // avant ce correctif.
  if (hasBufferedLevel(infiniteConfig())) {
    runGeneration({ intoBoard: true });
    return;
  }
  setInfiniteGeneratingOverlay(true);
  try {
    await runGeneration({ intoBoard: true });
  } finally {
    setInfiniteGeneratingOverlay(false);
  }
};
btnInfiniteSettings.onclick = () => {
  // "Réglages" pousse un NOUVEL écran (pas juste un panneau interne): Retour
  // depuis les réglages doit ramener au plateau en cours, pas au menu titre
  // — voir goBack()/showView().
  pushView("infinite-config");
};

// Retour utilisateur: "un button-icon plutot que les fleches [...] qui
// s'accorde avec les autres boutons [...] alignés à gauche" — ces deux
// boutons vivent maintenant dans .header-actions (voir index.html), au même
// titre que btn-level-grid; conservés en `const` ici (au lieu d'un simple
// `document.getElementById(...).onclick =` comme avant) car setMode() a
// aussi besoin de les référencer pour les masquer/révéler par mode (voir
// plus bas, même pattern que btnLevelGrid/btnInfiniteSettings).
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
btnPrev.onclick = () => {
  if (boardLocked) return;
  // Bug corrigé (retour utilisateur): `loadLevel` fait un modulo pour
  // accepter un index hors bornes (voir sa définition — pratique pour
  // `currentStoryIndex % levels.length` etc.), donc appeler
  // loadLevel(-1) depuis le tout premier niveau (index 0) NE PLANTAIT PAS
  // mais rebouclait silencieusement sur le DERNIER niveau (index
  // levels.length-1) — en mode normal, ça permettait de "remonter" à un
  // niveau non débloqué en cliquant Précédent depuis le niveau 1, sans
  // jamais passer par Suivant ni par la grille (tous deux correctement
  // verrouillés, voir btnNext/renderLevelGrid). Il n'existe pas de niveau
  // "avant le premier" : ce bouton doit simplement s'arrêter à l'index 0,
  // jamais boucler, peu importe le mode admin (contrairement à Suivant, ce
  // n'est pas une histoire de déblocage — remonter avant le début n'a
  // simplement aucun sens).
  if (currentLevelIndex <= 0) return;
  loadLevel(currentLevelIndex - 1);
};
btnNext.onclick = () => {
  if (boardLocked) return;
  // Chantier admin/normal (retour utilisateur): en mode normal, on ne doit
  // JAMAIS pouvoir avancer sur un niveau pas encore débloqué — avant ce
  // chantier, ce bouton ne vérifiait rien du tout et permettait de sauter
  // n'importe quel niveau Histoire (exactement la feature "passer les
  // niveaux" que l'utilisateur veut réserver au mode admin). Le mode admin
  // (voir admin.js: isAdminModeOn, jamais vrai en prod) retrouve ce
  // comportement d'avant tel quel — bypass total, aucune vérification.
  if (!isAdminModeOn() && currentLevelIndex + 1 >= unlockedCount(storyProgress, levels.length)) return;
  loadLevel(currentLevelIndex + 1);
};

/** Active/désactive les flèches Précédent/Suivant selon le niveau
 * ACTUELLEMENT chargé (voir currentLevelIndex, mis à jour par loadLevel
 * juste avant chaque appel) — sans effet visible hors du mode "story"
 * (boutons cachés par setMode dans tous les autres modes, voir plus haut),
 * mais recalculé systématiquement à chaque niveau pour rester correct dès
 * qu'on repasse en Histoire. Réévalué aussi à chaque bascule du mode admin
 * (voir onAdminModeChange plus bas) pour réactiver IMMÉDIATEMENT Suivant
 * sans attendre un changement de niveau si l'admin vient de s'activer en
 * plein milieu d'une partie bloquée — Précédent, lui, ne dépend jamais du
 * mode admin (voir son onclick ci-dessus). */
function updateLevelNavLock() {
  btnPrev.disabled = currentLevelIndex <= 0;
  btnNext.disabled = !isAdminModeOn() && currentLevelIndex + 1 >= unlockedCount(storyProgress, levels.length);
}
onAdminModeChange(updateLevelNavLock);

// Retour utilisateur: "dans la grille quotidienne, si je fais 'effacer',
// j'ai les nouvelles mécaniques qui pop sur mon écran. Ca ne devrait pas !"
// — BUG CORRIGÉ: en mode "daily" (Défi Quotidien) ET "community", cette
// branche retombait dans le `else` ci-dessous, qui appelle loadLevel() — le
// chargeur du mode HISTOIRE, qui relit `levels[currentLevelIndex]`. Or
// loadCommunityLevel/loadDailyChallengeLevel mettent currentLevelIndex à -1
// (voir leurs définitions plus bas: ils ne s'appuient jamais sur `levels[]`,
// juste sur `currentLevel`/`currentCommunityLevel` gardés en mémoire) — donc
// loadLevel(-1) rechargeait en fait le DERNIER niveau Histoire (-1 % N ->
// N-1), PUIS appelait queueNewMechanicSchemas() dessus (jamais silencieux,
// voir loadLevel): un niveau Histoire inconnu du joueur à cet instant du
// jeu Quotidien/Communauté pouvait donc déclencher une popup de mécanique
// "nouvelle" hors contexte — exactement le symptôme rapporté, même si le
// vrai bug (mauvaise grille rechargée) était plus large que la seule popup.
// Chaque mode "Effacer" doit recharger SA PROPRE grille en mémoire, jamais
// passer par le chemin Histoire.
document.getElementById("btn-reset").onclick = () => {
  if (boardLocked || infiniteGenerationPending) return;
  if (mode === "infinite" && lastInfiniteResult) loadInfiniteLevel(lastInfiniteResult);
  else if (mode === "community" && currentCommunityLevel) loadCommunityLevel(currentCommunityLevel);
  else if (mode === "daily") loadDailyChallengeLevel(currentLevel);
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
    // Chantier admin/normal: même bypass que la flèche Suivant (voir
    // btnNext plus haut) — en mode admin, la grille de sélection reste
    // visuellement "verrouillée" (l'utilisateur voit toujours sa vraie
    // progression) mais chaque case redevient cliquable, pour rester
    // cohérent avec "passer les niveaux" plutôt que de forcer un détour
    // par la flèche Suivant niveau par niveau.
    const isPlayable = isUnlocked || isAdminModeOn();
    // Retour utilisateur: "je préfèrerais que ce soit le niveau sur lequel
    // on est actuellement qui soit en vert, pour se repérer" — jusqu'ici
    // rien ne distinguait le niveau ACTIF (currentLevelIndex, celui affiché
    // si on retourne jouer) des autres cases débloquées: seul "terminé"
    // (vert) avait une couleur dédiée, ce qui ne dit pas où on en est. On
    // introduit donc .level-tile--current pour ça, et .level-tile--done
    // bascule sur --accent (cyan) pour ne plus se confondre avec lui — voir
    // level-select.css, où --current est déclaré après --done/--locked pour
    // les surpasser visuellement dans le cas (rare, admin uniquement) où le
    // niveau actif est aussi un niveau non débloqué qu'on aurait rejoint en
    // sautant dessus.
    const isCurrent = i === currentLevelIndex;
    tile.className =
      "level-tile" +
      (isDone ? " level-tile--done" : "") +
      (isUnlocked ? "" : " level-tile--locked") +
      (isCurrent ? " level-tile--current" : "");
    tile.disabled = !isPlayable;
    if (isPlayable) {
      tile.onclick = () => selectStoryLevel(i);
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
  if (boardLocked || infiniteGenerationPending) return;
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
const communityPagerEl = document.getElementById("community-pager");
const btnCommunityCreate = document.getElementById("btn-community-create");
const btnCommunityProfile = document.getElementById("btn-community-profile");

const communityRateModal = document.getElementById("community-rate-modal");
const communityRateTextEl = document.getElementById("community-rate-text");
const btnCommunityRateLike = document.getElementById("btn-community-rate-like");

const navCommunityEl = document.getElementById("nav-community");
const communityLevelTitleEl = document.getElementById("community-level-title");
const communityLevelAuthorEl = document.getElementById("community-level-author");
const btnCommunityLike = document.getElementById("btn-community-like");

const profilePseudoTextEl = document.getElementById("profile-pseudo-text");
// Round 26 (retour utilisateur): #profile-pseudo-text contient maintenant
// aussi une icône "edit" décorative (voir index.html) — le texte du pseudo
// doit donc cibler ce label interne, jamais écraser tout le conteneur via
// .textContent (ce qui supprimerait l'icône au passage).
const profilePseudoLabelEl = document.getElementById("profile-pseudo-label");
const profilePseudoEditEl = document.getElementById("profile-pseudo-edit");
const profilePseudoInput = document.getElementById("profile-pseudo-input");
const btnProfilePseudoConfirm = document.getElementById("btn-profile-pseudo-confirm");
const profileAvatarPicker = document.getElementById("profile-avatar-picker");
const profilePublishedEl = document.getElementById("profile-published");
const profilePublishedEmptyEl = document.getElementById("profile-published-empty");
const profilePublishedPagerEl = document.getElementById("profile-published-pager");
const profileLikedEl = document.getElementById("profile-liked");
const profileLikedEmptyEl = document.getElementById("profile-liked-empty");
const profileLikedPagerEl = document.getElementById("profile-liked-pager");
const profileBadgePreviewEl = document.getElementById("profile-badge-preview");
const profileSommationBadgesEl = document.getElementById("profile-sommation-badges");
const titleProfileBanner = document.getElementById("title-profile-banner");
const titleProfileIdentityEl = document.getElementById("title-profile-identity");

let communitySearch = "";
let communitySort = "recent";
// Retour utilisateur: "il faut paginer dans Communauté la liste des grilles,
// par 20" — affichage paginé (pas de vraies routes/URLs), voir buildPager()
// plus bas. Remise à 1 uniquement sur une VRAIE entrée dans l'écran ou un
// changement de recherche/tri (voir renderCommunityFeed(resetPage)) — jamais
// sur un simple like/rafraîchissement Firestore en tâche de fond, sinon
// liker une grille en page 3 vous ramènerait brutalement en page 1.
let communityPage = 1;
const COMMUNITY_PAGE_SIZE = 20;
let currentCommunityLevel = null; // grille en cours en mode "community" — voir loadCommunityLevel
let selectedProfileAvatar = AVATARS[0].id;
// Tier (1-5) du badge choisi pour affichage public, ou null ("aucun badge") —
// voir renderCommunityProfile/refreshProfileBadgePreview. Simple reflet local
// de profile.activeBadge, ré-synchronisé à chaque entrée dans "Mon profil".
let selectedActiveBadge = null;
// Retour utilisateur: "paginer les sections 'Mes grilles publiées' et 'mes
// favoris', 5 grilles par page" — contrairement à communityPage ci-dessus,
// remis à 1 à CHAQUE appel de renderCommunityProfile() (même philosophie que
// le reste de cette fonction, voir son commentaire: "resynchronise TOUT
// depuis le profil enregistré" à chaque rendu, jamais de diff fragile) —
// ces deux listes rétrécissent de toute façon dès qu'on like/retire une
// grille depuis cet écran, donc replacer en page 1 après coup est sans
// risque de perte de contexte.
let profilePublishedPage = 1;
let profileLikedPage = 1;
const PROFILE_PAGE_SIZE = 5;

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
    // "purchase" (points) et "star" (Défi Quotidien) partagent le MÊME Set
    // `owned` (voir community-store.js: isAvatarUnlocked, cas "star") — la
    // monnaie dépensée à l'achat n'a pas besoin d'être distinguée une fois
    // l'avatar possédé.
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

/** Affichage paginé générique (retour utilisateur: pagination de Communauté
 * et des listes de "Mon profil") — "ce ne sont pas des vraies pages à
 * proprement parler, c'est un affichage paginé" : pas de route/URL par
 * page, juste un découpage de la liste déjà en mémoire + Précédent/Suivant.
 * Renvoie `null` (rien à afficher) si tout tient sur une seule page, pour
 * que l'appelant n'ait qu'à vider son conteneur avant d'ajouter le résultat
 * (jamais de pager fantôme à cacher séparément). */
function buildPager(page, totalPages, onChange) {
  if (totalPages <= 1) return null;
  const wrap = document.createElement("div");
  wrap.className = "pager";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "pager-btn";
  prevBtn.setAttribute("aria-label", t("pager.precedente"));
  prevBtn.disabled = page <= 1;
  prevBtn.innerHTML =
    '<svg viewBox="0 0 24 24" class="icon-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  prevBtn.addEventListener("click", () => onChange(page - 1));

  const label = document.createElement("span");
  label.className = "pager-label";
  label.textContent = t("pager.label", { page, totalPages });

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "pager-btn";
  nextBtn.setAttribute("aria-label", t("pager.suivante"));
  nextBtn.disabled = page >= totalPages;
  nextBtn.innerHTML =
    '<svg viewBox="0 0 24 24" class="icon-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
  nextBtn.addEventListener("click", () => onChange(page + 1));

  wrap.append(prevBtn, label, nextBtn);
  return wrap;
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

  // Retour utilisateur: "on ne doit pas pouvoir liker sa propre grille
  // publiée dans communauté" — le bouton like n'a de sens que sur les
  // grilles des autres ; le compteur de likes reste toujours visible.
  if (level.source === "local") {
    bottom.append(likesStat, playsStat, spacer);
  } else {
    bottom.append(likeBtn, likesStat, playsStat, spacer);
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

  // Retour utilisateur: "les boutons 'Jouer' doivent être plus gros [...]
  // un bouton-icon Play c'est plus universel [...] il faut qu'il prenne
  // tout l'espace en hauteur de community-card-byline et
  // community-card-bottom" — icône seule (même triangle que "Tester" dans
  // l'éditeur, voir ed-test), plus un vrai bouton texte perdu parmi
  // like/retirer. Sort du flux vertical top/byline/mechanics/bottom
  // (voir plus bas: regroupé avec ces 3 dans .community-card-middle, colonne
  // dédiée qui s'étire sur toute leur hauteur cumulée via align-items:stretch,
  // voir community.css).
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "community-card-play";
  playBtn.setAttribute("aria-label", "Jouer");
  playBtn.title = "Jouer";
  playBtn.innerHTML =
    '<svg viewBox="0 0 24 24" class="icon-svg" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>';
  playBtn.addEventListener("click", () => {
    loadCommunityLevel(level);
    pushView("play", { mode: "community" });
  });

  const info = document.createElement("div");
  info.className = "community-card-info";
  info.appendChild(byline);
  if (mechanicsRow.childElementCount > 0) info.appendChild(mechanicsRow);
  info.appendChild(bottom);

  const middle = document.createElement("div");
  middle.className = "community-card-middle";
  middle.append(info, playBtn);

  card.append(top, middle);
  return card;
}

/** `resetPage`: remet la pagination en page 1 — UNIQUEMENT pertinent pour
 * une vraie (ré)entrée dans l'écran ou un changement de recherche/tri (voir
 * les appelants). Par défaut à `false`: un like posé en page 3 ou un
 * rafraîchissement Firestore en tâche de fond (voir onChange/
 * onLevelsChanged) redessinent la page COURANTE sans faire sauter le
 * joueur en page 1 — contrairement à "Mon profil" (voir
 * renderCommunityProfile), ce fil ne rétrécit jamais quand on like, rien ne
 * justifie de perdre sa position de lecture à chaque interaction. */
function renderCommunityFeed(resetPage = false) {
  if (resetPage) communityPage = 1;

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

  // Retour utilisateur: "il faut paginer dans Communauté la liste des
  // grilles, par 20" — re-clampé à chaque rendu (pas seulement au reset):
  // une recherche qui réduit soudain le nombre de résultats, ou une grille
  // supprimée par son auteur pendant que vous êtes en page 3, ne doivent
  // jamais laisser communityPage pointer sur une page devenue inexistante.
  const totalPages = Math.max(1, Math.ceil(list.length / COMMUNITY_PAGE_SIZE));
  communityPage = Math.min(Math.max(1, communityPage), totalPages);
  const pageItems = list.slice((communityPage - 1) * COMMUNITY_PAGE_SIZE, communityPage * COMMUNITY_PAGE_SIZE);

  communityFeedEl.innerHTML = "";
  for (const level of pageItems) {
    communityFeedEl.appendChild(buildCommunityCard(level, { onChange: renderCommunityFeed }));
  }
  communityEmptyEl.classList.toggle("hidden", list.length > 0);
  communityPagerEl.innerHTML = "";
  const pager = buildPager(communityPage, totalPages, (page) => {
    communityPage = page;
    renderCommunityFeed();
  });
  if (pager) communityPagerEl.appendChild(pager);
}

btnCommunityCreate.onclick = () => pushView("editor");
btnCommunityProfile.onclick = () => pushView("community-profile");

communitySearchEl.addEventListener("input", () => {
  communitySearch = communitySearchEl.value;
  renderCommunityFeed(true); // nouvelle recherche: retour en page 1
});
communitySortEl.addEventListener("change", () => {
  communitySort = communitySortEl.value;
  renderCommunityFeed(true); // nouveau tri: retour en page 1
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

/** Charge la grille du Défi Quotidien — même chemin que loadCommunityLevel
 * ci-dessus (grid/renderer/handleCellClick strictement identiques), voir
 * dailyChallenge.js pour la génération/le stockage de `level`. */
function loadDailyChallengeLevel(level) {
  currentLevelIndex = -1;
  currentLevel = level;
  grid = new LightUpGrid(currentLevel);
  startBoard();
}

/** Relit toujours l'état depuis community-store.js (jamais mis en cache
 * localement) — un like posé depuis "Mon profil" juste avant, par exemple,
 * doit se refléter ici sans action supplémentaire. */
function refreshCommunityLikeButton() {
  if (!currentCommunityLevel) return;
  const fresh = getLevel(currentCommunityLevel.id);
  // Retour utilisateur: "on ne doit pas pouvoir liker sa propre grille
  // publiée dans communauté" — sur sa propre grille (source "local"), le
  // bouton coeur du bandeau de jeu n'a pas lieu d'être.
  btnCommunityLike.classList.toggle("hidden", fresh?.source === "local");
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
    const purchasable = !unlocked && (avatar.unlock?.type === "purchase" || avatar.unlock?.type === "star");
    const btn = document.createElement("button");
    btn.type = "button";
    // Retour utilisateur: "les étoiles ont le code couleur jaune et les
    // points bleu [...] pour déverrouiller des éléments en utilisant des
    // points, on utilise la couleur bleue" — classe dédiée (voir
    // profile.css: .purchasable--star) pour que la bordure en pointillés
    // change de teinte selon la monnaie, pas seulement la pastille de prix.
    const purchasableClass = purchasable
      ? " purchasable" + (avatar.unlock.type === "star" ? " purchasable--star" : "")
      : "";
    btn.className =
      "profile-avatar-btn" +
      (avatar.id === selectedProfileAvatar ? " active" : "") +
      (unlocked ? "" : purchasable ? purchasableClass : " locked");
    btn.innerHTML = avatar.svg;
    btn.disabled = !unlocked && !purchasable;
    const avatarLabel = t(`avatar.${avatar.id}`);
    btn.title = unlocked ? avatarLabel : `${avatarLabel} — ${avatarUnlockLabel(avatar)}`;
    if (purchasable) {
      const price = document.createElement("span");
      price.className = "profile-avatar-price" + (avatar.unlock.type === "star" ? " profile-avatar-price--star" : "");
      // Retour utilisateur: icônes (étoile bleue = Étoiles, éclair jaune =
      // Énergie) à la place de l'abréviation/symbole texte.
      price.innerHTML = avatar.unlock.type === "star" ? boltLabel(avatar.unlock.cost) : starLabel(avatar.unlock.cost);
      btn.appendChild(price);
    }
    if (unlocked) {
      btn.addEventListener("click", () => {
        selectedProfileAvatar = avatar.id;
        updateProfile({ avatar: avatar.id });
        syncMyAuthorEverywhere();
        refreshProfileAvatarPicker();
        refreshProfileBadgePreview();
      });
    } else if (purchasable) {
      btn.addEventListener("click", () => {
        setProfileAvatarPurchaseStatus(null);
        // Défi Quotidien (voir community-store.js: unlock.type "star") — même
        // flux que "purchase" ci-dessous, juste une monnaie différente
        // (spendStars au lieu de spendSharedPoints, voir storage.js).
        const isStarUnlock = avatar.unlock.type === "star";
        const spent = isStarUnlock ? spendStars(avatar.unlock.cost) : spendSharedPoints(avatar.unlock.cost);
        if (!spent) {
          setProfileAvatarPurchaseStatus(
            isStarUnlock
              ? `Pas assez d'Énergie (${avatar.unlock.cost} nécessaire).`
              : `Pas assez d'Étoiles (${avatar.unlock.cost} nécessaires).`,
            true
          );
          return;
        }
        const owned = loadProfile()?.ownedAvatars ?? [];
        selectedProfileAvatar = avatar.id;
        updateProfile({ ownedAvatars: [...owned, avatar.id], avatar: avatar.id });
        syncMyAuthorEverywhere();
        refreshProfileAvatarPicker();
        refreshProfileBadgePreview();
        showCosmeticUnlockModal({
          kind: "avatar",
          avatarId: avatar.id,
          title: t("cosmeticUnlockBadgeTitle", { name: t(`avatar.${avatar.id}`) }),
          subtitle: isStarUnlock
            ? t("cosmeticUnlockBoltSubtitle", { cost: avatar.unlock.cost })
            : t("cosmeticUnlockStarSubtitle", { cost: avatar.unlock.cost }),
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
/** Pastilles étoiles/points affichées dans la bannière du menu titre (retour
 * utilisateur: "le compte d'étoiles et de points du joueur doit être présent
 * dans le menu (à l'intérieur de la bannière du joueur)") — lit directement
 * `infinitePoints` (déjà tenu à jour en mémoire, voir renderPointsEverywhere)
 * plutôt que de re-solliciter le storage, et `loadStars()` (voir storage.js)
 * pour les étoiles du Défi Quotidien: pas de variable en mémoire dédiée pour
 * ces dernières, donc relue à chaque appel comme le reste de cette bannière
 * (jamais figée sur un total périmé après une victoire). */
function buildTitleProfileStats() {
  const wrap = document.createElement("span");
  wrap.className = "title-profile-stats";
  const starsEl = document.createElement("span");
  starsEl.className = "title-profile-stat title-profile-stat--star";
  // Retour utilisateur: icône éclair (Énergie) au lieu du symbole "★" texte.
  starsEl.innerHTML = boltLabel(loadStars());
  const pointsEl = document.createElement("span");
  pointsEl.className = "title-profile-stat title-profile-stat--points";
  // Retour utilisateur: icône étoile (Étoiles) au lieu de l'abréviation "pt".
  pointsEl.innerHTML = starLabel(infinitePoints);
  wrap.append(starsEl, pointsEl);
  return wrap;
}

function renderTitleProfileBanner() {
  const profile = loadProfile();
  titleProfileIdentityEl.innerHTML = "";
  const frame = buildBadgeFrame(
    profile?.avatar ?? AVATARS[0].id,
    profile?.pseudo?.trim() || "Configurer mon profil",
    profile?.activeBadge,
    { chevron: true }
  );
  // Retour utilisateur: "à l'intérieur de la bannière du joueur" — inséré
  // DANS le .badge-frame lui-même (juste avant le chevron ">"), pas à côté:
  // buildBadgeFrame() est partagée avec d'autres contextes (cartes
  // Communauté, prévisu "Mon profil") qui ne doivent jamais afficher les
  // stats, donc l'insertion se fait ici plutôt que via un paramètre de
  // buildBadgeFrame — reste local à CETTE bannière.
  const chevronEl = frame.querySelector(".badge-frame-chevron");
  frame.insertBefore(buildTitleProfileStats(), chevronEl);
  titleProfileIdentityEl.appendChild(frame);
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
  const frame = buildBadgeFrame(selectedProfileAvatar, pseudo, selectedActiveBadge, { framed: true });
  // Retour utilisateur (round 26): "les comptes (points + étoiles) sont
  // dans la prévisu, pas en dessous, comme dans 'menu'" — inséré DANS le
  // badge-frame lui-même (dernier enfant, pas de chevron ici pour le
  // pousser après comme dans renderTitleProfileBanner), même composant que
  // la bannière du menu titre (voir buildTitleProfileStats), rafraîchi ici
  // pour rester à jour après un achat d'avatar (qui dépense points OU
  // étoiles).
  frame.appendChild(buildTitleProfileStats());
  profileBadgePreviewEl.appendChild(frame);
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
  // Deux lots de badges indépendants affichés dans la MÊME grille — voir
  // game/meditate.js: MEDITATE_BADGE_DEFS, tiers 6-8 DISJOINTS des tiers 1-5
  // de getSommationBadges() (voir badges.css) donc aucun risque de
  // collision dans activeBadge (juste un numéro de tier, peu importe la
  // source — voir buildBadgeFrame). Round suivant (retour utilisateur):
  // getStarBadges() (ancien seuil d'Énergie) remplacé par
  // getMeditateBadges() (mini-jeu de révélation).
  // Bannière "Fusion" (retour utilisateur: fin du mode Jouer, positionnée
  // en PREMIER) — objet synthétique au même format `{name, earned, tier}`
  // que getSommationBadges()/getMeditateBadges() (voir ces fonctions),
  // mais lue directement depuis storage.js (isStoryMasteryUnlocked) plutôt
  // que depuis un module de badges dédié: il n'y a qu'UNE seule bannière
  // ici, pas tout un système de paliers. Prépendue par ordre d'insertion
  // (refreshProfileBadges() n'affiche PAS par numéro de tier) donc elle
  // s'affiche toujours en tête, sans dépendre de STORY_MASTERY_BADGE_TIER.
  const storyMasteryBadge = { name: "Fusion", earned: isStoryMasteryUnlocked(), tier: STORY_MASTERY_BADGE_TIER };
  for (const badge of [storyMasteryBadge, ...getSommationBadges(), ...getMeditateBadges()]) {
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
        syncMyAuthorEverywhere();
        refreshProfileBadges();
        refreshProfileBadgePreview();
      });
    } else {
      tile.title = "Bannière verrouillée";
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
  profilePseudoLabelEl.textContent = profile?.pseudo?.trim() || "Configurer mon pseudo";
  exitPseudoEditMode();

  const savedAvatarUnlocked =
    profile?.avatar && isAvatarUnlocked(AVATARS.find((a) => a.id === profile.avatar) ?? {}, avatarUnlocks());
  selectedProfileAvatar = savedAvatarUnlocked ? profile.avatar : AVATARS[0].id;
  selectedActiveBadge = profile?.activeBadge ?? null;
  setProfileAvatarPurchaseStatus(null); // jamais un message d'achat resté d'une visite précédente

  refreshProfileAvatarPicker();
  refreshProfileBadges();
  refreshProfileBadgePreview();

  // Retour utilisateur: "paginer [...] 5 grilles par page" — remis à 1 à
  // chaque appel (voir déclaration de profilePublishedPage/profileLikedPage
  // plus haut pour la justification). L'état "vide" (voir *EmptyEl ci-
  // dessous) ne dépend que du nombre TOTAL d'éléments, jamais de la page
  // affichée — basculé ici une seule fois plutôt que dans les fonctions de
  // page ci-dessous, qui elles ne re-dessinent QUE la page courante.
  profilePublishedPage = 1;
  profileLikedPage = 1;
  const mine = listLevels().filter((l) => l.source === "local");
  const liked = likedLevels();
  profilePublishedEmptyEl.classList.toggle("hidden", mine.length > 0);
  profileLikedEmptyEl.classList.toggle("hidden", liked.length > 0);
  renderProfilePublishedPage();
  renderProfileLikedPage();
}

/** Change UNIQUEMENT la page de "Mes grilles publiées" (voir buildPager
 * ci-dessus, bouton Précédent/Suivant) — un renderCommunityProfile() complet
 * remettrait profilePublishedPage à 1 avant même de lire la nouvelle valeur
 * (voir son propre commentaire: reset systématique), donc changer de page
 * doit re-dérouler seulement CETTE section, pas tout l'écran. */
function renderProfilePublishedPage() {
  const mine = listLevels().filter((l) => l.source === "local");
  const totalPages = Math.max(1, Math.ceil(mine.length / PROFILE_PAGE_SIZE));
  profilePublishedPage = Math.min(Math.max(1, profilePublishedPage), totalPages);
  const pageItems = mine.slice((profilePublishedPage - 1) * PROFILE_PAGE_SIZE, profilePublishedPage * PROFILE_PAGE_SIZE);
  profilePublishedEl.innerHTML = "";
  for (const level of pageItems) {
    profilePublishedEl.appendChild(
      buildCommunityCard(level, { showUnpublish: true, onChange: renderCommunityProfile })
    );
  }
  profilePublishedPagerEl.innerHTML = "";
  const pager = buildPager(profilePublishedPage, totalPages, (page) => {
    profilePublishedPage = page;
    renderProfilePublishedPage();
  });
  if (pager) profilePublishedPagerEl.appendChild(pager);
}

/** Même principe que renderProfilePublishedPage() ci-dessus, pour "Mes
 * favoris". */
function renderProfileLikedPage() {
  const liked = likedLevels();
  const totalPages = Math.max(1, Math.ceil(liked.length / PROFILE_PAGE_SIZE));
  profileLikedPage = Math.min(Math.max(1, profileLikedPage), totalPages);
  const pageItems = liked.slice((profileLikedPage - 1) * PROFILE_PAGE_SIZE, profileLikedPage * PROFILE_PAGE_SIZE);
  profileLikedEl.innerHTML = "";
  for (const level of pageItems) {
    profileLikedEl.appendChild(buildCommunityCard(level, { onChange: renderCommunityProfile }));
  }
  profileLikedPagerEl.innerHTML = "";
  const pager = buildPager(profileLikedPage, totalPages, (page) => {
    profileLikedPage = page;
    renderProfileLikedPage();
  });
  if (pager) profileLikedPagerEl.appendChild(pager);
}

/** Filtre EN PLACE un <input> texte selon sanitizePlayerText (storage.js) —
 * retour utilisateur (round publication): pseudo ET titre de grille (voir
 * editor.js) sont les deux seuls champs libres visibles par d'autres
 * joueurs, donc les deux passent par ce même filtre. Préserve la position
 * du curseur (compte les caractères retirés AVANT le curseur pour la
 * décaler d'autant) plutôt qu'un simple `input.value = sanitizé` qui
 * renverrait toujours le curseur en fin de champ — gênant dès qu'on corrige
 * un caractère au milieu d'un pseudo déjà long. */
function sanitizeInputInPlace(input) {
  const { value, selectionStart } = input;
  const sanitized = sanitizePlayerText(value);
  if (sanitized === value) return;
  const before = value.slice(0, selectionStart ?? value.length);
  const removed = before.length - sanitizePlayerText(before).length;
  input.value = sanitized;
  const pos = Math.max(0, (selectionStart ?? sanitized.length) - removed);
  input.setSelectionRange(pos, pos);
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
  syncMyAuthorEverywhere();
  profilePseudoLabelEl.textContent = pseudo;
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
// Retour utilisateur (round publication): "n'autoriser que les caractères
// alphabétiques + accents + espace" sur le pseudo — voir storage.js:
// sanitizePlayerText pour le pourquoi (empêche URL/email/téléphone glissés
// dans un champ public). Filtré EN DIRECT (pas seulement à la validation)
// pour que le joueur voie tout de suite le caractère refusé disparaître.
profilePseudoInput.addEventListener("input", () => {
  sanitizeInputInPlace(profilePseudoInput);
  refreshProfileBadgePreview();
});

// Mode Admin [dev uniquement] — voir admin.js pour la justification du
// `if (import.meta.env.DEV)` (élimination du bundle de prod). Round 17
// (retour utilisateur): bouton admin temporaire pour tester les badges sans
// finir Remember — même fonction que le bouton équivalent d'Options (voir
// plus haut, section PixelArt), donc même effet de bord accepté (débloque
// aussi le thème PixelArt en même temps). Round suivant (retour
// utilisateur: "ajoute les deux [bannières Étoiles] sur le bouton admin"):
// débloque aussi Nébuleuse/Comète/Supernova (tiers 6-8). Round Meditate
// (retour utilisateur): l'ancien debugUnlockStarBadges (seuil d'Énergie,
// dailyChallenge.js) est remplacé par debugUnlockMeditateBadges (voir
// game/meditate.js). Chantier admin/normal (retour utilisateur: "il faut
// ajouter la dernière bannière au déblocage admin"): la bannière "Fusion"
// (fin de campagne, voir storage.js: markStoryMasteryUnlocked) n'était PAS
// couverte par ce bouton — c'est le seul déblocage cosmétique qui suit un
// mécanisme entièrement différent (progression Histoire, pas
// Remember/Meditate) — ajoutée ici pour que ce bouton couvre enfin TOUTES
// les bannières d'un seul clic.
if (import.meta.env.DEV) {
  mountAdminButton(".profile-badges-header", "Déverrouiller (admin)", null, () => {
    debugUnlockPixelArt();
    debugUnlockMeditateBadges();
    markStoryMasteryUnlocked();
    renderCommunityProfile();
  });
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
    navDailyEl.classList.add("hidden");
    btnLevelGrid.classList.remove("hidden");
    // Retour utilisateur: "un button-icon [...] alignés à gauche" — btnPrev/
    // btnNext vivent maintenant dans .header-actions au même titre que
    // btnLevelGrid (voir index.html), donc révélés/masqués de la même façon,
    // Story UNIQUEMENT.
    btnPrev.classList.remove("hidden");
    btnNext.classList.remove("hidden");
    btnInfiniteSettings.classList.add("hidden");
    btnInfiniteNext.classList.add("hidden");
    btnCommunityLike.classList.add("hidden");
    playControlsEl.classList.remove("play-controls--left");
    playView.classList.remove("hidden");
    return;
  }
  if (next === "community") {
    navStaticEl.classList.add("hidden");
    navInfiniteEl.classList.add("hidden");
    navCommunityEl.classList.remove("hidden");
    navDailyEl.classList.add("hidden");
    btnLevelGrid.classList.add("hidden");
    btnPrev.classList.add("hidden");
    btnNext.classList.add("hidden");
    btnInfiniteSettings.classList.add("hidden");
    btnInfiniteNext.classList.add("hidden");
    // Pas de `remove("hidden")` inconditionnel ici: sur sa PROPRE grille
    // publiée (retour utilisateur: "on ne doit pas pouvoir liker sa propre
    // grille publiée dans communauté") le bouton doit rester caché.
    // `refreshCommunityLikeButton` retranche cette logique (basée sur
    // `currentCommunityLevel`, déjà positionné par `loadCommunityLevel` avant
    // que `setMode` ne soit appelée) pour ne pas la dupliquer ici.
    refreshCommunityLikeButton();
    // Retour utilisateur: "dans le mode communauté, le nom du niveau doit
    // être aligné à gauche, pas à droite" — même override que le mode
    // Défi Quotidien ci-dessous (.play-controls a margin-left:auto par
    // défaut, voir screen-header.css): #btn-community-like vit dans
    // .play-action-bar, un conteneur SÉPARÉ de .header-actions/
    // .play-controls (voir index.html) — appliquer --left ici ne le
    // déplace donc pas, seul le titre+auteur du niveau glisse à gauche.
    playControlsEl.classList.add("play-controls--left");
    playView.classList.remove("hidden");
    return;
  }
  if (next === "daily") {
    // Défi Quotidien: une seule grille par jour — ni sélection de niveau
    // (btnLevelGrid), ni "nouveau niveau" (btnInfiniteNext), ni "aimer"
    // (réservé aux grilles Communauté). .header-actions se retrouve donc
    // entièrement vide dans ce mode: rien ne justifie de garder le titre
    // poussé à droite (voir playControlsEl ci-dessus) — .play-controls--left
    // annule ce margin-left:auto pour que "⚡ Défi Quotidien" reste juste
    // après le bouton Retour (retour utilisateur).
    navStaticEl.classList.add("hidden");
    navInfiniteEl.classList.add("hidden");
    navCommunityEl.classList.add("hidden");
    navDailyEl.classList.remove("hidden");
    btnLevelGrid.classList.add("hidden");
    btnPrev.classList.add("hidden");
    btnNext.classList.add("hidden");
    btnInfiniteSettings.classList.add("hidden");
    btnInfiniteNext.classList.add("hidden");
    btnCommunityLike.classList.add("hidden");
    playControlsEl.classList.add("play-controls--left");
    playView.classList.remove("hidden");
    return;
  }
  // next === "infinite"
  navStaticEl.classList.add("hidden");
  navInfiniteEl.classList.remove("hidden");
  navCommunityEl.classList.add("hidden");
  navDailyEl.classList.add("hidden");
  btnLevelGrid.classList.add("hidden");
  btnPrev.classList.add("hidden");
  btnNext.classList.add("hidden");
  btnInfiniteSettings.classList.remove("hidden");
  btnInfiniteNext.classList.remove("hidden");
  btnCommunityLike.classList.add("hidden");
  playControlsEl.classList.remove("play-controls--left");
  playView.classList.remove("hidden");
}

// Retour utilisateur: "lorsqu'on publie une grille, ca serait bien de
// rediriger vers 'communauté' avec une notif de reussite" — editor.js
// appelle ce callback juste après la publication réussie (voir
// publishConfirmBtn dans editor.js): `pushView` empile "community" sur la
// pile de nav (Retour ramène à l'éditeur, pas au menu titre — cohérent avec
// le reste de la navigation, voir pushView plus haut) et `showToast`
// affiche la confirmation par-dessus l'écran qui vient de s'afficher.
const editorApi = initEditor({
  levels,
  onPublished: () => {
    pushView("community");
    showToast(t("editor-publish-toast.success"));
  },
});
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
  // Round 22 (retour utilisateur): "il faudra freeze le jeu lors du
  // déblocage d'un objet cosmétique [...] pareillement pour les badges" —
  // voir showCosmeticUnlockModal() plus bas.
  onBadgeEarned: (tier, name) => {
    // Sauvegarde cloud best-effort (voir le même appel dans le win handler
    // ci-dessus) — un badge Remember est un événement de progression au même
    // titre qu'un niveau terminé.
    saveProgressToCloud();
    // tier >= PIXELART_BADGE_UNLOCK_TIER: 5e et DERNIÈRE récompense —
    // Remember est désormais terminé (voir main.js: renderModeMenuButtons,
    // qui désactive #menu-remember + son badge "terminé" dès le prochain
    // passage par le menu). Retour utilisateur: "une fois la modale de
    // récompense fermée, on redirige vers le menu" — onClose plutôt qu'un
    // appel immédiat, pour ne rediriger qu'APRÈS que le joueur ait
    // explicitement fermé la modale (jamais avant, voir aussi: "cette
    // modale ne doit pas être fermable en cliquant en dehors").
    const isFinal = tier >= PIXELART_BADGE_UNLOCK_TIER;
    showCosmeticUnlockModal({
      kind: "badge",
      badgeTier: tier,
      title: name ? `Bannière « ${name} »` : "Nouvelle bannière",
      subtitle: isFinal
        ? "Nouvelle bannière débloquée, et le thème PixelArt avec !"
        : "Nouvelle bannière débloquée !",
      onClose: isFinal ? goToTitle : undefined,
    });
  },
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
  meditate: "view-meditate",
};

let viewStack = ["title"];

// Retour utilisateur ("un peu de transition entre les pages [...] restons
// simple") — évite de rejouer l'animation d'entrée (voir navigation.css:
// .screen--enter) si renderActiveScreen() est rappelée alors que l'écran
// actif n'a pas réellement changé (aucun appelant actuel ne fait ça, mais
// mieux vaut ne jamais faire "clignoter" un écran que le joueur regarde
// déjà si un futur appel le faisait).
let lastRenderedScreenId = null;

function renderActiveScreen() {
  const active = viewStack[viewStack.length - 1];
  const activeId = SCREEN_IDS[active];
  for (const [name, id] of Object.entries(SCREEN_IDS)) {
    document.getElementById(id).classList.toggle("hidden", name !== active);
  }
  if (activeId !== lastRenderedScreenId) {
    const el = document.getElementById(activeId);
    el.classList.remove("screen--enter");
    void el.offsetWidth; // force le reflow: permet de rejouer l'animation même si la classe était déjà posée juste avant (même technique que showHintAt)
    el.classList.add("screen--enter");
    lastRenderedScreenId = activeId;
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
  // Round 25 (retour utilisateur): bandeau publicitaire affiché EN CONTINU
  // pendant qu'on joue une grille (Histoire/Infini/Communauté, "play" quel
  // que soit le sous-mode — voir setMode) OU en Remember ("sommation") —
  // caché sur tout autre écran (menu, sélection, options, éditeur, fil
  // Communauté, profil...). Un seul appel ici plutôt que dans chaque
  // raccourci d'entrée en jeu (enterStoryDirect, enterInfiniteDirect,
  // enterRememberDirect, loadCommunityLevel...): showView() est LE point de
  // passage commun à toute navigation (voir pushView/goBack), donc aucun
  // chemin ne peut l'oublier.
  // Meditate ajouté au même lot que Remember (retour utilisateur: "pour
  // que cette feature pousse à la consommation") — même écran "gameplay
  // actif" que play/sommation du point de vue du bandeau publicitaire.
  if (name === "play" || name === "sommation" || name === "meditate") showBannerAd();
  else hideBannerAd();
  // Si `opts.mode` n'est pas fourni (ex: goBack() qui rappelle showView
  // sans opts), on garde le mode DÉJÀ actif plutôt que de retomber sur
  // "story" par défaut — sinon "Retour" depuis les réglages Infini
  // ramenait au plateau Histoire au lieu du plateau Infini en cours.
  if (name === "play") setMode(opts?.mode ?? mode);
  // Musique d'arrière-plan (retour utilisateur: "lorsqu'on n'est plus en
  // jeu [...] on pose un filtre sur la musique pour l'étouffer un peu, la
  // passer en arrière-plan [...] on retire le filtre lorsqu'on revient en
  // jeu (grille Jouer ou grille quotidienne ou grille Arcade)") — seules
  // les 3 grilles nommées comptent comme "en jeu": une grille Communauté,
  // bien qu'affichée sur ce même écran "play", n'en fait PAS partie (pas
  // citée par l'utilisateur), donc reste muffled comme Remember/Meditate/
  // Options/Profil/etc. `mode` peut ne pas être encore à jour ici si
  // `opts.mode` vient d'être appliqué juste au-dessus (setMode est
  // synchrone), donc on relit `opts?.mode ?? mode` de la même façon.
  const isActiveGameplay =
    name === "play" && ["story", "daily", "infinite"].includes(opts?.mode ?? mode);
  if (isActiveGameplay) exitBackgroundMuffle();
  else enterBackgroundMuffle();
  if (opts?.levelIndex != null) loadLevel(opts.levelIndex);
  if (name === "story-select") renderLevelGrid();
  // refreshCommunityCloud() est throttlée en interne (voir community-store.js:
  // REFRESH_MIN_INTERVAL_MS) — sûr d'appeler à CHAQUE entrée sur ces deux
  // écrans, un aller-retour rapide entre écrans ne redéclenche pas de lecture
  // réseau. Rendu immédiat avec le cache déjà en mémoire ci-dessous, puis
  // re-rendu automatique (voir onLevelsChanged plus haut) une fois la
  // réponse réseau arrivée.
  if (name === "community" || name === "community-profile") refreshCommunityCloud();
  if (name === "community") renderCommunityFeed(true); // vraie entrée dans l'écran: page 1
  if (name === "community-profile") renderCommunityProfile();
  if (name === "editor") editorApi.onShow();
  if (name === "sommation") sommationApi.onShow();
  if (name === "meditate") renderMeditateView();
  if (name === "options") {
    renderPixelArtOption();
    renderPlayGamesSection();
    renderLanguageOption();
  }
  // Rafraîchit la carte "Remember" du menu titre (points vs "Terminé") à
  // chaque retour — le déverrouillage de PixelArt peut survenir entre deux
  // passages sans forcément s'accompagner d'un changement de points (voir
  // renderPointsEverywhere), donc jamais figé sur un état périmé, même
  // principe que renderPixelArtOption()/renderLevelGrid().
  if (name === "title") {
    renderPointsEverywhere();
    renderTitleProfileBanner();
    // Défi Quotidien: revalide la date à CHAQUE retour au menu (retour
    // utilisateur: "on vérifie que la grille est à jour selon la date") —
    // couvre le cas où l'app est restée ouverte à cheval sur minuit.
    renderDailyChallengeButton();
    // Remember/Meditate: bascule disabled + badge "terminé" (voir
    // renderModeMenuButtons) — un badge peut se débloquer PENDANT une
    // session (via sa modale de récompense, qui redirige elle-même ici),
    // donc jamais figé sur un état périmé.
    renderModeMenuButtons();
    // Voir startDailyChallengeFabTicker/stopDailyChallengeFabTicker plus
    // bas: ce tic ne doit tourner que pendant que l'écran titre (seul
    // endroit où #btn-daily-challenge est visible) est affiché.
    startDailyChallengeFabTicker();
  } else {
    stopDailyChallengeFabTicker();
  }
  renderActiveScreen();
  // alignDailyChallengeFab() mesure le DOM réel (getBoundingClientRect) —
  // ne peut donner un résultat correct qu'UNE FOIS #view-title démasqué,
  // donc après renderActiveScreen() ci-dessus, jamais avant.
  if (name === "title") alignDailyChallengeFab();
}

/** Empile et affiche un nouvel écran — c'est la navigation "normale" (un
 * clic qui va vers l'avant). */
function pushView(name, opts) {
  viewStack.push(name);
  showView(name, opts);
}

/** Choisir un niveau depuis la grille de sélection (bug utilisateur: "je vais
 * dans Jouer [...] je vais dans la sélection de niveaux et j'en choisis un,
 * quand je ferai Retour ça va me remettre dans la sélection de niveaux [...]
 * si je chaîne ce comportement [...] je vais devoir faire retours plusieurs
 * fois pour arriver au menu principal"). "story-select" est TOUJOURS empilé
 * par-dessus un "play" déjà présent (seul btnLevelGrid, visible uniquement
 * en jeu, l'empile — voir plus bas) : un simple pushView("play", ...) ici
 * empilait donc un DEUXIÈME "play" par-dessus, laissant la pile grossir sans
 * fin à chaque aller-retour sélection -> niveau (Retour devait alors repasser
 * par "story-select" avant de revenir au "play" précédent, puis seulement
 * ensuite au menu). On dépile plutôt "story-select" et on réutilise le
 * "play" qui était déjà en dessous — la pile ne grandit jamais, Retour
 * depuis le niveau choisi revient exactement là où on était avant d'ouvrir
 * la sélection (généralement le menu). */
function selectStoryLevel(i) {
  if (viewStack[viewStack.length - 1] === "story-select") viewStack.pop();
  if (viewStack[viewStack.length - 1] !== "play") viewStack.push("play");
  showView("play", { mode: "story", levelIndex: i });
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

/** Retour utilisateur (Remember/Meditate terminés): "une fois la modale de
 * récompense fermée, on redirige vers le menu" — réinitialise TOUTE la pile
 * de navigation sur "title" plutôt qu'un simple goBack() (qui ne dépilerait
 * qu'UN seul écran, pas forcément jusqu'au menu selon la pile en cours). */
function goToTitle() {
  viewStack = ["title"];
  showView("title");
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
    // Bug (retour utilisateur): Jouer -> retour -> Arcade affichait encore
    // le niveau de Jouer. showView() bascule bien le mode/l'UI vers
    // "infinite" mais ne recharge PAS le plateau (contrairement au cas
    // "story" ci-dessus qui passe par opts.levelIndex) : `grid`/`currentLevel`
    // restaient donc ceux du dernier mode joué (ex: Histoire) entre-temps.
    // On force explicitement le rechargement du dernier résultat Infini —
    // même mécanisme que le handler de btn-reset. loadInfiniteLevel() est
    // sûr à rappeler avec la même référence: son effet de bord (comptage
    // pub interstitielle) est gardé par `result !== lastInfiniteResult`,
    // qui vaut false ici et saute donc ce comptage.
    showView("play", { mode: "infinite" });
    loadInfiniteLevel(lastInfiniteResult);
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
 * Une fois PixelArt débloqué (5e et dernière récompense), Remember est
 * terminé et non-rejouable — le bouton #menu-remember est alors désactivé
 * (voir renderModeMenuButtons ci-dessous), donc son onclick n'appelle même
 * plus cette fonction ; le garde-fou ci-dessous n'est qu'un filet de
 * sécurité si jamais elle était appelée dans cet état malgré tout. */
function enterRememberDirect() {
  if (isPixelArtUnlocked()) return;
  viewStack = ["title", "sommation"];
  showView("sommation");
}

// ---------- Meditate (mini-jeu de révélation, bannières Nébuleuse/Comète/Supernova) ----------
// Retour utilisateur: remplace l'ancien déblocage par seuil d'Énergie — voir
// game/meditate.js pour toute la logique (génération de grille, révélation,
// progression). Ce bloc ne fait que du rendu DOM + relais des clics vers ce
// module, même répartition des responsabilités que sommationApi/
// sommation.js pour Remember.
const meditateEnergyEl = document.getElementById("meditate-energy");
const meditatePlayStateEl = document.getElementById("meditate-play-state");
const meditatePreviewGridEl = document.getElementById("meditate-preview-grid");
const meditatePreviewNameEl = document.getElementById("meditate-preview-name");
const meditateSearchGridEl = document.getElementById("meditate-search-grid");

// Mode Admin [dev uniquement] — voir admin.js pour la justification du
// `if (import.meta.env.DEV)` (élimination du bundle de prod). Outil de
// test (retour utilisateur): injecte 100 Éclairs sans avoir à farmer le
// Défi Quotidien — même principe que le bouton "+500 étoiles" (sommation.js).
if (import.meta.env.DEV) {
  mountAdminButton("#view-meditate .screen-header", "+100 éclairs", "Débug: +100 Éclairs", () => {
    addStars(100);
    renderMeditateEnergy();
  });
}

/** Recette de fond CSS de chaque bannière — reprise TELLE QUELLE de
 * badges.css (.badge-teaser--tier-N.earned + .badge-teaser-deco, retour
 * utilisateur: "la preview doit être de base l'image qu'on utilise pour la
 * préview des bannières dans Profil"), combinée en une seule liste
 * `background-image` empilable sur un calque de taille arbitraire (voir
 * buildMeditateBackdrop ci-dessous). */
const MEDITATE_ART_RECIPES = {
  // Nébuleuse (tier 6). Round suivant (retour utilisateur: "redesign un peu
  // Nébuleuse [...] qu'il ne soit pas bleu déjà [...] un motif un peu plus
  // fort/présent") — reprise TELLE QUELLE de .badge-teaser--tier-6.earned +
  // .badge-teaser-deco (voir badges.css), même principe que les deux
  // recettes ci-dessous: vert-citron + repeating-conic-gradient au lieu du
  // bleu/cyan + simple nuage flou d'origine.
  6: {
    background: "#141f0d",
    image:
      "linear-gradient(135deg, rgba(154, 224, 74, 0.18), transparent 78%), " +
      "radial-gradient(10px 8px at 78% 24%, rgba(154, 224, 74, 0.6), transparent 70%), " +
      "radial-gradient(5px 5px at 70% 30%, rgba(224, 247, 154, 0.9), transparent), " +
      "radial-gradient(3px 3px at 84% 40%, rgba(224, 247, 154, 0.85), transparent), " +
      "repeating-conic-gradient(from 15deg at 78% 24%, rgba(154, 224, 74, 0.18) 0deg 4deg, transparent 4deg 22deg)",
  },
  // Comète (tier 7, ex-tier 6 — simple renumérotation, pas de changement
  // visuel: voir badges.css).
  7: {
    background: "#1f130d",
    image:
      "linear-gradient(135deg, rgba(255, 122, 69, 0.18), transparent 78%), " +
      "radial-gradient(4px 4px at 80% 22%, #ff7a45, transparent), " +
      "linear-gradient(150deg, transparent 45%, rgba(255, 150, 90, 0.35) 62%, rgba(255, 90, 40, 0.16) 80%, transparent 95%)",
  },
  // Supernova (tier 8, ex-tier 7 — simple renumérotation).
  8: {
    background: "#170f1f",
    image:
      "linear-gradient(135deg, rgba(201, 143, 224, 0.2), transparent 78%), " +
      "radial-gradient(circle at 78% 26%, rgba(201, 143, 224, 0.9) 0 4px, rgba(201, 143, 224, 0.35) 4px 13px, transparent 13px 70%), " +
      "repeating-conic-gradient(from 0deg at 78% 26%, rgba(201, 143, 224, 0.14) 0deg 3deg, transparent 3deg 20deg)",
  },
};
const MEDITATE_NAME_COLORS = { 6: "#b6ec6a", 7: "#ff9a63", 8: "#dcb8f0" };

/** Un seul grand calque ("backdrop") portant la recette d'imagerie complète
 * de la bannière, positionné en absolu à l'intérieur d'une "fenêtre"
 * (`overflow:hidden`, voir meditate.css: .meditate-window) — TOUT en
 * pourcentages plutôt qu'en pixels calculés en JS (retour utilisateur: "il
 * faut pas calculer la largeur [...] juste un pourcentage, ou du flex en
 * CSS pour que ce soit responsive"): un backdrop large de `division*100%`
 * et décalé de `-row*100%`/`-col*100%` reproduit exactement la même
 * découpe QUELLE QUE SOIT la taille réelle de la fenêtre (fixée par CSS —
 * grid-template-columns: repeat(N, 1fr) + aspect-ratio:1, voir
 * renderMeditatePreview/renderMeditateSearchGrid), sans jamais avoir besoin
 * de connaître sa taille en pixels ici. Même technique de "tuilage"
 * partagée par la preview (damier division×division) ET les fragments
 * révélés de la grille de recherche, pour ne jamais recomposer deux fois la
 * même image. */
function makeMeditateWindow(tier, division, row, col) {
  const recipe = MEDITATE_ART_RECIPES[tier];
  const win = document.createElement("div");
  win.className = "meditate-window";

  const backdrop = document.createElement("div");
  backdrop.className = "meditate-art-backdrop";
  backdrop.style.width = `${division * 100}%`;
  backdrop.style.height = `${division * 100}%`;
  backdrop.style.background = recipe.background;
  backdrop.style.backgroundImage = recipe.image;
  backdrop.style.top = `${-row * 100}%`;
  backdrop.style.left = `${-col * 100}%`;

  win.appendChild(backdrop);
  return win;
}

/** Reconstruit la preview division×division en haut de l'écran (retour
 * utilisateur: "on affiche la preview à débloquer dans une sorte d'état
 * disable [...] et on y trace sa division des formes pour que le joueur ait
 * un repère"), assombrie/désaturée tant que la FORME correspondante n'est
 * pas ENTIÈREMENT retrouvée (retour utilisateur: "lorsque le joueur a
 * découvert entièrement une forme, elle se 'enable' sur la preview en
 * haut") — jamais case par case, toujours forme par forme. Un contour
 * (border-right/bottom) sépare deux cases de FORMES DIFFÉRENTES uniquement
 * (retour utilisateur: "il faut que les formes définies soient
 * constatables, donc détourées"), jamais deux cases de la même forme. */
/** @param justFoundShapeId — retour utilisateur: "animation sur la preview
 * lorsqu'on découvre une pièce entière" — identifiant de la forme qui vient
 * SEULEMENT d'être entièrement révélée par le dernier clic (ou `null` sur
 * tout rendu qui n'en découle pas, ex. simple retour sur l'écran): ajoute
 * une classe d'animation UNIQUEMENT aux cases de cette forme, plutôt qu'à
 * toute case déjà trouvée — sans ça, comme tout le damier est reconstruit
 * depuis zéro à chaque rendu (innerHTML vidé), une classe d'animation posée
 * sans condition sur .meditate-preview-cell--found rejouerait l'animation
 * de TOUTES les formes déjà trouvées à chaque nouveau clic. */
function renderMeditatePreview(def, revealState, justFoundShapeId = null) {
  meditatePreviewGridEl.innerHTML = "";
  // 1fr: chaque colonne se partage également la largeur du conteneur (voir
  // meditate.css: .meditate-preview-grid, largeur bornée via `min()`) —
  // aucune taille de case calculée ici, purement délégué au CSS.
  meditatePreviewGridEl.style.gridTemplateColumns = `repeat(${def.division}, 1fr)`;

  const shapeAt = Array.from({ length: def.division }, () => Array(def.division).fill(null));
  for (const shape of def.shapes) {
    for (const [r, c] of shape.cells) shapeAt[r][c] = shape.id;
  }

  for (let row = 0; row < def.division; row++) {
    for (let col = 0; col < def.division; col++) {
      const win = makeMeditateWindow(def.tier, def.division, row, col);
      const shapeId = shapeAt[row][col];
      const found = shapeId != null && revealState[shapeId];
      win.classList.add("meditate-preview-cell", found ? "meditate-preview-cell--found" : "meditate-preview-cell--locked");
      if (found && shapeId === justFoundShapeId) win.classList.add("meditate-preview-cell--just-found");
      if (col < def.division - 1 && shapeAt[row][col + 1] !== shapeId) win.classList.add("meditate-preview-cell--edge-right");
      if (row < def.division - 1 && shapeAt[row + 1][col] !== shapeId) win.classList.add("meditate-preview-cell--edge-bottom");
      meditatePreviewGridEl.appendChild(win);
    }
  }
}

/** Grille de recherche (retour utilisateur: "toutes les cases doivent se
 * toucher" — voir meditate.css: technique des marges négatives qui
 * superposent les bordures d'une case sur sa voisine, même principe que
 * sommation.js: .som-grid). Une case déjà révélée montre soit le VRAI
 * fragment d'image (même imagerie que la preview, repositionné via son
 * origine `originRow`/`originCol` — voir meditate.js: generateGrid), soit
 * un simple fond neutre si elle ne portait rien (retour utilisateur: "soit
 * il n'y a rien [...] soit il y a un morceau d'une des formes") — jamais un
 * indice visuel AVANT le clic (retour utilisateur: "quand je clique rien ne
 * se découvre [...] mais quand quelque chose se découvre ça doit être
 * aussi visuel").
 *
 * @param justRevealedIndex — retour utilisateur: "une animation sur les
 * cases autant lorsqu'on a rien derrière que lorsqu'on découvre un
 * élément" — index de la case que le DERNIER clic vient de révéler (ou
 * `null` sur tout rendu qui n'en découle pas). Même raisonnement que
 * justFoundShapeId ci-dessus (renderMeditatePreview): toute la grille est
 * reconstruite depuis zéro à chaque rendu, donc l'animation ne doit être
 * posée QUE sur cette case précise, jamais sur toutes celles déjà
 * révélées, sous peine de les voir toutes rejouer leur animation à chaque
 * nouveau clic. */
function renderMeditateSearchGrid(def, grid, justRevealedIndex = null) {
  meditateSearchGridEl.innerHTML = "";
  // Retour utilisateur: "la grille de jeu doit être grande, prendre la
  // largeur du téléphone et s'adapter en hauteur [...] juste un
  // pourcentage, ou du flex en CSS" — aucune taille de case calculée en JS:
  // `1fr` fait que chaque colonne se partage également la largeur RÉELLE de
  // .meditate-search-grid (width:100%, voir meditate.css), et `aspect-ratio:
  // 1` (posé sur .meditate-search-cell) fait suivre la hauteur de chaque
  // case sur sa propre largeur — donc sur toute la grille, entièrement
  // recalculé par le navigateur à chaque reflow (rotation, redimensionnement
  // desktop...), sans le moindre JS.
  meditateSearchGridEl.style.gridTemplateColumns = `repeat(${grid.size}, 1fr)`;

  // Retour utilisateur: "les contours s'adaptent en fonction des cases
  // voisines dévoilées, l'idée c'est d'avoir CONSTAMMENT les contours de la
  // forme à trouver, pas les contours de la case puis de la forme" — la
  // version précédente comparait au statut RÉVÉLÉ des voisins
  // (sameRevealedShape), donc le contour changeait de forme au fil des
  // clics (une case de plus révélée = une ligne interne qui disparaît),
  // recomposant progressivement un contour approximatif plutôt que de
  // montrer d'emblée le VRAI contour, fixe, de la pièce entière.
  // Désormais: dès qu'UNE SEULE case d'une forme est révélée, cette forme
  // est "repérée" (touchedShapeIds) et son contour COMPLET s'affiche
  // immédiatement sur la totalité de ses cases réelles (grid.cells connaît
  // le shapeId de CHAQUE case, y compris non révélées — voir
  // game/meditate.js: generateGrid), qu'elles soient déjà cliquées ou non.
  // Le contour ne bouge plus ensuite: sameShapeStatic compare au shapeId
  // RÉEL du voisin (pas à son statut révélé), donc la géométrie affichée
  // est celle de la pièce elle-même, stable du premier au dernier clic sur
  // cette forme. Les cases pas encore cliquées à l'intérieur restent de
  // simples boutons sombres (aucune fuite du FRAGMENT/image, juste son
  // contour) — jamais un contour sur une forme pas encore repérée, jamais
  // sur les cases sans forme (shapeId null).
  const touchedShapeIds = new Set();
  for (const c of grid.cells) if (c.revealed && c.shapeId != null) touchedShapeIds.add(c.shapeId);

  const sameShapeStatic = (row, col, shapeId) => {
    if (row < 0 || row >= grid.size || col < 0 || col >= grid.size) return false;
    return grid.cells[row * grid.size + col].shapeId === shapeId;
  };

  const addEdgeClasses = (el, row, col, shapeId) => {
    if (!sameShapeStatic(row, col + 1, shapeId)) el.classList.add("meditate-search-cell--edge-right");
    if (!sameShapeStatic(row, col - 1, shapeId)) el.classList.add("meditate-search-cell--edge-left");
    if (!sameShapeStatic(row + 1, col, shapeId)) el.classList.add("meditate-search-cell--edge-bottom");
    if (!sameShapeStatic(row - 1, col, shapeId)) el.classList.add("meditate-search-cell--edge-top");
  };

  grid.cells.forEach((cell, index) => {
    const justRevealed = index === justRevealedIndex;
    const row = Math.floor(index / grid.size);
    const col = index % grid.size;
    let el;
    if (cell.revealed && cell.shapeId != null) {
      el = makeMeditateWindow(def.tier, def.division, cell.originRow, cell.originCol);
      el.classList.add("meditate-search-cell", "meditate-search-cell--fragment");
      if (justRevealed) el.classList.add("meditate-search-cell--reveal-fragment");
      addEdgeClasses(el, row, col, cell.shapeId);
    } else {
      el = document.createElement("button");
      el.type = "button";
      el.className = "meditate-search-cell";
      if (cell.revealed) {
        el.classList.add("meditate-search-cell--empty");
        if (justRevealed) el.classList.add("meditate-search-cell--reveal-empty");
        el.disabled = true;
      } else {
        el.addEventListener("click", () => onMeditateCellClick(index));
        // Case pas encore cliquée mais appartenant à une forme déjà
        // repérée ailleurs sur la grille: son contour fait partie du
        // pourtour global de cette forme (voir commentaire ci-dessus),
        // même si le fragment lui-même reste caché tant qu'elle n'est pas
        // cliquée individuellement.
        if (cell.shapeId != null && touchedShapeIds.has(cell.shapeId)) addEdgeClasses(el, row, col, cell.shapeId);
      }
    }
    meditateSearchGridEl.appendChild(el);
  });
}

// Retour utilisateur: "on n'a pas non plus l'animation d'addition/
// soustraction sur les éclairs [...] ça devrait faire comme pour les
// étoiles" — même principe que lastRenderedPoints/triggerPointsAnim
// (renderPointsEverywhere ci-dessus): mémorise la dernière valeur RENDUE
// pour détecter un delta à chaque appel, initialisée avant le tout premier
// rendu pour ne rien animer au chargement.
let lastRenderedEnergy = loadStars();

function renderMeditateEnergy() {
  if (!meditateEnergyEl) return;
  const energy = loadStars();
  meditateEnergyEl.innerHTML = boltLabel(energy);
  const delta = energy - lastRenderedEnergy;
  lastRenderedEnergy = energy;
  if (delta !== 0) triggerPointsAnim(meditateEnergyEl, delta > 0 ? "energy-gain" : "energy-loss");
}

/** Point d'entrée (voir showView: name === "meditate") — prépare une grille
 * pour la bannière en cours si besoin (voir meditate.js: ensureCurrentGrid)
 * puis (re)dessine tout l'écran depuis zéro, jamais un rendu incrémental
 * (même principe que renderLevelGrid/refreshProfileBadges: on ne risque
 * jamais un affichage périmé). */
// `justRevealedIndex`/`justFoundShapeId`: relayés tels quels à
// renderMeditateSearchGrid/renderMeditatePreview (voir leurs commentaires
// respectifs) — `null` par défaut pour tout appel qui ne découle pas
// directement d'un clic (entrée sur l'écran, retour après fermeture de la
// modale de récompense...), pour n'y rejouer AUCUNE animation.
function renderMeditateView(justRevealedIndex = null, justFoundShapeId = null) {
  renderMeditateEnergy();
  // Retour utilisateur: "on va retirer les 'pages' affichées lorsqu'on a
  // terminé le mode [...] Meditate [...] le bouton dans le menu est
  // disable avec un petit badge" — l'ancien écran "tout débloqué"
  // (#meditate-done-state) est retiré ; le bouton #menu-meditate désactivé
  // (voir renderModeMenuButtons) empêche normalement d'entrer ici une fois
  // terminé, ce filet de sécurité redirige simplement vers le menu si cet
  // écran était malgré tout atteint dans cet état.
  if (isMeditateAllUnlocked()) {
    goToTitle();
    return;
  }

  const def = getMeditateCurrentDef();
  const grid = ensureMeditateGrid();
  if (!def || !grid) return; // filet de sécurité, ne devrait pas arriver ici (voir isMeditateAllUnlocked ci-dessus)

  meditatePreviewNameEl.textContent = def.name;
  meditatePreviewNameEl.style.color = MEDITATE_NAME_COLORS[def.tier] ?? "";
  renderMeditatePreview(def, getMeditateShapeRevealState(), justFoundShapeId);
  renderMeditateSearchGrid(def, grid, justRevealedIndex);
}

/** Clic sur une case pas encore révélée — dépense 1 Énergie via
 * meditate.js:revealCell (retour utilisateur: "ça découvre la case [...]
 * en payant un Éclair"), jamais gratuit ni remboursé si la case était
 * vide. Ré-affiche entièrement l'écran ensuite (voir renderMeditateView) —
 * y compris quand une bannière vient d'être débloquée: la modale de
 * récompense PARTAGÉE (showCosmeticUnlockModal, même composant que Remember)
 * s'affiche par-dessus le nouvel état déjà à jour (bannière suivante, ou
 * écran "tout débloqué"), jamais derrière. */
// Retour utilisateur: "j'aimerais que lorsqu'on gagne, on ait un peu de
// flottement entre le moment où on découvre la dernière pièce en entier et
// le moment où la victoire s'annonce, très léger, peut-être juste une
// seconde". `def`/`grid` sont capturés AVANT revealMeditateCell (toujours
// corrects: rien d'autre n'a pu les modifier entre le rendu précédent et ce
// clic) car revealCell (meditate.js) fait avancer l'état RÉEL de façon
// synchrone dès qu'une bannière se débloque (bannerIndex incrémenté, grid
// remis à null pour la bannière suivante) — sans cette capture,
// renderMeditateView() basculerait IMMÉDIATEMENT sur la bannière suivante
// (ou l'écran "tout débloqué"), sans jamais montrer la grille dans son état
// "juste complété".
const MEDITATE_VICTORY_DELAY_MS = 1000;

// Retour utilisateur: "quand on clique sans avoir d'éclairs à dépenser, ça
// ne doit pas sélectionner la case [...] plutôt faire vibrer la chip de la
// ressource Éclairs, ou [...] l'animation + son qu'on utilise [...] quand
// on ne découvre pas de case vide" — la case elle-même reste un <button>
// (voir .meditate-search-cell:focus, meditate.css: outline supprimé), donc
// plus aucun retour visuel n'y reste "collé" après un clic refusé ; à la
// place, on secoue #meditate-energy (même classe générique
// input-error/input-error--shake que l'éditeur, voir editor.js:
// markImportError) et on rejoue le SFX déjà utilisé pour "case vide" côté
// grille (playMeditateEmpty) plutôt que d'en créer un nouveau.
function flashMeditateEnergyShortage() {
  if (!meditateEnergyEl) return;
  meditateEnergyEl.classList.remove("input-error--shake");
  void meditateEnergyEl.offsetWidth; // force le redémarrage de l'animation si déjà en cours
  meditateEnergyEl.classList.add("input-error", "input-error--shake");
  playMeditateEmpty();
}

// Nettoie la classe d'erreur une fois l'anim terminée (0.4s, voir
// som-shake-fail dans sommation-fx.css) plutôt que de la laisser en
// permanence sur la pilule — sinon la bordure resterait teintée "erreur"
// même après une résolution normale du clic suivant.
document.addEventListener("animationend", (e) => {
  if (e.target === meditateEnergyEl && e.animationName === "som-shake-fail") {
    meditateEnergyEl.classList.remove("input-error", "input-error--shake");
  }
});

// Retour utilisateur: "on ne charge pas le prochain niveau tant que la
// modale de récompense n'est pas fermée ! [...] si je clique vite, je peux
// à la fois terminer le niveau et commencer le suivant avant que la modale
// ne soit ouverte" — bug de course: revealMeditateCell (meditate.js) fait
// avancer l'état RÉEL de façon synchrone dès que la dernière pièce d'une
// bannière est trouvée (bannerIndex incrémenté, nouvelle grille prête pour
// la bannière suivante), MAIS l'écran continue d'afficher l'ANCIENNE grille
// (capturée plus bas) pendant tout MEDITATE_VICTORY_DELAY_MS avant que la
// modale n'apparaisse — ses boutons restent donc cliquables tout ce temps.
// Un clic pendant cette fenêtre appelait de nouveau onMeditateCellClick,
// qui relit ensureMeditateGrid()/getMeditateCurrentDef() (déjà ceux de la
// bannière SUIVANTE) : le clic, destiné à l'écran "victoire" encore
// affiché, dépensait donc en réalité un Éclair sur le NOUVEAU niveau avant
// même que le joueur ait vu la modale. meditateInputLocked bloque tout
// nouveau clic dès l'entrée dans la branche bannerUnlocked ci-dessous,
// jusqu'à la fermeture de la modale (onClose), qui le relâche juste avant
// de (re)construire l'écran suivant.
let meditateInputLocked = false;

function onMeditateCellClick(index) {
  if (meditateInputLocked) return;
  const def = getMeditateCurrentDef();
  const grid = ensureMeditateGrid();
  const result = revealMeditateCell(index);
  if (!result.ok) {
    if (result.reason === "not-enough-energy") {
      hapticWarning();
      flashMeditateEnergyShortage();
    }
    return;
  }
  hapticLight();
  renderMeditateEnergy();
  // Retour utilisateur: "avec un son pour chaque cas" — deux SFX distincts
  // (voir game/sound.js) selon que la case révélée portait un fragment ou
  // rien du tout, jamais le même quel que soit le résultat.
  if (result.shapeId != null) playMeditateFragment();
  else playMeditateEmpty();

  if (result.bannerUnlocked && def && grid) {
    // Voir commentaire de meditateInputLocked ci-dessus: verrouillé DÈS ICI,
    // avant même le délai, pour couvrir toute la fenêtre où l'ancienne
    // grille reste affichée et cliquable.
    meditateInputLocked = true;
    // Ré-affiche D'ABORD la case qui vient d'être cliquée dans la grille
    // encore "actuelle" (celle capturée ci-dessus) — le joueur voit la
    // dernière pièce se révéler entièrement (avec son animation, voir
    // justRevealedIndex/justFoundShapeId ci-dessous) — puis attend
    // MEDITATE_VICTORY_DELAY_MS avant l'annonce de victoire proprement dite.
    grid.cells[index].revealed = true;
    const revealState = {};
    for (const shape of def.shapes) revealState[shape.id] = true; // bannerUnlocked => tout est trouvé
    renderMeditatePreview(def, revealState, result.shapeId);
    renderMeditateSearchGrid(def, grid, index);
    setTimeout(() => {
      hapticSuccess();
      saveProgressToCloud();
      // Retour utilisateur: "on ne doit pas passer à la grille suivante
      // tant que la modale de récompense n'est pas fermée" — onClose
      // plutôt qu'un appel immédiat, pour ne basculer qu'APRÈS que le
      // joueur ait explicitement fermé la modale. Sur la DERNIÈRE bannière
      // (result.allDone), on redirige vers le menu (retour utilisateur:
      // "une fois la modale de récompense fermée, on redirige vers le
      // menu") plutôt que de ré-afficher cet écran maintenant terminé.
      showCosmeticUnlockModal({
        kind: "badge",
        badgeTier: result.unlockedTier,
        title: result.unlockedName ? `Bannière « ${result.unlockedName} »` : "Nouvelle bannière",
        subtitle: result.allDone
          ? "Nouvelle bannière débloquée — tout le contenu de Meditate est désormais débloqué !"
          : "Nouvelle bannière débloquée !",
        onClose: () => {
          meditateInputLocked = false;
          if (result.allDone) goToTitle();
          else renderMeditateView();
        },
      });
    }, MEDITATE_VICTORY_DELAY_MS);
  } else {
    // Reveal "normal" (pas la dernière pièce d'une bannière): l'animation
    // de case + celle de la preview (si une forme individuelle vient
    // d'être complétée, sans pour autant débloquer toute la bannière)
    // peuvent s'appliquer immédiatement, rien à retarder ici.
    renderMeditateView(index, result.shapeCompleted ? result.shapeId : null);
  }
}

// ---------- Défi Quotidien (bouton flottant du menu titre) ----------
const btnDailyChallenge = document.getElementById("btn-daily-challenge");
const dailyChallengeFabBadgeEl = document.getElementById("daily-challenge-fab-badge");
const dailyChallengeFabCooldownEl = document.getElementById("daily-challenge-fab-cooldown");
const gameLogoEl = document.querySelector(".game-logo");

/** Aligne verticalement le bouton flottant sur le logo du menu titre (retour
 * utilisateur: "doit être au niveau du titre sur l'axe vertical") — mesuré
 * sur le DOM réel (getBoundingClientRect), même principe que
 * render.js:measureMetrics(): la hauteur de la bannière profil au-dessus du
 * logo varie selon le badge actif/la longueur du pseudo, impossible à fixer
 * une bonne fois pour toutes en CSS pur. Appelée depuis showView() (juste
 * après que #view-title soit démasqué — AVANT ça, getBoundingClientRect()
 * renverrait une boîte vide) et sur resize (voir plus bas). Ne fait rien si
 * l'écran titre n'est pas affiché, pour ne jamais figer `top` sur une mesure
 * prise pendant que le logo était caché (display:none). */
function alignDailyChallengeFab() {
  if (!btnDailyChallenge || !gameLogoEl) return;
  if (document.getElementById(SCREEN_IDS.title).classList.contains("hidden")) return;
  const logoRect = gameLogoEl.getBoundingClientRect();
  const top = logoRect.top + logoRect.height / 2 - btnDailyChallenge.offsetHeight / 2;
  btnDailyChallenge.style.top = `${Math.max(8, Math.round(top))}px`;
}

/** Reflète l'état courant sur le bouton flottant — appelée au chargement,
 * après chaque victoire (voir advanceAfterWin), et à chaque retour au menu
 * titre (voir showView: name === "title"). Revalide toujours contre la date
 * courante via isDailyChallengeReady/isDailyChallengeCompleted (voir
 * dailyChallenge.js), jamais un état mis en cache ici.
 *
 * Round suivant (retour utilisateur: "on va permettre de jouer le défi
 * quotidien à nouveau [...] en échange d'une rewardAd"): un défi déjà
 * terminé aujourd'hui ne cache PLUS le bouton (contrairement à avant ce
 * round, voir commentaire ci-dessous toujours valable pour "pas encore
 * prêt") — il reste affiché dans un état "fait" distinct (voir
 * floating-controls.css: .daily-challenge-fab--done), seul moyen d'accéder
 * à la popup "rejouer contre une pub" (voir openDailyReplayPopup). */
function renderDailyChallengeButton() {
  if (!btnDailyChallenge) return;
  // Retour utilisateur: "le bouton flottant ne doit apparaître que dès lors
  // que la grille quotidienne est générée, sinon il n'apparaît pas, afin de
  // ne pas faire attendre le joueur dans un loading pour rien" — le bouton
  // reste absent tant que ce n'est pas prêt (display:none, classe .hidden):
  // display:none (et non juste opacity/visibility) est volontaire, c'est ce
  // qui permet à l'animation d'entrée (.daily-challenge-fab: animation
  // d'entrée déclenchée par le passage display:none -> visible) de se
  // rejouer aussi bien le jour suivant qu'à l'instant précis où la
  // génération du jour se termine.
  const completed = isDailyChallengeCompleted();
  const ready = isDailyChallengeReady();
  btnDailyChallenge.classList.toggle("hidden", !ready);
  btnDailyChallenge.classList.toggle("daily-challenge-fab--done", ready && completed);
  if (!ready) return; // rien d'autre à mettre à jour sur un bouton caché
  if (completed) {
    // Retour utilisateur: "le bouton Défi quotidien lorsqu'il a déjà été
    // fait doit avoir un petit badge 'pub' pour prévenir qu'il faudra
    // visionner une pub" — remplace la pastille "!" (réservée à "grille du
    // jour pas encore jouée") par ce badge dédié, affiché QUELLE QUE SOIT
    // l'état du cooldown (le détail exact du compte à rebours, lui, ne
    // s'affiche que DANS la popup, voir openDailyReplayPopup/
    // renderDailyReplayPopup) — juste un rappel visuel permanent qu'un rejeu
    // passera forcément par une pub.
    dailyChallengeFabBadgeEl.classList.remove("hidden");
    dailyChallengeFabBadgeEl.classList.add("daily-challenge-fab-badge--pub");
    dailyChallengeFabBadgeEl.textContent = t("daily-challenge-fab-badge--pub.label");
    btnDailyChallenge.title = "Défi Quotidien — déjà fait aujourd'hui, appuyer pour rejouer contre une pub";
    // Retour utilisateur: "lorsqu'on active un timer d'une heure, j'aimerais
    // que ce timer soit visible sous le chip 'pub' dans un deuxième chip
    // rougeâtre collé au premier" — contrairement au badge "Pub" ci-dessus
    // (permanent tant que le défi est fait), celui-ci reflète le cooldown
    // ACTUEL (voir dailyChallenge.js: getReplayCooldownRemainingMs) et
    // disparaît dès qu'il est écoulé — voir aussi le setInterval juste après
    // cette fonction, qui la rappelle périodiquement pour que ce compte à
    // rebours ne reste jamais figé pendant qu'on regarde le menu.
    if (dailyChallengeFabCooldownEl) {
      const remaining = getReplayCooldownRemainingMs();
      dailyChallengeFabCooldownEl.classList.toggle("hidden", remaining === 0);
      // Retour utilisateur: "affiche juste le timer dans le format mm:ss,
      // sinon ça prend trop de place" — le chip est minuscule (16px de
      // haut, collé au badge "Pub" au-dessus, voir floating-controls.css),
      // le format verbeux "1 h 12 min" de la popup (formatDailyReplayCooldown
      // plus bas) y débordait. mm:ss (jamais d'heures: le cooldown plafonne
      // à 1h = 60:00, voir dailyChallenge.js: REPLAY_COOLDOWN_MS) tient
      // toujours sur la même largeur compacte.
      if (remaining > 0) dailyChallengeFabCooldownEl.textContent = formatCooldownClock(remaining);
    }
    return;
  }
  dailyChallengeFabBadgeEl.classList.remove("hidden", "daily-challenge-fab-badge--pub");
  dailyChallengeFabBadgeEl.textContent = "!";
  btnDailyChallenge.title = "Défi Quotidien — grille du jour, +1 Énergie";
  // Pas "fait" aujourd'hui: aucun cooldown de rejeu ne peut être actif, voir
  // commentaire ci-dessus.
  dailyChallengeFabCooldownEl?.classList.add("hidden");
}

// Rafraîchit périodiquement le bouton flottant pendant qu'il reste affiché
// (voir dailyChallengeFabCooldownEl ci-dessus) — sans ça, son compte à
// rebours resterait figé à la valeur lue au dernier vrai événement
// (victoire, retour au menu...) tant que le joueur ne quitte/revient pas
// sur l'écran titre. 1s (et non 30s comme le popup de rejeu, voir
// renderDailyReplayPopup plus bas): le chip affiche maintenant les secondes
// (format mm:ss, retour utilisateur) donc doit véritablement défiler
// seconde par seconde plutôt que sauter par paliers de 30.
//
// Retour utilisateur: "le téléphone chauffe au bout d'un moment" — ce tic
// tournait auparavant EN PERMANENCE dès le chargement du module (un
// `setInterval` posé une fois pour toutes, jamais nettoyé), quel que soit
// l'écran affiché — y compris en pleine partie, où ce bouton n'est même
// pas visible (voir renderDailyChallengeButton: `#btn-daily-challenge`
// n'existe QUE sur l'écran titre, voir index.html). Le travail individuel
// est négligeable, mais un réveil CPU perpétuel et inutile s'additionne au
// fil d'une longue session. Démarré/arrêté désormais depuis showView (voir
// plus haut), UNIQUEMENT tant que l'écran titre est affiché.
let dailyChallengeFabTickTimer = null;

function startDailyChallengeFabTicker() {
  if (dailyChallengeFabTickTimer) return; // déjà en cours: idempotent
  dailyChallengeFabTickTimer = setInterval(renderDailyChallengeButton, 1_000);
}

function stopDailyChallengeFabTicker() {
  if (!dailyChallengeFabTickTimer) return;
  clearInterval(dailyChallengeFabTickTimer);
  dailyChallengeFabTickTimer = null;
}

btnDailyChallenge.onclick = () => {
  if (isDailyChallengeCompleted()) {
    openDailyReplayPopup();
    return;
  }
  const level = getDailyChallengeLevel();
  // Ne devrait plus arriver: le bouton n'est désormais visible qu'une fois
  // la grille du jour réellement générée (voir renderDailyChallengeButton
  // ci-dessus) — gardé en garde-fou défensif plutôt que retiré, au cas où
  // un appel externe l'afficherait un jour sans repasser par cette fonction.
  if (!level) return;
  viewStack = ["title", "play"];
  loadDailyChallengeLevel(level);
  showView("play", { mode: "daily" });
};

// ---------- Défi Quotidien: rejouer contre une pub (retour utilisateur) ----------
// "on va permettre de jouer le défi quotidien à nouveau (nouvelle
// génération de grille) en échange d'une rewardAd [...] il faudra attendre
// minimum une heure avant de pouvoir refaire cette action [...] on affichera
// donc un compteur d'une heure [...] sur la petite pop up du menu."
// Round suivant (retour utilisateur): "plutôt que de mettre une ligne
// descriptive pour le timer, il suffit de mettre le timer dans le bouton et
// de verrouiller le bouton tant que le timer n'est pas terminé" — le texte
// d'intro (#daily-replay-banner) reste désormais TOUJOURS affiché, seul le
// bouton en dessous change de libellé/état selon le cooldown (voir
// renderDailyReplayPopup) — voir index.html: #daily-replay-popup, puis
// #daily-replay-confirm-modal (confirmation + vraie rewarded ad, même
// mécanisme que som-ad-modal/som-genoffer-modal).
const dailyReplayPopupEl = document.getElementById("daily-replay-popup");
const btnDailyReplayOffer = document.getElementById("btn-daily-replay-offer");
const dailyReplayConfirmModalEl = document.getElementById("daily-replay-confirm-modal");
const btnDailyReplayWatch = document.getElementById("btn-daily-replay-watch");
const dailyReplayAdStatusEl = document.getElementById("daily-replay-ad-status");
let dailyReplayCooldownTimer = null;

/** "1 h 12 min" / "45 min" — toujours arrondi À LA MINUTE SUPÉRIEURE (jamais
 * 0 min affiché tant qu'il reste ne serait-ce qu'une seconde de cooldown),
 * pour ne jamais laisser croire que c'est déjà rejouable. */
function formatDailyReplayCooldown(ms) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

/** "45:12" — format compact pour le chip du bouton flottant (voir
 * renderDailyChallengeButton), trop petit pour le format verbeux ci-dessus.
 * Jamais de composante heures: REPLAY_COOLDOWN_MS (dailyChallenge.js)
 * plafonne à 1h, donc `m` ne dépasse jamais 60. Arrondi À LA SECONDE
 * SUPÉRIEURE pour la même raison que formatDailyReplayCooldown: ne jamais
 * afficher 00:00 tant qu'il reste du cooldown. */
function formatCooldownClock(ms) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** (Ré)affiche le bouton de la popup selon le cooldown ACTUEL (voir
 * dailyChallenge.js: getReplayCooldownRemainingMs) — jamais un état figé au
 * moment de l'ouverture, voir openDailyReplayPopup qui rafraîchit ceci
 * périodiquement tant que la popup reste affichée. Verrouillé (disabled) +
 * libellé = le compte à rebours tant que le cooldown n'est pas écoulé,
 * sinon redevient le bouton normal "Regarder une pub". */
function renderDailyReplayPopup() {
  const remaining = getReplayCooldownRemainingMs();
  const canReplay = remaining === 0;
  btnDailyReplayOffer.disabled = !canReplay;
  btnDailyReplayOffer.textContent = canReplay
    ? t("daily-replay-banner.button")
    : `Disponible dans ${formatDailyReplayCooldown(remaining)}`;
}

function openDailyReplayPopup() {
  renderDailyReplayPopup();
  dailyReplayPopupEl.classList.remove("hidden");
  clearInterval(dailyReplayCooldownTimer);
  // 30s: largement suffisant pour un compte à rebours affiché à la minute
  // près (voir formatDailyReplayCooldown) — jamais besoin de la seconde,
  // et évite de solliciter le DOM inutilement pendant que la popup reste
  // ouverte.
  dailyReplayCooldownTimer = setInterval(renderDailyReplayPopup, 30_000);
}

function closeDailyReplayPopup() {
  dailyReplayPopupEl.classList.add("hidden");
  clearInterval(dailyReplayCooldownTimer);
  dailyReplayCooldownTimer = null;
}

document.querySelectorAll("[data-daily-replay-popup-close]").forEach((el) => (el.onclick = closeDailyReplayPopup));

function closeDailyReplayConfirmModal() {
  dailyReplayConfirmModalEl.classList.add("hidden");
}

document.querySelectorAll("[data-daily-replay-confirm-close]").forEach((el) => (el.onclick = closeDailyReplayConfirmModal));

/** Clic sur le bouton du bandeau (retour utilisateur: "si on clique sur le
 * bouton, on a une modale qui prévient qu'il faut regarder la pub") — ferme
 * la popup et ouvre la VRAIE modale de confirmation, réinitialisée à son
 * état de départ (au cas où une tentative précédente avait laissé un
 * message d'erreur affiché). */
btnDailyReplayOffer.onclick = () => {
  closeDailyReplayPopup();
  if (dailyReplayAdStatusEl) {
    dailyReplayAdStatusEl.textContent = "";
    dailyReplayAdStatusEl.classList.add("hidden");
  }
  btnDailyReplayWatch.disabled = false;
  btnDailyReplayWatch.textContent = t("btn-daily-replay-watch");
  dailyReplayConfirmModalEl.classList.remove("hidden");
};

/** Même principe que btnHintWatchAd.onclick/genOfferAcceptBtn.onclick
 * ci-dessus: showRewardedAd() ne résout `earned: true` QUE sur confirmation
 * du SDK — la grille n'est régénérée (dailyChallenge.js:
 * regenerateTodayChallengeViaAd, qui enregistre aussi l'horodatage du
 * cooldown) que dans ce cas précis, jamais de façon optimiste. */
btnDailyReplayWatch.onclick = async () => {
  btnDailyReplayWatch.disabled = true;
  btnDailyReplayWatch.textContent = "Chargement…";
  if (dailyReplayAdStatusEl) {
    dailyReplayAdStatusEl.textContent = "";
    dailyReplayAdStatusEl.classList.add("hidden");
  }
  const { earned, reason } = await showRewardedAd();
  if (earned) {
    trackEvent("rewarded_ad_completed", { placement: "daily_challenge_replay" });
    closeDailyReplayConfirmModal();
    const level = await regenerateTodayChallengeViaAd();
    renderDailyChallengeButton();
    if (level) {
      viewStack = ["title", "play"];
      loadDailyChallengeLevel(level);
      showView("play", { mode: "daily" });
    }
    return;
  }
  btnDailyReplayWatch.disabled = false;
  btnDailyReplayWatch.textContent = t("btn-daily-replay-watch");
  if (dailyReplayAdStatusEl) {
    dailyReplayAdStatusEl.textContent =
      reason === "unavailable"
        ? "Pas de pub disponible pour l'instant — réessaie dans un instant."
        : "Pub fermée avant la fin — rien n'a changé.";
    dailyReplayAdStatusEl.classList.remove("hidden");
  }
};

// Amorce la génération dès l'ouverture de l'app (retour utilisateur: "on
// vérifie que la grille est à jour selon la date") — en arrière-plan,
// jamais bloquant, pour que le bouton soit déjà prêt le temps que le joueur
// arrive au menu titre. Sans effet si une grille valide pour aujourd'hui
// existe déjà (voir ensureTodayChallenge: no-op dans ce cas).
ensureTodayChallenge().then(() => renderDailyChallengeButton());
renderDailyChallengeButton();

/** Retour utilisateur: "on va retirer les 'pages' affichées lorsqu'on a
 * terminé le mode Remember ou Meditate [...] le bouton dans le menu est
 * disable avec un petit badge qui indique que le mode est terminé" —
 * bascule `disabled` + la pastille "Terminé" (voir title.css:
 * .menu-card-done-badge) sur #menu-remember/#menu-meditate selon
 * isPixelArtUnlocked()/isMeditateAllUnlocked(). Appelée à chaque passage
 * par le menu titre (voir showView: name === "title") — jamais figée sur un
 * état périmé, même principe que renderDailyChallengeButton/
 * renderTitleProfileBanner ci-dessus. */
const menuStoryBtn = document.getElementById("menu-story");
const menuInfiniteBtn = document.getElementById("menu-infinite");
const menuRememberBtn = document.getElementById("menu-remember");
const menuRememberDoneBadgeEl = document.getElementById("menu-remember-done-badge");
const menuMeditateBtn = document.getElementById("menu-meditate");
const menuMeditateDoneBadgeEl = document.getElementById("menu-meditate-done-badge");

function renderModeMenuButtons() {
  const rememberDone = isPixelArtUnlocked();
  menuRememberBtn.disabled = rememberDone;
  menuRememberDoneBadgeEl?.classList.toggle("hidden", !rememberDone);

  const meditateDone = isMeditateAllUnlocked();
  menuMeditateBtn.disabled = meditateDone;
  menuMeditateDoneBadgeEl?.classList.toggle("hidden", !meditateDone);
}

menuStoryBtn.onclick = enterStoryDirect;
menuInfiniteBtn.onclick = enterInfiniteDirect;
document.getElementById("menu-community").onclick = () => pushView("community");
menuRememberBtn.onclick = enterRememberDirect;
// Garde-fou (voir renderModeMenuButtons): #menu-meditate est désactivé une
// fois Meditate terminé, donc ce onclick ne devrait alors plus jamais se
// déclencher (les navigateurs n'émettent pas de "click" sur un <button
// disabled>) — vérifié malgré tout, même principe que enterRememberDirect.
menuMeditateBtn.onclick = () => {
  if (!isMeditateAllUnlocked()) pushView("meditate");
};
document.getElementById("menu-options").onclick = () => pushView("options");

renderActiveScreen();
renderTitleStoryProgress();
renderTitleProfileBanner();
renderModeMenuButtons();
// Premier alignement (voir alignDailyChallengeFab ci-dessus): l'app démarre
// TOUJOURS sur l'écran titre (viewStack initial, voir plus haut), donc
// #view-title est déjà démasqué à ce stade sans passer par showView() — et
// pour la MÊME raison, le tic du chip cooldown (voir
// startDailyChallengeFabTicker, normalement démarré/arrêté depuis
// showView selon l'écran) doit être lancé explicitement ici aussi, sous
// peine de rester figé jusqu'à la première navigation.
alignDailyChallengeFab();
startDailyChallengeFabTicker();

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
  resizeDebounceId = setTimeout(() => {
    renderer.render();
    // Même raisonnement que ci-dessus, appliqué au bouton Défi Quotidien
    // (voir alignDailyChallengeFab): un changement de largeur peut faire
    // passer le logo à la ligne différemment (mobile étroit) et décaler sa
    // position verticale — sans effet si l'écran titre n'est pas affiché.
    alignDailyChallengeFab();
  }, 120);
});

// Charge le niveau Histoire courant en mémoire dès le départ (pas encore
// affiché tant que l'écran titre est actif) pour que le plateau soit déjà
// prêt si le joueur clique "Histoire" — évite un plateau vide entraperçu au
// tout premier changement d'écran. `enterStoryDirect`/`showView` rechargeront
// ce même niveau au clic (redondant mais inoffensif) plutôt que de dupliquer
// ici la logique de mise en visibilité de setMode.
setMode("story");
// silent:true — voir loadLevel(): ce préchargement tourne pendant que
// l'écran titre est encore affiché, la modale "schéma" ne doit pas
// pouvoir s'ouvrir ici (voir showView/enterStoryDirect pour le vrai point
// de déclenchement, au clic réel sur "Histoire").
loadLevel(currentStoryIndex(storyProgress, levels.length), { silent: true });

// Mode Admin [dev uniquement] — voir admin.js: n'a d'effet QUE si
// `import.meta.env.DEV` (jamais en build de production). Appelé
// inconditionnellement, comme tous les autres `init*()` de ce fichier —
// c'est la garde interne de la fonction, pas ce point d'appel, qui décide.
initAdminToggle();
