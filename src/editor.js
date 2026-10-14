'use strict';
const vscode = require('vscode');
const { buildHtml } = require('./html');
const path = require('path');
const crypto = require('crypto');

class VenturiEditorProvider {
  /**
   * @param {vscode.ExtensionContext} context
   * @param {{ run:(cmd:string, uri:vscode.Uri, msg:any)=>Promise<void>, setActive:(uri:vscode.Uri)=>void }} hooks
   */
  constructor(context, hooks) { this.context = context; this.hooks = hooks; }

  async resolveCustomTextEditor(document, panel) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = this.html(panel.webview, media);
    this.hooks.setActive(document.uri);

    let applying = false, lastApplied = null, queue = Promise.resolve();

    const applyText = async text => {
      if (text === document.getText()) return;
      applying = true;
      try {
        const edit = new vscode.WorkspaceEdit();
        const end = document.lineAt(document.lineCount - 1).range.end;
        edit.replace(document.uri, new vscode.Range(0, 0, end.line, end.character), text);
        await vscode.workspace.applyEdit(edit);
        lastApplied = text;
      } finally { applying = false; }
    };

    const handle = async msg => {
      switch (msg.type) {
        case 'ready':
          panel.webview.postMessage({ type: 'load', text: document.getText() });
          break;
        case 'edit':
          await applyText(msg.text);
          break;
        case 'cmd':
          await this.hooks.run(msg.cmd, document.uri, msg);
          break;
        case 'status': {
          const st = await this.hooks.status(document.uri);
          panel.webview.postMessage({ type: 'status', ...(st || { dir: '', rows: [] }) });
          break;
        }
        case 'invalid':
          vscode.window.showErrorMessage('Venturi : JSON invalide, le schéma est verrouillé pour ne rien écraser.', 'Ouvrir en texte')
            .then(c => c && vscode.commands.executeCommand('vscode.openWith', document.uri, 'default'));
          break;
        case 'svg': {
          const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), msg.name)),
            filters: { SVG: ['svg'] }
          });
          if (target) await vscode.workspace.fs.writeFile(target, Buffer.from(msg.svg, 'utf8'));
          break;
        }
      }
    };

    const subs = [
      panel.webview.onDidReceiveMessage(msg => { queue = queue.then(() => handle(msg)).catch(e => console.error('[venturi]', e)); }),
      // Modification externe (texte, git, undo/redo…) → on met à jour le schéma
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.uri.toString() !== document.uri.toString() || !e.contentChanges.length) return;
        if (applying || document.getText() === lastApplied) return;
        panel.webview.postMessage({ type: 'load', text: document.getText() });
      }),
      panel.onDidChangeViewState(() => { if (panel.active) this.hooks.setActive(document.uri); })
    ];
    panel.onDidDispose(() => subs.forEach(s => s.dispose()));
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('hex');
    return buildHtml({
      nonce, cspSource: webview.cspSource, version: require('../package.json').version,
      uri: f => webview.asWebviewUri(vscode.Uri.joinPath(media, f))
    });
  }
}

module.exports = { VenturiEditorProvider };
