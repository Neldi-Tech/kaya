'use client';

// Pill row of kid chips — only renders for parents/helpers viewing /hive,
// since a kid user always sees their own wallet (no switcher needed).
// Hidden when there's only one kid in the family.

import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { useAuth } from '@/contexts/AuthContext';

export default function KidSwitcher() {
  const { profile } = useAuth();
  const { children } = useFamily();
  const { activeKidId, setActiveKidId } = useHive();

  if (profile?.role === 'kid') return null;
  if (children.length <= 1) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
      {children.map((c) => {
        const sel = activeKidId === c.id;
        return (
          <button
            key={c.id}
            onClick={() => setActiveKidId(c.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold whitespace-nowrap border transition-all ${
              sel ? 'bg-hive-honey text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
            }`}
          >
            <span>{c.avatarEmoji}</span>{c.name}
          </button>
        );
      })}
    </div>
  );
}
