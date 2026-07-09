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
  createElement: (tagName) => new FakeElement(tagName),
  getElementById: (id) => elements.get(id) || null
};
const storage = new Map();
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

["range-engine.js", "trainer-scheduler.js", "app.js"].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(rootDir, file), "utf8"), context, { filename: file });
});

const visibleActions = ["yesActionBtn", "callActionBtn", "noActionBtn"]
  .map((id) => elements.get(id))
  .filter((button) => !button.classList.contains("hidden") && !button.disabled);
assert(visibleActions.length >= 2, "A generated question exposes valid action buttons");

visibleActions[0].click();
assert(!elements.get("feedbackBox").classList.contains("hidden"), "Answering shows feedback");
assert(!elements.get("whyLine").classList.contains("hidden"), "Answering shows coaching immediately");
assert(elements.get("coachReasonLine").textContent, "Coach reason is populated");
assert(elements.get("coachTakeawayLine").textContent, "Coach takeaway is populated");
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

elements.get("openChartsBtn").click();
assert(!elements.get("chartModal").classList.contains("hidden"), "Chart opens");
assert(elements.get("chartModeSelect").options.length === 2, "Chart exposes only the two fully contextualized situations");
assert(elements.get("chartMatrix").children.length === 169, "Chart renders all 169 hand classes");

assert(elements.get("spotLine").scrollIntoViewCalls.length === 0, "Initial question does not force-scroll the page");
elements.get("nextBtn").click();
assert(elements.get("feedbackBox").classList.contains("hidden"), "Next hand clears prior feedback");
assert(elements.get("spotLine").scrollIntoViewCalls.length === 1, "Next hand returns the learner to the question");
assert(elements.get("spotLine").scrollIntoViewCalls[0].block === "start", "Next hand aligns the question at the viewport start");

console.log("App interaction smoke test passed.");
