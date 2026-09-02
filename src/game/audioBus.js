// Configuration audio GLOBALE partagée par music.js et sound.js — extraite
// ici (plutôt que dupliquée, ou posée arbitrairement dans l'un des deux
// fichiers) pour qu'un seul point de code s'en charge, importé par les deux
// AVANT qu'ils ne créent le moindre node Tone.

import * as Tone from "tone";

// Retour utilisateur: "le son grésille assez vite sur téléphone, et si je
// laisse tourner un peu, ça grésille de plus en plus" — Tone.js démarre par
// défaut sur un contexte audio en latence "interactive" (le plus petit
// buffer possible, pensé pour un jeu de rythme où chaque frappe doit sonner
// quasi instantanément). Or la musique (voir music.js) tourne EN CONTINU dès
// le premier clic et n'est plus jamais interrompue tant que l'app reste au
// premier plan : plusieurs pistes bouclées EN MÊME TEMPS, plus des effets
// partagés (passe-bas/passe-haut/reverb/delay) — un buffer aussi petit
// laisse très peu de marge au thread audio pour absorber la moindre pause
// (le ramasse-miettes JS, un pic de rendu à l'écran, et surtout le
// throttling thermique progressif d'un CPU mobile sous charge soutenue: le
// processeur ralentit au fil des minutes, ce qui explique le "de plus en
// plus"). Un contexte dédié en latence "playback" (buffer nettement plus
// généreux) absorbe ces à-coups sans craquer, au prix d'une latence
// supplémentaire de quelques dizaines de ms au déclenchement d'un son —
// inaudible ici, on n'est pas sur un jeu de rythme.
// DOIT être posé tout en haut du tout premier fichier qui touche Tone —
// c'est justement le rôle de CE module (importé en premier par music.js ET
// sound.js, voir plus bas) : un contexte ne peut plus être changé une fois
// des nodes déjà créés dessus.
Tone.setContext(new Tone.Context({ latencyHint: "playback" }));

// Retour utilisateur: "actuellement ce sont surtout les deux pistes des
// neurones colorés qui saturent" — le grésillement persistait encore après
// le filtre passe-haut "mobile-safe" (voir music.js/sound.js) et le
// changement de contexte ci-dessus : plusieurs couches de musique peuvent
// être débloquées EN MÊME TEMPS (voir music.js: MECHANIC_THRESHOLDS ne
// s'excluent pas entre elles), et un effet de jeu (pose, victoire...) peut
// se déclencher PENDANT que plusieurs de ces couches jouent déjà — sans
// AUCUN limiteur nulle part dans la chaîne jusqu'ici, cette somme peut
// dépasser 0dBFS et ÉCRÊTER (clipping numérique), ce qui sonne exactement
// comme un grésillement/une distorsion, et empire mécaniquement à mesure
// que plus de couches se débloquent au fil d'un niveau — une cause
// entièrement DIFFÉRENTE (et cumulable) du CPU/de la latence déjà traités.
//
// Retour utilisateur (round suivant): "le son grésille toujours un peu [...]
// il faut être un peu plus radical". Un `Tone.Limiter` seul est un pur
// écrêteur dur (brickwall): tant que le total reste sous le seuil il ne
// touche à RIEN, puis au-delà il coupe instantanément et sans transition —
// sur un signal qui frôle souvent ce seuil (plusieurs couches + SFX qui
// s'ajoutent en continu), cet écrêtage répété peut lui-même sonner comme un
// grésillement, même une fois toutes les sources individuellement
// raisonnables. `compressor` est posé EN AMONT du limiteur pour réduire la
// somme PROGRESSIVEMENT dès -24dB (ratio 4:1, genou doux de 12dB pour éviter
// tout effet de "pompage" audible) plutôt que d'attendre le tout dernier
// moment: le limiteur en aval devient un pur filet de sécurité pour les
// pics résiduels, au lieu de faire tout le travail lui-même en permanence.
const compressor = new Tone.Compressor({
  threshold: -24,
  ratio: 4,
  attack: 0.003,
  release: 0.25,
  knee: 12,
});

const limiter = new Tone.Limiter(-1).toDestination();
compressor.connect(limiter);

// `masterBus` reste le point d'entrée unique importé par music.js/sound.js
// (aucun changement requis dans ces deux fichiers) — il pointe maintenant
// vers le compresseur plutôt que directement vers le limiteur, ce dernier
// restant caché en aval dans cette même chaîne.
export const masterBus = compressor;
