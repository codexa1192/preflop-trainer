#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const engine = require("../range-engine.js");

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
  "vsOpenStatsList"
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
    appJs.includes("4-bet reference"),
  "Chart exposes one situation selector for first-in, facing-open, and 4-bet reference"
);

if (failures > 0) {
  console.error(`${failures} range validation check(s) failed.`);
  process.exit(1);
}

console.log("All range validation checks passed.");
