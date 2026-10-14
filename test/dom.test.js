'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
try { require.resolve('jsdom'); } catch {
  test('éditeur dans jsdom', { skip: 'jsdom n\'est pas installé : lance « npm install » pour exécuter les tests du DOM' }, () => {});
  return;
}
const { boot, P } = require('./dom');

const chain = () => ({
  version: 1, topName: 'chain', rstLow: true,
  blocks: [
    { inst: 'din', mod: '', kind: 'in', x: 20, y: 140, color: '', ports: [P('p', 'out')] },
    { inst: 'r1', mod: 'regn', kind: 'register', x: 160, y: 120, color: '', compact: true, ports: [P('clk', 'in', 1, 'clk'), P('rst', 'in', 1, 'rst'), P('d', 'in'), P('q', 'out')] },
    { inst: 'r2', mod: 'regn', kind: 'register', x: 300, y: 120, color: '', compact: true, ports: [P('clk', 'in', 1, 'clk'), P('rst', 'in', 1, 'rst'), P('d', 'in'), P('q', 'out')] },
    { inst: 'dout', mod: '', kind: 'out', x: 440, y: 140, color: '', ports: [P('p', 'in')] }
  ],
  links: [{ from: 'din.p', to: 'r1.d' }, { from: 'r1.q', to: 'r2.d' }, { from: 'r2.q', to: 'dout.p' }]
});

test('démarrage : aucune erreur, barre d\'outils et menus présents', () => {
  const t = boot(); t.load(chain());
  assert.deepEqual(t.errors, []);
  for (const a of ['cut', 'straighten', 'cmd:simulate', 'zoom:fit']) assert.ok(t.$(`button[data-a="${a}"]`), a);
  for (const m of ['add', 'set', 'files']) { assert.ok(t.$(`[data-menu="${m}"]`)); assert.ok(t.$(`#m-${m}`).hidden); }
  assert.match(t.$('.ver').textContent, /vtest/);
  assert.match(t.$('#lat').textContent, /Latence : 2 cycles/);
});

test('menus : ouverture, fermeture par Échap, choix d\'une action ferme le menu', async () => {
  const t = boot(); t.load(chain());
  t.menu('add');
  assert.equal(t.$('#m-add').hidden, false);
  t.key('Escape');
  assert.equal(t.$('#m-add').hidden, true);
  t.menu('add'); t.btn('add:register');
  assert.equal(t.$('#m-add').hidden, true);
  await t.tick();
  assert.equal(t.model().blocks.length, 5);
  assert.deepEqual(t.errors, []);
});

test('grille : tous les ports du schéma par défaut sont sur la grille de 20 px', () => {
  const t = boot(); t.load(chain());
  const ports = t.ports();
  assert.ok(Object.keys(ports).length >= 6);
  for (const [k, [x, y]] of Object.entries(ports)) assert.ok(x % 20 === 0 && y % 20 === 0, `${k} = ${x},${y}`);
});

test('grille : din → r1.d → r1.q → r2.d → dout sont des fils droits (même hauteur)', () => {
  const t = boot(); t.load(chain());
  const ps = t.ports();
  const y = k => ps[k][1];
  // indices : 0 din, 1 r1, 2 r2, 3 dout ; ports des registres : 0 clk, 1 rst, 2 d, 3 q
  assert.equal(y('0:0'), y('1:2'));
  assert.equal(y('1:3'), y('2:2'));
  assert.equal(y('2:3'), y('3:0'));
});

test('blocs compacts : 60×80 quel que soit le nom, nom long abrégé', () => {
  const t = boot(), m = chain(); m.blocks[1].inst = 'pipeline_register_long_name'; m.links[0].to = 'pipeline_register_long_name.d'; m.links[1].from = 'pipeline_register_long_name.q';
  t.load(m);
  for (const i of [1, 2]) {
    const r = t.$$(`rect.bx[data-b="${i}"]`)[0];
    assert.equal(r.getAttribute('width'), '60'); assert.equal(r.getAttribute('height'), '80');
  }
  assert.match(t.$('svg').innerHTML, /<title>pipeline_register_long_name<\/title>/);
  assert.match(t.$('svg').innerHTML, /pipe…/);
});

