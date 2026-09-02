// Ambiance sonore minimale, entièrement synthétisée (pas de fichiers audio).
// Sons doux et spatiaux (onde/reverb) plutôt que secs et percussifs, pour
// rester cohérent avec le thème cérébral/neuronal du jeu.
import * as Tone from "tone";
import { isFailureActive } from "./music.js";

// Multiplicateur d'amplitude (paramètre `velocity` de Tone.Synth, 1 =
// niveau normal) appliqué aux SFX d'action qui mènent à une erreur — retour
// utilisateur: "on les entend trop peu", +20% linéaire. Appliqué via
// `velocity` plutôt qu'en remontant le `.volume` (en dB) des synths
// partagés (`soft`/`tone`), qui servent aussi à d'autres sons (ex.
// playTargetLost, playChargeEmptied) qui ne doivent PAS être affectés.
const ERROR_SFX_VELOCITY = 1.2;

// Note de pose = extraite de la VRAIE mélodie de neurone-couleur.wav
// (analyse spectrale du fichier, voir music-demos/couches/notes-couches.md
// pour le contexte général) plutôt qu'un tirage uniforme dans MUSIC_SCALE
// comme avant — retour utilisateur: la pose doit "citer" la mélodie du jeu.
// La piste est structurée en 3 blocs de 8s (phrase A-B-A', voir notes-
// couches.md) ; chaque bloc est décomposé ci-dessous en sa propre suite de
// notes JOUÉES DANS L'ORDRE. Bloc A (0-8s): E5 puis C5 puis A4 (résolution
// sur la tonique). Bloc B (8-16s): E5, G4, E5 (seul bloc qui ne redescend
// pas sur A4, cohérent avec son rôle de contraste). Bloc A' (16-24s):
// C5, E5, A4 (variante du bloc A, même note de résolution finale).
const MELODY_BLOCKS = [
  ["E5", "C5", "A4"],
  ["E5", "G4", "E5"],
  ["C5", "E5", "A4"],
];

// État de la suite en cours: `currentBlock` est l'un des tableaux ci-dessus
// (référence directe, pas une copie), `posInBlock` l'index de la PROCHAINE
// note à jouer dedans. Tant que la suite n'est pas épuisée, on avance
// simplement dedans à chaque pose ; une fois épuisée, on retire un nouveau
// bloc au hasard parmi les 3 (répétition du même bloc possible, voir retour
// utilisateur) et on repart de son index 0.
let currentBlock = null;
let posInBlock = 0;

function nextPlacementNote() {
  if (!currentBlock || posInBlock >= currentBlock.length) {
    currentBlock = MELODY_BLOCKS[Math.floor(Math.random() * MELODY_BLOCKS.length)];
    posInBlock = 0;
  }
  return currentBlock[posInBlock++];
}

let started = false;
async function ensureStarted() {
  if (!started) {
    await Tone.start();
    started = true;
  }
}

/**
 * Volume général (0 à 1, linéaire) appliqué sur la sortie finale de Tone —
 * en amont de tous les synths/bus ci-dessous, donc affecte tous les sons
 * uniformément sans toucher à leurs volumes individuels respectifs.
 */
export function setMasterVolume(level) {
  const clamped = Math.max(0, Math.min(1, level));
  Tone.getDestination().volume.value = clamped <= 0 ? -Infinity : Tone.gainToDb(clamped);
}

// Retour utilisateur: "je me demande si c'est pas dû aussi aux enceintes du
// téléphone [...] des sonorités peut-être délicates pour ce type
// d'enceinte" — hypothèse tout à fait plausible et complémentaire au
// correctif de contexte audio (voir music.js): un haut-parleur de
// téléphone est minuscule, mono, avec un débattement mécanique très
// limité — il ne reproduit PAS proprement les fréquences graves (en
// dessous d'environ 150-200Hz selon les modèles), et une tentative de le
// faire produit typiquement un bourdonnement/grésillement PHYSIQUE (le
// haut-parleur qui "crache"), distinct d'un décrochage logiciel. Filtre
// passe-haut partagé, posé en tout dernier sur le bus commun (après reverb,
// juste avant la sortie) — coupe en douceur ce grave que ces enceintes ne
// peuvent de toute façon pas rendre proprement, pratique standard de
// mixage "mobile-safe". Affecte tout ce qui sort de ce fichier (synths de
// jeu ET la reverb qui les prolonge).
const speakerSafeHighpass = new Tone.Filter(160, "highpass").toDestination();

