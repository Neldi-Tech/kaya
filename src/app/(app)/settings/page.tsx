'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily, updateUserProfile, addChild, PointsMode } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

export default function SettingsPage() {
  const router = useRouter();
  const { user, profile, signOut, refreshProfile, isGuest } = useAuth();
  const { family, children, refresh } = useFamily();

  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newChildName, setNewChildName] = useState('');
  const [addingChild, setAddingChild] = useState(false);
  const [pointsMode, setPointsMode] = useState<PointsMode>(family?.pointsMode || 'full');

  // Display name editor
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    if (family?.pointsMode) setPointsMode(family.pointsMode);
  }, [family?.pointsMode]);

  const startEditingName = () => {
    setNameInput(profile?.displayName || '');
    setNameError('');
    setEditingName(true);
  };

  const cancelEditingName = () => {
    setEditingName(false);
    setNameError('');
  };

  const saveName = async () => {
    if (!user || isGuest) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError('Name cannot be empty');
      return;
    }
    if (trimmed === profile?.displayName) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setNameError('');
    try {
      await updateUserProfile(user.uid, { displayName: trimmed });
      await refreshProfile();
      setEditingName(false);
    } catch (e: any) {
      setNameError(e.message || 'Failed to save');
    }
    setSavingName(false);
  };

  const copyInviteCode = () => {
    if (!family?.inviteCode) return;
    navigator.clipboard.writeText(family.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddChild = async () => {
    if (!profile?.familyId || !newChildName.trim()) return;
    setAddingChild(true);
    const colors = ['#D4A017', '#7B9DB7', '#9B8EC4', '#C0392B', '#27AE60', '#2980B9'];
    const emojis = ['🏅', '🤍', '🥈', '❤️', '💚', '💙'];
    const idx = children.length % colors.length;

    await addChild(profile.familyId, {
      name: newChildName.trim(),
      houseName: `House ${children.length + 1}`,
      houseColor: colors[idx],
      avatarEmoji: emojis[idx],
      totalPoints: 0,
      weeklyPoints: 0,
      streak: 0,
      badges: [],
    } as any);
    setNewChildName('');
    setAddingChild(false);
    await refresh();
  };

  const handlePointsMode = async (mode: PointsMode) => {
    if (!profile?.familyId) return;
    setPointsMode(mode);
    await updateFamily(profile.familyId, { pointsMode: mode } as any);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  const isParent = profile?.role === 'parent';

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4">
      <BackButton />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-black">Settings</h1>
      </div>

      {/* Profile card */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-lg text-white font-black shrink-0">
            {profile?.displayName?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="space-y-2">
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full h-9 px-3 bg-kaya-cream rounded-kaya-sm text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                  placeholder="Your display name"
                  autoFocus
                  maxLength={40}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName();
                    if (e.key === 'Escape') cancelEditingName();
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveName}
                    disabled={savingName}
                    className="h-8 px-3 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
                  >
                    {savingName ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={cancelEditingName}
                    disabled={savingName}
                    className="h-8 px-3 bg-kaya-warm rounded-kaya-sm text-xs font-semibold text-kaya-sand"
                  >
                    Cancel
                  </button>
                </div>
                {nameError && <p className="text-red-500 text-xs">{nameError}</p>}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-sm truncate">{profile?.displayName || 'You'}</p>
                  {!isGuest && (
                    <button
                      onClick={startEditingName}
                      className="text-[11px] text-kaya-gold font-semibold hover:underline shrink-0"
                    >
                      Edit
                    </button>
                  )}
                </div>
                <p className="text-xs text-kaya-sand truncate">{profile?.email}</p>
                <p className="text-xs font-semibold capitalize" style={{ color: '#D4A017' }}>{profile?.role}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Family name */}
      {family && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-1">Family</p>
          <p className="font-bold">{family.name}</p>
        </div>
      )}

      {/* Invite code */}
      {isParent && family && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">Invite Code</p>
            <button
              onClick={() => setShowInvite(!showInvite)}
              className="text-xs text-kaya-gold font-semibold"
            >
              {showInvite ? 'Hide' : 'Show'}
            </button>
          </div>
          {showInvite && (
            <div className="flex items-center gap-3">
              <p className="text-2xl font-mono font-bold tracking-[0.3em] flex-1">{family.inviteCode}</p>
              <button
                onClick={copyInviteCode}
                className="px-4 py-2 bg-kaya-warm rounded-kaya-sm text-xs font-semibold text-kaya-sand"
              >
                {copied ? '✅ Copied' : '📋 Copy'}
              </button>
            </div>
          )}
          <p className="text-xs text-kaya-sand mt-2">Share this code with helpers or family members to join</p>
        </div>
      )}

      {/* Points Mode */}
      {isParent && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-3">Points Mode</p>
          <div className="space-y-2">
            {[
              { value: 'full' as PointsMode, label: 'Full Points', desc: 'Show all points and rankings' },
              { value: 'badges-only' as PointsMode, label: 'Badges Only', desc: 'Focus on badges, hide point numbers' },
              { value: 'encouragement' as PointsMode, label: 'Encouragement', desc: 'No competition, positive reinforcement only' },
            ].map((mode) => (
              <button
                key={mode.value}
                onClick={() => handlePointsMode(mode.value)}
                className={`w-full text-left p-3 rounded-kaya-sm border-2 transition-all ${
                  pointsMode === mode.value
                    ? 'border-kaya-gold bg-kaya-gold/5'
                    : 'border-kaya-warm-dark'
                }`}
              >
                <p className="text-sm font-semibold">{mode.label}</p>
                <p className="text-xs text-kaya-sand">{mode.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add child */}
      {isParent && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-3">Children</p>
          <div className="space-y-2 mb-3">
            {children.map((child) => (
              <div key={child.id} className="flex items-center gap-2 text-sm">
                <span>{child.avatarEmoji}</span>
                <span className="font-medium">{child.name}</span>
                <span className="text-xs text-kaya-sand">— {child.houseName}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newChildName}
              onChange={(e) => setNewChildName(e.target.value)}
              className="flex-1 h-10 px-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
              placeholder="Add a child..."
            />
            <button
              onClick={handleAddChild}
              disabled={!newChildName.trim() || addingChild}
              className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm text-sm font-bold disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Navigation links */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden mb-4">
        {[
          { label: 'Kid Profiles', path: '/profiles', icon: '👧' },
          { label: 'Reports', path: '/reports', icon: '📊' },
          { label: 'Badges', path: '/badges', icon: '🏆' },
        ].map((item, i) => (
          <button
            key={item.path}
            onClick={() => router.push(item.path)}
            className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-kaya-cream transition-colors ${
              i > 0 ? 'border-t border-kaya-warm-dark' : ''
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            <span className="text-sm font-medium flex-1">{item.label}</span>
            <span className="text-kaya-sand text-sm">→</span>
          </button>
        ))}
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="w-full h-11 bg-red-50 text-red-500 rounded-kaya text-sm font-semibold hover:bg-red-100 transition-colors mb-8"
      >
        Sign Out
      </button>
    </div>
  );
}
