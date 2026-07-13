#!/usr/bin/env node
"use strict";

const assert = require("assert");
const engine = require("../range-engine.js");
const scheduler = require("../trainer-scheduler.js");

const START = 1_720_000_000_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const QUESTION = "VS_OPEN:MP3>SB:QJs:BALANCED:STANDARD";
const CONCEPT = "VS_OPEN:MP3>SB:QJs:STANDARD";

function freshStats(version) {
  return scheduler.ensureAdaptiveStats({
    strategyVersion: version || scheduler.CURRENT_STRATEGY_VERSION,
    sequence: 0,
    byQuestion: {},
    byConcept: {},
    relearningQueue: [],
    recentQuestions: [],
    recentContexts: [],
    recentHands: []
  });
}

function answer(stats, overrides) {
  const sequence = stats.sequence + 1;
  return scheduler.recordQuestionResult(stats, {
    questionKey: QUESTION,
    conceptKey: CONCEPT,
    contextKey: "VS_OPEN:MP3>SB",
    hand: "QJs",
    strategyVersion: scheduler.CURRENT_STRATEGY_VERSION,
    timestamp: START + sequence * 1000,
    responseLatencyMs: 3500,
    chosenAction: "FOLD",
    sessionId: "SESSION_1",
    reviewData: {
      mode: "VS_OPEN",
      openerPosition: "MP3",
      heroPosition: "SB",
      hand: "QJs",
      openerProfile: "BALANCED",
      openSize: "STANDARD",
      ignoredPrivateField: "must_not_persist"
    },
    isPassing: true,
    isPreferred: true,
    ...overrides
  });
}

function filler(stats, index) {
  scheduler.recordQuestionResult(stats, {
    questionKey: `RFI:BTN:72o:BALANCED:F${index}`,
    contextKey: "RFI:BTN",
    hand: "72o",
    timestamp: START + (stats.sequence + 1) * 1000,
    isPassing: true,
    isPreferred: true
  });
}

// Cold-start scoring must preserve the product's high-value boundary focus.
// This catches absolute score floors that multiply across the much larger core
// pool and quietly turn a fresh session into mostly easy hands.
const DEFAULT_RFI_CONTEXTS = ["MP3", "CO", "BTN", "SB"].map((position) => ({
  mode: engine.MODES.RFI,
  position,
  heroBaseline: "BALANCED"
}));
const DEFAULT_VS_CONTEXTS = [
  "UTG>BTN", "UTG>BB", "MP3>BTN", "MP3>SB", "MP3>BB",
  "CO>BTN", "CO>SB", "CO>BB", "BTN>SB", "BTN>BB"
].map((key) => {
  const [openerPosition, heroPosition] = key.split(">");
  return {
    mode: engine.MODES.VS_OPEN,
    openerPosition,
    heroPosition,
    openerProfile: "BALANCED",
    openSize: "STANDARD"
  };
});

function coldStartDistribution(args) {
  const rows = engine.ALL_HAND_CLASSES.map((hand) => ({
    hand,
    recommendation: engine.recommend({ ...args, hand })
  }));
  const base = scheduler.buildChallengeOptions(rows, {
    actionWeights: {},
    coreShare: 0.08,
    excludeHands: ["AA", "KK", "QQ", "AKs", "AKo"],
    maxSharePerHand: 0.08
  });
  const scored = base.map((option) => ({
    ...option,
    weight: scheduler.scoreHandOption({
      hand: option.hand,
      samplingWeight: option.weight,
      comboWeight: scheduler.comboCount(option.hand) / 12,
      sequence: 0,
      now: START
    })
  }));
  const capped = scheduler.capWeightedOptions(scored, 0.18);
  return {
    challenge: capped.filter((option) => option.tier === "CHALLENGE")
      .reduce((sum, option) => sum + option.weight, 0),
    maxHand: Math.max(...capped.map((option) => option.weight))
  };
}

const rfiColdStart = DEFAULT_RFI_CONTEXTS.map(coldStartDistribution);
const vsColdStart = DEFAULT_VS_CONTEXTS.map(coldStartDistribution);
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const weightedDefaultChallenge = 0.35 * average(rfiColdStart.map((row) => row.challenge)) +
  0.65 * average(vsColdStart.map((row) => row.challenge));
assert(
  rfiColdStart.concat(vsColdStart).every((row) => row.challenge >= 0.85 && row.maxHand <= 0.1800001) &&
    weightedDefaultChallenge >= 0.88,
  "Cold-start focused study keeps at least 85% challenge mass per context and 88% across the default mix"
);

