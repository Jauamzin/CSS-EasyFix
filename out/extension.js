"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const node_html_parser_1 = require("node-html-parser");
const css = __importStar(require("css"));
const select = __importStar(require("css-select"));
// Recursively collect all HTML elements from the parsed document.
function collectElements(root) {
    let elements = [];
    if (root.nodeType === 1) {
        elements.push(root);
    }
    for (const child of root.childNodes) {
        if (child.nodeType === 1) {
            elements = elements.concat(collectElements(child));
        }
    }
    return elements;
}
// Convert a parsed element to a minimal DOM for css-select.
function toCssSelectDom(el) {
    return {
        type: 'tag',
        name: el.tagName,
        attribs: {
            id: el.getAttribute('id') || '',
            class: el.getAttribute('class') || ''
        },
        children: el.childNodes
            .filter(child => child.nodeType === 1)
            .map(child => toCssSelectDom(child))
    };
}
// Helper: Get all local CSS file URIs by looking at <link rel="stylesheet"> tags.
function getAllCssFileUris(document) {
    const text = document.getText();
    const root = (0, node_html_parser_1.parse)(text);
    const links = root.querySelectorAll('link[rel="stylesheet"]');
    const uris = [];
    for (const link of links) {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('http')) {
            const docDir = path.dirname(document.uri.fsPath);
            const cssPath = path.join(docDir, href);
            uris.push(vscode.Uri.file(cssPath));
        }
    }
    return uris;
}
// Reads and concatenates the content of all local CSS files referenced in the HTML.
async function getCombinedCssContent(document) {
    let cssUris = getAllCssFileUris(document);
    if (cssUris.length === 0) {
        // Fallback: search for style.css in the workspace.
        const cssFiles = await vscode.workspace.findFiles('**/style.css', '**/node_modules/**', 1);
        if (cssFiles.length > 0) {
            cssUris.push(cssFiles[0]);
        }
    }
    let combined = '';
    for (const uri of cssUris) {
        try {
            const fileData = await vscode.workspace.fs.readFile(uri);
            combined += Buffer.from(fileData).toString('utf8') + "\n";
        }
        catch (e) {
            console.error('Error reading CSS file:', e);
        }
    }
    return combined || '/* No stylesheet found */';
}
async function getCssContent(document) {
    return getCombinedCssContent(document);
}
// Filter CSS rules from the CSS content that match the target HTML element.
function filterCssRulesForElement(cssContent, target) {
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
            }
            catch (e) {
                console.error("Error matching selector:", selector, e);
                return false;
            }
        });
    });
    const filteredStylesheet = {
        type: "stylesheet",
        stylesheet: { rules: matchingRules }
    };
    return css.stringify(filteredStylesheet);
}
// Create a dark-themed webview content for editing CSS rules.
function getEditWebviewContent(editableCss) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CSS EasyFix - Edit CSS</title>
  <style>
    body {
      font-family: "Segoe UI", sans-serif;
      background-color: #1e1e1e;
      color: #d4d4d4;
      margin: 0;
      padding: 20px;
    }
    h1 {
      color: #569cd6;
      margin-bottom: 10px;
    }
    p {
      margin-bottom: 20px;
    }
    textarea {
      width: 100%;
      height: 60vh;
      padding: 10px;
      font-family: Consolas, monospace;
      font-size: 14px;
      border: 1px solid #333;
      border-radius: 4px;
      box-shadow: inset 0 1px 3px rgba(0,0,0,0.8);
      background-color: #252526;
      color: #d4d4d4;
      resize: vertical;
    }
    button {
      background-color: #0e639c;
      color: #fff;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      font-size: 14px;
      cursor: pointer;
      transition: background-color 0.2s ease-in-out;
    }
    button:hover {
      background-color: #1177bb;
    }
  </style>
