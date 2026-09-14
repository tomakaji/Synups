// i18n — retour utilisateur: "il faut extraire tous les textes dans un
// endroit et les utiliser via des clés [...] pour l'instant on ne fait pas
// les traductions dans les autres langues (on reste en français
// uniquement), je te demanderai plus tard pour tout traduire" — puis,
// plus tard: "j'ai changé le wording dans locales/fr.js [...] tu peux
// intégrer les traductions dans les autres langues avec i18n" (11 langues
// au total, ciblant les principaux marchés Google Play — voir locales/) —
// puis enfin: "init en dur sur l'anglais (fallback), init dynamique par la
// détection [...] puis on ajoute dans options la possibilité de changer la
// langue". DEFAULT_LOCALE ci-dessous est donc le filet de secours "en dur"
// (langue système non traduite, ou navigator.language indisponible), tandis
// que la langue réellement choisie au démarrage vient TOUJOURS de
// detectSystemLocale() sauf si le joueur a explicitement choisi une langue
// dans Options (voir main.js: settings.locale, storage.js).
//
// Architecture volontairement minimale (pas de librairie externe) — chaque
// langue est un dictionnaire plat dans locales/<code>.js, listé ci-dessous
// dans LOCALES. main.js/sommation.js/editor.js/community-store.js n'appellent
// jamais un fichier de langue directement, jamais une chaîne en dur: tout
// passe par t()/applyI18n() ci-dessous, exactement comme storage.js est le
// seul endroit à connaître localStorage).
//
// Trois façons d'utiliser une clé, selon d'où vient le texte:
//   1. Texte STATIQUE dans index.html: attribut `data-i18n="clé"` sur
//      l'élément — son textContent est écrasé par t(clé) via applyI18n(),
//      appelée une fois au chargement (voir main.js). Le texte français
//      déjà présent dans le HTML reste un simple filet de sécurité (utile
//      si applyI18n() n'a pas encore tourné) — fr.js reste la SEULE source
//      de vérité une fois l'app démarrée, jamais l'inverse.
//   2. Attribut (title/aria-label/placeholder) STATIQUE dans index.html:
//      `data-i18n-attr="title:clé;aria-label:clé2"` (paires séparées par
//      des points-virgules, une clé peut servir plusieurs attributs).
//   3. Texte DYNAMIQUE généré en JS (labels calculés, messages avec
//      variables, modales ouvertes par le code): `t("clé", {var: valeur})`
//      directement dans main.js/sommation.js/editor.js/community-store.js —
//      voir l'interpolation `{{var}}` gérée par t() ci-dessous.
//
// Clés: chaînes plates (pas de chemin imbriqué "a.b.c" résolu à la volée) —
// le "." dans beaucoup de clés générées depuis le HTML (ex:
// "menu-story.label") n'est qu'une convention de LISIBILITÉ (id de
// l'élément + partie concernée), jamais un chemin d'accès. Un seul objet
// plat par langue (voir locales/fr.js) : plus simple à parcourir/chercher
// (Ctrl+F sur une clé) qu'une arborescence, largement suffisant pour la
// taille de cette app.
import { fr } from "./locales/fr.js";
import { en } from "./locales/en.js";
import { es } from "./locales/es.js";
import { pt } from "./locales/pt.js";
import { de } from "./locales/de.js";
import { it } from "./locales/it.js";
import { ja } from "./locales/ja.js";
import { ko } from "./locales/ko.js";
import { ru } from "./locales/ru.js";
import { zh } from "./locales/zh.js";
import { ar } from "./locales/ar.js";
import { tr } from "./locales/tr.js";

// LOCALES est un vrai dictionnaire {code: dict} (pas un simple alias vers
// `fr`), pour que l'ajout d'une future langue n'exige de toucher QUE
// locales/ + cette liste, jamais i18n.js lui-même ni les appelants.
const LOCALES = { fr, en, es, pt, de, it, ja, ko, ru, zh, ar, tr };

// Filet de secours "en dur" (retour utilisateur) quand ni la langue système
// ni un choix explicite du joueur ne sont exploitables (navigator.language
// absent, ou langue système sans traduction) — anglais plutôt que français,
// pour un public international par défaut. Voir detectSystemLocale()
// ci-dessous: la langue RÉELLEMENT active au démarrage reste dynamique
// (détectée), ce n'est que le repli ultime qui est figé sur "en".
const DEFAULT_LOCALE = "en";
let currentLocale = DEFAULT_LOCALE;

