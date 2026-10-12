'use strict';
/**
 * Générateur Verilog de Venturi (logique pure, sans dépendance à VS Code).
 * Portée telle quelle depuis la fonction gen() de venturi_ide.html.
 */

// Liste des mots réservés Verilog (utilisée par idOf et validate)
const KEYWORDS = new Set([
  'always', 'and', 'assign', 'automatic', 'begin', 'buf', 'case', 'casex', 'casez',
  'cell', 'deassign', 'default', 'defparam', 'disable', 'edge', 'else', 'end', 'endcase',
  'endfunction', 'endgenerate', 'endmodule', 'endprimitive', 'endspecify', 'endtable',
  'endtask', 'event', 'for', 'force', 'forever', 'fork', 'function', 'generate',
  'genvar', 'if', 'initial', 'inout', 'input', 'integer', 'join', 'localparam', 'module',
  'nand', 'negedge', 'nor', 'not', 'or', 'output', 'parameter', 'posedge', 'primitive',
  'real', 'realtime', 'reg', 'release', 'repeat', 'signed', 'specify', 'supply0',
  'supply1', 'table', 'task', 'time', 'tri', 'unsigned', 'vectored', 'wait', 'wand',
  'weak0', 'weak1', 'while', 'wire', 'wor', 'xnor', 'xor', 'logic', 'bit', 'byte',
  'int', 'class', 'package', 'interface'
]);

/**
 * Nettoie un nom pour le rendre valide en Verilog.
 * - Remplace les caractères non alphanumériques par '_'
 * - Empêche les noms commençant par un chiffre
 * - Supprime les underscores consécutifs
 * - Limite à 100 caractères
 * - Évite les mots réservés Verilog
 * @param {string} s - Nom à nettoyer
 * @returns {string} Nom valide pour Verilog
 */
const idOf = s => {
  let result = String(s)
    .replace(/[^A-Za-z0-9_]/g, '_')      // Remplace les caractères spéciaux
    .replace(/^(\d)/, '_$1')            // Un nom ne peut pas commencer par un chiffre
    .replace(/_+/g, '_')                // Supprime les underscores consécutifs
    .slice(0, 100);                    // Limite à 100 caractères
  
  // Si le résultat est vide ou commence par '_' + chiffre
  if (!result || /^_\d/.test(result)) {
    result = '_' + result.replace(/^_/, '');
  }
  
  // Éviter les mots réservés
  if (KEYWORDS.has(result)) {
    result = result + '_';
  }
  
  return result;
};

/**
 * Évalue une expression de largeur simple (ex: "WIDTH*2", "8", "DATA_WIDTH+2")
 * @param {string} expr - Expression à évaluer
 * @param {Object} params - Dictionnaire de paramètres (ex: { WIDTH: 8, DATA_WIDTH: 16 })
 * @returns {number} Valeur numérique
 */
function evaluateWidth(expr, params = {}) {
  // Si c'est un nombre direct
  if (/^\d+$/.test(expr)) {
    return parseInt(expr, 10);
  }
  
  // Remplacer les références aux paramètres
  let resolved = expr;
  for (const [key, value] of Object.entries(params)) {
    const regex = new RegExp(`\\b${key}\\b`, 'g');
    resolved = resolved.replace(regex, String(value));
  }
  
  // Évaluer l'expression (SEULEMENT des opérations simples : +, -, *, /, %)
  // Sécurité : on n'évalue que des expressions numériques
  if (/^[\d\s+\-*/%()]+$/.test(resolved)) {
    try {
      // Utiliser une évaluation sûre (pas d'exécutions arbitraires)
      const safeExpr = resolved.replace(/[^\d\s+\-*/%()]/g, '');
      // eslint-disable-next-line no-eval
      return Math.max(1, Math.floor(eval(safeExpr)));
    } catch {
      // En cas d'erreur, retourner 1
      return 1;
    }
  }
  
  return 1;
}

/**
 * Résout une largeur de port qui peut être une expression ou un nombre
 * @param {string|number} width - Largeur du port
 * @param {Object} params - Paramètres globaux du schéma
 * @returns {number} Largeur résolue
 */
function resolveWidth(width, params = {}) {
  if (typeof width === 'number') {
    return Math.max(1, Math.floor(width));
  }
  if (typeof width === 'string') {
    return evaluateWidth(width, params);
  }
  return 1;
}

