# Kaya · Business — Project Briefing
*Saved 2026-05-13 — scopes Phase 2 "Business Mode" from the original Kaya briefing (2026-04-25). Updated 2026-05-13 with v1 module spec.*

## TL;DR
**Kaya Business** is the Kaya sub-product that lets each kid run a real micro-business — track what they own, what they sell, what it costs, and what they earn. **One business per kid**, with a flat collection of Assets (passion fruit vines, hens, baking goods, anything). Five kid screens, one Parent Console. Sales credit the kid's Hive Wallet (Cash, split into *on hand* vs *deposit*). Costs come either from a parent-funded **float** or from the kid's wallet. **Sunday auto-generated Weekly Report** is visible to siblings. Every screen carries kid-friendly definitions ("What is the Hive?", "What is an Asset?") so kids learn the vocabulary as they use it.

## Why "Business"
- **Plain and direct.** Kids and parents both know what it means immediately — no translation gap with visiting friends or future global users.
- **Venture-agnostic.** Doesn't lock the brand to gardens/farms — kids will invent businesses we can't predict.
- **Matches existing sub-product naming pattern:** Kaya-Hive, Kaya-PiggyBank, Kaya-Business — the parent brand "Kaya" carries the Swahili soul; sub-products use functional English.

## How it Fits the Existing Kaya Stack

| Module | Owns | Kaya Business's relationship |
|---|---|---|
| **Kaya core** | Chores, routines, ratings, meetings, House Points (L1) | Care reminders register here as routines — kid earns HP for doing them. |
| **The Hive** | 3-layer wallet: HP → Honey Coins → Cash (L1/L2/L3); Cash is split into *on hand* vs *deposit* | All Kaya Business revenue/expense moves Cash. Business never creates its own money. |
| ~~PiggyBank~~ | *Superseded by Hive (decision 2026-05-13).* | n/a — Hive is the single source of truth for kid money. |
| **Kaya Business (new)** | One business per kid: assets, sales, costs, care reminders, weekly P&L. | This brief. |

Principle: **Kaya Business is the operations layer. Hive is the money layer.** Business never bypasses Hive's parent-approval rules for cash movement.

---

## v1 Module Spec (locked 2026-05-13)

### Five Kid Screens

#### 1. **My Business** — dashboard
The home screen. At a glance:
- **Total asset value** — live count × unit price across all assets
- **This week's revenue** — sales total
- **This week's costs** — expenses total
- **This week's profit** — revenue − costs
- **Pending care tasks** — what the kid still needs to do today/this week
- **Float balance** (if parent has funded one)

#### 2. **My Assets** — inventory
List of everything the kid owns. Each asset row:
- **Name** (e.g., "Passion fruit vines", "Layer hens")
- **Count** (12 vines, 6 hens)
- **Stage** (seedling / growing / fruiting · chick / pullet / laying · etc. — stage-set varies by asset type)
- **Unit price** — current value of one of these in this stage
- **Live valuation** = count × unit price

Add asset / edit count / change stage / retire asset (death of an animal, end of plant life) all live here.

#### 3. **Sales** — quick log
Two paths:
- **Family sales** (to anyone on the household roster — Mama, Papa, siblings, helpers Mage & Jacky) → buyer + item dropdowns auto-pulled from the **Family Price List**. One tap to log; price is fixed.
- **Relative / external sales** (extended family, neighbors, school friends, anyone not on the roster) → free entry of buyer name, item, quantity, price. **The price field is auto-suggested from the Family Price List** as a starting point — kid can edit up or down per transaction (Aunt Ruth gets a discount, the neighbor pays a premium).

All sales credit the kid's Hive Cash — split into *on hand* or *deposit* per the kid's choice (parent can override on approval). **Parent approval required by default** unless the sale is under the family's auto-approve threshold.

#### 4. **Costs** — expense log
Items: feed, fertilizer, seedlings, packaging, tools, other. Two funding sources:
- **Parent-funded float** — parent pre-loads a working-capital pool for the kid's business. Costs draw down the float. Once empty, kid must request a top-up.
- **Kid's wallet** — costs deducted directly from the kid's Hive Cash (on-hand). Useful when the kid wants to invest their own earnings back into the business.

Kid picks the source per cost. Parent approval required for costs above the family's spend-approval threshold (mirrors Hive's spend rules).

