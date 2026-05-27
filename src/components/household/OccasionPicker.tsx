'use client';

// Minimal Occasion picker — name + date only.
//
// Spec §4.5 calls for grouping suggestions ("when user types Jane's
// wedding in two entries, suggest grouping under one Occasion"). That
// fuzzy lookup ships in a follow-up — for P2 we just persist the name
// and date on the doc so the data is captured, and let the user type
// the same occasion name across entries for now. Grouping by name is
// a client-side filter the list page can apply in the meantime.

export interface OccasionValue {
  name: string;
  dateIso: string;       // YYYY-MM-DD
  groupId: string | null;
}

export function OccasionPicker({
  value,
  onChange,
  label = 'Occasion (optional)',
  helperText = 'For weddings, msiba, birthdays — anything tied to an event. Skip for tithe / regular giving.',
}: {
  value: OccasionValue;
  onChange: (v: OccasionValue) => void;
  label?: string;
  helperText?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">
        {label}
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="e.g. Wedding — Jane & Mark · Msiba — Mama Asha"
          className="flex-1 rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
        />
        <input
          type="date"
          value={value.dateIso}
          onChange={(e) => onChange({ ...value, dateIso: e.target.value })}
          className="rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
        />
      </div>
      <p className="text-xs font-semibold text-pulse-navy/55">{helperText}</p>
    </div>
  );
}
