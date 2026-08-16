# Synups

Puzzle de lumière (façon Akari) avec une mécanique de lasers colorés,
habillé d'une esthétique sombre "épurée / mystérieuse / réseau de
neurones". Le joueur pose des lumières sur une grille pour satisfaire des
cases à charge ("neurones") et/ou atteindre des cases cible avec la bonne
couleur, sans jamais faire se croiser deux lumières sur la même
ligne/colonne dégagée.

Ce document est le point d'entrée pour reprendre le projet sans autre
contexte que ce dépôt : règles du jeu, architecture du code, format des
niveaux, et état d'avancement des différentes mécaniques.

## Démarrage rapide

```bash
npm install
npm run dev       # serveur de dev Vite, http://localhost:5173
npm run build     # build de prod dans dist/
npm run preview   # sert le build de prod en local
npm run verify    # rejoue une solution connue pour chaque niveau (sanity check)
npm run check-unique  # vérifie que chaque niveau a bien une solution unique
```

Aucune dépendance backend : tout tourne côté navigateur (Vite + JS
vanilla). Le seul package externe est [Tone.js](https://tonejs.github.io/)
pour l'audio synthétisé (aucun fichier son, tout est généré).

**Piège classique** : `index.html` à la racine est le point d'entrée de
**dev** (`<script type="module" src="/src/main.js">`). Ne jamais le
remplacer par le `dist/index.html` généré par le build (qui référence
`/assets/index-*.js`) — ça casse `npm run dev` immédiatement.

## Structure du projet

```
index.html              Point d'entrée dev (jeu + éditeur, deux vues superposées)
src/
  main.js                Boucle de jeu : chargement de niveau, clics, undo, sons, étoiles
  editor.js               Éditeur de niveaux en navigateur (peinture, test, export)
  style.css                Tout le CSS (thème sombre, icônes, animations)
  game/
    grid.js                Modèle de grille + règles (LightUpGrid) — le cœur du jeu
    render.js               Rendu DOM partagé (icônes SVG, lasers) — utilisé par le jeu ET l'éditeur
    colors.js               Palette de couleurs, mélange additif r/g/b
    sound.js                Synthèse audio (Tone.js), pas de fichiers audio
    solver.js               Solveur par backtracking + propagation (dev tools + bouton "Résoudre")
    levels.js               Données des niveaux (voir "Format des niveaux" ci-dessous)
scripts/
  verify.mjs               Sanity check : rejoue une solution connue par niveau
  check-unique.mjs         Vérifie l'unicité de la solution de chaque niveau
  generate-levels.mjs        Génère des formes de grille + indices cohérents (outil de conception)
  generate-unique-levels.mjs Génère des niveaux à solution garantie unique
  analyze-rays.mjs           Outil ponctuel : repère les rayons assez longs pour y insérer un filtre/cible
```

`grid.js` ne dépend de rien d'autre : c'est la seule source de vérité sur
les règles. `render.js` est purement présentation (aucune logique de jeu)
et est partagé par `main.js` (jeu) et `editor.js` (aperçu/test en direct)
pour qu'ils affichent toujours exactement la même chose.

## Règles du jeu

- On pose une lumière en cliquant sur une case vide ; un second clic la
  retire.
- Une lumière illumine toute sa ligne et sa colonne jusqu'au premier
  obstacle opaque rencontré dans chaque direction (elle ne "voit" pas
  au-delà).
- Deux lumières ne peuvent jamais s'éclairer mutuellement (pose invalide
  si la case cible est déjà illuminée par une autre lumière).
