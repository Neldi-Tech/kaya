'use client';

// Kaya Sparks · Treasures — one treasure, and its whole story.
//
// The screen is deliberately ordered by what MATTERS, not by what is
// easiest to render: the Giver's Thread first (💛 who this came from and
// what they said back), then what it's worth in the child's own effort
// currency, then the condition timeline.
//
// D4 · money never appears here for a child. The value sub-document is
//      not merely hidden — the gateway never sends it to a non-parent.
// D6 · nothing is deleted; the actions move the status.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { toDisplayDate } from '@/lib/dates';
import {
  getTreasure, setStory, reportCondition, markFound, addSighting,
  updateTreasure, treasuresApi, categoryDef, daysBetween, todayIso,
  lendTreasure, returnTreasure, extendBorrow,
  STATUS_CHIP, STATUS_LABEL,
  type Treasure, type TreasureEvent, type TreasurePrivate,
} from '@/lib/sparks/treasures';

const EVENT_EMOJI: Record<string, string> = {
  registered: '🎁', thanked: '🎤', reply: '💌', story: '📖',
  check: '🔑', broken: '💔', repaired: '🔧', lost: '❓', found: '✅',
  sighting: '👀', lent: '🤝', returned: '↩️', shared: '👨‍👩‍👧',
  handed_on: '🤝', donated: '💚', sold: '💰', outgrown: '🌱', retired: '🕰',
  value_set: '🔒', vault_promoted: '💎',
};