// Bus commun : un peu de reverb + un léger delay pour une sensation
// d'espace/onde, plutôt qu'un son sec qui claque.
// Retour utilisateur (grésillement mobile — voir aussi music.js: le
// changement de contexte audio en latence "playback", correctif principal):
// Tone.Reverb est une convolution, le calcul DSP continu le plus coûteux de
// ce fichier — son coût croît avec `decay` (la queue de réverbération
// traitée en continu tant qu'elle n'est pas éteinte). 4.5s ramené à 2.5s:
// toujours "un peu de reverb" perceptible, mais une queue nettement plus
// courte à calculer en continu, pour laisser plus de marge au CPU mobile.
const reverb = new Tone.Reverb({ decay: 2.5, wet: 0.4 }).connect(speakerSafeHighpass);
const delay = new Tone.FeedbackDelay({ delayTime: 0.3, feedback: 0.22, wet: 0.16 }).connect(reverb);

const tone = new Tone.Synth({
  oscillator: { type: "sine" },
  envelope: { attack: 0.04, decay: 0.5, sustain: 0.05, release: 0.8 },
  volume: -10,
}).connect(delay);

const soft = new Tone.Synth({
  oscillator: { type: "triangle" },
  envelope: { attack: 0.03, decay: 0.35, sustain: 0, release: 0.5 },
  volume: -16,
}).connect(delay);

// Le son de réussite (playWin ci-dessous) est baissé de 30% en amplitude
// perçue: -30% linéaire = 20*log10(0.7) ≈ -3.1 dB, appliqué directement sur
// le volume de base de ces synths (utilisés uniquement par playWin, donc
// sans effet sur les autres sons).
const WIN_VOLUME_TRIM_DB = -3.1;

// playWin alterne entre DEUX habillages à chaque victoire (retour
// utilisateur: un peu de variété) — tous deux recomposés dans la gamme
// pentatonique de La (A-C-D-E-G) qui sert de centre tonal à TOUTE la
// musique du jeu (voir music.js/music-demos/couches/notes-couches.md);
// les accords en do/ré majeur de la version d'origine juraient avec elle.

// Version A ("quintes qui s'ouvrent"): deux accords en quintes ouvertes
// (pas de tierce qui trancherait majeur/mineur) + un point d'orgue aigu.
const padWinA = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: "sine" },
  envelope: { attack: 0.5, decay: 0.6, sustain: 0.52, release: 1.2 },
  volume: -12 + WIN_VOLUME_TRIM_DB,
}).connect(reverb);

const shimmerWinA = new Tone.Synth({
  oscillator: { type: "sine" },
  envelope: { attack: 0.25, decay: 0.5, sustain: 0.15, release: 1.2 },
  volume: -18 + WIN_VOLUME_TRIM_DB,
}).connect(reverb);

// Version C ("quinte ouverte + brillance"): même langage que la nappe de
// fond de music.js (quinte ouverte A2+E3 dans base.wav) + deux notes de
// brillance qui arrivent au sommet.
const padWinC = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: "sine" },
  envelope: { attack: 0.6, decay: 0.65, sustain: 0.48, release: 1.15 },
  volume: -12 + WIN_VOLUME_TRIM_DB,
}).connect(reverb);

const sparkWinC = new Tone.Synth({
  oscillator: { type: "sine" },
  envelope: { attack: 0.02, decay: 0.35, sustain: 0.15, release: 0.5 },
  volume: -17 + WIN_VOLUME_TRIM_DB,
}).connect(reverb);

// Petits accusés de réception pour les objectifs (cible atteinte/perdue,
// synapse rompue/rétablie, charge pleine/vidée/en surcharge) : courts,
// toujours doux, jamais percussifs.
const chime = new Tone.Synth({
  oscillator: { type: "sine" },
  envelope: { attack: 0.015, decay: 0.35, sustain: 0.05, release: 1.1 },
  volume: -13,
}).connect(reverb);

// Timbre dédié au son de pose pendant l'état d'échec (synapse rompue ou
// neurone en surcharge, voir music.js: isFailureActive/enterFailure) — un
// intervalle dissonant (tritone) en registre grave, sur une onde en dents de
// scie (plus "sombre"/rugueuse que le sinus utilisé pour la pose normale)
// pour signaler que quelque chose ne va pas SANS sonner comme playError
// (une seule note, timbre/registre différents) : la pose n'est pas elle-même
// une erreur, elle se contente d'être teintée par l'état d'échec en cours.
const darkPlaceLow = new Tone.Synth({
  oscillator: { type: "sawtooth" },
  envelope: { attack: 0.015, decay: 0.3, sustain: 0, release: 0.4 },
  volume: -14,
}).connect(delay);

const darkPlaceHigh = new Tone.Synth({
  oscillator: { type: "sawtooth" },
  envelope: { attack: 0.015, decay: 0.3, sustain: 0, release: 0.4 },
  volume: -16,
}).connect(delay);

