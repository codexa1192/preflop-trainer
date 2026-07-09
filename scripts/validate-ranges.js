#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const engine = require("../range-engine.js");
const scheduler = require("../trainer-scheduler.js");

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error("FAIL:", message);
  } else {
    console.log("PASS:", message);
  }
}

function rec(args) {
  return engine.recommend({
    mode: engine.MODES.VS_OPEN,
    openerProfile: "BALANCED",
    openSize: "STANDARD",
    ...args
  });
}

function sameRecommendation(a, b) {
  return (
    a.primaryAction === b.primaryAction &&
    a.allowedActions.join("|") === b.allowedActions.join("|") &&
    a.explanation === b.explanation &&
    a.frequency === b.frequency &&
    a.actionTag === b.actionTag &&
    a.contextLabel === b.contextLabel &&
    a.rangeLabel === b.rangeLabel &&
    JSON.stringify(a.coach) === JSON.stringify(b.coach)
  );
}

const rootDir = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(rootDir, "app.js"), "utf8");
const engineJs = fs.readFileSync(path.join(rootDir, "range-engine.js"), "utf8");
const schedulerJs = fs.readFileSync(path.join(rootDir, "trainer-scheduler.js"), "utf8");

const aqoBtnVsMp3Standard = rec({
  openerPosition: "MP3",
  heroPosition: "BTN",
  hand: "AQo"
});
assert(
  aqoBtnVsMp3Standard.primaryAction !== engine.ACTIONS.FOLD &&
    aqoBtnVsMp3Standard.allowedActions.some((action) => action !== engine.ACTIONS.FOLD),
  "AQo BTN vs MP3 Balanced standard is not pure fold"
);

const aqoBtnVsMp3Large = rec({
  openerPosition: "MP3",
  heroPosition: "BTN",
  hand: "AQo",
  openSize: "LARGE"
});
assert(
  aqoBtnVsMp3Large.primaryAction !== engine.ACTIONS.FOLD &&
    aqoBtnVsMp3Large.allowedActions.includes(engine.ACTIONS.CALL),
  "AQo BTN vs MP3 Balanced large remains a continue/close hand"
);

const ajoCoVsUtgLarge = rec({
  openerPosition: "UTG",
  heroPosition: "CO",
  hand: "AJo",
  openSize: "LARGE"
});
assert(
  ajoCoVsUtgLarge.primaryAction === engine.ACTIONS.FOLD &&
    ajoCoVsUtgLarge.allowedActions.length === 1,
  "AJo CO vs UTG Balanced large is default fold"
);

const ajoBtnVsUtgTightLarge = rec({
  openerPosition: "UTG",
  heroPosition: "BTN",
  hand: "AJo",
  openerProfile: "TIGHT",
  openSize: "LARGE"
});
assert(
  ajoBtnVsUtgTightLarge.primaryAction !== engine.ACTIONS.CALL &&
    !ajoBtnVsUtgTightLarge.allowedActions.includes(engine.ACTIONS.CALL),
  "AJo BTN vs UTG Tight large does not prefer or allow default call"
);

const ajoBtnVsUtgBalancedLarge = rec({
  openerPosition: "UTG",
  heroPosition: "BTN",
  hand: "AJo",
  openerProfile: "BALANCED",
  openSize: "LARGE"
});
assert(
  ajoBtnVsUtgBalancedLarge.primaryAction !== engine.ACTIONS.CALL &&
    !ajoBtnVsUtgBalancedLarge.allowedActions.includes(engine.ACTIONS.CALL),
  "AJo BTN vs UTG Balanced large does not prefer or allow default call"
);

const rfi77Utg = engine.recommend({
  mode: engine.MODES.RFI,
  position: "UTG",
  hand: "77",
  openerProfile: "BALANCED",
  openSize: "STANDARD"
});
assert(
  rfi77Utg.allowedActions.includes(engine.ACTIONS.OPEN),
  "77 UTG Balanced RFI is at least reasonable/open"
);

[
  ["55", "CO"],
  ["66", "UTG"],
  ["77", "UTG"]
].forEach(([hand, position]) => {
  const recommendation = engine.recommend({
    mode: engine.MODES.RFI,
    position,
    hand,
    openerProfile: "BALANCED",
    openSize: "STANDARD"
  });
  assert(
    recommendation.allowedActions.includes(engine.ACTIONS.OPEN) &&
      !/limp/i.test(recommendation.explanation + " " + recommendation.rangeLabel),
    `${hand} ${position} Balanced RFI is open/mixed, not a limp recommendation`
  );
});

