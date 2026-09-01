// Retour haptique (vibrations courtes) — module isolé, même principe que
// ads.js: tout le reste de l'app passe par les fonctions exportées ci-dessous
// plutôt que d'importer @capacitor/haptics directement, pour ne jamais avoir
// à réfléchir au SDK natif ailleurs dans le code.
//
// Round 24 (retour utilisateur: "rajouter du retour haptique sur les boutons
// de navigation en général, et dans le jeu et le mode remember") — trois
// intensités couvrent tous les usages de l'app plutôt qu'une seule vibration
// générique:
//   - hapticLight(): la plupart des interactions (boutons de navigation,
//     pose/retrait d'une lumière en jeu, prise en main d'un générateur dans
//     Remember) — un tap léger, pour ne jamais devenir fatigant sur des
//     actions très fréquentes.
//   - hapticWarning(): un coup refusé/invalide (case interdite, mauvaise
//     fusion...) — notification "warning" du SDK, distincte du tap léger
//     pour que l'échec se SENTE différent de la réussite sans avoir à
//     regarder l'écran.
//   - hapticSuccess(): un jalon (niveau résolu, badge débloqué en Remember)
//     — notification "success", la plus marquée des trois, réservée aux
//     vrais moments de satisfaction plutôt qu'à chaque coup.
//
// Ce module ne fait RIEN (no-op silencieux) tant qu'on n'est pas dans une
// coquille Capacitor native (voir Capacitor.isNativePlatform(), même garde
// que ads.js) — le jeu continue de tourner normalement comme site web/PWA
// pendant le dev, sans jamais planter faute de SDK natif disponible. Chaque
// fonction avale aussi ses propres erreurs (device sans moteur de vibration,
// permission refusée...) plutôt que de les laisser remonter: le retour
// haptique est un bonus, jamais un chemin critique.

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

const nativeOnly = (fn) => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    fn()?.catch?.(() => {});
  } catch {
    // voir en-tête de fichier: jamais bloquant.
  }
};

export function hapticLight() {
  nativeOnly(() => Haptics.impact({ style: ImpactStyle.Light }));
}

export function hapticWarning() {
  nativeOnly(() => Haptics.notification({ type: NotificationType.Warning }));
}

export function hapticSuccess() {
  nativeOnly(() => Haptics.notification({ type: NotificationType.Success }));
}
