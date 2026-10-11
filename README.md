# Venturi, schéma bloc → Verilog


Dessine ton circuit sous forme de **schéma bloc** (registres, additionneurs, multiplexeurs, blocs
personnalisés, entrées/sorties), et Venturi **génère le Verilog**, le **compile avec Icarus Verilog**, le
**simule** et ouvre les ondes dans **GTKWave**, sans quitter VS Code.

Aucune dépendance npm, aucun build : seuls `iverilog`, `vvp` et (optionnellement) `gtkwave` sont requis.

## Fonctionnalités

- **Éditeur graphique** : glisser-déposer des blocs, câblage de port à port, bus avec largeur, copier/coller,
  export SVG.
- **Génération Verilog** à chaque sauvegarde : un module par type de bloc (squelette que tu complètes)
  et un module top qui relie les instances.
- **Validation du schéma** : instances en double, mots réservés, ports incohérents, double pilotage,
  largeurs différentes, entrées non connectées…
- **Compilation intégrée** : les erreurs d'`iverilog` apparaissent dans l'onglet *Problèmes*, sur la bonne ligne.
- **Simulation et ondes** : bouton ▶ pour `vvp`, commande pour ouvrir GTKWave.
- **Testbench** prêt à l'emploi (horloge, reset, `$dumpfile`).
- **Ton code n'est jamais écrasé par surprise** : chaque fichier généré porte une empreinte
  `// venturi:<hash>`. Un fichier modifié à la main est conservé tant que ses ports correspondent au schéma ;
  sinon une confirmation est demandée et une copie `.bak` est faite.

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

Télécharge le fichier `.vsix` depuis les [Releases](https://github.com/OWNER/venturi/releases), puis :

```bash
code --install-extension venturi-0.2.0.vsix
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
| `venturi.generateOnSave` | `true` | Régénère le Verilog à la sauvegarde du schéma |
| `venturi.compileOnSave` | `true` | Compile à la sauvegarde d'un schéma ou d'un `.v` de `rtl/` ou `tb/` |
| `venturi.simTop` | *(auto)* | Module à simuler (`-s`) ; vide = `tb_<top>`, `<top>_tb`, `tb`… |
| `venturi.simTimeoutSec` | `60` | Durée maximale d'une simulation |
| `venturi.iverilog.path` / `.args` | `iverilog` / `["-g2012"]` | Commande et arguments d'`iverilog` |
| `venturi.vvp.path` / `.args` | `vvp` / `[]` | Commande et arguments de `vvp` |
| `venturi.gtkwave.path` | `gtkwave` | Commande de GTKWave |

Les réglages d'exécutables sont limités à la portée *machine* (réglages utilisateur) : un dépôt cloné
ne peut pas rediriger Venturi vers un autre programme.

## Format de fichier

Un schéma est un fichier JSON `*.venturi.json` lisible et versionnable :
`{ "version": 1, "topName", "rstLow", "blocks": [...], "links": [{ "from": "r1.q", "to": "r2.d" }] }`.
Voir [`examples/chain.venturi.json`](examples/chain.venturi.json).

## Développement

```bash
git clone https://github.com/OWNER/venturi.git
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
