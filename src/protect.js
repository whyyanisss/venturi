'use strict';
/**
 * Protection des fichiers générés (logique pure, sans VS Code, testée directement).
 * Chaque fichier généré commence par « // venturi:<hash> » : si le hash correspond au contenu, le fichier
 * n'a pas été modifié à la main et peut être régénéré sans risque. Sinon on demande avant d'y toucher.
 */
const crypto = require('crypto');

const MARK = '// venturi:';
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const stamp = body => `${MARK}${sha(body)}\n${body}`;

/** Vrai si le fichier porte son empreinte et n'a pas été modifié depuis la génération. */
function pristine(txt) {
  const i = txt.indexOf('\n');
  return txt.startsWith(MARK) && i > 0 && txt.slice(MARK.length, i) === sha(txt.slice(i + 1));
}

const strip = t => t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
// 1 = début (« module m #(…) ( »), 2 = liste de ports, 3 = fin (« ) ; »)
const HEAD = /(module\s+\w+\s*(?:#\s*\([\s\S]*?\)\s*)?\()([\s\S]*?)(\)\s*;)/;

/** Empreinte de l'en-tête d'un module : noms des paramètres + ports (sans commentaires ni reg/wire), ou null. */
function portSig(txt) {
  const m = strip(txt).match(HEAD);
  if (!m) return null;
  const params = [...m[1].matchAll(/parameter\s+(\w+)/g)].map(x => x[1]).join(',');
  return (params ? `#${params}|` : '') + m[2].replace(/\b(reg|wire|logic)\b/g, '').replace(/\s+/g, '').trim();
}

/** Découpe une liste de ports sur les virgules de premier niveau. */
function splitPorts(list) {
  const out = []; let depth = 0, cur = '';
  for (const ch of list) {
    if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}
const portName = d => (strip(d).match(/(\w+)\s*$/) || [])[1];

/**
 * Met à jour seulement l'EN-TÊTE (paramètres et ports) d'un module que tu as retouché à la main : le corps (ta logique)
 * est conservé tel quel. Les qualificatifs `reg` de ton code sont respectés (une sortie que tu pilotes avec `assign`
 * ne devient pas `reg`). Retourne null si l'un des deux textes n'a pas de module.
 */
function syncHeader(old, content) {
  const mo = old.match(HEAD), mn = content.match(HEAD);
  if (!mo || !mn) return null;
  const oldDecl = new Map(splitPorts(strip(mo[2])).map(d => [portName(d), d]));
  const list = splitPorts(mn[2]).map(d => {
    const o = oldDecl.get(portName(d));
    let x = d.replace(/\breg\b\s*/, '');
    if (o && /\breg\b/.test(o)) x = x.replace(/^(output)\s*/, 'output reg ');
    return x;
  });
  const header = mn[1] + '\n    ' + list.join(',\n    ') + '\n' + mn[3];
  return old.slice(0, mo.index) + header + old.slice(mo.index + mo[0].length);
}

/**
 * Décide ce qu'on fait d'un fichier généré.
 *  - same    : identique, rien à faire
 *  - write   : nouveau fichier, ou fichier jamais modifié à la main → on peut écrire sans demander
 *  - keep    : code écrit à la main dont les ports n'ont pas changé → on n'y touche pas
 *  - confirm : il faudrait écraser → demander à l'utilisateur (`modified` = modifié à la main)
 * @param {string|null} old      contenu actuel (null si le fichier n'existe pas)
 * @param {string} content       contenu généré (avec empreinte)
 * @param {{isTop?:boolean, always?:boolean}} opt  always : confirmer aussi pour un fichier non modifié
 */
function classify(old, content, { isTop = false, always = false } = {}) {
  if (old === content) return { action: 'same' };
  if (old === null || old === undefined) return { action: 'write', reason: 'new' };
  if (pristine(old)) return always ? { action: 'confirm', modified: false } : { action: 'write', reason: 'update' };
  if (!isTop && portSig(old) === portSig(content)) return { action: 'keep' };
  return { action: 'confirm', modified: true };
}

/** Vrai si le fichier a été généré par Venturi (il commence par l'empreinte), même modifié depuis. */
const isVenturiFile = txt => typeof txt === 'string' && txt.startsWith(MARK);

/**
 * État d'un fichier généré, pour le panneau « État du Verilog » :
 *  absent · ok · stale (jamais modifié mais en retard sur le schéma) · edited (modifié à la main, en-tête à jour)
 *  · edited-stale (modifié à la main et son en-tête ne correspond plus au schéma)
 */
function fileState(old, content, isTop = false) {
  if (old === null || old === undefined) return 'absent';
  if (old === content) return 'ok';
  if (pristine(old)) return 'stale';
  return !isTop && portSig(old) === portSig(content) ? 'edited' : 'edited-stale';
}

const pad = n => String(n).padStart(2, '0');
/** Nom de sauvegarde horodaté : une sauvegarde n'en écrase jamais une autre. */
function backupPath(f, d = new Date()) {
  return `${f}.${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.bak`;
}

module.exports = { MARK, sha, stamp, pristine, portSig, syncHeader, classify, fileState, isVenturiFile, backupPath };
