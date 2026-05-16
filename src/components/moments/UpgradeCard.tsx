'use client';

// The Keepsake → Family upgrade prompt. Surfaces when a free-tier
// user hits a gate (creating a 2nd album, adding the 201st photo,
// trying custom access on a sub-album, etc.). For week-1 ship the
// CTA reads "Coming soon" — week 2 wires the payment provider and
// flips this to a checkout redirect.

interface Props {
  reason: string;
  /** Toggle the CTA between "Notify me" (pre-launch) and "Upgrade"
   *  (post-launch). Week-1 ship uses 'notify'. */
  ctaMode?: 'notify' | 'upgrade';
  onNotify?: () => void;
  onUpgrade?: () => void;
  /** Optional usage metric to show as a near-full progress bar. */
  usage?: { current: number; max: number; label: string };
}

export default function UpgradeCard({
  reason, ctaMode = 'notify', onNotify, onUpgrade, usage,
}: Props) {
  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-kaya-sm bg-kaya-gold-light flex items-center justify-center text-xl flex-shrink-0">✨</div>
        <div className="flex-1">
          <p className="text-[10px] font-display font-black uppercase tracking-wider text-kaya-gold-dark">Keepsake · Family plan</p>
          <p className="font-display font-black text-base text-kaya-chocolate leading-tight mt-0.5">Unlimited albums & sub-albums</p>
          <p className="text-xs text-kaya-sand mt-1 leading-relaxed">{reason}</p>
        </div>
      </div>

      {usage && (
        <div>
          <div className="h-1.5 rounded-full bg-kaya-warm overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-kaya-gold to-red-600"
              style={{ width: `${Math.min(100, Math.round((usage.current / usage.max) * 100))}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] font-display font-bold text-kaya-sand mt-1.5">
            <span>{usage.label}</span>
            <span className="text-red-700">{Math.round((usage.current / usage.max) * 100)}%</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-kaya-cream border border-kaya-warm-dark rounded-md p-2">
          <p className="font-display font-black text-kaya-gold-dark text-sm">50 GB</p>
          <p className="text-[10px] text-kaya-sand mt-0.5">Storage</p>
        </div>
        <div className="bg-kaya-cream border border-kaya-warm-dark rounded-md p-2">
          <p className="font-display font-black text-kaya-gold-dark text-sm">Unlimited</p>
          <p className="text-[10px] text-kaya-sand mt-0.5">Albums + sub-albums</p>
        </div>
        <div className="bg-kaya-cream border border-kaya-warm-dark rounded-md p-2">
          <p className="font-display font-black text-amber-800 text-sm">AI</p>
          <p className="text-[10px] text-kaya-sand mt-0.5">"On this day", faces</p>
        </div>
        <div className="bg-kaya-cream border border-kaya-warm-dark rounded-md p-2">
          <p className="font-display font-black text-emerald-700 text-sm">Custom</p>
          <p className="text-[10px] text-kaya-sand mt-0.5">Per-album access</p>
        </div>
      </div>

      {ctaMode === 'notify' ? (
        <button
          onClick={onNotify}
          className="h-11 rounded-kaya-sm bg-kaya-chocolate text-kaya-gold-light font-display font-black text-sm hover:bg-kaya-chocolate-light transition-colors"
        >
          Notify me when Family plan launches
        </button>
      ) : (
        <button
          onClick={onUpgrade}
          className="h-11 rounded-kaya-sm bg-kaya-chocolate text-kaya-gold-light font-display font-black text-sm hover:bg-kaya-chocolate-light transition-colors"
        >
          Upgrade · Tsh 12,000 / month
        </button>
      )}
    </div>
  );
}
