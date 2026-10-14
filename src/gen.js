'use strict';
/**
 * Générateur Verilog de Venturi (logique pure, sans dépendance à VS Code).
 * Portée telle quelle depuis la fonction gen() de venturi_ide.html.
 */

const K = require('../media/kinds');

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

  const T = id(topName) || 'top', files = {}, src = {}, rstName = rstLow ? 'rst_n' : 'rst';

  // Les instances d'un même module sont regroupées. Si elles n'ont pas toutes les mêmes largeurs de ports
  // (ou la même profondeur, pour un registre), le module est PARAMÉTRÉ : une seule définition, et chaque
  // instance fixe sa taille (`reg #(.WIDTH(16)) u_r1 (...)`). Changer la taille d'une instance ne crée donc
  // jamais un nouveau module : le même fichier .v reste valable pour toutes.
  const groups = new Map();
  blocks.forEach(b => { if (!isIO(b)) { const m = id(b.mod); if (!groups.has(m)) groups.set(m, []); groups.get(m).push(b); } });
  // Réglages qui entrent dans le corps du module (valeur d'une constante, décalage, bits extraits)
  const extraOf = b => {
    const out = b.ports.find(p => p.dir == 'out'), w = out ? out.width : 1;
    if (b.kind == 'const') return { VALUE: K.valueLiteral(b.value, w) || `${w}'d0` };
    if (b.kind == 'shift') return { AMOUNT: String(Math.max(0, Math.floor(b.amount) || 0)) };
    if (b.kind == 'slice') { const hi = Math.max(0, Math.floor(b.hi ?? 3)), lo = Math.min(hi, Math.max(0, Math.floor(b.lo ?? 0))); return { HI: String(hi), LO: String(lo) }; }
    return {};
  };
  const params = {};
  groups.forEach((list, m) => {
    const b0 = list[0], names = new Set(b0.ports.map(pn)), P = { list: [], byPort: {}, depth: null, extra: [], x: {} };
    const uniq = base => { let s = base; while (names.has(s)) s += '_'; names.add(s); return s; };
    const byKey = new Map();
    b0.ports.forEach((p, j) => {
      const ws = list.map(x => (x.ports[j] || p).width);
      if (ws.every(w => w == ws[0])) return;
      const key = ws.join(',');
      if (!byKey.has(key)) byKey.set(key, { name: null, def: ws[0], first: p, ports: [] });
      byKey.get(key).ports.push(j);
    });
    const gs = [...byKey.values()];
    gs.forEach(g => { g.name = uniq(gs.length == 1 ? 'WIDTH' : `W_${pn(g.first)}`); P.list.push(g); g.ports.forEach(j => { P.byPort[j] = g.name; }); });
    if (b0.kind == 'register') {
      const ds = list.map(x => Math.max(1, Math.floor(x.depth) || 1));
      if (!ds.every(x => x == ds[0])) P.depth = { name: uniq('DEPTH'), def: ds[0] };
    }
    const ex0 = extraOf(b0);
    Object.keys(ex0).forEach(k => {
      const vs = list.map(x => extraOf(x)[k]);
      if (vs.every(v => v == vs[0])) P.x[k] = vs[0];
      else { P.x[k] = uniq(k); P.extra.push({ name: P.x[k], key: k, def: vs[0] }); }
    });
    params[m] = P;
  });

  groups.forEach((list, m) => {
    const b = list[0], P = params[m];
    const ins = b.ports.filter(p => p.dir == 'in' && !p.role), o = b.ports.find(p => p.dir == 'out');
    const c = b.ports.find(p => p.role == 'clk'), r = b.ports.find(p => p.role == 'rst'), n = pn;
    const wd = (p, j) => P.byPort[j] ? ` [${P.byPort[j]}-1:0]` : p.width > 1 ? ` [${p.width - 1}:0]` : '';
    const d = (p, j, rg) => `${p.dir == 'in' ? 'input' : 'output'}${rg ? ' reg' : ''}${wd(p, j)} ${pn(p)}`;
    let body = `    // TODO: logique de ${m}\n`, reg = false;
    if (b.kind == 'register' && c && r && ins[0] && o) {
      const N = Math.max(1, Math.floor(b.depth) || 1);
      if (N > 1 || P.depth) {
        // Registre à décalage de N étages : un seul module, latence de N cycles.
        const taken = new Set([...b.ports.map(pn), ...P.list.map(g => g.name), ...(P.depth ? [P.depth.name] : [])]);
        const free = base => { let s = base; while (taken.has(s)) s += '_'; return s; };
        const st = free('pipe_stage'), ix = free('pipe_i'), oj = b.ports.indexOf(o);
        const last = P.depth ? `${P.depth.name} - 1` : String(N - 1), cnt = P.depth ? P.depth.name : String(N);
        const w = P.byPort[oj] ? `[${P.byPort[oj]}-1:0] ` : o.width > 1 ? `[${o.width - 1}:0] ` : '';
        body = `    reg ${w}${st} [0:${last}];\n    integer ${ix};\n\n`
          + `    always @(posedge ${n(c)} or ${rstLow ? 'negedge' : 'posedge'} ${n(r)})\n`
          + `        if (${rstLow ? '!' : ''}${n(r)})\n            for (${ix} = 0; ${ix} < ${cnt}; ${ix} = ${ix} + 1) ${st}[${ix}] <= 0;\n`
          + `        else begin\n            ${st}[0] <= ${n(ins[0])};\n`
          + `            for (${ix} = 1; ${ix} < ${cnt}; ${ix} = ${ix} + 1) ${st}[${ix}] <= ${st}[${ix} - 1];\n        end\n\n`
          + `    assign ${n(o)} = ${st}[${last}];\n`;
      } else {
        reg = true;
        body = `    always @(posedge ${n(c)} or ${rstLow ? 'negedge' : 'posedge'} ${n(r)})\n        if (${rstLow ? '!' : ''}${n(r)}) ${n(o)} <= 0;\n        else ${n(o)} <= ${n(ins[0])};\n`;
      }
    } else if (b.kind == 'adder' && ins[1] && o) {
      body = `    assign ${n(o)} = ${n(ins[0])} + ${n(ins[1])};\n`;
    } else if (b.kind == 'mux') {
      const sl = ins.find(p => p.side), dt = ins.filter(p => !p.side);
      if (sl && o && dt.length) body = `    assign ${n(o)} = ${dt.map((p, i) => i < dt.length - 1 ? `(${n(sl)} == ${i}) ? ${n(p)} : ` : n(p)).join('')};\n`;
    } else if (b.kind == 'const' && o) {
      body = `    assign ${n(o)} = ${P.x.VALUE};\n`;
    } else if (b.kind == 'logic' && ins.length && o) {
      const sym = { and: '&', or: '|', xor: '^', nand: '&', nor: '|', xnor: '^' }[b.op || 'and'];
      const e = ins.map(n).join(` ${sym || '&'} `);
      body = `    assign ${n(o)} = ${b.op == 'not' ? `~${n(ins[0])}` : ['nand', 'nor', 'xnor'].includes(b.op) ? `~(${e})` : e};\n`;
    } else if (b.kind == 'cmp' && ins[1] && o) {
      const sym = { eq: '==', ne: '!=', lt: '<', le: '<=', gt: '>', ge: '>=' }[b.op || 'eq'] || '==';
      body = `    assign ${n(o)} = (${n(ins[0])} ${sym} ${n(ins[1])});\n`;
    } else if (b.kind == 'counter' && c && r && o) {
      reg = true;
      body = `    always @(posedge ${n(c)} or ${rstLow ? 'negedge' : 'posedge'} ${n(r)})\n        if (${rstLow ? '!' : ''}${n(r)}) ${n(o)} <= 0;\n`
        + `        else${ins[0] ? ` if (${n(ins[0])})` : ''} ${n(o)} <= ${n(o)} ${b.op == 'down' ? '-' : '+'} 1;\n`;
    } else if (b.kind == 'shift' && ins[0] && o) {
      const a = n(ins[0]), op = b.op || 'shl';
      body = `    assign ${n(o)} = ${op == 'shl' ? `${a} << ${P.x.AMOUNT}` : op == 'shr' ? `${a} >> ${P.x.AMOUNT}` : `$signed(${a}) >>> ${P.x.AMOUNT}`};\n`;
    } else if (b.kind == 'slice' && ins[0] && o) {
      body = `    assign ${n(o)} = ${n(ins[0])}[${P.x.HI}:${P.x.LO}];\n`;
    } else if (b.kind == 'concat' && ins.length && o) {
      body = `    assign ${n(o)} = {${ins.map(n).join(', ')}};\n`;
    } else if (b.kind == 'ram' && c) {
      const we = b.ports.find(p => p.name == 'we'), ad = b.ports.find(p => p.name == 'addr'), di = b.ports.find(p => p.name == 'din');
      if (we && ad && di && o) {
        const wm = P.byPort[b.ports.indexOf(di)] ? `${P.byPort[b.ports.indexOf(di)]}-1` : String(di.width - 1);
        const aw = P.byPort[b.ports.indexOf(ad)] || String(ad.width);
        let mem = 'mem'; while (b.ports.some(p => pn(p) == mem) || P.list.some(g => g.name == mem)) mem += '_';
        reg = true;
        body = `    reg [${wm}:0] ${mem} [0:(1 << ${aw}) - 1];\n\n    always @(posedge ${n(c)}) begin\n        if (${n(we)}) ${mem}[${n(ad)}] <= ${n(di)};\n        ${n(o)} <= ${mem}[${n(ad)}];\n    end\n`;
      }
    }
    const decl = [...P.list.map(g => `parameter ${g.name} = ${g.def}`), ...(P.depth ? [`parameter ${P.depth.name} = ${P.depth.def}`] : []), ...P.extra.map(e => `parameter ${e.name} = ${e.def}`)];
    const ph = decl.length ? ` #(\n    ${decl.join(',\n    ')}\n)` : '';
    files[`${m}.v`] = `// Squelette généré par Venturi : les ports suivent le schéma, le corps est libre.\n`
      + (decl.length ? `// Paramètres : la taille est fixée par chaque instance (voir le module top).\n` : '')
      + `module ${m}${ph} (\n    ${b.ports.map((p, j) => d(p, j, reg && p == o)).join(',\n    ')}\n);\n\n${body}\nendmodule\n`;
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
    const P = params[id(b.mod)];
    const ex = extraOf(b);
    const pa = [...P.list.map(g => `.${g.name}(${(b.ports[g.ports[0]] || {}).width})`), ...(P.depth ? [`.${P.depth.name}(${Math.max(1, Math.floor(b.depth) || 1)})`] : []), ...P.extra.map(e => `.${e.name}(${ex[e.key]})`)];
    inst += `    ${id(b.mod)}${pa.length ? ` #(${pa.join(', ')})` : ''} u_${id(b.inst)} (\n${conn}\n    );\n\n`;
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

  // Blocs prêts à l'emploi : réglages cohérents
  blocks.forEach(b => {
    const out = b.ports.find(p => p.dir == 'out');
    if (b.kind == 'const' && out) {
      if (K.valueLiteral(b.value, out.width) === null) err(`Constante ${b.inst} : valeur « ${b.value} » invalide (décimal, 0x… ou 0b…).`, b.inst);
      else if (K.valueNumber(b.value) >= (1n << BigInt(out.width))) warn(`Constante ${b.inst} : la valeur « ${b.value} » ne tient pas sur ${out.width} bit${out.width > 1 ? 's' : ''}.`, b.inst);
    }
    if (b.kind == 'slice') {
      const a = b.ports.find(p => p.dir == 'in'), hi = Math.floor(b.hi ?? 3), lo = Math.floor(b.lo ?? 0);
      if (!(hi >= lo && lo >= 0)) err(`Extraction ${b.inst} : bits [${b.hi}:${b.lo}] invalides (il faut haut ≥ bas ≥ 0).`, b.inst);
      else if (a && hi >= a.width) warn(`Extraction ${b.inst} : le bit ${hi} est hors de l'entrée (${a.width} bit${a.width > 1 ? 's' : ''}).`, b.inst);
    }
    if (b.kind == 'shift') {
      const a = b.ports.find(p => p.dir == 'in'), k = Math.floor(b.amount);
      if (!(k >= 0)) err(`Décaleur ${b.inst} : décalage « ${b.amount} » invalide.`, b.inst);
      else if (a && k >= a.width) warn(`Décaleur ${b.inst} : décalage de ${k} sur ${a.width} bits, le résultat est toujours nul.`, b.inst);
    }
  });

  // Modules : un seul jeu de ports par nom de module
  // Structure d'un module = noms, sens, rôles et côtés des ports. Les largeurs (et la profondeur d'un registre)
  // ne comptent pas : elles deviennent des paramètres Verilog propres à chaque instance.
  // L'opération (et, ou, ==, <<…) change le corps du module : elle fait partie de la structure.
  const sigOf = b => b.ports.map(p => `${p.dir}:${p.role || ''}:${p.side ? 'S' : ''}:${idOf(p.name)}`).join('|') + (b.op ? `|op:${b.op}` : '');
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
    else if (sigOf(prev) != sigOf(b)) err(`Les blocs ${prev.inst} et ${b.inst} utilisent le module « ${m} » avec des ports différents (noms ou sens : seules les tailles peuvent varier).`, b.inst);
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
