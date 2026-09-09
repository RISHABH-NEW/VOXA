/**
 * VOXA — Voice Orb Visualization
 * Canvas-based animated orb with state-driven visual effects.
 * 
 * States:
 *   READY       — Subtle breathing glow
 *   LISTENING   — Pulsing rings expanding outward
 *   THINKING    — Rotating particles / spinner
 *   SPEAKING    — Audio-reactive waveform distortion
 *   INTERRUPTED — Brief red flash, then transition
 *   ERROR       — Static dim red glow
 */

class VoxaOrb {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.state = 'READY';
    this.animationId = null;
    this.time = 0;
    this.transitionProgress = 0;
    this.targetState = null;
    this.interruptFlash = 0;

    // Orb properties
    this.centerX = 0;
    this.centerY = 0;
    this.baseRadius = 80;
    this.particles = [];

    // Colors
    this.colors = {
      READY: { r: 99, g: 102, b: 241 },          // Indigo
      LISTENING: { r: 34, g: 211, b: 238 },       // Cyan
      THINKING: { r: 168, g: 85, b: 247 },        // Purple
      TOOL_WORKING: { r: 245, g: 158, b: 11 },    // Amber
      SPEAKING: { r: 52, g: 211, b: 153 },        // Emerald
      INTERRUPTED: { r: 251, g: 113, b: 133 },    // Rose
      CANCELLING: { r: 239, g: 68, b: 68 },       // Red
      RECOVERING: { r: 34, g: 211, b: 238 },      // Cyan
      ERROR: { r: 239, g: 68, b: 68 },            // Red
    };

