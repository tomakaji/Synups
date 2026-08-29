// Intégration AdMob (Capacitor) — module isolé, comme storage.js/community-store.js:
// tout le reste de l'app (sommation.js notamment) passe par les fonctions
// exportées ci-dessous plutôt que d'importer @capacitor-community/admob
// directement, pour ne jamais avoir à réfléchir au SDK natif ailleurs dans
// le code, et pour que ce module reste le SEUL endroit à retoucher le jour
// où les vrais identifiants AdMob remplacent les IDs de test.
//
// IMPORTANT — IDs de TEST: les constantes ci-dessous sont les identifiants
// PUBLICS de test fournis par Google (documentés sur
// https://developers.google.com/admob/android/test-ads et .../ios/test-ads),
// jamais des vrais identifiants d'app. Tant qu'ils sont utilisés, aucun
// revenu réel n'est généré (par design: erreur si un vrai AdMob renvoyait
// des pubs "live" pendant le développement pourrait être qualifié de trafic
// invalide). À REMPLACER par les vrais App ID / ad unit IDs une fois le
// compte AdMob créé et l'app enregistrée — voir android/app/src/main/AndroidManifest.xml
// et ios/App/App/Info.plist pour les App ID (2 autres endroits à mettre à
// jour en plus de ce fichier).
//
// Ce module ne fait RIEN (no-op silencieux) tant qu'on n'est pas dans une
// coquille Capacitor native (voir Capacitor.isNativePlatform()) — le jeu
// continue de tourner normalement comme site web/PWA pendant le dev (npm
// run dev/preview, ou une éventuelle version web à part), sans jamais
// planter faute de SDK natif disponible.

import { Capacitor } from "@capacitor/core";
import { AdMob, RewardAdPluginEvents, AdmobConsentStatus } from "@capacitor-community/admob";

const TEST_APP_ID = {
  android: "ca-app-pub-3940256099942544~3347511713",
  ios: "ca-app-pub-3940256099942544~1458002511",
};

// Rewarded (vidéo récompensée) — seul format branché pour l'instant (voir
// sommation.js: "regarder une pub pour regagner des points", le seul retour
// utilisateur explicite sur les pubs à ce jour). Bannière/interstitiel: pas
// demandés, pas ajoutés — inutile d'alourdir ce module avec des formats non
// utilisés par l'app.
const TEST_REWARDED_AD_UNIT_ID = {
  android: "ca-app-pub-3940256099942544/5224354917",
  ios: "ca-app-pub-3940256099942544/1712485313",
};

let initPromise = null;
let rewardedReady = false;
// Une préparation à la fois: éviter d'empiler prepareRewardVideoAd() si
// showRewardedAd() est appelé plusieurs fois rapidement (double clic sur le
// bouton "regarder une pub" par ex.) avant que le premier chargement ait
// fini.
let preparingRewarded = null;

function platform() {
  // "web" inclut aussi bien le navigateur classique que le dev server Vite
  // — dans les deux cas isNativePlatform() est false, donc ce module reste
  // inerte sans avoir à distinguer les deux.
  const p = Capacitor.getPlatform();
  return p === "android" || p === "ios" ? p : "android"; // fallback arbitraire, jamais utilisé réellement en dehors de native
}

function rewardedAdUnitId() {
  return TEST_REWARDED_AD_UNIT_ID[platform()];
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
      AdMob.initialize({
        // À retirer (ou passer à false) une fois les vrais ad unit IDs en
        // place — voir commentaire des constantes TEST_* en haut de fichier.
        initializeForTesting: true,
      })
    )
    .then(() => prepareRewarded())
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
