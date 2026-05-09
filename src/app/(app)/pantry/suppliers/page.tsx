'use client';

// /pantry/suppliers — Soko shortlist. Phase 1A creates suppliers with
// `categories: ['soko', ...]` so the same record will surface in The
// Roster directory in Phase 2 with no migration. We render a small
// dashed bridge note so families know this isn't a duplicate dataset.

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { usePantry } from '@/contexts/PantryContext';
import {
  Supplier, SupplierCategory,
  addSupplier, updateSupplier, deleteSupplier,
} from '@/lib/pantry';
import ContactPickerButton from '@/components/pantry/ContactPickerButton';
import BackButton from '@/components/ui/BackButton';

export default function SuppliersPage() {
  const { profile, isGuest } = useAuth();
  const { sokoSuppliers } = usePantry();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">Pantry · Soko</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">Trusted vendors 🏪</h1>
        </div>
        {!isGuest && (
          <button
            onClick={() => { setAdding((v) => !v); setEditingId(null); }}
            className="h-10 px-4 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-extrabold text-[12px] shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)]"
          >
            {adding ? 'Close' : '+ Add'}
          </button>
        )}
      </div>

      {/* Add form */}
      {adding && (
        <SupplierForm
          familyId={profile?.familyId || ''}
          onDone={() => setAdding(false)}
        />
      )}

      {/* Empty state or list */}
      {sokoSuppliers.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <div className="text-4xl mb-2">🏪</div>
          <p className="font-nunito font-extrabold text-[14px]">No suppliers yet</p>
          <p className="text-[12px] text-hive-muted mt-1">
            Add your local market, dairy, bakery — anyone who supplies your week. Each gets a one-tap WhatsApp send.
          </p>
        </div>
      ) : (
        <div className="space-y-2 mb-4">
          {sokoSuppliers.map((s) => (
            <SupplierRow
              key={s.id}
              supplier={s}
              editing={editingId === s.id}
              onEditToggle={() => setEditingId((id) => (id === s.id ? null : s.id))}
              familyId={profile?.familyId || ''}
              isGuest={isGuest}
            />
          ))}
        </div>
      )}

      {/* Roster bridge note */}
      <div className="rounded-hive border border-dashed border-pantry-leaf bg-gradient-to-br from-pantry-leaf-soft to-white p-4 mb-2">
        <p className="font-nunito font-extrabold text-[12px] text-pantry-leaf-dk">🌐 Bridges to The Roster</p>
        <p className="text-[11px] text-hive-muted leading-relaxed mt-1">
          These vendors are tagged <strong>Soko</strong> in your household directory. When the full Roster ships,
          other categories (transport, security, maids…) live alongside them. Same record, two views.
        </p>
      </div>

      <p className="text-center text-[11px] text-hive-muted mt-4 leading-relaxed">
        <Link href="/pantry" className="text-pantry-leaf-dk font-bold hover:underline">← Back to Pantry</Link>
      </p>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function SupplierRow({
  supplier, editing, onEditToggle, familyId, isGuest,
}: {
  supplier: Supplier;
  editing: boolean;
  onEditToggle: () => void;
  familyId: string;
  isGuest: boolean;
}) {
  if (editing) {
    return (
      <SupplierForm
        familyId={familyId}
        existing={supplier}
        onDone={onEditToggle}
        onDelete={async () => {
          if (isGuest) return;
          if (!confirm(`Delete ${supplier.name}? They'll vanish from your list (and from any staples they're tagged on).`)) return;
          await deleteSupplier(familyId, supplier.id);
          onEditToggle();
        }}
      />
    );
  }
  const initial = supplier.name?.[0]?.toUpperCase() || '?';
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-[12px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center font-nunito font-black">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-nunito font-extrabold text-[14px] truncate">{supplier.name}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {supplier.contactName && (
            <span className="text-[10px] text-hive-muted">👤 {supplier.contactName}</span>
          )}
          {supplier.phone && (
            <span className="text-[10px] text-hive-muted">📱 {supplier.phone}</span>
          )}
          {!supplier.phone && (
            <span className="text-[10px] italic text-hive-muted">no phone yet</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {supplier.categories?.map((c) => (
            <span
              key={c}
              className={`text-[9px] font-nunito font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-[0.5px] ${
                c === 'soko' ? 'bg-pantry-leaf-soft text-pantry-leaf-dk' : 'bg-hive-line text-hive-muted'
              }`}
            >
              {c}
            </span>
          ))}
        </div>
      </div>
      {!isGuest && (
        <button
          onClick={onEditToggle}
          className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk hover:underline shrink-0"
        >
          Edit
        </button>
      )}
    </div>
  );
}

const ALL_CATEGORIES: { id: SupplierCategory; label: string }[] = [
  { id: 'soko',      label: 'Soko (groceries)' },
  { id: 'transport', label: 'Transport' },
  { id: 'security',  label: 'Security' },
  { id: 'maids',     label: 'Maids / cleaning' },
  { id: 'utility',   label: 'Utility / repair' },
  { id: 'events',    label: 'Events' },
  { id: 'other',     label: 'Other' },
];

function SupplierForm({
  familyId, existing, onDone, onDelete,
}: {
  familyId: string;
  existing?: Supplier;
  onDone: () => void;
  onDelete?: () => void;
}) {
  const { profile } = useAuth();
  const [name, setName] = useState(existing?.name || '');
  const [contactName, setContactName] = useState(existing?.contactName || '');
  const [phone, setPhone] = useState(existing?.phone || '');
  const [whatsappEnabled, setWhatsappEnabled] = useState<boolean>(existing?.whatsappEnabled ?? true);
  const [notes, setNotes] = useState(existing?.notes || '');
  // Soko is forced on inside Pantry — every supplier created here belongs
  // in the grocery view by definition. Other tags can be toggled in case
  // the parent is also adding a transport guy who happens to do groceries.
  const initialCats = new Set<SupplierCategory>(existing?.categories || ['soko']);
  initialCats.add('soko');
  const [categories, setCategories] = useState<Set<SupplierCategory>>(initialCats);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleCat = (c: SupplierCategory) => {
    if (c === 'soko') return; // pinned
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const submit = async () => {
    if (!profile?.uid) return;
    setError('');
    if (!name.trim()) { setError('Pick a business name.'); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        contactName: contactName.trim() || undefined,
        phone: phone.trim() || undefined,
        whatsappEnabled: !!phone.trim() && whatsappEnabled,
        notes: notes.trim() || undefined,
        categories: Array.from(categories),
        createdBy: profile.uid,
      };
      if (existing) {
        await updateSupplier(familyId, existing.id, payload);
      } else {
        await addSupplier(familyId, payload);
      }
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    }
    setSaving(false);
  };

  return (
    <div className="bg-hive-paper border-2 border-pantry-leaf rounded-hive-lg p-4 mb-3 space-y-3">
      {/* Phone-contact picker · pre-fills name + phone in one tap on
          supported browsers (Android Chrome, etc.). Disabled with an
          inline hint on iOS / desktop. */}
      {!existing && (
        <ContactPickerButton
          onPicked={({ name: pickedName, phone: pickedPhone }) => {
            // Don't overwrite a name the parent already typed.
            if (pickedName && !name.trim()) setName(pickedName);
            if (pickedPhone && !phone.trim()) setPhone(pickedPhone);
            // If they pick a contact and didn't have a contact-person yet,
            // mirror the picked name there too — common case is the supplier
            // is the person.
            if (pickedName && !contactName.trim() && !name.trim()) {
              setContactName(pickedName);
            }
          }}
        />
      )}

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Business name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Mama Kibo's Stall"
          maxLength={80}
          autoFocus
          className="w-full mt-1 h-11 px-3 bg-hive-cream rounded-[12px] text-[15px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Contact person (optional)</label>
        <input
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          placeholder="e.g. Mama Kibo"
          maxLength={60}
          className="w-full mt-1 h-10 px-3 bg-hive-cream rounded-[12px] text-[13px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Phone (used for WhatsApp send)</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="+255 7XX XXX XXX"
          maxLength={30}
          className="w-full mt-1 h-10 px-3 bg-hive-cream rounded-[12px] text-[13px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
        <p className="text-[10px] text-hive-muted mt-1">Include the country code (e.g. +255 for Tanzania).</p>
      </div>

      <button
        onClick={() => setWhatsappEnabled((v) => !v)}
        type="button"
        className="w-full flex items-center gap-3 p-2 rounded-hive-pill border border-hive-line bg-hive-paper text-left"
        disabled={!phone.trim()}
      >
        <div className={`w-8 h-5 rounded-hive-pill relative transition-colors shrink-0 ${whatsappEnabled && phone.trim() ? 'bg-[#25D366]' : 'bg-hive-line'}`}>
          <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all" style={{ left: whatsappEnabled && phone.trim() ? '14px' : '2px' }} />
        </div>
        <span className="text-[12px] font-nunito font-extrabold flex-1">
          {phone.trim()
            ? whatsappEnabled
              ? 'WhatsApp send enabled for this supplier'
              : 'WhatsApp disabled — phone-only contact'
            : 'Add a phone first to enable WhatsApp'}
        </span>
      </button>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted block mb-1.5">
          Categories <span className="normal-case">· Soko is pinned (this is the Pantry's view)</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_CATEGORIES.map((c) => {
            const sel = categories.has(c.id);
            const pinned = c.id === 'soko';
            return (
              <button
                key={c.id}
                onClick={() => toggleCat(c.id)}
                disabled={pinned}
                className={`px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border transition-colors ${
                  sel
                    ? pinned
                      ? 'bg-pantry-leaf text-white border-transparent cursor-default'
                      : 'bg-pantry-leaf text-white border-transparent'
                    : 'border-hive-line bg-hive-paper text-hive-muted hover:border-pantry-leaf/50'
                }`}
              >
                {c.label}{pinned && ' 🔒'}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Notes (optional)</label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Open Mon–Sat · best mangoes · cash only"
          maxLength={200}
          className="w-full mt-1 h-10 px-3 bg-hive-cream rounded-[12px] text-[12px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </div>

      {error && <p className="text-hive-rose text-[12px] font-bold">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={submit}
          disabled={saving}
          className="flex-1 h-11 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[13px] disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Add supplier'}
        </button>
        <button
          onClick={onDone}
          disabled={saving}
          className="h-11 px-4 rounded-hive-pill bg-hive-line text-hive-muted font-nunito font-extrabold text-[12px]"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={saving}
            className="h-11 px-3 rounded-hive-pill bg-[#FCEAEA] text-hive-rose font-nunito font-extrabold text-[11px]"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
