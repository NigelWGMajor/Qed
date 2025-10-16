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