test('« Redresser » aligne un pipeline décalé, « Aligner sur la grille » cale les blocs', async () => {
  const t = boot(), m = chain();
  m.blocks[1].y = 203; m.blocks[2].y = 91; m.blocks[3].x = 447;
  t.load(m);
  assert.match(t.$('#hint').textContent, /pas sur la grille/);
  t.menu('set'); t.btn('snapgrid'); await t.tick();
  let mm = t.model();
  assert.ok(mm.blocks.every(b => b.x % 20 === 0 && b.y % 20 === 0));
  t.btn('straighten'); await t.tick();
  const ps = t.ports();
  assert.equal(ps['0:0'][1], ps['1:2'][1]); assert.equal(ps['1:3'][1], ps['2:2'][1]); assert.equal(ps['2:3'][1], ps['3:0'][1]);
  assert.deepEqual(t.errors, []);
});

test('flèches : déplacent la sélection d\'un pas de grille', async () => {
  const t = boot(); t.load(chain());
  t.down(t.block(1)); t.up();
  t.key('ArrowRight'); t.key('ArrowDown'); await t.tick();
  const b = t.model().blocks[1];
  assert.deepEqual([b.x, b.y], [180, 140]);
  t.key('ArrowLeft', { altKey: true }); await t.tick();
  assert.equal(t.model().blocks[1].x, 179);
});

test('guides : pendant le glissement, un port aligné est signalé', () => {
  const t = boot(), m = chain(); m.blocks[2].y = 280;
  t.load(m);
  t.down(t.block(2), { clientX: 310, clientY: 300 });
  t.move(310, 140);                                     // r2 revient à la hauteur de r1
  assert.ok(t.$$('.guide').length >= 1, 'une ligne de guide est dessinée');
  t.up();
  assert.equal(t.$$('.guide').length, 0, 'et disparaît au relâchement');
});

test('état du Verilog : ouverture, rendu des lignes, boutons → commandes', async () => {
  const t = boot(); t.load(chain());
  t.menu('files'); t.btn('status');
  assert.equal(t.$('#vstat').hidden, false);
  await t.tick(250);
  assert.ok(t.posted.some(m => m.type === 'status'), 'l\'éditeur demande l\'état à l\'extension');
  t.w.dispatchEvent(new t.w.MessageEvent('message', { data: { type: 'status', dir: '/p/rtl', rows: [
    { name: 'chain.v', isTop: true, state: 'ok' }, { name: 'reg8.v', isTop: false, state: 'edited-stale' }, { name: 'reg16.v', isTop: false, state: 'orphan' }] } }));
  const html = t.$('#vstat').innerHTML;
  assert.match(html, /2 à regarder/);
  assert.match(html, /modifié à la main — en-tête à adapter/);
  assert.match(html, /orphelin/);
  t.click(t.$('#vstat button[data-v="update"][data-f="reg8.v"]'));
  t.click(t.$('#vstat button[data-v="archive"][data-f="reg16.v"]'));
  const cmds = t.posted.filter(m => m.type === 'cmd').map(m => `${m.cmd}:${m.file}`);
  assert.deepEqual(cmds, ['update:reg8.v', 'archive:reg16.v']);
  t.click(t.$('#vstat button[data-v="close"]'));
  assert.equal(t.$('#vstat').hidden, true);
  assert.deepEqual(t.errors, []);
});

test('état du Verilog : tout à jour', () => {
  const t = boot(); t.load(chain());
  t.menu('files'); t.btn('status');
  t.w.dispatchEvent(new t.w.MessageEvent('message', { data: { type: 'status', dir: '', rows: [{ name: 'chain.v', isTop: true, state: 'ok' }] } }));
  assert.match(t.$('#vstat').innerHTML, /tout est à jour/);
});

/* ---------- Nouveaux blocs dans l'éditeur ---------- */

const { generate, validate } = require('../src/gen');
const K = require('../media/kinds');
const gerrors = m => validate(m).filter(i => i.level === 'error').map(i => i.msg);
const selectBlock = (t, i) => { t.down(t.block(i)); t.up(); };
const blank = () => ({ version: 1, topName: 'top', rstLow: true, blocks: [], links: [] });

