# Venturi, schéma bloc → Verilog


Dessine ton circuit sous forme de **schéma bloc** (registres, additionneurs, multiplexeurs, blocs
personnalisés, entrées/sorties), et Venturi **génère le Verilog**, le **compile avec Icarus Verilog**, le
**simule** et ouvre les ondes dans **GTKWave**, sans quitter VS Code.

Aucune dépendance npm, aucun build : seuls `iverilog`, `vvp` et (optionnellement) `gtkwave` sont requis.

## Fonctionnalités

- **Éditeur graphique** : glisser-déposer des blocs, câblage de port à port, bus avec largeur, copier/coller,
  export SVG.
- **Fils droits** : tous les ports sont sur une grille de 20 px ; *⇉ Redresser* aligne les blocs sur leurs sources, *Réglages ▸ Aligner
  sur la grille* cale un ancien schéma, des guides s'affichent pendant le glissement et les flèches déplacent d'un pas.
- **Port `sel` du mux automatique** : il se place du côté de sa source (réglable).
- **Blocs prêts à l'emploi** : constante, porte logique, comparateur, compteur, décaleur, extraction de bits, concaténation, RAM
  (*+ Ajouter*). Le module suit l'opération et les réglages variables deviennent des paramètres Verilog.
- **État du Verilog** (*Fichiers ▸ État du Verilog…*) : pour chaque module, à jour / en retard / modifié à la main / orphelin, avec les
  actions *Ouvrir*, *Comparer*, *Mettre à jour*, *Archiver*. Réglage `venturi.generateOn` (`save`, `change`, `manual`).
