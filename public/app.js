class CanvasDrawer {
    constructor(config) {
        this.config = config;
        this.canvas = document.createElement('canvas'); // Use an in-memory canvas
        this.ctx = this.canvas.getContext('2d');
        this.CONSTANTS = {
            FONT_SIZE: 90,
            PADDING: 60,
            TEXT_AREA_HEIGHT: 220,
            IMG_SIZE: 1000,
            POLAROID_WIDTH: 1000 + 60 * 2,
            get POLAROID_HEIGHT() { return this.IMG_SIZE + this.PADDING + this.TEXT_AREA_HEIGHT; },
            GRID_GAP: 100,
        };
    }

    async _loadAssets(imageSources, activeDecorations) {
        const imagePromises = imageSources.map(src => {
            const img = new Image();
            img.src = src;
            return img.decode().then(() => img).catch(e => console.error("Image load error:", e));
        });

        const decoPromises = [...activeDecorations].map(id => {
            const img = new Image();
            // Important for drawing images from other domains onto a canvas
            img.crossOrigin = 'anonymous'; 
            img.src = this.config.decorations[id].url;
            return img.decode().then(() => ({ id, img })).catch(e => console.error("Decoration load error:", e));
        });

        const [loadedImages, loadedDecos] = await Promise.all([
            Promise.all(imagePromises.filter(p => p)),
            Promise.all(decoPromises.filter(p => p))
        ]);

        const decoMap = new Map(loadedDecos.map(d => [d.id, d.img]));
        return { loadedImages, decoMap };
    }

    _drawImageWithAspectRatio(img, dx, dy, dWidth, dHeight) {
        const hRatio = dWidth / img.width;
        const vRatio = dHeight / img.height;
        const ratio = Math.max(hRatio, vRatio); // Use max for 'cover' effect
        const centerShiftX = (dWidth - img.width * ratio) / 2;
        const centerShiftY = (dHeight - img.height * ratio) / 2;
        this.ctx.drawImage(img, 0, 0, img.width, img.height,
            dx + centerShiftX, dy + centerShiftY, img.width * ratio, img.height * ratio);
    }

    _drawSinglePolaroid(img, text, decoMap, filterValue, font) {
        const { PADDING, IMG_SIZE, TEXT_AREA_HEIGHT, POLAROID_WIDTH, POLAROID_HEIGHT, FONT_SIZE } = this.CONSTANTS;
        const polaroidBg = getComputedStyle(document.documentElement).getPropertyValue('--polaroid-bg').trim();

        // A. Draw Polaroid BG and shadow
        this.ctx.shadowColor = 'rgba(60, 60, 80, 0.15)';
        this.ctx.shadowBlur = 40;
        this.ctx.shadowOffsetY = 20;
        this.ctx.fillStyle = polaroidBg;
        this.ctx.fillRect(0, 0, POLAROID_WIDTH, POLAROID_HEIGHT);
        this.ctx.shadowColor = 'transparent';

        // B. Draw Image with Filter
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(PADDING, PADDING, IMG_SIZE, IMG_SIZE);
        this.ctx.clip();
        this.ctx.filter = filterValue;
        this._drawImageWithAspectRatio(img, PADDING, PADDING, IMG_SIZE, IMG_SIZE);
        this.ctx.filter = 'none';
        this.ctx.restore();

        // C. Draw Decorations
        for (const [id, decoImg] of decoMap.entries()) {
            const d = this.config.decorations[id];
            this.ctx.drawImage(decoImg, d.x, d.y, d.w, d.h);
        }

        // D. Draw Text
        if (text) {
            this.ctx.fillStyle = '#444';
            this.ctx.font = `600 ${FONT_SIZE}px '${font}'`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(text, POLAROID_WIDTH / 2, PADDING + IMG_SIZE + (TEXT_AREA_HEIGHT / 2));
        }
    }

    async createDownloadableCanvas(options) {
        const { layout, images, text, filter, font, decorations } = options;
        const { loadedImages, decoMap } = await this._loadAssets(images, decorations);
        if (loadedImages.length === 0) throw new Error("No images to draw.");

        const { POLAROID_WIDTH, POLAROID_HEIGHT, GRID_GAP, IMG_SIZE, PADDING, TEXT_AREA_HEIGHT } = this.CONSTANTS;
        const filterValue = this.config.filters[filter].value;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (layout === 'collage') {
            const w_large = POLAROID_WIDTH, h_large = POLAROID_HEIGHT;
            const w_small = (POLAROID_WIDTH - GRID_GAP) / 2, h_small = POLAROID_HEIGHT;

            this.canvas.width = w_large;
            this.canvas.height = h_large + h_small + GRID_GAP;

            // Draw large image
            if (loadedImages[0]) {
                this.ctx.save();
                this._drawSinglePolaroid(loadedImages[0], '', decoMap, filterValue, font);
                this.ctx.restore();
            }
            // Draw small images
            for (let i = 1; i < 3; i++) {
                if (!loadedImages[i]) continue;
                const x = (i - 1) * (w_small + GRID_GAP);
                const y = h_large + GRID_GAP;
                this.ctx.save();
                this.ctx.translate(x, y);
                this.ctx.scale(w_small / POLAROID_WIDTH, h_small / POLAROID_HEIGHT);
                this._drawSinglePolaroid(loadedImages[i], i === loadedImages.length - 1 ? text : '', new Map(), filterValue, font);
                this.ctx.restore();
            }
        } else {
            let cols = 1, rows = 1;
            if (layout === 'grid-2x2') { cols = 2; rows = 2; }
            else if (layout === 'grid-strip' || layout === 'grid-4x1') { rows = 4; }

            this.canvas.width = cols * POLAROID_WIDTH + (cols - 1) * GRID_GAP;
            this.canvas.height = rows * POLAROID_HEIGHT + (rows - 1) * GRID_GAP;

            for (let i = 0; i < loadedImages.length; i++) {
                const isLastImage = i === loadedImages.length - 1;
                const currentText = isLastImage ? text : '';
                const currentDecos = (layout === 'single' || i === 0) ? decoMap : new Map();
                const row = Math.floor(i / cols);
                const col = i % cols;
                const x = col * (POLAROID_WIDTH + GRID_GAP);
                const y = row * (POLAROID_HEIGHT + GRID_GAP);

                this.ctx.save();
                this.ctx.translate(x, y);
                this._drawSinglePolaroid(loadedImages[i], currentText, currentDecos, filterValue, font);
                this.ctx.restore();
            }
        }
        return this.canvas;
    }
}


