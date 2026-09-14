// Intégration AdMob (Capacitor) — module isolé, comme storage.js/community-store.js:
// tout le reste de l'app (sommation.js notamment) passe par les fonctions
// exportées ci-dessous plutôt que d'importer @capacitor-community/admob
// directement, pour ne jamais avoir à réfléchir au SDK natif ailleurs dans
// le code, et pour que ce module reste le SEUL endroit à retoucher pour les
// identifiants ad unit.
//
// Round 20 (retour utilisateur: "j'ai un compte firebase et un compte
// AdMob"): un vrai compte AdMob a été créé (app + ad unit rewarded, pour les
// deux plates-formes) — voir REAL_APP_ID/REAL_REWARDED_AD_UNIT_ID plus bas.
// Retour utilisateur juste après: "l'app n'est pas terminée [...] on remet
// les ID de test", donc les IDs de TEST sont restés actifs un moment. APP_ID
// n'est pas consommé par ce fichier (le SDK natif le lit directement depuis
// android/app/src/main/AndroidManifest.xml), gardé ici uniquement comme
// rappel/source de vérité — à garder en synchro avec ce fichier, jamais
// l'un sans l'autre.
//
// Round publication (retour utilisateur: "est-ce que j'ai légalement le
// droit d'utiliser les vrais ID en dev ?") — RÉPONSE: pas d'interdiction
// légale, mais les règles AdMob (invalid traffic policy) interdisent de
// générer soi-même des impressions/clics sur ses PROPRES annonces réelles,
// sous peine de suspension du compte AdMob entier. La méthode officielle
// pour tester en toute sécurité avec de VRAIS ad units, sans ce risque :
// déclarer son propre appareil comme "testing device" (voir
// AdMob.initialize() plus bas, TESTING_DEVICE_IDS) — Google sait alors que
// CET appareil ne doit recevoir que des pubs de test (aucun revenu, aucun
// risque de trafic invalide), alors que tous les autres joueurs reçoivent
// de vraies pubs normalement. Voir
// https://developers.google.com/admob/android/test-ads#enable_test_devices.
// Ad unit RÉEL disponible pour le rewarded uniquement pour l'instant (voir
// REAL_REWARDED_AD_UNIT_ID) — désormais ACTIF. Interstitiel/bandeau restent
// sur les IDs de TEST publics Google : aucun ad unit réel n'a encore été
// créé pour ces deux formats dans la console AdMob (à faire avant de les
// basculer à leur tour, même principe que le rewarded ci-dessous).
//
// Ce module ne fait RIEN (no-op silencieux) tant qu'on n'est pas dans une
// coquille Capacitor native (voir Capacitor.isNativePlatform()) — le jeu
// continue de tourner normalement comme site web/PWA pendant le dev (npm
// run dev/preview, ou une éventuelle version web à part), sans jamais
// planter faute de SDK natif disponible.

import { Capacitor } from "@capacitor/core";
import {
  AdMob,
  RewardAdPluginEvents,
  InterstitialAdPluginEvents,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  AdmobConsentStatus,
} from "@capacitor-community/admob";
// Retour utilisateur: "il faut aussi couper la musique lorsqu'on joue une
// reward ou une pub d'interstice" — une pub plein écran (native, PAS une
// vue de cette WebView) masque le jeu sans forcément déclencher
// document.visibilitychange (voir music.js: ce n'est pas garanti selon la
// plateforme/le SDK), donc le mécanisme de pause déjà en place pour la
// mise en veille (même fichier) ne suffit pas seul ici — raison de pause
// dédiée ("ad"), voir showRewardedAd/showInterstitialAd plus bas.
import { pauseMusic, resumeMusic } from "./music.js";
// Chantier admin/normal (retour utilisateur: "ajoute moi des acces admin
// pour bypass les pubs sur navigateur (car on ne peut pas les visionner)")
// — AdMob (voir en-tête de fichier) ne fonctionne QUE dans la coquille
// native: en navigateur, showRewardedAd() ci-dessous renvoyait jusqu'ici
// systématiquement `{ earned: false }`, rendant impossible de tester en
// dev tout ce qui EXIGE une rewarded ad (indice, Remember, Défi Quotidien,
// génOffer...). isAdminModeOn() ne peut jamais valoir `true` en build de
// PRODUCTION (aucun toggle pour l'activer hors dev, voir admin.js) — ce
// bypass reste donc entièrement inerte hors dev, exactement comme les
// autres usages non enveloppés de isAdminModeOn() dans le code (ex:
// main.js: btnNext/renderLevelGrid).
import { isAdminModeOn } from "../admin.js";