export async function playPlace() {
  await ensureStarted();
  if (isFailureActive()) {
    // Hauteur FIXE (aucune variation de note tant que l'échec dure) — voir
    // nextPlacementNote() plus bas, qu'on n'appelle PAS ici: currentBlock/
    // posInBlock restent inchangés, donc la suite normale reprend
    // exactement où elle en était une fois l'échec résolu.
    // Retour utilisateur (enceintes téléphone): G2 (~98Hz) tombait sous le
    // passe-haut "mobile-safe" ajouté ci-dessus (speakerSafeHighpass) et se
    // serait retrouvé étouffé/absent sur un haut-parleur de téléphone.
    // Remonté d'une octave (G3/C#4) : garde le même intervalle dissonant
    // (tritone) et le même caractère "grave/sombre" RELATIF au reste de la
    // palette, tout en restant au-dessus du filtre — donc audible et
    // propre plutôt que filtré ou source de bourdonnement.
    const now = Tone.now();
    darkPlaceLow.triggerAttackRelease("G3", "8n", now);
    darkPlaceHigh.triggerAttackRelease("C#4", "8n", now);
    return;
  }
  // Voir nextPlacementNote() plus haut: avance dans la suite de notes du
  // bloc de mélodie en cours (neurone-couleur.wav), retire un nouveau bloc
  // au hasard une fois la suite épuisée.
  tone.triggerAttackRelease(nextPlacementNote(), "8n");
}

export async function playRemove() {
  await ensureStarted();
  tone.triggerAttackRelease("C4", "8n");
}

export async function playError() {
  await ensureStarted();
  soft.triggerAttackRelease("F#3", "16n", Tone.now(), ERROR_SFX_VELOCITY);
}

// Montée ambiante, plus proche d'une onde qui se déploie que d'une fanfare —
// alterne à chaque victoire entre les versions A et C ci-dessus (un peu de
// variété), toutes deux dans la gamme pentatonique de La.
let winVariantIsA = false; // premier appel bascule à true -> A joue en premier

export async function playWin() {
  await ensureStarted();
  const now = Tone.now();
  winVariantIsA = !winVariantIsA;
  if (winVariantIsA) {
    padWinA.triggerAttackRelease(["A3", "E4", "A4"], "4n", now);
    padWinA.triggerAttackRelease(["D4", "A4", "D5"], "2n", now + 0.55);
    shimmerWinA.triggerAttackRelease("E6", "2n", now + 0.25);
  } else {
    padWinC.triggerAttackRelease(["A3", "E4"], "2n", now);
    padWinC.triggerAttackRelease(["A4", "D5"], "2n", now + 0.5);
    sparkWinC.triggerAttackRelease("G5", "8n", now + 0.9);
    sparkWinC.triggerAttackRelease("A5", "4n", now + 1.15);
  }
}

// --- Objectifs: case-cible ---------------------------------------------

export async function playTargetSuccess() {
  await ensureStarted();
  const now = Tone.now();
  chime.triggerAttackRelease("E5", "16n", now);
  chime.triggerAttackRelease("A5", "8n", now + 0.09);
}

export async function playTargetLost() {
  await ensureStarted();
  const now = Tone.now();
  soft.triggerAttackRelease("A4", "16n", now);
  soft.triggerAttackRelease("E4", "8n", now + 0.08);
}

// --- Objectifs: synapse --------------------------------------------------

export async function playSynapseBreak() {
  await ensureStarted();
  const now = Tone.now();
  soft.triggerAttackRelease("D3", "16n", now, ERROR_SFX_VELOCITY);
  soft.triggerAttackRelease("C3", "8n", now + 0.05, ERROR_SFX_VELOCITY);
}

export async function playSynapseRestore() {
  await ensureStarted();
  tone.triggerAttackRelease("G4", "8n");
}

// --- Objectifs: case à charge ---------------------------------------------

export async function playChargeFull() {
  await ensureStarted();
  chime.triggerAttackRelease("F#4", "8n");
}

export async function playChargeEmptied() {
  await ensureStarted();
  soft.triggerAttackRelease("D4", "16n");
}

export async function playChargeOverload() {
  await ensureStarted();
  const now = Tone.now();
  soft.triggerAttackRelease("F3", "16n", now, ERROR_SFX_VELOCITY);
  tone.triggerAttackRelease("F#3", "16n", now + 0.02, ERROR_SFX_VELOCITY);
}

// --- Sommation (mode bonus): génération de lumière ------------------------
// Son dédié, volontairement TRÈS court et étouffé (filtre passe-bas + volume
// bas) car cette action peut être spammée (bouton "Générer" dans
// sommation.js) — contrairement aux autres sons de ce fichier, réutilisés
// tels quels de façon symbolique par Sommation pour rappeler le jeu de base,
// celui-ci est neuf pour ne pas fatiguer l'oreille en rafale.
const sommationGenerateFilter = new Tone.Filter({ frequency: 900, type: "lowpass" }).connect(delay);
const sommationGenerateSynth = new Tone.Synth({
  oscillator: { type: "sine" },
  envelope: { attack: 0.004, decay: 0.08, sustain: 0, release: 0.08 },
  volume: -24,
}).connect(sommationGenerateFilter);

export async function playGenerate() {
  await ensureStarted();
  sommationGenerateSynth.triggerAttackRelease("C5", "32n");
}
