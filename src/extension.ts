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
}

export function deactivate() {}
