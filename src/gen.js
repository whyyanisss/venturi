'use strict';
/**
 * Générateur Verilog de Venturi (logique pure, sans dépendance à VS Code).
 * Portée telle quelle depuis la fonction gen() de venturi_ide.html.
 */

const idOf = s => String(s).replace(/\W/g, '_');

/**
 * @param {{topName:string, rstLow:boolean, blocks:any[], links:any[]}} model
 * @returns {{top:string, topFile:string, files:Record<string,string>}}
 */
function generate(model) {
  const { topName, rstLow, blocks, links } = model;
  const id = idOf;
  const isIO = b => b.kind == 'in' || b.kind == 'out';
  const pn = p => p.role == 'rst' ? id(p.name).replace(/_n$/, '') + (rstLow ? '_n' : '') : id(p.name);
  const find = r => {
    const k = r.indexOf('.'), bi = blocks.findIndex(x => x.inst == r.slice(0, k));
    const pj = bi < 0 ? -1 : blocks[bi].ports.findIndex(p => p.name == r.slice(k + 1));
    return pj < 0 ? null : { bi, pj, b: blocks[bi], p: blocks[bi].ports[pj] };
  };

  const T = id(topName) || 'top', files = {}, seen = {}, src = {}, rstName = rstLow ? 'rst_n' : 'rst';
  const d = (p, r) => `${p.dir == 'in' ? 'input' : 'output'}${r ? ' reg' : ''}${p.width > 1 ? ` [${p.width - 1}:0]` : ''} ${pn(p)}`;

  blocks.forEach(b => {
    if (isIO(b)) return;
    const m = id(b.mod); if (seen[m]) return; seen[m] = 1;
    const ins = b.ports.filter(p => p.dir == 'in' && !p.role), o = b.ports.find(p => p.dir == 'out');
    const c = b.ports.find(p => p.role == 'clk'), r = b.ports.find(p => p.role == 'rst'), n = pn;
    let body = `    // TODO: logique de ${m}\n`, reg = false;
    if (b.kind == 'register' && c && r && ins[0] && o) {
      reg = true;
      body = `    always @(posedge ${n(c)} or ${rstLow ? 'negedge' : 'posedge'} ${n(r)})\n        if (${rstLow ? '!' : ''}${n(r)}) ${n(o)} <= 0;\n        else ${n(o)} <= ${n(ins[0])};\n`;
    } else if (b.kind == 'adder' && ins[1] && o) {
      body = `    assign ${n(o)} = ${n(ins[0])} + ${n(ins[1])};\n`;
    } else if (b.kind == 'mux') {
      const sl = ins.find(p => p.side), dt = ins.filter(p => !p.side);
      if (sl && o && dt.length) body = `    assign ${n(o)} = ${dt.map((p, i) => i < dt.length - 1 ? `(${n(sl)} == ${i}) ? ${n(p)} : ` : n(p)).join('')};\n`;
    }
    files[`${m}.v`] = `// Squelette généré par Venturi : les ports suivent le schéma, le corps est libre.\n`
      + `module ${m} (\n    ${b.ports.map(p => d(p, reg && p == o)).join(',\n    ')}\n);\n\n${body}\nendmodule\n`;
  });

  const sig = (b, p) => b.kind == 'in' ? id(b.inst) : `${id(b.inst)}_${id(p.name)}`;
  links.forEach(l => { const f = find(l.from), t = find(l.to); if (f && t) src[l.to] = sig(f.b, f.p); });

  let wires = '', inst = '', assigns = '', iops = '';
  blocks.forEach(b => {
    if (isIO(b)) {
      const w = b.ports[0].width > 1 ? ` [${b.ports[0].width - 1}:0]` : '', s = src[`${b.inst}.p`];
      iops += `,\n    ${b.kind == 'in' ? 'input' : 'output'}${w} ${id(b.inst)}`;
      if (b.kind == 'out') assigns += s ? `    assign ${id(b.inst)} = ${s};\n` : `    // TODO: sortie ${id(b.inst)} non connectée\n`;
      return;
    }
    b.ports.forEach(p => {
      if (p.role) return;
      const w = p.width > 1 ? `[${p.width - 1}:0] ` : '';
      if (p.dir == 'out') wires += `    wire ${w}${sig(b, p)};\n`;
      else if (!src[`${b.inst}.${p.name}`]) wires += `    wire ${w}${sig(b, p)}; // TODO: entrée non connectée\n`;
    });
    const conn = b.ports.map(p => `        .${pn(p)}(${p.role == 'rst' ? rstName : p.role ? p.role : (p.dir == 'in' && src[`${b.inst}.${p.name}`]) || sig(b, p)})`).join(',\n');
    inst += `    ${id(b.mod)} u_${id(b.inst)} (\n${conn}\n    );\n\n`;
  });

  files[`${T}.v`] = `// Module top généré par Venturi depuis le schéma (.venturi.json).\n`
    + `// Régénéré à chaque sauvegarde du schéma : modifie le schéma plutôt que ce fichier.\n`
    + `module ${T} (\n    input clk,\n    input ${rstName}${iops}\n);\n${wires}\n${inst}${assigns}endmodule\n`;

  return { top: T, topFile: `${T}.v`, files };
}

