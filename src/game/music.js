// Musique par calques (voir music-demos/couches/notes-couches.md pour la
// conception d'origine): une piste de fond ("base"), plus une piste par
// mécanique qu'on démute la première fois qu'elle s'active dans le niveau en
// cours (neurone/neurone de couleur/miroir/neurone miroir/prisme), plus une
// piste d'échec. Tant qu'une synapse est rompue ou qu'un neurone est en
// surcharge, base + couches débloquées ne sont plus COUPÉES mais ÉTOUFFÉES
// (voir `duckFilter`/FAILURE_MUFFLE_GAIN ci-dessous — retour utilisateur:
// "plutôt que de couper la musique qui se joue actuellement, l'étouffer pour
// qu'elle paraisse loin") pendant qu'échec.wav (non filtrée, voir
// `ensureBuilt`) monte par-dessus — elle est conçue pour dominer largement
// ce fond assourdi, pas pour jouer seule dans un silence complet.
//
// Toutes les pistes sont des fichiers WAV bouclables SANS perte (voir
// public/music/ — durée exacte 24.000000s à 44.1kHz, aucun padding
// d'encodeur contrairement à un mp3/ogg compressé, ce qui garantirait un
// clic au raccord de boucle) démarrées TOUTES EN MÊME TEMPS dès le premier
// clic (voir startMusic) puis JAMAIS arrêtées/redémarrées ensuite — on ne
// fait que faire monter/descendre leur gain individuel. C'est ce qui
// garantit qu'elles restent en phase indéfiniment (aucune dérive possible:
// chaque `Tone.Player` boucle sur son propre buffer via le même
// AudioContext, sans dépendre de `Tone.Transport`).
import * as Tone from "tone";
import { isPixelTheme } from "./pixelIcons.js";
// Contexte audio ("playback", moins sujet au grésillement) + bus de sortie
// commun (limiteur anti-clipping) — voir audioBus.js pour le détail des
// deux, partagés avec sound.js. Import placé ici, avant toute création de
// node Tone dans CE fichier : le contexte doit être posé avant le premier
// node, jamais après (voir audioBus.js).
import { masterBus } from "./audioBus.js";

// Gamme utilisée par TOUTES les couches mélodiques (voir
// music-demos/couches: neurone-couleur.wav, prismes.wav) — exportée comme
// référence de tonalité pour toute synthèse/extension future de ces
// couches. sound.js ne s'en sert plus pour la note de pose (voir
// `nextPlacementNote`, qui cite directement la mélodie de neurone-couleur.wav
// plutôt qu'un tirage dans cette gamme).
export const MUSIC_SCALE = ["A3", "C4", "D4", "E4", "G4"];

// Round 13 (thème PixelArt, 6e volet — musique): les mêmes 11 pistes
// existent en DEUX versions — le rendu "lisse" d'origine (public/music/) et
// une réorchestration chiptune/Game Boy (public/music-chip/, voir
// tools/chiptune/ pour le synthétiseur qui les a générées) qui reprend les
// mêmes thèmes/tonalité (même gamme MUSIC_SCALE, même mouvement d'accords
// Am->C->Am sur base.wav) mais en timbres pulse/triangle/bruit LFSR plutôt
// qu'en instruments "lisses". `currentLayerUrls()` choisit le bon jeu selon
// le thème actif au moment de la construction/rechargement des lecteurs —
// voir refreshMusicTheme() plus bas pour le cas où le thème change EN COURS
// DE LECTURE (bouton Options, voir main.js: btnPixelartToggle.onclick).
const LAYER_URLS_SMOOTH = {
  base: "/music/base.wav",
  neurone: "/music/neurone.wav",
  neuroneLayer2: "/music/neurone-layer2.wav",
  neuroneCouleur: "/music/neurone-couleur.wav",
  neuroneCouleurLayer2: "/music/neurone-couleur-layer2.wav",
  miroirs: "/music/miroirs.wav",
  miroirsLayer2: "/music/miroirs-layer2.wav",
  neuronesMiroirs: "/music/neurones-miroirs.wav",
  prismes: "/music/prismes.wav",
  pyra: "/music/pyra.wav",
  echec: "/music/echec.wav",
};

