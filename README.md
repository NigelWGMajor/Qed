
<!-- Extension Icon -->
<p align="center">
	<img src="media/editor-icon.png" alt="Quick SVG Editor Icon" width="64" height="64">
</p>

# Quick SVG Editor

A simple VS Code extension for editing SVG files with a grid-based interface.

## Features

- Draw and edit SVGs on a grid
- Line, curve, and arc tools
- Context menu for color, thickness, and delete
- Export as SVG or PNG (choose resolution)
- Undo last action
- Zoom and pan
- Auto-save and live SVG preview

## Getting Started

1. Open or create an `.svg` file in VS Code
2. Right-click and select "Reopen Editor With..." → "Quick SVG Editor"
3. Or open from the icon in the top-right corner of the svg viewer
4. Use the grid canvas to draw and edit
5. Right-click lines for more options
6. Use the context menu to export as SVG or PNG

- Draw:      Drag
- Move:      Shift-drag
- Copy:      Ctrl-drag
- Move Ends: Alt-drag
- Undo:      Ctrl-z
- Bezier:    Drag Dot
- Arc:       Ctrl-drag Dot
- Reset:     Double-click Dot
- Zoom:      Wheel (Press To Pan)
- Save:      sCtrl-s

More in the context menu ...
Note that constructiion lines do not save to png or svg

## Development

Install dependencies and build:

```bash
npm install
npm run compile
```

Watch for changes:

```bash
npm run watch
```

## Packaging

To create a VSIX package for distribution or installation:

```bash
npm install -g vsce
vsce package
```

This will generate a `.vsix` file in your project folder.

## License

MIT