// Round 21 (retour utilisateur: "pub-récompense pour recharger les indices" +
// "publicités courtes (pas des reward ads) tous les 5 niveaux du mode
// infinity") — deux nouveaux usages du SDK déjà en place ci-dessous:
//   - la rewarded ad existante (voir showRewardedAd) est réutilisée telle
//     quelle pour les indices (Générique par conception: elle ne sait rien
//     de CE qu'elle récompense — voir main.js: btnHintWatchAd.onclick — donc
//     aucun changement nécessaire ici pour ce premier point).
//   - un format INTERSTITIEL est ajouté (voir INTERSTITIAL_AD_UNIT_ID/
//     prepareInterstitial/showInterstitialAd plus bas), format différent du
//     rewarded, avec son propre ad unit AdMob.

// Publication Android uniquement pour l'instant (retour utilisateur: "on
// oublie tout ce qui est iOS") — seul android/app/src/main/AndroidManifest.xml
// a été reporté sur le vrai App ID ci-dessous ; ios/App/App/Info.plist est
// resté sur l'ID de test, laissé tel quel puisque iOS n'est pas dans le
// scope de publication actuel.
const APP_ID = {
  android: "ca-app-pub-4606745726023654~5350590056",
  ios: "ca-app-pub-3940256099942544~1458002511",
};

// Alias conservé pour lisibilité (voir usages ci-dessous) — mêmes valeurs
// que APP_ID.android, gardées côte à côte pour qu'on retrouve facilement
// "quel est le vrai ID" si jamais on doit revenir en arrière temporairement.
const REAL_APP_ID = {
  android: "ca-app-pub-4606745726023654~5350590056",
  ios: "ca-app-pub-4606745726023654~8047186954",
};
const REAL_REWARDED_AD_UNIT_ID = {
  android: "ca-app-pub-4606745726023654/4798207082",
  ios: "ca-app-pub-4606745726023654/5421023615",
};

// Rewarded (vidéo récompensée) — seul format avec un ad unit RÉEL créé côté
// AdMob pour l'instant (bloc "Remember - pub récompensée", 75 points),
// désormais ACTIF (voir en-tête de fichier: TESTING_DEVICE_IDS protège
// l'appareil du développeur pendant les tests, sans empêcher les vraies
// pubs/le vrai revenu pour les autres joueurs).
const REWARDED_AD_UNIT_ID = {
  android: "ca-app-pub-4606745726023654/4798207082",
  ios: "ca-app-pub-3940256099942544/1712485313",
};

// Interstitiel (pub courte plein écran, PAS une rewarded) — voir main.js:
// loadInfiniteLevel(), affichée tous les 5 niveaux Infini "vraiment joués"
// (retour utilisateur round 21). IDs de TEST publics Google — format
// interstitiel, DIFFÉRENTS de ceux du rewarded ci-dessus (même publisher
// id "3940256099942544" que Google réutilise pour tous ses IDs de test,
// seul le suffixe change selon le format). Aucun ad unit RÉEL créé pour ce
// format pour l'instant (contrairement au rewarded, voir REAL_REWARDED_AD_UNIT_ID
// plus haut) — à créer dans la console AdMob avant publication, sur le même
// modèle (app + ad unit "Interstitiel", PAS "Interstitiel avec récompense").
const INTERSTITIAL_AD_UNIT_ID = {
  android: "ca-app-pub-3940256099942544/1033173712",
  ios: "ca-app-pub-3940256099942544/4411468910",
};

