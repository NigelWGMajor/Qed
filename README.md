# SVG Grid Editor

A VSCode extension for creating and editing SVG files with a grid-based drawing interface.

## Features

- **32x32 Grid Canvas**: Draw on a precise grid background with snap-to-grid functionality
- **Line Drawing**: Create straight lines by clicking and dragging between grid points
- **Bezier Curves**: Convert lines to smooth quadratic curves by dragging the midpoint
- **Circular Arcs**: Hold Ctrl while dragging to create perfect circular arcs
- **Auto-save**: Changes are automatically saved to the SVG file
- **Real-time Preview**: See the generated SVG code below the canvas

## How to Use

### Installation

1. Open this folder in VSCode
2. Press `F5` to launch the extension in a new Extension Development Host window
3. In the new window, create a new file with a `.svg` extension or open an existing SVG file
4. Right-click the file and select "Reopen Editor With..." → "SVG Grid Editor"

### Drawing Lines

1. Click and hold at a starting point on the grid
2. Drag to the end point
3. Release to create the line
4. Lines snap to grid intersections automatically

### Creating Curves

#### Bezier Curves (Quadratic)
1. After creating a line, you'll see a green dot at its midpoint
2. Click and drag the green dot to create a smooth bezier curve
3. The dot turns blue once the curve is active
4. You can continue adjusting the curve by dragging the blue control point

#### Circular Arcs
1. After creating a line, click the green midpoint dot
2. **Hold down the Ctrl key** while dragging
3. The dot turns orange, indicating arc mode
4. Drag to position where you want the arc to pass through (the center of the arc)
5. Release to create a perfect circular arc
6. You can toggle between arc and bezier mode by holding/releasing Ctrl while dragging

### Visual Indicators

- **Green dot**: Midpoint of a straight line - drag to start curving
- **Blue dot**: Bezier curve control point - drag to adjust the curve
- **Orange dot**: Circular arc control point - the line shows the radius from the arc center

### Saving

- The SVG file is automatically saved as you draw (with 300ms debouncing)
- The SVG code is visible in the preview panel below the canvas
- You can close and reopen the file - your drawing will be preserved

## Technical Details

- **Grid Size**: 32x32 units
- **Line Thickness**: 1 grid unit
- **Canvas Size**: 512x512 pixels (16 pixels per grid unit)
- **SVG Output**: Standard SVG format with path elements using M (move), L (line), Q (quadratic curve), and A (arc) commands

## Project Structure

```
.
├── src/
│   ├── extension.ts           # Extension entry point
│   └── svgEditorProvider.ts   # Custom editor provider
├── media/
│   ├── editor.js              # Webview drawing logic
│   └── editor.css             # Webview styles
├── out/                       # Compiled JavaScript
├── package.json               # Extension manifest
└── tsconfig.json              # TypeScript configuration
```

## Development

### Build

```bash
npm install
npm run compile
```

### Watch Mode

```bash
npm run watch
```

This will automatically recompile when you make changes to TypeScript files.

## Future Enhancements

Potential features to add:

- Color picker for line colors
- Multiple line thicknesses
- Undo/redo functionality
- Delete lines
- Move/transform lines
- Fill shapes
- Export to different formats
- Grid size configuration
- Multiple layers
