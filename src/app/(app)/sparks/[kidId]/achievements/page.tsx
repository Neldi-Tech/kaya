'use client';

// Kaya Sparks · Achievements (/sparks/[kidId]/achievements). The
// "achievement wall" from the mockup (head-green). Each row =
// coloured medal + title + subtitle. Captures use the same
// CaptureSheet (kid uploads a photo of the certificate / medal +
// titles it; OCR auto-extract lands with Slice 4).

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

// Medal palette — rotates across the wall so it reads as a mix of
// gold / coral / mint / purple medals from the mockup. The kid's
// real photo (when uploaded) goes in the medal circle.
const MEDAL_BG = ['#FFD93D', '#FFE7E0', '#DDF5DF', '#E5D6FF', '#C9F0EC'];
const MEDAL_ICON = ['🏆', '🥇', '🌟', '🎖️', '🏅'];

export default function AchievementsPage() {
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
    return subscribeToAreaItems(familyId, kidId, 'achievement', setItems);
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
        area="achievement"
        subtitle={items.length === 0 ? 'No certificates yet' : `${items.length} captured`}
        action={
          <AddItemButton onClick={() => setOpenCapture(true)} label="+ Add" />
        }
      >
        {items.length === 0 ? (
          <AreaEmptyState
            emoji="🏆"
            title={`Every certificate, every medal — saved`}
            body={`Snap a photo of the certificate, the medal, or the prize. AI OCR for issuer + date arrives in Slice 4.`}
            action={
              <button
                type="button"
                onClick={() => setOpenCapture(true)}
                className="inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px]"
                style={{ background: '#2E7D34', color: '#fff' }}
              >
                + Add an achievement
              </button>
            }
          />
        ) : (
          <ul className="m-0 p-0 list-none">
            {items.map((it, idx) => {
              const photo = it.photo_urls?.[0];
              return (
                <li
                  key={it.id}
                  className="flex items-center gap-3 py-3 border-b border-[#ECE4D3] last:border-b-0"
                >
                  <div
                    className="w-10 h-10 rounded-full grid place-items-center shrink-0 overflow-hidden"
                    style={photo ? undefined : { background: MEDAL_BG[idx % MEDAL_BG.length] }}
                  >
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt={it.title} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-lg" aria-hidden>{MEDAL_ICON[idx % MEDAL_ICON.length]}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-extrabold text-[#0F1F44] leading-tight">
                      {it.title}
                    </div>
                    <div className="text-[11px] text-[#5A6488] mt-0.5">
                      {it.description ? `${it.description} · ` : ''}{toDisplayDate(it.date)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AreaScreen>

      <CaptureSheet
        open={openCapture}
        onClose={() => setOpenCapture(false)}
        familyId={familyId}
        kidId={kidId}
        kidName={kid.name}
        area="achievement"
        profile={profile}
        uid={authProfile.uid}
      />
    </>
  );
}
