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
let randomState = 123456789;
const seededMath = Object.create(Math);
seededMath.random = () => {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 4294967296;
};
const context = vm.createContext({
  console,
  document,
  Math: seededMath,
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value))
  },
  confirm: () => true,
  clearTimeout: () => {},
  setTimeout: () => 1
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

const visibleActions = currentActionButtons();
assert(visibleActions.length >= 2, "A generated question exposes valid action buttons");

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

console.log("App interaction smoke test passed.");
