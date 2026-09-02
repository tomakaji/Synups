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
// MOTEUR: Howler.js, pas Tone.js (voir git log pour l'historique complet du
// grésillement). Après plusieurs rounds de corrections ciblées (latence,
// filtres, gain staging, limiteur, compresseur, puis correction DSP de
// plusieurs fichiers wav eux-mêmes — phase inversée, grave extrême), le
// grésillement persistait toujours en usage prolongé sur mobile. Recherche:
// plusieurs issues GitHub OUVERTES sur Tone.js décrivent EXACTEMENT ce
// symptôme (grésillement qui grandit avec le temps, plusieurs Tone.Player
// simultanés sur mobile — ex. #953, #758, #285) comme une limite connue de
// la librairie, pas un défaut de ce mix précis. Howler.js est le choix
// communautaire standard pour de la lecture de fichiers pré-rendus en boucle
// (exactement notre cas ici — Tone.js reste plus adapté à de la synthèse
// live/réactive, voir sound.js qui l'utilise encore pour ses synthés SFX).
//
// Toutes les pistes sont des fichiers WAV bouclables SANS perte (voir
// public/music/ — durée exacte 24.000000s à 44.1kHz, aucun padding
// d'encodeur contrairement à un mp3/ogg compressé, ce qui garantirait un
// clic au raccord de boucle) démarrées TOUTES EN MÊME TEMPS dès le premier
// clic (voir startMusic) puis JAMAIS arrêtées/redémarrées ensuite — on ne
// fait que faire monter/descendre leur gain individuel. C'est ce qui
// garantit qu'elles restent en phase indéfiniment (chaque piste boucle sur
// son propre buffer, en pause/reprise SIMULTANÉE avec les autres via
// pauseMusic/resumeMusic ci-dessous — jamais arrêtée puis redémarrée à un
// timestamp recalculé comme au temps de Tone.js, Howler gère nativement la
// pause "en place").
import { Howl, Howler } from "howler";
import { isPixelTheme } from "./pixelIcons.js";

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

// Gain cible (au lieu de 1) quand une couche est débloquée — toutes les
// couches non listées restent à 1 (aucun effet, valeur par défaut ci-dessous).
// Retour utilisateur (grésillement/saturation): "les deux pistes des
// neurones colorés saturent, surtout la deuxième [...] elles sont plutôt
// fortes de toute façon" — neuroneCouleur/neuroneCouleurLayer2 sont deux
// pistes DÉJÀ fortes qui peuvent aussi jouer EN MÊME TEMPS que "neurone"/
// "neuroneLayer2" (les paliers de déblocage ne s'excluent pas, voir
// MECHANIC_THRESHOLDS) — leur somme dépassait visiblement 0dB en sortie,
// d'où la saturation. Layer2 baissée plus fort que la couche 1 (rapportée
// comme la plus touchée). prismes/pyra également baissées un cran, plus
// légèrement (pas rapportées comme saturées, juste "un peu" en trop).
// Retour utilisateur (round "neurone sans couleur, 1ère couche, son
// grave qui rebondit et grésille"): `neurone` était montée à +10% à
// l'origine parce que neurone.wav semblait faible — en réalité le fichier
// avait deux défauts qui MASQUAIENT son vrai niveau perçu plutôt que d'en
// justifier le gain: ses deux canaux étaient quasi en opposition de phase
// (L ≈ -R, annulation partielle et irrégulière une fois sommé en mono —
// exactement ce qui produisait le "rebond" instable signalé, un
// haut-parleur de téléphone étant mono) et 91% de son énergie vivait sous
// 100Hz, une zone qu'un tel haut-parleur ne peut de toute façon pas
// reproduire proprement. Le fichier a été corrigé à la source (phase
// réalignée, grave profond remplacé par ses harmoniques — même technique
// qu'un exciter de basse, garde le côté "rebondissant" en le déplaçant
// dans une zone audible/propre, voir l'historique de neurone.wav) : son
// niveau perçu réel remonte de lui-même, plus besoin du boost de +10%.
const LAYER_ACTIVE_GAIN = {
  neuroneCouleur: 0.7,
  neuroneCouleurLayer2: 0.5,
  prismes: 0.8,
  pyra: 0.8,
};