const exactPriorityFixtures = [
  {
    questionKey: "RFI:BTN:DUE:BALANCED:NA",
    record: { total: 4, correct: 4, preferred: 4, dueAt: START - 1, preferredStreak: 4 },
    unresolved: false
  },
  {
    questionKey: "RFI:CO:WEAK:BALANCED:NA",
    record: { total: 3, correct: 1, preferred: 1, lastMissedAt: 2, preferredStreak: 0, lapses: 2 },
    unresolved: true
  },
  {
    questionKey: "RFI:SB:FRESH:BALANCED:NA",
    record: { total: 2, correct: 2, preferred: 2, dueAt: START + 100_000, preferredStreak: 2 },
    unresolved: false
  }
];
const exactPriority = scheduler.buildExactPriorityOptions(exactPriorityFixtures, {
  sequence: 10,
  now: START
});
assert(
  exactPriority.some((row) => row.questionKey.includes(":DUE:") && row.dueNow),
  "A non-queue retention review can win before mode and context selection when its exact due time arrives"
);
assert(
  exactPriority.some((row) => row.questionKey.includes(":WEAK:") && !row.dueNow),
  "A weak exact decision can enter the global adaptive-priority lane"
);
assert(
  !exactPriority.some((row) => row.questionKey.includes(":FRESH:")),
  "A passing exact decision that is not due does not displace ordinary coverage"
);
assert(
  !scheduler.buildExactPriorityOptions(exactPriorityFixtures, {
    sequence: 10,
    now: START,
    recentQuestionKeys: ["RFI:CO:WEAK:BALANCED:NA"]
  }).some((row) => row.questionKey.includes(":WEAK:")),
  "A non-due weak exact decision still respects the recent-question cooldown"
);
assert(
  !scheduler.buildExactPriorityOptions(exactPriorityFixtures, {
    sequence: 10,
    now: START,
    excludedQuestionKeys: ["RFI:CO:WEAK:BALANCED:NA"]
  }).some((row) => row.questionKey.includes(":WEAK:")),
  "An exact decision already in the spaced queue cannot bypass its scheduled interval"
);

let boundedDueDraws = 0;
for (let answered = 0; answered < 20; answered += 1) {
  if (scheduler.allowsDueReview({ answered, dueDrawn: boundedDueDraws, maxShare: 0.75 })) {
    boundedDueDraws += 1;
  }
}
assert.strictEqual(boundedDueDraws, 15, "A focus session reserves five of twenty slots for new coverage during a due backlog");
assert(
  Array.from({ length: 10 }, (_value, answered) => scheduler.allowsDueReview({
    sessionKind: "TARGETED",
    answered,
    dueDrawn: answered,
    maxShare: 0.75
  })).every(Boolean),
  "An explicitly targeted review session can spend every slot on its selected leak"
);

const masteredConcept = {
  total: 10,
  correct: 10,
  preferred: 10,
  preferredStreak: 6,
  fluentPreferredStreak: 6,
  qualifiedRetrievalStreak: 6,
  isInvariant: true
};
const oneFluentExact = {
  total: 1,
  correct: 1,
  preferred: 1,
  preferredStreak: 1,
  fluentPreferredStreak: 1,
  averageLatencyMs: 1500
};
const conceptOnlyScore = scheduler.scoreHandOption({
  conceptRecord: masteredConcept,
  sequence: 10,
  now: START,
  isInvariant: true
});
const exactOnlyScore = scheduler.scoreHandOption({
  record: oneFluentExact,
  sequence: 10,
  now: START,
  isInvariant: true
});
const blendedScore = scheduler.scoreHandOption({
  record: oneFluentExact,
  conceptRecord: masteredConcept,
  sequence: 10,
  now: START,
  isInvariant: true
});
assert(
  blendedScore > conceptOnlyScore && blendedScore < exactOnlyScore,
  "The first exact success blends with broader concept evidence instead of causing an all-or-nothing priority jump"
);

const exactMiss = {
  total: 1,
  correct: 0,
  preferred: 0,
  lastMissedAt: 1,
  preferredStreak: 0,
  relearningStage: 0,
  lapses: 1
};
assert.strictEqual(
  scheduler.scoreHandOption({ record: exactMiss, conceptRecord: masteredConcept, sequence: 10, now: START }),
  scheduler.scoreHandOption({ record: exactMiss, sequence: 10, now: START }),
  "Concept transfer can never wash out an unresolved exact miss"
);

const threeExact = {
  total: 3,
  correct: 3,
  preferred: 3,
  preferredStreak: 3,
  fluentPreferredStreak: 3,
  qualifiedRetrievalStreak: 3,
  averageLatencyMs: 1500
};
assert.strictEqual(
  scheduler.scoreHandOption({ record: threeExact, conceptRecord: masteredConcept, sequence: 10, now: START }),
  scheduler.scoreHandOption({ record: threeExact, sequence: 10, now: START }),
  "After three exact observations, exact evidence fully replaces the concept prior"
);

