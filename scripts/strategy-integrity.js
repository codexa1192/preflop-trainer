#!/usr/bin/env node
"use strict";

const engine = require("../range-engine.js");
const crypto = require("crypto");

const EXPECTED_ACTION_SHA256 = "508e1676b5ef9061e4a5852c1bba35cbced7da780b8fd29acbdf48ca8543a0f4";

const result = engine.validateStrategyIntegrity();
const actionSha256 = crypto.createHash("sha256")
  .update(engine.getCorpusActionSnapshot())
  .digest("hex");
if (actionSha256 !== EXPECTED_ACTION_SHA256) {
  result.errors.push("Action snapshot SHA-256 changed: expected " + EXPECTED_ACTION_SHA256 + ", received " + actionSha256);
}
if (!Object.isFrozen(engine.RANGE_PRESETS) ||
    !Object.isFrozen(engine.RANGE_PRESETS[engine.DEFAULT_PRESET_ID]) ||
    !Object.isFrozen(engine.RANGE_PRESETS[engine.DEFAULT_PRESET_ID].vsOpen.spotTemplates)) {
  result.errors.push("Exported strategy corpus must be deeply immutable");
}

console.log("Strategy corpus:", result.corpus.strategyVersion);
console.log("Status:", result.corpus.status, "(" + result.corpus.reviewStatus + ")");
console.log("Fingerprint:", result.corpus.fingerprint);
console.log("Action snapshot SHA-256:", actionSha256);
console.log("Contexts:", result.summary.rfiContexts, "RFI /", result.summary.vsOpenContexts, "facing-open");
console.log("Explicit adjustment rules:", result.summary.explicitAdjustmentRules);
console.log("Disclosed context-level no-op controls:", result.summary.disclosedNoOpControls);

const regressionChecks = [
  {
    label: "Tight BTN>BB KTs/K9s ladder",
    stronger: "KTs",
    weaker: "K9s",
    args: {
      mode: engine.MODES.VS_OPEN,
      openerPosition: "BTN",
      heroPosition: "BB",
      openerProfile: "TIGHT",
      openSize: "STANDARD"
    }
  },
  {
    label: "Large MP1>CO suited-connector ladder",
    stronger: "T9s",
    weaker: "98s",
    args: {
      mode: engine.MODES.VS_OPEN,
      openerPosition: "MP1",
      heroPosition: "CO",
      openerProfile: "BALANCED",
      openSize: "LARGE"
    }
  }
];

regressionChecks.forEach((check) => {
  const stronger = engine.recommend({ ...check.args, hand: check.stronger });
  const weaker = engine.recommend({ ...check.args, hand: check.weaker });
  const strongerContinues = stronger.allowedActions.some((action) => action !== engine.ACTIONS.FOLD);
  const weakerContinues = weaker.allowedActions.some((action) => action !== engine.ACTIONS.FOLD);
  if (!strongerContinues && weakerContinues) {
    result.errors.push(check.label + " regressed: " + check.stronger + " folds while " + check.weaker + " continues");
  }
});

if (result.errors.length) {
  result.errors.forEach((error) => console.error("FAIL:", error));
  process.exitCode = 1;
} else {
  console.log("PASS: corpus provenance, deterministic adjustments, and same-family continuation ladders are internally consistent");
}
