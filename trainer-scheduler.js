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
  const MAX_RELEARNING_QUEUE = 200;
  const MIN_FIRST_REVIEW_RETENTION = 40;
  const CURRENT_STRATEGY_VERSION = "v4";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const INITIAL_RETRIEVAL_INTERVAL_MS = 6 * 60 * 60 * 1000;
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
      qualifiedRetrievalStreak: 0,
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
    // Older records tracked fast answers but not whether they were delayed.
    // Restore them conservatively instead of inventing durable retrieval.
    const hasQualifiedRetrieval = row.qualifiedRetrievalStreak !== undefined;
    record.qualifiedRetrievalStreak = Math.min(
      !hasQualifiedRetrieval
        ? 0
        : cleanCount(row.qualifiedRetrievalStreak),
      record.preferred
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
    if (!hasQualifiedRetrieval && record.relearningStage < 0 && legacyDeadlineNeedsRebase(record)) {
      // Older builds let repeated same-session answers manufacture intervals as
      // long as 30 days. Keep the evidence, but require a genuinely delayed
      // retrieval before restoring a long deadline. Active relearning records
      // are excluded so their queue deadline remains authoritative.
      const priorInterval = record.intervalMs;
      const observedAt = record.lastSeenAt || record.firstSeenAt ||
        (record.dueAt && priorInterval ? Math.max(1, record.dueAt - priorInterval) : 0);
      record.intervalMs = INITIAL_RETRIEVAL_INTERVAL_MS;
      const conservativeDueAt = observedAt ? observedAt + INITIAL_RETRIEVAL_INTERVAL_MS : 1;
      record.dueAt = record.dueAt ? Math.min(record.dueAt, conservativeDueAt) : conservativeDueAt;
    }
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
    const preferredRate = safeBucket.total ? safeBucket.preferred / safeBucket.total : 0;
    const learningGap = missRate + acceptableRate * 0.25;
    const coverageBoost = safeBucket.total < 4 ? (4 - safeBucket.total) * 0.2 : 0;
    const confidence = Math.min(safeBucket.total / 10, 1);
    const weaknessBoost = safeBucket.total ? learningGap * (0.9 + confidence * 0.9) : 0.2;
    // Strong aggregate evidence must reduce a mode/context below neutral or a
    // mastered bucket keeps consuming its fixed curriculum share forever.
    // The floor preserves sparse exploration and lets exact due reviews bypass
    // this aggregate discount through their global priority lane.
    const masteryDiscount = preferredRate * confidence * 0.8;
    const recentPenalty = isRecent ? 0.38 : 1;
    return clampWeight(
      (1 + coverageBoost + weaknessBoost) * (1 - masteryDiscount) * recentPenalty,
      0.18,
      3.4
    );
  }

  function scoreBucketGroup(buckets) {
    const rows = Array.isArray(buckets) && buckets.length ? buckets : [{}];
    return rows.reduce((sum, bucket) => sum + scoreBucket(bucket, false), 0) / rows.length;
  }

  function allowsDueReview(args) {
    const input = args || {};
    if (input.sessionKind === "TARGETED") return true;
    const answered = cleanCount(input.answered);
    const dueDrawn = cleanCount(input.dueDrawn);
    const requestedShare = Number(input.maxShare);
    const maxShare = Number.isFinite(requestedShare) ? Math.min(1, Math.max(0, requestedShare)) : 0.75;
    return dueDrawn < Math.ceil((answered + 1) * maxShare);
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

  function buildExactPriorityOptions(rows, args) {
    const input = args || {};
    const sequence = cleanCount(input.sequence);
    const now = cleanTimestamp(input.now) || Date.now();
    const recent = new Set(Array.isArray(input.recentQuestionKeys) ? input.recentQuestionKeys : []);
    const excluded = new Set(Array.isArray(input.excludedQuestionKeys) ? input.excludedQuestionKeys : []);
    const unseenScore = scoreHandOption({ sequence, now, comboWeight: 1 });
    if (!Array.isArray(rows)) return [];

    return rows.map((row) => {
      if (!isPlainObject(row) || !isSafeQuestionKey(row.questionKey) || excluded.has(row.questionKey)) {
        return null;
      }
      const record = normalizeQuestionRecord(row.record);
      if (!record || !record.total) return null;
      const dueNow = Boolean(
        (record.nextReviewSequence && sequence >= record.nextReviewSequence) ||
        (record.dueAt && now >= record.dueAt)
      );
      const unresolved = row.unresolved === true || record.relearningStage >= 0 ||
        Boolean(record.lastMissedAt && record.preferredStreak < 3);
      if ((!dueNow && !unresolved) || (!dueNow && recent.has(row.questionKey))) {
        return null;
      }
      const weight = scoreHandOption({
        record,
        conceptRecord: row.conceptRecord,
        sequence,
        now,
        comboWeight: positiveWeight(row.comboWeight, 1),
        isInvariant: Boolean(row.isInvariant),
        isRecentHand: Boolean(row.isRecentHand)
      });
      if (!dueNow && weight <= unseenScore) return null;
      return {
        ...row,
        dueNow,
        weight: dueNow ? Math.max(weight, unseenScore * 2) : weight
      };
    }).filter(Boolean);
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
    const tierPenalty = retentionPenaltyForEvidence(record, conceptRecord, input.isInvariant);
    return sampling * occurrence * combinations * regret * weakness * due * tierPenalty;
  }

  function learningNeed(record, conceptRecord) {
    const exact = record || emptyRecord();
    const concept = conceptRecord || emptyRecord();
    if (!exact.total) {
      return singleRecordLearningNeed(concept, false);
    }
    const exactNeed = singleRecordLearningNeed(exact, exact.correct < exact.total);
    if (isUnresolvedRecord(exact) || !concept.total || concept.total <= exact.total || exact.total >= 3) {
      return exactNeed;
    }
    const prior = subtractExactEvidence(concept, exact);
    if (!prior.total) return exactNeed;
    const confidence = Math.min(exact.total / 3, 1);
    return exactNeed * confidence + singleRecordLearningNeed(prior, false) * (1 - confidence);
  }

  function singleRecordLearningNeed(source, exactMissBoost) {
    if (!source.total) {
      return 1.25;
    }
    const missRate = (source.total - source.correct) / source.total;
    const acceptableRate = (source.correct - source.preferred) / source.total;
    const latencyPenalty = source.averageLatencyMs > FLUENT_RESPONSE_MS
      ? Math.min(0.7, (source.averageLatencyMs - FLUENT_RESPONSE_MS) / FLUENT_RESPONSE_MS * 0.25)
      : 0;
    const lapsePenalty = Math.min(0.8, source.lapses / Math.max(2, source.total));
    return 0.72 + missRate * 1.8 + acceptableRate * 0.7 + latencyPenalty + lapsePenalty + (exactMissBoost ? 0.35 : 0);
  }

  function subtractExactEvidence(concept, exact) {
    const total = Math.max(0, concept.total - exact.total);
    const correct = Math.min(total, Math.max(0, concept.correct - exact.correct));
    return {
      ...emptyRecord(),
      total,
      correct,
      preferred: Math.min(correct, Math.max(0, concept.preferred - exact.preferred)),
      averageLatencyMs: concept.averageLatencyMs,
      lapses: Math.min(total, Math.max(0, concept.lapses - exact.lapses))
    };
  }

  function isUnresolvedRecord(record) {
    return Boolean(record && (record.relearningStage >= 0 || (record.lastMissedAt && record.preferredStreak < 3)));
  }

  function retentionPenaltyForEvidence(record, conceptRecord, invariantHint) {
    const exact = record || emptyRecord();
    const concept = conceptRecord || emptyRecord();
    const exactPenalty = retentionPenalty(retentionTier(exact, null, invariantHint));
    if (isUnresolvedRecord(exact) || !exact.total || !concept.total || concept.total <= exact.total || exact.total >= 3) {
      return exact.total ? exactPenalty : retentionPenalty(retentionTier(concept, null, invariantHint));
    }
    const confidence = Math.min(exact.total / 3, 1);
    const conceptPenalty = retentionPenalty(retentionTier(concept, null, invariantHint));
    return exactPenalty * confidence + conceptPenalty * (1 - confidence);
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
    const qualifiedStreak = source.qualifiedRetrievalStreak;
    const invariant = invariantHint === undefined ? source.isInvariant : Boolean(invariantHint);
    if (invariant && qualifiedStreak >= 2) {
      return "STABLE";
    }
    if (qualifiedStreak >= 6) {
      return "MASTERED";
    }
    if (qualifiedStreak >= 3) {
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
    const previousSequence = cleanCount(stats.sequence);
    const answeredAt = cleanTimestamp(result.timestamp || result.answeredAt) || Date.now();
    const conceptKey = isSafeQuestionKey(result.conceptKey) ? result.conceptKey : "";
    const previousExact = normalizeQuestionRecord(stats.byQuestion[result.questionKey]) || emptyRecord();
    const previousConcept = conceptKey
      ? (normalizeQuestionRecord(stats.byConcept[conceptKey]) || emptyRecord())
      : null;
    const previousQueueEntry = stats.relearningQueue.find((entry) => entry.questionKey === result.questionKey);
    const queueWasDue = Boolean(
      previousQueueEntry && isQueueEntryDue(previousQueueEntry, {
        sequence: previousSequence,
        now: answeredAt,
        sessionId: result.sessionId
      })
    );
    const exactWasDue = isRecordReviewDue(previousExact, previousSequence, answeredAt) || queueWasDue;
    const conceptWasDue = previousConcept
      ? isRecordReviewDue(previousConcept, previousSequence, answeredAt)
      : false;
    stats.sequence = previousSequence + 1;
    const previousReviewState = {
      relearningStage: previousExact.relearningStage,
      nextReviewSequence: previousExact.nextReviewSequence,
      dueAt: previousExact.dueAt
    };
    const missingQueueReviewDue = previousReviewState.relearningStage >= 0 &&
      !previousQueueEntry && isMirroredQueueReviewDue(previousExact, previousSequence, answeredAt);
    const exact = updateLearningRecord(
      previousExact,
      { ...result, wasDue: exactWasDue },
      stats.sequence,
      answeredAt,
      conceptKey,
      resultVersion
    );
    stats.byQuestion[result.questionKey] = exact;
    if (conceptKey) {
      stats.byConcept[conceptKey] = updateLearningRecord(
        previousConcept,
        { ...result, wasDue: conceptWasDue },
        stats.sequence,
        answeredAt,
        conceptKey,
        resultVersion
      );
    }

    updateRelearningQueue(stats, { ...result, wasDue: queueWasDue }, answeredAt, conceptKey, missingQueueReviewDue);
    const queueEntry = stats.relearningQueue.find((entry) => entry.questionKey === result.questionKey);
    if (queueEntry) {
      mirrorQueueState(exact, queueEntry);
    } else if (!previousQueueEntry && previousReviewState.relearningStage >= 0 &&
      !missingQueueReviewDue && Boolean(result.isPassing) &&
      (result.isPreferred === undefined ? true : Boolean(result.isPreferred))) {
      exact.relearningStage = previousReviewState.relearningStage;
      exact.nextReviewSequence = previousReviewState.nextReviewSequence;
    } else {
      mirrorQueueState(exact, null);
    }
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
    const isFluent = latency > 0 && latency <= FLUENT_RESPONSE_MS;
    const wasDue = Boolean(result.wasDue);
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
      record.fluentPreferredStreak = isFluent
        ? record.fluentPreferredStreak + 1
        : 0;
      if (wasDue) {
        if (isFluent) {
          record.qualifiedRetrievalStreak += 1;
          record.intervalMs = qualifiedRetrievalInterval(
            record.qualifiedRetrievalStreak,
            record.isInvariant
          );
        } else {
          record.qualifiedRetrievalStreak = 0;
          record.intervalMs = INITIAL_RETRIEVAL_INTERVAL_MS;
        }
        record.dueAt = answeredAt + record.intervalMs;
      } else if (!record.dueAt && !record.nextReviewSequence) {
        // Initial acquisition gets a short first delay. Extra answers before
        // that deadline do not manufacture a longer retention interval.
        record.intervalMs = INITIAL_RETRIEVAL_INTERVAL_MS;
        record.dueAt = answeredAt + record.intervalMs;
      }
    } else {
      record.preferredStreak = 0;
      record.fluentPreferredStreak = 0;
      record.qualifiedRetrievalStreak = 0;
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

  function qualifiedRetrievalInterval(streak, isInvariant) {
    const intervals = [DAY_MS, 3 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS, 30 * DAY_MS];
    const interval = intervals[Math.min(Math.max(streak, 1), intervals.length) - 1];
    return isInvariant && streak >= 2 ? Math.max(interval, 7 * DAY_MS) : interval;
  }

  function updateRelearningQueue(stats, result, answeredAt, conceptKey, missingQueueReviewDue) {
    const index = stats.relearningQueue.findIndex((entry) => entry.questionKey === result.questionKey);
    const isPreferred = Boolean(result.isPassing) &&
      (result.isPreferred === undefined ? true : Boolean(result.isPreferred));
    const latency = cleanDuration(result.responseLatencyMs || result.latencyMs);
    const isFluent = latency > 0 && latency <= FLUENT_RESPONSE_MS;
    if (!isPreferred) {
      const entry = makeQueueEntry(result, answeredAt, conceptKey, 0, stats.sequence);
      if (index === -1) {
        stats.relearningQueue.push(entry);
      } else {
        stats.relearningQueue[index] = entry;
      }
      return;
    }
    if (index === -1) {
      const record = stats.byQuestion[result.questionKey];
      if (missingQueueReviewDue && record && record.relearningStage >= 0) {
        if (!isFluent) {
          const retry = makeQueueEntry(
            result,
            answeredAt,
            record.conceptKey || conceptKey,
            record.relearningStage,
            stats.sequence
          );
          retry.dueSequence = 0;
          retry.dueAt = answeredAt + INITIAL_RETRIEVAL_INTERVAL_MS;
          stats.relearningQueue.push(retry);
        } else if (record.relearningStage < RELEARNING_STAGES.length - 1) {
          stats.relearningQueue.push(makeQueueEntry(
            result,
            answeredAt,
            record.conceptKey || conceptKey,
            record.relearningStage + 1,
            stats.sequence
          ));
        }
      }
      return;
    }
    if (!result.wasDue) {
      return;
    }
    const current = stats.relearningQueue[index];
    if (!isFluent) {
      const retry = makeQueueEntry(
        {
          ...result,
          sessionId: result.sessionId || current.sessionId,
          relearningReason: current.reason,
          reviewData: current.reviewData
        },
        answeredAt,
        current.conceptKey || conceptKey,
        current.stage,
        stats.sequence
      );
      retry.dueSequence = 0;
      retry.dueAt = answeredAt + INITIAL_RETRIEVAL_INTERVAL_MS;
      stats.relearningQueue[index] = retry;
      return;
    }
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

  function isRecordReviewDue(record, sequence, now) {
    return Boolean(
      (record.nextReviewSequence && sequence >= record.nextReviewSequence) ||
      (record.dueAt && now >= record.dueAt)
    );
  }

  function isMirroredQueueReviewDue(record, sequence, now) {
    if (!record || record.relearningStage < 0) return false;
    // Persisted fields are authoritative because a slow answer can turn any
    // queue stage into a time-based retry. If a sequence deadline exists, its
    // later retention dueAt must not skip that queue deadline.
    if (record.nextReviewSequence) return sequence >= record.nextReviewSequence;
    return Boolean(record.dueAt && now >= record.dueAt);
  }

  function queueUrgency(entry, args) {
    const sequence = cleanCount(args && args.sequence);
    const now = cleanTimestamp(args && args.now) || Date.now();
    const sequenceDebt = entry.dueSequence ? Math.max(0, sequence - entry.dueSequence) : 0;
    const timeDebt = entry.dueAt ? Math.max(0, now - entry.dueAt) / (60 * 60 * 1000) : 0;
    // Once a review is due, durable retrieval should not sit behind an endless
    // stream of new stage-zero misses. Favor overdue debt and later spacing
    // stages, while still letting a heavily overdue first review move ahead.
    return entry.stage * 32 + sequenceDebt * 4 + timeDebt + (entry.reason === "MISSED" ? 1 : 0);
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
    const rows = Array.from(byQuestion.values());
    const firstReviews = rows
      .filter((entry) => entry.stage === 0)
      .sort((a, b) => cleanTimestamp(b.enqueuedAt) - cleanTimestamp(a.enqueuedAt))
      .slice(0, MIN_FIRST_REVIEW_RETENTION);
    const retainedKeys = new Set(firstReviews.map((entry) => entry.questionKey));
    const retained = firstReviews.concat(rows
      .filter((entry) => !retainedKeys.has(entry.questionKey))
      .sort((a, b) => queueRetentionPriority(b) - queueRetentionPriority(a))
      .slice(0, MAX_RELEARNING_QUEUE - firstReviews.length));
    return retained.sort((a, b) => queueRetentionPriority(b) - queueRetentionPriority(a));
  }

  function queueRetentionPriority(entry) {
    // The bounded queue must preserve the hardest-to-rebuild evidence first:
    // later-stage delayed reviews, then the most recently scheduled item.
    return entry.stage * 1e15 + cleanTimestamp(entry.enqueuedAt);
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

  function legacyDeadlineNeedsRebase(record) {
    if (record.intervalMs > INITIAL_RETRIEVAL_INTERVAL_MS) return true;
    const observedAt = record.lastSeenAt || record.firstSeenAt;
    return Boolean(observedAt && record.dueAt > observedAt + INITIAL_RETRIEVAL_INTERVAL_MS);
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
    allowsDueReview,
    buildChallengeOptions,
    buildExactPriorityOptions,
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
    scoreBucketGroup,
    scoreHandOption,
    scoreLearningPriority,
    semanticNeighboringHands
  };
});