test('ajouter : chaque bloc prêt à l\'emploi apparaît compact (sauf RAM), nommé et valide', async () => {
  const t = boot(); t.load(blank());
  for (const k of K.KINDS) { t.menu('add'); t.btn(`add:${k}`); }
  await t.tick();
  const m = t.model();
  assert.deepEqual(m.blocks.map(b => b.kind), K.KINDS);
  assert.deepEqual(m.blocks.map(b => b.inst), ['k1', 'g1', 'c1', 'ct1', 'sh1', 'sl1', 'cc1', 'ram1']);
  m.blocks.forEach(b => assert.equal(!!b.compact, b.kind !== 'ram', b.kind));
  assert.deepEqual(t.errors, []);
  for (const [k, [x, y]] of Object.entries(t.ports())) assert.ok(x % 20 === 0 && y % 20 === 0, `${k} = ${x},${y}`);
  assert.match(t.$('svg').innerHTML, /&amp;|>&<|>\+1</, 'les symboles sont dessinés');
});

test('porte logique : opération → module et symbole ; NON masque le nombre d\'entrées ; entrées → ports', async () => {
  const t = boot(); t.load(blank());
  t.menu('add'); t.btn('add:logic'); await t.tick();
  selectBlock(t, 0);
  assert.ok(t.$('#props [data-a="kf:n"]'));
  t.change('#props [data-a="kf:op"]', 'nor'); await t.tick();
  let b = t.model().blocks[0];
  assert.equal(b.op, 'nor'); assert.equal(b.mod, 'nor2');
  t.input('#props [data-a="kf:n"]', 3); await t.tick();
  b = t.model().blocks[0];
  assert.deepEqual(b.ports.map(p => p.name), ['a', 'b', 'c', 'y']); assert.equal(b.mod, 'nor3');
  t.change('#props [data-a="kf:op"]', 'not'); await t.tick();
  b = t.model().blocks[0];
  assert.deepEqual(b.ports.map(p => p.name), ['a', 'y']); assert.equal(b.mod, 'inv');
  assert.equal(t.$('#props [data-a="kf:n"]'), null, 'NON n\'a qu\'une entrée : champ masqué');
  assert.deepEqual(t.errors, []);
});

test('largeur d\'un bloc prêt à l\'emploi : toutes les entrées/sorties suivent, sans changer le module', async () => {
  const t = boot(); t.load(blank());
  t.menu('add'); t.btn('add:cmp'); await t.tick();
  selectBlock(t, 0);
  t.input('#props [data-a="kf:w"]', 16); await t.tick();
  const b = t.model().blocks[0];
  assert.deepEqual(b.ports.map(p => p.width), [16, 16, 1]);
  assert.equal(b.mod, 'cmp_eq');
});

test('extraction de bits : la sortie fait haut−bas+1, l\'entrée est assez large ; bas ≤ haut', async () => {
  const t = boot(); t.load(blank());
  t.menu('add'); t.btn('add:slice'); await t.tick();
  selectBlock(t, 0);
  t.input('#props [data-a="kf:hi"]', 11); await t.tick();
  let b = t.model().blocks[0];
  assert.equal(b.hi, 11); assert.equal(b.ports.find(p => p.name === 'y').width, 12); assert.ok(b.ports.find(p => p.name === 'a').width >= 12);
  t.input('#props [data-a="kf:lo"]', 4); await t.tick();
  b = t.model().blocks[0];
  assert.equal(b.ports.find(p => p.name === 'y').width, 8);
  t.input('#props [data-a="kf:hi"]', 2); await t.tick();
  b = t.model().blocks[0];
  assert.ok(b.lo <= b.hi, `bas (${b.lo}) ne dépasse pas haut (${b.hi})`);
});

test('concaténation : la sortie est la somme des entrées, une largeur par entrée', async () => {
  const t = boot(); t.load(blank());
  t.menu('add'); t.btn('add:concat'); await t.tick();
  selectBlock(t, 0);
  t.input('#props [data-a="kf:n"]', 3); await t.tick();
  assert.ok(t.$('#props [data-a="kf:cw:2"]'));
  t.input('#props [data-a="kf:cw:0"]', 1); await t.tick();
  const b = t.model().blocks[0];
  assert.deepEqual(b.ports.map(p => p.width), [1, 4, 4, 9]);
  assert.equal(b.mod, 'concat3');
});

