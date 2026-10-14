'use strict';
/**
 * HTML de l'éditeur (webview). Pure : aucune dépendance à VS Code, donc réutilisée telle quelle par les tests DOM.
 * @param {{nonce:string, cspSource:string, uri:(f:string)=>string, version:string}} o
 */
function buildHtml({ nonce, cspSource, uri, version }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri('editor.css')}">
</head>
<body>
<div id="stage">
  <div id="tools">
    <div id="bar">
      <button data-menu="add" title="Ajouter un bloc, une entrée, une sortie ou une bande d'étage">+ Ajouter ▾</button>
      <button id="cutb" data-a="cut" title="Ligne de coupe : un registre sur chaque fil qui traverse la ligne">✂ Coupe</button>
      <button data-a="straighten" title="Redresser les fils : aligne les blocs sélectionnés (ou tous) à la hauteur de leurs sources">⇉ Redresser</button>
      <button data-menu="set" title="Nom du module top, reset, nomenclature">Réglages ▾</button>
      <span class="sep"></span>
      <button class="p" data-a="cmd:simulate" title="iverilog + vvp">▶ Simuler</button>
      <button data-menu="files" title="Générer, compiler, exporter">Fichiers ▾</button>
      <span class="grow"></span>
      <span class="ver" title="Version de Venturi chargée dans cette fenêtre">v${version}</span>
      <span id="lat" class="lat" title="Plus long chemin entrée → sortie, en cycles d'horloge"></span>
      <span class="sep"></span>
      <button data-a="zoom:out" title="Dézoomer">−</button><button id="zl" data-a="zoom:reset" title="Zoom 100 %">100 %</button><button data-a="zoom:in" title="Zoomer">+</button><button data-a="zoom:fit" title="Tout afficher">Ajuster</button>
    </div>
    <div class="menu" id="m-add" hidden>
      <button data-a="add:register">Registre</button>
      <button data-a="add:adder">Additionneur</button>
      <button data-a="add:mux">Mux</button>
      <button data-a="add:custom">Custom</button>
      <hr>
      <button data-a="add:const" title="Valeur fixe (décimal, 0xFF, 0b1010)">Constante</button>
      <button data-a="add:logic" title="ET, OU, OU exclusif, NON-ET, NON-OU, NON-OU exclusif, NON">Porte logique</button>
      <button data-a="add:cmp" title="==, !=, <, <=, >, >=">Comparateur</button>
      <button data-a="add:counter" title="Compteur avec enable, sens au choix">Compteur</button>
      <button data-a="add:shift" title="Décalage de N bits : <<, >>, >>>">Décaleur</button>
      <button data-a="add:slice" title="Extrait les bits [haut:bas] d'un bus">Extraction de bits</button>
      <button data-a="add:concat" title="Assemble plusieurs bus en un seul : {a, b}">Concaténation</button>
      <button data-a="add:ram" title="Mémoire synchrone : écriture avec we, lecture à l'adresse">RAM</button>
      <hr>
      <button data-a="add:in">Entrée</button>
      <button data-a="add:out">Sortie</button>
      <button data-a="band" title="Zone nommée (IF, ID, EX…) derrière les blocs">Étage (bande)</button>
    </div>
    <div class="menu" id="m-set" hidden>
      <label class="inl">top <input id="top" data-a="top" value="chain"></label>
      <label class="inl">reset <select id="rp" data-a="rst"><option value="low">actif bas</option><option value="high">actif haut</option></select></label>
      <button id="nom" data-a="nom">Nomenclature : normale</button>
      <button data-a="snapgrid" title="Cale tous les blocs sur la grille de 20 px (les ports sont alors tous alignés)">Aligner sur la grille</button>
    </div>
    <div class="menu" id="m-files" hidden>
      <button data-a="status" title="Pour chaque module : à jour, en retard sur le schéma, modifié à la main, orphelin">État du Verilog…</button>
      <button data-a="cmd:generate" title="Écrit rtl/*.v (demande confirmation avant d'écraser un fichier modifié à la main)">Générer .v</button>
      <button data-a="cmd:compile" title="iverilog">Compiler</button>
      <button data-a="cmd:openTop" title="Ouvre le module top à côté">Ouvrir top.v</button>
      <button data-a="cmd:testbench" title="Crée tb/tb_<top>.v s'il n'existe pas (ne l'écrase jamais) et l'ouvre">Créer tb</button>
      <button data-a="cmd:simulateWave" title="Simule puis ouvre GTKWave sur le .vcd produit">Simuler + GTKWave</button>
      <button data-a="cmd:wave" title="Ouvre GTKWave sur le dernier .vcd">Ouvrir GTKWave</button>
      <button data-a="svg">Exporter .svg</button>
    </div>
  </div>
  <div id="main">
    <div id="cvw"><svg id="cv"></svg></div>
    <div id="props" class="ov" hidden></div>
    <div id="vstat" class="ov" hidden></div>
    <div id="hint" class="ov">Glisse un bloc · tire d'un port à l'autre pour câbler · double-clic sur un fil : + registre · rectangle ou Maj+clic : sélection · molette : zoom · Espace+glisser : déplacer la vue</div>
  </div>
</div>
<script nonce="${nonce}" src="${uri('wire.js')}"></script>
<script nonce="${nonce}" src="${uri('kinds.js')}"></script>
<script nonce="${nonce}" src="${uri('pipeline.js')}"></script>
<script nonce="${nonce}" src="${uri('group.js')}"></script>
<script nonce="${nonce}" src="${uri('layout.js')}"></script>
<script nonce="${nonce}" src="${uri('editor.js')}"></script>
</body>
</html>`;
}

module.exports = { buildHtml };