#### 5. **Weekly Report** — Sunday auto-generated P&L
Generated every Sunday for the prior week (Mon–Sun). Per kid:
- **Revenue, costs, profit**
- **Top wins** (best-selling item, biggest single sale, asset stage advances)
- **Next week's reminders** (upcoming care tasks, low-stock alerts, asset stages about to change)
- **Visible to siblings** — the three kids see each other's reports. Healthy competition + shared family rhythm. (Privacy note: this is a deliberate design choice, not an oversight.)

### One Parent Console
Lives inside the existing Kaya parent dashboard. Three responsibilities:

1. **Set / edit the Family Price List** — canonical prices for items kids sell within the household.
2. **Approve transactions above threshold** — pending sales (above auto-approve) and costs (above spend-approval). One queue, one tap each.
3. **Side-by-side books** — all three kids' P&Ls and asset values on one screen. Inputs to the Sunday family meeting.

### Care Reminders
Each asset type ships with a **default care schedule**. When a kid adds an asset, the schedule is created automatically as Hive routines that earn House Points on completion.

| Asset type | Default care schedule |
|---|---|
| Passion fruit | Water 3×/week · fertilize monthly · prune quarterly |
| Chickens (laying hens) | Feed daily · refresh water daily · clean coop weekly · health check monthly |
| Vegetable garden | Water daily · weed weekly · fertilize monthly |
| Goats | Feed 2×/day · water daily · deworm quarterly |
| Bakery / kitchen products | Restock ingredients weekly · clean station daily |
| *Other / custom* | Kid + parent define together |

Reminders surface in two places: **My Business** (pending care tasks card) and the existing Kaya core routines view. Completing one earns HP via Hive's existing routine engine — Kaya Business never awards HP directly.

---

## Kid-Friendly Definitions

Each screen shows a small **"What's this?"** card with the relevant definition. Kids tap to expand. Copy is short, warm, and uses concrete examples from the Timotheo family.

| Term | Kid-friendly definition |
|---|---|
| **My Business** | Your very own little company — the things you grow or make, the people you sell to, and the money you earn. |
| **Asset** | Something you own that helps you make money. Diella's passion fruit vines are her assets. Earlnathan's hens are his assets. |
| **Stage** | Where your asset is in its life. A passion fruit vine starts as a *seedling*, then *grows*, then *fruits*. A chick becomes a *pullet*, then a *laying hen*. The stage tells you what to expect. |
| **Unit Price** | How much *one* of your assets is worth right now. One laying hen is worth more than one chick because she lays eggs you can sell. |
| **Live Valuation** | The total worth of all your assets. Count × Unit Price. If you sold everything today, this is roughly what you'd get. |
| **Sale** | When you give something you made or grew to someone in exchange for money. |
| **Family Sale** | A sale to someone in our house — Mama, Papa, sister, brother, Mage, Jacky. The price is already set in the Family Price List. |
| **Relative Sale** | A sale to someone outside our house — Aunt Ruth, a neighbor, a friend at school. You decide the price together. |
| **Cost** | Money you spend to keep your business going — feed for hens, fertilizer for vines, sugar for cookies. |
| **Float** | Money Mama or Papa puts into your business to help you get started, so you don't have to use your own savings. You spend from the float; when it runs out, you ask for more. |
| **Profit** | What's left after you take your costs out of your sales. *Profit = Sales − Costs.* If costs are bigger than sales, that's a *loss* — and that's okay; it teaches us to plan better. |
| **The Hive** | Your money home inside Kaya. It holds three things: House Points (HP), Honey Coins, and Cash. Your business sales land in your Hive Cash. |
| **Cash on Hand** | The real money you carry — in your pocket or your own piggy bank. You can spend it. |
| **Deposit** | Money you've handed to Mama or Papa to keep safe. You can't spend it directly — you have to ask to take some out first. (This is how grown-up bank accounts work.) |
| **Care Reminder** | A small job your asset needs to stay healthy — watering, feeding, cleaning. Doing them earns you House Points. Skipping them can hurt your business. |
| **Weekly Report** | A summary every Sunday of how your business did. Did you make money? What sold best? What do you need to do next week? |

