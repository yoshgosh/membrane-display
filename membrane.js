class MembraneEffect {
  constructor(options = {}) {
    this._maxR          = options.maxR          ?? 220;
    this._pressRate     = options.pressRate     ?? 0.015;
    this._releaseRate   = options.releaseRate   ?? 0.005;
    this._shadowOpacity = options.shadowOpacity ?? 0.15;
    this._stopThreshold = 0.005;

    this._pressure       = 0;
    this._pressureTarget = 0;
    this._rafId          = null;
    this._mapDirty       = false;
    this._isPressed      = false;
    this._lastTimestamp  = 0;
    this._pageX = this._pageY = 0;
    this._clientX = this._clientY = 0;

    this._svgEl         = null;
    this._filterEl      = null;
    this._feImageEl     = null;
    this._feDispEl      = null;
    this._shadowCanvas  = null;
    this._shadowCtx     = null;
    this._mapCanvas     = null;
    this._mapCtx        = null;

    this._boundMouseDown   = this._onMouseDown.bind(this);
    this._boundMouseUp     = this._onMouseUp.bind(this);
    this._boundMouseMove   = this._onMouseMove.bind(this);
    this._boundResize      = this._onResize.bind(this);
    this._boundTick        = this._tick.bind(this);
  }

  mount() {
    this._buildSVG();
    this._buildCanvas();
    this._attachEvents();
  }

  destroy() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._clearFilter();
    window.removeEventListener('mousedown',  this._boundMouseDown);
    window.removeEventListener('mouseup',    this._boundMouseUp);
    window.removeEventListener('mousemove',  this._boundMouseMove);
    window.removeEventListener('resize',     this._boundResize);
    if (this._svgEl?.parentNode)         this._svgEl.parentNode.removeChild(this._svgEl);
    if (this._shadowCanvas?.parentNode)  this._shadowCanvas.parentNode.removeChild(this._shadowCanvas);
  }

  _buildSVG() {
    const NS = 'http://www.w3.org/2000/svg';
    const W  = window.innerWidth;
    const H  = window.innerHeight;

    const svg = document.createElementNS(NS, 'svg');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    svg.setAttribute('aria-hidden', 'true');

    const defs = document.createElementNS(NS, 'defs');
    svg.appendChild(defs);

    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id',           'membrane-filter');
    filter.setAttribute('filterUnits',  'userSpaceOnUse');
    filter.setAttribute('x',            '0');
    filter.setAttribute('y',            '0');
    filter.setAttribute('width',        String(W));
    filter.setAttribute('height',       String(H));
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    defs.appendChild(filter);

    // neutral gray fills the entire filter region → no displacement outside the map
    const feFlood = document.createElementNS(NS, 'feFlood');
    feFlood.setAttribute('flood-color',   'rgb(128,128,128)');
    feFlood.setAttribute('flood-opacity', '1');
    feFlood.setAttribute('result',        'neutral');
    filter.appendChild(feFlood);

    const feImage = document.createElementNS(NS, 'feImage');
    feImage.setAttribute('result',              'localMap');
    feImage.setAttribute('x',                   '0');
    feImage.setAttribute('y',                   '0');
    feImage.setAttribute('width',               String(2 * this._maxR));
    feImage.setAttribute('height',              String(2 * this._maxR));
    feImage.setAttribute('preserveAspectRatio', 'none');
    filter.appendChild(feImage);

    const feComp = document.createElementNS(NS, 'feComposite');
    feComp.setAttribute('in',       'localMap');
    feComp.setAttribute('in2',      'neutral');
    feComp.setAttribute('operator', 'over');
    feComp.setAttribute('result',   'fullMap');
    filter.appendChild(feComp);

    const feDisp = document.createElementNS(NS, 'feDisplacementMap');
    feDisp.setAttribute('in',               'SourceGraphic');
    feDisp.setAttribute('in2',              'fullMap');
    feDisp.setAttribute('scale',            '0');
    feDisp.setAttribute('xChannelSelector', 'R');
    feDisp.setAttribute('yChannelSelector', 'G');
    filter.appendChild(feDisp);

    document.body.appendChild(svg);

    this._svgEl     = svg;
    this._filterEl  = filter;
    this._feImageEl = feImage;
    this._feDispEl  = feDisp;

    this._mapCanvas        = document.createElement('canvas');
    this._mapCanvas.width  = 2 * this._maxR;
    this._mapCanvas.height = 2 * this._maxR;
    this._mapCtx           = this._mapCanvas.getContext('2d');
  }

  _buildCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'z-index:2147483647',
    ].join(';');
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    this._shadowCanvas = canvas;
    this._shadowCtx    = canvas.getContext('2d');
  }

  _attachEvents() {
    window.addEventListener('mousedown', this._boundMouseDown);
    window.addEventListener('mouseup',   this._boundMouseUp);
    window.addEventListener('mousemove', this._boundMouseMove, { passive: true });
    window.addEventListener('resize',    this._boundResize,    { passive: true });
  }

  _onMouseDown(e) {
    this._isPressed      = true;
    this._pressureTarget = 1;
    this._pageX   = e.pageX;
    this._pageY   = e.pageY;
    this._clientX = e.clientX;
    this._clientY = e.clientY;
    this._mapDirty = true;
    this._applyFilter();
    this._startRAF();
  }

  _onMouseUp() {
    this._isPressed      = false;
    this._pressureTarget = 0;
  }

  _onMouseMove(e) {
    if (!this._isPressed) return;
    this._pageX   = e.pageX;
    this._pageY   = e.pageY;
    this._clientX = e.clientX;
    this._clientY = e.clientY;
    this._mapDirty = true;
  }

  _onResize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this._filterEl.setAttribute('width',  String(W));
    this._filterEl.setAttribute('height', String(H));
    this._shadowCanvas.width  = W;
    this._shadowCanvas.height = H;
  }

  _startRAF() {
    if (this._rafId !== null) return;
    this._lastTimestamp = performance.now();
    this._rafId = requestAnimationFrame(this._boundTick);
  }

  _tick(timestamp) {
    const dt   = Math.min(timestamp - this._lastTimestamp, 50);
    this._lastTimestamp = timestamp;

    const rate = this._pressureTarget === 1 ? this._pressRate : this._releaseRate;
    this._pressure += (this._pressureTarget - this._pressure) * (1 - Math.exp(-rate * dt));

    if (this._mapDirty) {
      this._generateMap();
      this._mapDirty = false;
    }

    const scale = this._maxR * 0.15 * this._pressure;
    this._feDispEl.setAttribute('scale', scale.toFixed(2));

    const fx = this._pageX - this._maxR;
    const fy = this._pageY - this._maxR;
    this._feImageEl.setAttribute('x', String(fx));
    this._feImageEl.setAttribute('y', String(fy));

    this._drawShadow();

    if (this._pressure < this._stopThreshold && this._pressureTarget === 0) {
      this._clearFilter();
      this._rafId = null;
      return;
    }

    this._rafId = requestAnimationFrame(this._boundTick);
  }

  _generateMap() {
    const maxR  = this._maxR;
    const maxR2 = maxR * maxR;
    const size  = 2 * maxR;
    const ctx   = this._mapCtx;

    // Gaussian derivative profile: f(r) = (r/σ) * exp(-r²/2σ²)
    // Peaks at r = σ, normalized so peak = 1
    const sigma       = maxR * 0.35;
    const sigma2      = sigma * sigma;
    const gaussNormInv = Math.exp(0.5); // 1 / exp(-0.5)

    const imageData = ctx.createImageData(size, size);
    const data      = imageData.data;

    for (let y = 0; y < size; y++) {
      const dy  = y - maxR;
      const dy2 = dy * dy;
      for (let x = 0; x < size; x++) {
        const i   = (y * size + x) * 4;
        const dx  = x - maxR;
        const r2  = dx * dx + dy2;
        data[i + 2] = 0;

        if (r2 >= maxR2) {
          data[i]     = 128;
          data[i + 1] = 128;
          data[i + 3] = 0;
        } else if (r2 < 0.25) {
          data[i]     = 128;
          data[i + 1] = 128;
          data[i + 3] = 255;
        } else {
          const r        = Math.sqrt(r2);
          const invR     = 1.0 / r;
          const gaussVal = (r / sigma) * Math.exp(-r2 / (2 * sigma2)) * gaussNormInv;
          data[i]     = (128 + 127 * dx * invR * gaussVal + 0.5) | 0;
          data[i + 1] = (128 + 127 * dy * invR * gaussVal + 0.5) | 0;
          data[i + 3] = 255;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    this._feImageEl.setAttribute('href', this._mapCanvas.toDataURL('image/png'));
  }

  _drawShadow() {
    const ctx = this._shadowCtx;
    const W   = this._shadowCanvas.width;
    const H   = this._shadowCanvas.height;
    const p   = this._pressure;

    ctx.clearRect(0, 0, W, H);
    if (p < 0.005) return;

    const cx = this._clientX;
    const cy = this._clientY;
    const R  = this._maxR;

    // sigma and alpha both scale with pressure — shape and darkness change continuously
    const sigma = R * (0.20 + 0.30 * p);
    const maxA  = p * p * this._shadowOpacity;

    // Approximate Gaussian depth profile exp(-r²/σ²) with radial gradient stops
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    for (let i = 0; i <= 10; i++) {
      const t   = i / 10;
      const r   = t * R;
      const val = Math.exp(-(r * r) / (sigma * sigma));
      grd.addColorStop(t, `rgba(0,0,0,${(maxA * val).toFixed(4)})`);
    }

    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
  }

  _applyFilter() {
    document.documentElement.style.filter = 'url(#membrane-filter)';
  }

  _clearFilter() {
    document.documentElement.style.filter = '';
    this._shadowCtx.clearRect(0, 0, this._shadowCanvas.width, this._shadowCanvas.height);
    this._feDispEl.setAttribute('scale', '0');
  }
}
