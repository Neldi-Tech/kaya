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
            {items.map((it, idx) => {
              const accent = ROW_ACCENTS[idx % ROW_ACCENTS.length];
              return (
                <div key={it.id} className="bg-[#FBF7EE] rounded-[14px] px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <h5 className="font-display font-extrabold text-[14px] text-[#0F1F44] m-0 truncate">
                      ⚽ {it.title}
                    </h5>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-[#DDF5DF] text-[#2E7D34] px-2 py-0.5 rounded-full whitespace-nowrap">
                      Active
                    </span>
                  </div>
                  {/* Progress bar — placeholder (Slice 3 wires sessions attended). */}
                  <div className="h-1.5 bg-white rounded-full overflow-hidden mt-2">
                    <div
                      className="h-full rounded-full"
                      style={{ width: '0%', background: accent }}
                    />
                  </div>
                  <div className="text-[11px] text-[#5A6488] mt-1.5">
                    {it.description ? `${it.description} · ` : ''}
                    Started {toDisplayDate(it.date)} · session tracking in Slice 3
                  </div>
                </div>
              );
            })}
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
