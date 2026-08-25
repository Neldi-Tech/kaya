'use client';

// 🤝 Helper Recognition tab (HR PR-1) — the 5-dial scorecard for one
// helper, parent-only, living beside Today / Fill / Score / Reviews on
// the workplan page. The dials feed reward & recognition planning; the
// monthly helper round + Asante card land in HR PR-2/3.

import { useEffect, useMemo, useState } from 'react';
import { computeHelperDials, fetchKidWords, DIAL_META, dialColor, type HelperDials, type KidWord } from '@/lib/helperRecognition';
import { shareScorecardPng } from '@/lib/helperScorecardPng';
import type { HelperLink } from '@/lib/firestore';
import { useFamily } from '@/contexts/FamilyContext';
import { useAuth } from '@/contexts/AuthContext';
import { asLocale, localeForCountry } from '@/lib/i18n';
import {
  createShineCard, listShineCards, setShineCardLang, deleteShineCard,
  setShineCardGift, getHelperRound, shineCardSvg,
  type ShineCard, type CardLang, type HelperRound,
} from '@/lib/shineCards';
import { CardShareRow } from '@/components/rewards/ShineCards';
import { createDraftRequest } from '@/lib/purchase';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

// Same avatar vocabulary as the workplan rail.
const HELPER_EMOJI: Record<HelperLink['preset'], string> = {
  nanny: '🤱', tutor: '📚', driver: '🚗', grandparent: '👵', gardener: '🌿',
  security: '🛡️', cleaner: '🧽', cook: '🍳', handyman: '🛠️', custom: '🤝',
};

/** 🎁 HR PR-3 — the starter gift ideas when the family hasn't built
 *  its own gift bank yet. Parents can add/remove their own. */
const DEFAULT_GIFT_IDEAS = [
  '💵 Cash bonus (via payroll)',
  '🌴 A paid day off',
  '📱 Airtime top-up',
  '🛍️ Shopping voucher',
  '🍰 Dinner treat with the family',
  '🧺 Kanga / kitenge gift',
];
const GIFT_MEMORY_DAYS = 60;
const LENS_EMOJI: Record<string, string> = { best: '🏆', improved: '📈', unsung: '🕯️' };

/** One thank-you line per dial, in both languages — the top dial seeds
 *  the composer so the card says WHY, not just "thanks". */
const SUGGESTIONS: Record<string, { en: (n: string) => string; sw: (n: string) => string }> = {
  strictness:  { en: (n) => `Asante ${n} — your honest ratings help our kids grow.`, sw: (n) => `Asante ${n} — ukadiriaji wako wa kweli unawasaidia watoto wetu kukua.` },
  consistency: { en: (n) => `Thank you ${n} for showing up every single day.`, sw: (n) => `Asante ${n} kwa kuwepo kila siku bila kukosa.` },
  workplan:    { en: (n) => `Thank you ${n} — the work gets done, and done well.`, sw: (n) => `Asante ${n} — kazi inafanyika, tena vizuri.` },
  corrections: { en: (n) => `Your corrections teach our kids — thank you ${n}.`, sw: (n) => `Masahihisho yako yanawafundisha watoto wetu — asante ${n}.` },
  kidsVoice:   { en: (n) => `The kids' words say it best — thank you ${n}!`, sw: (n) => `Maneno ya watoto yanasema yote — asante ${n}!` },
};

