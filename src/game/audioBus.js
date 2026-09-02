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
// `masterBus`, en aval de TOUT (musique ET effets de jeu, voir music.js/
// sound.js qui s'y connectent tous les deux plutôt que d'appeler chacun
// leur propre `.toDestination()`), est le seul point où la VRAIE somme
// finale peut être surveillée. Tone.Limiter(-1) ne change rien tant que le
// total reste sous -1dBFS, et compresse fortement seulement les pics qui
// dépasseraient — inaudible en usage normal, un pur garde-fou anti-clipping.
export const masterBus = new Tone.Limiter(-1).toDestination();
