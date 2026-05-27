'use client';

// Kaya Sparks · Sports & Activities (/sparks/[kidId]/sports).
// Mockup detail screen styled per `head-mint`. Each subscription
// renders as the "sport-row" — cream card with title + status pill +
// progress bar + meta line. Slice 2 captures the subscription as a
// sparks_items entry (area = 'sports_subscription'); Slice 3 wires
// session-by-session tracking + auto-expiry alerts at T-14/T-7/T-1.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  bumpSportsSession, setSportsPlanned,
  subscribeToAreaItems, subscribeToSparksProfile,
} from '@/lib/sparks/firestore';
import type { SparksItem, SparksProfile } from '@/lib/sparks/schema';
import { toDisplayDate } from '@/lib/dates';
import AreaScreen, { AddItemButton, AreaEmptyState } from '@/components/sparks/AreaScreen';
import CaptureSheet from '@/components/sparks/CaptureSheet';

// Per-row progress accent — cycles through coral / mint / purple so the
// wall reads varied even before per-session tracking lands.
const ROW_ACCENTS = ['#FF6B6B', '#4ECDC4', '#A66CFF'];

export default function SportsPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const { profile: authProfile } = useAuth();
  const { children } = useFamily();
  const familyId = authProfile?.familyId;
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [items, setItems] = useState<SparksItem[]>([]);
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [openCapture, setOpenCapture] = useState(false);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToAreaItems(familyId, kidId, 'sports_subscription', setItems);
  }, [familyId, kidId]);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToSparksProfile(familyId, kidId, setProfile);
  }, [familyId, kidId]);

  if (!familyId || !kid) {
    return <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#5A6488] text-sm">Loading…</div>;
  }

  return (
    <>
      <AreaScreen
        kidId={kidId}
        kidName={kid.name}
        area="sports_subscription"
        subtitle={items.length === 0 ? 'No subscriptions yet' : `${items.length} active`}
        action={
          <AddItemButton onClick={() => setOpenCapture(true)} label="+ New" />
        }
      >
        {items.length === 0 ? (
          <AreaEmptyState
            emoji="⚽"
            title="Track every activity"
            body={`Football, swimming, art class — log it here so renewals never sneak up.`}
            action={
              <button
                type="button"
                onClick={() => setOpenCapture(true)}
                className="inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px]"
                style={{ background: '#1E7873', color: '#fff' }}
              >
                + Add a subscription
              </button>
            }
          />
        ) : (
          <div className="space-y-2.5 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3">
            {items.map((it, idx) => (
              <SportsRow
                key={it.id}
                item={it}
                accent={ROW_ACCENTS[idx % ROW_ACCENTS.length]}
                familyId={familyId}
              />
            ))}
          </div>
        )}
      </AreaScreen>

      <CaptureSheet
        open={openCapture}
        onClose={() => setOpenCapture(false)}
        familyId={familyId}
        kidId={kidId}
        kidName={kid.name}
        area="sports_subscription"
        profile={profile}
        uid={authProfile.uid}
      />
    </>
  );
}

// ── Sports row · session counter + planned editor ────────────────────
//
// Each subscription gets a "+ Session" button that bumps `sessions.attended`
// and a small inline editor for `sessions.planned`. Progress bar fills
// `attended / planned`; without planned it shows the raw attended count.

function SportsRow({
  item, accent, familyId,
}: {
  item: SparksItem;
  accent: string;
  familyId: string;
}) {
  const attended = item.sessions?.attended ?? 0;
  const planned = item.sessions?.planned;
  const [busy, setBusy] = useState(false);
  const [editPlanned, setEditPlanned] = useState(false);
  const [draftPlanned, setDraftPlanned] = useState(String(planned ?? ''));

  const pct = planned && planned > 0
    ? Math.min(100, Math.round((attended / planned) * 100))
    : Math.min(100, attended * 5); // arbitrary stub fill when un-planned

  const bump = async (by: number) => {
    if (busy) return;
    setBusy(true);
    try { await bumpSportsSession(familyId, item.id, by); }
    finally { setBusy(false); }
  };
  const savePlanned = async () => {
    setBusy(true);
    try {
      const n = draftPlanned.trim() === '' ? null : Math.max(1, Number(draftPlanned));
      await setSportsPlanned(familyId, item.id, Number.isFinite(n as number) ? n : null);
      setEditPlanned(false);
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-[#FBF7EE] rounded-[14px] px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <h5 className="font-display font-extrabold text-[14px] text-[#0F1F44] m-0 truncate">
          ⚽ {item.title}
        </h5>
        <span className="text-[10px] font-bold uppercase tracking-wider bg-[#DDF5DF] text-[#2E7D34] px-2 py-0.5 rounded-full whitespace-nowrap">
          Active
        </span>
      </div>

      <div className="h-1.5 bg-white rounded-full overflow-hidden mt-2">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: accent }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-[#5A6488]">
        <div className="min-w-0 truncate">
          {item.description ? `${item.description} · ` : ''}Started {toDisplayDate(item.date)}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 font-bold">
          {editPlanned ? (
            <>
              <span>{attended} of</span>
              <input
                type="number"
                min={1}
                value={draftPlanned}
                onChange={(e) => setDraftPlanned(e.target.value)}
                placeholder="—"
                className="w-12 bg-white border border-[#ECE4D3] rounded px-1.5 py-0.5 text-center"
              />
              <button
                type="button"
                onClick={savePlanned}
                disabled={busy}
                className="text-[#1E7873]"
              >
                ✓
              </button>
              <button
                type="button"
                onClick={() => { setEditPlanned(false); setDraftPlanned(String(planned ?? '')); }}
                className="text-[#5A6488]"
              >
                ×
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditPlanned(true)}
              className="hover:bg-white rounded px-1.5 py-0.5"
              title="Set planned sessions for the term"
            >
              {attended} {planned ? `of ${planned}` : 'sessions'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => bump(+1)}
          disabled={busy}
          className="flex-1 px-3 py-1.5 rounded-lg text-[12px] font-extrabold disabled:opacity-40"
          style={{ background: accent, color: '#fff' }}
        >
          + Session attended
        </button>
        {attended > 0 && (
          <button
            type="button"
            onClick={() => bump(-1)}
            disabled={busy}
            className="px-2.5 py-1.5 rounded-lg text-[12px] font-extrabold text-[#5A6488] hover:bg-white"
            aria-label="Undo last session"
          >
            −
          </button>
        )}
      </div>
    </div>
  );
}
