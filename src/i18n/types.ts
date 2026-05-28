/**
 * LocaleStrings — The single source of truth for every translatable key.
 * Every locale file must implement this interface in full.
 * TypeScript will catch any missing keys at compile time.
 */
export interface LocaleStrings {
  // ── Gemini System Prompt ──────────────────────────────────────────────
  systemPrompt: string; // Full system prompt for this locale (includes confidence threshold placeholder %s)

  // ── Config Dashboard ──────────────────────────────────────────────────
  configCommandDesc: string;
  configTitle: string;
  configFooter: string;  // %s = version
  configFieldLogChannel: string;
  configFieldScanImages: string;
  configFieldScanLinks: string;
  configFieldScamProbabilityThreshold: string;
  configFieldSingleInfraction: string;
  configFieldSpambotPunishment: string;
  configFieldSpambotThreshold: string;
  configFieldExcludedChannels: string;
  configFieldExcludedRoles: string;
  configFieldExcludedUrls: string;
  configFieldLanguage: string;
  configFieldScanMemberAgeThreshold: string;
  configValueNotSet: string;
  configValueEnabled: string;
  configValueDisabled: string;
  configValueNone: string;
  configValueInfractions: string; // "⚠️ %s Infractions"
  configValueSpambotThresholdDisabled: string;
  // Category descriptions
  configDescGeneral: string;
  configDescPunishments: string;
  configDescExclusions: string;
  configDescTargeting: string;
  configDescReset: string;
  // Buttons
  configBtnGeneral: string;
  configBtnPunishments: string;
  configBtnExclusions: string;
  configBtnEditUrls: string;
  configBtnTargeting: string;
  configBtnResetAll: string;
  configBtnBack: string;
  configBtnClearLogChannel: string;
  configBtnScanImagesOn: string;
  configBtnScanImagesOff: string;
  configBtnScanLinksOn: string;
  configBtnScanLinksOff: string;
  configBtnThreshold: string;          // "Threshold: %s%"
  configBtnSpamThreshold: string;      // "Spam Threshold: %s Infractions"
  configBtnSpamThresholdOff: string;   // "Spam Threshold: Disabled"
  configBtnConfirmReset: string;
  configBtnCancelReset: string;
  // Select menu placeholders
  configSelectLogChannel: string;
  configSelectSinglePunishment: string;
  configSelectSpambotPunishment: string;
  configSelectAddChannel: string;
  configSelectRemoveChannel: string;
  configSelectAddRole: string;
  configSelectRemoveRole: string;
  configSelectLanguage: string;
  configSelectScanMemberAgeThreshold: string;
  configBtnNoExcludedChannels: string;
  configBtnNoExcludedRoles: string;
  // Scan Member Age option labels
  configValScanMemberAgeAll: string;
  configValScanMemberAge1w: string;
  configValScanMemberAge1m: string;
  configValScanMemberAge6m: string;
  // Language select options
  configLangAuto: string;    // "Auto (Discord Setting)"
  configLangEnUS: string;    // "English"
  configLangKo: string;      // "한국어 (Korean)"
  // Punishment option labels (select menu options)
  punishOptNone: string;
  punishOptTimeoutSingle: string;
  punishOptTimeoutSpam: string;
  punishOptKick: string;
  punishOptBan: string;
  // Punishment display labels (embed field values with emoji)
  punishLabelNone: string;
  punishLabelTimeoutSingle: string;
  punishLabelTimeoutSpam: string;
  punishLabelKick: string;
  punishLabelBan: string;
  // Modal
  modalThresholdTitle: string;
  modalThresholdLabel: string;
  modalThresholdPlaceholder: string;     // "Current: %s%"
  modalSpamThresholdTitle: string;
  modalSpamThresholdLabel: string;
  modalSpamThresholdPlaceholder: string; // "Current: %s"
  modalUrlsTitle: string;
  modalUrlsLabel: string;
  modalUrlsPlaceholder: string;
  // Error / system replies
  errorNotInServer: string;
  errorNoPermission: string;
  errorGeneric: string;
  errorThresholdInvalid: string;
  errorSpamThresholdInvalid: string;

