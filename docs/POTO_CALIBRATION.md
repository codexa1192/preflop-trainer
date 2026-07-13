# Potawatomi $1/$3 calibration contract

The trainer must separate three kinds of information:

1. **Room evidence** — a current rule confirmed by Potawatomi, the owner, or a
   named third-party listing, with its confidence shown.
2. **Observed pool prior** — an anonymous frequency measured over several
   sessions.
3. **Strategy evidence** — a solver configuration or independent expert review
   tied to an exact node.

Confirming a room rule does not prove that a hand recommendation incorporates
that rule. A plausible live-poker heuristic is not solver evidence.

## Current room evidence

Evidence date: **2026-07-12**.

| Item | Current evidence | Status in the trainer |
| --- | --- | --- |
| Table size | The user reports nine-handed; PokerAtlas also lists nine players | User-reported and third-party-listed default |
| Base rake | The user's 10% capped at $6 recollection matches PokerAtlas | Third-party-listed; desk verification, increments, and no-flop treatment remain pending |
| Promotional drop | Official rules describe a first promotional dollar once a qualifying Hold'em pot reaches $15; PokerAtlas lists `$1 on $15+` and `$2 on $30+` | Current amount is uncertain because the official poker page lists no current promotions and the Bad Beat page says that jackpot is suspended |
| Buy-in | PokerAtlas lists $100-$500, about 33-167bb | Third-party-listed room range; not strategy coverage |
| Straddle | PokerAtlas lists UTG only | Third-party-listed position; amount, frequency, and procedure unverified |

Sources:

- Potawatomi poker room: <https://www.potawatomi.com/casino/poker>
- Potawatomi poker house rules: <https://www.potawatomi.com/casino/house-rules>
- Potawatomi Bad Beat Jackpot status: <https://www.potawatomi.com/casino/poker/bad-beat-jackpot>
- PokerAtlas $1/$3 listing: <https://www.pokeratlas.com/poker-cash-game/potawatomi-casino-milwaukee-no-limit-holdem-1-3>

## What the reported cost means

The following is a hypothetical illustration, not production trainer logic or
a statement of the exact collection procedure. It assumes simple continuous
10% math and interprets PokerAtlas's `$2 on $30+` as **$2 total**, not an
additional $2 after the first dollar:

| Pot | Base rake | Listed drop | Illustrated total removed |
| ---: | ---: | ---: | ---: |
| $15 | $1.50 | $1 | $2.50 |
| $30 | $3 | $2 | $5 |
| $60 | $6 | $2 | $8 |

If that interpretation and collection schedule are accurate, marginal
small-pot calls face a substantial headwind, particularly from the small blind
and against large opens. That supports skepticism toward passive marginal
continues; it does **not** reveal exact hand thresholds. Actual rounding,
no-flop-no-drop treatment, whether `$2` is total or additional, and current
promotional collection still need desk confirmation.

## Current strategy scope

The active action matrix remains `poto-live-1-3-provisional-v4`:

- nine-handed, unstraddled;
- 100bb is a **training assumption**, not a verified effective-stack range;
- standard and large open-size classes are qualitative, not exact sizes;
- small-blind first-in uses a raise-or-fold simplification; limping is not in
  the active tree;
- rake and promotional drop are disclosed but were not solver inputs;
- no action EVs, numeric mixed frequencies, or reviewed regret bands exist;
- the 35% first-in / 65% facing-open mix is curriculum emphasis, not observed
  room frequency.

The trainer must not call these answers GTO, solved, optimal, rake-adjusted, or
expert-reviewed.

## Solve and review gate

Before a recommendation can be promoted from provisional, its exact node must
include:

- table size, blind structure, exact stack, ante, rake, drop, and straddle
  state;
- exact open, call, 3-bet, 4-bet, and all-in sizes available at that node;
- Hero and Villain position-specific action ranges and numeric frequencies;
- per-action EVs for boundary hands or a dated qualitative-regret review;
- solver name/version, shared configuration, output hash, and convergence
  evidence, or an independent reviewer's dated attestation;
- sensitivity checks across relevant stack, open-size, and uncertain rake/drop
  variants;
- a corpus version and action fingerprint that invalidates stale mastery when
  an answer changes.

Because the stepwise promotional drop is not reproduced by a simple
percentage-and-cap input, Poto work should use rake sensitivity bounds. A
simplified preferred action should be published only when it remains stable
across the relevant bounds; otherwise the trainer should label it mixed or
withhold grading.

## Current product priority

The following order is a product choice based on structural adjacency to the
active single-raised-pot trainer and on avoiding strategy transfer between
different game trees. It is not claimed to be measured Poto spot frequency:

1. Open plus one caller: fold, call, or squeeze from late position and blinds.
2. Hero opens and faces a 3-bet: fold, call, or 4-bet with positions and sizes.
3. One limper: fold, overlimp, or isolate after room frequency is observed.
4. UTG-straddled hands after the amount and procedure are verified.
5. Multiple limpers/callers only with explicit multiway-solver limitations.

Do not map a single-raised-pot chart onto these different game trees.

## Anonymous observation sheet

Record counts only. Do not record player names, descriptions, seat identities,
or private information.

| Observation | Suggested buckets |
| --- | --- |
| Effective stack when Hero enters a hand | under $200 / $200-$299 / $300-$399 / $400+ |
| First open size | $6-$8 / $9 / $10-$12 / $13-$15 / $16+ |
| Limpers before Hero | 0 / 1 / 2 / 3+ |
| Openers before Hero | unopened / one open / open plus caller(s) |
| Preflop 3-bet size | under 3x / 3-4x / over 4x |
| UTG straddle | on / off |
| Table occupancy | 9 / 8 / 7 or fewer |

Treat 200 overall observable opportunities as a **provisional collection
checkpoint**, not statistical sufficiency. Before any individual context can
affect study frequency, predeclare a context-level sample and uncertainty rule.
Until that rule is met, low-sample or unverified contexts must resolve to
neutral weight rather than fake precision.
