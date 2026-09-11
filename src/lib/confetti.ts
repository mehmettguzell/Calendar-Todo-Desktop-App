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

/** A full-viewport overlay, created once and re-used by later bursts. */
function overlayCanvas(): HTMLCanvasElement {
  if (activeCanvas) return activeCanvas;
  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "999999";
  document.body.appendChild(canvas);
  activeCanvas = canvas;
  return canvas;
}

function burstFrom(count: number, startX: number, startY: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 6 + Math.random() * 14;
    particles.push({
      x: startX + (Math.random() - 0.5) * 40,
      y: startY + (Math.random() - 0.5) * 40,
      w: 8 + Math.random() * 6,
      h: 5 + Math.random() * 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4, // slight upward boost
      color:
        CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] ??
        "#3b82f6",
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 12,
      wobble: Math.random() * 10,
      wobbleSpeed: 0.1 + Math.random() * 0.1,
      opacity: 1,
      drag: 0.95 + Math.random() * 0.03,
      gravity: 0.28 + Math.random() * 0.15,
    });
  }
  return particles;
}

/** Move one piece on by a frame and fade it out over the last 40% of the run. */
function step(p: Particle, progress: number): void {
  p.x += p.vx;
  p.y += p.vy;
  p.vx *= p.drag;
  p.vy = p.vy * p.drag + p.gravity;
  p.rotation += p.rotationSpeed;
  p.wobble += p.wobbleSpeed;
  if (progress > 0.6) p.opacity = Math.max(0, 1 - (progress - 0.6) / 0.4);
}

function paint(ctx: CanvasRenderingContext2D, p: Particle): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate((p.rotation * Math.PI) / 180);
  ctx.scale(Math.cos(p.wobble), 1);
  ctx.globalAlpha = p.opacity;
  ctx.fillStyle = p.color;
  ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  ctx.restore();
}

function removeOverlay(): void {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  activeCanvas?.parentNode?.removeChild(activeCanvas);
  activeCanvas = null;
}

/** Run the burst to its end, then take the overlay back down. */
function animate(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  durationMs: number,
): void {
  const startTime = performance.now();
  const render = (time: number) => {
    const progress = (time - startTime) / durationMs;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    let alive = 0;
    for (const p of particles) {
      step(p, progress);
      if (p.opacity > 0.01 && p.y < window.innerHeight + 50) {
        alive += 1;
        paint(ctx, p);
      }
    }

    if (alive > 0 && progress < 1) animationFrameId = requestAnimationFrame(render);
    else removeOverlay();
  };
  animationFrameId = requestAnimationFrame(render);
}

/** A context sized to the viewport, or null where canvas is unavailable. */
function sizedContext(): CanvasRenderingContext2D | null {
  const canvas = overlayCanvas();
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (!ctx) return null;

  canvas.width = window.innerWidth * window.devicePixelRatio;
  canvas.height = window.innerHeight * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  return ctx;
}

export interface ConfettiOptions {
  particleCount?: number;
  /** Where the burst starts, as a fraction of the viewport. */
  origin?: { x: number; y: number };
  durationMs?: number;
}

export function fireConfetti({
  particleCount = 80,
  origin = { x: 0.5, y: 0.45 },
  durationMs = 3000,
}: ConfettiOptions = {}): void {
  if (typeof window === "undefined") return;
  const paintOn = sizedContext();
  if (!paintOn) return;

  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animate(
    paintOn,
    burstFrom(
      particleCount,
      origin.x * window.innerWidth,
      origin.y * window.innerHeight,
    ),
    durationMs,
  );
}
