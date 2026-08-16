'use client';

// Kaya Sparks · Treasures — the 3-step add wizard.
//
// D3 · a photo and a name is ENOUGH. Everything else can be filled in
// later, because a half-registered thing is infinitely better than an
// unregistered one — and F7 (data-entry death) is the most likely way
// this whole module fails.
//
// D17 · step 2 never asks a child to type anyone's contact details. The
// giver list comes from the family + the directory, and the thank-you is
// composed here but SENT by a parent.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { uploadSparksPhoto } from '@/lib/sparks/uploadPhoto';
import {
  createTreasure, treasuresApi, TREASURE_CATEGORIES, todayIso,
  type GiverKind,
} from '@/lib/sparks/treasures';

interface Props {
  familyId: string;
  kidId: string;
  kidName: string;
  /** Pre-fill the giver + occasion (birthday mode, reward auto-create). */
  preset?: { giverKind?: GiverKind; giverName?: string; occasion?: string };
  onClose: () => void;
  onCreated: (id: string) => void;
}

type GiverChoice = {
  key: string;
  label: string;
  emoji: string;
  kind: GiverKind;
  uid?: string;
  childId?: string;
};

const OCCASIONS = ['Birthday', 'Christmas', 'Eid', 'Well done', 'Just because', 'Passed on to me'];

