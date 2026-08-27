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
    name: "First Step",
    rows: 2,
    cols: 2,
    cells: ["..", ".."],
  },
  {
    name: "Second Step",
    rows: 3,
    cols: 3,
    cells: [".X.", ".X.", "..."],
  },
  {
    name: "Neurone",
    rows: 2,
    cols: 5,
    cells: ["..2..", ".XXXX"],
  },
  {
    name: "Neurones",
    rows: 4,
    cols: 4,
    cells: ["....", ".X..", "..X.", "1..1"],
  },
  {
    name: "Synapses",
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
    name: "Synapses 2",
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
    name: "Akari",
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
    name: "Akari 2",
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
    name: "Colors",
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
    name: "Colors Fusion",
    rows: 4,
    cols: 4,
    cells: [". . 1r .", ". X y .", "1g y . .", "0 . . ."],
  },
  {
    name: "Synups",
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
    name: "Synups 2",
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
    name: "Miroirs",
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
    name: "Miroirs de Yanis le boss",
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
    name: "Mirrors 2",
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
    name: "Fusion sur mirroir",
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
    name: "Lets play",
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
    name: "white",
    rows: 11,
    cols: 5,
    cells: [
      ". . . . .",
      "2g . w . .",
      ". . . . .",
      ". . . . .",
      "/ . \\ . 2b",
      ". w . w .",
      "\\ . X . \\",
      ". w . w .",
      "w . / . X",
      "2r . X . /",
      ". . . . .",
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
    name: "Pyra 2",
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
    name: "Pyra 3",
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
    name: "Pyra hard",
    rows: 9,
    cols: 8,
    cells: [
      ". . X . . . . .",
      "c . . 3b . . y 0",
      ". 1 . . . . . 0",
      ". 2 . Y . . . m",
      ". . Y . Y . . .",
      ". . . Y . . . .",
      "X 0 . . . X 1b .",
      ". 1g . w . . / .",
      ". . . X 2 . . .",
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
    name: "Prisme 2",
    rows: 9,
    cols: 5,
    cells: [
      "X X . . X",
      ". y . . .",
      "0 . . Pr .",
      ". . 1 . .",
      ". . . X X",
      ". 2g . . .",
      ". . . . .",
      "X c . . 2",
      "X . . . .",
    ],
  },
  {
    name: "Prisme 3",
    rows: 11,
    cols: 7,
    cells: [
      "X 0 . . . 0 X",
      "c . . . . . X",
      ". . . . . . X",
      ". 2 . . . 1 .",
      ". 0 X . . . .",
      ". . . Pr . . y",
      "X . . . . 1 .",
      ". . . W . . .",
      ". Y . X X . .",
      ". . . . . 0 .",
      ". . y 2r . . X",
    ],
  },
  {
    name: "Neurone miroir intro",
    rows: 3,
    cols: 5,
    cells: [
      "1 X X X 1",
      ". . M . .",
      "X X X . X",
    ],
  },
  {
    name: "Neurone miroir chain",
    rows: 7,
    cols: 5,
    cells: [
      ". . M . .",
      "X X X X M",
      ". . M . .",
      "M X X X X",
      ". X X X X",
      "2 X X X X",
      ". X X . X",
    ],
  },
    {
    name: "Neurone Miroir 1",
    rows: 9,
    cols: 6,
    cells: [
      "X . . 0 . .",
      "c . . . . c",
      ". X . 1 X .",
      ". . . . . .",
      ". M . X . 1g",
      ". . . X . .",
      ". . . . . .",
      "c . . 3b . X",
      "0 . . . . X",
    ],
  },
  {
    name: "Neurones mirroirs avoid",
    rows: 9,
    cols: 7,
    cells: [
      "X X . 0 X X X",
      ". M . 1 X X .",
      ". . . . M . .",
      ". X . 1 X . .",
      ". . . . . . .",
      ". 0 . . . . .",
      ". X M . X . 1",
      ". 1 . . 1 . X",
      ". . . . . . 0",
    ],
  },
  {
    name: "Neurone mirroir 2",
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
  {
    name: "Prisme + Miroir",
    rows: 10,
    cols: 9,
    cells: [
      ". 1 . . . . . X .",
      ". . 1 . . 2 . . .",
      "b . . . . . . . .",
      "0 . . 0 . . . r .",
      "X . M . . 1b X . /",
      "0 . . . . . . . \\",
      ". . . . . X Pr . .",
      ". . w . . . . . 1r",
      "2 . . 0 . X . . .",
      ". . 0 X . . . m X",
    ],
  },
  {
    name: "Hard",
    rows: 12,
    cols: 8,
    cells: [
      "X . . 1 . 2 . .",
      ". c . . . . 3b .",
      ". . 1 . . X . .",
      "2 . . . 3 . . .",
      ". . 0 2 . . . .",
      ". . y w . . . .",
      ". Pr m . . Pr . .",
      ". . . . . . X .",
      "1 . . X . . Y 0",
      ". . X 1b . . . .",
      "b . . . . . . 0",
      "X \\ . 2g . w X X",
    ],
  },
];
