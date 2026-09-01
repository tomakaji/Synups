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
// scripts/verify.mjs) pour garantir qu'il est gagnable.
//
// IMPORTANT — cet ordre est ce que main.js:queueNewMechanicSchemas() utilise
// pour décider QUAND montrer chaque modale "schéma" pédagogique (au premier
// niveau qui contient réellement le token de la mécanique, voir
// community-store.js: detectMechanics) : tenir cette liste à jour à chaque
// réordonnancement/insertion de niveau, sinon un tuto peut se déclencher sur
// un niveau qui n'utilise pas encore vraiment la mécanique annoncée (bug
// vécu — retour utilisateur: "le tuto couleur arrive bien avant les niveaux
// utilisant la couleur" — la liste ci-dessous avait dérivé de l'ordre réel
// des niveaux au fil des ajouts). Ordre RÉEL actuel, mécanique par
// mécanique (premier niveau, 1-indexé, où elle apparaît réellement) :
//   1-4   "First Step".."Neurones": règle de base seule (case numérotée +
//         lumière), aucune mécanique additionnelle.
//   5-6   "Synapses"/"Synapses 2": case interdite ("0").
//   7-8   "Akari"/"Akari 2": grilles base plus grandes, aucune mécanique
//         additionnelle nouvelle.
//   9+    "Colors": couleur (charge colorée + case-cible) — RESTE présente
//         dans quasiment tous les niveaux suivants, ce n'est pas un bloc
//         isolé.
//   13+   "Miroirs": miroir ("/"/"\\"), combiné à la couleur dès son
//         introduction.
//   19+   "Pyra": neurone pyramidal ("Y").
//   23+   "prisme": prisme ("P"/"Pr"/"Pg"/"Pb"/"Pw").
//   26+   "Neurone miroir intro": neurone miroir [expérimental] ("M").
// Les derniers niveaux ("Prisme + Miroir", "Hard") combinent volontairement
// plusieurs mécaniques déjà enseignées à ce stade.

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
