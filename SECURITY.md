# Politique de sécurité

## Signaler une vulnérabilité

Merci de **ne pas** ouvrir d'issue publique. Utilise l'onglet *Security → Report a vulnerability*
du dépôt GitHub (signalement privé).

## Périmètre

Venturi exécute les programmes `iverilog`, `vvp` et `gtkwave` sur ta machine.
Pour limiter les risques :

- l'extension refuse de s'activer dans un espace de travail non fiable ;
- les réglages qui désignent des exécutables ou leurs arguments sont de portée *machine* ;
- les processus sont lancés sans interpréteur de commandes (`child_process.spawn`, sans shell).

Ouvre malgré tout uniquement des projets en lesquels tu as confiance : un testbench Verilog peut,
par nature, exécuter des commandes système (`$system`) pendant la simulation.