export default function AddTreasureWizard({
  familyId, kidId, kidName, preset, onClose, onCreated,
}: Props) {
  const { profile } = useAuth();
  const isParent = profile?.role === 'parent';
  const [people, setPeople] = useState<GiverChoice[]>([]);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Step 1 — what
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('other');
  const [givenOn, setGivenOn] = useState(todayIso());
  const [travels, setTravels] = useState(false);
  const [watchlisted, setWatchlisted] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');

  // Step 2 — who gave it
  const [giver, setGiver] = useState<GiverChoice | null>(null);
  const [otherName, setOtherName] = useState(preset?.giverName ?? '');
  const [occasion, setOccasion] = useState(preset?.occasion ?? '');

  // Step 3 — why it matters
  const [story, setStory] = useState('');
  const [thankYou, setThankYou] = useState('');

  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const emoji = useMemo(
    () => TREASURE_CATEGORIES.find((c) => c.id === categoryId)?.emoji ?? '📦',
    [categoryId],
  );

  // D17 · Kaya already knows their people — parents, brothers and
  // sisters, and anyone who has given this family something before.
  // Served by the gateway so a child never types contact details and the
  // client never needs read access to `users`.
  useEffect(() => {
    let dead = false;
    treasuresApi<{ people: GiverChoice[] }>('people', { kidId })
      .then((r) => { if (!dead) setPeople(r.people || []); })
      .catch(() => { if (!dead) setPeople([]); });
    return () => { dead = true; };
  }, [kidId]);

  const givers: GiverChoice[] = useMemo(() => [
    ...people,
    { key: 'other', label: 'Someone else', emoji: '🙋', kind: 'person' as GiverKind },
    { key: 'self', label: 'I bought it', emoji: '🛒', kind: 'self' as GiverKind },
  ], [people]);

  const canNext1 = name.trim().length > 0;

  async function save() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      // Reserve the id client-side, upload, then write — that ordering
      // avoids orphan rows when an upload dies mid-way.
      let photoUrl: string | undefined;
      let thumbUrl: string | undefined;
      let photoId: string | undefined;
      if (file) {
        const holderId = `treasure-${Date.now().toString(36)}`;
        const up = await uploadSparksPhoto(familyId, holderId, file);
        photoUrl = up.feedUrl;
        thumbUrl = up.thumbUrl;
        photoId = up.photoId;
      }

      const giverKind: GiverKind = giver?.kind ?? (otherName.trim() ? 'person' : 'unknown');
      const giverName = giver?.kind === 'self'
        ? ''
        : giver && giver.key !== 'other'
          ? giver.label
          : otherName.trim();

      const id = await createTreasure(familyId, {
        kidId,
        name: name.trim(),
        categoryId,
        emoji,
        photoUrl,
        thumbUrl,
        photoId,
        giverKind,
        giverName,
        giverUid: giver?.uid,
        giverChildId: giver?.childId,
        occasion: occasion.trim() || undefined,
        givenOn,
        story: story.trim() || undefined,
        watchlisted,
        travels,
      });

      // The thank-you is a DRAFT until a parent sends it (F17).
      if (thankYou.trim()) {
        await treasuresApi('thankyou-set', {
          treasureId: id, kind: 'text', text: thankYou.trim(),
        }).catch(() => { /* the treasure is saved; the note can be retried */ });
      }
      onCreated(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save that — try again.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-[22px] sm:rounded-[22px] max-h-[92vh] overflow-y-auto">
        {/* Hero — jade → mint, the Treasures identity */}
        <div
          className="px-4 py-4 text-white"
          style={{ background: 'linear-gradient(135deg,#0E6B5E 0%,#3FA38F 100%)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10.5px] font-extrabold opacity-85">💎 Treasures · {kidName}</div>
              <div className="font-display text-[18px] font-extrabold mt-0.5">Add a treasure</div>
              <div className="text-[11px] opacity-90 mt-0.5">
                A photo and a name is enough — the rest can wait
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-white/80 text-[20px] leading-none px-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-4">
          {/* 3-step rail */}
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {(['1 · What', '2 · Who gave it', '3 · Why it matters'] as const).map((label, i) => (
              <div
                key={label}
                className={`rounded-[10px] py-1.5 text-center text-[9.5px] font-extrabold border ${
                  step === i + 1
                    ? 'bg-[#0E6B5E] text-white border-[#0E6B5E]'
                    : 'bg-white text-[#5B6B8C] border-[#E8E0CF]'
                }`}
              >
                {label}
              </div>
            ))}
          </div>

          {step === 1 && (
            <>
              <label className="block rounded-[14px] border-2 border-dashed border-[#BFE3D8] bg-[#F1FAF7] p-4 text-center cursor-pointer">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="max-h-40 mx-auto rounded-[10px] object-contain" />
                ) : (
                  <>
                    <div className="text-[34px] leading-none">{emoji}</div>
                    <div className="text-[11px] text-[#5B6B8C] font-bold mt-1.5">
                      📷 Snap it — or skip and add a photo later
                    </div>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>

              <Field label="Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Grandma's watch"
                  maxLength={80}
                  className="w-full text-[13px] font-bold outline-none bg-transparent"
                />
              </Field>

              <div className="text-[9.5px] font-extrabold tracking-[0.6px] uppercase text-[#8A8471] mt-3 mb-1.5">
                What kind of thing is it?
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TREASURE_CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryId(c.id)}
                    className={`px-2.5 py-1.5 rounded-full text-[11px] font-extrabold border ${
                      categoryId === c.id
                        ? 'bg-[#E2F3EE] text-[#0E6B5E] border-[#0E6B5E]'
                        : 'bg-white text-[#5B6B8C] border-[#E8E0CF]'
                    }`}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>

              <Field label="When did you get it?">
                <input
                  type="date"
                  value={givenOn}
                  onChange={(e) => setGivenOn(e.target.value)}
                  className="w-full text-[13px] font-bold outline-none bg-transparent"
                />
              </Field>

              <Toggle
                on={travels}
                onChange={setTravels}
                title="🧳 Does it travel with you?"
                body="Kaya will put it on your packing list and check it comes home."
              />
              <Toggle
                on={watchlisted}
                onChange={setWatchlisted}
                title="🔑 Include in the Keeper Check"
                body="The 30-second sweep. Leave this on for the things you'd be saddest to lose."
              />

              <button
                type="button"
                disabled={!canNext1}
                onClick={() => setStep(2)}
                className="w-full mt-4 py-2.5 rounded-full text-white font-extrabold text-[13px] disabled:opacity-40"
                style={{ background: '#0E6B5E' }}
              >
                Next · who gave it?
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="text-[13px] font-extrabold mb-2">Who gave it to you?</div>
              <div className="grid grid-cols-2 gap-2">
                {givers.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setGiver(g)}
                    className={`rounded-[13px] border p-2.5 text-left ${
                      giver?.key === g.key
                        ? 'border-2 border-[#0E6B5E] bg-[#F1FAF7]'
                        : 'border-[#E8E0CF] bg-white'
                    }`}
                  >
                    <div className="text-[20px] leading-none">{g.emoji}</div>
                    <div className="text-[11.5px] font-extrabold mt-1 leading-tight">{g.label}</div>
                  </button>
                ))}
              </div>

              {giver?.key === 'other' && (
                <Field label="Their name">
                  <input
                    value={otherName}
                    onChange={(e) => setOtherName(e.target.value)}
                    placeholder="Grandma Joyce"
                    maxLength={60}
                    className="w-full text-[13px] font-bold outline-none bg-transparent"
                  />
                </Field>
              )}

              <div className="text-[9.5px] font-extrabold tracking-[0.6px] uppercase text-[#8A8471] mt-3 mb-1.5">
                What was the occasion?
              </div>
              <div className="flex flex-wrap gap-1.5">
                {OCCASIONS.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOccasion(occasion === o ? '' : o)}
                    className={`px-2.5 py-1.5 rounded-full text-[11px] font-extrabold border ${
                      occasion === o
                        ? 'bg-[#E2F3EE] text-[#0E6B5E] border-[#0E6B5E]'
                        : 'bg-white text-[#5B6B8C] border-[#E8E0CF]'
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 rounded-full font-extrabold text-[13px] bg-[#EEF0F4] text-[#5B6B8C]"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="flex-1 py-2.5 rounded-full text-white font-extrabold text-[13px]"
                  style={{ background: '#0E6B5E' }}
                >
                  Next
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <Field label="Why does it matter to you?">
                <textarea
                  value={story}
                  onChange={(e) => setStory(e.target.value)}
                  rows={3}
                  maxLength={1200}
                  placeholder="It was the first watch I ever had…"
                  className="w-full text-[13px] font-medium outline-none bg-transparent resize-none"
                />
              </Field>
              <p className="text-[10.5px] text-[#8A8471] leading-snug mt-1">
                This is the bit that makes a teddy count as much as a phone. You can skip it and
                write it any time.
              </p>

              {giver && giver.kind !== 'self' && (
                <div className="mt-4 rounded-[12px] border border-[#BFE3D8] bg-[#F1FAF7] p-3">
                  <div className="text-[11.5px] font-extrabold text-[#1B4B43]">
                    💛 Say thank you to {giver.key === 'other' ? (otherName || 'them') : giver.label}?
                  </div>
                  <textarea
                    value={thankYou}
                    onChange={(e) => setThankYou(e.target.value)}
                    rows={2}
                    maxLength={600}
                    placeholder="Thank you so much, I love it!"
                    className="w-full mt-2 text-[12.5px] font-medium outline-none bg-white rounded-[10px] border border-[#BFE3D8] p-2 resize-none"
                  />
                  <p className="text-[10px] text-[#5B6B8C] mt-1.5 leading-snug">
                    {isParent
                      ? 'You can send this from the treasure once it’s saved.'
                      : 'Mum or Dad will read it and send it for you.'}
                  </p>
                </div>
              )}

              {err && (
                <p className="text-[11.5px] text-[#C0392B] font-bold mt-3">{err}</p>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-4 py-2.5 rounded-full font-extrabold text-[13px] bg-[#EEF0F4] text-[#5B6B8C]"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={save}
                  className="flex-1 py-2.5 rounded-full text-white font-extrabold text-[13px] disabled:opacity-50"
                  style={{ background: '#0E6B5E' }}
                >
                  {busy ? 'Saving…' : '💎 Add it'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#E8E0CF] rounded-[10px] px-3 py-2 mt-2.5 bg-white">
      <div className="text-[9.5px] font-extrabold tracking-[0.6px] uppercase text-[#8A8471]">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Toggle({
  on, onChange, title, body,
}: { on: boolean; onChange: (v: boolean) => void; title: string; body: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`w-full text-left mt-2.5 rounded-[12px] border p-2.5 ${
        on ? 'border-[#BFE3D8] bg-[#F1FAF7]' : 'border-[#E8E0CF] bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-extrabold text-[#0F1F44]">{title}</span>
        <span
          className={`w-9 h-5 rounded-full shrink-0 relative transition-colors ${
            on ? 'bg-[#0E6B5E]' : 'bg-[#DDE3EC]'
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
              on ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        </span>
      </div>
      <p className="text-[10.5px] text-[#5B6B8C] mt-1 leading-snug m-0">{body}</p>
    </button>
  );
}
