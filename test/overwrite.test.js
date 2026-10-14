'use strict';
// Parcours complet de la génération avec un faux « vscode » : on vérifie qu'un fichier modifié à la main
// n'est jamais écrasé sans confirmation modale, et que ta version est toujours sauvegardée.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const calls = { warn: [], cmds: [], status: [] };
let answer;
const channel = { appendLine() {}, append() {}, show() {}, dispose() {} };
const api = {
  Uri: { file: f => ({ fsPath: f, toString: () => 'file://' + f }) },
  window: {
    createOutputChannel: () => channel,
    showWarningMessage: (msg, ...rest) => { calls.warn.push({ msg, rest }); return Promise.resolve(answer); },
    showErrorMessage: () => Promise.resolve(),
    setStatusBarMessage: m => calls.status.push(m),
    showTextDocument: () => Promise.resolve(),
    tabGroups: { activeTabGroup: {} }
  },
  ViewColumn: { Beside: -2 },
  workspace: { getConfiguration: () => ({ get: (_k, d) => d }), asRelativePath: x => String(x.fsPath || x), openTextDocument: () => Promise.resolve({}) },
  commands: { executeCommand: (...a) => { calls.cmds.push(a); return Promise.resolve(); } },
  TabInputCustom: class {}
};
const load = Module._load;
Module._load = function (req, ...r) { return req === 'vscode' ? api : load.call(this, req, ...r); };
const P = require('../src/project');
Module._load = load;

const text = fs.readFileSync(path.join(__dirname, '..', 'examples', 'chain.venturi.json'), 'utf8');
const mkProject = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'venturi-ow-'));
  return { root, p: { uri: api.Uri.file(path.join(root, 'schema', 'chain.venturi.json')), root, text }, top: path.join(root, 'rtl', 'chain.v') };
};
const reset = a => { answer = a; calls.warn.length = 0; calls.cmds.length = 0; calls.status.length = 0; };
const baks = (dir, base) => fs.readdirSync(dir).filter(n => n.startsWith(base + '.') && n.endsWith('.bak'));

test('première génération : écrit sans rien demander', async () => {
  reset(undefined);
  const { p, top } = mkProject();
  const g = await P.generateFor(p);
  assert.ok(fs.existsSync(top));
  assert.ok(g.written.includes('chain.v'));
  assert.equal(calls.warn.length, 0);
});

test('régénérer un fichier non modifié : silencieux', async () => {
  reset(undefined);
  const { p } = mkProject();
  await P.generateFor(p);
  const g = await P.generateFor(p);
  assert.deepEqual(g.written, []);
  assert.equal(calls.warn.length, 0);
});

test('fichier modifié à la main + « Garder mon code » : rien n\'est touché, et on ne redemande pas', async () => {
  reset('Garder mon code');
  const { p, top } = mkProject();
  await P.generateFor(p);
  fs.appendFileSync(top, '// ma logique\n');
  const before = fs.readFileSync(top, 'utf8');
  await P.generateFor(p);
  assert.equal(calls.warn.length, 1);
  assert.equal(calls.warn[0].rest[0].modal, true, 'fenêtre modale');
  assert.match(calls.warn[0].rest[0].detail, /chain\.v — modifié à la main/);
  assert.equal(fs.readFileSync(top, 'utf8'), before);
  assert.deepEqual(baks(path.dirname(top), 'chain.v'), []);
  await P.generateFor(p);
  assert.equal(calls.warn.length, 1, 'pas de nouvelle question pour le même contenu');
});

test('fenêtre fermée (Échap) : traité comme « garder », rien n\'est écrasé', async () => {
  reset(undefined);
  const { p, top } = mkProject();
  await P.generateFor(p);
  fs.appendFileSync(top, '// ma logique\n');
  await P.generateFor(p);
  assert.match(fs.readFileSync(top, 'utf8'), /ma logique/);
});

