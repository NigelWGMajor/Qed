import * as vscode from 'vscode';

export class SvgEditorProvider implements vscode.CustomTextEditorProvider {
    private static instance: SvgEditorProvider;
    private activePanel?: vscode.WebviewPanel;

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new SvgEditorProvider(context);
        SvgEditorProvider.instance = provider;
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            SvgEditorProvider.viewType,
            provider
        );
        return providerRegistration;
    }

    public static getInstance(): SvgEditorProvider | undefined {
        return SvgEditorProvider.instance;
    }

    private static readonly viewType = 'svgGridEditor.editor';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public postMessageToActiveEditor(message: any) {
        if (this.activePanel) {
            this.activePanel.webview.postMessage(message);
        }
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Track this as the active panel
        this.activePanel = webviewPanel;

        webviewPanel.webview.options = {
            enableScripts: true,
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        let isUpdatingFromWebview = false;

        // Storage keys for reference layer, crosshair state, background color, and suppress flag (per document)
        const referenceLayerKey = `referenceLayer:${document.uri.toString()}`;
        const crosshairKey = `crosshair:${document.uri.toString()}`;
        const backgroundColorKey = `backgroundColor:${document.uri.toString()}`;
        const suppressReferenceLayerKey = `suppressReferenceLayer:${document.uri.toString()}`;
        const context = this.context;

        function updateWebview() {
            // Load reference layer, crosshair state, background color, and suppress flag from storage
            const referenceLayer = context.workspaceState.get(referenceLayerKey, []);
            const showCrosshair = context.workspaceState.get(crosshairKey, false);
            const backgroundColor = context.workspaceState.get(backgroundColorKey, undefined);
            const suppressReferenceLayer = context.workspaceState.get(suppressReferenceLayerKey, false);

            webviewPanel.webview.postMessage({
                type: 'update',
                content: document.getText(),
                referenceLayer: referenceLayer,
                showCrosshair: showCrosshair,
                backgroundColor: backgroundColor,
                suppressReferenceLayer: suppressReferenceLayer,
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
                case 'saveAsPng': {
                    // e.pngDataUrl: PNG data URL from webview
                    const pngDataUrl = e.pngDataUrl;
                    const uri = await vscode.window.showSaveDialog({
                        filters: { png: ['png'] },
                        saveLabel: 'Save PNG'
                    });
                    if (!uri) { return; }
                    try {
                        // Decode base64 PNG data
                        const base64 = pngDataUrl.replace(/^data:image\/png;base64,/, '');
                        const buffer = Buffer.from(base64, 'base64');
                        await vscode.workspace.fs.writeFile(uri, buffer);
                        vscode.window.showInformationMessage(`PNG saved to ${uri.fsPath}`);
                    } catch (err) {
                        const msg = (err && typeof err === 'object' && 'message' in err) ? (err as Error).message : String(err);
                        vscode.window.showErrorMessage('Failed to export PNG: ' + msg);
                    }
                    return;
                }
                case 'saveAsSvg': {
                    // e.svg: SVG string
                    const svgContent = e.svg;
                    const uri = await vscode.window.showSaveDialog({
                        filters: { svg: ['svg'] },
                        saveLabel: 'Save SVG'
                    });
                    if (!uri) { return; }
                    try {
                        await vscode.workspace.fs.writeFile(uri, Buffer.from(svgContent, 'utf8'));
                        vscode.window.showInformationMessage(`SVG saved to ${uri.fsPath}`);
                    } catch (err) {
                        const msg = (err && typeof err === 'object' && 'message' in err) ? (err as Error).message : String(err);
                        vscode.window.showErrorMessage('Failed to export SVG: ' + msg);
                    }
                    return;
                }
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
                case 'saveReferenceLayer':
                    // Save reference layer to workspace state
                    await context.workspaceState.update(referenceLayerKey, e.referenceLayer);
                    return;
                case 'clearReferenceLayer':
                    // Clear reference layer from workspace state
                    await context.workspaceState.update(referenceLayerKey, []);
                    return;
                case 'saveCrosshairState':
                    // Save crosshair state to workspace state
                    await context.workspaceState.update(crosshairKey, e.showCrosshair);
                    return;
                case 'saveBackgroundColor':
                    // Save background color to workspace state
                    await context.workspaceState.update(backgroundColorKey, e.backgroundColor);
                    return;
                case 'saveSuppressReferenceLayer':
                    // Save suppress reference layer flag to workspace state
                    await context.workspaceState.update(suppressReferenceLayerKey, e.suppressReferenceLayer);
                    return;
                case 'createUntitledFromLines':
                    // Create a new untitled document with just the drawn lines (no reference layer)
                    const newDocument = await vscode.workspace.openTextDocument({
                        content: e.content,
                        language: 'svg'
                    });
                    await vscode.window.showTextDocument(newDocument, { preview: false });
                    return;
                case 'createUntitledFromLinesAndClose':
                    // Create a new untitled document with the drawn lines and close the original
                    const untitledDoc = await vscode.workspace.openTextDocument({
                        content: e.content,
                        language: 'svg'
                    });
                    // Open the new untitled document with our custom editor
                    await vscode.commands.executeCommand('vscode.openWith', untitledDoc.uri, 'svgGridEditor.editor');
                    // Close the original reference file editor (this webview panel)
                    webviewPanel.dispose();
                    return;
                case 'loadReferenceFile':
                    // Open file picker for user to select SVG file
                    const fileUri = await vscode.window.showOpenDialog({
                        canSelectMany: false,
                        filters: {
                            svgFiles: ['svg']
                        },
                        openLabel: 'Load as Reference Layer'
                    });
                    if (fileUri && fileUri[0]) {
                        // Read the file content
                        const fileContent = await vscode.workspace.fs.readFile(fileUri[0]);
                        const svgContent = Buffer.from(fileContent).toString('utf8');
                        // Send content to webview
                        webviewPanel.webview.postMessage({
                            type: 'loadReferenceContent',
                            content: svgContent
                        });
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
        <div id="coordinate-display"></div>
    </div>
    <!-- Save as PNG and SVG options will be in the context menu -->
    <div id="context-menu" class="context-menu" style="display: none;">
        <div class="context-menu-item" data-action="delete" id="delete-option">Delete</div>
        <div class="context-menu-item" data-action="straighten" id="straighten-option" style="display: none;">Straighten</div>
        <div class="context-menu-item" data-action="toggle-construction" id="toggle-construction-option" style="display: none;">Mark as Construction Line</div>
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
        <div class="context-menu-separator" id="separator-reference"></div>
        <div class="context-menu-section-title" id="reference-title">Reference Layer</div>
        <div class="context-menu-item" data-action="load-reference" id="load-reference-option">Load Reference Layer...</div>
        <div class="context-menu-item" data-action="toggle-reference" id="toggle-reference-option">Hide Reference Layer</div>
        <div class="context-menu-item" data-action="merge-reference" id="merge-reference-option">Merge Reference to Lines</div>
        <div class="context-menu-item" data-action="clear-reference" id="clear-reference-option">Clear Reference Layer</div>
        <div class="context-menu-separator"></div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" style="display: flex; align-items: center; gap: 8px; padding: 6px 16px;">
        <span data-action="save-as-png" id="save-as-png-option" style="cursor:pointer;">Save as PNG</span>
        <input type="number" id="png-resolution-input" min="1" value="128" style="width: 64px; font-size: 13px; border-radius: 4px; border: 1px solid #555; padding: 2px 6px; margin-left: 8px;" title="Resolution (px)">
        <span style="font-size: 12px; color: #888;">px</span>
    </div>
    <div class="context-menu-item" data-action="save-as-svg" id="save-as-svg-option">Save as SVG...</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" data-action="toggle-crosshair" id="toggle-crosshair-option">Show Crosshair</div>
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
