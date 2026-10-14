# Changelog

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet
[le versionnage sémantique](https://semver.org/lang/fr/).

## [0.3.0] — 2026-10-14

### Alignement des ports
- **Ports sur la grille de 20 px** : un bloc posé sur la grille a tous ses ports sur la grille (hauteurs de blocs multiples de 40, ports
  répartis symétriquement, largeurs multiples de 20). Deux blocs posés sur la grille se relient par un **fil droit** dès que leurs ports sont
  à la même hauteur, sans « aimant » approximatif. Les entrées/sorties du top font 80×40.
- **⇉ Redresser** : aligne les blocs sélectionnés (ou tous) à la hauteur de leurs sources, de gauche à droite (médiane s'il y a plusieurs sources).
  **Réglages ▸ Aligner sur la grille** cale tous les blocs sur la grille. Un schéma ancien hors grille est signalé, jamais modifié sans toi.
- **Guides d'alignement** pendant le glissement d'un bloc (ligne pointillée quand un port s'aligne avec un autre) et **flèches du clavier**
  (un pas de grille ; Alt = 1 px).
- **Port `sel` d'un mux** : côté automatique (au-dessus du bloc si sa source est plus haut, en dessous sinon), réglable (auto / haut / bas) ;
  le fil arrive en L direct quand la source est du bon côté. La position de `sel` ne fait plus partie de la structure du module.
  Le bord haut d'un mux est maintenant incliné comme le bord bas pour le calcul de la position des ports.

### État du Verilog
- **Fichiers ▸ État du Verilog…** : une ligne par module (*à jour*, *en retard sur le schéma*, *pas encore généré*, *modifié à la main — en-tête
  à jour*, *modifié à la main — en-tête à adapter*, *orphelin*) avec *Ouvrir*, *Comparer*, *Mettre à jour* (fichier par fichier, avec la fenêtre
  de confirmation habituelle) et *Archiver (.bak)* pour les orphelins (jamais supprimés).
- Réglage **`venturi.generateOn`** : `save` (défaut), `change` (le Verilog suit l'éditeur, sans fenêtre : les fichiers modifiés à la main sont
  conservés et signalés) ou `manual`. Remplace `generateOnSave`.

### Nouveaux blocs
- **Constante** (décimal, `0xFF`, `0b1010`), **porte logique** (ET, OU, OU exclusif, NON-ET, NON-OU, NON-OU exclusif, NON ; 2 à 8 entrées),
  **comparateur** (`== != < <= > >=`), **compteur** (enable, compte/décompte), **décaleur** (`<< >> >>>` de N bits),
  **extraction de bits** `[haut:bas]`, **concaténation** (2 à 8 entrées) et **RAM** synchrone (largeur de données et d'adresse).
- Compacts par défaut (sauf la RAM), avec leur symbole dessiné ; le nom de module suit l'opération (`and2`, `cmp_ge`, `shift_sra`…) et la
  valeur, le décalage ou les bits sont des **paramètres Verilog** quand ils varient d'une instance à l'autre. Champs facultatifs du
  `.venturi.json` : `op`, `value`, `amount`, `hi`, `lo`, `selAuto`.
- Compteur et RAM comptent pour un cycle dans la latence affichée.

### Fiabilité
- L'éditeur est maintenant testé **dans un vrai DOM (jsdom)** : menus, grille, redressement, guides, flèches, panneaux, nouveaux blocs, ligne de
  coupe, copier-coller, état du Verilog. Un de ces tests a déjà trouvé un défaut (les guides restaient affichés après le glissement).
  `npm install` puis `npm test` ; sans jsdom, ces tests sont simplement ignorés.
- La CI et la release produisent aussi le **zip des sources** (`venturi-<version>-source.zip`).

### Modifié (versions de développement 0.2.2)

### Modifié
- **Les tailles sont des paramètres Verilog.** Changer la largeur d'un port, ou la profondeur d'un registre, ne crée plus de
  nouveau module et ne laisse plus un ancien `.v` inchangé : quand les instances d'un même module n'ont pas toutes la même
  taille, le module est généré **paramétré** (`module regn #(parameter WIDTH = 8) (...)`) et chaque instance fixe sa taille
  dans le top (`regn #(.WIDTH(16)) u_r1 (...)`). Plusieurs largeurs indépendantes donnent un paramètre par groupe
  (`W_a`, `W_s`…), plusieurs profondeurs un paramètre `DEPTH`. Si toutes les instances ont la même taille, le module reste
  littéral (sortie identique à avant). Vaut pour tous les modules : registres, additionneurs, mux, blocs custom.
- Deux blocs qui partagent un module n'ont plus d'erreur « ports différents » à cause d'une largeur : seule une différence de
  **structure** (nom, sens ou rôle d'un port) en provoque une, et l'éditeur donne alors un module dédié (`reg8_2`).
- Nouveaux modules par défaut : `regn` et `addn` (`reg` est un mot réservé en Verilog) ; un registre inséré (clic sur un fil,
  ligne de coupe) réutilise le module d'un registre existant. Les noms existants (`reg8`, `add8`…) restent valables.
- **Blocs compacts de taille fixe** (60×80) : le nom est abrégé s'il est long (nom complet en infobulle) au lieu d'agrandir le bloc.

### Corrigé
- Ajouter un port après en avoir supprimé un pouvait créer un **nom en double** : le nom est maintenant toujours libre.
- Les largeurs de `d` et `q` d'un registre restent identiques (changer l'une change l'autre).
- Passer un port d'entrée en sortie (ou l'inverse) supprime les liens devenus invalides.
- Le nombre d'entrées d'un mux met à jour le nom du module (`mux2`, `mux4`…).

### Sécurité
- **« Ports seulement (garder mon code) »** : nouveau choix de la fenêtre de confirmation. Quand tu as retouché un module à la main
  et qu'une taille change, Venturi met à jour seulement l'**en-tête** (paramètres et ports, donc les tailles) et garde ta logique
  (les `reg` de ton code sont respectés), après une sauvegarde `.bak`. Avant, il fallait tout écraser ou garder un module resté
  figé à son ancienne taille. Jamais appliqué au module top.
- **Plus de faux « Verilog déjà à jour »** : si un fichier est conservé tel quel (modifié à la main, ou « garder » choisi), la barre
  d'état le dit (`conservé tel quel (non régénéré) : reg8.v`). Un clic sur « Générer » repose la question même si tu avais répondu
  « garder » ; la génération automatique, elle, ne rouvre pas de fenêtre mais le signale.
- La **version chargée** s'affiche dans la barre d'outils (`v0.2.2`) pour vérifier qu'on utilise bien la dernière installation
  (même numéro de version = VS Code ignore la réinstallation sans `--force`).
- **Confirmation avant d'écraser** : si un `.v` a été modifié à la main (ou n'a pas été généré par Venturi), la régénération
  ouvre une **fenêtre modale** (*Écraser (avec sauvegarde)* / *Comparer* / *Garder mon code*). Rien n'est écrit sans ton accord ;
  « Comparer » ouvre le diff sans rien modifier. Avant tout écrasement, ta version est copiée dans un `.bak` **horodaté**
  (une sauvegarde n'en remplace jamais une autre — avant, un seul `.bak` était réutilisé).
- Réglage `venturi.confirmOverwrite` : `modified` (défaut) ou `always` (confirmer avant de réécrire n'importe quel `.v`).
- Un module écrit à la main dont les ports n'ont pas changé reste intouché, sans question.

### Ajouté
- Menu *Fichiers* : **Créer tb** (crée `tb/tb_<top>.v` s'il n'existe pas, ne l'écrase jamais), **Simuler + GTKWave**,
  **Ouvrir GTKWave**. Réglage `venturi.gtkwave.openAfterSimulate` pour ouvrir GTKWave après chaque simulation ;
  seuls les `.vcd` écrits par la simulation en cours sont ouverts.
- **Fils déplaçables partout** : les fils qui arrivent par le haut/bas (ex. `sel` d'un mux) ou qui contournent se tirent
  verticalement (champ `my`, facultatif) ; avant, seuls les fils droits se déplaçaient.
- La **ligne de coupe** détecte aussi les fils qui arrivent par le haut ou le bas d'un bloc (`sel` d'un mux).
- Les bandes d'étage commencent 30 px sous le bord haut ; plus aucun bloc ne peut être placé au-dessus de y = 60.
- **Interface** : barre d'outils fixe au-dessus du canevas (plus de boutons qui s'empilent ni qui cachent le schéma),
  menus *Ajouter* / *Réglages* / *Fichiers*, boutons fréquents toujours visibles (✂ Coupe, ▶ Simuler, zoom, latence).
- **Registres et additionneurs compacts par défaut** (nouveaux blocs et nouveaux fichiers) ; l'additionneur compact existe aussi.
- **Blocs custom** : rouge par défaut ; champs facultatifs `w`, `h`, `rx` (largeur, hauteur, arrondi) réglables dans le panneau
  ou par une poignée de redimensionnement. Ignorés par le générateur Verilog.
- **Registre compact** : option `compact` par bloc (case à cocher dans le panneau), plus haut que large, avec le triangle
  d'horloge sur toute la base du rectangle.
- **Fils déplaçables** : le segment vertical d'un fil se tire à la souris ; la position est mémorisée dans le lien (`mx`,
  facultatif) et ignorée par le générateur. Bouton « Tracé automatique » pour l'annuler.
  Champ facultatif dans le `.venturi.json`, ignoré par le générateur Verilog : le format reste en version 1.
- **Insertion d'un registre sur un fil** : double-clic sur un fil ou bouton « + Registre ici ». Largeur reprise du fil,
  module `reg<largeur>` (suffixe `_2`… en cas de conflit de ports), blocs décalés si la place manque.
- **Ligne de coupe** : un registre sur chaque signal qui traverse la ligne (un seul par signal ramifié), blocs de droite décalés.
- **Registre à profondeur N** : champ facultatif `depth` ; génère un module à N étages dont la profondeur est un paramètre
  de l'instance (`DEPTH`) quand elle varie d'une instance à l'autre.
- **Sélection multiple** (rectangle, Maj+clic, Ctrl+A), déplacement de groupe, copier-coller avec liens internes,
  alignement et répartition.
- **Zoom** (molette) et déplacement de la vue (Espace+glisser, clic molette) ; le canevas grandit avec le schéma.
- **Bandes d'étages** : champ facultatif `bands` dans le `.venturi.json` (ignoré par le générateur) et affichage de la latence.
- Le panneau de propriétés s'affiche aussi quand un fil est sélectionné.
- `media/pipeline.js` : logique pure de ces fonctions, couverte par `test/pipeline.test.js`.

## [0.2.1]

### Corrigé
- Documentation : version du `.vsix` dans le README et URL de clonage (`OWNER` remplacé par `whyyanisss`).

## [0.2.0]

### Ajouté
- **Validation du schéma** avant génération : noms d'instance en double, mots réservés Verilog,
  E/S nommées `clk`/`rst`, module partagé avec des ports différents, sens de lien invalide,
  double pilotage, largeurs différentes, entrées non connectées. Les erreurs bloquent la génération,
  les avertissements sont signalés. Détails dans la sortie « Venturi ».
- Champ `version` dans les fichiers `.venturi.json` (format 1), pour de futures migrations.
- Suite de tests (`npm test`) : générateur, validation, et compilation/simulation réelles avec iverilog.
- Intégration continue GitHub Actions et workflow de publication.
- Icône, métadonnées Marketplace, `CHANGELOG`, `CONTRIBUTING`, `SECURITY`.
- Dossier `examples/` et configuration de débogage F5.

### Modifié
- Le schéma créé par « Nouveau schéma » est maintenant complet et sans avertissement
  (entrée → 2 registres → sortie).
- Les réglages `venturi.iverilog.*`, `venturi.vvp.*` et `venturi.gtkwave.path` sont limités à la
  portée *machine* : un dépôt cloné ne peut plus rediriger vers un autre exécutable.

### Corrigé
- « Simuler » lancé pendant une compilation échouait en silence : un message s'affiche désormais.

## [0.1.0]

- Première version : éditeur de schémas blocs, génération Verilog, compilation iverilog,
  simulation vvp, ouverture de GTKWave, création de testbench, protection du code modifié à la main.
