# Changelog

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet
[le versionnage sémantique](https://semver.org/lang/fr/).

## [0.2.0] — Non publié

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
