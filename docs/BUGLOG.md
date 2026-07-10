# Bug log

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
