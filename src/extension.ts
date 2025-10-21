import * as vscode from 'vscode';
import { SvgEditorProvider } from './svgEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        SvgEditorProvider.register(context)
    );

    // Register command to save SVG as PNG
    context.subscriptions.push(
        vscode.commands.registerCommand('svgEditor.saveAsPng', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'svg') {
                vscode.window.showErrorMessage('No active SVG editor found.');
                return;
            }

            // Prompt for resolution
            const input = await vscode.window.showInputBox({
                prompt: 'Enter PNG resolution (width/height in px)',
                value: '128',
                validateInput: (val) => isNaN(Number(val)) || Number(val) <= 0 ? 'Please enter a positive number' : undefined
            });
            if (!input) return;
            const size = parseInt(input, 10);

            // Ask for save location
            const uri = await vscode.window.showSaveDialog({
                filters: { 'PNG Image': ['png'] },
                saveLabel: 'Save PNG'
            });
            if (!uri) return;

            const svgContent = editor.document.getText();
            try {
                const sharp = require('sharp');
                const pngBuffer = await sharp(Buffer.from(svgContent))
                    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .png()
                    .toBuffer();
                await vscode.workspace.fs.writeFile(uri, pngBuffer);
                vscode.window.showInformationMessage(`PNG saved to ${uri.fsPath}`);
            } catch (err) {
                const msg = (err && typeof err === 'object' && 'message' in err) ? (err as Error).message : String(err);
                vscode.window.showErrorMessage('Failed to export PNG: ' + msg);
            }
        })
    );

    // Register command to open SVG files with the grid editor
    context.subscriptions.push(
        vscode.commands.registerCommand('svgGridEditor.openEditor', async (uri?: vscode.Uri) => {
            // If no URI provided, use the active editor's document
            if (!uri && vscode.window.activeTextEditor) {
                uri = vscode.window.activeTextEditor.document.uri;
            }

            if (!uri) {
                vscode.window.showErrorMessage('No SVG file selected');
                return;
            }

            // Open the file with the custom editor
            await vscode.commands.executeCommand('vscode.openWith', uri, 'svgGridEditor.editor');
        })
    );

    // Register command to load SVG as reference layer in active editor
    context.subscriptions.push(
        vscode.commands.registerCommand('svgGridEditor.loadAsReference', async (uri?: vscode.Uri) => {
            if (!uri) {
                vscode.window.showErrorMessage('No SVG file selected');
                return;
            }

            // Get the provider instance
            const provider = SvgEditorProvider.getInstance();
            if (!provider) {
                vscode.window.showErrorMessage('SVG Grid Editor provider not found');
                return;
            }

            // Read the SVG file content
            const fileContent = await vscode.workspace.fs.readFile(uri);
            const svgContent = Buffer.from(fileContent).toString('utf8');

            // Send the content to the active webview
            provider.postMessageToActiveEditor({
                type: 'loadReferenceContentDirect',
                content: svgContent
            });
        })
    );
}



export function deactivate() {}