const LAYER_URLS_CHIP = {
  base: "/music-chip/base.wav",
  neurone: "/music-chip/neurone.wav",
  neuroneLayer2: "/music-chip/neurone-layer2.wav",
  neuroneCouleur: "/music-chip/neurone-couleur.wav",
  neuroneCouleurLayer2: "/music-chip/neurone-couleur-layer2.wav",
  miroirs: "/music-chip/miroirs.wav",
  miroirsLayer2: "/music-chip/miroirs-layer2.wav",
  neuronesMiroirs: "/music-chip/neurones-miroirs.wav",
  prismes: "/music-chip/prismes.wav",
  pyra: "/music-chip/pyra.wav",
  echec: "/music-chip/echec.wav",
};

function currentLayerUrls() {
  return isPixelTheme() ? LAYER_URLS_CHIP : LAYER_URLS_SMOOTH;
}

// Couches "mécanique" au sens de resetLayers/setLayerActive — n'inclut ni
// "base" (toujours à 1, jamais dans `unlocked`) ni "echec" (gérée à part,
// voir enterFailure/exitFailure). Les "layer2" sont des couches
// SUPPLÉMENTAIRES qui s'ajoutent par-dessus la couche 1 correspondante à
// partir d'un certain compte (voir MECHANIC_THRESHOLDS) — jamais un
// remplacement, les deux jouent en même temps une fois débloquées.
const MECHANIC_LAYERS = [
  "neurone",
  "neuroneLayer2",
  "neuroneCouleur",
  "neuroneCouleurLayer2",
  "miroirs",
  "miroirsLayer2",
  "neuronesMiroirs",
  "prismes",
  "pyra",
];

// Palier (compte d'éléments actuellement actifs, voir render.js:
// `mechanicCounts`) à partir duquel chaque couche doit être DÉBLOQUÉE — et,
// tout aussi important, RE-VERROUILLÉE si le compte redescend en dessous
// (retour utilisateur: "si on retire les conditions d'unmute, on remute").
// Clé du compte correspondant dans l'objet reçu par `applyMechanicCounts`.
const MECHANIC_THRESHOLDS = {
  neurone: { count: "chargeFull", min: 1 },
  neuroneLayer2: { count: "chargeFull", min: 3 },
  neuroneCouleur: { count: "chargeFullColored", min: 1 },
  neuroneCouleurLayer2: { count: "chargeFullColored", min: 2 },
  miroirs: { count: "mirrorActive", min: 1 },
  miroirsLayer2: { count: "mirrorActive", min: 2 },
  neuronesMiroirs: { count: "neuronesMiroirsActive", min: 1 },
  prismes: { count: "prismActive", min: 1 },
  pyra: { count: "pyraActive", min: 1 },
};

// Gain cible (au lieu de 1) quand une couche est débloquée — "neurone" est
// montée de 10% (retour utilisateur), toutes les autres non listées
// restent à 1 (aucun effet, valeur par défaut ci-dessous).
// Retour utilisateur (grésillement/saturation): "les deux pistes des
// neurones colorés saturent, surtout la deuxième [...] elles sont plutôt
// fortes de toute façon" — neuroneCouleur/neuroneCouleurLayer2 sont deux
// pistes DÉJÀ fortes qui peuvent aussi jouer EN MÊME TEMPS que "neurone"/
// "neuroneLayer2" (les paliers de déblocage ne s'excluent pas, voir
// MECHANIC_THRESHOLDS) — leur somme dépassait visiblement 0dB en sortie,
// d'où la saturation. Layer2 baissée plus fort que la couche 1 (rapportée
// comme la plus touchée). prismes/pyra également baissées un cran, plus
// légèrement (pas rapportées comme saturées, juste "un peu" en trop).
const LAYER_ACTIVE_GAIN = {
  neurone: 1.1,
  neuroneCouleur: 0.7,
  neuroneCouleurLayer2: 0.5,
  prismes: 0.8,
  pyra: 0.8,
};

const FADE = 0.35; // secondes, montée/descente de gain par calque — évite tout clic

// Fondu utilisé spécifiquement pour l'apparition/disparition d'une couche
// MÉCANIQUE (setLayerActive, palier franchi/défranchi en cours de partie —
// retour utilisateur: le fondu de 0.35s ci-dessus donnait une impression de
// bascule "brutale" pour ce cas précis). Volontairement PAS utilisé pour
// l'état d'échec (enterFailure/exitFailure) ni resetLayers: la musique
// d'erreur doit au contraire apparaître/disparaître de façon nette et
// immédiate — c'est le signal d'alarme, il doit rester FADE (0.35s).
const LAYER_FADE = 1.1;