// A miss must become an exact-node review after eight intervening questions.
const relearning = freshStats();
answer(relearning, {
  isPassing: false,
  isPreferred: false,
  chosenAction: "CALL"
});
assert.strictEqual(relearning.relearningQueue.length, 1, "A miss creates one explicit review");
assert.strictEqual(relearning.relearningQueue[0].dueSequence, 9, "First relearning target is +8 questions");
assert.deepStrictEqual(
  Object.keys(relearning.relearningQueue[0].reviewData).sort(),
  ["hand", "heroPosition", "mode", "openSize", "openerPosition", "openerProfile"].sort(),
  "Only the bounded question descriptor is retained"
);
const rfiReview = freshStats();
scheduler.recordQuestionResult(rfiReview, {
  questionKey: "RFI:BTN:Q9s:BALANCED:NA",
  conceptKey: "RFI:BTN:Q9s:OPEN",
  contextKey: "RFI:BTN",
  hand: "Q9s",
  strategyVersion: scheduler.CURRENT_STRATEGY_VERSION,
  timestamp: START,
  responseLatencyMs: 3500,
  chosenAction: "PASS",
  sessionId: "SESSION_1",
  mode: "RFI",
  position: "BTN",
  heroBaseline: "BALANCED",
  isPassing: false,
  isPreferred: false
});
assert.strictEqual(
  rfiReview.relearningQueue[0].reviewData.heroBaseline,
  "BALANCED",
  "RFI queue descriptors retain the exact Hero baseline"
);
const noMassedEscape = freshStats();
answer(noMassedEscape, { isPassing: false, isPreferred: false, chosenAction: "CALL" });
for (let attempt = 0; attempt < 6; attempt += 1) answer(noMassedEscape);
assert.strictEqual(
  noMassedEscape.relearningQueue.length,
  1,
  "Massed repeats before the due sequence cannot cancel spaced relearning"
);
const oneQuestionEarly = freshStats();
answer(oneQuestionEarly, { isPassing: false, isPreferred: false, chosenAction: "CALL" });
for (let index = 0; index < 7; index += 1) filler(oneQuestionEarly, index);
answer(oneQuestionEarly);
assert(
  oneQuestionEarly.relearningQueue.length === 1 &&
    oneQuestionEarly.relearningQueue[0].stage === 0 &&
    oneQuestionEarly.relearningQueue[0].dueSequence === 9,
  "An answer shown one question before the review deadline cannot advance the queue as it increments sequence"
);
const independentRetention = freshStats();
answer(independentRetention, { isPassing: false, isPreferred: false, chosenAction: "CALL" });
for (let index = 0; index < 8; index += 1) filler(independentRetention, index);
answer(independentRetention);
const pendingSecondReview = { ...independentRetention.relearningQueue[0] };
const retentionDueAt = independentRetention.byQuestion[QUESTION].dueAt;
assert.strictEqual(pendingSecondReview.stage, 1, "The isolated queue fixture reaches its +32 stage");
assert.strictEqual(
  scheduler.getNextRelearningQuestion(independentRetention, {
    sequence: independentRetention.sequence,
    now: retentionDueAt,
    availableQuestionKeys: [QUESTION]
  }),
  null,
  "A separate retention deadline does not make the +32 queue review due"
);
answer(independentRetention, { timestamp: retentionDueAt });
assert(
  independentRetention.relearningQueue[0].stage === pendingSecondReview.stage &&
    independentRetention.relearningQueue[0].dueSequence === pendingSecondReview.dueSequence,
  "A due retention answer cannot skip an independent +32 relearning review"
);
const prunedQueueRetention = freshStats();
prunedQueueRetention.sequence = 10;
prunedQueueRetention.byQuestion[QUESTION] = {
  total: 2,
  correct: 2,
  preferred: 2,
  preferredStreak: 2,
  fluentPreferredStreak: 2,
  qualifiedRetrievalStreak: 1,
  intervalMs: DAY_MS,
  dueAt: START,
  relearningStage: 1,
  nextReviewSequence: 42
};
answer(prunedQueueRetention, { timestamp: START });
assert(
  prunedQueueRetention.byQuestion[QUESTION].relearningStage === 1 &&
    prunedQueueRetention.byQuestion[QUESTION].nextReviewSequence === 42 &&
    prunedQueueRetention.byQuestion[QUESTION].qualifiedRetrievalStreak === 2 &&
    prunedQueueRetention.byQuestion[QUESTION].dueAt === START + 3 * DAY_MS,
  "A pruned future queue stage preserves its sequence deadline without discarding a new retention deadline"
);
const slowQueueReview = freshStats();
answer(slowQueueReview, { isPassing: false, isPreferred: false, chosenAction: "CALL" });
for (let index = 0; index < 8; index += 1) filler(slowQueueReview, index);
const slowReviewAt = START + (slowQueueReview.sequence + 1) * 1000;
answer(slowQueueReview, { timestamp: slowReviewAt, responseLatencyMs: 12_000 });
assert(
  slowQueueReview.relearningQueue[0].stage === 0 &&
    slowQueueReview.relearningQueue[0].dueSequence === 0 &&
    slowQueueReview.relearningQueue[0].dueAt === slowReviewAt + 6 * HOUR_MS,
  "A slow due answer stays in relearning and receives the advertised six-hour retry"
);
assert.strictEqual(
  scheduler.getNextRelearningQuestion(slowQueueReview, {
    sequence: slowQueueReview.sequence,
    now: slowReviewAt + 6 * HOUR_MS - 1,
    availableQuestionKeys: [QUESTION]
  }),
  null,
  "The slow-answer retry does not appear before six hours"
);
assert(
  scheduler.getNextRelearningQuestion(slowQueueReview, {
    sequence: slowQueueReview.sequence,
    now: slowReviewAt + 6 * HOUR_MS,
    availableQuestionKeys: [QUESTION]
  }),
  "The slow-answer retry becomes drawable at six hours"
);
const prunedSlowRetryAt = slowQueueReview.relearningQueue[0].dueAt;
slowQueueReview.relearningQueue = [];
answer(slowQueueReview, { timestamp: prunedSlowRetryAt, responseLatencyMs: 3000 });
assert(
  slowQueueReview.relearningQueue.length === 1 &&
    slowQueueReview.relearningQueue[0].stage === 1 &&
    slowQueueReview.relearningQueue[0].dueSequence === slowQueueReview.sequence + 32,
  "A due time-based retry reconstructs and advances after queue-capacity pruning"
);
for (let index = 0; index < 7; index += 1) {
  filler(relearning, index);
}
assert.strictEqual(
  scheduler.getNextRelearningQuestion(relearning, { sequence: relearning.sequence, now: START + 8000 }),
  null,
  "A miss is not repeated too early"
);
filler(relearning, 7);
let due = scheduler.getNextRelearningQuestion(relearning, {
  sequence: relearning.sequence,
  now: START + 9000,
  availableQuestionKeys: [QUESTION]
});
assert(due && due.questionKey === QUESTION, "The exact miss recurs at the +8 target");
assert.strictEqual(due.reviewData.hand, "QJs", "Due reviews retain their reconstruction descriptor");

