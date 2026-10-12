'use strict';
const assert = require('assert');
const { generate, validate, idOf, evaluateWidth, resolveWidth, formatVerilogValue, generateParameters } = require('../src/gen');

// Tests pour idOf
console.log('Testing idOf...');
assert.strictEqual(idOf('test'), 'test');
assert.strictEqual(idOf('test-block'), 'test_block');
assert.strictEqual(idOf('123test'), '_123test');
assert.strictEqual(idOf('test@123'), 'test_123');
assert.strictEqual(idOf('module'), 'module_'); // mot réservé
assert.strictEqual(idOf('endmodule'), 'endmodule_'); // mot réservé
assert.strictEqual(idOf(''), '_');
assert.strictEqual(idOf('123'), '_123');
assert.strictEqual(idOf('___test___'), '_test_');
console.log('✓ idOf tests passed');

// Tests pour evaluateWidth
console.log('Testing evaluateWidth...');
assert.strictEqual(evaluateWidth('8'), 8);
assert.strictEqual(evaluateWidth('16'), 16);
assert.strictEqual(evaluateWidth('WIDTH', { WIDTH: 32 }), 32);
assert.strictEqual(evaluateWidth('WIDTH*2', { WIDTH: 8 }), 16);
assert.strictEqual(evaluateWidth('WIDTH+4', { WIDTH: 8 }), 12);
assert.strictEqual(evaluateWidth('DATA_WIDTH-2', { DATA_WIDTH: 16 }), 14);
assert.strictEqual(evaluateWidth('invalid'), 1); // expression invalide
assert.strictEqual(evaluateWidth('WIDTH*2', {}), 1); // paramètre manquant
console.log('✓ evaluateWidth tests passed');

// Tests pour resolveWidth
console.log('Testing resolveWidth...');
assert.strictEqual(resolveWidth(8), 8);
assert.strictEqual(resolveWidth(16), 16);
assert.strictEqual(resolveWidth('WIDTH', { WIDTH: 32 }), 32);
assert.strictEqual(resolveWidth('WIDTH*2', { WIDTH: 8 }), 16);
console.log('✓ resolveWidth tests passed');

// Tests pour formatVerilogValue
console.log('Testing formatVerilogValue...');
assert.strictEqual(formatVerilogValue(42), '42');
assert.strictEqual(formatVerilogValue(42, 8), "8'd42");
assert.strictEqual(formatVerilogValue('8\'hFF'), "8'hFF");
assert.strictEqual(formatVerilogValue('0'), '0');
assert.strictEqual(formatVerilogValue(0, 16), "16'd0");
console.log('✓ formatVerilogValue tests passed');

// Tests pour generateParameters
console.log('Testing generateParameters...');
assert.strictEqual(generateParameters({}), '');
assert.strictEqual(generateParameters({ WIDTH: 8 }).trim(), '#(\n    parameter WIDTH = 8\n  )');
assert.strictEqual(generateParameters({ WIDTH: 8, RESET_VAL: 0 }).trim(), '#(\n    parameter WIDTH = 8,\n    parameter RESET_VAL = 0\n  )');
console.log('✓ generateParameters tests passed');

// Tests pour validate
console.log('Testing validate...');

// Test 1: Schéma valide simple
const validSchema1 = {
  topName: 'test',
  rstLow: true,
  blocks: [
    { inst: 'din', kind: 'in', ports: [{ name: 'p', dir: 'out', width: 8 }] },
    { inst: 'dout', kind: 'out', ports: [{ name: 'p', dir: 'in', width: 8 }] }
  ],
  links: []
};
const issues1 = validate(validSchema1);
assert.strictEqual(issues1.length, 0, 'Schéma valide simple ne devrait pas avoir d\'erreurs');

// Test 2: Nom de module top invalide
const invalidTopName = {
  topName: '123test',
  rstLow: true,
  blocks: [],
  links: []
};
const issues2 = validate(invalidTopName);
assert.strictEqual(issues2.length, 1, 'Nom de module top invalide devrait avoir une erreur');
assert.strictEqual(issues2[0].level, 'error');

