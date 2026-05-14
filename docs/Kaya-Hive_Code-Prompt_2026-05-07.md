# Kaya · The Hive — Code Generation Prompt

> **Use this prompt in Cursor / v0 / Claude Code.** Paste the entire file as the first message, with the existing `etimotheo1/kaya` repo open. The agent will scaffold the Hive module on top of the existing Next.js + Firebase app.

> **Updated 2026-05-13 — v3 (cash-split + sale-approval).** Cash (L3) is now split into **on-hand** vs **deposit** sub-balances; new transaction types and Cloud Functions added for safekeeping deposits and withdrawals; new Hive config keys + flows added for **business sale approvals** so Kaya Business (separate module) plugs in cleanly. See *Migration* in section 3 and *Kaya-Business_Project_Briefing_2026-05-13.md* for the downstream design that motivated these changes.

---

## 1. CONTEXT (read before generating)

You are extending an existing app called **Kaya** — a family house-points system for kids. The repo is `etimotheo1/kaya`.

**Stack already in place:**
- Next.js 14 App Router
- Tailwind CSS
- Firebase Auth + Firestore
- Existing contexts: `AuthContext`, `FamilyContext`
- Existing data layer: `src/lib/firestore.ts`
- Existing security rules at `firestore.rules` (family-scoped, role-based: parent / helper / kid)
- Domain: `ourkaya.com` (live)
- Firebase project: `kaya-app-b9463`

**Existing routes (do not duplicate):** dashboard, rate, award, profiles, kid, helper, meetings, badges, rewards, reports, notifications, settings, login, onboarding.

**You are adding a new module called The Hive** — kids' money portal with three currency layers and parent-controlled exchange rates.

---

## 2. THE 3-LAYER MODEL (core domain)

Every kid has three balances:

| Layer | Currency | Lives in | Purpose |
|---|---|---|---|
| **L1** | House Points (HP) | Kaya core | Earned from chores, quests, awards. Spendable on in-family rewards. |
| **L2** | Honey Coins (🍯) | The Hive | Committed savings. Converted from HP. Visible to parents. |
| **L3** | Cash ($) | Wallet | Real money. Received as allowance, gifts, future business income. Spent with parent approval. |

**Two parent-controlled exchange rates per family:**
- **Rate A — `hpToHoneyRate`** (default: `100`) — how many HP equal 1 Honey Coin.
- **Rate B — `honeyToCashRate`** (default: `1.00`) — how many USD equal 1 Honey Coin.

**Conversion rules:**
- HP → Honey: auto-approved, instant. Kid's choice.
- Honey → Cash: requires parent approval. Creates an approval request.
- Cash spending: each spend requires parent approval before deducting.
- Cash receiving (allowance/gifts/manual deposit): parent action — instant.

**Money discipline:**
- Once HP becomes Honey, it's a commitment. No reverse conversion.
- Cash is always represented as integer cents in storage to avoid float drift.

---

## 3. FIRESTORE SCHEMA (add to existing rules)

