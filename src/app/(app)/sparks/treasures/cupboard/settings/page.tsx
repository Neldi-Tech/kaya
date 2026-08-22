'use client';

// Kaya Sparks · Treasures 2.0 — ⚙️ Cupboard settings (parents).
//
// Design screen 14 · D26 who may open it · D32 reading-reminder default
// · D36 Finish Quiz · D38 Game Night · D40 dust days · N8 meeting line.
// Every value is written now; the loops that consume them land in
// C3–C6 (reading reminders, quiz, game night, dust, meeting line).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  getCupboardSettings, setCupboardSettings, listCupboardHelpers,
  DEFAULT_CUPBOARD_SETTINGS, READING_MODE_LABEL, DAY_LABEL,
  type CupboardSettings, type CupboardHelperRow, type ReadingReminderMode,
} from '@/lib/sparks/cupboard';
import { CupboardFrame, Card, ChoiceChips, WOOD } from '@/components/sparks/CupboardShell';

export default function CupboardSettingsPage() {
  const { profile } = useAuth();
  const familyId = profile?.familyId ?? '';
  const isParent = profile?.role === 'parent';

  const [s, setS] = useState<CupboardSettings>(DEFAULT_CUPBOARD_SETTINGS);
  const [helpers, setHelpers] = useState<CupboardHelperRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!isParent) return;
    Promise.all([getCupboardSettings(), listCupboardHelpers()])
      .then(([st, hs]) => { setS(st); setHelpers(hs); setLoaded(true); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'error'));
  }, [isParent]);

  const save = useCallback(async (patch: Partial<CupboardSettings>) => {
    const next = { ...s, ...patch };
    setS(next); setErr('');
    try {
      await setCupboardSettings(familyId, patch);
      setSaved('Saved'); setTimeout(() => setSaved(''), 1400);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); }
  }, [familyId, s]);

  if (!isParent) {
    return (
      <CupboardFrame back={{ href: '/sparks/treasures/cupboard', label: 'Cupboard' }} hero={{ tone: 'navy', eyebrow: '🗄 The Family Cupboard', title: '⚙️ Settings', sub: 'Parents only' }}>
        <Card tone="warn"><div className="text-[12px] font-extrabold text-[#8A6800]">This page is for parents.</div></Card>
      </CupboardFrame>
    );
  }

  const Toggle = ({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) => (
    <button type="button" onClick={() => onChange(!on)} className="w-full flex items-center justify-between gap-3 py-2 border-b border-dashed border-[#E8E0CF] last:border-0 text-left">
      <span>
        <span className="block text-[12px] font-extrabold text-[#0F1F44]">{label}</span>
        {sub && <span className="block text-[10.5px] font-bold text-[#8A8471] leading-snug">{sub}</span>}
      </span>
      <span className="relative inline-block w-[34px] h-[19px] rounded-full shrink-0 transition-colors" style={{ background: on ? WOOD : '#CBD2DC' }} aria-hidden>
        <span className="absolute top-[2px] w-[15px] h-[15px] rounded-full bg-white transition-all" style={{ left: on ? 17 : 2 }} />
      </span>
    </button>
  );

  const hours = Array.from({ length: 24 }, (_, h) => ({ id: String(h), label: `${String(h).padStart(2, '0')}:00` }));

  return (
    <CupboardFrame back={{ href: '/sparks/treasures/cupboard', label: 'Cupboard' }} hero={{ tone: 'navy', eyebrow: '🗄 The Family Cupboard · parents only', title: '⚙️ Settings', sub: 'Who, when, how much' }}>
      {!loaded && !err && <p className="text-[13px] text-[#5A6488] text-center py-6">Loading…</p>}
      {err && <p className="text-[11.5px] text-[#C0392B] font-bold">{err}</p>}
      {saved && <p className="text-[11px] font-extrabold text-[#2E7D4F]">✓ {saved}</p>}

      {loaded && (
        <>
          {/* D26 · who */}
          <Card>
            <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">👥 Who can see &amp; add</div>
            <p className="text-[11px] font-bold text-[#5B6B8C] mt-1 mb-2 leading-snug">Parents + all kids — always. Helpers only when you pick them here: they may see, add, and log reading for a kid. Never values.</p>
            {helpers.length === 0 ? (
              <p className="text-[11px] text-[#8A8471] m-0">No helpers on this family yet · <Link href="/settings" className="font-extrabold text-[#0E6B5E]">Settings → Helpers</Link></p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {helpers.map((h) => {
                  const on = s.helperUids.includes(h.uid);
                  return (
                    <button key={h.uid} type="button" disabled={!h.active}
                      onClick={() => save({ helperUids: on ? s.helperUids.filter((u) => u !== h.uid) : [...s.helperUids, h.uid] })}
                      className="text-[11px] font-extrabold px-2.5 py-1.5 rounded-full border-[1.5px] border-[#E8E0CF] bg-white text-[#0F1F44] disabled:opacity-40"
                      style={on ? { background: WOOD, color: '#fff', borderColor: WOOD } : undefined}>
                      {on ? '✓ ' : ''}{h.displayName}{!h.active ? ' (inactive)' : ''}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* D32 · reading reminders default */}
          <Card>
            <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">📖 Reading reminders — default for a new reading</div>
            <p className="text-[10.5px] font-bold text-[#8A8471] mt-0.5 mb-2 leading-snug">Each reading can be changed on its own. A kid nudge only — never email.</p>
            <ChoiceChips value={s.reading.mode} onChange={(mode: ReadingReminderMode) => save({ reading: { ...s.reading, mode } })}
              options={(Object.keys(READING_MODE_LABEL) as ReadingReminderMode[]).map((m) => ({ id: m, label: READING_MODE_LABEL[m] }))} />
            {s.reading.mode !== 'off' && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] font-extrabold text-[#5B6B8C]">at</span>
                <select className="rounded-[10px] border border-[#E8E0CF] bg-white px-2 py-1.5 text-[12px]" value={String(s.reading.hour)} onChange={(e) => save({ reading: { ...s.reading, hour: Number(e.target.value) } })}>
                  {hours.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
                </select>
              </div>
            )}
            <div className="mt-1">
              <Toggle on={s.reading.quietLineDays > 0} onChange={(v) => save({ reading: { ...s.reading, quietLineDays: v ? 7 : 0 } })}
                label="7-day quiet line to parents" sub="After a week of silence, one quiet line to you — never an alarm." />
            </div>
          </Card>

          {/* D36 · quiz */}
          <Card>
            <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">🏁 Finish Quiz</div>
            <Toggle on={s.quiz.enabled} onChange={(v) => save({ quiz: { ...s.quiz, enabled: v } })} label="Kaya asks 3–5 questions when a book is finished" sub="Always skippable. Kaya rates understanding; you rate as usual." />
            {s.quiz.enabled && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] font-extrabold text-[#5B6B8C]">On from age</span>
                <select className="rounded-[10px] border border-[#E8E0CF] bg-white px-2 py-1.5 text-[12px]" value={String(s.quiz.minAge)} onChange={(e) => save({ quiz: { ...s.quiz, minAge: Number(e.target.value) } })}>
                  {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((a) => <option key={a} value={a}>{a}+</option>)}
                </select>
              </div>
            )}
            <Toggle on={s.quiz.points} onChange={(v) => save({ quiz: { ...s.quiz, points: v } })} label="Points for a passed quiz (award rail)" sub="Off by default — reading is its own reward." />
          </Card>

          {/* D38 · game night */}
          <Card>
            <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">🎲 Game Night</div>
            <Toggle on={s.gameNight.enabled} onChange={(v) => save({ gameNight: { ...s.gameNight, enabled: v } })} label="Kaya asks “Family fun tonight?”" sub="A push to parents + kids, then the picker." />
            {s.gameNight.enabled && (
              <>
                <div className="mt-2"><ChoiceChips value={String(s.gameNight.dayOfWeek)} onChange={(d) => save({ gameNight: { ...s.gameNight, dayOfWeek: Number(d) } })}
                  options={DAY_LABEL.map((l, i) => ({ id: String(i), label: l }))} /></div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] font-extrabold text-[#5B6B8C]">at</span>
                  <select className="rounded-[10px] border border-[#E8E0CF] bg-white px-2 py-1.5 text-[12px]" value={String(s.gameNight.hour)} onChange={(e) => save({ gameNight: { ...s.gameNight, hour: Number(e.target.value) } })}>
                    {hours.map((h) => <option key={h.id} value={h.id}>{h.label.slice(0, 2)}</option>)}
                  </select>
                  <span className="text-[11px] font-extrabold text-[#5B6B8C]">:</span>
                  <select className="rounded-[10px] border border-[#E8E0CF] bg-white px-2 py-1.5 text-[12px]" value={String(s.gameNight.minute)} onChange={(e) => save({ gameNight: { ...s.gameNight, minute: Number(e.target.value) } })}>
                    {[0, 15, 30, 45].map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                  </select>
                </div>
              </>
            )}
          </Card>

          {/* D40 · dust */}
          <Card>
            <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">🕸 Gathering dust after</div>
            <p className="text-[10.5px] font-bold text-[#8A8471] mt-0.5 mb-2 leading-snug">One gentle card per item per quarter — play it, or pass it on. Never nags.</p>
            <ChoiceChips value={String(s.dustDays)} onChange={(d) => save({ dustDays: Number(d) })}
              options={[{ id: '60', label: '60 days' }, { id: '90', label: '90 days' }, { id: '180', label: '180 days' }, { id: '0', label: 'Off' }]} />
          </Card>

          {/* N8 · meeting line */}
          <Card>
            <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">🧾 Sunday Meeting line</div>
            <Toggle on={s.meetingLine} onChange={(v) => save({ meetingLine: v })} label="“This week we read … and played …”" sub="One sentence in the meeting report’s Learn & Grow." />
          </Card>
        </>
      )}
    </CupboardFrame>
  );
}
