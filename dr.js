// PDF.js configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Import database service
let databaseService;

// Initialize database service
(async function initDatabase() {
    try {
        // Import the database service module
        const module = await import('./database.js');
        databaseService = module.default;
        await databaseService.init();
        console.log('Database service initialized');
    } catch (error) {
        console.error('Failed to initialize database service:', error);
        // Fallback to mock service
        databaseService = {
            getProjects: async () => [],
            getProject: async () => null,
            saveProject: async (project) => ({ id: Date.now(), ...project }),
            deleteProject: async () => true,
            saveLocationPlan: async () => ({ id: 1 }),
            getLocationPlan: async () => null
        };
    }
})();

// Drawing variables
let drawingData = {
    scale: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    startX: 0,
    startY: 0,
    pdfDoc: null,
    pageNum: 1
};

let currentPhotoSlot = null;
let photoCounter = 1;
let photoPages = 1;

// Project management drawing variables
let projectDrawingData = {
    scale: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    startX: 0,
    startY: 0,
    pdfDoc: null,
    pageNum: 1
};

// Rendering locks to prevent race conditions
let renderLock = false;
let projectRenderLock = false;

// Initialize first photo page
initializePhotoPage(1);

// Worker table calculations
function updateWorkerTotals() {
    const rows = document.querySelectorAll('#workerTableBody tr');
    let builderAmTotal = 0;
    let builderPmTotal = 0;
    let servicesAmTotal = 0;
    let servicesPmTotal = 0;

    rows.forEach(row => {
        const inputs = row.querySelectorAll('input[type="number"]');
        if (inputs.length >= 4) {
            builderAmTotal += parseInt(inputs[0].value) || 0;
            builderPmTotal += parseInt(inputs[1].value) || 0;
            servicesAmTotal += parseInt(inputs[2].value) || 0;
            servicesPmTotal += parseInt(inputs[3].value) || 0;
        }
    });

    const builderAmEl = document.getElementById('builderAmTotal');
    const builderPmEl = document.getElementById('builderPmTotal');
    const servicesAmEl = document.getElementById('servicesAmTotal');
    const servicesPmEl = document.getElementById('servicesPmTotal');

    if (builderAmEl) builderAmEl.textContent = builderAmTotal;
    if (builderPmEl) builderPmEl.textContent = builderPmTotal;
    if (servicesAmEl) servicesAmEl.textContent = servicesAmTotal;
    if (servicesPmEl) servicesPmEl.textContent = servicesPmTotal;
}

// Add event listeners to worker inputs
document.getElementById('workerTableBody').addEventListener('input', updateWorkerTotals);

function deleteWorkerRow(btn) {
    const row = btn.closest('tr');
    if (row && row.parentNode) {
        row.parentNode.removeChild(row);
        updateWorkerTotals();
        checkPage1Overflow();
    }
}