    this._initParticles();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.min(rect.width, 340);
    this.canvas.width = size * window.devicePixelRatio;
    this.canvas.height = size * window.devicePixelRatio;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.centerX = size / 2;
    this.centerY = size / 2;
    this.baseRadius = size * 0.22;
  }

  _initParticles() {
    this.particles = [];
    for (let i = 0; i < 60; i++) {
      this.particles.push({
        angle: (Math.PI * 2 * i) / 60,
        radius: 0,
        speed: 0.5 + Math.random() * 1.5,
        size: 1 + Math.random() * 2,
        offset: Math.random() * Math.PI * 2,
      });
    }
  }

  setState(newState) {
    if (newState === 'INTERRUPTED') {
      this.interruptFlash = 1.0;
    }
    this.state = newState;
  }

  start() {
    if (this.animationId) return;
    this._animate();
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  _animate() {
    this.time += 0.016;
    this._draw();
    this.animationId = requestAnimationFrame(() => this._animate());
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.width / window.devicePixelRatio;
    const h = this.canvas.height / window.devicePixelRatio;

    ctx.clearRect(0, 0, w, h);

    // Get current color
    const color = this.colors[this.state] || this.colors.READY;

    // Interrupt flash decay
    if (this.interruptFlash > 0) {
      this.interruptFlash *= 0.92;
      if (this.interruptFlash < 0.01) this.interruptFlash = 0;
    }

    // Draw based on state
    switch (this.state) {
      case 'READY':
        this._drawReady(ctx, color);
        break;
      case 'LISTENING':
        this._drawListening(ctx, color);
        break;
      case 'THINKING':
        this._drawThinking(ctx, color);
        break;
      case 'SPEAKING':
        this._drawSpeaking(ctx, color);
        break;
      case 'INTERRUPTED':
        this._drawInterrupted(ctx, color);
        break;
      case 'ERROR':
        this._drawError(ctx, color);
        break;
    }

    // Flash overlay
    if (this.interruptFlash > 0) {
      const flashColor = this.colors.INTERRUPTED;
      ctx.beginPath();
      ctx.arc(this.centerX, this.centerY, this.baseRadius * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${flashColor.r}, ${flashColor.g}, ${flashColor.b}, ${this.interruptFlash * 0.3})`;
      ctx.fill();
    }
  }

  _drawReady(ctx, color) {
    const breathe = Math.sin(this.time * 1.5) * 0.08 + 1;
    const radius = this.baseRadius * breathe;

    // Outer glow
    const gradient = ctx.createRadialGradient(
      this.centerX, this.centerY, radius * 0.3,
      this.centerX, this.centerY, radius * 2
    );
    gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 0.15)`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.centerX * 2, this.centerY * 2);

    // Main orb
    const orbGrad = ctx.createRadialGradient(
      this.centerX - radius * 0.3, this.centerY - radius * 0.3, 0,
      this.centerX, this.centerY, radius
    );
    orbGrad.addColorStop(0, `rgba(${color.r + 60}, ${color.g + 60}, ${color.b + 60}, 0.9)`);
    orbGrad.addColorStop(0.7, `rgba(${color.r}, ${color.g}, ${color.b}, 0.6)`);
    orbGrad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0.1)`);

    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = orbGrad;
    ctx.fill();

    // Inner bright core
    const coreGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, 0,
      this.centerX, this.centerY, radius * 0.4
    );
    coreGrad.addColorStop(0, `rgba(255, 255, 255, 0.4)`);
    coreGrad.addColorStop(1, `rgba(255, 255, 255, 0)`);
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, radius * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = coreGrad;
    ctx.fill();
  }

  _drawListening(ctx, color) {
    // Pulsing rings
    for (let i = 0; i < 3; i++) {
      const phase = (this.time * 2 + i * 0.7) % 3;
      const ringRadius = this.baseRadius * (1 + phase * 0.6);
      const opacity = Math.max(0, 1 - phase / 3) * 0.3;

      ctx.beginPath();
      ctx.arc(this.centerX, this.centerY, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Main orb with pulse
    const pulse = Math.sin(this.time * 4) * 0.1 + 1;
    const radius = this.baseRadius * pulse;

    const orbGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, 0,
      this.centerX, this.centerY, radius
    );
    orbGrad.addColorStop(0, `rgba(${color.r + 40}, ${color.g + 40}, ${color.b + 40}, 0.8)`);
    orbGrad.addColorStop(0.6, `rgba(${color.r}, ${color.g}, ${color.b}, 0.5)`);
    orbGrad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0.1)`);

    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = orbGrad;
    ctx.fill();
  }

  _drawThinking(ctx, color) {
    // Rotating particles
    const numDots = 12;
    for (let i = 0; i < numDots; i++) {
      const angle = (Math.PI * 2 * i) / numDots + this.time * 3;
      const dotRadius = this.baseRadius * 1.2;
      const x = this.centerX + Math.cos(angle) * dotRadius;
      const y = this.centerY + Math.sin(angle) * dotRadius;
      const size = 3 + Math.sin(this.time * 5 + i) * 1.5;
      const opacity = 0.3 + Math.sin(this.time * 3 + i * 0.5) * 0.3;

      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity})`;
      ctx.fill();
    }

    // Core orb (smaller, breathing)
    const breathe = Math.sin(this.time * 3) * 0.05 + 0.85;
    const radius = this.baseRadius * breathe;

    const orbGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, 0,
      this.centerX, this.centerY, radius
    );
    orbGrad.addColorStop(0, `rgba(${color.r + 40}, ${color.g + 40}, ${color.b + 40}, 0.7)`);
    orbGrad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0.15)`);

    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = orbGrad;
    ctx.fill();
  }

  _drawSpeaking(ctx, color) {
    // Waveform distortion on the orb boundary
    const points = 64;
    ctx.beginPath();

    for (let i = 0; i <= points; i++) {
      const angle = (Math.PI * 2 * i) / points;
      const wave1 = Math.sin(angle * 6 + this.time * 8) * 8;
      const wave2 = Math.sin(angle * 3 + this.time * 5) * 5;
      const wave3 = Math.sin(angle * 9 + this.time * 12) * 3;
      const r = this.baseRadius + wave1 + wave2 + wave3;

      const x = this.centerX + Math.cos(angle) * r;
      const y = this.centerY + Math.sin(angle) * r;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.closePath();

    const orbGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, 0,
      this.centerX, this.centerY, this.baseRadius * 1.3
    );
    orbGrad.addColorStop(0, `rgba(${color.r + 60}, ${color.g + 60}, ${color.b + 60}, 0.8)`);
    orbGrad.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, 0.5)`);
    orbGrad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0.1)`);

    ctx.fillStyle = orbGrad;
    ctx.fill();

    // Outer glow
    const glowGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, this.baseRadius * 0.8,
      this.centerX, this.centerY, this.baseRadius * 2
    );
    glowGrad.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 0.12)`);
    glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, this.centerX * 2, this.centerY * 2);
  }

  _drawInterrupted(ctx, color) {
    // Quick transition visual
    const radius = this.baseRadius * (1 + this.interruptFlash * 0.3);

    const orbGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, 0,
      this.centerX, this.centerY, radius
    );
    orbGrad.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 0.7)`);
    orbGrad.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, 0.3)`);
    orbGrad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0.05)`);

    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = orbGrad;
    ctx.fill();

    // Shatter lines
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + this.time;
      const len = radius * (0.5 + this.interruptFlash * 0.5);

      ctx.beginPath();
      ctx.moveTo(this.centerX, this.centerY);
      ctx.lineTo(
        this.centerX + Math.cos(angle) * len,
        this.centerY + Math.sin(angle) * len
      );
      ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${this.interruptFlash * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  _drawError(ctx, color) {
    const radius = this.baseRadius * 0.9;
    const pulse = Math.sin(this.time * 2) * 0.03 + 1;

    const orbGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, 0,
      this.centerX, this.centerY, radius * pulse
    );
    orbGrad.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 0.5)`);
    orbGrad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0.1)`);

    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, radius * pulse, 0, Math.PI * 2);
    ctx.fillStyle = orbGrad;
    ctx.fill();
  }
}

window.VoxaOrb = VoxaOrb;
