# Strategy corpus change record

## Learning-efficiency correction — 2026-07-13

The action corpus remains `poto-live-1-3-provisional-v4`; its action fingerprint
and SHA-256 action snapshot are unchanged. This release corrects training and
explanation behavior without changing a valid poker action:

- only fluent answers retrieved after their scheduled delay advance durable
  mastery or lengthen retention intervals;
- early repetitions preserve the existing deadline, while slow due answers
  return on a short interval;
- mastered modes and contexts lose most of their fixed curriculum share while
  retaining a bounded exploration floor;
- boundary coaching reports the contrast hand's complete allowed-action plan
  and shows the applicable adjustment;
- keyboard movement in the chart keeps the visible explanation synchronized;
- small-blind first-in is labeled as a raise-or-fold simplification because no
  limp branch exists.

Existing records restore conservatively with zero qualified delayed retrievals;
mistakes and answer history remain available. No range can be described as
solver-reviewed or rake-adjusted because of this training-only release.

## Training reliability correction — 2026-07-12

The action corpus remains `poto-live-1-3-provisional-v4`; its action fingerprint
and SHA-256 action snapshot are unchanged. This release changes training safety
and scheduling, not valid poker actions:

- unsupported modes, impossible position sequences, and invalid hand classes
  are explicitly ungraded instead of inheriting a fold or an unrelated range;
- exact due and weak decisions can enter a global priority lane before broad
  mode/context sampling, while queued +8/+32 spacing remains protected;
- normal sessions reserve 25% of their slots for new coverage during a review
  backlog, while targeted drills may remain review-only;
- overdue delayed reviews no longer starve behind new first-stage misses;
- capacity-pruned review entries reconstruct their next spacing stage instead
  of silently losing the +32 and one-day retrievals;
- concept transfer tapers over the first three exact observations and can never
  wash out an unresolved exact miss;
- small-pair and small-blind call coaching no longer overstates hand strength or
  contradicts the displayed default action;
- production reads the reviewed fingerprint constant immediately, while
  integrity checks still recompute the full action snapshot.
- response timing excludes settings, charts, hidden tabs, and unfocused-window
  time; storage failures and missing app assets now surface visible recovery
  states instead of false success or a dead trainer shell.

Because valid action signatures did not change, existing exact mastery remains
compatible. Unsupported scenarios never count toward mastery.

## Room-evidence calibration — 2026-07-12

The action corpus remains `poto-live-1-3-provisional-v4`; its action fingerprint
is intentionally unchanged. This release corrects provenance and coaching:

- removes the unsupported presentation of `100-133bb` as a live-room fact and
  labels 100bb as a training assumption;
- records nine-handed as user-reported and PokerAtlas-listed, and records that
  the user's 10% rake capped at $6 recollection matches the same listing, while
  keeping desk verification and the current promotional drop unresolved;
- keeps rake/drop models `null` in the strategy configuration because those
  costs did not produce the current actions;
- explains small-blind suited broadways as good hands in bad seats instead of
  misdescribing their rank or connection;
- labels the 35/65 decision mix as curriculum emphasis rather than Poto
  occurrence evidence;
- hardens the reviewed-status gate so exact stack, rake, drop, straddle,
  sizing, and hashed action evidence are required before a future corpus can be
  labeled reviewed.

Room-evidence changes do not invalidate action mastery. Any later action change
must still update the strategy version, FNV fingerprint, and SHA-256 snapshot.

## `poto-live-1-3-provisional-v4`

Status: **provisional; not solver- or expert-reviewed**.

The default `BALANCED` / `STANDARD` facing-open action matrix is unchanged from
the deployed v3 corpus. Version 4 removes the former global profile/size hand
lists because they could fold a stronger member of a hand family while keeping
a weaker member.

This cleanup changes 955 of 53,235 facing-open hand/configuration cells outside
that default matrix. These changes are an explicit provisional reset, not proof
that either v3 or v4 is optimal:

| Configuration | Changed cells |
| --- | ---: |
| Tight / small | 167 |
| Tight / standard | 167 |
| Tight / large | 153 |
| Balanced / small | 64 |
| Balanced / standard | 0 |
| Balanced / large | 128 |
| Loose / small | 77 |
| Loose / standard | 71 |
| Loose / large | 128 |

Action transitions:

| Previous → v4 | Cells |
| --- | ---: |
| Pure fold → pure call | 675 |
| Pure fold → call/3-bet mix | 40 |
| Pure fold → call/fold mix | 18 |
| Pure fold → 3-bet/fold mix | 10 |
| Call/fold mix → fold-primary mix | 36 |
| Call/fold mix → pure fold | 173 |
| 3-bet/fold mix → pure fold | 3 |

The normalized action manifest is locked by both a runtime FNV fingerprint and
a CI SHA-256 snapshot. Any future action change must update those reviewed
constants and add a new section here. This prevents copy or refactoring work
from silently rewriting poker answers.

Rollback reference: the last deployed v3 strategy source was commit `c3cce91`;
the GitHub `main` merge containing it was `1958301e` at sprint start.
