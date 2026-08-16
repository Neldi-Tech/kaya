'use client';

// 🌟 Recognition Wizard (FX PR-4) — Elia's flow, 16-Aug-2026:
//   1 pick the recognition line (details + PROPOSED type: mention/gift/token)
//   2 open it → see in detail what's there to recognize
//   3 pick the gift, customize it, or simply say 🎲 surprise
//   4 then decide points or not (new 'Recognition' award category)
//   5 the Shine Card is created from those choices
//   6 APPROVE → award rail fires + auto-post to Moments + parent emails,
//     and the card can go out 📤 (WhatsApp etc.) from the done screen
//   7 the streak sits on the side
// Everything still rides the existing award rail — the wizard only
// orchestrates it.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  giveAward, getFamilyMembers, readPointSystemConfig,
  type AwardKind,
} from '@/lib/firestore';
import { rewardsFloorFor, type FamilyRewardsSlice } from '@/lib/hive';
import {
  getWaitingRound, createShineCard, listShineCards, listRounds,
  rememberedTheme, rememberTheme, shineCardSvg,
  SHINE_THEMES, type ShineCard, type ShineTheme, type WaitingRound,
} from '@/lib/shineCards';
import { CardShareRow, postShineCardToMoments } from '@/components/rewards/ShineCards';
import { notifyAward } from '@/lib/notify';

type Step = 'list' | 'detail' | 'gift' | 'points' | 'preview' | 'done';
type Item = WaitingRound['round']['items'][number];

const PROPOSAL: Record<string, { chip: string; blurb: string }> = {
  coverage: { chip: '✨ Mention', blurb: 'A warm mention goes a long way — they have waited the longest.' },
  best:     { chip: '🎁 Gift',    blurb: 'A strong week deserves something real — a gift fits.' },
  improved: { chip: '🎖️ Token',  blurb: 'Climbing hard — a token of the comeback keeps the climb going.' },
  comeback: { chip: '🎖️ Token',  blurb: 'Bounced back after a rough patch — mark it with a token.' },
};

