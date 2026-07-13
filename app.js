(() => {
  "use strict";

  window.PotoTrainerReady = false;

  const engine = window.PotoRangeEngine;
  const scheduler = window.PotoTrainerScheduler;
  const evidence = window.PotoEvidence;

  if (!engine || !scheduler || !evidence) {
    renderBootFailure();
    window.PotoTrainerReady = true;
    return;
  }

  const ACTIONS = engine.ACTIONS;
  const MODES = engine.MODES;

  const STORAGE_KEYS = {
    settings: "poto_preflop_trainer_settings_v3",
    legacySettings: "poto_preflop_trainer_settings_v2",
    stats: "poto_preflop_trainer_stats_v4"
  };

  const SAMPLING = {
    UNIFORM: "UNIFORM",
    BORDERLINE: "BORDERLINE"
  };

  const SAMPLING_LABELS = {
    [SAMPLING.UNIFORM]: "Full deck review (169)",
    [SAMPLING.BORDERLINE]: "Focused high-value review"
  };
  const AUTOPILOT_VALUE_HANDS = new Set(["AA", "KK", "QQ", "AKs", "AKo"]);
  const SESSION_TARGET = 20;
  // Ten decisions let a miss on the first targeted question complete the
  // +8-intervening-question relearning window inside the same drill.
  const TARGETED_SESSION_TARGET = 10;
  const MAX_DUE_REVIEW_SHARE = 0.75;
  const MAX_ANSWER_LOG = 500;
  const MAX_LEAK_RECORDS = 800;
  const STRATEGY_METADATA = typeof engine.getCorpusMetadata === "function"
    ? engine.getCorpusMetadata()
    : { strategyVersion: "v4", status: "provisional", reviewStatus: "not independently reviewed", fingerprint: "legacy-v4" };
  const STRATEGY_FINGERPRINT = typeof engine.getCorpusFingerprint === "function"
    ? engine.getCorpusFingerprint()
    : STRATEGY_METADATA.fingerprint;
  const STRATEGY_VERSION = STRATEGY_METADATA.strategyVersion || scheduler.CURRENT_STRATEGY_VERSION || "v4";
  const DEFAULT_FOCUS_SPOTS = new Set([
    "UTG>BTN", "UTG>BB", "MP3>BTN", "MP3>SB", "MP3>BB",
    "CO>BTN", "CO>SB", "CO>BB", "BTN>SB", "BTN>BB"
  ]);

  const CURRICULUM_MIX = evidence.TRAINING_PRIORS.decisionModeMix.map((item) => ({ ...item }));
  const LIVE_OPEN_SIZE_CLASSES = engine.OPEN_SIZE_CLASSES.filter((item) => item.id !== "SMALL");

  let storageAvailable = true;
  let persistenceWarning = false;
  let settings = loadSettings();
  let stats = loadStats();
  let currentQuestion = null;
  let whyVisible = false;
  let questionActiveStartedAt = null;
  let questionActiveElapsedMs = 0;
  let activeTarget = null;
  let topLeak = null;
  let activeModal = null;
  let modalReturnFocus = null;
  let windowFocused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
  let session = createSession();
  const samplerState = {};
  const failedStorageWrites = new Set();

  const el = {
    appContent: document.getElementById("appContent"),
    openChartsBtn: document.getElementById("openChartsBtn"),
    openSettingsBtn: document.getElementById("openSettingsBtn"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    settingsModal: document.getElementById("settingsModal"),
    settingsNotice: document.getElementById("settingsNotice"),
    heroBaselineGrid: document.getElementById("heroBaselineGrid"),
    villainProfileGrid: document.getElementById("villainProfileGrid"),
    profileDefinitionLine: document.getElementById("profileDefinitionLine"),
    roomEvidenceLine: document.getElementById("roomEvidenceLine"),
    roomDropEvidenceLine: document.getElementById("roomDropEvidenceLine"),
    openSizeGrid: document.getElementById("openSizeGrid"),
    rfiToggleGrid: document.getElementById("rfiToggleGrid"),
    drillSamplingGrid: document.getElementById("drillSamplingGrid"),
    vsSpotToggleGrid: document.getElementById("vsSpotToggleGrid"),
    spotSelectionSummary: document.getElementById("spotSelectionSummary"),
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
    questionPanel: document.getElementById("questionPanel"),
    sessionLabel: document.getElementById("sessionLabel"),
    sessionProgressText: document.getElementById("sessionProgressText"),
    sessionProgressTrack: document.getElementById("sessionProgressTrack"),
    sessionProgressFill: document.getElementById("sessionProgressFill"),
    sessionCompletePanel: document.getElementById("sessionCompletePanel"),
    sessionCompleteTitle: document.getElementById("sessionCompleteTitle"),
    sessionCompleteSummary: document.getElementById("sessionCompleteSummary"),
    restartSessionBtn: document.getElementById("restartSessionBtn"),
    reviewSessionLeakBtn: document.getElementById("reviewSessionLeakBtn"),
    attemptsValue: document.getElementById("attemptsValue"),
    dueValue: document.getElementById("dueValue"),
    accuracyValue: document.getElementById("accuracyValue"),
    responseValue: document.getElementById("responseValue"),
    nextPriorityTitle: document.getElementById("nextPriorityTitle"),
    nextPriorityCopy: document.getElementById("nextPriorityCopy"),
    drillTopLeakBtn: document.getElementById("drillTopLeakBtn"),
    leakList: document.getElementById("leakList"),
    masteryLine: document.getElementById("masteryLine"),
    strategyStatusTitle: document.getElementById("strategyStatusTitle"),
    strategyStatusCopy: document.getElementById("strategyStatusCopy"),
    coachRangePlanRow: document.getElementById("coachRangePlanRow"),
    coachRangePlanLine: document.getElementById("coachRangePlanLine"),
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
    chartProfileLabel: document.getElementById("chartProfileLabel"),
    chartSizeControl: document.getElementById("chartSizeControl"),
    chartMatrix: document.getElementById("chartMatrix"),
    chartDetail: document.getElementById("chartDetail")
  };

  bindEvents();
  renderStrategyStatus();
  buildSettingsUI();
  buildChartControls();
  renderStats();
  renderSessionProgress();
  nextQuestion();
  window.PotoTrainerReady = true;

  function bindEvents() {
    el.yesActionBtn.addEventListener("click", () => submitAnswer(getButtonAction(el.yesActionBtn)));
    el.callActionBtn.addEventListener("click", () => submitAnswer(getButtonAction(el.callActionBtn)));
    el.noActionBtn.addEventListener("click", () => submitAnswer(getButtonAction(el.noActionBtn)));
    el.whyBtn.addEventListener("click", toggleWhyLine);
    el.viewCurrentChartBtn.addEventListener("click", openCurrentChart);
    el.nextBtn.addEventListener("click", advanceToNextQuestion);
    el.restartSessionBtn.addEventListener("click", () => startSession());
    el.reviewSessionLeakBtn.addEventListener("click", () => topLeak && startTargetedDrill(topLeak));
    el.drillTopLeakBtn.addEventListener("click", () => topLeak && startTargetedDrill(topLeak));

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
      const saved = saveStats();
      renderStats();
      startSession();
      showNotice(saved ? "Stats reset." : "Stats reset for this tab, but progress could not be saved.");
    });

    if (document.addEventListener) {
      document.addEventListener("keydown", handleDocumentKeydown);
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    if (window.addEventListener) {
      window.addEventListener("blur", handleWindowBlur);
      window.addEventListener("focus", handleWindowFocus);
    }
  }

  function openSettings() {
    openModal(el.settingsModal, el.closeSettingsBtn);
    if (!storageAvailable) {
      showNotice("Local storage unavailable. Settings and stats are session-only.");
    }
  }

  function closeSettings() {
    closeModal(el.settingsModal);
  }

  function openChart() {
    syncChartControlsFromSettings();
    openModal(el.chartModal, el.closeChartBtn);
    renderChart();
  }

  function closeChart() {
    closeModal(el.chartModal);
  }

  function openCurrentChart() {
    if (!currentQuestion) {
      openChart();
      return;
    }

    el.chartModeSelect.value = currentQuestion.mode;
    setChartProfileOptions(
      currentQuestion.mode,
      currentQuestion.mode === MODES.RFI
        ? (currentQuestion.heroBaseline || settings.heroBaseline)
        : (currentQuestion.openerProfile || settings.villainProfile)
    );
    el.chartSizeSelect.value = currentQuestion.openSize || settings.openSize;

    if (currentQuestion.mode === MODES.RFI) {
      rebuildHeroOptions(MODES.RFI, currentQuestion.position);
    } else {
      el.chartOpenerSelect.value = currentQuestion.openerPosition;
      rebuildHeroOptions(MODES.VS_OPEN, currentQuestion.heroPosition);
    }

    openModal(el.chartModal, el.closeChartBtn);
    renderChart(currentQuestion.handClass);
  }

  function openModal(modal, focusTarget) {
    pauseQuestionTimer(Date.now());
    modalReturnFocus = document.activeElement || null;
    activeModal = modal;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    if (document.body && document.body.classList) {
      document.body.classList.add("modal-open");
    }
    if (el.appContent) {
      el.appContent.inert = true;
      el.appContent.setAttribute("aria-hidden", "true");
    }
    window.setTimeout(() => safeFocus(focusTarget || modal), 0);
  }

  function closeModal(modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    if (activeModal === modal) {
      activeModal = null;
      if (document.body && document.body.classList) {
        document.body.classList.remove("modal-open");
      }
      if (el.appContent) {
        el.appContent.inert = false;
        el.appContent.setAttribute("aria-hidden", "false");
      }
      safeFocus(modalReturnFocus);
      modalReturnFocus = null;
      resumeQuestionTimer(Date.now());
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      pauseQuestionTimer(Date.now());
    } else {
      resumeQuestionTimer(Date.now());
    }
  }

  function handleWindowBlur() {
    windowFocused = false;
    pauseQuestionTimer(Date.now());
  }

  function handleWindowFocus() {
    windowFocused = true;
    resumeQuestionTimer(Date.now());
  }

  function handleDocumentKeydown(evt) {
    if (!activeModal) {
      return;
    }
    if (evt.key === "Escape") {
      if (evt.preventDefault) evt.preventDefault();
      activeModal === el.settingsModal ? closeSettings() : closeChart();
      return;
    }
    if (evt.key !== "Tab" || !activeModal.querySelectorAll) {
      return;
    }
    const focusable = Array.from(activeModal.querySelectorAll("button, select, input, summary, [tabindex]"))
      .filter((node) => !node.disabled && !node.classList.contains("hidden") && node.tabIndex !== -1);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (evt.shiftKey && document.activeElement === first) {
      if (evt.preventDefault) evt.preventDefault();
      safeFocus(last);
    } else if (!evt.shiftKey && document.activeElement === last) {
      if (evt.preventDefault) evt.preventDefault();
      safeFocus(first);
    }
  }

  function safeFocus(node) {
    if (node && typeof node.focus === "function") {
      node.focus();
    }
  }

  function buildSettingsUI() {
    buildRadioGroup({
      grid: el.heroBaselineGrid,
      name: "heroBaseline",
      values: engine.HERO_BASELINES || engine.OPENER_PROFILES,
      selected: settings.heroBaseline,
      onChange: (value) => updateSetting("heroBaseline", value)
    });

    buildRadioGroup({
      grid: el.villainProfileGrid,
      name: "villainProfile",
      values: engine.OPENER_PROFILES,
      selected: settings.villainProfile,
      onChange: (value) => updateSetting("villainProfile", value)
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

    buildSpotToggleGroup();

    buildSamplingGrid(el.drillSamplingGrid, "drillSamplingMode", settings.drillSamplingMode);
    el.decisionMixNote.innerHTML = '<p class="setting-note">A focus session is 20 decisions. Due mistakes come first; remaining questions favor semantic range boundaries and under-practiced concepts. The 35% first-in / 65% facing-open split is a curriculum emphasis, not measured Poto opportunity frequency. Facing-3-bet decisions stay withheld until positions, sizes, and call ranges are modeled.</p>';
    renderRoomEvidence();
    renderProfileDefinition();
  }

  function renderRoomEvidence() {
    if (!el.roomEvidenceLine || !el.roomDropEvidenceLine) return;
    el.roomEvidenceLine.textContent = evidence.getRoomEvidenceSummary() +
      " PokerAtlas's listed $100-$500 buy-in spans about 33-167bb; the graded strategy uses only a 100bb training assumption and excludes straddles.";
    el.roomDropEvidenceLine.textContent = "PokerAtlas lists $1 on $15+ and $2 on $30+. Potawatomi's official poker page lists no current promotions and its Bad Beat page says that jackpot is suspended, so the current collection and meaning of $2 still need desk confirmation.";
  }

  function buildSpotToggleGroup() {
    const spots = engine.getValidVsOpenSpots();
    const selected = new Set(settings.enabledVsOpenSpots);
    el.vsSpotToggleGrid.textContent = "";
    spots.forEach((spot) => {
      const row = document.createElement("label");
      row.className = "check-row";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selected.has(spot.key);
      input.value = spot.key;
      const text = document.createElement("span");
      text.textContent = engine.positionLabel(spot.openerPosition) + " → " + engine.positionLabel(spot.heroPosition);
      input.addEventListener("change", () => {
        const next = new Set(settings.enabledVsOpenSpots);
        input.checked ? next.add(spot.key) : next.delete(spot.key);
        if (!next.size) {
          input.checked = true;
          showNotice("Keep at least one facing-open spot enabled.");
          return;
        }
        settings.enabledVsOpenSpots = spots.filter((item) => next.has(item.key)).map((item) => item.key);
        saveSettings();
        updateSpotSelectionSummary();
        renderProfileDefinition();
        renderStats();
        startSession({ focusQuestion: false });
      });
      row.append(input, text);
      el.vsSpotToggleGrid.appendChild(row);
    });
    updateSpotSelectionSummary();
  }

  function updateSpotSelectionSummary() {
    el.spotSelectionSummary.textContent = settings.enabledVsOpenSpots.length + " exact spots selected";
  }

  function renderProfileDefinition() {
    const openerPositions = Array.from(new Set(enabledVsOpenSpots().map((spot) => spot.openerPosition)));
    if (!openerPositions.length || typeof engine.getVillainProfileDefinition !== "function") {
      el.profileDefinitionLine.textContent = "Controls only Villain's position-specific opening range when Hero faces a raise.";
      return;
    }
    const definitions = openerPositions.map((position) =>
      engine.getVillainProfileDefinition(settings.villainProfile, position)
    );
    if (definitions.length === 1) {
      const definition = definitions[0];
      el.profileDefinitionLine.textContent = definition.label + " " + definition.positionLabel +
        " model: " + definition.pureOpenPercent + "% pure opens; up to " + definition.upperBoundOpenPercent +
        "% including its qualitative mixed boundary. Provisional derived range, not observed Poto frequency.";
      return;
    }
    el.profileDefinitionLine.textContent = definitions[0].label + " model by selected opener: " +
      definitions.map((definition) => definition.positionLabel + " " + definition.pureOpenPercent + "-" +
        definition.upperBoundOpenPercent + "%").join("; ") +
      ". Each span runs from pure opens through the qualitative mixed boundary; these are provisional derived ranges, not observed Poto frequencies.";
  }

  function resetToLiveDefaults() {
    settings = defaultSettings();
    const saved = saveSettings();
    buildSettingsUI();
    renderStats();
    startSession({ focusQuestion: false });
    showNotice(saved
      ? "Live $1/$3 defaults restored."
      : "Live $1/$3 defaults apply to this tab, but could not be saved.");
  }

  function updateSetting(key, value) {
    if (settings[key] === value) {
      return;
    }
    settings[key] = value;
    saveSettings();
    if (key === "villainProfile") renderProfileDefinition();
    renderStats();
    startSession({ focusQuestion: false });
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
        renderStats();
        startSession({ focusQuestion: false });
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
        startSession({ focusQuestion: false });
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

  function renderStrategyStatus() {
    const reviewedStatuses = new Set(["reviewed", "solver-reviewed", "expert-reviewed"]);
    const reviewed = reviewedStatuses.has(STRATEGY_METADATA.status) || STRATEGY_METADATA.reviewStatus === "independently-reviewed";
    el.strategyStatusTitle.textContent = reviewed ? "Reviewed strategy corpus" : "Poto room profile · provisional strategy";
    el.strategyStatusCopy.textContent = reviewed
      ? "Version " + STRATEGY_VERSION + " · " + (STRATEGY_METADATA.assumptions || "See settings for assumptions.")
      : "You report 9-handed; PokerAtlas lists 9 players and 10% rake up to $6. Hand-authored 100bb actions are not solver- or expert-reviewed and do not incorporate rake/drop. Version " + STRATEGY_VERSION + ".";
    const link = document.createElement("a");
    link.href = "./docs/POTO_CALIBRATION.md";
    link.textContent = " Poto assumptions";
    el.strategyStatusCopy.appendChild(link);
  }

  function createSession(options) {
    const input = options || {};
    return {
      id: "session-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 100000).toString(36),
      kind: input.kind || "FOCUS",
      label: input.label || "10-minute focus",
      target: input.target || SESSION_TARGET,
      answered: 0,
      passing: 0,
      preferred: 0,
      dueDrawn: 0,
      startedAt: Date.now(),
      ended: false
    };
  }

  function startSession(options) {
    const input = options || {};
    if (!input.keepTarget) activeTarget = null;
    session = createSession(input);
    el.questionPanel.classList.remove("hidden");
    el.sessionCompletePanel.classList.add("hidden");
    renderSessionProgress();
    nextQuestion();
    if (input.focusQuestion !== false) safeFocus(el.questionPanel);
  }

  function renderSessionProgress() {
    const answered = Math.min(session.answered, session.target);
    el.sessionLabel.textContent = session.label;
    el.sessionProgressText.textContent = answered + " / " + session.target;
    el.sessionProgressTrack.setAttribute("aria-valuemax", String(session.target));
    el.sessionProgressTrack.setAttribute("aria-valuenow", String(answered));
    el.sessionProgressFill.style.width = Math.round((answered / session.target) * 100) + "%";
  }

  function finishSession() {
    session.ended = true;
    const elapsedMinutes = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
    const preferredRate = formatPercent(session.preferred, session.answered);
    el.sessionCompleteTitle.textContent = session.kind === "TARGETED" ? "Leak review session complete" : "Focus complete";
    el.sessionCompleteSummary.textContent = session.answered + " decisions in about " + elapsedMinutes +
      " min · " + preferredRate + " default accuracy. " +
      (topLeak ? "Your next practice priority is " + leakTitle(topLeak) + "." : "No unresolved exact leak is established yet.");
    el.reviewSessionLeakBtn.classList.toggle("hidden", !topLeak);
    el.questionPanel.classList.add("hidden");
    el.sessionCompletePanel.classList.remove("hidden");
    renderSessionProgress();
    saveStats();
    safeFocus(el.restartSessionBtn);
  }

  function nextQuestion() {
    if (session.ended) return;
    currentQuestion = generateQuestion();
    whyVisible = false;
    renderQuestion();
  }

  function advanceToNextQuestion() {
    if (session.answered >= session.target) {
      finishSession();
      return;
    }
    nextQuestion();
    el.spotLine.scrollIntoView({ block: "start" });
    safeFocus(el.questionPanel);
  }

  function generateQuestion() {
    const allowDueReview = scheduler.allowsDueReview({
      sessionKind: session.kind,
      answered: session.answered,
      dueDrawn: session.dueDrawn,
      maxShare: MAX_DUE_REVIEW_SHARE
    });
    const dueQuestion = allowDueReview ? drawDueQuestion() : null;
    if (dueQuestion) {
      session.dueDrawn += 1;
      if (activeTarget && dueQuestion.questionKey === activeTarget.questionKey) {
        activeTarget.firstQuestion = false;
      }
      return dueQuestion;
    }

    if (activeTarget) {
      const hand = activeTarget.firstQuestion ? activeTarget.hand : null;
      activeTarget.firstQuestion = false;
      return buildQuestionFromArgs(activeTarget.args, hand || sampleHand({ ...activeTarget.args, samplingMode: settings.drillSamplingMode }), "targeted");
    }

    const exactPriorityQuestion = drawExactPriorityQuestion(allowDueReview);
    if (exactPriorityQuestion) {
      if (exactPriorityQuestion.source === "due review") session.dueDrawn += 1;
      return exactPriorityQuestion;
    }

    const mode = drawDecisionMode();

    if (mode === MODES.RFI) {
      const position = drawRfiPosition();
      const handArgs = {
        mode,
        position,
        samplingMode: settings.drillSamplingMode
      };
      const handClass = sampleHand(handArgs);
      return buildQuestionFromArgs(handArgs, handClass, "focus");
    }

    const spot = drawVsOpenSpot();
    const handArgs = {
      mode: MODES.VS_OPEN,
      openerPosition: spot.openerPosition,
      heroPosition: spot.heroPosition,
      samplingMode: settings.drillSamplingMode
    };
    const handClass = sampleHand(handArgs);
    return buildQuestionFromArgs(handArgs, handClass, "focus");
  }

  function buildQuestionFromArgs(inputArgs, handClass, source) {
    const args = { ...inputArgs };
    if (args.mode === MODES.RFI) {
      args.heroBaseline = args.heroBaseline || settings.heroBaseline;
    } else {
      args.openerProfile = args.openerProfile || settings.villainProfile;
      args.openSize = args.openSize || settings.openSize;
    }
    const recommendation = engine.recommend({ ...args, hand: handClass });
    const questionKey = buildQuestionKey(args, handClass);
    return {
      ...args,
      handClass,
      recommendation,
      questionKey,
      conceptKey: buildConceptKey(args, handClass, recommendation),
      statsContextKey: statsContextKeyForArgs(args),
      source: source || "focus",
      answered: false
    };
  }

  function drawDueQuestion() {
    if (typeof scheduler.getNextRelearningQuestion !== "function" || !stats.byLeak) return null;
    const availableQuestionKeys = activeTarget && session.kind === "TARGETED"
      ? [activeTarget.questionKey]
      : currentLeakRows().map((row) => row.questionKey);
    if (!availableQuestionKeys.length) return null;
    const due = scheduler.getNextRelearningQuestion(stats, {
      sequence: stats.sequence,
      now: Date.now(),
      sessionId: session.id,
      availableQuestionKeys
    });
    const questionKey = typeof due === "string" ? due : (due && due.questionKey);
    const leak = questionKey && stats.byLeak[questionKey];
    return leak ? buildQuestionFromArgs(leak.args, leak.hand, "due review") : null;
  }

  function leakMatchesCurrentSettings(leak) {
    if (!leak || !leak.args) return false;
    if (leak.args.mode === MODES.RFI) {
      return settings.enabledRfiPositions.includes(leak.args.position) && leak.args.heroBaseline === settings.heroBaseline;
    }
    return settings.enabledVsOpenSpots.includes(engine.spotKey(leak.args.openerPosition, leak.args.heroPosition)) &&
      leak.args.openerProfile === settings.villainProfile && leak.args.openSize === settings.openSize;
  }

  function currentLeakRows() {
    return Object.values(stats.byLeak || {}).filter(leakMatchesCurrentSettings);
  }

  function exactPriorityOptions(now) {
    if (typeof scheduler.buildExactPriorityOptions !== "function") return [];
    const recentHands = new Set(stats.recentHands || []);
    const queuedQuestionKeys = (stats.relearningQueue || []).map((row) => row && row.questionKey).filter(Boolean);
    const rows = currentLeakRows().map((leak) => {
      const record = stats.byQuestion && stats.byQuestion[leak.questionKey];
      return {
        ...leak,
        record,
        conceptRecord: stats.byConcept && stats.byConcept[leak.conceptKey || (record && record.conceptKey)],
        comboWeight: comboWeight(leak.hand),
        isInvariant: Boolean(record && record.isInvariant),
        isRecentHand: recentHands.has(leak.hand)
      };
    });
    return scheduler.buildExactPriorityOptions(rows, {
      sequence: stats.sequence,
      now: now || Date.now(),
      recentQuestionKeys: stats.recentQuestions || [],
      excludedQuestionKeys: queuedQuestionKeys
    });
  }

  function drawExactPriorityQuestion(allowDueReview) {
    const options = exactPriorityOptions(Date.now());
    if (!options.length) return null;
    const due = allowDueReview ? options.filter((option) => option.dueNow) : [];
    const weak = options.filter((option) => !option.dueNow);
    if (!due.length && (!weak.length || Math.random() >= 0.3)) return null;
    const candidates = scheduler.capWeightedOptions(due.length ? due : weak, 0.3);
    const selected = drawWeightedOption(candidates.map((option) => ({
      ...option,
      id: option.questionKey,
      value: option
    }))).value;
    return buildQuestionFromArgs(
      selected.args,
      selected.hand,
      selected.dueNow ? "due review" : "exact priority"
    );
  }

  function drawDecisionMode() {
    const signature = settings.enabledRfiPositions.join("|") + ":" + settings.enabledVsOpenSpots.join("|");
    if (isAdaptiveDrill()) {
      const options = CURRICULUM_MIX.map((item) => ({
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
    return drawEven("context:" + MODES.VS_OPEN, valid, settings.enabledVsOpenSpots.join("|") + ":" + valid.length);
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
        weight: scoreLearningOption(args, hand, 1, questionKey, recentQuestions, recentHands)
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
        weight: scoreLearningOption(args, option.hand, option.weight, questionKey, recentQuestions, recentHands)
      };
    });
    const fresh = options.filter((option) => !recentQuestions.has(option.questionKey));
    const candidates = fresh.length ? fresh : options;
    return drawWeightedOption(scheduler.capWeightedOptions(candidates, 0.18)).value;
  }

  function scoreLearningOption(args, hand, samplingWeight, questionKey, recentQuestions, recentHands) {
    const recommendation = engine.recommend({
      ...args,
      hand,
      heroBaseline: args.mode === MODES.RFI ? (args.heroBaseline || settings.heroBaseline) : undefined,
      openerProfile: args.mode === MODES.VS_OPEN ? (args.openerProfile || settings.villainProfile) : undefined,
      openSize: args.openSize || settings.openSize
    });
    const conceptKey = buildConceptKey(args, hand, recommendation);
    const common = {
      record: stats.byQuestion[questionKey],
      conceptRecord: stats.byConcept && stats.byConcept[conceptKey],
      samplingWeight,
      sequence: stats.sequence,
      now: Date.now(),
      isRecentQuestion: recentQuestions.has(questionKey),
      isRecentHand: recentHands.has(hand),
      isInvariant: isInvariantRecommendation(recommendation),
      comboWeight: comboWeight(hand),
      occurrenceWeight: 1,
      regretWeight: 1
    };
    return scheduler.scoreHandOption(common);
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
    return engine.getValidVsOpenSpots().filter((spot) => settings.enabledVsOpenSpots.includes(spot.key));
  }

  function buildQuestionKey(args, hand) {
    const contextKey = contextKeyForArgs(args);
    const profile = args.mode === MODES.RFI
      ? (args.heroBaseline || settings.heroBaseline)
      : (args.openerProfile || settings.villainProfile);
    const size = args.mode === MODES.VS_OPEN ? (args.openSize || settings.openSize) : "NA";
    return ["v4", contextKey, hand, profile, size, STRATEGY_FINGERPRINT].join(":");
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
      return base + ":" + (args.heroBaseline || settings.heroBaseline);
    }
    return base + ":" + (args.openerProfile || settings.villainProfile) + ":" + (args.openSize || settings.openSize);
  }

  function buildConceptKey(args, hand, recommendation) {
    const family = typeof scheduler.handFamily === "function" ? scheduler.handFamily(hand) : hand.slice(-1);
    const familyLabel = typeof family === "string" ? family : hand;
    const rule = recommendation.facts && recommendation.facts.strategyRuleId
      ? recommendation.facts.strategyRuleId
      : recommendation.primaryAction;
    const controls = recommendation.facts && recommendation.facts.operationalControls || {};
    const actionSignature = recommendation.primaryAction + "-" + recommendation.allowedActions.slice().sort().join("-");
    const dimensions = args.mode === MODES.RFI
      ? [controls.heroBaseline ? (args.heroBaseline || settings.heroBaseline) : "hero-invariant"]
      : [
          controls.openerProfile ? (args.openerProfile || settings.villainProfile) : "profile-invariant",
          controls.openSize ? (args.openSize || settings.openSize) : "size-invariant"
        ];
    return [args.mode, contextKeyForArgs(args), hand, familyLabel, actionSignature, rule].concat(dimensions)
      .join(":").replace(/[^A-Za-z0-9_>:.-]/g, "-").slice(0, 150);
  }

  function isInvariantRecommendation(recommendation) {
    const controls = recommendation.facts && recommendation.facts.operationalControls;
    return Boolean(controls) && !Object.values(controls).some(Boolean) && recommendation.allowedActions.length === 1;
  }

  function comboWeight(hand) {
    const count = typeof scheduler.comboCount === "function"
      ? scheduler.comboCount(hand)
      : (hand.length === 2 ? 6 : (hand.endsWith("s") ? 4 : 12));
    return Math.max(0.25, count / 12);
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
        heroBaseline: args.heroBaseline || settings.heroBaseline,
        openerProfile: args.openerProfile || settings.villainProfile,
        openSize: args.openSize || settings.openSize
      })
    }));
    return scheduler.buildChallengeOptions(rows, {
      // Leave action weights empty: the learning priority applies real combo
      // frequency instead of forcing an artificial 3-bet/call/fold quota.
      actionWeights: {},
      coreShare: 0.08,
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
      heroBaseline: question.heroBaseline || settings.heroBaseline,
      openerProfile: question.openerProfile || settings.villainProfile,
      openSize: question.openSize || settings.openSize
    });
    el.samplingLine.textContent = question.source === "due review"
      ? "Due review · spaced retrieval"
      : (question.source === "targeted"
          ? "Targeted exact-spot drill"
          : (question.source === "exact priority"
              ? "Personal weak spot · adaptive priority"
              : SAMPLING_LABELS[settings.drillSamplingMode]));
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
    el.whyBtn.setAttribute("aria-expanded", "false");
    el.whyBtn.classList.add("hidden");
    el.whyLine.classList.add("hidden");
    el.coachReasonLine.textContent = "";
    el.coachCorrectionLine.textContent = "";
    el.coachCorrectionRow.classList.add("hidden");
    el.coachRangePlanLine.textContent = "";
    el.coachRangePlanRow.classList.add("hidden");
    el.coachAdjustmentLine.textContent = "";
    el.coachAdjustmentRow.classList.add("hidden");
    el.coachTakeawayLine.textContent = "";
    el.viewCurrentChartBtn.classList.add("hidden");
    el.nextBtn.classList.add("hidden");
    el.questionPanel.setAttribute("aria-busy", "false");
    resetQuestionTimer(Date.now());
    renderSessionProgress();
  }

  function resetQuestionTimer(now) {
    questionActiveElapsedMs = 0;
    questionActiveStartedAt = null;
    resumeQuestionTimer(now);
  }

  function pauseQuestionTimer(now) {
    if (questionActiveStartedAt === null) return;
    questionActiveElapsedMs += Math.max(0, now - questionActiveStartedAt);
    questionActiveStartedAt = null;
  }

  function resumeQuestionTimer(now) {
    if (!currentQuestion || currentQuestion.answered || activeModal || document.hidden || !windowFocused || questionActiveStartedAt !== null) return;
    questionActiveStartedAt = now;
  }

  function stopQuestionTimer(now) {
    pauseQuestionTimer(now);
    return Math.max(0, Math.min(10 * 60 * 1000, questionActiveElapsedMs));
  }

  function submitAnswer(takeAction) {
    if (!currentQuestion || currentQuestion.answered || !takeAction) {
      return;
    }

    const answeredAt = Date.now();
    const responseLatencyMs = stopQuestionTimer(answeredAt);
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

    stats.responseLatencyTotalMs += responseLatencyMs;
    stats.responseLatencySamples += 1;
    updateLeakRecord(currentQuestion, takeAction, grade, answeredAt, responseLatencyMs);

    scheduler.recordQuestionResult(stats, {
      questionKey: currentQuestion.questionKey,
      contextKey: currentQuestion.statsContextKey,
      hand: currentQuestion.handClass,
      conceptKey: currentQuestion.conceptKey,
      strategyVersion: STRATEGY_VERSION,
      timestamp: answeredAt,
      responseLatencyMs,
      chosenAction: takeAction,
      sessionId: session.id,
      isPassing: grade.isPassing,
      isPreferred: grade.isPreferred,
      isInvariant: isInvariantRecommendation(recommendation),
      comboWeight: comboWeight(currentQuestion.handClass),
      occurrenceWeight: 1,
      regretWeight: 1,
      mode: currentQuestion.mode,
      position: currentQuestion.position,
      heroBaseline: currentQuestion.heroBaseline,
      openerPosition: currentQuestion.openerPosition,
      heroPosition: currentQuestion.heroPosition,
      openerProfile: currentQuestion.openerProfile,
      openSize: currentQuestion.openSize
    });

    stats.answerLog.unshift({
      questionKey: currentQuestion.questionKey,
      conceptKey: currentQuestion.conceptKey,
      contextKey: currentQuestion.statsContextKey,
      hand: currentQuestion.handClass,
      chosenAction: takeAction,
      primaryAction: recommendation.primaryAction,
      isPassing: grade.isPassing,
      isPreferred: grade.isPreferred,
      responseLatencyMs,
      answeredAt,
      strategyFingerprint: STRATEGY_FINGERPRINT,
      roomEvidenceVersion: evidence.EVIDENCE_VERSION
    });
    if (stats.answerLog.length > MAX_ANSWER_LOG) stats.answerLog.length = MAX_ANSWER_LOG;

    session.answered += 1;
    if (grade.isPassing) session.passing += 1;
    if (grade.isPreferred) session.preferred += 1;
    renderSessionProgress();

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
    el.whyBtn.setAttribute("aria-expanded", "true");
    el.viewCurrentChartBtn.classList.remove("hidden");
    el.whyLine.classList.remove("hidden");
    whyVisible = true;
    el.nextBtn.classList.remove("hidden");
    el.nextBtn.textContent = session.answered >= session.target ? "Finish session" : "Next hand";
  }

  function updateLeakRecord(question, chosenAction, grade, answeredAt, latencyMs) {
    const key = question.questionKey;
    const existing = stats.byLeak[key] || {
      questionKey: key,
      conceptKey: question.conceptKey,
      strategyFingerprint: STRATEGY_FINGERPRINT,
      args: storedQuestionArgs(question),
      hand: question.handClass,
      contextLabel: question.recommendation.contextLabel,
      primaryAction: question.recommendation.primaryAction,
      attempts: 0,
      misses: 0,
      nonPreferred: 0,
      lapses: 0,
      correctSeen: 0,
      wrongActions: {},
      unresolved: false,
      recoveryStreak: 0,
      lastAnsweredAt: 0,
      lastMissedAt: 0,
      averageLatencyMs: 0
    };
    if (typeof existing.unresolved !== "boolean") existing.unresolved = existing.misses > 0;
    if (!Number.isFinite(existing.recoveryStreak)) existing.recoveryStreak = 0;
    existing.attempts += 1;
    existing.averageLatencyMs = Math.round(((existing.averageLatencyMs * (existing.attempts - 1)) + latencyMs) / existing.attempts);
    existing.lastAnsweredAt = answeredAt;
    existing.primaryAction = question.recommendation.primaryAction;
    if (!grade.isPassing) {
      existing.misses += 1;
      existing.unresolved = true;
      existing.recoveryStreak = 0;
      existing.lastMissedAt = answeredAt;
      existing.wrongActions[chosenAction] = (existing.wrongActions[chosenAction] || 0) + 1;
      if (existing.correctSeen > 0) existing.lapses += 1;
    } else {
      existing.correctSeen += 1;
      if (!grade.isPreferred) {
        existing.nonPreferred += 1;
        existing.unresolved = true;
        existing.recoveryStreak = 0;
      } else if (existing.unresolved) {
        existing.recoveryStreak = (existing.recoveryStreak || 0) + 1;
        if (existing.recoveryStreak >= 3) {
          existing.unresolved = false;
        }
      }
    }
    stats.byLeak[key] = existing;
  }

  function storedQuestionArgs(question) {
    if (question.mode === MODES.RFI) {
      return { mode: MODES.RFI, position: question.position, heroBaseline: question.heroBaseline || settings.heroBaseline };
    }
    return {
      mode: MODES.VS_OPEN,
      openerPosition: question.openerPosition,
      heroPosition: question.heroPosition,
      openerProfile: question.openerProfile || settings.villainProfile,
      openSize: question.openSize || settings.openSize
    };
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
    const rangePlan = recommendation.allowedActions.length > 1
      ? (recommendation.frequency || "Qualitative mix; this provisional corpus does not assign an exact frequency.")
      : "Pure default in this provisional corpus; no numeric EV or frequency is claimed.";
    el.coachRangePlanLine.textContent = rangePlan;
    el.coachRangePlanRow.classList.remove("hidden");

    const corpusSwitch = Array.isArray(recommendation.counterfactuals) ? recommendation.counterfactuals[0] : null;
    const corpusSwitchText = corpusSwitch
      ? counterfactualLabel(corpusSwitch) + " changes the provisional corpus default to " + engine.displayAction(corpusSwitch.primaryAction) + "."
      : "";
    el.coachAdjustmentLine.textContent = corpusSwitchText;
    el.coachAdjustmentRow.classList.toggle("hidden", !corpusSwitchText);
    const contrast = recommendation.facts && recommendation.facts.nearestContrast;
    el.coachTakeawayLine.textContent = contrast
      ? contrast.hand + " is the nearest provisional-corpus " + contrast.relationship + " contrast and defaults to " + engine.displayAction(contrast.primaryAction) + "."
      : (coach.takeaway || "Use this only under the assumptions shown above.");
  }

  function counterfactualLabel(row) {
    if (row.dimension === "openerProfile") return "Villain model " + row.to;
    if (row.dimension === "openSize") return "Open size " + engine.sizeLabel(row.to);
    if (row.dimension === "heroBaseline") return "Hero baseline " + (engine.heroBaselineLabel ? engine.heroBaselineLabel(row.to) : row.to);
    return row.dimension + " " + row.to;
  }

  function toggleWhyLine() {
    if (!currentQuestion || !currentQuestion.answered) {
      return;
    }

    whyVisible = !whyVisible;
    if (!whyVisible) {
      el.whyBtn.textContent = "Show explanation";
      el.whyBtn.setAttribute("aria-expanded", "false");
      el.whyLine.classList.add("hidden");
      return;
    }

    el.whyBtn.textContent = "Hide explanation";
    el.whyBtn.setAttribute("aria-expanded", "true");
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
    setSelectOptions(el.chartSizeSelect, LIVE_OPEN_SIZE_CLASSES);
    syncChartControlsFromSettings();
  }

  function syncChartControlsFromSettings() {
    const preferredMode = currentQuestion && currentQuestion.mode ? currentQuestion.mode : MODES.VS_OPEN;
    el.chartModeSelect.value = preferredMode;
    setChartProfileOptions(preferredMode, preferredMode === MODES.RFI ? settings.heroBaseline : settings.villainProfile);
    el.chartSizeSelect.value = settings.openSize;
    if (!el.chartOpenerSelect.value) {
      setSelectOptions(el.chartOpenerSelect, engine.VS_OPEN_OPENERS.map((id) => ({ id, label: engine.positionLabel(id) })));
    }
    rebuildHeroOptions(el.chartModeSelect.value);
  }

  function renderChart(focusHand) {
    const mode = el.chartModeSelect.value;
    const preferredProfile = mode === MODES.RFI ? settings.heroBaseline : settings.villainProfile;
    const validProfiles = mode === MODES.RFI ? (engine.HERO_BASELINES || engine.OPENER_PROFILES) : engine.OPENER_PROFILES;
    if (!validProfiles.some((row) => row.id === el.chartProfileSelect.value)) {
      setChartProfileOptions(mode, preferredProfile);
    }
    const profile = el.chartProfileSelect.value;
    const size = el.chartSizeSelect.value;

    if (mode === MODES.RFI) {
      el.chartOpenerSelect.disabled = true;
      el.chartProfileSelect.disabled = false;
      el.chartProfileLabel.textContent = "Hero baseline";
      el.chartSizeSelect.disabled = true;
      rebuildHeroOptions(mode, el.chartHeroSelect.value || "UTG");
    } else {
      el.chartOpenerSelect.disabled = false;
      el.chartHeroSelect.disabled = false;
      el.chartProfileSelect.disabled = false;
      el.chartProfileLabel.textContent = "Villain model";
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
    let focusedRecommendation = null;
    rows.forEach(({ hand, recommendation }, cellIndex) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "chart-cell chart-" + engine.classifyForChart(recommendation);
      cell.textContent = hand;
      const alternativeLabels = recommendation.allowedActions
        .filter((action) => action !== recommendation.primaryAction)
        .map(engine.displayAction)
        .join(", ");
      cell.setAttribute("aria-label", hand + " default " + engine.displayAction(recommendation.primaryAction) +
        (alternativeLabels ? "; reasonable alternative " + alternativeLabels : ""));
      const isInitialTabStop = focusHand ? focusHand === hand : cellIndex === 0;
      cell.tabIndex = isInitialTabStop ? 0 : -1;
      cell.setAttribute("tabindex", String(cell.tabIndex));
      cell.addEventListener("click", () => {
        setChartRovingFocus(cell);
        showChartDetail(recommendation, true);
      });
      cell.addEventListener("keydown", (evt) => handleChartCellKeydown(evt, cellIndex));
      el.chartMatrix.appendChild(cell);
      if (focusHand && focusHand === hand) {
        focusedRecommendation = recommendation;
      }
    });

    if (focusedRecommendation) {
      showChartDetail(focusedRecommendation, true);
    } else if (rows.length) {
      showChartDetail(rows.find((row) => row.hand === "AQo")?.recommendation || rows[0].recommendation);
    }
  }

  function setChartProfileOptions(mode, preferred) {
    const values = mode === MODES.RFI ? (engine.HERO_BASELINES || engine.OPENER_PROFILES) : engine.OPENER_PROFILES;
    setSelectOptions(el.chartProfileSelect, values);
    if (values.some((row) => row.id === preferred)) el.chartProfileSelect.value = preferred;
    el.chartProfileLabel.textContent = mode === MODES.RFI ? "Hero baseline" : "Villain model";
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
        heroBaseline: profile,
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

  function showChartDetail(recommendation, reveal) {
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

    const counterfactual = Array.isArray(recommendation.counterfactuals) ? recommendation.counterfactuals[0] : null;
    const adjustment = document.createElement("p");
    adjustment.textContent = counterfactual
      ? "Corpus switch: " + counterfactualLabel(counterfactual) + " → " + engine.displayAction(counterfactual.primaryAction)
      : "";

    const takeaway = document.createElement("p");
    const contrast = recommendation.facts && recommendation.facts.nearestContrast;
    takeaway.textContent = contrast
      ? "Contrast: " + contrast.hand + " defaults to " + engine.displayAction(contrast.primaryAction) + "."
      : (coach.takeaway ? "Remember: " + coach.takeaway : "");

    el.chartDetail.append(title, meta, why);
    if (adjustment.textContent) {
      el.chartDetail.appendChild(adjustment);
    }
    if (takeaway.textContent) {
      el.chartDetail.appendChild(takeaway);
    }
    if (reveal && typeof el.chartDetail.scrollIntoView === "function") {
      const revealDetail = () => el.chartDetail.scrollIntoView({ block: "nearest" });
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(revealDetail);
      } else {
        window.setTimeout(revealDetail, 0);
      }
    }
  }

  function setChartRovingFocus(target) {
    Array.from(el.chartMatrix.children).forEach((cell) => {
      cell.tabIndex = cell === target ? 0 : -1;
      cell.setAttribute("tabindex", String(cell.tabIndex));
    });
  }

  function handleChartCellKeydown(evt, index) {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -13, ArrowDown: 13 };
    if (!Object.prototype.hasOwnProperty.call(offsets, evt.key)) return;
    if (evt.preventDefault) evt.preventDefault();
    const cells = Array.from(el.chartMatrix.children);
    const targetIndex = Math.max(0, Math.min(cells.length - 1, index + offsets[evt.key]));
    const target = cells[targetIndex];
    if (!target || target === cells[index]) return;
    setChartRovingFocus(target);
    safeFocus(target);
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
        heroBaseline: profile
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
    el.accuracyValue.textContent = formatPercent(stats.preferred, stats.total);
    const due = getDueRows();
    el.dueValue.textContent = String(due.length);
    el.responseValue.textContent = stats.responseLatencySamples
      ? (stats.responseLatencyTotalMs / stats.responseLatencySamples / 1000).toFixed(1) + "s"
      : "--";
    const leaks = rankedLeaks();
    topLeak = leaks[0] || null;
    el.drillTopLeakBtn.disabled = !topLeak;
    el.nextPriorityTitle.textContent = topLeak ? leakTitle(topLeak) : "No established leak yet";
    el.nextPriorityCopy.textContent = topLeak
      ? leakSummary(topLeak)
      : "Answer a few decisions and the trainer will identify the exact spot to revisit.";
    el.leakList.textContent = "";
    if (!leaks.length) {
      const li = document.createElement("li");
      li.className = "empty-row";
      li.textContent = "No unresolved exact decisions under this strategy version.";
      el.leakList.appendChild(li);
    } else {
      leaks.slice(0, 5).forEach(renderLeakRow);
    }
    const conceptCount = stats.byConcept ? Object.keys(stats.byConcept).length : 0;
    el.masteryLine.textContent = due.length + " due now · " + conceptCount + " concepts seen · strategy fingerprint " + STRATEGY_FINGERPRINT + "." +
      (persistenceWarning ? " Progress cannot be saved in this browser; keep this tab open or free local storage." : "");
  }

  function getDueRows() {
    const availableQuestionKeys = currentLeakRows().map((row) => row.questionKey);
    if (!availableQuestionKeys.length) return [];
    const now = Date.now();
    const queued = typeof scheduler.getDueRelearning === "function"
      ? scheduler.getDueRelearning(stats, {
          sequence: stats.sequence,
          now,
          sessionId: session.id,
          availableQuestionKeys
        })
      : [];
    const exact = exactPriorityOptions(now).filter((row) => row.dueNow);
    return Array.from(new Map([].concat(queued || [], exact).map((row) => [row.questionKey, row])).values());
  }

  function rankedLeaks() {
    const dueKeys = new Set(getDueRows().map((row) => row.questionKey));
    return currentLeakRows().filter(Boolean)
      .map((row) => ({ ...row, dueNow: dueKeys.has(row.questionKey) }))
      .filter((row) => row.dueNow || (row.unresolved !== false && (row.misses > 0 || row.nonPreferred > 0)))
      .sort((a, b) => leakPriority(b) - leakPriority(a) || (b.lastMissedAt || 0) - (a.lastMissedAt || 0));
  }

  function leakPriority(row) {
    return (row.dueNow ? 100 : 0) + (row.misses || 0) * 8 + (row.nonPreferred || 0) * 4 + (row.lapses || 0) * 12 +
      (row.attempts ? (row.misses || 0) / row.attempts * 10 : 0);
  }

  function renderLeakRow(leak) {
    const li = document.createElement("li");
    li.className = "leak-card";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.className = "leak-title";
    title.textContent = leakTitle(leak);
    const meta = document.createElement("span");
    meta.className = "leak-meta";
    meta.textContent = leakSummary(leak);
    const due = document.createElement("span");
    due.className = "leak-due";
    due.textContent = leak.dueNow ? "Due now" : "Scheduled for review";
    copy.append(title, meta, due);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "drill-leak-btn";
    button.textContent = "Drill this spot";
    button.addEventListener("click", () => startTargetedDrill(leak));
    li.append(copy, button);
    el.leakList.appendChild(li);
  }

  function leakTitle(leak) {
    return leak.hand + " · " + leak.contextLabel;
  }

  function leakSummary(leak) {
    const recurring = Object.entries(leak.wrongActions || {}).sort((a, b) => b[1] - a[1])[0];
    if (!leak.misses && leak.nonPreferred) {
      return "Accepted but non-default " + leak.nonPreferred + "× · Default " + engine.displayAction(leak.primaryAction) +
        " · " + leak.attempts + " attempt" + (leak.attempts === 1 ? "" : "s");
    }
    return (recurring ? "Recurring choice " + engine.displayAction(recurring[0]) + " " + recurring[1] + "× · " : "") +
      "Default " + engine.displayAction(leak.primaryAction) + " · " + leak.misses + " miss" + (leak.misses === 1 ? "" : "es") +
      " in " + leak.attempts + " attempt" + (leak.attempts === 1 ? "" : "s");
  }

  function startTargetedDrill(leak) {
    if (!leak || !leak.args) return;
    activeTarget = { args: { ...leak.args }, hand: leak.hand, questionKey: leak.questionKey, firstQuestion: true };
    session = createSession({ kind: "TARGETED", label: "Exact leak review", target: TARGETED_SESSION_TARGET });
    el.questionPanel.classList.remove("hidden");
    el.sessionCompletePanel.classList.add("hidden");
    renderSessionProgress();
    nextQuestion();
    el.spotLine.scrollIntoView({ block: "start" });
    safeFocus(el.questionPanel);
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
    const allSpots = engine.getValidVsOpenSpots();
    return {
      heroBaseline: "BALANCED",
      villainProfile: "BALANCED",
      openSize: "STANDARD",
      enabledRfiPositions: ["MP3", "CO", "BTN", "SB"].filter((position) => engine.RFI_POSITIONS.includes(position)),
      enabledVsOpenSpots: allSpots.filter((spot) => DEFAULT_FOCUS_SPOTS.has(spot.key)).map((spot) => spot.key),
      drillSamplingMode: SAMPLING.BORDERLINE
    };
  }

  function loadSettings() {
    const fallback = defaultSettings();
    try {
      const currentRaw = safeGetStorage(STORAGE_KEYS.settings);
      const legacyRaw = currentRaw ? null : safeGetStorage(STORAGE_KEYS.legacySettings);
      const raw = currentRaw || legacyRaw;
      const parsed = raw ? JSON.parse(raw) : {};
      const heroValues = engine.HERO_BASELINES || engine.OPENER_PROFILES;
      const heroBaseline = heroValues.some((item) => item.id === parsed.heroBaseline) ? parsed.heroBaseline : fallback.heroBaseline;
      const requestedVillain = parsed.villainProfile || parsed.openerProfile;
      const villainProfile = engine.OPENER_PROFILES.some((item) => item.id === requestedVillain) ? requestedVillain : fallback.villainProfile;
      const openSize = LIVE_OPEN_SIZE_CLASSES.some((item) => item.id === parsed.openSize) ? parsed.openSize : fallback.openSize;
      let enabledRfiPositions = Array.isArray(parsed.enabledRfiPositions)
        ? engine.RFI_POSITIONS.filter((position) => parsed.enabledRfiPositions.includes(position))
        : fallback.enabledRfiPositions;
      const isLegacyAllPositionDefault = Boolean(legacyRaw) &&
        enabledRfiPositions.length === engine.RFI_POSITIONS.length &&
        engine.RFI_POSITIONS.every((position) => enabledRfiPositions.includes(position));
      if (isLegacyAllPositionDefault) {
        enabledRfiPositions = fallback.enabledRfiPositions;
      }
      const validSpotKeys = engine.getValidVsOpenSpots().map((spot) => spot.key);
      const enabledVsOpenSpots = Array.isArray(parsed.enabledVsOpenSpots)
        ? validSpotKeys.filter((key) => parsed.enabledVsOpenSpots.includes(key))
        : fallback.enabledVsOpenSpots;
      const samplingMode = parsed.drillSamplingMode || parsed.vsOpenSamplingMode || parsed.rfiSamplingMode;

      return {
        heroBaseline,
        villainProfile,
        openSize,
        enabledRfiPositions: enabledRfiPositions.length ? enabledRfiPositions : fallback.enabledRfiPositions,
        enabledVsOpenSpots: enabledVsOpenSpots.length ? enabledVsOpenSpots : fallback.enabledVsOpenSpots,
        drillSamplingMode: SAMPLING_LABELS[samplingMode] ? samplingMode : fallback.drillSamplingMode
      };
    } catch (err) {
      return fallback;
    }
  }

  function saveSettings() {
    const recovering = failedStorageWrites.has(STORAGE_KEYS.settings);
    const saved = safeSetStorage(STORAGE_KEYS.settings, JSON.stringify(settings));
    if (!saved) {
      showNotice("Could not save settings. Changes apply only while this tab stays open.");
    } else if (recovering) {
      showNotice("Settings saving restored.");
    }
    return saved;
  }

  function defaultStats() {
    const byContext = {};
    (engine.HERO_BASELINES || engine.OPENER_PROFILES).forEach(({ id: baseline }) => {
      engine.RFI_POSITIONS.forEach((position) => {
        byContext[MODES.RFI + ":" + position + ":" + baseline] = { total: 0, correct: 0, preferred: 0 };
      });
    });
    engine.OPENER_PROFILES.forEach(({ id: profile }) => {
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
      schemaVersion: 4,
      strategyVersion: STRATEGY_VERSION,
      strategyFingerprint: STRATEGY_FINGERPRINT,
      total: 0,
      correct: 0,
      preferred: 0,
      responseLatencyTotalMs: 0,
      responseLatencySamples: 0,
      byContext,
      misses: {},
      byLeak: {},
      answerLog: [],
      sequence: 0,
      byQuestion: {},
      byConcept: {},
      relearningQueue: [],
      recentQuestions: [],
      recentContexts: [],
      recentHands: []
    }, { strategyVersion: STRATEGY_VERSION });
  }

  function loadStats() {
    const fallback = defaultStats();
    try {
      const raw = safeGetStorage(STORAGE_KEYS.stats);
      const parsed = raw ? JSON.parse(raw) : {};
      if (raw && parsed.strategyFingerprint !== STRATEGY_FINGERPRINT) {
        return fallback;
      }
      if (Number.isFinite(parsed.total) && parsed.total >= 0) {
        fallback.total = Math.floor(parsed.total);
      }
      if (Number.isFinite(parsed.correct) && parsed.correct >= 0) {
        fallback.correct = Math.floor(parsed.correct);
      }
      if (Number.isFinite(parsed.preferred) && parsed.preferred >= 0) {
        fallback.preferred = Math.floor(parsed.preferred);
      }
      if (Number.isFinite(parsed.responseLatencyTotalMs) && parsed.responseLatencyTotalMs >= 0) {
        fallback.responseLatencyTotalMs = Math.floor(parsed.responseLatencyTotalMs);
      }
      if (Number.isFinite(parsed.responseLatencySamples) && parsed.responseLatencySamples >= 0) {
        fallback.responseLatencySamples = Math.floor(parsed.responseLatencySamples);
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
      if (parsed.byLeak && typeof parsed.byLeak === "object") {
        Object.entries(parsed.byLeak).forEach(([key, row]) => {
          if (row && typeof row === "object" && engine.ALL_HAND_CLASSES.includes(row.hand) && row.questionKey === key) {
            fallback.byLeak[key] = row;
          }
        });
      }
      if (Array.isArray(parsed.answerLog)) {
        fallback.answerLog = parsed.answerLog.filter((row) => row && row.strategyFingerprint === STRATEGY_FINGERPRINT).slice(0, MAX_ANSWER_LOG);
      }
      scheduler.restoreAdaptiveStats(fallback, parsed, {
        validHands: engine.ALL_HAND_CLASSES,
        strategyVersion: STRATEGY_VERSION
      });
      if (fallback.correct > fallback.total) {
        fallback.correct = fallback.total;
      }
      fallback.preferred = Math.min(fallback.preferred, fallback.correct);
      fallback.sequence = Math.max(fallback.sequence, fallback.total);
      pruneLeakRecords(fallback);
      return fallback;
    } catch (err) {
      return fallback;
    }
  }

  function saveStats() {
    pruneLeakRecords(stats);
    const saved = safeSetStorage(STORAGE_KEYS.stats, JSON.stringify(stats));
    if (!saved) {
      persistenceWarning = true;
    }
    return saved;
  }

  function pruneLeakRecords(targetStats) {
    if (!targetStats || !targetStats.byLeak || typeof targetStats.byLeak !== "object") return;
    const entries = Object.entries(targetStats.byLeak);
    if (entries.length <= MAX_LEAK_RECORDS) return;
    const queued = new Set(Array.isArray(targetStats.relearningQueue)
      ? targetStats.relearningQueue.map((row) => row && row.questionKey).filter(Boolean)
      : []);
    entries.sort((a, b) => {
      const aRow = a[1] || {};
      const bRow = b[1] || {};
      const aProtected = queued.has(a[0]) || aRow.unresolved;
      const bProtected = queued.has(b[0]) || bRow.unresolved;
      if (aProtected !== bProtected) return aProtected ? -1 : 1;
      if (Boolean(aRow.misses) !== Boolean(bRow.misses)) return aRow.misses ? -1 : 1;
      return (bRow.lastAnsweredAt || 0) - (aRow.lastAnsweredAt || 0);
    });
    const keep = new Set(entries.slice(0, MAX_LEAK_RECORDS).map(([key]) => key));
    entries.forEach(([key]) => {
      if (!keep.has(key)) delete targetStats.byLeak[key];
    });
  }

  function safeGetStorage(key) {
    try {
      const value = window.localStorage.getItem(key);
      storageAvailable = true;
      return value;
    } catch (err) {
      storageAvailable = false;
      return null;
    }
  }

  function safeSetStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
      storageAvailable = true;
      failedStorageWrites.delete(key);
      persistenceWarning = failedStorageWrites.size > 0;
      return true;
    } catch (err) {
      storageAvailable = false;
      failedStorageWrites.add(key);
      persistenceWarning = true;
      return false;
    }
  }

  function renderBootFailure() {
    const host = document.getElementById("appContent") || document.body;
    if (!host || typeof document.createElement !== "function") return;
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.setAttribute("role", "alert");
    const title = document.createElement("h2");
    title.textContent = "Trainer couldn't start";
    const copy = document.createElement("p");
    copy.textContent = "A required app file did not load. Check your connection, then refresh this page.";
    panel.append(title, copy);
    host.textContent = "";
    host.appendChild(panel);
  }
})();
