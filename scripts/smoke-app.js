#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class FakeElement {
  constructor(tagName, attributes) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.attributes = { ...(attributes || {}) };
    this.children = [];
    this.listeners = {};
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this._textContent = "";
    this._innerHTML = "";
    this.scrollIntoViewCalls = [];
    this.style = {};
    this._classes = new Set(String(this.attributes.class || "").split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...names) => names.forEach((name) => this._classes.add(name)),
      remove: (...names) => names.forEach((name) => this._classes.delete(name)),
      contains: (name) => this._classes.has(name),
      toggle: (name, force) => {
        const shouldAdd = force === undefined ? !this._classes.has(name) : Boolean(force);
        if (shouldAdd) {
          this._classes.add(name);
        } else {
          this._classes.delete(name);
        }
        return shouldAdd;
      }
    };
  }

  get className() {
    return Array.from(this._classes).join(" ");
  }

  set className(value) {
    this._classes = new Set(String(value || "").split(/\s+/).filter(Boolean));
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value || "");
    if (!this._textContent) {
      this.children = [];
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    if (!this._innerHTML) {
      this.children = [];
    }
  }

  get options() {
    return this.children.filter((child) => child && child.tagName === "OPTION");
  }

  addEventListener(type, listener) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this.children.push(node);
    if (this.tagName === "SELECT" && !this.value && node && node.value) {
      this.value = node.value;
    }
    return node;
  }

  click() {
    (this.listeners.click || []).forEach((listener) => listener({ target: this }));
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  scrollIntoView(options) {
    this.scrollIntoViewCalls.push(options || {});
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

function parseAttributes(source) {
  const attributes = {};
  String(source || "").replace(/([A-Za-z0-9_-]+)="([^"]*)"/g, (_match, name, value) => {
    attributes[name] = value;
    return _match;
  });
  return attributes;
}

const rootDir = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
const elements = new Map();
html.replace(/<([A-Za-z0-9]+)([^>]*)>/g, (_match, tagName, attributeSource) => {
  const attributes = parseAttributes(attributeSource);
  if (attributes.id) {
    elements.set(attributes.id, new FakeElement(tagName, attributes));
  }
  return _match;
});

const document = {
  activeElement: null,
  hidden: false,
  body: new FakeElement("body"),
  listeners: {},
  createElement: (tagName) => {
    const node = new FakeElement(tagName);
    node.ownerDocument = document;
    return node;
  },
  getElementById: (id) => elements.get(id) || null,
  addEventListener: (type, listener) => {
    document.listeners[type] = document.listeners[type] || [];
    document.listeners[type].push(listener);
  }
};
elements.forEach((node) => {
  node.ownerDocument = document;
});
document.body.ownerDocument = document;
const storage = new Map([
  ["poto_preflop_trainer_settings_v2", JSON.stringify({
    openerProfile: "BALANCED",
    openSize: "STANDARD",
    enabledRfiPositions: ["UTG", "UTG1", "MP1", "MP2", "MP3", "CO", "BTN", "SB"],
    enabledOpeners: ["UTG", "UTG1", "MP1", "MP2", "MP3", "CO", "BTN"],
    drillSamplingMode: "BORDERLINE"
  })]
]);
let nowMs = 1_000_000;
let setFailuresRemaining = 0;
let setAttempts = 0;
class FakeDate extends Date {
  static now() {
    return nowMs;
  }
}
let randomState = 123456789;
const windowListeners = {};
const seededMath = Object.create(Math);
seededMath.random = () => {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 4294967296;
};
const context = vm.createContext({
  console,
  Date: FakeDate,
  document,
  Math: seededMath,
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => {
      setAttempts += 1;
      if (setFailuresRemaining > 0) {
        setFailuresRemaining -= 1;
        throw new Error("Synthetic storage write failure");
      }
      storage.set(key, String(value));
    }
  },
  confirm: () => true,
  clearTimeout: () => {},
  setTimeout: () => 1,
  requestAnimationFrame: (callback) => callback(),
  addEventListener: (type, listener) => {
    windowListeners[type] = windowListeners[type] || [];
    windowListeners[type].push(listener);
  }
});
context.window = context;
context.globalThis = context;

