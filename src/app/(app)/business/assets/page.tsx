'use client';

// Business → Assets — list of the kid's active and retired assets.
// Shows type emoji, name, count × unit, stage badge, current valuation.
// Parents and kids can tap "+ Add asset" → /business/assets/new.

import Link from 'next/link';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { assetType, assetValuationCents } from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import KidSwitcher from '@/components/hive/KidSwitcher';
import BackButton from '@/components/ui/BackButton';

export default function AssetsPage() {
  const { children } = useFamily();
  const { activeKidId, config } = useHive();
  const { assets, totalAssetValueCents, loading } = useBusiness();

  const activeKid = children.find((c) => c.id === activeKidId);
  const cur = config.currency;

  const activeAssets  = assets.filter((a) => !a.retiredAt && a.stage !== 'retired');
  const retiredAssets = assets.filter((a) =>  a.retiredAt || a.stage === 'retired');

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden mb-1"><BackButton /></div>

      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-green">
          {activeKid ? `${activeKid.name}'s Business` : 'My Business'}
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1 leading-tight">
          My Assets 🏷️
        </h1>
      </div>

      <KidSwitcher />

      {/* Total portfolio value */}
      {!loading && assets.length > 0 && (
        <div className="bg-gradient-to-br from-[#E6F7EE] to-[#C9EBD7] border border-[#8FD3AB] rounded-hive px-4 py-3 mb-4 flex items-center justify-between">
          <p className="font-nunito font-extrabold text-[13px]">Portfolio value</p>
          <p className="font-nunito font-black text-[20px] text-hive-green">{formatCash(totalAssetValueCents, cur)}</p>
        </div>
      )}

      {/* Add asset CTA */}
      <Link
        href="/business/assets/new"
        className="block w-full bg-hive-green hover:bg-[#2A8553] text-white rounded-hive py-3 text-center font-nunito font-black text-[13px] transition-colors no-underline mb-4"
      >
        + Add asset
      </Link>

      {loading ? (
        <div className="py-12 text-center text-hive-muted text-sm">Loading…</div>
      ) : assets.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <p className="text-4xl mb-3">🌱</p>
          <p className="font-nunito font-extrabold text-[14px] mb-1">No assets yet</p>
          <p className="text-[12px] text-hive-muted">Add your first asset — chickens, garden plants, anything your business owns.</p>
        </div>
      ) : (
        <>
          {/* Active assets */}
          {activeAssets.length > 0 && (
            <section className="mb-4">
              <h2 className="font-nunito font-extrabold text-[11px] uppercase tracking-[2px] text-hive-muted mb-2">Active</h2>
              <div className="space-y-2">
                {activeAssets.map((a) => {
                  const type = assetType(a.typeKey);
                  const valCents = assetValuationCents(a);
                  return (
                    <div key={a.id} className="bg-hive-paper border border-hive-line rounded-hive px-4 py-3 flex items-center gap-3">
                      <span className="text-2xl shrink-0">{type.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-nunito font-extrabold text-[14px] truncate">{a.name}</p>
                        <p className="text-[11px] text-hive-muted">
                          {a.count} {type.unit} · {a.stage}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-nunito font-black text-[15px]">{formatCash(valCents, cur)}</p>
                        <p className="text-[10px] text-hive-muted">{formatCash(a.unitPriceCents, cur)} each</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Retired assets */}
          {retiredAssets.length > 0 && (
            <section>
              <h2 className="font-nunito font-extrabold text-[11px] uppercase tracking-[2px] text-hive-muted mb-2">Retired</h2>
              <div className="space-y-2">
                {retiredAssets.map((a) => {
                  const type = assetType(a.typeKey);
                  return (
                    <div key={a.id} className="bg-hive-cream border border-hive-line/60 rounded-hive px-4 py-3 flex items-center gap-3 opacity-60">
                      <span className="text-2xl shrink-0">{type.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-nunito font-extrabold text-[13px] truncate">{a.name}</p>
                        <p className="text-[11px] text-hive-muted">{a.count} {type.unit} · retired</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
