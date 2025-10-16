(function() {
    const vscode = acquireVsCodeApi();

    const canvas = document.getElementById('grid-canvas');
    const ctx = canvas.getContext('2d');
    const svgPreview = document.getElementById('svg-preview');

    // Grid configuration
    const GRID_SIZE = 32;
    const CELL_SIZE = 16; // pixels per grid unit
    const CANVAS_SIZE = GRID_SIZE * CELL_SIZE;

    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;

    // Drawing state
    let lines = [];
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

    // Undo state
    let undoState = null;

    // Context menu state
    let contextMenuLineIndex = null;
    const contextMenu = document.getElementById('context-menu');

    // Default drawing properties
    let defaultThickness = 1;
    let defaultColor = '#808080'; // Mid grey

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

    function saveUndoState() {
        undoState = JSON.parse(JSON.stringify(lines));
    }

    function performUndo() {
        if (undoState !== null) {
            lines = JSON.parse(JSON.stringify(undoState));
            undoState = null;
            redraw();
            debouncedSave();
        }
    }

    function drawGrid() {
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 0.5;

        for (let i = 0; i <= GRID_SIZE; i++) {
            const pos = i * CELL_SIZE;

            // Vertical lines
            ctx.beginPath();
            ctx.moveTo(pos, 0);
            ctx.lineTo(pos, CANVAS_SIZE);
            ctx.stroke();

            // Horizontal lines
            ctx.beginPath();
            ctx.moveTo(0, pos);
            ctx.lineTo(CANVAS_SIZE, pos);
            ctx.stroke();
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
        ctx.strokeStyle = line.color || '#000000';
        ctx.lineWidth = (line.thickness || 1) * CELL_SIZE;
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
    }

    function drawCurveHandle(line, index) {
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

        // Clear the entire canvas
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        // Apply zoom and pan transformations
        ctx.translate(panX, panY);
        ctx.scale(zoom, zoom);

        drawGrid();

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
            const startX = line.start.x / CELL_SIZE;
            const startY = line.start.y / CELL_SIZE;
            const endX = line.end.x / CELL_SIZE;
            const endY = line.end.y / CELL_SIZE;
            const thickness = line.thickness || 1;
            const color = line.color || '#000000';

            let pathData = `M ${startX} ${startY} `;

            if (line.curveControl && line.isArc) {
                // Calculate SVG arc parameters
                const center = calculateArcCenter(line.start, line.end, line.curveControl);
                const radius = Math.sqrt(
                    Math.pow(line.start.x - center.x, 2) +
                    Math.pow(line.start.y - center.y, 2)
                ) / CELL_SIZE;

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
            } else if (line.curveControl) {
                const ctrlX = line.curveControl.x / CELL_SIZE;
                const ctrlY = line.curveControl.y / CELL_SIZE;
                pathData += `Q ${ctrlX} ${ctrlY} ${endX} ${endY}`;
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

            const stroke = path.getAttribute('stroke') || '#000000';
            const strokeWidth = parseFloat(path.getAttribute('stroke-width') || '1');

            const commands = d.match(/[MLQA][^MLQA]*/g);

            if (!commands) {
                return;
            }

            let currentPoint = null;

            commands.forEach(cmd => {
            const type = cmd[0];
            const coords = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat);

            if (type === 'M') {
                currentPoint = {
                    x: coords[0] * CELL_SIZE,
                    y: coords[1] * CELL_SIZE
                };
            } else if (type === 'L' && currentPoint) {
                parsedLines.push({
                    start: { ...currentPoint },
                    end: {
                        x: coords[0] * CELL_SIZE,
                        y: coords[1] * CELL_SIZE
                    },
                    curveControl: null,
                    isArc: false,
                    thickness: strokeWidth,
                    color: stroke
                });
                currentPoint = {
                    x: coords[0] * CELL_SIZE,
                    y: coords[1] * CELL_SIZE
                };
            } else if (type === 'Q' && currentPoint) {
                parsedLines.push({
                    start: { ...currentPoint },
                    end: {
                        x: coords[2] * CELL_SIZE,
                        y: coords[3] * CELL_SIZE
                    },
                    curveControl: {
                        x: coords[0] * CELL_SIZE,
                        y: coords[1] * CELL_SIZE
                    },
                    isArc: false,
                    thickness: strokeWidth,
                    color: stroke
                });
                currentPoint = {
                    x: coords[2] * CELL_SIZE,
                    y: coords[3] * CELL_SIZE
                };
            } else if (type === 'A' && currentPoint) {
                // Arc command: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
                const rx = coords[0] * CELL_SIZE;
                const ry = coords[1] * CELL_SIZE;
                const sweepFlag = coords[4];
                const endX = coords[5] * CELL_SIZE;
                const endY = coords[6] * CELL_SIZE;

                // Calculate a point on the arc to use as control point
                // Use the midpoint of the arc
                const startX = currentPoint.x;
                const startY = currentPoint.y;

                // Calculate center of the circle
                const dx = (endX - startX) / 2;
                const dy = (endY - startY) / 2;
                const midX = startX + dx;
                const midY = startY + dy;

                const distToMid = Math.sqrt(dx * dx + dy * dy);
                const h = Math.sqrt(Math.max(0, rx * rx - distToMid * distToMid));

                // Perpendicular direction
                let cx, cy;
                if (sweepFlag === 1) {
                    cx = midX - h * dy / distToMid;
                    cy = midY + h * dx / distToMid;
                } else {
                    cx = midX + h * dy / distToMid;
                    cy = midY - h * dx / distToMid;
                }

                // Find a point on the arc (perpendicular to start-end line, on the arc)
                const angle = Math.atan2(startY - cy, startX - cx) +
                              (sweepFlag === 1 ? -Math.PI / 2 : Math.PI / 2);
                const arcPointX = cx + rx * Math.cos(angle);
                const arcPointY = cy + ry * Math.sin(angle);

                parsedLines.push({
                    start: { ...currentPoint },
                    end: {
                        x: endX,
                        y: endY
                    },
                    curveControl: {
                        x: arcPointX,
                        y: arcPointY
                    },
                    isArc: true,
                    thickness: strokeWidth,
                    color: stroke
                });
                currentPoint = {
                    x: endX,
                    y: endY
                };
            }
            });
        });

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

                vscode.postMessage({
                    type: 'save',
                    content: svg
                });
            }
            saveTimeout = null;
        }, 300);
    }

    function updateSVGPreview() {
        const svg = linesToSVG();
        svgPreview.textContent = svg;
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
                line.start.x = originalLineState.start.x + dx;
                line.start.y = originalLineState.start.y + dy;
                line.end.x = originalLineState.end.x + dx;
                line.end.y = originalLineState.end.y + dy;

                if (line.curveControl) {
                    line.curveControl.x = originalLineState.curveControl.x + dx;
                    line.curveControl.y = originalLineState.curveControl.y + dy;
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
        const separator1 = document.getElementById('separator-1');
        const defaultsTitle = document.getElementById('defaults-title');
        const thicknessValue = document.getElementById('thickness-value');

        if (lineIndex === null) {
            // Right-clicked on blank canvas - show defaults menu
            deleteOption.style.display = 'none';
            straightenOption.style.display = 'none';
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

    // Track mouse position for Alt key
    let lastMousePos = { x: 0, y: 0 };
    canvas.addEventListener('mousemove', (e) => {
        lastMousePos = getCanvasCoordinates(e);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
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

    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.type) {
            case 'update':
                // Prevent circular updates while loading
                isLoadingFromFile = true;
                lines = svgToLines(message.content);
                redraw();
                updateSVGPreview();
                // Reset flag after a delay
                setTimeout(() => {
                    isLoadingFromFile = false;
                }, 100);
                break;
        }
    });

    // Initial draw
    redraw();
})();