const setMine55BtnVsMp3 = rec({
  openerPosition: "MP3",
  heroPosition: "BTN",
  hand: "55"
});
assert(
  setMine55BtnVsMp3.primaryAction === engine.ACTIONS.CALL &&
    !/limp/i.test(setMine55BtnVsMp3.explanation + " " + setMine55BtnVsMp3.rangeLabel),
  "55 BTN vs MP3 facing open is a call/set-mining continue, not a limp recommendation"
);

const chartRec = engine.getChartCellRecommendation({
  mode: engine.MODES.VS_OPEN,
  openerPosition: "MP3",
  heroPosition: "BTN",
  hand: "AQo",
  openerProfile: "BALANCED",
  openSize: "STANDARD"
});
assert(
  sameRecommendation(chartRec, aqoBtnVsMp3Standard),
  "Chart output and trainer output use the same recommendation object"
);

const mixedAqoGrade = engine.gradeRecommendation(aqoBtnVsMp3Standard, engine.ACTIONS.THREE_BET);
assert(
  mixedAqoGrade.isPassing && mixedAqoGrade.isAcceptable && !mixedAqoGrade.isPreferred && mixedAqoGrade.label === "Reasonable alternative",
  "Mixed AQo secondary 3-bet is acceptable but does not count as default mastery"
);

const tooTightAqoGrade = engine.gradeRecommendation(aqoBtnVsMp3Standard, engine.ACTIONS.FOLD);
assert(
  !tooTightAqoGrade.isPassing && tooTightAqoGrade.label === "Too tight",
  "Folding AQo BTN vs MP3 grades as too tight"
);

const tooLooseAjoGrade = engine.gradeRecommendation(ajoCoVsUtgLarge, engine.ACTIONS.CALL);
assert(
  !tooLooseAjoGrade.isPassing && tooLooseAjoGrade.label === "Too loose",
  "Calling AJo CO vs UTG large grades as too loose"
);

const valueThreeBet = rec({
  openerPosition: "MP3",
  heroPosition: "BTN",
  hand: "QQ"
});
assert(
  valueThreeBet.primaryAction === engine.ACTIONS.THREE_BET && valueThreeBet.actionTag === "value",
  "Pure QQ 3-bet is tagged as value"
);

const bluffThreeBet = rec({
  openerPosition: "MP3",
  heroPosition: "BTN",
  hand: "A5s"
});
assert(
  bluffThreeBet.primaryAction === engine.ACTIONS.THREE_BET && bluffThreeBet.actionTag === "blocker bluff",
  "Pure A5s 3-bet is tagged specifically as a blocker bluff"
);

const fourBetKk = engine.recommend({
  mode: engine.MODES.FOUR_BET,
  hand: "KK"
});
assert(
  fourBetKk.primaryAction === engine.ACTIONS.FOUR_BET &&
    fourBetKk.allowedActions.includes(engine.ACTIONS.FOUR_BET),
  "KK facing 3-bet uses the engine-backed 4-bet recommendation"
);

const chartFourBetKk = engine.getChartCellRecommendation({
  mode: engine.MODES.FOUR_BET,
  hand: "KK"
});
assert(
  sameRecommendation(chartFourBetKk, fourBetKk),
  "Inactive 4-bet engine reference remains internally consistent for future contextual modeling"
);

const contradictions = engine.validatePureActionRanges();
assert(
  contradictions.length === 0,
  "No hand appears in overlapping pure or mixed range groups for the same spot"
);

assert(
  engine.parseRangeList("AK").has("AKs") && engine.parseRangeList("AK").has("AKo"),
  "Parser expands unsuffixed AK to suited and offsuit"
);

assert(
  engine.parseRangeList("77+").has("AA") && engine.parseRangeList("77+").has("77") && !engine.parseRangeList("77+").has("66"),
  "Parser expands pair-plus ranges correctly"
);

assert(
  engine.POSITION_ORDER.length === 9 &&
    new Set(engine.POSITION_ORDER.map(engine.positionLabel)).size === 9 &&
    engine.RANGE_PRESETS[engine.DEFAULT_PRESET_ID].assumptions.includes("9-handed"),
  "The nine modeled seats have unique readable labels and match the stated table size"
);