class PolaroidMaker {
    constructor() {
        this._initConfig();
        this._initDOM();
        this._initState();
        this._initUI();
        this._bindEvents();
        this._updateUI();
        this._loadPrompts();
    }

    _initConfig() {
        this.config = {
            filters: { 'none': { name: 'None', value: 'none' }, 'vintage': { name: 'Vintage', value: 'sepia(0.35) contrast(1.1) brightness(1.05) saturate(1.2)' }, 'mono': { name: 'Mono', value: 'grayscale(1)' }, 'retro': { name: 'Retro', value: 'sepia(0.6) contrast(0.9) brightness(1.1)' }, 'gloomy': { name: 'Gloomy', value: 'contrast(1.2) brightness(0.9) saturate(0.8)' }, 'mellow': { name: 'Mellow', value: 'brightness(1.1) contrast(0.95) saturate(0.9)' }, 'dreamy': { name: 'Dreamy', value: 'saturate(1.4) contrast(0.9) brightness(1.1) blur(0.5px)' }, 'lomo': { name: 'Lomo', value: 'saturate(1.5) contrast(1.2)' }, 'golden': { name: 'Golden', value: 'sepia(0.2) saturate(1.4) contrast(0.9) brightness(1.1) hue-rotate(-10deg)' }, 'cyber': { name: 'Cyber', value: 'saturate(1.5) contrast(1.2) hue-rotate(180deg) sepia(0.3) brightness(0.9)' }, 'cam90': { name: '90s Cam', value: 'sepia(0.4) contrast(1.1) brightness(1.1) saturate(1.3)' }, },
            fonts: { 'Caveat': 'Cute', 'Patrick Hand': 'Neat', 'Rock Salt': 'Bold', 'Special Elite': 'Typed' },
            decorations: {
                'ribbon-decoration': { name: 'Ribbon', url: 'assets/ribbon.png', w: 200, h: 100, x: 0, y: 0 },
                'heart-decoration': { name: 'Heart', url: 'assets/heart.png', w: 150, h: 150, x: 870, y: 0 },
                'sparkle-decoration': { name: 'Sparkle', url: 'assets/sparkle.svg', w: 100, h: 100, x: 880, y: 30 },
                'doodle-arrow-decoration': { name: 'Arrow', url: 'assets/doodle-arrow.svg', w: 200, h: 200, x: 400, y: 400 }
            },
            supabaseUrl: 'https://pneybqcjgjqlrvpwpmpq.supabase.co',
            supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBuZXlicWNqZ2pxbHJ2cHdwbXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4NDIzMjcsImV4cCI6MjA3MzQxODMyN30.FwAHPNYBDzCeAC84KPWjXw8S5626sILMAeG1L-7JyLk'
        };
        this.canvasDrawer = new CanvasDrawer(this.config);
        this.prompts = [];
    }
    
