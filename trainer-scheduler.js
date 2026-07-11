(function initPotoTrainerScheduler(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.PotoTrainerScheduler = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildPotoTrainerScheduler() {
  "use strict";

  const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
  const RANK_INDEX = Object.fromEntries(RANKS.map((rank, index) => [rank, index]));
  const RECENT_QUESTION_LIMIT = 16;
  const RECENT_CONTEXT_LIMIT = 10;
  const RECENT_HAND_LIMIT = 8;
  const MAX_QUESTION_RECORDS = 2400;
  const MAX_CONCEPT_RECORDS = 1200;
  const CURRENT_STRATEGY_VERSION = "v4";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const FLUENT_RESPONSE_MS = 8000;
  const INVARIANT_RETENTION_CEILING = 0.12;
  const RELEARNING_STAGES = Object.freeze([
    Object.freeze({ sequenceGap: 8, delayMs: 0 }),
    Object.freeze({ sequenceGap: 32, delayMs: 0 }),
    Object.freeze({ sequenceGap: 0, delayMs: DAY_MS })
  ]);
  const REVIEW_DATA_FIELDS = new Set([
    "mode", "position", "openerPosition", "heroPosition", "hand",
    "heroBaseline", "openerProfile", "openSize", "contextKey", "conceptKey"
  ]);

  function emptyRecord() {
    return {
      total: 0,
      correct: 0,
      preferred: 0,
      lastSeen: 0,
      lastMissedAt: 0,
      correctStreak: 0,
      preferredStreak: 0,
      fluentPreferredStreak: 0,
      firstSeenAt: 0,
      lastSeenAt: 0,
      lastMissedAtMs: 0,
      averageLatencyMs: 0,
      latencySamples: 0,
      lastLatencyMs: 0,
      lapses: 0,
      intervalMs: 0,
      dueAt: 0,
      nextReviewSequence: 0,
      relearningStage: -1,
      actionCounts: {},
      lastChosenAction: "",
      conceptKey: "",
      strategyVersion: CURRENT_STRATEGY_VERSION,
      isInvariant: false
    };
  }

  function ensureAdaptiveStats(stats, args) {
    if (!stats || typeof stats !== "object") {
      return stats;
    }
    const requestedVersion = safeVersion(args && args.strategyVersion) ||
      safeVersion(stats.strategyVersion) || CURRENT_STRATEGY_VERSION;
    if (safeVersion(stats.strategyVersion) && stats.strategyVersion !== requestedVersion) {
      invalidateStrategyVersion(stats, requestedVersion);
    }
    stats.strategyVersion = requestedVersion;
    stats.sequence = cleanCount(stats.sequence);
    stats.byQuestion = isPlainObject(stats.byQuestion) ? stats.byQuestion : {};
    stats.byConcept = isPlainObject(stats.byConcept) ? stats.byConcept : {};
    stats.relearningQueue = normalizeRelearningQueue(stats.relearningQueue);
    stats.recentQuestions = normalizeRecentList(stats.recentQuestions, RECENT_QUESTION_LIMIT);
    stats.recentContexts = normalizeRecentList(stats.recentContexts, RECENT_CONTEXT_LIMIT);
    stats.recentHands = normalizeRecentList(stats.recentHands, RECENT_HAND_LIMIT);
    return stats;
  }

  function normalizeQuestionRecord(row) {
    if (!isPlainObject(row)) {
      return null;
    }
    const record = emptyRecord();
    record.total = cleanCount(row.total);
    record.correct = Math.min(cleanCount(row.correct), record.total);
    record.preferred = Math.min(cleanCount(row.preferred), record.correct);
    record.lastSeen = cleanCount(row.lastSeen);
    record.lastMissedAt = cleanCount(row.lastMissedAt);
    record.correctStreak = Math.min(cleanCount(row.correctStreak), record.correct);
    record.preferredStreak = Math.min(cleanCount(row.preferredStreak), record.preferred);
    record.fluentPreferredStreak = Math.min(
      row.fluentPreferredStreak === undefined
        ? 0
        : cleanCount(row.fluentPreferredStreak),
      record.preferredStreak
    );
    record.firstSeenAt = cleanTimestamp(row.firstSeenAt);
    record.lastSeenAt = cleanTimestamp(row.lastSeenAt);
    record.lastMissedAtMs = cleanTimestamp(row.lastMissedAtMs);
    record.averageLatencyMs = cleanDuration(row.averageLatencyMs);
    record.latencySamples = cleanCount(row.latencySamples);
    record.lastLatencyMs = cleanDuration(row.lastLatencyMs);
    record.lapses = Math.min(cleanCount(row.lapses), record.total);
    record.intervalMs = cleanDuration(row.intervalMs);
    record.dueAt = cleanTimestamp(row.dueAt);
    record.nextReviewSequence = cleanCount(row.nextReviewSequence);
    record.relearningStage = Number.isInteger(row.relearningStage) && row.relearningStage >= 0 &&
      row.relearningStage < RELEARNING_STAGES.length ? row.relearningStage : -1;
    record.actionCounts = normalizeActionCounts(row.actionCounts, record.total);
    record.lastChosenAction = safeToken(row.lastChosenAction, 24);
    record.conceptKey = isSafeQuestionKey(row.conceptKey) ? row.conceptKey : "";
    record.strategyVersion = safeVersion(row.strategyVersion) || CURRENT_STRATEGY_VERSION;
    record.isInvariant = Boolean(row.isInvariant);
    return record;
  }

  function normalizeRecentList(values, limit) {
    if (!Array.isArray(values)) {
      return [];
    }
    const out = [];
    values.forEach((value) => {
      if (typeof value === "string" && value && !out.includes(value)) {
        out.push(value.slice(0, 160));
      }
    });
    return out.slice(0, limit);
  }

  function isSafeQuestionKey(key) {
    return typeof key === "string" && key.length <= 160 && /^[A-Za-z0-9_>:.-]+$/.test(key);
  }

  function isSafeContextKey(key) {
    return typeof key === "string" && key.length <= 80 && /^[A-Za-z0-9_>:-]+$/.test(key);
  }

  function scoreBucket(bucket, isRecent) {
    const safeBucket = normalizeBucket(bucket);
    const missRate = safeBucket.total ? (safeBucket.total - safeBucket.correct) / safeBucket.total : 0;
    const acceptableRate = safeBucket.total ? (safeBucket.correct - safeBucket.preferred) / safeBucket.total : 0;
    const learningGap = missRate + acceptableRate * 0.25;
    const coverageBoost = safeBucket.total < 4 ? (4 - safeBucket.total) * 0.2 : 0;
    const confidence = Math.min(safeBucket.total / 10, 1);
    const weaknessBoost = safeBucket.total ? learningGap * (0.9 + confidence * 0.9) : 0.2;
    const recentPenalty = isRecent ? 0.38 : 1;
    return clampWeight((1 + coverageBoost + weaknessBoost) * recentPenalty, 0.18, 3.4);
  }

  function scoreHandOption(args) {
    const input = args || {};
    const record = normalizeQuestionRecord(input.record) || emptyRecord();
    const conceptRecord = normalizeQuestionRecord(input.conceptRecord);
    const dueMultiplier = dueScore(record, input);
    const priority = scoreLearningPriority({
      ...input,
      record,
      conceptRecord,
      dueScore: dueMultiplier
    });
    if (priority === 0) {
      return 0;
    }
    const dueNow = dueMultiplier >= 2;
    const recentQuestionPenalty = input.isRecentQuestion && !dueNow ? 0.08 : 1;
    const recentHandPenalty = input.isRecentHand && !dueNow ? 0.58 : 1;
    let score = priority * recentQuestionPenalty * recentHandPenalty;
    if (retentionTier(record, conceptRecord, input.isInvariant) === "STABLE" && !dueNow) {
      score = Math.min(score, INVARIANT_RETENTION_CEILING);
    }
    // Preserve the sampler's relative challenge/core mass. An absolute floor
    // turns dozens of intentionally tiny core weights into a large aggregate
    // share and makes cold-start sessions mostly easy folds.
    return clampWeight(score, 0, 8);
  }

  function scoreLearningPriority(args) {
    const input = args || {};
    const record = normalizeQuestionRecord(input.record) || emptyRecord();
    const conceptRecord = normalizeQuestionRecord(input.conceptRecord);
    const sampling = positiveWeight(input.samplingWeight, 1);
    const occurrence = nonNegativeWeight(input.occurrenceWeight, 1);
    const combinations = positiveWeight(
      input.comboWeight,
      input.hand ? comboCount(input.hand) / 6 : 1
    );
    const regret = nonNegativeWeight(input.regretWeight, 1);
    const weakness = positiveWeight(input.weaknessWeight, learningNeed(record, conceptRecord));
    const due = positiveWeight(input.dueScore, dueScore(record, input));
    const tierPenalty = retentionPenalty(retentionTier(record, conceptRecord, input.isInvariant));
    return sampling * occurrence * combinations * regret * weakness * due * tierPenalty;
  }

  function learningNeed(record, conceptRecord) {
    const exact = record || emptyRecord();
    const source = exact.total ? exact : (conceptRecord || exact);
    if (!source.total) {
      return 1.25;
    }
    const missRate = (source.total - source.correct) / source.total;
    const acceptableRate = (source.correct - source.preferred) / source.total;
    const latencyPenalty = source.averageLatencyMs > FLUENT_RESPONSE_MS
      ? Math.min(0.7, (source.averageLatencyMs - FLUENT_RESPONSE_MS) / FLUENT_RESPONSE_MS * 0.25)
      : 0;
    const lapsePenalty = Math.min(0.8, source.lapses / Math.max(2, source.total));
    const exactMissBoost = exact.total && exact.correct < exact.total ? 0.35 : 0;
    return 0.72 + missRate * 1.8 + acceptableRate * 0.7 + latencyPenalty + lapsePenalty + exactMissBoost;
  }

  function retentionTier(record, conceptRecord, invariantHint) {
    const exact = record || emptyRecord();
    const source = exact.total ? exact : (conceptRecord || exact);
    if (!source.total) {
      return "UNSEEN";
    }
    const unresolvedMiss = source.lastMissedAt && source.preferredStreak < 3;
    if (source.relearningStage >= 0 || unresolvedMiss) {
      return "RELEARNING";
    }
    const fluentStreak = source.fluentPreferredStreak;
    const invariant = invariantHint === undefined ? source.isInvariant : Boolean(invariantHint);
    if (invariant && fluentStreak >= 2) {
      return "STABLE";
    }
    if (fluentStreak >= 6) {
      return "MASTERED";
    }
    if (fluentStreak >= 3) {
      return "RETAINING";
    }
    return "LEARNING";
  }

  function retentionPenalty(tier) {
    return {
      UNSEEN: 1,
      LEARNING: 1,
      RELEARNING: 1.25,
      RETAINING: 0.45,
      MASTERED: 0.18,
      STABLE: 0.06
    }[tier] || 1;
  }

  function dueScore(record, args) {
    const sequence = cleanCount(args && args.sequence);
    const now = cleanTimestamp(args && args.now) || Date.now();
    if (record.nextReviewSequence) {
      if (sequence >= record.nextReviewSequence) {
        return 4.5;
      }
      const gap = record.nextReviewSequence - sequence;
      if (gap <= 2) {
        return 2;
      }
      if (gap <= 8) {
        return 1.3;
      }
    }
    if (record.dueAt) {
      if (now >= record.dueAt) {
        return 4;
      }
      if (record.dueAt - now <= DAY_MS / 8) {
        return 1.25;
      }
    }
    if (record.lastMissedAt && record.preferredStreak < 3 && sequence - record.lastMissedAt >= 8) {
      return 2.5;
    }
    return 1;
  }

  function recordQuestionResult(stats, result) {
    if (!stats || !result || !isSafeQuestionKey(result.questionKey) ||
      !isSafeContextKey(result.contextKey) || !result.hand) {
      return stats;
    }
    ensureAdaptiveStats(stats, { strategyVersion: result.strategyVersion });

    const resultVersion = safeVersion(result.strategyVersion) || stats.strategyVersion;
    if (resultVersion !== stats.strategyVersion) {
      invalidateStrategyVersion(stats, resultVersion);
    }
    stats.sequence = cleanCount(stats.sequence) + 1;
    const answeredAt = cleanTimestamp(result.timestamp || result.answeredAt) || Date.now();
    const conceptKey = isSafeQuestionKey(result.conceptKey) ? result.conceptKey : "";
    const exact = updateLearningRecord(
      normalizeQuestionRecord(stats.byQuestion[result.questionKey]) || emptyRecord(),
      result,
      stats.sequence,
      answeredAt,
      conceptKey,
      resultVersion
    );
    stats.byQuestion[result.questionKey] = exact;
    if (conceptKey) {
      stats.byConcept[conceptKey] = updateLearningRecord(
        normalizeQuestionRecord(stats.byConcept[conceptKey]) || emptyRecord(),
        result,
        stats.sequence,
        answeredAt,
        conceptKey,
        resultVersion
      );
    }

    updateRelearningQueue(stats, result, answeredAt, conceptKey);
    mirrorQueueState(exact, stats.relearningQueue.find((entry) => entry.questionKey === result.questionKey));
    remember(stats.recentQuestions, result.questionKey, RECENT_QUESTION_LIMIT);
    remember(stats.recentContexts, result.contextKey, RECENT_CONTEXT_LIMIT);
    remember(stats.recentHands, result.hand, RECENT_HAND_LIMIT);
    pruneQuestionRecords(stats);
    pruneConceptRecords(stats);
    return stats;
  }

  function updateLearningRecord(record, result, sequence, answeredAt, conceptKey, strategyVersion) {
    const isPassing = Boolean(result.isPassing);
    const isPreferred = isPassing && (result.isPreferred === undefined ? true : Boolean(result.isPreferred));
    const latency = cleanDuration(result.responseLatencyMs || result.latencyMs);
    record.total += 1;
    record.lastSeen = sequence;
    record.firstSeenAt = record.firstSeenAt || answeredAt;
    record.lastSeenAt = answeredAt;
    record.strategyVersion = strategyVersion;
    record.conceptKey = conceptKey || record.conceptKey;
    if (typeof result.isInvariant === "boolean") {
      record.isInvariant = result.isInvariant;
    }
    if (isPassing) {
      record.correct += 1;
      record.correctStreak += 1;
    } else {
      record.lastMissedAt = sequence;
      record.lastMissedAtMs = answeredAt;
      record.correctStreak = 0;
      record.lapses += 1;
    }
    if (isPreferred) {
      record.preferred += 1;
      record.preferredStreak += 1;
      record.fluentPreferredStreak = latency > 0 && latency <= FLUENT_RESPONSE_MS
        ? record.fluentPreferredStreak + 1
        : 0;
      record.intervalMs = masteryInterval(record.preferredStreak, record.isInvariant);
      record.dueAt = answeredAt + record.intervalMs;
    } else {
      record.preferredStreak = 0;
      record.fluentPreferredStreak = 0;
      record.intervalMs = 0;
      record.dueAt = 0;
    }
    if (latency) {
      record.lastLatencyMs = latency;
      record.averageLatencyMs = record.latencySamples
        ? Math.round((record.averageLatencyMs * record.latencySamples + latency) / (record.latencySamples + 1))
        : latency;
      record.latencySamples += 1;
    }
    const chosenAction = safeToken(result.chosenAction, 24);
    if (chosenAction) {
      record.lastChosenAction = chosenAction;
      record.actionCounts[chosenAction] = cleanCount(record.actionCounts[chosenAction]) + 1;
    }
    record.correct = Math.min(record.correct, record.total);
    record.preferred = Math.min(record.preferred, record.correct);
    return record;
  }

  function masteryInterval(streak, isInvariant) {
    const intervals = [6 * 60 * 60 * 1000, DAY_MS, 3 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS, 30 * DAY_MS];
    const interval = intervals[Math.min(Math.max(streak, 1), intervals.length) - 1];
    return isInvariant && streak >= 2 ? Math.max(interval, 7 * DAY_MS) : interval;
  }

  function updateRelearningQueue(stats, result, answeredAt, conceptKey) {
    const index = stats.relearningQueue.findIndex((entry) => entry.questionKey === result.questionKey);
    const isPreferred = Boolean(result.isPassing) &&
      (result.isPreferred === undefined ? true : Boolean(result.isPreferred));
    if (!isPreferred) {
      const entry = makeQueueEntry(result, answeredAt, conceptKey, 0, stats.sequence);
      if (index === -1) {
        stats.relearningQueue.push(entry);
      } else {
        stats.relearningQueue[index] = entry;
      }
      return;
    }
    if (index === -1 || !isQueueEntryDue(stats.relearningQueue[index], {
      sequence: stats.sequence,
      now: answeredAt,
      sessionId: result.sessionId
    })) {
      return;
    }
    const current = stats.relearningQueue[index];
    if (current.stage >= RELEARNING_STAGES.length - 1) {
      stats.relearningQueue.splice(index, 1);
      return;
    }
    const nextStage = current.stage + 1;
    stats.relearningQueue[index] = makeQueueEntry(
      { ...result, relearningReason: current.reason, reviewData: current.reviewData },
      answeredAt,
      current.conceptKey || conceptKey,
      nextStage,
      stats.sequence
    );
  }

  function makeQueueEntry(result, answeredAt, conceptKey, stage, sequence) {
    const definition = RELEARNING_STAGES[stage];
    return {
      questionKey: result.questionKey,
      conceptKey: conceptKey || "",
      stage,
      dueSequence: definition.sequenceGap ? sequence + definition.sequenceGap : 0,
      dueAt: definition.delayMs ? answeredAt + definition.delayMs : 0,
      enqueuedAt: answeredAt,
      reason: result.relearningReason === "MISSED" || result.relearningReason === "NON_PREFERRED"
        ? result.relearningReason
        : (result.isPassing ? "NON_PREFERRED" : "MISSED"),
      sessionId: safeToken(result.sessionId, 48),
      reviewData: sanitizeReviewData(result.reviewData || result)
    };
  }

  function mirrorQueueState(record, entry) {
    if (!entry) {
      record.relearningStage = -1;
      record.nextReviewSequence = 0;
      return;
    }
    record.relearningStage = entry.stage;
    record.nextReviewSequence = entry.dueSequence;
    record.dueAt = entry.dueAt || record.dueAt;
  }

  function getDueRelearning(stats, args) {
    ensureAdaptiveStats(stats);
    if (!stats) {
      return [];
    }
    const input = args || {};
    const available = Array.isArray(input.availableQuestionKeys)
      ? new Set(input.availableQuestionKeys.filter(isSafeQuestionKey))
      : null;
    return stats.relearningQueue
      .filter((entry) => (!available || available.has(entry.questionKey)) && isQueueEntryDue(entry, {
        sequence: input.sequence === undefined ? stats.sequence : input.sequence,
        now: input.now,
        sessionId: input.sessionId
      }))
      .sort((a, b) => queueUrgency(b, input) - queueUrgency(a, input))
      .map(cloneQueueEntry);
  }

  function getNextRelearningQuestion(stats, args) {
    return getDueRelearning(stats, args)[0] || null;
  }

  function isQueueEntryDue(entry, args) {
    const sequence = cleanCount(args && args.sequence);
    const now = cleanTimestamp(args && args.now) || Date.now();
    if (entry.dueSequence && sequence >= entry.dueSequence) {
      return true;
    }
    if (entry.dueAt && now >= entry.dueAt) {
      return true;
    }
    return false;
  }

  function queueUrgency(entry, args) {
    const sequence = cleanCount(args && args.sequence);
    const now = cleanTimestamp(args && args.now) || Date.now();
    const sequenceDebt = entry.dueSequence ? Math.max(0, sequence - entry.dueSequence) : 0;
    const timeDebt = entry.dueAt ? Math.max(0, now - entry.dueAt) / (60 * 60 * 1000) : 0;
    return (RELEARNING_STAGES.length - entry.stage) * 1000 + sequenceDebt + timeDebt;
  }

  function restoreAdaptiveStats(stats, parsed, args) {
    if (!stats || !isPlainObject(parsed)) {
      return ensureAdaptiveStats(stats, args);
    }
    const explicitVersion = safeVersion(args && args.strategyVersion);
    const parsedVersion = safeVersion(parsed.strategyVersion);
    const targetVersion = explicitVersion || parsedVersion || safeVersion(stats.strategyVersion) ||
      CURRENT_STRATEGY_VERSION;
    ensureAdaptiveStats(stats, { strategyVersion: targetVersion });
    if (explicitVersion && parsedVersion && parsedVersion !== explicitVersion) {
      return invalidateStrategyVersion(stats, explicitVersion);
    }
    stats.byQuestion = {};
    stats.byConcept = {};
    stats.relearningQueue = [];
    if (Number.isFinite(parsed.sequence) && parsed.sequence >= 0) {
      stats.sequence = Math.floor(parsed.sequence);
    }
    if (isPlainObject(parsed.byQuestion)) {
      Object.entries(parsed.byQuestion).forEach(([key, row]) => {
        const record = normalizeQuestionRecord(row);
        if (isSafeQuestionKey(key) && record && record.total > 0) {
          stats.byQuestion[key] = record;
        }
      });
    }
    if (isPlainObject(parsed.byConcept)) {
      Object.entries(parsed.byConcept).forEach(([key, row]) => {
        const record = normalizeQuestionRecord(row);
        if (isSafeQuestionKey(key) && record && record.total > 0) {
          stats.byConcept[key] = record;
        }
      });
    }
    stats.relearningQueue = normalizeRelearningQueue(parsed.relearningQueue);
    stats.recentQuestions = normalizeRecentList(parsed.recentQuestions, RECENT_QUESTION_LIMIT).filter(isSafeQuestionKey);
    stats.recentContexts = normalizeRecentList(parsed.recentContexts, RECENT_CONTEXT_LIMIT).filter(isSafeContextKey);
    stats.recentHands = normalizeRecentHands(parsed.recentHands, args && args.validHands);
    pruneQuestionRecords(stats);
    pruneConceptRecords(stats);
    return ensureAdaptiveStats(stats, { strategyVersion: targetVersion });
  }

  function invalidateStrategyVersion(stats, newVersion) {
    if (!stats || typeof stats !== "object") {
      return stats;
    }
    stats.strategyVersion = safeVersion(newVersion) || CURRENT_STRATEGY_VERSION;
    stats.byQuestion = {};
    stats.byConcept = {};
    stats.relearningQueue = [];
    stats.recentQuestions = [];
    stats.recentContexts = [];
    stats.recentHands = [];
    stats.masteryInvalidatedAt = Date.now();
    return stats;
  }

  function pruneQuestionRecords(stats) {
    pruneRecordMap(stats && stats.byQuestion, MAX_QUESTION_RECORDS, new Set(
      Array.isArray(stats && stats.relearningQueue)
        ? stats.relearningQueue.map((entry) => entry.questionKey)
        : []
    ));
  }

  function pruneConceptRecords(stats) {
    pruneRecordMap(stats && stats.byConcept, MAX_CONCEPT_RECORDS, new Set());
  }

  function pruneRecordMap(recordMap, limit, protectedKeys) {
    if (!isPlainObject(recordMap)) {
      return;
    }
    const entries = Object.entries(recordMap);
    if (entries.length <= limit) {
      return;
    }
    entries
      .filter(([key]) => !protectedKeys.has(key))
      .sort((a, b) => cleanCount(a[1] && a[1].lastSeen) - cleanCount(b[1] && b[1].lastSeen))
      .slice(0, entries.length - limit)
      .forEach(([key]) => {
        delete recordMap[key];
      });
  }

  function remember(list, value, limit) {
    if (!Array.isArray(list) || typeof value !== "string" || !value) {
      return;
    }
    const index = list.indexOf(value);
    if (index !== -1) {
      list.splice(index, 1);
    }
    list.unshift(value);
    if (list.length > limit) {
      list.length = limit;
    }
  }

  function normalizeBucket(bucket) {
    if (!bucket || typeof bucket !== "object") {
      return { total: 0, correct: 0, preferred: 0 };
    }
    const total = cleanCount(bucket.total);
    const correct = Math.min(cleanCount(bucket.correct), total);
    const preferred = Math.min(cleanCount(bucket.preferred), correct);
    return { total, correct, preferred };
  }

  function normalizeRecentHands(values, validHands) {
    const hands = normalizeRecentList(values, RECENT_HAND_LIMIT);
    return Array.isArray(validHands) ? hands.filter((hand) => validHands.includes(hand)) : hands;
  }

  function classifyDecisionBoundaryRows(rows) {
    if (!Array.isArray(rows)) {
      return { mixed: [], edge: [], core: [] };
    }
    const byHand = new Map();
    rows.forEach((row) => {
      if (row && parseHand(row.hand) && row.recommendation && !byHand.has(row.hand)) {
        byHand.set(row.hand, row);
      }
    });
    const result = { mixed: [], edge: [], core: [] };
    byHand.forEach((row, hand) => {
      const decisionClass = recommendationClass(row.recommendation);
      if (decisionClass === "MIXED") {
        result.mixed.push(row);
        return;
      }
      const isEdge = semanticNeighboringHands(hand).some((neighbor) => {
        const neighborRow = byHand.get(neighbor);
        return neighborRow && recommendationClass(neighborRow.recommendation) !== decisionClass;
      });
      result[isEdge ? "edge" : "core"].push(row);
    });
    return result;
  }

  function buildChallengeOptions(rows, args) {
    const pools = classifyDecisionBoundaryRows(rows);
    const excludedHands = new Set(Array.isArray(args && args.excludeHands) ? args.excludeHands : []);
    const challengeRows = pools.mixed.concat(pools.edge).filter((row) => !excludedHands.has(row.hand));
    const coreRows = pools.core.filter((row) => !excludedHands.has(row.hand));
    if (!challengeRows.length && !coreRows.length) {
      return [];
    }
    const requestedCoreShare = Number.isFinite(args && args.coreShare)
      ? Math.min(0.25, Math.max(0, args.coreShare))
      : 0.05;
    const actionWeights = isPlainObject(args && args.actionWeights) ? args.actionWeights : {};
    const maxShare = Number.isFinite(args && args.maxSharePerHand)
      ? Math.min(0.25, Math.max(0.01, args.maxSharePerHand))
      : 0.08;
    let coreShare = coreRows.length ? (challengeRows.length ? requestedCoreShare : 1) : 0;
    if (challengeRows.length && coreRows.length) {
      // Move overflow into stable-core maintenance instead of silently raising
      // the advertised per-hand cap when a context has very few true edges.
      coreShare = Math.max(coreShare, 1 - challengeRows.length * maxShare);
    }
    const challengeShare = challengeRows.length ? 1 - coreShare : 0;
    return allocateTierOptions(challengeRows, "CHALLENGE", challengeShare, actionWeights, maxShare)
      .concat(allocateTierOptions(coreRows, "CORE", coreShare, actionWeights, maxShare));
  }

  function allocateTierOptions(rows, tier, totalShare, actionWeights, maxShare) {
    if (!rows.length || totalShare <= 0) {
      return [];
    }
    const hasExplicitActionWeights = Object.values(actionWeights || {}).some((weight) => (
      Number.isFinite(Number(weight)) && Number(weight) > 0
    ));
    if (!hasExplicitActionWeights) {
      return capTierWeights(rows.map((row) => ({
        action: row.recommendation.primaryAction || "UNKNOWN",
        hand: row.hand,
        tier,
        comboCount: comboCount(row.hand),
        weight: totalShare / rows.length
      })), totalShare, maxShare);
    }
    const byAction = new Map();
    rows.forEach((row) => {
      const action = row.recommendation.primaryAction || "UNKNOWN";
      if (!byAction.has(action)) {
        byAction.set(action, []);
      }
      byAction.get(action).push(row);
    });
    const actionTotal = Array.from(byAction.keys()).reduce((sum, action) => {
      const weight = Number(actionWeights[action]);
      return sum + (Number.isFinite(weight) && weight > 0 ? weight : 1);
    }, 0);
    const options = [];
    byAction.forEach((actionRows, action) => {
      const requested = Number(actionWeights[action]);
      const actionWeight = Number.isFinite(requested) && requested > 0 ? requested : 1;
      const perHand = totalShare * (actionWeight / actionTotal) / actionRows.length;
      actionRows.forEach((row) => {
        options.push({
          action,
          hand: row.hand,
          tier,
          comboCount: comboCount(row.hand),
          weight: perHand
        });
      });
    });
    return capTierWeights(options, totalShare, maxShare);
  }

  function capTierWeights(options, totalShare, requestedCap) {
    if (!options.length) {
      return [];
    }
    const cap = Math.max(requestedCap, totalShare / options.length);
    const pending = new Set(options.map((_option, index) => index));
    const weights = new Array(options.length).fill(0);
    let remaining = totalShare;
    while (pending.size) {
      const rawTotal = Array.from(pending).reduce((sum, index) => sum + options[index].weight, 0);
      const capped = Array.from(pending).filter((index) => {
        const projected = rawTotal ? remaining * options[index].weight / rawTotal : remaining / pending.size;
        return projected > cap + 1e-12;
      });
      if (!capped.length) {
        pending.forEach((index) => {
          weights[index] = rawTotal ? remaining * options[index].weight / rawTotal : remaining / pending.size;
        });
        break;
      }
      capped.forEach((index) => {
        weights[index] = cap;
        remaining -= cap;
        pending.delete(index);
      });
    }
    return options.map((option, index) => ({ ...option, weight: weights[index] }));
  }

  function capWeightedOptions(options, maxShare) {
    if (!Array.isArray(options) || !options.length) {
      return [];
    }
    const safe = options.map((option) => ({
      ...option,
      weight: Number.isFinite(option && option.weight) && option.weight > 0 ? option.weight : 0
    }));
    const total = safe.reduce((sum, option) => sum + option.weight, 0);
    const normalized = safe.map((option) => ({
      ...option,
      weight: total ? option.weight / total : 1 / safe.length
    }));
    return capTierWeights(normalized, 1, Number.isFinite(maxShare) ? maxShare : 0.18);
  }

  function recommendationClass(recommendation) {
    if (!recommendation || typeof recommendation !== "object") {
      return "UNKNOWN";
    }
    const allowed = Array.isArray(recommendation.allowedActions) ? recommendation.allowedActions : [];
    if (allowed.length > 1) {
      return "MIXED";
    }
    return typeof recommendation.primaryAction === "string" && recommendation.primaryAction
      ? recommendation.primaryAction
      : "UNKNOWN";
  }

  function semanticNeighboringHands(hand) {
    const parsed = parseHand(hand);
    if (!parsed) {
      return [];
    }
    if (parsed.family === "pair") {
      return [parsed.high - 1, parsed.high + 1]
        .filter((index) => index >= 0 && index < RANKS.length)
        .map((index) => RANKS[index] + RANKS[index]);
    }
    const neighbors = new Set();
    [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]].forEach(([highDelta, lowDelta]) => {
      const high = parsed.high + highDelta;
      const low = parsed.low + lowDelta;
      if (high >= 0 && low < RANKS.length && high < low) {
        neighbors.add(RANKS[high] + RANKS[low] + parsed.suffix);
      }
    });
    return Array.from(neighbors);
  }

  // Kept for consumers that render the matrix; boundary classification no longer uses this geometry.
  function neighboringHands(hand) {
    const cell = handToCell(hand);
    if (!cell) {
      return [];
    }
    return [[cell.row - 1, cell.col], [cell.row + 1, cell.col], [cell.row, cell.col - 1], [cell.row, cell.col + 1]]
      .filter(([row, col]) => row >= 0 && row < RANKS.length && col >= 0 && col < RANKS.length)
      .map(([row, col]) => cellToHand(row, col));
  }

  function handFamily(hand) {
    const parsed = parseHand(hand);
    return parsed ? parsed.family : "unknown";
  }

  function comboCount(hand) {
    const family = handFamily(hand);
    return family === "pair" ? 6 : family === "suited" ? 4 : family === "offsuit" ? 12 : 0;
  }

  function parseHand(hand) {
    const value = typeof hand === "string" ? hand : "";
    if (value.length === 2 && value[0] === value[1] && RANK_INDEX[value[0]] !== undefined) {
      return { family: "pair", suffix: "", high: RANK_INDEX[value[0]], low: RANK_INDEX[value[1]] };
    }
    if (value.length !== 3 || !["s", "o"].includes(value[2])) {
      return null;
    }
    const high = RANK_INDEX[value[0]];
    const low = RANK_INDEX[value[1]];
    if (high === undefined || low === undefined || high >= low) {
      return null;
    }
    return { family: value[2] === "s" ? "suited" : "offsuit", suffix: value[2], high, low };
  }

  function handToCell(hand) {
    const parsed = parseHand(hand);
    if (!parsed) {
      return null;
    }
    if (parsed.family === "pair") {
      return { row: parsed.high, col: parsed.low };
    }
    return parsed.suffix === "s"
      ? { row: parsed.high, col: parsed.low }
      : { row: parsed.low, col: parsed.high };
  }

  function cellToHand(row, col) {
    if (row === col) {
      return RANKS[row] + RANKS[col];
    }
    return row < col ? RANKS[row] + RANKS[col] + "s" : RANKS[col] + RANKS[row] + "o";
  }

  function normalizeRelearningQueue(queue) {
    if (!Array.isArray(queue)) {
      return [];
    }
    const byQuestion = new Map();
    queue.map(normalizeQueueEntry).filter(Boolean).forEach((entry) => {
      const current = byQuestion.get(entry.questionKey);
      if (!current || queueRetentionPriority(entry) > queueRetentionPriority(current)) {
        byQuestion.set(entry.questionKey, entry);
      }
    });
    return Array.from(byQuestion.values())
      .sort((a, b) => queueRetentionPriority(b) - queueRetentionPriority(a))
      .slice(0, 200);
  }

  function queueRetentionPriority(entry) {
    return (RELEARNING_STAGES.length - entry.stage) * 1e15 + cleanTimestamp(entry.enqueuedAt);
  }

  function normalizeQueueEntry(row) {
    if (!isPlainObject(row) || !isSafeQuestionKey(row.questionKey)) {
      return null;
    }
    const stage = Number.isInteger(row.stage) && row.stage >= 0 && row.stage < RELEARNING_STAGES.length
      ? row.stage
      : 0;
    return {
      questionKey: row.questionKey,
      conceptKey: isSafeQuestionKey(row.conceptKey) ? row.conceptKey : "",
      stage,
      dueSequence: cleanCount(row.dueSequence),
      dueAt: cleanTimestamp(row.dueAt),
      enqueuedAt: cleanTimestamp(row.enqueuedAt),
      reason: row.reason === "NON_PREFERRED" ? "NON_PREFERRED" : "MISSED",
      sessionId: safeToken(row.sessionId, 48),
      reviewData: sanitizeReviewData(row.reviewData)
    };
  }

  function sanitizeReviewData(value) {
    if (!isPlainObject(value)) {
      return {};
    }
    const out = {};
    REVIEW_DATA_FIELDS.forEach((key) => {
      const item = value[key];
      if (typeof item === "string") {
        const safe = safeToken(item, 80);
        if (safe) {
          out[key] = safe;
        }
      }
    });
    return out;
  }

  function cloneQueueEntry(entry) {
    return { ...entry, reviewData: { ...entry.reviewData } };
  }

  function normalizeActionCounts(value, total) {
    if (!isPlainObject(value)) {
      return {};
    }
    const out = {};
    let remaining = total;
    Object.entries(value)
      .map(([action, count]) => [safeToken(action, 24), cleanCount(count)])
      .filter(([action, count]) => action && count)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .forEach(([action, count]) => {
        if (!remaining) return;
        out[action] = Math.min(count, remaining);
        remaining -= out[action];
      });
    return out;
  }

  function safeToken(value, limit) {
    return typeof value === "string" && value.length <= limit && /^[A-Za-z0-9_>:.-]+$/.test(value)
      ? value
      : "";
  }

  function safeVersion(value) {
    return safeToken(value, 60);
  }

  function cleanCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function cleanTimestamp(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function cleanDuration(value) {
    return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 365 * DAY_MS) : 0;
  }

  function positiveWeight(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function nonNegativeWeight(value, fallback) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function clampWeight(value, min, max) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return {
    CURRENT_STRATEGY_VERSION,
    FLUENT_RESPONSE_MS,
    INVARIANT_RETENTION_CEILING,
    MAX_QUESTION_RECORDS,
    RECENT_CONTEXT_LIMIT,
    RECENT_HAND_LIMIT,
    RECENT_QUESTION_LIMIT,
    RELEARNING_STAGES,
    buildChallengeOptions,
    capWeightedOptions,
    classifyDecisionBoundaryRows,
    comboCount,
    ensureAdaptiveStats,
    getDueRelearning,
    getNextRelearningQuestion,
    handFamily,
    invalidateStrategyVersion,
    isSafeContextKey,
    isSafeQuestionKey,
    neighboringHands,
    normalizeQuestionRecord,
    normalizeRecentList,
    pruneQuestionRecords,
    recordQuestionResult,
    restoreAdaptiveStats,
    retentionTier,
    scoreBucket,
    scoreHandOption,
    scoreLearningPriority,
    semanticNeighboringHands
  };
});