```
families/{familyId}
  ...existing fields
  hiveConfig:
    hpToHoneyRate: number              // default 100
    honeyToCashRate: number            // default 1.00
    currency: string                   // family-configurable, NEVER hard-coded. Sensible default per locale (e.g. "TZS" for TZ family, "USD" for US).
    cashOutRequiresApproval: bool      // default true
    spendRequiresApproval: bool        // default true
    saleRequiresApproval: bool         // default true — mirrors spend pattern (NEW v3)
    saleAutoApproveUnderCents: integer // default 0 (always require) — per-family threshold (NEW v3)
    defaultSaleDestination: "on_hand" | "on_deposit"  // default "on_hand" (NEW v3)
    largeSaleThresholdCents: integer   // sales above this default to "on_deposit" in UI (NEW v3)
    minCashOut: number                 // default 5 (Honey)
    autoAllowance:
      enabled: bool
      kidId: string
      amountCents: number
      cadence: "weekly" | "monthly"
      nextRunAt: Timestamp

families/{familyId}/kids/{kidId}/wallet (singleton doc, id = "balances")
  housePoints: number                  // mirrors core HP balance
  honeyCoins: number
  cashOnHandCents: integer             // physical cash kid holds (NEW v3 — replaces cashCents)
  cashOnDepositCents: integer          // safekeeping money parent holds for kid (NEW v3)
  // cashTotalCents is computed on read: onHand + onDeposit. Do not store.
  totalLifetimeEarnedCents: integer
  totalLifetimeSpentCents: integer
  updatedAt: Timestamp

families/{familyId}/kids/{kidId}/hiveTransactions/{txId}
  layer: "house_points" | "honey" | "cash"
  direction: "in" | "out"
  amount: number                       // HP / Honey integer, Cash in cents
  category: "chore" | "quest" | "award" | "convert" | "allowance"
            | "gift" | "business_sale" | "business_cost"
            | "spend" | "donation"
            | "cash_deposit" | "cash_withdrawal"   // safekeeping movements (NEW v3)
            | "other"
  cashDestination?: "on_hand" | "on_deposit"   // present on cash-layer txs (NEW v3)
  description: string
  status: "completed" | "pending_approval" | "approved" | "rejected"
  linkedTxId?: string                  // pairs the two sides of a conversion or safekeeping move
  ventureSaleId?: string               // back-ref to a Kaya Business sale doc, if applicable (NEW v3)
  ventureCostId?: string               // back-ref to a Kaya Business cost doc, if applicable (NEW v3)
  createdAt: Timestamp
  completedAt?: Timestamp
  createdBy: string                    // userId of kid or parent
  approvedBy?: string

families/{familyId}/kids/{kidId}/goals/{goalId}
  title: string
  icon: string                         // emoji
  targetAmount: number                 // in target layer's unit
  currentAmount: number
  layer: "honey" | "cash"              // which balance funds it
  cashSubLayer?: "on_hand" | "on_deposit" | "any"  // for cash-funded goals (NEW v3, default "any")
  status: "active" | "completed" | "abandoned"
  createdAt: Timestamp
  completedAt?: Timestamp

families/{familyId}/approvalRequests/{reqId}
  kidId: string
  type: "cash_out" | "spend" | "business_sale" | "business_cost" | "cash_withdrawal"   // expanded (NEW v3)
  amountCents: integer                 // for cash_out also store honeyAmount
  honeyAmount?: number                 // present on cash_out
  cashDestination?: "on_hand" | "on_deposit"   // present on business_sale (NEW v3)
  cashSource?: "on_hand" | "on_deposit"        // present on cash_withdrawal (always "on_deposit") and on business_cost (always "on_hand")
  ventureSaleId?: string               // back-ref to Kaya Business doc (NEW v3)
  ventureCostId?: string               // back-ref to Kaya Business doc (NEW v3)
  description: string
  category?: string                    // for spend / business_cost
  status: "pending" | "approved" | "rejected"
  createdAt: Timestamp
  resolvedAt?: Timestamp
  resolvedBy?: string
  rejectionReason?: string
  resultingTxIds?: string[]
```

**Migration (one-time backfill, run before deploying v3):**
For every existing wallet doc:
- `cashOnHandCents = existing cashCents`
- `cashOnDepositCents = 0`
- Delete `cashCents` field after copy.
For every existing cash-layer `hiveTransactions`:
- `cashDestination = "on_hand"` (safe default — they all moved on-hand cash before the split existed).
Run as a Cloud Function migration script. Idempotent — checks for absence of `cashOnHandCents` before touching.

**Security rules (extend existing):**
- Kids can read their own wallet, transactions, goals, requests.
- Kids can create their own goals, conversion txs (HP→Honey only — server-side rule), and `cash_out` / `spend` approval requests.
- Only parents (`role == "parent"`) can: edit `hiveConfig`, resolve `approvalRequests`, deposit cash (`category in ["allowance","gift","business"]`).
- Helpers (`role == "helper"`) cannot touch the Hive.
- All wallet mutations must go through Cloud Functions (not client) to keep balances atomic.

---

## 4. CLOUD FUNCTIONS (create `functions/src/hive.ts`)

Implement these callable functions:

