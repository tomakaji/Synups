// Grilles communautaires fictives (contenu de seed) — voir community-store.js.
// Généré par scripts/gen-community-seed.mjs (réutilise generateLevel() du
// vrai générateur Infini: chaque grille ci-dessous est garantie jouable et à
// solution unique, ce ne sont pas des données inventées à la main). Contenu
// statique et immuable: seule la couche locale (likes/parties du joueur,
// niveaux qu'IL publie) vit dans localStorage, voir community-store.js.
// Pour régénérer: node scripts/gen-community-seed.mjs
export const SEED_LEVELS = [
  {
    "id": "seed-01",
    "title": "Premier signal",
    "author": {
      "pseudo": "Neurosynth",
      "avatar": "neuron"
    },
    "rows": 8,
    "cols": 6,
    "cells": [
      "X . . . . X",
      ". 4 . . 1 .",
      ". . . . . .",
      "X X . . . X",
      "X X . 3 . .",
      "1 X . . . .",
      ". . . . 1 .",
      "X X . . X X"
    ],
    "mechanics": [],
    "difficulty": 1,
    "createdAt": "2026-08-03T23:21:18.674Z",
    "baseLikes": 1,
    "basePlays": 75
  },
  {
    "id": "seed-02",
    "title": "Écho simple",
    "author": {
      "pseudo": "Lucie.exe",
      "avatar": "charge"
    },
    "rows": 8,
    "cols": 7,
    "cells": [
      "1 1 . . 1 . 2",
      ". . . . 1 . .",
      ". 1 . 1 . . .",
      "2 . . . . . 1",
      ". . 2 . . 2 .",
      "2 . . 2 . . .",
      ". . . . 1 . .",
      "1 0 . 1 . . 0"
    ],
    "mechanics": [
      "forbidden"
    ],
    "difficulty": 1,
    "createdAt": "2026-08-05T06:33:18.674Z",
    "baseLikes": 24,
    "basePlays": 99
  },
  {
    "id": "seed-03",
    "title": "Circuit calme",
    "author": {
      "pseudo": "M. Prisme",
      "avatar": "synapse"
    },
    "rows": 9,
    "cols": 7,
    "cells": [
      ". g 1g . . X X",
      ". . . . . X X",
      ". 2 X 2 . . .",
      ". . X . X . X",
      ". 2 X . X . 1b",
      "X . . y X X .",
      ". . . X X X .",
      "1 1r . . . . g",
      "X X . 1g . X X"
    ],
    "mechanics": [
      "color"
    ],
    "difficulty": 1,
    "createdAt": "2026-08-06T13:45:18.674Z",
    "baseLikes": 10,
    "basePlays": 34
  },
  {
    "id": "seed-04",
    "title": "Double impulsion",
    "author": {
      "pseudo": "Aeon",
      "avatar": "mirror"
    },
    "rows": 8,
    "cols": 6,
    "cells": [
      "2 . . 1 . 2",
      ". . . 1 . .",
      ". 1 1 . . 1",
      "2 . . . . 1",
      ". 3 X X 1 .",
      ". . . X X .",
      ". . . . X .",
      "X . 2 . . ."
    ],
    "mechanics": [],
    "difficulty": 1,
    "createdAt": "2026-08-07T20:57:18.674Z",
    "baseLikes": 33,
    "basePlays": 58
  },
  {
    "id": "seed-05",
    "title": "Le nœud aveugle",
    "author": {
      "pseudo": "Voltaic",
      "avatar": "prism"
    },
    "rows": 9,
    "cols": 7,
    "cells": [
      "X . 2g X . . X",
      "X . . . g . X",
      "X . X X X X .",
      ". 3 . . . . .",
      ". . . 1 X . .",
      ". . X . y 1g X",
      ". . 1r . . . .",
      ". X . . X X .",
      "X . . . . 0 X"
    ],
    "mechanics": [
      "color",
      "forbidden"
    ],
    "difficulty": 2,
    "createdAt": "2026-08-09T04:09:18.674Z",
    "baseLikes": 24,
    "basePlays": 82
  },
  {
    "id": "seed-06",
    "title": "Chambre interdite",
    "author": {
      "pseudo": "Songe",
      "avatar": "pyra"
    },
    "rows": 9,
    "cols": 8,
    "cells": [
      "X X X X X X 1 .",
      "X . y X X X X .",
      "1g . . X . . X .",
      ". . . . . . 0 .",
      ". . X . . . . .",
      "X \\ X . 1r . 1 X",
      ". . . . . . . X",
      ". 0 X X . X . X",
      "X 1 . . . X X X"
    ],
    "mechanics": [
      "mirror",
      "color",
      "forbidden"
    ],
    "difficulty": 2,
    "createdAt": "2026-08-10T11:21:18.674Z",
    "baseLikes": 10,
    "basePlays": 17
  },
  {
    "id": "seed-07",
    "title": "Triade rouge",
    "author": {
      "pseudo": "Katsu",
      "avatar": "target"
    },
    "rows": 9,
    "cols": 7,
    "cells": [
      ". 1 1 . 2 0 0",
      ". 1 0 . . . .",
      ". . 2 0 . . X",
      "1 . . 1g . . .",
      ". . . . 0 . .",
      ". 0 . . g . .",
      "1 0 . . . . g",
      ". . . 0 . . 0",
      ". 0 . 0 0 0 0"
    ],
    "mechanics": [
      "forbidden",
      "color"
    ],
    "difficulty": 1,
    "createdAt": "2026-08-11T18:33:18.674Z",
    "baseLikes": 28,
    "basePlays": 41
  },
  {
    "id": "seed-08",
    "title": "Miroir brisé",
    "author": {
      "pseudo": "Vortex_9",
      "avatar": "target"
    },
    "rows": 9,
    "cols": 7,
    "cells": [
      "X . . . . X X",
      ". . 1b / X . .",
      "X . . . 0 . X",
      "0 . X . . . X",
      "X X / 2g . 3 .",
      "X \\ . g X . .",
      ". . . X . . .",
      ". 1b . . c X X",
      "X . . . . . ."
    ],
    "mechanics": [
      "forbidden",
      "mirror",
      "color"
    ],
    "difficulty": 2,
    "createdAt": "2026-08-13T01:45:18.674Z",
    "baseLikes": 19,
    "basePlays": 65
  },
  {
    "id": "seed-09",
    "title": "Dérive bleue",
    "author": {
      "pseudo": "Mira",
      "avatar": "wall"
    },
    "rows": 9,
    "cols": 8,
    "cells": [
      "X X . . . 2b . X",
      "X X b X X . . .",
      "X . . . 0 X . .",
      ". . . . . . . .",
      ". 0 X X 1 . 1 .",
      "1 1 . . X . X X",
      ". . . . . . . .",
      ". . X . . . X .",
      "X . 0 . X . X X"
    ],
    "mechanics": [
      "color",
      "forbidden"
    ],
    "difficulty": 2,
    "createdAt": "2026-08-14T08:57:18.674Z",
    "baseLikes": 5,
    "basePlays": 89
  },
  {
    "id": "seed-10",
    "title": "Fractale mineure",
    "author": {
      "pseudo": "Ombre Claire",
      "avatar": "neuron"
    },
    "rows": 12,
    "cols": 8,
    "cells": [
      "X . . . . X 1 .",
      "X 1b 1 X . . X .",
      "/ / . . . 1 . .",
      "X X X X . X . X",
      ". \\ g X X X 1g X",
      "c 1g . X X \\ . X",
      "X . . 2 . . . 1",
      ". . X . X . X .",
      "X 1 . . . . . .",
      "X X . X X . 1 .",
      "X X . . X X . .",
      "X X . X X X X X"
    ],
    "mechanics": [
      "color",
      "mirror"
    ],
    "difficulty": 3,
    "createdAt": "2026-08-15T16:09:18.674Z",
    "baseLikes": 33,
    "basePlays": 24
  },
  {
    "id": "seed-11",
    "title": "Surcharge contrôlée",
    "author": {
      "pseudo": "Petit Nex",
      "avatar": "charge"
    },
    "rows": 11,
    "cols": 8,
    "cells": [
      "X X . . . . . X",
      "X . 4 . X . . .",
      "X . . . . . 1 0",
      ". . . 2g . X . .",
      ". . . . . . . X",
      ". . . . X . . .",
      ". X . . . X 1 .",
      ". . . . X . 1 .",
      ". X . . . . X .",
      "g X . . X X . .",
      "X . . X X X X X"
    ],
    "mechanics": [
      "forbidden",
      "color"
    ],
    "difficulty": 3,
    "createdAt": "2026-08-16T23:21:18.674Z",
    "baseLikes": 19,
    "basePlays": 48
  },
  {
    "id": "seed-12",
    "title": "Le dernier neurone",
    "author": {
      "pseudo": "Ignis",
      "avatar": "synapse"
    },
    "rows": 9,
    "cols": 6,
    "cells": [
      "X X 1 X X X",
      ". 2 . . . .",
      ". X . . X .",
      ". 1 X 1 X X",
      ". . X X X X",
      ". X . . 1 X",
      ". . X Y . X",
      "X c 2 . . X",
      "X 1b . . . X"
    ],
    "mechanics": [
      "color",
      "pyra"
    ],
    "difficulty": 1,
    "createdAt": "2026-08-18T06:33:18.674Z",
    "baseLikes": 32,
    "basePlays": 72
  },
  {
    "id": "seed-13",
    "title": "Pyra dormant",
    "author": {
      "pseudo": "Halo",
      "avatar": "mirror"
    },
    "rows": 12,
    "cols": 7,
    "cells": [
      ". . . 1g . . 0",
      "1 X . . . . 0",
      "X . c \\ X . .",
      ". . . . X . .",
      "X X . 2b . X X",
      "X X . . . . .",
      ". X . . . X 0",
      ". X . . X . .",
      "1 X . X . . X",
      ". . . . X . .",
      ". 1 . . . X X",
      "X . . X . . 0"
    ],
    "mechanics": [
      "forbidden",
      "color",
      "mirror"
    ],
    "difficulty": 3,
    "createdAt": "2026-08-19T13:45:18.674Z",
    "baseLikes": 28,
    "basePlays": 96
  },
  {
    "id": "seed-14",
    "title": "Réseau silencieux",
    "author": {
      "pseudo": "Cascade",
      "avatar": "prism"
    },
    "rows": 9,
    "cols": 7,
    "cells": [
      "X X . w . . 1r",
      ". 2g X . . X .",
      ". . . . . . .",
      ". . . . . X .",
      ". . 2 X . 1b X",
      ". X . . . b .",
      ". . X X X . .",
      "X . . 3b . X .",
      "X . . . . X X"
    ],
    "mechanics": [
      "color"
    ],
    "difficulty": 2,
    "createdAt": "2026-08-20T20:57:18.674Z",
    "baseLikes": 9,
    "basePlays": 31
  },
  {
    "id": "seed-15",
    "title": "Angle mort",
    "author": {
      "pseudo": "Fable",
      "avatar": "pyra"
    },
    "rows": 8,
    "cols": 7,
    "cells": [
      "X 1 . . 2 . X",
      "0 0 . 2 . . .",
      "0 0 . . . . 0",
      "0 0 1 1 0 1 0",
      "1 1 . . 1 . .",
      ". . . . . . .",
      ". 1 . . 1 . .",
      "X . . 1 0 . X"
    ],
    "mechanics": [
      "forbidden"
    ],
    "difficulty": 1,
    "createdAt": "2026-08-22T04:09:18.674Z",
    "baseLikes": 27,
    "basePlays": 55
  },
  {
    "id": "seed-16",
    "title": "Résonance",
    "author": {
      "pseudo": "Zed",
      "avatar": "filter"
    },
    "rows": 11,
    "cols": 8,
    "cells": [
      "X . . X . . . .",
      ". . . 0 . X X .",
      ". X . 1 . 0 X 2",
      "1 X . X X 1 X .",
      ". . . . X . . X",
      ". 0 X X . X . .",
      "X X . X . 0 . .",
      ". . . . . c X 1g",
      ". X X X X X . .",
      "2b . . X . / . /",
      ". . . . . X . X"
    ],
    "mechanics": [
      "color",
      "forbidden",
      "mirror"
    ],
    "difficulty": 3,
    "createdAt": "2026-08-23T11:21:18.674Z",
    "baseLikes": 23,
    "basePlays": 79
  }
];
