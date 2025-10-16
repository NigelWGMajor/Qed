"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const svgEditorProvider_1 = require("./svgEditorProvider");
function activate(context) {
    context.subscriptions.push(svgEditorProvider_1.SvgEditorProvider.register(context));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map