# Potawatomi $1/$3 calibration contract

The trainer must separate three kinds of information:

1. **Room fact** — a current rule confirmed by Potawatomi or at the poker desk.
2. **Observed pool prior** — an anonymous frequency measured over several sessions.
3. **Strategy evidence** — a solver configuration or independent expert review tied to an exact node.

Do not promote an assumption from one category to another. In particular, a
plausible live-poker heuristic is not solver evidence.

## Current public baseline

As of 2026-07-10, Potawatomi's public poker page confirms an active Milwaukee
poker room but does not publish the detailed cash-game rake or buy-in rules.
PokerAtlas currently lists the $1/$3 game as nine-handed with a $100 minimum,
$500 maximum, an optional UTG straddle, 10% rake capped at $6, and a jackpot
drop. These third-party values must be verified at the desk before they are used
as solver inputs.

- Potawatomi: <https://www.potawatomi.com/casino/poker>
- PokerAtlas: <https://www.pokeratlas.com/poker-cash-game/potawatomi-casino-milwaukee-no-limit-holdem-1-3>

## One-session anonymous observation sheet

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

After at least 200 observable opportunities, use the counts only to prioritize
study frequency. Do not infer an opponent's exact range from a small sample.

## Corpus acceptance checklist

Every strategy configuration must state:

- table size, blind structure, rake cap, drop, and straddle state;
- exact effective stack and all action sizes;
- Hero and Villain position-specific ranges;
- fold/call/raise frequency for every trained hand class;
- action EVs or reviewed qualitative regret bands;
- solver name/version, configuration hash, and convergence tolerance, or the
  independent reviewer's dated attestation;
- corpus version and a fingerprint that invalidates stale mastery records.

Until all fields exist, the UI must call the range a **provisional live
baseline**, not GTO, solved, optimal, or verified.