// Bandeau (bannière collée en bas de l'écran, PAS un format plein écran) —
// retour utilisateur round 25: "lorsqu'on joue une grille (histoire ou
// infinity) ou au mode bonus, on veut afficher un bandeau publicitaire tout
// en bas de l'écran EN MÊME TEMPS" (donc affiché en continu PENDANT que le
// joueur joue, contrairement au rewarded/interstitiel qui interrompent
// ponctuellement — voir showBannerAd/hideBannerAd plus bas). IDs de TEST
// publics Google — format bandeau, différents des autres formats ci-dessus.
// Aucun ad unit RÉEL créé pour ce format pour l'instant (même remarque que
// INTERSTITIAL_AD_UNIT_ID) — à créer dans la console AdMob avant publication.
const BANNER_AD_UNIT_ID = {
  android: "ca-app-pub-3940256099942544/6300978111",
  ios: "ca-app-pub-3940256099942544/2934735716",
};

// Appareil(s) du développeur à déclarer comme "testing device" AdMob (voir
// en-tête de fichier) — récupéré dans le logcat Android (voir ce même
// commentaire, historique de la conversation) au premier lancement natif.
// Un seul appareil déclaré pour l'instant (celui du développeur) ; en
// ajouter un autre ici (simple virgule) le jour où quelqu'un d'autre doit
// tester avec de vraies pubs sans risquer du trafic invalide.
const TESTING_DEVICE_IDS = ["6BB3EF5DE4700E07B0C747FF4FAD2EB8"];

let initPromise = null;
let rewardedReady = false;
// Une préparation à la fois: éviter d'empiler prepareRewardVideoAd() si
// showRewardedAd() est appelé plusieurs fois rapidement (double clic sur le
// bouton "regarder une pub" par ex.) avant que le premier chargement ait
// fini.
let preparingRewarded = null;
let interstitialReady = false;
let preparingInterstitial = null;
// `bannerCreated`: showBanner() a déjà réussi au moins une fois (un vrai
// bandeau existe côté natif) — tant que c'est faux, showBannerAd() doit
// appeler showBanner() (charge + affiche) plutôt que resumeBanner() (réaffiche
// un bandeau déjà chargé), qui échouerait sur un bandeau qui n'a jamais existé.
let bannerCreated = false;
// `bannerVisible`: état VOULU par le dernier appel (show vs hide) — sert à
// ignorer un événement asynchrone (SizeChanged, potentiellement en vol au
// moment d'un hideBannerAd()) qui arriverait APRÈS que le joueur ait déjà
// quitté l'écran de jeu, pour ne jamais réserver d'espace pour un bandeau
// qu'on vient de cacher.
let bannerVisible = false;
// Callback fourni par main.js (voir onBannerHeightChange) — informé de la
// hauteur RÉELLE du bandeau (0 = caché/pas encore chargé/échoué) pour que
// l'appelant réserve exactement l'espace nécessaire sous le plateau, jamais
// une valeur fixe devinée qui laisserait un vide ou chevaucherait le jeu.
let bannerHeightListener = null;

function platform() {
  // "web" inclut aussi bien le navigateur classique que le dev server Vite
  // — dans les deux cas isNativePlatform() est false, donc ce module reste
  // inerte sans avoir à distinguer les deux.
  const p = Capacitor.getPlatform();
  return p === "android" || p === "ios" ? p : "android"; // fallback arbitraire, jamais utilisé réellement en dehors de native
}

function rewardedAdUnitId() {
  return REWARDED_AD_UNIT_ID[platform()];
}

function interstitialAdUnitId() {
  return INTERSTITIAL_AD_UNIT_ID[platform()];
}

function bannerAdUnitId() {
  return BANNER_AD_UNIT_ID[platform()];
}

/** Précharge une rewarded ad — appelée après init, et après chaque
 * affichage (consommé = à recharger) pour que le bouton "regarder une pub"
 * ait quasi toujours une pub prête plutôt que de faire attendre le joueur
 * au moment du clic. Ne rejette jamais (juste rewardedReady qui reste
 * false) — un échec de chargement pub ne doit jamais faire planter le
 * reste de l'app. */