/* ---------- Validation du schéma ---------- */

const KEYWORDS = new Set((
  'always and assign automatic begin buf case casex casez cell deassign default defparam disable edge else end endcase ' +
  'endfunction endgenerate endmodule endprimitive endspecify endtable endtask event for force forever fork function ' +
  'generate genvar if initial inout input integer join localparam module nand negedge nor not or output parameter ' +
  'posedge primitive real realtime reg release repeat signed specify supply0 supply1 table task time tri unsigned ' +
  'vectored wait wand weak0 weak1 while wire wor xnor xor logic bit byte int class package interface'
).split(' '));

/**
 * Vérifie la cohérence du schéma avant génération.
 * @param {{topName:string, rstLow:boolean, blocks:any[], links:any[]}} model
 * @returns {{level:'error'|'warning', msg:string, inst?:string}[]}
 */
function validate(model) {
  const { topName, rstLow, blocks, links } = model;
  const issues = [];
  const err = (msg, inst) => issues.push({ level: 'error', msg, inst });
  const warn = (msg, inst) => issues.push({ level: 'warning', msg, inst });
  const isIO = b => b.kind == 'in' || b.kind == 'out';
  const validId = s => /^[A-Za-z_]\w*$/.test(s) && !KEYWORDS.has(s);
  const T = idOf(topName) || 'top';
  const rstName = rstLow ? 'rst_n' : 'rst';

  if (!validId(T)) err(`Nom du module top « ${topName} » invalide ou réservé en Verilog.`);

  // Instances : noms uniques et valides
  const byId = new Map();
  blocks.forEach(b => {
    const i = idOf(b.inst);
    if (!b.inst || !validId(i)) err(`Nom d'instance « ${b.inst} » invalide ou réservé en Verilog.`, b.inst);
    if (byId.has(i)) err(`Deux blocs ont le même nom d'instance « ${i} » (après nettoyage des caractères spéciaux).`, b.inst);
    byId.set(i, b);
    if (isIO(b) && (i == 'clk' || i == rstName)) err(`« ${i} » est réservé par le module top (horloge/reset).`, b.inst);
    if (isIO(b) && !b.ports.length) err(`Le port « ${b.inst} » n'a pas de définition.`, b.inst);
  });

  // Modules : un seul jeu de ports par nom de module
  const sigOf = b => b.ports.map(p => `${p.dir}:${p.width}:${p.role || ''}:${p.side || ''}:${idOf(p.name)}`).join('|');
  const mods = new Map();
  blocks.filter(b => !isIO(b)).forEach(b => {
    const m = idOf(b.mod);
    if (!b.mod || !validId(m)) { err(`Nom de module « ${b.mod} » invalide ou réservé (bloc ${b.inst}).`, b.inst); return; }
    if (m == T) err(`Le module « ${m} » porte le même nom que le module top.`, b.inst);
    if (!b.ports.length) err(`Le bloc ${b.inst} n'a aucun port.`, b.inst);
    const pnames = new Set();
    b.ports.forEach(p => {
      const n = idOf(p.name);
      if (!validId(n)) err(`Port « ${p.name} » invalide ou réservé (bloc ${b.inst}).`, b.inst);
      if (pnames.has(n)) err(`Port « ${n} » en double dans le bloc ${b.inst}.`, b.inst);
      pnames.add(n);
    });
    const prev = mods.get(m);
    if (!prev) mods.set(m, b);
    else if (sigOf(prev) != sigOf(b)) err(`Les blocs ${prev.inst} et ${b.inst} utilisent le module « ${m} » avec des ports différents.`, b.inst);
  });

  // Liens
  const find = r => {
    const k = r.indexOf('.'), b = blocks.find(x => x.inst == r.slice(0, k));
    const p = b && b.ports.find(q => q.name == r.slice(k + 1));
    return p ? { b, p } : null;
  };
  const driven = new Map();
  links.forEach(l => {
    const f = find(l.from), t = find(l.to);
    if (!f || !t) { warn(`Lien « ${l.from} → ${l.to} » ignoré : un des ports n'existe plus.`); return; }
    if (f.p.dir != 'out' || t.p.dir != 'in') err(`Lien « ${l.from} → ${l.to} » : il doit aller d'une sortie vers une entrée.`, t.b.inst);
    if (f.p.width != t.p.width) warn(`Largeurs différentes : ${l.from} (${f.p.width}) → ${l.to} (${t.p.width}).`, t.b.inst);
    if (driven.has(l.to)) err(`${l.to} est piloté par plusieurs sources.`, t.b.inst);
    driven.set(l.to, true);
  });

  // Entrées non pilotées
  blocks.forEach(b => b.ports.forEach(p => {
    if (p.dir != 'in' || p.role) return;
    if (!driven.has(`${b.inst}.${p.name}`)) warn(isIO(b) ? `La sortie « ${b.inst} » n'est pas connectée.` : `Entrée ${b.inst}.${p.name} non connectée.`, b.inst);
  }));
  return issues;
}

