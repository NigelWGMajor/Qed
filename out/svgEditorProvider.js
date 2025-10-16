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
exports.SvgEditorProvider = void 0;
const vscode = __importStar(require("vscode"));
class SvgEditorProvider {
    static register(context) {
        const provider = new SvgEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(SvgEditorProvider.viewType, provider);
        return providerRegistration;
    }
    constructor(context) {
        this.context = context;
    }
    async resolveCustomTextEditor(document, webviewPanel, _token) {
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
        let isUpdatingFromWebview = false;
        function updateWebview() {
            webviewPanel.webview.postMessage({
                type: 'update',
                content: document.getText(),
            });
        }
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                // Only update webview if the change didn't come from the webview itself
                if (!isUpdatingFromWebview) {
                    updateWebview();
                }
            }
        });
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
        webviewPanel.webview.onDidReceiveMessage(async (e) => {
            switch (e.type) {
                case 'save':
                    isUpdatingFromWebview = true;
                    try {
                        await this.updateTextDocument(document, e.content);
                    }
                    finally {
                        // Reset flag after a small delay to ensure the change event has processed
                        setTimeout(() => {
                            isUpdatingFromWebview = false;
                        }, 100);
                    }
                    return;
            }
        });
        updateWebview();
    }
    getHtmlForWebview(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.css'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>SVG Grid Editor</title>
</head>
<body>
    <div id="canvas-container">
        <canvas id="grid-canvas"></canvas>
    </div>
    <div id="svg-preview"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
    updateTextDocument(document, content) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), content);
        return vscode.workspace.applyEdit(edit);
    }
}
exports.SvgEditorProvider = SvgEditorProvider;
SvgEditorProvider.viewType = 'svgGridEditor.editor';
//# sourceMappingURL=svgEditorProvider.js.map