</head>
<body>
  <h1>CSS EasyFix</h1>
  <p>Edit the CSS rules affecting the selected element below:</p>
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
// Create a dark-themed webview content for selecting an HTML element.
function getSelectionWebviewContent(elementsData) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Select HTML Element</title>
  <style>
    body {
      font-family: "Segoe UI", sans-serif;
      background-color: #1e1e1e;
      color: #d4d4d4;
      margin: 0;
      padding: 20px;
    }
    h1 {
      color: #569cd6;
      margin-bottom: 20px;
    }
    ul {
      list-style: none;
      padding: 0;
    }
    li {
      padding: 10px;
      border-bottom: 1px solid #333;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    li:hover {
      background-color: #252526;
    }
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
// Update all local CSS files by merging updated rules with existing content.
async function updateCssFiles(newCss, document) {
    const cssUris = getAllCssFileUris(document);
    if (cssUris.length === 0) {
        vscode.window.showErrorMessage('No stylesheet files found to update.');
        return;
    }
    for (const cssUri of cssUris) {
        try {
            const fileData = await vscode.workspace.fs.readFile(cssUri);
            const originalCss = Buffer.from(fileData).toString('utf8');
            const originalParsed = css.parse(originalCss);
            const newParsed = css.parse(newCss);
            if (!originalParsed.stylesheet || !newParsed.stylesheet) {
                vscode.window.showErrorMessage('Error parsing CSS in ' + cssUri.fsPath);
                continue;
            }
            const origStylesheet = originalParsed.stylesheet;
            const newStylesheet = newParsed.stylesheet;
            newStylesheet.rules.forEach(newRule => {
                if (newRule.type === 'rule') {
                    const newSelectors = Array.isArray(newRule.selectors) ? newRule.selectors : [];
                    if (newSelectors.length === 0)
                        return;
                    const existingRuleIndex = origStylesheet.rules.findIndex(rule => {
                        if (rule.type === 'rule' && Array.isArray(rule.selectors)) {
                            const existingSelectors = rule.selectors || [];
                            return existingSelectors.join(',') === newSelectors.join(',');
                        }
                        return false;
                    });
                    if (existingRuleIndex !== -1) {
                        origStylesheet.rules[existingRuleIndex] = newRule;
                    }
                    else {
                        origStylesheet.rules.push(newRule);
                    }
                }
            });
            const mergedCss = css.stringify(originalParsed);
            const cssDoc = await vscode.workspace.openTextDocument(cssUri);
            const fullRange = new vscode.Range(cssDoc.positionAt(0), cssDoc.positionAt(cssDoc.getText().length));
            const edit = new vscode.WorkspaceEdit();
            edit.replace(cssUri, fullRange, mergedCss);
            const applied = await vscode.workspace.applyEdit(edit);
            if (applied) {
                await cssDoc.save();
                vscode.window.showInformationMessage(`Stylesheet updated successfully: ${cssUri.fsPath}`);
            }
            else {
                vscode.window.showErrorMessage(`Failed to update the stylesheet: ${cssUri.fsPath}`);
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error processing stylesheet: ${cssUri.fsPath}`);
        }
    }
}
let parsedElements = [];
function activate(context) {
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
        const root = (0, node_html_parser_1.parse)(text, {
            lowerCaseTagName: true,
            withStartIndices: true,
            withEndIndices: true
        });
        parsedElements = collectElements(root);
        const minimalElements = parsedElements.map((el, index) => ({
            index,
            tagName: el.tagName,
            id: el.getAttribute('id') || '',
            class: el.getAttribute('class') || ''
        }));
        const elementsData = encodeURIComponent(JSON.stringify(minimalElements));
        const panel = vscode.window.createWebviewPanel('cssEasyFixSelect', 'Select HTML Element', vscode.ViewColumn.Beside, { enableScripts: true });
        panel.webview.html = getSelectionWebviewContent(elementsData);
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'elementSelected') {
                const idx = message.index;
                if (typeof idx === 'number' && parsedElements[idx]) {
                    const cssContent = await getCssContent(document);
                    const filteredCss = filterCssRulesForElement(cssContent, parsedElements[idx]);
                    const editPanel = vscode.window.createWebviewPanel('cssEasyFixEdit', 'CSS EasyFix - Edit CSS for Element', vscode.ViewColumn.Beside, { enableScripts: true });
                    editPanel.webview.html = getEditWebviewContent(filteredCss);
                    editPanel.webview.onDidReceiveMessage(async (msg) => {
                        if (msg.command === 'applyCss') {
                            await updateCssFiles(msg.updatedCss, document);
                        }
                    });
                    panel.dispose();
                }
                else {
                    vscode.window.showErrorMessage('Invalid element selection.');
                }
            }
        });
    });
    context.subscriptions.push(selectionCommand);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map