1. `convertHpToHoney({ kidId, hpAmount })` — atomic: deducts HP, increments `honeyCoins`, creates two paired `hiveTransactions`.
2. `requestCashOut({ kidId, honeyAmount, cashDestination })` — creates `approvalRequest` type `cash_out`. Resolved Honey→Cash credits the chosen destination (default `on_hand`).
3. `requestSpend({ kidId, amountCents, description, category })` — creates `approvalRequest` type `spend`. **Spending always debits `cashOnHandCents`.** If on-hand insufficient, function returns an error code `INSUFFICIENT_ON_HAND` and the client should prompt the kid to request a cash withdrawal first.
4. `resolveApprovalRequest({ requestId, decision, reason? })` — parent-only. Atomic balance update + tx creation on approve. **Handles all approval types** (`cash_out`, `spend`, `business_sale`, `business_cost`, `cash_withdrawal`).
5. `depositCash({ kidId, amountCents, category, description, cashDestination })` — parent-only. Increments the chosen sub-balance (default `on_hand`) + writes `hiveTransactions`. **(NEW v3 param: `cashDestination`.)**
6. `setHiveRates({ hpToHoneyRate, honeyToCashRate })` — parent-only.
7. `runAutoAllowance()` — scheduled. Allowance always credits `on_hand`.

**NEW v3 — Safekeeping & Business plumbing:**

8. `requestCashDeposit({ kidId, amountCents })` — kid-initiated. Kid is logging that they handed physical cash to a parent. Creates `approvalRequest` type `cash_withdrawal`-mirror (call it `cash_deposit_pending`). On parent confirm: atomic move `onHand` ↓, `onDeposit` ↑; pair of `hiveTransactions` (`cash_deposit` out from on_hand, in to on_deposit), linked.
9. `withdrawCashFromSafekeeping({ kidId, amountCents })` — parent-only direct call (no approval needed — parent is the actor). Atomic move `onDeposit` ↓, `onHand` ↑; paired `hiveTransactions` with category `cash_withdrawal`.
10. `requestBusinessSale({ kidId, totalCents, items, buyerName, saleType, cashDestination, ventureSaleId })` — Kaya Business calls this when a kid logs a sale.
    - If `totalCents < hiveConfig.saleAutoApproveUnderCents` AND `hiveConfig.saleRequiresApproval == false`-or-threshold-allows → auto-approve immediately (atomic: cash sub-balance up, write `hiveTransactions` category `business_sale`, status `completed`).
    - Else → create `approvalRequest` type `business_sale`, status `pending`. Resolution flows through `resolveApprovalRequest`.
11. `requestBusinessCost({ kidId, amountCents, category, description, ventureCostId })` — Kaya Business calls this when a kid logs a wallet-funded cost. Threshold + approval logic mirrors `requestSpend`. Always debits `on_hand`. (Float-funded costs do NOT call this — the float lives outside Hive.)
12. `migrateWalletsToCashSplit()` — one-shot admin callable that performs the v3 backfill described in section 3.

All functions must:
- Verify caller's role via custom claims or Firestore lookup.
- Use Firestore transactions for any balance-touching write.
- Log to a `hiveAuditLog` collection.
- Treat `cashOnHandCents` and `cashOnDepositCents` as the only writable cash fields. `cashTotalCents` is computed on read in client code, never stored.

---

## 5. ROUTES (Next.js App Router)

Add under `src/app/`:

```
hive/
  page.tsx                    → Hive Home (Honey Pot dashboard)
  wallet/page.tsx             → all balances; Cash row expands into On Hand / On Deposit (v3)
  safekeeping/page.tsx        → deposit & withdraw flow between on-hand and on-deposit (NEW v3)
  convert/page.tsx            → exchange screen (Honey↔Cash now picks destination)
  cash-in/page.tsx            → income ledger (filterable by category, including business_sale)
  cash-out/page.tsx           → spending log + pending requests
  goals/page.tsx              → goal list
  goals/new/page.tsx          → add goal
  insights/page.tsx           → charts + tips

parent/
  rates/page.tsx              → Lever A / Lever B config + sale threshold (v3)
  approvals/page.tsx          → pending request inbox (now includes business_sale, business_cost, cash_deposit confirmations)
  hive-deposit/page.tsx       → manual cash deposit (allowance / gift; picks destination)
  hive-withdraw/page.tsx      → withdraw from kid's safekeeping back to on-hand (NEW v3)
```