test('« Écraser (avec sauvegarde) » : fichier régénéré, ta version est dans un .bak horodaté', async () => {
  reset('Écraser (avec sauvegarde)');
  const { p, top } = mkProject();
  await P.generateFor(p);
  fs.appendFileSync(top, '// ma logique\n');
  const g = await P.generateFor(p);
  assert.ok(g.written.includes('chain.v'));
  assert.doesNotMatch(fs.readFileSync(top, 'utf8'), /ma logique/);
  const b = baks(path.dirname(top), 'chain.v');
  assert.equal(b.length, 1);
  assert.match(b[0], /^chain\.v\.\d{8}-\d{6}\.bak$/);
  assert.match(fs.readFileSync(path.join(path.dirname(top), b[0]), 'utf8'), /ma logique/);
});

test('deux écrasements successifs : les deux sauvegardes sont conservées', async () => {
  reset('Écraser (avec sauvegarde)');
  const { p, top } = mkProject();
  await P.generateFor(p);
  fs.appendFileSync(top, '// version A\n'); await P.generateFor(p);
  fs.appendFileSync(top, '// version B\n'); await P.generateFor(p);
  const b = baks(path.dirname(top), 'chain.v');
  assert.equal(b.length, 2);
  const all = b.map(n => fs.readFileSync(path.join(path.dirname(top), n), 'utf8')).join('\n');
  assert.match(all, /version A/); assert.match(all, /version B/);
});

test('« Comparer » : ouvre un diff et ne modifie rien', async () => {
  reset('Comparer');
  const { p, top } = mkProject();
  await P.generateFor(p);
  fs.appendFileSync(top, '// ma logique\n');
  const before = fs.readFileSync(top, 'utf8');
  await P.generateFor(p);
  assert.equal(fs.readFileSync(top, 'utf8'), before);
  assert.ok(calls.cmds.some(c => c[0] === 'vscode.diff'));
  assert.deepEqual(baks(path.dirname(top), 'chain.v'), []);
});

test('module écrit à la main dont les ports n\'ont pas changé : conservé sans question', async () => {
  reset(undefined);
  const { p, root } = mkProject();
  await P.generateFor(p);
  const f = path.join(root, 'rtl', 'reg8.v');
  fs.appendFileSync(f, '// ma logique de registre\n');
  const g = await P.generateFor(p);
  assert.equal(calls.warn.length, 0);
  assert.ok(!g.written.includes('reg8.v'));
  assert.match(fs.readFileSync(f, 'utf8'), /ma logique de registre/);
});

test('un fichier que tu as écrit sans empreinte n\'est jamais écrasé en silence', async () => {
  reset('Garder mon code');
  const { p, root } = mkProject();
  fs.mkdirSync(path.join(root, 'rtl'), { recursive: true });
  const mine = path.join(root, 'rtl', 'chain.v');
  fs.writeFileSync(mine, 'module chain (input x);\nendmodule\n');
  await P.generateFor(p);
  assert.equal(calls.warn.length, 1);
  assert.equal(fs.readFileSync(mine, 'utf8'), 'module chain (input x);\nendmodule\n');
});

test('Créer tb : ne remplace jamais un testbench existant', async () => {
  reset(undefined);
  const { p, root } = mkProject();
  const tbf = path.join(root, 'tb', 'tb_chain.v');
  await P.createTestbench(p);
  assert.ok(fs.existsSync(tbf));
  fs.appendFileSync(tbf, '// mes stimuli\n');
  await P.createTestbench(p);
  assert.match(fs.readFileSync(tbf, 'utf8'), /mes stimuli/);
});

/** Les fenêtres modales de confirmation (les avertissements de schéma, eux, ne sont pas modaux). */
const modals = () => calls.warn.filter(w => w.rest[0] && w.rest[0].modal);

/* ---------- Taille d'une instance modifiée alors que le module a été retouché à la main ---------- */

const wide = () => { const m = JSON.parse(text); m.blocks[2].ports.forEach(q => { if (!q.role) q.width = 16; }); return JSON.stringify(m); };

test('module retouché à la main + taille changée : « Ports seulement » adapte l\'en-tête et garde ta logique', async () => {
  reset('Ports seulement (garder mon code)');
  const { p, root } = mkProject();
  await P.generateFor(p);
  const f = path.join(root, 'rtl', 'reg8.v');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('else q <= d;', 'else q <= d + 1;   // MA LOGIQUE'));
  const g = await P.generateFor({ ...p, text: wide() });
  const v = fs.readFileSync(f, 'utf8');
  assert.match(v, /parameter WIDTH = 8/);
  assert.match(v, /input \[WIDTH-1:0\] d/);
  assert.match(v, /MA LOGIQUE/);
  assert.ok(g.written.includes('reg8.v'));
  assert.equal(baks(path.dirname(f), 'reg8.v').length, 1);
  assert.match(fs.readFileSync(path.join(root, 'rtl', 'chain.v'), 'utf8'), /reg8 #\(\.WIDTH\(16\)\) u_r2/);
  // et à la génération suivante : ton code n'est plus signalé comme conflit
  reset(undefined);
  await P.generateFor({ ...p, text: wide() });
  assert.equal(modals().length, 0);
});