["poto-evidence.js", "range-engine.js", "trainer-scheduler.js", "app.js"].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(rootDir, file), "utf8"), context, { filename: file });
});

function currentActionButtons() {
  return ["yesActionBtn", "callActionBtn", "noActionBtn"]
    .map((id) => elements.get(id))
    .filter((button) => !button.classList.contains("hidden") && !button.disabled);
}

function persistedStats() {
  return JSON.parse(storage.get("poto_preflop_trainer_stats_v4"));
}

const migratedRfiPositions = elements.get("rfiToggleGrid").children
  .map((label) => label.children[0])
  .filter((input) => input.checked)
  .map((input) => input.value);
assert.deepStrictEqual(
  migratedRfiPositions,
  ["MP3", "CO", "BTN", "SB"],
  "The legacy all-position default migrates to the time-efficient four-position focus"
);
assert(
  /model by selected opener/.test(elements.get("profileDefinitionLine").textContent) &&
    /UTG/.test(elements.get("profileDefinitionLine").textContent) &&
    /HJ/.test(elements.get("profileDefinitionLine").textContent) &&
    /response changes only on explicitly tagged boundaries/i.test(elements.get("profileDefinitionLine").textContent),
  "The Villain definition summarizes every selected opener and discloses the response-template boundary"
);

const visibleActions = currentActionButtons();
assert(visibleActions.length >= 2, "A generated question exposes valid action buttons");

nowMs += 2000;
elements.get("openSettingsBtn").click();
nowMs += 5000;
elements.get("closeSettingsBtn").click();
nowMs += 750;
elements.get("openChartsBtn").click();
nowMs += 4000;
elements.get("closeChartBtn").click();
nowMs += 250;
document.hidden = true;
(document.listeners.visibilitychange || []).forEach((listener) => listener());
nowMs += 7000;
document.hidden = false;
(document.listeners.visibilitychange || []).forEach((listener) => listener());
nowMs += 500;
(windowListeners.blur || []).forEach((listener) => listener());
nowMs += 6000;
(windowListeners.focus || []).forEach((listener) => listener());
visibleActions[0].click();
assert(!elements.get("feedbackBox").classList.contains("hidden"), "Answering shows feedback");
assert.strictEqual(elements.get("sessionProgressText").textContent, "1 / 20", "Answering advances the 20-decision focus session");
const savedV4 = JSON.parse(storage.get("poto_preflop_trainer_stats_v4"));
assert.strictEqual(savedV4.schemaVersion, 4, "Stats persist under the v4 schema");
assert(savedV4.strategyFingerprint, "Stats bind mastery to a strategy fingerprint");
assert(savedV4.answerLog[0].chosenAction, "Answer history stores the learner's chosen action");
assert.strictEqual(savedV4.answerLog[0].roomEvidenceVersion, "poto-room-evidence-2026-07-12", "Answer history records the room-evidence version without changing the strategy fingerprint");
assert(savedV4.answerLog[0].conceptKey.includes(savedV4.answerLog[0].hand), "Concept mastery includes the exact hand instead of collapsing a whole suited/offsuit family");
assert(Number.isFinite(savedV4.answerLog[0].responseLatencyMs), "Answer history stores response latency");
assert.strictEqual(savedV4.answerLog[0].responseLatencyMs, 3500, "Response latency counts only visible question time outside app modals");
assert(savedV4.answerLog[0].answeredAt > 0, "Answer history stores an answer timestamp");
assert(savedV4.byLeak[savedV4.answerLog[0].questionKey], "Exact question records back the leak dashboard");
assert(!elements.get("whyLine").classList.contains("hidden"), "Answering shows coaching immediately");
assert(elements.get("coachReasonLine").textContent, "Coach reason is populated");
assert(elements.get("coachTakeawayLine").textContent, "Coach takeaway is populated");
assert(/recollection matches its current listing/i.test(elements.get("roomEvidenceLine").textContent), "Settings distinguish the user's rake recollection from the third-party listing");
assert(/meaning of \$2 still need desk confirmation/i.test(elements.get("roomDropEvidenceLine").textContent), "Settings preserve current promotional-drop uncertainty without false-precision math");
assert(!elements.get("nextBtn").classList.contains("hidden"), "Answering exposes the next-hand action");
const answerDetail = elements.get("detailLine").textContent;
const answerMatch = answerDetail.match(/^You chose ([A-Z0-9-]+) · Default ([A-Z0-9-]+)/);
assert(answerMatch, "Feedback names the chosen and default actions");
if (answerMatch[1] !== answerMatch[2]) {
  assert(!elements.get("coachCorrectionRow").classList.contains("hidden"), "A non-default choice shows action-specific coaching");
  assert(elements.get("coachCorrectionLine").textContent, "Action-specific coaching explains the learner's choice");
}
if (elements.get("resultLine").textContent === "Reasonable alternative") {
  assert(elements.get("feedbackBox").classList.contains("feedback-acceptable"), "A reasonable alternative uses neutral feedback styling");
}