    _initDOM() {
        this.els = {
            video: document.getElementById('videoElement'), canvas: document.getElementById('canvas'), startCameraBtn: document.getElementById('startCameraBtn'), switchCameraBtn: document.getElementById('switchCameraBtn'), captureBtn: document.getElementById('captureBtn'), uploadBtn: document.getElementById('uploadBtn'), fileInput: document.getElementById('fileInput'), downloadBtn: document.getElementById('downloadBtn'), polaroidContainer: document.getElementById('polaroidContainer'), polaroidText: document.getElementById('polaroidText'), flashEffect: document.getElementById('flashEffect'), cameraOverlay: document.getElementById('cameraOverlay'), emptyState: document.getElementById('emptyState'), layoutOptions: document.getElementById('layoutOptions'), startTimerBtn: document.getElementById('startTimerBtn'), timerDelay: document.getElementById('timerDelay'), photoCount: document.getElementById('photoCount'), timerStatus: document.getElementById('timerStatus'), countdownOverlay: document.getElementById('countdownOverlay'), countdownNumber: document.getElementById('countdownNumber'),
            filterOptions: document.getElementById('filterOptions'), fontOptions: document.getElementById('fontOptions'), decorationOptions: document.getElementById('decorationOptions'),
            downloadBtnText: document.querySelector('#downloadBtn .btn-text'),
            downloadBtnSpinner: document.querySelector('#downloadBtn .spinner'),
            promptDisplay: document.getElementById('promptDisplay'), promptText: document.getElementById('promptText'), copyPromptBtn: document.getElementById('copyPromptBtn'),
        };
    }

    _initState() {
        this.ctx = this.els.canvas.getContext('2d');
        this.state = {
            layout: 'single', filter: 'none', font: 'Caveat',
            decorations: new Set(),
            capturedImages: [],
            isStreaming: false,
            isTimerActive: false,
            facingMode: 'user',
            stream: null,
            videoDeviceCount: 0,
        };
    }
    
    _initUI() {
        const filterPreviewUrl = 'assets/img.jpg'; // Use a sample image for filter previews
        this.els.filterOptions.innerHTML = Object.entries(this.config.filters).map(([id, { name, value }]) => `
            <div class="grid-option filter-option" data-filter="${id}">
                <div class="filter-preview" style="background-image: url('${filterPreviewUrl}'); filter: ${value};"></div>
                <div class="option-name">${name}</div>
            </div>`).join('');

        this.els.fontOptions.innerHTML = Object.entries(this.config.fonts).map(([font, name]) => `
            <div class="grid-option font-option" data-font="${font}">
                <div class="font-preview font-${font.replace(/\s/g, '-')}">Ag</div>
                <div class="option-name">${name}</div>
            </div>`).join('');

        this.els.decorationOptions.innerHTML = Object.entries(this.config.decorations).map(([id, { url, name, w, h }]) => `
             <div class="grid-option decoration-option" data-decoration="${id}">
                <div class="decoration-preview" style="background-image: url('${url}'); width: ${w/4}px; height: ${h/4}px; background-size: contain; background-repeat: no-repeat; background-position: center;"></div>
                <div class="option-name">${name}</div>
             </div>`).join('');
        
        this._setActiveOption(this.els.layoutOptions, `[data-layout="${this.state.layout}"]`);
        this._setActiveOption(this.els.filterOptions, `[data-filter="${this.state.filter}"]`);
        this._setActiveOption(this.els.fontOptions, `[data-font="${this.state.font}"]`);
        this.els.polaroidText.style.fontFamily = `'${this.state.font}', cursive`;
    }
    