answer(relearning);
assert.strictEqual(relearning.relearningQueue[0].stage, 1, "A successful first review advances the queue");
assert.strictEqual(
  relearning.relearningQueue[0].dueSequence,
  relearning.sequence + 32,
  "Second relearning target is +32 questions"
);
while (relearning.sequence < relearning.relearningQueue[0].dueSequence) {
  filler(relearning, relearning.sequence);
}
assert(scheduler.getNextRelearningQuestion(relearning, {
  sequence: relearning.sequence,
  now: START + relearning.sequence * 1000
}), "The second exact-node review becomes due");
answer(relearning);
assert.strictEqual(relearning.relearningQueue[0].stage, 2, "Second success advances to delayed review");
assert.strictEqual(
  scheduler.getNextRelearningQuestion(relearning, {
    sequence: relearning.sequence,
    now: START + relearning.sequence * 1000
  }),
  null,
  "Delayed review is not immediately due"
);
assert.strictEqual(scheduler.getNextRelearningQuestion(relearning, {
  sequence: relearning.sequence,
  now: START + relearning.sequence * 1000,
  sessionId: "SESSION_2"
}), null, "Restarting immediately does not defeat delayed spacing");
assert(scheduler.getNextRelearningQuestion(relearning, {
  sequence: relearning.sequence,
  now: START + relearning.sequence * 1000 + 24 * 60 * 60 * 1000,
  sessionId: "SESSION_2"
}), "The delayed review becomes due after one day");
const competingReviews = freshStats();
competingReviews.sequence = 100;
competingReviews.relearningQueue = [
  {
    questionKey: "RFI:BTN:Q9s:BALANCED:NA",
    conceptKey: "RFI:BTN:Q9s:OPEN",
    stage: 0,
    dueSequence: 95,
    dueAt: 0,
    enqueuedAt: START,
    reason: "MISSED",
    sessionId: "SESSION_1",
    reviewData: { mode: "RFI", position: "BTN", hand: "Q9s", heroBaseline: "BALANCED" }
  },
  {
    questionKey: "RFI:CO:JTs:BALANCED:NA",
    conceptKey: "RFI:CO:JTs:OPEN",
    stage: 2,
    dueSequence: 0,
    dueAt: START - 60 * 60 * 1000,
    enqueuedAt: START - 24 * 60 * 60 * 1000,
    reason: "MISSED",
    sessionId: "SESSION_0",
    reviewData: { mode: "RFI", position: "CO", hand: "JTs", heroBaseline: "BALANCED" }
  }
];
const orderedReviews = scheduler.getDueRelearning(competingReviews, {
  sequence: competingReviews.sequence,
  now: START
});
assert.strictEqual(
  orderedReviews[0].questionKey,
  "RFI:CO:JTs:BALANCED:NA",
  "A due delayed-retrieval review is not starved by a first review already five questions overdue"
);

const boundedQueue = freshStats();
boundedQueue.relearningQueue = Array.from({ length: 199 }, (_value, index) => ({
  questionKey: `RFI:BTN:Q${index}:BALANCED:NA`,
  conceptKey: "",
  stage: 0,
  dueSequence: index + 1,
  dueAt: 0,
  enqueuedAt: START + index,
  reason: "MISSED",
  sessionId: "SESSION_1",
  reviewData: {}
})).concat([
  {
    questionKey: "RFI:CO:DELAYEDA:BALANCED:NA",
    conceptKey: "",
    stage: 2,
    dueSequence: 0,
    dueAt: START + 1000,
    enqueuedAt: START - 1000,
    reason: "MISSED",
    sessionId: "SESSION_1",
    reviewData: {}
  },
  {
    questionKey: "RFI:CO:DELAYEDB:BALANCED:NA",
    conceptKey: "",
    stage: 2,
    dueSequence: 0,
    dueAt: START + 2000,
    enqueuedAt: START - 2000,
    reason: "MISSED",
    sessionId: "SESSION_1",
    reviewData: {}
  }
]);
scheduler.ensureAdaptiveStats(boundedQueue);
assert(
  boundedQueue.relearningQueue.some((entry) => entry.questionKey.includes("DELAYEDA")) &&
    boundedQueue.relearningQueue.some((entry) => entry.questionKey.includes("DELAYEDB")),
  "Queue pruning preserves every later-stage delayed review before dropping early-stage items"
);