function addWorkerRow() {
    const tbody = document.getElementById('workerTableBody');
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text" placeholder="" /></td>
        <td><input type="number" value="" /></td>
        <td><input type="number" value="" /></td>
        <td><input type="number" value="" /></td>
        <td><input type="number" value="" /></td>
    `;
    tbody.appendChild(row);
    checkPage1Overflow();
}

// Worker table: right-click row to show Delete button
let workerRowDeleteTarget = null;
const workerRowDeleteBtn = document.getElementById('workerRowDeleteBtn');
document.getElementById('workerTableBody').addEventListener('contextmenu', function (e) {
    const row = e.target.closest('tr');
    if (!row) return;
    e.preventDefault();
    workerRowDeleteTarget = row;
    workerRowDeleteBtn.style.display = 'block';
    workerRowDeleteBtn.style.left = e.clientX + 4 + 'px';
    workerRowDeleteBtn.style.top = e.clientY + 4 + 'px';
});
if (workerRowDeleteBtn) {
    workerRowDeleteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (workerRowDeleteTarget && workerRowDeleteTarget.parentNode) {
            workerRowDeleteTarget.parentNode.removeChild(workerRowDeleteTarget);
            updateWorkerTotals();
            checkPage1Overflow();
        }
        workerRowDeleteBtn.style.display = 'none';
        workerRowDeleteTarget = null;
    });
}
document.addEventListener('click', function () {
    workerRowDeleteBtn.style.display = 'none';
    workerRowDeleteTarget = null;
});

// A4 height in px (297mm at 96dpi) – when page1 exceeds this, move worker table to a new page
const PAGE_A4_HEIGHT_PX = Math.round(297 * 96 / 25.4);
const WORKER_TABLE_PAGE_ID = 'workerTablePage';

function checkPage1Overflow() {
    const page1 = document.getElementById('page1');
    const workerTable = document.querySelector('.worker-table');
    const container = document.getElementById('mainContainer');
    const photoPage1 = document.getElementById('photoPage1');
    if (!page1 || !workerTable || !container || !photoPage1) return;

    let extraPage = document.getElementById(WORKER_TABLE_PAGE_ID);
    const isWorkerTableInPage1 = page1.contains(workerTable);

    if (isWorkerTableInPage1 && page1.scrollHeight > PAGE_A4_HEIGHT_PX) {
        if (!extraPage) {
            extraPage = document.createElement('div');
            extraPage.className = 'page';
            extraPage.id = WORKER_TABLE_PAGE_ID;
            container.insertBefore(extraPage, photoPage1);
        }
        extraPage.appendChild(workerTable);
    } else if (extraPage && extraPage.contains(workerTable)) {
        page1.appendChild(workerTable);
        if (page1.scrollHeight > PAGE_A4_HEIGHT_PX) {
            extraPage.appendChild(workerTable);
        } else {
            extraPage.remove();
        }
    }
    updateContainerScale();
}

// Initialize drawing handlers when DOM is ready
function initDrawingHandlers() {
    const drawingUpload = document.getElementById('drawingUpload');
    const drawingFileInput = document.getElementById('drawingFileInput');
    const drawingContainer = document.getElementById('drawingContainer');
    const drawingCanvas = document.getElementById('drawingCanvas');
    const drawingContextMenu = document.getElementById('drawingContextMenu');
    const drawingMenuRotate = document.getElementById('drawingMenuRotate');
    const drawingMenuReset = document.getElementById('drawingMenuReset');
    const drawingMenuRemove = document.getElementById('drawingMenuRemove');
    
    console.log('Initializing drawing handlers...');
    console.log('drawingUpload:', drawingUpload);
    console.log('drawingContainer:', drawingContainer);
    console.log('drawingCanvas:', drawingCanvas);
    console.log('drawingContextMenu:', drawingContextMenu);
    
    if (!drawingUpload || !drawingContainer || !drawingCanvas || !drawingContextMenu) {
        console.error('Missing required drawing elements');
        return;
    }
    
    // Move context menu to body to avoid CSS transform issues
    // The context menu is position: fixed and should be relative to viewport
    // Being inside transformed containers can cause positioning issues
    document.body.appendChild(drawingContextMenu);
    
    // Flag to prevent immediate hiding after showing context menu
    let justShowedContextMenu = false;
    
    drawingUpload.addEventListener('click', () => {
        drawingFileInput.click();
    });
    
    drawingUpload.addEventListener('dragover', (e) => {
        e.preventDefault();
        drawingUpload.classList.add('dragover');
    });
    
    drawingUpload.addEventListener('dragleave', () => {
        drawingUpload.classList.remove('dragover');
    });
    
    drawingUpload.addEventListener('drop', (e) => {
        e.preventDefault();
        drawingUpload.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type === 'application/pdf') {
            loadPDF(files[0]);
        }
    });
    
    if (drawingFileInput) {
        drawingFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                loadPDF(e.target.files[0]);
            }
        });
    }
    
// Right-click context menu for location plan (when PDF is loaded)
drawingContainer.addEventListener('contextmenu', function (e) {
        if (drawingCanvas.style.display !== 'block' || !drawingData.pdfDoc) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // Set flag to prevent immediate hiding
        justShowedContextMenu = true;
        
        // Make sure context menu is in body (avoids CSS transform issues)
        if (drawingContextMenu.parentElement !== document.body) {
            document.body.appendChild(drawingContextMenu);
        }
        
        // Show the menu with clean styling (CSS handles appearance)
        drawingContextMenu.style.display = 'block';
        drawingContextMenu.style.left = e.clientX + 'px';
        drawingContextMenu.style.top = e.clientY + 'px';
        drawingContextMenu.style.zIndex = '2000';
        
        // Reset flag after a short delay to allow menu interaction
        setTimeout(() => {
            justShowedContextMenu = false;
        }, 100);
    });

    // Prevent clicks inside the context menu from closing it
    drawingContextMenu.addEventListener('mousedown', function (e) {
        e.stopPropagation();
        // If it's a right-click inside the menu, don't hide it
        if (e.button === 2) {
            e.preventDefault();
        }
    });
    
    drawingContextMenu.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    // Hide context menu when clicking anywhere else (left-click only)
    document.addEventListener('mousedown', function (e) {
        // Don't hide if we just showed the context menu
        if (justShowedContextMenu) {
            return;
        }
        
        // Only hide on left-click (button 0)
        if (e.button === 0 && drawingContextMenu.style.display === 'block' && 
            !drawingContextMenu.contains(e.target)) {
            drawingContextMenu.style.display = 'none';
        }
    });
    
    // Hide context menu when right-clicking elsewhere
    document.addEventListener('contextmenu', function (e) {
        // Don't hide if we just showed the context menu
        if (justShowedContextMenu) {
            return;
        }
        
        if (drawingContextMenu.style.display === 'block' && 
            !drawingContextMenu.contains(e.target)) {
            drawingContextMenu.style.display = 'none';
        }
    });
    
    // Also add a click handler as backup
    document.addEventListener('click', function (e) {
        // Don't hide if we just showed the context menu
        if (justShowedContextMenu) {
            return;
        }
        
        if (drawingContextMenu.style.display === 'block' && 
            !drawingContextMenu.contains(e.target)) {
            drawingContextMenu.style.display = 'none';
        }
    });
    
    if (drawingMenuRotate) {
        drawingMenuRotate.addEventListener('click', function (e) {
            e.stopPropagation();
            drawingData.rotation = (drawingData.rotation + 90) % 360;
            renderPDF();
            drawingContextMenu.style.display = 'none';
        });
    }
    
    if (drawingMenuReset) {
        drawingMenuReset.addEventListener('click', function (e) {
            e.stopPropagation();
            resetDrawing();
            drawingContextMenu.style.display = 'none';
        });
    }
    
    if (drawingMenuRemove) {
        drawingMenuRemove.addEventListener('click', function (e) {
            e.stopPropagation();
            removeDrawing();
            drawingContextMenu.style.display = 'none';
        });
    }
}

async function loadPDF(file) {
    const fileReader = new FileReader();
    fileReader.onload = async function() {
        const typedarray = new Uint8Array(this.result);
        await loadPDFFromArrayBuffer(typedarray);
    };
    fileReader.readAsArrayBuffer(file);
}

// Load PDF from array buffer or base64 string for main page location plan
async function loadPDFFromArrayBuffer(data) {
    // Handle both ArrayBuffer and base64 string input
    let arrayBuffer;
    if (data instanceof ArrayBuffer) {
        arrayBuffer = data;
    } else if (isBase64(data)) {
        // Convert base64 string to ArrayBuffer
        arrayBuffer = base64ToArrayBuffer(data);
    } else if (data instanceof Uint8Array) {
        // Already a Uint8Array
        arrayBuffer = data.buffer;
    } else {
        console.error('Unsupported data type for PDF loading:', typeof data);
        return false;
    }
    
    const typedarray = new Uint8Array(arrayBuffer);
    
    try {
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        drawingData.pdfDoc = pdf;
        renderPDF();
        drawingUpload.style.display = 'none';
        drawingCanvas.style.display = 'block';
        return true;
    } catch (error) {
        console.error('Error loading PDF:', error);
        alert('Error loading PDF file');
        return false;
    }
}



// Wheel zoom: mouse position as center; wheel down = zoom in, wheel up = zoom out
drawingContainer.addEventListener('wheel', function (e) {
    if (drawingCanvas.style.display !== 'block' || !drawingData.pdfDoc) return;
    e.preventDefault();
    const rect = drawingContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const oldScale = drawingData.scale;
    const factor = e.deltaY > 0 ? 1 / 1.06 : 1.06;
    const newScale = Math.max(0.2, Math.min(8, oldScale * factor));
    if (newScale === oldScale) return;
    drawingData.offsetX = mouseX - (mouseX - drawingData.offsetX) * newScale / oldScale;
    drawingData.offsetY = mouseY - (mouseY - drawingData.offsetY) * newScale / oldScale;
    drawingData.scale = newScale;
    renderPDF();
}, { passive: false });

// Render scale for 2K/4K: minimum 2x, or devicePixelRatio for high-DPI displays
const PDF_RENDER_DPI_SCALE = Math.max(2, window.devicePixelRatio || 1);

async function renderPDF() {
    if (!drawingData.pdfDoc || renderLock) return;
    
    renderLock = true;
    try {
        const page = await drawingData.pdfDoc.getPage(drawingData.pageNum);
        const effectiveScale = drawingData.scale * PDF_RENDER_DPI_SCALE;
        const viewport = page.getViewport({ scale: effectiveScale, rotation: drawingData.rotation });
        
        const canvas = drawingCanvas;
        const context = canvas.getContext('2d');
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // Display size in CSS pixels so canvas fits container; bitmap stays high-res for 2K/4K
        canvas.style.width = (viewport.width / PDF_RENDER_DPI_SCALE) + 'px';
        canvas.style.height = (viewport.height / PDF_RENDER_DPI_SCALE) + 'px';
        canvas.style.left = drawingData.offsetX + 'px';
        canvas.style.top = drawingData.offsetY + 'px';

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        await page.render(renderContext).promise;
    } catch (error) {
        console.error('Error rendering PDF:', error);
    } finally {
        renderLock = false;
    }
}

function zoomIn() {
    drawingData.scale *= 1.2;
    renderPDF();
}

function zoomOut() {
    drawingData.scale /= 1.2;
    renderPDF();
}

function rotateDrawing(degrees) {
    drawingData.rotation = (drawingData.rotation + degrees) % 360;
    renderPDF();
}

function resetDrawing() {
    drawingData.scale = 1;
    drawingData.rotation = 0;
    drawingData.offsetX = 0;
    drawingData.offsetY = 0;
    renderPDF();
}

function removeDrawing() {
    drawingCanvas.style.display = 'none';
    drawingUpload.style.display = 'flex';
    drawingData.pdfDoc = null;
}

// Canvas dragging
drawingCanvas.addEventListener('mousedown', (e) => {
    drawingData.isDragging = true;
    drawingData.startX = e.clientX - drawingData.offsetX;
    drawingData.startY = e.clientY - drawingData.offsetY;
});

document.addEventListener('mousemove', (e) => {
    if (drawingData.isDragging) {
        drawingData.offsetX = e.clientX - drawingData.startX;
        drawingData.offsetY = e.clientY - drawingData.startY;
        drawingCanvas.style.left = drawingData.offsetX + 'px';
        drawingCanvas.style.top = drawingData.offsetY + 'px';
    }
});

document.addEventListener('mouseup', () => {
    drawingData.isDragging = false;
});

// iPad / touch: two-finger pan (content tracks fingers), pinch = zoom only, long-press (0.5s) = right-click
let touchLongPressTimer = null;
let touchStartDistance = 0;
let touchStartScale = 1;
let lastTouchCenterX = 0;
let lastTouchCenterY = 0;

function getTouchCenter(touches) {
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
    };
}

function getTouchDistance(touches) {
    const a = touches[0].clientX - touches[1].clientX;
    const b = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(a * a + b * b);
}

function clearLongPressTimer() {
    if (touchLongPressTimer) {
        clearTimeout(touchLongPressTimer);
        touchLongPressTimer = null;
    }
}

function showContextMenuAt(clientX, clientY) {
    if (drawingCanvas.style.display !== 'block' || !drawingData.pdfDoc) return;
    drawingContextMenu.style.display = 'block';
    drawingContextMenu.style.left = clientX + 'px';
    drawingContextMenu.style.top = clientY + 'px';
}

drawingContainer.addEventListener('touchstart', function (e) {
    if (drawingCanvas.style.display !== 'block' || !drawingData.pdfDoc) return;
    if (e.touches.length === 1) {
        e.preventDefault();
        clearLongPressTimer();
        const touch = e.touches[0];
        touchLongPressTimer = setTimeout(function () {
            touchLongPressTimer = null;
            showContextMenuAt(touch.clientX, touch.clientY);
        }, 500);
    } else if (e.touches.length === 2) {
        clearLongPressTimer();
        e.preventDefault();
        const rect = drawingContainer.getBoundingClientRect();
        const center = getTouchCenter(e.touches);
        lastTouchCenterX = center.x - rect.left;
        lastTouchCenterY = center.y - rect.top;
        touchStartDistance = getTouchDistance(e.touches);
        touchStartScale = drawingData.scale;
    }
}, { passive: false });

drawingContainer.addEventListener('touchmove', function (e) {
    if (drawingCanvas.style.display !== 'block' || !drawingData.pdfDoc) return;
    if (e.touches.length === 1) {
        clearLongPressTimer();
    } else if (e.touches.length === 2) {
        e.preventDefault();
        const rect = drawingContainer.getBoundingClientRect();
        const center = getTouchCenter(e.touches);
        const centerX = center.x - rect.left;
        const centerY = center.y - rect.top;
        const dist = getTouchDistance(e.touches);

        // Pan: content tracks finger movement (add center delta to offset)
        drawingData.offsetX += (centerX - lastTouchCenterX);
        drawingData.offsetY += (centerY - lastTouchCenterY);

        // Zoom: only from pinch (distance change); zoom toward current finger center
        const newScale = Math.max(0.2, Math.min(8, touchStartScale * (dist / touchStartDistance)));
        drawingData.offsetX = centerX - (centerX - drawingData.offsetX) * newScale / drawingData.scale;
        drawingData.offsetY = centerY - (centerY - drawingData.offsetY) * newScale / drawingData.scale;
        drawingData.scale = newScale;

        lastTouchCenterX = centerX;
        lastTouchCenterY = centerY;
        renderPDF();
    }
}, { passive: false });

drawingContainer.addEventListener('touchend', function (e) {
    if (e.touches.length < 2) clearLongPressTimer();
    if (e.touches.length === 2) {
        const rect = drawingContainer.getBoundingClientRect();
        const center = getTouchCenter(e.touches);
        lastTouchCenterX = center.x - rect.left;
        lastTouchCenterY = center.y - rect.top;
        touchStartDistance = getTouchDistance(e.touches);
        touchStartScale = drawingData.scale;
    }
}, { passive: true });

drawingContainer.addEventListener('touchcancel', function (e) {
    clearLongPressTimer();
}, { passive: true });

// Photo handling
function initializePhotoPage(pageNum) {
    const grid = document.getElementById(`photoGrid${pageNum}`);
    grid.innerHTML = '';

    for (let i = 0; i < 6; i++) {
        const photoItem = document.createElement('div');
        photoItem.className = 'photo-item';
        
        const photoUpload = document.createElement('div');
        photoUpload.className = 'photo-upload';
        photoUpload.dataset.photoId = photoCounter;
        
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder-text';
        placeholder.innerHTML = '<p>📷 Drag photo here or click</p>';
        photoUpload.appendChild(placeholder);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-photo';
        removeBtn.innerHTML = '×';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removePhoto(photoUpload);
        };
        photoUpload.appendChild(removeBtn);

        const photoLabel = document.createElement('div');
        photoLabel.className = 'photo-label';
        photoLabel.textContent = `Photo (${photoCounter})`;

        photoItem.appendChild(photoUpload);
        photoItem.appendChild(photoLabel);
        grid.appendChild(photoItem);

        setupPhotoUpload(photoUpload);
        photoCounter++;
    }
}

function setupPhotoUpload(element) {
    element.addEventListener('click', () => {
        currentPhotoSlot = element;
        document.getElementById('photoFileInput').click();
    });

    element.addEventListener('dragover', (e) => {
        e.preventDefault();
        element.classList.add('dragover');
    });

    element.addEventListener('dragleave', () => {
        element.classList.remove('dragover');
    });

    element.addEventListener('drop', (e) => {
        e.preventDefault();
        element.classList.remove('dragover');
        const photoId = e.dataTransfer.getData('application/x-photo-id');
        if (photoId) {
            const item = photoStore.find((p) => p.id === photoId);
            if (item) {
                displayPhotoFromDataUrl(element, item.dataUrl);
                return;
            }
        }
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type.startsWith('image/')) {
            displayPhoto(element, files[0]);
        }
    });
}

document.getElementById('photoFileInput').addEventListener('change', (e) => {
    if (e.target.files.length > 0 && currentPhotoSlot) {
        displayPhoto(currentPhotoSlot, e.target.files[0]);
    }
    e.target.value = ''; // Reset input
});

const MAX_PHOTO_SIZE = 528;
const PHOTO_QUALITY = 0.85;

// Left panel photo library: store { id, dataUrl } for drag-to-slot
let photoStore = [];
let nextPhotoStoreId = 1;

// Quick Dispatch: double-click to send photo to next slot in order
let quickDispatchEnabled = false;
let dispatchOrder = []; // [{ photoId, slotIndex }], slotIndex 1-based

const PANEL_THUMB_MAX = 400;

function resizeImageToDataUrl(file, maxSize) {
    const limit = maxSize || MAX_PHOTO_SIZE;
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > limit || h > limit) {
                    if (w > h) {
                        h = Math.round((h * limit) / w);
                        w = limit;
                    } else {
                        w = Math.round((w * limit) / h);
                        h = limit;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
            };
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
    });
}

/** Resize an already-loaded Image element to data URL (used when we have img + EXIF in one load). */
function resizeImageElementToDataUrl(img, maxSize) {
    const limit = maxSize || MAX_PHOTO_SIZE;
    let w = img.width, h = img.height;
    if (w > limit || h > limit) {
        if (w > h) {
            h = Math.round((h * limit) / w);
            w = limit;
        } else {
            w = Math.round((w * limit) / h);
            h = limit;
        }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
}

/** Parse EXIF DateTimeOriginal "YYYY:MM:DD HH:MM:SS" to timestamp; return 0 if missing/invalid. */
function parseExifDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return 0;
    const parts = dateStr.trim().split(/\s+/);
    if (parts.length < 2) return 0;
    const iso = parts[0].replace(/:/g, '-') + 'T' + parts[1];
    const d = new Date(iso);
    return isNaN(d.getTime()) ? 0 : d.getTime();
}

function addPhotosToStore(files) {
    if (!files || !files.length) return;
    [].forEach.call(files, (file) => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const done = (captureDate) => {
                    const thumbnailDataUrl = resizeImageElementToDataUrl(img, PANEL_THUMB_MAX);
                    const dataUrl = resizeImageElementToDataUrl(img, MAX_PHOTO_SIZE);
                    const id = 'p' + (nextPhotoStoreId++);
                    photoStore.push({ id, dataUrl, thumbnailDataUrl, captureDate });
                    renderPhotoPanelThumbnails();
                };
                if (typeof EXIF === 'undefined') {
                    done(0);
                    return;
                }
                EXIF.getData(img, function () {
                    const dateStr = EXIF.getTag(this, 'DateTimeOriginal');
                    const captureDate = parseExifDate(dateStr);
                    done(captureDate);
                });
            };
            img.onerror = () => {};
            img.src = e.target.result;
        };
        reader.onerror = () => {};
        reader.readAsDataURL(file);
    });
}

function renderPhotoPanelThumbnails() {
    const list = document.getElementById('photoPanelList');
    const emptyHint = document.getElementById('photoPanelListEmptyHint');
    if (!list) return;
    list.innerHTML = '';
    if (emptyHint) emptyHint.classList.toggle('hidden', photoStore.length > 0);
    const sorted = [...photoStore].sort((a, b) => (a.captureDate || 0) - (b.captureDate || 0));
    sorted.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'photo-panel-thumb';
        div.draggable = true;
        div.dataset.photoId = item.id;
        const img = document.createElement('img');
        img.src = item.thumbnailDataUrl || item.dataUrl;
        img.alt = 'Photo';
        div.appendChild(img);

        const entry = dispatchOrder.find(function (d) { return d.photoId === item.id; });
        if (entry) {
            div.classList.add('dispatched');
            const badge = document.createElement('span');
            badge.className = 'dispatch-slot-badge';
            badge.textContent = String(entry.slotIndex);
            div.appendChild(badge);
        }

        div.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/x-photo-id', item.id);
            e.dataTransfer.effectAllowed = 'copy';
        });

        if (quickDispatchEnabled) {
            div.addEventListener('dblclick', function (e) {
                e.preventDefault();
                handleQuickDispatchDoubleClick(item.id);
            });
        }
        list.appendChild(div);
    });
}

function handleQuickDispatchDoubleClick(photoId) {
    const item = photoStore.find(function (p) { return p.id === photoId; });
    if (!item) return;

    const lastEntry = dispatchOrder[dispatchOrder.length - 1];
    const isLastDispatched = lastEntry && lastEntry.photoId === photoId;

    if (isLastDispatched) {
        const slotEl = getPhotoSlotElement(lastEntry.slotIndex);
        if (slotEl) removePhoto(slotEl);
        dispatchOrder.pop();
        renderPhotoPanelThumbnails();
        return;
    }

    if (dispatchOrder.some(function (d) { return d.photoId === photoId; })) return;

    const nextSlot = dispatchOrder.length + 1;
    ensurePhotoPagesForSlot(nextSlot);
    const slotEl = getPhotoSlotElement(nextSlot);
    if (!slotEl) return;
    displayPhotoFromDataUrl(slotEl, item.dataUrl);
    dispatchOrder.push({ photoId: photoId, slotIndex: nextSlot });
    renderPhotoPanelThumbnails();
}

(function setupPhotoPanel() {
    const input = document.getElementById('photoPanelFileInput');
    const addPhotosBtn = document.getElementById('addPhotosBtn');
    const photoPanelList = document.getElementById('photoPanelList');
    if (input) {
        input.addEventListener('change', (e) => {
            addPhotosToStore(e.target.files);
            e.target.value = '';
        });
    }
    if (addPhotosBtn && input) {
        addPhotosBtn.addEventListener('click', () => input.click());
    }
    if (photoPanelList) {
        photoPanelList.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            photoPanelList.classList.add('dragover');
        });
        photoPanelList.addEventListener('dragleave', (e) => {
            e.preventDefault();
            if (!photoPanelList.contains(e.relatedTarget)) photoPanelList.classList.remove('dragover');
        });
        photoPanelList.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            photoPanelList.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files.length) addPhotosToStore(e.dataTransfer.files);
        });
    }

    const quickDispatchBtn = document.getElementById('quickDispatchBtn');
    const quickDispatchHint = document.getElementById('quickDispatchHint');
    if (quickDispatchBtn && quickDispatchHint) {
        quickDispatchBtn.addEventListener('click', function () {
            quickDispatchEnabled = !quickDispatchEnabled;
            quickDispatchBtn.classList.toggle('active', quickDispatchEnabled);
            quickDispatchBtn.textContent = quickDispatchEnabled ? 'Quick Dispatch (ON)' : 'Quick Dispatch';
            quickDispatchHint.style.display = quickDispatchEnabled ? 'block' : 'none';
            renderPhotoPanelThumbnails();
        });
    }

    // Photo thumbnail size slider – smooth updates via rAF, save only on release
    const photoThumbSizeSlider = document.getElementById('photoThumbSizeSlider');
    const photoThumbSizeValue = document.getElementById('photoThumbSizeValue');
    const PHOTO_THUMB_SIZE_KEY = 'dailyReportPhotoThumbSize';
    if (photoThumbSizeSlider && photoThumbSizeValue && photoPanelList) {
        const savedSize = localStorage.getItem(PHOTO_THUMB_SIZE_KEY);
        if (savedSize !== null) {
            const n = parseInt(savedSize, 10);
            if (n >= 60 && n <= 300) {
                photoThumbSizeSlider.value = n;
                photoThumbSizeValue.textContent = n;
                photoPanelList.style.setProperty('--photo-thumb-min', n + 'px');
            }
        }
        let thumbSizeRaf = null;
        photoThumbSizeSlider.addEventListener('input', function () {
            const px = this.value;
            if (thumbSizeRaf !== null) cancelAnimationFrame(thumbSizeRaf);
            thumbSizeRaf = requestAnimationFrame(function () {
                thumbSizeRaf = null;
                photoThumbSizeValue.textContent = px;
                photoPanelList.style.setProperty('--photo-thumb-min', px + 'px');
            });
        });
        photoThumbSizeSlider.addEventListener('change', function () {
            localStorage.setItem(PHOTO_THUMB_SIZE_KEY, this.value);
        });
    }
})();

function displayPhotoFromDataUrl(element, dataUrl) {
    element.innerHTML = '';
    const img = document.createElement('img');
    img.src = dataUrl;
    element.appendChild(img);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-photo';
    removeBtn.innerHTML = '×';
    removeBtn.onclick = (e) => { e.stopPropagation(); removePhoto(element); };
    element.appendChild(removeBtn);
    element.classList.add('has-photo');
}

function displayPhoto(element, file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            let w = img.width;
            let h = img.height;
            if (w > MAX_PHOTO_SIZE || h > MAX_PHOTO_SIZE) {
                if (w > h) {
                    h = Math.round((h * MAX_PHOTO_SIZE) / w);
                    w = MAX_PHOTO_SIZE;
                } else {
                    w = Math.round((w * MAX_PHOTO_SIZE) / h);
                    h = MAX_PHOTO_SIZE;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', PHOTO_QUALITY);

            element.innerHTML = '';
            const outImg = document.createElement('img');
            outImg.src = dataUrl;
            element.appendChild(outImg);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-photo';
            removeBtn.innerHTML = '×';
            removeBtn.onclick = (event) => {
                event.stopPropagation();
                removePhoto(element);
            };
            element.appendChild(removeBtn);
            element.classList.add('has-photo');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function removePhoto(element) {
    const placeholder = document.createElement('div');
    placeholder.className = 'placeholder-text';
    placeholder.innerHTML = '<p>📷 Drag photo here or click</p>';
    element.innerHTML = '';
    element.appendChild(placeholder);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-photo';
    removeBtn.innerHTML = '×';
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        removePhoto(element);
    };
    element.appendChild(removeBtn);
    element.classList.remove('has-photo');
}

function addPhotoPage() {
    photoPages++;
    const newPage = document.createElement('div');
    newPage.className = 'page';
    newPage.id = `photoPage${photoPages}`;
    
    const header = document.createElement('h2');
    header.className = 'photo-page-header';
    header.textContent = 'Progress Photos';
    newPage.appendChild(header);
    
    const photoGrid = document.createElement('div');
    photoGrid.className = 'photo-grid';
    photoGrid.id = `photoGrid${photoPages}`;
    
    newPage.appendChild(photoGrid);
    document.getElementById('mainContainer').appendChild(newPage);
    
    initializePhotoPage(photoPages);
    updateDeletePhotoPageButton();
    updateContainerScale();
}

// Get the .photo-upload element for 1-based global slot (1-6 = page1, 7-12 = page2, ...)
function getPhotoSlotElement(slotIndex) {
    const pageNum = Math.ceil(slotIndex / 6);
    const slotInPage = (slotIndex - 1) % 6;
    const grid = document.getElementById(`photoGrid${pageNum}`);
    if (!grid) return null;
    const slots = grid.querySelectorAll('.photo-upload');
    return slots[slotInPage] || null;
}

// Ensure at least enough photo pages for the given 1-based slot (e.g. 7 -> 2 pages)
function ensurePhotoPagesForSlot(slotIndex) {
    const requiredPages = Math.ceil(slotIndex / 6);
    while (photoPages < requiredPages) {
        addPhotoPage();
    }
}

function deleteLastPhotoPage() {
    if (photoPages <= 2) return;
    const lastPage = document.getElementById(`photoPage${photoPages}`);
    if (lastPage) lastPage.remove();
    photoPages--;
    photoCounter -= 6;
    dispatchOrder = dispatchOrder.filter(function (d) { return d.slotIndex <= photoPages * 6; });
    renderPhotoPanelThumbnails();
    updateDeletePhotoPageButton();
    updateContainerScale();
}

function updateDeletePhotoPageButton() {
    const btn = document.getElementById('deletePhotoPageBtn');
    if (btn) btn.disabled = photoPages <= 2;
}

function printReport() {
    window.print();
}

// Inspection date: show weekday when date is selected
const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
document.getElementById('inspectionDate').addEventListener('change', function() {
    const val = this.value;
    const w = document.getElementById('inspectionDateWeekday');
    if (val) {
        const parts = val.split('-');
        const d = new Date(parseInt(parts[0],10), parseInt(parts[1],10) - 1, parseInt(parts[2],10));
        w.textContent = '(' + weekdays[d.getDay()] + ')';
    } else {
        w.textContent = '';
    }
});

// Initial totals calculation
updateWorkerTotals();
updateDeletePhotoPageButton();

// After layout, move worker table to new page if page1 would overflow
setTimeout(checkPage1Overflow, 100);

// Uniform scale: first page and photo pages fit in app-main (same scale for width and height)
const MM_TO_PX = 96 / 25.4;
const CONTAINER_REF_WIDTH_MM = 210;

function updateContainerScale() {
    const appMain = document.getElementById('appMain');
    const wrapper = document.getElementById('containerScaleWrapper');
    const container = document.getElementById('mainContainer');
    if (!appMain || !wrapper || !container) return;

    const appW = appMain.clientWidth;
    const appH = appMain.clientHeight;
    if (appW <= 0 || appH <= 0) return;

    const refWidthPx = CONTAINER_REF_WIDTH_MM * MM_TO_PX;
    const naturalH = container.scrollHeight;
    const naturalW = refWidthPx;

    /* Scale to fit app-main width; height scales with same ratio (vertical scroll if needed) */
    const scale = Math.min(appW / naturalW, 1);
    const scaledW = naturalW * scale;
    const scaledH = naturalH * scale;

    wrapper.style.width = scaledW + 'px';
    wrapper.style.height = scaledH + 'px';
    wrapper.style.minHeight = scaledH + 'px';

    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = naturalW + 'px';
    container.style.height = naturalH + 'px';
    container.style.transform = 'scale(' + scale + ')';
    container.style.transformOrigin = 'top left';
}

window.addEventListener('resize', updateContainerScale);
setTimeout(updateContainerScale, 150);

// Photo panel resize handle
const PHOTO_PANEL_MIN_WIDTH = 280;
const PHOTO_PANEL_MAX_WIDTH_PCT = 0.8;
const PHOTO_PANEL_DEFAULT_WIDTH_PCT = 0.5;

let photoPanelResizing = false;
let photoPanelStartX = 0;
let photoPanelStartWidth = 0;

const resizeHandle = document.getElementById('photoPanelResizeHandle');
const photoPanelEl = document.getElementById('photoPanel');

function getPhotoPanelWidthPx() {
    if (!photoPanelEl) return 0;
    const w = photoPanelEl.offsetWidth;
    return w;
}

function setPhotoPanelWidthPx(px) {
    if (!photoPanelEl) return;
    const layout = document.querySelector('.app-layout');
    if (!layout) return;
    const total = layout.clientWidth;
    const pct = Math.max(PHOTO_PANEL_MIN_WIDTH / total, Math.min(PHOTO_PANEL_MAX_WIDTH_PCT, px / total));
    photoPanelEl.style.width = (pct * 100) + '%';
    photoPanelEl.style.minWidth = PHOTO_PANEL_MIN_WIDTH + 'px';
    photoPanelEl.style.maxWidth = (PHOTO_PANEL_MAX_WIDTH_PCT * 100) + '%';
    updateContainerScale();
}

if (resizeHandle && photoPanelEl) {
    resizeHandle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        photoPanelResizing = true;
        photoPanelStartX = e.clientX;
        photoPanelStartWidth = getPhotoPanelWidthPx();
    });
}

document.addEventListener('mousemove', function (e) {
    if (!photoPanelResizing) return;
    const dx = e.clientX - photoPanelStartX;
    const newWidth = photoPanelStartWidth + dx;
    setPhotoPanelWidthPx(newWidth);
});

document.addEventListener('mouseup', function () {
    photoPanelResizing = false;
});

// Template selection: user will create templates via modal
const PROJECT_DATA = {};

// Database project management
let dbProjects = [];
let editingProjectId = null;

// Initialize template management
function initProjectManagement() {
    const projectBtn = document.getElementById('projectBtn');
    const projectDropdown = document.getElementById('projectDropdown');
    const manageProjectsBtn = document.getElementById('manageProjectsBtn');
    const projectManagementModal = document.getElementById('projectManagementModal');
    const projectManagementClose = document.getElementById('projectManagementClose');
    const cancelProjectBtn = document.getElementById('cancelProjectBtn');
    const saveProjectBtn = document.getElementById('saveProjectBtn');

    // Load templates from database
    loadProjects();

    // Template dropdown toggle
    if (projectBtn && projectDropdown) {
        projectBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            projectDropdown.classList.toggle('show');
        });

        // Handle template selection from dropdown - removed since no default templates
        // User will create their own templates via the modal
    }

    // Manage Templates button
    if (manageProjectsBtn) {
        manageProjectsBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            // 開啟「Manage Templates」時，一律當作建立新範本：
            // 1. 關閉下拉選單
            // 2. 重設表單欄位
            // 3. 清空 modal 裡的 location plan PDF 與繪圖狀態
            projectDropdown.classList.remove('show');
            resetProjectForm();
            removeProjectDrawing();
            projectPDFRawData = null;
            projectPDFFileName = '';
            projectDrawingData.scale = 1;
            projectDrawingData.rotation = 0;
            projectDrawingData.offsetX = 0;
            projectDrawingData.offsetY = 0;
            showProjectManagementModal();
        });
    }

    // Close modal buttons
    if (projectManagementClose) {
        projectManagementClose.addEventListener('click', hideProjectManagementModal);
    }
    if (cancelProjectBtn) {
        cancelProjectBtn.addEventListener('click', hideProjectManagementModal);
    }

    // Save template button
    if (saveProjectBtn) {
        saveProjectBtn.addEventListener('click', saveProject);
    }

    // Close modal when clicking outside
    if (projectManagementModal) {
        projectManagementModal.addEventListener('click', function (e) {
            if (e.target === projectManagementModal) {
                hideProjectManagementModal();
            }
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', function () {
        if (projectDropdown && projectDropdown.classList.contains('show')) {
            projectDropdown.classList.remove('show');
        }
    });
}

// Photo panel function button: Export / Import template settings
function initPhotoPanelFunction() {
    const functionBtn = document.getElementById('photoPanelFunctionBtn');
    const functionDropdown = document.getElementById('photoPanelFunctionDropdown');
    const exportSettingBtn = document.getElementById('exportSettingBtn');
    const importSettingBtn = document.getElementById('importSettingBtn');
    const importSettingFileInput = document.getElementById('importSettingFileInput');

    if (functionBtn && functionDropdown) {
        functionBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            functionDropdown.classList.toggle('show');
            functionBtn.setAttribute('aria-expanded', functionDropdown.classList.contains('show'));
        });
    }

    if (exportSettingBtn) {
        exportSettingBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            exportTemplateSettings();
            if (functionDropdown) functionDropdown.classList.remove('show');
            if (functionBtn) functionBtn.setAttribute('aria-expanded', 'false');
        });
    }

    if (importSettingBtn && importSettingFileInput) {
        importSettingBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            importSettingFileInput.value = '';
            importSettingFileInput.click();
            if (functionDropdown) functionDropdown.classList.remove('show');
            if (functionBtn) functionBtn.setAttribute('aria-expanded', 'false');
        });
    }

    if (importSettingFileInput) {
        importSettingFileInput.addEventListener('change', function (e) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async function () {
                try {
                    const data = JSON.parse(reader.result);
                    const projects = data.projects || [];
                    if (projects.length === 0) {
                        alert('No template data found in this file.');
                        e.target.value = '';
                        return;
                    }
                    await databaseService.clearProjects();
                    for (const project of projects) {
                        await databaseService.saveProject(project);
                    }
                    await loadProjects();
                    alert('Import completed. ' + projects.length + ' template(s) restored.');
                } catch (err) {
                    console.error('Import failed:', err);
                    alert('Import failed: invalid or corrupted file.');
                }
                e.target.value = '';
            };
            reader.onerror = () => {
                alert('Failed to read file.');
                e.target.value = '';
            };
            reader.readAsText(file, 'UTF-8');
        });
    }

    document.addEventListener('click', function () {
        if (functionDropdown && functionDropdown.classList.contains('show')) {
            functionDropdown.classList.remove('show');
            if (functionBtn) functionBtn.setAttribute('aria-expanded', 'false');
        }
    });
}

async function exportTemplateSettings() {
    try {
        const projects = await databaseService.getProjects();
        const data = {
            version: 1,
            exportDate: new Date().toISOString(),
            projects: projects || []
        };
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'daily-record-templates-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Export failed:', err);
        alert('Export failed: ' + (err.message || err));
    }
}

// Load templates from database
async function loadProjects() {
    try {
        // Use database service
        dbProjects = await databaseService.getProjects();
        
        // If no projects, start with empty array
        if (!dbProjects) {
            dbProjects = [];
        }
        
        renderProjectList();
        updateProjectDropdown();
    } catch (error) {
        console.error('Error loading templates:', error);
        // Fallback to empty array
        dbProjects = [];
    }
}

// Render project list in modal
function renderProjectList() {
    const projectList = document.getElementById('projectList');
    const projectListEmpty = document.getElementById('projectListEmpty');
    
    if (!projectList) return;
    
    // Clear existing list
    projectList.innerHTML = '';
    
    if (dbProjects.length === 0) {
        if (projectListEmpty) {
            projectListEmpty.style.display = 'block';
            projectList.appendChild(projectListEmpty);
        }
        return;
    }
    
    if (projectListEmpty) {
        projectListEmpty.style.display = 'none';
    }
    
    // Create project items
    dbProjects.forEach(project => {
        const projectItem = document.createElement('div');
        projectItem.className = 'project-item';
        projectItem.dataset.projectId = project.id;
        
        projectItem.innerHTML = `
            <div class="project-item-info">
                <div class="project-item-name">${project.name}</div>
                <div class="project-item-details">
                    ${project.project_title || 'No title'} | ${project.location || 'No location'}
                </div>
            </div>
            <div class="project-item-actions">
                <button type="button" class="project-action-btn edit-btn" data-project-id="${project.id}">Edit</button>
                <button type="button" class="project-action-btn delete delete-btn" data-project-id="${project.id}">Delete</button>
            </div>
        `;
        
        projectList.appendChild(projectItem);
    });
    
    // Add event listeners for edit and delete buttons
    projectList.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const projectId = parseInt(this.getAttribute('data-project-id'));
            editProject(projectId);
        });
    });
    
    projectList.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const projectId = parseInt(this.getAttribute('data-project-id'));
            deleteProject(projectId);
        });
    });
}

// Update project dropdown with database projects
function updateProjectDropdown() {
    const projectDropdown = document.getElementById('projectDropdown');
    if (!projectDropdown) return;

    // Remove existing database project items (keep only hardcoded ones and manage button)
    // We mark the whole container with data-db-project, not just the button
    const existingDbItems = projectDropdown.querySelectorAll('[data-db-project]');
    existingDbItems.forEach(item => item.remove());

    // Add database projects with edit and delete buttons
    dbProjects.forEach(project => {
        const itemContainer = document.createElement('div');
        itemContainer.className = 'project-dropdown-item-container';
        itemContainer.setAttribute('data-db-project', 'true');
        itemContainer.dataset.projectId = project.id;
        
        const itemRow = document.createElement('div');
        itemRow.className = 'project-dropdown-item-row';
        
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'project-dropdown-item';
        item.textContent = project.name;

        item.addEventListener('click', function(e) {
            e.stopPropagation();
            loadProjectIntoForm(project);
            projectDropdown.classList.remove('show');
        });

        // Create action buttons container
        const actionButtons = document.createElement('div');
        actionButtons.className = 'project-dropdown-actions';
        
        // Edit button
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'project-dropdown-edit-btn';
        editBtn.innerHTML = '✏️';
        editBtn.title = 'Edit Template';
        
        editBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            editProject(project.id);
            projectDropdown.classList.remove('show');
        });
        
        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'project-dropdown-delete-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = 'Delete Template';
        
        deleteBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            if (confirm('Are you sure you want to delete this project?')) {
                deleteProject(project.id);
            }
            projectDropdown.classList.remove('show');
        });
        
        // Add buttons to action container
        actionButtons.appendChild(editBtn);
        actionButtons.appendChild(deleteBtn);
        
        // Add elements to row
        itemRow.appendChild(item);
        itemRow.appendChild(actionButtons);
        
        // Add row to container
        itemContainer.appendChild(itemRow);

        // Insert before the divider
        const divider = projectDropdown.querySelector('.project-dropdown-divider');
        if (divider) {
            projectDropdown.insertBefore(itemContainer, divider);
        } else {
            projectDropdown.appendChild(itemContainer);
        }
    });
}

// Load project data into form fields AND apply location plan
async function loadProjectIntoForm(project) {
    const headerEl = document.getElementById('header');
    const projectTitleEl = document.getElementById('projectTitle');
    const locationEl = document.getElementById('location');
    
    if (headerEl && project.header) headerEl.textContent = project.header;
    if (projectTitleEl && project.project_title) projectTitleEl.textContent = project.project_title;
    if (locationEl && project.location) locationEl.textContent = project.location;
    
    // Load location plan if available, otherwise clear existing location plan
    if (project.pdfData) {
        await applyLocationPlanToPage(project);
    } else {
        // Clear any existing location plan
        removeDrawing();
    }
}

// Apply location plan settings to the main page
async function applyLocationPlanToPage(project) {
    if (!project || !project.pdfData) return false;
    
    try {
        // Load PDF data into main page location plan
        const success = await loadPDFFromArrayBuffer(project.pdfData);
        if (success && project.drawingData) {
            // Apply saved drawing transformations – use normalized offsets so
            // main page和 modal 的不同寬度時，視角仍然一致
            drawingData.scale = project.drawingData.scale || 1;
            drawingData.rotation = project.drawingData.rotation || 0;

            const mainContainer = document.getElementById('drawingContainer');
            const mainW = mainContainer ? mainContainer.clientWidth || 0 : 0;
            const mainH = mainContainer ? mainContainer.clientHeight || 0 : 0;

            if (project.drawingData.offsetXNorm != null && project.drawingData.offsetYNorm != null &&
                mainW > 0 && mainH > 0) {
                drawingData.offsetX = project.drawingData.offsetXNorm * mainW;
                drawingData.offsetY = project.drawingData.offsetYNorm * mainH;
            } else {
                // 向後相容：舊資料只儲存了絕對位移
                drawingData.offsetX = project.drawingData.offsetX || 0;
                drawingData.offsetY = project.drawingData.offsetY || 0;
            }

            renderPDF();
        }
        return success;
    } catch (error) {
        console.error('Error applying location plan:', error);
        return false;
    }
}

// Show project management modal
function showProjectManagementModal() {
    const modal = document.getElementById('projectManagementModal');
    if (modal) {
        modal.classList.add('show');
    }
}

// Hide project management modal
function hideProjectManagementModal() {
    const modal = document.getElementById('projectManagementModal');
    if (modal) {
        modal.classList.remove('show');
        resetProjectForm();
    }
}

// Reset project form
function resetProjectForm() {
    editingProjectId = null;
    
    const projectName = document.getElementById('projectName');
    const projectHeader = document.getElementById('projectHeader');
    const projectTitleInput = document.getElementById('projectTitleInput');
    const projectLocation = document.getElementById('projectLocation');
    const saveProjectBtn = document.getElementById('saveProjectBtn');
    
    if (projectName) projectName.value = '';
    if (projectHeader) projectHeader.value = 'Progress Photos Record';
    if (projectTitleInput) projectTitleInput.value = '';
    if (projectLocation) projectLocation.value = '';
    if (saveProjectBtn) saveProjectBtn.textContent = 'Save Project';
}

// Edit project
async function editProject(projectId) {
    const project = dbProjects.find(p => p.id === projectId);
    if (!project) return;

    editingProjectId = projectId;

    const projectName = document.getElementById('projectName');
    const projectHeader = document.getElementById('projectHeader');
    const projectTitleInput = document.getElementById('projectTitleInput');
    const projectLocation = document.getElementById('projectLocation');
    const saveProjectBtn = document.getElementById('saveProjectBtn');

    if (projectName) projectName.value = project.name || '';
    if (projectHeader) projectHeader.value = project.header || 'Progress Photos Record';
    if (projectTitleInput) projectTitleInput.value = project.project_title || '';
    if (projectLocation) projectLocation.value = project.location || '';
    if (saveProjectBtn) saveProjectBtn.textContent = 'Update Project';

    // Load PDF data if available
    if (project.pdfData) {
        const success = await loadProjectPDFFromArrayBuffer(project.pdfData);
        // Set drawing data if available
        if (project.drawingData) {
            projectDrawingData.scale = project.drawingData.scale || 1;
            projectDrawingData.rotation = project.drawingData.rotation || 0;

            const container = document.getElementById('projectDrawingContainer');
            const w = container ? container.clientWidth || 0 : 0;
            const h = container ? container.clientHeight || 0 : 0;

            if (project.drawingData.offsetXNorm != null && project.drawingData.offsetYNorm != null &&
                w > 0 && h > 0) {
                projectDrawingData.offsetX = project.drawingData.offsetXNorm * w;
                projectDrawingData.offsetY = project.drawingData.offsetYNorm * h;
            } else {
                // 向後相容舊資料
                projectDrawingData.offsetX = project.drawingData.offsetX || 0;
                projectDrawingData.offsetY = project.drawingData.offsetY || 0;
            }
            
            // Render the PDF with saved transformations
            if (success && projectDrawingData.pdfDoc) {
                renderProjectPDF();
            }
        }
        // Set file name if available
        if (project.pdfFileName) {
            const projectDrawingFileName = document.getElementById('projectDrawingFileName');
            if (projectDrawingFileName) {
                projectDrawingFileName.textContent = project.pdfFileName;
            }
        }
    } else {
        // Reset drawing area if no PDF
        removeProjectDrawing();
    }

    // Show modal with project data
    showProjectManagementModal();
}

// Delete project
async function deleteProject(projectId) {
    if (!confirm('Are you sure you want to delete this project? This will not delete any associated reports or photos.')) {
        return;
    }
    
    try {
        // Delete from database
        await databaseService.deleteProject(projectId);
        
        // Remove from local array
        dbProjects = dbProjects.filter(p => p.id !== projectId);
        
        renderProjectList();
        updateProjectDropdown();
        
        alert('Project deleted successfully');
    } catch (error) {
        console.error('Error deleting project:', error);
        alert('Error deleting project: ' + error.message);
    }
}

// Save project
async function saveProject() {
    const projectName = document.getElementById('projectName');
    const projectHeader = document.getElementById('projectHeader');
    const projectTitleInput = document.getElementById('projectTitleInput');
    const projectLocation = document.getElementById('projectLocation');
    
    if (!projectName || !projectName.value.trim()) {
        alert('Project name is required');
        projectName.focus();
        return;
    }
    
    // Handle PDF data carefully to prevent ArrayBuffer detachment issues
    let pdfDataForStorage = null;
    if (projectPDFRawData) {
        try {
            // Convert to base64 string to avoid ArrayBuffer detachment issues entirely
            // This creates a completely independent copy of the data
            let uint8Array;
            if (projectPDFRawData instanceof Uint8Array) {
                // Create a completely new copy of the Uint8Array data
                const length = projectPDFRawData.length;
                uint8Array = new Uint8Array(length);
                for (let i = 0; i < length; i++) {
                    uint8Array[i] = projectPDFRawData[i];
                }
            } else if (projectPDFRawData instanceof ArrayBuffer) {
                // Copy the ArrayBuffer data
                const tempView = new Uint8Array(projectPDFRawData);
                const length = tempView.length;
                uint8Array = new Uint8Array(length);
                for (let i = 0; i < length; i++) {
                    uint8Array[i] = tempView[i];
                }
            } else {
                console.warn('projectPDFRawData is unexpected type:', typeof projectPDFRawData);
                pdfDataForStorage = null;
            }
            
            if (uint8Array && uint8Array.length > 0) {
                // Convert to base64 for storage - this avoids all detachment issues
                const binary = [];
                for (let i = 0; i < uint8Array.length; i++) {
                    binary.push(String.fromCharCode(uint8Array[i]));
                }
                pdfDataForStorage = btoa(binary.join(''));
            }
        } catch (error) {
            console.warn('Failed to prepare PDF data for storage:', error);
            pdfDataForStorage = null;
        }
    }

    const projectData = {
        name: projectName.value.trim(),
        header: projectHeader ? projectHeader.value.trim() : '',
        project_title: projectTitleInput ? projectTitleInput.value.trim() : '',
        location: projectLocation ? projectLocation.value.trim() : '',
        // Store PDF data as Uint8Array to avoid detachment issues
        pdfData: pdfDataForStorage,
        pdfFileName: projectPDFFileName,
        drawingData: projectDrawingData.pdfDoc ? (function () {
            // 儲存時同時紀錄絕對位移與「相對容器」的位移比例，
            // 之後在主頁與 modal 依各自寬高換算，以保持視角一致
            const container = document.getElementById('projectDrawingContainer');
            const w = container ? container.clientWidth || 0 : 0;
            const h = container ? container.clientHeight || 0 : 0;

            let offsetXNorm = null;
            let offsetYNorm = null;
            if (w > 0 && h > 0) {
                offsetXNorm = projectDrawingData.offsetX / w;
                offsetYNorm = projectDrawingData.offsetY / h;
            }

            return {
                scale: projectDrawingData.scale,
                rotation: projectDrawingData.rotation,
                offsetX: projectDrawingData.offsetX,
                offsetY: projectDrawingData.offsetY,
                offsetXNorm,
                offsetYNorm
            };
        })() : null
    };
    
    try {
        if (editingProjectId) {
            // Update existing project
            projectData.id = editingProjectId;
            // Save to database
            const updatedProject = await databaseService.saveProject(projectData);
            
            // Update local array
            const index = dbProjects.findIndex(p => p.id === editingProjectId);
            if (index !== -1) {
                dbProjects[index] = { ...dbProjects[index], ...updatedProject };
            }
        } else {
            // Create new project
            const newProject = await databaseService.saveProject(projectData);
            dbProjects.push(newProject);
        }
        
        renderProjectList();
        updateProjectDropdown();
        hideProjectManagementModal();
        
        // Clear PDF data after saving
        projectPDFRawData = null;
        projectPDFFileName = '';
        
        alert(`Project ${editingProjectId ? 'updated' : 'created'} successfully`);
    } catch (error) {
        console.error('Error saving project:', error);
        alert('Error saving project: ' + error.message);
    }
}

// Store PDF raw data for saving
let projectPDFRawData = null;
let projectPDFFileName = '';

// Project management drawing initialization
function initProjectManagementDrawing() {
    const projectDrawingUpload = document.getElementById('projectDrawingUpload');
    const projectDrawingFileInput = document.getElementById('projectDrawingFileInput');
    const projectDrawingFileBtn = document.getElementById('projectDrawingFileBtn');
    const projectDrawingContainer = document.getElementById('projectDrawingContainer');
    const projectDrawingCanvas = document.getElementById('projectDrawingCanvas');
    const projectDrawingContextMenu = document.getElementById('projectDrawingContextMenu');
    const projectDrawingMenuRotate = document.getElementById('projectDrawingMenuRotate');
    const projectDrawingMenuReset = document.getElementById('projectDrawingMenuReset');
    const projectDrawingMenuRemove = document.getElementById('projectDrawingMenuRemove');
    const projectDrawingFileName = document.getElementById('projectDrawingFileName');

    if (!projectDrawingUpload || !projectDrawingFileInput) return;

    // File selection button handlers
    if (projectDrawingFileBtn) {
        projectDrawingFileBtn.addEventListener('click', () => {
            projectDrawingFileInput.click();
        });
    }

    // File input change handlers
    projectDrawingFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            projectDrawingFileName.textContent = file.name;
            loadProjectPDF(file);
        }
    });

    // Drawing upload handlers
    projectDrawingUpload.addEventListener('click', () => {
        projectDrawingFileInput.click();
    });

    projectDrawingUpload.addEventListener('dragover', (e) => {
        e.preventDefault();
        projectDrawingUpload.classList.add('dragover');
    });

    projectDrawingUpload.addEventListener('dragleave', () => {
        projectDrawingUpload.classList.remove('dragover');
    });

    projectDrawingUpload.addEventListener('drop', (e) => {
        e.preventDefault();
        projectDrawingUpload.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type === 'application/pdf') {
            projectDrawingFileName.textContent = files[0].name;
            loadProjectPDF(files[0]);
        }
    });

    // Context menu handlers
    if (projectDrawingMenuRotate) {
        projectDrawingMenuRotate.addEventListener('click', function (e) {
            e.stopPropagation();
            projectDrawingData.rotation = (projectDrawingData.rotation + 90) % 360;
            renderProjectPDF();
            projectDrawingContextMenu.style.display = 'none';
        });
    }

    if (projectDrawingMenuReset) {
        projectDrawingMenuReset.addEventListener('click', function (e) {
            e.stopPropagation();
            resetProjectDrawing();
            projectDrawingContextMenu.style.display = 'none';
        });
    }

    if (projectDrawingMenuRemove) {
        projectDrawingMenuRemove.addEventListener('click', function (e) {
            e.stopPropagation();
            removeProjectDrawing();
            projectDrawingContextMenu.style.display = 'none';
        });
    }

    // Flag to prevent immediate hiding after showing context menu in modal
    let projectJustShowedContextMenu = false;
    
    // Right-click context menu
    if (projectDrawingContainer) {
        projectDrawingContainer.addEventListener('contextmenu', function (e) {
            if (projectDrawingCanvas.style.display !== 'block' || !projectDrawingData.pdfDoc) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            // Set flag to prevent immediate hiding
            projectJustShowedContextMenu = true;
            
            if (projectDrawingContextMenu) {
                // Ensure context menu is in body (avoids CSS transform issues)
                if (projectDrawingContextMenu.parentElement !== document.body) {
                    document.body.appendChild(projectDrawingContextMenu);
                }
                
                projectDrawingContextMenu.style.display = 'block';
                projectDrawingContextMenu.style.left = e.clientX + 'px';
                projectDrawingContextMenu.style.top = e.clientY + 'px';
                projectDrawingContextMenu.style.zIndex = '2000';
            }
            
            // Reset flag after a short delay to allow menu interaction
            setTimeout(() => {
                projectJustShowedContextMenu = false;
            }, 100);
        });
    }

    // Prevent clicks inside the context menu from closing it
    if (projectDrawingContextMenu) {
        projectDrawingContextMenu.addEventListener('mousedown', function (e) {
            e.stopPropagation();
            // If it's a right-click inside the menu, don't hide it
            if (e.button === 2) {
                e.preventDefault();
            }
        });
        
        projectDrawingContextMenu.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }

    // Hide context menu when clicking anywhere else (left-click only)
    document.addEventListener('mousedown', function (e) {
        // Don't hide if we just showed the context menu
        if (projectJustShowedContextMenu) {
            return;
        }
        
        // Only hide on left-click (button 0)
        if (e.button === 0 && projectDrawingContextMenu && 
            projectDrawingContextMenu.style.display === 'block' && 
            !projectDrawingContextMenu.contains(e.target)) {
            projectDrawingContextMenu.style.display = 'none';
        }
    });
    
    // Hide context menu when right-clicking elsewhere
    document.addEventListener('contextmenu', function (e) {
        // Don't hide if we just showed the context menu
        if (projectJustShowedContextMenu) {
            return;
        }
        
        if (projectDrawingContextMenu && 
            projectDrawingContextMenu.style.display === 'block' && 
            !projectDrawingContextMenu.contains(e.target)) {
            projectDrawingContextMenu.style.display = 'none';
        }
    });
    
    // Also add a click handler as backup
    document.addEventListener('click', function (e) {
        // Don't hide if we just showed the context menu
        if (projectJustShowedContextMenu) {
            return;
        }
        
        if (projectDrawingContextMenu && 
            projectDrawingContextMenu.style.display === 'block' && 
            !projectDrawingContextMenu.contains(e.target)) {
            projectDrawingContextMenu.style.display = 'none';
        }
    });

    // Wheel zoom for project drawing
    if (projectDrawingContainer) {
        projectDrawingContainer.addEventListener('wheel', function (e) {
            if (projectDrawingCanvas.style.display !== 'block' || !projectDrawingData.pdfDoc) return;
            e.preventDefault();
            const rect = projectDrawingContainer.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const oldScale = projectDrawingData.scale;
            const factor = e.deltaY > 0 ? 1 / 1.06 : 1.06;
            const newScale = Math.max(0.2, Math.min(8, oldScale * factor));
            if (newScale === oldScale) return;
            projectDrawingData.offsetX = mouseX - (mouseX - projectDrawingData.offsetX) * newScale / oldScale;
            projectDrawingData.offsetY = mouseY - (mouseY - projectDrawingData.offsetY) * newScale / oldScale;
            projectDrawingData.scale = newScale;
            renderProjectPDF();
        }, { passive: false });
    }

    // Canvas dragging
    if (projectDrawingCanvas) {
        projectDrawingCanvas.addEventListener('mousedown', (e) => {
            projectDrawingData.isDragging = true;
            projectDrawingData.startX = e.clientX - projectDrawingData.offsetX;
            projectDrawingData.startY = e.clientY - projectDrawingData.offsetY;
        });

        document.addEventListener('mousemove', (e) => {
            if (projectDrawingData.isDragging) {
                projectDrawingData.offsetX = e.clientX - projectDrawingData.startX;
                projectDrawingData.offsetY = e.clientY - projectDrawingData.startY;
                projectDrawingCanvas.style.left = projectDrawingData.offsetX + 'px';
                projectDrawingCanvas.style.top = projectDrawingData.offsetY + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            projectDrawingData.isDragging = false;
        });
    }

}

async function loadProjectPDF(file) {
    const fileReader = new FileReader();
    fileReader.onload = async function() {
        const arrayBuffer = this.result;
        // Create a Uint8Array copy for storage - this will keep data safe from detachment
        const storageUint8Array = new Uint8Array(arrayBuffer.byteLength);
        storageUint8Array.set(new Uint8Array(arrayBuffer));
        projectPDFRawData = storageUint8Array;  // Store as Uint8Array, not ArrayBuffer
        projectPDFFileName = file.name;

        // Create a separate ArrayBuffer copy for PDF.js
        const pdfjsBuffer = new ArrayBuffer(arrayBuffer.byteLength);
        new Uint8Array(pdfjsBuffer).set(new Uint8Array(arrayBuffer));

        try {
            const pdf = await pdfjsLib.getDocument(pdfjsBuffer).promise;
            projectDrawingData.pdfDoc = pdf;
            renderProjectPDF();
            const projectDrawingUpload = document.getElementById('projectDrawingUpload');
            const projectDrawingCanvas = document.getElementById('projectDrawingCanvas');
            if (projectDrawingUpload) projectDrawingUpload.style.display = 'none';
            if (projectDrawingCanvas) projectDrawingCanvas.style.display = 'block';
        } catch (error) {
            console.error('Error loading PDF:', error);
            alert('Error loading PDF file');
        }
    };
    fileReader.readAsArrayBuffer(file);
}

// Load PDF from array buffer (for editing saved projects)
// Helper function to convert base64 string to ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// Helper function to detect if data is base64 string
function isBase64(str) {
    if (typeof str !== 'string') return false;
    // Simple base64 detection - check for common pattern
    return /^[A-Za-z0-9+/]+=*$/.test(str) && str.length % 4 === 0;
}

async function loadProjectPDFFromArrayBuffer(data) {
    // Handle both ArrayBuffer and base64 string input
    let arrayBuffer;
    if (data instanceof ArrayBuffer) {
        arrayBuffer = data;
    } else if (isBase64(data)) {
        // Convert base64 string to ArrayBuffer
        arrayBuffer = base64ToArrayBuffer(data);
    } else if (data instanceof Uint8Array) {
        // Already a Uint8Array
        arrayBuffer = data.buffer;
    } else {
        console.error('Unsupported data type for PDF loading:', typeof data);
        return false;
    }

    // Create a Uint8Array copy for storage - this will keep data safe from detachment
    const storageUint8Array = new Uint8Array(arrayBuffer.byteLength);
    storageUint8Array.set(new Uint8Array(arrayBuffer));
    projectPDFRawData = storageUint8Array;  // Store as Uint8Array, not ArrayBuffer

    // Create a separate ArrayBuffer copy for PDF.js
    const pdfjsBuffer = new ArrayBuffer(arrayBuffer.byteLength);
    new Uint8Array(pdfjsBuffer).set(new Uint8Array(arrayBuffer));

    try {
        const pdf = await pdfjsLib.getDocument(pdfjsBuffer).promise;
        projectDrawingData.pdfDoc = pdf;
        renderProjectPDF();
        const projectDrawingUpload = document.getElementById('projectDrawingUpload');
        const projectDrawingCanvas = document.getElementById('projectDrawingCanvas');
        if (projectDrawingUpload) projectDrawingUpload.style.display = 'none';
        if (projectDrawingCanvas) projectDrawingCanvas.style.display = 'block';
        return true;
    } catch (error) {
        console.error('Error loading PDF from array buffer:', error);
        return false;
    }
}

async function renderProjectPDF() {
    if (!projectDrawingData.pdfDoc || projectRenderLock) return;
    
    projectRenderLock = true;
    try {
        const page = await projectDrawingData.pdfDoc.getPage(projectDrawingData.pageNum);
        const effectiveScale = projectDrawingData.scale * PDF_RENDER_DPI_SCALE;
        const viewport = page.getViewport({ scale: effectiveScale, rotation: projectDrawingData.rotation });
        
        const canvas = document.getElementById('projectDrawingCanvas');
        if (!canvas) return;
        
        const context = canvas.getContext('2d');
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // Display size in CSS pixels so canvas fits container; bitmap stays high-res for 2K/4K
        canvas.style.width = (viewport.width / PDF_RENDER_DPI_SCALE) + 'px';
        canvas.style.height = (viewport.height / PDF_RENDER_DPI_SCALE) + 'px';
        canvas.style.left = projectDrawingData.offsetX + 'px';
        canvas.style.top = projectDrawingData.offsetY + 'px';

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        await page.render(renderContext).promise;
    } catch (error) {
        console.error('Error rendering project PDF:', error);
    } finally {
        projectRenderLock = false;
    }
}

function resetProjectDrawing() {
    projectDrawingData.scale = 1;
    projectDrawingData.rotation = 0;
    projectDrawingData.offsetX = 0;
    projectDrawingData.offsetY = 0;
    renderProjectPDF();
}

function removeProjectDrawing() {
    const projectDrawingCanvas = document.getElementById('projectDrawingCanvas');
    const projectDrawingUpload = document.getElementById('projectDrawingUpload');
    const projectDrawingFileName = document.getElementById('projectDrawingFileName');
    
    if (projectDrawingCanvas) projectDrawingCanvas.style.display = 'none';
    if (projectDrawingUpload) projectDrawingUpload.style.display = 'flex';
    if (projectDrawingFileName) projectDrawingFileName.textContent = 'No file selected';
    projectDrawingData.pdfDoc = null;
}

// Show project context menu
function showProjectContextMenu(clientX, clientY, project) {
    const projectContextMenu = document.getElementById('projectContextMenu');
    if (!projectContextMenu) return;
    
    // Set flag to prevent immediate hiding after showing context menu
    let justShowedContextMenu = true;
    
    // Ensure context menu is in body
    if (projectContextMenu.parentElement !== document.body) {
        document.body.appendChild(projectContextMenu);
    }
    
    // Position the menu
    projectContextMenu.style.display = 'block';
    projectContextMenu.style.left = clientX + 'px';
    projectContextMenu.style.top = clientY + 'px';
    projectContextMenu.style.zIndex = '2000';
    
    // Set up event handlers for menu items
    const editBtn = document.getElementById('projectMenuEdit');
    const deleteBtn = document.getElementById('projectMenuDelete');
    
    if (editBtn) {
        editBtn.onclick = function(e) {
            e.stopPropagation();
            editProject(project.id);
            projectContextMenu.style.display = 'none';
        };
    }
    
    if (deleteBtn) {
        deleteBtn.onclick = function(e) {
            e.stopPropagation();
            deleteProject(project.id);
            projectContextMenu.style.display = 'none';
        };
    }
    
    // Prevent clicks inside the context menu from closing it
    projectContextMenu.addEventListener('mousedown', function(e) {
        e.stopPropagation();
        if (e.button === 2) {
            e.preventDefault();
        }
    });
    
    projectContextMenu.addEventListener('click', function(e) {
        e.stopPropagation();
    });
    
    // Hide context menu when clicking elsewhere
    const hideMenuHandler = function(e) {
        if (justShowedContextMenu) {
            justShowedContextMenu = false;
            return;
        }
        
        if (projectContextMenu.style.display === 'block' && 
            !projectContextMenu.contains(e.target)) {
            projectContextMenu.style.display = 'none';
            document.removeEventListener('mousedown', hideMenuHandler);
            document.removeEventListener('contextmenu', hideMenuHandler);
            document.removeEventListener('click', hideMenuHandler);
        }
    };
    
    // Set up listeners to hide menu
    setTimeout(() => {
        document.addEventListener('mousedown', hideMenuHandler);
        document.addEventListener('contextmenu', hideMenuHandler);
        document.addEventListener('click', hideMenuHandler);
    }, 10);
}

// Initialize project management when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initProjectManagement();
    initPhotoPanelFunction();
    // Initialize project management drawing handlers
    initProjectManagementDrawing();
    // Initialize main drawing handlers
    initDrawingHandlers();
});