const utgBoundaryRows = engine.ALL_HAND_CLASSES.map((hand) => ({
  hand,
  recommendation: engine.recommend({
    mode: engine.MODES.RFI,
    position: "UTG",
    hand,
    openerProfile: "BALANCED",
    openSize: "STANDARD"
  })
}));
const utgBoundaryPools = scheduler.classifyDecisionBoundaryRows(utgBoundaryRows);
const boundaryPartition = [...utgBoundaryPools.mixed, ...utgBoundaryPools.edge, ...utgBoundaryPools.core].map((row) => row.hand);
assert(
  boundaryPartition.length === 169 && new Set(boundaryPartition).size === 169 &&
    utgBoundaryPools.mixed.some((row) => row.hand === "66") &&
    utgBoundaryPools.edge.some((row) => row.hand === "AQo") &&
    utgBoundaryPools.core.some((row) => row.hand === "72o"),
  "Decision-boundary classifier partitions all 169 hands and separates mixed, edge, and stable core examples"
);

const reversedBoundaryPools = scheduler.classifyDecisionBoundaryRows(utgBoundaryRows.slice().reverse());
function sortedHands(rows) {
  return rows.map((row) => row.hand).sort().join("|");
}
assert(
  sortedHands(reversedBoundaryPools.mixed) === sortedHands(utgBoundaryPools.mixed) &&
    sortedHands(reversedBoundaryPools.edge) === sortedHands(utgBoundaryPools.edge) &&
    sortedHands(reversedBoundaryPools.core) === sortedHands(utgBoundaryPools.core),
  "Decision-boundary classification is independent of input order"
);

assert(
  scheduler.neighboringHands("AA").length === 2 &&
    scheduler.neighboringHands("76s").length === 4 &&
    !scheduler.neighboringHands("76s").includes("65s"),
  "Boundary detection uses cardinal matrix neighbors rather than diagonal shortcuts"
);

function optimizedRows(args) {
  return engine.ALL_HAND_CLASSES.map((hand) => ({
    hand,
    recommendation: engine.recommend({ ...args, hand })
  }));
}

function challengeOptions(args) {
  const isRfi = args.mode === engine.MODES.RFI;
  return scheduler.buildChallengeOptions(optimizedRows(args), {
    actionWeights: isRfi
      ? { [engine.ACTIONS.OPEN]: 0.55, [engine.ACTIONS.FOLD]: 0.45 }
      : { [engine.ACTIONS.THREE_BET]: 0.3, [engine.ACTIONS.CALL]: 0.35, [engine.ACTIONS.FOLD]: 0.35 },
    coreShare: 0.05,
    excludeHands: ["AA", "KK"],
    maxSharePerHand: 0.08
  });
}

let challengeDistributionFailures = 0;
function checkChallengeDistribution(args) {
  const options = challengeOptions(args);
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  const core = options.filter((option) => option.tier === "CORE").reduce((sum, option) => sum + option.weight, 0);
  const fold = options.filter((option) => option.action === engine.ACTIONS.FOLD).reduce((sum, option) => sum + option.weight, 0);
  const maxHand = Math.max(...options.map((option) => option.weight));
  if (Math.abs(total - 1) > 1e-9 || Math.abs(core - 0.05) > 1e-9 ||
      fold > 0.5 || maxHand > 0.0800001 || new Set(options.map((option) => option.hand)).size !== options.length) {
    challengeDistributionFailures += 1;
  }
}

engine.OPENER_PROFILES.forEach(({ id: openerProfile }) => {
  engine.RFI_POSITIONS.forEach((position) => checkChallengeDistribution({
    mode: engine.MODES.RFI,
    position,
    openerProfile,
    openSize: "STANDARD"
  }));
  ["STANDARD", "LARGE"].forEach((openSize) => {
    engine.getValidVsOpenSpots().forEach((spot) => checkChallengeDistribution({
      mode: engine.MODES.VS_OPEN,
      openerPosition: spot.openerPosition,
      heroPosition: spot.heroPosition,
      openerProfile,
      openSize
    }));
  });
});
assert(
  challengeDistributionFailures === 0,
  "Every active context keeps 95% challenge mass, 5% stable-core mass, balanced fold defaults, and an 8% per-hand cap"
);