const mixedCapacityQueue = freshStats();
mixedCapacityQueue.relearningQueue = Array.from({ length: 200 }, (_value, index) => ({
  questionKey: `RFI:CO:DURABLE${index}:BALANCED:NA`,
  stage: 2,
  enqueuedAt: START + index,
  dueAt: START + 100_000
})).concat(Array.from({ length: 50 }, (_value, index) => ({
  questionKey: `RFI:BTN:FIRST${index}:BALANCED:NA`,
  stage: 0,
  enqueuedAt: START + 1000 + index,
  dueSequence: index + 1
})));
scheduler.ensureAdaptiveStats(mixedCapacityQueue);
assert.strictEqual(
  mixedCapacityQueue.relearningQueue.filter((entry) => entry.stage === 0).length,
  40,
  "Queue pruning reserves a bounded pool of recent first reviews alongside durable retrieval"
);

const reconstructPrunedReview = freshStats();
reconstructPrunedReview.sequence = 20;
reconstructPrunedReview.byQuestion[QUESTION] = {
  total: 1,
  correct: 0,
  preferred: 0,
  lastMissedAt: 1,
  preferredStreak: 0,
  relearningStage: 0,
  nextReviewSequence: 9,
  conceptKey: CONCEPT
};
answer(reconstructPrunedReview, { timestamp: START + 21_000 });
assert(
  reconstructPrunedReview.relearningQueue.length === 1 &&
    reconstructPrunedReview.relearningQueue[0].stage === 1 &&
    reconstructPrunedReview.relearningQueue[0].dueSequence === reconstructPrunedReview.sequence + 32,
  "Answering a due review whose queue entry was capacity-pruned reconstructs the next spacing stage"
);

const preserveEarlyPrunedReview = freshStats();
preserveEarlyPrunedReview.byQuestion[QUESTION] = {
  total: 1,
  correct: 0,
  preferred: 0,
  lastMissedAt: 1,
  preferredStreak: 0,
  relearningStage: 0,
  nextReviewSequence: 100,
  conceptKey: CONCEPT
};
answer(preserveEarlyPrunedReview, { timestamp: START + 1000 });
assert(
  preserveEarlyPrunedReview.relearningQueue.length === 0 &&
    preserveEarlyPrunedReview.byQuestion[QUESTION].relearningStage === 0 &&
    preserveEarlyPrunedReview.byQuestion[QUESTION].nextReviewSequence === 100,
  "An early repetition cannot advance or erase a capacity-pruned review before it is due"
);

const finalReviewAt = relearning.relearningQueue[0].dueAt;
answer(relearning, { sessionId: "SESSION_2", timestamp: finalReviewAt });
assert.strictEqual(relearning.relearningQueue.length, 0, "A successful delayed review clears relearning");

const qjsRecord = relearning.byQuestion[QUESTION];
assert.strictEqual(qjsRecord.relearningStage, -1, "Completed relearning clears its mirrored queue stage");
assert.strictEqual(qjsRecord.qualifiedRetrievalStreak, 3, "All three delayed fluent reviews count as qualified retrievals");
assert.strictEqual(qjsRecord.dueAt, finalReviewAt + 7 * DAY_MS, "Final relearning preserves the new seven-day retention deadline");
assert.strictEqual(qjsRecord.lapses, 1, "Misses persist as lapses");
assert.strictEqual(qjsRecord.actionCounts.CALL, 1, "Wrong-action evidence is retained");
assert.strictEqual(qjsRecord.actionCounts.FOLD, 3, "Preferred-action evidence is retained");
assert.strictEqual(qjsRecord.lastChosenAction, "FOLD", "The last chosen action is available to leak summaries");
assert(qjsRecord.averageLatencyMs > 0 && qjsRecord.lastSeenAt > 0, "Latency and timestamps persist");
assert.strictEqual(relearning.byConcept[CONCEPT].total, 4, "Exact attempts transfer into concept mastery");

// Semantic topology cannot cross pair/suited/offsuit families.
["AA", "76s", "98o"].forEach((hand) => {
  const family = scheduler.handFamily(hand);
  const neighbors = scheduler.semanticNeighboringHands(hand);
  assert(neighbors.length > 0, `${hand} has semantic neighbors`);
  assert(neighbors.every((neighbor) => scheduler.handFamily(neighbor) === family), `${hand} stays in its family`);
});
assert(scheduler.semanticNeighboringHands("76s").includes("65s"), "Connected suited hands compare to adjacent connectors");
const syntheticPools = scheduler.classifyDecisionBoundaryRows([
  { hand: "AA", recommendation: { primaryAction: "OPEN", allowedActions: ["OPEN"] } },
  { hand: "KK", recommendation: { primaryAction: "OPEN", allowedActions: ["OPEN"] } },
  { hand: "AKs", recommendation: { primaryAction: "FOLD", allowedActions: ["FOLD"] } },
  { hand: "AKo", recommendation: { primaryAction: "FOLD", allowedActions: ["FOLD"] } }
]);
assert(syntheticPools.core.some((row) => row.hand === "AA"), "AA is not a false edge against AKs/AKo");

