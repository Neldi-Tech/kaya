# Kaya · Business — Code Generation Prompt

> **Use this prompt in Cursor / v0 / Claude Code.** Paste the entire file as the first message, with the existing `etimotheo1/kaya` repo open. The agent will scaffold the Kaya Business module on top of the existing Next.js + Firebase app, alongside Kaya core and The Hive (v3).

> **Prerequisite:** [Kaya-Hive_Code-Prompt_2026-05-07.md](Kaya-Hive_Code-Prompt_2026-05-07.md) **v3** must be applied first. Kaya Business depends on Hive v3's cash split (`cashOnHandCents` + `cashOnDepositCents`) and the new Cloud Functions (`requestBusinessSale`, `requestBusinessCost`, `withdrawCashFromSafekeeping`).

> **Companion documents (read these first):**
> - [Kaya-Business_Project_Briefing_2026-05-13.md](Kaya-Business_Project_Briefing_2026-05-13.md) — the locked v1 spec, all 17 resolved decisions.
> - [Kaya-Business_Design-Proposal_2026-05-13.html](Kaya-Business_Design-Proposal_2026-05-13.html) — the visual proposal: 5 kid screens (mobile) + Parent Console (web) + Cost Float (web) + Asset Library + glossary + wiring diagram.

---

## 1. CONTEXT (read before generating)

You are extending an existing app called **Kaya** — a family house-points system for kids.

**Stack already in place:**
- Next.js 14 App Router
- Tailwind CSS
- Firebase Auth + Firestore + Cloud Functions
- Existing contexts: `AuthContext`, `FamilyContext`, `HiveContext` (after v3)
- Existing data layer: `src/lib/firestore.ts`
- Existing security rules at `firestore.rules` (family-scoped, role-based: `parent` / `helper` / `kid`)
- Domain: `ourkaya.com` (live)
- Firebase project: `kaya-app-b9463`