const adversarialAdaptiveOptions = challengeOptions({
  mode: engine.MODES.VS_OPEN,
  openerPosition: "UTG",
  heroPosition: "UTG1",
  openerProfile: "TIGHT",
  openSize: "STANDARD"
}).map((option) => ({
  ...option,
  weight: option.weight * scheduler.scoreHandOption({
    record: option.hand === "AKs"
      ? { total: 6, correct: 0, preferred: 0, lastSeen: 1, lastMissedAt: 6, correctStreak: 0, preferredStreak: 0 }
      : { total: 6, correct: 6, preferred: 6, lastSeen: 5, lastMissedAt: 0, correctStreak: 6, preferredStreak: 6 },
    sequence: 20
  })
}));
const cappedAdaptiveOptions = scheduler.capWeightedOptions(adversarialAdaptiveOptions, 0.18);
const adaptiveMax = Math.max(...cappedAdaptiveOptions.map((option) => option.weight));
const adaptiveAk = cappedAdaptiveOptions.find((option) => option.hand === "AKs");
assert(
  Math.abs(cappedAdaptiveOptions.reduce((sum, option) => sum + option.weight, 0) - 1) < 1e-9 &&
    adaptiveMax <= 0.1800001 && adaptiveAk && adaptiveAk.weight > 0.08,
  "Weak spots get extra adaptive practice without any one hand exceeding an 18% next-draw cap"
);

const coBbA5s = rec({
  openerPosition: "CO",
  heroPosition: "BB",
  hand: "A5s"
});
assert(
  coBbA5s.primaryAction === engine.ACTIONS.CALL &&
    coBbA5s.allowedActions.includes(engine.ACTIONS.FOLD) &&
    !coBbA5s.allowedActions.includes(engine.ACTIONS.THREE_BET),
  "CO versus BB A5s has one non-contradictory mixed classification"
);

const trashBlindFold = rec({
  openerPosition: "BTN",
  heroPosition: "BB",
  hand: "72o"
});
const pairBlindCall = rec({
  openerPosition: "UTG",
  heroPosition: "BB",
  hand: "22"
});
const sbBoundaryOpen = engine.recommend({
  mode: engine.MODES.RFI,
  position: "SB",
  hand: "K4s",
  openerProfile: "BALANCED",
  openSize: "STANDARD"
});
const rfi55UtgFold = engine.recommend({
  mode: engine.MODES.RFI,
  position: "UTG",
  hand: "55",
  openerProfile: "BALANCED"
});
const looseLargeAjo = rec({
  openerPosition: "MP1",
  heroPosition: "MP2",
  hand: "AJo",
  openerProfile: "LOOSE",
  openSize: "LARGE"
});
const tightEarly99 = rec({
  openerPosition: "UTG",
  heroPosition: "UTG1",
  hand: "99",
  openerProfile: "TIGHT"
});
const early77Call = rec({
  openerPosition: "UTG",
  heroPosition: "BTN",
  hand: "77"
});
assert(
  /lacks suitedness|poor connection/i.test(trashBlindFold.coach.reason) &&
    /out of position/i.test(trashBlindFold.coach.takeaway) &&
    !/stronger broadway/i.test(trashBlindFold.coach.reason) &&
    /pocket pair/i.test(pairBlindCall.coach.reason) &&
    /big blind still to act/i.test(sbBoundaryOpen.coach.takeaway) &&
    !/price/i.test(rfi55UtgFold.coach.reason) &&
    /larger pot/i.test(early77Call.coach.actionNotes[engine.ACTIONS.THREE_BET]),
  "Coach explanations match the hand family and exact blind context"
);

assert(
  looseLargeAjo.primaryAction === engine.ACTIONS.FOLD &&
    tightEarly99.primaryAction === engine.ACTIONS.FOLD &&
    /selected 4.5-6bb size|selected large size/i.test(looseLargeAjo.coach.adjustment) &&
    /selected tight profile/i.test(tightEarly99.coach.adjustment) &&
    /can work/i.test(tightEarly99.coach.actionNotes[engine.ACTIONS.CALL]) &&
    !/offsuit hand/i.test(tightEarly99.coach.takeaway),
  "Combined opener profile and size assumptions do not contradict the trained default"
);

