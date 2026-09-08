// Défi Quotidien — retour utilisateur: "Tu peux ajouter un mode 'Défi
// Quotidien' [...] Tu peux générer une très grande grille (difficulté 3 mais
// en plus grand) chaque jour (lorsque le joueur est connecté au jeu on
// vérifie que la grille est a jour selon la date) et on enregistre la grille
// sur les données du joueur (pas de grille commune à tout le monde). En
// récompense on gagne une nouvelle ressource (une étoile) [...] Elles
// permettront de débloquer des avatars et des badges."
//
// Génération 100% locale (voir requestLevel/generator.js) avec un seed
// aléatoire à CHAQUE génération — volontairement PAS dérivé de la date
// seule: un seed basé uniquement sur la date produirait la MÊME grille pour
// tous les joueurs (façon Wordle), exactement ce que le retour utilisateur
// exclut explicitement ("pas de grille commune à tout le monde"). Le seul
// rôle de la date est de décider QUAND régénérer (une fois par jour civil,
// heure locale de l'appareil), jamais CE QUI est généré.
import { requestLevel } from "./infiniteClient.js";
import { DAILY_CHALLENGE_SIZE_BOOST, DAILY_CHALLENGE_MIN_BRANCH_COUNT } from "./generator.js";
import {
  loadDailyChallenge,
  saveDailyChallenge,
  loadStars,
  addStars,
  loadDailyReplayAdAt,
  saveDailyReplayAdAt,
} from "./storage.js";
import { trackEvent } from "./analytics.js";

// Budget généreux (voir generator.js: DAILY_CHALLENGE_SIZE_BOOST) — cette
// génération tourne en arrière-plan dans le pool de Workers existant (voir
// infiniteClient.js), jamais sur le thread principal, donc un budget plus
// large que le 3★ normal (9s/40 tentatives, voir DEFAULT_*_BY_TIER) est sans
// risque pour la fluidité : seul le délai avant que le bouton flottant
// devienne "prêt" en dépend (voir ensureTodayChallenge côté appelant, lancé
// dès l'ouverture du menu titre pour laisser le temps de converger).
const MAX_ATTEMPTS = 60;
const MAX_TIME_MS = 45_000;
// Features volontairement plus restreintes que le 3★ Infini par défaut
// (pas de miroir/Pyra, expérimentaux et plus coûteux en recherche) — la
// couleur reste incluse: c'est le cœur de l'identité du jeu ("lumières").
const ENABLED_FEATURE_KEYS = ["forbidden", "color"];

/** "AAAA-MM-JJ" en heure LOCALE de l'appareil (pas UTC: la journée du joueur
 * doit correspondre à son fuseau, pas à un serveur) — clé de comparaison pour
 * savoir si la grille stockée est celle d'aujourd'hui. */
function todayKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readState() {
  return loadDailyChallenge();
}

/** true si une grille valide POUR AUJOURD'HUI est déjà stockée — que le
 * joueur l'ait déjà terminée ou non (voir isTodayCompleted pour distinguer).
 * Revalidée à chaque appel contre la date courante (retour utilisateur: "on
 * vérifie que la grille est à jour selon la date") plutôt que mise en cache
 * en mémoire, pour rester correcte même si l'app reste ouverte à cheval sur
 * minuit. */
export function isTodayReady() {
  const state = readState();
  return !!state && state.date === todayKey() && !!state.level;
}

export function isTodayCompleted() {
  const state = readState();
  return !!state && state.date === todayKey() && state.completed === true;
}

/** Renvoie la grille du jour (ou `null` si pas encore générée/périmée) — ne
 * déclenche JAMAIS de génération elle-même (voir ensureTodayChallenge pour
 * ça), simple lecture. */
export function getTodayLevel() {
  const state = readState();
  if (!state || state.date !== todayKey() || !state.level) return null;
  return state.level;
}

let generationPromise = null;

/** Lance une génération de grille (mêmes paramètres partout, voir
 * ENABLED_FEATURE_KEYS/MAX_ATTEMPTS/MAX_TIME_MS ci-dessus), la stocke comme
 * grille du jour (`completed: false`) puis résout avec le niveau — factorisé
 * ici car ensureTodayChallenge (génération normale) ET
 * regenerateTodayChallengeViaAd (rejeu contre pub, round suivant) partagent
 * EXACTEMENT la même mécanique de génération/stockage, seule la condition de
 * déclenchement diffère. Une seule génération en vol à la fois (mise en
 * cache de la Promise, même pattern que firebaseReady/initAds): appelable
 * sans risque depuis plusieurs points sans jamais en lancer deux en
 * parallèle. Ne throw jamais: en cas d'échec du générateur (cas limite, voir
 * generateLevel), résout avec `null` — l'appelant (main.js) affiche alors un
 * état d'erreur discret plutôt qu'un plateau cassé. */
