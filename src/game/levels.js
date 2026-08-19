// Niveaux tutoriels (1-5) puis niveaux avancés (6-10, difficulté et taille
// croissantes, une fois les règles de base supposées comprises), puis
// niveaux à solution unique (11-15, difficulté croissante).
//
// Codes de case: "." vide, "0" case interdite (aucune lumière
// adjacente autorisée), "1"-"4" case à charge (ce nombre de lumières
// adjacentes exactement), "X" hors-grille (void — aussi utilisée comme
// mur/obstacle plein, il n'y a plus de distinction entre les deux).
// "/" ou "\" case miroir: dévie un laser de charge colorée de 90° (ne
// concerne pas la lumière blanche de base, qui les traverse comme un
// obstacle opaque ordinaire). Voir CellType.MIRROR dans grid.js.
// "r"/"g"/"b"/"y"/"c"/"m"/"w" case vide avec couleur cible exacte requise.
// Une case à charge peut porter une couleur (token à 2 caractères, ex.
// "2r" = charge 2, rouge) : une fois satisfaite, chacune de ses directions
// qui NE pointe PAS vers une lumière tire un laser fin de sa couleur
// jusqu'à la première case-lumière rencontrée sur cette ligne/colonne, et
// la teinte (elle diffuse alors sa propre couleur au lieu du blanc par
// défaut). Si plusieurs lasers de couleurs différentes atteignent la même
// lumière, leurs couleurs se mélangent. Voir src/game/grid.js.
//
// Chaque niveau a été construit à partir d'une solution connue (voir
// scripts/verify.mjs) pour garantir qu'il est gagnable. Les niveaux 6-10 ont
// été produits par scripts/generate-levels.mjs (remplissage glouton +
// indices dérivés de la solution trouvée). Les niveaux 11-15 et les coeurs
// des niveaux 21-25 ont été produits par scripts/generate-unique-levels.mjs,
// qui rejette toute grille n'ayant pas EXACTEMENT une solution (vérifié par
// src/game/solver.js). Voir aussi `npm run check-unique`.
//
// Niveaux 16-20: introduction de la mécanique couleur (case à charge +
// laser + case-cible), petites grilles construites à la main, difficulté
// croissante des interactions (une charge colorée isolée, puis le mélange
// de deux couleurs sur une même lumière, puis la combinaison avec une case
// interdite, puis deux charges indépendantes dans une même grille, puis une
// bordure interdite autour du coeur "mélange").
//
// Niveaux 21-25: coeurs à solution UNIQUE générés (7x7 à 8x7, difficulté
// croissante), sur lesquels 1 à 3 "cases à charge" existantes ont reçu une
// couleur. Comme le coeur est déjà entièrement déterminé par les indices
// numériques, la case colorée est nécessairement satisfaite dans LA
// solution ; son laser touche alors une lumière déjà fixée par le reste de
// la grille, et une case-cible en aval de cette lumière vérifie la bonne
// couleur. Chaque insertion a été vérifiée avec le moteur réel (aucune
// autre lumière ne doit "polluer" la case-cible visée) et chaque niveau a
// été re-vérifié avec `countSolutions` pour confirmer qu'il reste à
// solution unique après ajout des cases-cibles.