A bottom tab bar specific to the Hive section: `Hive · Quests · Wallet · Insights`.

---

## 6. SCREEN SPECS

Refer to **Kaya-Hive_Design-Proposal-v3_2026-05-13.html** in the project root for the visual mockups. Match them faithfully.

**Hive Home (`/hive`)**
- Honey Pot balance card (gradient honey, 🍯 icon, balance, +N this week, streak)
- 4-button grid: Earn, Spend, Goals, Insights
- Recent activity list (5 most recent `hiveTransactions`)

**Wallet (`/hive/wallet`)** — *updated v3*
- Three balance cards stacked: HP (blue-grey), Honey (honey gradient), **Cash (green) — now shows three numbers**:
  - **Cash Total** (headline, big)
  - **On Hand** sub-row with a small icon (👛 / pocket)
  - **On Deposit** sub-row with a small icon (🏦 / safe)
- Cash card has two CTAs: "Deposit to safekeeping" and "Withdraw from safekeeping" → `/hive/safekeeping`
- HP and Honey cards each show balance + sub-line ("≈ TSh 12,000 if cashed out").
- Big "⇄ Convert between layers" CTA → `/hive/convert`
- Footer: "Total worth: ~TSh X across all layers" (currency symbol per `hiveConfig.currency`).
- Inline "What's this?" cards explaining *Cash on Hand* and *Cash on Deposit* in kid-friendly copy (see Kaya-Business brief glossary).

**Safekeeping (`/hive/safekeeping`)** — *new v3*
- Toggle at top: **Deposit** ↔ **Withdraw**
- **Deposit flow** (kid action):
  - "How much are you handing to Mama/Papa?" amount input
  - Shows resulting on-hand and on-deposit projection
  - CTA: "Submit deposit" → calls `requestCashDeposit`. Status shown as "Waiting for parent to confirm receipt of cash."
- **Withdraw flow** (parent-only — kids see this disabled with a hint to ask a parent):
  - Parent picks kid + amount.
  - CTA: "Withdraw" → calls `withdrawCashFromSafekeeping`. Instant.
- Recent safekeeping history at bottom (last 10 deposit/withdrawal events).

**Convert (`/hive/convert`)**
- Two stacked cards: FROM and TO
- Layer pickers (HP→Honey | Honey→Cash)
- Amount input with keypad
- Live rate pill ("100 HP = 1 🍯")
- Live preview of resulting balance
- CTA: "Convert now" (HP→Honey, instant) OR "Request cash-out" (Honey→Cash, creates approval)

**Cash In (`/hive/cash-in`)** — *updated v3*
- Summary tiles: This month, Avg/week, **% from business** (computed as `business_sale` cents ÷ all in cents)
- Ledger of `direction:"in"` cash transactions, with category chips. `business_sale` rows show a small "🌱 Business" pill and link to the originating Kaya Business sale.
- (No more Phase-3 placeholder — business income is real now via Kaya Business.)

**Cash Out (`/hive/cash-out`)** — *updated v3*
- Pending request cards at top (spend, business_cost, cash_deposit) — with Cancel button.
- Summary tiles: This month spent, Save rate, **Business reinvestment** (cents spent via `business_cost` category).
- Ledger of `direction:"out"` cash transactions; business costs visually grouped under a "🌱 Business" header.
- "Request a spend" CTA — if `cashOnHandCents < amount`, the modal shows: *"You don't have enough on hand. Withdraw from safekeeping first?"* with a deep-link to `/hive/safekeeping`.

**Goals (`/hive/goals`)**
- Each goal: icon, title, %, progress bar, current/target, ETA at current pace
- "+ Set a new goal" dashed card

**Insights (`/hive/insights`)**
- Earnings this week bar chart (last 7 days)
- Top earning quest card
- Spending by category donut/list
- "Tip from Kaya" card (gradient honey) — surface a behavioral nudge

**Parent · Rates (`/parent/rates`)**
- Two sliders / inputs: Lever A (HP → 🍯) and Lever B (🍯 → Cash)
- Live preview: "At these rates, 100 HP = $1.00"
- Save button → `setHiveRates`