These definitions live in two places:
1. **In the brief** (above) — for designers and developers writing UI copy.
2. **In the app** — as collapsible "What's this?" cards on each screen header.

---

## Family Price List

A small per-family catalog of items kids commonly sell, with a parent-set canonical price.

```
families/{familyId}/priceList/{itemId}
  itemName: string                     // "Eggs (dozen)", "Passion fruit (kg)", "Chocolate cookie"
  unit: string                         // "dozen", "kg", "piece"
  unitPriceCents: integer              // canonical family-internal price
  sellerKidId: string                  // optional — restrict this item to one kid's catalog
  active: bool
  updatedAt: Timestamp
```

How it's used:
- On **Sales → Family sale**, the buyer picks an item from the list; price auto-fills and is locked.
- On **Sales → Relative / external sale**, the same item dropdown is offered and the price is **auto-suggested as a starting point**, but the kid can edit it for that one sale (custom pricing for outsiders).
- Parents update prices seasonally (cost of feed went up → eggs go up).

Why it matters: removes friction for the most common case (90% of early sales are inside the family), teaches kids that *prices are set, not invented per transaction*, AND gives them a sensible default when they negotiate with outsiders.

---

## Currency Handling

- **Family-configurable, never hard-coded.** Each family picks their currency in Hive (default for the Timotheo family: TZS — Tanzanian Shilling). All amounts stored in integer minor units (cents / *senti*) per the family's currency setting.
- **No multi-currency inside a family** in v1. One family = one currency for all money.
- **Future-state (deferred to v2):** an optional "global profile" view that translates a kid's headline numbers into USD using a near-real-time FX rate, for the eventual case where families compare or share business stories across countries. v1 stores native amounts only; the translation is a presentation layer added later.
- **UI rule:** never show "$" hard-coded. Always render the family's currency symbol/code (TSh, $, €, ₹, …).

---

## Cost Float (parent pre-funding)

Each kid's business has an optional **float** — a working-capital pool the parent pre-loads.

```
families/{familyId}/kids/{kidId}/business (singleton)
  floatBalanceCents: integer           // 0 if not used
  floatTopUpHistory: [{ amountCents, atTimestamp, byParentId }]
  floatLifetimeFundedCents: integer
  costFundingDefault: "float" | "wallet"   // which source kid's "Add Cost" defaults to
```

