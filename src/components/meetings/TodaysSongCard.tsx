'use client';

// ── Today's Closing Song setter (Sunday-Meeting v4.3) ───────────────────
// Shared card so a PARENT or the meeting LEADER of the day (incl. a kid) can
// set today's closing song from the Meetings hub, My Day, OR My Workplan.
// Writes to the family-WRITABLE Song Library (tagged pickedForCycle) so a
// kid leader's pick persists and the presenter reveals it to everyone.
//
// Errors are SURFACED (not swallowed) — if the save is denied (e.g. the
// meetingSongLibrary rules aren't deployed yet) the user sees why.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { meetingCycleKey } from '@/lib/meetingSubmissions';
import {
  setTodaysSong, subscribeTodaysSong, clearTodaysSong, approveTodaysSong, type SongLibraryEntry,
} from '@/lib/meetingSongLibrary';
import { songThumbnailUrl } from '@/lib/songEmbed';
import SongLibraryView from './SongLibraryView';

export default function TodaysSongCard({ className = '' }: { className?: string }) {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const familyId = family?.id;
  const scheduleDow = family?.meetingSetup?.schedule?.dayOfWeek;
  const cycleKey = useMemo(() => meetingCycleKey(scheduleDow) ?? 'always', [scheduleDow]);

  // Resolve a kid's childId (empty-string safe — match by email, never [0]).
  const myChildId = useMemo(() => {
    if (profile?.role !== 'kid' || !profile) return undefined;
    const direct = profile.childId?.trim();
    if (direct) return direct;
    const myEmail = profile.email?.toLowerCase() ?? '';
    if (!myEmail) return undefined;
    return (children || []).find((c: { id: string; emailLower?: string; email?: string }) =>
      (c.emailLower || c.email?.toLowerCase() || '') === myEmail)?.id;
  }, [profile, children]);

  // Who may set: any PARENT, or the LEADER of the day (parent or kid). No helpers.
  const isLeaderOfDay = useMemo(() => {
    const leader = family?.nextMeetingLeader;
    if (!leader || !profile) return false;
    if (leader.id === profile.uid) return true;
    return !!(myChildId && leader.id === myChildId);
  }, [family?.nextMeetingLeader, profile, myChildId]);
  const canSetSong = profile?.role === 'parent' || isLeaderOfDay;
  const isParent = profile?.role === 'parent';
  const requiresApproval = family?.meetingSetup?.kidSongLinkRequiresApproval ?? true;

  const [songInput, setSongInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [active, setActive] = useState<SongLibraryEntry | null>(null);

  useEffect(() => {
    if (!familyId) return;
    const unsub = subscribeTodaysSong(familyId, cycleKey, (s) => {
      if (s) { setActive(s); return; }
      const legacy = family?.meetingSetup?.closingSong;
      const stillCurrent = legacy?.url && (!legacy.cycleKey || legacy.cycleKey === meetingCycleKey(scheduleDow));
      setActive(stillCurrent
        ? ({ id: '', url: legacy!.url, provider: 'other', addedAt: 0, playCount: 0, avgRating: 0, ratingCount: 0, pickedByName: legacy!.setByName } as SongLibraryEntry)
        : null);
    });
    return () => unsub();
  }, [familyId, cycleKey, family?.meetingSetup?.closingSong, scheduleDow]);

  if (!canSetSong || !familyId) return null;

  const doSet = async (url: string) => {
    setError(null);
    if (!url.trim().startsWith('http')) { setError('Paste a full YouTube or Spotify link (starts with http).'); return; }
    setSaving(true);
    try {
      await setTodaysSong(familyId, {
        url: url.trim(),
        cycleKey,
        setByName: profile?.displayName?.split(' ')[0] || 'you',
        setByUid: profile?.uid,
        setByRole: (profile?.role === 'kid' ? 'kid' : profile?.role === 'helper' ? 'helper' : 'parent'),
        // Parent-set → auto-approved. Kid-set → pending unless the family's
        // kid-song approval gate is off.
        pickApproved: isParent ? true : !requiresApproval,
      });
      setSongInput('');
      setShowLibrary(false);
    } catch (e: any) {
      const msg = (e?.code === 'permission-denied' || /permission/i.test(e?.message || ''))
        ? 'Could not save — the song library isn’t enabled yet. Ask a parent to deploy the latest Kaya update.'
        : (e?.message || 'Could not save the song — please try again.');
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const doClear = async () => {
    setError(null);
    try { await clearTodaysSong(familyId, cycleKey); } catch { setActive(null); }
  };

  const doApprove = async () => {
    setError(null);
    try { await approveTodaysSong(familyId, cycleKey); }
    catch { setError('Could not approve — please try again.'); }
  };

  const pendingApproval = !!active && active.pickApproved === false;

  return (
    <div className={`bg-kaya-chocolate/5 border border-kaya-chocolate/15 rounded-kaya-lg p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">🎵</span>
        <h3 className="font-display font-extrabold text-[13px] text-kaya-chocolate">Today&apos;s closing song</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-kaya-gold/20 text-kaya-chocolate/70">
          Surprise reveal
        </span>
      </div>

      {active ? (
        <>
        <div className="flex items-start gap-3">
          {/* Video thumbnail — reads as a video, not a long URL */}
          <a
            href={active.url}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 relative w-[92px] aspect-video rounded-lg overflow-hidden group bg-cover bg-center"
            style={songThumbnailUrl(active.url)
              ? { backgroundImage: `url(${songThumbnailUrl(active.url)})` }
              : { background: 'linear-gradient(150deg,#3a2710,#caa12f)' }}
            title="Open the video"
          >
            {!songThumbnailUrl(active.url) && (
              <span className="absolute inset-0 grid place-items-center text-2xl">🎬</span>
            )}
            <span className="absolute inset-0 grid place-items-center">
              <span className="w-7 h-5 rounded-[5px] bg-red-600/90 grid place-items-center group-hover:scale-110 transition-transform">
                <span className="w-0 h-0 ml-0.5" style={{ borderStyle: 'solid', borderWidth: '5px 0 5px 8px', borderColor: 'transparent transparent transparent #fff' }} />
              </span>
            </span>
          </a>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-extrabold text-kaya-chocolate truncate">
              🎬 {active.title?.trim() || 'Tonight’s song'}
            </p>
            <p className="text-[11px] text-kaya-chocolate/60 mt-0.5">Set by {active.pickedByName || active.addedByName || 'leader'}</p>
            <a href={active.url} target="_blank" rel="noreferrer noopener"
              className="inline-block mt-1 text-[11px] font-bold text-kaya-gold-dark underline underline-offset-2">▶ Open / preview</a>
          </div>
          <button type="button" onClick={doClear}
            className="shrink-0 text-[11px] text-kaya-sand hover:text-red-500 font-bold transition-colors">✕ Clear</button>
        </div>

        {/* 🛡️ Kid-set song awaiting a parent's OK */}
        {pendingApproval && (
          <div className="mt-3 rounded-kaya-sm border border-kaya-gold/50 bg-kaya-gold/10 p-3">
            <p className="text-[12px] font-bold text-kaya-chocolate">
              🛡️ {active.pickedByName || 'A kid'} chose this song — it needs a parent’s OK before it plays.
            </p>
            {isParent ? (
              <button
                type="button"
                onClick={doApprove}
                className="mt-2 inline-flex items-center gap-2 h-9 px-4 rounded-kaya-sm bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-extrabold text-[12px] transition-colors"
              >
                ✓ Approve this song
              </button>
            ) : (
              <p className="mt-1.5 text-[11px] text-kaya-chocolate/60">⏳ Waiting for a parent to approve — hand them the phone for one tap.</p>
            )}
          </div>
        )}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              type="url"
              value={songInput}
              onChange={(e) => setSongInput(e.target.value)}
              placeholder="Paste YouTube / Spotify link…"
              className="flex-1 h-10 px-3 bg-white border border-kaya-chocolate/20 rounded-kaya-sm text-[13px] text-kaya-chocolate placeholder-kaya-sand/60 focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
            />
            <button
              type="button"
              onClick={() => doSet(songInput)}
              disabled={saving || !songInput.trim().startsWith('http')}
              className="h-10 px-4 rounded-kaya-sm bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-extrabold text-[12px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? '…' : 'Set'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowLibrary((v) => !v)}
            className="mt-2 w-full h-9 rounded-kaya-sm bg-white border border-kaya-chocolate/20 text-kaya-chocolate font-extrabold text-[12px] hover:bg-kaya-warm transition-colors"
          >
            📚 {showLibrary ? 'Hide library' : 'Pick from Song Library'}
          </button>
          {showLibrary && (
            <div className="mt-3">
              <SongLibraryView familyId={familyId} onUse={(e) => doSet(e.url)} compact />
            </div>
          )}
        </>
      )}

      {error && <p className="mt-2 text-[11px] font-bold text-red-500">⚠️ {error}</p>}

      <p className="mt-1.5 text-[10px] text-kaya-sand">
        {active
          ? '🎶 Ready — the presenter reveals it as a 5-4-3-2-1 countdown surprise for everyone.'
          : 'A parent or the day’s leader can set it. Paste a link or pick from the library.'}
      </p>
    </div>
  );
}
