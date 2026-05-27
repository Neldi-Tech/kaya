'use client';

// Kaya Sparks · Academic & PTM (/sparks/[kidId]/academic).
// Mockup detail screen styled per `head-purple`. Per-term records
// with subjects + grade pills. Slice 2 ships the basic term entry +
// view; PTM follow-ups → workplan wiring lands in Slice 3.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  addAcademicFollowUp, removeAcademicFollowUp, setAcademicFollowUpStatus,
  subscribeToAcademicRecords, subscribeToSparksProfile, upsertAcademicRecord,
  type AcademicSubjectInput,
} from '@/lib/sparks/firestore';
import { extractFromImage } from '@/lib/sparks/ai';
import type {
  AcademicTerm, SparksAcademicRecord, SparksProfile,
} from '@/lib/sparks/schema';
import AreaScreen, { AddItemButton, AreaEmptyState } from '@/components/sparks/AreaScreen';

// Grade pill classes per band — pulled from the mockup
// (.g-a green-deep / .g-b purple / .g-c coral-deep).
function gradeClass(percent?: number, grade?: string): { bg: string; fg: string; label: string } {
  // Honour explicit letter grade when present; else infer from percent.
  const letter = (grade ?? '').trim().toUpperCase();
  if (letter.startsWith('A')) return { bg: '#DDF5DF', fg: '#2E7D34', label: letter };
  if (letter.startsWith('B')) return { bg: '#E8E0FF', fg: '#5A3CB8', label: letter };
  if (letter.startsWith('C') || letter.startsWith('D') || letter.startsWith('F')) {
    return { bg: '#FFE7E0', fg: '#B84A2C', label: letter };
  }
  // Infer from percent
  if (percent !== undefined) {
    if (percent >= 80) return { bg: '#DDF5DF', fg: '#2E7D34', label: `${percent}%` };
    if (percent >= 65) return { bg: '#E8E0FF', fg: '#5A3CB8', label: `${percent}%` };
    return { bg: '#FFE7E0', fg: '#B84A2C', label: `${percent}%` };
  }
  return { bg: '#FBF7EE', fg: '#5A6488', label: '—' };
}

function termLabel(term: AcademicTerm): string {
  return { T1: 'Term 1', T2: 'Term 2', T3: 'Term 3' }[term];
}

