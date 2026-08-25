'use client';

// 🤝 Helper Recognition — the 5-dial scorecard (HR PR-1, approved
// 16-Aug design). Blends the HP2 snapshot metrics with two NEW dials
// computed from the family's rating docs:
//
//   🎯 Strictness   — rating honesty. All-Excellent every day is
//                     rubber-stamping; honest differentiation scores
//                     high. exShare ≤ 80% → 100, linearly down to 20
//                     at 100% Excellent. Needs ≥10 rated routines.
//   📅 Consistency  — HP2 ratingCompletion (fill rate of their slots).
//   🧹 Workplan     — HP2 workplan pct.
//   ✍️ Corrections  — Elia's dial: % of BAD ratings carrying a note
//                     that teaches (per-routine note or day comment,
//                     ≥ 8 chars). No bad ratings = dial rests (null).
//   💬 Kids' voice  — HP2 kidReview pct (the Fri–Sun reviews).
//
// Helper Score = weighted blend (25/25/20/15/15), null dials excluded
// with weights renormalised — same convention as HP2's own weights.

import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from './firebase';

export interface HelperDials {
  strictness: number | null;
  consistency: number | null;
  workplan: number | null;
  corrections: number | null;
  kidsVoice: number | null;
  score: number | null;
  facts: {
    rated: number;
    excellent: number;
    good: number;
    bad: number;
    badWithNote: number;
    weeks: number;
  };
}

export const DIAL_META: Array<{ key: keyof Omit<HelperDials, 'score' | 'facts'>; emoji: string; label: string; weight: number; blurb: string }> = [
  { key: 'strictness',  emoji: '🎯', label: 'Strictness',        weight: 25, blurb: 'Honest ratings — not rubber-stamped Excellents.' },
  { key: 'consistency', emoji: '📅', label: 'Consistency',       weight: 25, blurb: 'Their rating slots filled, day after day.' },
  { key: 'workplan',    emoji: '🧹', label: 'Workplan',          weight: 20, blurb: 'Tasks done on time.' },
  { key: 'corrections', emoji: '✍️', label: 'Correction quality', weight: 15, blurb: 'Bad ratings carry notes that teach the kids.' },
  { key: 'kidsVoice',   emoji: '💬', label: "Kids' voice",       weight: 15, blurb: 'What the kids said in their Fri–Sun reviews.' },
];

type SnapshotLite = {
  settled?: boolean;
  metrics?: {
    workplan?: { pct?: number | null };
    ratingCompletion?: { pct?: number | null };
    kidReview?: { pct?: number | null; count?: number };
  };
};

/** Fetch the HP2 snapshots for a helper (running + settled weeks). */
async function fetchSnapshots(helperUid: string, weeks = 4): Promise<SnapshotLite[]> {
  const u = auth.currentUser;
  if (!u) return [];
  const token = await u.getIdToken();
  const res = await fetch(`/api/helpers/perf-weeks?helperUid=${encodeURIComponent(helperUid)}&weeks=${weeks}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const list: SnapshotLite[] = [];
  if (data.current) list.push(data.current);
  for (const w of data.weeks || data.snapshots || []) list.push(w);
  return list;
}

const meanPct = (vals: Array<number | null | undefined>): number | null => {
  const ok = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return ok.length ? Math.round(ok.reduce((s, v) => s + v, 0) / ok.length) : null;
};

export async function computeHelperDials(
  familyId: string,
  helperUid: string,
  days = 28,
): Promise<HelperDials> {
  // ── HP2 dials from the snapshots ────────────────────────────────
  const snaps = await fetchSnapshots(helperUid).catch(() => [] as SnapshotLite[]);
  const workplan = meanPct(snaps.map((s) => s.metrics?.workplan?.pct));
  const consistency = meanPct(snaps.map((s) => s.metrics?.ratingCompletion?.pct));
  const kidsVoice = meanPct(snaps.map((s) =>
    (s.metrics?.kidReview?.count || 0) > 0 ? s.metrics?.kidReview?.pct : null));

  // ── The two NEW dials from raw ratings ──────────────────────────
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const snap = await getDocs(query(collection(db, 'families', familyId, 'ratings'), where('date', '>=', from)));
  let rated = 0, excellent = 0, good = 0, bad = 0, badWithNote = 0;
  for (const d of snap.docs) {
    const r = d.data() as {
      ratedBy?: string;
      ratings?: Record<string, string>;
      notes?: Record<string, string>;
      comment?: string;
    };
    if (r.ratedBy !== helperUid) continue;
    const dayComment = (r.comment || '').trim();
    for (const [rid, v] of Object.entries(r.ratings || {})) {
      if (v === 'skip') continue;
      rated++;
      if (v === 'excellent') excellent++;
      else if (v === 'good') good++;
      else if (v === 'bad') {
        bad++;
        const note = (r.notes?.[rid] || '').trim();
        if (note.length >= 8 || dayComment.length >= 8) badWithNote++;
      }
    }
  }

  let strictness: number | null = null;
  if (rated >= 10) {
    const exShare = excellent / rated;
    strictness = exShare <= 0.8 ? 100 : Math.max(20, Math.round(100 - ((exShare - 0.8) / 0.2) * 80));
  }
  const corrections = bad > 0 ? Math.round((badWithNote / bad) * 100) : null;

  // ── Composite (null dials excluded, weights renormalised) ───────
  const dials: Record<string, number | null> = { strictness, consistency, workplan, corrections, kidsVoice };
  let wSum = 0, acc = 0;
  for (const m of DIAL_META) {
    const v = dials[m.key];
    if (v === null || v === undefined) continue;
    wSum += m.weight;
    acc += v * m.weight;
  }
  const score = wSum > 0 ? Math.round(acc / wSum) : null;

  return {
    strictness, consistency, workplan, corrections, kidsVoice, score,
    facts: { rated, excellent, good, bad, badWithNote, weeks: snaps.length },
  };
}

export const dialColor = (v: number | null): string =>
  v === null ? '#C9C0AE' : v >= 85 ? '#2E9E5B' : v >= 65 ? '#D4A017' : '#E06A7B';

// ── 💬 Kids' words (HR PR-4) ──────────────────────────────────────
// The kids' own review lines about a helper — free-text notes first,
// then the "liked" chips — for stamping on the Asante card.

export interface KidWord { text: string; kidName: string }

export async function fetchKidWords(familyId: string, helperUid: string, weeks = 8): Promise<KidWord[]> {
  const u = auth.currentUser;
  if (!u) return [];
  const token = await u.getIdToken();
  const res = await fetch(
    `/api/helpers/kid-review?familyId=${encodeURIComponent(familyId)}&helperUid=${encodeURIComponent(helperUid)}&weeks=${weeks}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const out: KidWord[] = [];
  const seen = new Set<string>();
  const push = (text: string, kidName: string) => {
    const t = text.trim();
    const key = `${t.toLowerCase()}|${kidName}`;
    if (!t || seen.has(key)) return;
    seen.add(key);
    out.push({ text: t.slice(0, 100), kidName });
  };
  for (const w of (data.weeks || []) as Array<{ reviews?: Array<{ kidName?: string; note?: string; liked?: string[] }> }>) {
    for (const r of w.reviews || []) {
      const name = (r.kidName || 'Kid').split(' ')[0];
      if (r.note) push(r.note, name);
      for (const l of r.liked || []) push(l, name);
    }
  }
  return out.slice(0, 8);
}
