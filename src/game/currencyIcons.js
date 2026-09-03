// Icônes des deux monnaies du jeu, centralisées ici pour être partagées
// entre main.js et sommation.js sans dupliquer le même SVG à chaque site
// d'affichage.
//
// Retour utilisateur (renommage): "points" (monnaie BLEUE, mode Infini/
// Remember) s'appelle désormais "Étoile(s)" côté joueur, icône étoile ; et
// l'ancienne monnaie "étoiles" (JAUNE, Défi Quotidien) s'appelle désormais
// "Énergie", icône éclair — les CODES COULEUR restent inchangés (bleu pour
// la nouvelle monnaie Étoile, jaune pour Énergie), seuls le mot et l'icône
// affichés au joueur ont changé.
//
// IMPORTANT: les identifiants internes (storage.js: KEYS.points/KEYS.stars,
// loadPoints/loadStars/spendStars/addStars, `unlock.type === "star"`,
// classes CSS *--points/*--star...) restent VOLONTAIREMENT inchangés —
// renommer les clés localStorage romprait la lecture des soldes déjà
// enregistrés chez les joueurs actuels. Seul l'AFFICHAGE change ; voir les
// fonctions ci-dessous, seul point d'entrée pour ce nouvel habillage.
const STAR_PATH = "M12 2.5l2.9 6.2 6.6.6-5 4.5 1.5 6.7L12 17l-6 3.5 1.5-6.7-5-4.5 6.6-.6z";
const BOLT_POINTS = "13 2 3 14 12 14 11 22 21 10 12 10 13 2";

/** Icône "Étoile(s)" (ex-"points", monnaie bleue Infini/Remember) — même
 * tracé que l'étoile déjà utilisée ailleurs dans le jeu (ex-icône Défi
 * Quotidien), réutilisée ici pour la nouvelle monnaie qui en hérite le nom. */
export function starIconSVG() {
  return `<svg viewBox="0 0 24 24" class="currency-icon" fill="currentColor" stroke="none" aria-hidden="true"><path d="${STAR_PATH}"></path></svg>`;
}

/** Icône "Énergie" (ex-"étoiles", monnaie jaune Défi Quotidien). */
export function boltIconSVG() {
  return `<svg viewBox="0 0 24 24" class="currency-icon" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="${BOLT_POINTS}"></polygon></svg>`;
}

/** Icône + valeur prêtes à injecter via innerHTML (icône avant le nombre,
 * même convention que l'ancien "★100" des prix d'avatars). Le contexte
 * (couleur via CSS currentColor sur l'élément parent : var(--accent) pour
 * Étoile, #ffd76e pour Énergie) reste géré par les classes existantes
 * (.title-profile-stat--points/.infinite-points pour Étoile,
 * .title-profile-stat--star/.daily-challenge-fab pour Énergie). */
export function starLabel(value) {
  return `${starIconSVG()}${value}`;
}

export function boltLabel(value) {
  return `${boltIconSVG()}${value}`;
}
