import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('css-easyfix.helloWorld', () => {
    const panel = vscode.window.createWebviewPanel(
      'cssEasyFix',           // Internal identifier for the webview.
      'CSS EasyFix',          // Panel title.
      vscode.ViewColumn.Beside, // Where to show the panel.
      { enableScripts: true } // Webview options.
    );
    
    panel.webview.html = getWebviewContent();
  });
  context.subscriptions.push(disposable);
}

function getWebviewContent() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CSS EasyFix</title>
</head>
<body>
  <h1>Welcome to CSS EasyFix!</h1>
  <p>This is your starting point. Soon, you'll be able to inspect and edit CSS for any HTML element.</p>
</body>
</html>`;
}

export function deactivate() {}