function prepareRewarded() {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (preparingRewarded) return preparingRewarded;
  rewardedReady = false;
  // Pas de `isTesting: true` ici (contrairement à interstitiel/bandeau plus
  // bas) : cet ad unit est désormais le VRAI (voir REWARDED_AD_UNIT_ID) —
  // `isTesting: true` forcerait une pub de test pour TOUT le monde, ce qui
  // annulerait le passage en réel. La protection du développeur passe par
  // TESTING_DEVICE_IDS (voir initAds ci-dessus), pas par ce flag.
  preparingRewarded = AdMob.prepareRewardVideoAd({ adId: rewardedAdUnitId() })
    .then(() => {
      rewardedReady = true;
    })
    .catch(() => {
      rewardedReady = false;
    })
    .finally(() => {
      preparingRewarded = null;
    });
  return preparingRewarded;
}

/** Précharge une interstitielle — même logique que prepareRewarded()
 * ci-dessus (une préparation à la fois, jamais de rejet, juste
 * interstitialReady qui reste false en cas d'échec). Appelée après init, et
 * après chaque affichage (voir showInterstitialAd) pour que la suivante soit
 * prête sans faire attendre le joueur au prochain palier de 5 niveaux. */
function prepareInterstitial() {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (preparingInterstitial) return preparingInterstitial;
  interstitialReady = false;
  preparingInterstitial = AdMob.prepareInterstitial({ adId: interstitialAdUnitId(), isTesting: true })
    .then(() => {
      interstitialReady = true;
    })
    .catch(() => {
      interstitialReady = false;
    })
    .finally(() => {
      preparingInterstitial = null;
    });
  return preparingInterstitial;
}

/** Demande le consentement RGPD (SDK Google UMP) — obligatoire avant toute
 * requête de pub pour un utilisateur dans l'UE/UK (voir retour utilisateur
 * round 19: doc suite migration Capacitor). `showConsentForm` ne s'affiche
 * QUE si `isConsentFormAvailable`/status REQUIRED — sur un device hors UE,
 * `requestConsentInfo` renvoie NOT_REQUIRED et cette fonction ne montre
 * jamais rien, pas de faux positif. */
async function ensureConsent() {
  const info = await AdMob.requestConsentInfo();
  if (info.status === AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable) {
    await AdMob.showConsentForm();
  }
}

/** Initialise le SDK Google Mobile Ads + consentement RGPD + (iOS) demande
 * App Tracking Transparency — à appeler UNE fois au démarrage de l'app
 * (voir main.js). Idempotent (un seul vrai appel même si invoquée plusieurs
 * fois) via `initPromise` mis en cache, même principe que d'autres init
 * uniques du projet (voir main.js: applyVolumes() appelée une fois au
 * chargement). */
export function initAds() {
  if (initPromise) return initPromise;
  if (!Capacitor.isNativePlatform()) {
    initPromise = Promise.resolve();
    return initPromise;
  }
  initPromise = ensureConsent()
    .catch(() => {
      // Un échec de récupération du consentement (réseau coupé au premier
      // lancement, par ex.) ne doit pas bloquer le jeu — voir plus bas:
      // AdMob.initialize() est quand même tenté, et npa (non-personnalisé)
      // sera de toute façon demandé côté requête de pub par prudence tant
      // que le statut de consentement n'est pas confirmé OBTAINED.
    })
    .then(() =>
      // iOS 14+: popup natif ATT, distinct du consentement RGPD ci-dessus
      // (l'un porte sur le tracking publicitaire cross-app, l'autre sur le
      // RGPD) — no-op sur Android/web/iOS<14, voir doc du plugin.
      AdMob.requestTrackingAuthorization().catch(() => {})
    )
    .then(() =>
      // initializeForTesting + testingDevices (voir en-tête de fichier et
      // TESTING_DEVICE_IDS ci-dessus) : SEULS les appareils listés dans
      // TESTING_DEVICE_IDS reçoivent des pubs de test — tous les autres
      // joueurs reçoivent de vraies pubs (vrai revenu) normalement. C'est
      // la méthode recommandée par Google pour tester avec de vrais ad
      // units sans jamais générer de trafic invalide sur son propre compte.
      AdMob.initialize({ initializeForTesting: true, testingDevices: TESTING_DEVICE_IDS })
    )
    .then(() => Promise.all([prepareRewarded(), prepareInterstitial()]))
    .catch(() => {
      // SDK indisponible/erreur d'init: le jeu continue sans pubs plutôt
      // que de planter — showRewardedAd() renverra simplement { earned:
      // false } dans ce cas (rewardedReady restera false).
    });
  return initPromise;
}