const FADE_MS = 350; // montée/descente de gain par calque — évite tout clic

// Fondu utilisé spécifiquement pour l'apparition/disparition d'une couche
// MÉCANIQUE (setLayerActive, palier franchi/défranchi en cours de partie —
// retour utilisateur: le fondu de 0.35s ci-dessus donnait une impression de
// bascule "brutale" pour ce cas précis). Volontairement PAS utilisé pour
// l'état d'échec (enterFailure/exitFailure) ni resetLayers: la musique
// d'erreur doit au contraire apparaître/disparaître de façon nette et
// immédiate — c'est le signal d'alarme, il doit rester FADE_MS.
const LAYER_FADE_MS = 1100;

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

// --- Chaîne de sortie Web Audio native, posée directement sur le contexte
// interne de Howler (Howler.ctx — un AudioContext SÉPARÉ de celui de
// Tone.js utilisé par sound.js pour ses synthés SFX ; les deux librairies ne
// partagent pas de contexte, essayer de les faire cohabiter sur un seul
// AudioContext est fragile — voir recherche). Chaque librairie a donc
// désormais sa PROPRE chaîne de sécurité anti-clipping/mobile-safe
// (compresseur + limiteur), voir audioBus.js pour l'équivalent côté Tone.js.
//
// Point d'accroche: `Howler.masterGain`, un GainNode que Howler crée une
// fois en interne et connecte par défaut à `Howler.ctx.destination` (voir
// node_modules/howler/dist/howler.js — vérifié directement dans la source,
// c'est le point d'extension documenté par la communauté pour insérer du
// traitement Web Audio personnalisé). On le déconnecte de la destination
// d'origine et on le reconnecte à travers notre propre chaîne.
const ctx = Howler.ctx;

function rampParam(param, target, seconds) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + seconds);
}

// Passe-bas PARTAGÉ pour base + couches mécaniques uniquement — échec.wav
// (voir ensureBuilt) NE PASSE PAS par ce filtre: elle doit rester pleinement
// claire/nette pendant que le reste s'étouffe derrière elle. Cutoff au repos
// à NORMAL_CUTOFF_HZ (inaudible, filtre neutre) — voir enterFailure/
// exitFailure pour la rampe vers/depuis FAILURE_MUFFLE_CUTOFF_HZ.
const duckFilter = ctx.createBiquadFilter();
duckFilter.type = "lowpass";
duckFilter.frequency.value = NORMAL_CUTOFF_HZ;
duckFilter.connect(Howler.masterGain);

// Retour utilisateur: "je me demande si c'est pas dû aussi aux enceintes du
// téléphone [...] des sonorités peut-être délicates pour ce type
// d'enceinte" — même filtre "mobile-safe" que sound.js (voir son
// commentaire pour le détail): un haut-parleur de téléphone (minuscule,
// mono, débattement mécanique limité) reproduit mal, voire fait bourdonner,
// tout ce qui descend sous ~150-200Hz. Coupure remontée de 160 à 200Hz au
// round "plus radical" (retour utilisateur: le grésillement persistait
// malgré tout ce qui précède) — on sacrifie un peu plus de grave (déjà peu
// présent/peu utile sur ce type d'enceinte) pour une marge de sécurité plus
// large contre le bourdonnement.
const speakerSafeHighpass = ctx.createBiquadFilter();
speakerSafeHighpass.type = "highpass";
speakerSafeHighpass.frequency.value = 200;

// Compresseur PROACTIF avant le limiteur (round "plus radical" — un
// limiteur seul ne fait qu'écrêter au dernier moment, ce qui peut encore
// sonner dur/grésillant quand plusieurs couches culminent en même temps ;
// un compresseur en amont réduit la dynamique en douceur AVANT d'atteindre
// ce point, voir audioBus.js pour le même raisonnement côté Tone.js).
const compressor = ctx.createDynamicsCompressor();
compressor.threshold.value = -24;
compressor.ratio.value = 4;
compressor.attack.value = 0.003;
compressor.release.value = 0.25;
compressor.knee.value = 12;

