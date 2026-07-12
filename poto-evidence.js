(function initPotoEvidence(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.PotoEvidence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildPotoEvidence() {
  "use strict";

  const EVIDENCE_VERSION = "poto-room-evidence-2026-07-12";

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  const SOURCES = deepFreeze({
    potoPoker: {
      label: "Potawatomi poker room",
      url: "https://www.potawatomi.com/casino/poker",
      kind: "official"
    },
    potoHouseRules: {
      label: "Potawatomi poker house rules",
      url: "https://www.potawatomi.com/casino/house-rules",
      kind: "official"
    },
    potoBadBeat: {
      label: "Potawatomi Bad Beat Jackpot",
      url: "https://www.potawatomi.com/casino/poker/bad-beat-jackpot",
      kind: "official"
    },
    pokerAtlas: {
      label: "PokerAtlas Potawatomi $1/$3 listing",
      url: "https://www.pokeratlas.com/poker-cash-game/potawatomi-casino-milwaukee-no-limit-holdem-1-3",
      kind: "third-party"
    }
  });

  const ROOM_PROFILE = deepFreeze({
    evidenceVersion: EVIDENCE_VERSION,
    venue: "Potawatomi Casino Hotel Milwaukee",
    game: "No-limit hold'em cash",
    stakes: { smallBlindUsd: 1, bigBlindUsd: 3 },
    asOf: "2026-07-12",
    facts: {
      tableSize: {
        value: 9,
        status: "user-reported-and-third-party-listed",
        sourceIds: ["pokerAtlas"]
      },
      rake: {
        percentage: 0.10,
        capUsd: 6,
        status: "user-recalled-and-third-party-listed-desk-verification-pending",
        sourceIds: ["pokerAtlas"],
        caveats: [
          "Potawatomi does not publish the base-rake schedule on its public poker pages.",
          "Exact increments, rounding, and no-flop-no-drop treatment remain unverified."
        ]
      },
      promotionalDrop: {
        officialFirstDollarThresholdUsd: 15,
        thirdPartyListing: [
          { potAtLeastUsd: 15, listingText: "$1 on $15+" },
          { potAtLeastUsd: 30, listingText: "$2 on $30+" }
        ],
        status: "current-amount-uncertain",
        sourceIds: ["potoPoker", "potoHouseRules", "potoBadBeat", "pokerAtlas"],
        caveat: "Official rules describe the first promotional dollar, while the official poker page lists no current promotions and the Bad Beat page says that jackpot is suspended. PokerAtlas's $2 wording is not assumed to mean either total or additional collection in the app. Verify the current drop at the desk."
      },
      buyIn: {
        minUsd: 100,
        maxUsd: 500,
        minBbRounded: 33,
        maxBbRounded: 167,
        status: "third-party-listed",
        sourceIds: ["pokerAtlas"]
      },
      straddle: {
        permittedPosition: "UTG",
        status: "third-party-listed-details-unverified",
        sourceIds: ["pokerAtlas"],
        caveat: "Amount, frequency, optional status, and restraddle rules are not verified."
      }
    }
  });

  const TRAINING_PRIORS = deepFreeze({
    evidenceVersion: EVIDENCE_VERSION,
    decisionModeMix: [
      { id: "RFI", label: "First in", weight: 0.35 },
      { id: "VS_OPEN", label: "Facing open", weight: 0.65 }
    ],
    status: "curriculum-prior",
    disclosure: "The 35/65 split emphasizes harder facing-open decisions. It is not an observed Potawatomi opportunity frequency."
  });

  function getRoomEvidenceSummary() {
    return "You report 9-handed, and PokerAtlas also lists 9 players. Your 10% rake capped at $6 recollection matches its current listing; desk verification is still pending.";
  }

  return deepFreeze({
    EVIDENCE_VERSION,
    ROOM_PROFILE,
    SOURCES,
    TRAINING_PRIORS,
    getRoomEvidenceSummary
  });
});
