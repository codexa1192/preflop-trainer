# Rendered UI standard

The rendered trainer is the source of truth for visual and interaction quality.
Code inspection and the fake-DOM smoke test are necessary but insufficient.

For every meaningful UI change:

1. Serve the exact branch locally.
2. Walk a realistic synthetic training session in a real browser.
3. Capture and inspect at least one desktop and one mobile screenshot.
4. Exercise a preferred answer, a wrong answer, a relearning question, an
   empty/new stats state, settings, chart controls, and session completion.
5. Verify keyboard focus, Escape-to-close, focus return, visible feedback,
   touch targets, scrolling, and absence of console errors.
6. Correct issues and repeat the screenshots before merge.

Never capture or commit private browser state or identifying information. This
trainer should contain only synthetic poker decisions and local anonymous
learning statistics.

If browser verification cannot be completed, the handoff must say:
"Visual verification incomplete; code-only UI review performed." and
"UX verification incomplete; flow was not walked."