Behavior:
- Parent can fund / top up the float from their own action (does not affect kid's Hive wallet).
- When the kid logs a cost, they pick the funding source: **Float** or **My Wallet**.
- If float source is chosen but float is empty, the cost is held as `pending_topup` — it doesn't silently fall through to the kid's wallet.
- The float is *separate* from the kid's Hive Cash. It never appears in Hive balances. It belongs to the business, not the kid.

This teaches a real concept: **businesses use working capital that isn't your personal money.**

---

## Asset Lifecycle (loss, retirement, transfer)

Real businesses lose assets — a hen dies, a vine fails, a batch of cookies spoils. The model handles this honestly so weekly P&L stays accurate.

| Event | What the kid does | What happens |
|---|---|---|
| **Asset count drops** (1 of 6 hens dies) | Edit count from 6 → 5; pick reason: *died* / *lost* / *given away* / *consumed at home* | Logged as a `loss` event on the asset. Live valuation drops. Counted as a non-cash *cost* on the weekly report so profit reflects reality. |
| **Stage advance** (chick → pullet → laying) | Tap stage selector | `unitPriceCents` auto-updates to the new stage's default (parent-editable). Stage advance becomes a *Top win* on the weekly report. |
| **Stage regression** (laying hen stops laying due to age/illness) | Tap stage selector to a "retired" stage | Asset stays in the inventory at lower valuation; no longer counted in production projections. |
| **Full retirement** (entire asset type wound down — kid pivots) | Mark asset `retired` | Removed from active dashboard; preserved in history for archive views. |
| **Transfer between siblings** (Earlnathan gifts a hen to Daniella) | Parent-mediated action in the Parent Console | Decrements one kid's asset count, increments the other's. Logged on both sides. v1: keep simple — no internal "purchase" between kids. |

Why this matters: profit numbers should reflect real-world losses, not pretend everything is forever. A kid whose 2 of 6 hens died this month should *see* that in their P&L and learn from it.

---

## Domain Model (Firestore sketch)

```
families/{familyId}/priceList/{itemId}
  ...as above

families/{familyId}/kids/{kidId}/business (singleton, id = "config")
  active: bool
  createdAt, updatedAt: Timestamp
  emoji: string                        // optional decoration
  tagline: string                      // kid-written, e.g., "Diella's Garden Magic"
  floatBalanceCents: integer
  floatLifetimeFundedCents: integer
  costFundingDefault: "float" | "wallet"
  saleAutoApproveUnderCents: integer   // mirrors Hive's spend-approve threshold pattern
  defaultSaleCashDestination: "on_hand" | "on_deposit"

families/{familyId}/kids/{kidId}/assets/{assetId}
  type: string                         // "passion_fruit" | "laying_hen" | "veg_garden" | "goat" | "bakery_product" | "custom"
  name: string                         // human label, e.g., "Front-yard vines"
  count: number
  stage: string                        // type-specific: "seedling" | "growing" | "fruiting" · "chick" | "pullet" | "laying" | "retired"
  unitPriceCents: integer              // current per-unit valuation at this stage
  liveValuationCents: integer          // computed on read: count × unitPriceCents
  notes: string
  retiredAt: Timestamp                 // null while active
  updatedAt: Timestamp

families/{familyId}/kids/{kidId}/assets/{assetId}/lossEvents/{lossId}
  occurredAt: Timestamp
  countLost: integer                   // 1 hen died, 3 vines failed
  reason: "died" | "lost" | "given_away" | "consumed_at_home" | "spoiled" | "other"
  notes: string
  estValueLostCents: integer           // for weekly P&L non-cash cost line
  loggedByKidId: string

families/{familyId}/kids/{kidId}/sales/{saleId}
  saleDate: Timestamp
  saleType: "family" | "relative"
  buyerName: string                    // family roster member OR free-text for relative
  buyerKidIdOrUserId: string           // set if buyer is in the household
  items: [{ priceListItemId?, itemName, quantity, unit, unitPriceCents }]
  totalCents: integer
  cashDestination: "on_hand" | "on_deposit"
  status: "pending_approval" | "auto_approved" | "approved" | "rejected"
  autoApprovedReason: string           // e.g., "under family threshold of 5000 TZS"
  hiveTxId: string                     // back-reference to Hive credit
  approvedByParentId: string
  createdAt: Timestamp

families/{familyId}/kids/{kidId}/costs/{costId}
  costDate: Timestamp
  category: "feed" | "seed" | "fertilizer" | "packaging" | "tools" | "other"
  description: string
  amountCents: integer
  fundingSource: "float" | "wallet"
  status: "pending_approval" | "approved" | "pending_topup"
  hiveTxId: string                     // present only when fundingSource = "wallet"
  approvedByParentId: string
  createdAt: Timestamp

families/{familyId}/kids/{kidId}/careTasks/{taskId}
  assetType: string                    // "passion_fruit", "laying_hen", ...
  assetId: string                      // back-ref to specific asset
  title: string                        // "Water vines", "Feed hens AM"
  frequency: "daily" | "weekly" | "monthly" | "custom"
  customCron: string                   // optional
  hpReward: number                     // earned via Hive routine on completion
  routineId: string                    // back-reference into core Kaya routine engine
  active: bool
  lastDoneAt: Timestamp
  nextDueAt: Timestamp

families/{familyId}/kids/{kidId}/reports/{weekIso}
  weekStart, weekEnd: Timestamp
  revenueCents: integer
  costsCents: integer
  profitCents: integer
  topWins: [{ kind: "best_seller"|"biggest_sale"|"stage_advance", description, valueCents? }]
  nextWeekReminders: [{ kind: "care_due"|"low_stock"|"stage_change", description, dueDate }]
  inventorySnapshot: [{ assetType, count, stage, liveValuationCents }]
  visibleToSiblings: bool              // default true
  generatedAt: Timestamp
```

---

## Wiring (data + control flow)

```
                  ┌─────────────────────────┐
                  │   Kaya Business         │
                  │  (operations layer)     │
                  └──────────┬──────────────┘
                             │
       ┌────────────────┬────┴───────────┬──────────────────┐
       │                │                │                  │
       ▼                ▼                ▼                  ▼
 careTask done    sale approved   cost from wallet    cost from float
       │          (or auto under         │                  │
       │           threshold)            │                  │
       ▼                ▼                ▼                  ▼
  Hive routine    Hive Cash credit  Hive Cash debit   Float balance −=
  → HP credited   → on_hand OR     → on_hand          (no Hive tx;
                    on_deposit       (must withdraw    parent funds the
                                     from deposit if   float separately)
                                     insufficient)
       │                │                │                  │
       └─── all sales/wallet costs reflected in Hive Wallet view ───┘
                                                            │
                                                Float balance shown
                                                on My Business dashboard
                                                (separate from Hive)
```

**Key invariants**
- Kaya Business never writes to a kid's Hive wallet directly. It creates a *request* (sale, wallet-cost) and Hive's existing approval flow does the actual ledger move.
- Float spending is internal to Business — it does not touch Hive.
- Care task completions write to the existing routines collection — Business's `careTasks` doc just owns the schedule + back-reference.
- All money values stored as integer cents. Currency is family-scoped via Hive's `currency` setting.
- **Sales always require parent approval** unless under the family's `saleAutoApproveUnderCents` threshold. Mirrors `spendRequiresApproval` exactly so parents have one mental model.
- Weekly reports generate Sunday 21:00 family-local time (matches Kaya's existing meeting cadence). Sibling visibility default = true.

---

## Hive Schema Changes Required (upstream of Business)

These changes must land in Hive **before** Kaya Business ships, but they stand on their own and should be applied to Hive even without Business. They affect the existing Hive code prompt, design proposal, and any code already shipped.

**1. Wallet split**
```diff
families/{familyId}/kids/{kidId}/wallet (singleton, id = "balances")
  housePoints: number
  honeyCoins: number
- cashCents: integer
+ cashOnHandCents: integer
+ cashOnDepositCents: integer
+ // cashTotalCents is computed on read: onHand + onDeposit (do not store)
  totalLifetimeEarnedCents: integer
  totalLifetimeSpentCents: integer
  updatedAt: Timestamp
```

**2. New transaction types** (add to existing `hiveTransactions` enum)
- `cash_deposit` — kid hands physical cash to parent. `onHand` ↓, `onDeposit` ↑. Logged by kid, confirmed by parent.
- `cash_withdrawal` — parent gives physical cash to kid. `onDeposit` ↓, `onHand` ↑. Parent action.
- `business_sale_credit` — credit from a Kaya Business sale. Direction (`onHand` vs `onDeposit`) carried in tx.
- `business_cost_debit` — debit for a Kaya Business cost paid from kid's wallet. Always from `onHand`; if insufficient, parent must withdraw from deposit first.

**3. New Hive config keys**
```
hiveConfig:
  ...existing...
  saleRequiresApproval: bool                 // default true (mirrors spendRequiresApproval)
  saleAutoApproveUnderCents: integer         // default 0 (always require). Per-family.
  defaultSaleDestination: "on_hand" | "on_deposit"   // default "on_hand"
  largeSaleThresholdCents: integer           // sales above this default to "on_deposit" in the UI
```

**4. UI changes to existing Hive Wallet screen**
- Replace single "Cash" number with **Cash Total** + a two-row breakdown: *On Hand* / *On Deposit*.
- Add **Deposit** and **Withdraw** actions on the wallet screen.
- Approvals queue gets the new tx types.

**5. Migration for any existing wallets**
Set `cashOnHandCents = existing cashCents` and `cashOnDepositCents = 0`. One-time backfill. Safe default — kids start with everything on-hand.

---

## Weekly Report — sample shape

> **Diella's Business — Week of 11–17 May 2026**
> 💰 **Revenue:** 18,000 TZS
> 🧾 **Costs:** 4,000 TZS
> ✅ **Profit:** +14,000 TZS
>
> 🌟 **Top wins**
> - Best-seller: passion fruit (kg) — 6 kg sold to Mama and Aunt Ruth
> - Biggest sale: 9,000 TZS to Aunt Ruth on Saturday
> - 2 vines advanced from *growing* to *fruiting*
>
> 📅 **Next week's reminders**
> - Water vines Mon, Wed, Fri (don't miss like last week)
> - Fertilizer running low — top up by Wednesday
> - 3 more vines about to fruit — log the stage change when they do
>
> 👀 *Earlnathan and Daniella can see this report.*

Parent Console roll-up: same three kids stacked; same week; one approvals tap-strip at the top.

---

## Resolved decisions (locked 2026-05-13)
1. ✅ **Name** — Kaya Business.
2. ✅ **PiggyBank vs Hive** — Hive supersedes PiggyBank; single source of truth for kid money.
3. ✅ **Sale approvals** — parent-approved by default with per-kid auto-approve threshold; same pattern regardless of cash destination (on-hand or deposit).
4. ✅ **Cash on hand vs deposit** — Hive Cash split into the two sub-balances; spending always debits on-hand.
5. ✅ **Module shape (v1)** — five kid screens + one Parent Console; one business per kid; flat asset list (not nested ventures).
6. ✅ **Family Price List** — parent-maintained; locks price for family sales; auto-suggests price for relative sales (kid can edit).
7. ✅ **Cost float** — optional parent-pre-funded working capital, separate from kid's Hive wallet. Empty float = `pending_topup`, never silently falls through to wallet.
8. ✅ **Sibling-visible weekly reports** — Sunday auto-generated.
9. ✅ **Care reminder defaults** — per-asset-type templates auto-create Hive routines.
10. ✅ **Kid-friendly definitions** in-app on every screen.
11. ✅ **Currency** — family-configured via Hive setting (TZS for Timotheo). Never hard-coded. v2 will optionally translate to USD for a "global profile" view.
12. ✅ **Asset lifecycle** — loss / stage advance / stage regression / retirement / parent-mediated transfer all modeled. Losses count as non-cash costs in weekly P&L.
13. ✅ **Care reminder delivery (v1)** — in-app only, surfaced via the existing Kaya notifications module. Push / WhatsApp deferred to v2.
14. ✅ **Photo evidence** — deferred to v2. Keeps v1 input flow one-tap simple.
15. ✅ **Asset-type library** — v1 ships with 5 built-in types (passion fruit, laying hens, veg garden, goats, bakery products) + a `custom` type families can use immediately. Type definitions are family-scoped, editable by parents.
16. ✅ **Float top-up flow** — silent on the parent side (no kid acknowledgement). Kid sees the new float balance reflected on the My Business dashboard with a small "+5,000 TSh added by Mama" toast.
17. ✅ **Report privacy override** — v1 default is sibling-visible across the board; per-report private toggle deferred to v2 (no signal yet that kids want to hide reports — revisit after pilot).

**The brief is feature-complete for v1.** All idea-level decisions are locked; remaining detail (specific UI copy, empty states, exact spacing) belongs in the design phase.

## Next steps (priority order)
1. **Apply *Hive Schema Changes Required*** to the existing [Kaya-Hive_Code-Prompt_2026-05-07.md](Kaya-Hive_Code-Prompt_2026-05-07.md) and the Hive design proposal HTML — *prerequisite for Business and stands on its own merit.*
2. **Produce Kaya Business HTML design proposal** (`Kaya-Business_Design-Proposal_2026-05-13.html`) — the five kid screens, the Parent Console, the inline "What's this?" definitions, all matching Hive's visual style. (This is the artifact you said you want to see next.)
3. **Produce Kaya Business code-generation prompt** (`Kaya-Business_Code-Prompt_2026-05-13.md`) — Hive-style structure, ready for Claude Code / Cursor / v0.
4. **Pilot one asset per kid** (Diella's passion fruit, Earlnathan's hens, Daniella's TBD) — start small, see what's missing in real use before opening up the full library.

---

## Important context
- Original briefing (2026-04-25) flagged Business Mode as: *"kids manage real micro-enterprises (orchard, chickens, passion fruits) to learn money skills"* and noted *"Business Mode should teach genuine entrepreneurship, not gamified play money."* Kaya Business honors that: real assets, real money flows through Hive, real parent approval, real weekly P&L.
- Tone for the brand: warm, family, global; avoid Americana-coded language. UI copy follows.
- Family roster (Dar es Salaam): Earlnathan (Golden), Diella (White), Daniella (Silver); helpers Mage and Jacky.
- Why kid-friendly definitions on every screen: the product *teaches the vocabulary of business* by using it. Asset, profit, deposit, float, valuation — these are real grown-up words, and kids should learn them in context, not avoid them.
