// Modèle de grille et règles du jeu LightUp.
// Aucune dépendance : facile à tester isolément (voir scripts/verify.mjs,
// scripts/check-unique.mjs et src/game/solver.js).
//
// Mécanique couleur (v2, "charge + laser"): une case à charge (CLUE) peut
// porter une couleur. Quand elle atteint son état "success" (le bon nombre
// de lumières adjacentes), chacune de ses directions qui ne pointe PAS vers
// une lumière tire un laser fin de sa couleur, qui voyage jusqu'à la
// première case-lumière rencontrée sur cette ligne/colonne et la teinte
// (elle diffuse alors sa propre couleur au lieu du blanc par défaut). Le
// laser est purement indicatif: il ne rend pas les cases traversées
// "illuminées". Si plusieurs lasers de couleurs différentes atteignent la
// même lumière, leurs couleurs se mélangent (addition des canaux r/g/b).
//
// Une case interdite (FORBIDDEN) est un type dédié: aucune lumière ne peut
// jamais être adjacente. Remplace l'ancien indice numéroté "0".
//
// VOID (hors-grille) et WALL (mur) sont à nouveau deux types distincts:
// tous les deux bloquent la lumière blanche de base comme n'importe quel
// obstacle opaque, MAIS un laser de charge colorée traverse un VOID sans y
// être arrêté (transparent, comme si la case n'existait pas pour le
// routage coloré) alors qu'un WALL l'arrête bel et bien. Ça permet de
// distinguer "en dehors de la forme du niveau" (void, souvent traversé par
// des lasers qui routent ailleurs) de "obstacle solide qui bloque
// vraiment" (wall).
//
// Miroir (MIRROR, token "/" ou "\"): dévie un laser de charge colorée de
// 90° au lieu de l'arrêter. Ne concerne QUE les lasers colorés — la
// lumière blanche de base (illumination normale, comptage des cases à
// charge/interdites) le traverse comme n'importe quel obstacle opaque
// (il bloque, sans dévier). Ça permet de router un laser en coude vers
// une lumière qui n'est pas sur la même ligne/colonne que la charge.
//
// [Retiré round 22, retour utilisateur: "on ne l'utilise pas"] Filtre
// (FILTER, token "Fr"/"Fg"/"Fb") existait ici — couleur fixe qui ne
// laissait passer qu'un seul canal d'un laser coloré traversant la case,
// sans dévier (contrairement au miroir). Supprimé du moteur (CellType,
// parsing de token, propagation), de l'éditeur et du rendu — aucun niveau
// Histoire ni seed communautaire n'en dépendait (voir git history pour
// retrouver l'implémentation si jamais réintroduite).
//
// Prisme (PRISM, token "P" ou "Pr"/"Pg"/"Pb"/"Pw"): case fixe du niveau
// (non posable par le joueur) qui colore une lumière sur chacune de ses 4
// directions (gauche/bas/droite/haut) SI elle est "à portée de laser" —
// PAS seulement adjacente: on scanne comme un laser de charge colorée
// (transparent au VOID, mais arrêté par tout autre obstacle — mur, miroir,
// charge, autre prisme...) jusqu'à la première lumière
// rencontrée sur cette ligne/colonne (voir `_scanRangeForLight`). La
// "première couleur" (celle à gauche) s'applique dès la PREMIÈRE lumière
// en portée (0 et 1 lumière en portée donnent donc le même état de
// base) ; chaque lumière SUPPLÉMENTAIRE en portée (la 2e, 3e, 4e...)
// pivote l'ordre d'un cran (90°) de plus (voir PRISM_COLOR_SEQUENCE
// ci-dessous). L'ordre relatif reste toujours rouge→vert→bleu→blanc,
// seul le point de départ pivote.
//
// L'icône affichée est volontairement EN AVANCE d'un cran sur cette
// rotation "appliquée": elle montre où ira la couleur de la PROCHAINE
// lumière plutôt que la couleur déjà attribuée aux lumières en place —
// le joueur doit pouvoir anticiper avant de poser, pas seulement
// constater après coup (voir `appliedRotation` vs `displayRotation`
// dans recompute()). Les lumières déjà posées, elles, ne changent
// jamais rétroactivement de couleur.
//
// Pyra (PYRA, token "Y"): neurone pyramidal. Contrairement à une charge
// (CLUE) qui exige un nombre EXACT de lumières adjacentes, Pyra n'a pas
// de quantité fixe: il est "activé" dès qu'il a entre 1 et 3 lumières
// adjacentes (n'importe lequel de ces comptes suffit), et surchargé à 4
// (comme n'importe quelle charge en surcharge). Son identité est une
// instabilité tricolore: une fois activé, il tire un laser dont la
// couleur dépend du nombre de lumières adjacentes — 1=rouge, 2=vert,
// 3=bleu — exactement comme une charge colorée satisfaite, sauf que la
// couleur n'est pas fixée au level-design mais recalculée à chaque passe.
//
// [Expérimental] Neurone miroir (MIRROR_NEURON, token "M"): obstacle fixe
// du niveau (non posable par le joueur). Dès qu'une lumière se trouve
// N'IMPORTE OÙ sur sa ligne ou sa colonne — PAS de ligne de vue requise:
// peu importe la distance et peu importe ce qu'il y a entre les deux (mur,
// void, un autre obstacle, même une autre lumière) — le neurone la
// duplique AUTOMATIQUEMENT en symétrie centrale par rapport à lui-même (si
// la lumière est à distance d du neurone dans une direction, le duplicata
// apparaît à distance d dans la direction opposée). Seule la case CIBLE du
// duplicata doit rester légale (dans la grille, case vide, pas déjà
// occupée, pas déjà illuminée) — voir `_computeMirrorDuplicates`, qui
// balaie chaque ligne/colonne jusqu'au premier neurone miroir rencontré
// (ignorant tout le reste en chemin) plutôt que jusqu'au premier obstacle.
// Si la case cible calculée n'est pas légale, TOUT le mouvement est annulé
// (toggleLight renvoie false, son d'erreur) — on ne pose jamais la lumière
// d'origine seule sans son duplicata. Retirer l'une des deux lumières
// d'une paire ainsi liée retire l'autre avec elle (voir `_mirrorLinks`,
// `_computeMirrorDuplicates`).
//
// Réaction en chaîne: si un duplicata se retrouve à son tour sur la
// ligne/colonne d'un AUTRE neurone miroir (à n'importe quelle distance,
// obstacles ou pas), celui-ci le duplique également, et ainsi de suite
// (voir `_computeMirrorDuplicates`, parcours en largeur avec anti-boucle:
// un rebond qui retomberait sur une case déjà comptée dans CE mouvement —
// typiquement l'aller-retour à travers le MÊME neurone miroir — ne relance
// pas de duplication, il referme juste la chaîne). Comme pour un seul
// neurone, c'est tout ou rien: si UNE seule duplication de la chaîne est
// impossible, le mouvement entier est annulé. Tous les duplicatas d'une
// même chaîne restent directement liés à la lumière d'ORIGINE (pas à leur
// duplicata parent) — retirer l'origine les retire tous d'un coup, et ils
// héritent tous directement de sa couleur (voir `_mirrorDuplicateOf`).
//
// Le duplicata N'EST PAS une lumière indépendante à part entière:
// - Il copie TOUJOURS la couleur effective de la lumière d'origine (voir
//   `_mirrorDuplicateOf`), même si aucun laser de charge ne touche
//   directement sa propre case — recalculé à chaque `recompute()`, donc
//   tout changement de couleur de l'origine (nouvelle charge satisfaite,
//   miroir/filtre traversé...) se répercute immédiatement sur le
//   duplicata, pas seulement au moment où il apparaît.
// - Il ne compte pas dans le nombre de coups affiché (voir
//   `getPlacedLightCount()`/`getPlacedLights()`, qui excluent les clés
//   présentes dans `_mirrorDuplicateOf`).
// - Il n'est pas interactif: cliquer directement sur sa case ne fait rien
//   (voir `toggleLight`, qui refuse la suppression directe d'un
//   duplicata) — seul le retrait de la lumière d'origine le fait
//   disparaître, en cascade via `_mirrorLinks`.
// - Un laser de charge qui atteindrait directement un duplicata (au lieu
//   de sa propre couleur héritée) n'a AUCUN effet sur sa couleur — voir
//   `cell._mirrorLaserBlocked` (calculé dans recompute(), lu par
//   render.js) pour le signaler visuellement plutôt que de laisser
//   croire que ce laser a fonctionné.