let coachFailures = 0;
engine.OPENER_PROFILES.forEach(({ id: profile }) => {
  engine.RFI_POSITIONS.forEach((position) => {
    engine.ALL_HAND_CLASSES.forEach((hand) => {
      const recommendation = engine.recommend({ mode: engine.MODES.RFI, position, hand, openerProfile: profile });
      const secondaryNoteFailure = recommendation.allowedActions
        .filter((action) => action !== recommendation.primaryAction)
        .some((action) => !/reasonable|can work/i.test(recommendation.coach.actionNotes[action]));
      const pairTakeawayFailure = hand.length === 2 && !/pair|set|price/i.test(recommendation.coach.takeaway);
      if (!recommendation.allowedActions.includes(recommendation.primaryAction) ||
          !recommendation.coach.reason || !recommendation.coach.adjustment || !recommendation.coach.takeaway ||
          !recommendation.coach.actionNotes ||
          recommendation.allowedActions.some((action) => !recommendation.coach.actionNotes[action]) ||
          /fold equity|table texture/i.test(Object.values(recommendation.coach).join(" ")) ||
          secondaryNoteFailure || pairTakeawayFailure) {
        coachFailures += 1;
      }
    });
  });
  ["STANDARD", "LARGE"].forEach((openSize) => {
    engine.getValidVsOpenSpots().forEach((spot) => {
      engine.ALL_HAND_CLASSES.forEach((hand) => {
        const recommendation = engine.recommend({
          mode: engine.MODES.VS_OPEN,
          openerPosition: spot.openerPosition,
          heroPosition: spot.heroPosition,
          hand,
          openerProfile: profile,
          openSize
        });
        const selectedAssumptionContradiction =
          (profile === "TIGHT" && recommendation.primaryAction !== engine.ACTIONS.FOLD &&
            /fold.{0,40}tight|tight.{0,40}fold/i.test(recommendation.coach.adjustment)) ||
          (openSize === "LARGE" && recommendation.primaryAction !== engine.ACTIONS.FOLD &&
            /fold.{0,40}(large|larger|4\.5-6bb)|(large|larger|4\.5-6bb).{0,40}fold/i.test(recommendation.coach.adjustment));
        const secondaryNoteFailure = recommendation.allowedActions
          .filter((action) => action !== recommendation.primaryAction)
          .some((action) => !/reasonable|can work/i.test(recommendation.coach.actionNotes[action]));
        const pairTakeawayFailure = hand.length === 2 && !/pair|set|price/i.test(recommendation.coach.takeaway);
        if (!recommendation.allowedActions.includes(recommendation.primaryAction) ||
            !recommendation.coach.reason || !recommendation.coach.adjustment || !recommendation.coach.takeaway ||
            !recommendation.coach.actionNotes ||
            recommendation.allowedActions.some((action) => !recommendation.coach.actionNotes[action]) ||
            /fold equity|table texture/i.test(Object.values(recommendation.coach).join(" ")) ||
            selectedAssumptionContradiction || secondaryNoteFailure || pairTakeawayFailure) {
          coachFailures += 1;
        }
      });
    });
  });
});
assert(
  coachFailures === 0,
  "Every active recommendation has a valid default and complete structured coaching"
);

const weakBucketWeight = scheduler.scoreBucket({ total: 10, correct: 4, preferred: 2 }, false);
const masteredBucketWeight = scheduler.scoreBucket({ total: 10, correct: 10, preferred: 10 }, false);
const newBucketWeight = scheduler.scoreBucket({ total: 0, correct: 0 }, false);
const recentWeakBucketWeight = scheduler.scoreBucket({ total: 10, correct: 4, preferred: 2 }, true);
assert(
  weakBucketWeight > masteredBucketWeight && newBucketWeight > masteredBucketWeight,
  "Adaptive scheduler prioritizes weak buckets and under-tested coverage over mastered buckets"
);
assert(
  recentWeakBucketWeight < weakBucketWeight,
  "Adaptive scheduler applies a cooldown to recently used weak contexts"
);

const weakHandWeight = scheduler.scoreHandOption({
  record: { total: 4, correct: 1, preferred: 1, lastSeen: 1, lastMissedAt: 1, correctStreak: 0, preferredStreak: 0 },
  sequence: 20
});
const masteredHandWeight = scheduler.scoreHandOption({
  record: { total: 4, correct: 4, preferred: 4, lastSeen: 19, lastMissedAt: 0, correctStreak: 4, preferredStreak: 4 },
  sequence: 20
});
const recentWeakHandWeight = scheduler.scoreHandOption({
  record: { total: 4, correct: 1, preferred: 1, lastSeen: 20, lastMissedAt: 20, correctStreak: 0, preferredStreak: 0 },
  sequence: 20,
  isRecentQuestion: true
});
assert(
  weakHandWeight > masteredHandWeight && recentWeakHandWeight < weakHandWeight,
  "Adaptive scheduler boosts weak exact questions but cools down recent repeats"
);

function freshAdaptiveStats() {
  return scheduler.ensureAdaptiveStats({
    sequence: 0,
    byQuestion: {},
    recentQuestions: [],
    recentContexts: [],
    recentHands: []
  });
}

