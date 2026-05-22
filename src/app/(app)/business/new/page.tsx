'use client';

// Kaya Business · New business (kid screen 2) — v2, AI-first.
//
// "Create with Kaya AI": the child types one line and Kaya drafts the whole
// business — best type, a standardized name + mission + emoji, and starter
// products (each a standardized name + unit + starter price). The child tweaks
// anything, can ✨ draw a picture per product or ask for more, then creates.
// "Build it myself" is the same editor without the AI draft.
//
// Each product is a row: Name · Unit (selection incl. Other) · Price per unit.
// For goods these become Inventory items at qty 0 — worth fills in at the first
// stock-take (see createBusiness in business.ts). AI features degrade silently
// when their API keys are absent (manual entry always works).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  BUSINESS_TYPES, BusinessType, CustomerChannel, PHASE1_BUSINESS_TYPES,
  CUSTOMER_CHANNELS, UNIT_SUGGESTIONS, ProductDraft,
  createBusiness, newBusinessId, readBusinessConfig,
} from '@/lib/business';
import { uploadBusinessPhotoFromDataUrl } from '@/lib/businessPhoto';
import AIImageButton from '@/components/business/AIImageButton';

interface Row {
  id: string;
  name: string;
  unit: string;
  customUnit: boolean;   // true → `unit` is free text (the "Other…" path)
  price: string;         // major units, as typed
  imageDataUrl: string;  // AI-generated, uploaded to Storage on submit
  showImage: boolean;    // the per-row picture generator is open
}

const rid = () => Math.random().toString(36).slice(2, 9);
const newRow = (): Row => ({ id: rid(), name: '', unit: '', customUnit: false, price: '', imageDataUrl: '', showImage: false });

interface DraftProduct { name: string; unit: string; priceCents: number }
function toRow(p: DraftProduct): Row {
  const known = UNIT_SUGGESTIONS.includes(p.unit);
  return {
    id: rid(),
    name: p.name || '',
    unit: p.unit || '',
    customUnit: !!p.unit && !known,
    price: p.priceCents ? String(p.priceCents / 100) : '',
    imageDataUrl: '',
    showImage: false,
  };
}

const parsePriceCents = (s: string): number => {
  const n = parseFloat((s || '').replace(/,/g, ''));
  return Number.isNaN(n) || n <= 0 ? 0 : Math.round(n * 100);
};

