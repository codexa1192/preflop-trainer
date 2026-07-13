# Training objective

The product objective is to reduce expected preflop loss per minute of study,
not to maximize question count or chart coverage.

The scheduler should approximate:

```text
priority = review_due
         * real_spot_frequency
         * starting_hand_combo_frequency
         * personal_error_probability
         * mistake_cost
```

When sourced action EVs are unavailable, `mistake_cost` must use explicit,
coarse provisional bands rather than fabricated big-blind values.

The active 35% first-in / 65% facing-open split is a curriculum prior chosen to
emphasize more complex decisions. It is not a room-frequency estimate. Until
anonymous context counts meet a predeclared context-level sample and
uncertainty rule, and regret evidence is reviewed, both `real_spot_frequency`
and `mistake_cost` must resolve to neutral weights. Context occurrence belongs
in mode/context selection exactly once;
putting the same context multiplier into a within-context hand draw adds no
information and can create misleading EV language.

## Session contract

- Default to a focused session of roughly ten minutes.
- A miss returns after about 6-10 questions, again after about 25-40 questions,
  and in a later session.
- A merely acceptable secondary action is reviewed again; it is not mastered.
- An invariant premium decision retires rapidly and receives sparse maintenance.
- Durable mastery requires successful delayed retrieval, not six immediate
  repetitions.
- Exact due reviews are selected before aggregate mode and context sampling.
  Non-due personal weak spots may use a capped priority lane, but they must not
  bypass the explicit relearning intervals or recent-question cooldown.
- A normal focus session caps due reviews at 75% of its questions so an old
  backlog cannot eliminate all new coverage. An explicitly targeted leak drill
  may devote its full session to that review sequence.
- Broader concept evidence is only a bounded prior for the first three exact
  observations. It must never dilute an unresolved exact miss.
- The session may finish early when no high-value item is due.

## Required scheduler simulations

- No boundary may exist solely because a pair cell touches a non-pair cell on
  the 13-by-13 chart.
- A seeded miss must reappear inside the first review window.
- A non-queue exact retention review must become globally eligible when due.
- Delayed reviews must not starve behind newly due first reviews.
- Capacity pruning must retain a bounded pool of first reviews and reconstruct
  the next spacing stage when a due queue entry was pruned.
- Concept transfer must taper across early exact observations and never hide an
  exact miss.
- Mastered invariant premiums must remain below their retention ceiling.
- A strategy fingerprint change must invalidate affected exact mastery.
- A synthetic costly weak spot must receive materially more practice within a
  50-question session than an equally frequent mastered spot.
