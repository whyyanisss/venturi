'use strict';
// Test d'intégration : le Verilog généré doit compiler et se simuler avec Icarus Verilog.
// Ignoré automatiquement si iverilog n'est pas installé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { generate, testbench } = require('../src/gen');
const { chain, input, output, adder, mux, reg } = require('./helpers');

const has = cmd => !cp.spawnSync(cmd, ['-V'], { stdio: 'ignore' }).error;
const skip = has('iverilog') && has('vvp') ? false : 'iverilog/vvp introuvables';

function build(model, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venturi-'));
  fs.mkdirSync(path.join(dir, 'build'));
  const g = generate(model);
  const files = Object.entries(g.files).map(([n, body]) => { const f = path.join(dir, n); fs.writeFileSync(f, body); return f; });
  const tb = path.join(dir, `tb_${g.top}.v`);
  fs.writeFileSync(tb, testbench(model));
  const vvp = path.join(dir, `${name}.vvp`);
  const c = cp.spawnSync('iverilog', ['-g2012', '-Wall', '-o', vvp, '-s', `tb_${g.top}`, ...files, tb], { encoding: 'utf8' });
  return { dir, vvp, c };
}

test('chain compile et se simule', { skip }, () => {
  const { dir, vvp, c } = build(chain(), 'chain');
  assert.equal(c.status, 0, c.stderr);
  const r = cp.spawnSync('vvp', [vvp], { cwd: dir, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Simulation terminée/);
  assert.ok(fs.existsSync(path.join(dir, 'build', 'tb_chain.vcd')), 'le .vcd doit être produit');
});

test('chain : reset actif haut compile', { skip }, () => {
  const { c } = build(chain({ rstLow: false }), 'chain_h');
  assert.equal(c.status, 0, c.stderr);
});

test('additionneur + mux compilent', { skip }, () => {
  const m = {
    version: 1, topName: 'alu', rstLow: true,
    blocks: [input('x'), input('y'), input('s', 1), adder('a1'), mux('m1', 2), output('o')],
    links: [
      { from: 'x.p', to: 'a1.a' }, { from: 'y.p', to: 'a1.b' },
      { from: 'a1.s', to: 'm1.i0' }, { from: 'x.p', to: 'm1.i1' },
      { from: 's.p', to: 'm1.sel' }, { from: 'm1.y', to: 'o.p' }
    ]
  };
  const { c } = build(m, 'alu');
  assert.equal(c.status, 0, c.stderr);
});