**Existing routes (do not duplicate):** dashboard, rate, award, profiles, kid, helper, meetings, badges, rewards, reports, notifications, settings, login, onboarding, hive/* (full Hive v3 module), parent/rates, parent/approvals, parent/hive-deposit, parent/hive-withdraw.

**You are adding a new module called Kaya Business** — a kids' micro-business module that:
- Lets each kid run **one business** (flat list of assets — not nested ventures).
- Tracks assets, sales, costs, care reminders, and a Sunday auto-generated weekly P&L.
- **Routes all money flows through Hive v3** — never writes to a kid's wallet directly.
- Ships a **mobile-first kid view (5 screens)** and a **web-first Parent Console (6 routes)**.
- Carries kid-friendly inline definitions ("What's this?") on every screen.

**You will NOT build:** PiggyBank (superseded by Hive); separate production-event log (sales are direct); photo evidence (v2); push/WhatsApp (v2); joint ventures (v2); inter-venture trade (v3); mobile-money rails (v3); per-report privacy override (v2); tax/profit-sharing (v3+).

---

## 2. THE BUSINESS MODEL (core domain)

**Principle:** Kaya Business is the **operations layer**. The Hive is the **money layer**. Business creates approval *requests*; Hive's existing flow does the actual ledger move. Float-funded costs are the only money flow that stays *inside* Business.

**One business per kid.** Each kid's business is a singleton with:
- An optional parent-funded **float** (working capital, separate from kid's Hive Cash).
- A flat collection of **Assets** (vines, hens, plants, animals, kitchen products, custom).
- A log of **Sales** (family / relative).
- A log of **Costs** (float-funded / wallet-funded).
- A schedule of **Care Tasks** (auto-mapped to Hive routines for HP rewards).
- An archive of weekly **Reports** (auto-generated Sunday 21:00 family-local).

**Asset model:** each asset has `count`, `stage` (type-specific: seedling/growing/fruiting · chick/pullet/laying/retired · …), and `unitPriceCents`. Live valuation = count × unit price. Loss events (death, spoilage, give-away) are first-class — they decrement count, write a `lossEvents` doc, and surface in the weekly P&L as **non-cash costs**.

**Sales:** two paths.
- **Family sale** — buyer is on the household roster (Mama, Papa, siblings, helpers Mage & Jacky). Item + price come from the **Family Price List**. Price is **locked**. One-tap log.
- **Relative sale** — buyer is anyone outside the roster (Aunt Ruth, neighbors, school friends). Free-entry buyer name. Price is **auto-suggested** from the Family Price List as a starting point and is **editable** for that one sale.
- Both paths produce a `cashDestination` choice (👛 On Hand / 🏦 On Deposit). UI defaults: small sales → on hand, sales above `largeSaleThresholdCents` → on deposit (parent can override on approval).
- Both paths require parent approval **unless** the sale is under the family's `saleAutoApproveUnderCents` threshold (mirrors Hive's `spendRequiresApproval` exactly).

**Costs:** two funding sources.
- **Float** — parent-funded working capital. Decrements `floatBalanceCents` on the business singleton. **Never touches Hive.**
- **Wallet** — debits the kid's Hive Cash (always from `cashOnHandCents`; if insufficient, the cost is held and the kid is prompted to withdraw from safekeeping first). Goes through Hive's `requestBusinessCost` — same approval rules as `spend`.
- If float is chosen but float is empty, the cost is held with `status = "pending_topup"`. **It does NOT silently fall through to the kid's wallet.**

**Care reminders:** each asset type ships with a default schedule (passion fruit: water 3×/week + fertilize monthly + prune quarterly · hens: feed daily + water daily + clean coop weekly + health check monthly · etc.). When a kid adds an asset, `setupCareSchedule` creates `careTasks` docs **and** corresponding entries in the existing Kaya core routines collection so kids earn HP for completion. Completion is recorded by Kaya core; Business reads it via `routineId` back-reference.

**Weekly Report:** `generateWeeklyReport` runs Sunday 21:00 family-local. One report per kid. Per-report `visibleToSiblings` defaults to `true` (siblings see each other's reports — deliberate design choice for healthy competition).

**Currency:** family-configured via `hiveConfig.currency`. **Never hard-code "$".** All Business money values are integer minor units (cents / *senti*) using the family's currency.

---

## 3. FIRESTORE SCHEMA (add to existing rules)

```
families/{familyId}/priceList/{itemId}
  itemName: string                     // "Eggs (dozen)", "Passion fruit (kg)"
  unit: string                         // "dozen", "kg", "piece", "bunch"
  unitPriceCents: integer              // canonical family-internal price
  sellerKidId: string                  // optional — restrict to one kid's catalog
  emoji: string                        // optional decoration
  active: bool
  createdAt, updatedAt: Timestamp
  createdBy: string                    // userId of parent

families/{familyId}/businessAssetTypes/{typeId}
  // Asset library — ships with 5 built-in types + family-scoped custom types
  builtin: bool                        // true for the 5 v1 types
  key: string                          // "passion_fruit" | "laying_hen" | "veg_garden" | "goat" | "bakery_product" | <custom-slug>
  name: string                         // human label
  emoji: string
  stages: [{ key, label, defaultUnitPriceCents }]   // ordered progression incl. terminal "retired"
  defaultCareTasks: [{ title, frequency, hpReward }]   // seeds the careTasks for each asset of this type
  active: bool
  updatedAt: Timestamp

families/{familyId}/kids/{kidId}/business (singleton, id = "config")
  active: bool
  createdAt, updatedAt: Timestamp
  emoji: string                        // optional decoration ("🌿")
  tagline: string                      // kid-written, e.g., "Diella's Garden Magic"
  floatBalanceCents: integer
  floatLifetimeFundedCents: integer
  costFundingDefault: "float" | "wallet"
  saleAutoApproveUnderCents: integer   // mirrors Hive's spend-approve threshold
  defaultSaleCashDestination: "on_hand" | "on_deposit"
  largeSaleThresholdCents: integer     // sales above default to "on_deposit" in UI

families/{familyId}/kids/{kidId}/business/floatTopUps/{topUpId}
  amountCents: integer
  byParentId: string
  note: string
  occurredAt: Timestamp

families/{familyId}/kids/{kidId}/assets/{assetId}
  typeKey: string                      // matches a businessAssetTypes.key
  name: string                         // human label, e.g., "Front-yard vines"
  count: number
  stage: string                        // matches one of the type's stages.key
  unitPriceCents: integer              // current per-unit valuation at this stage
  liveValuationCents: integer          // computed-on-write: count × unitPriceCents (for query simplicity)
  notes: string
  retiredAt: Timestamp                 // null while active
  createdAt, updatedAt: Timestamp

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
  items: [{ priceListItemId?, itemName, emoji?, quantity, unit, unitPriceCents }]
  totalCents: integer
  cashDestination: "on_hand" | "on_deposit"
  status: "pending_approval" | "auto_approved" | "approved" | "rejected"
  autoApprovedReason: string           // e.g., "under family threshold of 5000 cents"
  hiveTxId: string                     // back-reference to Hive credit (when resolved)
  hiveApprovalRequestId: string        // back-reference to Hive approvalRequests
  approvedByParentId: string
  rejectionReason: string
  createdAt: Timestamp
  resolvedAt: Timestamp

families/{familyId}/kids/{kidId}/costs/{costId}
  costDate: Timestamp
  category: "feed" | "seed" | "fertilizer" | "packaging" | "tools" | "ingredients" | "other"
  description: string
  amountCents: integer
  fundingSource: "float" | "wallet"
  status: "pending_approval" | "approved" | "rejected" | "pending_topup"
  hiveTxId: string                     // present only when fundingSource = "wallet" AND approved
  hiveApprovalRequestId: string        // present only when fundingSource = "wallet"
  approvedByParentId: string
  createdAt: Timestamp
  resolvedAt: Timestamp

families/{familyId}/kids/{kidId}/careTasks/{taskId}
  assetTypeKey: string                 // matches businessAssetTypes.key
  assetId: string                      // back-ref to specific asset
  title: string                        // "Water vines · AM"
  frequency: "daily" | "weekly" | "monthly" | "custom"
  customCron: string                   // optional
  hpReward: number
  routineId: string                    // back-reference into core Kaya routine engine
  active: bool
  lastDoneAt: Timestamp
  nextDueAt: Timestamp

families/{familyId}/kids/{kidId}/reports/{weekIso}
  weekStart, weekEnd: Timestamp
  revenueCents: integer
  costsCents: integer
  nonCashLossesCents: integer          // from lossEvents in the week
  profitCents: integer                 // revenue - costs - nonCashLosses
  topWins: [{ kind: "best_seller"|"biggest_sale"|"stage_advance", description, valueCents? }]
  nextWeekReminders: [{ kind: "care_due"|"low_stock"|"stage_change", description, dueDate }]
  inventorySnapshot: [{ assetId, typeKey, name, count, stage, liveValuationCents }]
  careCompletionPct: number
  visibleToSiblings: bool              // default true
  generatedAt: Timestamp
```

**Security rules (extend existing `firestore.rules`):**
- Kids can READ: their own business singleton, assets, sales, costs, careTasks, reports; sibling reports (where `visibleToSiblings == true`); the family priceList; the businessAssetTypes.
- Kids can CREATE: their own assets, sales (status `pending_approval` or `auto_approved` — server-side rule decides), costs (status `pending_approval` or `pending_topup`), lossEvents on their assets.
- Kids can UPDATE: their own assets (count, stage, retiredAt) — but **liveValuationCents must be writable only via Cloud Function** to prevent client-side fudging.
- Kids cannot WRITE: priceList, businessAssetTypes (custom types creatable only by parents), business singleton config (floats, thresholds), other kids' anything.
- Parents can RW everything in their family.
- Helpers can READ their family's business data but cannot mutate.
- All sale/cost approval resolution and float top-ups go through Cloud Functions (not direct client writes).

---

## 4. CLOUD FUNCTIONS (create `functions/src/business.ts`)

Implement these callable functions. All are family-scoped (callers verified via custom claims or Firestore role lookup) and use Firestore transactions for atomicity.

**Setup & catalog**
1. `initBusiness({ kidId, tagline, emoji })` — parent or kid creates the business singleton. Idempotent.
2. `setFamilyPriceListItem({ itemId?, itemName, unit, unitPriceCents, sellerKidId?, emoji?, active })` — parent only. Upsert.
3. `removeFamilyPriceListItem({ itemId })` — parent only. Soft-delete via `active=false`.
4. `setBusinessAssetType({ typeId?, key, name, emoji, stages, defaultCareTasks, active })` — parent only. Upsert. Custom types use a slug-based key.
5. `setBusinessThresholds({ kidId, saleAutoApproveUnderCents, defaultSaleCashDestination, largeSaleThresholdCents, costFundingDefault })` — parent only.

**Asset lifecycle**
6. `addAsset({ kidId, typeKey, name, count, stage, unitPriceCents })` — kid or parent. Atomic: writes asset doc + recomputes `liveValuationCents` + calls `setupCareSchedule` for the asset.
7. `updateAssetCount({ assetId, newCount, reason? })` — kid or parent. If `newCount < count`, automatically prompt for a `lossEvent` (handled by client via subsequent `logAssetLoss` call; the function itself just updates count + valuation atomically).
8. `updateAssetStage({ assetId, newStage })` — kid or parent. Looks up the type's `stages.defaultUnitPriceCents` for the new stage and updates `unitPriceCents` (parent-editable thereafter). Records a stage-advance event for the weekly report.
9. `logAssetLoss({ assetId, countLost, reason, notes?, estValueLostCents })` — kid or parent. Atomic: writes lossEvents doc + decrements asset count + recomputes liveValuationCents.
10. `retireAsset({ assetId })` — kid or parent. Sets `stage="retired"`, `retiredAt=now`. Does not delete history.
11. `transferAssetToSibling({ fromKidId, toKidId, assetId, count })` — **parent-only**. Atomic: decrements source asset count + creates/increments target asset of same type on receiving kid. v1 keeps simple — no inter-kid "purchase" mechanics.

**Care**
12. `setupCareSchedule({ assetId })` — internal helper. Reads the asset's type's `defaultCareTasks`, creates `careTasks` docs, and creates corresponding routine entries in Kaya core (`familyId/routines/{routineId}` with metadata back-ref). Idempotent.
13. `markCareTaskDone({ taskId })` — kid or parent. Delegates HP credit to Kaya core's existing routine completion handler; updates `lastDoneAt` and `nextDueAt` on the careTask doc.

**Sales** (the gateway to Hive)
14. `submitSale({ kidId, saleType, buyerName, buyerKidIdOrUserId?, items, cashDestination })` —
    - Compute `totalCents = sum(items[i].quantity * items[i].unitPriceCents)`.
    - Write the `sales` doc with `status="pending_approval"`.
    - Call Hive's `requestBusinessSale({ kidId, totalCents, items, buyerName, saleType, cashDestination, ventureSaleId: <new sale id> })`.
    - Hive will either auto-approve (creating the `business_sale` Hive tx + crediting the chosen sub-balance) or create a `business_sale` approval request.
    - On Hive auto-approve: receive the `hiveTxId` and update the local sale doc with `status="auto_approved"`, `hiveTxId`, `resolvedAt=now`.
    - On Hive pending: receive the `hiveApprovalRequestId` and store it on the sale doc.

**Costs**
15. `submitCost({ kidId, category, description, amountCents, fundingSource })` —
    - **If `fundingSource === "wallet"`:** write costs doc with `status="pending_approval"` + call Hive's `requestBusinessCost`. Same auto-approve / pending split as sales.
    - **If `fundingSource === "float"`:** check `floatBalanceCents`.
      - If sufficient: atomic — write costs doc with `status="approved"`, decrement `floatBalanceCents`, recompute valuations. **Hive is NOT called.**
      - If insufficient: write costs doc with `status="pending_topup"`. Notify parent. Do NOT silently fall back to wallet.

**Float**
16. `topUpFloat({ kidId, amountCents, note? })` — parent-only. Atomic: increments `floatBalanceCents`, increments `floatLifetimeFundedCents`, writes a `floatTopUps` doc. If any `costs` for this kid are `pending_topup` and now coverable, automatically resolve them in priority order (oldest first) — atomic in the same transaction. Send a kid-side toast notification.

**Approvals (parent side — wraps Hive's resolveApprovalRequest for sales/costs)**
17. `resolveBusinessApproval({ hiveApprovalRequestId, decision, cashDestinationOverride?, reason? })` — parent only. Calls Hive's `resolveApprovalRequest` and additionally updates the local Business `sales` or `costs` doc with `status="approved"|"rejected"`, `hiveTxId`, `approvedByParentId`, `resolvedAt`, optional `cashDestinationOverride` (parent can change destination at approval time per the brief).

**Reports**
18. `generateWeeklyReport({ familyId? })` — **scheduled function**, runs every Sunday at 21:00 family-local time (handle timezone via family doc's `timezone` field; default `Africa/Dar_es_Salaam`). For each active business in the family:
    - Aggregate week's sales (`saleDate >= weekStart`) → `revenueCents`.
    - Aggregate week's wallet+float costs → `costsCents`.
    - Aggregate week's lossEvents `estValueLostCents` → `nonCashLossesCents`.
    - Compute `profitCents`.
    - Identify `topWins`: best-selling item by quantity, biggest single sale, stage advances logged this week.
    - Identify `nextWeekReminders`: care tasks due in the next 7 days, low-stock heuristic (any item that sold >X times last week), stages about to change (parent-set ETAs on assets, optional v2).
    - Snapshot inventory.
    - Compute `careCompletionPct`: (care tasks marked done in week) / (care tasks scheduled in week).
    - Write the report doc.
19. `regenerateWeeklyReport({ kidId, weekIso })` — manual on-demand override. Useful for parent debugging.

**General requirements**
- All functions verify caller's role.
- All writes that touch money use Firestore transactions.
- All functions write to a `businessAuditLog` collection (parallel to `hiveAuditLog`).
- All money values are integer cents using the family's currency. **Never hard-code USD or "$".**
- All timestamps stored as Firestore Timestamps; client renders in family-local timezone.

---

## 5. ROUTES (Next.js App Router)

### Kid routes (mobile-first; rendered with the existing kid auth shell)

```
business/
  page.tsx                          → My Business (dashboard)
  assets/page.tsx                   → My Assets (list)
  assets/new/page.tsx               → Add asset wizard (type → name → count → stage → care preview)
  assets/[assetId]/page.tsx         → Asset detail (stage history, loss log, retire)
  sales/page.tsx                    → Sales list
  sales/new/page.tsx                → Log a sale (segmented Family / Relative; full picker stack)
  costs/page.tsx                    → Costs list
  costs/new/page.tsx                → Log a cost (Float / Wallet picker; category + amount)
  reports/page.tsx                  → My weekly reports archive
  reports/[weekIso]/page.tsx        → Specific week (also rendered when sibling viewing — read-only when so)
```

Bottom tab bar (kid view, scoped to Business): `Business · Assets · Sales · Costs`. The Weekly Report opens from My Business as a card tap (or from `/business/reports`).

### Parent routes (web-first; rendered with the existing parent shell, wider layout)

```
parent/business/
  page.tsx                          → Side-by-side books (default landing)
  approvals/page.tsx                → Approvals queue (sales + costs + cash deposits)
  price-list/page.tsx               → Family Price List editor
  floats/page.tsx                   → Cost Floats (per-kid panel + top-up + history)
  asset-library/page.tsx            → Asset type library editor (built-ins read-only; custom CRUD)
  thresholds/page.tsx               → Per-kid auto-approve thresholds + defaults
  reports/page.tsx                  → All-kids weekly reports archive (filterable, printable for Sunday meetings)
```

Parent Console layout: 3-column desktop (left nav · main content · right approvals rail). Collapses to single column under 1100px viewport. The right rail's approvals shortcut must remain accessible on mobile (parent on the go) — surfaced as a floating badge in the top bar at narrow widths.

### Sibling viewing
Kid A can read Kid B's reports if `visibleToSiblings == true`. Sibling-viewer mode renders `/business/reports/[weekIso]` with a small banner ("👀 You are viewing Earlnathan's report") and disables any edit affordances.

---

## 6. SCREEN SPECS

Refer to **Kaya-Business_Design-Proposal_2026-05-13.html** in the project root for the visual mockups. Match them faithfully. Each screen below lists data sources, key components, primary actions, and the "What's this?" copy to surface.

### Kid · My Business (`/business`)
- **Hero card:** "Total Asset Value" — sum of `liveValuationCents` across active assets. Sub-line: change vs last week.
- **Stat grid (3 tiles):** Revenue (week), Costs (week), Profit (week).
- **Float row** (only if `floatBalanceCents > 0`): "Float from Mama · TSh X,000".
- **Today's care card:** subset of `careTasks` where `nextDueAt <= today`. Checkbox completion calls `markCareTaskDone`.
- **What's this?:** *"Your very own little company — the things you grow or make, the people you sell to, and the money you earn."*
- **Tap-targets:** Hero → Assets · Stat tiles → Sales/Costs/Reports respectively · Care card → /business (stays).

### Kid · My Assets (`/business/assets`)
- **Grouped list** of assets, each row: emoji · name · stage pill · count · unit price · live valuation · chev to detail.
- **Add asset dashed card** at bottom → /business/assets/new.
- **What's this?:** *"Something you own that helps you make money. Its stage tells you what to expect."*

### Kid · Add Asset (`/business/assets/new`)
- **Step 1:** Pick type — chip grid from `businessAssetTypes` (active=true), grouped by built-in / custom.
- **Step 2:** Name (default to type name + " · my own").
- **Step 3:** Count + stage (chips driven by selected type's stages).
- **Step 4:** Confirm unit price (prefilled from type's stage default).
- **Preview:** "When I add this, X care tasks will be created and Y HP per task will be earned."
- **Submit:** calls `addAsset`.

### Kid · Sales (`/business/sales`)
- **This-week summary** (header).
- **Quick action row:** "+ Family sale" (primary leaf) + "+ Relative sale" (alt).
- **Recent sales list:** 10 most recent, grouped status pills (auto-approved / approved / pending). Each row shows buyer + family/relative badge + cashDestination badge.
- **What's this?:** *"A sale to someone in our house uses the price already set. A sale to anyone outside lets you choose the price."*

### Kid · Log a Sale (`/business/sales/new`)
- **Segmented toggle:** Family / Relative (defaults per UI decision; e.g., last-used).
- **Family path:** buyer chip-row from family roster · item chip-row from priceList (filtered by `sellerKidId == this kid` if set, else all active) · quantity stepper · cashDestination chips · total → submit.
- **Relative path:** buyer free-text input · same item chip-row but the price field is **editable** (auto-suggested from priceList; show a "↓ Discount applied" / "↑ Premium applied" hint when edited) · quantity stepper · cashDestination chips · total → submit.
- **Auto-approve hint:** under threshold → "Auto-approved" green note · over threshold → "Submit for Mama's approval" honey button.
- **Submit:** calls `submitSale`.

### Kid · Costs (`/business/costs`)
- **Float row** at top (always visible if float exists).
- **Quick action:** "+ Add a cost" (honey).
- **Recent costs list:** funding badge (Float / Wallet) + status (approved / pending / pending_topup / loss).
- **Loss events** also surface here as red-tinted rows (`Asset loss · non-cash · −X`).
- **What's this?:** *"The Float is money Mama or Papa puts into your business so you don't have to use your savings. Wallet means you're spending your own Hive Cash."*

### Kid · Log a Cost (`/business/costs/new`)
- **Segmented toggle:** Float / Wallet (default = `business.costFundingDefault`).
- **Category chips:** feed · seed · fertilizer · packaging · tools · ingredients · other.
- **Description input · amount input.**
- **Funding-warning banner:** if Float chosen and `floatBalanceCents < amount`, show "⚠ Float will go to TSh 0 and the cost will wait until Mama tops it up. Continue?"
- **Submit:** calls `submitCost`.

### Kid · Weekly Report (`/business/reports/[weekIso]`)
- **Hero block:** week label + business name + Revenue/Costs/Profit pills.
- **Top Wins** (best-seller, biggest sale, stage advances) with emoji icons.
- **Next Week** reminders (care due, low stock, stage changes) with emoji icons.
- **Sibling visibility note** (if `visibleToSiblings`): *"👀 Earlnathan and Daniella can see this report."*
- **Read-only sibling-viewer mode:** add a viewer banner; hide edit/share affordances.

### Parent · Side-by-side books (`/parent/business`)
- **Top bar** uses the existing parent topbar (logo, family name, profile menu).
- **Left nav** (this section): Side-by-side · Approvals · Price List · Floats · Asset Library · Thresholds · Reports. Approvals item shows a count badge (pending requests).
- **Left nav rollup boxes:** "This week — family" (total revenue, costs, profit, care completion %) · "Sunday meeting in N days" (links to report preview).
- **Center:** "Side-by-side books" — heading · week label · `<KidCard>` × 3 in a grid showing each kid's weekly numbers + asset summary + care-completion bar.
- **Right rail:** approvals queue (top 3-5 most urgent), each with type pill, kid name, amount, action buttons, optional destination toggle (for sales).
- **Below kid grid:** Family Price List editor — embedded, editable inline.

### Parent · Approvals (`/parent/business/approvals`)
- Full-page approvals queue (when more than fit in the right rail).
- Filters: by kid · by type (sale / cost / cash deposit) · by status.
- Bulk approve action available (with confirm dialog).

### Parent · Family Price List (`/parent/business/price-list`)
- Full-page editable table of priceList items (item · unit · price · seller kid · active toggle · delete).
- Add row at bottom.
- Inline save on blur; debounce.

### Parent · Cost Floats (`/parent/business/floats`)
- **Per-kid panel grid** (3 cards): float balance, lifetime funded, top-up + history actions. Red border + warning if `floatBalanceCents == 0` AND there are `pending_topup` costs.
- **Top-up modal:** amount input + note. Submits `topUpFloat`.
- **Top-up history table:** date · kid · amount · funded by.

### Parent · Asset Library (`/parent/business/asset-library`)
- **Built-in types** (5 cards): read-only display of stages and default care.
- **Custom types** section: full CRUD (key + name + emoji + stages array + defaultCareTasks array + active toggle).
- **Stage editor:** ordered list with up/down reorder, label + defaultUnitPriceCents per row. Add stage button. Cannot delete a stage that's in use by an existing asset (show a warning).
- **Care-task editor:** ordered list with title + frequency + hpReward.

### Parent · Thresholds (`/parent/business/thresholds`)
- Per-kid form: `saleAutoApproveUnderCents` (number input with currency symbol from `hiveConfig.currency`) · `defaultSaleCashDestination` (radio: On Hand / On Deposit) · `largeSaleThresholdCents` · `costFundingDefault` (radio: Float / Wallet).
- Save → `setBusinessThresholds`.

### Parent · Reports archive (`/parent/business/reports`)
- All weeks · all kids · filterable.
- Each row: week · kid · revenue · costs · profit · care % · view link.
- "Print this week's reports" CTA → renders the 3 kids' reports in a print-friendly stylesheet for the Sunday meeting.

---

## 7. DESIGN TOKENS (use these exactly — extends Hive's tokens)

```css
/* Existing Hive tokens (do not change) */
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
--rose: #E36F6F         /* spend / negative / loss */
--blue: #3F7AAF         /* HP layer accent */

