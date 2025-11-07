// ...existing code...
window.addEventListener('DOMContentLoaded', () => {
    // ...existing code...
    const contextMenu = document.getElementById('context-menu');

    // Add Save as PNG and SVG to context menu
    contextMenu.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) { return; }
        const action = target.dataset.action;
        if (action === 'save-as-png') {
            hideContextMenu();
            const resolutionInput = document.getElementById('png-resolution-input');
            let resolution = 128;
            if (resolutionInput && !isNaN(Number(resolutionInput.value)) && Number(resolutionInput.value) > 0) {
                resolution = Number(resolutionInput.value);
            }
            const svg = linesToSVG();
            const canvas = document.createElement('canvas');
            canvas.width = resolution;
            canvas.height = resolution;
            const ctx = canvas.getContext('2d');
            const img = new window.Image();
            img.onload = function() {
                ctx.clearRect(0, 0, resolution, resolution);
                ctx.drawImage(img, 0, 0, resolution, resolution);
                const pngDataUrl = canvas.toDataURL('image/png');
                vscode.postMessage({
                    type: 'saveAsPng',
                    pngDataUrl,
                    resolution
                });
            };
            img.onerror = function() {
                alert('Failed to render SVG to PNG.');
            };
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        }
        if (action === 'save-as-svg') {
            hideContextMenu();
            const svg = linesToSVG();
            vscode.postMessage({
                type: 'saveAsSvg',
                svg
            });
        }
    });
});
    const vscode = acquireVsCodeApi();

    const canvas = document.getElementById('grid-canvas');
    const ctx = canvas.getContext('2d');
    const svgPreview = document.getElementById('svg-preview');
    const coordinateDisplay = document.getElementById('coordinate-display');

    // Grid configuration
    const GRID_SIZE = 32;
    const CELL_SIZE = 16; // pixels per grid unit
    const CANVAS_SIZE = GRID_SIZE * CELL_SIZE;

    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;

    // Drawing state
    let lines = [];  // Editable lines (saved to file)
    let referenceLayer = [];  // Imported path objects (not saved, reference only)
    let currentLine = null;
    let isDragging = false;
    let draggedCurveIndex = null;
    let draggedCurvePoint = null;
    let saveTimeout = null;
    let isLoadingFromFile = false;

    // View state for zoom and pan
    let zoom = 1.0;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let lastPanX = 0;
    let lastPanY = 0;
    let lastMiddleClickTime = 0;
    let lastLeftClickTime = 0;
    let lastClickedCurveIndex = null;
    const DOUBLE_CLICK_DELAY = 300; // milliseconds

    // Move/copy state
    let isMoving = false;
    let isCopying = false;
    let movingLineIndex = null;
    let moveStartPos = null;
    let originalLineState = null;

    // Undo state - stack of up to 10 previous states
    let undoStack = [];

    // Context menu state
    let contextMenuLineIndex = null;
    const contextMenu = document.getElementById('context-menu');

    // Default drawing properties
    let defaultThickness = 1;
    let defaultColor = '#808080'; // Mid grey

    // Detect VSCode theme (dark vs light)
    const isVSCodeDark = document.body.classList.contains('vscode-dark') ||
                         document.body.classList.contains('vscode-high-contrast');
    let backgroundColor = isVSCodeDark ? '#202020' : '#ffffff';

    // Reference layer visibility
    let isReferenceLayerVisible = true;

    // Reference layer suppression (when user explicitly clears it, don't repopulate from file)
    let suppressReferenceLayer = false;

    // Crosshair cursor lines
    let showCrosshair = false;

    // Alt key state for endpoint dragging
    let isAltPressed = false;
    let hoveredLineIndex = null;
    let isDraggingEndpoint = false;
    let draggedEndpointLineIndex = null;
    let draggedEndpointType = null; // 'start' or 'end'

    // Ctrl+click state for adding control points
    let ctrlClickStartPos = null;
    let potentialCopyLineIndex = null; // Track which line might be copied if drag continues

    // Line structure: { start: {x, y}, end: {x, y}, curveControl: {x, y} | null, isArc: boolean, thickness: number, color: string }
    // Path structure: { type: 'path', pathData: string, fill: string | null, stroke: string | null, strokeWidth: number, transform: {scaleX, scaleY, offsetX, offsetY} }

    function saveUndoState() {
        // Add current state to undo stack
        undoStack.push(JSON.parse(JSON.stringify(lines)));
        // Keep only last 10 states
        if (undoStack.length > 10) {
            undoStack.shift();
        }
    }

    function performUndo() {
        if (undoStack.length > 0) {
            lines = JSON.parse(JSON.stringify(undoStack.pop()));
            redraw();
            debouncedSave();
        }
    }

    function drawGrid() {
        // Draw dots at grid intersections
        ctx.fillStyle = backgroundColor === '#ffffff' ? '#e0e0e0' : '#404040';

        for (let i = 0; i <= GRID_SIZE; i++) {
            for (let j = 0; j <= GRID_SIZE; j++) {
                const x = i * CELL_SIZE;
                const y = j * CELL_SIZE;

                ctx.beginPath();
                ctx.arc(x, y, 1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    function snapToGrid(x, y) {
        return {
            x: Math.round(x / CELL_SIZE) * CELL_SIZE,
            y: Math.round(y / CELL_SIZE) * CELL_SIZE
        };
    }

    function getCanvasCoordinates(event) {
        const rect = canvas.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;

        // Transform screen coordinates to world coordinates
        return {
            x: (screenX - panX) / zoom,
            y: (screenY - panY) / zoom
        };
    }

    function worldToScreen(worldX, worldY) {
        return {
            x: worldX * zoom + panX,
            y: worldY * zoom + panY
        };
    }

    function drawLine(line) {
        // Handle path objects (imported filled paths)
        if (line.type === 'path') {
            drawPath(line);
            return;
        }

        // Handle regular line objects
        // Construction lines are drawn as thin blue dotted lines
        if (line.isConstructionLine) {
            ctx.strokeStyle = '#4080FF';  // Light blue
            ctx.lineWidth = 1;  // Fixed thin width
            ctx.setLineDash([4, 4]);  // Dotted pattern
        } else {
            ctx.strokeStyle = line.color || '#000000';
            ctx.lineWidth = (line.thickness || 1) * CELL_SIZE;
            ctx.setLineDash([]);  // Solid line
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (line.curveControl && line.isArc) {
            drawArc(line);
        } else {
            ctx.beginPath();
            ctx.moveTo(line.start.x, line.start.y);

            if (line.curveControl) {
                ctx.quadraticCurveTo(
                    line.curveControl.x,
                    line.curveControl.y,
                    line.end.x,
                    line.end.y
                );
            } else {
                ctx.lineTo(line.end.x, line.end.y);
            }

            ctx.stroke();
        }

        // Reset dash pattern after drawing
        ctx.setLineDash([]);
    }

    function drawPath(pathObj) {
        // Draw a preserved SVG path (from imports)

        // Apply transform if present
        if (pathObj.transform) {
            const t = pathObj.transform;
            ctx.save();
            // Apply translation first, then scale (transforms apply in reverse order for matrix multiplication)
            ctx.translate(t.offsetX * CELL_SIZE, t.offsetY * CELL_SIZE);
            ctx.scale(t.scaleX * CELL_SIZE, t.scaleY * CELL_SIZE);

            // Create path AFTER setting up transforms
            const path = new Path2D(pathObj.pathData);

            // Draw fill
            if (pathObj.fill && pathObj.fill !== 'none') {
                ctx.fillStyle = pathObj.fill;
                ctx.fill(path);
            }

            // Draw stroke
            if (pathObj.stroke && pathObj.stroke !== 'none') {
                ctx.strokeStyle = pathObj.stroke;
                ctx.lineWidth = pathObj.strokeWidth || 1;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke(path);
            }

            ctx.restore();
        } else {
            // No transform - draw path as-is
            const path = new Path2D(pathObj.pathData);

            if (pathObj.fill && pathObj.fill !== 'none') {
                ctx.fillStyle = pathObj.fill;
                ctx.fill(path);
            }

            if (pathObj.stroke && pathObj.stroke !== 'none') {
                ctx.strokeStyle = pathObj.stroke;
                ctx.lineWidth = pathObj.strokeWidth || 1;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke(path);
            }
        }
    }

    function drawCurveHandle(line, index) {
        // Don't draw handles for path objects
        if (line.type === 'path') {
            return;
        }

        if (!line.curveControl) {
            // Draw midpoint indicator
            const midX = (line.start.x + line.end.x) / 2;
            const midY = (line.start.y + line.end.y) / 2;

            ctx.fillStyle = '#4CAF50';
            ctx.beginPath();
            ctx.arc(midX, midY, 6, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Draw control point - orange for arcs, blue for bezier curves
            ctx.fillStyle = line.isArc ? '#FF9800' : '#2196F3';
            ctx.beginPath();
            ctx.arc(line.curveControl.x, line.curveControl.y, 6, 0, Math.PI * 2);
            ctx.fill();

            if (line.isArc) {
                // Draw arc center and radius indicator
                const center = calculateArcCenter(line.start, line.end, line.curveControl);
                ctx.fillStyle = '#FF9800';
                ctx.globalAlpha = 0.3;
                ctx.beginPath();
                ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1.0;

                ctx.strokeStyle = '#FF9800';
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(center.x, center.y);
                ctx.lineTo(line.curveControl.x, line.curveControl.y);
                ctx.stroke();
                ctx.setLineDash([]);
            } else {
                // Draw control lines for bezier
                ctx.strokeStyle = '#2196F3';
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(line.start.x, line.start.y);
                ctx.lineTo(line.curveControl.x, line.curveControl.y);
                ctx.lineTo(line.end.x, line.end.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }

    function redraw() {
        // Save the current transform
        ctx.save();

        // Clear and fill background
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        // Apply zoom and pan transformations
        ctx.translate(panX, panY);
        ctx.scale(zoom, zoom);

        drawGrid();

        // Draw reference layer first (as underlay) if visible
        if (isReferenceLayerVisible) {
            ctx.save();
            ctx.globalAlpha = 0.5; // All reference layer items are semi-transparent
            referenceLayer.forEach((item) => {
                if (item.type === 'path') {
                    drawPath(item);
                } else {
                    // Regular line object in reference layer
                    drawLine(item);
                }
            });
            ctx.restore();
        }

        // Draw editable lines on top
        lines.forEach((line, index) => {
            drawLine(line);
            drawCurveHandle(line, index);
        });

        if (currentLine) {
            drawLine(currentLine);
        }

        // Draw endpoint dots on top when Alt is pressed (drawn last so they're always on top)
        if (isAltPressed && hoveredLineIndex !== null && hoveredLineIndex < lines.length) {
            const line = lines[hoveredLineIndex];
            ctx.fillStyle = '#FF0000';
            ctx.beginPath();
            ctx.arc(line.start.x, line.start.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(line.end.x, line.end.y, 6, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw crosshair cursor lines if enabled (without red cross)
        if (showCrosshair && lastSnapPos) {
            const crosshairColor = backgroundColor === '#ffffff' ? '#FF0000' : '#00FF00';
            ctx.strokeStyle = crosshairColor;
            ctx.lineWidth = 1 / zoom; // Keep line width constant regardless of zoom
            ctx.setLineDash([5 / zoom, 5 / zoom]);

            // Vertical line at snap position
            ctx.beginPath();
            ctx.moveTo(lastSnapPos.x, 0);
            ctx.lineTo(lastSnapPos.x, CANVAS_SIZE);
            ctx.stroke();

            // Horizontal line at snap position
            ctx.beginPath();
            ctx.moveTo(0, lastSnapPos.y);
            ctx.lineTo(CANVAS_SIZE, lastSnapPos.y);
            ctx.stroke();

            ctx.setLineDash([]);
        }

        // Draw red cross at snap position when crosshair is disabled and not actively drawing/dragging
        if (lastSnapPos && !showCrosshair && !isDragging && !isMoving && !isCopying && !isDraggingEndpoint && !currentLine) {
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 2 / zoom; // Keep line width constant regardless of zoom
            ctx.setLineDash([]);

            const crossSize = 8 / zoom; // Size of the cross in world coordinates

            // Draw X shape
            ctx.beginPath();
            ctx.moveTo(lastSnapPos.x - crossSize, lastSnapPos.y - crossSize);
            ctx.lineTo(lastSnapPos.x + crossSize, lastSnapPos.y + crossSize);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(lastSnapPos.x + crossSize, lastSnapPos.y - crossSize);
            ctx.lineTo(lastSnapPos.x - crossSize, lastSnapPos.y + crossSize);
            ctx.stroke();

            ctx.globalAlpha = 1.0; // Reset opacity
        }

        // Restore the transform
        ctx.restore();
    }

    function isNearPoint(pos, point, threshold = 10) {
        const dx = pos.x - point.x;
        const dy = pos.y - point.y;
        return Math.sqrt(dx * dx + dy * dy) < threshold;
    }

    function calculateArcCenter(start, end, arcPoint) {
        // Given start, end, and a point on the arc, calculate the center
        // The center is equidistant from all three points

        const ax = start.x;
        const ay = start.y;
        const bx = end.x;
        const by = end.y;
        const cx = arcPoint.x;
        const cy = arcPoint.y;

        // Use perpendicular bisectors to find center
        const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));

        if (Math.abs(d) < 0.0001) {
            // Points are collinear, return midpoint
            return { x: (ax + bx) / 2, y: (ay + by) / 2 };
        }

        const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
        const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;

        return { x: ux, y: uy };
    }

    function drawArc(line) {
        // Draw a circular arc through start, arcPoint (stored in curveControl), and end
        const center = calculateArcCenter(line.start, line.end, line.curveControl);

        const radius = Math.sqrt(
            Math.pow(line.start.x - center.x, 2) +
            Math.pow(line.start.y - center.y, 2)
        );

        const startAngle = Math.atan2(line.start.y - center.y, line.start.x - center.x);
        const endAngle = Math.atan2(line.end.y - center.y, line.end.x - center.x);
        const midAngle = Math.atan2(line.curveControl.y - center.y, line.curveControl.x - center.x);

        // Determine if we should go clockwise or counterclockwise
        let counterClockwise = false;

        // Normalize angles to [0, 2π)
        const normalizeAngle = (a) => {
            while (a < 0) { a += 2 * Math.PI; }
            while (a >= 2 * Math.PI) { a -= 2 * Math.PI; }
            return a;
        };

        const sa = normalizeAngle(startAngle);
        const ma = normalizeAngle(midAngle);
        const ea = normalizeAngle(endAngle);

        // Check if midpoint is between start and end going counterclockwise
        if (sa < ea) {
            counterClockwise = (ma > sa && ma < ea);
        } else {
            counterClockwise = (ma > sa || ma < ea);
        }

        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, startAngle, endAngle, counterClockwise);
        ctx.stroke();
    }

    function findCurveHandleUnderCursor(pos) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip path objects
            if (line.type === 'path') {
                continue;
            }

            if (line.curveControl) {
                if (isNearPoint(pos, line.curveControl)) {
                    return { lineIndex: i, point: 'control' };
                }
            } else {
                const midX = (line.start.x + line.end.x) / 2;
                const midY = (line.start.y + line.end.y) / 2;

                if (isNearPoint(pos, { x: midX, y: midY })) {
                    return { lineIndex: i, point: 'midpoint' };
                }
            }
        }
        return null;
    }

    function findEndpointUnderCursor(pos) {
        // When Alt is pressed and we have a locked line, only check that line's endpoints
        if (isAltPressed && hoveredLineIndex !== null && hoveredLineIndex < lines.length) {
            const line = lines[hoveredLineIndex];
            // Skip path objects
            if (line.type === 'path') {
                return null;
            }
            if (isNearPoint(pos, line.start)) {
                return { lineIndex: hoveredLineIndex, type: 'start' };
            }
            if (isNearPoint(pos, line.end)) {
                return { lineIndex: hoveredLineIndex, type: 'end' };
            }
            return null;
        }

        // Check if cursor is near any line endpoint (when Alt is pressed)
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            // Skip path objects
            if (line.type === 'path') {
                continue;
            }
            if (isNearPoint(pos, line.start)) {
                return { lineIndex: i, type: 'start' };
            }
            if (isNearPoint(pos, line.end)) {
                return { lineIndex: i, type: 'end' };
            }
        }
        return null;
    }

    function findLineUnderCursor(pos, threshold = 15) {
        // Check lines in reverse order (top to bottom in rendering)
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];

            // Skip path objects - they are visual underlays only
            if (line.type === 'path') {
                continue;
            }

            if (line.curveControl && line.isArc) {
                // Check arc
                const center = calculateArcCenter(line.start, line.end, line.curveControl);
                const radius = Math.sqrt(
                    Math.pow(line.start.x - center.x, 2) +
                    Math.pow(line.start.y - center.y, 2)
                );
                const distToCenter = Math.sqrt(
                    Math.pow(pos.x - center.x, 2) +
                    Math.pow(pos.y - center.y, 2)
                );

                // Check if point is near the arc path
                if (Math.abs(distToCenter - radius) < threshold) {
                    return i;
                }
            } else if (line.curveControl) {
                // Check quadratic curve - sample points along curve
                for (let t = 0; t <= 1; t += 0.05) {
                    const x = (1 - t) * (1 - t) * line.start.x +
                              2 * (1 - t) * t * line.curveControl.x +
                              t * t * line.end.x;
                    const y = (1 - t) * (1 - t) * line.start.y +
                              2 * (1 - t) * t * line.curveControl.y +
                              t * t * line.end.y;

                    if (isNearPoint(pos, { x, y }, threshold)) {
                        return i;
                    }
                }
            } else {
                // Check straight line - point to line segment distance
                const dx = line.end.x - line.start.x;
                const dy = line.end.y - line.start.y;
                const lengthSq = dx * dx + dy * dy;

                if (lengthSq === 0) {
                    if (isNearPoint(pos, line.start, threshold)) {
                        return i;
                    }
                } else {
                    const t = Math.max(0, Math.min(1,
                        ((pos.x - line.start.x) * dx + (pos.y - line.start.y) * dy) / lengthSq
                    ));
                    const projX = line.start.x + t * dx;
                    const projY = line.start.y + t * dy;

                    if (isNearPoint(pos, { x: projX, y: projY }, threshold)) {
                        return i;
                    }
                }
            }
        }
        return null;
    }

    function findLineAtPositionForCurving(pos, threshold = 15) {
        // Find any line (straight or curved) at position
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];

            if (line.curveControl && !line.isArc) {
                // Check bezier curve
                for (let t = 0; t <= 1; t += 0.05) {
                    const x = (1 - t) * (1 - t) * line.start.x +
                              2 * (1 - t) * t * line.curveControl.x +
                              t * t * line.end.x;
                    const y = (1 - t) * (1 - t) * line.start.y +
                              2 * (1 - t) * t * line.curveControl.y +
                              t * t * line.end.y;

                    if (isNearPoint(pos, { x, y }, threshold)) {
                        return i;
                    }
                }
            } else if (!line.curveControl && !line.isArc) {
                // Check straight line
                const dx = line.end.x - line.start.x;
                const dy = line.end.y - line.start.y;
                const lengthSq = dx * dx + dy * dy;

                if (lengthSq === 0) {
                    if (isNearPoint(pos, line.start, threshold)) {
                        return i;
                    }
                } else {
                    const t = Math.max(0, Math.min(1,
                        ((pos.x - line.start.x) * dx + (pos.y - line.start.y) * dy) / lengthSq
                    ));
                    const projX = line.start.x + t * dx;
                    const projY = line.start.y + t * dy;

                    if (isNearPoint(pos, { x: projX, y: projY }, threshold)) {
                        return i;
                    }
                }
            }
        }
        return null;
    }

    function addControlPointToLine(lineIndex, pos) {
        const line = lines[lineIndex];

        // If it's already a curve, just move the control point
        if (line.curveControl) {
            line.curveControl = { x: pos.x, y: pos.y };
        } else {
            // Convert straight line to curve with control point at clicked position
            line.curveControl = { x: pos.x, y: pos.y };
            line.isArc = false;
        }
    }

    function linesToSVG() {
        if (lines.length === 0) {
            return '';
        }

        let pathElements = '';

        lines.forEach(line => {
            // Skip construction lines - they should not be exported
            if (line.isConstructionLine) {
                return;
            }
            // Handle path objects (filled paths from merged reference layer)
            if (line.type === 'path') {
                const fillAttr = (line.fill && line.fill !== 'none') ? ` fill="${line.fill}"` : ' fill="none"';
                const strokeAttr = (line.stroke && line.stroke !== 'none') ? ` stroke="${line.stroke}"` : '';
                const strokeWidthAttr = line.strokeWidth ? ` stroke-width="${line.strokeWidth}"` : '';

                // If path has a transform, we need to apply it in the SVG
                // The transform converts from original SVG space to our grid space
                if (line.transform) {
                    const t = line.transform;
                    // Create SVG transform: translate then scale
                    // Note: scaleX/scaleY are already in grid units (CELL_SIZE multiplied in)
                    // so we need to divide by CELL_SIZE to get back to viewBox units
                    const scaleX = t.scaleX;
                    const scaleY = t.scaleY;
                    const translateX = t.offsetX;
                    const translateY = t.offsetY;

                    const transformAttr = ` transform="translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})"`;
                    pathElements += `  <path d="${line.pathData}"${fillAttr}${strokeAttr}${strokeWidthAttr}${transformAttr}/>\n`;
                } else {
                    // No transform, export as-is
                    pathElements += `  <path d="${line.pathData}"${fillAttr}${strokeAttr}${strokeWidthAttr}/>\n`;
                }
                return;
            }

            // Handle regular line objects
            const startX = line.start.x / CELL_SIZE;
            const startY = line.start.y / CELL_SIZE;
            const endX = line.end.x / CELL_SIZE;
            const endY = line.end.y / CELL_SIZE;
            const thickness = line.thickness || 1;
            const color = line.color || '#000000';

            // Skip lines with invalid coordinates
            if (!isFinite(startX) || !isFinite(startY) || !isFinite(endX) || !isFinite(endY)) {
                return;
            }

            let pathData = `M ${startX} ${startY} `;

            if (line.curveControl && line.isArc) {
                // Calculate SVG arc parameters
                const center = calculateArcCenter(line.start, line.end, line.curveControl);
                const radius = Math.sqrt(
                    Math.pow(line.start.x - center.x, 2) +
                    Math.pow(line.start.y - center.y, 2)
                ) / CELL_SIZE;

                // Validate arc parameters
                if (!isFinite(center.x) || !isFinite(center.y) || !isFinite(radius) || radius <= 0) {
                    // Fall back to straight line if arc is invalid
                    pathData += `L ${endX} ${endY}`;
                } else {
                    // Determine sweep direction
                    const startAngle = Math.atan2(line.start.y - center.y, line.start.x - center.x);
                    const endAngle = Math.atan2(line.end.y - center.y, line.end.x - center.x);
                    const midAngle = Math.atan2(line.curveControl.y - center.y, line.curveControl.x - center.x);

                    const normalizeAngle = (a) => {
                        while (a < 0) { a += 2 * Math.PI; }
                        while (a >= 2 * Math.PI) { a -= 2 * Math.PI; }
                        return a;
                    };

                    const sa = normalizeAngle(startAngle);
                    const ma = normalizeAngle(midAngle);
                    const ea = normalizeAngle(endAngle);

                    let sweepFlag = 1;  // clockwise by default
                    if (sa < ea) {
                        sweepFlag = (ma > sa && ma < ea) ? 1 : 0;
                    } else {
                        sweepFlag = (ma > sa || ma < ea) ? 1 : 0;
                    }

                    // SVG arc: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
                    pathData += `A ${radius} ${radius} 0 0 ${sweepFlag} ${endX} ${endY}`;
                }
            } else if (line.curveControl) {
                const ctrlX = line.curveControl.x / CELL_SIZE;
                const ctrlY = line.curveControl.y / CELL_SIZE;

                // Validate control point
                if (!isFinite(ctrlX) || !isFinite(ctrlY)) {
                    // Fall back to straight line if control point is invalid
                    pathData += `L ${endX} ${endY}`;
                } else {
                    pathData += `Q ${ctrlX} ${ctrlY} ${endX} ${endY}`;
                }
            } else {
                pathData += `L ${endX} ${endY}`;
            }

            pathElements += `  <path d="${pathData}" fill="none" stroke="${color}" stroke-width="${thickness}" stroke-linecap="round" stroke-linejoin="round"/>\n`;
        });

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID_SIZE} ${GRID_SIZE}" width="${GRID_SIZE}" height="${GRID_SIZE}">
${pathElements}</svg>`;

        return svg;
    }

    function svgToLines(svgContent) {
        if (!svgContent || svgContent.trim() === '') {
            return [];
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(svgContent, 'image/svg+xml');

        // Parse viewBox for coordinate transformation
        const svgElement = doc.querySelector('svg');
        let viewBox = { x: 0, y: 0, width: GRID_SIZE, height: GRID_SIZE };
        let scaleX = 1;
        let scaleY = 1;
        let offsetX = 0;
        let offsetY = 0;

        if (svgElement && svgElement.hasAttribute('viewBox')) {
            const vb = svgElement.getAttribute('viewBox').split(/[\s,]+/).map(parseFloat);
            if (vb.length === 4 && vb.every(v => isFinite(v))) {
                viewBox = { x: vb[0], y: vb[1], width: vb[2], height: vb[3] };
                // Calculate transformation from viewBox to our canvas
                scaleX = GRID_SIZE / viewBox.width;
                scaleY = GRID_SIZE / viewBox.height;
                offsetX = -viewBox.x * scaleX;
                offsetY = -viewBox.y * scaleY;
            }
        }

        // Transform a point from SVG coordinates to canvas coordinates
        const transformPoint = (x, y) => {
            return {
                x: (x * scaleX + offsetX) * CELL_SIZE,
                y: (y * scaleY + offsetY) * CELL_SIZE
            };
        };

        // Inverse transform: from canvas coordinates back to SVG coordinates
        const inverseTransformPoint = (px, py) => {
            const gridX = px / CELL_SIZE;
            const gridY = py / CELL_SIZE;
            return {
                x: (gridX - offsetX) / scaleX,
                y: (gridY - offsetY) / scaleY
            };
        };

        const paths = doc.querySelectorAll('path');

        if (!paths || paths.length === 0) {
            return [];
        }

        const parsedLines = [];

        paths.forEach(path => {
            const d = path.getAttribute('d');
            if (!d) {
                return;
            }

            let fill = path.getAttribute('fill');
            let stroke = path.getAttribute('stroke');
            const strokeWidth = parseFloat(path.getAttribute('stroke-width') || '1');
            const transformAttr = path.getAttribute('transform');

            // Check if fill is inherited from parent SVG element
            if (!fill && svgElement) {
                fill = svgElement.getAttribute('fill');
            }

            // If path has a fill (not 'none'), preserve it as a complete path object
            // Also check for closed paths with Z command (typically filled shapes)
            const hasClosedPath = /[Zz]/.test(d);
            if ((fill && fill !== 'none') || (hasClosedPath && !stroke)) {
                // Check if this is a merged path (has transform attribute)
                // Merged paths should go to lines array, not reference layer
                if (transformAttr) {
                    // Parse transform attribute - it's in the format "translate(x y) scale(sx sy)"
                    const translateMatch = transformAttr.match(/translate\(([^)]+)\)/);
                    const scaleMatch = transformAttr.match(/scale\(([^)]+)\)/);

                    let transformObj = { scaleX, scaleY, offsetX, offsetY }; // Default to viewBox transform

                    if (translateMatch && scaleMatch) {
                        const translateParts = translateMatch[1].trim().split(/\s+/).map(parseFloat);
                        const scaleParts = scaleMatch[1].trim().split(/\s+/).map(parseFloat);

                        transformObj = {
                            scaleX: scaleParts[0],
                            scaleY: scaleParts[1] || scaleParts[0],
                            offsetX: translateParts[0],
                            offsetY: translateParts[1] || translateParts[0]
                        };
                    }

                    // This is a merged path - add it to lines array as editable
                    parsedLines.push({
                        type: 'path',
                        pathData: d,
                        fill: fill,
                        stroke: stroke,
                        strokeWidth: strokeWidth,
                        transform: transformObj
                    });
                    console.log('SVG Editor: Loaded merged path to lines array');
                    return;
                }

                // Regular filled path - add to reference layer if not suppressed
                if (!suppressReferenceLayer) {
                    referenceLayer.push({
                        type: 'path',
                        pathData: d,
                        fill: fill || '#000000',
                        stroke: stroke,
                        strokeWidth: strokeWidth,
                        transform: { scaleX, scaleY, offsetX, offsetY }
                    });
                    console.log('SVG Editor: Preserved filled path to reference layer with', d.match(/[MmZz]/g).length, 'subpaths');
                } else {
                    console.log('SVG Editor: Skipped filled path (reference layer suppressed)');
                }
                return; // Skip line-by-line parsing for filled paths
            }

            // For stroked paths without fill, parse into editable line segments
            const effectiveStroke = stroke || fill || '#000000';

            // Match all SVG path commands (both uppercase and lowercase)
            const commands = d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g);

            if (!commands) {
                console.warn('SVG Editor: No valid path commands found in path');
                return;
            }

            let currentPoint = null;
            let lastControlPoint = null; // For smooth curve commands (T/t, S/s)

            commands.forEach(cmd => {
            const type = cmd[0];
            const coordsStr = cmd.slice(1).trim();
            if (!coordsStr && type.toUpperCase() !== 'Z') {
                return; // Skip empty commands except Z
            }

            // Split coordinates - handle negative numbers that aren't space-separated
            // e.g., "0-255.5-46.5" should become ["0", "-255.5", "-46.5"]
            const coords = coordsStr ? coordsStr.match(/-?[0-9]*\.?[0-9]+/g).map(parseFloat) : [];

            // Validate coordinates - skip malformed commands
            if (coords.some(c => isNaN(c) || !isFinite(c))) {
                console.warn(`SVG Editor: Skipping malformed ${type} command with invalid coordinates`);
                return;
            }

            // Helper to convert relative coordinates to absolute
            const isRelative = type === type.toLowerCase();
            const getAbsoluteCoord = (relX, relY) => {
                if (!currentPoint) { return { x: relX, y: relY }; }
                if (!isRelative) { return { x: relX, y: relY }; }

                // For relative coordinates, convert currentPoint back to SVG space, add offset, return
                const currentSVG = inverseTransformPoint(currentPoint.x, currentPoint.y);
                return {
                    x: currentSVG.x + relX,
                    y: currentSVG.y + relY
                };
            };

            const cmdType = type.toUpperCase();

            if (cmdType === 'M') {
                // Move command
                const abs = getAbsoluteCoord(coords[0], coords[1]);
                const transformed = transformPoint(abs.x, abs.y);
                currentPoint = transformed;
                lastControlPoint = null;
            } else if (cmdType === 'L' && currentPoint) {
                // Line command
                const abs = getAbsoluteCoord(coords[0], coords[1]);
                const transformed = transformPoint(abs.x, abs.y);
                parsedLines.push({
                    start: { ...currentPoint },
                    end: transformed,
                    curveControl: null,
                    isArc: false,
                    thickness: strokeWidth,
                    color: effectiveStroke
                });
                currentPoint = transformed;
                lastControlPoint = null;
            } else if (cmdType === 'H' && currentPoint) {
                // Horizontal line
                const currentSVG = inverseTransformPoint(currentPoint.x, currentPoint.y);
                const abs = isRelative
                    ? { x: currentSVG.x + coords[0], y: currentSVG.y }
                    : { x: coords[0], y: currentSVG.y };
                const transformed = transformPoint(abs.x, abs.y);
                parsedLines.push({
                    start: { ...currentPoint },
                    end: transformed,
                    curveControl: null,
                    isArc: false,
                    thickness: strokeWidth,
                    color: effectiveStroke
                });
                currentPoint = transformed;
                lastControlPoint = null;
            } else if (cmdType === 'V' && currentPoint) {
                // Vertical line
                const currentSVG = inverseTransformPoint(currentPoint.x, currentPoint.y);
                const abs = isRelative
                    ? { x: currentSVG.x, y: currentSVG.y + coords[0] }
                    : { x: currentSVG.x, y: coords[0] };
                const transformed = transformPoint(abs.x, abs.y);
                parsedLines.push({
                    start: { ...currentPoint },
                    end: transformed,
                    curveControl: null,
                    isArc: false,
                    thickness: strokeWidth,
                    color: effectiveStroke
                });
                currentPoint = transformed;
                lastControlPoint = null;
            } else if (cmdType === 'Q' && currentPoint) {
                // Quadratic Bezier curve
                const absCtrl = getAbsoluteCoord(coords[0], coords[1]);
                const absEnd = getAbsoluteCoord(coords[2], coords[3]);
                const transformedCtrl = transformPoint(absCtrl.x, absCtrl.y);
                const transformedEnd = transformPoint(absEnd.x, absEnd.y);
                parsedLines.push({
                    start: { ...currentPoint },
                    end: transformedEnd,
                    curveControl: transformedCtrl,
                    isArc: false,
                    thickness: strokeWidth,
                    color: effectiveStroke
                });
                lastControlPoint = transformedCtrl;
                currentPoint = transformedEnd;
            } else if (cmdType === 'T' && currentPoint) {
                // Smooth quadratic Bezier (uses reflection of last control point)
                let controlPoint;
                if (lastControlPoint) {
                    // Reflect last control point across current point
                    controlPoint = {
                        x: 2 * currentPoint.x - lastControlPoint.x,
                        y: 2 * currentPoint.y - lastControlPoint.y
                    };
                } else {
                    // If no previous control point, use current point
                    controlPoint = { ...currentPoint };
                }
                const absEnd = getAbsoluteCoord(coords[0], coords[1]);
                const transformedEnd = transformPoint(absEnd.x, absEnd.y);
                parsedLines.push({
                    start: { ...currentPoint },
                    end: transformedEnd,
                    curveControl: controlPoint,
                    isArc: false,
                    thickness: strokeWidth,
                    color: effectiveStroke
                });
                lastControlPoint = controlPoint;
                currentPoint = transformedEnd;
            } else if (cmdType === 'C' && currentPoint) {
                // Cubic Bezier curve - approximate with quadratic
                // C has 3 control points: cp1, cp2, end
                // We'll use cp1 as our quadratic control point
                const absCtrl1 = getAbsoluteCoord(coords[0], coords[1]);
                const absEnd = getAbsoluteCoord(coords[4], coords[5]);
                const transformedCtrl = transformPoint(absCtrl1.x, absCtrl1.y);
                const transformedEnd = transformPoint(absEnd.x, absEnd.y);
                parsedLines.push({
                    start: { ...currentPoint },
                    end: transformedEnd,
                    curveControl: transformedCtrl,
                    isArc: false,
                    thickness: strokeWidth,
                    color: effectiveStroke
                });
                // For smooth curves, remember the second control point
                const absCtrl2 = getAbsoluteCoord(coords[2], coords[3]);
                lastControlPoint = transformPoint(absCtrl2.x, absCtrl2.y);
                currentPoint = transformedEnd;
            } else if (cmdType === 'S' && currentPoint) {
                // Smooth cubic Bezier - approximate with quadratic
                let controlPoint1;
                if (lastControlPoint) {
                    // Reflect last control point across current point
                    controlPoint1 = {
                        x: 2 * currentPoint.x - lastControlPoint.x,
                        y: 2 * currentPoint.y - lastControlPoint.y
                    };
                } else {
                    controlPoint1 = { ...currentPoint };
                }
                const absEnd = getAbsoluteCoord(coords[2], coords[3]);
                const transformedEnd = transformPoint(absEnd.x, absEnd.y);
                parsedLines.push({
                    start: { ...currentPoint },
                    end: transformedEnd,
                    curveControl: controlPoint1,
                    isArc: false,
                    thickness: strokeWidth,
                    color: effectiveStroke
                });
                const absCtrl2 = getAbsoluteCoord(coords[0], coords[1]);
                lastControlPoint = transformPoint(absCtrl2.x, absCtrl2.y);
                currentPoint = transformedEnd;
            } else if (cmdType === 'Z' && parsedLines.length > 0) {
                // Close path - find the last M command's point
                // For simplicity, we'll skip this as it would create a line back to start
                lastControlPoint = null;
            } else if (cmdType === 'A' && currentPoint) {
                // Arc command: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
                // For simplicity, convert arc to a quadratic bezier approximation
                const absEnd = getAbsoluteCoord(coords[5], coords[6]);
                const transformedEnd = transformPoint(absEnd.x, absEnd.y);

                // Use midpoint as control point for simple approximation
                const controlPoint = {
                    x: (currentPoint.x + transformedEnd.x) / 2,
                    y: (currentPoint.y + transformedEnd.y) / 2
                };

                parsedLines.push({
                    start: { ...currentPoint },
                    end: transformedEnd,
                    curveControl: controlPoint,
                    isArc: false,
                    thickness: strokeWidth,
                    color: effectiveStroke
                });
                lastControlPoint = null;
                currentPoint = transformedEnd;
            } else {
                // Unknown command - log warning
                if (currentPoint) {
                    console.warn(`SVG Editor: Unsupported command type '${type}'`);
                }
            }
            });
        });

        console.log(`SVG Editor: Parsed ${parsedLines.length} lines from ${paths.length} paths`);
        if (parsedLines.length > 0) {
            console.log('SVG Editor: First line:', parsedLines[0]);
            console.log('SVG Editor: Last line:', parsedLines[parsedLines.length - 1]);
        }

        return parsedLines;
    }

    function debouncedSave() {
        // Clear any pending save
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }

        // Schedule a new save after 300ms of inactivity
        saveTimeout = setTimeout(() => {
            if (!isLoadingFromFile) {
                const svg = linesToSVG();
                svgPreview.textContent = svg;

                // If there's a reference layer active and we have editable lines,
                // we should NOT save back to the original file to avoid overwriting the reference
                if (referenceLayer.length > 0 && lines.length > 0) {
                    // Don't save - user should manually clear reference or use "Save As"
                    console.log('SVG Editor: Skipping auto-save because reference layer is active. Clear reference layer first or use File > Save As.');
                } else {
                    vscode.postMessage({
                        type: 'save',
                        content: svg
                    });
                }
            }
            saveTimeout = null;
        }, 300);
    }

    function updateSVGPreview() {
        const svg = linesToSVG();
        svgPreview.textContent = svg;
    }

    function updateCoordinateDisplay() {
        if (!lastSnapPos) {
            coordinateDisplay.textContent = '';
            return;
        }

        // Convert canvas coordinates to grid coordinates with center at (0, 0)
        // Y polarity is reversed: positive y goes up, negative y goes down
        const centerX = GRID_SIZE / 2;
        const centerY = GRID_SIZE / 2;
        const gridX = Math.round(lastSnapPos.x / CELL_SIZE) - centerX;
        const gridY = -(Math.round(lastSnapPos.y / CELL_SIZE) - centerY);

        let displayText = `(${gridX}, ${gridY})`;

        // Add offset information for drag operations
        if ((isMoving || isCopying) && moveStartPos && movingLineIndex !== null) {
            const line = lines[movingLineIndex];
            const originalStart = originalLineState.start;

            // Calculate offset from original position
            const offsetX = Math.round(line.start.x / CELL_SIZE) - Math.round(originalStart.x / CELL_SIZE);
            const offsetY = -(Math.round(line.start.y / CELL_SIZE) - Math.round(originalStart.y / CELL_SIZE));

            if (offsetX !== 0 || offsetY !== 0) {
                const offsetSign = (val) => val >= 0 ? '+' + val : val.toString();
                displayText += ` ${offsetSign(offsetX)},${offsetSign(offsetY)}`;
            }
        } else if (isDraggingEndpoint && draggedEndpointLineIndex !== null && originalLineState) {
            // Show offset for endpoint dragging
            const line = lines[draggedEndpointLineIndex];
            const originalPoint = draggedEndpointType === 'start' ? originalLineState.start : originalLineState.end;
            const currentPoint = draggedEndpointType === 'start' ? line.start : line.end;

            const offsetX = Math.round(currentPoint.x / CELL_SIZE) - Math.round(originalPoint.x / CELL_SIZE);
            const offsetY = -(Math.round(currentPoint.y / CELL_SIZE) - Math.round(originalPoint.y / CELL_SIZE));

            if (offsetX !== 0 || offsetY !== 0) {
                const offsetSign = (val) => val >= 0 ? '+' + val : val.toString();
                displayText += ` ${offsetSign(offsetX)},${offsetSign(offsetY)}`;
            }
        } else if (currentLine && currentLine.start) {
            // Show offset when drawing a new line
            const startX = Math.round(currentLine.start.x / CELL_SIZE) - centerX;
            const startY = -(Math.round(currentLine.start.y / CELL_SIZE) - centerY);
            const offsetX = gridX - startX;
            const offsetY = gridY - startY;

            if (offsetX !== 0 || offsetY !== 0) {
                const offsetSign = (val) => val >= 0 ? '+' + val : val.toString();
                displayText += ` ${offsetSign(offsetX)},${offsetSign(offsetY)}`;
            }
        }

        coordinateDisplay.textContent = displayText;
    }

    // Event handlers
    canvas.addEventListener('mousedown', (e) => {
        // Handle middle button for panning and double-click reset
        if (e.button === 1) {
            e.preventDefault();

            const currentTime = Date.now();
            const timeSinceLastClick = currentTime - lastMiddleClickTime;

            // Check for double-click
            if (timeSinceLastClick < DOUBLE_CLICK_DELAY) {
                // Double-click detected - reset zoom and pan
                zoom = 1.0;
                panX = 0;
                panY = 0;
                redraw();
                lastMiddleClickTime = 0; // Reset to prevent triple-click
                return;
            }

            // Single click - start panning
            lastMiddleClickTime = currentTime;
            isPanning = true;
            lastPanX = e.clientX;
            lastPanY = e.clientY;
            canvas.style.cursor = 'grabbing';
            return;
        }

        // Handle left button for drawing
        if (e.button === 0) {
            const pos = getCanvasCoordinates(e);
            const handle = findCurveHandleUnderCursor(pos);

            // Check for Alt+click to drag endpoints
            if (e.altKey && !e.shiftKey && !e.ctrlKey) {
                const endpoint = findEndpointUnderCursor(pos);
                if (endpoint) {
                    saveUndoState();
                    isDraggingEndpoint = true;
                    draggedEndpointLineIndex = endpoint.lineIndex;
                    draggedEndpointType = endpoint.type;
                    // Save original state for offset calculation
                    originalLineState = JSON.parse(JSON.stringify(lines[endpoint.lineIndex]));
                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp);
                    return;
                }
            }

            // Check for Ctrl+click (for adding control points) or Ctrl+drag (for copying)
            // Store the start position and potential line to copy - distinguish click from drag later
            if (!handle && e.ctrlKey && !e.shiftKey && !e.altKey) {
                ctrlClickStartPos = { ...pos };
                potentialCopyLineIndex = findLineUnderCursor(pos);
                // If on a line, this might become a copy drag; if not, might be adding control point
                // Continue to mouseMove or mouseUp to determine which
                return;
            }

            // Check for Shift+drag (move) - but only if NOT on a control dot
            if (!handle && e.shiftKey && !e.ctrlKey) {
                const lineIndex = findLineUnderCursor(pos);
                if (lineIndex !== null) {
                    saveUndoState();
                    isMoving = true;
                    movingLineIndex = lineIndex;
                    moveStartPos = { ...pos };
                    originalLineState = JSON.parse(JSON.stringify(lines[lineIndex]));
                    canvas.style.cursor = 'move';
                    return;
                }
            }

            if (handle) {
                const currentTime = Date.now();
                const timeSinceLastClick = currentTime - lastLeftClickTime;

                // Check for double-click on a curve control point (not midpoint)
                if (handle.point === 'control' &&
                    timeSinceLastClick < DOUBLE_CLICK_DELAY &&
                    lastClickedCurveIndex === handle.lineIndex) {
                    // Double-click detected - remove curvature
                    saveUndoState();
                    const line = lines[handle.lineIndex];
                    line.curveControl = null;
                    line.isArc = false;
                    redraw();
                    debouncedSave();
                    lastLeftClickTime = 0;
                    lastClickedCurveIndex = null;
                    return;
                }

                // Single click - start dragging curve control
                saveUndoState();
                lastLeftClickTime = currentTime;
                lastClickedCurveIndex = handle.lineIndex;
                isDragging = true;
                draggedCurveIndex = handle.lineIndex;
                draggedCurvePoint = handle.point;
                // Add document-level listeners to track mouse outside canvas
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
            } else {
                // Starting a new line - reset curve click tracking
                lastLeftClickTime = 0;
                lastClickedCurveIndex = null;

                const snapped = snapToGrid(pos.x, pos.y);
                currentLine = {
                    start: snapped,
                    end: snapped,
                    curveControl: null,
                    thickness: defaultThickness,
                    color: defaultColor
                };
            }
        }
    });

    function handleMouseMove(e) {
        const pos = getCanvasCoordinates(e);

        // Check if Ctrl+drag should start copying (need at least CELL_SIZE movement)
        if (ctrlClickStartPos !== null && potentialCopyLineIndex !== null && !isCopying) {
            const dx = pos.x - ctrlClickStartPos.x;
            const dy = pos.y - ctrlClickStartPos.y;
            const distMoved = Math.sqrt(dx * dx + dy * dy);

            // Start copy operation if moved at least one grid unit
            if (distMoved >= CELL_SIZE) {
                saveUndoState();
                isCopying = true;
                movingLineIndex = potentialCopyLineIndex;
                moveStartPos = { ...ctrlClickStartPos };
                // Create a copy of the line
                const copiedLine = JSON.parse(JSON.stringify(lines[potentialCopyLineIndex]));
                lines.push(copiedLine);
                movingLineIndex = lines.length - 1;
                originalLineState = JSON.parse(JSON.stringify(copiedLine));
                canvas.style.cursor = 'copy';
                ctrlClickStartPos = null;
                potentialCopyLineIndex = null;
                redraw();
            }
        }

        if (isDraggingEndpoint && draggedEndpointLineIndex !== null) {
            const line = lines[draggedEndpointLineIndex];
            const snapped = snapToGrid(pos.x, pos.y);

            if (draggedEndpointType === 'start') {
                line.start = snapped;
            } else {
                line.end = snapped;
            }
            redraw();
        } else if (isMoving || isCopying) {
            if (movingLineIndex !== null && moveStartPos) {
                const dx = pos.x - moveStartPos.x;
                const dy = pos.y - moveStartPos.y;

                const line = lines[movingLineIndex];

                // Calculate new positions with snapping to grid
                const newStart = snapToGrid(originalLineState.start.x + dx, originalLineState.start.y + dy);
                const newEnd = snapToGrid(originalLineState.end.x + dx, originalLineState.end.y + dy);

                line.start.x = newStart.x;
                line.start.y = newStart.y;
                line.end.x = newEnd.x;
                line.end.y = newEnd.y;

                if (line.curveControl) {
                    const newControl = snapToGrid(originalLineState.curveControl.x + dx, originalLineState.curveControl.y + dy);
                    line.curveControl.x = newControl.x;
                    line.curveControl.y = newControl.y;
                }

                redraw();
            }
        } else if (isDragging && draggedCurveIndex !== null) {
            const line = lines[draggedCurveIndex];

            if (draggedCurvePoint === 'midpoint') {
                line.curveControl = { x: pos.x, y: pos.y };
                line.isArc = e.ctrlKey;  // Set arc mode based on Ctrl key
            } else if (draggedCurvePoint === 'control') {
                line.curveControl = { x: pos.x, y: pos.y };
                line.isArc = e.ctrlKey;  // Allow toggling between arc and bezier
            }

            redraw();
        } else if (currentLine) {
            const snapped = snapToGrid(pos.x, pos.y);
            currentLine.end = snapped;
            redraw();
        }
    }

    function handleMouseUp(e) {
        if (isDraggingEndpoint) {
            isDraggingEndpoint = false;
            draggedEndpointLineIndex = null;
            draggedEndpointType = null;
            originalLineState = null;
            updateCoordinateDisplay();
            debouncedSave();
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        } else if (isMoving || isCopying) {
            isMoving = false;
            isCopying = false;
            movingLineIndex = null;
            moveStartPos = null;
            originalLineState = null;
            canvas.style.cursor = 'crosshair';
            updateCoordinateDisplay();
            debouncedSave();
        } else if (isDragging) {
            isDragging = false;
            draggedCurveIndex = null;
            draggedCurvePoint = null;
            debouncedSave();
            // Remove document listeners
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        } else if (ctrlClickStartPos !== null) {
            // Check if this was a Ctrl+click (not a drag)
            const pos = getCanvasCoordinates(e);
            const dx = pos.x - ctrlClickStartPos.x;
            const dy = pos.y - ctrlClickStartPos.y;
            const distMoved = Math.sqrt(dx * dx + dy * dy);

            // If mouse didn't move at least one grid unit, treat it as a click
            if (distMoved < CELL_SIZE) {
                const lineIndex = findLineAtPositionForCurving(ctrlClickStartPos);
                if (lineIndex !== null) {
                    saveUndoState();
                    addControlPointToLine(lineIndex, ctrlClickStartPos);
                    redraw();
                    debouncedSave();
                }
            }
            ctrlClickStartPos = null;
            potentialCopyLineIndex = null;
        } else if (currentLine) {
            const dx = currentLine.end.x - currentLine.start.x;
            const dy = currentLine.end.y - currentLine.start.y;

            if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
                saveUndoState();
                lines.push(currentLine);
                debouncedSave();
            }

            currentLine = null;
            updateCoordinateDisplay();
            redraw();
        }
    }

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);

    canvas.addEventListener('mouseleave', (e) => {
        if (currentLine) {
            currentLine = null;
            redraw();
        }
    });

    // Zoom with mouse wheel
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();

        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Get world coordinates before zoom
        const worldX = (mouseX - panX) / zoom;
        const worldY = (mouseY - panY) / zoom;

        // Update zoom
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(10, zoom * zoomFactor));

        // Adjust pan to keep mouse position fixed
        panX = mouseX - worldX * newZoom;
        panY = mouseY - worldY * newZoom;

        zoom = newZoom;
        redraw();
    });

    // Pan with middle mouse button (movement handled in document listener)
    document.addEventListener('mousemove', (e) => {
        if (isPanning) {
            const dx = e.clientX - lastPanX;
            const dy = e.clientY - lastPanY;

            panX += dx;
            panY += dy;

            lastPanX = e.clientX;
            lastPanY = e.clientY;

            redraw();
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (e.button === 1 && isPanning) {
            isPanning = false;
            canvas.style.cursor = 'crosshair';
        }
    });

    // Context menu functionality
    function getThicknessDisplay(thickness) {
        const THICKNESS_MULTIPLIER = Math.pow(2, 1/4);
        const steps = Math.log(thickness) / Math.log(THICKNESS_MULTIPLIER);
        const roundedSteps = Math.round(steps);

        // At zero position (thickness = 1), show "1"
        if (roundedSteps === 0) {
            return '1';
        }

        // For non-zero, show the actual thickness rounded to 1 decimal
        return thickness.toFixed(1);
    }

    function showContextMenu(x, y, lineIndex) {
        contextMenuLineIndex = lineIndex;
        contextMenu.style.display = 'block';
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';

        const deleteOption = document.getElementById('delete-option');
        const straightenOption = document.getElementById('straighten-option');
        const toggleConstructionOption = document.getElementById('toggle-construction-option');
        const separator1 = document.getElementById('separator-1');
        const defaultsTitle = document.getElementById('defaults-title');
        const thicknessValue = document.getElementById('thickness-value');
        const loadReferenceOption = document.getElementById('load-reference-option');
        const toggleReferenceOption = document.getElementById('toggle-reference-option');
        const mergeReferenceOption = document.getElementById('merge-reference-option');
        const clearReferenceOption = document.getElementById('clear-reference-option');
        const toggleCrosshairOption = document.getElementById('toggle-crosshair-option');
        const separatorReference = document.getElementById('separator-reference');
        const referenceTitle = document.getElementById('reference-title');

        // Update dynamic text labels
        toggleReferenceOption.textContent = isReferenceLayerVisible ? 'Hide Reference Layer' : 'Show Reference Layer';
        toggleCrosshairOption.textContent = showCrosshair ? 'Hide Crosshair' : 'Show Crosshair';

        // Show/hide reference layer options based on whether we have a reference layer (regardless of suppression)
        separatorReference.style.display = 'block';
        referenceTitle.style.display = 'block';
        if (referenceLayer.length > 0) {
            loadReferenceOption.style.display = 'block'; // Always show load to allow adding more
            toggleReferenceOption.style.display = 'block';
            mergeReferenceOption.style.display = 'block';
            clearReferenceOption.style.display = 'block';
        } else {
            loadReferenceOption.style.display = 'block';
            toggleReferenceOption.style.display = 'none';
            mergeReferenceOption.style.display = 'none';
            clearReferenceOption.style.display = 'none';
        }

        if (lineIndex === null) {
            // Right-clicked on blank canvas - show defaults menu
            deleteOption.style.display = 'none';
            straightenOption.style.display = 'none';
            toggleConstructionOption.style.display = 'none';
            separator1.style.display = 'none';
            defaultsTitle.style.display = 'block';

            // Show default thickness value
            thicknessValue.textContent = `(${getThicknessDisplay(defaultThickness)})`;
        } else {
            // Right-clicked on a line - show line menu
            deleteOption.style.display = 'block';
            separator1.style.display = 'block';
            defaultsTitle.style.display = 'none';

            // Show line thickness value
            const line = lines[lineIndex];
            const lineThickness = line.thickness || 1;
            thicknessValue.textContent = `(${getThicknessDisplay(lineThickness)})`;

            // Show/hide straighten option based on whether line is curved
            if (line && line.curveControl) {
                straightenOption.style.display = 'block';
            } else {
                straightenOption.style.display = 'none';
            }

            // Show/hide construction line toggle only for straight lines
            if (line && !line.curveControl && line.type !== 'path') {
                toggleConstructionOption.style.display = 'block';
                // Update text based on current state
                toggleConstructionOption.textContent = line.isConstructionLine
                    ? 'Unmark as Construction Line'
                    : 'Mark as Construction Line';
            } else {
                toggleConstructionOption.style.display = 'none';
            }
        }
    }

    function hideContextMenu() {
        contextMenu.style.display = 'none';
        contextMenuLineIndex = null;
    }

    // Right-click handler
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const pos = getCanvasCoordinates(e);
        const lineIndex = findLineUnderCursor(pos);

        // Always show context menu - either for line or for defaults
        showContextMenu(e.clientX, e.clientY, lineIndex);
    });

    // Hide context menu on click elsewhere
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

    // Context menu actions
    contextMenu.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) {
            return;
        }

        const action = target.dataset.action;
        const value = target.dataset.value;

        const THICKNESS_MULTIPLIER = Math.pow(2, 1/4); // Fourth root of 2 ≈ 1.189
        let shouldCloseMenu = true;
        let needsSave = false;
        let shouldUpdateThicknessDisplay = false;

        if (contextMenuLineIndex === null) {
            // Operating on defaults (blank canvas)
            switch (action) {
                case 'thickness-decrease':
                    defaultThickness = defaultThickness / THICKNESS_MULTIPLIER;
                    shouldCloseMenu = false;
                    shouldUpdateThicknessDisplay = true;
                    break;

                case 'thickness-reset':
                    defaultThickness = 1;
                    shouldCloseMenu = false;
                    shouldUpdateThicknessDisplay = true;
                    break;

                case 'thickness-increase':
                    defaultThickness = defaultThickness * THICKNESS_MULTIPLIER;
                    shouldCloseMenu = false;
                    shouldUpdateThicknessDisplay = true;
                    break;

                case 'color':
                    defaultColor = value;
                    break;

                case 'toggle-background':
                    backgroundColor = backgroundColor === '#ffffff' ? '#202020' : '#ffffff';
                    // Save background color to extension storage
                    vscode.postMessage({
                        type: 'saveBackgroundColor',
                        backgroundColor: backgroundColor
                    });
                    redraw();
                    break;

                case 'load-reference':
                    // Request extension to open file picker for SVG file
                    vscode.postMessage({
                        type: 'loadReferenceFile'
                    });
                    break;

                case 'toggle-reference':
                    isReferenceLayerVisible = !isReferenceLayerVisible;
                    redraw();
                    break;

                case 'merge-reference':
                    // Convert reference layer to editable lines array
                    saveUndoState();
                    console.log('SVG Editor: Merging', referenceLayer.length, 'reference items to lines');
                    // Add all reference layer items to lines array
                    referenceLayer.forEach(item => {
                        // Add item as-is to lines (both path objects and regular lines)
                        lines.push(item);
                    });
                    // Clear reference layer
                    referenceLayer = [];
                    vscode.postMessage({
                        type: 'clearReferenceLayer'
                    });
                    redraw();
                    debouncedSave();
                    console.log('SVG Editor: Merged to', lines.length, 'total lines');
                    break;

                case 'clear-reference':
                    shouldCloseMenu = false; // Don't auto-close, we'll handle it manually
                    // Note: Can't use confirm() dialog in sandboxed webview, so we just do it
                    console.log('SVG Editor: Clearing reference layer, count before:', referenceLayer.length);

                    // If we have drawn lines, we need to create a new untitled document
                    // Otherwise we'd lose the drawing when the original file closes
                    if (lines.length > 0) {
                        // Tell extension to create new untitled document with just the lines
                        // and close the original reference file view
                        vscode.postMessage({
                            type: 'createUntitledFromLinesAndClose',
                            content: linesToSVG()
                        });
                    } else {
                        // No lines drawn, just clear the reference layer
                        referenceLayer = [];
                        suppressReferenceLayer = true;

                        vscode.postMessage({
                            type: 'clearReferenceLayer'
                        });
                        vscode.postMessage({
                            type: 'saveSuppressReferenceLayer',
                            suppressReferenceLayer: true
                        });

                        redraw();
                    }

                    console.log('SVG Editor: Reference layer cleared');
                    hideContextMenu(); // Close menu
                    break;

                case 'toggle-crosshair':
                    showCrosshair = !showCrosshair;
                    // Save crosshair state to extension storage
                    vscode.postMessage({
                        type: 'saveCrosshairState',
                        showCrosshair: showCrosshair
                    });
                    redraw();
                    break;
            }
        } else {
            // Operating on a specific line
            saveUndoState();
            const line = lines[contextMenuLineIndex];

            switch (action) {
                case 'delete':
                    lines.splice(contextMenuLineIndex, 1);
                    needsSave = true;
                    break;

                case 'straighten':
                    line.curveControl = null;
                    line.isArc = false;
                    needsSave = true;
                    break;

                case 'toggle-construction':
                    // Only allow straight lines to be construction lines
                    if (!line.curveControl) {
                        line.isConstructionLine = !line.isConstructionLine;
                        needsSave = true;
                    }
                    break;

                case 'thickness-decrease':
                    line.thickness = (line.thickness || 1) / THICKNESS_MULTIPLIER;
                    shouldCloseMenu = false;
                    shouldUpdateThicknessDisplay = true;
                    needsSave = true;
                    break;

                case 'thickness-reset':
                    line.thickness = 1;
                    shouldCloseMenu = false;
                    shouldUpdateThicknessDisplay = true;
                    needsSave = true;
                    break;

                case 'thickness-increase':
                    line.thickness = (line.thickness || 1) * THICKNESS_MULTIPLIER;
                    shouldCloseMenu = false;
                    shouldUpdateThicknessDisplay = true;
                    needsSave = true;
                    break;

                case 'color':
                    line.color = value;
                    needsSave = true;
                    break;
            }
        }

        // Update thickness display if needed
        if (shouldUpdateThicknessDisplay) {
            const thicknessValue = document.getElementById('thickness-value');
            if (contextMenuLineIndex === null) {
                thicknessValue.textContent = `(${getThicknessDisplay(defaultThickness)})`;
            } else {
                const line = lines[contextMenuLineIndex];
                const lineThickness = line.thickness || 1;
                thicknessValue.textContent = `(${getThicknessDisplay(lineThickness)})`;
            }
        }

        if (shouldCloseMenu) {
            hideContextMenu();
        }
        if (needsSave) {
            redraw();
            debouncedSave();
        }
    });

    // Track mouse position for Alt key, crosshair, and snap indicator
    let lastMousePos = { x: 0, y: 0 };
    let lastSnapPos = { x: 0, y: 0 };
    canvas.addEventListener('mousemove', (e) => {
        lastMousePos = getCanvasCoordinates(e);
        lastSnapPos = snapToGrid(lastMousePos.x, lastMousePos.y);
        // Update coordinate display
        updateCoordinateDisplay();
        // Redraw if crosshair is visible or to show snap indicator
        if (showCrosshair || (!isDragging && !isMoving && !isCopying && !isDraggingEndpoint && !currentLine)) {
            redraw();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape key to abort current line drawing
        if (e.key === 'Escape') {
            if (currentLine) {
                currentLine = null;
                redraw();
                e.preventDefault();
            }
        }

        // Track Alt key state
        if (e.key === 'Alt' && !isAltPressed) {
            isAltPressed = true;
            // Lock onto the line under the cursor when Alt is first pressed
            hoveredLineIndex = findLineUnderCursor(lastMousePos);
            redraw();
        }

        // Ctrl+Z for undo (Cmd+Z on Mac)
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            performUndo();
        }
    });

    document.addEventListener('keyup', (e) => {
        // Track Alt key release
        if (e.key === 'Alt') {
            isAltPressed = false;
            hoveredLineIndex = null;
            redraw();
        }
    });

    // Drag-and-drop support for SVG files
    canvas.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Visual feedback - change cursor
        canvas.style.cursor = 'copy';
    });

    canvas.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        canvas.style.cursor = 'crosshair';
    });

    canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        canvas.style.cursor = 'crosshair';

        // Get dropped files
        const files = e.dataTransfer.files;
        if (files.length === 0) {
            return;
        }

        const file = files[0];

        // Check if it's an SVG file
        if (!file.name.endsWith('.svg')) {
            console.warn('SVG Editor: Dropped file is not an SVG');
            return;
        }

        // Read the file content
        const reader = new FileReader();
        reader.onload = (event) => {
            const svgContent = event.target.result;
            console.log('SVG Editor: Dropped SVG file, length:', svgContent.length);

            // Send to the same handler as "Load Reference Layer"
            vscode.postMessage({
                type: 'loadReferenceContentDirect',
                content: svgContent
            });
        };
        reader.readAsText(file);
    });

    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.type) {
            case 'update':
                console.log('SVG Editor: Received update message, content length:', message.content.length);
                // Prevent circular updates while loading
                isLoadingFromFile = true;

                // Restore suppress reference layer flag
                if (message.suppressReferenceLayer !== undefined) {
                    suppressReferenceLayer = message.suppressReferenceLayer;
                    console.log('SVG Editor: Restored suppress reference layer:', suppressReferenceLayer);
                }

                // Restore crosshair state if provided
                if (message.showCrosshair !== undefined) {
                    showCrosshair = message.showCrosshair;
                    console.log('SVG Editor: Restored crosshair state:', showCrosshair);
                }

                // Restore background color if provided
                if (message.backgroundColor !== undefined) {
                    backgroundColor = message.backgroundColor;
                    console.log('SVG Editor: Restored background color:', backgroundColor);
                }

                // Clear reference layer and parse fresh from file content
                // Suppression flag is ignored on initial load - we always parse what's in the file
                referenceLayer = [];
                suppressReferenceLayer = false; // Reset suppression when loading file

                // Parse editable lines from SVG content
                // This will also populate referenceLayer with any filled paths found
                lines = svgToLines(message.content);

                // Save reference layer back to extension storage
                vscode.postMessage({
                    type: 'saveReferenceLayer',
                    referenceLayer: referenceLayer
                });
                vscode.postMessage({
                    type: 'saveSuppressReferenceLayer',
                    suppressReferenceLayer: false
                });

                console.log('SVG Editor: Parsed', lines.length, 'editable lines and', referenceLayer.length, 'reference paths');
                redraw();
                updateSVGPreview();
                // Reset flag after a delay
                setTimeout(() => {
                    isLoadingFromFile = false;
                }, 100);
                break;

            case 'redraw':
                console.log('SVG Editor: Panel became visible, redrawing canvas');
                // Force canvas to refresh its context when panel becomes visible
                canvas.width = CANVAS_SIZE;
                canvas.height = CANVAS_SIZE;
                redraw();
                break;

            case 'loadReferenceContent':
            case 'loadReferenceContentDirect':
                console.log('SVG Editor: Loading reference content, length:', message.content.length);
                // Clear suppression flag since we're intentionally loading a reference
                suppressReferenceLayer = false;
                // Clear existing reference layer
                referenceLayer = [];
                // Parse the SVG content - this returns editable lines AND populates referenceLayer with filled paths
                const parsedLines = svgToLines(message.content);

                // When explicitly loading a reference, ALL content goes to reference layer
                parsedLines.forEach(line => {
                    // All parsed content (both path objects and regular lines) go to reference layer
                    if (line.type === 'path') {
                        // Already a path object
                        referenceLayer.push(line);
                    } else {
                        // Regular line - keep as-is but add to reference layer
                        // We'll store it as a regular line object, not a path
                        referenceLayer.push(line);
                    }
                });

                // Save the reference layer
                vscode.postMessage({
                    type: 'saveReferenceLayer',
                    referenceLayer: referenceLayer
                });
                vscode.postMessage({
                    type: 'saveSuppressReferenceLayer',
                    suppressReferenceLayer: false
                });
                console.log('SVG Editor: Loaded', referenceLayer.length, 'reference paths');
                redraw();
                break;
        }
    });

    // Initial draw
    redraw();

