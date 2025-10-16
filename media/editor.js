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

    // Line structure: { start: {x, y}, end: {x, y}, curveControl: {x, y} | null, isArc: boolean }

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
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = CELL_SIZE;
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

    function linesToSVG() {
        if (lines.length === 0) {
            return '';
        }

        let pathData = '';

        lines.forEach(line => {
            const startX = line.start.x / CELL_SIZE;
            const startY = line.start.y / CELL_SIZE;
            const endX = line.end.x / CELL_SIZE;
            const endY = line.end.y / CELL_SIZE;

            pathData += `M ${startX} ${startY} `;

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
                pathData += `A ${radius} ${radius} 0 0 ${sweepFlag} ${endX} ${endY} `;
            } else if (line.curveControl) {
                const ctrlX = line.curveControl.x / CELL_SIZE;
                const ctrlY = line.curveControl.y / CELL_SIZE;
                pathData += `Q ${ctrlX} ${ctrlY} ${endX} ${endY} `;
            } else {
                pathData += `L ${endX} ${endY} `;
            }
        });

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID_SIZE} ${GRID_SIZE}" width="${GRID_SIZE}" height="${GRID_SIZE}">
  <path d="${pathData.trim()}" fill="none" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

        return svg;
    }

    function svgToLines(svgContent) {
        if (!svgContent || svgContent.trim() === '') {
            return [];
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(svgContent, 'image/svg+xml');
        const path = doc.querySelector('path');

        if (!path) {
            return [];
        }

        const d = path.getAttribute('d');
        if (!d) {
            return [];
        }

        const parsedLines = [];
        const commands = d.match(/[MLQA][^MLQA]*/g);

        if (!commands) {
            return [];
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
                    isArc: false
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
                    isArc: false
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
                    isArc: true
                });
                currentPoint = {
                    x: endX,
                    y: endY
                };
            }
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

            if (handle) {
                const currentTime = Date.now();
                const timeSinceLastClick = currentTime - lastLeftClickTime;

                // Check for double-click on a curve control point (not midpoint)
                if (handle.point === 'control' &&
                    timeSinceLastClick < DOUBLE_CLICK_DELAY &&
                    lastClickedCurveIndex === handle.lineIndex) {
                    // Double-click detected - remove curvature
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
                    curveControl: null
                };
            }
        }
    });

    function handleMouseMove(e) {
        const pos = getCanvasCoordinates(e);

        if (isDragging && draggedCurveIndex !== null) {
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
        if (isDragging) {
            isDragging = false;
            draggedCurveIndex = null;
            draggedCurvePoint = null;
            debouncedSave();
            // Remove document listeners
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        } else if (currentLine) {
            const dx = currentLine.end.x - currentLine.start.x;
            const dy = currentLine.end.y - currentLine.start.y;

            if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
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