elements.get("whyBtn").click();
assert(elements.get("whyLine").classList.contains("hidden"), "Explanation control hides coaching");
elements.get("whyBtn").click();
assert(!elements.get("whyLine").classList.contains("hidden"), "Explanation control restores coaching");

elements.get("viewCurrentChartBtn").click();
assert.strictEqual(elements.get("chartDetail").scrollIntoViewCalls.length, 1, "Viewing the current chart reveals that exact hand's explanation");
elements.get("closeChartBtn").click();
elements.get("chartDetail").scrollIntoViewCalls = [];

assert(elements.get("spotLine").scrollIntoViewCalls.length === 0, "Initial question does not force-scroll the page");
elements.get("nextBtn").click();
assert(elements.get("feedbackBox").classList.contains("hidden"), "Next hand clears prior feedback");
assert(elements.get("spotLine").scrollIntoViewCalls.length === 1, "Next hand returns the learner to the question");
assert(elements.get("spotLine").scrollIntoViewCalls[0].block === "start", "Next hand aligns the question at the viewport start");
assert.strictEqual(document.activeElement, elements.get("questionPanel"), "Next hand moves keyboard focus to the labeled question region");

let latestStats = persistedStats();
let leak = Object.values(latestStats.byLeak).find((row) => row.misses > 0);
for (let attempt = 0; !leak && attempt < 20; attempt += 1) {
  const actions = currentActionButtons();
  const preferredProbeActions = ["CALL", "PASS", "FOLD", "3BET", "OPEN"];
  const requestedAction = preferredProbeActions[attempt % preferredProbeActions.length];
  const choice = actions.find((button) => button.attributes["data-action"] === requestedAction) ||
    actions[actions.length - 1];
  choice.click();
  latestStats = persistedStats();
  leak = Object.values(latestStats.byLeak).find((row) => row.misses > 0);
  if (!leak) elements.get("nextBtn").click();
}
assert(leak, "Smoke flow establishes one exact leak for targeted review");

const targetKey = leak.questionKey;
const repeatedWrongAction = Object.keys(leak.wrongActions)[0];
elements.get("drillTopLeakBtn").click();
assert.strictEqual(elements.get("sessionProgressText").textContent, "0 / 10", "Targeted review is long enough for its first spaced recheck");
assert.strictEqual(document.activeElement, elements.get("questionPanel"), "Starting a targeted review focuses the labeled question region");
let targetAppearances = 0;
for (let answer = 0; answer < 10; answer += 1) {
  const actions = currentActionButtons();
  const choice = answer === 0
    ? actions.find((button) => button.attributes["data-action"] === repeatedWrongAction)
    : actions[0];
  assert(choice, "Each targeted question exposes a selectable action");
  choice.click();
  latestStats = persistedStats();
  if (latestStats.answerLog[0].questionKey === targetKey) targetAppearances += 1;
  if (answer < 9) elements.get("nextBtn").click();
}
assert(targetAppearances >= 2, "A repeatedly missed target reappears after its first spaced review window");
elements.get("nextBtn").click();
assert.strictEqual(elements.get("sessionCompleteTitle").textContent, "Leak review session complete", "Completion describes the session without claiming mastery");

