
# Mode Infini — proposition de design (v1)

Statut: décisions d'architecture validées (voir section 10), aucun code écrit.
Prochaine étape: implémentation de la Phase 1 (MVP, section 9).

## Décisions validées

- **Unicité**: best-effort. Le générateur essaie fort d'obtenir une solution
  unique, mais passé un budget de temps/tentatives, il sert le meilleur candidat
  trouvé plutôt que de faire attendre le joueur — voir section 8 pour le critère
  exact de « meilleur candidat ».
- **Perf**: génération dans un Web Worker dès la première version.
- **Phasage**: on commence par le MVP (formes + cases interdites + indices
  numériques, sans couleur ni mécaniques spéciales) avant d'ajouter le reste.

## 1. Objectifs

- Un mode « Infini » séparé des niveaux statiques (`levels.js` n'est pas touché) : on
  choisit une **difficulté (1/2/3 étoiles)** et les **features** autorisées, puis le
  jeu génère un niveau à la volée, encore et encore.
- Les niveaux générés doivent être **malins** : pas de solution qui saute aux yeux.
  Concrètement, ça veut dire une solution **unique** dans l'immense majorité des cas,
  et une difficulté mesurée sur le raisonnement réellement nécessaire pour la
  trouver — pas juste « plus de cases = plus dur ».
- « Toutes les features cochées » ne doit **pas** vouloir dire « toutes les features
  présentes sur chaque niveau ». Ça veut dire « tout est autorisé », le générateur
  pioche un sous-ensemble plausible selon la difficulté.
- Réutiliser au maximum ce qui existe déjà (`grid.js`, `solver.js`, et même les
  scripts `generate-levels.mjs` / `generate-unique-levels.mjs`, qui posent déjà la
  bonne méthode) plutôt que réinventer un système parallèle.

## 2. Ce qui existe déjà et sur quoi s'appuyer

Trois briques du projet font déjà 80 % du travail difficile, juste pas encore en
temps réel ni pilotées par des features/difficulté :

- **`grid.js`** est déjà l'unique source de vérité des règles (`toggleLight`,
  `recompute`, `isWon`) — un niveau généré n'est jamais qu'un objet `{rows, cols,
  cells}` comme n'importe quel niveau de `levels.js`. Zéro risque de divergence de
  règles entre généré et statique.
- **`solver.js`** (`countSolutions`, `findSolution`, `enumerateSolutions`) sait déjà
  vérifier l'unicité d'une solution et est déjà utilisé **en direct dans le
  navigateur** aujourd'hui (`main.js`, calcul du « par » pour les étoiles quand un
  niveau n'a pas de `starThresholds` explicite — voir `computeStars`). Faire tourner
  le solveur côté client au moment de jouer n'est donc pas un pari, c'est déjà en
  prod.
- **`scripts/generate-unique-levels.mjs`** contient déjà le bon algorithme de base
  (détaillé section 4) : forme aléatoire → résolution gloutonne → les murs
  deviennent des indices *dérivés de cette solution* → vérification d'unicité par
  `countSolutions`, retry si échec. Il ne gère aujourd'hui que les indices simples
  (pas de couleur, pas de mécaniques spéciales) et tourne en Node hors-ligne, pas
  dans le navigateur. Le mode Infini est essentiellement une généralisation +
  portage de ce script.

## 3. Vue d'ensemble de l'architecture

```
src/game/generator.js         // pur, sans DOM : generateLevel({ difficulty, features, seed })
src/game/generator.worker.js  // Web Worker : appelle generator.js, ne bloque pas l'UI
src/game/solver.js            // + une fonction d'introspection de difficulté (section 6)
src/infinite.js               // vue "mode Infini" (UI : sélecteurs + bouton + jeu)
index.html                    // 3e vue #infinite-view, à côté de #play-view / #editor-view
style.css                     // panneau de sélection (réutilise le look du panneau Importer)
```

Point clé : le générateur produit un objet niveau **standard**. Une fois généré, on
le fait tourner exactement comme un niveau de `levels.js` — même `LightUpGrid`, même
`createBoardRenderer`, même logique de clic dans `main.js`. Aucune règle de jeu
n'est dupliquée ; le mode Infini est une *source* de niveaux de plus, pas un moteur
parallèle.

## 4. Le pipeline de génération