/**
 * Génère la déclaration des paramètres pour un module
 * @param {Object} params - Paramètres du module (ex: { WIDTH: 8, RESET_VAL: 0 })
 * @returns {string} Déclaration des paramètres Verilog
 */
function generateParameters(params = {}) {
  if (Object.keys(params).length === 0) {
    return '';
  }
  
  const paramLines = Object.entries(params).map(([name, value]) => {
    // Si la valeur est une expression, on la laisse telle quelle
    if (typeof value === 'string' && !/^\d+$/.test(value)) {
      return `    parameter ${idOf(name)} = ${value}`;
    }
    return `    parameter ${idOf(name)} = ${value}`;
  });
  
  return `#(\n    ${paramLines.join(',\n    ')}
  )`;
}

/**
 * Formate une valeur pour Verilog (ajoute le préfixe de taille si nécessaire)
 * @param {string|number} value - Valeur à formater
 * @param {number} width - Largeur du signal
 * @returns {string} Valeur formatée pour Verilog
 */
function formatVerilogValue(value, width = null) {
  if (typeof value === 'number') {
    if (width !== null) {
      return `${width}'d${value}`;
    }
    return String(value);
  }
  if (typeof value === 'string') {
    // Si c'est déjà une valeur Verilog (ex: "8'hFF"), la retourner telle quelle
    if (/^\d+'[bBdDhHoO]/.test(value)) {
      return value;
    }
    // Sinon, essayer de la formater
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      if (width !== null) {
        return `${width}'d${num}`;
      }
      return String(num);
    }
    // Retourner la valeur telle quelle (pour les expressions)
    return value;
  }
  return '0';
}

/**
 * @param {{topName:string, rstLow:boolean, blocks:any[], links:any[], parameters?:Object, testbench?:Object}} model
 * @returns {{top:string, topFile:string, files:Record<string,string>}}
 */