const exactLeakSpot = leak.args.mode === "VS_OPEN"
  ? leak.args.openerPosition + ">" + leak.args.heroPosition
  : null;
const spotToggle = elements.get("vsSpotToggleGrid").children
  .map((label) => label.children[0])
  .find((input) => input.checked && (!exactLeakSpot || input.value === exactLeakSpot));
spotToggle.checked = false;
(spotToggle.listeners.change || []).forEach((listener) => listener({ target: spotToggle }));
assert.strictEqual(elements.get("sessionProgressText").textContent, "0 / 20", "Changing an exact facing-open spot clears a targeted session and starts a clean focus");
if (exactLeakSpot) {
  assert.strictEqual(elements.get("nextPriorityTitle").textContent, "No established leak yet", "Disabling a facing-open spot removes its leak from the dashboard");
}

const settingGrid = leak.args.mode === "RFI" ? elements.get("heroBaselineGrid") : elements.get("villainProfileGrid");
const activeSetting = leak.args.mode === "RFI" ? leak.args.heroBaseline : leak.args.openerProfile;
const changedSetting = settingGrid.children
  .map((label) => label.children[0])
  .find((input) => input.value !== activeSetting);
changedSetting.checked = true;
(changedSetting.listeners.change || []).forEach((listener) => listener({ target: changedSetting }));
assert.strictEqual(elements.get("nextPriorityTitle").textContent, "No established leak yet", "The dashboard hides leaks outside the current training settings");
assert.strictEqual(elements.get("sessionProgressText").textContent, "0 / 20", "Changing strategy settings starts a clean focus session");

elements.get("openChartsBtn").click();
assert(!elements.get("chartModal").classList.contains("hidden"), "Chart opens");
assert.strictEqual(elements.get("appContent").inert, true, "Opening a modal makes the background inert");
assert(elements.get("chartModeSelect").options.length === 2, "Chart exposes only the two fully contextualized situations");
assert(elements.get("chartMatrix").children.length === 169, "Chart renders all 169 hand classes");
const mixedChartCell = elements.get("chartMatrix").children.find((cell) => /reasonable alternative/.test(cell.attributes["aria-label"] || ""));
assert(mixedChartCell, "Mixed chart cells expose their default and reasonable alternative to assistive technology");
assert.strictEqual(elements.get("chartMatrix").children.filter((cell) => cell.tabIndex === 0).length, 1, "The hand chart exposes one keyboard tab stop instead of 169");
const chartModeControl = elements.get("chartModeSelect");
(chartModeControl.listeners.change || []).forEach((listener) => listener({ target: chartModeControl }));
assert.strictEqual(
  elements.get("chartMatrix").children.filter((cell) => cell.tabIndex === 0).length,
  1,
  "Changing a chart selector preserves exactly one keyboard tab stop"
);
const chartInitialTabStop = elements.get("chartMatrix").children.find((cell) => cell.tabIndex === 0);
const selectorArrowTarget = elements.get("chartMatrix").children[1];
(chartInitialTabStop.listeners.keydown || []).forEach((listener) => listener({ key: "ArrowRight", preventDefault: () => {} }));
assert(
  document.activeElement === selectorArrowTarget &&
    elements.get("chartDetail").children[0].textContent.startsWith(selectorArrowTarget.textContent + " ·"),
  "Arrow navigation remains synchronized after changing a chart selector"
);
elements.get("chartDetail").scrollIntoViewCalls = [];
const refreshedMixedChartCell = elements.get("chartMatrix").children.find((cell) => /reasonable alternative/.test(cell.attributes["aria-label"] || ""));
assert(refreshedMixedChartCell, "Selector changes preserve mixed chart cells");
refreshedMixedChartCell.click();
assert.strictEqual(elements.get("chartDetail").scrollIntoViewCalls.length, 1, "Selecting a chart hand reveals its coaching detail");
const mixedCellIndex = elements.get("chartMatrix").children.indexOf(refreshedMixedChartCell);
const arrowTarget = elements.get("chartMatrix").children[Math.min(168, mixedCellIndex + 1)];
(refreshedMixedChartCell.listeners.keydown || []).forEach((listener) => listener({ key: "ArrowRight", preventDefault: () => {} }));
assert.strictEqual(document.activeElement, arrowTarget, "Arrow keys move focus between chart hands");
assert.strictEqual(arrowTarget.tabIndex, 0, "Arrow navigation moves the chart's single tab stop with focus");
assert(
  elements.get("chartDetail").children[0].textContent.startsWith(arrowTarget.textContent + " ·"),
  "Arrow navigation keeps the visible chart explanation synchronized with the focused hand"
);
const selectChartValue = (id, value) => {
  const control = elements.get(id);
  control.value = value;
  (control.listeners.change || []).forEach((listener) => listener({ target: control }));
};
selectChartValue("chartModeSelect", context.PotoRangeEngine.MODES.VS_OPEN);
selectChartValue("chartOpenerSelect", "UTG");
selectChartValue("chartHeroSelect", "UTG1");
selectChartValue("chartProfileSelect", "TIGHT");
selectChartValue("chartSizeSelect", "STANDARD");
const sameDefaultDifferentMixCell = elements.get("chartMatrix").children.find((cell) => cell.textContent === "AQo");
assert(sameDefaultDifferentMixCell, "Known same-default counterfactual fixture exists in the chart");
sameDefaultDifferentMixCell.click();
const fullPlanChangeLine = elements.get("chartDetail").children
  .map((child) => child.textContent)
  .find((text) => text.startsWith("What changes:"));
