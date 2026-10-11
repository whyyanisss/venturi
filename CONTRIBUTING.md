# Contribuer à Venturi

Merci de ton intérêt ! Les issues et pull requests sont les bienvenues.

## Mise en place

```bash
git clone https://github.com/OWNER/venturi.git
cd venturi
sudo apt install iverilog gtkwave   # pour les tests d'intégration
npm test
```

Ouvre le dossier dans VS Code et appuie sur **F5** pour lancer l'extension dans une fenêtre de test
(le dossier `examples/` s'ouvre automatiquement).

## Principes du projet

- **Aucune dépendance** à l'exécution ni au build. Le code est du JavaScript pur (CommonJS).
- **Aucun outil externe obligatoire** au-delà d'`iverilog`, `vvp` et `gtkwave`.
- La logique pure (génération, validation) vit dans `src/gen.js`, sans dépendance à VS Code,
  pour rester testable avec `node --test`.
- Les fichiers `.v` écrits à la main par l'utilisateur ne doivent **jamais** être écrasés sans confirmation.

## Organisation

| Fichier | Rôle |
| --- | --- |
| `src/extension.js` | Activation, commandes, hooks de sauvegarde |
| `src/editor.js` | Fournisseur de l'éditeur personnalisé (côté extension) |
| `src/project.js` | Résolution du schéma, écriture protégée des fichiers, testbench |
| `src/gen.js` | Génération Verilog, testbench, validation (logique pure) |
| `src/sim.js` | `iverilog`, `vvp`, GTKWave, diagnostics |
| `media/editor.js` / `.css` | Interface du canevas (webview) |

## Pull requests

1. Une modification = une PR, avec une description claire.
2. Ajoute ou adapte des tests pour tout changement de `src/gen.js`.
3. `npm test` doit passer.
4. Mets à jour `CHANGELOG.md` (section « Non publié »).

## Publier une version (mainteneurs)

1. Mettre à jour `version` dans `package.json` et `CHANGELOG.md`.
2. `git tag vX.Y.Z && git push --tags` : le workflow `release` vérifie la version, lance les tests,
   construit le `.vsix` et l'attache à une release GitHub.
3. Publication sur le Marketplace : définir le secret `VSCE_PAT` du dépôt, le workflow publie alors aussi.
