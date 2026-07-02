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
    a.explanation === b.explanation
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
  mixedAqoGrade.isPassing && mixedAqoGrade.label.startsWith("Acceptable"),
  "Mixed AQo secondary 3-bet grades as acceptable instead of wrong"
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
  bluffThreeBet.primaryAction === engine.ACTIONS.THREE_BET && bluffThreeBet.actionTag === "bluff",
  "Pure A5s 3-bet is tagged as bluff/semi-bluff"
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
  "Facing 3-bet chart output and drill output use the same 4-bet recommendation object"
);

const contradictions = engine.validatePureActionRanges();
assert(
  contradictions.length === 0,
  "No hand appears in contradictory pure-action ranges for the same spot"
);

assert(
  engine.parseRangeList("AK").has("AKs") && engine.parseRangeList("AK").has("AKo"),
  "Parser expands unsuffixed AK to suited and offsuit"
);

assert(
  engine.parseRangeList("77+").has("AA") && engine.parseRangeList("77+").has("77") && !engine.parseRangeList("77+").has("66"),
  "Parser expands pair-plus ranges correctly"
);

const weakBucketWeight = scheduler.scoreBucket({ total: 10, correct: 4 }, false);
const masteredBucketWeight = scheduler.scoreBucket({ total: 10, correct: 10 }, false);
const newBucketWeight = scheduler.scoreBucket({ total: 0, correct: 0 }, false);
const recentWeakBucketWeight = scheduler.scoreBucket({ total: 10, correct: 4 }, true);
assert(
  weakBucketWeight > masteredBucketWeight && newBucketWeight > masteredBucketWeight,
  "Adaptive scheduler prioritizes weak buckets and under-tested coverage over mastered buckets"
);
assert(
  recentWeakBucketWeight < weakBucketWeight,
  "Adaptive scheduler applies a cooldown to recently used weak contexts"
);

const weakHandWeight = scheduler.scoreHandOption({
  record: { total: 4, correct: 1, lastSeen: 1, lastMissedAt: 1, correctStreak: 0 },
  handMisses: 3,
  sequence: 20
});
const masteredHandWeight = scheduler.scoreHandOption({
  record: { total: 4, correct: 4, lastSeen: 19, lastMissedAt: 0, correctStreak: 4 },
  handMisses: 0,
  sequence: 20
});
const recentWeakHandWeight = scheduler.scoreHandOption({
  record: { total: 4, correct: 1, lastSeen: 20, lastMissedAt: 20, correctStreak: 0 },
  handMisses: 3,
  sequence: 20,
  isRecentQuestion: true
});
assert(
  weakHandWeight > masteredHandWeight && recentWeakHandWeight < weakHandWeight,
  "Adaptive scheduler boosts weak exact questions but cools down recent repeats"
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
    restoredStats.byQuestion["FOUR_BET:default:A5s:DEFAULT:NA"].correct === 2 &&
    restoredStats.recentQuestions.includes("FOUR_BET:default:A5s:DEFAULT:NA") &&
    restoredStats.recentContexts.includes("FOUR_BET:default") &&
    restoredStats.recentHands.includes("AQo") &&
    !restoredStats.recentHands.includes("bad-hand"),
  "Adaptive stats restore synthetic persisted exact-question and recent cooldown state end to end"
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
  "fourBetStatsList",
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
  appJs.includes("MODES.THREE_BET + key.slice(MODES.VS_OPEN.length)") &&
    appJs.includes("correct: Math.min(merged.correct, merged.total)"),
  "Legacy 3-bet spot stats migrate into unified facing-open stats"
);

assert(
  appJs.includes("First in") &&
    appJs.includes("Facing open") &&
    appJs.includes("Facing 3-bet"),
  "Chart exposes one situation selector for first-in, facing-open, and facing-3-bet"
);

assert(
  appJs.includes("MODES.FOUR_BET") &&
    appJs.includes("ACTIONS.FOUR_BET") &&
    appJs.includes("FOUR_BET_CONTEXT_KEY"),
  "Unified drill includes the supported engine-backed facing-3-bet decision"
);

assert(
  schedulerJs.includes("scoreBucket") &&
    schedulerJs.includes("scoreHandOption") &&
    schedulerJs.includes("isSafeQuestionKey") &&
    appJs.includes("PotoTrainerScheduler") &&
    appJs.includes("restoreAdaptiveStats(fallback, parsed") &&
    appJs.includes("recordQuestionResult") &&
    appJs.includes("adaptiveGroupMultiplier") &&
    appJs.includes("recentQuestions"),
  "Adaptive trainer scheduler is loaded, records exact question history, adapts category selection, and avoids stale app-only logic"
);

assert(
  appJs.includes("Adaptive full deck (169)") &&
    !appJs.includes("Uniform (169)") &&
    appJs.includes("return drawAdaptiveHand(args, engine.ALL_HAND_CLASSES)") &&
    appJs.includes("function isAdaptiveDrill()") &&
    appJs.includes("return true;"),
  "Every study plan stays adaptive; full-deck mode adapts over all 169 hands"
);

assert(
  !appJs.includes(".slice(0, 55)") &&
    !appJs.includes(".slice(0, 75)") &&
    !appJs.includes(".slice(0, 85)"),
  "Adaptive sampling keeps full fold/rest hand coverage instead of truncating rest groups"
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
  appJs.includes("engine.profileLabel(profile) + \" profile · Hero \"") &&
    !appJs.includes("openSize: settings.openSize\\n      }) + \" · Hero \""),
  "RFI chart assumption omits hidden open-size text that does not affect RFI output"
);

assert(
  engineJs.includes("chart-three-bet") === false &&
    indexHtml.includes("chart-three-bet") &&
    indexHtml.includes("chart-four-bet") &&
    engineJs.includes('return "three-bet"') &&
    engineJs.includes('return "four-bet"'),
  "Chart colors distinguish 3-bet and 4-bet actions"
);

assert(
  indexHtml.includes("./range-engine.js?v=20260702-adaptive-study") &&
    indexHtml.includes("./trainer-scheduler.js?v=20260702-adaptive-study") &&
    indexHtml.includes("./app.js?v=20260702-adaptive-study") &&
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