- **Registres et additionneurs compacts par défaut** : blocs étroits (nom + largeur, triangle d'horloge sur toute la base),
  pour dessiner de grands pipelines. La case « Compact » du panneau permet de revenir à la taille normale.
- **Blocs custom vraiment libres** : rouges par défaut, largeur / hauteur / arrondi réglables dans le panneau, ou à la
  souris avec la poignée du coin bas-droit ; « Taille automatique » rétablit le calcul automatique.
- **Barre d'outils unique et fixe** au-dessus du canevas (elle ne recouvre plus rien) ; les actions sont rangées dans
  trois menus : *Ajouter*, *Réglages*, *Fichiers*.
- **Ligne de coupe** (*✂ Coupe*) : un clic à l'endroit voulu et chaque signal qui traverse la ligne reçoit un registre,
  à sa bonne largeur. Un signal qui alimente plusieurs blocs n'obtient qu'un registre ; les blocs de droite sont décalés.
  Les fils concernés s'éclairent pendant que tu déplaces la ligne.
- **Registre à profondeur N** : champ « Profondeur » d'un registre. Pile dessinée avec un badge `×4`, un seul module
  qui retarde le signal de N cycles ; la profondeur est un paramètre de l'instance.
- **Tailles paramétrées** : changer la largeur d'un port ou la profondeur d'un registre modifie le *même* fichier `.v`
  (`parameter WIDTH`) et la taille est fixée par instance dans le top (`regn #(.WIDTH(16)) u_r1`), au lieu de créer un
  module par taille. Vaut pour tous les modules.
- **Sélection multiple** : rectangle sur le fond ou Maj+clic, déplacement de groupe, Ctrl+A, copier-coller (Ctrl+C/V/D)
  avec les liens internes, et boutons *Aligner* / *Répartir*.
- **Zoom et déplacement** : molette pour zoomer, Espace+glisser (ou clic molette) pour déplacer la vue, boutons − / % / + / Ajuster.
- **Bandes d'étages** (*+ Étage*) : zones nommées (IF, ID, EX, MEM, WB…) derrière les blocs, à déplacer et redimensionner
  par l'en-tête. La **latence** (plus long chemin entrée → sortie, en cycles) s'affiche dans la barre d'outils.
- **Écriture sécurisée du Verilog** : un fichier modifié à la main n'est jamais écrasé sans une fenêtre de confirmation
  (écraser avec sauvegarde `.bak` horodatée, mettre à jour seulement les ports en gardant ton code, comparer, ou garder
  ton code). La barre d'état dit toujours ce qui a été écrit et ce qui a été conservé tel quel. Réglage `venturi.confirmOverwrite`.
- **Testbench et ondes** : *Fichiers ▸ Créer tb* (ne remplace jamais un tb existant), *Simuler + GTKWave*, *Ouvrir GTKWave*.
- **Fils déplaçables** : tire un fil pour décaler son segment vertical ; « Tracé automatique » remet le tracé par défaut.
- **Insérer un registre sur un fil** : double-clic sur un fil (ou *+ Registre ici* dans le panneau). Le fil est coupé,
  le registre prend la largeur du fil, son module s'appelle `reg<largeur>` (`reg16`…) et l'espace manquant est créé
  en décalant les blocs à droite.
- **Génération Verilog** à chaque sauvegarde : un module par type de bloc (squelette que tu complètes)
  et un module top qui relie les instances.
- **Validation du schéma** : instances en double, mots réservés, ports incohérents, double pilotage,
  largeurs différentes, entrées non connectées…
- **Compilation intégrée** : les erreurs d'`iverilog` apparaissent dans l'onglet *Problèmes*, sur la bonne ligne.
- **Simulation et ondes** : bouton ▶ pour `vvp`, commande pour ouvrir GTKWave.
- **Testbench** prêt à l'emploi (horloge, reset, `$dumpfile`).
- **Ton code n'est jamais écrasé par surprise** : chaque fichier généré porte une empreinte
  `// venturi:<hash>`. Un fichier modifié à la main est conservé tant que ses ports correspondent au schéma ;
  sinon une **fenêtre de confirmation** est demandée (écraser, comparer ou garder ton code) et ta version est copiée
  dans un `.bak` horodaté.

## Installation

### Prérequis

```bash
# Debian / Ubuntu / WSL
sudo apt install iverilog gtkwave
```

Sous Windows, utilise **WSL** et ouvre ton projet depuis WSL (`cd ~/mon_projet && code .`) :
l'extension s'exécute côté WSL et appelle directement `iverilog`, `vvp` et `gtkwave`.
Évite les dossiers sous `/mnt/c` (lent). GTKWave a besoin de WSLg (Windows 11 ou WSL récent) pour afficher sa fenêtre.

### Extension

Télécharge le fichier `.vsix` depuis les [Releases](https://github.com/whyyanisss/venturi/releases), puis :

```bash
code --install-extension venturi-0.3.0.vsix
```

Pour la coloration syntaxique du Verilog, installe aussi *Verilog-HDL/SystemVerilog* (`mshr-h.veriloghdl`).

## Démarrage rapide

1. `Ctrl+Shift+P` → **Venturi : Nouveau schéma** : crée `schema/<top>.venturi.json`.
2. Ajoute des blocs avec la barre d'outils, relie-les en tirant d'un port à un autre.
   **Double-clic sur un bloc** = ouvre son `.v` à côté.
3. **Ctrl+S** : le Verilog est (re)généré dans `rtl/` puis compilé.
4. **Venturi : Créer un testbench** → `tb/tb_<top>.v`.
5. **▶ Simuler**, puis **Ouvrir les ondes (GTKWave)**.

Un schéma d'exemple est fourni dans [`examples/`](examples/).

## Commandes

| Commande | Rôle |
| --- | --- |
| Venturi : Nouveau schéma | Crée un schéma de départ dans `schema/` |
| Venturi : Générer le Verilog | Écrit les fichiers dans `rtl/` |
| Venturi : Compiler (iverilog) | Compile `rtl/` et `tb/`, affiche les diagnostics |
| Venturi : Simuler (vvp) | Compile puis exécute la simulation |
| Venturi : Ouvrir les ondes (GTKWave) | Ouvre le `.vcd` le plus récent de `build/` |
| Venturi : Créer un testbench | Crée `tb/tb_<top>.v` |
| Venturi : Voir le JSON du schéma | Ouvre le fichier en texte |

## Réglages

| Réglage | Défaut | Description |
| --- | --- | --- |
| `venturi.rtlDir` | `rtl` | Dossier du Verilog généré |
| `venturi.tbDir` | `tb` | Dossier des testbenches |
| `venturi.buildDir` | `build` | Sortie (`.vvp`, `.vcd`) |
| `venturi.generateOn` | `save` | `save` : à l'enregistrement ; `change` : à chaque modification (sans fenêtre) ; `manual` : sur demande |
| `venturi.compileOnSave` | `true` | Compile à la sauvegarde d'un schéma ou d'un `.v` de `rtl/` ou `tb/` |
| `venturi.simTop` | *(auto)* | Module à simuler (`-s`) ; vide = `tb_<top>`, `<top>_tb`, `tb`… |
| `venturi.simTimeoutSec` | `60` | Durée maximale d'une simulation |
| `venturi.iverilog.path` / `.args` | `iverilog` / `["-g2012"]` | Commande et arguments d'`iverilog` |
| `venturi.vvp.path` / `.args` | `vvp` / `[]` | Commande et arguments de `vvp` |
| `venturi.gtkwave.path` | `gtkwave` | Commande de GTKWave |
| `venturi.gtkwave.openAfterSimulate` | `false` | Ouvre GTKWave à la fin de chaque simulation réussie |
| `venturi.confirmOverwrite` | `modified` | `modified` : confirmation avant d'écraser un `.v` modifié à la main ; `always` : avant tout écrasement |

Les réglages d'exécutables sont limités à la portée *machine* (réglages utilisateur) : un dépôt cloné
ne peut pas rediriger Venturi vers un autre programme.

## Format de fichier

Un schéma est un fichier JSON `*.venturi.json` lisible et versionnable :
`{ "version": 1, "topName", "rstLow", "blocks": [...], "links": [{ "from": "r1.q", "to": "r2.d" }] }`.
Voir [`examples/chain.venturi.json`](examples/chain.venturi.json).

## Développement

```bash
git clone https://github.com/whyyanisss/venturi.git
cd venturi
code .        # puis F5 pour lancer l'extension dans une fenêtre de test
npm test      # tests unitaires + simulation iverilog (ignorée si iverilog est absent)
npm run package   # produit venturi-<version>.vsix
```

Aucune dépendance à installer. Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Feuille de route

- Nouveaux blocs : constantes, découpe/concaténation de bus, logique, compteur, mémoire
- Paramètres Verilog (`#(parameter WIDTH=8)`)
- Schémas hiérarchiques
- Zoom, sélection multiple, routage amélioré
- Erreurs de compilation affichées directement sur les blocs
- Testbench avec stimuli définis dans le schéma

## Licence

[MIT](LICENSE)