const preferredPractice = freshAdaptiveStats();
const acceptablePractice = freshAdaptiveStats();
for (let attempt = 0; attempt < 5; attempt += 1) {
  scheduler.recordQuestionResult(preferredPractice, {
    questionKey: "VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD",
    contextKey: "VS_OPEN:MP3>BTN",
    hand: "AQo",
    isPassing: true,
    isPreferred: true
  });
  scheduler.recordQuestionResult(acceptablePractice, {
    questionKey: "VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD",
    contextKey: "VS_OPEN:MP3>BTN",
    hand: "AQo",
    isPassing: true,
    isPreferred: false
  });
}
const preferredPracticeWeight = scheduler.scoreHandOption({
  record: preferredPractice.byQuestion["VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD"],
  sequence: preferredPractice.sequence
});
const acceptablePracticeWeight = scheduler.scoreHandOption({
  record: acceptablePractice.byQuestion["VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD"],
  sequence: acceptablePractice.sequence
});
assert(
  acceptablePracticeWeight > preferredPracticeWeight &&
    acceptablePractice.byQuestion["VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD"].preferred === 0,
  "Reasonable alternatives remain in rotation instead of counting as preferred-action mastery"
);

const rehabilitatedPractice = freshAdaptiveStats();
scheduler.recordQuestionResult(rehabilitatedPractice, {
  questionKey: "RFI:UTG:AJo:BALANCED:NA",
  contextKey: "RFI:UTG",
  hand: "AJo",
  isPassing: false,
  isPreferred: false
});
for (let attempt = 0; attempt < 6; attempt += 1) {
  scheduler.recordQuestionResult(rehabilitatedPractice, {
    questionKey: "RFI:UTG:AJo:BALANCED:NA",
    contextKey: "RFI:UTG",
    hand: "AJo",
    isPassing: true,
    isPreferred: true
  });
}
const rehabilitatedWeight = scheduler.scoreHandOption({
  record: rehabilitatedPractice.byQuestion["RFI:UTG:AJo:BALANCED:NA"],
  sequence: rehabilitatedPractice.sequence
});
const unseenWeight = scheduler.scoreHandOption({ sequence: rehabilitatedPractice.sequence });
assert(
  rehabilitatedWeight < unseenWeight,
  "A historical miss is rehabilitated after a sustained preferred-action streak"
);

const adaptiveStats = scheduler.ensureAdaptiveStats({
  sequence: 0,
  byQuestion: {},
  recentQuestions: [],
  recentContexts: [],
  recentHands: []
});
scheduler.recordQuestionResult(adaptiveStats, {
  questionKey: "VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD",
  contextKey: "VS_OPEN:MP3>BTN",
  hand: "AQo",
  isPassing: false
});
scheduler.recordQuestionResult(adaptiveStats, {
  questionKey: "VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD",
  contextKey: "VS_OPEN:MP3>BTN",
  hand: "AQo",
  isPassing: true
});
assert(
  adaptiveStats.sequence === 2 &&
    adaptiveStats.byQuestion["VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD"].total === 2 &&
    adaptiveStats.byQuestion["VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD"].correct === 1 &&
    adaptiveStats.recentQuestions[0] === "VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD",
  "Adaptive stats persist exact-question accuracy and recent-question cooldown state"
);

assert(
  scheduler.isSafeQuestionKey("VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD") &&
    scheduler.isSafeQuestionKey("FOUR_BET:default:KK:DEFAULT:NA") &&
    scheduler.isSafeContextKey("FOUR_BET:default"),
  "Adaptive stats reload accepts generated lowercase hand and context keys"
);

const restoredStats = scheduler.ensureAdaptiveStats({
  sequence: 0,
  byQuestion: {},
  recentQuestions: [],
  recentContexts: [],
  recentHands: []
});
scheduler.restoreAdaptiveStats(restoredStats, {
  sequence: 7,
  byQuestion: {
    "VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD": { total: 3, correct: 1, lastSeen: 6, lastMissedAt: 6, correctStreak: 0 },
    "FOUR_BET:default:A5s:DEFAULT:NA": { total: 2, correct: 2, lastSeen: 5, lastMissedAt: 0, correctStreak: 2 }
  },
  recentQuestions: ["VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD", "FOUR_BET:default:A5s:DEFAULT:NA"],
  recentContexts: ["VS_OPEN:MP3>BTN", "FOUR_BET:default"],
  recentHands: ["AQo", "A5s", "bad-hand"]
}, { validHands: engine.ALL_HAND_CLASSES });
assert(
  restoredStats.sequence === 7 &&
    restoredStats.byQuestion["VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD"].total === 3 &&
    restoredStats.byQuestion["VS_OPEN:MP3>BTN:AQo:BALANCED:STANDARD"].preferred === 0 &&
    restoredStats.byQuestion["FOUR_BET:default:A5s:DEFAULT:NA"].correct === 2 &&
    restoredStats.byQuestion["FOUR_BET:default:A5s:DEFAULT:NA"].preferredStreak === 0 &&
    restoredStats.recentQuestions.includes("FOUR_BET:default:A5s:DEFAULT:NA") &&
    restoredStats.recentContexts.includes("FOUR_BET:default") &&
    restoredStats.recentHands.includes("AQo") &&
    !restoredStats.recentHands.includes("bad-hand"),
  "Adaptive stats restore legacy records conservatively without inventing preferred-action mastery"
);