export default function TreasureDetailPage() {
  const params = useParams<{ kidId: string; treasureId: string }>();
  const kidId = params?.kidId ?? '';
  const treasureId = params?.treasureId ?? '';
  const router = useRouter();
  const { profile } = useAuth();
  const { children } = useFamily();

  const familyId = profile?.familyId;
  const isParent = profile?.role === 'parent';
  const isOwner = !!profile?.childId && profile.childId === kidId;
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [t, setT] = useState<Treasure | null>(null);
  const [events, setEvents] = useState<TreasureEvent[]>([]);
  const [priv, setPriv] = useState<TreasurePrivate | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [storyOpen, setStoryOpen] = useState(false);
  const [storyText, setStoryText] = useState('');
  const [conditionOpen, setConditionOpen] = useState(false);
  const [lendOpen, setLendOpen] = useState(false);
  const [lendTo, setLendTo] = useState('');
  const [lendToChildId, setLendToChildId] = useState('');
  const [lendDue, setLendDue] = useState('');
  const [note, setNote] = useState('');
  const [where, setWhere] = useState('');

  const load = useCallback(() => {
    if (!treasureId) return;
    getTreasure(treasureId)
      .then((r) => {
        setT(r.treasure);
        setEvents(r.events || []);
        setPriv(r.private ?? null);
        setStoryText(r.treasure.story || '');
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not open that'));
  }, [treasureId]);

  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setErr('');
    try { await fn(); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'That did not work'); }
    finally { setBusy(false); }
  }

  if (err && !t) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center p-6 text-center">
        <div>
          <p className="text-[13px] font-bold text-[#0F1F44]">This treasure isn’t available to you.</p>
          <Link href={`/sparks/${kidId}/treasures`} className="text-[12px] font-extrabold text-[#0E6B5E]">
            ‹ Back to the shelf
          </Link>
        </div>
      </div>
    );
  }

  if (!t) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#0F1F44] text-sm">
        Loading…
      </div>
    );
  }

  const chip = STATUS_CHIP[t.status];
  const cat = categoryDef(t.categoryId);
  const today = todayIso();
  const canEdit = isParent || isOwner;

  return (
    <div className="min-h-screen bg-[#FFFBF5] pb-20">
      <div className="mx-auto max-w-md sm:max-w-2xl">
        <div className="px-4 pt-4">
          <Link
            href={`/sparks/${kidId}/treasures`}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full bg-white border border-[#ECE4D3] text-[#0F1F44] font-display font-extrabold text-[12px] no-underline"
          >
            <span className="text-[13px] leading-none opacity-60" aria-hidden>‹</span>
            <span>{kid?.name ? `${kid.name}’s treasures` : 'Treasures'}</span>
          </Link>
        </div>

        {/* Hero */}
        <div
          className="mx-4 mt-3 rounded-[18px] overflow-hidden text-white"
          style={{ background: 'linear-gradient(135deg,#0E6B5E 0%,#3FA38F 100%)' }}
        >
          {t.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.photoUrl} alt="" className="w-full max-h-56 object-cover" />
          )}
          <div className="p-4">
            <div className="text-[10.5px] font-extrabold opacity-85">
              💎 Treasures · {cat.emoji} {cat.label}
            </div>
            <div className="font-display text-[19px] font-extrabold mt-0.5">
              {t.emoji} {t.name}
            </div>
            <div className="text-[11px] opacity-90 mt-1">
              {t.giverKind === 'self'
                ? `You bought it · ${toDisplayDate(t.givenOn)}`
                : t.giverName
                  ? `Given by ${t.giverName} · ${toDisplayDate(t.givenOn)}`
                  : toDisplayDate(t.givenOn)}
            </div>
            <span
              className="inline-block mt-2 text-[10px] font-extrabold px-2.5 py-1 rounded-full"
              style={{ background: chip.bg, color: chip.fg }}
            >
              {chip.emoji} {STATUS_LABEL[t.status]}
            </span>
          </div>
        </div>

        <div className="px-4 mt-3">
          {/* 💛 The Giver's Thread — the half a plain register loses. */}
          {(t.giverName || t.thankYou || t.giverReply) && (
            <div className="rounded-[12px] border border-[#BFE3D8] bg-[#E2F3EE] p-3 text-[#1B4B43]">
              {t.giverName && (
                <p className="text-[11.5px] font-bold leading-snug m-0">
                  💛 <b>{t.giverName}</b> gave you this
                  {t.occasion ? ` for ${t.occasion.toLowerCase()}` : ''}.
                </p>
              )}
              {t.thankYou && (
                <p className="text-[11px] font-bold mt-2 m-0">
                  🎤 Your thank-you{' '}
                  <span
                    className="inline-block text-[9.5px] font-extrabold px-2 py-0.5 rounded-full align-middle"
                    style={
                      t.thankYou.status === 'sent'
                        ? { background: '#DDF5DF', color: '#2E7D34' }
                        : { background: '#FFF1C9', color: '#8A6800' }
                    }
                  >
                    {t.thankYou.status === 'sent' ? 'sent' : 'waiting for a parent'}
                  </span>
                </p>
              )}
              {t.thankYou?.text && (
                <p className="text-[11.5px] italic mt-1 m-0 leading-snug">“{t.thankYou.text}”</p>
              )}
              {isParent && t.thankYou && t.thankYou.status !== 'sent' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => treasuresApi('thankyou-send', { treasureId }))}
                  className="mt-2 px-3.5 py-1.5 rounded-full text-white font-extrabold text-[11.5px]"
                  style={{ background: '#0E6B5E' }}
                >
                  ▶ Send it to {t.giverName || 'them'}
                </button>
              )}
              {t.giverReply && (
                <p className="text-[11.5px] italic mt-2 m-0 leading-snug">
                  “{t.giverReply.text}” — <b>{t.giverReply.byName}</b>, pinned forever
                </p>
              )}
            </div>
          )}

          {/* 📖 The story */}
          <div className="rounded-[14px] border border-[#ECE4D3] bg-white p-3 mt-2.5">
            <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
              📖 Why it matters
            </div>
            {storyOpen ? (
              <>
                <textarea
                  value={storyText}
                  onChange={(e) => setStoryText(e.target.value)}
                  rows={3}
                  maxLength={1200}
                  className="w-full mt-2 text-[12.5px] rounded-[10px] border border-[#ECE4D3] p-2 outline-none resize-none"
                  placeholder="It was the first watch I ever had…"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(async () => {
                      if (familyId) await setStory(familyId, kidId, treasureId, storyText);
                      setStoryOpen(false);
                    })}
                    className="px-3.5 py-1.5 rounded-full text-white font-extrabold text-[11.5px]"
                    style={{ background: '#0E6B5E' }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStoryOpen(false); setStoryText(t.story || ''); }}
                    className="px-3.5 py-1.5 rounded-full font-extrabold text-[11.5px] bg-[#EEF0F4] text-[#5B6B8C]"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[11.5px] text-[#5B6B8C] font-bold leading-snug mt-1 m-0">
                  {t.story || 'Nothing written yet — this is the bit that makes a teddy count as much as a phone.'}
                </p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setStoryOpen(true)}
                    className="mt-2 px-3.5 py-1.5 rounded-full font-extrabold text-[11.5px] bg-[#E2F3EE] text-[#0E6B5E]"
                  >
                    {t.story ? '✏️ Edit' : '📖 Add its story'}
                  </button>
                )}
              </>
            )}
          </div>

          {/* 🔒 Parent-only value block (D4). A kid, sibling or helper
              never receives these fields — the gateway does not send
              them, so there is nothing here to hide. */}
          {isParent && (
            <div className="rounded-[14px] border border-[#DDE3EC] bg-[#F1F3F7] p-3 mt-2.5">
              <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
                🔒 Parents only
              </div>
              <p className="text-[11px] font-bold text-[#5B6B8C] leading-snug mt-1 m-0">
                {priv?.valueCents
                  ? `Recorded value: ${(priv.valueCents / 100).toLocaleString()} ${priv.currency || 'TZS'}`
                  : 'No value recorded yet.'}
                {priv?.warrantyEndsOn ? ` · warranty to ${toDisplayDate(priv.warrantyEndsOn)}` : ''}
              </p>
              <p className="text-[10.5px] text-[#8A8471] italic leading-snug mt-1.5 m-0">
                Never shown on a kid, sibling or helper screen. {kid?.name ?? 'They'} sees what it
                took to earn, not what it cost.
              </p>
            </div>
          )}

          {/* 🤝 Borrow & Return (D11). Most things aren't lost — they're
              lent and forgotten. This ledger is the cure, and the
              record at the bottom is the sentence a parent gets to
              say: "you've got back everything you've lent." */}
          {t.status === 'lent' && t.borrow ? (
            <div className="rounded-[14px] border border-[#E0D7FF] bg-[#F6F2FF] p-3 mt-2.5">
              <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
                🤝 Lent to {t.borrow.toName}
              </div>
              <p className="text-[10.8px] font-bold text-[#5B6B8C] mt-1 m-0">
                Since {toDisplayDate(t.borrow.since)} · back by{' '}
                <b>{toDisplayDate(t.borrow.dueOn)}</b>
                {t.borrow.dueOn < today ? ' · overdue' : ''}
              </p>
              <p className="text-[10.5px] text-[#5B6B8C] mt-1 m-0 leading-snug">
                Kaya reminds you both on the morning it&rsquo;s due.
              </p>
              {canEdit && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => returnTreasure(familyId!, kidId, treasureId))}
                    className="px-3.5 py-1.5 rounded-full text-white font-extrabold text-[11.5px]"
                    style={{ background: '#0E6B5E' }}
                  >
                    ✅ Got it back
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const d = prompt('New return date (YYYY-MM-DD)', t.borrow?.dueOn ?? '');
                      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
                        run(() => extendBorrow(familyId!, kidId, treasureId, d));
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-full font-extrabold text-[11.5px] bg-white text-[#5A3CB8] border-[1.5px] border-[#5A3CB8]"
                  >
                    📅 Give more time
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {t.lending && t.lending.out + t.lending.backOnTime + t.lending.backLate > 0 && (
            <div className="rounded-[14px] border border-[#ECE4D3] bg-white p-3 mt-2.5">
              <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
                Lending record
              </div>
              <p className="text-[11px] font-bold text-[#5B6B8C] mt-1 m-0">
                Lent {t.lending.out + t.lending.backOnTime + t.lending.backLate} ·
                {' '}back on time {t.lending.backOnTime} · late {t.lending.backLate}
              </p>
              {t.lending.backLate === 0 && t.lending.backOnTime > 0 && (
                <p className="text-[10.8px] font-bold text-[#0E6B5E] mt-1 m-0 leading-snug">
                  🏅 Everything you&rsquo;ve lent has come back. That&rsquo;s trust you can spend.
                </p>
              )}
            </div>
          )}

          {/* Its story so far — the append-only trail IS the record. */}
          <div className="mt-4">
            <div className="text-[10px] font-extrabold tracking-[0.6px] uppercase text-[#8A8471] mb-1.5">
              Its story so far
            </div>
            <div className="border-l-2 border-[#BFE3D8] ml-1.5 pl-3">
              {events.length === 0 && (
                <p className="text-[11.5px] text-[#8A8471] m-0">Just registered.</p>
              )}
              {events.map((e) => (
                <div key={e.id} className="relative mb-2.5">
                  <span
                    className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-[#3FA38F]"
                    aria-hidden
                  />
                  <div className="text-[9.5px] font-extrabold tracking-[0.4px] text-[#8A8471]">
                    {toDisplayDate(e.on)}
                  </div>
                  <div className="text-[11.3px] font-bold leading-snug text-[#0F1F44]">
                    {EVENT_EMOJI[e.kind] || '•'} {e.note || e.kind}
                    {e.ownedIt && (
                      <span className="ml-1.5 text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#DDF5DF] text-[#2E7D34]">
                        🫱 Owned It
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          {canEdit && (
            <div className="mt-4 flex flex-wrap gap-2">
              {t.status === 'lost' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => markFound(familyId!, kidId, treasureId, where.trim() || undefined))}
                  className="px-4 py-2 rounded-full text-white font-extrabold text-[12px]"
                  style={{ background: '#0E6B5E' }}
                >
                  ✅ I found it
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConditionOpen((v) => !v)}
                  className="px-4 py-2 rounded-full font-extrabold text-[12px] bg-[#EEF0F4] text-[#5B6B8C]"
                >
                  🔧 Something’s wrong
                </button>
              )}
              {t.status === 'broken' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => reportCondition(familyId!, kidId, treasureId, 'repaired', 'Repaired'))}
                  className="px-4 py-2 rounded-full font-extrabold text-[12px] bg-[#FFF1C9] text-[#8A6800]"
                >
                  🔧 It’s fixed
                </button>
              )}
              {t.status !== 'lent' && t.status !== 'lost' && (
                <button
                  type="button"
                  onClick={() => setLendOpen((v) => !v)}
                  className="px-4 py-2 rounded-full font-extrabold text-[12px] bg-[#EFE8FF] text-[#5A3CB8]"
                >
                  🤝 Lend it
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => updateTreasure(familyId!, kidId, treasureId, {
                  visibility: t.visibility === 'private' ? 'family' : 'private',
                }))}
                className="px-4 py-2 rounded-full font-extrabold text-[12px] bg-[#E2F3EE] text-[#0E6B5E]"
              >
                {t.visibility === 'private' ? '👨‍👩‍👧 Share with the family' : '🔒 Make it private again'}
              </button>
            </div>
          )}

          {/* A sibling's ONE interaction: help find it (D10). No field
              anywhere asks who might have taken it. */}
          {!canEdit && t.status === 'lost' && (
            <div className="mt-4 rounded-[12px] border border-[#F0C9CC] bg-[#FEF6F6] p-3">
              <div className="text-[11.5px] font-extrabold text-[#8B2830]">👀 Seen it anywhere?</div>
              <input
                value={where}
                onChange={(e) => setWhere(e.target.value)}
                placeholder="In the car, on Wednesday"
                maxLength={120}
                className="w-full mt-2 text-[12px] rounded-[10px] border border-[#F0C9CC] bg-white p-2 outline-none"
              />
              <button
                type="button"
                disabled={busy || !where.trim()}
                onClick={() => run(async () => {
                  await addSighting(familyId!, kidId, treasureId, where.trim());
                  setWhere('');
                })}
                className="mt-2 px-3.5 py-1.5 rounded-full text-white font-extrabold text-[11.5px] disabled:opacity-40"
                style={{ background: '#0E6B5E' }}
              >
                👀 I’ve seen it
              </button>
            </div>
          )}

          {lendOpen && canEdit && (
            <div className="mt-3 rounded-[12px] border border-[#E0D7FF] bg-[#F6F2FF] p-3">
              <div className="text-[11.5px] font-extrabold text-[#5A3CB8]">🤝 Who&rsquo;s borrowing it?</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {children.filter((c) => c.id !== kidId).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setLendToChildId(c.id); setLendTo(c.name); }}
                    className={`px-2.5 py-1.5 rounded-full text-[11px] font-extrabold border ${
                      lendToChildId === c.id
                        ? 'bg-[#E0D7FF] text-[#5A3CB8] border-[#5A3CB8]'
                        : 'bg-white text-[#5B6B8C] border-[#E0D7FF]'
                    }`}
                  >
                    {c.avatarEmoji || '🧒'} {c.name}
                  </button>
                ))}
              </div>
              <input
                value={lendToChildId ? '' : lendTo}
                onChange={(e) => { setLendToChildId(''); setLendTo(e.target.value); }}
                placeholder="or a friend&rsquo;s name"
                maxLength={60}
                className="w-full mt-2 text-[12px] rounded-[10px] border border-[#E0D7FF] bg-white p-2 outline-none"
              />
              <input
                type="date"
                value={lendDue}
                onChange={(e) => setLendDue(e.target.value)}
                className="w-full mt-2 text-[12px] rounded-[10px] border border-[#E0D7FF] bg-white p-2 outline-none"
              />
              <p className="text-[10.5px] text-[#5B6B8C] mt-1 m-0 leading-snug">
                Pick when it should come back. Kaya reminds you both that morning.
              </p>
              <button
                type="button"
                disabled={busy || !lendTo.trim() || !lendDue}
                onClick={() => run(async () => {
                  await lendTreasure(familyId!, kidId, treasureId, {
                    toName: lendTo.trim(),
                    toChildId: lendToChildId || undefined,
                    dueOn: lendDue,
                  });
                  setLendOpen(false); setLendTo(''); setLendToChildId(''); setLendDue('');
                })}
                className="mt-2 px-3.5 py-1.5 rounded-full text-white font-extrabold text-[11.5px] disabled:opacity-40"
                style={{ background: '#5A3CB8' }}
              >
                🤝 Lend it
              </button>
            </div>
          )}

          {conditionOpen && canEdit && (
            <div className="mt-3 rounded-[12px] border border-[#BFE3D8] bg-[#F1FAF7] p-3">
              <p className="text-[11.2px] font-bold text-[#1B4B43] leading-snug m-0">
                Kaya never takes points away for an accident.{' '}
                <b>Telling us fast is the Keeper’s job.</b>
              </p>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="The strap came off in PE"
                maxLength={400}
                className="w-full mt-2 text-[12px] rounded-[10px] border border-[#BFE3D8] bg-white p-2 outline-none"
              />
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(async () => {
                    await reportCondition(familyId!, kidId, treasureId, 'broken', note.trim() || undefined);
                    setNote(''); setConditionOpen(false);
                  })}
                  className="px-3.5 py-1.5 rounded-full font-extrabold text-[11.5px] bg-[#FFF1C9] text-[#8A6800]"
                >
                  💔 It’s broken
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(async () => {
                    await reportCondition(
                      familyId!, kidId, treasureId, 'lost',
                      note.trim() || undefined, where.trim() || undefined,
                    );
                    setNote(''); setConditionOpen(false);
                  })}
                  className="px-3.5 py-1.5 rounded-full font-extrabold text-[11.5px] bg-[#FDE8E8] text-[#C0392B]"
                >
                  ❓ I can’t find it
                </button>
              </div>
            </div>
          )}

          {t.status === 'lost' && t.sightings && t.sightings.length > 0 && (
            <div className="mt-3 rounded-[12px] border border-[#ECE4D3] bg-white p-3">
              <div className="text-[11.5px] font-extrabold text-[#0F1F44]">👀 Where people have seen it</div>
              {t.sightings.slice(-4).map((s, i) => (
                <p key={`${s.at}-${i}`} className="text-[11px] font-bold text-[#5B6B8C] mt-1 m-0">
                  {s.byName}: “{s.where}” · {toDisplayDate(s.on)}
                </p>
              ))}
              <p className="text-[10.5px] text-[#8A8471] italic mt-2 m-0 leading-snug">
                Kaya never asks who took something. It asks where it was last — because that is what
                actually finds things.
              </p>
            </div>
          )}

          {t.lostSince && t.status === 'lost' && (
            <p className="text-[10.5px] text-[#8A8471] mt-3">
              Missing {daysBetween(t.lostSince, today)} day
              {daysBetween(t.lostSince, today) === 1 ? '' : 's'} · we’ll tell everyone the moment it turns up.
            </p>
          )}

          {err && <p className="text-[11.5px] text-[#C0392B] font-bold mt-3">{err}</p>}
        </div>
      </div>
    </div>
  );
}
