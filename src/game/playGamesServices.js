// Sauvegarde cloud de la progression via Google Play Games Services — retour
// utilisateur: "plutôt qu'utiliser firebase il faudrait plutôt utiliser la
// base de donnée utilisateurs prévue à cet effet et offerte par GooglePlay à
// travers l'auth qu'ils fournissent." Firebase (voir firebase-config.js)
// reste utilisé, mais UNIQUEMENT pour la Communauté (grilles partagées,
// anonyme) — jamais pour la progression personnelle, qui passe entièrement
// par ce module.
//
// Module isolé, même pattern que ads.js/haptics.js: tout le reste de l'app
// passe par les fonctions exportées ci-dessous, jamais un import direct du
// plugin ailleurs. Android UNIQUEMENT (voir Capacitor.getPlatform() plus
// bas) — Google Play Games Services n'a pas d'équivalent iOS ; l'équivalent
// Apple (Game Center) est une intégration entièrement séparée, non demandée
// pour l'instant (voir échange avec l'utilisateur: iOS reste en local
// uniquement pour le moment). Ne throw JAMAIS: sign-in/sauvegarde/
// restauration sont best-effort, un échec (pas connecté, réseau coupé, App
// ID placeholder non configuré — voir strings.xml: games_app_id) ne doit
// jamais empêcher de jouer.
//
// Plugin choisi: capacitor-google-game-services (scottcl88) — SEUL candidat
// trouvé qui expose une vraie API "Saved Games" (saveGame/loadGame, via les
// Snapshots de Google) plutôt que juste classements/succès, ET qui déclare
// explicitement utiliser le SDK Play Games Services v2
// (com.google.android.gms:play-services-games-v2, voir android/build.gradle
// généré par npx cap sync) — pertinent puisque Google bloque la publication
// de nouveaux jeux avec l'ancien SDK v1 depuis septembre 2025 et le
// supprimera courant 2026/2027.
import { Capacitor } from "@capacitor/core";
import { GoogleGameServices } from "capacitor-google-game-services";
import {
  loadStoryProgress,
  saveStoryProgress,
  loadPoints,
  savePoints,
  loadProfile,
  saveProfile,
} from "./storage.js";
import { exportSommationMeta, importSommationMeta } from "../sommation.js";
import { trackEvent } from "./analytics.js";

// Nom de la sauvegarde Snapshot — un seul slot, pas de multi-sauvegarde
// (retour utilisateur: la progression du joueur, pas plusieurs profils).
const SAVE_NAME = "synups-progress";
const SAVE_FORMAT_VERSION = 1;

function isAndroidNative() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

let signedIn = false;

/** État courant (synchrone, mis à jour par signIn/getStatus) — utilisé par
 * main.js pour afficher "Connecté"/"Se connecter" dans Options sans await à
 * chaque frame. */
export function isSignedIn() {
  return signedIn;
}

export function isAvailable() {
  return isAndroidNative();
}

/** Vérifie l'état de connexion SANS déclencher de popup — à appeler au
 * démarrage de l'app (voir main.js) pour savoir si un compte est déjà
 * connecté (Google peut garder la session active d'une ouverture à l'autre)
 * sans jamais solliciter le joueur silencieusement au lancement. */
export async function refreshStatus() {
  if (!isAndroidNative()) return false;
  try {
    const { isAuthenticated } = await GoogleGameServices.isAuthenticated();
    signedIn = !!isAuthenticated;
    return signedIn;
  } catch {
    signedIn = false;
    return false;
  }
}

/** Déclenche l'écran de connexion Google Play Games — TOUJOURS à l'initiative
 * d'un geste explicite du joueur (bouton "Se connecter" dans Options, voir
 * main.js), jamais appelée automatiquement au chargement (retour utilisateur
 * implicite: une connexion de compte reste un choix du joueur). */
export async function signIn() {
  if (!isAndroidNative()) return { isAuthenticated: false, reason: "unavailable" };
  try {
    const { isAuthenticated } = await GoogleGameServices.signIn();
    signedIn = !!isAuthenticated;
    trackEvent("playgames_sign_in", { success: signedIn });
    return { isAuthenticated: signedIn, reason: signedIn ? null : "declined" };
  } catch {
    signedIn = false;
    trackEvent("playgames_sign_in", { success: false });
    return { isAuthenticated: false, reason: "error" };
  }
}

