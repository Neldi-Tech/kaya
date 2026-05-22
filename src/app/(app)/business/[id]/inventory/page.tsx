'use client';

// Kaya Business · Inventory & worth (kid screen 4). Every thing the business
// owns — assets (keep working for you) + stock (ready to sell) — with per-unit
// valuation, and the total business worth surfaced prominently. Adding/editing
// items recomputes the denormalized business.stats roll-up (see business.ts).

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, BusinessItem, ItemKind, NewItemInput,
  subscribeToBusiness, subscribeToBusinessItems,
  addBusinessItem, markItemLoss, removeBusinessItem, itemWorthCents, readBusinessConfig,
} from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import { formatWorth } from '@/components/business/money';
import { typeMeta, TYPE_GRADIENT } from '@/components/business/meta';

function centsFrom(input: string): number | undefined {
  const n = parseFloat(input.replace(/,/g, ''));
  if (Number.isNaN(n) || n <= 0) return undefined;
  return Math.round(n * 100);
}

export default function InventoryPage() {
  const params = useParams();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const rounding = readBusinessConfig(family).displayRounding;
  const familyId = profile?.familyId;

  const [business, setBusiness] = useState<Business | null>(null);
  const [items, setItems] = useState<BusinessItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!familyId || !businessId) return;
    const u1 = subscribeToBusiness(familyId, businessId, setBusiness);
    const u2 = subscribeToBusinessItems(familyId, businessId, (it) => { setItems(it); setLoading(false); });
    return () => { u1(); u2(); };
  }, [familyId, businessId]);

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === business?.ownerId;
  const canEdit = isParent || isOwner;

  const assets = items.filter((i) => i.kind === 'asset');
  const stock = items.filter((i) => i.kind === 'stock');
  const costOfStock = useMemo(
    () => stock.reduce((s, i) => s + (i.loss ? 0 : (i.unitCostCents ?? 0) * (i.qty || 0)), 0),
    [stock],
  );

  const currency = config.currency;
  const stats = business?.stats;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">📦</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-black text-[16px] truncate">Inventory &amp; worth</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">
            {business ? business.name : 'Everything you own · what it costs · what it’s worth'}
          </div>
        </div>
        {business && (
          <Link href={`/business/${businessId}`} className="text-[12px] font-nunito font-extrabold text-hive-honey-soft hover:underline shrink-0">
            Dashboard →
          </Link>
        )}
      </div>

      {/* Worth roll-up */}
      <div
        className="rounded-hive p-4 mb-3 border border-hive-honey/60"
        style={{ background: business ? TYPE_GRADIENT[business.type] : '#FFF6DE' }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-nunito font-extrabold text-hive-navy/70">
              {business ? `${business.name} is worth` : 'This business is worth'}
            </div>
            <div className="font-nunito font-black text-[30px] leading-tight mt-0.5">
              {formatWorth(stats?.worthCents ?? 0, currency, rounding)}
            </div>
          </div>
          <div className="text-[34px] leading-none">💰</div>
        </div>
        <div className="mt-2 space-y-1.5 text-[13px]">
          <div className="flex items-center justify-between border-b border-dashed border-black/10 pb-1.5">
            <span>🌳 Assets (keep working for you)</span>
            <span className="font-nunito font-extrabold">{formatWorth(stats?.assetsCents ?? 0, currency, rounding)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-dashed border-black/10 pb-1.5">
            <span>📦 Stock at market value</span>
            <span className="font-nunito font-extrabold">{formatWorth(stats?.stockMarketCents ?? 0, currency, rounding)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-hive-navy/60">🧾 Cost of stock (what you spent)</span>
            <span className="text-hive-navy/60">{formatWorth(costOfStock, currency, rounding)}</span>
          </div>
        </div>
      </div>

      {/* Kid lesson */}
      <div className="bg-[#F4ECD8] border border-hive-honey/60 rounded-hive p-4 mb-3">
        <p className="text-[13px] leading-relaxed text-hive-navy">
          <b>📚 Two kinds of things you own:</b> <b>assets</b> (trees, chickens, tools — they keep working
          for you) and <b>stock</b> (fruits, eggs, things ready to sell). Add them up and you see how big
          your business really is.
        </p>
      </div>

      {canEdit && <AddItemForm familyId={familyId!} businessId={businessId} uid={profile!.uid} currency={currency} />}

      {loading ? (
        <p className="text-center text-hive-muted text-sm py-8">Loading…</p>
      ) : items.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-8 text-center mt-3">
          <div className="text-4xl mb-2">🌱</div>
          <p className="font-nunito font-extrabold text-[15px]">Nothing in your books yet</p>
          <p className="text-hive-muted text-sm mt-1">Add your first asset or some stock to see your worth grow.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {assets.length > 0 && (
            <ItemGroup title="🌳 Assets — your money-makers" sub={`${assets.length} ${assets.length === 1 ? 'item' : 'items'}`}
              items={assets} currency={currency} canEdit={canEdit} familyId={familyId!} businessId={businessId} />
          )}
          {stock.length > 0 && (
            <ItemGroup title="📦 Stock — ready (or getting ready) to sell" sub={`${stock.length} ${stock.length === 1 ? 'line' : 'lines'}`}
              items={stock} currency={currency} canEdit={canEdit} familyId={familyId!} businessId={businessId} />
          )}
        </div>
      )}
    </div>
  );
}

