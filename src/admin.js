// Mode Admin — chantier de séparation admin/normal (retour utilisateur):
// jusqu'ici, les outils de test/triche (déblocage forcé de cosmétiques,
// injection d'étoiles/Éclairs, navigation libre entre niveaux Histoire)
// étaient disséminés dans le jeu, TOUJOURS présents, sans distinction entre
// un build de développement et le build publié sur les stores. Ce module
// centralise l'état admin et le SEUL point d'entrée pour l'activer: un
// toggle flottant dans un coin de l'écran.
//
// Contrainte du chantier: en build de PRODUCTION (celui publié), aucune de
// ces features ne doit exister — pas seulement être cachée derrière un
// interrupteur invisible. `import.meta.env.DEV` est une constante que Vite
// remplace STATIQUEMENT au moment du build (`true` sous `npm run dev`,
// `false` sous `npm run build`/`vite build`, voir sa doc "Env Variables and
// Modes") — un `if (!import.meta.env.DEV) return;` en tête de fonction se
// retrouve donc littéralement `if (true) return;` en prod, ce qui rend tout
// le reste de son corps INATTEIGNABLE : esbuild (le minifieur par défaut de
// Vite) élimine ce code mort du bundle final, il n'y a donc plus de trace
// du toggle ni de son DOM dans l'app publiée.
//
// Chaque feature admin reste définie dans son module d'origine (main.js:
// debugUnlockPixelArt/addStars, meditate.js: debugUnlockMeditateBadges,
// storage.js: markStoryMasteryUnlocked, etc.) — pour la MÊME raison
// d'élimination de code mort, main.js/sommation.js enveloppent CHAQUE
// création/câblage de bouton de triche dans son propre
// `if (import.meta.env.DEV) { ... }` local plutôt que de passer par une
// fonction générique de ce fichier : un `if (import.meta.env.DEV)` littéral
// à l'endroit même de l'usage est ce qu'esbuild élimine le plus sûrement,
// une indirection par fonction partagée le serait moins (l'appelant ne sait
// pas statiquement que l'intérieur de la fonction appelée est mort). Ce
// fichier ne fournit donc que l'état PARTAGÉ minimal, lui-même totalement
// inerte en prod puisque rien ne peut jamais le faire passer à `true`
// (aucun toggle n'existe pour l'activer) :
//   - `isAdminModeOn()` : lu par main.js (navigation Histoire, voir
//     btnNext) pour savoir s'il faut appliquer les restrictions normales.
//   - `onAdminModeChange(fn)` : pour réagir immédiatement à un basculement
//     (ex: réactiver la flèche Suivant sans attendre le prochain niveau).
//   - `initAdminToggle()` : crée le bouton flottant lui-même — SEULE
//     fonction de ce fichier qui construit du DOM, donc la seule qui a
//     besoin de sa propre garde `if (!import.meta.env.DEV) return;`.

const listeners = new Set();
let enabled = false;

/** Vrai seulement si le mode admin est actif MAINTENANT (jamais vrai en
 * prod: rien ne peut appeler `setEnabled(true)` en dehors du toggle créé
 * par `initAdminToggle`, lui-même absent du bundle de prod). */
export function isAdminModeOn() {
  return enabled;
}

/** Abonnement à un changement d'état — retourne une fonction de
 * désabonnement (non utilisée actuellement, fournie par cohérence). */
export function onAdminModeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setEnabled(v) {
  enabled = v;
  for (const fn of listeners) fn(enabled);
}

/**
 * Crée le toggle flottant (coin de l'écran, voir styles/floating-controls.css:
 * #admin-toggle) — SEUL moyen d'activer le mode admin. N'existe QUE si
 * `import.meta.env.DEV` (voir en-tête de fichier) : appelée
 * inconditionnellement au démarrage par main.js, mais c'est cette garde
 * interne, pas l'appelant, qui décide si quoi que ce soit doit réellement
 * se produire.
 */