/** Squelette de testbench pour le module top du schéma. */
function testbench(model) {
  const { topName, rstLow, blocks } = model;
  const T = idOf(topName) || 'top', rst = rstLow ? 'rst_n' : 'rst';
  const w = b => b.ports[0].width > 1 ? `[${b.ports[0].width - 1}:0] ` : '';
  const ins = blocks.filter(b => b.kind == 'in'), outs = blocks.filter(b => b.kind == 'out');
  const decl = [
    '    reg clk = 0;',
    `    reg ${rst} = ${rstLow ? 0 : 1};`,
    ...ins.map(b => `    reg ${w(b)}${idOf(b.inst)} = 0;`),
    ...outs.map(b => `    wire ${w(b)}${idOf(b.inst)};`)
  ].join('\n');
  const conns = ['clk', rst, ...ins.map(b => idOf(b.inst)), ...outs.map(b => idOf(b.inst))]
    .map(n => `        .${n}(${n})`).join(',\n');
  return `\`timescale 1ns/1ps

module tb_${T};
${decl}

    ${T} dut (
${conns}
    );

    // Horloge 100 MHz
    always #5 clk = ~clk;

    initial begin
        $dumpfile("build/tb_${T}.vcd");
        $dumpvars(0, tb_${T});

        // Reset
        #25 ${rst} = ${rstLow ? 1 : 0};

        // TODO: stimuli
        #200;

        $display("Simulation terminée à %0t ns", $time);
        $finish;
    end
endmodule
`;
}

module.exports = { generate, testbench, validate, idOf };
