Preflop Trainer
===============

Public static poker preflop trainer hosted with GitHub Pages.

Source layout
-------------

- `index.html` - static UI shell.
- `range-engine.js` - single source of truth for live $1/$3 range presets, recommendation logic, grading, and chart output.
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

```bash
node --check app.js
node --check range-engine.js
node scripts/validate-ranges.js
```