export const CellType = {
  VOID: "void", // hors-grille: bloque la lumière blanche, transparent aux lasers colorés
  WALL: "wall", // mur: bloque la lumière blanche ET les lasers colorés
  EMPTY: "empty", // case vide, peut recevoir une lumière
  CLUE: "clue", // obstacle plein "case à charge" (1 à 4 lumières adjacentes)
  FORBIDDEN: "forbidden", // obstacle plein: aucune lumière adjacente autorisée
  MIRROR: "mirror", // dévie un laser de charge colorée de 90°, opaque au reste
  PRISM: "prism", // colore ses 4 voisins directs, rotation selon lumières adjacentes
  MIRROR_NEURON: "mirror_neuron", // [expérimental] duplique en symétrie toute lumière qui l'éclaire
  PYRA: "pyra", // neurone pyramidal: activé dès 1 lumière adjacente (jusqu'à 3), surcharge à 4
};

// Ordre fixe des directions pour le prisme (gauche, bas, droite, haut) et
// séquence fixe de couleurs qui leur est assignée, avant rotation. Exportés
// pour que render.js puisse reconstruire les couleurs "de base" (rotation
// 0) et les faire pivoter visuellement lui-même (voir prismIcon).
export const PRISM_DIRECTIONS = [
  [0, -1], // gauche
  [1, 0], // bas
  [0, 1], // droite
  [-1, 0], // haut
];
export const PRISM_COLOR_SEQUENCE = ["r", "g", "b", "w"];

// Une case vide peut porter une couleur cible : la lumière blanche de base
// (r,g,b tous vrais) doit ressortir exactement dans cette combinaison une
// fois arrivée sur la case (après mélange éventuel de plusieurs rayons).
const TARGET_CODES = {
  r: { r: true, g: false, b: false },
  g: { r: false, g: true, b: false },
  b: { r: false, g: false, b: true },
  y: { r: true, g: true, b: false }, // jaune = rouge + vert
  c: { r: false, g: true, b: true }, // cyan = vert + bleu
  m: { r: true, g: false, b: true }, // magenta = rouge + bleu
  w: { r: true, g: true, b: true }, // blanc = les trois
};

// Une case à charge ne peut porter qu'une couleur primaire pure.
const CHARGE_COLOR_CODES = { r: "r", g: "g", b: "b" };

// Les tokens d'une rangée sont séparés par des espaces (voir levels.js), ce
// qui permet des tokens à 2 caractères ("2r" = charge 2, couleur rouge)
// sans ambiguïté avec une case-cible seule ("r").
function parseCellToken(token) {
  if (token === "X" || token === "#") return { type: CellType.VOID };
  if (token === "W") return { type: CellType.WALL };
  if (token === ".") return { type: CellType.EMPTY, target: null };
  if (token === "0") return { type: CellType.FORBIDDEN };
  if (token === "/" || token === "\\") return { type: CellType.MIRROR, orientation: token };
  if (TARGET_CODES[token]) return { type: CellType.EMPTY, target: { ...TARGET_CODES[token] } };

  const p = /^P([rgbw])?$/.exec(token);
  if (p) return { type: CellType.PRISM, firstColor: p[1] || "r" };

  if (token === "M") return { type: CellType.MIRROR_NEURON };
  if (token === "Y") return { type: CellType.PYRA };

  const m = /^([1-4])([rgb])?$/.exec(token);
  if (m) {
    return {
      type: CellType.CLUE,
      number: Number(m[1]),
      color: m[2] ? CHARGE_COLOR_CODES[m[2]] : null,
    };
  }
  throw new Error(`Code de case inconnu: "${token}"`);
}

const DIRECTIONS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

const WHITE = { r: true, g: true, b: true };