test('constante, décaleur, RAM : réglages propres', async () => {
  const t = boot(); t.load(blank());
  t.menu('add'); t.btn('add:const'); t.menu('add'); t.btn('add:shift'); t.menu('add'); t.btn('add:ram'); await t.tick();
  selectBlock(t, 0); t.input('#props [data-a="kf:value"]', '0xFF'); t.input('#props [data-a="kf:w"]', 16);
  selectBlock(t, 1); t.input('#props [data-a="kf:amount"]', 3); t.change('#props [data-a="kf:op"]', 'sra');
  selectBlock(t, 2); t.input('#props [data-a="kf:aw"]', 6); t.input('#props [data-a="kf:w"]', 32);
  await t.tick();
  const [k, s, r] = t.model().blocks;
  assert.equal(k.value, '0xFF'); assert.equal(k.ports[0].width, 16);
  assert.equal(s.amount, 3); assert.equal(s.op, 'sra'); assert.equal(s.mod, 'shift_sra');
  assert.equal(r.ports.find(p => p.name === 'addr').width, 6); assert.equal(r.ports.find(p => p.name === 'din').width, 32); assert.equal(r.ports.find(p => p.name === 'dout').width, 32);
  assert.deepEqual(t.errors, []);
});

test('changer le type d\'un bloc en bloc prêt à l\'emploi (et retour) : réglages propres, sans reste', async () => {
  const t = boot(); t.load(chain());
  selectBlock(t, 1);
  t.change('#props [data-a="kind"]', 'logic'); await t.tick();
  let b = t.model().blocks[1];
  assert.equal(b.kind, 'logic'); assert.equal(b.op, 'and'); assert.equal(b.mod, 'and2'); assert.equal(b.depth, undefined);
  t.change('#props [data-a="kind"]', 'register'); await t.tick();
  b = t.model().blocks[1];
  assert.equal(b.kind, 'register'); assert.equal(b.op, undefined); assert.equal(b.compact, true); assert.equal(b.mod, 'regn');
});

test('un schéma construit dans l\'éditeur avec les nouveaux blocs génère du Verilog sans erreur', async () => {
  const t = boot(); t.load(blank());
  for (const k of ['const', 'logic', 'cmp', 'shift']) { t.menu('add'); t.btn(`add:${k}`); }
  await t.tick();
  const m = t.model();
  assert.deepEqual(gerrors(m), []);
  const g = generate(m);
  assert.ok(g.files['constn.v'] && g.files['and2.v'] && g.files['cmp_eq.v'] && g.files['shift_shl.v']);
});

