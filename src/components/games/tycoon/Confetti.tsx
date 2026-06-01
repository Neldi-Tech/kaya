'use client';

// Canvas confetti, ported from the prototype. Bursts whenever `signal`
// changes (the orchestrator increments it on a 'confetti' event).

import { useEffect, useRef } from 'react';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; col: string; sz: number; rot: number }
const COLORS = ['#6B3FE0', '#FF6B6B', '#2DD4BF', '#FFC93C', '#FF8FB1', '#7DD3FC', '#2ecc71'];

export default function Confetti({ signal }: { signal: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const parts = useRef<Particle[]>([]);
  const running = useRef(false);

  useEffect(() => {
    if (signal <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const cx = window.innerWidth * (window.innerWidth > 760 ? 0.32 : 0.5);
    const cy = window.innerHeight * 0.4;
    for (let i = 0; i < 70; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 8;
      parts.current.push({
        x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3,
        life: 60 + Math.random() * 30, col: COLORS[i % COLORS.length], sz: 4 + Math.random() * 5, rot: Math.random() * 6,
      });
    }
    if (running.current) return;
    running.current = true;
    const tick = () => {
      const w = window.innerWidth; const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      parts.current = parts.current.filter((p) => p.life > 0);
      parts.current.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.life -= 1; p.rot += 0.2;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.col; ctx.globalAlpha = Math.min(1, p.life / 30);
        ctx.fillRect(-p.sz / 2, -p.sz / 2, p.sz, p.sz * 1.6); ctx.restore();
      });
      if (parts.current.length) { requestAnimationFrame(tick); }
      else { ctx.clearRect(0, 0, w, h); running.current = false; }
    };
    requestAnimationFrame(tick);
  }, [signal]);

  return <canvas ref={canvasRef} className="kt-fx" aria-hidden />;
}