/** Affiche la rewarded ad préchargée et résout SEULEMENT une fois l'issue
 * connue avec certitude — jamais de façon optimiste. `{ earned: true }`
 * UNIQUEMENT si l'événement `Rewarded` du SDK s'est déclenché (voir
 * sommation.js: c'est CE booléen, et rien d'autre, qui doit décider si les
 * points sont crédités — retour utilisateur/bonne pratique: ne jamais
 * accorder la récompense avant la confirmation du SDK, pour ne pas se faire
 * avoir par un utilisateur qui ferme la pub après 1 seconde). Sur
 * web/plateforme non supportée, ou si aucune pub n'est prête, résout tout
 * de suite avec `{ earned: false, reason: "unavailable" }` — à
 * sommation.js de décider quoi afficher dans ce cas (voir openAdModal). */
export async function showRewardedAd() {
  if (!Capacitor.isNativePlatform()) {
    // Voir l'import isAdminModeOn ci-dessus: seul cas où le navigateur peut
    // renvoyer une récompense, jamais sinon.
    if (isAdminModeOn()) return { earned: true, reason: "admin-bypass" };
    return { earned: false, reason: "unavailable" };
  }
  if (!rewardedReady) {
    return { earned: false, reason: "unavailable" };
  }

  // Voir music.js: pauseMusic/resumeMusic — posée AVANT showRewardVideoAd()
  // (pas seulement à l'événement "affichée") pour ne rien laisser passer
  // pendant le court instant de chargement/transition natif. `finish`
  // ci-dessous, seul point de sortie de cette pub (quelle que soit
  // l'issue), lève systématiquement cette même raison.
  pauseMusic("ad");
  return new Promise((resolve) => {
    let settled = false;
    const listeners = [];
    const finish = (result) => {
      if (settled) return;
      settled = true;
      listeners.forEach((l) => l.remove());
      resumeMusic("ad");
      // La pub qu'on vient de montrer est consommée dans tous les cas
      // (récompensée ou non) — on relance immédiatement le chargement de
      // la suivante pour le prochain clic, sans bloquer la résolution de
      // CETTE promesse sur ce rechargement.
      prepareRewarded();
      resolve(result);
    };

    Promise.all([
      AdMob.addListener(RewardAdPluginEvents.Rewarded, () => finish({ earned: true })),
      AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish({ earned: false, reason: "dismissed" })),
      AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish({ earned: false, reason: "failed" })),
    ]).then((handles) => listeners.push(...handles));

    AdMob.showRewardVideoAd().catch(() => finish({ earned: false, reason: "failed" }));
  });
}

/** Affiche l'interstitielle préchargée — PAS une rewarded (voir en-tête de
 * fichier): rien à récompenser, rien à attendre pour CRÉDITER quoi que ce
 * soit. Retourne malgré tout une Promise résolue une fois l'interstitielle
 * réglée (affichée puis fermée, échec d'affichage, ou immédiatement en
 * no-op — voir plus bas) : certains appelants (voir dailyChallenge.js/
 * main.js: fin du Défi Quotidien, "pub interstitielle courte avant de
 * revenir au menu") ont besoin d'enchaîner APRÈS coup, d'autres restent
 * "fire and forget" en ignorant simplement cette Promise — voir main.js:
 * loadInfiniteLevel() l'appelle sans l'attendre, le niveau Infini suivant
 * continue de se préparer PENDANT que l'interstitielle s'affiche par-
 * dessus. No-op silencieux (Promise déjà résolue) sur web/plateforme non
 * supportée, ou si aucune pub n'est prête (jamais de niveau "en attente
 * d'une pub" côté joueur, ni de retour au menu bloqué indéfiniment côté
 * Défi Quotidien). */
