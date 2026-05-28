'use client';

// Kaya Sparks · Home Revisions (/sparks/[kidId]/revisions).
//
// New 6th area (Slice 7, 2026-05-28). The practice engine — kid snaps a
// homework revision, Claude scores it + suggests next questions, kid
// earns Kaya Points on qualifying submit. Parent reviews each row via
// the existing RatingSheet flow (lightbox + rating + points-award path
// in Slice 7b).
//
// Surface theme: head-revision (navy → purple) for the AreaScreen.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  ratingsByItemId, subscribeToAreaItems, subscribeToKidRatings,
  subscribeToSparksProfile,
} from '@/lib/sparks/firestore';
import {
  DEFAULT_REVISION_SETTINGS,
  type SparksItem, type SparksProfile, type SparksRating,
} from '@/lib/sparks/schema';
import { toDisplayDate } from '@/lib/dates';
import AreaScreen, { AddItemButton, AreaEmptyState } from '@/components/sparks/AreaScreen';
import RatingSheet from '@/components/sparks/RatingSheet';
import RatingDisplay from '@/components/sparks/RatingDisplay';
import PhotoLightbox from '@/components/sparks/PhotoLightbox';
import ThreadSheet from '@/components/sparks/ThreadSheet';
import RevisionFlow from '@/components/sparks/RevisionFlow';
import MaterialsList from '@/components/sparks/MaterialsList';
import AddMaterialSheet from '@/components/sparks/AddMaterialSheet';
import { subscribeMaterials } from '@/lib/sparks/materialsFirestore';
import type { SparksMaterial } from '@/lib/sparks/materials';

