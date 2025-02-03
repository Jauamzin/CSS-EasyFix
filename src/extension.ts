import * as vscode from 'vscode';
import { parse, HTMLElement } from 'node-html-parser';
import * as css from 'css';
import * as select from 'css-select';

interface ParsedHTMLElement extends HTMLElement {
  startIndex: number;
  endIndex: number;
}

// Recursively collect all HTML elements from the parsed document.
function collectElements(root: ParsedHTMLElement): ParsedHTMLElement[] {
  let elements: ParsedHTMLElement[] = [];
  if (root.nodeType === 1) {
    elements.push(root);
  }
  for (const child of root.childNodes) {
    if (child.nodeType === 1) {
      elements = elements.concat(collectElements(child as ParsedHTMLElement));
    }
  }
  return elements;
}

// Convert a parsed element to a minimal object along with its index.
function elementToMinimal(el: ParsedHTMLElement, index: number) {
  return {
    index,
    tagName: el.tagName,
    id: el.getAttribute('id') || '',
    class: el.getAttribute('class') || ''
  };
}

// Create webview HTML content for selecting an element.
function getSelectionWebviewContent(elements: any[]): string {
  const elementsData = encodeURIComponent(JSON.stringify(elements));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Select HTML Element</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    ul { list-style: none; padding: 0; }
    li { padding: 8px; border-bottom: 1px solid #ccc; cursor: pointer; }
    li:hover { background-color: #e0e0e0; }
  </style>
</head>
<body>
  <h1>Select an HTML Element</h1>
  <ul id="elementList"></ul>
  <script>
    const vscode = acquireVsCodeApi();
    const elements = JSON.parse(decodeURIComponent("${elementsData}"));
    const list = document.getElementById('elementList');
    elements.forEach((el) => {
      const li = document.createElement('li');
      li.textContent = \`<\${el.tagName}\${el.id ? ' id="' + el.id + '"' : ''}\${el.class ? ' class="' + el.class + '"' : ''}>\`;
      li.onclick = () => {
        vscode.postMessage({ command: 'elementSelected', index: el.index });
      };
      list.appendChild(li);
    });
  </script>
</body>
</html>`;
}

// Reads the content of style.css from the workspace.
async function getCssContent(): Promise<string> {
  const cssFiles = await vscode.workspace.findFiles('**/style.css', '**/node_modules/**', 1);
  if (cssFiles.length > 0) {
    const fileData = await vscode.workspace.fs.readFile(cssFiles[0]);
    return Buffer.from(fileData).toString('utf8');
  }
  return '/* No style.css found */';
}

// Given the CSS file content and a target HTML element,
// filter the CSS rules that match the element.
function filterCssRulesForElement(cssContent: string, target: ParsedHTMLElement): string {
  const parsedCss = css.parse(cssContent);
  if (!parsedCss.stylesheet) {
    return '/* No CSS stylesheet found */';
  }
  const domTarget = toCssSelectDom(target);
  const matchingRules = parsedCss.stylesheet.rules.filter(rule => {
    if (rule.type !== 'rule' || !rule.selectors) {
      return false;
    }
    return rule.selectors.some(selector => {
      try {
        return select.is(domTarget, selector);
      } catch (e) {
        console.error("Error matching selector:", selector, e);
        return false;
      }
    });
  });
  const filteredStylesheet = {
    type: "stylesheet" as "stylesheet",
    stylesheet: { rules: matchingRules }
  } as css.Stylesheet;
  return css.stringify(filteredStylesheet);
}

// Convert a ParsedHTMLElement into a minimal DOM for css-select.
function toCssSelectDom(el: ParsedHTMLElement): any {
  return {
    type: 'tag',
    name: el.tagName,
    attribs: {
      id: el.getAttribute('id') || '',
      class: el.getAttribute('class') || ''
    },
    children: el.childNodes
      .filter(child => child.nodeType === 1)
      .map(child => toCssSelectDom(child as ParsedHTMLElement))
  };
}

// Create webview content for editing CSS rules.
function getEditWebviewContent(editableCss: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CSS EasyFix - Edit CSS</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    textarea { width: 100%; height: 70vh; font-family: monospace; font-size: 14px; }
    button { margin-top: 10px; padding: 8px 16px; font-size: 14px; }
  </style>
</head>
<body>
  <h1>CSS EasyFix</h1>
  <p>Edit the CSS rules affecting the selected element:</p>
  <textarea id="cssEditor">${editableCss}</textarea>
  <br>
  <button onclick="applyChanges()">Apply Changes</button>
  <script>
    const vscode = acquireVsCodeApi();
    function applyChanges() {
      const updatedCss = document.getElementById('cssEditor').value;
      vscode.postMessage({ command: 'applyCss', updatedCss });
    }
  </script>
</body>
</html>`;
}

// Update the style.css file with new CSS content.
async function updateCssFile(newCss: string): Promise<void> {
  const cssFiles = await vscode.workspace.findFiles('**/style.css', '**/node_modules/**', 1);
  if (cssFiles.length > 0) {
    const cssUri = cssFiles[0];
    const document = await vscode.workspace.openTextDocument(cssUri);
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(cssUri, fullRange, newCss);
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      await document.save();
      vscode.window.showInformationMessage('style.css updated successfully!');
    } else {
      vscode.window.showErrorMessage('Failed to update style.css.');
    }
  } else {
    vscode.window.showErrorMessage("Could not find style.css to update.");
  }
}

let parsedElements: ParsedHTMLElement[] = [];

export function activate(context: vscode.ExtensionContext) {
  // Command to select an element via a webview.
  let selectionCommand = vscode.commands.registerCommand('css-easyfix.selectHtmlElement', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor found!');
      return;
    }
    const document = editor.document;
    if (document.languageId !== 'html') {
      vscode.window.showErrorMessage('This command works only on HTML files.');
      return;
    }
    const text = document.getText();
    const root = parse(text, {
      lowerCaseTagName: true,
      withStartIndices: true,
      withEndIndices: true
    } as any) as ParsedHTMLElement;
    parsedElements = collectElements(root);
    const minimalElements = parsedElements.map((el, index) => elementToMinimal(el, index));
    const panel = vscode.window.createWebviewPanel(
      'cssEasyFixSelect',
      'Select HTML Element',
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    panel.webview.html = getSelectionWebviewContent(minimalElements);
    
    panel.webview.onDidReceiveMessage(async message => {
      if (message.command === 'elementSelected') {
        const idx = message.index;
        if (typeof idx === 'number' && parsedElements[idx]) {
          // Retrieve the CSS content.
          const cssContent = await getCssContent();
          // Filter rules affecting the selected element.
          const filteredCss = filterCssRulesForElement(cssContent, parsedElements[idx]);
          // Open a new webview to edit the CSS.
          const editPanel = vscode.window.createWebviewPanel(
            'cssEasyFixEdit',
            'CSS EasyFix - Edit CSS for Element',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
          );
          editPanel.webview.html = getEditWebviewContent(filteredCss);
          
          editPanel.webview.onDidReceiveMessage(async msg => {
            if (msg.command === 'applyCss') {
              await updateCssFile(msg.updatedCss);
            }
          });
          panel.dispose(); // Close the selection panel.
        } else {
          vscode.window.showErrorMessage('Invalid element selection.');
        }
      }
    });
  });
  context.subscriptions.push(selectionCommand);
}

export function deactivate() {}