/** Rassemble tout ce qui compte comme "progression du joueur" — story
 * (niveaux Histoire terminés), points (mode Infini, dépensés dans Remember),
 * profil communautaire (pseudo/avatar/badge actif/avatars possédés) et la
 * progression Remember (badges/objectifs, voir sommation.js:
 * exportSommationMeta). N'inclut PAS les réglages d'affichage (son/
 * PixelArt/daltonien, voir storage.js: DEFAULT_SETTINGS) — ce sont des
 * préférences d'appareil, pas une progression à synchroniser entre
 * appareils. N'inclut pas non plus les niveaux publiés dans Communauté
 * (déjà dans Firestore, voir community-store.js — pas une donnée locale). */
function collectProgressSnapshot() {
  return {
    v: SAVE_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    points: loadPoints(),
    storyCompleted: Array.from(loadStoryProgress()),
    profile: loadProfile(),
    sommationMeta: exportSommationMeta(),
  };
}

/** Applique un snapshot restauré du cloud sur le stockage local — appelée
 * UNIQUEMENT depuis restoreProgressFromCloud() ci-dessous, jamais
 * automatiquement (voir ce commentaire là-bas: écraser le local est
 * volontairement une action explicite du joueur). Tolérante à un snapshot
 * partiel/malformé (chaque champ est optionnel, voir les gardes ci-dessous)
 * plutôt que de tout rejeter en bloc pour une seule clé absente. */
function applyProgressSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  if (Number.isFinite(snapshot.points)) savePoints(snapshot.points);
  if (Array.isArray(snapshot.storyCompleted)) saveStoryProgress(new Set(snapshot.storyCompleted));
  if (snapshot.profile && typeof snapshot.profile === "object") saveProfile(snapshot.profile);
  if (snapshot.sommationMeta) importSommationMeta(snapshot.sommationMeta);
}

/** Envoie la progression locale vers le cloud (écrase la sauvegarde cloud
 * existante — c'est le sens naturel d'un "envoi") — best-effort, jamais
 * bloquant: un échec (pas connecté, réseau coupé) est juste ignoré, appelé
 * en toile de fond après les événements significatifs (voir main.js: fin de
 * niveau) SANS jamais afficher d'erreur au joueur pour cet appel silencieux
 * — seul l'appel explicite depuis Options (bouton "Sauvegarder maintenant")
 * relaie `ok` à l'UI. */
export async function saveProgressToCloud() {
  if (!isAndroidNative() || !signedIn) return { ok: false, reason: "not_signed_in" };
  try {
    const snapshot = collectProgressSnapshot();
    await GoogleGameServices.saveGame({ title: SAVE_NAME, data: JSON.stringify(snapshot) });
    trackEvent("playgames_save", { success: true });
    return { ok: true };
  } catch {
    trackEvent("playgames_save", { success: false });
    return { ok: false, reason: "error" };
  }
}

/** Récupère la progression depuis le cloud et l'applique en LOCAL — action
 * DESTRUCTIVE pour la progression locale actuelle (voir applyProgressSnapshot),
 * donc toujours déclenchée par un geste explicite avec confirmation côté UI
 * (voir main.js: bouton "Restaurer depuis Google Play"), jamais en silence. */
export async function restoreProgressFromCloud() {
  if (!isAndroidNative() || !signedIn) return { ok: false, reason: "not_signed_in" };
  try {
    const { data } = await GoogleGameServices.loadGame();
    if (!data) {
      trackEvent("playgames_restore", { success: false });
      return { ok: false, reason: "empty" };
    }
    const snapshot = JSON.parse(data);
    applyProgressSnapshot(snapshot);
    trackEvent("playgames_restore", { success: true });
    return { ok: true };
  } catch {
    trackEvent("playgames_restore", { success: false });
    return { ok: false, reason: "error" };
  }
}