export default function RevisionsPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const { profile: authProfile } = useAuth();
  const { children } = useFamily();
  const familyId = authProfile?.familyId;
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [items, setItems] = useState<SparksItem[]>([]);
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [openRevision, setOpenRevision] = useState(false);
  const [ratings, setRatings] = useState<SparksRating[]>([]);
  const [rateItem, setRateItem] = useState<SparksItem | null>(null);
  const [threadItem, setThreadItem] = useState<SparksItem | null>(null);
  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number; caption: string; sub: string } | null>(null);
  const isParent = authProfile?.role === 'parent';

  // Tab state — Revisions feed vs. Materials reference docs.
  const [tab, setTab] = useState<'revisions' | 'materials'>('revisions');
  const [materials, setMaterials] = useState<SparksMaterial[]>([]);
  const [openAddMaterial, setOpenAddMaterial] = useState(false);
  const [editMaterial, setEditMaterial] = useState<SparksMaterial | null>(null);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToAreaItems(familyId, kidId, 'revision', setItems);
  }, [familyId, kidId]);
  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToSparksProfile(familyId, kidId, setProfile);
  }, [familyId, kidId]);
  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToKidRatings(familyId, kidId, setRatings);
  }, [familyId, kidId]);
  useEffect(() => {
    if (!familyId) return;
    return subscribeMaterials(familyId, setMaterials);
  }, [familyId]);

  const ratingsMap = useMemo(() => ratingsByItemId(ratings), [ratings]);

  // Build a small "recent rounds" hint for the AI next-question router
  // so suggestions don't repeat what just got asked.
  const recentRounds = useMemo(
    () => items
      .filter((it) => it.revision_data?.subject)
      .slice(0, 4)
      .map((it) => ({
        subject: it.revision_data!.subject!,
        ai_notes: it.revision_data!.ai_notes,
      })),
    [items],
  );

  if (!familyId || !kid) {
    return <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#5A6488] text-sm">Loading…</div>;
  }

  // Quick aggregates for the header subtitle
  const total = items.length;
  const qualifying = items.filter((it) => (it.revision_data?.ai_score ?? 0) >= 60).length;
  const myKidMaterials = useMemo(
    () => materials.filter((m) =>
      m.shared_with === 'all_kids'
      || (Array.isArray(m.shared_with) && m.shared_with.includes(kidId))
    ),
    [materials, kidId],
  );
  const subtitle = tab === 'materials'
    ? (myKidMaterials.length === 0
        ? 'No materials shared yet'
        : `${myKidMaterials.length} material${myKidMaterials.length === 1 ? '' : 's'} to refer back to`)
    : (total === 0
        ? 'Start your first revision'
        : `${total} round${total === 1 ? '' : 's'} · ${qualifying} qualified`);

  return (
    <>
      <AreaScreen
        kidId={kidId}
        kidName={kid.name}
        area="revision"
        subtitle={subtitle}
        action={tab === 'revisions'
          ? <AddItemButton onClick={() => setOpenRevision(true)} label="+ Revise" />
          : (isParent
              ? <AddItemButton onClick={() => setOpenAddMaterial(true)} label="+ Material" />
              : null)
        }
      >
        {/* Tab toggle — Revisions vs Materials. */}
        <div className="flex gap-1 bg-white border border-[#ECE4D3] rounded-full p-1 mb-3">
          <button
            type="button"
            onClick={() => setTab('revisions')}
            className={`flex-1 text-center text-[12px] font-extrabold py-2 rounded-full transition ${tab === 'revisions' ? 'bg-[#5A3CB8] text-white' : 'text-[#5A6488]'}`}
            aria-pressed={tab === 'revisions'}
          >
            🎯 Revisions
          </button>
          <button
            type="button"
            onClick={() => setTab('materials')}
            className={`flex-1 text-center text-[12px] font-extrabold py-2 rounded-full transition ${tab === 'materials' ? 'bg-[#5A3CB8] text-white' : 'text-[#5A6488]'}`}
            aria-pressed={tab === 'materials'}
          >
            📚 Materials
          </button>
        </div>

        {tab === 'materials' ? (
          <MaterialsList
            items={materials}
            forKidId={isParent ? undefined : kidId}
            canEdit={isParent}
            familyId={familyId}
            profileSubjects={profile?.subjects?.map((s) => s.name)}
            onEdit={(m) => setEditMaterial(m)}
            onAdd={isParent ? () => setOpenAddMaterial(true) : undefined}
          />
        ) : items.length === 0 ? (
          <AreaEmptyState
            emoji="🎯"
            title="Try a revision round"
            body={`Snap a worksheet → Claude scores it → AI gives you 3 next questions tuned to what you got wrong. Earn Kaya Points when you qualify.`}
            action={
              <button
                type="button"
                onClick={() => setOpenRevision(true)}
                className="inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px]"
                style={{ background: '#5A3CB8', color: '#fff' }}
              >
                + Start a revision
              </button>
            }
          />
        ) : (
          <ul className="m-0 p-0 list-none space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
            {items.map((it) => {
              const d = it.revision_data;
              const photo = it.photo_urls?.[0];
              const isQuestionsMode = d?.upload_mode === 'questions';
              const score = isQuestionsMode ? null : (d?.ai_score ?? null);
              const subject = d?.subject || it.subject || 'Revision';
              const latestRating = ratingsMap.get(it.id)?.[0] ?? null;
              const pillBg = score === null ? '#FBF7EE' : score >= 90 ? '#DDF5DF' : score >= 60 ? '#FFF1C9' : '#FFE7E0';
              const pillFg = score === null ? '#5A6488' : score >= 90 ? '#2E7D34' : score >= 60 ? '#8A6800' : '#A33A2A';
              return (
                <li key={it.id} className="bg-white border border-[#ECE4D3] rounded-[14px] p-3.5">
                  <div className="flex items-center gap-3">
                    {photo ? (
                      <button
                        type="button"
                        onClick={() => setLightbox({
                          photos: it.photo_urls ?? [],
                          index: 0,
                          caption: subject,
                          sub: `${toDisplayDate(it.date)}${d?.grade_level ? ' · ' + d.grade_level : ''}`,
                        })}
                        className="w-14 h-14 rounded-xl overflow-hidden shrink-0 border-0 p-0 cursor-zoom-in"
                        aria-label={`Open ${subject} full screen`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo} alt={subject} className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-[#E0D7FF] grid place-items-center text-2xl shrink-0" aria-hidden>
                        {isQuestionsMode ? '📚' : '🎯'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44] truncate">
                          {subject}
                          {d?.grade_level && <span className="text-[10px] font-bold text-[#5A6488] ml-1.5">· {d.grade_level}</span>}
                        </div>
                        {isQuestionsMode && (
                          <span className="text-[10.5px] font-extrabold rounded-full px-2 py-0.5 bg-[#E5D6FF] text-[#5A3CB8]">
                            📚 Questions
                          </span>
                        )}
                        {score !== null && (
                          <span
                            className="text-[10.5px] font-extrabold rounded-full px-2 py-0.5"
                            style={{ background: pillBg, color: pillFg }}
                          >
                            {score}%
                          </span>
                        )}
                        {d?.points_awarded && (
                          <span className="text-[10.5px] font-extrabold rounded-full px-2 py-0.5 bg-[#FFF1C9] text-[#8A6800]">
                            🎉 +pts
                          </span>
                        )}
                        {(() => {
                          const settings = { ...DEFAULT_REVISION_SETTINGS, ...(profile?.revision_settings ?? {}) };
                          const pending = !d?.points_awarded
                            && score !== null
                            && score >= settings.qualifying_score
                            && settings.parent_approval_required;
                          if (!pending) return null;
                          return (
                            <span className="text-[10.5px] font-extrabold rounded-full px-2 py-0.5 bg-[#E5D6FF] text-[#5A3CB8]">
                              {isParent ? '🟡 Awaiting your review' : '🟡 Pending review'}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="text-[11px] text-[#5A6488] mt-0.5">
                        {toDisplayDate(it.date)}
                        {d?.ai_breakdown && (
                          <> · <span className="text-[#2E7D34]">{d.ai_breakdown.correct}✓</span>
                            <span className="ml-1.5 text-[#8A6800]">{d.ai_breakdown.partial}~</span>
                            <span className="ml-1.5 text-[#A33A2A]">{d.ai_breakdown.wrong}✗</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setThreadItem(it)}
                        className="inline-flex items-center gap-1 bg-[#FBF7EE] hover:bg-[#E5D6FF] border border-[#ECE4D3] hover:border-[#5A3CB8] text-[#5A3CB8] rounded-full px-2.5 py-1 text-[11px] font-extrabold transition-colors"
                        aria-label="Open thread"
                        title="Reply / upload more"
                      >
                        💬
                      </button>
                      {isParent && (
                        <RatingDisplay
                          rating={latestRating}
                          onTap={() => setRateItem(it)}
                          variant="wide"
                        />
                      )}
                    </div>
                  </div>
                  {d?.ai_notes && (
                    <div className="mt-2.5 bg-[#FBF7EE] rounded-lg px-3 py-2 text-[12px] text-[#0F1F44] leading-snug">
                      <span className="text-[#5A3CB8] font-bold">✨ </span>
                      {d.ai_notes}
                    </div>
                  )}
                  {/* Question-mode rows show the parsed questions; answers-mode
                      rows show the next 3 follow-ups Claude generated. */}
                  {isQuestionsMode && d?.parsed_questions && d.parsed_questions.length > 0 && (
                    <details className="mt-2 group">
                      <summary className="text-[11px] font-extrabold text-[#5A3CB8] cursor-pointer hover:underline">
                        📚 {d.parsed_questions.length} questions on this page
                      </summary>
                      <ol className="m-0 mt-2 pl-5 text-[12px] text-[#0F1F44] leading-relaxed">
                        {d.parsed_questions.map((q, idx) => (
                          <li key={idx} className="py-0.5">{q}</li>
                        ))}
                      </ol>
                    </details>
                  )}
                  {!isQuestionsMode && d?.next_questions && d.next_questions.length > 0 && (
                    <details className="mt-2 group">
                      <summary className="text-[11px] font-extrabold text-[#5A3CB8] cursor-pointer hover:underline">
                        🎯 Next 3 questions
                      </summary>
                      <ol className="m-0 mt-2 pl-5 text-[12px] text-[#0F1F44] leading-relaxed">
                        {d.next_questions.map((q, idx) => (
                          <li key={idx} className="py-0.5">{q}</li>
                        ))}
                      </ol>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </AreaScreen>

      <RevisionFlow
        open={openRevision}
        onClose={() => setOpenRevision(false)}
        familyId={familyId}
        kidId={kidId}
        kidName={kid.name}
        profile={profile}
        uid={authProfile.uid}
        recentRounds={recentRounds}
      />

      {rateItem && (
        <RatingSheet
          open={!!rateItem}
          onClose={() => setRateItem(null)}
          familyId={familyId}
          item={rateItem}
          parentUid={authProfile.uid}
          mode="both"
        />
      )}

      {threadItem && (
        <ThreadSheet
          open={!!threadItem}
          onClose={() => setThreadItem(null)}
          familyId={familyId}
          item={threadItem}
          authorUid={authProfile.uid}
          authorName={authProfile.displayName || (isParent ? 'Parent' : kid.name)}
          authorRole={authProfile.role === 'helper' ? 'helper' : (isParent ? 'parent' : 'kid')}
          kidName={kid.name}
        />
      )}

      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onIndexChange={(i) => setLightbox({ ...lightbox, index: i })}
          onClose={() => setLightbox(null)}
          caption={lightbox.caption}
          subCaption={lightbox.sub}
        />
      )}

      {/* Materials — add / edit sheet (parent-only). */}
      {isParent && (
        <AddMaterialSheet
          open={openAddMaterial || !!editMaterial}
          onClose={() => { setOpenAddMaterial(false); setEditMaterial(null); }}
          familyId={familyId}
          uid={authProfile.uid}
          uploaderName={authProfile.displayName || authProfile.email || 'Parent'}
          kids={children.map((c) => ({ id: c.id, name: c.name }))}
          profileSubjects={profile?.subjects?.map((s) => s.name)}
          inUseSubjects={Array.from(new Set(materials.map((m) => m.subject)))}
          existing={editMaterial}
        />
      )}
    </>
  );
}
