Preflop Trainer
===============

Public static poker preflop trainer hosted with GitHub Pages.

Source layout
-------------

- `index.html` - static UI shell.
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

The included live ranges are training defaults. Regression tests enforce
internal consistency, but they are not a substitute for an independently
reviewed solver or expert-approved strategy corpus.

Challenge mode targets explicit mixed hands and one-step range boundaries for
95% of its cold-start questions, while retaining a 5% stable-core review
share. A reasonable secondary action is accepted but does not count as full
default-action mastery. A single hand is capped at 8% of a cold-start context
and 18% after weak-spot adaptation, preventing one boundary hand from taking
over a session.

Stats use the v3 local schema. Earlier results are left untouched under the v2
key but are not imported because the old format cannot distinguish a preferred
answer from a reasonable secondary action or remove the retired generic
facing-3-bet questions safely.

```bash
node --check app.js
node --check trainer-scheduler.js
node --check range-engine.js
node scripts/validate-ranges.js
node scripts/smoke-app.js
```