export default function AcademicPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const { profile: authProfile } = useAuth();
  const { children } = useFamily();
  const familyId = authProfile?.familyId;
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [records, setRecords] = useState<SparksAcademicRecord[]>([]);
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [editing, setEditing] = useState<{ year: number; term: AcademicTerm } | null>(null);
  const [draft, setDraft] = useState<{
    year: number;
    term: AcademicTerm;
    subjects: AcademicSubjectInput[];
    ptmNotes: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToAcademicRecords(familyId, kidId, setRecords);
  }, [familyId, kidId]);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToSparksProfile(familyId, kidId, setProfile);
  }, [familyId, kidId]);

  if (!familyId || !kid) {
    return <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#5A6488] text-sm">Loading…</div>;
  }

  const startNewTerm = () => {
    const now = new Date();
    const year = now.getFullYear();
    // Seed with the kid's subjects (if any), else with one blank row.
    const seeds: AcademicSubjectInput[] =
      (profile?.subjects ?? []).length > 0
        ? profile!.subjects!.map((s) => ({ name: s.name }))
        : [{ name: '' }];
    setDraft({ year, term: 'T1', subjects: seeds, ptmNotes: '' });
    setEditing({ year, term: 'T1' });
    setError(null);
  };

  const editExisting = (rec: SparksAcademicRecord) => {
    setDraft({
      year: rec.year,
      term: rec.term,
      subjects: rec.subjects?.length
        ? rec.subjects.map((s) => ({ name: s.name, grade: s.grade, percent: s.percent, teacher_note: s.teacher_note }))
        : [{ name: '' }],
      ptmNotes: rec.ptm_notes ?? '',
    });
    setEditing({ year: rec.year, term: rec.term });
    setError(null);
  };

  const cancelEdit = () => { setDraft(null); setEditing(null); setError(null); setScanNote(null); };

  /** Scan a report-card photo → seed the draft form with the
   *  extracted subjects + grades + percent + term/year. Parent always
   *  reviews + edits before save. Backed by /api/sparks/ai/extract
   *  (kind='academic'), Claude Sonnet vision. */
  const scanReportCard = async (file: File) => {
    setScanning(true);
    setScanNote(null);
    setError(null);
    try {
      const out = await extractFromImage(file, 'academic');
      if ('skipped' in out && out.skipped) {
        setScanNote('AI is off in this preview — fill in the term manually.');
        return;
      }
      if (!out.ok) {
        setScanNote(out.error || 'Couldn’t read the report card — fill it in by hand.');
        return;
      }
      const data = out.data;
      const now = new Date();
      const year = data.year && data.year > 1900 ? data.year : now.getFullYear();
      const term = (data.term === 'T1' || data.term === 'T2' || data.term === 'T3')
        ? data.term
        : 'T1';
      const subjects: AcademicSubjectInput[] = (data.subjects ?? [])
        .filter((s) => s.name?.trim())
        .map((s) => ({
          name: s.name.trim(),
          grade: s.grade?.trim() || undefined,
          percent: typeof s.percent === 'number' && s.percent >= 0 && s.percent <= 100 ? s.percent : undefined,
        }));
      if (subjects.length === 0) {
        setScanNote('No subjects detected. Try a clearer photo, or fill in by hand.');
        return;
      }
      setDraft({
        year,
        term,
        subjects,
        ptmNotes: data.teacherNotes?.trim() || '',
      });
      setEditing({ year, term });
      setScanNote(`✨ Scanned ${subjects.length} subjects · review + edit before saving.`);
    } finally {
      setScanning(false);
      // Allow re-scanning the same file
      if (scanInputRef.current) scanInputRef.current.value = '';
    }
  };

  const updateSubject = (idx: number, patch: Partial<AcademicSubjectInput>) => {
    if (!draft) return;
    const next = [...draft.subjects];
    next[idx] = { ...next[idx], ...patch };
    setDraft({ ...draft, subjects: next });
  };
  const addSubjectRow = () => {
    if (!draft) return;
    setDraft({ ...draft, subjects: [...draft.subjects, { name: '' }] });
  };
  const removeSubjectRow = (idx: number) => {
    if (!draft) return;
    setDraft({ ...draft, subjects: draft.subjects.filter((_, i) => i !== idx) });
  };

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const cleaned = draft.subjects.filter((s) => s.name.trim().length > 0);
      if (cleaned.length === 0) {
        setError('Add at least one subject before saving.');
        return;
      }
      await upsertAcademicRecord(familyId, {
        kid_id: kidId,
        year: draft.year,
        term: draft.term,
        subjects: cleaned,
        ptm_notes: draft.ptmNotes.trim() || undefined,
      });
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again?');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AreaScreen
      kidId={kidId}
      kidName={kid.name}
      area="academic"
      subtitle={records.length === 0 ? 'No term records yet' : `${records.length} term${records.length === 1 ? '' : 's'} captured`}
      action={
        !editing ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => scanInputRef.current?.click()}
              disabled={scanning}
              className="px-3 py-1.5 rounded-full text-[12px] font-extrabold whitespace-nowrap disabled:opacity-60"
              style={{
                background: 'rgba(255,255,255,0.22)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.35)',
              }}
              title="Scan a report-card photo and auto-fill the term form."
            >
              {scanning ? '✨ Scanning…' : '✨ Scan report card'}
            </button>
            <AddItemButton onClick={startNewTerm} label="+ Term" />
          </div>
        ) : undefined
      }
    >
      {/* Hidden file input for the Scan Report Card flow. */}
      <input
        ref={scanInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) scanReportCard(f);
        }}
      />

      {scanNote && (
        <div className="bg-[#E5D6FF] border border-[#A66CFF]/40 text-[#5A3CB8] rounded-[10px] px-3 py-2 mb-3 text-[12px] font-bold">
          {scanNote}
        </div>
      )}

      {/* Edit form */}
      {draft && (
        <div className="bg-[#FBF7EE] rounded-[14px] p-4 mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <select
              value={draft.year}
              onChange={(e) => setDraft({ ...draft, year: Number(e.target.value) })}
              className="bg-white border border-[#ECE4D3] rounded-lg px-2.5 py-1.5 text-[13px] font-bold text-[#0F1F44]"
            >
              {[draft.year - 1, draft.year, draft.year + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select
              value={draft.term}
              onChange={(e) => setDraft({ ...draft, term: e.target.value as AcademicTerm })}
              className="bg-white border border-[#ECE4D3] rounded-lg px-2.5 py-1.5 text-[13px] font-bold text-[#0F1F44]"
            >
              <option value="T1">{termLabel('T1')}</option>
              <option value="T2">{termLabel('T2')}</option>
              <option value="T3">{termLabel('T3')}</option>
            </select>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#5A6488]">Subjects</div>
            {draft.subjects.map((s, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={s.name}
                  onChange={(e) => updateSubject(idx, { name: e.target.value })}
                  placeholder="Subject"
                  className="flex-1 bg-white border border-[#ECE4D3] rounded-lg px-2.5 py-1.5 text-[12.5px] text-[#0F1F44] min-w-0"
                />
                <input
                  type="text"
                  value={s.grade ?? ''}
                  onChange={(e) => updateSubject(idx, { grade: e.target.value })}
                  placeholder="A"
                  maxLength={3}
                  className="w-12 bg-white border border-[#ECE4D3] rounded-lg px-2 py-1.5 text-[12.5px] text-center font-bold text-[#0F1F44]"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={s.percent ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateSubject(idx, { percent: v === '' ? undefined : Math.max(0, Math.min(100, Number(v))) });
                  }}
                  placeholder="%"
                  className="w-16 bg-white border border-[#ECE4D3] rounded-lg px-2 py-1.5 text-[12.5px] text-center font-bold text-[#0F1F44]"
                />
                <button
                  type="button"
                  onClick={() => removeSubjectRow(idx)}
                  aria-label="Remove subject"
                  className="text-[#E85C5C] font-bold text-base px-1.5 hover:bg-white rounded"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addSubjectRow}
              className="text-[#5A3CB8] font-bold text-[12px]"
            >
              + Add subject
            </button>
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#5A6488] mb-1">PTM notes</div>
            <textarea
              value={draft.ptmNotes}
              onChange={(e) => setDraft({ ...draft, ptmNotes: e.target.value })}
              placeholder="What the teacher said. Follow-ups become tasks in Slice 3."
              rows={3}
              className="w-full bg-white border border-[#ECE4D3] rounded-lg px-2.5 py-2 text-[12.5px] text-[#0F1F44] resize-none"
            />
          </div>

          {error && (
            <div className="bg-[#FFE7E0] text-[#A33A2A] rounded-lg px-3 py-2 text-[12px]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={cancelEdit}
              className="px-3 py-2 rounded-lg text-[12.5px] font-bold text-[#5A6488] hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveDraft}
              disabled={saving}
              className="px-3.5 py-2 rounded-lg text-[12.5px] font-extrabold"
              style={{ background: '#5A3CB8', color: '#fff' }}
            >
              {saving ? 'Saving…' : 'Save term'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {records.length === 0 && !draft && (
        <AreaEmptyState
          emoji="📚"
          title="No terms captured yet"
          body={`Start with the most recent term — subjects, grades, and PTM notes.`}
          action={
            <button
              type="button"
              onClick={startNewTerm}
              className="inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px]"
              style={{ background: '#5A3CB8', color: '#fff' }}
            >
              + Add a term
            </button>
          }
        />
      )}

      {records.length > 0 && !draft && (
        <div className="space-y-3">
          {records.map((rec) => (
            <div
              key={rec.id}
              className="bg-[#FBF7EE] rounded-[14px] p-3 cursor-pointer hover:bg-[#FFF1A8] transition-colors"
              onClick={() => editExisting(rec)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44]">
                  {termLabel(rec.term)} · {rec.year}
                </div>
                <span className="text-[10px] font-bold text-[#5A3CB8]">Edit →</span>
              </div>
              <ul className="m-0 p-0 list-none">
                {rec.subjects?.map((s) => {
                  const pill = gradeClass(s.percent, s.grade);
                  return (
                    <li
                      key={s.name}
                      className="flex items-center justify-between py-1.5 border-b border-[#ECE4D3] last:border-b-0"
                    >
                      <span className="text-[12.5px] text-[#0F1F44]">{s.name}</span>
                      <span
                        className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full"
                        style={{ background: pill.bg, color: pill.fg }}
                      >
                        {pill.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {rec.ptm_notes && (
                <div className="mt-2 text-[11.5px] text-[#5A6488] leading-snug">
                  <strong className="text-[#0F1F44]">PTM:</strong> {rec.ptm_notes}
                </div>
              )}
              <FollowUps familyId={familyId} record={rec} uid={authProfile.uid} />
            </div>
          ))}
        </div>
      )}
    </AreaScreen>
  );
}

// ── PTM follow-ups · inline tracker (Slice 3b) ───────────────────────
//
// Each follow-up = a tracked task on the academic record. Add with a
// quick inline form; tap the circle to close (✓) or reopen; long-press
// / × to delete. Open follow-ups carry a yellow chip; closed ones grey
// out. Slice 3b stores them on `record.follow_ups`; the workplan
// bridge (mirror to /workplanItems) lands with the rest of the
// workplan wiring in a follow-up slice.

function FollowUps({
  familyId, record, uid,
}: {
  familyId: string;
  record: SparksAcademicRecord;
  uid: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const follow_ups = record.follow_ups ?? [];
  const openCount = follow_ups.filter((f) => f.status === 'open').length;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const add = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await addAcademicFollowUp(familyId, record.id, {
        text: draft.trim(),
        due_date: due || undefined,
      });
      setDraft(''); setDue(''); setAdding(false);
    } finally { setBusy(false); }
  };
  const toggle = async (id: string, current: 'open' | 'closed') => {
    setBusy(true);
    try { await setAcademicFollowUpStatus(familyId, record.id, id, current === 'open' ? 'closed' : 'open', uid); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true);
    try { await removeAcademicFollowUp(familyId, record.id, id); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-[#ECE4D3]" onClick={stop}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#5A6488]">
          Follow-ups{openCount > 0 && (
            <span className="ml-1.5 text-[10px] font-extrabold bg-[#FFF1C9] text-[#8A6800] rounded-full px-1.5 py-0.5">
              {openCount} open
            </span>
          )}
        </div>
        {!adding && (
          <button
            type="button"
            onClick={(e) => { stop(e); setAdding(true); }}
            className="text-[11px] font-bold text-[#5A3CB8] hover:bg-white rounded px-1.5 py-0.5"
          >
            + Follow-up
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-white rounded-lg p-2.5 mb-2 space-y-1.5">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Weekly reading practice"
            className="w-full bg-[#FBF7EE] border border-[#ECE4D3] rounded px-2 py-1.5 text-[12.5px] text-[#0F1F44]"
            autoFocus
          />
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="flex-1 bg-[#FBF7EE] border border-[#ECE4D3] rounded px-2 py-1.5 text-[12px] text-[#0F1F44]"
            />
            <button
              type="button"
              onClick={(e) => { stop(e); add(); }}
              disabled={!draft.trim() || busy}
              className="px-2.5 py-1.5 rounded text-[12px] font-extrabold disabled:opacity-40"
              style={{ background: '#5A3CB8', color: '#fff' }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={(e) => { stop(e); setAdding(false); setDraft(''); setDue(''); }}
              className="px-2 py-1.5 text-[12px] text-[#5A6488] font-bold"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {follow_ups.length === 0 && !adding ? (
        <div className="text-[11.5px] text-[#5A6488] italic">
          No follow-ups yet. Add reading practice, retests, conversations to remember.
        </div>
      ) : (
        <ul className="m-0 p-0 list-none space-y-1.5">
          {follow_ups.map((f) => (
            <li
              key={f.id}
              className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${
                f.status === 'open' ? 'bg-[#FFF1C9]' : 'bg-white opacity-60'
              }`}
            >
              <button
                type="button"
                onClick={(e) => { stop(e); toggle(f.id, f.status); }}
                disabled={busy}
                aria-label={f.status === 'open' ? 'Mark closed' : 'Reopen'}
                className={`w-5 h-5 rounded-full border-2 grid place-items-center text-[10px] font-extrabold shrink-0 mt-0.5 ${
                  f.status === 'closed' ? 'bg-[#2E7D34] border-[#2E7D34] text-white' : 'bg-white border-[#8A6800] text-[#8A6800]'
                }`}
              >
                {f.status === 'closed' ? '✓' : ''}
              </button>
              <div className="flex-1 min-w-0">
                <div className={`text-[12.5px] ${f.status === 'closed' ? 'line-through text-[#5A6488]' : 'text-[#0F1F44]'}`}>
                  {f.text}
                </div>
                {f.due_date && (
                  <div className="text-[10.5px] text-[#5A6488] mt-0.5">
                    Due {f.due_date}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => { stop(e); remove(f.id); }}
                disabled={busy}
                aria-label="Delete follow-up"
                className="text-[#E85C5C] font-bold px-1.5 text-base hover:bg-white rounded"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