const svgDataUrl = (card: ShineCard) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(shineCardSvg(card))}`;

export default function RecognitionWizard() {
  const { profile } = useAuth();
  const { family, children, rewards } = useFamily();
  const familyId = profile?.familyId || '';
  const pointSystem = readPointSystemConfig(family);
  const diamondMin = pointSystem.diamondMinPoints;

  const [waiting, setWaiting] = useState<WaitingRound | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!familyId || !profile) return;
    getWaitingRound(familyId, profile.uid, profile.role)
      .then(setWaiting).catch(() => setWaiting(null))
      .finally(() => setLoaded(true));
  }, [familyId, profile]);

  const [step, setStep] = useState<Step>('list');
  const [item, setItem] = useState<Item | null>(null);
  const [message, setMessage] = useState('');
  const [gift, setGift] = useState('');
  const [giftCustom, setGiftCustom] = useState(false);
  // 🎁 FX PR-5 — structured gift record for future statistics.
  const [giftSource, setGiftSource] = useState<'store' | 'custom' | 'surprise' | ''>('');
  const [giftRewardId, setGiftRewardId] = useState('');
  const [pts, setPts] = useState(0); // 0 = mention only (kudos on the rail)
  const [theme, setTheme] = useState<ShineTheme>('classic');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [card, setCard] = useState<ShineCard | null>(null);
  const [emailed, setEmailed] = useState(0);

  // 🔥 side stats (step 7) — streak of answered rounds + cards this week.
  const [side, setSide] = useState<{ streak: number; week: number } | null>(null);
  useEffect(() => {
    if (!familyId) return;
    (async () => {
      try {
        const [cards, rounds] = await Promise.all([listShineCards(familyId), listRounds(familyId)]);
        const answered = (date: string) => {
          const start = new Date(`${date}T00:00:00`).getTime();
          return cards.some((c) => c.at >= start && c.at < start + 72 * 3600_000);
        };
        let streak = 0;
        for (const r of [...rounds].sort((a, b) => b.date.localeCompare(a.date))) {
          const start = new Date(`${r.date}T00:00:00`).getTime();
          if (Date.now() < start + 72 * 3600_000 && !answered(r.date)) continue;
          if (answered(r.date)) streak++; else break;
        }
        const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0);
        setSide({ streak, week: cards.filter((c) => c.at >= monday.getTime()).length });
      } catch { setSide(null); }
    })();
  }, [familyId, step]);

  const kid = item ? children.find((c) => c.id === item.kidId) : null;
  const detailLine = item
    ? (item.line.includes('— ') ? item.line.slice(item.line.indexOf('— ') + 2) : item.line)
    : '';

  // 🎁 store suggestions for THIS kid (2 within reach + 1 stretch).
  const giftIdeas = useMemo(() => {
    if (!kid) return [];
    const floor = rewardsFloorFor(family as FamilyRewardsSlice | undefined, kid.id);
    const spend = Math.max(0, (kid.totalPoints || 0) - floor);
    const act = (rewards || []).filter((r) => r.active && r.kind !== 'family');
    const within = act.filter((r) => r.pointsCost <= spend).sort((a, b) => b.pointsCost - a.pointsCost).slice(0, 2);
    const stretch = act.filter((r) => r.pointsCost > spend).sort((a, b) => a.pointsCost - b.pointsCost).slice(0, 1);
    return [...within, ...stretch].slice(0, 3);
  }, [kid, family, rewards]);

  const openItem = (it: Item) => {
    setItem(it);
    setMessage('');
    setGift(''); setGiftCustom(false); setGiftSource(''); setGiftRewardId('');
    setPts(0);
    setTheme(profile ? rememberedTheme(profile.uid) : 'classic');
    setErr('');
    setStep('detail');
  };

  const previewCard: ShineCard | null = item && kid && profile ? {
    id: 'preview', n: 0,
    kidId: kid.id, kidName: kid.name.split(' ')[0], kidEmoji: kid.avatarEmoji || '🧒',
    theme, quote: message.trim() || detailLine,
    by: profile.uid, byName: profile.displayName.split(' ')[0], at: Date.now(),
    kindLabel: pts > 0 ? 'points' : 'kudos',
    pointsLabel: pts > 0 ? `${pts >= diamondMin ? '💎' : '⭐'} +${pts} PTS` : '🌟 RECOGNITION',
    category: 'Recognition',
    ...(gift.trim() ? { gift: gift.trim() } : {}),
  } : null;

  const approve = async () => {
    if (!profile || !kid || !item || !previewCard || busy) return;
    setBusy(true); setErr('');
    try {
      // ⑥a — the award rail (points → regular/diamond; mention → kudos).
      const kindAward: AwardKind = pts > 0 ? (pts >= diamondMin ? 'diamond' : 'regular') : 'kudos';
      const res = await giveAward(familyId, {
        childId: kid.id,
        kind: kindAward,
        points: pts,
        reason: previewCard.quote,
        category: kindAward === 'diamond' ? 'diamond-recognition' : 'recognition',
        awardedBy: profile.uid,
        awardedByName: profile.displayName,
      });
      // ⑥b — the Shine Card, from the choices as designed.
      const minted = await createShineCard({
        familyId,
        kidId: kid.id,
        kidName: previewCard.kidName,
        kidEmoji: previewCard.kidEmoji,
        awardId: res.id,
        theme,
        quote: previewCard.quote,
        kindLabel: kindAward,
        pointsLabel: previewCard.pointsLabel,
        category: 'Recognition',
        roundDate: waiting?.round.date,
        ...(previewCard.gift ? {
          gift: previewCard.gift,
          giftMeta: {
            label: previewCard.gift,
            source: giftSource || 'custom',
            ...(giftRewardId ? { rewardId: giftRewardId } : {}),
          },
        } : {}),
      });
      const full: ShineCard = { ...previewCard, id: minted.id, n: minted.n, doubleShine: minted.doubleShine, notes: [] };
      setCard(full);
      if (profile) rememberTheme(profile.uid, theme);
      // ⑥c — auto-post to Moments (best-effort; card links back).
      postShineCardToMoments(familyId, profile, full).catch(() => {});
      // ⑥d — parent/helper emails (best-effort).
      (async () => {
        try {
          const members = await getFamilyMembers(familyId);
          const to = members
            .filter((m) => (m.role === 'parent' || m.role === 'helper') && m.uid !== profile.uid && m.email && m.notifyOnAward !== false)
            .map((m) => m.email);
          if (to.length) {
            await notifyAward({
              to,
              childName: kid.name,
              actorName: profile.displayName,
              points: pts,
              reason: previewCard.quote,
              isDiamond: kindAward === 'diamond',
            });
            setEmailed(to.length);
          }
        } catch { /* best-effort */ }
      })();
      setStep('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not complete — try again.');
    }
    setBusy(false);
  };

  if (!profile || !loaded) return null;

  const celebrated = new Set(waiting?.celebratedKidIds || []);
  const items = waiting ? waiting.round.items.filter((i) => !celebrated.has(i.kidId)) : [];

  // ── Shell ─────────────────────────────────────────────────────────
  const shell = (content: React.ReactNode, backTo?: Step) => (
    <div className="rounded-kaya p-4 mb-5 text-white" style={{ background: 'linear-gradient(130deg,#6B3FE0,#9b6bff)' }}>
      {backTo && step !== 'done' && (
        <button type="button" onClick={() => setStep(backTo)} className="text-[11px] font-black opacity-80 mb-1.5">‹ back</button>
      )}
      {content}
      {err && <p className="text-[12px] font-bold mt-2 bg-white/20 rounded-kaya-sm px-3 py-1.5">⚠️ {err}</p>}
    </div>
  );

  // ① The list — details + proposed recognition.
  if (step === 'list') {
    if (items.length === 0) {
      return (
        <div className="rounded-kaya border border-kaya-warm-dark bg-white px-4 py-3 mb-5">
          <p className="text-[12.5px] font-bold">✅ Nothing waiting — every round is answered.</p>
          <p className="text-[11px] text-kaya-sand mt-0.5">Spotted something shine-worthy anyway? <Link href="/award" className="text-kaya-gold font-bold hover:underline">Celebrate spontaneously →</Link></p>
        </div>
      );
    }
    return shell(
      <>
        <p className="text-[9.5px] uppercase tracking-[0.14em] font-bold opacity-85 mb-1.5">
          🌟 Round of {waiting!.round.date.slice(8)}/{waiting!.round.date.slice(5, 7)} · tap to open
        </p>
        <div className="space-y-1.5">
          {items.map((it) => {
            const prop = PROPOSAL[it.kind] || PROPOSAL.coverage;
            return (
              <button key={`${it.kidId}-${it.kind}`} type="button" onClick={() => openItem(it)}
                className="w-full text-left rounded-kaya-sm px-3 py-2.5 transition-colors hover:bg-white/25"
                style={{ background: 'rgba(255,255,255,.13)', border: '1px solid rgba(255,255,255,.25)' }}>
                <p className="text-[12.5px] font-bold">{it.emoji} {it.line}</p>
                <p className="text-[10.5px] font-black mt-1"><span className="px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,.25)' }}>proposed: {prop.chip}</span></p>
              </button>
            );
          })}
        </div>
      </>,
    );
  }

  if (!item || !kid) { setStep('list'); return null; }
  const prop = PROPOSAL[item.kind] || PROPOSAL.coverage;

  // ② The detail — what's there to be recognized.
  if (step === 'detail') {
    return shell(
      <>
        <p className="text-[15px] font-black">{kid.avatarEmoji} {kid.name.split(' ')[0]}</p>
        <div className="rounded-kaya-sm px-3 py-2.5 mt-2" style={{ background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.28)' }}>
          <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">What&apos;s there to recognize</p>
          <p className="text-[13px] font-bold mt-1">{item.emoji} {detailLine}</p>
          {item.daysSince != null && <p className="text-[11.5px] opacity-85 mt-0.5">⏳ {item.daysSince} days since their last award.</p>}
          <p className="text-[11.5px] opacity-85 mt-0.5">{prop.blurb}</p>
        </div>
        <p className="text-[10px] uppercase tracking-wider font-bold opacity-80 mt-3 mb-1">Your words on the card (edit freely)</p>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={240}
          placeholder={detailLine}
          className="w-full px-3 py-2 rounded-kaya-sm text-[13px] text-kaya-chocolate focus:outline-none" />
        <button type="button" onClick={() => setStep('gift')}
          className="mt-2.5 h-10 px-5 rounded-full text-[12.5px] font-black" style={{ background: '#fff', color: '#6B3FE0' }}>
          Continue → 🎁
        </button>
      </>,
      'list',
    );
  }

  // ③ The gift — pick, customize, or surprise.
  if (step === 'gift') {
    return shell(
      <>
        <p className="text-[13px] font-black mb-1.5">🎁 A gift, token or treat for {kid.name.split(' ')[0]}?</p>
        <div className="flex gap-1.5 flex-wrap">
          {giftIdeas.map((g) => (
            <button key={g.id} type="button"
              onClick={() => {
                const label = `${g.icon} ${g.title}`;
                const off = gift === label;
                setGift(off ? '' : label); setGiftCustom(false);
                setGiftSource(off ? '' : 'store'); setGiftRewardId(off ? '' : g.id);
              }}
              className="px-3 py-1.5 rounded-full text-[11.5px] font-black"
              style={gift === `${g.icon} ${g.title}` ? { background: '#fff', color: '#6B3FE0' } : { background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.35)' }}>
              {g.icon} {g.title}
            </button>
          ))}
          <button type="button" onClick={() => { setGiftCustom((v) => !v); setGift(''); }}
            className="px-3 py-1.5 rounded-full text-[11.5px] font-black"
            style={giftCustom ? { background: '#fff', color: '#6B3FE0' } : { background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.35)' }}>
            ✏️ Customize
          </button>
          <button type="button" onClick={() => { setGift('A surprise is coming… 🎲'); setGiftCustom(false); }}
            className="px-3 py-1.5 rounded-full text-[11.5px] font-black"
            style={gift.startsWith('A surprise') ? { background: '#fff', color: '#6B3FE0' } : { background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.35)' }}>
            🎲 Surprise
          </button>
        </div>
        {giftCustom && (
          <input value={gift} onChange={(e) => setGift(e.target.value)} maxLength={60} autoFocus
            placeholder="e.g. Ice cream cone after school"
            className="mt-2 w-full h-10 px-3 rounded-kaya-sm text-[13px] text-kaya-chocolate focus:outline-none" />
        )}
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={() => setStep('points')}
            className="h-10 px-5 rounded-full text-[12.5px] font-black" style={{ background: '#fff', color: '#6B3FE0' }}>
            Continue → ⭐
          </button>
          <button type="button" onClick={() => { setGift(''); setGiftSource(''); setGiftRewardId(''); setStep('points'); }}
            className="h-10 px-4 rounded-full text-[12px] font-black" style={{ background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.4)' }}>
            Skip — no gift
          </button>
        </div>
      </>,
      'detail',
    );
  }

  // ④ Points or not — new 'Recognition' category either way.
  if (step === 'points') {
    return shell(
      <>
        <p className="text-[13px] font-black mb-1.5">⭐ Add points, or keep it a mention?</p>
        <div className="flex gap-1.5 flex-wrap items-center">
          <button type="button" onClick={() => setPts(0)}
            className="px-3 py-1.5 rounded-full text-[11.5px] font-black"
            style={pts === 0 ? { background: '#fff', color: '#6B3FE0' } : { background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.35)' }}>
            💬 Mention only
          </button>
          {[1, 2, 3, diamondMin, diamondMin + 2].map((p) => (
            <button key={p} type="button" onClick={() => setPts(p)}
              className="px-3 py-1.5 rounded-full text-[11.5px] font-black"
              style={pts === p ? { background: '#fff', color: '#6B3FE0' } : { background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.35)' }}>
              {p >= diamondMin ? '💎' : '⭐'} +{p}
            </button>
          ))}
        </div>
        <p className="text-[10.5px] opacity-80 mt-1.5">Either way it lands under the 🌟 <b>Recognition</b> category{pts === 0 ? ' (a mention rides the Kudos rail — it still counts and still shines)' : ''}.</p>
        <button type="button" onClick={() => setStep('preview')}
          className="mt-3 h-10 px-5 rounded-full text-[12.5px] font-black" style={{ background: '#fff', color: '#6B3FE0' }}>
          Create the card → 🌟
        </button>
      </>,
      'gift',
    );
  }

  // ⑤ The card, as designed — then ⑥ approve.
  if (step === 'preview' && previewCard) {
    return shell(
      <>
        <p className="text-[13px] font-black mb-2">🌟 The card — approve to send</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={svgDataUrl(previewCard)} alt="Shine Card preview" className="w-full max-w-[330px] mx-auto rounded-kaya" />
        <div className="flex gap-1.5 flex-wrap mt-2.5 justify-center">
          {SHINE_THEMES.map((t) => (
            <button key={t.id} type="button" onClick={() => setTheme(t.id)}
              className="px-2.5 py-1 rounded-full text-[10.5px] font-black"
              style={theme === t.id ? { background: '#fff', color: '#6B3FE0' } : { background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.35)' }}>
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void approve()} disabled={busy}
          className="mt-3 w-full h-11 rounded-full text-[13px] font-black disabled:opacity-60" style={{ background: '#fff', color: '#6B3FE0' }}>
          {busy ? 'Sending…' : `✅ Approve — award${pts > 0 ? ` +${pts}` : ''}, card, Moments & emails`}
        </button>
      </>,
      'points',
    );
  }

  // ⑥ done + ⑦ streak on the side.
  if (step === 'done' && card) {
    return (
      <div className="rounded-kaya p-4 mb-5 text-white" style={{ background: 'linear-gradient(130deg,#6B3FE0,#9b6bff)' }}>
        <div className="lg:flex lg:gap-5 lg:items-start">
          <div className="lg:flex-1">
            <p className="text-[14px] font-black">🎉 Sent! Shine Card №{card.n} for {card.kidName}{card.doubleShine ? ' · 🤝 Double Shine!' : ''}</p>
            <p className="text-[11px] opacity-85 mt-0.5">
              ✅ award rail · 📣 posted to Moments{emailed > 0 ? ` · 📧 ${emailed} email${emailed === 1 ? '' : 's'}` : ''} · bell rang
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgDataUrl(card)} alt={`Shine Card ${card.n}`} className="w-full max-w-[330px] rounded-kaya mt-2.5" />
            <div className="bg-white rounded-kaya p-3 mt-2.5 text-kaya-chocolate">
              <CardShareRow familyId={familyId} card={card} compact />
              <p className="text-[10px] text-kaya-sand text-center mt-1.5">📤 Share opens your phone&apos;s share sheet — WhatsApp and all.</p>
            </div>
          </div>
          <div className="mt-3 lg:mt-0 lg:w-44 shrink-0 space-y-2">
            {side && (
              <>
                <div className="rounded-kaya-sm px-3 py-2.5 text-center" style={{ background: 'rgba(255,255,255,.15)' }}>
                  <p className="font-black text-xl">🔥 {side.streak}</p>
                  <p className="text-[9px] uppercase tracking-wider font-bold opacity-80">Rounds in a row</p>
                </div>
                <div className="rounded-kaya-sm px-3 py-2.5 text-center" style={{ background: 'rgba(255,255,255,.15)' }}>
                  <p className="font-black text-xl">{side.week}</p>
                  <p className="text-[9px] uppercase tracking-wider font-bold opacity-80">Cards this week</p>
                </div>
              </>
            )}
            {items.length > 0 && (
              <button type="button" onClick={() => { setCard(null); setStep('list'); }}
                className="w-full h-10 rounded-full text-[11.5px] font-black" style={{ background: '#fff', color: '#6B3FE0' }}>
                🌟 Next: {items.length} more waiting
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