[
  "modeRfiBtn",
  "modeThreeBetBtn",
  "modeVsRfiBtn",
  "threeBetSamplingGrid",
  "vsRfiSamplingGrid",
  "threeBetStatsList",
  "threeBetToggleGrid",
  "vsRfiSpotGrid"
].forEach((oldId) => {
  assert(!indexHtml.includes(oldId) && !appJs.includes(oldId), `Removed old drill-mode DOM id ${oldId}`);
});

[
  "drillSamplingGrid",
  "openerToggleGrid",
  "decisionMixNote",
  "vsOpenStatsList",
  "coachReasonLine",
  "coachCorrectionLine",
  "coachAdjustmentLine",
  "coachTakeawayLine",
  "quickLiveDefaultsBtn",
  "chartAssumptionLine",
  "chartOpenerControl",
  "chartHeroControl",
  "chartProfileControl",
  "chartSizeControl"
].forEach((requiredId) => {
  assert(indexHtml.includes(`id="${requiredId}"`) && appJs.includes(requiredId), `Single decision UI id ${requiredId} is wired`);
});

assert(
  !appJs.includes("settings.mode") && !appJs.includes("renderModeButtons") && !appJs.includes("setMode("),
  "App no longer persists or renders separate drill modes"
);

assert(
  !appJs.includes("gradeThreeBetDecision(") && !appJs.includes("3-bet vs Opener"),
  "App uses full fold/call/3-bet recommendations instead of a duplicate 3-bet drill"
);

assert(
  appJs.includes('stats: "poto_preflop_trainer_stats_v3"') &&
    !appJs.includes('stats: "poto_preflop_trainer_stats_v2"') &&
    !appJs.includes("MODES.THREE_BET + key.slice"),
  "Stats use a clean v3 schema instead of misclassifying legacy alternatives or retired-mode totals"
);

assert(
  appJs.includes('{ id: MODES.RFI, label: "First in" }') &&
    appJs.includes('{ id: MODES.VS_OPEN, label: "Facing open" }'),
  "Chart exposes first-in and facing-open situations"
);

const decisionMixSource = appJs.slice(appJs.indexOf("const DECISION_MIX"), appJs.indexOf("];", appJs.indexOf("const DECISION_MIX")) + 2);
const chartModeSource = appJs.slice(appJs.indexOf("function buildChartControls"), appJs.indexOf("function syncChartControlsFromSettings"));
assert(
  !decisionMixSource.includes("MODES.FOUR_BET") &&
    !chartModeSource.includes("MODES.FOUR_BET") &&
    !indexHtml.includes('id="fourBetStatsList"'),
  "Context-free facing-3-bet content is withheld from the active drill, chart selector, and stats UI"
);

assert(
  schedulerJs.includes("scoreBucket") &&
    schedulerJs.includes("scoreHandOption") &&
    schedulerJs.includes("isSafeQuestionKey") &&
    appJs.includes("PotoTrainerScheduler") &&
    appJs.includes("restoreAdaptiveStats(fallback, parsed") &&
    appJs.includes("recordQuestionResult") &&
    appJs.includes("drawAdaptiveChallengeHand") &&
    schedulerJs.includes("buildChallengeOptions") &&
    schedulerJs.includes("classifyDecisionBoundaryRows") &&
    appJs.includes("recentQuestions"),
  "Adaptive trainer scheduler is loaded, records exact question history, adapts category selection, and avoids stale app-only logic"
);

assert(
  !appJs.includes("handMisses:") &&
    appJs.includes("isPreferred: grade.isPreferred") &&
    appJs.includes("stats.preferred") &&
    schedulerJs.includes("preferredStreak"),
  "Adaptive mastery is exact-question based and distinguishes preferred from merely acceptable answers"
);

assert(
  appJs.includes("function statsContextKeyForArgs(args)") &&
    appJs.includes('base + ":" + settings.openerProfile + ":" + settings.openSize') &&
    appJs.includes('formatPercent(bucket.preferred, bucket.total) + " default') &&
    indexHtml.includes("Default / strategy"),
  "Context adaptation and visible stats are scoped to the selected profile and size"
);