function ItemGroup({ title, sub, items, currency, canEdit, familyId, businessId }: {
  title: string; sub: string; items: BusinessItem[]; currency: string; canEdit: boolean; familyId: string; businessId: string;
}) {
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="font-nunito font-extrabold text-[14px]">{title}</h3>
        <span className="text-[11px] text-hive-muted">{sub}</span>
      </div>
      {items.map((it) => (
        <ItemRow key={it.id} item={it} currency={currency} canEdit={canEdit} familyId={familyId} businessId={businessId} />
      ))}
    </div>
  );
}

function ItemRow({ item, currency, canEdit, familyId, businessId }: {
  item: BusinessItem; currency: string; canEdit: boolean; familyId: string; businessId: string;
}) {
  const [busy, setBusy] = useState(false);
  const unit = item.unitMarketCents ?? item.unitCostCents ?? 0;
  const worth = itemWorthCents(item);
  const dimmed = item.loss || !item.countedInWorth;
  const subBits: string[] = [];
  if (item.stage) subBits.push(item.stage);
  if (item.producing) subBits.push('producing');
  if (item.loss) subBits.push('written off');
  else if (!item.countedInWorth) subBits.push('not counted yet');

  const showQty = item.qty !== 1 || !!item.unitLabel;
  const qtyBit = showQty ? `${item.qty}${item.unitLabel ? ` ${item.unitLabel}` : ''}` : '';
  const priceBit = unit > 0 ? `${formatCash(unit, currency)}${item.unitLabel ? ` / ${item.unitLabel}` : ''}` : '';
  const metaParts = [qtyBit, priceBit, ...subBits].filter(Boolean);

  return (
    <div className={`flex items-center justify-between gap-2 py-2 border-b border-dashed border-hive-line last:border-0 ${dimmed ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        {item.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photoUrl} alt={item.name} className="w-9 h-9 rounded-hive object-cover bg-hive-cream shrink-0" />
        )}
        <div className="min-w-0">
          <div className="font-nunito font-bold text-[13px] truncate">{item.name}</div>
          {metaParts.length > 0 && (
            <div className="text-[11px] text-hive-muted truncate">{metaParts.join(' · ')}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`font-nunito font-extrabold text-[13px] ${item.loss ? 'text-hive-rose' : ''}`}>
          {item.loss ? '—' : formatCash(worth, currency)}
        </span>
        {canEdit && (
          <div className="flex items-center gap-1">
            {!item.loss && (
              <button
                onClick={async () => { setBusy(true); try { await markItemLoss(familyId, businessId, item.id); } finally { setBusy(false); } }}
                disabled={busy}
                title="Mark spoilage / loss"
                className="w-7 h-7 rounded-hive-pill bg-hive-cream text-[12px] disabled:opacity-40 hover:brightness-95"
              >🥀</button>
            )}
            <button
              onClick={async () => { setBusy(true); try { await removeBusinessItem(familyId, businessId, item.id); } finally { setBusy(false); } }}
              disabled={busy}
              title="Remove (mistake)"
              className="w-7 h-7 rounded-hive-pill bg-hive-cream text-[12px] text-hive-muted disabled:opacity-40 hover:brightness-95"
            >✕</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddItemForm({ familyId, businessId, uid, currency }: { familyId: string; businessId: string; uid: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ItemKind>('stock');
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unitLabel, setUnitLabel] = useState('');
  const [stage, setStage] = useState('');
  const [cost, setCost] = useState('');
  const [market, setMarket] = useState('');
  const [counted, setCounted] = useState(true);
  const [producing, setProducing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => { setName(''); setQty('1'); setUnitLabel(''); setStage(''); setCost(''); setMarket(''); setCounted(true); setProducing(false); };

  const submit = async () => {
    setError('');
    if (name.trim().length < 1) { setError('Give it a name.'); return; }
    setSaving(true);
    const input: NewItemInput = {
      kind,
      name: name.trim(),
      qty: Math.max(1, Math.round(parseFloat(qty) || 1)),
      unitLabel: unitLabel.trim() || undefined,
      stage: stage.trim() || undefined,
      unitCostCents: centsFrom(cost),
      unitMarketCents: centsFrom(market),
      countedInWorth: counted,
      producing: kind === 'asset' ? producing : undefined,
    };
    try {
      await addBusinessItem(familyId, businessId, input, uid);
      reset();
      setOpen(false);
    } catch (e: any) {
      setError(e?.message || 'Could not add the item.');
    } finally {
      setSaving(false);
    }
  };

  const label = 'text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1 mt-2';
  const field = 'w-full h-10 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40';

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full h-11 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[13px] hover:brightness-110 active:scale-[0.99] transition">
        ＋ Add inventory
      </button>
    );
  }

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-nunito font-extrabold text-[14px]">Add inventory</h3>
        <button onClick={() => setOpen(false)} className="text-hive-muted text-[12px] font-nunito font-bold">Cancel</button>
      </div>

      <div className={label}>Kind</div>
      <div className="flex gap-2">
        {([['stock', '📦 Stock'], ['asset', '🌳 Asset']] as Array<[ItemKind, string]>).map(([k, lbl]) => (
          <button key={k} onClick={() => setKind(k)}
            className={`flex-1 h-10 rounded-hive-pill text-[12.5px] font-nunito font-extrabold border transition ${kind === k ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'}`}>
            {lbl}
          </button>
        ))}
      </div>

      <div className={label}>Name</div>
      <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={50}
        placeholder={kind === 'asset' ? 'e.g. “Big Mama” the hen' : 'e.g. Eggs — ready'} />

      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className={label}>Quantity</div>
          <input className={field} value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <div className={label}>Unit</div>
          <input className={field} value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} maxLength={20}
            placeholder="kg, pcs" />
        </div>
        <div>
          <div className={label}>Stage</div>
          <input className={field} value={stage} onChange={(e) => setStage(e.target.value)} maxLength={20}
            placeholder={kind === 'asset' ? 'layer' : 'ready'} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={label}>Cost / unit ({currency})</div>
          <input className={field} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="0" />
        </div>
        <div>
          <div className={label}>Value / unit ({currency})</div>
          <input className={field} value={market} onChange={(e) => setMarket(e.target.value)} inputMode="decimal" placeholder="0" />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mt-3">
        <label className="flex items-center gap-2 text-[12.5px] font-nunito font-bold">
          <input type="checkbox" checked={counted} onChange={(e) => setCounted(e.target.checked)} className="w-4 h-4 accent-hive-honey" />
          Counts toward worth
        </label>
        {kind === 'asset' && (
          <label className="flex items-center gap-2 text-[12.5px] font-nunito font-bold">
            <input type="checkbox" checked={producing} onChange={(e) => setProducing(e.target.checked)} className="w-4 h-4 accent-hive-honey" />
            Producing now
          </label>
        )}
      </div>

      {error && <p className="text-hive-rose text-[12px] font-bold mt-2">{error}</p>}

      <button onClick={submit} disabled={saving}
        className="w-full mt-3 h-11 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition">
        {saving ? 'Adding…' : 'Add to inventory'}
      </button>
    </div>
  );
}