- Une case à **charge** ("neurone", type `CLUE`) affiche un chiffre 1-4 :
  elle doit avoir exactement ce nombre de lumières adjacentes (4
  directions) pour être "satisfaite". Plus que le nombre = surcharge
  (état d'erreur visuel).
- Une case **interdite** ("synapse", type `FORBIDDEN`) ne doit jamais
  avoir de lumière adjacente.
- Le niveau est gagné quand : toutes les cases charge/interdites sont
  satisfaites, toutes les cases vides sont illuminées, et toutes les
  cases cible affichent exactement leur couleur requise.
- Le nombre de coups affiché (et utilisé pour la notation en étoiles) est
  le nombre de lumières **actuellement posées** sur la grille
  (`grid.lights.size`) : poser augmente le compteur, retirer le diminue —
  l'objectif est de résoudre avec le moins de lumières possible, pas
  forcément du premier coup.

### Mécanique couleur

Une case à charge peut porter une couleur (`color: "r"|"g"|"b"`). Une
fois satisfaite, elle tire un rayon fin (purement indicatif, ne rend rien
"illuminé") dans chaque direction non utilisée par une lumière adjacente,
jusqu'à la première case-lumière rencontrée, qu'il teinte. Si plusieurs
rayons de couleurs différentes atteignent la même lumière, leurs couleurs
s'additionnent (mélange r/g/b booléen : rouge+vert=jaune, etc.). Une case
**cible** (`target`) exige d'être illuminée par une combinaison de
couleurs précise (rouge/vert/bleu/jaune/cyan/magenta/blanc).

## Types de case et tokens (`levels.js`)

Chaque case est encodée par un token (chaîne courte). Une rangée est soit
une chaîne concaténée (`"2....#"`, un caractère = une case), soit une
liste de tokens séparés par des espaces si un token fait plus d'un
caractère (`"2r . . Fb . P"`).

| Token | Type | Description |
|---|---|---|
| `.` | `EMPTY` | Case vide, peut recevoir une lumière |
| `X` ou `#` | `VOID` | Hors-grille : bloque la lumière blanche, **transparent** aux lasers colorés |
| `W` | `WALL` | Mur : bloque la lumière blanche **et** les lasers colorés |
| `0` | `FORBIDDEN` | Aucune lumière adjacente autorisée ("synapse") |
| `1`-`4` | `CLUE` | Case à charge : exactement N lumières adjacentes |
| `1r`,`2g`,`3b`,... | `CLUE` coloré | Idem + tire un laser de cette couleur une fois satisfaite |
| `/` ou `\` | `MIRROR` | Dévie un laser coloré de 90° ; opaque à la lumière blanche |
| `r`,`g`,`b`,`y`,`c`,`m`,`w` | `EMPTY` + cible | Case cible : doit être illuminée exactement de cette couleur |
| `Fr`,`Fg`,`Fb` | `FILTER` ⚠️ expérimental | Ne garde que ce canal d'un laser coloré qui la traverse |
| `P`,`Pr`,`Pg`,`Pb`,`Pw` | `PRISM` ⚠️ expérimental | Colore ses 4 voisins directs (voir plus bas), défaut `r` |
| `M` | `MIRROR_NEURON` ⚠️ expérimental | Duplique en symétrie toute lumière qui l'éclaire (voir plus bas) |
| `Y` | `PYRA` ⚠️ expérimental | Neurone pyramidal : activé par 1 à 3 lumières adjacentes, surcharge à 4 (voir plus bas) |

Aucune de ces cases n'est cliquable/interactive en jeu : seules les
lumières le sont. Tout ce qui n'est pas `EMPTY` bloque la lumière blanche
de base comme un obstacle plein (sauf `VOID`, transparent aux lasers
colorés uniquement).

### Prisme (expérimental)

Case fixe non posable par le joueur. Colore ses 4 voisins directs
gauche/bas/droite/haut dans l'ordre fixe rouge→vert→bleu→blanc. La
"première couleur" (paramètre `firstColor`, celle à gauche) s'applique
dès la **première** lumière adjacente posée ; chaque lumière
**supplémentaire** pivote l'ordre d'un cran (90°) de plus. L'icône
affichée est volontairement **en avance d'un cran** sur l'état réellement
appliqué : elle montre où ira la couleur de la *prochaine* lumière plutôt
que l'état déjà en place, pour que le joueur puisse anticiper avant de
poser. Voir les commentaires en tête de `src/game/grid.js` pour le détail
exact des deux rotations (`appliedRotation` vs `displayRotation`).

### Filtre (expérimental)

Case fixe, couleur décidée au level-design (jamais cliquable). Un laser
coloré qui la traverse ne garde QUE ce canal (masque ET, jamais additif :
un filtre ne peut qu'enlever des canaux, jamais en ajouter).

### Neurone miroir (expérimental)

Obstacle fixe. Dès qu'une lumière l'illumine (elle est sur sa
ligne/colonne, ligne de vue directe), le neurone la **duplique
automatiquement** en symétrie centrale par rapport à lui-même. Si la case
symétrique ne peut pas légalement recevoir cette duplication (hors-grille,
non vide, déjà occupée ou déjà illuminée), **tout le mouvement est
annulé** (la pose échoue, son d'erreur) — on ne pose jamais la lumière
d'origine seule sans son duplicata. Retirer l'une des deux lumières d'une
paire liée retire l'autre avec elle.

Limitations connues : un duplicata qui illuminerait à son tour un AUTRE
neurone miroir ne déclenche pas de réaction en chaîne (une seule
"passe" par pose de lumière). Le solveur (`solver.js`) n'a pas été conçu
en tenant compte de cette mécanique — il fonctionne dans les cas simples
testés mais son comportement sur des niveaux complexes utilisant cette
case n'est pas garanti.

### Pyra / neurone pyramidal (expérimental)

Contrairement à une case à charge (`CLUE`) qui exige un nombre EXACT de
lumières adjacentes, Pyra n'a pas de quantité fixe : il est "activé" dès
qu'il a entre 1 et 3 lumières adjacentes (n'importe lequel de ces
comptes suffit pour qu'il compte comme satisfait dans la condition de
victoire), et surchargé à 4 (comme n'importe quelle charge en
surcharge). Son identité est une instabilité tricolore : une fois
activé, il tire un laser (même mécanique qu'une charge colorée
satisfaite) dont la couleur dépend du nombre de lumières adjacentes —
1 = rouge, 2 = vert, 3 = bleu — recalculée à chaque passe plutôt que
fixée au level-design. Icône (variante "triangle aux pointes RGB",
validée en mockup) : 3 repères de couleur scintillent en boucle sur les
sommets du triangle en permanence (identité instable, actif ou non), le
corps se remplit de la couleur active une fois activé, et le motif
"étoile" des charges en surcharge apparaît à 4.

Limitation connue : le solveur (`solver.js`) a une propagation de
contraintes spécialement conçue pour la sémantique "nombre exact" de
`CLUE` (déductions forcées, détection d'erreur anticipée via
`anyClueError`) ; Pyra n'en bénéficie pas — il reste traité comme une
case candidate normale par le backtracking générique, donc le solveur
reste correct mais moins efficace sur les niveaux qui en contiennent.

### Pourquoi quatre cases sont "expérimentales"

Filtre, Prisme, Neurone miroir et Pyra sont fonctionnels et testés
unitairement, mais pas encore éprouvés en conditions réelles de puzzle
(équilibrage, clarté pour le joueur, interaction avec le solveur). Dans
l'éditeur, ils sont regroupés à part avec un liseré pointillé et un
avertissement — éviter de les utiliser dans un niveau destiné à être
publié tant qu'ils n'ont pas été validés en jeu.

## L'éditeur de niveaux

Bouton "Éditeur" en haut à droite. Fonctionnalités :

- Peinture case par case (palette d'outils avec icône + libellé).
- Redimensionnement (bas/droite) + insertion/retrait de ligne ou colonne
  sur n'importe quel bord (haut/bas/gauche/droite), sans perdre le
  contenu existant.
- Mode **Test** : bascule vers une grille jouable identique au jeu réel
  (mêmes sons, mêmes règles), pour valider un niveau sans quitter
  l'éditeur. L'état des lumières de test persiste si on repasse en
  édition puis qu'on re-teste.
- Bouton **Résoudre** (actif seulement en mode Test) : appelle le
  solveur et pose automatiquement une solution trouvée, ou indique qu'
  aucune solution n'a été trouvée.
- Sauvegarde locale (`localStorage`) et **Export** : génère le code JS à
  coller directement dans `levels.js`.
- Le nom du niveau est **obligatoire** pour sauvegarder ou exporter (un
  niveau neuf démarre sans nom).

Les niveaux sauvegardés localement dans l'éditeur ne sont PAS dans
`levels.js` — c'est un espace de brouillon. Pour qu'un niveau rejoigne le
jeu, il faut copier le code exporté dans `src/game/levels.js`.

## Son

Tout est synthétisé via Tone.js (aucun fichier audio), pensé comme une
ambiance discrète plutôt que percussive : léger reverb + delay commun,
sons doux (attaque lente, pas de clic sec). Un curseur de volume général
agit sur `Tone.getDestination()`, donc en amont de tous les sons
uniformément.

## Notation en étoiles

`computeStars(moves, levelIndex)` dans `main.js` : si le niveau définit
`starThresholds: [seuil3etoiles, seuil2etoiles]` dans `levels.js`, on
l'utilise directement. Sinon, calcul automatique via le solveur (nombre
de lumières d'une solution valide = "par") : 3 étoiles si `moves <= par`,
2 étoiles si `moves <= par*1.5`, sinon 1. Le résultat est mis en cache par
niveau (le calcul peut prendre jusqu'à ~1s sur une grande grille).

## Limitations connues

- `scripts/verify.mjs` contient des solutions **codées en dur** par index
  de niveau. Si `levels.js` est modifié manuellement (ajout/suppression/
  réordonnancement de niveaux), ces solutions se désynchronisent et le
  script signale des échecs qui ne sont PAS des bugs du jeu — juste des
  données de test obsolètes à régénérer.
- Le niveau "La grosse salope" (nom à revoir avant publication) a perdu
  sa solution unique suite au changement "Void transparent aux lasers
  colorés" ; le contenu de `levels.js` n'est volontairement pas modifié
  automatiquement par un outil externe — à corriger manuellement au
  besoin.
- Le solveur n'est pas garanti optimal/rapide sur les mécaniques
  expérimentales (voir Neurone miroir ci-dessus) ni sur de très grandes
  grilles peu contraintes (plafond de nœuds explorés, résultat possible :
  "indéterminé").

## Conventions de code à connaître

- **Ne jamais faire diverger `render.js` entre jeu et éditeur** : toute
  nouvelle case doit avoir son cas dans le `switch` de `render()` et,
  si elle a une icône, une fonction dédiée (voir les icônes existantes
  pour le style : contour sombre plein + couleur devant, pour rester
  lisible même si le fond de la case prend la même teinte que l'icône).
- **`stroke-linejoin="round"`** obligatoire sur les traits épais qui
  tournent à 90° (sinon un artefact de jointure "miter" crée un pic
  parasite à l'angle).
- **N'animer un état en CSS que sur un noeud DOM persistant.** Si une
  icône est reconstruite via `innerHTML` à chaque rendu (le cas général),
  aucune transition CSS ne peut s'y appliquer — voir `renderPrismIcon`
  dans `render.js` pour le contre-exemple (noeud `.prism-rotor` gardé
  entre deux rendus, seul son `transform` est mis à jour).
- **`VOID` vs `WALL`** : les deux bloquent la lumière blanche de base
  identiquement ; seule la traversée des lasers colorés les distingue
  (`VOID` transparent, `WALL` opaque). Ne jamais fusionner les deux
  sans relire ce commentaire dans `grid.js`.
- **Historique d'annulation** : `moveHistory` (dans `main.js`) est un
  journal complet de toutes les actions (poses/retraits), y compris les
  duplications automatiques du neurone miroir (un clic peut affecter
  plusieurs cases à la fois — voir `grid.getLastAffectedCells()`).
  Ne jamais le simplifier en un simple compteur : c'est le compteur
  affiché (`grid.lights.size`) qui est dérivé séparément, pas l'inverse.

## Idées de mécaniques non implémentées

Pistes envisagées mais pas encore construites — le joueur ne pose que de
la lumière, il n'interagit avec aucun bloc directement :

- **Fusionneur** : capte la couleur de ses voisins actuellement éclairés
  et émet leur union dans une direction fixe — l'inverse du prisme.
- **Synapse sélective** : interdit une seule couleur précise à proximité
  plutôt que toute lumière.
- **Renvoi** : deux cases liées, un rayon qui entre par l'une ressort par
  l'autre.
- **Cible cumulative** : exige d'être traversée par un nombre minimum de
  rayons distincts, pas seulement la bonne couleur.
- **Case-mémoire** : retient un état (allumé/éteint) même après le
  retrait de la lumière qui l'a déclenché.
- **Cases jumelles/opposées** : deux cases liées à distance, l'une
  s'allume quand l'autre s'éteint (ou l'inverse).
- **Symétrie forcée / écho** : toute lumière posée doit avoir son miroir
  posé ailleurs sur la grille pour compter.
- **Seuil global** : une case reste dormante jusqu'à ce qu'un total de
  lumières posées sur toute la grille dépasse un seuil.
- **Budget de lumière** : nombre maximum de lumières posables sur tout le
  niveau, forçant à en retirer pour continuer.
- **Rotation de phase globale** : un minuteur ou un compteur d'actions
  fait pivoter TOUS les miroirs de la grille simultanément.

(Pyra, qui figurait ici, est désormais implémenté — voir la section
"Pyra / neurone pyramidal" plus haut.)

## Licence

Aucune licence définie pour l'instant.