export function initAdminToggle() {
  if (!import.meta.env.DEV) return;

  const btn = document.createElement("button");
  btn.id = "admin-toggle";
  btn.type = "button";
  btn.textContent = "ADMIN";
  btn.title = "Mode admin (dev uniquement) — active/désactive les outils de test";

  const sync = () => btn.classList.toggle("admin-toggle--on", enabled);
  btn.onclick = () => {
    setEnabled(!enabled);
    sync();
  };
  sync();
  document.body.appendChild(btn);
}

/**
 * Crée un bouton de triche/test et l'insère dans `mount` (sélecteur CSS ou
 * élément déjà résolu), visible seulement quand le mode admin est ACTIF
 * (voir isAdminModeOn/onAdminModeChange ci-dessus) — jamais appelée ailleurs
 * que depuis un bloc `if (import.meta.env.DEV) { ... }` (voir main.js/
 * sommation.js pour ses points d'appel) : c'est cette convention aux points
 * d'appel, pas une garde ici, qui garantit que cette fonction elle-même n'a
 * plus aucune référence vivante en prod une fois ces blocs éliminés — et
 * disparaît donc du bundle avec eux (aucune raison de dupliquer le même
 * `if (!import.meta.env.DEV) return;` ici).
 */
export function mountAdminButton(mount, label, title, onClick) {
  const host = typeof mount === "string" ? document.querySelector(mount) : mount;
  if (!host) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "som-debug-btn admin-only-btn";
  btn.textContent = label;
  if (title) btn.title = title;
  btn.onclick = onClick;
  host.appendChild(btn);
  const sync = () => btn.classList.toggle("admin-only-btn--visible", enabled);
  onAdminModeChange(sync);
  sync();
}

/**
 * Crée un "potard" (input range) de test/réglage — retour utilisateur: "un
 * potard pour que je teste en direct d'autres réglages" (voir music.js:
 * setBaseVarietyGain/setBaseVarietyRange/setBaseVarietyPeriod, premier
 * usage de cette fonction). Même visibilité conditionnelle que
 * `mountAdminButton` ci-dessus (classes `.admin-only-btn`/`--visible`,
 * voir mode-infinite.css — réutilisées ici pour un <label>, pas un
 * <button>, ces deux classes ne font que masquer/afficher, indépendamment
 * du type d'élément).
 *
 * `opts`: { min, max, step, value, format? } — `format` (optionnel) reçoit
 * la valeur numérique courante et retourne le texte affiché à côté du
 * potard (ex: `(v) => v.toFixed(0) + " Hz"`); par défaut, la valeur brute.
 * `onInput` reçoit la valeur numérique à chaque déplacement du potard.
 * Retourne l'élément <input> (pour pouvoir le resynchroniser depuis
 * l'appelant, ex: un bouton "Réinitialiser" qui remet aussi le potard à sa
 * position par défaut).
 */
export function mountAdminSlider(mount, label, opts, onInput) {
  const host = typeof mount === "string" ? document.querySelector(mount) : mount;
  if (!host) return null;
  const { min, max, step = 1, value, format } = opts;
  const wrap = document.createElement("label");
  wrap.className = "som-debug-slider admin-only-btn";

  const text = document.createElement("span");
  text.className = "som-debug-slider-label";
  text.textContent = label;

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  const readout = document.createElement("span");
  readout.className = "som-debug-slider-value";
  const renderReadout = (v) => (readout.textContent = format ? format(v) : String(v));
  renderReadout(value);

  input.oninput = () => {
    const v = Number(input.value);
    renderReadout(v);
    onInput(v);
  };

  wrap.appendChild(text);
  wrap.appendChild(input);
  wrap.appendChild(readout);
  host.appendChild(wrap);
  const sync = () => wrap.classList.toggle("admin-only-btn--visible", enabled);
  onAdminModeChange(sync);
  sync();
  return input;
}
