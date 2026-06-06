# Kaya — Claude Operating Notes

Persistent guidance for any Claude session working in this repo. Read on
session start, apply without being asked.

## Flight Check Grade

Every change shipped from this repo passes through 4 gates. Stamp every PR
description with the grade and update it on every push. Do not say a task is
"done" until **all four** gates are 🟢.

### The 4 gates

1. **Quality checks + approved design** — typecheck/lint clean, the approach
   matches what the user agreed to in chat (no scope creep, no surprise
   refactors).
2. **No confusion before merge** — preview URL shared, expected behaviour
   stated in plain language, every clarifying question answered.
3. **Uploaded → tested → quality preserved 100%** — change is deployed to a
   preview the user can hit, and the user (or Claude with verifiable
   evidence) has confirmed no deviation from the intended behaviour.
4. **Live on production** 🎉 — merged to `main`, prod deployment complete,
   confirmed working by the user. Announce with a celebratory call-out.

### Status legend

| Color | Meaning |
| ----- | ------- |
| 🟢 Green | Gate passed, evidence linked (commit, preview URL, user confirmation). |
| 🟡 Amber | Pending — not submitted yet, awaiting user clarification, or waiting on the user to verify. |
| 🔴 Red | Errors, regressions, or blocked. |

### Rules I follow

- Append a Flight Check Grade block to every PR description, all four gates
  with current color + a one-line reason.
- Update the block on every push to that PR so drift is visible.
- "Pushed", "fix applied", "preview deployed" are gate 1–3 states — **not**
  done. Only gate 4 🟢 is done.
- If the user says the bug is still happening, the first thing I check is
  which gate the PR is sitting at — not the code.
- A draft PR cannot reach gate 4. Flag the draft state to the user early.

## Autonomous release (Elia-authorised SDP mode)

When Elia approves a scope and says to **proceed autonomously** (e.g. "proceed
PR 1→N autonomously, following SDP"), run the whole multi-PR programme to
production without waiting for per-step sign-off:

- **Decompose first.** The approved design → a match checklist (the contract).
  Nothing on it is skipped, stubbed, or "good-enough'd".
- **Green increments, one PR per logical step.** Each PR: typecheck + `next
  build` + Vercel green + prod-verified (route 200 / health) before the next.
- **Auto-merge each PR on Vercel green** (standing preference), branch fresh off
  `origin/main` for the next — never keep committing on a merged branch.
- **Report at every milestone** in the SDP shape: 📐 Design-Match % (checklist
  ✅/🟡/⬜) · 📦 Delivery % (PRs shipped-green, with SHAs) · 🛫 Flight Check RAG
  (Preserve · Test · Merge · Launch · Notify), driving every gate to 🟢.
- **Finish the job.** Drive Design-Match + Delivery to 100%. Pause **only** if an
  action would negatively impact the project (real money/email side-effects,
  destructive git/Firestore/rules/index deploys) — flag those, don't guess.
- Preserve 100%-approved designs EXACTLY; deliver complete files; increment
  versions; close with every gate 🟢 + 🎉 + honest notes on anything deferred.
