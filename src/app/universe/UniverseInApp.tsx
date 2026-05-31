"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Timestamp } from "firebase/firestore";
import styles from "./universeApp.module.css";
import HoneyPotIcon from "@/components/hive/HoneyPotIcon";
import {
  MODULES,
  GALAXY_PLANETS,
  TAG_LABELS,
  isSoon,
  type PlanetLayout,
} from "./universeData";
import { useAuth } from "@/contexts/AuthContext";
import { updateUserProfile } from "@/lib/firestore";

const TOTAL = MODULES.length;

export default function UniverseInApp() {
  const { user, profile, isGuest } = useAuth();

  const homeHref =
    profile?.role === "kid"
      ? "/kid"
      : profile?.role === "helper"
        ? "/helper"
        : "/home";
  const name = (profile?.displayName || user?.displayName || "You").trim();
  const initial = name.charAt(0).toUpperCase() || "K";

  const rootRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  // `explored` drives the progress bar + end-state copy + persistence.
  // The per-chapter / per-planet ✓ badges are applied imperatively (below)
  // so React never re-renders those nodes' className and clobbers the flash.
  const [explored, setExplored] = useState<Set<string>>(
    () => new Set(profile?.universeProgress?.exploredKeys ?? []),
  );
  const exploredRef = useRef(explored);

  // On mount, paint the ✓ badges for whatever was already explored.
  useEffect(() => {
    for (const key of exploredRef.current) {
      document.getElementById(`ch-${key}`)?.classList.add(styles.explored);
      rootRef.current
        ?.querySelector(`[data-module="${key}"]`)
        ?.classList.add(styles.explored);
    }
  }, []);

  const markExplored = useCallback(
    (key: string) => {
      if (exploredRef.current.has(key)) return;
      const next = new Set(exploredRef.current);
      next.add(key);
      exploredRef.current = next;
      setExplored(next);

      document.getElementById(`ch-${key}`)?.classList.add(styles.explored);
      rootRef.current
        ?.querySelector(`[data-module="${key}"]`)
        ?.classList.add(styles.explored);

      // Best-effort persist to the user's own doc (no-ops for guests).
      if (user && !isGuest) {
        updateUserProfile(user.uid, {
          universeProgress: {
            exploredKeys: Array.from(next),
            updatedAt: Timestamp.now(),
          },
        }).catch(() => {
          /* tour progress is non-critical — silently degrade */
        });
      }
    },
    [user, isGuest],
  );

  // Tap a planet — even mid-spin — to fly to its chapter, flash it, and
  // auto-mark it explored a beat later. The handler never checks `paused`.
  const goToChapter = (key: string, planet: HTMLButtonElement) => {
    planet.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.3)" },
        { transform: "scale(1)" },
      ],
      { duration: 400, easing: "ease-out" },
    );
    const target = document.getElementById(`ch-${key}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.remove(styles.flash);
    void target.offsetWidth; // force reflow so the flash animation re-fires
    target.classList.add(styles.flash);
    window.setTimeout(() => target.classList.remove(styles.flash), 1000);
    window.setTimeout(() => markExplored(key), 700);
  };

  const n = explored.size;
  const pct = (n / TOTAL) * 100;
  const countLabel =
    n === 0
      ? 'Tap planets or "Mark explored" to fill the bar'
      : n === TOTAL
        ? "🎉 Tour complete!"
        : `${TOTAL - n} chapters to go`;
  const endTitle = n === TOTAL ? "Tour complete! 🎉" : "The End… for now.";
  const endSub =
    n === TOTAL
      ? "You've met every planet in the Kaya Universe. Welcome home."
      : "New planets will light up as Kaya grows. Come back any time!";

  const renderPlanet = (p: PlanetLayout) => (
    <button
      key={p.key}
      type="button"
      className={styles.planet}
      style={p.style}
      data-module={p.key}
      onClick={(e) => goToChapter(p.key, e.currentTarget)}
      aria-label={`${p.label}${p.small ? ` — ${p.small}` : ""}: jump to its chapter`}
    >
      <span className={styles.ico}>{p.ico === "🍯" ? <HoneyPotIcon size={28} /> : p.ico}</span>
      {p.label}
      {p.small && <small>{p.small}</small>}
    </button>
  );

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.wrap}>
        {/* ===== STICKY TOP BAR ===== */}
        <div className={styles.topbar}>
          <Link href={homeHref} className={styles.backBtn} aria-label="Back to Home">
            ←
          </Link>
          <div className={styles.pageTitle}>
            The Kaya Universe <span className={styles.tourPill}>YOUR TOUR</span>
          </div>
          <div className={styles.profileChip}>
            <div className={styles.avatar} aria-hidden>
              {initial}
            </div>
            <span>{name}</span>
          </div>
        </div>

        {/* ===== TOUR PROGRESS ===== */}
        <div className={styles.tourProgress}>
          <div className={styles.label}>
            🚀 Tour: <span>{n}</span> of {TOTAL} explored
          </div>
          <div className={styles.bar}>
            <div className={styles.fill} style={{ width: `${pct}%` }} />
          </div>
          <div className={styles.count}>{countLabel}</div>
        </div>

        {/* ===== HERO ===== */}
        <div className={styles.hero}>
          <span className={styles.eyebrow}>
            <span className={styles.dot} />
            Welcome to your tour
          </span>
          <h1>
            The <span className={styles.accent}>Kaya Universe.</span>
          </h1>
          <p className={styles.lede}>
            A guided walk-through of every Kaya module — what&apos;s inside, why
            it matters, and how to start using it today.
          </p>
        </div>

        {/* ===== GALAXY ===== */}
        <div
          className={`${styles.galaxy} ${paused ? styles.paused : ""}`}
          id="galaxy"
        >
          <button
            type="button"
            className={styles.pauseBtn}
            onClick={() => setPaused((v) => !v)}
            aria-pressed={paused}
          >
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>

          <div className={`${styles.orbit} ${styles.orbit1}`}>
            {GALAXY_PLANETS.filter((p) => p.ring === 1).map(renderPlanet)}
          </div>
          <div className={`${styles.orbit} ${styles.orbit2}`}>
            {GALAXY_PLANETS.filter((p) => p.ring === 2).map(renderPlanet)}
          </div>

          <div className={styles.sunCore}>
            KAYA<small>home base</small>
          </div>

          <div className={styles.legend}>
            <span>
              <b>Tap a planet</b> — jump to that chapter
            </span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span className={styles.pill}>YOU ARE HERE</span>
          </div>
        </div>

        {/* ===== STORY BRIDGE ===== */}
        <div className={styles.storyBridge}>
          <h2>
            Your <em>Walk-Through</em>
          </h2>
          <p>
            Each chapter shows what&apos;s inside, a tip to try first, and a way
            to open the live module. Mark them explored as you go!
          </p>
          <div className={styles.arr}>↓</div>
        </div>

        {/* ===== STORYLINE TRAIL ===== */}
        <div className={styles.trail} id="trail">
          {MODULES.map((m) => {
            const soon = isSoon(m);
            const visibleTags = m.tags.filter(
              (t): t is "kid" | "parent" | "both" => t !== "soon",
            );
            return (
              <div className={styles.chapter} id={`ch-${m.key}`} key={m.key}>
                <div className={styles.marker} style={{ background: m.color }}>
                  {String(m.num).padStart(2, "0")}
                </div>
                <div className={styles.card}>
                  <div className={styles.stepTag}>
                    Step {m.num} of {TOTAL}
                  </div>
                  <div className={styles.cardHead}>
                    <div
                      className={styles.mascot}
                      style={{ background: m.bg }}
                      aria-hidden
                    >
                      {m.icon === "🍯" ? <HoneyPotIcon size={36} /> : m.icon}
                    </div>
                    <h3>
                      {m.name}{" "}
                      {soon && <span className={styles.soonPill}>SOON</span>}
                    </h3>
                  </div>
                  <p
                    className={styles.pitch}
                    dangerouslySetInnerHTML={{ __html: m.pitch }}
                  />
                  <div className={styles.featureList}>
                    <div className={styles.ftitle}>Inside you&apos;ll find</div>
                    <ul>
                      {m.features.map((f, i) => (
                        <li key={i}>
                          <span className={styles.dotLi} />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className={styles.tipLine}>
                    <span className={styles.tipEm}>🎯</span>
                    <span>
                      <b>Try this first</b>
                      {m.tip}
                    </span>
                  </div>
                  <div className={styles.tagRow}>
                    {visibleTags.map((t) => {
                      const tag = TAG_LABELS[t];
                      return (
                        <span
                          key={t}
                          className={`${styles.forTag} ${styles[tag.cls]}`}
                        >
                          {tag.label}
                        </span>
                      );
                    })}
                  </div>
                  <div className={styles.actionRow}>
                    {soon ? (
                      <button
                        type="button"
                        className={`${styles.openBtn} ${styles.soon}`}
                      >
                        🔔 Notify me when ready
                      </button>
                    ) : m.route ? (
                      <Link href={m.route} className={styles.openBtn}>
                        Open {m.name} →
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className={styles.exploreBtn}
                      onClick={() => markExplored(m.key)}
                    >
                      <span className={styles.check} />
                      Mark explored
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ===== THE END ===== */}
        <div className={styles.trailEnd}>
          <div className={styles.star}>⭐</div>
          <h3>{endTitle}</h3>
          <p>{endSub}</p>
          <Link href={homeHref} className={styles.backHome}>
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
