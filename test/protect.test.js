'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/protect');

const mod = (ports = 'input clk, output q') => `module m (${ports});\nendmodule\n`;
const gen = (body) => P.stamp(body);

test('stamp / pristine : un fichier non modifié est reconnu, un fichier retouché non', () => {
  const f = gen(mod());
  assert.equal(P.pristine(f), true);
  assert.equal(P.pristine(f + '// ma modif\n'), false);
  assert.equal(P.pristine(mod()), false);                         // sans empreinte
});

test('classify : fichier absent → écriture directe', () => {
  assert.deepEqual(P.classify(null, gen(mod())), { action: 'write', reason: 'new' });
});

test('classify : identique → rien', () => {
  const f = gen(mod());
  assert.equal(P.classify(f, f).action, 'same');
});

test('classify : fichier jamais modifié → mise à jour sans demander', () => {
  const old = gen(mod('input clk, output q'));
  const neu = gen(mod('input clk, input d, output q'));
  assert.deepEqual(P.classify(old, neu), { action: 'write', reason: 'update' });
});

test('classify : jamais modifié mais confirmOverwrite=always → on demande quand même', () => {
  const old = gen(mod('input clk, output q')), neu = gen(mod('input clk, input d, output q'));
  assert.deepEqual(P.classify(old, neu, { always: true }), { action: 'confirm', modified: false });
});

test('classify : modifié à la main, ports changés → confirmation obligatoire', () => {
  const old = gen(mod('input clk, output q')) + '// ma logique\n';
  const neu = gen(mod('input clk, input d, output q'));
  assert.deepEqual(P.classify(old, neu), { action: 'confirm', modified: true });
});

test('classify : modifié à la main, mêmes ports → on garde ton code, sans rien demander', () => {
  const old = gen(mod('input clk, output q')) + '// ma logique\n';
  const neu = gen(mod('input clk, output reg q'));                // reg/wire ne comptent pas
  assert.equal(P.classify(old, neu).action, 'keep');
});

test('classify : le module top modifié à la main demande confirmation même si les ports sont identiques', () => {
  const old = gen(mod()) + '// ajout\n', neu = gen(mod() + '// autre contenu\n');
  assert.equal(P.classify(old, neu, { isTop: true }).action, 'confirm');
});

test('classify : un fichier sans empreinte (écrit par toi) n\'est jamais écrasé en silence', () => {
  const mine = mod('input a, output b');
  const neu = gen(mod('input clk, output q'));
  assert.equal(P.classify(mine, neu).action, 'confirm');
});

test('backupPath : nom horodaté, jamais le même .bak qui s\'écrase', () => {
  const d = new Date(2026, 9, 12, 8, 5, 3);
  assert.equal(P.backupPath('/p/rtl/reg8.v', d), '/p/rtl/reg8.v.20261012-080503.bak');
  assert.notEqual(P.backupPath('/p/rtl/a.v', new Date(2026, 9, 12, 8, 5, 3)), P.backupPath('/p/rtl/a.v', new Date(2026, 9, 12, 8, 5, 4)));
});

test('portSig : ignore commentaires, reg/wire et espaces', () => {
  const a = 'module m (input clk, // horloge\n output reg [7:0] q);\nendmodule';
  const b = 'module m(input clk,output [7:0] q);endmodule';
  assert.equal(P.portSig(a), P.portSig(b));
  assert.equal(P.portSig('pas de module'), null);
});

/* ---------- Mise à jour de l'en-tête seulement (ton code est conservé) ---------- */

