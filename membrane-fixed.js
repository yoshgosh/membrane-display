class MembraneFixed {
  constructor(options = {}) {
    this._maxR          = options.maxR          ?? 220;
    this._shadowOpacity = options.shadowOpacity ?? 0.15;

    this._points         = []; // { clientX, clientY }
    this._localMapPixels = null; // Uint8ClampedArray — precomputed local displacement map
    this._localShadeCanvas = null;

    this._fullMapCanvas = null;
    this._fullMapCtx    = null;

    this._svgEl     = null;
    this._feImageEl = null;
    this._feDispEl  = null;

    this._shadowCanvas = null;
    this._shadowCtx    = null;

    this._blobUrl     = null;

    this._boundClick  = this._onClick.bind(this);
    this._boundResize = this._onResize.bind(this);
  }

  mount() {
    this._precompute();
    this._buildSVG();
    this._buildCanvases();
    window.addEventListener('click',  this._boundClick);
    window.addEventListener('resize', this._boundResize, { passive: true });
  }

  destroy() {
    window.removeEventListener('click',  this._boundClick);
    window.removeEventListener('resize', this._boundResize);
    document.documentElement.style.filter = '';
    if (this._blobUrl) URL.revokeObjectURL(this._blobUrl);
    if (this._svgEl?.parentNode)        this._svgEl.parentNode.removeChild(this._svgEl);
    if (this._shadowCanvas?.parentNode) this._shadowCanvas.parentNode.removeChild(this._shadowCanvas);
  }

  _precompute() {
    const maxR  = this._maxR;
    const maxR2 = maxR * maxR;
    const size  = 2 * maxR;

    // --- displacement map (pressure = 1, same profile as MembraneEffect) ---
    const mapCanvas  = document.createElement('canvas');
    mapCanvas.width  = size;
    mapCanvas.height = size;
    const ctx        = mapCanvas.getContext('2d');

    const sigma        = maxR * 0.35;
    const sigma2       = sigma * sigma;
    const gaussNormInv = Math.exp(0.5);
    const imageData    = ctx.createImageData(size, size);
    const data         = imageData.data;

    for (let y = 0; y < size; y++) {
      const dy  = y - maxR;
      const dy2 = dy * dy;
      for (let x = 0; x < size; x++) {
        const i  = (y * size + x) * 4;
        const dx = x - maxR;
        const r2 = dx * dx + dy2;
        data[i + 2] = 0;
        if (r2 >= maxR2) {
          data[i] = 128; data[i + 1] = 128; data[i + 3] = 0;
        } else if (r2 < 0.25) {
          data[i] = 128; data[i + 1] = 128; data[i + 3] = 255;
        } else {
          const r        = Math.sqrt(r2);
          const gaussVal = (r / sigma) * Math.exp(-r2 / (2 * sigma2)) * gaussNormInv;
          data[i]     = (128 + 127 * (dx / r) * gaussVal + 0.5) | 0;
          data[i + 1] = (128 + 127 * (dy / r) * gaussVal + 0.5) | 0;
          data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    this._localMapPixels = data;

    // --- shade map ---
    const shadeCanvas  = document.createElement('canvas');
    shadeCanvas.width  = size;
    shadeCanvas.height = size;
    const shCtx        = shadeCanvas.getContext('2d');
    const shSigma      = maxR * 0.50;
    const shSigma2     = shSigma * shSigma;
    const shData       = shCtx.createImageData(size, size);
    const sd           = shData.data;

    for (let y = 0; y < size; y++) {
      const dy  = y - maxR;
      const dy2 = dy * dy;
      for (let x = 0; x < size; x++) {
        const dx = x - maxR;
        const r2 = dx * dx + dy2;
        const i  = (y * size + x) * 4;
        if (r2 >= maxR2 || r2 < 0.25) { sd[i + 3] = 0; continue; }
        const depth    = Math.exp(-r2 / (2 * shSigma2));
        const shade    = depth * depth;
        const r        = Math.sqrt(r2);
        const normR    = r / maxR;
        const t        = Math.max(0, (normR - 0.55) / 0.45);
        const edgeFade = 1 - t * t * (3 - 2 * t);
        sd[i] = 0; sd[i + 1] = 0; sd[i + 2] = 0;
        sd[i + 3] = (shade * 255 * edgeFade + 0.5) | 0;
      }
    }
    shCtx.putImageData(shData, 0, 0);
    this._localShadeCanvas = shadeCanvas;
  }

  _buildSVG() {
    const NS  = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    svg.setAttribute('aria-hidden', 'true');

    const defs = document.createElementNS(NS, 'defs');
    svg.appendChild(defs);

    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id',          'membrane-fixed-filter');
    filter.setAttribute('filterUnits', 'objectBoundingBox');
    filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
    filter.setAttribute('width', '1'); filter.setAttribute('height', '1');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    defs.appendChild(filter);

    const feImage = document.createElementNS(NS, 'feImage');
    feImage.setAttribute('x', '0'); feImage.setAttribute('y', '0');
    feImage.setAttribute('preserveAspectRatio', 'none');
    feImage.setAttribute('result', 'dispMap');
    filter.appendChild(feImage);

    const feDisp = document.createElementNS(NS, 'feDisplacementMap');
    feDisp.setAttribute('in',               'SourceGraphic');
    feDisp.setAttribute('in2',              'dispMap');
    feDisp.setAttribute('scale',            String(this._maxR * 0.15));
    feDisp.setAttribute('xChannelSelector', 'R');
    feDisp.setAttribute('yChannelSelector', 'G');
    filter.appendChild(feDisp);

    document.body.appendChild(svg);
    this._svgEl     = svg;
    this._feImageEl = feImage;
    this._feDispEl  = feDisp;
  }

  _buildCanvases() {
    const W = window.innerWidth;
    const H = window.innerHeight;

    this._fullMapCanvas        = document.createElement('canvas');
    this._fullMapCanvas.width  = W;
    this._fullMapCanvas.height = H;
    this._fullMapCtx           = this._fullMapCanvas.getContext('2d');

    this._feImageEl.setAttribute('width',  String(W));
    this._feImageEl.setAttribute('height', String(H));

    const shadow  = document.createElement('canvas');
    shadow.width  = W;
    shadow.height = H;
    shadow.style.cssText = [
      'position:fixed', 'top:0', 'left:0',
      'width:100%', 'height:100%',
      'pointer-events:none', 'z-index:2147483647',
    ].join(';');
    shadow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(shadow);
    this._shadowCanvas = shadow;
    this._shadowCtx    = shadow.getContext('2d');
  }

  _onResize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this._fullMapCanvas.width  = W;
    this._fullMapCanvas.height = H;
    this._shadowCanvas.width   = W;
    this._shadowCanvas.height  = H;
    this._feImageEl.setAttribute('width',  String(W));
    this._feImageEl.setAttribute('height', String(H));
    if (this._points.length > 0) this._rebuild();
  }

  _onClick(e) {
    this._points.push({ clientX: e.clientX, clientY: e.clientY });
    this._rebuild();
    if (this._points.length === 1) {
      document.documentElement.style.filter = 'url(#membrane-fixed-filter)';
    }
  }

  // Rebuild the full-viewport displacement map by summing all dent vectors additively.
  // Each point contributes (R-128, G-128) to a float accumulator; neutral is 128 everywhere else.
  _rebuild() {
    const W    = this._fullMapCanvas.width;
    const H    = this._fullMapCanvas.height;
    const maxR = this._maxR;
    const size = 2 * maxR;
    const src  = this._localMapPixels;

    const dxAcc = new Float32Array(W * H);
    const dyAcc = new Float32Array(W * H);

    for (const pt of this._points) {
      const ox = Math.round(pt.clientX - maxR);
      const oy = Math.round(pt.clientY - maxR);
      for (let ly = 0; ly < size; ly++) {
        const gy = oy + ly;
        if (gy < 0 || gy >= H) continue;
        for (let lx = 0; lx < size; lx++) {
          const gx = ox + lx;
          if (gx < 0 || gx >= W) continue;
          const li = (ly * size + lx) * 4;
          if (src[li + 3] === 0) continue;
          dxAcc[gy * W + gx] += src[li]     - 128;
          dyAcc[gy * W + gx] += src[li + 1] - 128;
        }
      }
    }

    const imageData = this._fullMapCtx.createImageData(W, H);
    const d         = imageData.data;
    for (let i = 0; i < W * H; i++) {
      d[i * 4]     = Math.max(0, Math.min(255, (128 + dxAcc[i] + 0.5) | 0));
      d[i * 4 + 1] = Math.max(0, Math.min(255, (128 + dyAcc[i] + 0.5) | 0));
      d[i * 4 + 2] = 0;
      d[i * 4 + 3] = 255;
    }
    this._fullMapCtx.putImageData(imageData, 0, 0);
    this._fullMapCanvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      this._feImageEl.setAttribute('href', url);
      if (this._blobUrl) URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = url;
    });

    // Redraw all shadows
    const ctx = this._shadowCtx;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = this._shadowOpacity;
    for (const pt of this._points) {
      ctx.drawImage(this._localShadeCanvas, pt.clientX - maxR, pt.clientY - maxR);
    }
    ctx.globalAlpha = 1;
  }
}