/** Noms natifs de chaque langue (ex: "Deutsch" pas "German"), pour le
 * sélecteur de langue d'Options (voir main.js) — jamais traduits eux-mêmes
 * (un nom de langue s'écrit dans SA PROPRE langue quel que soit le
 * dictionnaire actif, convention universelle des sélecteurs de langue). */
export const LOCALE_NAMES = {
  fr: "Français",
  en: "English",
  es: "Español",
  pt: "Português",
  de: "Deutsch",
  it: "Italiano",
  ja: "日本語",
  ko: "한국어",
  ru: "Русский",
  zh: "中文",
  ar: "العربية",
  tr: "Türkçe",
};

/** Liste {code, name} de toutes les langues disponibles, dans l'ordre
 * d'apparition de LOCALES ci-dessus — consommée telle quelle par le
 * `<select>` d'Options (voir main.js: renderLanguageOption) pour ne jamais
 * dupliquer la liste des codes supportés à un 2e endroit. */
export function getSupportedLocales() {
  return Object.keys(LOCALES).map((code) => ({ code, name: LOCALE_NAMES[code] || code }));
}

/** Vrai si `code` a un dictionnaire dans LOCALES — utilisé par main.js pour
 * valider un `settings.locale` persisté (ex: langue retirée dans une future
 * version) avant de l'utiliser, plutôt que de dupliquer `LOCALES[code]`. */
export function isLocaleSupported(code) {
  return Boolean(LOCALES[code]);
}

/** Change la langue active — no-op silencieux si `code` n'a pas de
 * dictionnaire dans LOCALES (comportement "best-effort" cohérent avec t()
 * ci-dessous: jamais bloquant). */
export function setLocale(code) {
  if (LOCALES[code]) currentLocale = code;
}

export function getLocale() {
  return currentLocale;
}

/** Détecte la langue du système/navigateur (`navigator.language`, ex.
 * "en-US" -> "en") et retourne son code si on a un dictionnaire pour elle,
 * sinon DEFAULT_LOCALE ("en", voir plus haut). Appelée au démarrage (voir
 * main.js) UNIQUEMENT si le joueur n'a pas encore choisi explicitement une
 * langue dans Options (settings.locale) — une fois un choix explicite fait,
 * il prime toujours sur la détection. */
export function detectSystemLocale() {
  if (typeof navigator === "undefined" || !navigator.language) return DEFAULT_LOCALE;
  const code = navigator.language.split("-")[0].toLowerCase();
  return LOCALES[code] ? code : DEFAULT_LOCALE;
}

const INTERPOLATE_RE = /\{\{\s*(\w+)\s*\}\}/g;

/** Résout une clé vers le texte de la langue active, avec interpolation
 * `{{var}}` simple (voir vars). Une clé manquante retourne la clé
 * elle-même ENTRE CROCHETS (ex: "[cosmeticUnlockTitle]") plutôt que de
 * planter ou de retourner une chaîne vide — immédiatement repérable à
 * l'écran/dans les logs si une clé est mal orthographiée ou oubliée dans
 * fr.js, sans jamais faire planter le jeu (même philosophie "best-effort,
 * jamais bloquant" que analytics.js/ads.js/haptics.js). */
export function t(key, vars) {
  const dict = LOCALES[currentLocale] || LOCALES[DEFAULT_LOCALE];
  const raw = dict[key];
  if (raw == null) return `[${key}]`;
  if (!vars) return raw;
  return raw.replace(INTERPOLATE_RE, (match, name) => (vars[name] != null ? String(vars[name]) : match));
}

/** Applique data-i18n/data-i18n-attr sur tout le sous-arbre `root` (le
 * `document` entier par défaut) — à appeler UNE FOIS au démarrage (voir
 * main.js, juste après que le DOM du index.html est disponible), et
 * PARTOUT où du HTML est injecté avec ces attributs déjà posés
 * statiquement (aucun cas actuel, mais dispo si besoin futur — voir
 * mechanics-reference-modal par ex., dont le contenu DYNAMIQUE passe lui
 * directement par t(), jamais par ce mécanisme). N'écrase que le
 * textContent (jamais l'innerHTML: aucun texte de ce jeu n'a besoin de
 * markup imbriqué) et les attributs listés dans data-i18n-attr. */
export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    const pairs = el.getAttribute("data-i18n-attr").split(";");
    for (const pair of pairs) {
      const [attr, key] = pair.split(":");
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  });
}
