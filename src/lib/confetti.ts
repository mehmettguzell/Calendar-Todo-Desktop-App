/**
 * Lightweight, zero-dependency canvas confetti explosion generator.
 */

interface Particle {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  wobble: number;
  wobbleSpeed: number;
  opacity: number;
  drag: number;
  gravity: number;
}

const CONFETTI_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#eab308",
  "#6366f1",
];

let activeCanvas: HTMLCanvasElement | null = null;
let animationFrameId: number | null = null;

export function fireConfetti(options?: {
  particleCount?: number;
  origin?: { x: number; y: number };
  durationMs?: number;
}): void {
  if (typeof window === "undefined") return;

  const count = options?.particleCount ?? 80;
  const durationMs = options?.durationMs ?? 3000;

  // Re-use or create canvas
  let canvas = activeCanvas;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "999999";
    document.body.appendChild(canvas);
    activeCanvas = canvas;
  }

  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    return;
  }
  if (!ctx) return;

  canvas.width = window.innerWidth * window.devicePixelRatio;
  canvas.height = window.innerHeight * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const particles: Particle[] = [];
  const startX = options?.origin
    ? options.origin.x * window.innerWidth
    : window.innerWidth / 2;
  const startY = options?.origin
    ? options.origin.y * window.innerHeight
    : window.innerHeight * 0.45;

  // Create burst
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 6 + Math.random() * 14;
    const color =
      CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] ??
      "#3b82f6";

    particles.push({
      x: startX + (Math.random() - 0.5) * 40,
      y: startY + (Math.random() - 0.5) * 40,
      w: 8 + Math.random() * 6,
      h: 5 + Math.random() * 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4, // slight upward boost
      color,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 12,
      wobble: Math.random() * 10,
      wobbleSpeed: 0.1 + Math.random() * 0.1,
      opacity: 1,
      drag: 0.95 + Math.random() * 0.03,
      gravity: 0.28 + Math.random() * 0.15,
    });
  }

  const startTime = performance.now();

  function render(time: number) {
    if (!ctx || !canvas) return;
    const elapsed = time - startTime;
    const progress = elapsed / durationMs;

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    let aliveCount = 0;

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity;
      p.rotation += p.rotationSpeed;
      p.wobble += p.wobbleSpeed;

      if (progress > 0.6) {
        p.opacity = Math.max(0, 1 - (progress - 0.6) / 0.4);
      }

      if (p.opacity > 0.01 && p.y < window.innerHeight + 50) {
        aliveCount++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.scale(Math.cos(p.wobble), 1);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    }

    if (aliveCount > 0 && progress < 1) {
      animationFrameId = requestAnimationFrame(render);
    } else {
      cleanup();
    }
  }

  function cleanup() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (activeCanvas) {
      if (activeCanvas.parentNode) {
        activeCanvas.parentNode.removeChild(activeCanvas);
      }
      activeCanvas = null;
    }
  }

  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(render);
}
