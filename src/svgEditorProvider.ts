import * as vscode from 'vscode';

export class SvgEditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new SvgEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            SvgEditorProvider.viewType,
            provider
        );
        return providerRegistration;
    }

    private static readonly viewType = 'svgGridEditor.editor';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
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

        // Handle panel visibility changes - reload content when panel becomes visible
        webviewPanel.onDidChangeViewState(e => {
            if (e.webviewPanel.visible) {
                // Reload the content from the document to repopulate lines array
                updateWebview();
            }
        });

        webviewPanel.webview.onDidReceiveMessage(async e => {
            switch (e.type) {
                case 'save':
                    isUpdatingFromWebview = true;
                    try {
                        await this.updateTextDocument(document, e.content);
                    } finally {
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

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.css')
        );

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
    <div id="context-menu" class="context-menu" style="display: none;">
        <div class="context-menu-item" data-action="delete" id="delete-option">Delete</div>
        <div class="context-menu-item" data-action="straighten" id="straighten-option" style="display: none;">Straighten</div>
        <div class="context-menu-separator" id="separator-1"></div>
        <div class="context-menu-section-title" id="defaults-title" style="display: none;">Defaults for New Lines</div>
        <div class="thickness-controls">
            <span class="thickness-label">Thickness:</span>
            <button class="thickness-btn" data-action="thickness-decrease" title="Thinner (÷⁴√2)">−</button>
            <button class="thickness-btn" data-action="thickness-reset" title="Reset to 1">=</button>
            <button class="thickness-btn" data-action="thickness-increase" title="Thicker (×⁴√2)">+</button>
            <span class="thickness-value" id="thickness-value"></span>
        </div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-section-title">Color</div>
        <div class="color-swatches">
            <div class="color-swatch" data-action="color" data-value="#000000" style="background: #000000;" title="Black"></div>
            <div class="color-swatch" data-action="color" data-value="#8B4513" style="background: #8B4513;" title="Brown"></div>
            <div class="color-swatch" data-action="color" data-value="#FF0000" style="background: #FF0000;" title="Red"></div>
            <div class="color-swatch" data-action="color" data-value="#FF8000" style="background: #FF8000;" title="Orange"></div>
            <div class="color-swatch" data-action="color" data-value="#FFFF00" style="background: #FFFF00;" title="Yellow"></div>
            <div class="color-swatch" data-action="color" data-value="#00FF00" style="background: #00FF00;" title="Green"></div>
            <div class="color-swatch" data-action="color" data-value="#0000FF" style="background: #0000FF;" title="Blue"></div>
            <div class="color-swatch" data-action="color" data-value="#8000FF" style="background: #8000FF;" title="Purple"></div>
            <div class="color-swatch" data-action="color" data-value="#C0C0C0" style="background: #C0C0C0;" title="Light Grey"></div>
            <div class="color-swatch" data-action="color" data-value="#808080" style="background: #808080;" title="Mid Grey"></div>
            <div class="color-swatch" data-action="color" data-value="#404040" style="background: #404040;" title="Dark Grey"></div>
            <div class="color-swatch" data-action="color" data-value="#FFFFFF" style="background: #FFFFFF; border: 1px solid #666;" title="White"></div>
        </div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="toggle-background">Toggle Background (Light/Dark)</div>
    </div>
    <div id="svg-preview"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    private updateTextDocument(document: vscode.TextDocument, content: string) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            content
        );
        return vscode.workspace.applyEdit(edit);
    }
}
