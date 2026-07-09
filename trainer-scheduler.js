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
    const preferred = Math.min(cleanCount(row.preferred), correct);
    const preferredStreak = Math.min(cleanCount(
      row.preferredStreak
    ), total);
    return {
      total,
      correct,
      preferred,
      lastSeen: cleanCount(row.lastSeen),
      lastMissedAt: cleanCount(row.lastMissedAt),
      correctStreak: cleanCount(row.correctStreak),
      preferredStreak
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
    const acceptableRate = safeBucket.total ? (safeBucket.correct - safeBucket.preferred) / safeBucket.total : 0;
    const learningGap = missRate + acceptableRate * 0.25;
    const coverageBoost = safeBucket.total < 4 ? (4 - safeBucket.total) * 0.2 : 0;
    const confidence = Math.min(safeBucket.total / 10, 1);
    const weaknessBoost = safeBucket.total ? learningGap * (0.9 + confidence * 0.9) : 0.2;
    const recentPenalty = isRecent ? 0.38 : 1;
    return clampWeight((1 + coverageBoost + weaknessBoost) * recentPenalty, 0.18, 3.4);
  }

  function scoreHandOption(args) {
    const record = normalizeQuestionRecord(args && args.record) || {
      total: 0,
      correct: 0,
      preferred: 0,
      lastSeen: 0,
      lastMissedAt: 0,
      correctStreak: 0,
      preferredStreak: 0
    };
    const sequence = cleanCount(args && args.sequence);
    const samplingWeight = Number.isFinite(args && args.samplingWeight) && args.samplingWeight > 0 ? args.samplingWeight : 1;
    const missRate = record.total ? (record.total - record.correct) / record.total : 0;
    const acceptableRate = record.total ? (record.correct - record.preferred) / record.total : 0;
    const learningGap = missRate + acceptableRate * 0.4;
    const lowRepBoost = record.total < 3 ? (3 - record.total) * 0.16 : 0;
    const exactWeaknessBoost = record.total ? learningGap * (1.15 + Math.min(record.total / 6, 1) * 0.7) : 0.25;
    const gap = Math.max(0, sequence - record.lastSeen);
    const unresolvedMiss = record.lastMissedAt && record.preferredStreak < 3;
    const dueBoost = unresolvedMiss && gap >= 4 ? Math.min(0.75, gap / 20) : 0;
    const masteredPenalty = preferredMasteryPenalty(record.preferredStreak);
    const recentQuestionPenalty = args && args.isRecentQuestion ? 0.08 : 1;
    const recentHandPenalty = args && args.isRecentHand ? 0.58 : 1;
    const score = (1 + lowRepBoost + exactWeaknessBoost + dueBoost) *
      samplingWeight *
      masteredPenalty *
      recentQuestionPenalty *
      recentHandPenalty;
    return clampWeight(score, 0.03, 4.2);
  }

  function preferredMasteryPenalty(streak) {
    if (streak >= 6) {
      return 0.34;
    }
    if (streak >= 4) {
      return 0.5;
    }
    if (streak >= 2) {
      return 0.72;
    }
    return 1;
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
      preferred: 0,
      lastSeen: 0,
      lastMissedAt: 0,
      correctStreak: 0,
      preferredStreak: 0
    };
    const isPassing = Boolean(result.isPassing);
    const isPreferred = isPassing && (result.isPreferred === undefined ? true : Boolean(result.isPreferred));
    existing.total += 1;
    existing.lastSeen = stats.sequence;
    if (isPassing) {
      existing.correct += 1;
      existing.correctStreak += 1;
    } else {
      existing.lastMissedAt = stats.sequence;
      existing.correctStreak = 0;
    }
    if (isPreferred) {
      existing.preferred += 1;
      existing.preferredStreak += 1;
    } else {
      existing.preferredStreak = 0;
    }
    existing.correct = Math.min(existing.correct, existing.total);
    existing.preferred = Math.min(existing.preferred, existing.correct);
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
      return { total: 0, correct: 0, preferred: 0 };
    }
    const total = cleanCount(bucket.total);
    const correct = Math.min(cleanCount(bucket.correct), total);
    const preferred = Math.min(cleanCount(
      bucket.preferred
    ), correct);
    return { total, correct, preferred };
  }

  function normalizeRecentHands(values, validHands) {
    const hands = normalizeRecentList(values, RECENT_HAND_LIMIT);
    if (!Array.isArray(validHands)) {
      return hands;
    }
    return hands.filter((hand) => validHands.includes(hand));
  }

  function classifyDecisionBoundaryRows(rows) {
    if (!Array.isArray(rows)) {
      return { mixed: [], edge: [], core: [] };
    }

    const byHand = new Map();
    rows.forEach((row) => {
      if (!row || !handToCell(row.hand) || !row.recommendation || byHand.has(row.hand)) {
        return;
      }
      byHand.set(row.hand, row);
    });

    const result = { mixed: [], edge: [], core: [] };
    byHand.forEach((row, hand) => {
      const decisionClass = recommendationClass(row.recommendation);
      if (decisionClass === "MIXED") {
        result.mixed.push(row);
        return;
      }

      const isEdge = neighboringHands(hand).some((neighbor) => {
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
    const coreShare = coreRows.length ? (challengeRows.length ? requestedCoreShare : 1) : 0;
    const challengeShare = challengeRows.length ? 1 - coreShare : 0;
    const actionWeights = isPlainObject(args && args.actionWeights) ? args.actionWeights : {};
    const maxShare = Number.isFinite(args && args.maxSharePerHand)
      ? Math.min(0.25, Math.max(0.01, args.maxSharePerHand))
      : 0.08;

    return allocateTierOptions(challengeRows, "CHALLENGE", challengeShare, actionWeights, maxShare)
      .concat(allocateTierOptions(coreRows, "CORE", coreShare, actionWeights, maxShare));
  }

  function allocateTierOptions(rows, tier, totalShare, actionWeights, maxShare) {
    if (!rows.length || totalShare <= 0) {
      return [];
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
    if (allowed.length > 1 || Boolean(recommendation.frequency)) {
      return "MIXED";
    }
    return typeof recommendation.primaryAction === "string" && recommendation.primaryAction
      ? recommendation.primaryAction
      : "UNKNOWN";
  }

  function neighboringHands(hand) {
    const cell = handToCell(hand);
    if (!cell) {
      return [];
    }
    return [
      [cell.row - 1, cell.col],
      [cell.row + 1, cell.col],
      [cell.row, cell.col - 1],
      [cell.row, cell.col + 1]
    ].filter(([row, col]) => row >= 0 && row < RANKS.length && col >= 0 && col < RANKS.length)
      .map(([row, col]) => cellToHand(row, col));
  }

  function handToCell(hand) {
    const value = typeof hand === "string" ? hand : "";
    if (value.length === 2 && value[0] === value[1] && RANK_INDEX[value[0]] !== undefined) {
      const index = RANK_INDEX[value[0]];
      return { row: index, col: index };
    }
    if (value.length !== 3 || !["s", "o"].includes(value[2])) {
      return null;
    }
    const first = RANK_INDEX[value[0]];
    const second = RANK_INDEX[value[1]];
    if (first === undefined || second === undefined || first >= second) {
      return null;
    }
    return value[2] === "s"
      ? { row: first, col: second }
      : { row: second, col: first };
  }

  function cellToHand(row, col) {
    if (row === col) {
      return RANKS[row] + RANKS[col];
    }
    if (row < col) {
      return RANKS[row] + RANKS[col] + "s";
    }
    return RANKS[col] + RANKS[row] + "o";
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
    buildChallengeOptions,
    capWeightedOptions,
    classifyDecisionBoundaryRows,
    ensureAdaptiveStats,
    isSafeContextKey,
    isSafeQuestionKey,
    neighboringHands,
    normalizeQuestionRecord,
    normalizeRecentList,
    pruneQuestionRecords,
    recordQuestionResult,
    restoreAdaptiveStats,
    scoreBucket,
    scoreHandOption
  };
});