// Retour utilisateur : "plutôt que de couper la musique qui se joue
// actuellement, l'étouffer pour qu'elle paraisse loin" — au lieu de ramener
// le gain de base/des couches débloquées à 0 pendant une erreur, on les
// ramène à ce niveau réduit (jamais silencieux) ET on les fait passer par
// `duckFilter` (passe-bas partagé, voir ci-dessous), qui simule
// l'éloignement/l'étouffement plutôt qu'une coupure nette. Valeurs choisies
// par écoute sur les démos ("wobble prononcé") validées par l'utilisateur.
const FAILURE_MUFFLE_GAIN = 0.4;
const FAILURE_MUFFLE_CUTOFF_HZ = 420;
const NORMAL_CUTOFF_HZ = 20000; // au-delà du spectre audible: filtre inactif en pratique

// Retour utilisateur: "je me demande si c'est pas dû aussi aux enceintes du
// téléphone [...] des sonorités peut-être délicates pour ce type
// d'enceinte" — même filtre "mobile-safe" que sound.js (voir son
// commentaire pour le détail): un haut-parleur de téléphone (minuscule,
// mono, débattement mécanique limité) reproduit mal, voire fait bourdonner,
// tout ce qui descend sous ~150-200Hz. Posé en tout dernier sur le bus
// musique (après musicBus, juste avant la sortie) — coupe ce grave-là en
// douceur pour TOUTES les couches, y compris échec.wav (qui, elle, ne
// passe pas par duckFilter ci-dessous, voir sa raison d'être).
// Se connecte à `masterBus` (voir audioBus.js) plutôt qu'à sa propre
// `.toDestination()` — c'est LUI, désormais, qui reçoit la somme finale
// musique + effets de jeu (voir sound.js) et la protège du clipping (et,
// depuis le round "plus radical", passe aussi par un compresseur avant le
// limiteur — voir audioBus.js).
// Coupure remontée de 160 à 200Hz au round "plus radical" (retour
// utilisateur: le grésillement persistait malgré tout ce qui précède) —
// on sacrifie un peu plus de grave (déjà peu présent/peu utile sur ce type
// d'enceinte) pour une marge de sécurité plus large contre le bourdonnement.
const speakerSafeHighpass = new Tone.Filter(200, "highpass").connect(masterBus);
const musicBus = new Tone.Volume(0).connect(speakerSafeHighpass);

// Passe-bas PARTAGÉ pour base + couches mécaniques uniquement — échec.wav
// (voir ensureBuilt) NE PASSE PAS par ce filtre: elle doit rester pleinement
// claire/nette pendant que le reste s'étouffe derrière elle. Cutoff au repos
// à NORMAL_CUTOFF_HZ (inaudible, filtre neutre) — voir enterFailure/
// exitFailure pour la rampe vers/depuis FAILURE_MUFFLE_CUTOFF_HZ.
const duckFilter = new Tone.Filter(NORMAL_CUTOFF_HZ, "lowpass").connect(musicBus);

/** Volume musique (0 à 1, linéaire) — bus SÉPARÉ de setMasterVolume dans
 * sound.js (qui reste le volume des effets de jeu: pose/retrait/victoire/
 * cibles/synapses/charges). Les deux curseurs sont donc indépendants. */
export function setMusicVolume(level) {
  const clamped = Math.max(0, Math.min(1, level));
  musicBus.volume.value = clamped <= 0 ? -Infinity : Tone.gainToDb(clamped);
}

let players = null; // { key -> Tone.Player }
let gains = null; // { key -> Tone.Gain }
let unlocked = new Set(); // sous-ensemble courant de MECHANIC_LAYERS démuté
let failureCount = 0; // compteur (pas booléen): plusieurs synapses/surcharges possibles à la fois
let started = false;
let loadPromise = null;