    _updateUI() {
        const hasImages = this.state.capturedImages.length > 0;
        this.els.captureBtn.disabled = !this.state.isStreaming || this.state.isTimerActive;
        this.els.startTimerBtn.disabled = !this.state.isStreaming || this.state.isTimerActive;
        this.els.downloadBtn.disabled = !hasImages || this.state.isTimerActive;
        this.els.switchCameraBtn.disabled = !this.state.isStreaming || this.state.isTimerActive || this.state.videoDeviceCount <= 1;
        this.els.emptyState.classList.toggle('hidden', hasImages);
    }
    
    _handleOptionSelection(container, selector, callback) {
        container.addEventListener('click', (e) => {
            const option = e.target.closest(selector);
            if (!option) return;
            if (option.classList.contains('decoration-option')) {
                option.classList.toggle('active');
            } else {
                this._setActiveOption(container, option);
            }
            callback(option);
        });
    }

    _setActiveOption(container, selector) {
        const option = typeof selector === 'string' ? container.querySelector(selector) : selector;
        if (!option) return;
        [...container.children].forEach(child => child.classList.remove('active'));
        option.classList.add('active');
    }

    _bindEvents() {
        this.els.startCameraBtn.addEventListener('click', () => this.startCamera());
        this.els.captureBtn.addEventListener('click', () => this.capturePhoto());
        this.els.uploadBtn.addEventListener('click', () => this.els.fileInput.click());
        this.els.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        this.els.downloadBtn.addEventListener('click', () => this.downloadPolaroid());
        this.els.polaroidText.addEventListener('input', () => this.renderPolaroid());
        this.els.startTimerBtn.addEventListener('click', () => this.startTimer());
        this.els.switchCameraBtn.addEventListener('click', () => this.switchCamera());
        
        this._handleOptionSelection(this.els.layoutOptions, '.layout-option', el => {
            this.state.layout = el.dataset.layout;
            const maxPhotos = this._getMaxImagesForLayout();
            this.els.photoCount.max = maxPhotos;
            if (parseInt(this.els.photoCount.value) > maxPhotos) this.els.photoCount.value = maxPhotos;
            this.renderPolaroid();
        });
        
        this._handleOptionSelection(this.els.filterOptions, '.filter-option', el => {
            this.state.filter = el.dataset.filter;
            this.renderPolaroid();
        });

        this._handleOptionSelection(this.els.fontOptions, '.font-option', el => {
            this.state.font = el.dataset.font;
            this.els.polaroidText.style.fontFamily = `'${this.state.font}', cursive`;
            this.renderPolaroid();
        });

        this._handleOptionSelection(this.els.decorationOptions, '.decoration-option', el => {
            const decoId = el.dataset.decoration;
            this.state.decorations.has(decoId) ? this.state.decorations.delete(decoId) : this.state.decorations.add(decoId);
            this.renderPolaroid();
        });

        // AI Prompt handlers will be set up after loading from Supabase
        
        this.els.copyPromptBtn.addEventListener('click', () => this.copyPrompt());
    }
    