test('module retouché à la main et conservé : « Générer » le dit au lieu d\'afficher « à jour »', async () => {
  reset('Garder mon code');
  const { p, root } = mkProject();
  await P.generateFor(p);
  fs.appendFileSync(path.join(root, 'rtl', 'reg8.v'), '// ma logique\n');
  const g = await P.generateFor({ ...p, text: wide() }, { notify: true });
  assert.ok(g.kept.includes('reg8.v'));
  const last = calls.status[calls.status.length - 1];
  assert.match(last, /conservé tel quel/);
  assert.match(last, /reg8\.v/);
  assert.doesNotMatch(last, /déjà à jour/);
});

test('« Garder » mémorisé : la génération automatique reste muette mais signale le fichier ; « Générer » repose la question', async () => {
  reset('Garder mon code');
  const { p, root } = mkProject();
  await P.generateFor(p);
  fs.appendFileSync(path.join(root, 'rtl', 'reg8.v'), '// ma logique\n');
  await P.generateFor({ ...p, text: wide() });                      // on répond « garder »
  assert.equal(modals().length, 1);
  reset('Garder mon code');
  const g = await P.generateFor({ ...p, text: wide() });            // génération automatique : pas de nouvelle fenêtre
  assert.equal(modals().length, 0);
  assert.ok(g.kept.includes('reg8.v'));
  assert.match(calls.status[calls.status.length - 1], /conservé tel quel/);
  await P.generateFor({ ...p, text: wide() }, { notify: true });    // clic sur « Générer » : on repose la question
  assert.equal(modals().length, 1);
});

test('Ports seulement : jamais appliqué au module top', async () => {
  reset('Ports seulement (garder mon code)');
  const { p, top } = mkProject();
  await P.generateFor(p);
  fs.appendFileSync(top, '// ma modif du top\n');
  const g = await P.generateFor({ ...p, text: wide() });
  assert.ok(g.kept.includes('chain.v'));
  assert.match(fs.readFileSync(top, 'utf8'), /ma modif du top/);
});

test('deux registres de tailles différentes, rien de modifié à la main : un seul reg8.v qui s\'adapte', async () => {
  reset(undefined);
  const { p, root } = mkProject();
  await P.generateFor(p);
  const before = fs.readFileSync(path.join(root, 'rtl', 'reg8.v'), 'utf8');
  const g = await P.generateFor({ ...p, text: wide() });
  const after = fs.readFileSync(path.join(root, 'rtl', 'reg8.v'), 'utf8');
  assert.notEqual(after, before);
  assert.match(after, /parameter WIDTH = 8/);
  assert.ok(g.written.includes('reg8.v'));
  assert.deepEqual(fs.readdirSync(path.join(root, 'rtl')).sort(), ['chain.v', 'reg8.v']);
  assert.equal(modals().length, 0);
});

/* ---------- Panneau « État du Verilog », génération partielle et automatique ---------- */

const stateOf = async (p, name) => { const s = await P.verilogStatus(p); return (s.rows.find(r => r.name === name) || {}).state; };

test('état du Verilog : absent → ok → en retard → modifié à la main', async () => {
  reset(undefined);
  const { p, root } = mkProject();
  assert.equal(await stateOf(p, 'reg8.v'), 'absent');
  await P.generateFor(p);
  assert.equal(await stateOf(p, 'reg8.v'), 'ok');
  assert.equal(await stateOf({ ...p, text: wide() }, 'reg8.v'), 'stale');          // le schéma a changé, le fichier non
  fs.appendFileSync(path.join(root, 'rtl', 'reg8.v'), '// à moi\n');
  assert.equal(await stateOf(p, 'reg8.v'), 'edited');
  assert.equal(await stateOf({ ...p, text: wide() }, 'reg8.v'), 'edited-stale');
  const s = await P.verilogStatus(p);
  assert.equal(s.rows[0].isTop, true, 'le top est en premier');
});