// Ambiance (boutique "Secrets", voir storage.js/main.js): un socle de
// couches TOUJOURS démutées, par-dessus lesquelles les déblocages normaux du
// niveau en cours (unlocked, ci-dessus) continuent de s'ajouter comme avant.
// Réutilise les couches mécaniques déjà composées plutôt que de nouveaux
// morceaux dédiés — une vraie composition originale par ambiance serait un
// chantier audio à part entière (voir l'historique de base.wav/echec.wav...,
// plusieurs jours d'itération). Défini ici (pas juste dans MECHANIC_LAYERS)
// pour que `setLayerActive` sache ne JAMAIS re-couper une couche d'ambiance
// au gré des déblocages/déverrouillages du niveau — c'est un socle permanent
// pour la session, pas un événement de jeu.
export const MUSIC_AMBIANCES = {
  "signal-clair": { label: "Signal clair", layers: [] }, // par défaut: comportement inchangé
  "echo-profond": { label: "Écho profond", layers: ["neuroneCouleur"] },
  "reseau-eveille": { label: "Réseau éveillé", layers: ["miroirs", "prismes"] },
};

let ambianceLayers = new Set();

/** Change le socle de couches toujours actives (voir MUSIC_AMBIANCES) — sans
 * effet sur les couches actuellement débloquées par le niveau en cours tant
 * que resetLayers() n'a pas tourné (prochain niveau/chargement), pour ne
 * jamais couper une couche EN PLEIN NIVEAU juste parce que le joueur change
 * d'ambiance dans Options entre deux niveaux. */
export function setMusicAmbiance(key) {
  ambianceLayers = new Set(MUSIC_AMBIANCES[key]?.layers ?? []);
}

function ensureBuilt() {
  if (players) return;
  players = {};
  gains = {};
  const urls = currentLayerUrls();
  for (const key of Object.keys(urls)) {
    // échec.wav se branche directement sur musicBus (jamais étouffée, voir
    // duckFilter ci-dessus) — base + toutes les couches mécaniques passent
    // par le passe-bas partagé, neutre hors état d'échec.
    const gain = new Tone.Gain(key === "base" ? 1 : 0).connect(key === "echec" ? musicBus : duckFilter);
    const player = new Tone.Player({ url: urls[key], loop: true }).connect(gain);
    players[key] = player;
    gains[key] = gain;
  }
}

/** Précharge les 7 pistes (idempotent, peut être appelé tôt — ex. au
 * chargement de la page — pour que `startMusic` n'ait plus qu'à démarrer la
 * lecture sans latence de réseau au premier clic). Ne démarre rien tant que
 * `startMusic` n'a pas été appelée. */
export function preloadMusic() {
  ensureBuilt();
  if (!loadPromise) loadPromise = Tone.loaded();
  return loadPromise;
}

/** Démarre la lecture des 7 pistes, parfaitement synchronisées (même
 * timestamp de départ pour toutes) — à appeler une seule fois, depuis un
 * geste utilisateur (voir `ensureStarted` dans sound.js: Tone.js exige un
 * clic avant de pouvoir jouer du son). Sans effet si déjà démarrée. */
export async function startMusic() {
  if (started) return;
  await preloadMusic();
  started = true;
  const when = Tone.now() + 0.05; // léger différé: laisse le temps au scheduler de tout aligner
  for (const player of Object.values(players)) player.start(when);
}

// Retour utilisateur: "on a du lag sur la musique lorsque le téléphone
// passe en veille ou lorsqu'on verrouille/change d'onglet [...] on devrait
// couper la musique lorsqu'on n'est plus focus" — puis "il faut aussi
// couper la musique lorsqu'on joue une reward ou une pub d'interstice" —
// BUG commun aux deux cas: un AudioContext qui continue de tourner pendant
// qu'on ne l'entend plus vraiment (écran verrouillé/WebView en veille, OU
// pub plein écran qui masque le jeu — voir ads.js) n'est plus servi en
// temps réel par le système ; à la reprise, les 11 lecteurs (bouclés en
// continu depuis startMusic, jamais arrêtés jusqu'ici) se retrouvent avec
// du retard accumulé et/ou désynchronisés entre eux, d'où le lag perçu au
// retour. Plutôt que de tenter de "rattraper" ce décalage, on ARRÊTE
// purement les 11 lecteurs le temps de la pause et on les REDÉMARRE tous
// ensemble au retour — exactement le même geste que startMusic ci-dessus
// (même timestamp pour tous), ce qui les remet en phase à zéro plutôt que
// de risquer un décalage cumulé. Les gains (couches débloquées, ambiance,
// état d'échec en cours) ne sont PAS touchés : seule la lecture est
// coupée/reprise, le mix reprend exactement où il en était.
//
// Plusieurs RAISONS de pause peuvent se chevaucher (ex: en théorie, une pub
// qui se déclenche pile au moment où l'app passe en arrière-plan) — un
// ensemble de raisons actives (comme `failureCount` plus haut, qui gère la
// même situation pour l'état d'échec) plutôt qu'un simple booléen: on ne
// redémarre la lecture que lorsque la DERNIÈRE raison active disparaît,
// jamais tant qu'il en reste une autre en cours.
const pauseReasons = new Set();