// Limiteur final anti-clipping — DynamicsCompressorNode natif avec un ratio
// élevé (20, le max natif) approxime un limiteur, exactement comme
// Tone.Limiter est lui-même construit sur un Compressor agressif.
const limiter = ctx.createDynamicsCompressor();
limiter.threshold.value = -1;
limiter.ratio.value = 20;
limiter.attack.value = 0.001;
limiter.release.value = 0.05;
limiter.knee.value = 0;

Howler.masterGain.disconnect();
Howler.masterGain.connect(speakerSafeHighpass);
speakerSafeHighpass.connect(compressor);
compressor.connect(limiter);
limiter.connect(ctx.destination);

/** Volume musique (0 à 1, linéaire) — bus SÉPARÉ de setMasterVolume dans
 * sound.js (qui reste le volume des effets de jeu: pose/retrait/victoire/
 * cibles/synapses/charges). Les deux curseurs sont donc indépendants.
 * Howler.volume() est le volume GLOBAL de la librairie (agit sur
 * Howler.masterGain lui-même) — compatible avec la chaîne personnalisée
 * ci-dessus puisque celle-ci se branche EN AVAL de masterGain. */
export function setMusicVolume(level) {
  const clamped = Math.max(0, Math.min(1, level));
  Howler.volume(clamped);
}

let howls = null; // { key -> Howl }
let unlocked = new Set(); // sous-ensemble courant de MECHANIC_LAYERS démuté
let failureCount = 0; // compteur (pas booléen): plusieurs synapses/surcharges possibles à la fois
let started = false;

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

// Reroute UNE piste pour qu'elle passe par `duckFilter` avant `masterGain`
// au lieu du routage par défaut de Howler (_node -> masterGain direct).
// échec.wav ne passe JAMAIS par ici (voir ensureBuilt) — elle garde le
// routage par défaut, pour rester pleinement claire/nette pendant que le
// reste s'étouffe derrière elle en cas d'erreur (voir enterFailure).
// `_sounds[0]._node` (un GainNode par piste, propriété interne mais stable
// et documentée par la communauté Howler — voir howler-plugin-effect-chain)
// est créé de façon SYNCHRONE dès `new Howl(...)`, avant même que le buffer
// soit décodé (vérifié directement dans howler.js: Sound.prototype.create,
// appelé depuis Howl.init) — donc déjà disponible juste après construction,
// pas besoin d'attendre l'événement 'load'.
function rerouteThroughDuckFilter(howl) {
  const sound = howl._sounds && howl._sounds[0];
  if (sound && sound._node) {
    sound._node.disconnect();
    sound._node.connect(duckFilter);
  }
}

function ensureBuilt() {
  if (howls) return;
  howls = {};
  const urls = currentLayerUrls();
  for (const key of Object.keys(urls)) {
    const howl = new Howl({
      src: [urls[key]],
      loop: true,
      volume: key === "base" ? 1 : 0,
      html5: false, // Web Audio (pas <audio> HTML5) — nécessaire pour le routage manuel ci-dessous
      preload: true,
    });
    // échec.wav se branche directement sur masterGain (jamais étouffée, voir
    // duckFilter ci-dessus) — base + toutes les couches mécaniques passent
    // par le passe-bas partagé, neutre hors état d'échec.
    if (key !== "echec") rerouteThroughDuckFilter(howl);
    howls[key] = howl;
  }
}

/** Ramène en douceur le gain d'une piste vers `target` (0 à 1) en `ms`
 * millisecondes, comme `Tone.Param.rampTo` — contrairement à `Tone`, la
 * méthode `Howl.fade()` NE PART PAS automatiquement de la valeur actuelle:
 * elle saute D'ABORD instantanément à la valeur `from` fournie, puis rampe
 * vers `to` (vérifié directement dans howler.js: `fade()` appelle
 * `self.volume(from, id)` avant de lancer la rampe). Il faut donc toujours
 * lire la valeur RÉELLE courante avant d'appeler `.fade()`, sous peine de
 * saut audible. `Howl.volume()` reste fiable même EN PLEIN FONDU: Howler met
 * à jour `sound._volume` à intervalles réguliers pendant la rampe (voir
 * `_startFadeInterval`), ce n'est pas juste la valeur de départ ou d'arrivée. */
