'use client';

// HP2 · Kid reviews tab — PARENT ONLY (Helper Performance 2.0, D13 —
// approved 2026-08-23). "What the kids say" about one helper, newest
// week first: per kid the 4 faces, liked / change chips, note, when it
// was sent. Reads through the Admin gateway; the helper never sees this
// tab (it isn't even in their tab list) and the API answers 403 for them.

import { useCallback, useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import type { HelperLink } from '@/lib/firestore';
import { FACES } from '@/lib/kidReviewQuestions';

interface Review { childId: string; kidName: string; answers: number[]; pct: number; liked: string[]; change: string[]; note: string; submittedAt: number; updatedAt?: number }
interface Week { weekKey: string; from: string; to: string; label: string; pct: number | null; stars: string | null; count: number; eligible: number; reviews: Review[] }
interface Payload { ok: boolean; helper: { uid: string; name: string; preset: string }; questions: { id: string; text: string; labels: string[] }[]; eligibleKids: { id: string; name: string }[]; weeks: Week[] }

export default function KidReviewsTab({ helper }: { helper: HelperLink }) {
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'unavailable' | 'error'>('loading');
  const load = useCallback(async () => {
    setState('loading');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/helpers/kid-review?helperUid=${encodeURIComponent(helper.uid)}&weeks=8`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 503) { setState('unavailable'); return; }
      if (!res.ok) { setState('error'); return; }
      setData((await res.json()) as Payload); setState('ok');
    } catch { setState('error'); }
  }, [helper.uid]);
  useEffect(() => { load(); }, [load]);

  const first = helper.displayName.split(' ')[0];
  return (
    <div className="space-y-3">
      <div className="rounded-hive-lg bg-hive-navy text-white p-4">
        <p className="text-[10px] uppercase tracking-[2px] font-nunito font-extrabold opacity-80">{first} · Kid reviews</p>
        <h3 className="font-nunito font-black text-lg leading-tight mt-0.5">What the kids say</h3>
        <p className="text-[11px] opacity-90 mt-1">Only parents see this. {first} is never shown it.</p>
      </div>

      {state === 'loading' && <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 animate-pulse text-[12px] text-hive-muted">Loading reviews…</div>}
      {state === 'unavailable' && <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 text-[12px] text-hive-muted">Kid reviews aren&apos;t available on this preview (server not configured). They work on www.ourkaya.com.</div>}
      {state === 'error' && <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 text-[12px] text-hive-rose font-bold">Couldn&apos;t load reviews. <button type="button" onClick={load} className="underline">Retry</button></div>}

      {state === 'ok' && data && (
        <>
          {data.eligibleKids.length === 0 && (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 text-[12px] text-hive-muted">
              No kids are assigned to {first} yet — assign kids in Settings → Helpers and they&apos;ll be asked from Friday.
            </div>
          )}
          {data.weeks.map((w, i) => {
            const isCurrent = i === 0;
            const nobody = w.count === 0;
            return (
              <div key={w.weekKey} className={`rounded-hive-lg border p-4 ${nobody ? 'border-hive-line bg-hive-paper' : 'border-[#D9CCFA] bg-[#EFE8FF]'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-nunito font-black text-[13px]">Week {w.weekKey.split('-W')[1]} · {w.label}</p>
                  {w.pct !== null ? (
                    <span className="text-[10px] font-nunito font-extrabold bg-white/80 text-[#5A3CB8] px-2 py-0.5 rounded-full">{w.stars} {w.pct}% · {w.count} of {w.eligible}</span>
                  ) : (
                    <span className="text-[10px] font-nunito font-extrabold text-hive-muted">{isCurrent ? 'opens Friday · no reviews yet' : 'no reviews'}</span>
                  )}
                </div>
                {w.reviews.map((r) => (
                  <div key={r.childId} className="mt-2.5 text-[12px] leading-relaxed">
                    <p className="font-nunito font-extrabold">
                      👧 {r.kidName} <span className="text-hive-muted font-normal">· {new Date(r.submittedAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}{r.updatedAt && r.updatedAt !== r.submittedAt ? ' · edited' : ''}</span>
                    </p>
                    <p className="text-hive-ink">
                      {r.answers.map((a, qi) => (
                        <span key={qi} className="mr-2">{FACES[a]?.emoji ?? '·'} {data.questions[qi]?.labels[a] ?? ''}<span className="text-hive-muted"> {qi === 0 ? 'felt' : data.questions[qi]?.text.replace(/\?$/, '').replace(/^(Was|Did|Were) /, '').replace(`${first} `, '').toLowerCase()}</span></span>
                      ))}
                    </p>
                    {(r.liked.length > 0 || r.change.length > 0) && (
                      <p className="text-hive-muted">
                        {r.liked.length > 0 && <>liked: <em className="text-hive-ink">{r.liked.join(', ')}</em></>}
                        {r.liked.length > 0 && r.change.length > 0 && ' · '}
                        {r.change.length > 0 && <>change: <em className="text-hive-ink">{r.change.join(', ')}</em></>}
                      </p>
                    )}
                    {r.note && <p className="italic text-hive-ink">“{r.note}”</p>}
                  </div>
                ))}
                {!nobody && w.count < w.eligible && (
                  <p className="mt-2 text-[11px] text-hive-muted">
                    {data.eligibleKids.filter((k) => !w.reviews.some((r) => r.childId === k.id)).map((k) => k.name).join(', ')} — didn&apos;t review
                  </p>
                )}
              </div>
            );
          })}
          <p className="text-[10px] text-hive-muted italic">Kids answer Fri–Sun in their own Kaya login. A review you read here is a good moment for the 👍 strip on the Today tab.</p>
        </>
      )}
    </div>
  );
}
