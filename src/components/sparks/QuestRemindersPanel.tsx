'use client';

// Kaya Sparks · Quests — reminder settings (D11).
//
// The cut-off, the switch, and the extra people who should be able to
// see it. Elia's ask was explicit: "since it's work, email set-ups where
// parents add other additional emails they would want to keep, so that
// there is more visibility" — a tutor, a grandparent, the aunt who
// actually does homework with them.
//
// Recipients follow the SAME cascade the household engine already uses:
// Quest > Sparks > Family Global. Nothing new to learn, one place to
// debug when an email doesn't arrive.

import { useState } from 'react';
import { updateQuest, type Quest } from '@/lib/sparks/quests';

interface Props {
  familyId: string;
  kidId: string;
  kidName: string;
  quest: Quest;
}

export default function QuestRemindersPanel({ familyId, kidId, kidName, quest }: Props) {
  const [open, setOpen] = useState(false);
  const [cutoff, setCutoff] = useState(quest.cutoffHHmm);
  const [enabled, setEnabled] = useState(quest.remindersEnabled !== false);
  const [emailsText, setEmailsText] = useState((quest.extraEmails ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const emails = emailsText.split(/[\n,]/).map((e) => e.trim()).filter(Boolean);
  const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  async function save() {
    setSaving(true);
    setSaved(false);
    await updateQuest(familyId, kidId, quest.id, {
      cutoffHHmm: cutoff,
      remindersEnabled: enabled,
      extraEmails: emails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
    }).catch(() => {});
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="mt-3 rounded-[16px] border border-[#ECE4D3] bg-white p-3.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="min-w-0">
          <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
            🔔 Reminders
          </div>
          <div className="text-[11.5px] text-[#5A6488] mt-0.5">
            {enabled
              ? `Cut-off ${cutoff}${quest.extraEmails?.length ? ` · +${quest.extraEmails.length} extra recipient${quest.extraEmails.length === 1 ? '' : 's'}` : ''}`
              : 'Off — nobody is told about a missed step'}
          </div>
        </div>
        <span className="text-[#D4A847] font-bold text-lg shrink-0" aria-hidden>
          {open ? '▾' : '›'}
        </span>
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-[#F3EEE2] space-y-3">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }}
              className="mt-0.5"
            />
            <span className="text-[12.5px] text-[#0F1F44] leading-snug">
              <strong>Tell us when a step is missed</strong>
              <span className="block text-[11px] text-[#5A6488]">
                {kidName} gets a gentle nudge an hour before the cut-off — never an email.
                Parents get the email only if the step is still open at the cut-off.
              </span>
            </span>
          </label>

          <div>
            <div className="font-display font-extrabold text-[12px] text-[#0F1F44] mb-1">
              Daily cut-off
            </div>
            <input
              type="time"
              value={cutoff}
              onChange={(e) => { setCutoff(e.target.value); setSaved(false); }}
              className="rounded-xl border border-[#ECE4D3] px-3 py-2 text-[14px]"
            />
          </div>

          <div>
            <div className="font-display font-extrabold text-[12px] text-[#0F1F44] mb-1">
              Extra people to keep in the loop
            </div>
            <div className="text-[11px] text-[#5A6488] mb-1.5 leading-snug">
              One email per line. A tutor, a grandparent, whoever actually sits with {kidName}.
              Both parents are always included.
            </div>
            <textarea
              value={emailsText}
              onChange={(e) => { setEmailsText(e.target.value); setSaved(false); }}
              rows={3}
              placeholder={'auntie@example.com\ncoach@example.com'}
              className="w-full rounded-xl border border-[#ECE4D3] px-3 py-2.5 text-[13px] resize-none"
            />
            {bad.length > 0 && (
              <div className="text-[11px] text-[#8B2130] mt-1">
                Not a valid address, so it won&apos;t be saved: {bad.join(', ')}
              </div>
            )}
          </div>

          <p className="text-[10.5px] text-[#8A8471] leading-snug m-0">
            If {kidName} does the step later that evening, everyone who got the email gets a quiet
            ✅ — and no second email. Every send is recorded in the family&apos;s alert log.
          </p>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-xl font-extrabold text-[12.5px] text-white disabled:opacity-50"
              style={{ background: quest.colour }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-[11.5px] font-bold text-[#2E7D34]">Saved ✓</span>}
          </div>
        </div>
      )}
    </div>
  );
}
