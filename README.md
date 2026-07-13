Preflop Trainer
===============

Public static poker preflop trainer hosted with GitHub Pages.

Source layout
-------------

- `index.html` - static UI shell.
- `poto-evidence.js` - immutable, sourced room profile and explicitly non-observed curriculum priors.
- `range-engine.js` - single source of truth for live $1/$3 range presets, recommendation logic, grading, and chart output.
- `trainer-scheduler.js` - adaptive weak-spot, decision-boundary, mastery, and recent-question cooldown scoring for drills.
- `app.js` - browser UI controller for drills, settings, stats, and charts.
- `scripts/validate-ranges.js` - deterministic regression checks for key range decisions.

Security posture
----------------

- Do not commit secrets, credentials, API keys, PHI, PII, customer records, exports, logs, or private business data.
- Keep changes on pull requests and keep `main` protected.
- Keep GitHub security features enabled: Dependabot alerts/security updates, secret scanning, and push protection.
- GitHub Actions are restricted to GitHub-owned and verified actions.

Deployment
----------

GitHub Pages serves this site from `main` at `/`.

Local validation
----------------

The active drill covers first-in and facing-open decisions. A generic
facing-3-bet drill is intentionally withheld: useful fold/call/4-bet training
requires hero and villain positions, open and 3-bet sizes, and a documented
call range.

The included strategy corpus is a **provisional 100bb, unstraddled training
baseline**. The app separately discloses the current Poto room evidence: the
user reports nine-handed, PokerAtlas also lists nine players, and the user's
10% rake capped at $6 recollection matches that listing. Desk verification is
still pending and the current promotional-drop total remains uncertain. None
of those room-cost reports are represented as solver inputs to the action matrix.
Regression tests enforce internal consistency and catch non-monotonic range artifacts,
but they are not a substitute for an independently reviewed solver or
expert-approved corpus. The UI keeps that status visible and binds local
mastery to the corpus fingerprint so a strategy update cannot silently reuse
stale mastery.

The default study loop is a focused 20-decision session designed to take about
10 minutes when explanations are read. It prioritizes due relearning, exact
mistakes, semantic poker boundaries, combination frequency, and under-practiced
concepts. A normal session caps due reviews at 75% so a backlog still leaves
five questions for new coverage; an explicitly targeted leak drill can remain
review-only. A miss is scheduled again after roughly 8 questions, 32 questions,
and on a later day. Only a fluent answer after its scheduled delay advances
durable mastery; early repeats keep the original deadline, and a slow due answer
returns soon. Mastered modes and contexts are discounted below neutral while a
small exploration floor remains. Stable invariant premiums are retired only
after delayed retrieval instead of consuming a fixed answer-category quota. A
reasonable secondary action is accepted, but it does not count as full
default-action mastery.

Stats use the v4 local schema and record the chosen action, response latency,
timestamp, lapses, exact question/context, concept, due state, and strategy
fingerprint. The compact practice-priority dashboard reports exact recurring
wrong actions and sample size and can start a ten-question targeted drill. That
length is deliberate: even a miss on the first targeted decision can reach its
first spaced recheck before the drill ends.
It deliberately labels ranking as practice priority rather than dollars or BB
saved because the provisional corpus does not contain reviewed EV regret.
Earlier stats remain untouched under their prior storage keys and are not
silently imported into the new mastery model.

The 35% first-in / 65% facing-open selection is an explicit curriculum prior
that spends more time on harder facing-open decisions. It is not labeled as
Potawatomi opportunity frequency. Room-frequency and regret weights remain
neutral until they have enough observed or reviewed evidence.

Hero's first-in baseline is separate from the Villain opening model. The
settings expose selected opener-to-Hero spots, and the Villain definition reports
a position-specific combination range instead of treating “tight” or “loose”
as self-explanatory. Feedback shows only counterfactuals actually queried from
the corpus, shows the complete allowed-action plan for a nearby boundary
contrast, and exposes the applicable adjustment rather than reducing mixed
hands to one action label. Small-blind first-in study is explicitly labeled as
a raise-or-fold simplification because the corpus does not model limping.

Before treating the baseline as room-specific, use the
[Poto calibration checklist](docs/POTO_CALIBRATION.md). The ranking objective
and its current evidence limits are documented in
[Training objective](docs/TRAINING_OBJECTIVE.md). Corpus behavior changes are
recorded in the [strategy changelog](docs/STRATEGY_CHANGELOG.md), and UI work
follows the [rendered visual standard](docs/AI_VISUAL_STANDARD.md).

```bash
node --check app.js
node --check poto-evidence.js
node --check trainer-scheduler.js
node --check range-engine.js
node scripts/validate-ranges.js
node scripts/strategy-integrity.js
node scripts/simulate-learning.js
node scripts/smoke-app.js
```
