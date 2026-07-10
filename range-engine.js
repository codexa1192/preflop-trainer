(function initPotoRangeEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.PotoRangeEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildPotoRangeEngine() {
  "use strict";

  const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
  const RANK_INDEX = Object.fromEntries(RANKS.map((rank, index) => [rank, index]));

  const ACTIONS = {
    FOLD: "FOLD",
    CALL: "CALL",
    THREE_BET: "3BET",
    FOUR_BET: "4BET",
    OPEN: "OPEN",
    PASS: "PASS"
  };

  const ACTION_LABELS = {
    [ACTIONS.FOLD]: "FOLD",
    [ACTIONS.CALL]: "CALL",
    [ACTIONS.THREE_BET]: "3-BET",
    [ACTIONS.FOUR_BET]: "4-BET",
    [ACTIONS.OPEN]: "OPEN",
    [ACTIONS.PASS]: "PASS"
  };

  const MODES = {
    RFI: "RFI",
    VS_OPEN: "VS_OPEN",
    THREE_BET: "THREE_BET",
    FOUR_BET: "FOUR_BET"
  };

  const OPENER_PROFILES = [
    { id: "TIGHT", label: "Tight" },
    { id: "BALANCED", label: "Balanced" },
    { id: "LOOSE", label: "Loose" }
  ];

  const OPEN_SIZE_CLASSES = [
    { id: "SMALL", label: "small 2-3bb" },
    { id: "STANDARD", label: "standard 3-4bb" },
    { id: "LARGE", label: "large 4.5-6bb" }
  ];

  const POSITION_ORDER = ["UTG", "UTG1", "MP1", "MP2", "MP3", "CO", "BTN", "SB", "BB"];
  const POSITION_LABELS = {
    UTG: "UTG",
    UTG1: "UTG+1",
    MP1: "MP",
    MP2: "LJ",
    MP3: "HJ",
    CO: "CO",
    BTN: "BTN",
    SB: "SB",
    BB: "BB"
  };
  const RFI_POSITIONS = ["UTG", "UTG1", "MP1", "MP2", "MP3", "CO", "BTN", "SB"];
  const VS_OPEN_OPENERS = ["UTG", "UTG1", "MP1", "MP2", "MP3", "CO", "BTN"];
  const DEFAULT_PROFILE = "BALANCED";
  const DEFAULT_SIZE = "STANDARD";
  const DEFAULT_PRESET_ID = "live-1-3-default";

  const TEXT = {
    size: "Large live opens reduce implied odds and make dominated calls worse; smaller opens let position and suitedness realize more equity."
  };

  const THREE_BET_BLUFF_CANDIDATES = "A5s, A4s, A3s, A2s";
  const THREE_BET_VALUE_CANDIDATES = "QQ+, AK";

  function spec(threeBet, call, mixed, note) {
    return {
      threeBet: threeBet || "",
      call: call || "",
      mixed: mixed || [],
      note: note || ""
    };
  }

  function mix(hands, primaryAction, allowedActions, frequency, explanation, defaultFoldWhen) {
    return {
      hands,
      primaryAction,
      allowedActions,
      frequency,
      explanation,
      defaultFoldWhen: defaultFoldWhen || { profiles: [], sizes: [] }
    };
  }

  const RANGE_PRESETS = {
    [DEFAULT_PRESET_ID]: {
      id: DEFAULT_PRESET_ID,
      name: "Live $1/$3 Default",
      assumptions: "Live $1/$3 Default · 9-handed · 100-133bb · no ante",
      rfi: {
        TIGHT: {
          UTG: { open: "99+, AJs+, KQs, AQo+", mixed: "88, ATs, KJs, QJs" },
          UTG1: { open: "88+, AJs+, KQs, AQo+", mixed: "77, ATs, KJs, QJs, AJo" },
          MP1: { open: "77+, ATs+, KJs+, QJs, JTs, AJo+, KQo", mixed: "66, A9s, KTs, QTs, T9s" },
          MP2: { open: "77+, ATs+, KJs+, QJs, JTs, AJo+, KQo", mixed: "66, A9s, KTs, QTs, T9s" },
          MP3: { open: "66+, A9s+, KTs+, QTs+, JTs, T9s, 98s, ATo+, KQo", mixed: "55, A8s, K9s, Q9s, J9s, 87s" },
          CO: { open: "55+, A8s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, ATo+, KJo+, QJo", mixed: "44, A7s, K8s, Q8s, J8s, 97s, 65s, A9o" },
          BTN: { open: "44+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A8o+, KTo+, QTo+, JTo", mixed: "33, 22, K9o, Q9o, J9o, T9o" },
          SB: { open: "55+, A7s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 65s, A9o+, KTo+, QTo+, JTo", mixed: "44, A6s, K7s, Q8s, J8s, T7s, 64s, A8o" }
        },
        BALANCED: {
          UTG: { open: "77+, ATs+, KQs, AQo+", mixed: "66, A9s, KJs, QJs, JTs, T9s, AJo, KQo" },
          UTG1: { open: "66+, ATs+, KJs+, QJs, JTs, T9s, AQo+", mixed: "55, A9s, KTs, QTs, 98s, AJo, KQo" },
          MP1: { open: "66+, A9s+, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo", mixed: "55, A8s, K9s, Q9s, 87s, ATo, KJo, QJo" },
          MP2: { open: "55+, A9s+, KTs+, QTs+, JTs, T9s, 98s, 87s, ATo+, KJo+, QJo", mixed: "44, A8s, K9s, Q9s, J9s, 76s, KTo, QTo" },
          MP3: { open: "55+, A8s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, ATo+, KJo+, QJo", mixed: "44, A7s, K8s, Q8s, J8s, 97s, 65s, A9o, KTo, QTo" },
          CO: { open: "44+, A2s+, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, A9o+, KTo+, QTo+, JTo", mixed: "33, K7s, Q8s, J8s, T7s, 97s, 54s, K9o, Q9o, J9o" },
          BTN: { open: "22+, A2s+, K2s+, Q6s+, J7s+, T7s+, 97s+, 86s+, 75s+, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o", mixed: "Q5s, J6s, T6s, 96s, 85s, 64s, 53s, K8o, Q8o, J8o" },
          SB: { open: "22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A7o+, K9o+, Q9o+, J9o+, T9o", mixed: "K4s, Q7s, J7s, T7s, 96s, 64s, 53s, A6o, K8o, Q8o" }
        },
        LOOSE: {
          UTG: { open: "66+, A9s+, KJs+, QJs, JTs, T9s, AQo+", mixed: "55, A8s, KTs, QTs, 98s, AJo, KQo" },
          UTG1: { open: "55+, A9s+, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo", mixed: "44, A8s, K9s, Q9s, 87s, ATo, KJo, QJo" },
          MP1: { open: "55+, A8s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KJo+, QJo", mixed: "44, A7s, K8s, Q8s, T8s, 76s, KTo, QTo, JTo" },
          MP2: { open: "44+, A7s+, K8s+, Q8s+, J8s+, T8s+, 98s, 87s, 76s, A9o+, KTo+, QTo+, JTo", mixed: "33, A6s, K7s, Q7s, 97s, 65s, A8o, K9o, Q9o" },
          MP3: { open: "44+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, A8o+, KTo+, QTo+, JTo", mixed: "33, K6s, Q7s, J7s, T7s, 64s, A7o, K9o, Q9o" },
          CO: { open: "33+, A2s+, K5s+, Q7s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, A7o+, K9o+, Q9o+, J9o+, T9o", mixed: "22, K4s, Q6s, J6s, T6s, 85s, 53s, A6o, K8o, Q8o" },
          BTN: { open: "22+, A2s+, K2s+, Q2s+, J5s+, T6s+, 95s+, 84s+, 74s+, 63s+, 53s+, 43s, A2o+, K7o+, Q8o+, J8o+, T8o+, 98o", mixed: "J4s, T5s, 94s, 83s, 73s, 62s, K6o, Q7o, J7o" },
          SB: { open: "22+, A2s+, K2s+, Q6s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 53s+, A2o+, K8o+, Q8o+, J8o+, T8o+", mixed: "Q5s, J6s, T6s, 95s, 84s, 43s, K7o, Q7o, J7o" }
        }
      },
      vsOpen: {
        templates: {
          EARLY_NEXT: spec(
            "QQ+, AK",
            "TT, JJ, AQs, KQs",
            [
              mix("99, AJs", ACTIONS.CALL, [ACTIONS.CALL, ACTIONS.FOLD], "Call at good tables; fold when the opener is very tight.", "Continue carefully. You have position, but early ranges dominate many one-pair hands.", { profiles: ["TIGHT"], sizes: [] }),
              mix("AQo", ACTIONS.FOLD, [ACTIONS.FOLD, ACTIONS.THREE_BET], "Mostly fold; occasional blocker 3-bet.", "AQo blocks premiums but performs poorly when called by an early-position range.", { profiles: ["TIGHT"], sizes: ["LARGE"] })
            ],
            "Tightest in-position continue range versus an early opener."
          ),
          EARLY_IP: spec(
            "QQ+, AK",
            "77, 88, 99, TT, JJ, AQs, KQs, QJs, JTs",
            [
              mix("AQo", ACTIONS.FOLD, [ACTIONS.FOLD, ACTIONS.THREE_BET], "Mostly fold; low-frequency 3-bet only with fold equity.", "AQo has blocker value, but flatting dominated offsuit broadways versus early position is a common live leak.", { profiles: ["TIGHT"], sizes: ["LARGE"] }),
              mix("AJs, ATs", ACTIONS.CALL, [ACTIONS.CALL, ACTIONS.THREE_BET], "Call most; 3-bet selectively.", "Suited aces realize equity better than offsuit broadways and can continue in position.")
            ],
            "In-position but still dominated by early opens."
          ),
          EARLY_SB: spec(
            "QQ+, AK, AQs",
            "88, 99, TT, JJ, KQs",
            [
              mix("AJs, AQo, A5s", ACTIONS.FOLD, [ACTIONS.FOLD, ACTIONS.THREE_BET], "Mostly fold; use as occasional 3-bet blockers.", "Small blind is out of position for the rest of the hand, so flat calls need a high bar.")
            ],
            "Small blind avoids dominated flats and mostly 3-bets or folds."
          ),
          EARLY_BB: spec(
            "QQ+, AK",
            "22, 33, 44, 55, 66, 77, 88, 99, TT, JJ, AQs, AJs, ATs, KQs, KJs, QJs, JTs, T9s, 98s",
            [
              mix("AQo, KQo", ACTIONS.FOLD, [ACTIONS.FOLD, ACTIONS.CALL], "Fold by default versus large or tight opens; defend only against smaller opens.", "Big blind gets a price, but offsuit broadways are still dominated by early value.", { profiles: ["TIGHT"], sizes: ["LARGE"] })
            ],
            "Big blind can defend suited and pair-heavy hands, but avoids dominated offsuit calls."
          ),
          MP_IP: spec(
            "JJ+, AK, AQs",
            "66, 77, 88, 99, TT, AJs, ATs, KQs, KJs, QJs, JTs, T9s, 98s, AQo",
            [
              mix("AJo, KQo", ACTIONS.FOLD, [ACTIONS.FOLD, ACTIONS.CALL], "Fold without a clear table edge; call in softer, smaller-open games.", "These offsuit hands look strong but run into domination when middle-position opens continue.", { profiles: ["TIGHT"], sizes: ["LARGE"] }),
              mix("A5s, A4s", ACTIONS.THREE_BET, [ACTIONS.THREE_BET, ACTIONS.FOLD], "3-bet as blocker bluffs when opener folds enough.", "Suited wheel aces block strong continues and retain equity when called.")
            ],
            "Middle-position in-position continue range."
          ),
          MP_BTN: spec(
            "JJ+, AK, AQs, A5s, A4s",
            "55, 66, 77, 88, 99, TT, AJs, ATs, KQs, KJs, QJs, JTs, T9s, 98s, 87s, AQo",
            [
              mix("AJo, KQo", ACTIONS.CALL, [ACTIONS.CALL, ACTIONS.FOLD], "Call against normal opens; fold versus tight/large opens.", "Button position helps realize equity, but these hands are still dominated often enough to avoid autopilot calls.", { profiles: ["TIGHT"], sizes: ["LARGE"] }),
              mix("KTs, QTs", ACTIONS.CALL, [ACTIONS.CALL, ACTIONS.THREE_BET], "Mostly call; mix 3-bets versus over-folding openers.", "Suited broadways play better in position and can apply blocker pressure.")
            ],
            "Button can continue wider against middle-position opens."
          ),
          MP_SB: spec(
            "TT+, AK, AQs, A5s, A4s",
            "77, 88, 99, AJs, KQs",
            [
              mix("AQo, KJs", ACTIONS.THREE_BET, [ACTIONS.THREE_BET, ACTIONS.FOLD], "Prefer 3-bet or fold from the small blind.", "Small blind calls are squeezed by position and rake; blockers matter more than flatting.")
            ],
            "Small blind plays a tighter 3-bet-or-fold style."
          ),
          MP_BB: spec(
            "JJ+, AK, AQs",
            "22, 33, 44, 55, 66, 77, 88, 99, TT, AJs, ATs, A9s, KQs, KJs, KTs, QJs, QTs, JTs, T9s, 98s, 87s, AQo",
            [
              mix("AJo, KQo, QJo", ACTIONS.CALL, [ACTIONS.CALL, ACTIONS.FOLD], "Defend at normal sizes; fold more versus larger opens.", "Big blind price helps, but dominated offsuit hands lose value as size increases.", { profiles: [], sizes: ["LARGE"] })
            ],
            "Big blind defends more because of price, but still respects size."
          ),
          CO_BTN: spec(
            "TT+, AK, AQo, AQs, AJs, KQs, A5s, A4s",
            "22, 33, 44, 55, 66, 77, 88, 99, ATs, A9s, KJs, KTs, QJs, QTs, JTs, T9s, 98s, 87s, AJo, KQo",
            [
              mix("KJo, QJo, J9s, T8s", ACTIONS.CALL, [ACTIONS.CALL, ACTIONS.THREE_BET], "Call most; attack loose cutoff opens.", "Button position lets these hands realize equity against a cutoff range.")
            ],
            "Button versus cutoff is the widest in-position non-blind defense."
          ),
          CO_SB: spec(
            "99+, AK, AQo, AQs, AJs, KQs, A5s, A4s, KJs",
            "66, 77, 88, ATs, KTs, JTs, T9s",
            [
              mix("QJs, QTs, AJo, KQo", ACTIONS.THREE_BET, [ACTIONS.THREE_BET, ACTIONS.FOLD], "Prefer 3-bet or fold from small blind; fold more versus tight or large opens.", "Out of position and rake make flats worse than taking initiative.", { profiles: ["TIGHT"], sizes: ["LARGE"] })
            ],
            "Small blind versus cutoff is aggressive and position-aware."
          ),
          CO_BB: spec(
            "TT+, AK, AQs, AQo, A4s",
            "22, 33, 44, 55, 66, 77, 88, 99, AJs, ATs, A9s, A8s, KQs, KJs, KTs, K9s, QJs, QTs, Q9s, JTs, J9s, T9s, T8s, 98s, 87s, 76s, AJo, KQo, KJo, QJo",
            [
              mix("A7s, A5s, Q8s, J8s, T7s", ACTIONS.CALL, [ACTIONS.CALL, ACTIONS.FOLD], "Defend versus standard sizes; fold versus larger/tighter opens.", "Big blind price allows more suited continues, but weak kickers are still marginal.", { profiles: ["TIGHT"], sizes: ["LARGE"] })
            ],
            "Big blind defends wide versus cutoff, especially suited hands."
          ),
          BTN_SB: spec(
            "88+, ATs+, KQs, AQo+, A5s, A4s, KJs",
            "66, 77, A9s, KTs, JTs, T9s",
            [
              mix("QJs, QTs, AJo, KQo, K9s, Q9s, J9s", ACTIONS.THREE_BET, [ACTIONS.THREE_BET, ACTIONS.FOLD], "3-bet or fold from small blind; fold more versus tight or large opens.", "Small blind has no postflop position and should pressure button opens rather than over-flat.", { profiles: ["TIGHT"], sizes: ["LARGE"] })
            ],
            "Small blind responds aggressively to button opens."
          ),
          BTN_BB: spec(
            "99+, AK, AQs, AQo, AJs, A5s, A4s, KQs",
            "22, 33, 44, 55, 66, 77, 88, ATs, A9s, A8s, A7s, A6s, KJs, KTs, K9s, K8s, K7s, QJs, QTs, Q9s, Q8s, JTs, J9s, J8s, T9s, T8s, 98s, 97s, 87s, 86s, 76s, 65s, AJo, ATo, KQo, KJo, QJo, JTo",
            [
              mix("KTo, QTo, T7s, 75s, 54s", ACTIONS.CALL, [ACTIONS.CALL, ACTIONS.FOLD], "Defend versus normal button opens; fold versus big/tight sizing.", "Big blind gets the best price but should still avoid defending every dominated offsuit hand.", { profiles: ["TIGHT"], sizes: ["LARGE"] })
            ],
            "Big blind defends widest versus button."
          )
        },
        spotTemplates: {
          "UTG>UTG1": "EARLY_NEXT",
          "UTG>MP1": "EARLY_NEXT",
          "UTG>MP2": "EARLY_IP",
          "UTG>MP3": "EARLY_IP",
          "UTG>CO": "EARLY_IP",
          "UTG>BTN": "EARLY_IP",
          "UTG>SB": "EARLY_SB",
          "UTG>BB": "EARLY_BB",
          "UTG1>MP1": "EARLY_NEXT",
          "UTG1>MP2": "EARLY_IP",
          "UTG1>MP3": "EARLY_IP",
          "UTG1>CO": "EARLY_IP",
          "UTG1>BTN": "EARLY_IP",
          "UTG1>SB": "EARLY_SB",
          "UTG1>BB": "EARLY_BB",
          "MP1>MP2": "MP_IP",
          "MP1>MP3": "MP_IP",
          "MP1>CO": "MP_IP",
          "MP1>BTN": "MP_BTN",
          "MP1>SB": "MP_SB",
          "MP1>BB": "MP_BB",
          "MP2>MP3": "MP_IP",
          "MP2>CO": "MP_IP",
          "MP2>BTN": "MP_BTN",
          "MP2>SB": "MP_SB",
          "MP2>BB": "MP_BB",
          "MP3>CO": "MP_IP",
          "MP3>BTN": "MP_BTN",
          "MP3>SB": "MP_SB",
          "MP3>BB": "MP_BB",
          "CO>BTN": "CO_BTN",
          "CO>SB": "CO_SB",
          "CO>BB": "CO_BB",
          "BTN>SB": "BTN_SB",
          "BTN>BB": "BTN_BB"
        },
        overrides: [
          {
            profiles: ["BALANCED", "LOOSE"],
            sizes: ["STANDARD", "LARGE"],
            spots: ["MP3>BTN"],
            hands: "AQo",
            recommendation: {
              primaryAction: ACTIONS.CALL,
              allowedActions: [ACTIONS.CALL, ACTIONS.THREE_BET],
              frequency: "Call most; 3-bet when opener over-folds or callers behind are weak.",
              explanation: "Continue. Button position and the AQ blocker make AQo too strong to pure fold versus a balanced MP3 open. Mix call and 3-bet by table texture and sizing."
            }
          },
          {
            profiles: ["BALANCED", "TIGHT"],
            sizes: ["LARGE"],
            spots: ["UTG>CO", "UTG>BTN", "UTG1>CO", "UTG1>BTN"],
            hands: "AJo",
            recommendation: {
              primaryAction: ACTIONS.FOLD,
              allowedActions: [ACTIONS.FOLD],
              frequency: "",
              explanation: "Mostly fold. Versus early position and large sizing, AJo is dominated by AQ, AK, and suited broadways, and it plays poorly when called."
            }
          }
        ],
        fourBet: {
          DEFAULT: { fourBet: "KK+", mixed: "AKs, AKo, QQ" },
          AGGRO: { fourBet: "KK+, AK", mixed: "QQ, A5s" }
        }
      }
    }
  };

  const ALL_HAND_CLASSES = buildAllHandClasses();
  const HAND_CLASS_SET = new Set(ALL_HAND_CLASSES);
  const PARSE_CACHE = new Map();

  function normalizeProfile(profile) {
    return OPENER_PROFILES.some((item) => item.id === profile) ? profile : DEFAULT_PROFILE;
  }

  function normalizeSize(size) {
    return OPEN_SIZE_CLASSES.some((item) => item.id === size) ? size : DEFAULT_SIZE;
  }

  function normalizePresetId(presetId) {
    return RANGE_PRESETS[presetId] ? presetId : DEFAULT_PRESET_ID;
  }

  function normalizeHand(hand) {
    const clean = String(hand || "").trim().toUpperCase();
    if (clean.length === 2 && clean[0] === clean[1]) {
      return clean;
    }
    if (clean.length === 3) {
      return clean.slice(0, 2) + clean[2].toLowerCase();
    }
    return clean;
  }

  function spotKey(openerPosition, heroPosition) {
    return openerPosition + ">" + heroPosition;
  }

  function getValidHeroPositions(openerPosition) {
    const openerIndex = POSITION_ORDER.indexOf(openerPosition);
    if (openerIndex < 0) {
      return [];
    }
    return POSITION_ORDER.slice(openerIndex + 1);
  }

  function getValidVsOpenSpots() {
    const spots = [];
    VS_OPEN_OPENERS.forEach((openerPosition) => {
      getValidHeroPositions(openerPosition).forEach((heroPosition) => {
        spots.push({
          openerPosition,
          heroPosition,
          key: spotKey(openerPosition, heroPosition)
        });
      });
    });
    return spots;
  }

  function getAssumptionLabel(args) {
    const preset = RANGE_PRESETS[normalizePresetId(args && args.presetId)];
    const profile = profileLabel(args && args.openerProfile);
    const size = sizeLabel(args && args.openSize);
    if (args && args.mode === MODES.RFI) {
      return preset.assumptions + " · " + profile + " RFI style";
    }
    if (args && args.mode === MODES.VS_OPEN) {
      return preset.assumptions + " · " + size + " · " + profile + " opener";
    }
    return preset.assumptions;
  }

  function profileLabel(profile) {
    const id = normalizeProfile(profile);
    return (OPENER_PROFILES.find((item) => item.id === id) || OPENER_PROFILES[1]).label;
  }

  function sizeLabel(size) {
    const id = normalizeSize(size);
    return (OPEN_SIZE_CLASSES.find((item) => item.id === id) || OPEN_SIZE_CLASSES[1]).label;
  }

  function positionLabel(position) {
    return POSITION_LABELS[position] || String(position || "");
  }

  function attachCoach(args, recommendation) {
    return {
      ...recommendation,
      coach: buildCoachNotes(args, recommendation)
    };
  }

  function buildCoachNotes(args, recommendation) {
    const hand = normalizeHand(args.hand || recommendation.hand);
    const traits = classifyHand(hand);
    if (recommendation.mode === MODES.RFI) {
      return buildRfiCoach(args, recommendation, traits);
    }
    if (recommendation.mode === MODES.FOUR_BET) {
      return buildFourBetCoach(recommendation, traits);
    }
    return buildVsOpenCoach(args, recommendation, traits);
  }

  function buildRfiCoach(args, recommendation, traits) {
    const position = positionLabel(args.position);
    const isMixed = recommendation.allowedActions.length > 1;
    let reason;
    if (isMixed) {
      reason = traits.hand + " sits on the " + position + " opening edge: " + describeHandStrength(traits) +
        ". Opening is the default, but folding is also reasonable when the players behind make the spot worse.";
    } else if (recommendation.primaryAction === ACTIONS.OPEN) {
      reason = traits.hand + " clears the " + position + " opening threshold because " + describeHandStrength(traits) + ".";
    } else {
      reason = traits.hand + " stays outside the " + position + " opening range because " + describeRfiLimitation(traits) + ".";
    }

    let adjustment = recommendation.frequency;
    if (!adjustment && ["AA", "KK"].includes(traits.hand) && recommendation.primaryAction === ACTIONS.OPEN) {
      adjustment = "This hand remains an open in every supported range profile.";
    } else if (!adjustment) {
      adjustment = args.position === "SB"
        ? "Tighten the bottom when the big blind defends or 3-bets aggressively."
        : "Tighten the bottom with aggressive players behind; widen only when the table is passive.";
    }

    let takeaway;
    if (["AA", "KK"].includes(traits.hand) && recommendation.primaryAction === ACTIONS.OPEN) {
      takeaway = "Premium pairs open from every position; the close decisions live much lower in the range.";
    } else if (traits.isPair) {
      takeaway = "The pocket-pair opening threshold widens by position: smaller pairs enter as fewer players remain.";
    } else if (args.position === "SB") {
      takeaway = "Small blind is late preflop but out of position after the flop, with the big blind still to act.";
    } else if (POSITION_ORDER.indexOf(args.position) <= POSITION_ORDER.indexOf("MP1")) {
      takeaway = "Early position starts with pairs, strong aces, and strong suited broadways; weak offsuit hands wait.";
    } else {
      takeaway = "As position improves, add suited and connected hands before weak disconnected offsuit hands.";
    }

    return {
      reason: cleanSentence(reason),
      adjustment: cleanSentence(plainAdjustment(adjustment)),
      takeaway: cleanSentence(takeaway),
      actionNotes: buildRfiActionNotes(recommendation, traits, position)
    };
  }

  function buildVsOpenCoach(args, recommendation, traits) {
    const opener = positionLabel(args.openerPosition);
    const hero = positionLabel(args.heroPosition);
    const isBlind = args.heroPosition === "SB" || args.heroPosition === "BB";
    const isMixed = recommendation.allowedActions.length > 1;
    const boundaryLead = isMixed ? "This is a boundary decision. " : "";
    let reason;

    if (recommendation.primaryAction === ACTIONS.THREE_BET) {
      if (traits.isSuitedAce && traits.lowRankIndex >= RANK_INDEX["5"]) {
        reason = boundaryLead + traits.hand + " can 3-bet because the ace blocks some of Villain's strongest continues, while suitedness gives it ways to improve when called.";
      } else if (parseRangeList(THREE_BET_VALUE_CANDIDATES).has(traits.hand)) {
        reason = boundaryLead + traits.hand + " is strong enough to build the pot against the " + opener + " opening range and continue versus resistance.";
      } else {
        reason = boundaryLead + traits.hand + " is strong enough to 3-bet against the " + opener + " opening range; raising is better than making a thin passive call.";
      }
    } else if (recommendation.primaryAction === ACTIONS.CALL) {
      if (traits.isPair) {
        reason = boundaryLead + traits.hand + " keeps solid showdown value as a pocket pair and can flop a set; the price and this exact " + hero + " spot make a call reasonable.";
      } else if (traits.isSuited) {
        reason = boundaryLead + traits.hand + " combines suitedness with enough high-card or connected strength to continue without inflating the pot.";
      } else {
        reason = boundaryLead + traits.hand + " has enough raw high-card strength to continue here, but its offsuit shape makes position and domination important.";
      }
    } else if (args.heroPosition === "SB" && traits.isSuited && traits.isBroadway) {
      const shape = traits.gap === 0
        ? "a strong, connected suited hand"
        : (traits.gap === 1 ? "a strong suited one-gapper" : "a playable suited broadway");
      reason = boundaryLead + traits.hand + " is " + shape +
        ", but from the small blind it realizes equity poorly out of position, live rake punishes a thin flat, it can be dominated by stronger broadways, and the big blind can squeeze or come along.";
    } else {
      reason = boundaryLead + traits.hand + " folds because " + describeHandLimitation(traits) +
        (isBlind ? "; the blind discount does not erase the postflop position problem" : " against the " + opener + " range") + ".";
    }

    const isPurePremiumRaise = recommendation.primaryAction === ACTIONS.THREE_BET &&
      recommendation.allowedActions.length === 1 && parseRangeList(THREE_BET_VALUE_CANDIDATES).has(traits.hand);
    let adjustment = recommendation.frequency;
    if (isPurePremiumRaise) {
      adjustment = "This hand remains a value 3-bet across the supported opener profiles and sizes.";
    } else if (recommendation.primaryAction === ACTIONS.FOLD && args.openerProfile === "TIGHT") {
      adjustment = "The selected tight profile supports folding; reconsider only if the opener proves wider than described.";
    } else if (recommendation.primaryAction === ACTIONS.FOLD && args.openSize === "LARGE") {
      adjustment = "The selected 4.5-6bb size supports folding; a smaller price is the main reason to reconsider.";
    } else if (!adjustment && args.openSize === "LARGE") {
      adjustment = "A 4.5-6bb open makes thin calls less attractive; keep the bottom of the continue range tight.";
    } else if (!adjustment && args.openerProfile === "TIGHT") {
      adjustment = "Against a tight opener, remove thin calls and speculative 3-bets first.";
    } else if (!adjustment && args.openerProfile === "LOOSE" &&
        recommendation.primaryAction === ACTIONS.FOLD && args.heroPosition === "SB" &&
        traits.isSuited && traits.isBroadway) {
      adjustment = "The loose range helps, but this hand still lacks enough blocker or value strength for a small-blind 3-bet; do not turn it into a rake-sensitive call.";
    } else if (!adjustment && args.openerProfile === "LOOSE") {
      adjustment = "Against a loose opener, widen selectively with position, suitedness, and blockers rather than any two cards.";
    } else if (!adjustment && recommendation.primaryAction === ACTIONS.FOLD &&
        args.heroPosition === "SB" && traits.isSuited && traits.isBroadway) {
      const price = args.openSize === "SMALL" ? "At 2-3bb" : "At 3-4bb";
      adjustment = price + ", a genuinely wider opener adds a 3-bet mix; calling remains the least attractive option.";
    } else if (!adjustment) {
      adjustment = "A larger open or tighter opener pushes the weakest continue toward fold; a looser opener moves it the other way.";
    }

    let takeaway;
    if (isPurePremiumRaise) {
      takeaway = "Premium pairs and AK raise for value; do not let a large open turn them passive.";
    } else if (traits.isPair) {
      if (recommendation.primaryAction === ACTIONS.THREE_BET) {
        takeaway = "Strong pocket pairs 3-bet for value; lower pairs usually call or fold based on price and position.";
      } else if (recommendation.primaryAction === ACTIONS.CALL) {
        takeaway = "Pocket pairs often call to keep the pot controlled and retain their chance to flop a set.";
      } else {
        takeaway = "Small pocket pairs need enough price and position; set potential alone does not require a call.";
      }
    } else if (args.heroPosition === "SB") {
      takeaway = "Small blind plays the rest of the hand out of position: prefer a clear 3-bet or disciplined fold over a marginal call.";
    } else if (args.heroPosition === "BB") {
      takeaway = "Big blind gets the best preflop price but still plays out of position after the flop.";
    } else if (args.openerPosition === "UTG" || args.openerPosition === "UTG1") {
      if (traits.isSuited) {
        takeaway = "Suitedness helps against early position, but it does not erase the opener's stronger starting range.";
      } else {
        takeaway = "Versus early position, domination matters more than how strong an offsuit hand looks.";
      }
    } else {
      takeaway = "In position, continue suited and connected hands before domination-prone offsuit hands.";
    }

    return {
      reason: cleanSentence(reason),
      adjustment: cleanSentence(plainAdjustment(adjustment)),
      takeaway: cleanSentence(takeaway),
      actionNotes: buildVsOpenActionNotes(recommendation, traits, args)
    };
  }

  function buildFourBetCoach(recommendation, traits) {
    const reason = recommendation.primaryAction === ACTIONS.FOUR_BET
      ? traits.hand + " is in the value-heavy 4-bet range."
      : traits.hand + " is not a default 4-bet without opponent and sizing context.";
    return {
      reason: cleanSentence(reason),
      adjustment: "Only widen a 4-bet range with a clear read and fully specified positions and sizing.",
      takeaway: "Facing a live 3-bet requires position, size, and a call range; hand class alone is not a full decision.",
      actionNotes: {}
    };
  }

  function buildRfiActionNotes(recommendation, traits, position) {
    return {
      [ACTIONS.OPEN]: recommendation.primaryAction === ACTIONS.OPEN
        ? "Opening matches the selected " + position + " range."
        : "Opening reaches below the selected " + position + " threshold because " + describeRfiLimitation(traits) + ".",
      [ACTIONS.FOLD]: recommendation.primaryAction === ACTIONS.FOLD
        ? "Folding keeps the bottom of the " + position + " range disciplined."
        : (recommendation.allowedActions.includes(ACTIONS.FOLD)
          ? "Folding is a reasonable fallback when aggressive players behind make this boundary hand worse."
          : "Folding gives up a hand that the selected " + position + " range opens by default.")
    };
  }

  function buildVsOpenActionNotes(recommendation, traits, args) {
    const notes = {};
    const allowed = new Set(recommendation.allowedActions);
    notes[ACTIONS.FOLD] = recommendation.primaryAction === ACTIONS.FOLD
      ? "Folding avoids a thin continue with " + traits.hand + " under these assumptions."
      : (allowed.has(ACTIONS.FOLD)
        ? "Folding is a reasonable fallback when the opener or price is worse than the selected baseline."
        : "Folding is more conservative than this range because " + describeHandStrength(traits) + ".");

    if (recommendation.primaryAction === ACTIONS.CALL) {
      notes[ACTIONS.CALL] = "Calling keeps the pot controlled while using this hand's showdown value or playability.";
    } else if (allowed.has(ACTIONS.CALL)) {
      notes[ACTIONS.CALL] = "Calling can work if the opener proves wider or the price is smaller; under the selected assumptions it is not the baseline.";
    } else if (recommendation.primaryAction === ACTIONS.THREE_BET) {
      notes[ACTIONS.CALL] = "Calling gives up the initiative with a hand this range prefers to raise.";
    } else if (args.heroPosition === "SB" && traits.isSuited && traits.isBroadway) {
      notes[ACTIONS.CALL] = "Calling is the least attractive option: it plays every street out of position, lets the big blind squeeze or come along, pays live rake, and can make dominated top pairs.";
    } else {
      notes[ACTIONS.CALL] = "Calling is too thin here because " + describeHandLimitation(traits) + ".";
    }

    if (recommendation.primaryAction === ACTIONS.THREE_BET) {
      notes[ACTIONS.THREE_BET] = "3-betting matches the range's plan to raise this hand for value or pressure.";
    } else if (allowed.has(ACTIONS.THREE_BET)) {
      notes[ACTIONS.THREE_BET] = "3-betting can work when the opener folds too often; under the selected assumptions it is not the baseline.";
    } else if (recommendation.primaryAction === ACTIONS.CALL) {
      notes[ACTIONS.THREE_BET] = "3-betting builds a larger pot with a hand this range prefers to play as a call.";
    } else {
      notes[ACTIONS.THREE_BET] = "3-betting asks for fold pressure or value that this hand and selected opener do not provide by default.";
    }
    return notes;
  }

  function classifyHand(hand) {
    const isPair = hand.length === 2;
    const isSuited = hand.endsWith("s");
    const isOffsuit = hand.endsWith("o");
    const highRank = hand[0] || "";
    const lowRank = hand[1] || "";
    const highRankIndex = RANK_INDEX[highRank];
    const lowRankIndex = RANK_INDEX[lowRank];
    const gap = isPair || highRankIndex === undefined || lowRankIndex === undefined
      ? 0
      : Math.max(0, lowRankIndex - highRankIndex - 1);
    return {
      hand,
      gap,
      highRank,
      highRankIndex,
      isBroadway: !isPair && [highRank, lowRank].every((rank) => ["A", "K", "Q", "J", "T"].includes(rank)),
      isOffsuit,
      isPair,
      isSuited,
      isSuitedAce: isSuited && highRank === "A",
      lowRank,
      lowRankIndex
    };
  }

  function describeHandStrength(traits) {
    if (traits.isPair) {
      return "it is a pocket pair with solid raw equity and set potential";
    }
    if (traits.isSuitedAce) {
      return "it combines an ace blocker with suited playability";
    }
    if (traits.isSuited && traits.isBroadway) {
      return "it has two strong cards, suitedness, and good postflop playability";
    }
    if (traits.isSuited && traits.gap <= 1) {
      return traits.gap === 0
        ? "its suited, connected shape can make straights, flushes, and strong draws"
        : "its suited one-gap shape can make straights, flushes, and strong draws";
    }
    if (traits.isBroadway) {
      return "its high-card strength is useful even though it is offsuit";
    }
    if (traits.highRank === "A") {
      return "the ace supplies high-card strength and blocker value";
    }
    if (traits.isSuited) {
      return "suitedness gives it more ways to improve after the flop";
    }
    return "its cards have enough rank and connection for this range";
  }

  function describeHandLimitation(traits) {
    if (traits.isPair) {
      return "set potential alone does not overcome the price and position";
    }
    if (traits.isBroadway && traits.isOffsuit) {
      return "it is offsuit and often dominated by stronger broadways";
    }
    if (traits.isSuitedAce) {
      return "its ace blocker and suitedness are not enough without a profitable raise or call";
    }
    if (traits.isSuited && traits.isBroadway && traits.gap <= 1) {
      return "it has real rank and connection, but domination and poor realization make continuing too thin in this spot";
    }
    if (traits.isSuited && traits.isBroadway) {
      return "it is a playable suited broadway, but domination and poor realization make continuing too thin in this spot";
    }
    if (traits.isSuited && traits.gap <= 1) {
      return "its suited connection has playability, but not enough rank or realization for this continue";
    }
    if (traits.isSuited) {
      return "suitedness alone does not make up for weak rank and limited connection";
    }
    if (traits.highRank === "A") {
      return "the weak kicker and offsuit shape create domination problems";
    }
    if (traits.isOffsuit && traits.gap <= 1) {
      return "its connection is real, but the offsuit shape and limited high-card strength make continuing too thin";
    }
    return "it lacks suitedness, high-card strength, and useful connection";
  }

  function describeRfiLimitation(traits) {
    if (traits.isPair) {
      return "this pocket pair is below the selected first-in threshold from this position";
    }
    if (traits.isSuited && traits.isBroadway) {
      return "this playable suited broadway is below the selected first-in threshold from this position";
    }
    if (traits.isSuited && traits.gap <= 1) {
      return "its suited connection does not clear the selected first-in threshold from this position";
    }
    return describeHandLimitation(traits);
  }

  function cleanSentence(text) {
    const value = String(text || "").trim().replace(/[.\s]+$/, "");
    return value ? value + "." : "";
  }

  function plainAdjustment(text) {
    return String(text || "")
      .replace(/low-frequency/gi, "occasional")
      .replace(/with fold equity/gi, "when the opener is likely to fold")
      .replace(/over-folding/gi, "folding too often")
      .replace(/over-folds/gi, "folds too often")
      .replace(/3-bet heavy/gi, "likely to re-raise")
      .replace(/clear table edge/gi, "clear postflop advantage");
  }

  function recommend(args) {
    const mode = args && args.mode ? args.mode : MODES.RFI;
    let recommendation;
    if (mode === MODES.RFI) {
      recommendation = recommendRfi(args);
    } else if (mode === MODES.FOUR_BET) {
      recommendation = recommendFourBet(args);
    } else {
      recommendation = recommendVsOpen(args);
    }
    return attachCoach(args || {}, recommendation);
  }

  function getChartCellRecommendation(args) {
    return recommend(args);
  }

  function recommendRfi(args) {
    const preset = RANGE_PRESETS[normalizePresetId(args && args.presetId)];
    const profile = normalizeProfile(args && args.openerProfile);
    const position = args && args.position;
    const hand = normalizeHand(args && args.hand);
    const row = preset.rfi[profile][position] || preset.rfi[DEFAULT_PROFILE].UTG;
    const openSet = parseRangeList(row.open);
    const mixedSet = parseRangeList(row.mixed);

    if (mixedSet.has(hand)) {
      return makeRecommendation({
        mode: MODES.RFI,
        hand,
        primaryAction: ACTIONS.OPEN,
        allowedActions: [ACTIONS.OPEN, ACTIONS.FOLD],
        frequency: "Open more often at passive tables; fold more often with aggressive players behind.",
        explanation: hand + " is near the " + positionLabel(position) + " opening boundary, so the players behind can move the decision.",
        contextLabel: "RFI " + positionLabel(position),
        rangeLabel: row.open + " | mixed: " + row.mixed
      });
    }

    if (openSet.has(hand)) {
      return makeRecommendation({
        mode: MODES.RFI,
        hand,
        primaryAction: ACTIONS.OPEN,
        allowedActions: [ACTIONS.OPEN],
        explanation: "Open. " + hand + " is inside the live $1/$3 " + profileLabel(profile).toLowerCase() + " " + positionLabel(position) + " opening range.",
        contextLabel: "RFI " + positionLabel(position),
        rangeLabel: row.open
      });
    }

    return makeRecommendation({
      mode: MODES.RFI,
      hand,
      primaryAction: ACTIONS.FOLD,
      allowedActions: [ACTIONS.FOLD],
      explanation: "Fold. " + hand + " is outside the " + positionLabel(position) + " live $1/$3 opening range under the selected assumptions.",
      contextLabel: "RFI " + positionLabel(position),
      rangeLabel: row.open + (row.mixed ? " | mixed: " + row.mixed : "")
    });
  }

  function recommendVsOpen(args) {
    const preset = RANGE_PRESETS[normalizePresetId(args && args.presetId)];
    const profile = normalizeProfile(args && args.openerProfile);
    const size = normalizeSize(args && args.openSize);
    const openerPosition = args && args.openerPosition;
    const heroPosition = args && args.heroPosition;
    const hand = normalizeHand(args && args.hand);
    const key = spotKey(openerPosition, heroPosition);
    const templateId = preset.vsOpen.spotTemplates[key];
    const template = templateId ? preset.vsOpen.templates[templateId] : null;

    if (!template || !HAND_CLASS_SET.has(hand)) {
      return makeRecommendation({
        mode: MODES.VS_OPEN,
        hand,
        primaryAction: ACTIONS.FOLD,
        allowedActions: [ACTIONS.FOLD],
        explanation: "Fold. This is not a supported live $1/$3 facing-open spot in the trainer.",
        contextLabel: positionLabel(openerPosition) + " opens, Hero " + positionLabel(heroPosition),
        rangeLabel: "Unsupported spot"
      });
    }

    const override = findOverride(preset, profile, size, key, hand);
    if (override) {
      return makeRecommendation({
        mode: MODES.VS_OPEN,
        hand,
        primaryAction: override.primaryAction,
        allowedActions: override.allowedActions,
        frequency: override.frequency,
        explanation: override.explanation,
        contextLabel: positionLabel(openerPosition) + " opens, Hero " + positionLabel(heroPosition),
        rangeLabel: buildTemplateRangeLabel(template)
      });
    }

    let rec = baseVsOpenRecommendation(template, hand, openerPosition, heroPosition);
    rec = applyProfileAndSizeAdjustments(rec, {
      profile,
      size,
      openerPosition,
      heroPosition,
      hand
    });
    rec.contextLabel = positionLabel(openerPosition) + " opens, Hero " + positionLabel(heroPosition);
    rec.rangeLabel = buildTemplateRangeLabel(template);
    return rec;
  }

  function recommendFourBet(args) {
    const preset = RANGE_PRESETS[normalizePresetId(args && args.presetId)];
    const hand = normalizeHand(args && args.hand);
    const mode = (args && args.fourBetStyle) === "AGGRO" ? "AGGRO" : "DEFAULT";
    const row = preset.vsOpen.fourBet[mode];
    const fourBetSet = parseRangeList(row.fourBet);
    const mixedSet = parseRangeList(row.mixed);

    if (fourBetSet.has(hand)) {
      return makeRecommendation({
        mode: MODES.FOUR_BET,
        hand,
        primaryAction: ACTIONS.FOUR_BET,
        allowedActions: [ACTIONS.FOUR_BET],
        explanation: "4-bet for value. This default live $1/$3 range keeps stacks from going in too light.",
        contextLabel: "4-bet " + mode.toLowerCase(),
        rangeLabel: row.fourBet
      });
    }

    if (mixedSet.has(hand)) {
      return makeRecommendation({
        mode: MODES.FOUR_BET,
        hand,
        primaryAction: ACTIONS.FOLD,
        allowedActions: [ACTIONS.FOLD, ACTIONS.FOUR_BET],
        frequency: "Mostly fold; 4-bet only with a clear read.",
        explanation: "Mixed 4-bet candidate. Use blockers and opponent fold tendencies; do not stack off automatically.",
        contextLabel: "4-bet " + mode.toLowerCase(),
        rangeLabel: row.fourBet + " | mixed: " + row.mixed
      });
    }

    return makeRecommendation({
      mode: MODES.FOUR_BET,
      hand,
      primaryAction: ACTIONS.FOLD,
      allowedActions: [ACTIONS.FOLD],
      explanation: "Fold. Default live $1/$3 4-bets should stay value-heavy unless you have a clear exploit.",
      contextLabel: "4-bet " + mode.toLowerCase(),
      rangeLabel: row.fourBet
    });
  }

  function findOverride(preset, profile, size, key, hand) {
    for (const override of preset.vsOpen.overrides) {
      if (!override.profiles.includes(profile) || !override.sizes.includes(size) || !override.spots.includes(key)) {
        continue;
      }
      if (parseRangeList(override.hands).has(hand)) {
        return override.recommendation;
      }
    }
    return null;
  }

  function baseVsOpenRecommendation(template, hand, openerPosition, heroPosition) {
    const threeBetSet = parseRangeList(template.threeBet);
    const callSet = parseRangeList(template.call);

    for (const rule of template.mixed) {
      if (parseRangeList(rule.hands).has(hand)) {
        return makeRecommendation({
          mode: MODES.VS_OPEN,
          hand,
          primaryAction: rule.primaryAction,
          allowedActions: rule.allowedActions,
          frequency: rule.frequency,
          explanation: rule.explanation + " " + TEXT.size,
          defaultFoldWhen: rule.defaultFoldWhen,
          contextLabel: positionLabel(openerPosition) + " opens, Hero " + positionLabel(heroPosition),
          rangeLabel: buildTemplateRangeLabel(template)
        });
      }
    }

    if (threeBetSet.has(hand)) {
      const isBluff = parseRangeList(THREE_BET_BLUFF_CANDIDATES).has(hand);
      const isClearValue = parseRangeList(THREE_BET_VALUE_CANDIDATES).has(hand);
      return makeRecommendation({
        mode: MODES.VS_OPEN,
        hand,
        primaryAction: ACTIONS.THREE_BET,
        allowedActions: [ACTIONS.THREE_BET],
        actionTag: isBluff ? "blocker bluff" : (isClearValue ? "value" : ""),
        explanation: isBluff
          ? "3-bet as a blocker bluff. The ace removes some premium combinations and suitedness provides a fallback when called."
          : (isClearValue
            ? "3-bet for value. This hand is strong enough to raise against the selected opener and hero position."
            : "3-bet for strength and initiative. Raising is better than making a thin passive call in this spot."),
        contextLabel: positionLabel(openerPosition) + " opens, Hero " + positionLabel(heroPosition),
        rangeLabel: buildTemplateRangeLabel(template)
      });
    }

    if (callSet.has(hand)) {
      return makeRecommendation({
        mode: MODES.VS_OPEN,
        hand,
        primaryAction: ACTIONS.CALL,
        allowedActions: [ACTIONS.CALL],
        explanation: "Call. " + hand + " has enough strength and playability for this exact " + positionLabel(heroPosition) + " spot.",
        contextLabel: positionLabel(openerPosition) + " opens, Hero " + positionLabel(heroPosition),
        rangeLabel: buildTemplateRangeLabel(template)
      });
    }

    return makeRecommendation({
      mode: MODES.VS_OPEN,
      hand,
      primaryAction: ACTIONS.FOLD,
      allowedActions: [ACTIONS.FOLD],
      explanation: "Fold. " + hand + " is outside the continue range for this opener, hero position, profile, and sizing because " + describeHandLimitation(classifyHand(hand)) + ".",
      contextLabel: positionLabel(openerPosition) + " opens, Hero " + positionLabel(heroPosition),
      rangeLabel: buildTemplateRangeLabel(template)
    });
  }

  function applyProfileAndSizeAdjustments(rec, context) {
    const { profile, size, openerPosition, heroPosition, hand } = context;
    const isInPosition = POSITION_ORDER.indexOf(heroPosition) < POSITION_ORDER.indexOf("SB");
    const isEarlyOpen = openerPosition === "UTG" || openerPosition === "UTG1";
    const isLateOpen = openerPosition === "CO" || openerPosition === "BTN";
    const defaultFoldWhen = rec.defaultFoldWhen || { profiles: [], sizes: [] };
    const selectedConditionFavorsFold = rec.allowedActions.includes(ACTIONS.FOLD) &&
      rec.allowedActions.some((action) => action !== ACTIONS.FOLD) &&
      ((defaultFoldWhen.profiles || []).includes(profile) ||
        (defaultFoldWhen.sizes || []).includes(size));

    if (selectedConditionFavorsFold) {
      return makeRecommendation({
        ...rec,
        primaryAction: ACTIONS.FOLD,
        allowedActions: [ACTIONS.FOLD],
        frequency: "",
        explanation: "The selected opener profile or size moves this boundary hand to a fold."
      });
    }

    if (profile === "TIGHT" && rec.primaryAction === ACTIONS.CALL && parseRangeList("AQo, AJo, KQo, KJo, QJo, ATo, KTs, QTs, JTs, T9s, 98s, 22, 33, 44, 55, 66").has(hand)) {
      return makeRecommendation({
        ...rec,
        primaryAction: ACTIONS.FOLD,
        allowedActions: [ACTIONS.FOLD],
        frequency: "",
        explanation: "Fold versus a tight opener. " + describeHandLimitation(classifyHand(hand)) + "; the normal call is too thin against this range."
      });
    }

    if (size === "LARGE" && rec.primaryAction === ACTIONS.CALL && parseRangeList("AJo, KQo, KJo, QJo, ATo, KTo, QTo, JTo, KTs, QTs, JTs, T9s, 98s, 22, 33, 44, 55").has(hand)) {
      return makeRecommendation({
        ...rec,
        primaryAction: ACTIONS.FOLD,
        allowedActions: [ACTIONS.FOLD],
        frequency: "",
        explanation: "Fold versus the large open. " + TEXT.size + " This hand is too dominated or too hard to realize at 4.5-6bb."
      });
    }

    if (size === "SMALL" && rec.primaryAction === ACTIONS.FOLD && isInPosition && !isEarlyOpen && parseRangeList("AJo, KQo, KJo, QJo, ATo, KTs, QTs, JTs, T9s, 98s, 87s, 66, 55").has(hand)) {
      const smallOpenAction = profile === "TIGHT" ? ACTIONS.FOLD : ACTIONS.CALL;
      return makeRecommendation({
        ...rec,
        primaryAction: smallOpenAction,
        allowedActions: smallOpenAction === ACTIONS.FOLD
          ? [ACTIONS.FOLD]
          : [ACTIONS.CALL, ACTIONS.FOLD],
        frequency: profile === "TIGHT" ? "" : "Call versus small opens when the table is not 3-bet heavy.",
        explanation: profile === "TIGHT"
          ? "The small price helps, but the selected tight opener keeps this as a default fold."
          : "Small sizing improves price and realization in position. This is a close call, not an automatic continue."
      });
    }

    if (profile === "LOOSE" && size !== "LARGE" && rec.primaryAction === ACTIONS.FOLD && !isEarlyOpen && parseRangeList("AQo, AJo, KQo, KJo, QJo, ATo, KTs, QJs, QTs, JTs, T9s, 98s, A5s, A4s, 66, 55").has(hand)) {
      if (heroPosition === "SB" && hand !== "QJs") {
        return rec;
      }
      const action = heroPosition === "SB" || isLateOpen ? ACTIONS.THREE_BET : ACTIONS.CALL;
      return makeRecommendation({
        ...rec,
        primaryAction: action,
        allowedActions: action === ACTIONS.THREE_BET ? [ACTIONS.THREE_BET, ACTIONS.FOLD] : [ACTIONS.CALL, ACTIONS.FOLD],
        frequency: action === ACTIONS.THREE_BET ? "Attack loose opens selectively." : "Continue versus loose opens; fold if sizing is large.",
        explanation: "Loose opener adjustment. The opener reaches this spot with more weak hands, so blockers and position gain value."
      });
    }

    return rec;
  }

  function makeRecommendation(input) {
    const allowed = uniqueActions(input.allowedActions && input.allowedActions.length ? input.allowedActions : [input.primaryAction]);
    return {
      mode: input.mode,
      hand: input.hand,
      primaryAction: input.primaryAction,
      allowedActions: allowed,
      frequency: input.frequency || "",
      explanation: input.explanation || "",
      defaultFoldWhen: input.defaultFoldWhen || { profiles: [], sizes: [] },
      actionTag: input.actionTag || "",
      contextLabel: input.contextLabel || "",
      rangeLabel: input.rangeLabel || ""
    };
  }

  function uniqueActions(actions) {
    const out = [];
    actions.forEach((action) => {
      if (action && !out.includes(action)) {
        out.push(action);
      }
    });
    return out;
  }

  function buildTemplateRangeLabel(template) {
    const mixed = template.mixed.map((rule) => rule.hands + " -> " + displayAction(rule.primaryAction)).join("; ");
    return "3-bet: " + (template.threeBet || "none") + " | call: " + (template.call || "none") + (mixed ? " | mixed: " + mixed : "");
  }

  function gradeRecommendation(recommendation, chosenAction) {
    const chosen = chosenAction === "3-BET" ? ACTIONS.THREE_BET : chosenAction;
    const primary = recommendation.primaryAction;
    const allowed = recommendation.allowedActions || [primary];

    if (chosen === primary) {
      return {
        label: "Good default",
        detail: "You chose the baseline action for these assumptions.",
        isPreferred: true,
        isAcceptable: true,
        isPassing: true,
        severity: "correct"
      };
    }

    if (allowed.includes(chosen)) {
      return {
        label: "Reasonable alternative",
        detail: displayAction(chosen) + " can work, but remember " + displayAction(primary) + " as the default.",
        isPreferred: false,
        isAcceptable: true,
        isPassing: true,
        severity: "acceptable"
      };
    }

    if (chosen === ACTIONS.FOLD && primary !== ACTIONS.FOLD) {
      return {
        label: "Too tight",
        detail: "The selected range continues this hand; folding is outside the default.",
        isPreferred: false,
        isAcceptable: false,
        isPassing: false,
        severity: "bad"
      };
    }

    if (chosen !== ACTIONS.FOLD && primary === ACTIONS.FOLD) {
      return {
        label: "Too loose",
        detail: "Fold is preferred; this continue is too thin for the selected spot.",
        isPreferred: false,
        isAcceptable: false,
        isPassing: false,
        severity: "bad"
      };
    }

    return {
      label: "Wrong",
      detail: displayAction(primary) + " is preferred.",
      isPreferred: false,
      isAcceptable: false,
      isPassing: false,
      severity: "bad"
    };
  }

  function gradeThreeBetDecision(recommendation, wantsThreeBet) {
    if (wantsThreeBet) {
      return gradeRecommendation(recommendation, ACTIONS.THREE_BET);
    }

    if (recommendation.primaryAction === ACTIONS.THREE_BET && !recommendation.allowedActions.some((action) => action !== ACTIONS.THREE_BET)) {
      return {
        label: "Too tight",
        detail: "3-bet is preferred; passing misses value or blocker pressure.",
        isPassing: false,
        severity: "bad"
      };
    }

    if (recommendation.primaryAction === ACTIONS.THREE_BET) {
      return {
        label: "Acceptable, but 3-bet preferred",
        detail: "Passing is reasonable because this is mixed, but 3-bet is the default.",
        isPassing: true,
        severity: "acceptable"
      };
    }

    return {
      label: "Correct",
      detail: "Do not 3-bet this hand by default.",
      isPassing: true,
      severity: "correct"
    };
  }

  function displayAction(action) {
    return ACTION_LABELS[action] || action || "";
  }

  function classifyForChart(recommendation) {
    if (!recommendation || !recommendation.primaryAction) {
      return "fold";
    }
    if ((recommendation.allowedActions || []).length > 1) {
      return "mixed";
    }
    if (recommendation.primaryAction === ACTIONS.OPEN) {
      return "open";
    }
    if (recommendation.primaryAction === ACTIONS.CALL) {
      return "call";
    }
    if (recommendation.primaryAction === ACTIONS.THREE_BET) {
      return "three-bet";
    }
    if (recommendation.primaryAction === ACTIONS.FOUR_BET) {
      return "four-bet";
    }
    return "fold";
  }

  function getRecommendationGroups(args) {
    const groups = {
      preferred: [],
      mixed: [],
      other: []
    };
    ALL_HAND_CLASSES.forEach((hand) => {
      const rec = recommend({ ...args, hand });
      if (rec.allowedActions.length > 1) {
        groups.mixed.push(hand);
      } else if (rec.primaryAction === ACTIONS.FOLD) {
        groups.other.push(hand);
      } else {
        groups.preferred.push(hand);
      }
    });
    return groups;
  }

  function validatePureActionRanges() {
    const errors = [];
    const preset = RANGE_PRESETS[DEFAULT_PRESET_ID];
    const validProfiles = new Set(OPENER_PROFILES.map((profile) => profile.id));
    const validSizes = new Set(OPEN_SIZE_CLASSES.map((size) => size.id));
    Object.entries(preset.rfi).forEach(([profile, positions]) => {
      Object.entries(positions).forEach(([position, row]) => {
        const open = parseRangeList(row.open);
        const mixed = parseRangeList(row.mixed);
        open.forEach((hand) => {
          if (mixed.has(hand)) {
            errors.push(profile + " " + position + " has " + hand + " in both pure open and mixed ranges");
          }
        });
      });
    });

    Object.entries(preset.vsOpen.spotTemplates).forEach(([key, templateId]) => {
      const template = preset.vsOpen.templates[templateId];
      const groups = [
        { label: "pure 3-bet", hands: parseRangeList(template.threeBet) },
        { label: "pure call", hands: parseRangeList(template.call) },
        ...template.mixed.map((rule, index) => ({
          label: "mixed rule " + (index + 1),
          hands: parseRangeList(rule.hands)
        }))
      ];

      for (let first = 0; first < groups.length; first += 1) {
        for (let second = first + 1; second < groups.length; second += 1) {
          groups[first].hands.forEach((hand) => {
            if (groups[second].hands.has(hand)) {
              errors.push(key + " has " + hand + " in both " + groups[first].label + " and " + groups[second].label);
            }
          });
        }
      }
    });

    Object.entries(preset.vsOpen.templates).forEach(([templateId, template]) => {
      template.mixed.forEach((rule, index) => {
        const foldWhen = rule.defaultFoldWhen || {};
        const profiles = Array.isArray(foldWhen.profiles) ? foldWhen.profiles : [];
        const sizes = Array.isArray(foldWhen.sizes) ? foldWhen.sizes : [];
        profiles.forEach((profile) => {
          if (!validProfiles.has(profile)) {
            errors.push(templateId + " mixed rule " + (index + 1) + " has unknown fold profile " + profile);
          }
        });
        sizes.forEach((size) => {
          if (!validSizes.has(size)) {
            errors.push(templateId + " mixed rule " + (index + 1) + " has unknown fold size " + size);
          }
        });
        if ((profiles.length || sizes.length) &&
            (!rule.allowedActions.includes(ACTIONS.FOLD) || !rule.allowedActions.some((action) => action !== ACTIONS.FOLD))) {
          errors.push(templateId + " mixed rule " + (index + 1) + " has unusable defaultFoldWhen metadata");
        }
      });
    });

    Object.entries(preset.vsOpen.fourBet).forEach(([style, row]) => {
      const pure = parseRangeList(row.fourBet);
      const mixed = parseRangeList(row.mixed);
      pure.forEach((hand) => {
        if (mixed.has(hand)) {
          errors.push(style + " 4-bet has " + hand + " in both pure and mixed ranges");
        }
      });
    });
    return errors;
  }

  function parseRangeList(text) {
    const source = Array.isArray(text) ? text.join(",") : String(text || "");
    if (PARSE_CACHE.has(source)) {
      return new Set(PARSE_CACHE.get(source));
    }

    const handSet = new Set();
    source
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
      .forEach((token) => {
        expandToken(token).forEach((handClass) => handSet.add(handClass));
      });

    const out = Array.from(handSet);
    PARSE_CACHE.set(source, out);
    return new Set(out);
  }

  function expandToken(token) {
    const clean = token.trim().toUpperCase();
    if (clean.includes("-")) {
      return expandDashToken(clean);
    }

    const match = clean.match(/^([AKQJT2-9])([AKQJT2-9])([SO])?(\+)?$/);
    if (!match) {
      throw new Error("Invalid range token: " + token);
    }

    const r1 = match[1];
    const r2 = match[2];
    const suitedness = match[3] ? match[3].toLowerCase() : "";
    const plus = Boolean(match[4]);
    const i1 = RANK_INDEX[r1];
    const i2 = RANK_INDEX[r2];
    const out = [];

    if (r1 === r2) {
      if (suitedness) {
        throw new Error("Pairs cannot include s/o suffix: " + token);
      }
      if (plus) {
        for (let i = i1; i >= 0; i -= 1) {
          out.push(RANKS[i] + RANKS[i]);
        }
      } else {
        out.push(r1 + r2);
      }
      return out;
    }

    if (i1 >= i2) {
      throw new Error("Token must be ordered high-to-low: " + token);
    }

    const pushCombo = (secondRank) => {
      if (suitedness === "s" || suitedness === "o") {
        out.push(r1 + secondRank + suitedness);
      } else {
        out.push(r1 + secondRank + "s");
        out.push(r1 + secondRank + "o");
      }
    };

    if (plus) {
      for (let i = i2; i > i1; i -= 1) {
        pushCombo(RANKS[i]);
      }
    } else {
      pushCombo(r2);
    }

    return out;
  }

  function expandDashToken(token) {
    const [start, end] = token.split("-").map((part) => part.trim());
    const startMatch = start.match(/^([AKQJT2-9])([AKQJT2-9])([SO])?$/);
    const endMatch = end.match(/^([AKQJT2-9])([AKQJT2-9])([SO])?$/);
    if (!startMatch || !endMatch) {
      throw new Error("Invalid range dash token: " + token);
    }

    if (startMatch[1] === startMatch[2] && endMatch[1] === endMatch[2]) {
      const startIndex = RANK_INDEX[startMatch[1]];
      const endIndex = RANK_INDEX[endMatch[1]];
      const low = Math.max(startIndex, endIndex);
      const high = Math.min(startIndex, endIndex);
      const out = [];
      for (let i = low; i >= high; i -= 1) {
        out.push(RANKS[i] + RANKS[i]);
      }
      return out;
    }

    if (startMatch[1] === endMatch[1] && startMatch[3] === endMatch[3]) {
      const highCard = startMatch[1];
      const suitedness = startMatch[3] ? startMatch[3].toLowerCase() : "";
      const startIndex = RANK_INDEX[startMatch[2]];
      const endIndex = RANK_INDEX[endMatch[2]];
      const low = Math.max(startIndex, endIndex);
      const high = Math.min(startIndex, endIndex);
      const out = [];
      for (let i = low; i >= high; i -= 1) {
        if (RANKS[i] !== highCard) {
          out.push(highCard + RANKS[i] + suitedness);
        }
      }
      return out;
    }

    throw new Error("Unsupported range dash token: " + token);
  }

  function buildAllHandClasses() {
    const out = [];
    for (let i = 0; i < RANKS.length; i += 1) {
      out.push(RANKS[i] + RANKS[i]);
      for (let j = i + 1; j < RANKS.length; j += 1) {
        out.push(RANKS[i] + RANKS[j] + "s");
        out.push(RANKS[i] + RANKS[j] + "o");
      }
    }
    return out;
  }

  return {
    ACTIONS,
    ACTION_LABELS,
    ALL_HAND_CLASSES,
    DEFAULT_PRESET_ID,
    MODES,
    OPEN_SIZE_CLASSES,
    OPENER_PROFILES,
    POSITION_LABELS,
    POSITION_ORDER,
    RANGE_PRESETS,
    RFI_POSITIONS,
    VS_OPEN_OPENERS,
    classifyForChart,
    displayAction,
    getAssumptionLabel,
    getChartCellRecommendation,
    getRecommendationGroups,
    getValidHeroPositions,
    getValidVsOpenSpots,
    gradeRecommendation,
    gradeThreeBetDecision,
    normalizeHand,
    parseRangeList,
    positionLabel,
    profileLabel,
    recommend,
    sizeLabel,
    spotKey,
    validatePureActionRanges
  };
});