// Fast answers only become durable evidence when they are retrieved after the
// scheduled delay. Immediate repetitions cannot manufacture mastery.
const massedAcquisition = freshStats();
for (let attempt = 0; attempt < 6; attempt += 1) {
  answer(massedAcquisition, { timestamp: START + attempt * 1000 });
}
const massedRecord = massedAcquisition.byQuestion[QUESTION];
assert.strictEqual(massedRecord.qualifiedRetrievalStreak, 0, "Immediate repetitions do not count as delayed retrieval");
assert.strictEqual(scheduler.retentionTier(massedRecord), "LEARNING", "Immediate repetitions cannot produce mastery");
assert.strictEqual(
  massedRecord.dueAt,
  START + 6 * 60 * 60 * 1000,
  "Early repetitions preserve the original first-review deadline"
);

const delayedAcquisition = freshStats();
answer(delayedAcquisition, { timestamp: START });
const firstRetentionDue = delayedAcquisition.byQuestion[QUESTION].dueAt;
answer(delayedAcquisition, { timestamp: firstRetentionDue });
assert.strictEqual(
  delayedAcquisition.byQuestion[QUESTION].qualifiedRetrievalStreak,
  1,
  "A fluent answer after the scheduled delay advances durable retrieval"
);
assert.strictEqual(
  delayedAcquisition.byQuestion[QUESTION].dueAt,
  firstRetentionDue + 24 * 60 * 60 * 1000,
  "The first qualified retrieval advances to a one-day interval"
);

const slowDelayedAcquisition = freshStats();
answer(slowDelayedAcquisition, { timestamp: START });
const slowRetentionDue = slowDelayedAcquisition.byQuestion[QUESTION].dueAt;
answer(slowDelayedAcquisition, { timestamp: slowRetentionDue, responseLatencyMs: 12_000 });
assert.strictEqual(
  slowDelayedAcquisition.byQuestion[QUESTION].qualifiedRetrievalStreak,
  0,
  "A slow due answer does not advance fluent retrieval mastery"
);
assert.strictEqual(
  slowDelayedAcquisition.byQuestion[QUESTION].dueAt,
  slowRetentionDue + 6 * 60 * 60 * 1000,
  "A slow due answer is scheduled again soon"
);

// Invariant premiums retire after two fluent, delayed retrievals.
const invariant = freshStats();
const invariantTimes = [START, START + 6 * 60 * 60 * 1000, START + 30 * 60 * 60 * 1000];
for (let attempt = 0; attempt < invariantTimes.length; attempt += 1) {
  scheduler.recordQuestionResult(invariant, {
    questionKey: "RFI:BTN:AA:BALANCED:NA",
    conceptKey: "RFI:BTN:AA",
    contextKey: "RFI:BTN",
    hand: "AA",
    timestamp: invariantTimes[attempt],
    responseLatencyMs: 1200,
    chosenAction: "OPEN",
    isPassing: true,
    isPreferred: true,
    isInvariant: true
  });
}
const invariantRecord = invariant.byQuestion["RFI:BTN:AA:BALANCED:NA"];
assert.strictEqual(
  scheduler.retentionTier(invariantRecord),
  "STABLE",
  "Two fluent delayed retrievals move an invariant decision to stable retention"
);
assert(
  scheduler.scoreHandOption({ record: invariantRecord, sequence: invariant.sequence, now: START + 10_000 }) <=
    scheduler.INVARIANT_RETENTION_CEILING,
  "Stable invariant premiums stay below the retention ceiling"
);

const unseen = scheduler.scoreHandOption({ sequence: invariant.sequence, now: START + 10_000 });
const stableShare = scheduler.scoreHandOption({
  record: invariantRecord,
  sequence: invariant.sequence,
  now: START + 10_000
});
assert(stableShare < unseen * 0.15, "Mastered stable material loses most of its sampling share");

const noLatency = freshStats();
for (let attempt = 0; attempt < 2; attempt += 1) {
  scheduler.recordQuestionResult(noLatency, {
    questionKey: "RFI:BTN:KK:BALANCED:NA",
    contextKey: "RFI:BTN",
    hand: "KK",
    isPassing: true,
    isPreferred: true,
    isInvariant: true,
    timestamp: START + attempt * 1000
  });
}
assert.strictEqual(
  noLatency.byQuestion["RFI:BTN:KK:BALANCED:NA"].fluentPreferredStreak,
  0,
  "Missing response latency never invents fluent recall"
);