function fadeLayer(key, target, ms) {
  const howl = howls && howls[key];
  if (!howl) return;
  const current = howl.volume();
  if (Math.abs(current - target) < 0.001) return; // évite un fade(0) qui ne fait rien mais spamme un timer
  howl.fade(current, target, Math.max(1, ms));
}

/** Précharge les 11 pistes (idempotent, peut être appelé tôt — ex. au
 * chargement de la page — pour que `startMusic` n'ait plus qu'à démarrer la
 * lecture sans latence de réseau au premier clic). Ne démarre rien tant que
 * `startMusic` n'a pas été appelée. Howler met en file d'attente les appels
 * `.play()` faits avant la fin du chargement (voir startMusic) — cette
 * fonction n'est donc pas strictement nécessaire à la lecture, mais est
 * conservée pour préchauffer le cache réseau tôt, comme avant. */
export function preloadMusic() {
  ensureBuilt();
  return Promise.all(
    Object.values(howls).map(
      (howl) =>
        new Promise((resolve) => {
          if (howl.state() === "loaded") {
            resolve();
            return;
          }
          howl.once("load", resolve);
          howl.once("loaderror", resolve); // ne bloque jamais le démarrage sur un fichier en échec
        }),
    ),
  );
}

/** Démarre la lecture des 11 pistes — à appeler une seule fois, depuis un
 * geste utilisateur (voir `ensureStarted` dans sound.js: les navigateurs
 * exigent un clic avant de pouvoir jouer du son ; Howler gère nativement le
 * déverrouillage de son AudioContext au premier geste, aucune gestion
 * manuelle nécessaire ici). Sans effet si déjà démarrée. Contrairement à
 * l'ancien moteur Tone.js, pas besoin de calculer un timestamp de départ
 * commun: les appels `.play()` synchrones ci-dessous suffisent à garder les
 * pistes en phase (Howler gère la lecture "en place" au pause/reprise, voir
 * pauseMusic/resumeMusic). */
export async function startMusic() {
  if (started) return;
  await preloadMusic();
  started = true;
  for (const howl of Object.values(howls)) howl.play();
}

// Retour utilisateur: "on a du lag sur la musique lorsque le téléphone
// passe en veille ou lorsqu'on verrouille/change d'onglet [...] on devrait
// couper la musique lorsqu'on n'est plus focus" — puis "il faut aussi
// couper la musique lorsqu'on joue une reward ou une pub d'interstice" —
// avec Howler, `.pause()`/`.play()` suspend et reprend la lecture EN PLACE
// nativement (contrairement à l'ancien moteur Tone.js qui devait tout
// arrêter puis tout redémarrer à un timestamp recalculé pour éviter un
// décalage cumulé) — plus simple et plus robuste. Les gains (couches
// débloquées, ambiance, état d'échec en cours) ne sont PAS touchés : seule
// la lecture est coupée/reprise, le mix reprend exactement où il en était.
//
// Plusieurs RAISONS de pause peuvent se chevaucher (ex: en théorie, une pub
// qui se déclenche pile au moment où l'app passe en arrière-plan) — un
// ensemble de raisons actives (comme `failureCount` plus haut, qui gère la
// même situation pour l'état d'échec) plutôt qu'un simple booléen: on ne
// redémarre la lecture que lorsque la DERNIÈRE raison active disparaît,
// jamais tant qu'il en reste une autre en cours.
const pauseReasons = new Set();

function pauseAllLayers() {
  if (!howls) return;
  for (const howl of Object.values(howls)) howl.pause();
}

function resumeAllLayers() {
  if (!howls) return;
  for (const howl of Object.values(howls)) howl.play();
}

/** Ajoute `reason` à l'ensemble des raisons actives de mise en pause — arrête
 * la lecture si c'est la première raison active (no-op sinon, une pause déjà
 * en cours ne se relance pas). Sans effet tant que le joueur n'a pas encore
 * posé son premier clic (voir `started`). `reason` est une chaîne libre
 * (ex: "visibility", "ad") — voir resumeMusic ci-dessous, qui doit être
 * appelée avec la MÊME chaîne pour lever cette raison précise. */