export default function HelperRecognitionTab({ helper, familyId }: {
  helper: HelperLink;
  familyId: string;
}) {
  const { family } = useFamily();
  const { profile } = useAuth();
  const [dials, setDials] = useState<HelperDials | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [round, setRound] = useState<HelperRound | null>(null);

  // 🧡 Asante composer — the parent-set default for THIS helper, else
  // their country's language (same chain useLocale uses for helpers).
  const defaultLang: CardLang =
    asLocale(family?.memberLanguageDefaults?.[helper.uid])
    ?? localeForCountry(family?.location?.country);
  const [lang, setLang] = useState<CardLang>(defaultLang);
  const [quote, setQuote] = useState('');
  // 💬 HR PR-4 — the kids' own review lines; one can ride the card.
  const [kidWords, setKidWords] = useState<KidWord[]>([]);
  const [kidsLine, setKidsLine] = useState<string | null>(null);
  // 📤 Scorecard share (2026-08-25) — same pattern as ⚖️ Compare mode, but
  // for ONE helper, and in a language they actually read. Its own state so
  // picking a share language never disturbs the Asante composer above.
  const [shareLang, setShareLang] = useState<CardLang>(defaultLang);
  const [sharing, setSharing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [composerMsg, setComposerMsg] = useState('');
  const [cards, setCards] = useState<ShineCard[]>([]);

  const refreshCards = () =>
    listShineCards(familyId, `helper:${helper.uid}`).then(setCards).catch(() => {});

  useEffect(() => {
    let alive = true;
    setState('loading');
    setQuote(''); setComposerMsg(''); setLang(defaultLang);
    computeHelperDials(familyId, helper.uid)
      .then((d) => { if (alive) { setDials(d); setState('ready'); } })
      .catch(() => { if (alive) setState('error'); });
    listShineCards(familyId, `helper:${helper.uid}`)
      .then((c) => { if (alive) setCards(c); })
      .catch(() => {});
    getHelperRound(familyId)
      .then((r) => { if (alive) setRound(r); })
      .catch(() => {});
    setKidsLine(null);
    fetchKidWords(familyId, helper.uid)
      .then((w) => { if (alive) setKidWords(w); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, helper.uid]);

  const firstName = helper.displayName.split(' ')[0];

  // The dial-seeded suggestion lines: top dial first, then the rest.
  const suggestions = useMemo(() => {
    if (!dials) return [] as string[];
    const ranked = DIAL_META
      .map((m) => ({ key: m.key as string, v: dials[m.key] }))
      .filter((d) => d.v !== null)
      .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
      .slice(0, 3);
    const keys = ranked.length ? ranked.map((r) => r.key) : ['consistency', 'workplan'];
    return keys.map((k) => SUGGESTIONS[k]?.[lang](firstName)).filter(Boolean) as string[];
  }, [dials, lang, firstName]);

  // Live preview of the card being written.
  const draftSvg = useMemo(() => {
    if (!quote.trim()) return null;
    const draft: ShineCard = {
      id: 'draft', n: (cards[0]?.n || 0) + 1,
      kidId: `helper:${helper.uid}`, kidName: helper.displayName,
      kidEmoji: HELPER_EMOJI[helper.preset] || '🤝',
      theme: 'asante', quote: quote.trim(), by: '', byName: lang === 'sw' ? 'familia' : 'the family',
      at: Date.now(), kindLabel: '🤝 Helper recognition',
      pointsLabel: lang === 'sw' ? '🧡 ASANTE SANA' : '🧡 THANK YOU',
      category: lang === 'sw' ? 'msaidizi wetu' : 'our helper',
      subject: 'helper', helperUid: helper.uid, lang,
      ...(kidsLine ? { kidsLine } : {}),
    };
    return shineCardSvg(draft);
  }, [quote, lang, helper, cards, kidsLine]);

  const createCard = async () => {
    if (!quote.trim() || creating) return;
    setCreating(true); setComposerMsg('');
    try {
      await createShineCard({
        familyId,
        kidId: `helper:${helper.uid}`,
        kidName: helper.displayName,
        kidEmoji: HELPER_EMOJI[helper.preset] || '🤝',
        subject: 'helper',
        helperUid: helper.uid,
        theme: 'asante',
        quote: quote.trim(),
        lang,
        kindLabel: '🤝 Helper recognition',
        pointsLabel: lang === 'sw' ? '🧡 ASANTE SANA' : '🧡 THANK YOU',
        category: lang === 'sw' ? 'msaidizi wetu' : 'our helper',
        ...(kidsLine ? { kidsLine } : {}),
      });
      setQuote(''); setKidsLine(null);
      setComposerMsg(`🧡 Asante card created — ${firstName} got the bell. Share it below!`);
      await refreshCards();
    } catch (e) {
      setComposerMsg(e instanceof Error ? e.message : 'Could not create the card.');
    }
    setCreating(false);
  };

  const switchCardLang = async (card: ShineCard, next: CardLang) => {
    setCards((p) => p.map((c) => (c.id === card.id ? { ...c, lang: next } : c)));
    await setShineCardLang(familyId, card.id, next).catch(() => refreshCards());
  };

  const removeCard = async (card: ShineCard) => {
    if (!window.confirm(`Delete Asante card №${card.n}? The record disappears for good.`)) return;
    await deleteShineCard(familyId, card.id).catch(() => {});
    await refreshCards();
  };

  // ── 🎁 Gift advisor (HR PR-3) ───────────────────────────────────
  const [giftMsg, setGiftMsg] = useState('');
  const [newIdea, setNewIdea] = useState('');
  const [bonusAmount, setBonusAmount] = useState('');
  const [bonusBusy, setBonusBusy] = useState(false);
  const giftIdeas = (family?.helperGiftBank?.length ? family.helperGiftBank : DEFAULT_GIFT_IDEAS);
  const usingOwnBank = !!family?.helperGiftBank?.length;
  // 60-day memory — gifts already given to THIS helper sink + get a tick.
  const recentGifts = useMemo(() => {
    const cutoff = Date.now() - GIFT_MEMORY_DAYS * 86400_000;
    return new Set(cards.filter((c) => c.at >= cutoff && (c.gift || c.giftMeta?.label))
      .map((c) => (c.giftMeta?.label || c.gift || '').toLowerCase()));
  }, [cards]);
  const rankedIdeas = useMemo(() => {
    const fresh = giftIdeas.filter((g) => !recentGifts.has(g.toLowerCase()));
    const given = giftIdeas.filter((g) => recentGifts.has(g.toLowerCase()));
    return [...fresh, ...given];
  }, [giftIdeas, recentGifts]);

  const recordGift = async (label: string) => {
    if (!cards[0]) { setGiftMsg('Create an Asante card first — the gift seals onto the newest card.'); return; }
    setGiftMsg('');
    try {
      await setShineCardGift(familyId, cards[0].id, label, { label, source: 'custom', pathway: 'simple' });
      setGiftMsg(`🎁 Sealed onto card №${cards[0].n} — Kaya remembers for ${GIFT_MEMORY_DAYS} days.`);
      await refreshCards();
    } catch (e) { setGiftMsg(e instanceof Error ? e.message : 'Could not record the gift.'); }
  };

  const addIdea = async () => {
    const idea = newIdea.trim().slice(0, 60);
    if (!idea || !family) return;
    setNewIdea('');
    // Starting from the default list? Seed the bank with it first so
    // nothing the parent already saw disappears.
    const seed = usingOwnBank ? [idea] : [...DEFAULT_GIFT_IDEAS, idea];
    await updateDoc(doc(db, 'families', family.id), { helperGiftBank: arrayUnion(...seed) }).catch(() => {});
  };
  const removeIdea = async (idea: string) => {
    if (!family || !usingOwnBank) return;
    await updateDoc(doc(db, 'families', family.id), { helperGiftBank: arrayRemove(idea) }).catch(() => {});
  };

  // 💼 Payroll-sealed bonus — a one-off payroll request the parents
  // approve like any pay run; the gift record seals with the amount.
  const sendBonus = async () => {
    const amount = Math.round(Number(bonusAmount) * 100);
    if (!profile || !Number.isFinite(amount) || amount <= 0 || bonusBusy) return;
    setBonusBusy(true); setGiftMsg('');
    try {
      const monthKey = new Date().toISOString().slice(0, 7);
      await createDraftRequest(familyId, {
        name: `Recognition bonus · ${helper.displayName} · ${monthKey}`,
        createdBy: profile.uid,
        createdByRole: 'parent',
        module: 'payroll',
        helperUid: helper.uid,
        items: [{ id: crypto.randomUUID(), name: `🌟 Recognition bonus — ${monthKey}`, qty: 1, unit: 'bonus', estimatedCents: amount }],
        initialStatus: 'pending_approval',
      });
      if (cards[0]) {
        await setShineCardGift(familyId, cards[0].id, `💵 Recognition bonus`, {
          label: '💵 Recognition bonus (payroll)', source: 'custom', pathway: 'simple', amountCents: amount,
        }).catch(() => {});
        await refreshCards();
      }
      setBonusAmount('');
      setGiftMsg('💼 Bonus request created in Payroll — approve it there to seal the pay.');
    } catch (e) { setGiftMsg(e instanceof Error ? e.message : 'Could not create the bonus request.'); }
    setBonusBusy(false);
  };

  if (state === 'loading') {
    return <p className="text-[12.5px] text-hive-muted py-4">Reading {helper.displayName.split(' ')[0]}&apos;s last 4 weeks…</p>;
  }
  if (state === 'error' || !dials) {
    return <p className="text-[12.5px] text-hive-muted py-4">Could not compute the scorecard — try again shortly.</p>;
  }

  const first = helper.displayName.split(' ')[0];
  return (
    <div className="space-y-3">
      {/* 🤝 HR PR-3 — this month's spotlight, when it shines on THIS helper */}
      {round?.item?.helperUid === helper.uid && (
        <div className="bg-hive-honey/25 border-2 border-hive-honey-dk rounded-hive p-3 flex items-start gap-2.5">
          <span className="text-2xl">{LENS_EMOJI[round.lens] || '🌟'}</span>
          <div className="min-w-0 flex-1">
            <p className="font-nunito font-black text-[13.5px]">This month&apos;s helper spotlight: {first}!</p>
            <p className="text-[12px] text-hive-ink mt-0.5">{round.item.line}</p>
            <button type="button"
              onClick={() => setQuote(suggestions[0] || `Asante ${first}!`)}
              className="mt-2 px-3 py-1.5 rounded-hive bg-hive-honey hover:bg-hive-honey-dk border border-hive-honey-dk text-hive-ink font-nunito font-black text-[11.5px]">
              🧡 Turn it into an Asante card
            </button>
          </div>
        </div>
      )}

      {/* Composite */}
      <div className="bg-white border border-hive-line rounded-hive p-3 space-y-2.5">
        <div className="flex items-center gap-3">
          <span className="font-nunito font-black text-3xl" style={{ color: dialColor(dials.score) }}>
            {dials.score === null ? '—' : dials.score}
          </span>
          <div className="min-w-0">
            <p className="font-nunito font-extrabold text-[13px]">🤝 Helper Score · last 4 weeks</p>
            <p className="text-[11px] text-hive-muted">Weighted blend of the five dials below (missing dials sit out, weights renormalise).</p>
          </div>
        </div>
        {/* 📤 Share this one helper's card — the ⚖️ Compare pattern, for one
            person, in the language they read. */}
        <div className="flex items-center gap-2 flex-wrap pt-0.5 border-t border-hive-line/70">
          <button
            type="button"
            disabled={sharing}
            onClick={async () => {
              setSharing(true);
              try {
                await shareScorecardPng(
                  [{ name: helper.displayName, dials }],
                  shareLang,
                  `Kaya-${firstName}-scorecard`,
                );
              } finally { setSharing(false); }
            }}
            className="mt-2 px-3.5 py-2 rounded-hive bg-hive-honey hover:bg-hive-honey-dk text-hive-ink font-nunito font-black text-[12px] border-2 border-hive-honey-dk disabled:opacity-60"
          >
            {sharing ? '…' : '📤 Share as picture'}
          </button>
          <div className="mt-2 flex rounded-full border border-hive-line overflow-hidden">
            {(['en', 'sw'] as CardLang[]).map((l) => (
              <button key={l} type="button" onClick={() => setShareLang(l)}
                className={`px-3 py-1 text-[11px] font-nunito font-black ${shareLang === l ? 'bg-hive-ink text-white' : 'bg-white text-hive-muted'}`}>
                {l === 'en' ? 'English' : 'Kiswahili'}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] text-hive-muted basis-full sm:basis-auto">
            {shareLang === defaultLang
              ? `${firstName}'s language`
              : 'Not their usual language'}
          </p>
        </div>
      </div>

      {/* The five dials */}
      <div className="bg-white border border-hive-line rounded-hive p-3 space-y-1.5">
        {DIAL_META.map((m) => {
          const v = dials[m.key];
          return (
            <div key={m.key} className="flex items-center gap-2.5">
              <span className="w-40 shrink-0 text-[12px] font-nunito font-extrabold">{m.emoji} {m.label}</span>
              <div className="flex-1 h-2 rounded-full bg-hive-cream overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${v ?? 0}%`, background: dialColor(v) }} />
              </div>
              <span className="w-9 text-right text-[12px] font-nunito font-black" style={{ color: dialColor(v) }}>
                {v === null ? '—' : v}
              </span>
              <span className="w-8 text-[9px] text-hive-muted font-bold text-right">×{m.weight}</span>
            </div>
          );
        })}
      </div>

      {/* Facts — the WHY behind the two new dials */}
      <div className="bg-hive-cream/60 border border-dashed border-hive-line rounded-hive p-3 text-[11.5px] text-hive-ink space-y-1">
        <p>🎯 <b>Strictness:</b> {dials.facts.rated} routines rated — {dials.facts.excellent} Excellent · {dials.facts.good} Good · {dials.facts.bad} Bad.{' '}
          {dials.strictness === null
            ? 'Not enough ratings yet to judge honesty (needs 10+).'
            : dials.strictness >= 85
              ? `Healthy, honest mix — ${first} rates what they actually see.`
              : 'Almost everything is Excellent — worth a chat about honest differentiation.'}
        </p>
        <p>✍️ <b>Corrections:</b>{' '}
          {dials.facts.bad === 0
            ? 'No Bad ratings in the window — nothing needed explaining.'
            : `${dials.facts.badWithNote} of ${dials.facts.bad} Bad ratings carried a note that teaches the kid${dials.corrections !== null && dials.corrections < 70 ? ' — remind ' + first + ' that the details matter to the kids' : ' — exactly the coaching kids need'}.`}
        </p>
        <p className="text-hive-muted">📅 Consistency, 🧹 Workplan and 💬 Kids&apos; voice come from the weekly performance snapshots ({dials.facts.weeks} week{dials.facts.weeks === 1 ? '' : 's'} read).</p>
      </div>

      {/* 🧡 Asante card composer (HR PR-2) — one card, two languages */}
      <div className="bg-white border border-hive-line rounded-hive p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <p className="font-nunito font-black text-[14px] flex-1">🧡 Asante card</p>
          <div className="flex rounded-full border border-hive-line overflow-hidden">
            {(['en', 'sw'] as CardLang[]).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)}
                className={`px-3 py-1 text-[11px] font-nunito font-black ${lang === l ? 'bg-hive-ink text-white' : 'bg-white text-hive-muted'}`}>
                {l === 'en' ? 'English' : 'Kiswahili'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => setQuote(s)}
              className="px-2.5 py-1 rounded-full bg-hive-cream text-[10.5px] font-bold text-hive-ink hover:bg-hive-honey/40 text-left">
              {s}
            </button>
          ))}
        </div>
        {kidWords.length > 0 && (
          <div className="bg-hive-cream/50 border border-dashed border-hive-line rounded-hive p-2 space-y-1">
            <p className="text-[10px] uppercase tracking-wider font-nunito font-black text-hive-muted">💬 The kids said — tap one to put it ON the card</p>
            <div className="flex flex-wrap gap-1.5">
              {kidWords.map((w) => {
                const line = `“${w.text}” — ${w.kidName}`;
                const on = kidsLine === line;
                return (
                  <button key={line} type="button" onClick={() => setKidsLine(on ? null : line)}
                    className={`px-2.5 py-1 rounded-full text-[10.5px] font-bold border text-left ${on ? 'bg-hive-ink text-white border-transparent' : 'bg-white text-hive-ink border-hive-line hover:bg-hive-honey/30'}`}>
                    {on ? '✓ ' : ''}{line}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <textarea
          value={quote}
          onChange={(e) => setQuote(e.target.value.slice(0, 400))}
          rows={2}
          placeholder={lang === 'sw' ? `Andika asante yako kwa ${firstName}…` : `Write your thank-you to ${firstName}…`}
          className="w-full border border-hive-line rounded-hive px-3 py-2 text-[13px] resize-none focus:outline-none focus:border-hive-honey-dk"
        />
        {draftSvg && (
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(draftSvg)}`}
            alt="Asante card preview"
            className="w-full max-w-[280px] mx-auto rounded-hive border border-hive-line"
          />
        )}
        <button type="button" onClick={() => void createCard()} disabled={!quote.trim() || creating}
          className="w-full py-2.5 rounded-hive bg-hive-honey hover:bg-hive-honey-dk border-2 border-hive-honey-dk text-hive-ink font-nunito font-black text-[13px] disabled:opacity-50">
          {creating ? 'Creating…' : lang === 'sw' ? '🧡 Tengeneza kadi ya Asante' : '🧡 Create the Asante card'}
        </button>
        {composerMsg && <p className="text-[11.5px] font-bold text-center">{composerMsg}</p>}
      </div>

      {/* 🎁 Gift advisor (HR PR-3) — ideas ranked by the 60-day memory */}
      <div className="bg-white border border-hive-line rounded-hive p-3 space-y-2">
        <p className="font-nunito font-black text-[14px]">🎁 Gift advisor</p>
        <p className="text-[11px] text-hive-muted">
          Tap an idea to seal it onto {first}&apos;s newest Asante card. Recently-given gifts sink down with a ✔ so nothing repeats inside {GIFT_MEMORY_DAYS} days.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {rankedIdeas.map((g) => {
            const given = recentGifts.has(g.toLowerCase());
            return (
              <span key={g} className="inline-flex items-center">
                <button type="button" onClick={() => void recordGift(g)}
                  className={`px-2.5 py-1.5 rounded-l-full text-[11px] font-bold border border-hive-line ${given ? 'bg-hive-cream/50 text-hive-muted' : 'bg-hive-cream text-hive-ink hover:bg-hive-honey/40'}`}>
                  {g}{given ? ' ✔' : ''}
                </button>
                {usingOwnBank ? (
                  <button type="button" onClick={() => void removeIdea(g)} title="Remove from the gift bank"
                    className="px-1.5 py-1.5 rounded-r-full text-[10px] font-black text-hive-muted border border-l-0 border-hive-line hover:text-rose-500">✕</button>
                ) : <span className="rounded-r-full border border-l-0 border-hive-line px-1 py-1.5 text-[10px] text-transparent">·</span>}
              </span>
            );
          })}
        </div>
        <div className="flex gap-1.5">
          <input value={newIdea} onChange={(e) => setNewIdea(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addIdea(); }}
            placeholder="Add your own gift idea…"
            className="flex-1 border border-hive-line rounded-hive px-3 py-1.5 text-[12px] focus:outline-none focus:border-hive-honey-dk" />
          <button type="button" onClick={() => void addIdea()} disabled={!newIdea.trim()}
            className="px-3 rounded-hive bg-hive-cream border border-hive-line text-[12px] font-nunito font-black disabled:opacity-40">＋</button>
        </div>
        {/* 💼 Payroll-sealed bonus */}
        <div className="border-t border-dashed border-hive-line pt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-nunito font-extrabold">💼 Cash bonus via Payroll:</span>
          <input value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal" placeholder="Amount"
            className="w-24 border border-hive-line rounded-hive px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-hive-honey-dk" />
          <button type="button" onClick={() => void sendBonus()} disabled={bonusBusy || !Number(bonusAmount)}
            className="px-3 py-1.5 rounded-hive bg-hive-ink text-white text-[11.5px] font-nunito font-black disabled:opacity-40">
            {bonusBusy ? 'Creating…' : 'Create bonus request'}
          </button>
          <Link href="/pantry/payroll" className="text-[11px] font-black text-hive-muted hover:underline">Payroll →</Link>
        </div>
        {giftMsg && <p className="text-[11.5px] font-bold">{giftMsg}</p>}
      </div>

      {/* The helper's Asante wall — every card, shareable, EN↔SW switch */}
      {cards.length > 0 && (
        <div className="bg-white border border-hive-line rounded-hive p-3 space-y-3">
          <p className="font-nunito font-black text-[13px]">🗂 {firstName}&apos;s Asante wall · {cards.length}</p>
          {cards.map((card) => (
            <div key={card.id} className="border border-hive-line rounded-hive p-2.5">
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(shineCardSvg(card))}`}
                alt={`Asante card №${card.n}`}
                className="w-full max-w-[280px] mx-auto rounded-hive"
              />
              <div className="flex items-center justify-center gap-2 mt-2">
                <div className="flex rounded-full border border-hive-line overflow-hidden">
                  {(['en', 'sw'] as CardLang[]).map((l) => (
                    <button key={l} type="button" onClick={() => void switchCardLang(card, l)}
                      className={`px-2.5 py-0.5 text-[10px] font-nunito font-black ${(card.lang ?? 'en') === l ? 'bg-hive-ink text-white' : 'bg-white text-hive-muted'}`}>
                      {l.toUpperCase()}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => void removeCard(card)}
                  className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black text-hive-muted border border-hive-line hover:text-rose-500">
                  🗑
                </button>
              </div>
              <CardShareRow familyId={familyId} card={card} compact />
            </div>
          ))}
        </div>
      )}

      <p className="text-[10.5px] text-hive-muted">
        🌟 Every first Monday, Kaya's helper round rotates the spotlight — 🏆 Best · 📈 Most improved · 🕯️ Unsung — and rings the parents to celebrate here.
      </p>
    </div>
  );
}
