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

## Session contract

- Default to a focused session of roughly ten minutes.
- A miss returns after about 6-10 questions, again after about 25-40 questions,
  and in a later session.
- A merely acceptable secondary action is reviewed again; it is not mastered.
- An invariant premium decision retires rapidly and receives sparse maintenance.
- Durable mastery requires successful delayed retrieval, not six immediate
  repetitions.
- The session may finish early when no high-value item is due.

## Required scheduler simulations

- No boundary may exist solely because a pair cell touches a non-pair cell on
  the 13-by-13 chart.
- A seeded miss must reappear inside the first review window.
- Mastered invariant premiums must remain below their retention ceiling.
- A strategy fingerprint change must invalidate affected exact mastery.
- A synthetic costly weak spot must receive materially more practice within a
  50-question session than an equally frequent mastered spot.
