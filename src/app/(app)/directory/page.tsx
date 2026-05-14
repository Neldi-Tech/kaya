'use client';

// /directory — Yellow Pages. The family's service directory: the
// plumber, the pharmacy, the mama wa kazi, the kids' school. Built
// on the existing families/{f}/suppliers collection (see
// lib/directory.ts for the architecture note) — this is the full
// "Roster" view, the Pantry's Soko tab is the grocery subset.
//
// Per the brief:
//   - Seeded by category (20 Tanzania-first service types)
//   - One-tap WhatsApp on every contact (priority)
//   - Save-to-phone (.vcf download) per contact + whole category
//   - Universal importer: vCard / Google CSV / pasted text, with
//     quick per-row category assignment

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  subscribeToSuppliers, addSupplier, updateSupplier, deleteSupplier,
  markSupplierContacted, type Supplier,
} from '@/lib/pantry';
import {
  DIRECTORY_CATEGORIES, findDirectoryCategory,
  normalizePhone, displayPhone, whatsappContactLink,
  contactToVCard, contactsToVCardFile, downloadVCard,
  parseContacts, type DirectoryCategory, type ParsedContact, type ImportFormat,
} from '@/lib/directory';
import ContactPickerButton from '@/components/pantry/ContactPickerButton';

export default function DirectoryPage() {
  const { profile, isGuest } = useAuth();
  const { family } = useFamily();
  const familyId = profile?.familyId || '';

  const [contacts, setContacts] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<DirectoryCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Set when a contact is picked from the phone's address book — opens
  // the Add form pre-filled. Cleared on manual "+ Add contact" / cancel.
  const [prefill, setPrefill] = useState<{ name?: string; phone?: string } | null>(null);

  useEffect(() => {
    if (!familyId) { setLoading(false); return; }
    const unsub = subscribeToSuppliers(familyId, 'all', (s) => {
      setContacts(s);
      setLoading(false);
    });
    return unsub;
  }, [familyId]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  };

  // Filter by category + search. Contacts without a directoryCategory
  // bucket under 'uncategorised' and only show when the filter is
  // 'all'.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (category !== 'all' && c.directoryCategory !== category) return false;
      if (q) {
        const hay = `${c.name} ${c.contactName || ''} ${c.notes || ''} ${c.phone || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [contacts, category, search]);

  // Group the visible contacts by directoryCategory for the list.
  const grouped = useMemo(() => {
    const map = new Map<string, Supplier[]>();
    for (const c of visible) {
      const key = c.directoryCategory || 'uncategorised';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    // Order: known categories in catalog order, then uncategorised.
    const ordered: { key: string; label: string; emoji: string; items: Supplier[] }[] = [];
    for (const cat of DIRECTORY_CATEGORIES) {
      const items = map.get(cat.id);
      if (items?.length) ordered.push({ key: cat.id, label: cat.label, emoji: cat.emoji, items });
    }
    const unc = map.get('uncategorised');
    if (unc?.length) ordered.push({ key: 'uncategorised', label: 'Uncategorised', emoji: '❓', items: unc });
    return ordered;
  }, [visible]);

  // Per-category counts for the chip row.
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of contacts) {
      const k = c.directoryCategory || 'uncategorised';
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [contacts]);

  const saveContact = async (data: ContactFormData, existing?: Supplier) => {
    if (!familyId || isGuest) return;
    const payload = {
      name: data.name.trim(),
      contactName: data.contactName.trim() || undefined,
      phone: normalizePhone(data.phone) || undefined,
      whatsappEnabled: true,
      notes: data.notes.trim() || undefined,
      email: data.email.trim() || undefined,
      categories: existing?.categories?.length ? existing.categories : (['other'] as Supplier['categories']),
      directoryCategory: data.category,
      createdBy: profile?.uid || 'unknown',
    };
    if (existing) {
      await updateSupplier(familyId, existing.id, payload);
      flash(`Updated ${payload.name}`);
    } else {
      await addSupplier(familyId, payload);
      flash(`Added ${payload.name}`);
    }
    setAdding(false);
    setEditingId(null);
  };

  const removeContact = async (c: Supplier) => {
    if (!familyId || isGuest) return;
    if (!confirm(`Remove "${c.name}" from your Yellow Pages?`)) return;
    await deleteSupplier(familyId, c.id);
    setEditingId(null);
    flash(`Removed ${c.name}`);
  };

  const importContacts = async (rows: { contact: ParsedContact; category: DirectoryCategory }[]) => {
    if (!familyId || isGuest) return 0;
    let added = 0;
    for (const { contact, category } of rows) {
      await addSupplier(familyId, {
        name: contact.name.trim() || 'Unnamed contact',
        phone: contact.phone || undefined,
        whatsappEnabled: true,
        notes: contact.notes?.trim() || undefined,
        categories: ['other'],
        directoryCategory: category,
        createdBy: profile?.uid || 'unknown',
      });
      added++;
    }
    setImporting(false);
    flash(`Imported ${added} contact${added === 1 ? '' : 's'}`);
    return added;
  };

  const exportCategory = (label: string, items: Supplier[]) => {
    const body = contactsToVCardFile(items.map((c) => ({
      name: c.name, contactName: c.contactName, phone: c.phone, notes: c.notes,
      directoryCategory: c.directoryCategory,
    })));
    downloadVCard(`kaya-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, body);
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32 lg:pb-12">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Directory · Yellow Pages
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">
          Yellow Pages 📒
        </h1>
        <p className="text-[12px] lg:text-[13px] text-hive-muted mt-1">
          Every service the {family?.name || 'family'} household relies on — one tap to WhatsApp or save to your phone.
        </p>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <button
          onClick={() => { setAdding((v) => !v); setEditingId(null); setImporting(false); setPrefill(null); }}
          disabled={isGuest}
          className="h-11 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[13px] disabled:opacity-50 shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)]"
        >
          {adding ? 'Close' : '+ Add contact'}
        </button>
        <button
          onClick={() => { setImporting((v) => !v); setAdding(false); setEditingId(null); }}
          disabled={isGuest}
          className="h-11 rounded-hive-pill bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[12px] disabled:opacity-50"
        >
          ⬆ Import contacts
        </button>
      </div>

      {/* Pick straight from the phone's address book. Lights up on
          Android Chrome / Edge / Samsung Internet (and PWA-installed
          Kaya); shows an inline hint on iOS / desktop. Picking opens
          the Add form pre-filled. */}
      {!isGuest && (
        <div className="mb-3">
          <ContactPickerButton
            onPicked={({ name: pickedName, phone: pickedPhone }) => {
              setPrefill({ name: pickedName, phone: pickedPhone });
              setAdding(true);
              setEditingId(null);
              setImporting(false);
            }}
          />
        </div>
      )}

      {/* Add form */}
      {adding && !editingId && (
        <ContactForm
          key={prefill ? `prefill-${prefill.name ?? ''}-${prefill.phone ?? ''}` : 'blank'}
          prefill={prefill ?? undefined}
          onSave={(d) => saveContact(d)}
          onCancel={() => { setAdding(false); setPrefill(null); }}
        />
      )}

      {/* Import sheet */}
      {importing && (
        <ImportSheet onImport={importContacts} onClose={() => setImporting(false)} />
      )}

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔎  Search name, phone, notes…"
        className="w-full h-11 px-4 mb-3 rounded-hive-pill bg-hive-paper border border-hive-line text-[13px] focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
      />

      {/* Category chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
        <CatChip active={category === 'all'} onClick={() => setCategory('all')}>
          All · {contacts.length}
        </CatChip>
        {DIRECTORY_CATEGORIES.map((c) => (
          <CatChip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
            {c.emoji} {c.label.split(' / ')[0].split(' (')[0]}
            {counts[c.id] ? ` · ${counts[c.id]}` : ''}
          </CatChip>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-center text-hive-muted text-sm py-10">Loading…</p>
      ) : contacts.length === 0 ? (
        <EmptyState onAdd={() => setAdding(true)} onImport={() => setImporting(true)} />
      ) : visible.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <p className="text-3xl mb-1">🔎</p>
          <p className="text-[12px] text-hive-muted">No contacts match these filters.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.key}>
              <div className="flex items-baseline justify-between mb-2 px-1">
                <p className="text-[12px] font-nunito font-extrabold uppercase tracking-[1.4px] text-pantry-leaf-dk">
                  {group.emoji} {group.label} · {group.items.length}
                </p>
                <button
                  onClick={() => exportCategory(group.label, group.items)}
                  className="text-[10px] font-nunito font-extrabold text-hive-muted hover:text-pantry-leaf-dk hover:underline"
                >
                  ⬇ Save all to phone
                </button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {group.items.map((c) =>
                  editingId === c.id ? (
                    <div key={c.id} className="lg:col-span-2">
                      <ContactForm
                        existing={c}
                        onSave={(d) => saveContact(d, c)}
                        onCancel={() => setEditingId(null)}
                        onDelete={() => removeContact(c)}
                      />
                    </div>
                  ) : (
                    <ContactCard
                      key={c.id}
                      contact={c}
                      familyName={family?.name}
                      familyId={familyId}
                      onEdit={() => { setEditingId(c.id); setAdding(false); setImporting(false); }}
                    />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-32 lg:bottom-16 z-50 bg-hive-navy text-white text-[12px] font-nunito font-extrabold px-4 py-2 rounded-hive-pill shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Contact card ──────────────────────────────────────────────────

function ContactCard({
  contact, familyName, familyId, onEdit,
}: {
  contact: Supplier;
  familyName?: string;
  familyId: string;
  onEdit: () => void;
}) {
  const cat = findDirectoryCategory(contact.directoryCategory);
  const waLink = whatsappContactLink(
    contact.phone,
    `Hello${contact.contactName ? ` ${contact.contactName}` : ''}, ${familyName ? `${familyName} family here. ` : ''}`,
  );

  const sendWhatsApp = () => {
    if (!waLink) return;
    if (familyId) markSupplierContacted(familyId, contact.id).catch(() => {});
    window.open(waLink, '_blank', 'noopener,noreferrer');
  };

  const saveToPhone = () => {
    const body = contactToVCard({
      name: contact.name, contactName: contact.contactName,
      phone: contact.phone, notes: contact.notes,
      directoryCategory: contact.directoryCategory,
    });
    downloadVCard(`kaya-${contact.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, body);
  };

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-[12px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center text-xl shrink-0">
          {cat?.emoji || '📇'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-nunito font-extrabold text-[14px] truncate">{contact.name}</p>
          {contact.contactName && (
            <p className="text-[11px] text-hive-muted truncate">Ask for {contact.contactName}</p>
          )}
          {contact.phone && (
            <p className="text-[11px] text-hive-muted truncate">{displayPhone(contact.phone)}</p>
          )}
          {contact.notes && (
            <p className="text-[11px] text-hive-muted italic truncate mt-0.5">{contact.notes}</p>
          )}
        </div>
        <button
          onClick={onEdit}
          className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk hover:underline shrink-0"
        >
          Edit
        </button>
      </div>
      <div className="flex gap-2 mt-2.5">
        <button
          onClick={sendWhatsApp}
          disabled={!waLink}
          className="flex-1 h-9 rounded-hive-pill bg-[#25D366] hover:bg-[#1FA855] disabled:bg-hive-line/60 disabled:text-hive-muted text-white font-nunito font-black text-[12px] transition-colors"
        >
          {waLink ? '💬 WhatsApp' : 'No phone number'}
        </button>
        <button
          onClick={saveToPhone}
          className="h-9 px-3 rounded-hive-pill bg-hive-cream border border-hive-line text-hive-navy font-nunito font-extrabold text-[12px]"
        >
          ⬇ Save
        </button>
      </div>
    </div>
  );
}

// ── Contact form (add + edit) ─────────────────────────────────────

interface ContactFormData {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  notes: string;
  category: DirectoryCategory;
}

function ContactForm({
  existing, prefill, onSave, onCancel, onDelete,
}: {
  existing?: Supplier;
  prefill?: { name?: string; phone?: string };
  onSave: (data: ContactFormData) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(existing?.name || prefill?.name || '');
  const [contactName, setContactName] = useState(existing?.contactName || '');
  const [phone, setPhone] = useState(existing?.phone || prefill?.phone || '');
  const [email, setEmail] = useState(existing?.email || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [category, setCategory] = useState<DirectoryCategory>(
    (existing?.directoryCategory as DirectoryCategory) || 'supermarket',
  );
  const [error, setError] = useState('');

  const submit = () => {
    if (!name.trim()) { setError('Give the contact a name.'); return; }
    setError('');
    onSave({ name, contactName, phone, email, notes, category });
  };

  return (
    <div className="bg-hive-paper border-2 border-pantry-leaf rounded-hive-lg p-4 mb-4 space-y-3">
      <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-pantry-leaf-dk">
        {existing ? 'Edit contact' : 'New contact'}
      </p>

      <Field label="Name / business">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Juma the plumber"
          maxLength={60}
          autoFocus
          className="w-full h-10 px-3 bg-hive-cream rounded-[10px] text-[14px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </Field>

      <Field label="Phone (WhatsApp)">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0712 345 678"
          inputMode="tel"
          maxLength={20}
          className="w-full h-10 px-3 bg-hive-cream rounded-[10px] text-[14px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
        {phone.trim() && (
          <p className="text-[10px] text-hive-muted mt-1">
            Saved as {displayPhone(phone)} · {whatsappContactLink(phone) ? 'WhatsApp ready ✓' : 'too short for WhatsApp'}
          </p>
        )}
      </Field>

      <Field label="Service category">
        <div className="flex flex-wrap gap-1.5">
          {DIRECTORY_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border transition-colors ${
                category === c.id
                  ? 'bg-pantry-leaf text-white border-transparent'
                  : 'border-hive-line bg-hive-paper text-hive-muted'
              }`}
            >
              {c.emoji} {c.label.split(' / ')[0].split(' (')[0]}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Ask for (optional)">
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Person's name"
            maxLength={40}
            className="w-full h-10 px-3 bg-hive-cream rounded-[10px] text-[13px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </Field>
        <Field label="Email (optional)">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            inputMode="email"
            maxLength={60}
            className="w-full h-10 px-3 bg-hive-cream rounded-[10px] text-[13px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </Field>
      </div>

      <Field label="Notes (optional)">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Fixed the kitchen sink, fair prices"
          maxLength={120}
          className="w-full h-10 px-3 bg-hive-cream rounded-[10px] text-[13px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </Field>

      {error && <p className="text-hive-rose text-[12px] font-bold">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={submit}
          className="flex-1 h-11 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[13px]"
        >
          {existing ? 'Save changes' : 'Add to Yellow Pages'}
        </button>
        <button
          onClick={onCancel}
          className="h-11 px-4 rounded-hive-pill bg-hive-line text-hive-muted font-nunito font-extrabold text-[12px]"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            className="h-11 px-3 rounded-hive-pill bg-hive-rose/10 text-hive-rose font-nunito font-extrabold text-[11px]"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}

// ── Import sheet ──────────────────────────────────────────────────

function ImportSheet({
  onImport, onClose,
}: {
  onImport: (rows: { contact: ParsedContact; category: DirectoryCategory }[]) => Promise<number>;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedContact[] | null>(null);
  const [format, setFormat] = useState<ImportFormat | null>(null);
  const [rowCats, setRowCats] = useState<Record<number, DirectoryCategory>>({});
  const [bulkCat, setBulkCat] = useState<DirectoryCategory>('fundi');
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    const text = await file.text();
    setRaw(text);
    runParse(text);
  };

  const runParse = (text: string) => {
    const { format, contacts } = parseContacts(text);
    setFormat(format);
    setParsed(contacts);
    // Seed each row's category from the parser's guess, else the
    // current bulk default.
    const seed: Record<number, DirectoryCategory> = {};
    contacts.forEach((c, i) => { seed[i] = c.guessedCategory || bulkCat; });
    setRowCats(seed);
  };

  const applyBulk = (cat: DirectoryCategory) => {
    setBulkCat(cat);
    if (!parsed) return;
    const next: Record<number, DirectoryCategory> = {};
    parsed.forEach((_, i) => { next[i] = cat; });
    setRowCats(next);
  };

  const doImport = async () => {
    if (!parsed) return;
    setBusy(true);
    await onImport(parsed.map((contact, i) => ({ contact, category: rowCats[i] || bulkCat })));
    setBusy(false);
  };

  const formatLabel =
    format === 'vcard' ? 'vCard / WhatsApp contact card'
    : format === 'csv' ? 'Google Contacts CSV'
    : format === 'text' ? 'Pasted text'
    : '';

  return (
    <div className="bg-hive-paper border-2 border-pantry-leaf rounded-hive-lg p-4 mb-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-pantry-leaf-dk">
          Import contacts
        </p>
        <button onClick={onClose} className="text-hive-muted text-xl leading-none">×</button>
      </div>
      <p className="text-[11px] text-hive-muted leading-snug">
        Upload a <strong>.vcf</strong> (phone export or a WhatsApp-shared card), a{' '}
        <strong>Google Contacts CSV</strong>, or just paste names + numbers. We detect the format automatically.
      </p>

      {!parsed ? (
        <>
          <label className="block">
            <span className="block w-full h-11 leading-[2.75rem] text-center rounded-hive-pill bg-pantry-leaf text-white font-nunito font-black text-[13px] cursor-pointer">
              📂 Choose a file (.vcf / .csv)
            </span>
            <input
              type="file"
              accept=".vcf,.csv,text/vcard,text/csv,text/plain"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
          </label>
          <div className="text-center text-[10px] text-hive-muted font-nunito font-extrabold uppercase tracking-wider">— or paste —</div>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={'Juma plumber, 0712 345 678\nGreen Pharmacy 0688 111 222\n…one per line'}
            rows={4}
            className="w-full p-3 bg-hive-cream rounded-[10px] text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40 resize-none"
          />
          <button
            onClick={() => runParse(raw)}
            disabled={!raw.trim()}
            className="w-full h-10 rounded-hive-pill bg-hive-navy text-white font-nunito font-extrabold text-[12px] disabled:opacity-40"
          >
            Preview contacts →
          </button>
        </>
      ) : parsed.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-[12px] text-hive-muted">
            Couldn't find any contacts in that {formatLabel.toLowerCase()}. Check the format and try again.
          </p>
          <button
            onClick={() => { setParsed(null); setFormat(null); }}
            className="mt-2 text-[12px] font-nunito font-extrabold text-pantry-leaf-dk underline"
          >
            ← Try again
          </button>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-hive-navy font-nunito font-extrabold">
            Found {parsed.length} contact{parsed.length === 1 ? '' : 's'} · {formatLabel}
          </p>

          {/* Bulk category assign */}
          <div>
            <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.2px] text-hive-muted mb-1">
              Set all to one category (you can still change rows below)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DIRECTORY_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => applyBulk(c.id)}
                  className={`px-2 py-1 rounded-hive-pill text-[10px] font-nunito font-extrabold border ${
                    bulkCat === c.id
                      ? 'bg-pantry-leaf text-white border-transparent'
                      : 'border-hive-line bg-hive-paper text-hive-muted'
                  }`}
                >
                  {c.emoji} {c.label.split(' / ')[0].split(' (')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Per-row preview + category dropdown */}
          <div className="max-h-64 overflow-y-auto space-y-1.5 -mx-1 px-1">
            {parsed.map((c, i) => (
              <div key={i} className="flex items-center gap-2 bg-hive-cream rounded-hive p-2">
                <div className="flex-1 min-w-0">
                  <p className="font-nunito font-extrabold text-[12px] truncate">{c.name}</p>
                  <p className="text-[10px] text-hive-muted truncate">
                    {c.phone ? displayPhone(c.phone) : 'no number'}
                  </p>
                </div>
                <select
                  value={rowCats[i] || bulkCat}
                  onChange={(e) => setRowCats((prev) => ({ ...prev, [i]: e.target.value as DirectoryCategory }))}
                  className="h-8 px-1.5 rounded-[8px] bg-hive-paper border border-hive-line text-[11px] font-nunito font-extrabold shrink-0 max-w-[42%]"
                >
                  {DIRECTORY_CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.emoji} {cat.label.split(' / ')[0].split(' (')[0]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { setParsed(null); setFormat(null); }}
              className="h-10 px-4 rounded-hive-pill bg-hive-line text-hive-muted font-nunito font-extrabold text-[12px]"
            >
              ← Back
            </button>
            <button
              onClick={doImport}
              disabled={busy}
              className="flex-1 h-10 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[12px] disabled:opacity-50"
            >
              {busy ? 'Importing…' : `Import ${parsed.length} contact${parsed.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Small shared bits ─────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.2px] text-hive-muted block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function CatChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border whitespace-nowrap transition-colors ${
        active
          ? 'bg-pantry-leaf-soft text-pantry-leaf-dk border-pantry-leaf'
          : 'border-hive-line bg-hive-paper text-hive-muted hover:border-pantry-leaf/50'
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
      <div className="text-4xl mb-2">📒</div>
      <p className="font-nunito font-extrabold text-[14px]">Your Yellow Pages is empty</p>
      <p className="text-[12px] text-hive-muted mt-1 mb-4 leading-relaxed">
        Add the plumber, the pharmacy, the kids' school — everyone your household calls on.
        Import your phone contacts to fill it fast.
      </p>
      <div className="flex gap-2 justify-center">
        <button
          onClick={onAdd}
          className="h-10 px-4 rounded-hive-pill bg-pantry-leaf text-white font-nunito font-black text-[12px]"
        >
          + Add one
        </button>
        <button
          onClick={onImport}
          className="h-10 px-4 rounded-hive-pill bg-hive-cream border border-hive-line text-hive-navy font-nunito font-extrabold text-[12px]"
        >
          ⬆ Import contacts
        </button>
      </div>
    </div>
  );
}