export function showInterstitialAd() {
  if (!Capacitor.isNativePlatform() || !interstitialReady) return Promise.resolve();
  interstitialReady = false;

  // Voir music.js: pauseMusic/resumeMusic — même raisonnement que
  // showRewardedAd ci-dessus (posée avant l'appel natif).
  pauseMusic("ad");
  let settled = false;
  const listeners = [];
  return new Promise((resolve) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      listeners.forEach((l) => l.remove());
      resumeMusic("ad");
      resolve();
    };
    Promise.all([
      AdMob.addListener(InterstitialAdPluginEvents.Dismissed, finish),
      AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, finish),
    ]).then((handles) => listeners.push(...handles));

    AdMob.showInterstitial().catch(() => finish());
    // Consommée dans tous les cas (affichée ou échec d'affichage): recharge
    // immédiatement pour le prochain déclenchement (palier Infini OU
    // prochain Défi Quotidien réussi, même pool partagé).
    prepareInterstitial();
  });
}

/** Enregistre le callback appelé à chaque changement de hauteur du bandeau
 * (voir bannerHeightListener ci-dessus) — à appeler UNE fois au démarrage de
 * l'app (voir main.js), avant tout showBannerAd(). `heightPx` est en dp/pt
 * (unité CSS px directement utilisable côté WebView) — 0 quand le bandeau
 * est caché, pas encore chargé, ou en échec, JAMAIS une valeur devinée. */
export function onBannerHeightChange(callback) {
  bannerHeightListener = callback;
}

let bannerListenersReady = false;

function ensureBannerListeners() {
  if (bannerListenersReady) return;
  bannerListenersReady = true;
  AdMob.addListener(BannerAdPluginEvents.SizeChanged, (info) => {
    // Ignore un événement en vol arrivé après un hideBannerAd() (voir
    // bannerVisible ci-dessus) — sinon un SizeChanged tardif rouvrirait
    // l'espace réservé sous un plateau qu'on vient de quitter.
    if (bannerVisible) bannerHeightListener?.(info?.height || 0);
  }).catch(() => {});
  AdMob.addListener(BannerAdPluginEvents.FailedToLoad, () => {
    if (bannerVisible) bannerHeightListener?.(0);
  }).catch(() => {});
}

/** Affiche le bandeau publicitaire collé en bas de l'écran — voir main.js:
 * showView(), appelé à l'entrée de tout écran de JEU (Histoire/Infini/
 * Communauté en train de jouer une grille, et Remember). Réutilise le MÊME
 * bandeau entre deux écrans plutôt que d'en recréer un à chaque fois
 * (resumeBanner réaffiche celui déjà chargé, sans recharger de pub) — un
 * showBanner() complet n'est fait qu'une seule fois, à la toute première
 * entrée en jeu. No-op silencieux hors app native ou en cas d'échec (le
 * jeu continue sans bandeau, jamais d'espace réservé pour rien). */
export async function showBannerAd() {
  if (!Capacitor.isNativePlatform()) return;
  bannerVisible = true;
  if (bannerCreated) {
    await AdMob.resumeBanner().catch(() => {
      // Le bandeau natif a pu être détruit entre-temps (rare) — retente un
      // vrai showBanner() au prochain appel plutôt que de rester bloqué sur
      // resumeBanner() qui échouera indéfiniment.
      bannerCreated = false;
    });
    return;
  }
  ensureBannerListeners();
  bannerCreated = true;
  await AdMob.showBanner({
    adId: bannerAdUnitId(),
    adSize: BannerAdSize.ADAPTIVE_BANNER,
    position: BannerAdPosition.BOTTOM_CENTER,
    isTesting: true,
  }).catch(() => {
    bannerCreated = false;
    if (bannerVisible) bannerHeightListener?.(0);
  });
}

/** Cache le bandeau SANS le détruire (voir showBannerAd) — appelé à la
 * sortie de tout écran de jeu (menu, options, éditeur, communauté...). */
export function hideBannerAd() {
  if (!Capacitor.isNativePlatform() || !bannerVisible) return;
  bannerVisible = false;
  bannerHeightListener?.(0);
  if (bannerCreated) AdMob.hideBanner().catch(() => {});
}
