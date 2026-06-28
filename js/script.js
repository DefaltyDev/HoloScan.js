const canvas = document.getElementById('canvas1');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let particleArray = [];
let baseParticles = [];
let orbitalParticles = [];
let globalTime = 0;
let gridCanvas = null; // offscreen canvas for static grid
const gap = 3;

const mouse = {
    x: null,
    y: null,
    radius: 130
};

window.addEventListener('mousemove', function(event) {
    mouse.x = event.x;
    mouse.y = event.y;
});

window.addEventListener('mouseout', function() {
    mouse.x = null;
    mouse.y = null;
});

const image = new Image();
image.src = 'assets/danilo.webp';

// ==========================================
// PRÉ-CALCULA A GRADE NUM CANVAS SEPARADO
// (desenhada uma vez, reutilizada todo frame)
// ==========================================
function buildGridCanvas() {
    gridCanvas = document.createElement('canvas');
    gridCanvas.width = canvas.width;
    gridCanvas.height = canvas.height;
    const gctx = gridCanvas.getContext('2d');
    const gridSize = 60;

    gctx.strokeStyle = 'rgba(0, 200, 255, 0.028)';
    gctx.lineWidth = 0.4;
    gctx.beginPath();
    for (let x = 0; x <= canvas.width; x += gridSize) {
        gctx.moveTo(x, 0);
        gctx.lineTo(x, canvas.height);
    }
    for (let y = 0; y <= canvas.height; y += gridSize) {
        gctx.moveTo(0, y);
        gctx.lineTo(canvas.width, y);
    }
    gctx.stroke();
}

// ==========================================
// PARTÍCULAS DO ROSTO — BATCH RENDERING
// ==========================================
class Particle {
    // edgeFactor: 0.0 = fully on edge (tiny+transparent), 1.0 = fully interior (normal)
    constructor(x, y, brightness, originX, originY, edgeFactor = 1) {
        this.x = originX + (Math.random() - 0.5) * 60;
        this.y = originY + (Math.random() - 0.5) * 60;
        this.originX = originX;
        this.originY = originY;

        this.baseBrightness = brightness / 255;
        // Shrink size at edges — edge particles are much smaller
        const ef = edgeFactor;  // 0..1
        this.size = (this.baseBrightness * 1.6 + 0.3) * (0.2 + ef * 0.8);
        // Fade alpha at edges
        this.baseAlpha = (this.baseBrightness * 0.85 + 0.05) * (0.15 + ef * 0.85);
        this.alpha = 0;

        // Pre-assign to a color bucket (0=cyan, 1=blue-white) — avoids per-frame color calc
        this.colorBucket = Math.random() > 0.6 ? 1 : 0;

        this.ease = 0.045 + Math.random() * 0.02;
        this.friction = 0.91;
        this.vx = 0;
        this.vy = 0;

        // Glitch
        this.glitchX = 0;
        this.glitchY = 0;
        this.glitchTimer = 0;

        // Flicker: pre-baked offset, computed cheaply in update
        this.flickerOffset = Math.random() * Math.PI * 2;
        this.flickerSpeed = Math.random() * 0.04 + 0.01;
    }

    update() {
        // Fade in
        if (this.alpha < this.baseAlpha) this.alpha += 0.008;

        // Mouse repulsion
        if (mouse.x !== null) {
            const dx = mouse.x - this.x;
            const dy = mouse.y - this.y;
            const dist2 = dx * dx + dy * dy;
            const r2 = mouse.radius * mouse.radius;
            if (dist2 < r2) {
                const dist = Math.sqrt(dist2);
                const force = ((mouse.radius - dist) / mouse.radius);
                const power = force * force * 5;
                this.vx -= (dx / dist) * power;
                this.vy -= (dy / dist) * power;
            }
        }

        this.vx += (this.originX - this.x) * this.ease;
        this.vy += (this.originY - this.y) * this.ease;
        this.vx *= this.friction;
        this.vy *= this.friction;
        this.x += this.vx;
        this.y += this.vy;

        // Glitch effect (rare)
        this.glitchTimer--;
        if (this.glitchTimer <= 0) {
            if (Math.random() < 0.002) {
                this.glitchX = (Math.random() - 0.5) * 8;
                this.glitchY = (Math.random() - 0.5) * 3;
                this.glitchTimer = Math.floor(Math.random() * 4) + 1;
            } else {
                this.glitchX = 0;
                this.glitchY = 0;
            }
        }
    }
}