    async startCamera() {
        if (this.state.isStreaming) return this.stopCamera();

        if (this.state.stream) this.state.stream.getTracks().forEach(track => track.stop());
        try {
            this.state.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: this.state.facingMode } });
            this.els.video.srcObject = this.state.stream;
            this.state.isStreaming = true;
            this.els.cameraOverlay.classList.add('hidden');
            this.els.startCameraBtn.innerHTML = `Stop Camera`;
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.state.videoDeviceCount = devices.filter(d => d.kind === 'videoinput').length;
        } catch (err) {
            console.error("Camera Error:", err);
            this.els.cameraOverlay.classList.remove('hidden');
            this.els.cameraOverlay.textContent = 'Camera access denied.';
        }
        this._updateUI();
    }
    
    stopCamera() {
        if (this.state.stream) this.state.stream.getTracks().forEach(track => track.stop());
        this.state.isStreaming = false;
        this.state.stream = null;
        this.els.video.srcObject = null;
        this.els.cameraOverlay.classList.remove('hidden');
        this.els.cameraOverlay.textContent = 'Click "Start Camera" to begin';
        this.els.startCameraBtn.innerHTML = `Start Camera`;
        this._updateUI();
    }

    switchCamera() {
        this.state.facingMode = this.state.facingMode === 'user' ? 'environment' : 'user';
        this.startCamera();
    }

    capturePhoto() {
        if (!this.state.isStreaming) return;
        this._triggerFlash();
        this.els.canvas.width = this.els.video.videoWidth; 
        this.els.canvas.height = this.els.video.videoHeight;
        
        if (this.state.facingMode === 'user') { 
            this.ctx.translate(this.els.canvas.width, 0); 
            this.ctx.scale(-1, 1); 
        }

        this.ctx.drawImage(this.els.video, 0, 0, this.els.canvas.width, this.els.canvas.height);
        this.addCapturedImage(this.els.canvas.toDataURL('image/jpeg', 0.95));
        
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); 
    }

    handleFileUpload(event) {
        const files = event.target.files;
        if (!files.length) return;
        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => this.addCapturedImage(e.target.result);
            reader.readAsDataURL(file);
        });
        event.target.value = ''; // Reset for same-file uploads
    }
    
    addCapturedImage(imageData) {
        const maxImages = this._getMaxImagesForLayout();
        if (this.state.capturedImages.length >= maxImages) {
            this.state.capturedImages.shift();
        }
        this.state.capturedImages.push(imageData);
        this.renderPolaroid();
        this._updateUI();
    }

    _getMaxImagesForLayout() {
        if (this.state.layout === 'single') return 1;
        if (this.state.layout === 'grid-2x2') return 4;
        if (this.state.layout === 'grid-strip') return 4;
        if (this.state.layout === 'collage') return 3;
        return 1;
    }
    
    renderPolaroid() {
        if (this.state.capturedImages.length === 0) {
            this.els.polaroidContainer.innerHTML = '';
            this._updateUI();
            return;
        }
        
        const text = this.els.polaroidText.value;
        const imagesToRender = this.state.capturedImages.slice(-this._getMaxImagesForLayout());
        const filterClass = `filter-${this.state.filter}`;
        
        const decorationHTML = [...this.state.decorations].map(id => {
            const deco = this.config.decorations[id];
            const style = `background-image: url('${deco.url}'); width: ${deco.w / 4}px; height: ${deco.h / 4}px; background-size: contain; background-repeat: no-repeat; z-index: 10; position: absolute; top: ${deco.y / 4}px; left: ${deco.x / 4}px;`;
            return `<div class="decoration" style="${style}"></div>`;
        }).join('');

        let html = '';
        if (this.state.layout === 'single') {
            html = `<div class="polaroid-output-area">
                <div id="polaroid-single" class="polaroid">
                    ${decorationHTML}
                    <div class="polaroid-image-wrapper">
                        <img src="${imagesToRender[0]}" class="polaroid-image ${filterClass}" alt="Captured photo">
                    </div>
                    <div class="polaroid-text" style="font-family: '${this.state.font}', cursive;">${text}</div>
                </div>
            </div>`;
        } else {
            html = `<div class="polaroid-grid-wrapper ${this.state.layout}">`;
            const totalSlots = this._getMaxImagesForLayout();
            for (let i = 0; i < totalSlots; i++) {
                const imgSrc = imagesToRender[i] || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
                const isTextVisible = i === (imagesToRender.length - 1);
                const showDecorations = i === 0;

                html += `
                <div class="polaroid">
                    ${showDecorations ? decorationHTML : ''}
                    <div class="polaroid-image-wrapper">
                        <img src="${imgSrc}" class="polaroid-image ${filterClass}" alt="Captured photo ${i + 1}">
                    </div>
                    <div class="polaroid-text" style="font-family: '${this.state.font}', cursive;">${isTextVisible ? text : ''}</div>
                </div>`;
            }
            html += `</div>`;
        }
        this.els.polaroidContainer.innerHTML = html;
        this._updateUI();
    }

    _setDownloadButtonState(isLoading) {
        this.els.downloadBtn.disabled = isLoading;
        this.els.downloadBtnText.classList.toggle('hidden', isLoading);
        this.els.downloadBtnSpinner.classList.toggle('hidden', !isLoading);
    }

    async downloadPolaroid() {
        this._setDownloadButtonState(true);
        try {
            const canvas = await this.canvasDrawer.createDownloadableCanvas({
                layout: this.state.layout,
                images: this.state.capturedImages.slice(-this._getMaxImagesForLayout()),
                text: this.els.polaroidText.value,
                filter: this.state.filter,
                font: this.state.font,
                decorations: this.state.decorations
            });

            const link = document.createElement('a');
            link.download = `photobooth-${this.state.layout}-${Date.now()}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (error) { 
            console.error("Download failed:", error);
            alert("Sorry, the image could not be created. Please check the console for errors and try again.");
        } finally {
            this._setDownloadButtonState(false);
        }
    }
    
    startTimer() {
        if (!this.state.isStreaming || this.state.isTimerActive) return;

        this.state.isTimerActive = true;
        this._updateUI();
        this.state.capturedImages = []; // Clear previous images for a new sequence
        this.renderPolaroid();
        
        const photosToTake = parseInt(this.els.photoCount.value) || 4;
        const delay = parseInt(this.els.timerDelay.value) || 3;
        let photosTaken = 0;

        const sequence = () => {
            if (photosTaken >= photosToTake) {
                this.stopTimer();
                return;
            }

            this.showCountdown(delay, photosTaken + 1, () => {
                this.capturePhoto();
                photosTaken++;
                setTimeout(sequence, 1000); // 1s pause between captures
            });
        };
        
        this.els.timerStatus.textContent = `Sequence in progress...`;
        sequence();
    }

    stopTimer() {
        this.state.isTimerActive = false;
        this.els.timerStatus.textContent = ``;
        this._updateUI();
    }

    showCountdown(seconds, photoNum, onComplete) {
        this.els.countdownOverlay.classList.add('is-active');
        let count = seconds;
        const tick = () => {
            this.els.countdownNumber.textContent = count > 0 ? count : `📸`;
            if (count > 0) {
                count--;
                setTimeout(tick, 1000);
            } else {
                setTimeout(() => {
                    this.els.countdownOverlay.classList.remove('is-active');
                    onComplete();
                }, 800);
            }
        };
        tick();
    }

    _triggerFlash() { 
        this.els.flashEffect.classList.add('active'); 
        setTimeout(() => this.els.flashEffect.classList.remove('active'), 300); 
    }

    async _loadPrompts() {
        try {
            const response = await fetch(`${this.config.supabaseUrl}/rest/v1/prompts?select=*`, {
                headers: {
                    'apikey': this.config.supabaseKey,
                    'Authorization': `Bearer ${this.config.supabaseKey}`
                }
            });
            this.prompts = await response.json();
            this._updatePromptButtons();
        } catch (error) {
            console.error('Failed to load prompts:', error);
        }
    }

    _updatePromptButtons() {
        const container = document.querySelector('.prompt-options');
        if (this.prompts.length > 0) {
            container.innerHTML = this.prompts.map(prompt => 
                `<button class="c-btn c-btn--secondary prompt-btn" data-prompt-id="${prompt.id}">
                    ${prompt.icon || '📝'} ${prompt.title}
                </button>`
            ).join('');
            
            container.querySelectorAll('.prompt-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const promptId = e.target.dataset.promptId;
                    this.showPrompt(promptId);
                });
            });
        }
    }

    showPrompt(promptId) {
        const prompt = this.prompts.find(p => p.id == promptId);
        if (prompt) {
            this.els.promptText.value = prompt.content;
            this.els.promptDisplay.classList.remove('hidden');
        }
    }

    async copyPrompt() {
        try {
            await navigator.clipboard.writeText(this.els.promptText.value);
            const originalText = this.els.copyPromptBtn.textContent;
            this.els.copyPromptBtn.textContent = '✅ Copied!';
            setTimeout(() => {
                this.els.copyPromptBtn.textContent = originalText;
            }, 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
            this.els.promptText.select();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new PolaroidMaker());