function stopAllPlayers() {
  if (!players) return;
  for (const player of Object.values(players)) {
    try {
      player.stop();
    } catch {
      // Déjà arrêté (ex: jamais démarré, ou double événement) — sans effet.
    }
  }
}

function restartAllPlayers() {
  if (!players) return;
  const when = Tone.now() + 0.05;
  for (const player of Object.values(players)) {
    try {
      player.start(when);
    } catch {
      // Déjà démarré (ex: double événement) — sans effet.
    }
  }
}

/** Ajoute `reason` à l'ensemble des raisons actives de mise en pause — arrête
 * la lecture si c'est la première raison active (no-op sinon, une pause déjà
 * en cours ne se relance pas). Sans effet tant que le joueur n'a pas encore
 * posé son premier clic (voir `started` — Tone.js exige un geste utilisateur
 * avant de pouvoir jouer le moindre son, donc `players` peut exister sans
 * qu'aucune lecture n'ait jamais commencé). `reason` est une chaîne libre
 * (ex: "visibility", "ad") — voir resumeMusic ci-dessous, qui doit être
 * appelée avec la MÊME chaîne pour lever cette raison précise. */
export function pauseMusic(reason) {
  if (!started) return;
  const wasEmpty = pauseReasons.size === 0;
  pauseReasons.add(reason);
  if (wasEmpty) stopAllPlayers();
}

/** Retire `reason` de l'ensemble des raisons actives — ne redémarre la
 * lecture que si c'était la DERNIÈRE raison encore active (no-op sinon: une
 * autre pause, ex. l'app toujours en arrière-plan, reste en cours). */
export function resumeMusic(reason) {
  if (!started) return;
  if (!pauseReasons.has(reason)) return;
  pauseReasons.delete(reason);
  if (pauseReasons.size === 0) restartAllPlayers();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseMusic("visibility");
    else resumeMusic("visibility");
  });
}

/** Recharge les 11 pistes sur le jeu d'URLs correspondant au thème ACTUEL
 * (voir currentLayerUrls) — à appeler quand le thème PixelArt est
 * togglé en cours de session (voir main.js: btnPixelartToggle.onclick),
 * puisque `ensureBuilt` ci-dessus n'est exécutée qu'une seule fois et ne
 * relit donc jamais le thème après coup. Sans effet si la musique n'a
 * jamais été construite (le prochain `ensureBuilt` prendra le bon thème
 * directement, rien à rattraper). Les gains (couches débloquées, ambiance,
 * état d'échec) sont préservés tels quels — seul le CONTENU audio change,
 * pas le mix en cours. */
export async function refreshMusicTheme() {
  if (!players) return;
  const urls = currentLayerUrls();
  const wasStarted = started;
  if (wasStarted) {
    for (const player of Object.values(players)) player.stop();
  }
  await Promise.all(Object.keys(urls).map((key) => players[key].load(urls[key])));
  if (wasStarted) {
    const when = Tone.now() + 0.05;
    for (const player of Object.values(players)) player.start(when);
  }
}

/** À appeler au chargement d'un nouveau niveau: remet toutes les couches
 * mécaniques et la couche échec au silence (la base continue de jouer sans
 * interruption) — le déblocage reflète la progression du niveau EN COURS,
 * pas un cumul entre niveaux. Ne touche pas à la lecture elle-même (aucun
 * redémarrage, donc aucun risque de désynchronisation). */
