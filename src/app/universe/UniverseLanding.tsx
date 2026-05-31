"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./universe.module.css";
import HoneyPotIcon from "@/components/hive/HoneyPotIcon";
import {
  MODULES,
  GALAXY_PLANETS,
  TAG_LABELS,
  isSoon,
  type PlanetLayout,
} from "./universeData";
import {
  AUDIENCE_CARDS,
  AUDIENCE_EYEBROW,
  AUDIENCE_LEDE,
  AUDIENCE_TITLE,
  AUDIENCE_USES,
  AUDIENCE_USES_TITLE,
} from "@/lib/audienceCopy";

// Closed-beta conversion paths (no /welcome route exists):
//   START  → /#letter  (FamilyLetterSignup waitlist on the marketing home)
//   SIGNIN → /login
const START = "/#letter";
const SIGNIN = "/login";

export default function UniverseLanding() {
  const [paused, setPaused] = useState(false);

  // Elia's note: a planet stays selectable even while the orbit is rolling.
  // The handler never checks `paused` — a tap works mid-spin and flies the
  // reader to the matching storyline chapter.
  const goToChapter = (key: string, planet?: HTMLButtonElement) => {
    if (planet) {
      planet.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.3)" },
          { transform: "scale(1)" },
        ],
        { duration: 400, easing: "ease-out" },
      );
    }
    const target = document.getElementById(`ch-${key}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.remove(styles.flash);
    void target.offsetWidth; // force reflow so the flash animation re-fires
    target.classList.add(styles.flash);
    window.setTimeout(() => target.classList.remove(styles.flash), 1000);
  };

  const renderPlanet = (p: PlanetLayout) => (
    <button
      key={p.key}
      type="button"
      className={styles.planet}
      style={p.style}
      onClick={(e) => goToChapter(p.key, e.currentTarget)}
      aria-label={`${p.label}${p.small ? ` — ${p.small}` : ""}: read its story`}
    >
      <span className={styles.ico}>{p.ico === "🍯" ? <HoneyPotIcon size={28} /> : p.ico}</span>
      {p.label}
      {p.small && <small>{p.small}</small>}
    </button>
  );

  return (
    <div className={styles.root}>
      <div className={styles.wrap}>
        {/* ===== NAV ===== */}
        <nav className={styles.nav}>
          <Link href="/" className={styles.brand}>
            <span className={styles.logo}>K</span> Kaya
          </Link>
          <div className={styles.navLinks}>
            <Link href="/">Home</Link>
            <a href="#galaxy" className={styles.active}>
              The Universe
            </a>
            <a href="#story">For Parents</a>
            <a href="#story">For Kids</a>
            <a href="#story">Pricing</a>
          </div>
          <div className={styles.navCta}>
            <Link href={SIGNIN} className={styles.signin}>
              Sign in
            </Link>
            <Link href={START} className={styles.tryBtn}>
              Try Kaya — free
            </Link>
          </div>
        </nav>

        {/* ===== HERO ===== */}
        <div className={styles.hero}>
          <span className={styles.eyebrow}>
            <span className={styles.dot} />
            Discover what&apos;s inside Kaya
          </span>
          <h1 className={styles.h1}>
            The <span className={styles.accent}>Kaya Universe.</span>
          </h1>
          <p className={styles.lede}>
            A whole family world in one app — points, money, dreams, business,
            home, and more. Tap a planet to meet each module.
          </p>
          <div className={styles.heroCta}>
            <Link href={START} className={styles.primary}>
              Start free →
            </Link>
            <a href="#story" className={styles.secondary}>
              Take the tour
            </a>
          </div>
          <div className={styles.trustBar}>
            <span>✨ Free to start</span>
            <span>🔒 Family-private</span>
            <span>🌍 Works anywhere</span>
          </div>
        </div>

        {/* ===== AUDIENCE — who Kaya is for (2026-05-29) =====
            Same shared copy as the marketing landing — adapted to the
            universe page's joy palette. Sits between Hero and Galaxy so
            visitors get the "is this for me?" answer before exploring
            the modules. */}
        <section className={styles.audience}>
          <div className={styles.audienceHead}>
            <span className={styles.audienceEyebrow}>{AUDIENCE_EYEBROW}</span>
            <h2 className={styles.audienceTitle}>{AUDIENCE_TITLE}</h2>
            <p className={styles.audienceLede}>{AUDIENCE_LEDE}</p>
          </div>
          <div className={styles.audienceGrid}>
            {AUDIENCE_CARDS.map((c) => (
              <div key={c.title} className={styles.audienceCard}>
                <div className={styles.audienceEm}>{c.em}</div>
                <h3 className={styles.audienceCardTitle}>{c.title}</h3>
                <p className={styles.audienceCardBody}>{c.body}</p>
              </div>
            ))}
          </div>
          <div className={styles.audienceUseStrip}>
            <h3 className={styles.audienceUseHead}>{AUDIENCE_USES_TITLE}</h3>
            <ul className={styles.audienceUseList}>
              {AUDIENCE_USES.map((u) => (
                <li key={u.strong}>
                  <span className={styles.audienceUseEm}>{u.em}</span>
                  <span>
                    <strong>{u.strong}</strong> — {u.body}
                  </span>
                </li>
              ))}
            </ul>
            <div className={styles.audienceUseCloser}>
              That&apos;s it. The system holds the rest.{" "}
              <em>If that&apos;s the kind of family you want to be — Kaya is for you.</em>
            </div>
          </div>
        </section>

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
              <b>Tap a planet</b> — read its story below
            </span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span className={styles.pill}>13 PLANETS</span>
          </div>
        </div>

        {/* ===== STORY BRIDGE ===== */}
        <div className={styles.storyBridge} id="story">
          <h2>
            The Kaya <em>Storyline</em>
          </h2>
          <p>
            One chapter for every module. Read it like a book — or use the
            planets above to fly straight to your favourite.
          </p>
          <div className={styles.arr}>↓</div>
        </div>

        {/* ===== STORYLINE TRAIL ===== */}
        <div className={styles.trail}>
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
                    dangerouslySetInnerHTML={{ __html: m.webPitch }}
                  />
                  <div className={styles.whyLine}>
                    <span className={styles.whyEmoji}>💡</span>
                    <span>
                      <b>Why it matters</b>
                      {m.webWhy}
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
                  <div>
                    {soon ? (
                      <Link
                        href={START}
                        className={`${styles.joinBtn} ${styles.soon}`}
                      >
                        🔔 Notify me when ready
                      </Link>
                    ) : (
                      <Link href={START} className={styles.joinBtn}>
                        Sign up to unlock →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ===== CTA STRIP ===== */}
        <div className={styles.ctaStrip}>
          <h3>Ready to bring your home together?</h3>
          <p>
            Start with Kaya core. Add modules as your family grows. Free to
            begin and built to last.
          </p>
          <div className={styles.actions}>
            <Link href={START} className={`${styles.btn} ${styles.btnPrimary}`}>
              Start free →
            </Link>
            <a href="#story" className={`${styles.btn} ${styles.btnGhost}`}>
              Read the launch story
            </a>
          </div>
        </div>
      </div>

      {/* ===== FOOTER ===== */}
      <div className={styles.wrapNarrow}>
        <footer className={styles.siteFooter}>
          <div>© Kaya — ourkaya.com</div>
          <div className={styles.links}>
            <a href="#">About</a>
            <a href="#">Privacy</a>
            <a href="#">Contact</a>
            <a href="#">@ourkaya.app</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
