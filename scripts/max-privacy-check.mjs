#!/usr/bin/env node
// Kaya · Max-Privacy Mode — build-blocking smoke test.
//
// Runs as the npm `prebuild` step, so `npm run build` (the Vercel build
// command) executes it FIRST. Any violation exits non-zero, which fails the
// build and BLOCKS THE DEPLOY. This is the regression tripwire promised by
// MAX_PRIVACY_MODE_SHIPPED_AT: it makes the child-privacy guarantees a gate,
// not a comment that can quietly rot.
//
// It is a fast static scan (no test runner, no network) asserting four things:
//   1. No analytics / ad / session-replay tracker SDK appears anywhere in src.
//      Children's sessions must load none — and we forbid them app-wide, since
//      a kid surface could otherwise inherit one from a shared layout.
//   2. No component reads `navigator.geolocation` directly. Every location read
//      must funnel through src/lib/useGeolocation.ts, which hard-throws for kids.
//   3. That guarded hook exists AND still contains its kid-role throw.
//   4. The Max-Privacy constants (shipped stamp + child-log retention) are present.
//
// Keep this list current: when a new tracker or sensitive API is considered,
// add it here so the guard travels with the codebase.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SRC = join(ROOT, 'src');

// Files allowed to mention an otherwise-flagged token (the guard's own home).
const GEO_HOOK = join('src', 'lib', 'useGeolocation.ts');

// Tracker / ad / session-replay SDKs that must never enter the bundle.
// Each entry: a human label + a RegExp deliberately specific enough to avoid
// false positives on ordinary identifiers.
const TRACKER_PATTERNS = [
  ['Google Analytics / gtag', /gtag\(|googletagmanager\.com|google-analytics\.com|\bdataLayer\b/],
  ['Segment', /cdn\.segment\.com|analytics\.(track|identify|page)\(/],
  ['Mixpanel', /\bmixpanel\b/i],
  ['Amplitude', /\bamplitude\b/i],
  ['PostHog', /\bposthog\b/i],
  ['Facebook Pixel', /connect\.facebook\.net|fbevents|\bfbq\(/],
  ['DoubleClick / ads', /doubleclick\.net|googlesyndication|adservice\.google/],
  ['Hotjar', /\bhotjar\b|static\.hotjar/i],
  ['FullStory', /\bfullstory\b|fs\.identify/i],
  ['Heap', /heapanalytics|heap\.io/i],
  ['Microsoft Clarity', /clarity\.ms/],
  ['Matomo / Piwik', /\b_paq\b|matomo/i],
];

// Direct browser geolocation — must go through the guarded hook instead.
const GEO_DIRECT = /navigator\s*\.\s*geolocation/;

/** Recursively collect .ts / .tsx files under a dir. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];
function flag(msg) {
  violations.push(msg);
}

// ── 1 + 2: scan every source file ────────────────────────────────────────────
const files = existsSync(SRC) ? walk(SRC) : [];
for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  for (const [label, re] of TRACKER_PATTERNS) {
    lines.forEach((line, i) => {
      if (re.test(line)) {
        flag(`Tracker SDK forbidden in Max-Privacy Mode — ${label}\n      ${rel}:${i + 1}  ${line.trim()}`);
      }
    });
  }

  // Direct geolocation is only allowed inside the sanctioned guarded hook.
  if (rel !== GEO_HOOK.split(sep).join('/')) {
    lines.forEach((line, i) => {
      if (GEO_DIRECT.test(line)) {
        flag(`Direct navigator.geolocation must route through src/lib/useGeolocation.ts\n      ${rel}:${i + 1}  ${line.trim()}`);
      }
    });
  }
}

// ── 3: the guarded geolocation hook exists and still throws for kids ──────────
const hookPath = join(ROOT, GEO_HOOK);
if (!existsSync(hookPath)) {
  flag(`Missing guarded geolocation hook: ${GEO_HOOK.split(sep).join('/')}`);
} else {
  const hook = readFileSync(hookPath, 'utf8');
  const guardsKid = /role\s*===\s*'kid'/.test(hook) && /throw\s+new\s+GeolocationBlockedError/.test(hook);
  if (!guardsKid) {
    flag(`Geolocation hook no longer hard-throws for role === 'kid' (the Max-Privacy guard was stripped).`);
  }
}

// ── 4: Max-Privacy constants present ──────────────────────────────────────────
const constantsPath = join(ROOT, 'src', 'lib', 'coppa', 'constants.ts');
if (!existsSync(constantsPath)) {
  flag('Missing src/lib/coppa/constants.ts');
} else {
  const consts = readFileSync(constantsPath, 'utf8');
  if (!/MAX_PRIVACY_MODE_SHIPPED_AT/.test(consts)) {
    flag("MAX_PRIVACY_MODE_SHIPPED_AT was removed from constants.ts (it must never be removed).");
  }
  if (!/CHILD_LOG_RETENTION_DAYS/.test(consts)) {
    flag('CHILD_LOG_RETENTION_DAYS (30-day rolling deletion) was removed from constants.ts.');
  }
}

// ── report ────────────────────────────────────────────────────────────────────
if (violations.length > 0) {
  console.error('\n  ✖ Max-Privacy Mode check FAILED — build blocked.\n');
  for (const v of violations) console.error('    • ' + v);
  console.error(`\n  ${violations.length} violation(s). Fix the above before deploying.\n`);
  process.exit(1);
}

console.log(`  ✓ Max-Privacy Mode check passed (${files.length} source files scanned, no trackers, geolocation guarded).`);