// Desenha todas as partículas em lotes por bucket de cor — muito mais rápido
function drawParticlesBatched() {
    if (particleArray.length === 0) return;

    // Agrupar por bucket
    const buckets = [[], []]; // 0=cyan, 1=blue-white
    for (let i = 0; i < particleArray.length; i++) {
        const p = particleArray[i];
        if (p.alpha < 0.01 || p.size < 0.3) continue;
        buckets[p.colorBucket].push(p);
    }

    const colors = [
        (a) => `rgba(0, 235, 255, ${a})`,
        (a) => `rgba(90, 215, 255, ${a})`,
    ];

    for (let b = 0; b < 2; b++) {
        const list = buckets[b];
        if (list.length === 0) continue;

        // Agrupar por alpha aproximado (arredonda a 0.05) para reduzir trocas de fillStyle
        // Para simplicidade, usar alpha médio do bucket
        const colorFn = colors[b];

        // Desenhar em sub-grupos de alpha para melhor aparência
        // Dividir em 4 níveis de alpha
        const alphaGroups = [[], [], [], []];
        for (const p of list) {
            const flicker = Math.sin(globalTime * p.flickerSpeed + p.flickerOffset) * 0.12 + 0.88;
            const a = Math.min(p.alpha * flicker, 1);
            const level = Math.min(3, Math.floor(a * 4));
            alphaGroups[level].push({ p, a });
        }

        for (let g = 0; g < 4; g++) {
            const group = alphaGroups[g];
            if (group.length === 0) continue;

            // Usa alpha médio do grupo para uma única fillStyle call
            const avgAlpha = (g + 0.5) / 4;
            ctx.fillStyle = colorFn(avgAlpha.toFixed(2));
            ctx.beginPath();

            for (const { p } of group) {
                const px = p.x + p.glitchX;
                const py = p.y + p.glitchY;
                ctx.moveTo(px + p.size, py);
                ctx.arc(px, py, p.size, 0, Math.PI * 2);
            }
            ctx.fill();
        }
    }
}

// ==========================================
// PARTÍCULAS DA BASE (ENERGIA ASCENDENTE)
// ==========================================
class BaseParticle {
    constructor(centerX, centerY) {
        const angle = Math.random() * Math.PI * 2;
        const radiusX = Math.random() * 110;
        const radiusY = Math.random() * 18;

        this.x = centerX + Math.cos(angle) * radiusX;
        this.y = centerY + Math.sin(angle) * radiusY;

        this.size = Math.random() * 2.0 + 0.3;
        this.speedY = Math.random() * 1.4 + 0.3;
        this.alpha = Math.random() * 0.7 + 0.2;
        this.fadeSpeed = Math.random() * 0.007 + 0.002;
        this.drift = (Math.random() - 0.5) * 0.4;
    }

    update() {
        this.y -= this.speedY;
        this.alpha -= this.fadeSpeed;
        this.x += this.drift;
    }
}

// Desenha base particles sem shadowBlur, em batch
function drawBaseParticlesBatched() {
    if (baseParticles.length === 0) return;
    ctx.fillStyle = 'rgba(0, 240, 255, 0.55)';
    ctx.beginPath();
    for (const p of baseParticles) {
        ctx.moveTo(p.x + p.size, p.y);
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    }
    ctx.fill();
}

// ==========================================
// PARTÍCULAS ORBITAIS
// ==========================================
class OrbitalParticle {
    constructor(cx, cy, radius) {
        this.cx = cx;
        this.cy = cy;
        this.radius = radius;
        this.angle = Math.random() * Math.PI * 2;
        this.speed = (Math.random() * 0.005 + 0.003) * (Math.random() < 0.5 ? 1 : -1);
        this.size = Math.random() * 1.8 + 0.4;
        this.alpha = Math.random() * 0.5 + 0.3;
        this.yScale = 0.3;
        this.pulseOffset = Math.random() * Math.PI * 2;
    }

    update() { this.angle += this.speed; }

