# SVG Grid Editor

A VSCode extension for creating and editing SVG files with a grid-based drawing interface.

## Features

- **32x32 Grid Canvas**: Draw on a precise grid background with snap-to-grid functionality
- **Line Drawing**: Create straight lines by clicking and dragging between grid points
- **Move/Copy**: Shift+drag to move lines, Ctrl+drag to copy them
- **Delete/Edit**: Right-click context menu for delete, thickness, and color options
- **Undo**: Ctrl+Z to undo the last action
- **Bezier Curves**: Convert lines to smooth quadratic curves by dragging the midpoint
- **Circular Arcs**: Hold Ctrl while dragging to create perfect circular arcs
- **Zoom**: Mouse wheel to zoom in/out (0.1x to 10x)
- **Pan**: Middle mouse button to pan the view
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

### Moving and Copying Lines

- **Move Line**: Hold **Shift** and drag a line to move it
  - Cursor changes to "move" icon
  - Entire line (including curves) moves together
  - Does not work when clicking on control dots
- **Copy Line**: Hold **Ctrl** and drag a line to duplicate it
  - Cursor changes to "copy" icon
  - Creates a duplicate that you can place anywhere
  - Does not work when clicking on control dots

### Context Menu (Right-Click)

- **Right-click on any line** to open context menu with options:
  - **Delete**: Remove the line
  - **Straighten**: Convert curved line to straight (only shown for curved lines)
  - **Thickness**: Three buttons in a row:
    - **[−]** Make thinner (÷⁴√2 ≈ 0.841×) - *menu stays open*
    - **[=]** Reset to normal (1×) - *menu stays open*
    - **[+]** Make thicker (×⁴√2 ≈ 1.189×) - *menu stays open*
  - **Color**: 12 inline color swatches:
    - Black, Brown, Red, Orange, Yellow, Green, Blue, Purple
    - Light Grey, Mid Grey, Dark Grey, White

### Undo

- **Undo Last Action**: Press **Ctrl+Z** (or **Cmd+Z** on Mac)
  - Undoes the last modifying action (draw, move, copy, curve, remove curve, delete, color, thickness)
  - Only one level of undo available

### Creating Curves

#### Bezier Curves (Quadratic)
1. After creating a line, you'll see a green dot at its midpoint
2. Click and drag the green dot to create a smooth bezier curve
3. The dot turns blue once the curve is active
4. You can continue adjusting the curve by dragging the blue control point
5. **Double-click the blue dot** to remove the curve and return to a straight line
6. **Alt+click on a bezier curve** to split it into two curves at that point

#### Circular Arcs
1. After creating a line, click the green midpoint dot
2. **Hold down the Ctrl key** while dragging
3. The dot turns orange, indicating arc mode
4. Drag to position where you want the arc to pass through (the center of the arc)
5. Release to create a perfect circular arc
6. You can toggle between arc and bezier mode by holding/releasing Ctrl while dragging
7. **Double-click the orange dot** to remove the arc and return to a straight line

### Zoom and Pan

- **Zoom In/Out**: Scroll mouse wheel up/down
  - Zoom range: 0.1x (zoomed out) to 10x (zoomed in)
  - Zoom centers on mouse cursor position
- **Pan View**: Click and drag with middle mouse button
  - Move the canvas to see different areas
  - Especially useful when zoomed in
- **Reset View**: Double-click middle mouse button
  - Resets zoom to 1.0x and pan to center

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

- Multi-level undo/redo
- Delete lines with Del key
- Custom color picker (currently has 12 standard colors)
- Move/transform lines
- Fill shapes
- Export to different formats (PNG, PDF)
- Grid size configuration
- Multiple layers
- Snap to angle for lines
- Duplicate/copy-paste shapes
- Keyboard shortcuts
