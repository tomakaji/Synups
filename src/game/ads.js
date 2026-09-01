// Intégration AdMob (Capacitor) — module isolé, comme storage.js/community-store.js:
// tout le reste de l'app (sommation.js notamment) passe par les fonctions
// exportées ci-dessous plutôt que d'importer @capacitor-community/admob
// directement, pour ne jamais avoir à réfléchir au SDK natif ailleurs dans
// le code, et pour que ce module reste le SEUL endroit à retoucher pour les
// identifiants ad unit.
//
// Round 20 (retour utilisateur: "j'ai un compte firebase et un compte
// AdMob"): un vrai compte AdMob a été créé (app + ad unit rewarded, pour les
// deux plates-formes) — voir REAL_APP_ID/REAL_REWARDED_AD_UNIT_ID plus bas,
// gardés de côté pour plus tard. Retour utilisateur juste après: "l'app
// n'est pas terminée [...] on remet les ID de test", donc ce sont bien les
// IDs de TEST publics de Google qui sont actifs ci-dessous tant que l'app
// est en développement — pour ne jamais afficher de vraies pubs (ni générer
// de faux revenus) avant que le jeu soit prêt à publier. APP_ID n'est pas
// consommé par ce fichier (le SDK natif le lit directement depuis
// android/app/src/main/AndroidManifest.xml et ios/App/App/Info.plist — 2
// AUTRES endroits à garder en synchro avec celui-ci, jamais l'un sans
// l'autre), gardé ici uniquement comme rappel/source de vérité.
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
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  AdmobConsentStatus,
} from "@capacitor-community/admob";

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

// IDs de TEST publics Google — les mêmes pour tous les développeurs,
// n'affichent jamais de vraie pub ni ne génèrent de revenu. ACTIFS tant que
// l'app est en dev (voir en-tête de fichier).
const APP_ID = {
  android: "ca-app-pub-3940256099942544~3347511713",
  ios: "ca-app-pub-3940256099942544~1458002511",
};

// IDs RÉELS créés dans la console AdMob (compte de l'utilisateur) — mis de
// côté pour le jour où l'app sera prête à publier. Pour les réactiver: dans
// ce fichier, remplacer APP_ID par REAL_APP_ID et REWARDED_AD_UNIT_ID par
// REAL_REWARDED_AD_UNIT_ID (ou inversement pour repasser en test), ET
// reporter REAL_APP_ID dans android/app/src/main/AndroidManifest.xml
// (meta-data com.google.android.gms.ads.APPLICATION_ID) et
// ios/App/App/Info.plist (GADApplicationIdentifier) — puis retirer
// isTesting/initializeForTesting plus bas (voir prepareRewarded/initAds).
const REAL_APP_ID = {
  android: "ca-app-pub-4606745726023654~5350590056",
  ios: "ca-app-pub-4606745726023654~8047186954",
};
const REAL_REWARDED_AD_UNIT_ID = {
  android: "ca-app-pub-4606745726023654/4798207082",
  ios: "ca-app-pub-4606745726023654/5421023615",
};

// Rewarded (vidéo récompensée) — seul format branché pour l'instant (voir
// sommation.js: "regarder une pub pour regagner des points", le seul retour
// utilisateur explicite sur les pubs à ce jour). Bannière/interstitiel: pas
// demandés, pas ajoutés — inutile d'alourdir ce module avec des formats non
// utilisés par l'app. IDs de TEST publics Google — voir REAL_REWARDED_AD_UNIT_ID
// ci-dessus pour les vrais (bloc AdMob "Remember - pub récompensée", 200 points).
const REWARDED_AD_UNIT_ID = {
  android: "ca-app-pub-3940256099942544/5224354917",
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
  preparingRewarded = AdMob.prepareRewardVideoAd({ adId: rewardedAdUnitId(), isTesting: true })
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
      // initializeForTesting: true — app en dev (voir en-tête de fichier),
      // évite qu'un device de test reçoive de vraies pubs par erreur avant
      // publication. À retirer en même temps que le passage aux vrais IDs.
      AdMob.initialize({ initializeForTesting: true })
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
  if (!Capacitor.isNativePlatform() || !rewardedReady) {
    return { earned: false, reason: "unavailable" };
  }

  return new Promise((resolve) => {
    let settled = false;
    const listeners = [];
    const finish = (result) => {
      if (settled) return;
      settled = true;
      listeners.forEach((l) => l.remove());
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
 * fichier): rien à récompenser, rien à attendre. Volontairement "fire and
 * forget" (pas de Promise à await côté appelant, contrairement à
 * showRewardedAd) — voir main.js: loadInfiniteLevel() l'appelle sans
 * bloquer le chargement du niveau suivant, qui continue de se préparer
 * PENDANT que l'interstitielle s'affiche par-dessus. No-op silencieux sur
 * web/plateforme non supportée, ou si aucune pub n'est prête (jamais de
 * niveau "en attente d'une pub" côté joueur). */
export function showInterstitialAd() {
  if (!Capacitor.isNativePlatform() || !interstitialReady) return;
  interstitialReady = false;
  AdMob.showInterstitial().catch(() => {});
  // Consommée dans tous les cas (affichée ou échec d'affichage): recharge
  // immédiatement pour le prochain palier de 5 niveaux.
  prepareInterstitial();
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