  // ── Onboarding (guildCreate) ──────────────────────────────────────────
  onboardTitle: string;
  onboardDescription: string;    // %s = ", <@inviterId>" or ""
  onboardStep1Title: string;
  onboardStep1Value: string;
  onboardStep2Title: string;
  onboardStep2Value: string;
  onboardStep3Title: string;
  onboardStep3Value: string;
  onboardStep4Title: string;
  onboardStep4Value: string;
  onboardCommandDesc: string;
  onboardCheckTitle: string;
  onboardCheckNoMissing: string;
  onboardCheckMissingFixedAdmin: string; // %s = channelsList
  onboardCheckMissingReport: string;     // %s = channelsList
  onboardCheckMissingTip: string;
  onboardCheckMissingGlobal: string;     // %s = globalList
  onboardCheckHasAdminTip: string;
  onboardFooter: string; // %s = version
  onboardCheckGlobalTitle: string;
  onboardCheckPartialTitle: string;
  onboardCheckPartialDesc: string; // %s = missingList
  onboardCheckFixGlobalTip: string;
  onboardCheckHiddenChannels: string; // e.g. "Hidden channels"
  onboardCheckAndMoreChannels: string; // %s = count, e.g. "...and %s more channels"

  // ── Permission Names ──────────────────────────────────────────────────
  permTimeoutMembers: string;
  permKickMembers: string;
  permBanMembers: string;
  permViewChannel: string;
  permSendMessages: string;
  permManageMessages: string;
  permReadMessageHistory: string;

  // ── In-Channel Scam Warning ───────────────────────────────────────────
  warnTitleSingle: string;
  warnTitleSpammer: string;
  warnDescription: string;          // %s = username, %s = punishmentSuffix
  warnDescriptionManual: string;    // %s = username, %s = sweepSuffix, %s = punishmentSuffix
  warnPunishmentSuffix: string;     // " The user has been **%s**."
  warnSweepSuffix: string;          // " Retroactively swept ... removed **%s** other scam messages."
  warnFieldReason: string;

  // ── Punishment past tense ─────────────────────────────────────────────
  punishPastTimeout: string;
  punishPastKick: string;
  punishPastBan: string;
  punishPastDefault: string;

  // ── Punishment result strings (returned by executePunishment) ──────────
  punishResultTimedOut: string;              // "🟡 Timed Out (%s)"
  punishResultKicked: string;
  punishResultBanned: string;
  punishResultSkippedRoleHierarchy: string;
  punishResultSkippedOwner: string;
  punishResultMissingModerate: string;
  punishResultMissingKick: string;
  punishResultMissingBan: string;
  punishResultFailed: string;                // "❌ Failed (%s)"
  punishResultNone: string;
  punishResultBotNotFound: string;

  // ── Classification labels ─────────────────────────────────────────────
  classifySingle: string;
  classifySpambot: string;    // "Spambot (%s infractions)"

  // ── Admin Log Embed ───────────────────────────────────────────────────
  logTitleScam: string;
  logTitleSpambot: string;
  logTitleManualScam: string;
  logTitleManualSpambot: string;
  logTitleSpambotUpdate: string;
  logFieldSender: string;
  logFieldReporter: string;
  logFieldChannels: string;
  logFieldScamProbability: string;
  logFieldStatus: string;
  logFieldClassification: string;
  logFieldPunishment: string;
  logFieldReason: string;
  logFieldMessageContent: string;
  logFieldFlaggedImages: string;
  logFieldSweepCleanup: string;     // "Successfully deleted **%s** other copies..."
  logStatusDeleted: string;
  logStatusDeletedAllSpans: string;
  logStatusFailed: string;
  logClassificationManualSuffix: string; // " (Manual Report + Threat Sweep)"

  // ── Report command ephemeral replies ──────────────────────────────────
  reportCommandName: string;
  reportCooldownActive: string;     // %s = minutesLeft
  reportScamDetected: string;       // %s = username, %s = confidence%, %s = reason
  reportSweepSuffix: string;        // %s = deletedCount
  reportSafeResult: string;         // %s = safeConfidence%, %s = reason
  reportError: string;              // %s = error message
}