    getPos() {
        return {
            x: this.cx + Math.cos(this.angle) * this.radius,
            y: this.cy + Math.sin(this.angle) * this.radius * this.yScale
        };
    }
}

function drawOrbitalsBatched() {
    if (orbitalParticles.length === 0) return;
    ctx.fillStyle = 'rgba(100, 230, 255, 0.5)';
    ctx.beginPath();
    for (const p of orbitalParticles) {
        const { x, y } = p.getPos();
        ctx.moveTo(x + p.size, y);
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
    }
    ctx.fill();
}

// ==========================================
// HUD
// ==========================================
function drawHUDRings(cx, cy) {
    const t = globalTime * 0.02;
    const rings = [
        { r: 160, dash: [6, 14], speed: 0.3,  alpha: 0.18 },
        { r: 185, dash: [2, 20], speed: -0.5, alpha: 0.12 },
        { r: 210, dash: [12, 8], speed: 0.2,  alpha: 0.08 },
    ];

    rings.forEach(ring => {
        ctx.save();
        ctx.translate(cx, cy + (image.height / 2) - 60);
        ctx.rotate(t * ring.speed);
        ctx.scale(1, 0.25);
        ctx.strokeStyle = `rgba(0, 220, 255, ${ring.alpha})`;
        ctx.lineWidth = 1;
        ctx.setLineDash(ring.dash);
        ctx.beginPath();
        ctx.arc(0, 0, ring.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    });
}

function drawBaseRing(cx, cy) {
    const t = globalTime * 0.02;
    const pulse = Math.sin(t * 3) * 0.1 + 0.9;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.18);

    // Gradiente radial — criado apenas quando há mudança real
    const gradient = ctx.createRadialGradient(0, 0, 60, 0, 0, 130);
    gradient.addColorStop(0, `rgba(0, 240, 255, ${(0.25 * pulse).toFixed(2)})`);
    gradient.addColorStop(0.6, `rgba(0, 180, 255, ${(0.1 * pulse).toFixed(2)})`);
    gradient.addColorStop(1, 'rgba(0, 100, 200, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 130, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(t);
    ctx.strokeStyle = `rgba(0, 240, 255, ${(0.5 * pulse).toFixed(2)})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, 100, 0, Math.PI * 2);
    ctx.stroke();

    ctx.rotate(-t * 1.7);
    ctx.strokeStyle = `rgba(100, 220, 255, ${(0.3 * pulse).toFixed(2)})`;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 12]);
    ctx.beginPath();
    ctx.arc(0, 0, 115, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.restore();
}

function drawCornerHUD() {
    const pulse = Math.sin(globalTime * 0.04) * 0.2 + 0.6;
    ctx.strokeStyle = `rgba(0, 220, 255, ${pulse.toFixed(2)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const corners = [
        [30, 30, 40, 40],
        [canvas.width - 30, 30, -40, 40],
        [30, canvas.height - 30, 40, -40],
        [canvas.width - 30, canvas.height - 30, -40, -40],
    ];

    for (const [x, y, lx, ly] of corners) {
        ctx.moveTo(x, y); ctx.lineTo(x + lx, y);
        ctx.moveTo(x, y); ctx.lineTo(x, y + ly);
    }
    ctx.stroke();
}

function drawHUDText() {
    const pulse = Math.sin(globalTime * 0.04) * 0.2 + 0.7;
    ctx.fillStyle = `rgba(0, 220, 255, ${(pulse * 0.55).toFixed(2)})`;
    ctx.font = '10px monospace';
    ctx.fillText('SYS::ACTIVE', 45, 45);
    ctx.fillText('FPS::LOCK', canvas.width - 110, 45);
    ctx.fillText('HOLO::v2.0', canvas.width - 110, canvas.height - 40);
    ctx.fillText('PWR::100%', 45, canvas.height - 40);
}

// ==========================================
// INIT
// ==========================================
// Samples a neighborhood of radius `r` pixels and returns the average
// alpha of those pixels (0–255). Used to determine how close to a border we are.
function sampleNeighborAlpha(pixels, px, py, pw, ph, r) {
    let total = 0;
    let count = 0;
    const step = Math.max(1, Math.floor(r / 3)); // sparse sampling — fast
    for (let sy = -r; sy <= r; sy += step) {
        for (let sx = -r; sx <= r; sx += step) {
            const nx = px + sx;
            const ny = py + sy;
            if (nx < 0 || ny < 0 || nx >= pw || ny >= ph) {
                // Outside image bounds counts as transparent
                total += 0;
            } else {
                total += pixels.data[(ny * pw + nx) * 4 + 3];
            }
            count++;
        }
    }
    return total / count; // 0..255
}

function init() {
    const startX = (canvas.width - image.width) / 2;
    const startY = (canvas.height - image.height) / 2 - 60;

    ctx.drawImage(image, startX, startY);
    const pixels = ctx.getImageData(startX, startY, image.width, image.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particleArray = [];
    baseParticles = [];

    // Neighborhood radius for edge detection (in image pixels)
    const edgeRadius = 12;

    for (let y = 0; y < pixels.height; y += gap) {
        for (let x = 0; x < pixels.width; x += gap) {
            const index = (y * pixels.width + x) * 4;
            const alpha = pixels.data[index + 3];
            if (alpha > 50) {
                const r = pixels.data[index];
                const g = pixels.data[index + 1];
                const b = pixels.data[index + 2];
                const brightness = r * 0.299 + g * 0.587 + b * 0.114;
                if (brightness > 30) {
                    // Compute how "interior" this pixel is (0=edge, 1=center)
                    const avgNeighborAlpha = sampleNeighborAlpha(
                        pixels, x, y, pixels.width, pixels.height, edgeRadius
                    );
                    // Map avg alpha → edgeFactor smoothly
                    // Full interior pixels have avg ~255, pure edge pixels ~100 or less
                    const edgeFactor = Math.min(1, Math.max(0, (avgNeighborAlpha - 80) / 140));

                    particleArray.push(new Particle(
                        startX + x, startY + y,
                        brightness,
                        startX + x, startY + y,
                        edgeFactor
                    ));
                }
            }
        }
    }

    // Orbital particles — reduzidos para 14
    const cx = canvas.width / 2;
    const cy = (canvas.height / 2) - 60;
    orbitalParticles = [];
    for (let i = 0; i < 14; i++) {
        orbitalParticles.push(new OrbitalParticle(cx, cy, 150 + Math.random() * 40));
    }

    buildGridCanvas();
}

image.onload = function() {
    init();
    animate();
};

// ==========================================
// ANIMATE — loop principal otimizado
// ==========================================
function animate() {
    globalTime++;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const baseX = canvas.width / 2;
    const baseY = (canvas.height / 2) + (image.height / 2) - 55;

    // 0. Grade estática (offscreen canvas — sem recalcular linhas)
    ctx.drawImage(gridCanvas, 0, 0);

    // 1. Cantos HUD + texto
    drawCornerHUD();
    drawHUDText();

    // 2. Anéis decorativos (apenas 3 arcos, sem shadowBlur)
    drawHUDRings(baseX, canvas.height / 2 - 60);

    // 3. Anel de energia na base
    drawBaseRing(baseX, baseY);

    // 4. Partículas da base — limite 30, batch render
    if (baseParticles.length < 30) {
        baseParticles.push(new BaseParticle(baseX, baseY));
    }
    for (let i = baseParticles.length - 1; i >= 0; i--) {
        baseParticles[i].update();
        if (baseParticles[i].alpha <= 0 || baseParticles[i].y < baseY - 200) {
            baseParticles.splice(i, 1);
        }
    }
    drawBaseParticlesBatched();

    // 5. Orbitais — update + batch draw
    for (let i = 0; i < orbitalParticles.length; i++) {
        orbitalParticles[i].update();
    }
    drawOrbitalsBatched();

    // 6. Partículas do rosto — update individual, draw em batch
    for (let i = 0; i < particleArray.length; i++) {
        // drift mínimo
        if (Math.random() > 0.97) {
            particleArray[i].x += (Math.random() - 0.5) * 0.4;
            particleArray[i].y += (Math.random() - 0.5) * 0.4;
        }
        particleArray[i].update();
    }
    drawParticlesBatched();

    requestAnimationFrame(animate);
}

window.addEventListener('resize', function() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    init();
});