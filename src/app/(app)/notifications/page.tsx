'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getNotifications, markNotificationRead, Notification } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

const TYPE_ICONS: Record<string, string> = {
  points:  '🎖️',
  badge:   '🏆',
  meeting: '👨‍👩‍👧‍👦',
  reward:  '🎁',
  streak:  '🔥',
  'moment-reaction': '💖',
  'moment-comment':  '💬',
  'moment-mention':  '🏷️',
  'moment-new':      '📸',
};

const TYPE_LABELS: Record<string, string> = {
  points:  'Points',
  badge:   'Badge',
  meeting: 'Meeting',
  reward:  'Reward',
  streak:  'Streak',
  'moment-reaction': 'Reaction',
  'moment-comment':  'Comment',
  'moment-mention':  'Mention',
  'moment-new':      'New post',
};

export default function NotificationsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.familyId) return;
    getNotifications(profile.familyId, profile.uid).then((n) => {
      setNotifications(n);
      setLoading(false);
    });
  }, [profile?.familyId, profile?.uid]);

  const handleRead = async (notif: Notification) => {
    if (profile?.familyId && !notif.read) {
      await markNotificationRead(profile.familyId, notif.id);
      setNotifications((prev) => prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n)));
    }
    if (notif.link) router.push(notif.link);
  };

  const handleReadAll = async () => {
    if (!profile?.familyId) return;
    const unread = notifications.filter((n) => !n.read);
    await Promise.all(unread.map((n) => markNotificationRead(profile.familyId, n.id)));
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>

      <div className="mb-5 lg:mb-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight">Notifications</h1>
          <p className="text-kaya-sand text-sm mt-0.5 lg:mt-1">
            {unreadCount > 0
              ? `${unreadCount} unread · ${notifications.length} total`
              : `${notifications.length} total · all caught up`}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleReadAll}
            className="text-[12px] font-semibold text-kaya-gold hover:underline whitespace-nowrap"
          >
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-kaya-sand text-sm text-center pt-8">Loading…</p>
      ) : notifications.length === 0 ? (
        <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-12 text-center">
          <p className="text-5xl mb-3">🔔</p>
          <p className="font-display font-bold text-lg mb-1">No notifications yet</p>
          <p className="text-kaya-sand text-sm">Activity updates will appear here as your family rates routines, awards points, and runs meetings.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleRead(n)}
              className={`w-full text-left flex items-start gap-3 p-3 lg:p-4 rounded-kaya border transition-colors ${
                n.read
                  ? 'bg-white border-kaya-warm-dark/60 opacity-70 hover:opacity-100'
                  : 'bg-white border-kaya-gold/40 shadow-sm hover:border-kaya-gold'
              }`}
            >
              <div className="w-10 h-10 rounded-[10px] bg-kaya-warm/60 flex items-center justify-center text-lg shrink-0">
                {TYPE_ICONS[n.type] || '📌'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <p className="text-sm font-semibold truncate">{n.title}</p>
                  <span className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider shrink-0">
                    {TYPE_LABELS[n.type] || n.type}
                  </span>
                </div>
                <p className="text-[13px] text-kaya-sand leading-snug">{n.message}</p>
              </div>
              {!n.read && <div className="w-2 h-2 rounded-full bg-kaya-gold flex-shrink-0 mt-2" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