// Test 3: Double nom d'instance
const duplicateInstance = {
  topName: 'test',
  rstLow: true,
  blocks: [
    { inst: 'reg1', kind: 'register', ports: [] },
    { inst: 'reg1', kind: 'register', ports: [] }
  ],
  links: []
};
const issues3 = validate(duplicateInstance);
assert.strictEqual(issues3.length, 1, 'Double nom d\'instance devrait avoir une erreur');
assert.strictEqual(issues3[0].level, 'error');

// Test 4: Lien invalide (sortie vers sortie)
const invalidLink = {
  topName: 'test',
  rstLow: true,
  blocks: [
    { inst: 'reg1', kind: 'register', ports: [
      { name: 'q', dir: 'out', width: 8 },
      { name: 'd', dir: 'in', width: 8 }
    ] },
    { inst: 'reg2', kind: 'register', ports: [
      { name: 'q', dir: 'out', width: 8 },
      { name: 'd', dir: 'in', width: 8 }
    ] }
  ],
  links: [{ from: 'reg1.q', to: 'reg2.q' }]
};
const issues4 = validate(invalidLink);
assert.strictEqual(issues4.length, 1, 'Lien sortie vers sortie devrait avoir une erreur');
assert.strictEqual(issues4[0].level, 'error');

// Test 5: Double pilotage
const doubleDrive = {
  topName: 'test',
  rstLow: true,
  blocks: [
    { inst: 'reg1', kind: 'register', ports: [{ name: 'q', dir: 'out', width: 8 }] },
    { inst: 'reg2', kind: 'register', ports: [{ name: 'q', dir: 'out', width: 8 }] },
    { inst: 'out1', kind: 'out', ports: [{ name: 'p', dir: 'in', width: 8 }] }
  ],
  links: [
    { from: 'reg1.q', to: 'out1.p' },
    { from: 'reg2.q', to: 'out1.p' }
  ]
};
const issues5 = validate(doubleDrive);
assert.strictEqual(issues5.length, 1, 'Double pilotage devrait avoir une erreur');
assert.strictEqual(issues5[0].level, 'error');

console.log('✓ validate tests passed');

// Tests pour generate
console.log('Testing generate...');

// Test 1: Génération simple
const simpleSchema = {
  topName: 'simple',
  rstLow: true,
  blocks: [
    { inst: 'din', kind: 'in', ports: [{ name: 'p', dir: 'out', width: 8 }] },
    { inst: 'reg1', kind: 'register', mod: 'reg8', ports: [
      { name: 'clk', dir: 'in', width: 1, role: 'clk' },
      { name: 'rst', dir: 'in', width: 1, role: 'rst' },
      { name: 'd', dir: 'in', width: 8 },
      { name: 'q', dir: 'out', width: 8 }
    ] },
    { inst: 'dout', kind: 'out', ports: [{ name: 'p', dir: 'in', width: 8 }] }
  ],
  links: [
    { from: 'din.p', to: 'reg1.d' },
    { from: 'reg1.q', to: 'dout.p' }
  ]
};

const result1 = generate(simpleSchema);
assert.ok(result1.top === 'simple', 'Nom du top devrait être simple');
assert.ok(result1.topFile === 'simple.v', 'Fichier top devrait être simple.v');
assert.ok(Object.keys(result1.files).includes('simple.v'), 'Fichier simple.v devrait être généré');
assert.ok(Object.keys(result1.files).includes('reg8.v'), 'Fichier reg8.v devrait être généré');

// Vérifier que le module reg8 a les bons ports
assert.ok(result1.files['reg8.v'].includes('input clk'), 'reg8.v devrait avoir input clk');
assert.ok(result1.files['reg8.v'].includes('input rst_n'), 'reg8.v devrait avoir input rst_n (rstLow=true)');
assert.ok(result1.files['reg8.v'].includes('input [7:0] d'), 'reg8.v devrait avoir input [7:0] d');
assert.ok(result1.files['reg8.v'].includes('output reg [7:0] q'), 'reg8.v devrait avoir output reg [7:0] q');

console.log('✓ generate simple schema tests passed');

