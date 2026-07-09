# Bug log

## 2026-07-09 - Next hand kept the mobile scroll position

**Issue:** After reviewing an explanation and tapping **Next Hand**, the new question loaded while the viewport stayed down in the stats section.

**Root Cause:** The next-hand handler rendered the new question but did not return the viewport to the quiz card.

**Fix:** Route the button through a dedicated advance handler that renders the next question and scrolls its context line into view.

**Test:** The app interaction smoke test now verifies that initial load does not force-scroll and a user-triggered next hand scrolls exactly once to the question start.

**Deployment:** Bump the static-script cache key so returning browsers load the corrected handler immediately after GitHub Pages publishes it.