assert(
  /Villain model BALANCED → FOLD or 3-BET \(default FOLD\)\./.test(fullPlanChangeLine || ""),
  "A counterfactual with the same default names the mixed action-plan change instead of repeating FOLD"
);
elements.get("closeChartBtn").click();
assert.strictEqual(elements.get("appContent").inert, false, "Closing a modal restores the background");

elements.get("openSettingsBtn").focus();
elements.get("openSettingsBtn").click();
assert(!elements.get("settingsModal").classList.contains("hidden"), "Settings opens");
(document.listeners.keydown || []).forEach((listener) => listener({ key: "Escape", preventDefault: () => {} }));
assert(elements.get("settingsModal").classList.contains("hidden"), "Escape closes the active modal");
assert.strictEqual(document.activeElement, elements.get("openSettingsBtn"), "Closing a modal restores focus");
assert(elements.get("heroBaselineGrid").children.length > 0, "Settings expose a dedicated Hero baseline");
assert(elements.get("villainProfileGrid").children.length === 3, "Settings expose a separate Villain model");
assert(elements.get("vsSpotToggleGrid").children.length === 35, "Settings expose all exact facing-open spots");

function checkedValue(gridId) {
  const input = elements.get(gridId).children
    .map((label) => label.children[0])
    .find((candidate) => candidate.checked);
  return input && input.value;
}

function recommendationForCurrentQuestion() {
  const engine = context.PotoRangeEngine;
  const spot = elements.get("spotLine").textContent;
  const hand = elements.get("handLine").textContent;
  if (spot.startsWith("First in - Hero ")) {
    const label = spot.slice("First in - Hero ".length);
    const position = engine.RFI_POSITIONS.find((id) => engine.positionLabel(id) === label);
    return engine.recommend({
      mode: engine.MODES.RFI,
      position,
      hand,
      heroBaseline: checkedValue("heroBaselineGrid")
    });
  }
  const match = spot.match(/^Facing open - (.+) opens, Hero (.+)$/);
  assert(match, "The current facing-open question has a parseable context label");
  const exactSpot = engine.getValidVsOpenSpots().find((candidate) =>
    engine.positionLabel(candidate.openerPosition) === match[1] &&
    engine.positionLabel(candidate.heroPosition) === match[2]
  );
  assert(exactSpot, "The current facing-open labels map back to an exact strategy spot");
  return engine.recommend({
    mode: engine.MODES.VS_OPEN,
    openerPosition: exactSpot.openerPosition,
    heroPosition: exactSpot.heroPosition,
    hand,
    openerProfile: checkedValue("villainProfileGrid"),
    openSize: checkedValue("openSizeGrid")
  });
}