function generate(model) {
  const { topName, rstLow, blocks, links, parameters: globalParams = {}, testbench: tbConfig = {} } = model;
  const id = idOf;
  const isIO = b => b.kind == 'in' || b.kind == 'out';
  const pn = p => p.role == 'rst' ? id(p.name).replace(/_n$/, '') + (rstLow ? '_n' : '') : id(p.name);
  const find = r => {
    const k = r.indexOf('.'), bi = blocks.findIndex(x => x.inst == r.slice(0, k));
    const pj = bi < 0 ? -1 : blocks[bi].ports.findIndex(p => p.name == r.slice(k + 1));
    return pj < 0 ? null : { bi, pj, b: blocks[bi], p: blocks[bi].ports[pj] };
  };

  const T = id(topName) || 'top', files = {}, seen = {}, src = {}, rstName = rstLow ? 'rst_n' : 'rst';
  const d = (p, r) => `${p.dir == 'in' ? 'input' : 'output'}${r ? ' reg' : ''}${p.width > 1 ? ` [${resolveWidth(p.width, globalParams) - 1}:0]` : ''} ${pn(p)}`;

  // Fonction pour générer le corps d'un bloc en fonction de son type
  const generateBlockBody = (b, n) => {
    const ins = b.ports.filter(p => p.dir == 'in' && !p.role);
    const o = b.ports.find(p => p.dir == 'out');
    const c = b.ports.find(p => p.role == 'clk');
    const r = b.ports.find(p => p.role == 'rst');
    
    // Résoudre les largeurs avec les paramètres du bloc
    const blockParams = b.parameters || {};
    const allParams = { ...globalParams, ...blockParams };
    
    // Calculer les largeurs des ports
    const getWidth = (port) => resolveWidth(port.width, allParams);
    
    switch (b.kind) {
      case 'register':
        if (c && r && ins[0] && o) {
          const width = getWidth(o);
          const resetVal = blockParams.RESET_VAL !== undefined ? formatVerilogValue(blockParams.RESET_VAL, width) : '0';
          return `    always @(posedge ${n(c)} or ${rstLow ? 'negedge' : 'posedge'} ${n(r)})\n` +
                 `      if (${rstLow ? '!' : ''}${n(r)}) ${n(o)} <= ${resetVal};\n` +
                 `      else ${n(o)} <= ${n(ins[0])};\n`;
        }
        break;
        
      case 'adder':
        if (ins[1] && o) {
          return `    assign ${n(o)} = ${n(ins[0])} + ${n(ins[1])};\n`;
        }
        break;
        
      case 'mux':
        const sl = ins.find(p => p.side);
        const dt = ins.filter(p => !p.side);
        if (sl && o && dt.length) {
          const cases = dt.map((p, i) => 
            i < dt.length - 1 ? `(${n(sl)} == ${i}) ? ${n(p)} : ` : n(p)
          );
          return `    assign ${n(o)} = ${cases.join('')};\n`;
        }
        break;
        
      case 'const':
        if (o) {
          const width = getWidth(o);
          const value = blockParams.VALUE !== undefined ? formatVerilogValue(blockParams.VALUE, width) : '0';
          return `    assign ${n(o)} = ${value};\n`;
        }
        break;
        
      case 'slice':
        if (ins[0] && o) {
          const width = getWidth(o);
          const msb = blockParams.MSB !== undefined ? blockParams.MSB : (getWidth(ins[0]) - 1);
          const lsb = blockParams.LSB !== undefined ? blockParams.LSB : 0;
          return `    assign ${n(o)} = ${n(ins[0])}[${msb}:${lsb}];\n`;
        }
        break;
        
      case 'concat':
        if (ins.length >= 2 && o) {
          const parts = ins.map(p => n(p));
          return `    assign ${n(o)} = {${parts.join(', ')}};\n`;
        }
        break;
        
      case 'and':
      case 'or':
      case 'xor':
      case 'nand':
      case 'nor':
      case 'xnor':
        if (ins.length >= 2 && o) {
          const op = {
            'and': '&',
            'or': '|',
            'xor': '^',
            'nand': '&',
            'nor': '|',
            'xnor': '^'
          }[b.kind];
          const inputs = ins.map(p => n(p)).join(` ${op} `);
          const result = b.kind.startsWith('n') ? `~(${inputs})` : inputs;
          return `    assign ${n(o)} = ${result};\n`;
        }
        break;
        
      case 'not':
        if (ins[0] && o) {
          return `    assign ${n(o)} = ~${n(ins[0])};\n`;
        }
        break;
        
      case 'shl':
        if (ins[0] && o) {
          const amount = blockParams.AMOUNT || 1;
          return `    assign ${n(o)} = ${n(ins[0])} << ${amount};\n`;
        }
        break;
        
      case 'shr':
        if (ins[0] && o) {
          const amount = blockParams.AMOUNT || 1;
          return `    assign ${n(o)} = ${n(ins[0])} >> ${amount};\n`;
        }
        break;
        
      case 'eq':
      case 'neq':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        if (ins.length >= 2 && o) {
          const op = {
            'eq': '==',
            'neq': '!=',
            'gt': '>',
            'gte': '>=',
            'lt': '<',
            'lte': '<='
          }[b.kind];
          return `    assign ${n(o)} = ${n(ins[0])} ${op} ${n(ins[1])};\n`;
        }
        break;
        
      case 'counter':
        if (c && r && o) {
          const width = getWidth(o);
          const enable = b.ports.find(p => p.role == 'enable');
          const load = b.ports.find(p => p.role == 'load');
          const loadVal = b.ports.find(p => p.role == 'load_val');
          
          let body = `    always @(posedge ${n(c)} or ${rstLow ? 'negedge' : 'posedge'} ${n(r)})\n`;
          body += `      if (${rstLow ? '!' : ''}${n(r)}) ${n(o)} <= 0;\n`;
          
          if (enable) {
            body += `      else if (${n(enable)}) ${n(o)} <= ${n(o)} + 1;\n`;
          } else {
            body += `      else ${n(o)} <= ${n(o)} + 1;\n`;
          }
          
          if (load && loadVal) {
            body += `      if (${n(load)}) ${n(o)} <= ${n(loadVal)};\n`;
          }
          
          return body;
        }
        break;
        
      default:
        return `    // TODO: logique de ${id(b.mod)}\n`;
    }
    
    return `    // TODO: logique de ${id(b.mod)}\n`;
  };

  // Générer les fichiers pour chaque bloc
  blocks.forEach(b => {
    if (isIO(b)) return;
    const m = id(b.mod); if (seen[m]) return; seen[m] = 1;
    
    // Résoudre les largeurs avec les paramètres
    const blockParams = b.parameters || {};
    const allParams = { ...globalParams, ...blockParams };
    
    // Générer la déclaration des paramètres du module
    const paramsDecl = generateParameters(blockParams);
    
    // Générer le corps du module
    const body = generateBlockBody(b, pn);
    const isReg = b.kind === 'register' || b.kind === 'counter';
    
    // Déterminer si la sortie doit être 'reg'
    const o = b.ports.find(p => p.dir == 'out' && !p.role);
    const reg = isReg && o;
    
    files[`${m}.v`] = `// Squelette généré par Venturi : les ports suivent le schéma, le corps est libre.\n` +
      `module ${m}${paramsDecl} (\n    ${b.ports.map(p => d(p, reg && p === o)).join(',\n    ')}\n);\n\n${body}\nendmodule\n`;
  });

  const sig = (b, p) => b.kind == 'in' ? id(b.inst) : `${id(b.inst)}_${id(p.name)}`;
  links.forEach(l => { const f = find(l.from), t = find(l.to); if (f && t) src[l.to] = sig(f.b, f.p); });

  let wires = '', inst = '', assigns = '', iops = '';
  blocks.forEach(b => {
    if (isIO(b)) {
      // Résoudre la largeur avec les paramètres globaux
      const width = resolveWidth(b.ports[0].width, globalParams);
      const w = width > 1 ? ` [${width - 1}:0]` : '';
      const s = src[`${b.inst}.p`];
      iops += `,\n    ${b.kind == 'in' ? 'input' : 'output'}${w} ${id(b.inst)}`;
      if (b.kind == 'out') assigns += s ? `    assign ${id(b.inst)} = ${s};\n` : `    // TODO: sortie ${id(b.inst)} non connectée\n`;
      return;
    }
    
    // Résoudre les largeurs des ports avec les paramètres du bloc
    const blockParams = b.parameters || {};
    const allParams = { ...globalParams, ...blockParams };
    
    b.ports.forEach(p => {
      if (p.role) return;
      const width = resolveWidth(p.width, allParams);
      const w = width > 1 ? `[${width - 1}:0] ` : '';
      if (p.dir == 'out') wires += `    wire ${w}${sig(b, p)};\n`;
      else if (!src[`${b.inst}.${p.name}`]) wires += `    wire ${w}${sig(b, p)}; // TODO: entrée non connectée\n`;
    });
    
    // Générer les connexions avec les paramètres
    const conn = b.ports.map(p => {
      const paramValue = b.parameters && b.parameters[p.name] !== undefined ? b.parameters[p.name] : undefined;
      if (p.role) {
        if (p.role === 'rst') return `        .${pn(p)}(${rstName})`;
        return `        .${pn(p)}(${p.role})`;
      }
      if (p.dir == 'in' && src[`${b.inst}.${p.name}`]) return `        .${pn(p)}(${src[`${b.inst}.${p.name}`]})`;
      if (paramValue !== undefined) return `        .${pn(p)}(${formatVerilogValue(paramValue)})`;
      return `        .${pn(p)}(${sig(b, p)})`;
    }).join(',\n');
    
    // Ajouter les paramètres du bloc à l'instanciation
    const paramsDecl = b.parameters && Object.keys(b.parameters).length > 0
      ? ` #(.${Object.entries(b.parameters).map(([k, v]) => `${idOf(k)}(${formatVerilogValue(v)})`).join(', ')})`
      : '';
    
    inst += `    ${id(b.mod)}${paramsDecl} u_${id(b.inst)} (\n${conn}\n    );\n\n`;
  });

  // Générer le module top avec les paramètres globaux
  const topParamsDecl = generateParameters(globalParams);
  files[`${T}.v`] = `// Module top généré par Venturi depuis le schéma (.venturi.json).\n` +
    `// Régénéré à chaque sauvegarde du schéma : modifie le schéma plutôt que ce fichier.\n` +
    `module ${T}${topParamsDecl} (\n    input clk,\n    input ${rstName}${iops}\n);\n${wires}\n${inst}${assigns}endmodule\n`;

  return { top: T, topFile: `${T}.v`, files };
}

