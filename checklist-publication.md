# Synups — ce qui manque avant une vraie publication

Audit du code fait le 14/09/2026. Classé par urgence : ce qui bloque la soumission, ce qui est légalement requis, ce qui est une question de produit à trancher, et ce qui peut attendre.

## 1. Bloquant technique (la soumission plantera ou trichera sans ça)

- ~~**AdMob encore en IDs de test partout**~~ **Fait pour le rewarded** : c'est l'AdMob "invalid traffic policy" qui interdisait de tester avec de vrais IDs sans précaution (pas une question de légalité) — l'ad unit réel du rewarded est maintenant actif dans `ads.js`/`AndroidManifest.xml`, protégé par un mécanisme `TESTING_DEVICE_IDS` (voir commentaire en tête d'`ads.js`) : ton propre appareil doit y être déclaré (ID récupéré dans le logcat au premier lancement natif) pour ne recevoir que des pubs de test dessus, tous les autres joueurs recevront de vraies pubs normalement. **Reste à faire** : aucun ad unit réel n'existe encore pour l'interstitiel ni le bandeau — à créer dans la console AdMob, ils restent sur les IDs de test public en attendant (sans risque).
- **Google Play Games Services jamais configuré réellement** (`android/app/src/main/res/values/strings.xml`) : `games_app_id` est toujours le placeholder `000000000000`. Tant que ça reste ainsi, la sauvegarde/synchro de progression via Play Games échoue silencieusement (le jeu tourne, mais cette fonctionnalité ne fait rien). Il faut créer le jeu dans Play Console (Play Games Services), récupérer l'Application ID, l'OAuth client ID web et déclarer le SHA-1 de la clé de signature.
- **Pas de clé de signature Android configurée** : `android/app/build.gradle` n'a aucun `signingConfig` (le bloc `release {}` ne signe rien). Il faut générer un keystore de production et le configurer — ou passer par Android Studio pour un "Generate Signed Bundle" — avant de pouvoir uploader un `.aab` sur Play Console. À faire une seule fois et à conserver précieusement (perdre ce keystore empêche de publier des mises à jour futures).
- ~~**Minification Android désactivée**~~ **Fait** : `minifyEnabled true` + `shrinkResources true` activés dans `android/app/build.gradle`.
- ~~**Certificat/profil de distribution iOS**~~ / ~~**Liste SKAdNetwork (iOS)**~~ **Abandonné** : "on oublie tout ce qui est iOS, on publie uniquement sur Android" — plus pertinent, iOS reste tel quel dans le repo (non maintenu) sans bloquer Android.

## 2. Légal / conformité store

- ~~**Politique de confidentialité pas vraiment publiée**~~ **Fait** : hébergée sur Firebase Hosting (`https://synups-3b038.web.app/`, déjà déployé), lien ajouté dans Options, adresse de contact remplacée par `synups-support@googlegroups.com` (Google Group gratuit, reçu par l'email perso sans jamais l'exposer), et le passage sur le retrait de niveau publié précisé (self-service, plus besoin d'email pour ça). **Rappel** : relancer `firebase deploy --only hosting` à chaque future modif de `public/privacy-policy.html` pour republier.
- **Formulaire "Sécurité des données" de Play Console** à remplir : d'après le code, l'app collecte un UID anonyme Firebase, un pseudo optionnel choisi par le joueur, des données Analytics (Firebase Analytics) et l'ID publicitaire via AdMob — à déclarer précisément dans ce formulaire.
- **Questionnaire de classification par âge** (Play Console) à remplir — reste à faire côté console, mais le risque principal identifié est maintenant mitigé : ~~un joueur mal intentionné pourrait glisser une URL/email/téléphone dans son pseudo ou le titre d'une grille~~ **Fait** : pseudo et titre de grille (les deux seuls champs de texte libre visibles par d'autres joueurs) n'acceptent plus que lettres (accents compris) et espaces, filtré en direct pendant la saisie (`storage.js: sanitizePlayerText`) — impossible d'y glisser un chiffre, un `@`, un `.` ou un `/`.

## 3. Fiche store (rien n'existe encore de ce côté)

- Icône de l'app et écran de démarrage natifs : déjà personnalisés (thème sombre cohérent avec le jeu), pas de souci ici.
- Manquants à préparer : captures d'écran (téléphone + tablette pour Play, plusieurs tailles pour l'App Store), image de couverture ("feature graphic" Play), description courte/longue, choix de catégorie.

## 4. Produit — décision à prendre

- **Le bouton "Désactiver les publicités" est une maquette sans aucune action réelle** (`onclick = () => {}`, volontaire jusqu'ici). Avant publication il faut soit l'implémenter pour de vrai (Google Play Billing / IAP), soit le masquer — un bouton d'achat visible qui ne fait rien est mauvais pour l'expérience et risque une remarque en review store.
- **Une seule langue disponible (français)** : l'architecture i18n existe et est prête à recevoir d'autres langues (`src/game/i18n.js`), mais seul `fr.js` a été rempli — la tâche "i18n 11 langues" est restée en attente. À trancher : lancer en FR uniquement (légitime pour une v1) ou traduire au moins l'anglais avant de sortir à l'international.

## 5. Qualité / tests avant mise en ligne

- ~~Vérifier en conditions réelles que le fix de synchro pseudo/badge/bannière fonctionne~~ **Fait (déjà testé).**
- ~~Tester sur plusieurs appareils Android réels~~ **Fait (déjà testé).**
- Le pool de génération en arrière-plan du mode Arcade (`infiniteClient.js`) reste le principal poste de consommation CPU identifié lors de l'audit chauffe — laissé tel quel par choix, mais bon à garder en tête si des retours "ça chauffe" reviennent après publication.

## 6. Peut clairement attendre (déjà identifié comme différé)

- Thème Rétro : icônes du menu en vrais sprites pixel-art, effets sonores en chiptune — le thème fonctionne déjà (débloqué via Remember), ce ne sont que des finitions cosmétiques.
- Traductions au-delà du français.