export const levels = [
  {
    name: "Where am i ?",
    rows: 2,
    cols: 2,
    cells: ["..", ".."],
  },
  {
    name: "a path ?",
    rows: 3,
    cols: 3,
    cells: [".X.", ".X.", "..."],
  },
  {
    name: "pathes",
    rows: 2,
    cols: 5,
    cells: ["..2..", ".XXXX"],
  },
  {
    name: "connect",
    rows: 4,
    cols: 4,
    cells: ["....", ".X..", "..X.", "1..1"],
  },
  {
    name: "eliminate",
    rows: 5,
    cols: 5,
    cells: [
      ". 0 . 0 .",
      ". . . . .",
      ". 0 . 0 .",
      ". . . . .",
      ". 0 . . .",
    ],
  },
  {
    name: "synapses",
    rows: 10,
    cols: 5,
    cells: [
      ". . . . 0",
      "0 . . . .",
      "X 0 . . .",
      "0 . . . 0",
      ". . X . .",
      "X . . . .",
      ". . 0 0 X",
      ". . . . .",
      "0 . . . .",
      ". . . . 0",
    ],
  },
  {
    name: "remember",
    rows: 7,
    cols: 7,
    cells: [
      "1 . . . . . .",
      "X . . . 2 . .",
      ". . . . . . .",
      ". . . . . . 0",
      "1 . . . 1 . .",
      ". . . . . . .",
      ". 0 . . X . X",
    ],
  },
  {
    name: "images",
    rows: 8,
    cols: 8,
    cells: [
      "X 1 . . . . . X",
      "X . . 0 . . . .",
      ". . . . X . . 1",
      "X . . . . X X .",
      ". . . . 3 . . 1",
      ". 3 . . . . . X",
      ". . . . . . X X",
      "X . . . . . . 0",
    ],
  },
  {
    name: "another path",
    rows: 6,
    cols: 6,
    cells: [
      "X . . . . .",
      ". 1r . . r .",
      ". . X X X X",
      "X X X . . .",
      "g . . . 3g .",
      "X . . . . X",
    ],
  },
  {
    name: "other pathes",
    rows: 4,
    cols: 4,
    cells: [". . 1r .", ". X y .", "1g y . .", "0 . . ."],
  },
  {
    name: "Éclat",
    rows: 7,
    cols: 7,
    cells: [
      "X X X X X X X",
      ". . . 1r X X .",
      "r 1g . . 1 . .",
      ". . . . . . 2b",
      ". . . g . 1 .",
      ". . . . . X .",
      "X b 0 . X X X",
    ],
  },
  {
    name: "Mixes",
    rows: 7,
    cols: 7,
    cells: [
      ". 1r . . . . .",
      ". . . . . . .",
      ". 3g . . . c .",
      ". . . . . . 0",
      ". . . r . . .",
      ". . b . . . .",
      ". . . . 1b . .",
    ],
  },
  {
    name: "reflect",
    rows: 6,
    cols: 4,
    cells: [
      "X X . X",
      ". . . .",
      ". 3g . \\",
      ". . . .",
      "X X X .",
      "X X X g",
    ],
  },
  {
    name: "La grosse salope",
    rows: 6,
    cols: 7,
    cells: [
      "X r . . 2r . X",
      ". 2r m . . . X",
      ". . . 1g . . c",
      ". . W / 1b . /",
      "X r . . . . X",
      "c . . . . . X",
    ],
  },
  {
    name: "Mirror",
    rows: 6,
    cols: 6,
    cells: [
      "X X . X X X",
      ". X . . 1r .",
      "2b . . \\ . .",
      ". . . . . .",
      ". m . . . .",
      ". . . m / .",
    ],
  },
  {
    name: "Fusion",
    rows: 5,
    cols: 7,
    cells: [
      "X X X . X X X",
      "m W X 1r X W m",
      ". X X \\ X X .",
      "m W X 1b X W m",
      "X X X . X X X",
    ],
  },
    {
    name: "Sleep",
    rows: 9,
    cols: 10,
    cells: [
      "X c . . . . 1g . X X",
      "y . . . X . . . X X",
      ". . 1b . r . . . X X",
      ". . . . . . . . . X",
      ". X . 2r . . \\ . . X",
      ". . . / . . . . y X",
      ". b . 1g . g . . . .",
      "X X X X . . 3r . . X",
      "X X X X X . . . . X",
    ],
  },
  {
    name: "Pyra",
    rows: 5,
    cols: 5,
    cells: [
      "X W Y . r",
      "X W . W X",
      "X . Y . b",
      "X W . W X",
      "g . Y . X",
    ],
  },
  {
    name: "Pyra2",
    rows: 10,
    cols: 8,
    cells: [
      ". . . . . . . .",
      ". 2 . . . . 2 .",
      ". . . Y Y . . .",
      ". . 1 . . 1 . .",
      "0 m . . . . . X",
      "X . 1 . . 1 . 0",
      ". . . . r . y .",
      ". . 1 . . 1 . .",
      ". 1b X . . X 1g .",
      ". . . . . . . .",
    ],
  },
  {
    name: "Pyras",
    rows: 11,
    cols: 8,
    cells: [
      "X . . . . . . X",
      ". 2b . . 0 X 0 .",
      ". . . . 0 0 . .",
      "0 . y . . . . .",
      ". . c Y . . . .",
      "W . . . Y . . 0",
      ". . . X X . . .",
      ". . . . . . . .",
      "2 . . m . . 1r .",
      ". . 2g . 2 . . .",
      "X . . . 0 . . X",
    ],
  },
  {
    name: "prisme",
    rows: 9,
    cols: 5,
    cells: [
      "X X . X X",
      "X b . X X",
      "X X . X X",
      "X X . X X",
      ". . Pr X .",
      "X . X X .",
      "X . X X .",
      "X . X X .",
      "r w . . y",
    ],
  },
  {
    name: "intro neurone miroir",
    rows: 2,
    cols: 5,
    cells: [
      "1 X X X 1",
      ". . M . .",
    ],
  },
  {
    name: "Neumir",
    rows: 7,
    cols: 5,
    cells: [
      ". . M . .",
      "X X X X M",
      ". . M . .",
      "M X X X X",
      ". X X X X",
      "2 X X X X",
      ". X X X X",
    ],
  },
  {
    name: "Neurone mirroir",
    rows: 9,
    cols: 7,
    cells: [
      "X X . X . X X",
      ". . c . g . .",
      ". y . . . . .",
      ". . . 0 . . X",
      "2r . . M . . .",
      ". X . . 0 . X",
      ". . . . . . .",
      ". 1g 1b . X 1g .",
      "X . . . . . X",
    ],
  },
];