/* ---------- Validation du schéma ---------- */

/**
 * Vérifie la cohérence du schéma avant génération.
 * @param {{topName:string, rstLow:boolean, blocks:any[], links:any[], parameters?:Object, testbench?:Object}} model
 * @returns {{level:'error'|'warning', msg:string, inst?:string}[]}
 */
function validate(model) {
  const { topName, rstLow, blocks, links, parameters: globalParams = {}, testbench: tbConfig = {} } = model;
  const issues = [];
  const err = (msg, inst) => issues.push({ level: 'error', msg, inst });
  const warn = (msg, inst) => issues.push({ level: 'warning', msg, inst });
  const isIO = b => b.kind == 'in' || b.kind == 'out';
  
  // Fonction de validation d'un identifiant
  const validId = s => {
    const cleaned = idOf(s);
    // Vérifier que le nom nettoyé n'est pas vide et ne commence pas par un chiffre
    return cleaned && cleaned.length > 0 && !/^\d/.test(cleaned) && !KEYWORDS.has(cleaned);
  };
  
  const T = idOf(topName) || 'top';
  const rstName = rstLow ? 'rst_n' : 'rst';

  if (!validId(topName)) {
    err(
      `Le nom du module top « ${topName} » est invalide. ` +
      `Utilisez uniquement des lettres, chiffres et underscores. ` +
      `Évitez les mots réservés Verilog (module, endmodule, always, etc.) et les noms commençant par un chiffre.`
    );
  }

  // Instances : noms uniques et valides
  const byId = new Map();
  blocks.forEach(b => {
    const i = idOf(b.inst);
    if (!b.inst || !validId(i)) {
      err(
        `Le nom d'instance « ${b.inst} » est invalide ou réservé en Verilog. ` +
        `Utilisez uniquement des lettres, chiffres et underscores, et évitez les mots réservés.`,
        b.inst
      );
    }
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
    if (!b.mod || !validId(m)) { 
      err(
        `Le nom de module « ${b.mod} » est invalide ou réservé (bloc ${b.inst}). ` +
        `Utilisez uniquement des lettres, chiffres et underscores.`,
        b.inst
      ); 
      return; 
    }
    if (m == T) err(`Le module « ${m} » porte le même nom que le module top.`, b.inst);
    if (!b.ports.length) err(`Le bloc ${b.inst} n'a aucun port.`, b.inst);
    const pnames = new Set();
    b.ports.forEach(p => {
      const n = idOf(p.name);
      if (!validId(n)) {
        err(
          `Le port « ${p.name} » est invalide ou réservé (bloc ${b.inst}). ` +
          `Utilisez un nom valide.`,
          b.inst
        );
      }
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
    if (!f || !t) { 
      warn(
        `Lien « ${l.from} → ${l.to} » ignoré : un des ports n'existe plus. ` +
        `Vérifiez que les noms des blocs et ports sont corrects.`,
        t?.b?.inst
      ); 
      return; 
    }
    if (f.p.dir != 'out' || t.p.dir != 'in') {
      err(
        `Lien « ${l.from} → ${l.to} » : il doit aller d'une sortie vers une entrée. ` +
        `Vérifiez la direction (dir) des ports.`,
        t.b.inst
      );
    }
    if (f.p.width != t.p.width) {
      warn(
        `Largeurs différentes : ${l.from} (${f.p.width}) → ${l.to} (${t.p.width}). ` +
        `Cela peut causer des erreurs de compilation.`,
        t.b.inst
      );
    }
    if (driven.has(l.to)) err(`« ${l.to} » est piloté par plusieurs sources.`, t.b.inst);
    driven.set(l.to, true);
  });

  // Entrées non pilotées
  blocks.forEach(b => b.ports.forEach(p => {
    if (p.dir != 'in' || p.role) return;
    if (!driven.has(`${b.inst}.${p.name}`)) {
      warn(
        isIO(b) 
          ? `La sortie « ${b.inst} » n'est pas connectée.`
          : `Entrée ${b.inst}.${p.name} non connectée.`,
        b.inst
      );
    }
  }));
  
  // Validation des stimuli (si présents)
  if (tbConfig.stimuli) {
    tbConfig.stimuli.forEach((stim, idx) => {
      if (!stim.time || typeof stim.time !== 'number') {
        err(
          `Le stimulus #${idx + 1} a un temps invalide. Utilisez un nombre (en ns).`,
          null
        );
      }
      if (!stim.actions || !Array.isArray(stim.actions)) {
        err(
          `Le stimulus #${idx + 1} n'a pas de liste d'actions valide.`,
          null
        );
      }
      stim.actions.forEach((action, actIdx) => {
        if (!action.signal) {
          err(
            `L'action #${actIdx + 1} du stimulus #${idx + 1} n'a pas de signal spécifié.`,
            null
          );
        }
        if (action.value === undefined) {
          err(
            `L'action #${actIdx + 1} du stimulus #${idx + 1} n'a pas de valeur spécifiée.`,
            null
          );
        }
      });
    });
  }
  
  // Validation des checks (si présents)
  if (tbConfig.checks) {
    tbConfig.checks.forEach((check, idx) => {
      if (!check.time || typeof check.time !== 'number') {
        err(
          `Le check #${idx + 1} a un temps invalide. Utilisez un nombre (en ns).`,
          null
        );
      }
      if (!check.signal) {
        err(
          `Le check #${idx + 1} n'a pas de signal spécifié.`,
          null
        );
      }
      if (check.expected === undefined) {
        err(
          `Le check #${idx + 1} n'a pas de valeur attendue spécifiée.`,
          null
        );
      }
    });
  }
  
  return issues;
}

/**
 * Génère un testbench avec stimuli et checks définis dans le schéma
 * @param {{topName:string, rstLow:boolean, blocks:any[], parameters?:Object, testbench?:Object}} model
 * @returns {string} Code Verilog du testbench
 */
function testbench(model) {
  const { topName, rstLow, blocks, parameters: globalParams = {}, testbench: tbConfig = {} } = model;
  const T = idOf(topName) || 'top', rst = rstLow ? 'rst_n' : 'rst';
  
  // Résoudre les largeurs avec les paramètres globaux
  const resolveWidth = (width) => {
    if (typeof width === 'number') return Math.max(1, Math.floor(width));
    if (typeof width === 'string') {
      return evaluateWidth(width, globalParams);
    }
    return 1;
  };
  
  const w = b => {
    const width = resolveWidth(b.ports[0].width);
    return width > 1 ? `[${width - 1}:0] ` : '';
  };
  
  const ins = blocks.filter(b => b.kind == 'in'), outs = blocks.filter(b => b.kind == 'out');
  
  // Générer les déclarations avec les paramètres globaux
  const paramsDecl = globalParams && Object.keys(globalParams).length > 0
    ? `#(\n    ${Object.entries(globalParams).map(([k, v]) => `    parameter ${idOf(k)} = ${v}`).join(',\n    ')}
  )`
    : '';
  
  const decl = [
    '    reg clk = 0;',
    `    reg ${rst} = ${rstLow ? 0 : 1};`,
    ...ins.map(b => `    reg ${w(b)}${idOf(b.inst)} = 0;`),
    ...outs.map(b => `    wire ${w(b)}${idOf(b.inst)};`)
  ].join('\n');
  const conns = ['clk', rst, ...ins.map(b => idOf(b.inst)), ...outs.map(b => idOf(b.inst))]
    .map(n => `        .${n}(${n})`).join(',\n');
  
  // Générer les stimuli
  let stimuliCode = '';
  if (tbConfig.stimuli && tbConfig.stimuli.length > 0) {
    stimuliCode = tbConfig.stimuli.map(stim => {
      const time = stim.time;
      const actions = stim.actions.map(action => {
        const signal = idOf(action.signal);
        const value = formatVerilogValue(action.value);
        return `        ${signal} = ${value};`;
      }).join('\n        ');
      return `    #${time} ${actions}`;
    }).join('\n    ');
  }
  
  // Générer les checks
  let checksCode = '';
  if (tbConfig.checks && tbConfig.checks.length > 0) {
    checksCode = tbConfig.checks.map(check => {
      const time = check.time;
      const signal = idOf(check.signal);
      const expected = formatVerilogValue(check.expected);
      const message = check.message || `Check échoué pour ${check.signal} à ${time}ns`;
      return `    #${time} if (${signal} !== ${expected}) $error("${message} (got ${signal}=%b, expected ${expected})", ${signal});`;
    }).join('\n    ');
  }
  
  // Temps de fin de simulation
  const endTime = Math.max(
    ...(tbConfig.stimuli || []).map(s => s.time),
    ...(tbConfig.checks || []).map(c => c.time),
    200
  ) + 50;
  
  return `\`timescale 1ns/1ps

module tb_${T}${paramsDecl};
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
        ${rst} = ${rstLow ? 0 : 1};

        // Stimuli définis dans le schéma
${stimuliCode.length > 0 ? '\n' + stimuliCode + '\n' : ''}        // Checks définis dans le schéma
${checksCode.length > 0 ? '\n' + checksCode + '\n' : ''}        // Fin de simulation
        #${endTime};

        $display("Simulation terminée à %0t ns", $time);
        $finish;
    end
endmodule
`;
}

module.exports = { 
  generate, 
  testbench, 
  validate, 
  idOf, 
  KEYWORDS, 
  evaluateWidth, 
  resolveWidth,
  formatVerilogValue,
  generateParameters
};