// End-to-end weighted drawing favors a costly weak spot over equally frequent
// unseen and mastered items across a realistic 50-question horizon.
let randomState = 246813579;
function seededRandom() {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 4294967296;
}
const drawCandidates = [
  {
    id: "costly-weak",
    weight: scheduler.scoreHandOption({
      record: { total: 6, correct: 0, preferred: 0, lastSeen: 1, lastMissedAt: 1 },
      sequence: 50,
      now: START,
      occurrenceWeight: 1,
      comboWeight: 1,
      regretWeight: 3
    })
  },
  {
    id: "unseen",
    weight: scheduler.scoreHandOption({
      sequence: 50,
      now: START,
      occurrenceWeight: 1,
      comboWeight: 1,
      regretWeight: 1
    })
  },
  {
    id: "mastered",
    weight: scheduler.scoreHandOption({
      record: {
        total: 8,
        correct: 8,
        preferred: 8,
        correctStreak: 8,
        preferredStreak: 8,
        fluentPreferredStreak: 8,
        qualifiedRetrievalStreak: 8,
        dueAt: START + 7 * 24 * 60 * 60 * 1000
      },
      sequence: 50,
      now: START,
      occurrenceWeight: 1,
      comboWeight: 1,
      regretWeight: 1
    })
  }
];
const drawCounts = { "costly-weak": 0, unseen: 0, mastered: 0 };
for (let draw = 0; draw < 50; draw += 1) {
  const totalWeight = drawCandidates.reduce((sum, row) => sum + row.weight, 0);
  let roll = seededRandom() * totalWeight;
  const selected = drawCandidates.find((row) => {
    roll -= row.weight;
    return roll <= 0;
  }) || drawCandidates[drawCandidates.length - 1];
  drawCounts[selected.id] += 1;
}
assert(
  drawCounts["costly-weak"] > drawCounts.unseen * 2 &&
    drawCounts.unseen > drawCounts.mastered,
  "A seeded 50-question draw materially prioritizes the costly weak spot"
);

assert.strictEqual(
  scheduler.scoreHandOption({ occurrenceWeight: 0, regretWeight: 1 }),
  0,
  "A calibrated zero-frequency node can be excluded"
);

// Combination frequency and EV inputs affect priority multiplicatively.
const suitedPriority = scheduler.scoreLearningPriority({ hand: "AKs", occurrenceWeight: 2, regretWeight: 3 });
const offsuitPriority = scheduler.scoreLearningPriority({ hand: "AKo", occurrenceWeight: 2, regretWeight: 3 });
assert(Math.abs(offsuitPriority / suitedPriority - 3) < 1e-9, "Twelve offsuit combos carry 3x four suited combos");
assert.strictEqual(scheduler.comboCount("AA"), 6);
assert.strictEqual(scheduler.comboCount("AKs"), 4);
assert.strictEqual(scheduler.comboCount("AKo"), 12);

// Concept mastery transfers, but strategy revisions invalidate strategy-dependent learning state.
const conceptOnly = scheduler.scoreHandOption({
  conceptRecord: invariant.byConcept["RFI:BTN:AA"],
  isInvariant: true,
  sequence: invariant.sequence,
  now: START + 10_000
});
assert(conceptOnly < unseen, "A mastered equivalent concept transfers to an unseen exact node");
scheduler.invalidateStrategyVersion(invariant, "v5-reviewed-corpus");
assert.strictEqual(invariant.strategyVersion, "v5-reviewed-corpus");
assert.strictEqual(Object.keys(invariant.byQuestion).length, 0, "A version change clears exact mastery");
assert.strictEqual(Object.keys(invariant.byConcept).length, 0, "A version change clears transferred mastery");
assert.strictEqual(invariant.relearningQueue.length, 0, "A version change clears obsolete reviews");

// Persistence keeps bounded action evidence and rejects a mismatched strategy corpus.
const restored = freshStats();
scheduler.restoreAdaptiveStats(restored, {
  strategyVersion: scheduler.CURRENT_STRATEGY_VERSION,
  sequence: 4,
  byQuestion: {
    [QUESTION]: {
      total: 4,
      correct: 2,
      preferred: 2,
      actionCounts: { CALL: 2, FOLD: 2, "unsafe action": 99 },
      lastChosenAction: "FOLD",
      lapses: 2,
      averageLatencyMs: 4200,
      latencySamples: 4
    }
  }
});
assert.deepStrictEqual(restored.byQuestion[QUESTION].actionCounts, { CALL: 2, FOLD: 2 });
const mismatch = freshStats();
mismatch.byQuestion.OLD = { total: 1 };
scheduler.restoreAdaptiveStats(mismatch, {
  strategyVersion: "old-corpus",
  byQuestion: { [QUESTION]: { total: 10, correct: 10, preferred: 10 } }
}, { strategyVersion: scheduler.CURRENT_STRATEGY_VERSION });
assert.strictEqual(Object.keys(mismatch.byQuestion).length, 0, "Mismatched persisted mastery is invalidated");

const replaceRestore = freshStats();
replaceRestore.byQuestion.STALE = { total: 1, correct: 1, preferred: 1 };
scheduler.restoreAdaptiveStats(replaceRestore, {
  strategyVersion: scheduler.CURRENT_STRATEGY_VERSION,
  byQuestion: {
    FRESH: { total: 1, correct: 1, preferred: 1 }
  }
});
assert(!replaceRestore.byQuestion.STALE && replaceRestore.byQuestion.FRESH, "Restore replaces stale mastery maps instead of merging them");