**Parent · Approvals (`/parent/approvals`)** — *updated v3*
- List of pending `approvalRequests` across all kids — **all five types** in one queue: `cash_out`, `spend`, `business_sale`, `business_cost`, `cash_deposit_pending`.
- Each card: kid name, type pill (color-coded), amount, description, source/destination chip (e.g. "→ on deposit"), Approve / Reject buttons.
- For `business_sale`, parent can override `cashDestination` before approving (toggle on the card).
- For `cash_deposit_pending`, the action is "Confirm received" / "Reject" (parent confirms they got the physical cash).
- Reject opens a reason input.

**Parent · Hive Withdraw (`/parent/hive-withdraw`)** — *new v3*
- Pick kid + amount; calls `withdrawCashFromSafekeeping`.
- Shows current on-deposit balance per kid.
- Used when handing physical cash back to a kid.

---

## 7. DESIGN TOKENS (use these exactly)

```css
--honey: #F39C2F        /* primary brand */
--honey-dk: #D17F1A
--honey-soft: #FCD9A0
--navy: #1F2D3D         /* primary text */
--ink: #0F1822          /* deep contrast */
--cream: #FFF8EC        /* page bg */
--paper: #FFFFFF
--muted: #5C6975
--line: #E8DEC9
--green: #3FAF6C        /* cash / positive */
--rose: #E36F6F         /* spend / negative */
--blue: #3F7AAF         /* HP layer accent */
```

Fonts: **Nunito** (display, weights 700/800/900) + **Lato** (body, 400/700).

Border radii: cards `18–24px`, balance pills `999px`, buttons `14–18px`. Use generous padding. Prefer single-column layouts on mobile; two-column on tablet.

---

## 8. COMPONENT INVENTORY (build these reusable pieces)

```
src/components/hive/
  BalanceCard.tsx              // layer-aware (HP / Honey / Cash); Cash variant renders the on-hand/deposit split (v3)
  CashSplitRow.tsx             // sub-row inside the Cash BalanceCard (v3)
  HoneyPotHero.tsx             // big gradient card with pot icon
  TransactionRow.tsx           // in / out variants; renders category pill incl. business_sale / business_cost / cash_deposit / cash_withdrawal (v3)
  TransactionList.tsx
  GoalCard.tsx
  GoalProgressBar.tsx
  ConvertCard.tsx              // used in /convert; cash side picks destination (v3)
  AmountKeypad.tsx
  ApprovalRequestCard.tsx      // parent inbox; handles all five request types incl. destination toggle (v3)
  PendingRequestBanner.tsx     // shown to kids
  SafekeepingPanel.tsx         // deposit/withdraw flow (v3)
  WhatsThisCard.tsx            // collapsible kid-friendly definition card (v3 — used on Wallet, etc.)
  RatePill.tsx
  HiveTabBar.tsx
  InsightCard.tsx
  WeeklyBarChart.tsx           // simple SVG bars, no library
  CategoryDonut.tsx
```

---

## 9. STATE MANAGEMENT

- Add `HiveContext` (sibling of `FamilyContext`) — provides current kid's wallet, recent transactions, pending requests via Firestore listeners.
- Memoize derived values: `totalNetWorthCents`, `saveRate`, `weeklyEarnings`.
- All write paths go through callable Cloud Functions (never direct client writes to wallet).

---

## 10. DATA SEEDING (for local dev)

Create `scripts/seed-hive.ts` that, given a kid ID:
- Sets `hiveConfig` defaults (currency: "TZS" for Timotheo seed; sale-approval threshold: 5000 cents = TSh 50)
- Initializes wallet with HP=1240, Honey=85, **cashOnHand=3000 cents, cashOnDeposit=1250 cents** (v3 split)
- Creates ~12 sample transactions covering: chore HP-in, convert, allowance, **business_sale** (with cashDestination=on_hand and cashDestination=on_deposit examples), **business_cost** debit, **cash_deposit** pair (on_hand→on_deposit), spend
- Creates 2 active goals (bike 62%, headphones 28%)
- Creates 1 pending `cash_out` request and 1 pending `business_sale` request

---

## 11. ACCEPTANCE CRITERIA

The build is done when:

