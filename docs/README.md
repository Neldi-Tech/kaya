# Kaya — Module Specs

Design + build specs for Kaya modules. Markdown specs live here; the
matching visual design proposals are served from `/public` so they
open in a browser (e.g. `ourkaya.com/Kaya-Business_Design-Proposal_2026-05-13.html`).

## Kaya Business (new module — Phase 1.5)

A kids' micro-business module: each kid runs one business, tracks
assets / sales / costs / care reminders, gets a Sunday weekly P&L.
Five kid screens (mobile) + a Parent Console (web). All money flows
route through The Hive — Business never writes a wallet directly.

| Doc | Purpose |
|---|---|
| [`Kaya-Business_Project_Briefing_2026-05-13.md`](./Kaya-Business_Project_Briefing_2026-05-13.md) | The locked v1 spec — 17 resolved decisions, domain model, screens, glossary. **Start here.** |
| [`/public/Kaya-Business_Design-Proposal_2026-05-13.html`](../public/Kaya-Business_Design-Proposal_2026-05-13.html) | Visual proposal — 5 kid screens + Parent Console + Cost Float + Asset Library + wiring diagram. |
| [`Kaya-Business_Code-Prompt_2026-05-13.md`](./Kaya-Business_Code-Prompt_2026-05-13.md) | Code-generation prompt for Cursor / Claude Code / v0 — schema, Cloud Functions, routes, components, acceptance criteria. |

## The Hive — v3 (cash split + business plumbing)

Prerequisite for Kaya Business. Splits Cash (L3) into **on-hand** vs
**deposit** sub-balances, adds safekeeping deposit/withdrawal flows,
and exposes the `requestBusinessSale` / `requestBusinessCost` Cloud
Functions that Business plugs into.

| Doc | Purpose |
|---|---|
| [`Kaya-Hive_Code-Prompt_2026-05-07.md`](./Kaya-Hive_Code-Prompt_2026-05-07.md) | Hive code-generation prompt — **updated 2026-05-13 to v3** (cash split, new Cloud Functions, migration). |
| [`/public/Kaya-Hive_Design-Proposal-v3_2026-05-13.html`](../public/Kaya-Hive_Design-Proposal-v3_2026-05-13.html) | Hive v3 visual proposal — Wallet cash split, Safekeeping screens, refreshed roadmap. |

## Build order

1. **Hive v3** — apply `Kaya-Hive_Code-Prompt_2026-05-07.md` (v3). Cash split + migration + business Cloud Functions.
2. **Kaya Business** — apply `Kaya-Business_Code-Prompt_2026-05-13.md` on top. Depends on Hive v3 being shipped.

Each code prompt is self-contained: paste it as the first message in
Cursor / Claude Code / v0 with this repo open, and it scaffolds the
module section by section.
