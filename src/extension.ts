import * as vscode from 'vscode';
import { SvgEditorProvider } from './svgEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        SvgEditorProvider.register(context)
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