assert(
  indexHtml.includes("Choose the default action") &&
    indexHtml.includes('id="coachReasonLine"') &&
    indexHtml.includes('id="coachCorrectionLine"') &&
    indexHtml.includes("feedback-acceptable") &&
    appJs.includes("renderCoach(recommendation, takeAction)") &&
    appJs.includes('el.whyLine.classList.remove("hidden")') &&
    !appJs.includes("Allowed:"),
  "Structured coaching is shown immediately and uses default-versus-alternative language"
);

assert(
  indexHtml.includes("9-handed") && !indexHtml.includes("8-handed") &&
    engineJs.includes("9-handed") && !engineJs.includes("8-handed") &&
    !appJs.includes("8-handed"),
  "Quiz and chart copy consistently state the modeled nine-handed table"
);

assert(
  appJs.includes("Full deck review (169)") &&
    appJs.includes("Challenge mode (range edges)") &&
    !appJs.includes("Uniform (169)") &&
    appJs.includes("return drawAdaptiveHand(args, engine.ALL_HAND_CLASSES)") &&
    appJs.includes("function isAdaptiveDrill()") &&
    appJs.includes("return true;"),
  "Every study plan stays adaptive; full-deck mode adapts over all 169 hands"
);

assert(
  appJs.includes('AUTOPILOT_VALUE_HANDS = new Set(["AA", "KK"])') &&
    appJs.includes("scheduler.buildChallengeOptions(rows") &&
    appJs.includes("coreShare: 0.05") &&
    appJs.includes("maxSharePerHand: 0.08") &&
    appJs.slice(
      appJs.indexOf("function drawAdaptiveChallengeHand"),
      appJs.indexOf("function drawWeightedOption")
    ).includes("scheduler.capWeightedOptions(candidates, 0.18)") &&
    !appJs.includes(".slice(0, 55)") &&
    !appJs.includes(".slice(0, 75)") &&
    !appJs.includes(".slice(0, 85)"),
  "Challenge sampling balances default actions, caps single-hand exposure, and keeps a small stable-core review share"
);

assert(
  indexHtml.includes("Preflop Chart") &&
    indexHtml.includes("100-133bb") &&
    appJs.includes("updateChartControlVisibility"),
  "UI uses unified Preflop Chart labeling, live stack assumptions, and situation-specific chart controls"
);

assert(
  appJs.includes('LIVE_OPEN_SIZE_CLASSES = engine.OPEN_SIZE_CLASSES.filter((item) => item.id !== "SMALL")') &&
    !appJs.includes("values: engine.OPEN_SIZE_CLASSES") &&
    !appJs.includes("setSelectOptions(el.chartSizeSelect, engine.OPEN_SIZE_CLASSES)"),
  "Settings and chart default to standard/large live open sizing, not small opens"
);

assert(
  appJs.includes("mode: MODES.RFI") &&
    appJs.includes("engine.positionLabel(el.chartHeroSelect.value") &&
    engine.getAssumptionLabel({ mode: engine.MODES.RFI, openerProfile: "BALANCED", openSize: "LARGE" }).includes("RFI style") &&
    !engine.getAssumptionLabel({ mode: engine.MODES.RFI, openerProfile: "BALANCED", openSize: "LARGE" }).includes("4.5-6bb"),
  "RFI assumptions name Hero's style and omit irrelevant facing-open size text"
);

assert(
  engineJs.includes("chart-three-bet") === false &&
    indexHtml.includes("chart-three-bet") &&
    !indexHtml.includes("dot-four-bet\"></span>4-bet") &&
    engineJs.includes('return "three-bet"') &&
    engineJs.includes('return "four-bet"'),
  "Active chart legend covers 3-bets without advertising the withheld 4-bet reference"
);

assert(
  indexHtml.includes("./range-engine.js?v=20260709-challenge-coach") &&
    indexHtml.includes("./trainer-scheduler.js?v=20260709-challenge-coach") &&
    indexHtml.includes("./app.js?v=20260709-challenge-coach") &&
    !indexHtml.includes('<script src="./app.js"></script>') &&
    !indexHtml.includes('<script src="./range-engine.js"></script>') &&
    !indexHtml.includes('<script src="./trainer-scheduler.js"></script>'),
  "Local scripts are versioned so deployed HTML does not pair with stale cached JS"
);

if (failures > 0) {
  console.error(`${failures} range validation check(s) failed.`);
  process.exit(1);
}

console.log("All range validation checks passed.");
