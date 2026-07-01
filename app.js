(() => {
  "use strict";

  const engine = window.PotoRangeEngine;
  const ACTIONS = engine.ACTIONS;
  const MODES = engine.MODES;

  const STORAGE_KEYS = {
    settings: "poto_preflop_trainer_settings_v2",
    stats: "poto_preflop_trainer_stats_v2"
  };

  const SAMPLING = {
    UNIFORM: "UNIFORM",
    BORDERLINE: "BORDERLINE"
  };

  const SAMPLING_LABELS = {
    [SAMPLING.UNIFORM]: "Uniform (169)",
    [SAMPLING.BORDERLINE]: "Borderline-heavy"
  };

  const DECISION_MIX = [
    { id: MODES.RFI, label: "First in", weight: 0.3 },
    { id: MODES.VS_OPEN, label: "Facing open", weight: 0.6 },
    { id: MODES.FOUR_BET, label: "Facing 3-bet", weight: 0.1 }
  ];
  const LIVE_OPEN_SIZE_CLASSES = engine.OPEN_SIZE_CLASSES.filter((item) => item.id !== "SMALL");
  const FOUR_BET_CONTEXT_KEY = MODES.FOUR_BET + ":default";

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
    viewCurrentChartBtn: document.getElementById("viewCurrentChartBtn"),
    nextBtn: document.getElementById("nextBtn"),
    attemptsValue: document.getElementById("attemptsValue"),
    correctValue: document.getElementById("correctValue"),
    accuracyValue: document.getElementById("accuracyValue"),
    rfiStatsList: document.getElementById("rfiStatsList"),
    vsOpenStatsList: document.getElementById("vsOpenStatsList"),
    fourBetStatsList: document.getElementById("fourBetStatsList"),
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
    } else if (currentQuestion.mode === MODES.FOUR_BET) {
      rebuildHeroOptions(MODES.FOUR_BET);
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
      itemLabel: (value) => value
    });

    buildToggleGroup({
      grid: el.openerToggleGrid,
      values: engine.VS_OPEN_OPENERS,
      selected: settings.enabledOpeners,
      settingKey: "enabledOpeners",
      itemLabel: (value) => value + " opens"
    });

    buildSamplingGrid(el.drillSamplingGrid, "drillSamplingMode", settings.drillSamplingMode);
    el.decisionMixNote.innerHTML = '<p class="setting-note">The drill mixes first-in open/fold, facing-open fold/call/3-bet, and default facing-3-bet 4-bet decisions. Facing-open spots are exact by opener and hero position.</p>';
  }

  function resetToLiveDefaults() {
    settings = defaultSettings();
    saveSettings();
    buildSettingsUI();
    nextQuestion();
    showNotice("Live $1/$3 defaults restored.");
  }

  function updateSetting(key, value) {
    if (settings[key] === value) {
      return;
    }
    settings[key] = value;
    saveSettings();
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
      const position = drawEven("context:RFI", settings.enabledRfiPositions, settings.enabledRfiPositions.join("|"));
      const handClass = sampleHand({
        mode,
        position,
        samplingMode: settings.drillSamplingMode
      });
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
        statsContextKey: MODES.RFI + ":" + position,
        answered: false
      };
    }

    if (mode === MODES.FOUR_BET) {
      const handClass = sampleHand({
        mode,
        samplingMode: settings.drillSamplingMode
      });
      const recommendation = engine.recommend({
        mode,
        hand: handClass
      });
      return {
        mode,
        handClass,
        recommendation,
        statsContextKey: FOUR_BET_CONTEXT_KEY,
        answered: false
      };
    }

    const spot = drawVsOpenSpot();
    const handClass = sampleHand({
      mode: MODES.VS_OPEN,
      openerPosition: spot.openerPosition,
      heroPosition: spot.heroPosition,
      samplingMode: settings.drillSamplingMode
    });
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
      statsContextKey: MODES.VS_OPEN + ":" + spot.key,
      answered: false
    };
  }

  function drawDecisionMode() {
    const signature = settings.enabledRfiPositions.join("|") + ":" + settings.enabledOpeners.join("|");
    return drawWeighted("context:decision", DECISION_MIX, signature);
  }

  function drawVsOpenSpot() {
    const valid = engine.getValidVsOpenSpots().filter((spot) => settings.enabledOpeners.includes(spot.openerPosition));
    return drawEven("context:" + MODES.VS_OPEN, valid, settings.enabledOpeners.join("|") + ":" + valid.length);
  }

  function sampleHand(args) {
    if (args.samplingMode === SAMPLING.UNIFORM) {
      return drawEven("hands:uniform:" + args.mode, engine.ALL_HAND_CLASSES, "all");
    }

    const groups = buildSamplingGroups(args);
    const category = drawWeighted("mix:" + samplingKey(args), groups, groups.map((group) => group.id + ":" + group.values.length + ":" + group.weight).join("|"));
    const picked = groups.find((group) => group.id === category) || groups[0];
    return drawEven("hands:" + samplingKey(args) + ":" + picked.id, picked.values, picked.values.join("|"));
  }

  function buildSamplingGroups(args) {
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

    if (args.mode === MODES.RFI) {
      return nonEmptyGroups([
        { id: "OPEN", weight: 0.35, values: rows.filter((row) => row.recommendation.primaryAction === ACTIONS.OPEN && row.recommendation.allowedActions.length === 1).map((row) => row.hand) },
        { id: "MIXED", weight: 0.45, values: rows.filter((row) => row.recommendation.allowedActions.length > 1).map((row) => row.hand) },
        { id: "REST", weight: 0.2, values: rows.filter((row) => row.recommendation.primaryAction === ACTIONS.FOLD).map((row) => row.hand).slice(0, 55) }
      ]);
    }

    if (args.mode === MODES.FOUR_BET) {
      return nonEmptyGroups([
        { id: "FOUR_BET", weight: 0.35, values: rows.filter((row) => row.recommendation.primaryAction === ACTIONS.FOUR_BET && row.recommendation.allowedActions.length === 1).map((row) => row.hand) },
        { id: "MIXED", weight: 0.45, values: rows.filter((row) => row.recommendation.allowedActions.length > 1).map((row) => row.hand) },
        { id: "REST", weight: 0.2, values: rows.filter((row) => row.recommendation.primaryAction === ACTIONS.FOLD).map((row) => row.hand).slice(0, 85) }
      ]);
    }

    return nonEmptyGroups([
      { id: "RAISE", weight: 0.25, values: rows.filter((row) => row.recommendation.primaryAction === ACTIONS.THREE_BET).map((row) => row.hand) },
      { id: "CALL", weight: 0.35, values: rows.filter((row) => row.recommendation.primaryAction === ACTIONS.CALL).map((row) => row.hand) },
      { id: "MIXED", weight: 0.25, values: rows.filter((row) => row.recommendation.allowedActions.length > 1).map((row) => row.hand) },
      { id: "REST", weight: 0.15, values: rows.filter((row) => row.recommendation.primaryAction === ACTIONS.FOLD).map((row) => row.hand).slice(0, 75) }
    ]);
  }

  function nonEmptyGroups(groups) {
    return groups.filter((group) => group.values.length > 0);
  }

  function samplingKey(args) {
    return [args.mode, args.position || "", args.openerPosition || "", args.heroPosition || "", settings.openerProfile, settings.openSize].join(":");
  }

  function renderQuestion() {
    const question = currentQuestion;
    if (question.mode === MODES.RFI) {
      el.spotLine.textContent = "First in - Hero " + question.position;
    } else if (question.mode === MODES.FOUR_BET) {
      el.spotLine.textContent = "Facing 3-bet - Hero opened, villain 3-bets";
    } else {
      el.spotLine.textContent = "Facing open - " + question.openerPosition + " opens, Hero " + question.heroPosition;
    }

    el.assumptionLine.textContent = engine.getAssumptionLabel({
      openerProfile: settings.openerProfile,
      openSize: settings.openSize
    });
    el.samplingLine.textContent = "Decision drill · Sampling: " + SAMPLING_LABELS[settings.drillSamplingMode];
    el.samplingLine.classList.remove("hidden");
    el.handLine.textContent = question.handClass;

    setActionLabelsForMode(question.mode);
    [el.yesActionBtn, el.callActionBtn, el.noActionBtn].forEach((button) => {
      button.disabled = false;
    });

    el.feedbackBox.className = "feedback hidden";
    el.resultLine.textContent = "";
    el.detailLine.textContent = "";
    el.whyBtn.textContent = "Why?";
    el.whyBtn.classList.add("hidden");
    el.whyLine.textContent = "";
    el.whyLine.classList.add("hidden");
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

    if (!stats.byContext[currentQuestion.statsContextKey]) {
      stats.byContext[currentQuestion.statsContextKey] = { total: 0, correct: 0 };
    }
    stats.byContext[currentQuestion.statsContextKey].total += 1;
    if (grade.isPassing) {
      stats.byContext[currentQuestion.statsContextKey].correct += 1;
    }

    if (!grade.isPassing) {
      const hand = currentQuestion.handClass;
      stats.misses[hand] = (stats.misses[hand] || 0) + 1;
    }

    saveStats();
    renderStats();

    [el.yesActionBtn, el.callActionBtn, el.noActionBtn].forEach((button) => {
      button.disabled = true;
    });

    el.feedbackBox.className = "feedback " + (grade.isPassing ? "feedback-ok" : "feedback-bad");
    el.resultLine.textContent = grade.label;
    el.detailLine.textContent =
      currentQuestion.handClass + " prefers " + engine.displayAction(recommendation.primaryAction) +
      " in " + recommendation.contextLabel + ". " + grade.detail;

    el.whyBtn.classList.remove("hidden");
    el.viewCurrentChartBtn.classList.remove("hidden");
    el.whyLine.classList.add("hidden");
    el.whyLine.textContent = "";
    whyVisible = false;
    el.nextBtn.classList.remove("hidden");
  }

  function toggleWhyLine() {
    if (!currentQuestion || !currentQuestion.answered) {
      return;
    }

    whyVisible = !whyVisible;
    if (!whyVisible) {
      el.whyBtn.textContent = "Why?";
      el.whyLine.classList.add("hidden");
      return;
    }

    el.whyBtn.textContent = "Hide Why";
    el.whyLine.textContent = buildWhyText(currentQuestion.recommendation);
    el.whyLine.classList.remove("hidden");
  }

  function buildWhyText(recommendation) {
    const allowed = recommendation.allowedActions.map(engine.displayAction).join("/");
    return recommendation.explanation +
      " Preferred: " + engine.displayAction(recommendation.primaryAction) +
      ". Allowed: " + allowed +
      (recommendation.frequency ? ". Mix: " + recommendation.frequency : "") + ".";
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

    if (mode === MODES.FOUR_BET) {
      setActionButton(el.yesActionBtn, ACTIONS.FOUR_BET, true);
      setActionButton(el.noActionBtn, ACTIONS.FOLD, true);
      setActionButton(el.callActionBtn, "", false);
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
      { id: MODES.VS_OPEN, label: "Facing open" },
      { id: MODES.FOUR_BET, label: "Facing 3-bet" }
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
      setSelectOptions(el.chartOpenerSelect, engine.VS_OPEN_OPENERS.map((id) => ({ id, label: id })));
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
    } else if (mode === MODES.FOUR_BET) {
      el.chartOpenerSelect.disabled = true;
      el.chartHeroSelect.disabled = true;
      el.chartProfileSelect.disabled = true;
      el.chartSizeSelect.disabled = true;
      rebuildHeroOptions(mode);
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

    if (mode === MODES.FOUR_BET) {
      return engine.getChartCellRecommendation({
        mode: MODES.FOUR_BET,
        hand
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
    const allowed = recommendation.allowedActions.map(engine.displayAction).join(", ");
    el.chartDetail.innerHTML = "";

    const title = document.createElement("strong");
    title.textContent =
      recommendation.hand + " · " + engine.displayAction(recommendation.primaryAction) +
      (recommendation.actionTag ? " · " + recommendation.actionTag : "");

    const meta = document.createElement("span");
    meta.textContent = recommendation.contextLabel + " · Allowed: " + allowed;

    const why = document.createElement("p");
    why.textContent = recommendation.explanation + (recommendation.frequency ? " " + recommendation.frequency : "");

    el.chartDetail.append(title, meta, why);
  }

  function updateChartControlVisibility(mode) {
    el.chartOpenerControl.classList.toggle("hidden", mode !== MODES.VS_OPEN);
    el.chartHeroControl.classList.toggle("hidden", mode === MODES.FOUR_BET);
    el.chartProfileControl.classList.toggle("hidden", mode === MODES.FOUR_BET);
    el.chartSizeControl.classList.toggle("hidden", mode !== MODES.VS_OPEN);
  }

  function renderChartAssumption(mode, profile, size) {
    if (mode === MODES.RFI) {
      el.chartAssumptionLine.textContent = "Live $1/$3 Default · 8-handed · 100-133bb · no ante · " + engine.profileLabel(profile) + " profile · Hero " + (el.chartHeroSelect.value || "UTG");
      return;
    }

    if (mode === MODES.FOUR_BET) {
      el.chartAssumptionLine.textContent = "Live $1/$3 Default · 8-handed · 100-133bb · no ante · Hero opened and faces a 3-bet · default 4-bet range";
      return;
    }

    el.chartAssumptionLine.textContent = engine.getAssumptionLabel({
      openerProfile: profile,
      openSize: size
    }) + " · " + (el.chartOpenerSelect.value || "MP3") + " opens, Hero " + (el.chartHeroSelect.value || "BTN");
  }

  function rebuildHeroOptions(mode, preferredValue) {
    if (mode === MODES.RFI) {
      setSelectOptions(el.chartHeroSelect, engine.RFI_POSITIONS.map((id) => ({ id, label: id })));
      el.chartHeroSelect.disabled = false;
      el.chartHeroSelect.value = engine.RFI_POSITIONS.includes(preferredValue) ? preferredValue : "UTG";
      return;
    }

    if (mode === MODES.FOUR_BET) {
      setSelectOptions(el.chartHeroSelect, [{ id: "default", label: "Default" }]);
      return;
    }

    if (!el.chartOpenerSelect.options.length) {
      setSelectOptions(el.chartOpenerSelect, engine.VS_OPEN_OPENERS.map((id) => ({ id, label: id })));
    }
    const opener = el.chartOpenerSelect.value || "MP3";
    const heroes = engine.getValidHeroPositions(opener);
    setSelectOptions(el.chartHeroSelect, heroes.map((id) => ({ id, label: id })));
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
    el.accuracyValue.textContent = formatPercent(stats.correct, stats.total);
    renderContextStatList(el.rfiStatsList, engine.RFI_POSITIONS.map((position) => ({ key: MODES.RFI + ":" + position, label: position })));
    renderContextStatList(el.vsOpenStatsList, engine.getValidVsOpenSpots().map((spot) => ({ key: MODES.VS_OPEN + ":" + spot.key, label: spot.key.replace(">", " -> ") })));
    renderContextStatList(el.fourBetStatsList, [{ key: FOUR_BET_CONTEXT_KEY, label: "Default live 4-bet" }]);
    renderMissList();
  }

  function renderContextStatList(listEl, contexts) {
    listEl.textContent = "";
    contexts.forEach((context) => {
      const bucket = stats.byContext[context.key] || { total: 0, correct: 0 };
      const li = document.createElement("li");
      li.className = "stat-row";

      const left = document.createElement("span");
      left.textContent = context.label;

      const right = document.createElement("span");
      right.textContent = bucket.correct + "/" + bucket.total + " (" + formatPercent(bucket.correct, bucket.total) + ")";

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
    engine.RFI_POSITIONS.forEach((position) => {
      byContext[MODES.RFI + ":" + position] = { total: 0, correct: 0 };
    });
    engine.getValidVsOpenSpots().forEach((spot) => {
      byContext[MODES.VS_OPEN + ":" + spot.key] = { total: 0, correct: 0 };
    });
    byContext[FOUR_BET_CONTEXT_KEY] = { total: 0, correct: 0 };
    return {
      total: 0,
      correct: 0,
      byContext,
      misses: {}
    };
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
      if (parsed.byContext && typeof parsed.byContext === "object") {
        Object.keys(fallback.byContext).forEach((key) => {
          const rows = [parsed.byContext[key]];
          if (key.startsWith(MODES.VS_OPEN + ":")) {
            rows.push(parsed.byContext[MODES.THREE_BET + key.slice(MODES.VS_OPEN.length)]);
          }
          const merged = rows.reduce((bucket, row) => {
            if (row && Number.isFinite(row.total) && Number.isFinite(row.correct)) {
              bucket.total += Math.max(0, Math.floor(row.total));
              bucket.correct += Math.max(0, Math.floor(row.correct));
            }
            return bucket;
          }, { total: 0, correct: 0 });
          if (merged.total > 0) {
            fallback.byContext[key] = {
              total: merged.total,
              correct: Math.min(merged.correct, merged.total)
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
      if (fallback.correct > fallback.total) {
        fallback.correct = fallback.total;
      }
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