export default function NewBusinessPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const { activeKidId, config } = useHive();
  const isParent = profile?.role === 'parent';
  const bizConfig = useMemo(() => readBusinessConfig(family), [family]);
  const currency = config.currency;

  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [idea, setIdea] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [aiOff, setAiOff] = useState(false);
  const [coachMsg, setCoachMsg] = useState('');
  const [showEditor, setShowEditor] = useState(false);

  const [type, setType] = useState<BusinessType>('goods');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [mission, setMission] = useState('');
  const [channels, setChannels] = useState<CustomerChannel[]>(['family']);
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [suggesting, setSuggesting] = useState(false);

  const [forKid, setForKid] = useState<string | null>(activeKidId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Phase-1 creatable types only (goods / service / adhoc).
  const pickable = BUSINESS_TYPES.filter((t) => PHASE1_BUSINESS_TYPES.includes(t.key));
  const keepsInventory = !!BUSINESS_TYPES.find((t) => t.key === type)?.shape.includes('inventory');
  const typeLabel = BUSINESS_TYPES.find((t) => t.key === type)?.label || 'Business';

  // Parent: fall back to the first kid so a not-yet-resolved activeKidId can't
  // silently leave the form with no owner.
  const effectiveKid = isParent ? (forKid ?? children[0]?.id ?? null) : null;
  const ownerId = isParent ? effectiveKid : (profile?.childId ?? null);

  const visibleRows = keepsInventory ? rows : rows.slice(0, 1);
  const hasProduct = rows.some((r) => r.name.trim());
  const canSubmit = name.trim().length > 1 && !!ownerId && channels.length > 0 && !saving
    && (keepsInventory ? hasProduct : true);

  const patchRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  const toggleChannel = (c: CustomerChannel) =>
    setChannels((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);

  const draft = async () => {
    if (!idea.trim()) return;
    setDrafting(true); setDraftError(''); setAiOff(false);
    try {
      const r = await fetch('/api/business-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'draft', idea: idea.trim(), currency, coachName: bizConfig.coachName }),
      });
      const j = await r.json();
      if (j?.skipped) { setAiOff(true); setShowEditor(true); return; }
      if (!r.ok || j?.error) { setDraftError(j?.error || 'Could not draft just now.'); return; }
      if (j.type) setType(j.type as BusinessType);
      setName((j.name || '').toString());
      setMission((j.mission || '').toString());
      setEmoji((j.emoji || '').toString());
      setCoachMsg((j.message || '').toString());
      const prods: DraftProduct[] = Array.isArray(j.products) ? j.products : [];
      setRows(prods.length ? prods.map(toRow) : [newRow()]);
      setShowEditor(true);
    } catch {
      setDraftError('Could not draft just now.');
    } finally {
      setDrafting(false);
    }
  };

  const suggestMore = async () => {
    setSuggesting(true);
    try {
      const r = await fetch('/api/business-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'suggest', name: name.trim(), type, currency, coachName: bizConfig.coachName,
          existing: rows.map((x) => x.name.trim()).filter(Boolean),
        }),
      });
      const j = await r.json();
      if (j?.skipped) { setAiOff(true); return; }
      if (!r.ok || j?.error) return;
      const prods: DraftProduct[] = Array.isArray(j.products) ? j.products : [];
      if (prods.length) {
        setRows((prev) => {
          const blanks = prev.filter((p) => !p.name.trim());
          const filled = prev.filter((p) => p.name.trim());
          return [...filled, ...prods.map(toRow), ...blanks];
        });
      }
    } catch { /* soft-fail — suggestions are a bonus */ } finally {
      setSuggesting(false);
    }
  };

  const goManual = () => { setMode('manual'); setShowEditor(true); };

  const submit = async () => {
    if (!profile?.familyId || !ownerId) return;
    setError(''); setSaving(true);
    try {
      const familyId = profile.familyId;
      const businessId = newBusinessId(familyId);
      const cleaned = rows.filter((r) => r.name.trim());
      const products: ProductDraft[] = [];
      for (const r of cleaned) {
        let photoUrl: string | undefined;
        if (r.imageDataUrl) {
          try { photoUrl = await uploadBusinessPhotoFromDataUrl(familyId, businessId, r.imageDataUrl); } catch { /* picture is optional */ }
        }
        products.push({
          name: r.name.trim(),
          unit: (r.customUnit ? r.unit.trim() : r.unit),
          priceCents: parsePriceCents(r.price),
          ...(photoUrl ? { photoUrl } : {}),
        });
      }
      const created = await createBusiness(
        familyId,
        {
          type,
          name: name.trim(),
          emoji: emoji.trim() || BUSINESS_TYPES.find((t) => t.key === type)?.emoji || '💼',
          mission: mission.trim() || undefined,
          customerChannels: channels,
          products,
          hiveSplit: bizConfig.defaultHiveSplit,
        },
        { uid: profile.uid, ownerId, isParent, name: profile.displayName || undefined },
        businessId,
      );
      router.push(created.startsWith('guest') ? '/business' : `/business/${businessId}`);
    } catch (e: any) {
      setError(e?.message || 'Could not create the business.');
      setSaving(false);
    }
  };

  const label = 'text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5 mt-3';
  const field = 'w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40';
  const seg = (active: boolean) =>
    `px-3 py-2 rounded-hive-pill text-[12.5px] font-nunito font-extrabold border transition ${
      active ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'
    }`;
  const filledProducts = rows.filter((r) => r.name.trim()).length;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="rounded-hive p-3.5 mb-4 flex items-center gap-3 bg-hive-navy text-hive-honey">
        <div className="text-[22px]">✨</div>
        <div>
          <div className="font-nunito font-black text-[16px]">New business</div>
          <div className="text-[11px] text-hive-honey-soft/80">Create it with Kaya AI</div>
        </div>
      </div>

      {isParent && children.length > 0 && (
        <>
          <div className={label}>Whose business?</div>
          <div className="flex flex-wrap gap-2">
            {children.map((c) => (
              <button key={c.id} type="button" onClick={() => setForKid(c.id)} className={seg(effectiveKid === c.id)}>
                {c.avatarEmoji} {c.name}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Mode toggle */}
      <div className={label}>How do you want to build it?</div>
      <div className="flex gap-1.5 bg-hive-paper border border-hive-line rounded-hive-pill p-1">
        <button type="button" onClick={() => setMode('ai')}
          className={`flex-1 py-2 rounded-hive-pill text-[12.5px] font-nunito font-extrabold transition ${mode === 'ai' ? 'bg-hive-navy text-hive-honey' : 'text-hive-muted'}`}>
          ✨ Create with Kaya AI
        </button>
        <button type="button" onClick={goManual}
          className={`flex-1 py-2 rounded-hive-pill text-[12.5px] font-nunito font-extrabold transition ${mode === 'manual' ? 'bg-hive-navy text-hive-honey' : 'text-hive-muted'}`}>
          Build it myself
        </button>
      </div>

      {/* AI intake */}
      {mode === 'ai' && (
        <>
          <div className={label}>Tell Kaya your idea</div>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="e.g. Nathan's Produce — selling fresh veg from our garden"
            maxLength={280}
            rows={2}
            className="w-full px-3 py-2.5 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
          />
          <button type="button" onClick={draft} disabled={drafting || idea.trim().length < 3}
            className="w-full mt-2 h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition">
            {drafting ? 'Drafting your business… ✨' : showEditor ? '✨ Draft again' : '✨ Draft my business'}
          </button>
          {draftError && <p className="text-hive-rose text-[12px] font-bold mt-2">{draftError}</p>}
          {aiOff && (
            <p className="text-[12px] text-[#B25E16] font-nunito font-bold mt-2">
              Kaya AI is taking a nap — no problem, fill it in yourself below.
            </p>
          )}
          {coachMsg && (
            <div className="rounded-[16px_16px_16px_4px] bg-hive-navy text-hive-cream p-3.5 mt-3">
              <div className="text-[10px] font-nunito font-black uppercase tracking-wider text-hive-honey mb-1">
                🤖 {bizConfig.coachName} · drafted this for you
              </div>
              <p className="text-[13px] leading-relaxed">{coachMsg}</p>
            </div>
          )}
        </>
      )}

      {(mode === 'manual' || showEditor) && (
        <>
          {/* Type */}
          <div className={label}>Type of business</div>
          <div className="grid grid-cols-3 gap-2">
            {pickable.map((t) => {
              const active = type === t.key;
              return (
                <button key={t.key} type="button" onClick={() => setType(t.key)}
                  className={`rounded-hive p-3 text-center border-2 transition ${
                    active ? 'border-hive-navy bg-hive-navy text-hive-honey shadow-sm' : 'border-hive-line bg-hive-paper text-hive-navy'
                  } hover:border-hive-honey active:scale-[0.98]`}>
                  <div className="text-[22px] leading-none">{t.emoji}</div>
                  <div className="text-[11px] font-nunito font-extrabold mt-1">{t.label}</div>
                </button>
              );
            })}
          </div>

          {/* Name + emoji */}
          <div className={label}>Name it</div>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50}
              placeholder="e.g. Nathan's Produce" className={field} />
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={2}
              placeholder={BUSINESS_TYPES.find((t) => t.key === type)?.emoji || '💼'}
              className="w-14 h-11 px-0 text-center text-xl bg-hive-paper rounded-hive border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40 shrink-0" />
          </div>

          <div className={label}>Mission (optional)</div>
          <textarea value={mission} onChange={(e) => setMission(e.target.value)} maxLength={140} rows={2}
            placeholder="What does this business do, in one line?"
            className="w-full px-3 py-2 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />

          {/* Products */}
          <div className={`${label} flex items-baseline gap-1.5`}>
            {keepsInventory ? 'Products' : 'What you sell'}
            {keepsInventory && <span className="normal-case tracking-normal font-nunito font-semibold text-hive-muted">· these become your Inventory</span>}
          </div>

          <div className="space-y-2.5">
            {visibleRows.map((r) => (
              <ProductRowCard
                key={r.id}
                row={r}
                currency={currency}
                detail={`${typeLabel} · ${name.trim()}`.trim()}
                canRemove={keepsInventory && rows.length > 1}
                onPatch={(p) => patchRow(r.id, p)}
                onRemove={() => removeRow(r.id)}
              />
            ))}
          </div>

          {keepsInventory && (
            <div className="flex gap-2 mt-2.5">
              <button type="button" onClick={() => setRows((prev) => [...prev, newRow()])}
                className="flex-1 h-11 rounded-hive bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[13px] hover:bg-hive-cream active:scale-[0.99] transition">
                ＋ Add product
              </button>
              <button type="button" onClick={suggestMore} disabled={suggesting || aiOff}
                className="flex-1 h-11 rounded-hive bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[13px] disabled:opacity-40 hover:bg-hive-cream active:scale-[0.99] transition">
                {suggesting ? 'Thinking… ✨' : '✨ Suggest more'}
              </button>
            </div>
          )}

          {keepsInventory && (
            <div className="bg-hive-cream border border-hive-honey/60 rounded-hive p-3 mt-3 text-[12.5px] leading-relaxed text-hive-navy">
              📦 <b>Each product starts in your Inventory</b> with a count of <b>0</b>. On your first
              {' '}<b>stock-take</b> you set how many you actually have — and the worth fills in.
            </div>
          )}

          {/* Channels */}
          <div className={label}>Who can buy?</div>
          <div className="flex flex-wrap gap-2">
            {CUSTOMER_CHANNELS.map((ch) => {
              const enabled = !ch.gated; // Phase 1: family + relatives only
              const active = channels.includes(ch.key);
              return (
                <button key={ch.key} type="button" disabled={!enabled} onClick={() => toggleChannel(ch.key)}
                  className={`${seg(active)} ${enabled ? '' : 'opacity-45 cursor-not-allowed'}`}>
                  {ch.label}{ch.gated ? ' · soon' : ''}
                </button>
              );
            })}
          </div>

          {error && <p className="text-hive-rose text-[12px] font-bold mt-3">{error}</p>}

          <button type="button" onClick={submit} disabled={!canSubmit}
            className="w-full mt-5 h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition">
            {saving ? 'Creating…'
              : keepsInventory && filledProducts > 0
                ? `Create business + ${filledProducts} ${filledProducts === 1 ? 'product' : 'products'}`
                : isParent ? 'Create business' : 'Start as Pilot →'}
          </button>
          {!canSubmit && !saving && (
            <p className="text-[12px] text-[#B25E16] text-center mt-2 font-nunito font-bold">
              {name.trim().length < 2 ? '✏️ Give it a name'
                : !ownerId ? 'Pick whose business it is'
                : channels.length === 0 ? 'Choose who can buy'
                : keepsInventory && !hasProduct ? 'Add at least one product'
                : ''}
            </p>
          )}
          {!isParent && (
            <p className="text-[11px] text-hive-muted text-center mt-2 leading-relaxed">
              Pilots run free. When you&apos;re ready to go <b>Active</b>, send a quick launch request to a parent from the business page.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ProductRowCard({ row, currency, detail, canRemove, onPatch, onRemove }: {
  row: Row;
  currency: string;
  detail: string;
  canRemove: boolean;
  onPatch: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const selectVal = row.customUnit ? '__other__' : row.unit;
  const onUnit = (v: string) => {
    if (v === '__other__') onPatch({ customUnit: true, unit: '' });
    else onPatch({ customUnit: false, unit: v });
  };

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-2.5">
      <div className="flex items-center gap-2.5">
        {/* Picture / generate */}
        {row.imageDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.imageDataUrl} alt={row.name || 'product'} onClick={() => onPatch({ showImage: !row.showImage })}
            className="w-12 h-12 rounded-hive object-cover bg-hive-cream shrink-0 cursor-pointer" />
        ) : (
          <button type="button" onClick={() => onPatch({ showImage: !row.showImage })}
            title="Add a picture"
            className="w-12 h-12 rounded-hive bg-hive-cream text-[#D17F1A] text-[18px] font-black shrink-0 flex items-center justify-center hover:brightness-95">
            ✨
          </button>
        )}
        <input value={row.name} onChange={(e) => onPatch({ name: e.target.value })} maxLength={50}
          placeholder="Product name (e.g. Tomatoes)"
          className="flex-1 min-w-0 h-10 px-3 bg-white rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
        {canRemove && (
          <button type="button" onClick={onRemove} title="Remove product"
            className="w-7 h-7 rounded-hive-pill bg-hive-cream text-hive-muted text-[13px] shrink-0 hover:brightness-95">✕</button>
        )}
      </div>

      <div className="flex gap-2 mt-2">
        {row.customUnit ? (
          <input value={row.unit} onChange={(e) => onPatch({ unit: e.target.value })} maxLength={20} autoFocus
            placeholder="unit"
            className="w-[42%] h-10 px-3 bg-white rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
        ) : (
          <select value={selectVal} onChange={(e) => onUnit(e.target.value)}
            className="w-[42%] h-10 px-2 bg-white rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40">
            <option value="">Unit…</option>
            {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
            <option value="__other__">Other…</option>
          </select>
        )}
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-hive-muted font-nunito font-bold pointer-events-none">{currency}</span>
          <input value={row.price} onChange={(e) => onPatch({ price: e.target.value })} inputMode="decimal" placeholder="0"
            className="w-full h-10 pl-12 pr-3 bg-white rounded-hive border border-hive-line text-[14px] text-right focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
        </div>
      </div>

      {row.showImage && (
        <div className="mt-2.5">
          <AIImageButton
            kind="product"
            subject={row.name}
            detail={detail}
            cta="✨ Draw this product"
            onAccept={async (dataUrl) => { onPatch({ imageDataUrl: dataUrl, showImage: false }); }}
          />
          {!row.name.trim() && (
            <p className="text-[11px] text-hive-muted mt-1.5">Type a product name first, then draw it.</p>
          )}
        </div>
      )}
    </div>
  );
}
