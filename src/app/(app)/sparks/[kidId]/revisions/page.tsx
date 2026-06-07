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
  subscribeToSparksProfile, updateSparksItem,
} from '@/lib/sparks/firestore';
import { uploadSparksPhotos } from '@/lib/sparks/uploadPhoto';
import CameraCaptureSheet from '@/components/messaging/CameraCaptureSheet';
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
  // Question paper (PR4) — the worksheet/exam, kept separate from answers.
  // Attachable anytime by a parent OR the kid (auto-framed via the scanner).
  const canAddQp = isParent || authProfile?.role === 'kid';
  const [qpFor, setQpFor] = useState<SparksItem | null>(null);
  const [qpBusy, setQpBusy] = useState(false);
  const addQuestionPaper = async (item: SparksItem, files: File[]) => {
    if (!familyId || files.length === 0) return;
    setQpBusy(true);
    try {
      const uploaded = await uploadSparksPhotos(familyId, item.id, files);
      const merged = [...(item.question_paper_urls ?? []), ...uploaded.map((u) => u.feedUrl)];
      await updateSparksItem(familyId, item.id, { question_paper_urls: merged });
    } finally {
      setQpBusy(false);
      setQpFor(null);
    }
  };

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

  // Materials shared with THIS kid (or all kids). MUST be computed before the
  // early return below — it's a hook, so it has to run on every render or
  // React throws "rendered more hooks than during the previous render" (which
  // is what white-screened this page on back-navigation).
  const myKidMaterials = useMemo(
    () => materials.filter((m) =>
      m.shared_with === 'all_kids'
      || (Array.isArray(m.shared_with) && m.shared_with.includes(kidId))
    ),
    [materials, kidId],
  );

  if (!familyId || !kid) {
    return <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#5A6488] text-sm">Loading…</div>;
  }

  // Quick aggregates for the header subtitle
  const total = items.length;
  const qualifying = items.filter((it) => (it.revision_data?.ai_score ?? 0) >= 60).length;
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
                        {/* Slice 7i · coverage chip — N/N questions read. */}
                        {d?.ai_breakdown_structured && d.ai_breakdown_structured.coverage.total > 0 && (
                          <span className="text-[10.5px] font-extrabold rounded-full px-2 py-0.5 bg-[#E5D6FF] text-[#5A3CB8]">
                            📋 {d.ai_breakdown_structured.coverage.read} / {d.ai_breakdown_structured.coverage.total} read
                          </span>
                        )}
                        {d?.points_awarded && (
                          <span className="text-[10.5px] font-extrabold rounded-full px-2 py-0.5 bg-[#FFF1C9] text-[#8A6800]">
                            🎉 +pts
                          </span>
                        )}
                        {(() => {
                          // Bug fix: status used to read only `points_awarded`,
                          // so a rated revision where the parent chose NOT to
                          // award points stayed stuck on "Awaiting your review".
                          // The truth is `latestRating` — once a rating doc
                          // exists for this item, the parent has reviewed,
                          // regardless of whether points were released.
                          if (latestRating) {
                            return (
                              <span className="text-[10.5px] font-extrabold rounded-full px-2 py-0.5 bg-[#DDF5DF] text-[#2E7D34]">
                                ✓ Reviewed
                              </span>
                            );
                          }
                          const settings = { ...DEFAULT_REVISION_SETTINGS, ...(profile?.revision_settings ?? {}) };
                          const pending = score !== null
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
                  {/* Question paper (PR4) — separate worksheet/exam, addable
                      anytime by a parent or the kid, auto-framed on capture. */}
                  {(it.question_paper_urls?.length || canAddQp) ? (
                    <div className="mt-2 flex items-center gap-2 flex-wrap pl-[68px]">
                      {it.question_paper_urls?.length ? (
                        <button
                          type="button"
                          onClick={() => setLightbox({
                            photos: it.question_paper_urls!,
                            index: 0,
                            caption: `${subject} · Question paper`,
                            sub: toDisplayDate(it.date),
                          })}
                          className="inline-flex items-center gap-1 bg-[#EAF3FF] border border-[#CFE2FB] text-[#1F3A5F] rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                          title="View the question paper"
                        >
                          📄 Question paper{it.question_paper_urls.length > 1 ? ` (${it.question_paper_urls.length})` : ''}
                        </button>
                      ) : null}
                      {canAddQp ? (
                        <button
                          type="button"
                          onClick={() => setQpFor(it)}
                          className="inline-flex items-center gap-1 bg-[#FBF7EE] border border-[#ECE4D3] text-[#5A6488] hover:text-[#1F3A5F] rounded-full px-2.5 py-1 text-[11px] font-extrabold transition-colors"
                          title="Attach the question paper / worksheet"
                        >
                          {it.question_paper_urls?.length ? '＋ Add page' : '📄 Add question paper'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {/* Slice 7i · Structured feedback when present, legacy
                      blob fallback otherwise. The disclaimer renders only
                      below the structured layout — old rows already have
                      a tone we don't want to add a warning to retroactively. */}
                  {d?.ai_breakdown_structured ? (
                    <StructuredFeedback s={d.ai_breakdown_structured} />
                  ) : d?.ai_notes ? (
                    <div className="mt-2.5 bg-[#FBF7EE] rounded-lg px-3 py-2 text-[12px] text-[#0F1F44] leading-snug">
                      <span className="text-[#5A3CB8] font-bold">✨ </span>
                      {d.ai_notes}
                    </div>
                  ) : null}
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
          kidName={kid.name}
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
          maxKidReevals={profile?.revision_settings?.max_kid_reevals ?? DEFAULT_REVISION_SETTINGS.max_kid_reevals}
        />
      )}

      {/* Question paper capture (PR4) — scan mode = auto-framed. */}
      <CameraCaptureSheet
        open={!!qpFor}
        mode="scan"
        onClose={() => { if (!qpBusy) setQpFor(null); }}
        onConfirm={(files) => (qpFor ? addQuestionPaper(qpFor, files) : undefined)}
      />

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

// ── Slice 7i · structured AI feedback renderer ───────────────────────
//
// Mirrors the approved design proposal exactly:
//   💪 Strengths   (green block · 2-5 specific bullets · always shown)
//   📝 Areas       (coral block · only wrong/partial · ref + topic + what + tip)
//   📊 Q-by-Q      (collapsible · every question · ✓ / ~ / ✗)
//   ⚠️ Disclaimer (amber dashed · always shown)

function StructuredFeedback({ s }: { s: NonNullable<SparksItem['revision_data']>['ai_breakdown_structured'] }) {
  if (!s) return null;
  const hasStrengths = s.strengths.length > 0;
  const hasAreas = s.areas.length > 0;
  const hasQbq = s.qbq.length > 0;

  return (
    <div className="mt-2.5 space-y-2">
      {hasStrengths && (
        <div className="bg-[#DDF5DF] border border-[#2E7D34]/20 rounded-lg px-3 py-2">
          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#2E7D34] mb-1">
            💪 Strengths
          </div>
          <ul className="m-0 pl-4 text-[12px] leading-snug text-[#1F4F23]">
            {s.strengths.map((line, idx) => (
              <li key={idx} className="py-0.5">{line}</li>
            ))}
          </ul>
        </div>
      )}

      {hasAreas && (
        <div className="border border-[#ECE4D3] rounded-lg overflow-hidden">
          <div className="bg-[#FFF5F2] px-3 py-1.5 border-b border-[#ECE4D3]">
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#A33A2A]">
              📝 Areas to revisit · {s.areas.length}
            </div>
          </div>
          <ul className="m-0 p-0 list-none">
            {s.areas.map((a, idx) => (
              <li key={idx} className={`px-3 py-2 ${idx < s.areas.length - 1 ? 'border-b border-[#ECE4D3]' : ''}`}>
                <div className="text-[12.5px]">
                  {a.question_ref && (
                    <span className="inline-block bg-[#FFE7E0] text-[#A33A2A] text-[10px] font-extrabold px-2 py-0.5 rounded-full mr-2">
                      {a.question_ref}
                    </span>
                  )}
                  <span className="font-extrabold text-[#0F1F44]">{a.topic}</span>
                </div>
                <div className="text-[12px] text-[#0F1F44] mt-1 leading-snug">{a.what_happened}</div>
                {a.tip && (
                  <div className="text-[11.5px] text-[#5A3CB8] bg-[#F6EFFF] mt-1.5 px-2 py-1 rounded">
                    💡 <strong>Tip:</strong> {a.tip}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasQbq && (
        <details className="border border-[#ECE4D3] rounded-lg group">
          <summary className="cursor-pointer bg-[#FBF7EE] px-3 py-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#5A6488] list-none flex items-center justify-between">
            <span>📊 Full breakdown · all {s.qbq.length} questions</span>
            <span className="text-[11px] font-extrabold text-[#5A3CB8] group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <ul className="m-0 p-0 list-none grid grid-cols-1 sm:grid-cols-2">
            {s.qbq.map((q, idx) => {
              const isLastRow = idx >= s.qbq.length - 2;
              const isRightCol = idx % 2 === 1;
              return (
                <li
                  key={q.question_ref + idx}
                  className={`px-3 py-1.5 text-[12px] flex items-center gap-2 ${!isLastRow ? 'border-b border-[#ECE4D3]' : ''} ${isRightCol ? '' : 'sm:border-r sm:border-[#ECE4D3]'}`}
                >
                  <span className="font-extrabold text-[#5A6488] min-w-[34px]">{q.question_ref}</span>
                  <span
                    className="font-extrabold text-[13px]"
                    style={{
                      color:
                        q.status === 'correct' ? '#2E7D34'
                        : q.status === 'wrong' ? '#A33A2A'
                        : '#8A6800',
                    }}
                    aria-label={q.status}
                  >
                    {q.status === 'correct' ? '✓' : q.status === 'wrong' ? '✗' : '~'}
                  </span>
                  <span className="text-[#0F1F44] truncate">{q.topic}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <div className="bg-[#FFFAEB] border border-dashed border-[#D4A847] rounded-lg px-3 py-2 text-[11px] text-[#5A4500] leading-snug flex items-start gap-2">
        <span className="text-base leading-none shrink-0" aria-hidden>⚠️</span>
        <div>
          <strong>AI can read this wrong.</strong> Claude scored this from photos — handwriting + image quality can fool it, especially on math notation, decimals, and crossed-out edits. Please skim the actual paper before finalizing a mark, especially anything that feels off.
        </div>
      </div>
    </div>
  );
}
