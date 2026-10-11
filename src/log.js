'use strict';
const vscode = require('vscode');

/** Canal de sortie unique « Venturi », partagé par tous les modules. */
const out = vscode.window.createOutputChannel('Venturi');

module.exports = { out };
