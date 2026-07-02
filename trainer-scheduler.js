(function initPotoTrainerScheduler(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.PotoTrainerScheduler = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildPotoTrainerScheduler() {
  "use strict";

  const RECENT_QUESTION_LIMIT = 32;
  const RECENT_CONTEXT_LIMIT = 10;
  const RECENT_HAND_LIMIT = 8;
  const MAX_QUESTION_RECORDS = 1200;

  function ensureAdaptiveStats(stats) {
    if (!stats || typeof stats !== "object") {
      return stats;
    }
    stats.sequence = cleanCount(stats.sequence);
    stats.byQuestion = isPlainObject(stats.byQuestion) ? stats.byQuestion : {};
    stats.recentQuestions = normalizeRecentList(stats.recentQuestions, RECENT_QUESTION_LIMIT);
    stats.recentContexts = normalizeRecentList(stats.recentContexts, RECENT_CONTEXT_LIMIT);
    stats.recentHands = normalizeRecentList(stats.recentHands, RECENT_HAND_LIMIT);
    return stats;
  }

  function normalizeQuestionRecord(row) {
    if (!isPlainObject(row)) {
      return null;
    }
    const total = cleanCount(row.total);
    const correct = Math.min(cleanCount(row.correct), total);
    return {
      total,
      correct,
      lastSeen: cleanCount(row.lastSeen),
      lastMissedAt: cleanCount(row.lastMissedAt),
      correctStreak: cleanCount(row.correctStreak)
    };
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
    const coverageBoost = safeBucket.total < 4 ? (4 - safeBucket.total) * 0.2 : 0;
    const confidence = Math.min(safeBucket.total / 10, 1);
    const weaknessBoost = safeBucket.total ? missRate * (0.9 + confidence * 0.9) : 0.2;
    const recentPenalty = isRecent ? 0.38 : 1;
    return clampWeight((1 + coverageBoost + weaknessBoost) * recentPenalty, 0.18, 3.4);
  }

  function scoreHandOption(args) {
    const record = normalizeQuestionRecord(args && args.record) || {
      total: 0,
      correct: 0,
      lastSeen: 0,
      lastMissedAt: 0,
      correctStreak: 0
    };
    const sequence = cleanCount(args && args.sequence);
    const handMisses = cleanCount(args && args.handMisses);
    const samplingWeight = Number.isFinite(args && args.samplingWeight) && args.samplingWeight > 0 ? args.samplingWeight : 1;
    const missRate = record.total ? (record.total - record.correct) / record.total : 0;
    const lowRepBoost = record.total < 3 ? (3 - record.total) * 0.16 : 0;
    const exactWeaknessBoost = record.total ? missRate * (1.15 + Math.min(record.total / 6, 1) * 0.7) : 0.25;
    const gap = Math.max(0, sequence - record.lastSeen);
    const dueBoost = record.lastMissedAt && gap >= 5 ? Math.min(0.9, gap / 18) : 0;
    const handMissBoost = Math.min(1.15, handMisses * 0.16);
    const masteredPenalty = record.correctStreak >= 2 && missRate === 0 ? 0.72 : 1;
    const recentQuestionPenalty = args && args.isRecentQuestion ? 0.08 : 1;
    const recentHandPenalty = args && args.isRecentHand ? 0.58 : 1;
    const score = (1 + lowRepBoost + exactWeaknessBoost + dueBoost + handMissBoost) *
      samplingWeight *
      masteredPenalty *
      recentQuestionPenalty *
      recentHandPenalty;
    return clampWeight(score, 0.03, 4.2);
  }

  function recordQuestionResult(stats, result) {
    ensureAdaptiveStats(stats);
    if (!stats || !result || !result.questionKey || !result.contextKey || !result.hand) {
      return stats;
    }

    stats.sequence = cleanCount(stats.sequence) + 1;
    const existing = normalizeQuestionRecord(stats.byQuestion[result.questionKey]) || {
      total: 0,
      correct: 0,
      lastSeen: 0,
      lastMissedAt: 0,
      correctStreak: 0
    };
    existing.total += 1;
    existing.lastSeen = stats.sequence;
    if (result.isPassing) {
      existing.correct += 1;
      existing.correctStreak += 1;
    } else {
      existing.lastMissedAt = stats.sequence;
      existing.correctStreak = 0;
    }
    existing.correct = Math.min(existing.correct, existing.total);
    stats.byQuestion[result.questionKey] = existing;

    remember(stats.recentQuestions, result.questionKey, RECENT_QUESTION_LIMIT);
    remember(stats.recentContexts, result.contextKey, RECENT_CONTEXT_LIMIT);
    remember(stats.recentHands, result.hand, RECENT_HAND_LIMIT);
    pruneQuestionRecords(stats);
    return stats;
  }

  function restoreAdaptiveStats(stats, parsed, args) {
    ensureAdaptiveStats(stats);
    if (!stats || !isPlainObject(parsed)) {
      return stats;
    }
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
    stats.recentQuestions = normalizeRecentList(parsed.recentQuestions, RECENT_QUESTION_LIMIT).filter(isSafeQuestionKey);
    stats.recentContexts = normalizeRecentList(parsed.recentContexts, RECENT_CONTEXT_LIMIT).filter(isSafeContextKey);
    stats.recentHands = normalizeRecentHands(parsed.recentHands, args && args.validHands);
    pruneQuestionRecords(stats);
    return ensureAdaptiveStats(stats);
  }

  function pruneQuestionRecords(stats) {
    if (!stats || !isPlainObject(stats.byQuestion)) {
      return;
    }
    const entries = Object.entries(stats.byQuestion);
    if (entries.length <= MAX_QUESTION_RECORDS) {
      return;
    }
    entries
      .sort((a, b) => (cleanCount(a[1] && a[1].lastSeen) - cleanCount(b[1] && b[1].lastSeen)))
      .slice(0, entries.length - MAX_QUESTION_RECORDS)
      .forEach(([key]) => {
        delete stats.byQuestion[key];
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
      return { total: 0, correct: 0 };
    }
    const total = cleanCount(bucket.total);
    const correct = Math.min(cleanCount(bucket.correct), total);
    return { total, correct };
  }

  function normalizeRecentHands(values, validHands) {
    const hands = normalizeRecentList(values, RECENT_HAND_LIMIT);
    if (!Array.isArray(validHands)) {
      return hands;
    }
    return hands.filter((hand) => validHands.includes(hand));
  }

  function cleanCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function clampWeight(value, min, max) {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(max, Math.max(min, value));
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return {
    MAX_QUESTION_RECORDS,
    RECENT_CONTEXT_LIMIT,
    RECENT_HAND_LIMIT,
    RECENT_QUESTION_LIMIT,
    ensureAdaptiveStats,
    isSafeContextKey,
    isSafeQuestionKey,
    normalizeQuestionRecord,
    normalizeRecentList,
    pruneQuestionRecords,
    recordQuestionResult,
    restoreAdaptiveStats,
    scoreBucket,
    scoreHandOption
  };
});