1. A kid logged in can see their Wallet with all balances pulling live from Firestore. **Cash card shows Total + On Hand + On Deposit.**
2. A kid can convert HP → Honey instantly; balances update atomically.
3. A kid can request a Honey → Cash conversion with chosen `cashDestination`; it appears in the parent's approval inbox; balances do not change until approved. On approval the chosen sub-balance is credited.
4. A parent can approve/reject any of the five request types from one queue; balances update atomically on approve.
5. A parent can deposit cash manually with a category and `cashDestination` (allowance / gift / business / other).
6. A kid can request a cash spend; parent approves; cash deducts from `cashOnHandCents`. **If on-hand insufficient, the kid is prompted to withdraw from safekeeping first (no silent fall-through to deposit).**
7. **A kid can submit a Cash Deposit (hand cash to parent); parent confirms; on-hand ↓ and on-deposit ↑ atomically with paired transactions. (NEW v3)**
8. **A parent can withdraw cash from a kid's safekeeping; on-deposit ↓ and on-hand ↑ atomically with paired transactions. (NEW v3)**
9. **A Kaya Business sale request flowing through `requestBusinessSale` correctly auto-approves under threshold OR creates a pending request; on resolution, the Hive `business_sale` tx is written with the correct `cashDestination` and `ventureSaleId` back-reference. (NEW v3)**
10. **A Kaya Business cost request via `requestBusinessCost` debits `cashOnHandCents` (after threshold/approval) and writes `business_cost` tx with `ventureCostId` back-reference. (NEW v3)**
11. A parent can set rates A and B AND the new sale-approval threshold; conversions and sales thereafter use the new rates / threshold.
12. The Insights screen shows current-week bar chart, save rate, and the new Business reinvestment tile.
13. All routes are mobile-first and faithful to the design mockups.
14. Firestore rules block kids from writing wallet directly. Helper role still cannot touch the Hive.
15. **The migration callable `migrateWalletsToCashSplit` runs idempotently and correctly backfills any pre-v3 wallet doc. (NEW v3)**
16. **All UI currency renders use `hiveConfig.currency`, never a hard-coded "$". (NEW v3)**

---

## 12. WHAT NOT TO BUILD YET (Phase 2 / 3 — defer)

- Real cash rails (Stripe, M-Pesa, Tigo Pesa) — leave hooks but no integration.
- ~~Business income module — show as greyed-out card only.~~ **Now in scope as a separate Kaya Business module — see `Kaya-Business_Project_Briefing_2026-05-13.md` and the upcoming `Kaya-Business_Code-Prompt_2026-05-13.md`. Hive's job here is only to expose the `requestBusinessSale` / `requestBusinessCost` Cloud Functions and route the resulting credits/debits through the cash-split wallet.**
- Global-profile USD translation of family-currency balances — hook the FX layer in v2.
- Per-kid report-privacy override (kids choosing to hide reports from siblings) — defer.
- Donation partners — single category for now.
- Notifications (email / push) — log only; in-app only for v1.

---

## 13. KICKOFF INSTRUCTION TO THE CODE AGENT

> Read `Kaya_Project_Briefing_2026-04-25.md`, `Kaya-Hive_Design-Proposal-v3_2026-05-13.html`, and `Kaya-Business_Project_Briefing_2026-05-13.md` in the repo root for context. Then implement section by section in this order: (1) Firestore schema + rules **including v3 cash split**, (2) Cloud Functions **including v3 safekeeping + business plumbing**, (3) `HiveContext` **with derived `cashTotalCents`**, (4) shared components **including `CashSplitRow`, `SafekeepingPanel`, `WhatsThisCard`**, (5) Wallet route, (6) Safekeeping route, (7) Convert route, (8) Cash In / Cash Out, (9) Goals, (10) Insights, (11) Parent Rates + Approvals + Hive Withdraw, (12) seed script, (13) `migrateWalletsToCashSplit` callable. After each section, run `pnpm build` and confirm no type errors before continuing. Open a single PR titled `feat(hive): v3 — cash split + business plumbing`.

---

*End of prompt. Project: Kaya · Module: The Hive · Original date: 2026-05-07 · Updated: 2026-05-13 (v3) · Author: Elia.*