function sameColor(a, b) {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/** Convertit une couleur de charge (lettre unique "r"/"g"/"b") en objet de
 * canaux {r,g,b}, pour pouvoir la faire évoluer (union) au fil des miroirs
 * traversés — une seule lettre ne peut plus représenter un mélange. */
function channelColor(ch) {
  return { r: ch === "r", g: ch === "g", b: ch === "b" };
}

function hasAnyChannel(c) {
  return c.r || c.g || c.b;
}

export class LightUpGrid {
  constructor(level) {
    this.rows = level.rows;
    this.cols = level.cols;
    this.cells = level.cells.map((row) => {
      // Une rangée peut être une chaîne concaténée classique ("2....#",
      // un caractère = une case) ou, si elle contient un espace, une liste de
      // tokens espacés (permet des tokens à 2 caractères comme "2r").
      const tokens = Array.isArray(row)
        ? row
        : row.includes(" ")
        ? row.trim().split(/\s+/)
        : row.split("");
      return tokens.map(parseCellToken);
    });
    this.lights = new Set(); // clés "r,c"
    this.lasers = []; // [{ from:[r,c], to:[r,c], color }] pour le rendu
    // Neurone miroir [expérimental]: graphe non-orienté des paires de
    // lumières liées par une duplication (clé -> Set des clés liées).
    // Retirer une lumière retire toute sa composante connexe (voir
    // toggleLight). Persiste tant que les lumières existent, indépendant
    // de recompute().
    this._mirrorLinks = new Map();
    // Neurone miroir [expérimental]: clé de duplicata -> clé de la lumière
    // d'origine qu'il copie. Permet (a) de savoir qu'une case donnée est un
    // duplicata (non interactif, exclu du décompte de coups) et (b) de
    // toujours lire la couleur EFFECTIVE de l'origine plutôt que celle
    // (souvent absente) du duplicata lui-même — voir recompute() étape 3.
    this._mirrorDuplicateOf = new Map();
    // Dernier ensemble de cellules affectées par le tout dernier appel à
    // toggleLight/setLightRaw ([{r, c, action}]) — permet à l'appelant
    // (main.js, editor.js) de savoir qu'UN clic a pu poser/retirer
    // PLUSIEURS lumières à la fois (l'origine + ses duplicatas) et de
    // traiter ce groupe comme une seule action atomique (historique
    // d'annulation, persistance des lumières de test dans l'éditeur).
    this._lastAffected = [];
    // Neurone miroir [expérimental], pour le rendu de l'animation "fil"
    // (voir render.js: playMirrorSuccess/playMirrorFailure) — pas d'usage
    // pour les règles du jeu elles-mêmes, uniquement des traces du DERNIER
    // appel à _computeMirrorDuplicates (via toggleLight):
    // - `_lastMirrorLinks`: un item par duplication réussie de ce
    //   mouvement ({from, neuron, to}, un par saut de chaîne), vide si le
    //   mouvement n'a touché aucun neurone miroir.
    // - `_lastMirrorFailure`: {neuron, from, attempted} si le mouvement a
    //   été refusé PARCE QU'une duplication précise était impossible,
    //   sinon null (un `toggleLight` refusé pour une autre raison, ex.
    //   case déjà illuminée, ne doit pas être confondu avec ça — voir le
    //   reset en tête de toggleLight).
    this._lastMirrorLinks = [];
    this._lastMirrorFailure = null;
    // Voir toggleLight({full}) / _recomputeAfterToggle: le mode "léger"
    // (utilisé par le solveur pendant sa recherche, voir solver.js) saute le
    // traçage de laser et la diffusion d'illumination — sûr UNIQUEMENT parce
    // que ni l'un ni l'autre n'influence le calcul lui-même, sauf pour le
    // Neurone miroir [expérimental] : `_computeMirrorDuplicates` lit
    // `target._illuminated` pour juger une case cible légale, qui deviendrait
    // périmée sans un recompute() complet. Calculé une seule fois ici (la
    // géométrie de la grille ne change jamais) plutôt qu'à chaque appel.
    this._hasMirrorNeuron = this.cells.some((row) => row.some((cell) => cell.type === CellType.MIRROR_NEURON));
    this.recompute();
  }

  /** Voir `_lastAffected` ci-dessus. */
  getLastAffectedCells() {
    return this._lastAffected;
  }

  /** Voir `_lastMirrorLinks` ci-dessus. Valide seulement juste après un
   * `toggleLight` qui a retourné "placed". */
  getLastMirrorLinks() {
    return this._lastMirrorLinks;
  }

  /** Voir `_lastMirrorFailure` ci-dessus. Valide seulement juste après un
   * `toggleLight` qui a retourné `false`. */
  getLastMirrorFailure() {
    return this._lastMirrorFailure;
  }

  key(r, c) {
    return `${r},${c}`;
  }

  inBounds(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  cellAt(r, c) {
    return this.inBounds(r, c) ? this.cells[r][c] : null;
  }

  hasLight(r, c) {
    return this.lights.has(this.key(r, c));
  }

  /** Neurone miroir [expérimental]: vrai si (r,c) porte actuellement un
   * duplicata (pas la lumière d'origine) — voir `_mirrorDuplicateOf`. */
  isMirrorDuplicate(r, c) {
    return this._mirrorDuplicateOf.has(this.key(r, c));
  }

  /** Lumières "réelles" (posées par le joueur), en excluant les duplicatas
   * de neurone miroir [expérimental] — ce sont eux qui comptent dans le
   * nombre de coups et dans une solution retournée par le solveur. */
  getPlacedLights() {
    return Array.from(this.lights)
      .filter((k) => !this._mirrorDuplicateOf.has(k))
      .map((k) => k.split(",").map(Number));
  }

  getPlacedLightCount() {
    return this.lights.size - this._mirrorDuplicateOf.size;
  }

  /** Vrai si une lumière POURRAIT être posée en (r,c) dans l'état ACTUEL du
   * plateau (case vide, pas déjà porteuse d'une lumière, pas déjà
   * illuminée par une autre) — sans muter quoi que ce soit, contrairement à
   * `toggleLight`. Reprend seulement les deux premières conditions de
   * `toggleLight` (pas la chaîne de neurone miroir [expérimental], cas plus
   * rare qu'il n'est pas utile de dupliquer ici) : suffisant pour un appelant
   * qui veut juste savoir si un clic à cet endroit a une chance d'aboutir
   * avant de le tenter pour de vrai (voir main.js: findNextHintCell, qui
   * s'en sert pour ne jamais proposer un indice sur une case-solution
   * devenue inatteignable parce qu'une lumière mal placée l'illumine déjà). */
  canPlaceLightAt(r, c) {
    const cell = this.cellAt(r, c);
    if (!cell || cell.type !== CellType.EMPTY) return false;
    if (this.lights.has(this.key(r, c))) return false;
    return !cell._illuminated;
  }

  /** Relie symétriquement deux clés dans `_mirrorLinks` (graphe en étoile
   * centré sur l'origine: seule `_collectLinkedGroup` depuis l'origine a
   * besoin d'être fiable, les duplicatas n'étant plus interactifs). */
  _link(a, b) {
    const linksA = this._mirrorLinks.get(a) || new Set();
    linksA.add(b);
    this._mirrorLinks.set(a, linksA);
    const linksB = this._mirrorLinks.get(b) || new Set();
    linksB.add(a);
    this._mirrorLinks.set(b, linksB);
  }

  /** Retire `k` de `_mirrorLinks` (clé et toute référence dans les Sets
   * des autres clés). */
  _unlinkAll(k) {
    const links = this._mirrorLinks.get(k);
    if (links) for (const other of links) this._mirrorLinks.get(other)?.delete(k);
    this._mirrorLinks.delete(k);
  }

  /**
   * Essaie de poser ou retirer une lumière sur la case (r,c).
   * Retourne "placed", "removed", ou false si l'action est invalide
   * (case non vide, déjà illuminée par une autre lumière, case portant un
   * duplicata de neurone miroir [expérimental] non retirable directement,
   * ou si une duplication requise est impossible).
   * Voir `getLastAffectedCells()` pour la liste complète des cases
   * effectivement modifiées (peut être plus d'une, voir neurone miroir).
   *
   * `full` (par défaut `true`, TOUS les appelants existants — jeu, éditeur —
   * inchangés) : passé à `false` par le solveur pendant sa recherche (voir
   * solver.js) pour ne recalculer que l'état des indices plutôt qu'un
   * `recompute()` complet — voir `_recomputeAfterToggle` pour la garde de
   * sécurité (jamais léger en présence d'un Neurone miroir [expérimental]).
   */
  toggleLight(r, c, { full = true } = {}) {
    // Réinitialisé avant tout `return false` possible: un échec pour une
    // raison SANS RAPPORT avec un neurone miroir (case non vide, déjà
    // illuminée...) ne doit jamais laisser croire à l'appelant qu'il peut
    // lire un `getLastMirrorFailure()` pertinent pour CE refus précis.
    this._lastMirrorFailure = null;

    const cell = this.cellAt(r, c);
    if (!cell || cell.type !== CellType.EMPTY) return false;

    const k = this.key(r, c);
    if (this.lights.has(k)) {
      // Un duplicata n'est pas interactif: on ne peut le retirer qu'en
      // retirant la lumière d'origine qu'il copie (voir en tête de fichier).
      if (this._mirrorDuplicateOf.has(k)) return false;

      const group = this._collectLinkedGroup(k);
      this._lastAffected = [];
      for (const gk of group) {
        this.lights.delete(gk);
        const originKey = this._mirrorDuplicateOf.get(gk) || null;
        this._mirrorDuplicateOf.delete(gk);
        this._unlinkAll(gk);
        const [gr, gc] = gk.split(",").map(Number);
        this._lastAffected.push({ r: gr, c: gc, action: "removed", isDuplicate: !!originKey, originKey });
      }
      this._recomputeAfterToggle(full);
      return "removed";
    }

    if (cell._illuminated) {
      return false; // règle: pas de pose sur une case déjà illuminée
    }

    // Neurone miroir [expérimental]: si poser ici illumine un ou plusieurs
    // neurones miroirs, chacun EXIGE sa duplication symétrique — tout ou
    // rien (voir le commentaire en tête de fichier).
    const duplicates = this._computeMirrorDuplicates(r, c);
    if (duplicates === null) return false;

    this.lights.add(k);
    this._lastAffected = [{ r, c, action: "placed", isDuplicate: false }];
    for (const dk of duplicates) {
      this.lights.add(dk);
      this._mirrorDuplicateOf.set(dk, k);
      this._link(k, dk);
      const [dr, dc] = dk.split(",").map(Number);
      this._lastAffected.push({ r: dr, c: dc, action: "placed", isDuplicate: true, originKey: k });
    }
    this._recomputeAfterToggle(full);
    return "placed";
  }

  /**
   * Cherche, pour une lumière qu'on voudrait poser en (r,c), tous les
   * neurones miroirs présents sur sa ligne ou sa colonne (dans chacune des
   * 4 directions) — SANS exigence de ligne de vue: on balaie jusqu'au
   * premier neurone miroir rencontré, quels que soient la distance et les
   * obstacles traversés en chemin (mur, void, une autre case, même une
   * autre lumière) — et calcule leur duplicata symétrique (même distance,
   * direction opposée, de l'autre côté du neurone ; seule la case CIBLE du
   * duplicata doit rester légale, voir en tête de fichier). Retourne la
   * liste des clés "r,c" à dupliquer, ou `null` si au moins une
   * duplication est impossible — dans ce cas l'appelant doit annuler tout
   * le mouvement, pas seulement la duplication en échec.
   */
  _computeMirrorDuplicates(r, c) {
    // Parcours en largeur: chaque nouveau duplicata est lui-même vérifié
    // dans ses 4 directions, exactement comme l'origine — c'est ce qui
    // permet la réaction en chaîne (voir en tête de fichier). `seen`
    // contient l'origine dès le départ: un rebond qui retomberait sur une
    // case déjà comptée dans ce même mouvement (typiquement l'aller-retour
    // à travers le MÊME neurone miroir, qui reflète mathématiquement
    // toujours vers le point de départ) referme juste la chaîne sans
    // relancer de duplication ni annuler le mouvement.
    const originKey = this.key(r, c);
    const seen = new Set([originKey]);
    const duplicates = [];
    const links = []; // { from:[r,c], neuron:[r,c], to:[r,c] }, un par saut de chaîne
    const queue = [[r, c]];
    this._lastMirrorFailure = null;
    // Un duplicata doit respecter la même règle "pas de pose sur une case
    // déjà illuminée" qu'une lumière normale — mais `target._illuminated`
    // ci-dessous ne reflète que l'état AVANT ce mouvement (recompute() n'a
    // pas encore tourné): il faut donc aussi vérifier explicitement contre
    // les lumières que CE mouvement est en train de poser (l'origine et les
    // duplicatas déjà validés plus tôt dans ce même parcours), sans quoi un
    // duplicata plus loin dans une chaîne peut se retrouver, une fois le
    // mouvement réellement appliqué, sur la même ligne/colonne à vue directe
    // que l'origine ou qu'un duplicata frère. `placedThisMove` grandit au
    // fur et à mesure des acceptations ; la relation de vue directe étant
    // symétrique, vérifier chaque nouvelle case contre tout ce qui est déjà
    // dedans suffit à couvrir toutes les paires.
    const placedThisMove = [[r, c]];

    while (queue.length) {
      const [pr, pc] = queue.shift();
      for (const [dr, dc] of DIRECTIONS) {
        let nr = pr + dr;
        let nc = pc + dc;
        // Ignore tout ce qui n'est pas un neurone miroir en chemin (mur,
        // void, autre case vide, autre lumière...) — seule sa présence
        // quelque part sur cette ligne/colonne compte, pas ce qu'il y a
        // entre les deux.
        while (this.inBounds(nr, nc) && this.cells[nr][nc].type !== CellType.MIRROR_NEURON) {
          nr += dr;
          nc += dc;
        }
        if (!this.inBounds(nr, nc)) continue; // aucun neurone miroir dans cette direction

        const tr = 2 * nr - pr;
        const tc = 2 * nc - pc;
        const tk = this.key(tr, tc);
        if (seen.has(tk)) continue;

        const target = this.cellAt(tr, tc);
        const seesLightThisMove =
          !!target &&
          target.type === CellType.EMPTY &&
          placedThisMove.some(([lr, lc]) => this._lineOfSight(tr, tc, lr, lc));
        if (
          !target ||
          target.type !== CellType.EMPTY ||
          this.hasLight(tr, tc) ||
          target._illuminated ||
          seesLightThisMove
        ) {
          // Case déjà éclairée/occupée, vide (void), mur, ou à vue directe
          // d'une lumière que ce même mouvement est en train de poser
          // (l'origine ou un duplicata frère) : cette duplication précise
          // est impossible, donc tout le mouvement l'est aussi. On garde de
          // quoi animer l'échec (voir render.js: playMirrorFailure) avant
          // d'abandonner.
          this._lastMirrorFailure = { neuron: [nr, nc], from: [pr, pc], attempted: [tr, tc] };
          return null;
        }
        seen.add(tk);
        duplicates.push(tk);
        placedThisMove.push([tr, tc]);
        links.push({ from: [pr, pc], neuron: [nr, nc], to: [tr, tc] });
        queue.push([tr, tc]);
      }
    }
    this._lastMirrorLinks = links;
    return duplicates;
  }

  /** Vrai si (r1,c1) et (r2,c2) sont sur la même ligne ou colonne avec un
   * chemin dégagé entre elles (aucune case non-EMPTY strictement entre les
   * deux) — c'est-à-dire si une lumière posée sur l'une illuminerait
   * l'autre, exactement selon la même logique que la propagation de
   * l'illumination en étape 3 de `recompute()` (une case EMPTY ne bloque
   * jamais la vue, qu'elle porte elle-même une lumière ou non). Utilisé par
   * `_computeMirrorDuplicates` pour valider un duplicata contre les autres
   * lumières que le MÊME mouvement est en train de poser. */
  _lineOfSight(r1, c1, r2, c2) {
    if (!this.inBounds(r1, c1) || !this.inBounds(r2, c2)) return false;
    if (r1 === r2 && c1 === c2) return false;
    if (r1 === r2) {
      const [lo, hi] = c1 < c2 ? [c1, c2] : [c2, c1];
      for (let c = lo + 1; c < hi; c++) {
        if (this.cells[r1][c].type !== CellType.EMPTY) return false;
      }
      return true;
    }
    if (c1 === c2) {
      const [lo, hi] = r1 < r2 ? [r1, r2] : [r2, r1];
      for (let r = lo + 1; r < hi; r++) {
        if (this.cells[r][c1].type !== CellType.EMPTY) return false;
      }
      return true;
    }
    return false;
  }

  /** Composante connexe de `k` dans le graphe `_mirrorLinks` (k inclus). */
  _collectLinkedGroup(k) {
    const seen = new Set([k]);
    const stack = [k];
    while (stack.length) {
      const cur = stack.pop();
      const links = this._mirrorLinks.get(cur);
      if (!links) continue;
      for (const other of links) {
        if (!seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    return seen;
  }

  /**
   * Pose ou retire une lumière SANS repasser par les règles de validation
   * de toggleLight (ex: "pas de pose sur une case déjà illuminée", ni la
   * duplication du neurone miroir). Utilisé par l'historique d'annulation:
   * on restaure un état par lequel le joueur est déjà passé (r,c) fait
   * partie d'un groupe déjà entièrement reproduit cellule par cellule par
   * l'appelant, donc on n'a pas à re-vérifier qu'il est atteignable —
   * seulement à le reproduire fidèlement.
   *
   * `meta` (optionnel, voir `_lastAffected`/`getLastAffectedCells`) permet
   * de restaurer aussi fidèlement `_mirrorDuplicateOf`/`_mirrorLinks` pour
   * une case qui était un duplicata de neurone miroir [expérimental]:
   * sans ça, Annuler perdrait le lien après un retrait (le duplicata
   * redeviendrait interactif) ou après une repose (sa couleur ne suivrait
   * plus celle de son origine).
   */
  setLightRaw(r, c, on, meta = {}) {
    const k = this.key(r, c);
    if (on) {
      this.lights.add(k);
      if (meta.isDuplicate && meta.originKey) {
        this._mirrorDuplicateOf.set(k, meta.originKey);
        this._link(meta.originKey, k);
      }
    } else {
      this.lights.delete(k);
      this._mirrorDuplicateOf.delete(k);
      this._unlinkAll(k);
    }
    this._lastAffected = [{ r, c, action: on ? "placed" : "removed" }];
    this.recompute();
  }

  /** Compte les lumières/directions libres adjacentes à (r,c) parmi les 4 directions. */
  _adjacentLightCount(r, c) {
    let count = 0;
    for (const [dr, dc] of DIRECTIONS) {
      const nCell = this.cellAt(r + dr, c + dc);
      if (nCell && nCell.type === CellType.EMPTY && this.hasLight(r + dr, c + dc)) count++;
    }
    return count;
  }

  /**
   * Cherche, en scannant depuis (r,c) dans la direction (dr,dc), la
   * première lumière "à portée de laser" — utilisé par le Prisme (voir en
   * tête de fichier): transparent au VOID (comme un laser de charge
   * colorée), mais arrêté par tout autre obstacle (mur, miroir, filtre,
   * charge, autre prisme...). Pas de déviation ni de changement de canal
   * ici, juste une portée en ligne droite sur la ligne/colonne visée.
   * Retourne [nr, nc] si trouvée, sinon null.
   */
  _scanRangeForLight(r, c, dr, dc) {
    let nr = r + dr;
    let nc = c + dc;
    while (this.inBounds(nr, nc)) {
      const nCell = this.cells[nr][nc];
      if (nCell.type === CellType.EMPTY) {
        if (this.hasLight(nr, nc)) return [nr, nc];
        nr += dr;
        nc += dc;
        continue;
      }
      if (nCell.type === CellType.VOID) {
        nr += dr;
        nc += dc;
        continue;
      }
      break; // obstacle opaque: la portée s'arrête ici
    }
    return null;
  }

  /**
   * Sous-ensemble de `recompute()` : ne calcule QUE `_state`/`_adjacentLights`/
   * `_activeColor` des cases FORBIDDEN/PYRA/CLUE (dépend seulement des
   * positions des lumières, jamais de l'illumination/des lasers). C'est
   * précisément — et UNIQUEMENT — ce dont `solver.js` a besoin pendant sa
   * recherche (`propagate`/branchement ne lisent jamais `_illuminated`/
   * `_lit`/laser, voir `isWon` pour la seule consommatrice de ces champs) —
   * voir `toggleLight({full:false})`. Beaucoup moins cher qu'un
   * `recompute()` complet : pas de traçage de laser (deux passes sur toutes
   * les charges colorées), pas de scan de prisme, pas de diffusion
   * d'illumination (un parcours en rayon par lumière posée).
   */
  _computeClueStates() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];

        if (cell.type === CellType.FORBIDDEN) {
          cell._adjacentLights = this._adjacentLightCount(r, c);
          cell._state = cell._adjacentLights === 0 ? "success" : "error";
          continue;
        }

        if (cell.type === CellType.PYRA) {
          // Pyra n'a pas de quantité fixe à atteindre (contrairement à
          // CLUE) : "activé" dès 1 lumière adjacente, jusqu'à 3 — au-delà
          // c'est la surcharge (4, comme n'importe quelle charge). La
          // couleur du laser qu'il tire dépend du nombre de lumières
          // adjacentes: 1=rouge, 2=vert, 3=bleu (identité tricolore
          // instable qui se "stabilise" sur un canal selon combien de
          // lumières le touchent).
          const adjacentLights = this._adjacentLightCount(r, c);
          cell._adjacentLights = adjacentLights;
          if (adjacentLights === 0) {
            cell._state = "neutral";
            cell._activeColor = null;
          } else if (adjacentLights <= 3) {
            cell._state = "success";
            cell._activeColor = adjacentLights === 1 ? "r" : adjacentLights === 2 ? "g" : "b";
          } else {
            cell._state = "error"; // surcharge à 4
            cell._activeColor = null;
          }
          continue;
        }

        if (cell.type !== CellType.CLUE) continue;

        let adjacentLights = 0;
        let adjacentEmptyFree = 0;
        for (const [dr, dc] of DIRECTIONS) {
          const nCell = this.cellAt(r + dr, c + dc);
          if (!nCell || nCell.type !== CellType.EMPTY) continue;
          if (this.hasLight(r + dr, c + dc)) adjacentLights++;
          else adjacentEmptyFree++;
        }

        // Exposé pour le rendu (pastilles vides/remplies/en surcharge, sans
        // afficher le chiffre lui-même).
        cell._adjacentLights = adjacentLights;

        if (adjacentLights === cell.number) {
          cell._state = "success";
        } else if (adjacentLights > cell.number) {
          cell._state = "error";
        } else if (adjacentEmptyFree === 0) {
          cell._state = "error"; // plus aucune case libre pour atteindre le chiffre
        } else {
          cell._state = "neutral";
        }
      }
    }
  }

  /**
   * Sous-ensemble "moyen" de `recompute()` : `_computeClueStates()` PLUS une
   * diffusion d'illumination simplifiée (juste `_illuminated`, un booléen —
   * PAS `_litColor`/`_hits`/`_colorMatch`, qui ont besoin du traçage de
   * laser pour être exacts). Contrairement à `_computeClueStates()` seule,
   * `_illuminated` doit rester à jour à CHAQUE `toggleLight`, pas seulement
   * aux feuilles de la recherche : `toggleLight` lui-même refuse une pose sur
   * une case déjà `_illuminated` (règle du jeu), et `_computeMirrorDuplicates`
   * (Neurone miroir [expérimental]) en dépend aussi pour juger une case
   * cible légale — un simple `_computeClueStates()` isolé, essayé d'abord,
   * laissait `_illuminated` périmé et acceptait/refusait des poses à tort
   * (régression détectée par comparaison avant/après sur tous les niveaux de
   * `levels.js`, voir l'historique). Reste nettement moins cher qu'un
   * `recompute()` complet : pas de traçage de laser (deux passes sur les
   * charges colorées), pas de scan de prisme — seulement ce qui est
   * structurellement nécessaire à la légalité des coups.
   */
  _computeIlluminationOnly() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.type === CellType.EMPTY) cell._illuminated = false;
      }
    }
    for (const k of this.lights) {
      const [r, c] = k.split(",").map(Number);
      const selfCell = this.cellAt(r, c);
      if (selfCell) selfCell._illuminated = true;
      for (const [dr, dc] of DIRECTIONS) {
        let nr = r + dr;
        let nc = c + dc;
        while (this.inBounds(nr, nc)) {
          const nCell = this.cells[nr][nc];
          if (nCell.type !== CellType.EMPTY) break;
          nCell._illuminated = true;
          nr += dr;
          nc += dc;
        }
      }
    }
  }

  /**
   * Choisit, après un `toggleLight`, entre un `recompute()` complet et le
   * sous-ensemble "moyen" (`_computeClueStates()` + `_computeIlluminationOnly()`)
   * — voir le commentaire du constructeur : jamais allégé si la grille
   * contient un Neurone miroir [expérimental] (`_computeMirrorDuplicates` a
   * besoin d'un `_illuminated` exact, déjà garanti ici, MAIS aussi de
   * `_litColor` pour d'autres cas limites non audités — on préfère s'abstenir
   * plutôt que risquer une régression sur une mécanique aussi délicate).
   * `full=true` (comportement par défaut de `toggleLight`, tous les
   * appelants existants — jeu, éditeur — inchangés) redemande toujours la
   * version complète.
   */
  _recomputeAfterToggle(full) {
    if (full || this._hasMirrorNeuron) this.recompute();
    else {
      this._computeClueStates();
      this._computeIlluminationOnly();
    }
  }

  /** Recalcule états des indices/interdictions, lasers de couleur, puis illumination. */
  recompute() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.type === CellType.EMPTY) {
          cell._litColor = { r: false, g: false, b: false };
          cell._litWhite = false;
          cell._hits = 0; // nombre de rayons distincts qui touchent cette case (intersection si >= 2)
          // Neurone miroir [expérimental]: un laser qui atteindrait
          // directement un duplicata n'a AUCUN effet sur sa couleur (il
          // hérite toujours de son origine, voir étape 3 ci-dessous) — ce
          // drapeau permet à render.js de le signaler visuellement plutôt
          // que de laisser croire que ce laser a fonctionné normalement.
          cell._mirrorLaserBlocked = false;
        } else if (cell.type === CellType.MIRROR) {
          // Couleurs actuellement en train de traverser ce miroir (rendu:
          // "miroir actif"), recalculé à chaque passe donc jamais périmé.
          cell._mirrorColor = { r: false, g: false, b: false };
        }
      }
    }

    // 1) États des cases à charge / interdites (dépend seulement des positions
    //    des lumières, pas encore de l'illumination).
    this._computeClueStates();

    // 2) Lasers de couleur: pour chaque case à charge colorée et satisfaite,
    //    chaque direction qui ne pointe pas vers une lumière tire un laser
    //    jusqu'à la première case-lumière rencontrée sur sa ligne/colonne —
    //    sauf s'il traverse un miroir, qui le dévie de 90° au lieu de
    //    l'arrêter (voir CellType.MIRROR). Le tracé complet (départ +
    //    chaque coude + arrivée) est conservé dans `points` pour le rendu.
    //
    //    Deux passes sont nécessaires pour gérer le mélange de couleurs à
    //    un miroir partagé: si un laser bleu arrive par un côté et un
    //    rouge par l'autre, le miroir devient violet (déjà le cas) ET les
    //    DEUX déviations qui en repartent doivent elles aussi devenir
    //    violettes — pas garder chacune sa couleur d'origine. Or au
    //    moment où on trace le premier rayon, on ne sait pas encore que le
    //    second va aussi traverser ce miroir. Passe A: on trace tous les
    //    rayons (géométrie + accumulation de `_mirrorColor` par miroir,
    //    comme avant) sans encore figer de couleur de rendu. Passe B: une
    //    fois tous les miroirs "vus" par tous les rayons, on rejoue chaque
    //    tracé et sa couleur évolue (union de canaux, jamais de retrait) à
    //    chaque miroir traversé, avec la couleur COMPLÈTE de ce miroir —
    //    pas juste la contribution de ce rayon.
    this.lasers = [];
    const tints = new Map(); // clé lumière -> {r,g,b} accumulé (mélange additif)
    const maxBounces = this.rows * this.cols * 4 + 8; // garde-fou anti-boucle (miroirs en cycle)
    const rawRays = []; // passe A: géométrie brute, couleur pas encore résolue

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        const clueReady = cell.type === CellType.CLUE && cell.color && cell._state === "success";
        const pyraReady = cell.type === CellType.PYRA && cell._state === "success";
        if (!clueReady && !pyraReady) continue;
        // Une charge colorée classique a une couleur fixe ; Pyra la
        // recalcule à chaque passe selon son nombre de lumières
        // adjacentes (voir _activeColor ci-dessus).
        const baseColor = pyraReady ? cell._activeColor : cell.color;

        for (const [dr, dc] of DIRECTIONS) {
          const neighbor = this.cellAt(r + dr, c + dc);
          if (!neighbor) continue; // hors grille: pas de direction à tirer
          if (neighbor.type === CellType.EMPTY && this.hasLight(r + dr, c + dc)) continue; // direction "utilisée"

          let curDr = dr;
          let curDc = dc;
          let nr = r + dr;
          let nc = c + dc;
          const points = [[r, c]];
          let segmentEmpty = null; // dernière case vide du segment courant (reset à chaque coude)
          let hitLight = null;
          let bounces = 0;

          while (this.inBounds(nr, nc)) {
            const nCell = this.cells[nr][nc];

            if (nCell.type === CellType.EMPTY && this.hasLight(nr, nc)) {
              hitLight = [nr, nc];
              break;
            }

            if (nCell.type === CellType.VOID) {
              // Hors-grille: transparent aux lasers colorés (contrairement
              // à la lumière blanche de base, qui elle s'arrête toujours
              // sur toute case non-EMPTY, voir plus bas) — on continue tout
              // droit sans ajouter de point ni casser le segment courant.
              nr += curDr;
              nc += curDc;
              continue;
            }

            if (nCell.type === CellType.MIRROR) {
              points.push([nr, nc]);
              bounces += 1;
              if (bounces > maxBounces) break; // cycle de miroirs: on abandonne ce tracé
              // "/" renvoie (dr,dc) -> (-dc,-dr) ; "" renvoie (dr,dc) -> (dc,dr).
              [curDr, curDc] = nCell.orientation === "/" ? [-curDc, -curDr] : [curDc, curDr];
              nCell._mirrorColor[baseColor] = true; // union des couleurs qui traversent ce miroir
              segmentEmpty = null;
              nr += curDr;
              nc += curDc;
              continue;
            }

            if (nCell.type !== CellType.EMPTY) break; // obstacle opaque: le laser s'arrête ici
            segmentEmpty = [nr, nc];
            nr += curDr;
            nc += curDc;
          }

          if (hitLight) points.push(hitLight);
          else if (segmentEmpty) points.push(segmentEmpty);

          if (points.length > 1) {
            // `points` garde toujours: départ, puis chaque miroir
            // traversé (dans l'ordre), puis l'arrivée (lumière ou dernière
            // case vide) — jamais de miroir en dernière position.
            rawRays.push({ points, baseColor, hitLight });
          }
        }
      }
    }

    for (const ray of rawRays) {
      const { points, baseColor, hitLight } = ray;
      let current = channelColor(baseColor);
      const segCount = points.length - 1;
      const colors = new Array(segCount);

      for (let i = 0; i < segCount; i++) {
        colors[i] = current;
        // Le point d'arrivée de ce segment est un miroir sauf s'il s'agit
        // du tout dernier point du tracé (lumière atteinte ou bout de
        // segment vide): un miroir mélange (union) avec TOUT ce qui le
        // traverse actuellement.
        if (i < segCount - 1) {
          const [wr, wc] = points[i + 1];
          const waypoint = this.cells[wr][wc];
          if (waypoint.type === CellType.MIRROR) {
            const mirrorColor = waypoint._mirrorColor;
            current = {
              r: current.r || mirrorColor.r,
              g: current.g || mirrorColor.g,
              b: current.b || mirrorColor.b,
            };
            // BUG CORRIGÉ (retour utilisateur: "le rayon qu'il renvoie est de
            // la bonne couleur (violet) mais sa couleur à lui (le style) est
            // rouge") : la Passe A (plus haut, `nCell._mirrorColor[baseColor]
            // = true`) ne tague chaque miroir qu'avec la couleur D'ORIGINE du
            // rayon (celle de la charge/Pyra de départ), jamais avec sa
            // couleur RÉELLEMENT ACCUMULÉE à ce point précis du tracé — un
            // rayon rouge qui devient violet en traversant un premier miroir
            // (mélangé là avec un rayon bleu d'une autre charge) continue
            // ensuite d'être tagué "rouge" sur chaque miroir SUIVANT qu'il
            // traverse, alors qu'il transporte déjà du violet. La Passe B
            // ci-dessus calcule pourtant déjà `current` correctement (c'est
            // ELLE qui alimente `colors[]`, donc le SEGMENT de rayon rendu
            // était déjà juste) — il manquait juste de reporter cette valeur
            // corrigée dans `_mirrorColor` du miroir lui-même, seule source
            // que `render.js`/`mirrorIcon` lit pour la couleur de l'ICÔNE.
            // Union monotone (n'enlève jamais un canal déjà vrai) — aucun
            // risque de régression sur le mélange déjà correct entre rayons
            // indépendants partageant un même miroir, seulement un
            // enrichissement pour les miroirs enchaînés sur un même tracé.
            mirrorColor.r = mirrorColor.r || current.r;
            mirrorColor.g = mirrorColor.g || current.g;
            mirrorColor.b = mirrorColor.b || current.b;
          }
        }
      }

      this.lasers.push({ points, colors, connected: !!hitLight });

      if (hitLight) {
        const tk = this.key(hitLight[0], hitLight[1]);
        if (this._mirrorDuplicateOf.has(tk)) {
          // Voir en tête de fichier: un duplicata ignore tout laser qui le
          // toucherait directement, il ne garde que la couleur héritée de
          // son origine — on ne verse donc rien dans `tints` pour lui,
          // juste le signal visuel.
          this.cells[hitLight[0]][hitLight[1]]._mirrorLaserBlocked = true;
        } else {
          const t = tints.get(tk) || { r: false, g: false, b: false };
          t.r = t.r || current.r;
          t.g = t.g || current.g;
          t.b = t.b || current.b;
          tints.set(tk, t);
        }
      }
    }

    // 2b) Prismes: case fixe qui colore, sur chacune de ses 4 directions
    //     (gauche/bas/droite/haut), la première lumière "à portée de
    //     laser" (voir _scanRangeForLight: transparent au VOID, arrêté par
    //     tout autre obstacle — PAS seulement son voisin direct), décalé
    //     d'un cran (90°) par lumière actuellement en portée. Alimente le
    //     même `tints` que les lasers de charge (mélange additif identique
    //     si une case est aussi atteinte par un laser par ailleurs), et
    //     ajoute un segment "laser" visuel vers chaque lumière en portée
    //     (potentiellement à distance, pas juste la case voisine).
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.type !== CellType.PRISM) continue;

        const rangeHits = PRISM_DIRECTIONS.map(([dr, dc]) => this._scanRangeForLight(r, c, dr, dc));
        const adjacentLights = rangeHits.filter((hit) => hit !== null).length;
        cell._prismAdjacentCount = adjacentLights; // lu par render.js pour l'angle de rotation visuel
        const baseIndex = PRISM_COLOR_SEQUENCE.indexOf(cell.firstColor);
        // Deux rotations distinctes:
        // - "appliquée": celle qui a réellement teinté les lumières déjà
        //   posées (la 1ère lumière en portée ne pivote pas, chaque
        //   lumière SUIVANTE pivote d'un cran de plus) — sert au calcul
        //   du tint, ne doit jamais changer rétroactivement la couleur
        //   d'une lumière déjà posée.
        // - "affichée" sur l'icône: en avance d'un cran sur l'appliquée,
        //   pour montrer où IRA la prochaine couleur plutôt que de
        //   simplement suivre ce qui vient de se passer (le joueur
        //   anticipe, il ne constate pas).
        const appliedRotation = (baseIndex + Math.max(0, adjacentLights - 1)) % PRISM_COLOR_SEQUENCE.length;
        const displayRotation = (baseIndex + adjacentLights) % PRISM_COLOR_SEQUENCE.length;

        const appliedColors = PRISM_DIRECTIONS.map((_, i) => PRISM_COLOR_SEQUENCE[(appliedRotation + i) % 4]);
        cell._prismColors = PRISM_DIRECTIONS.map((_, i) => PRISM_COLOR_SEQUENCE[(displayRotation + i) % 4]);

        rangeHits.forEach((hit, i) => {
          if (!hit) return;
          const [nr, nc] = hit;
          const neighbor = this.cells[nr][nc];

          const letter = appliedColors[i];
          const contributed = TARGET_CODES[letter];
          const tk = this.key(nr, nc);
          if (this._mirrorDuplicateOf.has(tk)) {
            neighbor._mirrorLaserBlocked = true; // voir en tête de fichier
          } else {
            const t = tints.get(tk) || { r: false, g: false, b: false };
            t.r = t.r || contributed.r;
            t.g = t.g || contributed.g;
            t.b = t.b || contributed.b;
            tints.set(tk, t);
          }

          this.lasers.push({
            points: [[r, c], [nr, nc]],
            colors: [{ ...contributed }],
            connected: true,
          });
        });
      }
    }

    // 3) Illumination : chaque lumière diffuse sa couleur effective (teinte
    //    reçue par laser, ou blanc par défaut) sur elle-même et ses 4 directions.
    //    Une lumière colorée prend le dessus sur une lumière blanche qui
    //    atteindrait la même case: on accumule donc les contributions
    //    colorées et blanches séparément (un simple OU ferait "avaler" toute
    //    couleur par le blanc, puisque blanc = les trois canaux à vrai).
    for (const k of this.lights) {
      const [r, c] = k.split(",").map(Number);
      // Neurone miroir [expérimental]: un duplicata n'a pas sa propre
      // couleur — il imite TOUJOURS celle de la lumière qu'il copie, même
      // si aucun laser n'atteint directement sa propre case (voir en tête
      // de fichier). On lit donc la teinte de l'origine, pas la sienne.
      const tintKey = this._mirrorDuplicateOf.get(k) || k;
      const tint = tints.get(tintKey);
      const effective = tint && hasAnyChannel(tint) ? tint : WHITE;
      const colored = effective !== WHITE;

      const mark = (cell) => {
        if (colored) {
          cell._litColor.r = cell._litColor.r || effective.r;
          cell._litColor.g = cell._litColor.g || effective.g;
          cell._litColor.b = cell._litColor.b || effective.b;
        } else {
          cell._litWhite = true;
        }
        cell._hits += 1;
      };

      const selfCell = this.cellAt(r, c);
      if (selfCell) mark(selfCell);

      for (const [dr, dc] of DIRECTIONS) {
        let nr = r + dr;
        let nc = c + dc;
        while (this.inBounds(nr, nc)) {
          const nCell = this.cells[nr][nc];
          if (nCell.type !== CellType.EMPTY) break; // obstacle opaque: le rayon s'arrête
          mark(nCell);
          nr += dr;
          nc += dc;
        }
      }
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.type !== CellType.EMPTY) continue;
        cell._lit = hasAnyChannel(cell._litColor)
          ? cell._litColor
          : cell._litWhite
          ? { ...WHITE }
          : { r: false, g: false, b: false };
        cell._illuminated = cell._lit.r || cell._lit.g || cell._lit.b;
        cell._colorMatch = cell.target ? sameColor(cell._lit, cell.target) : null;
      }
    }
  }

  clueState(r, c) {
    const cell = this.cellAt(r, c);
    return cell && (cell.type === CellType.CLUE || cell.type === CellType.FORBIDDEN)
      ? cell._state
      : null;
  }

  /**
   * `ignoreColor` (utilisé par le solveur pour évaluer l'ambiguïté "sans
   * la couleur") : une case-cible n'a alors besoin que d'être illuminée,
   * sans exiger la couleur exacte. Sert à vérifier qu'un niveau a
   * plusieurs solutions en lumière blanche mais une seule en couleur.
   *
   * `ignorePyra` (générateur uniquement, voir generator.js:
   * `pruneUnnecessaryPyra`) : `Set` de clés `"r,c"` de cases PYRA dont la
   * contrainte propre (1 à 3 lumières adjacentes) est ignorée pour CET
   * appel — la case reste un obstacle physique identique en tout point
   * (opacité, laser tricolore si `_state==="success"`), seul son état
   * n'est plus un motif de rejet. Sert à mesurer si le REMPLISSAGE
   * correct autour d'une case Pyra est déjà entièrement dicté par les
   * AUTRES contraintes du plateau (une seule solution même sans la
   * contrainte Pyra ⇒ décoratif) ou si sa propre contrainte est ce qui
   * départage plusieurs remplissages par ailleurs valides (⇒ nécessaire,
   * un vrai dilemme pour le joueur) — voir le commentaire de
   * `pruneUnnecessaryPyra` pour le raisonnement complet.
   */
  isWon({ ignoreColor = false, ignorePyra = null } = {}) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.type === CellType.EMPTY) {
          if (cell.target && !ignoreColor) {
            if (!cell._colorMatch) return false;
          } else if (!cell._illuminated) {
            return false;
          }
        }
        if (cell.type === CellType.CLUE && cell._state !== "success") return false;
        if (cell.type === CellType.FORBIDDEN && cell._state !== "success") return false;
        if (cell.type === CellType.PYRA && cell._state !== "success") {
          if (!(ignorePyra && ignorePyra.has(`${r},${c}`))) return false;
        }
      }
    }
    return true;
  }
}