// Test 2: Génération avec paramètres
const schemaWithParams = {
  topName: 'params_test',
  rstLow: true,
  parameters: {
    WIDTH: 16
  },
  blocks: [
    { inst: 'reg1', kind: 'register', mod: 'reg', parameters: { WIDTH: 8 }, ports: [
      { name: 'clk', dir: 'in', width: 1, role: 'clk' },
      { name: 'rst', dir: 'in', width: 1, role: 'rst' },
      { name: 'd', dir: 'in', width: 8 },
      { name: 'q', dir: 'out', width: 8 }
    ] },
    { inst: 'const1', kind: 'const', mod: 'const', parameters: { WIDTH: 8, VALUE: "8'hFF" }, ports: [
      { name: 'out', dir: 'out', width: 8 }
    ] }
  ],
  links: []
};

const result2 = generate(schemaWithParams);
assert.ok(result2.files['reg.v'].includes('#('), 'reg.v devrait avoir des paramètres');
assert.ok(result2.files['reg.v'].includes('parameter WIDTH = 8'), 'reg.v devrait avoir parameter WIDTH = 8');
assert.ok(result2.files['const.v'].includes('assign out = 8\'hFF'), 'const.v devrait avoir assign out = 8\'hFF');

console.log('✓ generate with parameters tests passed');

// Test 3: Génération avec nouveaux types de blocs
const schemaWithNewBlocks = {
  topName: 'new_blocks',
  rstLow: true,
  blocks: [
    { inst: 'and1', kind: 'and', mod: 'and_gate', ports: [
      { name: 'a', dir: 'in', width: 1 },
      { name: 'b', dir: 'in', width: 1 },
      { name: 'out', dir: 'out', width: 1 }
    ] },
    { inst: 'not1', kind: 'not', mod: 'not_gate', ports: [
      { name: 'a', dir: 'in', width: 1 },
      { name: 'out', dir: 'out', width: 1 }
    ] },
    { inst: 'slice1', kind: 'slice', mod: 'slice', parameters: { MSB: 7, LSB: 4 }, ports: [
      { name: 'in', dir: 'in', width: 8 },
      { name: 'out', dir: 'out', width: 4 }
    ] }
  ],
  links: []
};

const result3 = generate(schemaWithNewBlocks);
assert.ok(result3.files['and_gate.v'].includes('assign out = a & b'), 'and_gate.v devrait avoir assign out = a & b');
assert.ok(result3.files['not_gate.v'].includes('assign out = ~a'), 'not_gate.v devrait avoir assign out = ~a');
assert.ok(result3.files['slice.v'].includes('assign out = in[7:4]'), 'slice.v devrait avoir assign out = in[7:4]');

console.log('✓ generate with new blocks tests passed');

// Test 4: Génération avec testbench
const schemaWithTestbench = {
  topName: 'tb_test',
  rstLow: true,
  blocks: [
    { inst: 'din', kind: 'in', ports: [{ name: 'p', dir: 'out', width: 8 }] },
    { inst: 'dout', kind: 'out', ports: [{ name: 'p', dir: 'in', width: 8 }] }
  ],
  links: [],
  testbench: {
    stimuli: [
      { time: 50, actions: [{ signal: 'din', value: "8'hAA" }] },
      { time: 100, actions: [{ signal: 'din', value: "8'h55" }] }
    ],
    checks: [
      { time: 150, signal: 'dout', expected: "8'h55", message: 'Valeur attendue' }
    ]
  }
};

const tbResult = require('../src/gen').testbench(schemaWithTestbench);
assert.ok(tbResult.includes('#100'), 'Testbench devrait inclure #100');
assert.ok(tbResult.includes('din = 8\'hAA'), 'Testbench devrait inclure din = 8\'hAA');
assert.ok(tbResult.includes('din = 8\'h55'), 'Testbench devrait inclure din = 8\'h55');
assert.ok(tbResult.includes('$error'), 'Testbench devrait inclure $error pour le check');

console.log('✓ testbench tests passed');

console.log('\n✅ Tous les tests unitaires pour gen.js ont réussi !');