test('modules partagés : deux portes ET de largeurs différentes → un seul and2.v paramétré', async () => {
  const t = boot(); t.load(blank());
  t.menu('add'); t.btn('add:logic'); t.menu('add'); t.btn('add:logic'); await t.tick();
  selectBlock(t, 1); t.input('#props [data-a="kf:w"]', 16); await t.tick();
  const m = t.model();
  assert.equal(m.blocks[0].mod, 'and2'); assert.equal(m.blocks[1].mod, 'and2');
  const g = generate(m);
  assert.match(g.files['and2.v'], /parameter WIDTH = 8/);
  assert.match(g.files['top.v'], /and2 #\(\.WIDTH\(16\)\) u_g2/);
});

/* ---------- Côté de sel (mux), ligne de coupe ---------- */

const muxModel = () => ({
  version: 1, topName: 'top', rstLow: true,
  blocks: [
    { inst: 's', mod: '', kind: 'in', x: 20, y: 80, color: '', ports: [P('p', 'out', 1)] },
    { inst: 'a', mod: '', kind: 'in', x: 20, y: 200, color: '', ports: [P('p', 'out')] },
    { inst: 'b', mod: '', kind: 'in', x: 20, y: 280, color: '', ports: [P('p', 'out')] },
    { inst: 'm1', mod: 'mux2', kind: 'mux', x: 300, y: 200, color: '', ports: [P('i0', 'in'), P('i1', 'in'), P('sel', 'in', 1, '', 'bottom'), P('y', 'out')] },
    { inst: 'z', mod: '', kind: 'out', x: 520, y: 240, color: '', ports: [P('p', 'in')] }
  ],
  links: [{ from: 'a.p', to: 'm1.i0' }, { from: 'b.p', to: 'm1.i1' }, { from: 's.p', to: 'm1.sel' }, { from: 'm1.y', to: 'z.p' }]
});

test('sel d\'un mux : en haut si sa source est au-dessus, en bas si elle est en dessous (auto)', async () => {
  const t = boot(); t.load(muxModel());
  selectBlock(t, 3); t.key('ArrowRight'); await t.tick();
  assert.equal(t.model().blocks[3].ports.find(p => p.name === 'sel').side, 'top');
  selectBlock(t, 0); for (let i = 0; i < 10; i++) t.key('ArrowDown'); await t.tick();   // la source passe sous le mux
  assert.equal(t.model().blocks[3].ports.find(p => p.name === 'sel').side, 'bottom');
  assert.deepEqual(t.errors, []);
});

test('sel d\'un mux : un choix manuel est respecté', async () => {
  const t = boot(); t.load(muxModel());
  selectBlock(t, 3);
  t.change('#props [data-a="selSide"]', 'bottom'); await t.tick();
  t.key('ArrowRight'); await t.tick();
  const m = t.model();
  assert.equal(m.blocks[3].selAuto, false);
  assert.equal(m.blocks[3].ports.find(p => p.name === 'sel').side, 'bottom');
  t.change('#props [data-a="selSide"]', 'auto'); await t.tick();
  assert.equal(t.model().blocks[3].selAuto, undefined);
});

test('module du mux : la position de sel ne crée pas deux modules (structure identique)', async () => {
  const t = boot(), m = muxModel();
  m.blocks.push({ ...JSON.parse(JSON.stringify(m.blocks[3])), inst: 'm2', x: 300, y: 400 });
  m.blocks[5].ports.find(p => p.name === 'sel').side = 'top';
  assert.deepEqual(gerrors(m), []);
});

test('ligne de coupe dans l\'éditeur : un clic insère un registre par fil traversé', async () => {
  const t = boot(); t.load(chain());
  t.btn('cut');
  t.move(250, 100);
  assert.match(t.$('svg').innerHTML, /1 fil</);
  t.down(t.$('svg'), { clientX: 250, clientY: 100 }); await t.tick();
  const m = t.model();
  assert.equal(m.blocks.length, 5); assert.equal(m.links.length, 4);
  assert.match(t.$('#lat').textContent, /Latence : 3 cycles/);
  assert.deepEqual(t.errors, []);
});

test('copier-coller d\'un groupe et suppression : liens internes conservés', async () => {
  const t = boot(); t.load(chain());
  t.key('a', { ctrlKey: true }); t.key('c', { ctrlKey: true }); t.key('v', { ctrlKey: true }); await t.tick();
  let m = t.model();
  assert.equal(m.blocks.length, 8); assert.equal(m.links.length, 6);
  assert.equal(new Set(m.blocks.map(b => b.inst)).size, 8);
  t.key('Delete'); await t.tick();
  m = t.model();
  assert.equal(m.blocks.length, 4); assert.equal(m.links.length, 3);
});

test('balayage : chaque bouton de la barre et des menus, sur un schéma vide puis chargé, ne plante pas', async () => {
  const fs = require('fs'), path = require('path');
  const ex = fs.readFileSync(path.join(__dirname, '..', 'examples', 'chain.venturi.json'), 'utf8');
  for (const start of [blank(), JSON.parse(ex), chain(), muxModel()]) {
    const t = boot(); t.load(start);
    const buttons = t.$$('#tools button[data-a]');
    assert.ok(buttons.length > 25, `${buttons.length} boutons`);
    for (const b of buttons) { b.click(); if (t.$('#cutb').classList.contains('p')) t.key('Escape'); }
    t.key('a', { ctrlKey: true }); t.btn('straighten');
    await t.tick(50);
    assert.deepEqual(t.errors, [], t.errors.join('\n'));
  }
});

test('l\'exemple fourni se charge, ses ports sont dessinés et le schéma est valide', () => {
  const fs = require('fs'), path = require('path');
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'chain.venturi.json'), 'utf8'));
  const t = boot(); t.load(m);
  assert.ok(Object.keys(t.ports()).length >= 6);
  assert.deepEqual(gerrors(m), []);
  assert.deepEqual(t.errors, []);
});
