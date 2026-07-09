(() => {
  "use strict";

  const engine = window.PotoRangeEngine;
  const scheduler = window.PotoTrainerScheduler;
  const ACTIONS = engine.ACTIONS;
  const MODES = engine.MODES;

  if (!scheduler) {
    throw new Error("PotoTrainerScheduler failed to load.");
  }

  const STORAGE_KEYS = {
    settings: "poto_preflop_trainer_settings_v2",
    stats: "poto_preflop_trainer_stats_v3"
  };

  const SAMPLING = {
    UNIFORM: "UNIFORM",
    BORDERLINE: "BORDERLINE"
  };

  const SAMPLING_LABELS = {
    [SAMPLING.UNIFORM]: "Full deck review (169)",
    [SAMPLING.BORDERLINE]: "Challenge mode (range edges)"
  };
  const AUTOPILOT_VALUE_HANDS = new Set(["AA", "KK"]);

  const DECISION_MIX = [
    { id: MODES.RFI, label: "First in", weight: 0.35 },
    { id: MODES.VS_OPEN, label: "Facing open", weight: 0.65 }
  ];
  const LIVE_OPEN_SIZE_CLASSES = engine.OPEN_SIZE_CLASSES.filter((item) => item.id !== "SMALL");

  let storageAvailable = true;
  let settings = loadSettings();
  let stats = loadStats();
  let currentQuestion = null;
  let whyVisible = false;
  const samplerState = {};

  const el = {
    openChartsBtn: document.getElementById("openChartsBtn"),
    openSettingsBtn: document.getElementById("openSettingsBtn"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    settingsModal: document.getElementById("settingsModal"),
    settingsNotice: document.getElementById("settingsNotice"),
    profileGrid: document.getElementById("profileGrid"),
    openSizeGrid: document.getElementById("openSizeGrid"),
    rfiToggleGrid: document.getElementById("rfiToggleGrid"),
    drillSamplingGrid: document.getElementById("drillSamplingGrid"),
    openerToggleGrid: document.getElementById("openerToggleGrid"),
    decisionMixNote: document.getElementById("decisionMixNote"),
    quickLiveDefaultsBtn: document.getElementById("quickLiveDefaultsBtn"),
    resetStatsBtn: document.getElementById("resetStatsBtn"),
    spotLine: document.getElementById("spotLine"),
    assumptionLine: document.getElementById("assumptionLine"),
    samplingLine: document.getElementById("samplingLine"),
    handLine: document.getElementById("handLine"),
    actionsRow: document.getElementById("actionsRow"),
    yesActionBtn: document.getElementById("yesActionBtn"),
    callActionBtn: document.getElementById("callActionBtn"),
    noActionBtn: document.getElementById("noActionBtn"),
    feedbackBox: document.getElementById("feedbackBox"),
    resultLine: document.getElementById("resultLine"),
    detailLine: document.getElementById("detailLine"),
    whyBtn: document.getElementById("whyBtn"),
    whyLine: document.getElementById("whyLine"),
    coachReasonLine: document.getElementById("coachReasonLine"),
    coachCorrectionLine: document.getElementById("coachCorrectionLine"),
    coachCorrectionRow: document.getElementById("coachCorrectionRow"),
    coachAdjustmentLine: document.getElementById("coachAdjustmentLine"),
    coachAdjustmentRow: document.getElementById("coachAdjustmentRow"),
    coachTakeawayLine: document.getElementById("coachTakeawayLine"),
    viewCurrentChartBtn: document.getElementById("viewCurrentChartBtn"),
    nextBtn: document.getElementById("nextBtn"),
    attemptsValue: document.getElementById("attemptsValue"),
    correctValue: document.getElementById("correctValue"),
    accuracyValue: document.getElementById("accuracyValue"),
    rfiStatsList: document.getElementById("rfiStatsList"),
    vsOpenStatsList: document.getElementById("vsOpenStatsList"),
    missList: document.getElementById("missList"),
    chartModal: document.getElementById("chartModal"),
    closeChartBtn: document.getElementById("closeChartBtn"),
    chartModeSelect: document.getElementById("chartModeSelect"),
    chartHeroSelect: document.getElementById("chartHeroSelect"),
    chartOpenerSelect: document.getElementById("chartOpenerSelect"),
    chartProfileSelect: document.getElementById("chartProfileSelect"),
    chartSizeSelect: document.getElementById("chartSizeSelect"),
    chartAssumptionLine: document.getElementById("chartAssumptionLine"),
    chartOpenerControl: document.getElementById("chartOpenerControl"),
    chartHeroControl: document.getElementById("chartHeroControl"),
    chartProfileControl: document.getElementById("chartProfileControl"),
    chartSizeControl: document.getElementById("chartSizeControl"),
    chartMatrix: document.getElementById("chartMatrix"),
    chartDetail: document.getElementById("chartDetail")
  };

  bindEvents();
  buildSettingsUI();
  buildChartControls();
  renderStats();
  nextQuestion();

  function bindEvents() {
    el.yesActionBtn.addEventListener("click", () => submitAnswer(getButtonAction(el.yesActionBtn)));
    el.callActionBtn.addEventListener("click", () => submitAnswer(getButtonAction(el.callActionBtn)));
    el.noActionBtn.addEventListener("click", () => submitAnswer(getButtonAction(el.noActionBtn)));
    el.whyBtn.addEventListener("click", toggleWhyLine);
    el.viewCurrentChartBtn.addEventListener("click", openCurrentChart);
    el.nextBtn.addEventListener("click", nextQuestion);

    el.openSettingsBtn.addEventListener("click", openSettings);
    el.closeSettingsBtn.addEventListener("click", closeSettings);
    el.openChartsBtn.addEventListener("click", openChart);
    el.closeChartBtn.addEventListener("click", closeChart);
    el.quickLiveDefaultsBtn.addEventListener("click", resetToLiveDefaults);

    el.settingsModal.addEventListener("click", (evt) => {
      if (evt.target === el.settingsModal) {
        closeSettings();
      }
    });

    el.chartModal.addEventListener("click", (evt) => {
      if (evt.target === el.chartModal) {
        closeChart();
      }
    });

    [el.chartModeSelect, el.chartHeroSelect, el.chartOpenerSelect, el.chartProfileSelect, el.chartSizeSelect].forEach((control) => {
      control.addEventListener("change", renderChart);
    });

    el.resetStatsBtn.addEventListener("click", () => {
      if (!window.confirm("Reset all trainer stats?")) {
        return;
      }
      stats = defaultStats();
      saveStats();
      renderStats();
      showNotice("Stats reset.");
    });
  }

  function openSettings() {
    el.settingsModal.classList.remove("hidden");
    el.settingsModal.setAttribute("aria-hidden", "false");
    if (!storageAvailable) {
      showNotice("Local storage unavailable. Settings and stats are session-only.");
    }
  }

  function closeSettings() {
    el.settingsModal.classList.add("hidden");
    el.settingsModal.setAttribute("aria-hidden", "true");
  }

  function openChart() {
    syncChartControlsFromSettings();
    el.chartModal.classList.remove("hidden");
    el.chartModal.setAttribute("aria-hidden", "false");
    renderChart();
  }

  function closeChart() {
    el.chartModal.classList.add("hidden");
    el.chartModal.setAttribute("aria-hidden", "true");
  }

  function openCurrentChart() {
    if (!currentQuestion) {
      openChart();
      return;
    }

    el.chartModeSelect.value = currentQuestion.mode;
    el.chartProfileSelect.value = settings.openerProfile;
    el.chartSizeSelect.value = settings.openSize;

    if (currentQuestion.mode === MODES.RFI) {
      rebuildHeroOptions(MODES.RFI, currentQuestion.position);
    } else {
      el.chartOpenerSelect.value = currentQuestion.openerPosition;
      rebuildHeroOptions(MODES.VS_OPEN, currentQuestion.heroPosition);
    }

    el.chartModal.classList.remove("hidden");
    el.chartModal.setAttribute("aria-hidden", "false");
    renderChart(currentQuestion.handClass);
  }

  function buildSettingsUI() {
    buildRadioGroup({
      grid: el.profileGrid,
      name: "openerProfile",
      values: engine.OPENER_PROFILES,
      selected: settings.openerProfile,
      onChange: (value) => updateSetting("openerProfile", value)
    });

    buildRadioGroup({
      grid: el.openSizeGrid,
      name: "openSize",
      values: LIVE_OPEN_SIZE_CLASSES,
      selected: settings.openSize,
      onChange: (value) => updateSetting("openSize", value)
    });

    buildToggleGroup({
      grid: el.rfiToggleGrid,
      values: engine.RFI_POSITIONS,
      selected: settings.enabledRfiPositions,
      settingKey: "enabledRfiPositions",
      itemLabel: engine.positionLabel
    });

    buildToggleGroup({
      grid: el.openerToggleGrid,
      values: engine.VS_OPEN_OPENERS,
      selected: settings.enabledOpeners,
      settingKey: "enabledOpeners",
      itemLabel: (value) => engine.positionLabel(value) + " opens"
    });

    buildSamplingGrid(el.drillSamplingGrid, "drillSamplingMode", settings.drillSamplingMode);
    el.decisionMixNote.innerHTML = '<p class="setting-note">Challenge mode spends 95% of new questions on mixed decisions and true range edges, then adapts to the exact spots you miss. Facing-3-bet decisions are withheld until position, sizing, and call ranges are modeled.</p>';
  }

  function resetToLiveDefaults() {
    settings = defaultSettings();
    saveSettings();
    buildSettingsUI();
    renderStats();
    nextQuestion();
    showNotice("Live $1/$3 defaults restored.");
  }

  function updateSetting(key, value) {
    if (settings[key] === value) {
      return;
    }
    settings[key] = value;
    saveSettings();
    renderStats();
    nextQuestion();
  }

  function buildRadioGroup(args) {
    const { grid, name, values, selected, onChange } = args;
    grid.textContent = "";
    values.forEach((option) => {
      const id = name + "_" + option.id;
      const row = document.createElement("label");
      row.className = "radio-row";
      row.setAttribute("for", id);

      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.id = id;
      input.value = option.id;
      input.checked = selected === option.id;

      const text = document.createElement("span");
      text.textContent = option.label;

      input.addEventListener("change", () => {
        if (input.checked) {
          onChange(option.id);
        }
      });

      row.append(input, text);
      grid.appendChild(row);
    });
  }

  function buildSamplingGrid(grid, settingKey, selected) {
    grid.textContent = "";
    Object.entries(SAMPLING_LABELS).forEach(([value, label]) => {
      const id = settingKey + "_" + value;
      const row = document.createElement("label");
      row.className = "radio-row";
      row.setAttribute("for", id);

      const input = document.createElement("input");
      input.type = "radio";
      input.name = settingKey;
      input.id = id;
      input.value = value;
      input.checked = selected === value;

      const text = document.createElement("span");
      text.textContent = label;

      input.addEventListener("change", () => {
        if (!input.checked || settings[settingKey] === value) {
          return;
        }
        settings[settingKey] = value;
        saveSettings();
        nextQuestion();
      });

      row.append(input, text);
      grid.appendChild(row);
    });
  }

  function buildToggleGroup(args) {
    const { grid, values, selected, settingKey, itemLabel } = args;
    grid.textContent = "";
    const selectedSet = new Set(selected);

    values.forEach((value) => {
      const id = settingKey + "_" + value;
      const row = document.createElement("label");
      row.className = "check-row";
      row.setAttribute("for", id);

      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = id;
      input.value = value;
      input.checked = selectedSet.has(value);

      const text = document.createElement("span");
      text.textContent = itemLabel(value);

      input.addEventListener("change", () => {
        const nextValues = settings[settingKey].slice();
        const idx = nextValues.indexOf(value);

        if (input.checked && idx === -1) {
          nextValues.push(value);
        } else if (!input.checked && idx !== -1) {
          nextValues.splice(idx, 1);
        }

        if (nextValues.length === 0) {
          input.checked = true;
          showNotice("Keep at least one option enabled.");
          return;
        }

        settings[settingKey] = values.filter((item) => nextValues.includes(item));
        saveSettings();
        renderStats();
        nextQuestion();
      });

      row.append(input, text);
      grid.appendChild(row);
    });
  }

  function showNotice(text) {
    el.settingsNotice.textContent = text;
    window.clearTimeout(showNotice.timerRef);
    showNotice.timerRef = window.setTimeout(() => {
      el.settingsNotice.textContent = "";
    }, 1800);
  }

  function nextQuestion() {
    currentQuestion = generateQuestion();
    whyVisible = false;
    renderQuestion();
  }

  function generateQuestion() {
    const mode = drawDecisionMode();

    if (mode === MODES.RFI) {
      const position = drawRfiPosition();
      const handArgs = {
        mode,
        position,
        samplingMode: settings.drillSamplingMode
      };
      const handClass = sampleHand(handArgs);
      const recommendation = engine.recommend({
        mode,
        position,
        hand: handClass,
        openerProfile: settings.openerProfile,
        openSize: settings.openSize
      });
      return {
        mode,
        position,
        handClass,
        recommendation,
        questionKey: buildQuestionKey(handArgs, handClass),
        statsContextKey: statsContextKeyForArgs(handArgs),
        answered: false
      };
    }

    const spot = drawVsOpenSpot();
    const handArgs = {
      mode: MODES.VS_OPEN,
      openerPosition: spot.openerPosition,
      heroPosition: spot.heroPosition,
      samplingMode: settings.drillSamplingMode
    };
    const handClass = sampleHand(handArgs);
    const recommendation = engine.recommend({
      mode: MODES.VS_OPEN,
      openerPosition: spot.openerPosition,
      heroPosition: spot.heroPosition,
      hand: handClass,
      openerProfile: settings.openerProfile,
      openSize: settings.openSize
    });

    return {
      mode,
      openerPosition: spot.openerPosition,
      heroPosition: spot.heroPosition,
      handClass,
      recommendation,
      questionKey: buildQuestionKey(handArgs, handClass),
      statsContextKey: statsContextKeyForArgs(handArgs),
      answered: false
    };
  }

  function drawDecisionMode() {
    const signature = settings.enabledRfiPositions.join("|") + ":" + settings.enabledOpeners.join("|");
    if (isAdaptiveDrill()) {
      const options = DECISION_MIX.map((item) => ({
        id: item.id,
        weight: item.weight * scheduler.scoreBucket(modeStatsBucket(item.id), false)
      }));
      return drawWeightedOption(options).id;
    }
    return drawWeighted("context:decision", DECISION_MIX, signature);
  }

  function drawRfiPosition() {
    if (!isAdaptiveDrill()) {
      return drawEven("context:RFI", settings.enabledRfiPositions, settings.enabledRfiPositions.join("|"));
    }
    const options = settings.enabledRfiPositions.map((position) => ({
      id: position,
      value: position,
      contextKey: statsContextKeyForArgs({ mode: MODES.RFI, position })
    }));
    return drawAdaptiveContext(options).value;
  }

  function drawVsOpenSpot() {
    const valid = enabledVsOpenSpots();
    if (isAdaptiveDrill()) {
      const options = valid.map((spot) => ({
        id: spot.key,
        value: spot,
        contextKey: statsContextKeyForArgs({
          mode: MODES.VS_OPEN,
          openerPosition: spot.openerPosition,
          heroPosition: spot.heroPosition
        })
      }));
      return drawAdaptiveContext(options).value;
    }
    return drawEven("context:" + MODES.VS_OPEN, valid, settings.enabledOpeners.join("|") + ":" + valid.length);
  }

  function sampleHand(args) {
    if (args.samplingMode === SAMPLING.UNIFORM) {
      if (isAdaptiveDrill()) {
        return drawAdaptiveHand(args, engine.ALL_HAND_CLASSES);
      }
      return drawEven("hands:uniform:" + args.mode, engine.ALL_HAND_CLASSES, "all");
    }

    const options = buildChallengeOptions(args);
    if (isAdaptiveDrill()) {
      return drawAdaptiveChallengeHand(args, options);
    }
    return drawWeightedOption(options.map((option) => ({
      id: option.hand,
      value: option.hand,
      weight: option.weight
    }))).value;
  }

  function drawAdaptiveContext(options) {
    const recentContexts = new Set(stats.recentContexts || []);
    const scored = options.map((option) => ({
      ...option,
      weight: scheduler.scoreBucket(stats.byContext[option.contextKey], recentContexts.has(option.contextKey))
    }));
    const fresh = scored.filter((option) => !recentContexts.has(option.contextKey));
    return drawWeightedOption(fresh.length ? fresh : scored);
  }

  function drawAdaptiveHand(args, values) {
    const recentQuestions = new Set(stats.recentQuestions || []);
    const recentHands = new Set(stats.recentHands || []);
    const options = values.map((hand) => {
      const questionKey = buildQuestionKey(args, hand);
      return {
        id: hand,
        value: hand,
        questionKey,
        weight: scheduler.scoreHandOption({
          record: stats.byQuestion[questionKey],
          sequence: stats.sequence,
          isRecentQuestion: recentQuestions.has(questionKey),
          isRecentHand: recentHands.has(hand)
        })
      };
    });
    const fresh = options.filter((option) => !recentQuestions.has(option.questionKey));
    const candidates = fresh.length ? fresh : options;
    return drawWeightedOption(scheduler.capWeightedOptions(candidates, 0.18)).value;
  }

  function drawAdaptiveChallengeHand(args, challengeOptions) {
    const recentQuestions = new Set(stats.recentQuestions || []);
    const recentHands = new Set(stats.recentHands || []);
    const options = challengeOptions.map((option) => {
      const questionKey = buildQuestionKey(args, option.hand);
      return {
        id: option.hand,
        value: option.hand,
        questionKey,
        weight: option.weight * scheduler.scoreHandOption({
          record: stats.byQuestion[questionKey],
          sequence: stats.sequence,
          isRecentQuestion: recentQuestions.has(questionKey),
          isRecentHand: recentHands.has(option.hand)
        })
      };
    });
    const fresh = options.filter((option) => !recentQuestions.has(option.questionKey));
    const candidates = fresh.length ? fresh : options;
    return drawWeightedOption(scheduler.capWeightedOptions(candidates, 0.18)).value;
  }

  function drawWeightedOption(options) {
    if (!options.length) {
      throw new Error("Cannot draw from empty weighted options.");
    }
    const totalWeight = options.reduce((sum, option) => sum + Math.max(0, option.weight || 0), 0);
    if (!totalWeight) {
      return options[Math.floor(Math.random() * options.length)];
    }
    let roll = Math.random() * totalWeight;
    for (const option of options) {
      roll -= Math.max(0, option.weight || 0);
      if (roll <= 0) {
        return option;
      }
    }
    return options[options.length - 1];
  }

  function modeStatsBucket(mode) {
    if (mode === MODES.RFI) {
      return aggregateContextBuckets(settings.enabledRfiPositions.map((position) =>
        statsContextKeyForArgs({ mode: MODES.RFI, position })
      ));
    }
    return aggregateContextBuckets(enabledVsOpenSpots().map((spot) => statsContextKeyForArgs({
      mode: MODES.VS_OPEN,
      openerPosition: spot.openerPosition,
      heroPosition: spot.heroPosition
    })));
  }

  function aggregateContextBuckets(keys) {
    return keys.reduce((bucket, key) => {
      const row = stats.byContext[key];
      if (row && Number.isFinite(row.total) && Number.isFinite(row.correct)) {
        bucket.total += Math.max(0, Math.floor(row.total));
        bucket.correct += Math.max(0, Math.floor(row.correct));
        bucket.preferred += Number.isFinite(row.preferred)
          ? Math.max(0, Math.floor(row.preferred))
          : 0;
      }
      return bucket;
    }, { total: 0, correct: 0, preferred: 0 });
  }

  function enabledVsOpenSpots() {
    return engine.getValidVsOpenSpots().filter((spot) => settings.enabledOpeners.includes(spot.openerPosition));
  }

  function buildQuestionKey(args, hand) {
    const contextKey = contextKeyForArgs(args);
    const profile = settings.openerProfile;
    const size = args.mode === MODES.VS_OPEN ? settings.openSize : "NA";
    return [contextKey, hand, profile, size].join(":");
  }

  function contextKeyForArgs(args) {
    if (args.mode === MODES.RFI) {
      return MODES.RFI + ":" + args.position;
    }
    return MODES.VS_OPEN + ":" + engine.spotKey(args.openerPosition, args.heroPosition);
  }

  function statsContextKeyForArgs(args) {
    const base = contextKeyForArgs(args);
    if (args.mode === MODES.RFI) {
      return base + ":" + settings.openerProfile;
    }
    return base + ":" + settings.openerProfile + ":" + settings.openSize;
  }

  function isAdaptiveDrill() {
    return true;
  }

  function buildChallengeOptions(args) {
    const rows = engine.ALL_HAND_CLASSES.map((hand) => ({
      hand,
      recommendation: engine.recommend({
        mode: args.mode,
        position: args.position,
        openerPosition: args.openerPosition,
        heroPosition: args.heroPosition,
        hand,
        openerProfile: settings.openerProfile,
        openSize: settings.openSize
      })
    }));
    const actionWeights = args.mode === MODES.RFI
      ? { [ACTIONS.OPEN]: 0.55, [ACTIONS.FOLD]: 0.45 }
      : { [ACTIONS.THREE_BET]: 0.3, [ACTIONS.CALL]: 0.35, [ACTIONS.FOLD]: 0.35 };
    return scheduler.buildChallengeOptions(rows, {
      actionWeights,
      coreShare: 0.05,
      excludeHands: Array.from(AUTOPILOT_VALUE_HANDS),
      maxSharePerHand: 0.08
    });
  }

  function renderQuestion() {
    const question = currentQuestion;
    if (question.mode === MODES.RFI) {
      el.spotLine.textContent = "First in - Hero " + engine.positionLabel(question.position);
    } else {
      el.spotLine.textContent = "Facing open - " + engine.positionLabel(question.openerPosition) + " opens, Hero " + engine.positionLabel(question.heroPosition);
    }

    el.assumptionLine.textContent = engine.getAssumptionLabel({
      mode: question.mode,
      openerProfile: settings.openerProfile,
      openSize: settings.openSize
    });
    el.samplingLine.textContent = "Decision drill · Study plan: " + SAMPLING_LABELS[settings.drillSamplingMode];
    el.samplingLine.classList.remove("hidden");
    el.handLine.textContent = question.handClass;

    setActionLabelsForMode(question.mode);
    [el.yesActionBtn, el.callActionBtn, el.noActionBtn].forEach((button) => {
      button.disabled = false;
    });

    el.feedbackBox.className = "feedback hidden";
    el.resultLine.textContent = "";
    el.detailLine.textContent = "";
    el.whyBtn.textContent = "Show explanation";
    el.whyBtn.classList.add("hidden");
    el.whyLine.classList.add("hidden");
    el.coachReasonLine.textContent = "";
    el.coachCorrectionLine.textContent = "";
    el.coachCorrectionRow.classList.add("hidden");
    el.coachAdjustmentLine.textContent = "";
    el.coachAdjustmentRow.classList.add("hidden");
    el.coachTakeawayLine.textContent = "";
    el.viewCurrentChartBtn.classList.add("hidden");
    el.nextBtn.classList.add("hidden");
  }

  function submitAnswer(takeAction) {
    if (!currentQuestion || currentQuestion.answered || !takeAction) {
      return;
    }

    currentQuestion.answered = true;
    const recommendation = currentQuestion.recommendation;
    const grade = engine.gradeRecommendation(recommendation, takeAction);

    stats.total += 1;
    if (grade.isPassing) {
      stats.correct += 1;
    }
    if (grade.isPreferred) {
      stats.preferred += 1;
    }

    if (!stats.byContext[currentQuestion.statsContextKey]) {
      stats.byContext[currentQuestion.statsContextKey] = { total: 0, correct: 0, preferred: 0 };
    }
    stats.byContext[currentQuestion.statsContextKey].total += 1;
    if (grade.isPassing) {
      stats.byContext[currentQuestion.statsContextKey].correct += 1;
    }
    if (grade.isPreferred) {
      stats.byContext[currentQuestion.statsContextKey].preferred =
        (stats.byContext[currentQuestion.statsContextKey].preferred || 0) + 1;
    }

    if (!grade.isPassing) {
      const hand = currentQuestion.handClass;
      stats.misses[hand] = (stats.misses[hand] || 0) + 1;
    }

    scheduler.recordQuestionResult(stats, {
      questionKey: currentQuestion.questionKey,
      contextKey: currentQuestion.statsContextKey,
      hand: currentQuestion.handClass,
      isPassing: grade.isPassing,
      isPreferred: grade.isPreferred
    });

    saveStats();
    renderStats();

    [el.yesActionBtn, el.callActionBtn, el.noActionBtn].forEach((button) => {
      button.disabled = true;
    });

    const feedbackClass = grade.isPreferred
      ? "feedback-ok"
      : (grade.isAcceptable ? "feedback-acceptable" : "feedback-bad");
    el.feedbackBox.className = "feedback " + feedbackClass;
    el.resultLine.textContent = grade.label;
    el.detailLine.textContent =
      "You chose " + engine.displayAction(takeAction) +
      " · Default " + engine.displayAction(recommendation.primaryAction) + ". " + grade.detail;

    renderCoach(recommendation, takeAction);
    el.whyBtn.classList.remove("hidden");
    el.whyBtn.textContent = "Hide explanation";
    el.viewCurrentChartBtn.classList.remove("hidden");
    el.whyLine.classList.remove("hidden");
    whyVisible = true;
    el.nextBtn.classList.remove("hidden");
  }

  function renderCoach(recommendation, chosenAction) {
    const coach = recommendation.coach || {
      reason: recommendation.explanation,
      adjustment: recommendation.frequency,
      takeaway: "Use the default as the baseline, then adjust only when the table gives you a reason."
    };
    el.coachReasonLine.textContent = coach.reason || recommendation.explanation;
    const correction = chosenAction !== recommendation.primaryAction && coach.actionNotes
      ? coach.actionNotes[chosenAction]
      : "";
    el.coachCorrectionLine.textContent = correction || "";
    el.coachCorrectionRow.classList.toggle("hidden", !correction);
    el.coachAdjustmentLine.textContent = coach.adjustment || "";
    el.coachAdjustmentRow.classList.toggle("hidden", !coach.adjustment);
    el.coachTakeawayLine.textContent = coach.takeaway || "";
  }

  function toggleWhyLine() {
    if (!currentQuestion || !currentQuestion.answered) {
      return;
    }

    whyVisible = !whyVisible;
    if (!whyVisible) {
      el.whyBtn.textContent = "Show explanation";
      el.whyLine.classList.add("hidden");
      return;
    }

    el.whyBtn.textContent = "Hide explanation";
    el.whyLine.classList.remove("hidden");
  }

  function setActionLabelsForMode(mode) {
    el.actionsRow.classList.toggle("actions-three", mode === MODES.VS_OPEN);

    if (mode === MODES.VS_OPEN) {
      setActionButton(el.noActionBtn, ACTIONS.FOLD, true);
      setActionButton(el.callActionBtn, ACTIONS.CALL, true);
      setActionButton(el.yesActionBtn, ACTIONS.THREE_BET, true);
      return;
    }

    if (mode === MODES.RFI) {
      setActionButton(el.yesActionBtn, ACTIONS.OPEN, true);
      setActionButton(el.noActionBtn, ACTIONS.FOLD, true);
      setActionButton(el.callActionBtn, "", false);
      return;
    }

  }

  function setActionButton(button, action, visible) {
    button.classList.toggle("hidden", !visible);
    button._action = visible ? action : "";
    button.setAttribute("data-action", button._action);
    if (visible) {
      button.textContent = engine.displayAction(action);
    }
  }

  function getButtonAction(button) {
    return typeof button._action === "string" ? button._action : "";
  }

  function buildChartControls() {
    setSelectOptions(el.chartModeSelect, [
      { id: MODES.RFI, label: "First in" },
      { id: MODES.VS_OPEN, label: "Facing open" }
    ]);
    setSelectOptions(el.chartProfileSelect, engine.OPENER_PROFILES);
    setSelectOptions(el.chartSizeSelect, LIVE_OPEN_SIZE_CLASSES);
    syncChartControlsFromSettings();
  }

  function syncChartControlsFromSettings() {
    const preferredMode = currentQuestion && currentQuestion.mode ? currentQuestion.mode : MODES.VS_OPEN;
    el.chartModeSelect.value = preferredMode;
    el.chartProfileSelect.value = settings.openerProfile;
    el.chartSizeSelect.value = settings.openSize;
    if (!el.chartOpenerSelect.value) {
      setSelectOptions(el.chartOpenerSelect, engine.VS_OPEN_OPENERS.map((id) => ({ id, label: engine.positionLabel(id) })));
    }
    rebuildHeroOptions(el.chartModeSelect.value);
  }

  function renderChart(focusHand) {
    const mode = el.chartModeSelect.value;
    const profile = el.chartProfileSelect.value;
    const size = el.chartSizeSelect.value;

    if (mode === MODES.RFI) {
      el.chartOpenerSelect.disabled = true;
      el.chartProfileSelect.disabled = false;
      el.chartSizeSelect.disabled = true;
      rebuildHeroOptions(mode, el.chartHeroSelect.value || "UTG");
    } else {
      el.chartOpenerSelect.disabled = false;
      el.chartHeroSelect.disabled = false;
      el.chartProfileSelect.disabled = false;
      el.chartSizeSelect.disabled = false;
      if (!el.chartOpenerSelect.value) {
        el.chartOpenerSelect.value = "MP3";
      }
      rebuildHeroOptions(mode, el.chartHeroSelect.value);
    }
    updateChartControlVisibility(mode);
    renderChartAssumption(mode, profile, size);

    const rows = buildMatrixCells(mode, profile, size);
    el.chartMatrix.textContent = "";
    rows.forEach(({ hand, recommendation }) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "chart-cell chart-" + engine.classifyForChart(recommendation);
      cell.textContent = hand;
      cell.setAttribute("aria-label", hand + " " + engine.displayAction(recommendation.primaryAction));
      cell.addEventListener("click", () => showChartDetail(recommendation));
      el.chartMatrix.appendChild(cell);
      if (focusHand && focusHand === hand) {
        showChartDetail(recommendation);
      }
    });

    if (!focusHand && rows.length) {
      showChartDetail(rows.find((row) => row.hand === "AQo")?.recommendation || rows[0].recommendation);
    }
  }

  function buildMatrixCells(mode, profile, size) {
    const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
    const out = [];
    for (let row = 0; row < ranks.length; row += 1) {
      for (let col = 0; col < ranks.length; col += 1) {
        let hand;
        if (row === col) {
          hand = ranks[row] + ranks[col];
        } else if (col > row) {
          hand = ranks[row] + ranks[col] + "s";
        } else {
          hand = ranks[col] + ranks[row] + "o";
        }
        out.push({ hand, recommendation: chartRecommendation(mode, hand, profile, size) });
      }
    }
    return out;
  }

  function chartRecommendation(mode, hand, profile, size) {
    if (mode === MODES.RFI) {
      return engine.getChartCellRecommendation({
        mode: MODES.RFI,
        position: el.chartHeroSelect.value || "UTG",
        hand,
        openerProfile: profile,
        openSize: size
      });
    }

    return engine.getChartCellRecommendation({
      mode: MODES.VS_OPEN,
      openerPosition: el.chartOpenerSelect.value || "MP3",
      heroPosition: el.chartHeroSelect.value || "BTN",
      hand,
      openerProfile: profile,
      openSize: size
    });
  }

  function showChartDetail(recommendation) {
    const alternatives = recommendation.allowedActions
      .filter((action) => action !== recommendation.primaryAction)
      .map(engine.displayAction)
      .join(", ");
    const coach = recommendation.coach || {};
    el.chartDetail.innerHTML = "";

    const title = document.createElement("strong");
    title.textContent =
      recommendation.hand + " · " + engine.displayAction(recommendation.primaryAction) +
      (recommendation.actionTag ? " · " + recommendation.actionTag : "");

    const meta = document.createElement("span");
    meta.textContent = recommendation.contextLabel + " · Default: " + engine.displayAction(recommendation.primaryAction) +
      (alternatives ? " · Reasonable alternative: " + alternatives : "");

    const why = document.createElement("p");
    why.textContent = coach.reason || recommendation.explanation;

    const adjustment = document.createElement("p");
    adjustment.textContent = coach.adjustment ? "Change when: " + coach.adjustment : "";

    const takeaway = document.createElement("p");
    takeaway.textContent = coach.takeaway ? "Remember: " + coach.takeaway : "";

    el.chartDetail.append(title, meta, why);
    if (adjustment.textContent) {
      el.chartDetail.appendChild(adjustment);
    }
    if (takeaway.textContent) {
      el.chartDetail.appendChild(takeaway);
    }
  }

  function updateChartControlVisibility(mode) {
    el.chartOpenerControl.classList.toggle("hidden", mode !== MODES.VS_OPEN);
    el.chartHeroControl.classList.remove("hidden");
    el.chartProfileControl.classList.remove("hidden");
    el.chartSizeControl.classList.toggle("hidden", mode !== MODES.VS_OPEN);
  }

  function renderChartAssumption(mode, profile, size) {
    if (mode === MODES.RFI) {
      el.chartAssumptionLine.textContent = engine.getAssumptionLabel({
        mode: MODES.RFI,
        openerProfile: profile
      }) + " · Hero " + engine.positionLabel(el.chartHeroSelect.value || "UTG");
      return;
    }

    el.chartAssumptionLine.textContent = engine.getAssumptionLabel({
      mode: MODES.VS_OPEN,
      openerProfile: profile,
      openSize: size
    }) + " · " + engine.positionLabel(el.chartOpenerSelect.value || "MP3") + " opens, Hero " + engine.positionLabel(el.chartHeroSelect.value || "BTN");
  }

  function rebuildHeroOptions(mode, preferredValue) {
    if (mode === MODES.RFI) {
      setSelectOptions(el.chartHeroSelect, engine.RFI_POSITIONS.map((id) => ({ id, label: engine.positionLabel(id) })));
      el.chartHeroSelect.disabled = false;
      el.chartHeroSelect.value = engine.RFI_POSITIONS.includes(preferredValue) ? preferredValue : "UTG";
      return;
    }

    if (!el.chartOpenerSelect.options.length) {
      setSelectOptions(el.chartOpenerSelect, engine.VS_OPEN_OPENERS.map((id) => ({ id, label: engine.positionLabel(id) })));
    }
    const opener = el.chartOpenerSelect.value || "MP3";
    const heroes = engine.getValidHeroPositions(opener);
    setSelectOptions(el.chartHeroSelect, heroes.map((id) => ({ id, label: engine.positionLabel(id) })));
    el.chartHeroSelect.value = heroes.includes(preferredValue) ? preferredValue : (heroes.includes("BTN") ? "BTN" : heroes[0]);
  }

  function setSelectOptions(select, values) {
    const current = select.value;
    select.textContent = "";
    values.forEach((option) => {
      const node = document.createElement("option");
      node.value = option.id;
      node.textContent = option.label;
      select.appendChild(node);
    });
    if (values.some((option) => option.id === current)) {
      select.value = current;
    }
  }

  function renderStats() {
    el.attemptsValue.textContent = String(stats.total);
    el.correctValue.textContent = String(stats.correct);
    el.accuracyValue.textContent = formatPercent(stats.preferred, stats.total);
    renderContextStatList(el.rfiStatsList, engine.RFI_POSITIONS.map((position) => ({
      key: statsContextKeyForArgs({ mode: MODES.RFI, position }),
      label: engine.positionLabel(position)
    })));
    renderContextStatList(el.vsOpenStatsList, engine.getValidVsOpenSpots().map((spot) => ({
      key: statsContextKeyForArgs({
        mode: MODES.VS_OPEN,
        openerPosition: spot.openerPosition,
        heroPosition: spot.heroPosition
      }),
      label: engine.positionLabel(spot.openerPosition) + " -> " + engine.positionLabel(spot.heroPosition)
    })));
    renderMissList();
  }

  function renderContextStatList(listEl, contexts) {
    listEl.textContent = "";
    contexts.forEach((context) => {
      const bucket = stats.byContext[context.key] || { total: 0, correct: 0, preferred: 0 };
      const li = document.createElement("li");
      li.className = "stat-row";

      const left = document.createElement("span");
      left.textContent = context.label;

      const right = document.createElement("span");
      right.textContent = formatPercent(bucket.preferred, bucket.total) + " default · " +
        formatPercent(bucket.correct, bucket.total) + " within strategy";

      li.append(left, right);
      listEl.appendChild(li);
    });
  }

  function renderMissList() {
    const misses = Object.entries(stats.misses)
      .filter((entry) => engine.ALL_HAND_CLASSES.includes(entry[0]) && Number.isFinite(entry[1]) && entry[1] > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10);

    el.missList.textContent = "";
    if (!misses.length) {
      const li = document.createElement("li");
      li.className = "empty-row";
      li.textContent = "No misses yet.";
      el.missList.appendChild(li);
      return;
    }

    misses.forEach(([hand, count]) => {
      const li = document.createElement("li");
      li.className = "miss-row";
      const left = document.createElement("span");
      left.textContent = hand;
      const right = document.createElement("span");
      right.textContent = String(count);
      li.append(left, right);
      el.missList.appendChild(li);
    });
  }

  function drawEven(key, values, signature) {
    if (!values.length) {
      throw new Error("Cannot draw from empty list: " + key);
    }
    const state = samplerState[key] || { signature: "", remaining: [] };
    if (state.signature !== signature || !state.remaining.length) {
      state.signature = signature;
      state.remaining = shuffle(values);
      samplerState[key] = state;
    }
    return state.remaining.pop();
  }

  function drawWeighted(key, groups, signature) {
    const state = samplerState[key] || { signature: "", remaining: [] };
    if (state.signature !== signature || !state.remaining.length) {
      const deck = [];
      groups.forEach((group) => {
        const count = Math.max(1, Math.round(group.weight * 20));
        for (let i = 0; i < count; i += 1) {
          deck.push(group.id);
        }
      });
      state.signature = signature;
      state.remaining = shuffle(deck);
      samplerState[key] = state;
    }
    return state.remaining.pop();
  }

  function shuffle(values) {
    const out = values.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function formatPercent(correct, total) {
    if (!total) {
      return "--";
    }
    return Math.round((correct / total) * 100) + "%";
  }

  function defaultSettings() {
    return {
      openerProfile: "BALANCED",
      openSize: "STANDARD",
      enabledRfiPositions: engine.RFI_POSITIONS.slice(),
      enabledOpeners: engine.VS_OPEN_OPENERS.slice(),
      drillSamplingMode: SAMPLING.BORDERLINE
    };
  }

  function loadSettings() {
    const fallback = defaultSettings();
    try {
      const raw = safeGetStorage(STORAGE_KEYS.settings);
      const parsed = raw ? JSON.parse(raw) : {};
      const openerProfile = engine.OPENER_PROFILES.some((item) => item.id === parsed.openerProfile) ? parsed.openerProfile : fallback.openerProfile;
      const openSize = LIVE_OPEN_SIZE_CLASSES.some((item) => item.id === parsed.openSize) ? parsed.openSize : fallback.openSize;
      const enabledRfiPositions = Array.isArray(parsed.enabledRfiPositions)
        ? engine.RFI_POSITIONS.filter((position) => parsed.enabledRfiPositions.includes(position))
        : fallback.enabledRfiPositions;
      const enabledOpeners = Array.isArray(parsed.enabledOpeners)
        ? engine.VS_OPEN_OPENERS.filter((position) => parsed.enabledOpeners.includes(position))
        : fallback.enabledOpeners;
      const samplingMode = parsed.drillSamplingMode || parsed.vsOpenSamplingMode || parsed.rfiSamplingMode;

      return {
        openerProfile,
        openSize,
        enabledRfiPositions: enabledRfiPositions.length ? enabledRfiPositions : fallback.enabledRfiPositions,
        enabledOpeners: enabledOpeners.length ? enabledOpeners : fallback.enabledOpeners,
        drillSamplingMode: SAMPLING_LABELS[samplingMode] ? samplingMode : fallback.drillSamplingMode
      };
    } catch (err) {
      return fallback;
    }
  }

  function saveSettings() {
    safeSetStorage(STORAGE_KEYS.settings, JSON.stringify(settings));
  }

  function defaultStats() {
    const byContext = {};
    engine.OPENER_PROFILES.forEach(({ id: profile }) => {
      engine.RFI_POSITIONS.forEach((position) => {
        byContext[MODES.RFI + ":" + position + ":" + profile] = { total: 0, correct: 0, preferred: 0 };
      });
      LIVE_OPEN_SIZE_CLASSES.forEach(({ id: size }) => {
        engine.getValidVsOpenSpots().forEach((spot) => {
          byContext[MODES.VS_OPEN + ":" + spot.key + ":" + profile + ":" + size] = {
            total: 0,
            correct: 0,
            preferred: 0
          };
        });
      });
    });
    return scheduler.ensureAdaptiveStats({
      total: 0,
      correct: 0,
      preferred: 0,
      byContext,
      misses: {},
      sequence: 0,
      byQuestion: {},
      recentQuestions: [],
      recentContexts: [],
      recentHands: []
    });
  }

  function loadStats() {
    const fallback = defaultStats();
    try {
      const raw = safeGetStorage(STORAGE_KEYS.stats);
      const parsed = raw ? JSON.parse(raw) : {};
      if (Number.isFinite(parsed.total) && parsed.total >= 0) {
        fallback.total = Math.floor(parsed.total);
      }
      if (Number.isFinite(parsed.correct) && parsed.correct >= 0) {
        fallback.correct = Math.floor(parsed.correct);
      }
      if (Number.isFinite(parsed.preferred) && parsed.preferred >= 0) {
        fallback.preferred = Math.floor(parsed.preferred);
      }
      if (parsed.byContext && typeof parsed.byContext === "object") {
        Object.keys(fallback.byContext).forEach((key) => {
          const rows = [parsed.byContext[key]];
          const merged = rows.reduce((bucket, row) => {
            if (row && Number.isFinite(row.total) && Number.isFinite(row.correct)) {
              bucket.total += Math.max(0, Math.floor(row.total));
              bucket.correct += Math.max(0, Math.floor(row.correct));
              bucket.preferred += Number.isFinite(row.preferred)
                ? Math.max(0, Math.floor(row.preferred))
                : 0;
            }
            return bucket;
          }, { total: 0, correct: 0, preferred: 0 });
          if (merged.total > 0) {
            fallback.byContext[key] = {
              total: merged.total,
              correct: Math.min(merged.correct, merged.total),
              preferred: Math.min(merged.preferred, merged.correct, merged.total)
            };
          }
        });
      }
      if (parsed.misses && typeof parsed.misses === "object") {
        Object.entries(parsed.misses).forEach(([hand, count]) => {
          if (engine.ALL_HAND_CLASSES.includes(hand) && Number.isFinite(count) && count > 0) {
            fallback.misses[hand] = Math.floor(count);
          }
        });
      }
      scheduler.restoreAdaptiveStats(fallback, parsed, {
        validHands: engine.ALL_HAND_CLASSES
      });
      if (fallback.correct > fallback.total) {
        fallback.correct = fallback.total;
      }
      fallback.preferred = Math.min(fallback.preferred, fallback.correct);
      fallback.sequence = Math.max(fallback.sequence, fallback.total);
      return fallback;
    } catch (err) {
      return fallback;
    }
  }

  function saveStats() {
    safeSetStorage(STORAGE_KEYS.stats, JSON.stringify(stats));
  }

  function safeGetStorage(key) {
    if (!storageAvailable) {
      return null;
    }
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      storageAvailable = false;
      return null;
    }
  }

  function safeSetStorage(key, value) {
    if (!storageAvailable) {
      return false;
    }
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      storageAvailable = false;
      return false;
    }
  }
})();