test('état du Verilog : un fichier généré autrefois qui n\'est plus dans le schéma est signalé orphelin', async () => {
  reset(undefined);
  const { p, root } = mkProject();
  await P.generateFor(p);
  const stamped = fs.readFileSync(path.join(root, 'rtl', 'reg8.v'), 'utf8');
  fs.writeFileSync(path.join(root, 'rtl', 'reg16.v'), stamped.replace(/reg8/g, 'reg16'));     // ancien module généré
  fs.writeFileSync(path.join(root, 'rtl', 'a_moi.v'), 'module a_moi (input x);\nendmodule\n');  // fichier à toi : jamais signalé
  const s = await P.verilogStatus(p);
  assert.deepEqual(s.rows.filter(r => r.state === 'orphan').map(r => r.name), ['reg16.v']);
});

test('archiver un orphelin : renommé en .bak horodaté, jamais supprimé, avec confirmation', async () => {
  reset('Archiver en .bak');
  const { p, root } = mkProject();
  await P.generateFor(p);
  const f = path.join(root, 'rtl', 'reg16.v');
  fs.writeFileSync(f, fs.readFileSync(path.join(root, 'rtl', 'reg8.v'), 'utf8').replace(/reg8/g, 'reg16'));
  assert.equal(await P.archiveFile(p, 'reg16.v'), true);
  assert.equal(fs.existsSync(f), false);
  assert.equal(baks(path.join(root, 'rtl'), 'reg16.v').length, 1);
  assert.equal(modals().length, 1);
});

test('archiver : sans confirmation, rien ne bouge', async () => {
  reset(undefined);
  const { p, root } = mkProject();
  await P.generateFor(p);
  const f = path.join(root, 'rtl', 'reg16.v');
  fs.writeFileSync(f, fs.readFileSync(path.join(root, 'rtl', 'reg8.v'), 'utf8').replace(/reg8/g, 'reg16'));
  assert.equal(await P.archiveFile(p, 'reg16.v'), false);
  assert.ok(fs.existsSync(f));
});

test('« Mettre à jour » un seul fichier : les autres ne sont pas touchés', async () => {
  reset(undefined);
  const { p, root } = mkProject();
  await P.generateFor(p);
  const top = path.join(root, 'rtl', 'chain.v'), before = fs.readFileSync(top, 'utf8');
  await P.generateFor({ ...p, text: wide() }, { notify: true, only: ['reg8.v'] });
  assert.match(fs.readFileSync(path.join(root, 'rtl', 'reg8.v'), 'utf8'), /parameter WIDTH/);
  assert.equal(fs.readFileSync(top, 'utf8'), before);
  assert.equal(await stateOf({ ...p, text: wide() }, 'chain.v'), 'stale');
});

test('génération automatique : jamais de fenêtre, le fichier modifié est conservé et signalé', async () => {
  reset('Écraser (avec sauvegarde)');
  const { p, root } = mkProject();
  await P.generateFor(p);
  fs.appendFileSync(path.join(root, 'rtl', 'reg8.v'), '// ma logique\n');
  const g = await P.generateFor({ ...p, text: wide() }, { auto: true });
  assert.equal(modals().length, 0);
  assert.ok(g.kept.includes('reg8.v'));
  assert.match(fs.readFileSync(path.join(root, 'rtl', 'reg8.v'), 'utf8'), /ma logique/);
  assert.match(calls.status[calls.status.length - 1], /conservé tel quel/);
});

test('genMode : generateOn prime, sinon l\'ancien generateOnSave', () => {
  const cfgOf = (on, onSave) => ({ get: (k, d) => (k === 'generateOnSave' ? (onSave === undefined ? d : onSave) : d), inspect: () => ({ globalValue: on }) });
  assert.equal(P.genMode(cfgOf('change')), 'change');
  assert.equal(P.genMode(cfgOf('manual', true)), 'manual');
  assert.equal(P.genMode(cfgOf(undefined, false)), 'manual');
  assert.equal(P.genMode(cfgOf(undefined)), 'save');
});