function generateAndStoreTodayChallenge(trackEventName) {
  if (generationPromise) return generationPromise;

  generationPromise = requestLevel({
    difficulty: 3,
    enabledFeatureKeys: ENABLED_FEATURE_KEYS,
    seed: Date.now() ^ Math.floor(Math.random() * 0xffffffff),
    maxAttempts: MAX_ATTEMPTS,
    maxTimeMs: MAX_TIME_MS,
    sizeBoost: DAILY_CHALLENGE_SIZE_BOOST,
    minBranchCount: DAILY_CHALLENGE_MIN_BRANCH_COUNT,
  })
    .then((result) => {
      if (!result) return null;
      saveDailyChallenge({ date: todayKey(), level: result.level, completed: false });
      trackEvent(trackEventName);
      return result.level;
    })
    .catch(() => null)
    .finally(() => {
      generationPromise = null;
    });

  return generationPromise;
}

/** S'assure qu'une grille valide pour AUJOURD'HUI est disponible, en la
 * (re)générant si besoin (jour différent de la dernière grille stockée, ou
 * jamais générée) — voir todayKey(). Ne régénère JAMAIS une grille déjà
 * valide pour aujourd'hui, même si elle est déjà `completed` (voir
 * regenerateTodayChallengeViaAd ci-dessous pour ce cas précis, qui exige lui
 * une vraie rewarded ad). */
export function ensureTodayChallenge() {
  if (isTodayReady()) return Promise.resolve(getTodayLevel());
  return generateAndStoreTodayChallenge("daily_challenge_generated");
}

/** Marque le défi du jour comme terminé et crédite 1 étoile — protégée
 * contre un double-crédit (ex: victoire redéclenchée par un bug d'affichage,
 * ou l'appelant qui rappellerait deux fois) : n'ajoute l'étoile QUE si l'état
 * stocké n'était pas déjà `completed` pour la date du jour. Retourne le
 * nouveau total d'étoiles (inchangé si déjà complété aujourd'hui). */
export function completeTodayChallenge() {
  const state = readState();
  const key = todayKey();
  if (!state || state.date !== key || !state.level) return loadStars();
  if (state.completed) return loadStars();
  saveDailyChallenge({ ...state, completed: true });
  const total = addStars(1);
  trackEvent("daily_challenge_completed", { stars_total: total });
  return total;
}

// ---------- Rejouer contre une pub (retour utilisateur) ----------
// "on va permettre de jouer le défi quotidien à nouveau (nouvelle génération
// de grille) en échange d'une rewardAd [...] il faudra attendre minimum une
// heure avant de pouvoir refaire cette action" — un SEUL horodatage
// (KEYS.dailyReplayAdAt, voir storage.js) suffit à représenter tout l'état
// du cooldown: "dernière fois que ce visionnage a eu lieu", jamais un
// compteur séparé à garder synchronisé.
const REPLAY_COOLDOWN_MS = 60 * 60 * 1000; // 1h, en dur (retour utilisateur: "minimum une heure")

/** Millisecondes restantes avant de pouvoir proposer à nouveau le rejeu
 * contre une pub — 0 si jamais regardée ou si le cooldown est déjà écoulé. */
export function getReplayCooldownRemainingMs() {
  const last = loadDailyReplayAdAt();
  if (!last) return 0;
  const remaining = last + REPLAY_COOLDOWN_MS - Date.now();
  return remaining > 0 ? remaining : 0;
}

/** Régénère une NOUVELLE grille pour aujourd'hui suite à un visionnage de
 * pub réussi (retour utilisateur: "jouer le défi quotidien à nouveau,
 * nouvelle génération de grille") — remet `completed` à false (même stockage
 * que la génération normale, voir generateAndStoreTodayChallenge) et
 * enregistre l'horodatage de CE visionnage pour armer le cooldown d'1h
 * ci-dessus. Appelée UNIQUEMENT après confirmation du SDK (voir main.js:
 * appelée seulement quand showRewardedAd() résout `earned: true`, jamais de
 * façon optimiste) — contrairement à ensureTodayChallenge, régénère
 * TOUJOURS, même si une grille du jour valide (et déjà terminée) existe. */
export function regenerateTodayChallengeViaAd() {
  saveDailyReplayAdAt(Date.now());
  return generateAndStoreTodayChallenge("daily_challenge_replay_generated");
}

// ---------- Ancien déblocage par seuil d'Énergie (tiers 6-7) ----------
// RETIRÉ (retour utilisateur: "on va retirer les regles actuelles d'unlock
// de ces bannieres pour les modifier") — Comète/Supernova se débloquent
// désormais via le mini-jeu de révélation "Meditate" (voir game/meditate.js:
// MEDITATE_BADGE_DEFS/getMeditateBadges/debugUnlockMeditateBadges, mêmes
// numéros de tier 6-7 réutilisés tels quels côté badges.css). L'ancien
// STAR_BADGE_DEFS/getStarBadges/debugUnlockStarBadges basé sur un simple
// seuil de solde d'Énergie (loadStars() >= cost) n'existe plus.