Généralisation directe de `generate-unique-levels.mjs`, en 5 phases. Chaque phase
est reproductible depuis une seed (mêmes usages que le générateur actuel :
`seededRandom`), ce qui permettra plus tard un bouton « rejouer ce niveau »/partage
de code si voulu.

### Phase A — forme de la grille

Taille, densité de murs/void et forme des coins, tirées d'une plage dépendant de la
difficulté (voir section 6). Identique dans l'esprit à `buildLayout()` existant.

### Phase B — placement des mécaniques structurelles

C'est la partie qui n'existe pas encore. Toute case qui **change ce qu'est une
lumière valide** (MIRROR, FILTER, PRISM, MIRROR_NEURON, PYRA, FORBIDDEN) doit être
posée **avant** de chercher une solution, parce qu'elle influence la solution
elle-même — contrairement à un indice numérique (CLUE), qui lui est *dérivé après
coup* (phase C).

Le générateur pioche un sous-ensemble de features actives (section 5), puis pour
chacune :

- **FORBIDDEN** : remplace directement une case « mur » candidate (comme
  aujourd'hui).
- **MIRROR** (miroir dévieur), **FILTER** : posés le long d'un chemin plausible —
  on part d'une case qui devient charge colorée, on part dans une direction libre,
  on avance de quelques cases, et on dépose le miroir/filtre en route. Ça garantit
  qu'ils sont *utiles* (traversés par un laser) plutôt qu'inertes.
- **PRISM** : posé sur une case avec au moins une direction en portée de lumière
  potentielle (n'importe où sur sa ligne/colonne jusqu'au premier obstacle — la
  mécanique « portée de laser » qu'on vient de livrer).
- **PYRA** : posé comme une CLUE mais sans exiger de compte exact (1 à 3
  lumières adjacentes) — utilisable même sans la feature « Couleur » (l'activation
  1-3 est déjà un mécanisme intéressant en soi), mais son laser ne sert à rien sans
  cible colorée.
- **MIRROR_NEURON** : voir section 5, traité à part (coût + prudence).

### Phase C — résolution de référence + dérivation

Comme le script actuel : remplissage glouton (case par case, on pose une lumière
dès qu'une case n'est pas illuminée) pour obtenir **une** solution complète
valable compte tenu des obstacles posés en phase B. Puis :

- un sous-ensemble des cases « mur » devient des **CLUE** numériques, avec le
  compte réel de lumières adjacentes dans cette solution ;
- si « Couleur » est active : les CLUE concernées reçoivent une couleur, on relance
  `recompute()`, et les cases prévues comme **cibles colorées** lisent simplement
  `cell._lit` une fois la simulation de laser terminée pour connaître LEUR couleur
  cible exacte. C'est exactement la même astuce qui a servi à construire les
  niveaux 16 à 25 à la main pendant ce projet — juste automatisée.

C'est la partie la plus élégante du système existant : on ne cherche jamais « quel
indice rendrait ce niveau cohérent », on **lit** la réponse directement dans l'état
réel de la grille après simulation. Zéro recherche combinatoire pour cette étape.

### Phase D — vérification

`countSolutions(level, 2, budget)` : si `count === 0`, le candidat est rejeté
immédiatement (niveau impossible, jamais servi). Si `count !== 1` (plusieurs
solutions, ou budget dépassé sans conclure), le candidat n'est pas rejeté tout de
suite : il est **conservé comme filet de sécurité** (voir la politique
best-effort ci-dessous) et le générateur retente quand même une nouvelle seed en
espérant mieux, jusqu'à épuisement du budget global de la Phase F.

### Phase E — notation de la difficulté réelle, puis acceptation

C'est la partie vraiment nouvelle par rapport aux scripts existants (détaillée
section 6) : on ne fait pas confiance à la taille/densité pour deviner la
difficulté, on **mesure** la difficulté du candidat validé en observant *quelles
techniques le solveur a dû utiliser* pour le résoudre. Si le palier mesuré ne
correspond pas au palier demandé, le candidat est traité comme la Phase D
(conservé comme filet de sécurité si rien de mieux n'est trouvé, mais on retente).

### Phase F — budget global et politique best-effort (décidé)

Le générateur boucle sur les phases A→E jusqu'à trouver un candidat **parfait**
(solution unique ET palier de difficulté mesuré == palier demandé), ou jusqu'à
épuiser un budget global (nombre de tentatives ET temps écoulé, le premier des
deux qui tombe — proposition de départ : 40 tentatives ou 3 secondes). Si le
budget s'épuise sans candidat parfait, on sert le **meilleur candidat rencontré**
selon cet ordre de préférence :

1. solution unique, palier de difficulté différent du palier demandé (mieux vaut
   un niveau honnête mais mal calibré qu'un niveau ambigu) ;
2. plusieurs solutions, mais palier de difficulté correct ;
3. plusieurs solutions et palier incorrect (dernier recours, seulement si rien de
   mieux n'a été vu du tout) ;
4. jamais un candidat à 0 solution (toujours rejeté, quel que soit le budget).

Dans les cas 2 et 3 (solution non unique), l'écran de jeu affiche un badge discret
(« variante multiple » ou équivalent) plutôt que de le faire passer pour un niveau
à solution unique comme les autres — transparence envers le joueur plutôt que
correction silencieuse.

## 5. Modèle de features sélectionnables

| Feature (UI)                | CellType(s)                | Dépend de | Poids |
|------------------------------|-----------------------------|-----------|:-----:|
| Cases interdites              | FORBIDDEN                   | —         | 1     |
| Couleur (charges + cibles)    | CLUE coloré, TARGET          | —         | 3     |
| Miroir dévieur                | MIRROR                      | Couleur   | 2     |
| Filtre                        | FILTER                      | Couleur   | 2     |
| Prisme                        | PRISM                       | Couleur   | 3     |
| Pyra                          | PYRA                        | —         | 3     |
| Neurone miroir *(expérimental)* | MIRROR_NEURON              | —         | 5     |

Interprétation : chaque palier de difficulté a un **budget de complexité** (section
6). Le générateur tire au hasard, parmi les features cochées par le joueur ET
respectant leurs dépendances, un sous-ensemble dont la somme des poids tient dans
le budget — avec de la variance (un niveau 3★ avec Prisme+Filtre+Couleur cochés
n'utilisera pas forcément les trois à chaque génération). C'est ce qui garantit
que « tout coché » ne fige pas un seul type de niveau.

Note sur « Couleur » : c'est une méta-feature. Sans elle, Miroir/Filtre/Prisme
n'ont pas de sens (ils manipulent des lasers colorés) — l'UI les grise
automatiquement tant que Couleur n'est pas cochée, plutôt que de les laisser
sélectionnables pour rien.

Note sur le Neurone miroir : c'est de loin la mécanique la plus chère à générer et
vérifier (voir les deux bugs de solveur corrigés cette session — la case cible d'un
duplicata doit être revérifiée contre TOUT le mouvement en cours, et le solveur doit
savoir qu'une case exclue reste « à risque » si elle est sur la ligne/colonne d'un
neurone). Proposition : **désactivé par défaut**, activable en option ; même
activé, jamais plus d'une occurrence par niveau, et seulement pour 3★. En plus de la
vérification d'unicité standard, faire tourner une passe d'invariant dédiée (le
même style de vérif que `test-mirror-los.mjs` de cette session : aucune lumière ne
doit en voir une autre directement après génération) avant d'accepter un candidat
qui en contient un — filet de sécurité supplémentaire vu l'historique récent.

## 6. Paliers de difficulté — définition précise

Le piège classique (déjà documenté dans la littérature sur la génération de
Sudoku) : la difficulté perçue par un humain n'est **pas** proportionnelle à la
taille de la grille ou au nombre d'indices manquants, elle dépend de la technique
de résolution la plus avancée nécessaire. `solver.js` a *déjà* cette info : le
propagateur a deux étages (Stage 1 = déduction indice par indice, Stage 2 =
interaction entre paires d'indices), et tout ce qui reste après ça exige une
hypothèse de branchement (deviner).

Proposition : ajouter à `solver.js` une fonction d'introspection,

```js
export function analyzeSolve(level, maxNodes) {
  // Fait tourner la même recherche que findSolution, mais retient :
  // - usedStage2: au moins une déduction Stage 2 a servi
  // - branched: au moins un point où aucune déduction certaine n'existait
  //   (il a fallu émettre une hypothèse, pas juste appliquer une règle sûre)
  // - moves: taille de la solution trouvée
  // Tier logique induit :
  //   1 si !usedStage2 && !branched
  //   2 si (usedStage2 || branched) mais résolu avec peu de branchements
  //   3 si un vrai branchement profond a été nécessaire
}
```

C'est un ajout court : les fonctions `countSolutions`/`enumerateSolutions`/
`findSolution` sont déjà ~90 % identiques (bonne occasion, au passage, de les
faire partager un seul cœur de recherche paramétré plutôt que trois copier-coller
— nettoyage indépendant du mode Infini mais qui le rendrait plus simple).

Grille croisée **recalibrée** après un premier retour utilisateur ("le difficile
actuel joue comme un intermédiaire ; il faut aussi des lieux de doute, pas
seulement une grille plus grande") et validée empiriquement via
`generateLevel()` réel (25-30 tirages/palier, `DIFFICULTY_PRESETS` dans
`generator.js`) :

| Palier | Taille   | Densité obstacles | Budget poids feature | Budget noeuds solveur | Tier solveur exigé |
|--------|----------|--------------------|:---:|:---:|:---:|
| 1★     | 6×6 – 7×7 | ~0.28 – 0.36       | ≤6  | 400k | 1 (jamais de Stage 2, peu de branchement) |
| 2★     | 7×7 – 8×8 | ~0.20 – 0.28       | ≤8  | 600k | 2 (Stage 2 sans branchement lourd, OU branchement seul sans Stage 2) |
| 3★     | 8×8 – 9×9 | ~0.14 – 0.20       | ≤12 | 500k | 3 (Stage 2 requis ET branchement > 250 nœuds) |

Chaque palier correspond à l'ancien palier du dessus moins un cran (l'ancien
« 3★ » ≈ nouveau 2★), et le nouveau 3★ exige explicitement un « lieu de
doute » mesuré (`stage2Used === true` dans `analyzeSolve`, voir solver.js) —
pas seulement de la taille de grille. La colonne « tier solveur exigé » est
celle qui décide vraiment si un candidat est accepté pour le palier demandé —
taille/densité ne sont que des leviers de génération, réajustés
automatiquement (retry) si le tier mesuré ne correspond pas.

Le palier 3★ est plafonné à 9×9 : un sweep empirique a montré des pics de
latence jusqu'à ~50s sur des grilles 10×10 clairsemées pour une seule analyse
de solveur — bien au-delà de ce qu'un budget de génération peut absorber.
Pour compenser le coût par tentative plus élevé à ce palier (countSolutions +
analyzeSolve à faible densité), le budget de génération (Phase F) est
lui-même différencié par palier plutôt qu'uniforme : ~2s/40 tentatives pour
1★, ~3s/40 pour 2★, jusqu'à ~10s/100 tentatives pour 3★ (le Worker tourne
hors du thread UI, donc ce délai plus long ne bloque jamais l'interface).
Avec ce calibrage, le taux de candidats "parfaits" (solution unique ET
palier mesuré == palier demandé) mesuré est ~100 % en 1★/2★ et ~60-70 % en
3★ ; le reste retombe honnêtement en 2★ (jamais mal étiqueté, jamais 0
solution) plutôt que d'échouer.

Pour les étoiles **en jeu** (1-3 étoiles selon le nombre de coups du joueur, système
déjà existant via `starThresholds`/`computeStars`), le générateur doit remplir
explicitement `starThresholds: [solution.length, Math.ceil(solution.length * 1.5)]`
sur le niveau généré — la solution est déjà connue à la génération, pas la peine de
laisser `main.js` la recalculer au moment de la victoire comme il le fait déjà pour
les niveaux statiques sans seuils explicites.

## 7. UX proposée

- Nouvelle entrée à côté du bouton `#btn-mode-toggle` actuel (`Jouer` / `Éditeur`) :
  un mode `Infini`, troisième vue (`#infinite-view`).
- Écran de configuration (avant de lancer) :
  - 3 boutons radio étoiles (1/2/3), esthétique cohérente avec `.win-star` déjà
    utilisée à l'écran de victoire ;
  - liste de checkboxes features, reprenant les libellés déjà utilisés dans
    l'éditeur (`Cases interdites`, `Couleur`, `Miroir`, `Filtre`, `Prisme`, `Pyra`,
    `Neurone miroir [expérimental]`), avec les dépendances grisées automatiquement ;
  - bouton `Générer`.
- Pendant la génération (potentiellement quelques centaines de ms à ~1-2s en 3★
  avec beaucoup de features, cf. section 8) : état de chargement dans l'esprit
  esthétique actuel (réseau neuronal qui « calibre »), pas un simple spinner
  générique.
- Une fois généré : même écran de jeu que d'habitude (`#board`), avec un bouton
  `Niveau suivant` qui relance une génération avec les mêmes réglages plutôt que
  d'avancer dans un tableau `levels`.

## 8. Contrainte de performance : Web Worker (décidé)

Les mesures de cette session (`npm run check-unique` sur les niveaux existants)
donnent une idée réaliste des coûts : la plupart des niveaux se vérifient en
quelques ms, mais un niveau avec Neurone miroir a pris ~2.4s, et un niveau dense
sans mécanique spéciale (« Pyras ») a pris ~8s. Le mode Infini va *générer et
rejeter* plusieurs candidats par niveau (retry sur non-unicité et sur mauvais
palier de difficulté) — donc le pire cas cumulé peut dépasser largement le budget
d'un thread UI. Décision : `generator.js` tourne dans un **Web Worker**
(`generator.worker.js`) dès la première version, pas seulement si besoin plus
tard.

Message `{ type: "generate", difficulty, features, seed }` → `{ level, solution,
difficultyReport }`. L'UI reste réactive, l'état de chargement peut afficher une
estimation/progression (nombre de tentatives). Le budget global décrit en Phase F
(40 tentatives ou 3 secondes, premier des deux atteint) borne le Worker — il
répond toujours dans ce délai, avec le meilleur candidat trouvé si besoin (jamais
un blocage indéfini).

Les scripts Node existants (`scripts/*.mjs`) n'ont pas de Worker/DOM : le cœur
`generator.js` doit rester utilisable directement depuis Node (comme
`solver.js`/`grid.js` le sont déjà) — le Worker n'est qu'un wrapper côté navigateur,
pas une dépendance dure du générateur lui-même.

## 9. Plan de phasage proposé

Livrer par étapes plutôt que tout d'un coup, chaque étape jouable seule :

1. **MVP** : formes + FORBIDDEN + CLUE numérique uniquement (pas de couleur, pas de
   mécaniques spéciales). Reprend directement `generate-unique-levels.mjs`, y
   ajoute l'introspection de difficulté (section 6) et le portage navigateur/Worker.
   Le plus gros du risque technique (unicité, perf, UX de génération) est couvert
   ici, avec le périmètre le plus simple à valider.
2. **Couleur** : CLUE colorées + cibles, via la dérivation post-`recompute()`.
3. **Miroir dévieur + Filtre** : nécessitent un placement « le long d'un chemin »,
   un peu plus de logique de construction en phase B.
4. **Prisme + Pyra**.
5. **Neurone miroir** (opt-in, capé à 1/niveau, 3★ uniquement, avec la passe
   d'invariant supplémentaire décrite section 5).

## 10. Risques restants

Les trois décisions d'architecture (unicité best-effort, Worker dès le départ,
MVP en premier — voir « Décisions validées » en tête de document) sont tranchées.
Ce qui reste ouvert, à affiner en implémentant plutôt qu'en discutant dans l'abstrait :

- **Calibrage des seuils** (densité par palier, budget de complexité par feature,
  40 tentatives/3 secondes en Phase F) : ce sont des points de départ raisonnables
  mais pas des lois — à ajuster une fois qu'on génère pour de vrai et qu'on observe
  le taux réel de candidats parfaits par palier/feature.
- **Fréquence réelle du best-effort dégradé** : combien de fois, en pratique, le
  budget de la Phase F s'épuise-t-il avant de trouver un candidat parfait ? Si
  c'est fréquent sur des combos courantes (pas seulement Neurone miroir), ça
  vaudra le coup de retravailler la construction en Phase B/C plutôt que de
  compter sur le retry pur.
- **Ordre de phasage des mécaniques après le MVP** (Couleur → Miroir/Filtre →
  Prisme/Pyra → Neurone miroir, du moins risqué au plus coûteux) : proposé par
  défaut, mais pourra être réordonné librement selon ce qui intéresse le plus une
  fois le MVP en main.

---

Prochaine étape : implémentation de la Phase 1 (MVP) — la partie la plus proche de
code déjà existant et testé.
