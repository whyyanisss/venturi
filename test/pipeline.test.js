'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const PL = require('../media/pipeline');
const { generate, validate, testbench } = require('../src/gen');
const { chain, reg, adder, input, output } = require('./helpers');

const errors = m => validate(m).filter(i => i.level === 'error').map(i => i.msg);
const has = cmd => !cp.spawnSync(cmd, ['-V'], { stdio: 'ignore' }).error;
const skip = has('iverilog') && has('vvp') ? false : 'iverilog/vvp introuvables';

/** Applique la même séquence que insertReg() dans l'éditeur, sans géométrie. */
function insert(model, k) {
  const l = model.links[k];
  const w = model.blocks.find(b => b.inst === l.from.split('.')[0]).ports.find(p => p.name === l.from.split('.')[1]).width;
  const r = PL.makeRegister(model.blocks, w);
  return { ...model, blocks: [...model.blocks, r], links: PL.spliceLink(model.links, k, r), reg: r };
}

test('makeRegister : ports standard, compact, module regn (la largeur est un paramètre)', () => {
  const r = PL.makeRegister([], 16);
  assert.equal(r.kind, 'register');
  assert.equal(r.compact, true);
  assert.equal(r.mod, 'regn');
  assert.deepEqual(r.ports.map(p => p.name), ['clk', 'rst', 'd', 'q']);
  assert.equal(r.ports[2].width, 16);
  assert.equal(r.ports[3].width, 16);
});

test('freeInst / makeRegister évitent les noms déjà pris', () => {
  const blocks = [reg('r1'), reg('r2'), reg('r4')];
  assert.equal(PL.freeInst(blocks, 'r'), 'r3');
  assert.equal(PL.makeRegister(blocks, 8).inst, 'r3');
});

test('regModule : réutilise reg8 si les ports sont identiques', () => {
  assert.equal(PL.regModule([reg('r1')], 8), 'reg8');
});

test('regModule : suffixe si regn existe avec d\'autres ports', () => {
  const odd = reg('r1', 0, 'regn');
  odd.ports[2].name = 'din';
  assert.equal(PL.regModule([odd]), 'regn_2');
});

test('regModule : réutilise le module d\'un registre existant quelle que soit sa largeur', () => {
  assert.equal(PL.regModule([reg('r1', 0, 'reg16', 16)]), 'reg16');
});

test('spliceLink : A→B devient A→reg.d et reg.q→B, sans modifier l\'original', () => {
  const links = [{ from: 'a.q', to: 'b.d' }, { from: 'x.q', to: 'y.d' }];
  const r = { inst: 'r9' };
  const out = PL.spliceLink(links, 0, r);
  assert.deepEqual(out, [{ from: 'a.q', to: 'r9.d' }, { from: 'x.q', to: 'y.d' }, { from: 'r9.q', to: 'b.d' }]);
  assert.deepEqual(links[0], { from: 'a.q', to: 'b.d' });
  assert.deepEqual(PL.spliceLink(links, 7, r), links);
});

test('makeRoom : décale seulement les blocs à droite de la coupe', () => {
  const blocks = [{ x: 0 }, { x: 100 }, { x: 200 }];
  PL.makeRoom(blocks, 100, 40);
  assert.deepEqual(blocks.map(b => b.x), [0, 140, 240]);
});

test('insertion sur chain : le schéma reste valide, sans erreur ni avertissement', () => {
  const m = insert(chain(), 1);               // r1.q → r2.d
  assert.deepEqual(errors(m), []);
  assert.deepEqual(validate(m).filter(i => i.level === 'warning'), []);
  assert.equal(m.links.length, 4);
  assert.ok(m.links.some(l => l.from === 'r1.q' && l.to === 'r3.d'));
  assert.ok(m.links.some(l => l.from === 'r3.q' && l.to === 'r2.d'));
});

test('insertion : pipeline 16 bits → reg16.v généré, un seul reg16', () => {
  const m0 = {
    version: 1, topName: 'p16', rstLow: true,
    blocks: [input('a', 16), reg('r1', 0, 'reg16', 16), output('z', 16)],
    links: [{ from: 'a.p', to: 'r1.d' }, { from: 'r1.q', to: 'z.p' }]
  };
  const m1 = insert(m0, 1);
  const m2 = insert(m1, 0);
  assert.equal(m2.blocks.filter(b => b.kind === 'register').length, 3);
  assert.deepEqual(errors(m2), []);
  const g = generate(m2);
  assert.deepEqual(Object.keys(g.files).sort(), ['p16.v', 'reg16.v']);
  assert.equal((g.files['p16.v'].match(/reg16 u_/g) || []).length, 3);
});

