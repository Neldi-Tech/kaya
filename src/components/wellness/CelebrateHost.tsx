"use client";
import { useEffect, useState } from "react";
import type { Celebration } from "./fx";

export default function CelebrateHost() {
  const [c, setC] = useState<Celebration | null>(null);
  useEffect(() => {
    function on(e: Event) {
      setC((e as CustomEvent<Celebration>).detail);
      setTimeout(() => setC(null), 1600);
    }
    window.addEventListener("kaya-wellness-celebrate", on);
    return () => window.removeEventListener("kaya-wellness-celebrate", on);
  }, []);
  if (!c) return null;
  return (
    <div className="wl-celebrate">
      <div className="wl-cbox">
        <div className="big">{c.big}</div>
        <h3>{c.title}</h3>
        <p>{c.msg}</p>
      </div>
    </div>
  );
}
