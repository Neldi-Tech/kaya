// Kaya Wellness — confetti + celebration effects (client-only DOM helpers).
const COLORS = ["#6C4AB6", "#FF6B6B", "#1FB6A6", "#F9A826"];

export function burst(count = 26) {
  if (typeof document === "undefined") return;
  let host = document.querySelector<HTMLDivElement>(".wl-confetti");
  if (!host) {
    host = document.createElement("div");
    host.className = "wl-confetti";
    document.body.appendChild(host);
  }
  for (let i = 0; i < count; i++) {
    const c = document.createElement("div");
    c.className = "wl-cf";
    c.style.left = Math.random() * 100 + "vw";
    c.style.top = 20 + Math.random() * 30 + "vh";
    c.style.background = COLORS[i % COLORS.length];
    c.style.animationDelay = Math.random() * 0.3 + "s";
    host.appendChild(c);
    setTimeout(() => c.remove(), 1300);
  }
}

export type Celebration = { big: string; title: string; msg: string };

export function celebrate(big: string, title: string, msg: string) {
  if (typeof window === "undefined") return;
  burst();
  window.dispatchEvent(
    new CustomEvent<Celebration>("kaya-wellness-celebrate", { detail: { big, title, msg } })
  );
}
