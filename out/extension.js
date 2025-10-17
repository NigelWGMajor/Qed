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
const svgEditorProvider_1 = require("./svgEditorProvider");
function activate(context) {
    context.subscriptions.push(svgEditorProvider_1.SvgEditorProvider.register(context));
    // Register command to open SVG files with the grid editor
    context.subscriptions.push(vscode.commands.registerCommand('svgGridEditor.openEditor', async (uri) => {
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
    }));
    // Register command to load SVG as reference layer in active editor
    context.subscriptions.push(vscode.commands.registerCommand('svgGridEditor.loadAsReference', async (uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('No SVG file selected');
            return;
        }
        // Get the provider instance
        const provider = svgEditorProvider_1.SvgEditorProvider.getInstance();
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
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map