'use client';

// Big green "Send to {Supplier} on WhatsApp" button. Opens the wa.me
// deep link in a new tab; on success we mark the supplier as
// recently-contacted so the Soko view can sort by recency later.
//
// When the supplier has no phone (or whatsapp not enabled), we render a
// disabled hint that nudges the parent to add a number.

import type { GroceryListItem, Supplier } from '@/lib/pantry';
import {
  formatListForWhatsApp, whatsappLink, markSupplierContacted,
} from '@/lib/pantry';
import { useAuth } from '@/contexts/AuthContext';

export default function WhatsAppSendButton({
  supplier,
  items,
  familyName,
  size = 'md',
}: {
  supplier: Supplier;
  items: GroceryListItem[];
  /** Optional family name — used in the message greeting. */
  familyName?: string;
  size?: 'sm' | 'md';
}) {
  const { profile } = useAuth();
  const message = formatListForWhatsApp(supplier.name, items, {
    greeting: `Hi ${supplier.name},${familyName ? ` ${familyName} family here.` : ''}`,
  });
  const link = whatsappLink(supplier.phone, message);
  const send = () => {
    if (!link || !profile?.familyId) return;
    // Stamp lastContactedAt before opening — fire-and-forget.
    markSupplierContacted(profile.familyId, supplier.id).catch(() => {});
    window.open(link, '_blank', 'noopener,noreferrer');
  };
  const padding = size === 'sm' ? 'py-2 px-3 text-[12px]' : 'py-3 px-4 text-[13px]';

  if (!link) {
    return (
      <div className={`w-full ${padding} rounded-hive bg-hive-line/50 text-hive-muted text-center font-nunito font-extrabold`}>
        Add a phone number for {supplier.name} to enable WhatsApp send
      </div>
    );
  }
  const undone = items.filter((i) => !i.done).length;
  if (undone === 0) {
    return (
      <div className={`w-full ${padding} rounded-hive bg-hive-line/40 text-hive-muted text-center font-nunito font-extrabold`}>
        Nothing to send · all items checked off ✓
      </div>
    );
  }
  return (
    <button
      onClick={send}
      className={`w-full ${padding} rounded-hive bg-[#25D366] hover:bg-[#1FA855] text-white font-nunito font-black transition-colors flex items-center justify-center gap-2 shadow-[0_8px_20px_-8px_rgba(37,211,102,0.4)]`}
    >
      <span>📤</span>
      Send {undone} item{undone === 1 ? '' : 's'} to {supplier.name} on WhatsApp
    </button>
  );
}