test('insertions répétées : trois étages, noms uniques, schéma valide', () => {
  let m = chain();
  for (let i = 0; i < 3; i++) m = insert(m, m.links.length - 1);
  const names = m.blocks.map(b => b.inst);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(errors(m), []);
});

test('compact est ignoré par le générateur (même Verilog)', () => {
  const a = chain(), b = chain();
  b.blocks.forEach(x => { if (x.kind === 'register') x.compact = true; });
  assert.deepEqual(generate(a).files, generate(b).files);
});

test('pipeline inséré : compile et se simule avec iverilog', { skip }, () => {
  const m = insert(chain(), 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venturi-pl-'));
  fs.mkdirSync(path.join(dir, 'build'));
  const g = generate(m);
  const files = Object.entries(g.files).map(([n, body]) => { const f = path.join(dir, n); fs.writeFileSync(f, body); return f; });
  const tb = path.join(dir, `tb_${g.top}.v`);
  fs.writeFileSync(tb, testbench(m));
  const vvp = path.join(dir, 'pl.vvp');
  const c = cp.spawnSync('iverilog', ['-g2012', '-Wall', '-o', vvp, '-s', `tb_${g.top}`, ...files, tb], { encoding: 'utf8' });
  assert.equal(c.status, 0, c.stderr);
  const r = cp.spawnSync('vvp', [vvp], { cwd: dir, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Simulation terminée/);
});

/* ---------- Ports : nom de module cohérent, noms de ports uniques ---------- */

test('freePort : jamais un doublon, même après des suppressions', () => {
  const b = reg('r1');                                        // clk, rst, d, q
  b.ports.push({ name: 'p4', dir: 'in', width: 1, role: '', side: '' });
  b.ports.splice(0, 1);                                       // 4 ports restants dont « p4 »
  assert.equal(b.ports.length, 4);
  const n = PL.freePort(b);
  assert.ok(!b.ports.some(p => p.name === n), `${n} est déjà pris`);
  assert.equal(PL.freePort({ ports: [] }), 'p0');
});

test('adaptModule : changer seulement une largeur ne renomme rien (paramètre de l\'instance)', () => {
  const m = chain(), r = m.blocks[1];
  r.ports.forEach(p => { if (!p.role) p.width = 16; });
  assert.equal(PL.adaptModule(m.blocks, r), 'reg8');
  assert.deepEqual(validate(m).filter(i => i.level === 'error'), []);
});

test('adaptModule : ports modifiés alors que le module est partagé → module dédié (_2), pas d\'erreur', () => {
  const m = chain(), r = m.blocks[1];
  r.ports.push({ name: 'p4', dir: 'in', width: 1, role: '', side: '' });
  assert.equal(PL.adaptModule(m.blocks, r), 'reg8_2');
  r.mod = PL.adaptModule(m.blocks, r);
  assert.deepEqual(validate(m).filter(i => i.level === 'error' && /ports différents/.test(i.msg)), []);
});

test('adaptModule : un nom choisi à la main n\'est pas renommé s\'il n\'y a pas de conflit', () => {
  const m = chain(), r = m.blocks[1]; r.mod = 'mon_registre';
  r.ports.forEach(p => { if (!p.role) p.width = 16; });
  assert.equal(PL.adaptModule(m.blocks, r), 'mon_registre');
});

test('adaptModule : additionneur inchangé, mux : le nombre d\'entrées compte, pas la largeur', () => {
  const a = adder('a1'); a.ports.forEach(p => { p.width = 12; });
  assert.equal(PL.adaptModule([a], a), 'add8');
  const mkMux = (n, w) => ({ inst: 'm1', mod: 'mux2', kind: 'mux', x: 0, y: 0, color: '', ports: [
    ...Array.from({ length: n }, (_, i) => ({ name: 'i' + i, dir: 'in', width: w, role: '', side: '' })),
    { name: 'sel', dir: 'in', width: 2, role: '', side: 'bottom' }, { name: 'y', dir: 'out', width: w, role: '', side: '' }] });
  assert.equal(PL.adaptModule([], mkMux(4, 8)), 'mux4');
  assert.equal(PL.adaptModule([], mkMux(4, 16)), 'mux4');
  assert.equal(PL.adaptModule([], mkMux(2, 8)), 'mux2');
});

test('adaptModule : le suffixe d\'un fork de mux ne s\'accumule pas (mux4_2 → mux4 si plus de conflit)', () => {
  const b = { inst: 'm1', mod: 'mux4_2', kind: 'mux', ports: [
    ...[0, 1, 2, 3].map(i => ({ name: 'i' + i, dir: 'in', width: 8, role: '', side: '' })),
    { name: 'sel', dir: 'in', width: 2, role: '', side: 'bottom' }, { name: 'y', dir: 'out', width: 8, role: '', side: '' }] };
  assert.equal(PL.adaptModule([b], b), 'mux4');
});