test('syncHeader : les ports/paramètres sont mis à jour, ton corps reste intact', () => {
  const old = '// venturi:abc\nmodule regn (\n    input clk,\n    input rst_n,\n    input [7:0] d,\n    output reg [7:0] q\n);\n\n    // MA LOGIQUE\n    always @(posedge clk) q <= d + 1;\n\nendmodule\n';
  const neu = '// venturi:def\nmodule regn #(\n    parameter WIDTH = 8\n) (\n    input clk,\n    input rst_n,\n    input [WIDTH-1:0] d,\n    output reg [WIDTH-1:0] q\n);\n\n    always @(posedge clk) q <= d;\n\nendmodule\n';
  const r = P.syncHeader(old, neu);
  assert.match(r, /module regn #\(\s*parameter WIDTH = 8\s*\) \(/);
  assert.match(r, /input \[WIDTH-1:0\] d/);
  assert.match(r, /output reg \[WIDTH-1:0\] q/);
  assert.match(r, /\/\/ MA LOGIQUE\n    always @\(posedge clk\) q <= d \+ 1;/);
  assert.doesNotMatch(r, /q <= d;/);
  assert.equal(P.portSig(r), P.portSig(neu), 'l\'en-tête correspond maintenant au schéma');
  assert.equal(P.classify(r, neu).action, 'keep', 'et ton code n\'est plus signalé comme conflit');
});

test('syncHeader : une sortie que tu pilotes avec assign ne devient pas reg', () => {
  const old = 'module m (\n    input [7:0] a,\n    output [7:0] y\n);\n    assign y = ~a;\nendmodule\n';
  const neu = 'module m #(\n    parameter WIDTH = 8\n) (\n    input [WIDTH-1:0] a,\n    output reg [WIDTH-1:0] y\n);\nendmodule\n';
  const r = P.syncHeader(old, neu);
  assert.match(r, /output \[WIDTH-1:0\] y/);
  assert.doesNotMatch(r, /output reg/);
  assert.match(r, /assign y = ~a;/);
});

test('syncHeader : nouveau port ajouté, port supprimé', () => {
  const old = 'module m (\n    input a,\n    input old_port,\n    output y\n);\nendmodule\n';
  const neu = 'module m (\n    input a,\n    input b,\n    output y\n);\nendmodule\n';
  const r = P.syncHeader(old, neu);
  assert.match(r, /input b/);
  assert.doesNotMatch(r, /old_port/);
});

test('syncHeader : sans module dans l\'ancien texte → null', () => {
  assert.equal(P.syncHeader('rien ici', 'module m (input a);\nendmodule'), null);
});

test('portSig : ajouter un paramètre change l\'empreinte, changer sa valeur par défaut non', () => {
  const a = 'module m #(parameter WIDTH = 8) (input [WIDTH-1:0] d);\nendmodule';
  const b = 'module m #(parameter WIDTH = 16) (input [WIDTH-1:0] d);\nendmodule';
  const c = 'module m (input [7:0] d);\nendmodule';
  assert.equal(P.portSig(a), P.portSig(b));
  assert.notEqual(P.portSig(a), P.portSig(c));
});

/* ---------- État d'un fichier (panneau « État du Verilog ») ---------- */

test('fileState : les cinq états d\'un module', () => {
  const a = gen(mod('input clk, output q')), b = gen(mod('input clk, input d, output q'));
  assert.equal(P.fileState(null, a), 'absent');
  assert.equal(P.fileState(a, a), 'ok');
  assert.equal(P.fileState(a, b), 'stale');
  assert.equal(P.fileState(a + '// à moi\n', gen(mod('input clk, output reg q'))), 'edited');
  assert.equal(P.fileState(a + '// à moi\n', b), 'edited-stale');
  assert.equal(P.fileState(a + '// à moi\n', gen(mod('input clk, output reg q')), true), 'edited-stale', 'le top modifié est toujours à reprendre');
});

test('isVenturiFile : reconnaît un fichier généré, même modifié', () => {
  assert.equal(P.isVenturiFile(gen(mod())), true);
  assert.equal(P.isVenturiFile(gen(mod()) + '// ajout'), true);
  assert.equal(P.isVenturiFile(mod()), false);
  assert.equal(P.isVenturiFile(null), false);
});