export function resetLayers() {
  // Voir MUSIC_AMBIANCES: le socle d'ambiance (boutique Secrets) reste
  // démuté même au reset — seules les couches HORS ambiance retombent à 0.
  unlocked = new Set(ambianceLayers);
  failureCount = 0;
  if (!gains) return;
  gains.base.gain.rampTo(1, FADE); // garde-fou: au cas où un niveau se termine en pleine erreur
  for (const key of MECHANIC_LAYERS) {
    gains[key].gain.rampTo(ambianceLayers.has(key) ? (LAYER_ACTIVE_GAIN[key] ?? 1) : 0, FADE);
  }
  gains.echec.gain.rampTo(0, FADE);
  duckFilter.frequency.rampTo(NORMAL_CUTOFF_HZ, FADE); // même garde-fou pour l'étouffement
}

/** Démute OU remute une couche mécanique selon `active` (no-op si déjà dans
 * cet état — évite de relancer une rampe déjà en cours à chaque frame,
 * `applyMechanicCounts` ci-dessous appelle cette fonction en continu). Si
 * une erreur est en cours (voir enterFailure), `unlocked` est quand même
 * tenu à jour mais le gain ne bouge pas avant la résolution de l'erreur
 * (voir exitFailure) — cohérent avec "toutes les pistes étouffées derrière
 * échec.wav" pendant une erreur (voir enterFailure). */
function setLayerActive(key, active) {
  if (!MECHANIC_LAYERS.includes(key)) return;
  if (!active && ambianceLayers.has(key)) return; // socle d'ambiance: jamais re-coupée par la logique de jeu
  const wasActive = unlocked.has(key);
  if (wasActive === active) return;
  if (active) unlocked.add(key);
  else unlocked.delete(key);
  if (!gains || failureCount > 0) return;
  gains[key].gain.rampTo(active ? (LAYER_ACTIVE_GAIN[key] ?? 1) : 0, LAYER_FADE);
}

/** Point d'entrée unique pour la musique par calques côté logique de jeu —
 * voir render.js: `mechanicCounts`, appelé une fois par frame avec l'état
 * COURANT (pas un événement ponctuel). Chaque couche de MECHANIC_THRESHOLDS
 * est comparée à son palier et démutée/remutée en conséquence : une couche
 * peut donc aussi bien apparaître que disparaître si le compte redescend
 * (retour utilisateur — un palier qui peut se franchir doit pouvoir se
 * défranchir). */
export function applyMechanicCounts(counts) {
  for (const [key, { count, min }] of Object.entries(MECHANIC_THRESHOLDS)) {
    setLayerActive(key, (counts[count] || 0) >= min);
  }
}

/** Synapse rompue ou neurone en surcharge: ÉTOUFFE tout (base comprise —
 * voir FAILURE_MUFFLE_GAIN/duckFilter en tête de fichier) au lieu de couper,
 * pour que la musique en cours paraisse s'éloigner plutôt que disparaître,
 * et joue la piste d'échec (non filtrée) en boucle par-dessus. Un compteur
 * (pas un booléen) car plusieurs erreurs peuvent être actives en même temps
 * — seule la PREMIÈRE fait vraiment quelque chose. */
export function enterFailure() {
  failureCount++;
  if (failureCount !== 1 || !gains) return;
  gains.base.gain.rampTo(FAILURE_MUFFLE_GAIN, FADE);
  for (const key of unlocked) gains[key].gain.rampTo(FAILURE_MUFFLE_GAIN, FADE);
  duckFilter.frequency.rampTo(FAILURE_MUFFLE_CUTOFF_HZ, FADE);
  gains.echec.gain.rampTo(1, FADE);
}

/** Vrai tant qu'au moins une synapse est rompue ou qu'un neurone est en
 * surcharge (voir enterFailure/exitFailure) — consommé par sound.js pour
 * assombrir le son de pose pendant que la musique d'échec joue, sans que
 * sound.js ait besoin de dupliquer sa propre logique de comptage. */
export function isFailureActive() {
  return failureCount > 0;
}

/** Résolution d'UNE erreur — restaure l'état normal (base + couches
 * débloquées) seulement si c'était la DERNIÈRE erreur encore active. */
export function exitFailure() {
  if (failureCount === 0) return; // garde-fou défensif
  failureCount--;
  if (failureCount !== 0 || !gains) return;
  gains.echec.gain.rampTo(0, FADE);
  duckFilter.frequency.rampTo(NORMAL_CUTOFF_HZ, FADE);
  gains.base.gain.rampTo(1, FADE);
  for (const key of unlocked) gains[key].gain.rampTo(LAYER_ACTIVE_GAIN[key] ?? 1, FADE);
}
