import * as vscode from 'vscode';
import { SvgEditorProvider } from './svgEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        SvgEditorProvider.register(context)
    );
}

export function deactivate() {}