const inconsistentCounts = freshStats();
scheduler.restoreAdaptiveStats(inconsistentCounts, {
  strategyVersion: scheduler.CURRENT_STRATEGY_VERSION,
  byQuestion: {
    COUNTS: {
      total: 4,
      correct: 2,
      preferred: 1,
      correctStreak: 9,
      preferredStreak: 9,
      actionCounts: { CALL: 4, FOLD: 4, "3BET": 4 }
    }
  }
});
const normalizedCounts = inconsistentCounts.byQuestion.COUNTS;
assert.strictEqual(normalizedCounts.correctStreak, 2);
assert.strictEqual(normalizedCounts.preferredStreak, 1);
assert(
  Object.values(normalizedCounts.actionCounts).reduce((sum, count) => sum + count, 0) <= 4,
  "Persistence normalization cannot invent streaks or action observations"
);

const malformedVersion = freshStats();
malformedVersion.byQuestion.KEEP = { total: 1, correct: 1, preferred: 1 };
scheduler.recordQuestionResult(malformedVersion, { strategyVersion: "new-version-without-question" });
assert(malformedVersion.byQuestion.KEEP, "Malformed results cannot clear mastery through a version field alone");

const crowdedQueue = freshStats();
crowdedQueue.relearningQueue = Array.from({ length: 201 }, (_row, index) => ({
  questionKey: "RFI:BTN:Q" + index,
  stage: index === 200 ? 0 : 2,
  enqueuedAt: START + index,
  dueAt: START + 100000
}));
scheduler.ensureAdaptiveStats(crowdedQueue);
assert.strictEqual(crowdedQueue.relearningQueue.length, 200);
assert(crowdedQueue.relearningQueue.some((row) => row.questionKey === "RFI:BTN:Q200"), "Queue capacity protects the newest unresolved miss");

const legacyStats = freshStats();
scheduler.restoreAdaptiveStats(legacyStats, {
  strategyVersion: scheduler.CURRENT_STRATEGY_VERSION,
  byQuestion: {
    "RFI:BTN:QQ:BALANCED:NA": {
      total: 2,
      correct: 2,
      preferred: 2,
      preferredStreak: 2,
      isInvariant: true
    }
  }
});
const legacyInvariant = legacyStats.byQuestion["RFI:BTN:QQ:BALANCED:NA"];
assert.strictEqual(
  legacyInvariant.fluentPreferredStreak,
  0,
  "Pre-latency records do not invent fluent recall during migration"
);
assert.strictEqual(
  legacyInvariant.qualifiedRetrievalStreak,
  0,
  "Pre-qualified-retrieval records do not invent delayed mastery during migration"
);
assert.notStrictEqual(
  scheduler.retentionTier(legacyInvariant),
  "STABLE",
  "Legacy correctness alone cannot retire an invariant item"
);

const legacyLongDeadline = freshStats();
scheduler.restoreAdaptiveStats(legacyLongDeadline, {
  strategyVersion: scheduler.CURRENT_STRATEGY_VERSION,
  byQuestion: {
    [QUESTION]: {
      total: 6,
      correct: 6,
      preferred: 6,
      preferredStreak: 6,
      fluentPreferredStreak: 6,
      firstSeenAt: START,
      lastSeenAt: START,
      intervalMs: 30 * DAY_MS,
      dueAt: START + 30 * DAY_MS
    }
  }
});
const rebasedLegacy = legacyLongDeadline.byQuestion[QUESTION];
assert.strictEqual(rebasedLegacy.qualifiedRetrievalStreak, 0, "Legacy massed answers restore without qualified recall");
assert.strictEqual(rebasedLegacy.intervalMs, 6 * HOUR_MS, "Legacy false mastery is rebased to the initial interval");
assert.strictEqual(rebasedLegacy.dueAt, START + 6 * HOUR_MS, "Legacy false mastery becomes promptly reviewable");

const persistedQualified = freshStats();
scheduler.restoreAdaptiveStats(persistedQualified, {
  strategyVersion: scheduler.CURRENT_STRATEGY_VERSION,
  byQuestion: {
    [QUESTION]: {
      total: 8,
      correct: 8,
      preferred: 8,
      preferredStreak: 8,
      fluentPreferredStreak: 8,
      qualifiedRetrievalStreak: 3,
      firstSeenAt: START,
      lastSeenAt: START + 4 * DAY_MS,
      intervalMs: 7 * DAY_MS,
      dueAt: START + 11 * DAY_MS
    }
  }
});
assert.strictEqual(
  persistedQualified.byQuestion[QUESTION].qualifiedRetrievalStreak,
  3,
  "A genuine qualified retrieval streak survives persistence restore"
);
assert.strictEqual(
  persistedQualified.byQuestion[QUESTION].dueAt,
  START + 11 * DAY_MS,
  "A genuine qualified retrieval deadline survives persistence restore"
);

console.log("Learning scheduler v4 simulation passed.");
