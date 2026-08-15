'use client';

// Kaya Sparks · 🎬 the Baseline callout.
//
// The baseline was the least clear moment in the whole quest: a marker
// with no readings just looked like an empty row, and nobody knew that
// the FIRST reading is the one everything else gets measured against.
//
// So it stops being a side-effect of "record a reading" and becomes an
// explicit step zero — named, explained, and impossible to walk past
// without knowing what it's for.

import Link from 'next/link';
import { markerTrend, type Quest, type MarkerReading } from '@/lib/sparks/quests';

export default function BaselineCallout({ quest, readings, kidName, isParent }: {
  quest: Quest;
  readings: MarkerReading[];
  kidName: string;
  isParent: boolean;
}) {
  const markers = quest.markers ?? [];
  if (markers.length === 0) {
    // A quest with no markers can measure consistency but not growth —
    // worth saying out loud rather than silently offering less.
    if (!isParent) return null;
    return (
      <div className="mt-3 rounded-[16px] border border-dashed border-[#E8D9B5] bg-[#FFFBF0] p-4">
        <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
          📈 No markers on this quest
        </div>
        <p className="text-[12px] text-[#5A6488] mt-1 mb-0 leading-relaxed">
          You&apos;ll be able to see whether {kidName} <strong>showed up</strong>, but not whether
          they <strong>got better</strong>. Add a marker in the quest settings and Kaya will capture
          a starting point you can measure everything against.
        </p>
      </div>
    );
  }

  const missing = markers.filter((m) => markerTrend(readings, m.id).series.length === 0);
  if (missing.length === 0) return null;

  const allMissing = missing.length === markers.length;

  return (
    <div
      className="mt-3 rounded-[16px] p-4 text-white"
      style={{ background: `linear-gradient(135deg, ${quest.colour} 0%, #8A6800 170%)` }}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-2xl leading-none" aria-hidden>🎬</span>
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold tracking-[1.5px] opacity-85">
            STEP ZERO
          </div>
          <div className="font-display font-extrabold text-[15.5px] leading-tight">
            {allMissing ? 'Capture the starting line first' : 'One marker still has no starting line'}
          </div>
          <p className="text-[12.5px] opacity-95 mt-1.5 mb-0 leading-relaxed">
            The <strong>first</strong> reading of a marker becomes the <strong>baseline</strong> —
            the thing every later reading is compared against. Do it before the practice starts, not
            after, or there&apos;s nothing to measure the change from.
          </p>
          <p className="text-[12px] opacity-90 mt-2 mb-0 leading-relaxed">
            Record it with a clip if you can: in eight weeks {kidName} plays the first one back, and
            that is the moment the whole thing pays off. It only takes a minute, and it can never be
            captured again later.
          </p>

          <ul className="m-0 mt-2.5 pl-0 list-none grid gap-1">
            {missing.map((m) => (
              <li key={m.id} className="text-[12px] opacity-95 flex items-center gap-2">
                <span aria-hidden>·</span>
                <span className="font-bold">{m.label}</span>
                <span className="opacity-80">
                  {m.kind === 'rubric' ? '0–100' : m.kind === 'stars' ? '⭐ parent rating' : m.unit || 'count'}
                </span>
              </li>
            ))}
          </ul>

          <div className="text-[11.5px] opacity-85 mt-2.5">
            Scroll to <strong>📈 Growth</strong> below and tap{' '}
            <strong>🎬 Baseline</strong> on {missing.length === 1 ? 'that marker' : 'each marker'}.
          </div>
        </div>
      </div>
    </div>
  );
}

/** The same explanation, in the New Quest wizard, so a parent knows the
 *  baseline is coming before they've even finished setting up. */
export function BaselineWizardNote({ kidName }: { kidName: string }) {
  return (
    <div className="rounded-xl border border-[#E8D9B5] bg-[#FFFBF0] p-3.5">
      <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44] mb-1">
        🎬 What happens right after you create this
      </div>
      <p className="text-[11.5px] text-[#5A6488] leading-relaxed m-0">
        Kaya asks {kidName} to record each marker <strong>once, before any practice</strong>. That
        first reading is the <strong>baseline</strong> — the starting line everything else is
        measured against, and the recording they&apos;ll play back in a few weeks. Attach audio or
        video to it if you can; it&apos;s the single most convincing thing in the whole quest, and
        it can only be captured at the start.
      </p>
    </div>
  );
}

/** Nudge shown on the Growth panel's record form for a first reading. */
export function BaselineHint({ kidName }: { kidName: string }) {
  return (
    <p className="text-[11px] text-[#8A6800] mt-2 mb-0 leading-snug">
      🎬 This is the <strong>baseline</strong> — the starting line every later reading is compared
      against. It&apos;s recorded once and can&apos;t be re-declared, so take it before the practice
      starts. Attach a clip if you can: in a few weeks {kidName} plays it back, and that&apos;s the
      moment this all pays off.
    </p>
  );
}

/** A quick link out to the Growth panel. */
export function BaselineJump({ href }: { href: string }) {
  return (
    <Link href={href} className="text-[11.5px] font-extrabold underline">
      Go to Growth →
    </Link>
  );
}