let acceptableLeak = null;
for (let probe = 0; !acceptableLeak && probe < 40; probe += 1) {
  const recommendation = recommendationForCurrentQuestion();
  const alternative = recommendation.allowedActions.find((action) => action !== recommendation.primaryAction);
  const action = alternative || recommendation.primaryAction;
  const button = currentActionButtons().find((candidate) => candidate.attributes["data-action"] === action);
  assert(button, "The preferred or acceptable action is available in the current drill");
  button.click();
  if (alternative) {
    const snapshot = persistedStats();
    acceptableLeak = snapshot.byLeak[snapshot.answerLog[0].questionKey];
    assert.strictEqual(elements.get("resultLine").textContent, "Reasonable alternative", "A mixed-strategy alternative remains a passing answer");
    assert.strictEqual(acceptableLeak.misses, 0, "A reasonable alternative is not recorded as a miss");
    assert.strictEqual(acceptableLeak.nonPreferred, 1, "A reasonable alternative records a preferred-action gap");
    assert.strictEqual(acceptableLeak.unresolved, true, "A preferred-action gap enters relearning");
    const displayedCard = elements.get("leakList").children.find((item) =>
      item.children[0] && item.children[0].children[0] &&
      item.children[0].children[0].textContent.startsWith(acceptableLeak.hand + " · ")
    );
    assert(displayedCard, "The leak dashboard surfaces an unresolved acceptable-but-nonpreferred decision");
    assert(/Accepted but non-default/.test(displayedCard.children[0].children[1].textContent), "The dashboard explains a preferred-action gap without calling it a miss");
    break;
  }
  elements.get("nextBtn").click();
  if (!elements.get("sessionCompletePanel").classList.contains("hidden")) {
    elements.get("restartSessionBtn").click();
  }
}
assert(acceptableLeak, "The focused sampler reaches a mixed-strategy alternative for dashboard regression coverage");

const samplingInputs = elements.get("drillSamplingGrid").children.map((label) => label.children[0]);
const originalSampling = samplingInputs.find((input) => input.checked);
const alternateSampling = samplingInputs.find((input) => !input.checked);
const writesBeforeSettingsRecovery = setAttempts;
setFailuresRemaining = 1;
originalSampling.checked = false;
alternateSampling.checked = true;
(alternateSampling.listeners.change || []).forEach((listener) => listener({ target: alternateSampling }));
assert(/Progress cannot be saved/.test(elements.get("masteryLine").textContent), "A failed settings write immediately shows the persistence warning");
assert(/Could not save settings/.test(elements.get("settingsNotice").textContent), "A failed settings write is visible inside the open Settings modal");
alternateSampling.checked = false;
originalSampling.checked = true;
(originalSampling.listeners.change || []).forEach((listener) => listener({ target: originalSampling }));
assert.strictEqual(setAttempts, writesBeforeSettingsRecovery + 2, "A later settings save retries storage after a write failure");
assert(!/Progress cannot be saved/.test(elements.get("masteryLine").textContent), "A successful settings retry clears stale persistence feedback");
assert(/Settings saving restored/.test(elements.get("settingsNotice").textContent), "A recovered settings write replaces the visible failure notice");

