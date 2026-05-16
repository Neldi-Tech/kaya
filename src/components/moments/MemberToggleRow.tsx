'use client';

// One row in the AccessPickerSheet. Shows a family member with their
// role and a toggle. When `disabledReason` is set, the row renders
// greyed out + a tooltip explaining why (typically: the member isn't
// in the parent album's access list, so a sub-album can't include
// them either).

import type { UserProfile } from '@/lib/firestore';

interface Props {
  member: UserProfile;
  selected: boolean;
  disabledReason?: string;
  onToggle: () => void;
}

export default function MemberToggleRow({ member, selected, disabledReason, onToggle }: Props) {
  const disabled = !!disabledReason;
  const initial = member.displayName?.[0]?.toUpperCase() || '?';

  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onToggle(); }}
      disabled={disabled}
      className={`relative w-full flex items-center gap-3 p-2.5 rounded-kaya-sm border text-left transition-colors ${
        disabled
          ? 'bg-kaya-warm/50 border-kaya-warm-dark opacity-50 cursor-not-allowed'
          : selected
            ? 'bg-kaya-gold-light/40 border-kaya-gold'
            : 'bg-kaya-cream border-kaya-warm-dark hover:border-kaya-chocolate'
      }`}
    >
      {member.avatarPhoto || member.photoURL ? (
        <img
          src={member.avatarPhoto || member.photoURL}
          alt=""
          className="w-9 h-9 rounded-full object-cover bg-kaya-warm flex-shrink-0"
        />
      ) : (
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-display font-black text-sm flex-shrink-0 ${avatarBgForRole(member.role)}`}>
          {initial}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-display font-black text-sm text-kaya-chocolate leading-tight truncate">{member.displayName}</p>
        <p className="text-[10px] font-display font-bold uppercase tracking-wider text-kaya-sand mt-0.5">{roleLabel(member.role)}</p>
      </div>
      {disabled && disabledReason && (
        <span className="absolute right-[60px] top-1/2 -translate-y-1/2 text-[9px] font-display font-bold text-red-700 bg-white border border-red-700 px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none">
          {disabledReason}
        </span>
      )}
      <div className={`w-10 h-6 rounded-full relative flex-shrink-0 transition-colors ${selected ? 'bg-emerald-500' : 'bg-kaya-warm-dark'}`}>
        <div
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${selected ? 'left-[18px]' : 'left-0.5'}`}
        />
      </div>
    </button>
  );
}

function avatarBgForRole(role: string): string {
  switch (role) {
    case 'parent': return 'bg-gradient-to-br from-kaya-gold to-kaya-gold-dark';
    case 'kid': return 'bg-gradient-to-br from-emerald-500 to-emerald-800';
    case 'helper': return 'bg-gradient-to-br from-sky-500 to-sky-800';
    default: return 'bg-gradient-to-br from-kaya-sand to-kaya-chocolate';
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case 'parent': return 'Guardian';
    case 'helper': return 'Member';
    case 'kid': return 'Kid';
    default: return role;
  }
}
