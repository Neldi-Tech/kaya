'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getNotifications, markNotificationRead, Notification } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

const TYPE_ICONS: Record<string, string> = {
  points: '🎖️',
  badge: '🏆',
  meeting: '👨‍👩‍👧‍👦',
  reward: '🎁',
  streak: '🔥',
};

export default function NotificationsPage() {
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
    if (!profile?.familyId || notif.read) return;
    await markNotificationRead(profile.familyId, notif.id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
    );
  };

  return (
    <div className="px-4 pt-4">
      <BackButton />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-black">Notifications</h1>
      </div>

      {loading ? (
        <p className="text-kaya-sand text-sm text-center pt-8">Loading...</p>
      ) : notifications.length === 0 ? (
        <div className="text-center pt-10">
          <p className="text-4xl mb-3">🔔</p>
          <p className="text-kaya-sand text-sm">No notifications yet</p>
          <p className="text-kaya-sand text-xs mt-1">Activity updates will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleRead(n)}
              className={`w-full text-left flex items-start gap-3 p-3 rounded-kaya-sm border transition-colors ${
                n.read
                  ? 'bg-white border-kaya-warm-dark opacity-60'
                  : 'bg-white border-kaya-gold/30 shadow-sm'
              }`}
            >
              <span className="text-xl flex-shrink-0 mt-0.5">{TYPE_ICONS[n.type] || '📌'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{n.title}</p>
                <p className="text-xs text-kaya-sand truncate">{n.message}</p>
              </div>
              {!n.read && <div className="w-2 h-2 rounded-full bg-kaya-gold flex-shrink-0 mt-2" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