/* New Business tokens (NEW) */
--leaf: #4FB87A         /* Business primary accent */
--leaf-dk: #2E7D52      /* Business heading / text accent */
--leaf-soft: #E6F7EE    /* Business soft bg */
```

Fonts: **Nunito** (display, weights 700/800/900) + **Lato** (body, 400/700) — same as Hive.

Border radii: cards `14–18px`, pills `999px`, buttons `12–14px`. Stage pills smaller (`6px`, font 9-10px). Mobile-first single-column kid screens; 3-column desktop for Parent Console with collapse to single column under 1100px.

---

## 8. COMPONENT INVENTORY (build these reusable pieces)

### Mobile (`src/components/business/`)

```
BusinessHeroCard.tsx           // total asset value + week change
WeekStatGrid.tsx               // 3-tile revenue/costs/profit
FloatRow.tsx                   // dashed honey row showing float balance
CareTaskList.tsx               // today's care tasks with checkboxes
CareTaskRow.tsx                // single task with HP reward pill
AssetRow.tsx                   // list item: emoji/name/stage/count/value
AssetWizard.tsx                // 4-step add asset flow
StagePill.tsx                  // colored stage chip (fruit/lay/young/retired)
StagePicker.tsx                // chip-row picker for stages
SalesQuickActions.tsx          // "+ Family" / "+ Relative" button row
SaleEntryRow.tsx               // recent sale row with badges
SaleForm.tsx                   // segmented family/relative form
BuyerChipRow.tsx               // family roster chips OR free-text input
ItemPicker.tsx                 // priceList chip row with optional editable price
QuantityStepper.tsx            // − N + control
DestinationChips.tsx           // 👛 On Hand / 🏦 On Deposit
CostsList.tsx                  // grouped recent costs incl. losses
CostForm.tsx                   // float/wallet picker + category + amount
FundingBadge.tsx               // Float / Wallet / Loss / Pending pill
WeeklyReportHero.tsx           // gradient hero with week label + numbers
WinList.tsx                    // top wins with emoji icons
ReminderList.tsx               // next-week reminders
SiblingViewerBanner.tsx        // shown when viewing another kid's report
WhatsThisCard.tsx              // (REUSED from Hive v3) inline definition card
PendingBadge.tsx               // small "PENDING" pill
LossBadge.tsx                  // small "LOSS" pill
BusinessTabBar.tsx             // bottom nav for kid Business module
```

### Web/Parent Console (`src/components/business/parent/`)

```
ConsoleLayout.tsx              // 3-column desktop shell (left nav, main, right rail)
ConsoleNav.tsx                 // left nav with active state + count badges
ConsoleRollup.tsx              // left-nav rollup boxes ("this week — family")
KidCard.tsx                    // single kid's weekly book card for side-by-side
KidAvatar.tsx                  // colored initial badge (gold/white/silver)
PriceListTable.tsx             // editable table with inline saves
PriceListRow.tsx               // single editable row with toggle
FloatPanel.tsx                 // per-kid float card with top-up + history actions
FloatTopUpModal.tsx            // amount + note submit
FloatHistoryTable.tsx          // date / kid / amount / funded by
ApprovalsQueue.tsx             // list of ApprovalCard
ApprovalCard.tsx               // variants: SaleApproval, CostApproval, DepositApproval
ApprovalDestinationToggle.tsx  // override destination at approval time
AssetTypeLibraryEditor.tsx     // built-in + custom CRUD
StageEditor.tsx                // ordered list of stages + defaultUnitPriceCents
CareTaskEditor.tsx             // ordered list of default care tasks per type
ThresholdsForm.tsx             // per-kid threshold + default config
ReportsArchive.tsx             // filterable table of reports
PrintableReports.tsx           // Sunday-meeting print-friendly stylesheet
```

---

## 9. STATE MANAGEMENT

- **`BusinessContext`** (per-kid view) — provides current kid's `business` config, assets, recent sales/costs/care tasks, current week's aggregates, via Firestore listeners. Exposes derived: `liveValuationTotalCents`, `weekRevenueCents`, `weekCostsCents`, `weekProfitCents`, `careCompletionPct`, `pendingApprovalsCount`.
- **`FamilyBusinessContext`** (parent view) — provides all kids' summaries, the family `priceList`, the family `businessAssetTypes`, the pending approvals queue (Hive `approvalRequests` filtered by `type IN ["business_sale", "business_cost"]` + Hive `cash_deposit_pending` for completeness), all kids' floats. Used by all `/parent/business/*` routes.
- **Reuse `HiveContext`** for cash balances and wallet operations. Never duplicate Hive state in Business.
- **All write paths** go through callable Cloud Functions (never direct client writes to assets/sales/costs/business singleton).
- Memoize derived values aggressively (per-week aggregates can be expensive over many sales/costs).

---

## 10. DATA SEEDING (for local dev — `scripts/seed-business.ts`)

Given a familyId with three kids (Earlnathan, Diella, Daniella) and Hive v3 already seeded:

**Asset library** — seed the 5 built-in `businessAssetTypes`:
- `passion_fruit` (stages: seedling 1500c · growing 3000c · fruiting 6000c · retired 0; care: water 3×/week +5HP, fertilize monthly +5HP, prune quarterly +5HP)
- `laying_hen` (stages: chick 5000c · pullet 12000c · laying 25000c · retired 8000c; care: feed daily +5HP, refresh water daily +5HP, clean coop weekly +5HP, health check monthly +5HP)
- `veg_garden` (stages: seedling 500c · producing 1500c; care: water daily +5HP, weed weekly +5HP, fertilize monthly +5HP)
- `goat` (stages: kid 30000c · adult 80000c; care: feed 2×/day +8HP, water daily +8HP, deworm quarterly +8HP)
- `bakery_product` (stages: active 0c; care: restock ingredients weekly +4HP, clean station daily +4HP)

**Family Price List** — seed:
- 🍈 Passion fruit / kg / 3000c / Diella
- 🥬 Sukuma / bunch / 1500c / Diella
- 🥚 Eggs / dozen / 5000c / Earlnathan
- 🍪 Chocolate cookie / piece / 500c / Daniella

**Three businesses** with floats and tagline:
- Earlnathan · "Earnathan's Eggs 🐔" · float 12000c · saleAutoApproveUnderCents 5000
- Diella · "Diella's Garden Magic 🌿" · float 8000c · saleAutoApproveUnderCents 5000
- Daniella · "Daniella's Cookie Lab 🍪" · float 0c (currently empty — to demo the pending_topup state)

**Assets**:
- Earlnathan: 6 laying hens (laying)
- Diella: 10 vines (fruiting), 2 vines (growing), 8 sukuma plants (producing)
- Daniella: 1 bakery_product asset (active, count=1) representing "Cookie operation"

**Sales** — last 7 days each:
- Diella: 1 family sale (2 kg passion fruit → Mama, on hand, auto-approved), 1 relative sale (3 kg passion fruit → Aunt Ruth at TSh 2,800/kg, on deposit, approved), 1 pending relative sale (2 kg → neighbor at TSh 5,000)
- Earlnathan: 3 family sales (eggs to various household members)
- Daniella: 2 family sales (cookies)

**Costs**:
- Diella: 1 float-funded (fertilizer 4000c, approved), 1 wallet-funded (seedlings 3000c, approved), 1 lossEvent (2 vines failed, est 6000c)
- Earlnathan: 1 pending wallet cost (layer feed 6000c, awaiting parent)
- Daniella: 1 pending_topup cost (sugar 4000c — float empty)

**Care tasks** with realistic completion ratios for the past week (Diella 79%, Earlnathan 85%, Daniella 70% per design proposal numbers).

**Weekly reports** — generate one report per kid for the previous Sunday-completed week (so the design's example data renders).

---

## 11. ACCEPTANCE CRITERIA

The build is done when **all of the following** work end-to-end. Mobile criteria assume a kid logged in on a phone-sized viewport; Web criteria assume a parent on a desktop-sized viewport.

### Mobile (kid)
1. A kid can navigate to `/business` and see the My Business dashboard with live numbers pulling from Firestore.
2. A kid can add a new asset via `/business/assets/new` — the wizard creates the asset, computes liveValuationCents server-side, AND auto-creates the care tasks (visible in My Business and in Kaya core routines).
3. A kid can update an asset's count or stage; valuations update; if count drops, the loss-event flow triggers.
4. A kid can log a **family sale** under threshold and see it as auto-approved with cash credited to the chosen Hive sub-balance — with the corresponding Hive `business_sale` tx visible in Hive's Cash In screen.
5. A kid can log a **family sale** over threshold and see it appear in the parent's approvals queue — cash does not move until parent approves.
6. A kid can log a **relative sale** with an edited price; the edit is logged on the sale doc; "↓ Discount" or "↑ Premium" hint shows in UI.
7. A kid can log a **float-funded cost**; if float covers it, status is `approved` instantly and `floatBalanceCents` decrements. Hive is NOT called.
8. A kid can log a **float-funded cost** that exceeds the float; status is `pending_topup`; cost does NOT silently fall through to wallet.
9. A kid can log a **wallet-funded cost**; it goes through Hive's `requestBusinessCost`; on approval, `cashOnHandCents` decrements.
10. A kid can mark a care task done; HP credits via Kaya core's existing routine engine; My Business "today's care" updates; Hive HP balance reflects.
11. A kid can view their `Weekly Report` for the most recent Sunday-completed week with revenue/costs/profit, top wins, next-week reminders, and sibling-visibility note.
12. A kid can view a **sibling's** weekly report (read-only, with viewer banner) when sibling visibility is on.
13. The bottom tab bar `Business · Assets · Sales · Costs` is present on all kid Business routes; the bar's active state matches the route.
14. **Every kid screen has a `WhatsThisCard`** with kid-friendly copy specific to that screen.
15. All money values render in the family's `hiveConfig.currency`. **No hard-coded `$` anywhere.**

### Web (parent)
16. A parent can land on `/parent/business` and see the 3-column Console: left nav with badges, side-by-side books for all 3 kids, right rail approvals queue, and the Family Price List below.
17. A parent can edit a price-list row inline; save is debounced; updates propagate to Firestore.
18. A parent can add a new price-list item.
19. A parent can approve a pending sale from the right rail; cash credits to the kid's chosen destination (or the override the parent picked); local sale doc reflects `status="approved"` and `hiveTxId`.
20. A parent can approve a pending wallet cost from the right rail; `cashOnHandCents` debits.
21. A parent can confirm a kid's pending cash deposit (Hive `cash_deposit_pending`) from the right rail; balances move atomically.
22. A parent can navigate to `/parent/business/floats` and see per-kid float panels; the kid with empty float and pending_topup costs is visually flagged in red.
23. A parent can top up a float; if pending_topup costs exist for that kid and are now coverable, they auto-resolve in the same atomic transaction (oldest first).
24. A parent can navigate to `/parent/business/asset-library` and CRUD a custom asset type with stages and default care tasks.
25. A parent can navigate to `/parent/business/thresholds` and set per-kid auto-approve thresholds, default cash destination, large-sale destination flip, and cost funding default.
26. A parent can navigate to `/parent/business/reports` and view all-kids report archive; can trigger a print-friendly view of the current week's three reports for the Sunday meeting.
27. The Parent Console **collapses gracefully** to a single-column layout under 1100px viewport; the right rail's approvals shortcut becomes accessible via a top-bar badge.

### Cross-cutting
28. The scheduled `generateWeeklyReport` runs every Sunday at the family's local 21:00; reports are accurate to the data and visible to siblings per default config.
29. `firestore.rules` blocks kids from writing to: priceList, businessAssetTypes (custom CRUD), business singleton config, other kids' anything. Helpers cannot write at all to Business.
30. **All money flows that touch Hive** use the Hive Cloud Functions (`requestBusinessSale`, `requestBusinessCost`, `resolveApprovalRequest`); **none use direct client writes to the wallet doc**. Verified by code review.
31. **Float-funded costs** never create a Hive transaction.
32. The migration `migrateWalletsToCashSplit` from Hive v3 has run successfully before any Business cost or sale is processed.
33. Currency renders correctly for both TZS (Timotheo seed family) and any other currency configured via `hiveConfig.currency`. Verified with at least one test family configured for USD.
34. All routes are mobile-first responsive; parent routes upgrade to web layout at ≥1100px.

---

## 12. WHAT NOT TO BUILD YET (defer to v2 / v3)

- **Photo evidence** on production / sale logs. (v2)
- **Push / WhatsApp** care reminders. In-app + Kaya core notifications module only. (v2)
- **Joint ventures** (two kids co-owning one business). (v2)
- **Per-report privacy** override (kids choosing to hide a specific report from siblings). (v2)
- **Inter-venture trade** (Earlnathan supplies eggs to Diella's bakery as a tracked supplier relationship). (v3)
- **Real external-customer support** beyond manual buyer-name entry. (v3)
- **Mobile-money rails** (M-Pesa, Tigo Pesa, Stripe). (v3 — coordinated with Hive Phase 3.)
- **Optional global-profile USD translation.** (v3 — coordinated with Hive Phase 3.)
- **Tax / profit-sharing concepts.** (v3+)
- **Production-event logging as a separate step.** (v1 sales are direct; v2 may add a preliminary production log.)

---

## 13. KICKOFF INSTRUCTION TO THE CODE AGENT

> Read `Kaya_Project_Briefing_2026-04-25.md`, `Kaya-Hive_Code-Prompt_2026-05-07.md` (v3), `Kaya-Hive_Design-Proposal-v3_2026-05-13.html`, `Kaya-Business_Project_Briefing_2026-05-13.md`, and `Kaya-Business_Design-Proposal_2026-05-13.html` in the project root. Confirm Hive v3 is fully shipped (cash split, business sale/cost Cloud Functions, `migrateWalletsToCashSplit` run) before starting Business. Then implement section by section in this order: (1) Firestore schema + extended security rules, (2) Cloud Functions (asset lifecycle → care setup → sales/costs → float → reports), (3) `BusinessContext` + `FamilyBusinessContext`, (4) shared mobile components + `WhatsThisCard` reuse, (5) shared parent web components + `ConsoleLayout`, (6) Kid routes (My Business → Assets → Sales → Costs → Reports), (7) Parent routes (Side-by-side → Approvals → Price List → Floats → Asset Library → Thresholds → Reports archive), (8) `generateWeeklyReport` scheduled function, (9) `seed-business.ts`. After each section, run `pnpm build` and confirm no type errors before continuing. Open a single PR titled `feat(business): kaya business module — phase 1 (mobile + web)`.

---

*End of prompt. Project: Kaya · Module: Kaya Business · Date: 2026-05-13 · Author: Elia.*