setFailuresRemaining = 1;
elements.get("quickLiveDefaultsBtn").click();
assert(
  /defaults apply to this tab, but could not be saved/.test(elements.get("settingsNotice").textContent),
  "Quick Live Defaults does not overwrite a save failure with false success"
);
elements.get("quickLiveDefaultsBtn").click();
assert.strictEqual(
  elements.get("settingsNotice").textContent,
  "Live $1/$3 defaults restored.",
  "Quick Live Defaults claims durable success only after persistence recovers"
);

const writesBeforeRecoveryTest = setAttempts;
setFailuresRemaining = 1;
elements.get("resetStatsBtn").click();
assert(/Progress cannot be saved/.test(elements.get("masteryLine").textContent), "A storage write failure stays visible to the learner");
assert(/could not be saved/.test(elements.get("settingsNotice").textContent), "Reset Stats does not claim durable success after a failed write");
elements.get("resetStatsBtn").click();
assert.strictEqual(setAttempts, writesBeforeRecoveryTest + 2, "A later save retries storage after a write failure");
assert.strictEqual(persistedStats().total, 0, "Reset Stats persists after storage becomes available again");
assert(!/Progress cannot be saved/.test(elements.get("masteryLine").textContent), "A successful retry clears the persistence warning");
assert.strictEqual(elements.get("settingsNotice").textContent, "Stats reset.", "Reset Stats claims success only after persistence succeeds");

const appSource = fs.readFileSync(path.join(rootDir, "app.js"), "utf8");
[
  { missing: "range engine", globals: { PotoTrainerScheduler: {}, PotoEvidence: {} } },
  { missing: "scheduler", globals: { PotoRangeEngine: {}, PotoEvidence: {} } },
  { missing: "evidence", globals: { PotoRangeEngine: {}, PotoTrainerScheduler: {} } }
].forEach(({ missing, globals }) => {
  const bootHost = new FakeElement("main");
  const bootDocument = {
    body: new FakeElement("body"),
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => id === "appContent" ? bootHost : null
  };
  const bootContext = vm.createContext({ console, document: bootDocument, ...globals });
  bootContext.window = bootContext;
  bootContext.globalThis = bootContext;
  assert.doesNotThrow(
    () => vm.runInContext(appSource, bootContext, { filename: "app.js" }),
    "A missing " + missing + " dependency does not crash app boot"
  );
  assert.strictEqual(bootHost.children.length, 1, "A missing " + missing + " dependency renders one calm boot error");
  assert.strictEqual(bootHost.children[0].attributes.role, "alert", "The boot error is announced accessibly");
  assert.strictEqual(bootHost.children[0].children[0].textContent, "Trainer couldn't start", "The boot error explains the visible state");
  assert(/refresh this page/.test(bootHost.children[0].children[1].textContent), "The boot error gives a recovery action");
});

const watchdogMatch = html.match(/<script id="bootWatchdog">([\s\S]*?)<\/script>/);
assert(watchdogMatch, "The HTML includes an app-script boot watchdog");
const missingAppHost = new FakeElement("main");
const missingAppDocument = {
  body: new FakeElement("body"),
  createElement: (tagName) => new FakeElement(tagName),
  getElementById: (id) => id === "appContent" ? missingAppHost : null
};
const missingAppWindow = {
  PotoTrainerReady: false,
  setTimeout: (callback) => callback()
};
vm.runInNewContext(watchdogMatch[1], { window: missingAppWindow, document: missingAppDocument });
assert.strictEqual(missingAppHost.children.length, 1, "A missing app.js request replaces the loading shell with one recovery panel");
assert.strictEqual(missingAppHost.children[0].attributes.role, "alert", "The missing-app recovery panel is announced accessibly");
assert.strictEqual(missingAppHost.children[0].children[0].textContent, "Trainer couldn't start", "The app watchdog prevents a plausible dead trainer");
assert(
  /id="questionPanel"[^>]*aria-busy="true"/.test(html) &&
    /id="yesActionBtn"[^>]*disabled/.test(html) &&
    /<noscript>/.test(html),
  "The static shell is visibly loading and inert before JavaScript succeeds"
);

console.log("App interaction smoke test passed.");
