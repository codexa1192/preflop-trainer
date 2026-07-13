# Bug log

## 2026-07-12 - Training runtime could distort priority or teach unsupported spots

**Issue:** Unsupported position/mode inputs could become gradeable advice,
exact retention reviews could remain hidden behind context sampling, later
spaced reviews could be starved, modal/hidden time inflated response latency,
non-default passing answers were absent from the leak dashboard, and one
storage write failure disabled persistence for the rest of the session.

**Root Cause:** Recommendation dispatch used permissive fallbacks; the sampler
selected mode and context before most exact evidence; queue urgency favored
early stages; the timer used wall-clock time; the dashboard filtered only
misses; and storage availability was treated as permanently false after one
exception.

**Fix:** Return explicit ungraded recommendations for unsupported inputs; add a
capped exact-priority lane and balanced queue urgency; count only active
question time, including excluding unfocused-window time; cap normal-session
review backlog at 75%; reconstruct pruned spacing stages; show unresolved
acceptable alternatives; retry storage writes without false success; and
render a visible recovery state when any required script, including `app.js`,
is missing. Chart cells now use one roving keyboard tab stop and reveal the
selected explanation.

**Test:** Deterministic range, scheduler, fake-clock, storage-failure,
missing-dependency, dashboard, queue-capacity, and app-flow regressions cover
each behavior.

## 2026-07-09 - Next hand kept the mobile scroll position

**Issue:** After reviewing an explanation and tapping **Next Hand**, the new question loaded while the viewport stayed down in the stats section.

**Root Cause:** The next-hand handler rendered the new question but did not return the viewport to the quiz card.

**Fix:** Route the button through a dedicated advance handler that renders the next question and scrolls its context line into view.

**Test:** The app interaction smoke test now verifies that initial load does not force-scroll and a user-triggered next hand scrolls exactly once to the question start.

**Deployment:** Bump the static-script cache key so returning browsers load the corrected handler immediately after GitHub Pages publishes it.

## 2026-07-10 - Fold coaching mislabeled strong suited hands

**Issue:** QJs from the small blind versus a middle-position open could be a defensible fold, but the explanation incorrectly called it weak and poorly connected.

**Root Cause:** One generic fold-description branch treated every suited hand alike, ignoring the existing broadway and connection traits. A loose-opener adjustment also turned weaker small-blind candidates into calls while leaving QJs as a pure fold.

**Fix:** Give suited broadways, suited aces, one-gappers, and connected hands truthful limitation copy; keep balanced QJs as a fold, introduce 3-bet-or-fold against loose standard opens, and replace prose-driven range adjustments with explicit profile/size metadata.

**Test:** Exact QJs regressions cover balanced, loose, and large-open decisions; low-pair and hand-shape checks prevent over-broad rewrites; exhaustive checks reject false hand-family wording and require facing-open ranges to stay monotonic as the opener moves later.
