# Kaya — Where Families Grow 🏠

A family house points system that gamifies daily routines, awards good behavior, and builds character through weekly family meetings.

Built for the Timotheo family in Dar es Salaam, designed for families worldwide.

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **Backend**: Firebase Auth + Firestore
- **Deploy**: Vercel
- **PWA**: Installable on any device

## Features (Phase 1)

- 🔐 **Auth**: Google Sign-In + Email/Password
- 👨‍👩‍👧‍👦 **Role-based views**: Parent, Helper, Kid
- 📋 **Rate Routines**: Morning & evening task rating (Excellent/Good/Bad)
- 🎖️ **Award Points**: Bonus points for good behavior
- 🏆 **Badges**: 8 milestone badges (First Star → Legend)
- 👧 **Kid Profiles**: Per-child progress, 7-day heatmap, stats
- 👨‍👩‍👧‍👦 **Family Meetings**: Guided 6-step meeting flow with logging
- 📊 **Reports**: 7/14/30-day performance breakdown
- 🎁 **Rewards Store**: Redeem points for family rewards
- 🔔 **Notifications**: Activity feed
- ⚙️ **Settings**: Invite code, Points Mode toggle, manage children
- 🤝 **Helper Dashboard**: Simplified rating-only view
- ⭐ **Kid Dashboard**: Child-friendly points & badges view

## Quick Start

```bash
# 1. Clone
git clone https://github.com/etimotheo1/kaya.git
cd kaya

# 2. Install
npm install

# 3. Environment variables
# Copy .env.local (already configured for kaya-app-b9463)

# 4. Run locally
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

1. Push to GitHub: `git push origin main`
2. Go to [vercel.com](https://vercel.com) → Import `etimotheo1/kaya`
3. Add environment variables from `.env.local`
4. Deploy — done!

## Firebase Setup (Already Done)

- Project: `kaya-app-b9463`
- Auth: Google Sign-In enabled
- Firestore: Test mode (deploy security rules before production)
- Storage: Skipped (Phase 2)

## Firestore Data Structure

```
families/{familyId}
  ├── name, inviteCode, pointsMode, routines[]
  ├── children/{childId} — name, houseName, houseColor, totalPoints, badges[]
  ├── ratings/{ratingId} — childId, date, period, ratings{}, totalPoints
  ├── awards/{awardId} — childId, points, reason, category
  ├── meetings/{meetingId} — date, type, gratitude{}, goals{}, notes
  ├── rewards/{rewardId} — title, description, pointsCost, icon
  ├── redemptions/{id} — childId, rewardId, pointsSpent
  └── notifications/{id} — type, title, message, read

users/{uid}
  └── email, displayName, role, familyId
```

## Phase 2 (Planned)

- Kids journaling & photo sharing
- Custom chores
- Business Mode: micro-enterprises (orchard, chickens, passion fruits)
- WhatsApp share links
- Photo upload avatars
- Billing/freemium tiers

## Family Houses

| Child | House |
|-------|-------|
| Earlnathan | 🏅 Golden House |
| Diella | 🤍 White House |
| Daniella | 🥈 Silver House |

---

*"Kaya" — Swahili for "home." Where families grow together.*