export function pauseMusic(reason) {
  if (!started) return;
  const wasEmpty = pauseReasons.size === 0;
  pauseReasons.add(reason);
  if (wasEmpty) pauseAllLayers();
}

/** Retire `reason` de l'ensemble des raisons actives — ne redémarre la
 * lecture que si c'était la DERNIÈRE raison encore active (no-op sinon: une
 * autre pause, ex. l'app toujours en arrière-plan, reste en cours). */
export function resumeMusic(reason) {
  if (!started) return;
  if (!pauseReasons.has(reason)) return;
  pauseReasons.delete(reason);
  if (pauseReasons.size === 0) resumeAllLayers();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseMusic("visibility");
    else resumeMusic("visibility");
  });
}

/** Recharge les 11 pistes sur le jeu d'URLs correspondant au thème ACTUEL
 * (voir currentLayerUrls) — à appeler quand le thème PixelArt est
 * togglé en cours de session (voir main.js: btnPixelartToggle.onclick).
 * Howler ne permet pas de changer la source d'un Howl déjà construit
 * (contrairement à `Tone.Player.load()`) — chaque piste est donc déchargée
 * puis reconstruite avec la nouvelle URL, en restaurant son gain courant
 * (couches débloquées, ambiance, état d'échec) pour que seul le CONTENU
 * audio change, pas le mix en cours. Sans effet si la musique n'a jamais
 * été construite (le prochain `ensureBuilt` prendra le bon thème
 * directement, rien à rattraper). */
export async function refreshMusicTheme() {
  if (!howls) return;
  const urls = currentLayerUrls();
  const wasStarted = started;
  const currentVolumes = {};
  for (const key of Object.keys(howls)) currentVolumes[key] = howls[key].volume();
  for (const howl of Object.values(howls)) howl.unload();
  howls = {};
  for (const key of Object.keys(urls)) {
    const howl = new Howl({
      src: [urls[key]],
      loop: true,
      volume: currentVolumes[key] ?? (key === "base" ? 1 : 0),
      html5: false,
      preload: true,
    });
    if (key !== "echec") rerouteThroughDuckFilter(howl);
    howls[key] = howl;
  }
  if (wasStarted) {
    await preloadMusic();
    for (const howl of Object.values(howls)) howl.play();
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
  if (!howls) return;
  fadeLayer("base", 1, FADE_MS); // garde-fou: au cas où un niveau se termine en pleine erreur
  for (const key of MECHANIC_LAYERS) {
    fadeLayer(key, ambianceLayers.has(key) ? (LAYER_ACTIVE_GAIN[key] ?? 1) : 0, FADE_MS);
  }
  fadeLayer("echec", 0, FADE_MS);
  rampParam(duckFilter.frequency, NORMAL_CUTOFF_HZ, FADE_MS / 1000); // même garde-fou pour l'étouffement
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
  if (!howls || failureCount > 0) return;
  fadeLayer(key, active ? (LAYER_ACTIVE_GAIN[key] ?? 1) : 0, LAYER_FADE_MS);
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
  if (failureCount !== 1 || !howls) return;
  fadeLayer("base", FAILURE_MUFFLE_GAIN, FADE_MS);
  for (const key of unlocked) fadeLayer(key, FAILURE_MUFFLE_GAIN, FADE_MS);
  rampParam(duckFilter.frequency, FAILURE_MUFFLE_CUTOFF_HZ, FADE_MS / 1000);
  fadeLayer("echec", 1, FADE_MS);
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
  if (failureCount !== 0 || !howls) return;
  fadeLayer("echec", 0, FADE_MS);
  rampParam(duckFilter.frequency, NORMAL_CUTOFF_HZ, FADE_MS / 1000);
  fadeLayer("base", 1, FADE_MS);
  for (const key of unlocked) fadeLayer(key, LAYER_ACTIVE_GAIN[key] ?? 1, FADE_MS);
}
