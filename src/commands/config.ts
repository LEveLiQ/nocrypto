import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
  Guild,
  ComponentType,
  type MessageActionRowComponentBuilder,
  type AnySelectMenuInteraction,
} from "discord.js";
import { guild_config, GuildConfig, PunishmentSingle, PunishmentSpam, ScanMemberAgeThreshold } from "../utils/database";
import { logger } from "../utils/logger";
import { getLocale, t, getLanguageDisplayName, LocaleStrings } from "../i18n";
import packageJson from "../../package.json";

import { enUS } from "../i18n/locales/en-US";
import { ko } from "../i18n/locales/ko";

// ─── Slash Command (no subcommands) ──────────────────────────────────────────

export const configCommand = new SlashCommandBuilder()
  .setName("config")
  .setDescription(enUS.configCommandDesc)
  .setDescriptionLocalizations({
    ko: ko.configCommandDesc
  })
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function formatPunishment(action: string, tier: "single" | "spam", L: LocaleStrings): string {
  if (action === "none") return L.punishLabelNone;
  if (action === "timeout") return tier === "single" ? L.punishLabelTimeoutSingle : L.punishLabelTimeoutSpam;
  if (action === "kick") return L.punishLabelKick;
  if (action === "ban") return L.punishLabelBan;
  return action;
}

function formatScanMemberAgeThreshold(value: string, L: LocaleStrings): string {
  if (value === "1w") return L.configValScanMemberAge1w;
  if (value === "1m") return L.configValScanMemberAge1m;
  if (value === "6m") return L.configValScanMemberAge6m;
  return L.configValScanMemberAgeAll;
}

// ─── Dashboard Embed ─────────────────────────────────────────────────────────

function buildDashboardEmbed(
  config: GuildConfig,
  guildId: string,
  L: LocaleStrings,
  categoryDescription?: string
): EmbedBuilder {
  const excludedChannels: string[] = JSON.parse(config.excluded_channels);
  const excludedRoles: string[] = JSON.parse(config.excluded_roles);
  const excludedUrls: string[] = JSON.parse(config.excluded_urls);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(L.configTitle)
    .addFields(
      {
        name: L.configFieldLogChannel,
        value: config.log_channel_id ? `<#${config.log_channel_id}>` : L.configValueNotSet,
        inline: true,
      },
      {
        name: L.configFieldScanImages,
        value: config.scan_images ? L.configValueEnabled : L.configValueDisabled,
        inline: true,
      },
      {
        name: L.configFieldScanLinks,
        value: config.scan_links ? L.configValueEnabled : L.configValueDisabled,
        inline: true,
      },
      {
        name: L.configFieldConfidenceThreshold,
        value: `${(config.confidence_threshold * 100).toFixed(0)}%`,
        inline: true,
      },
      {
        name: L.configFieldSingleInfraction,
        value: formatPunishment(config.punishment_single, "single", L),
        inline: true,
      },
      {
        name: L.configFieldSpambotPunishment,
        value: formatPunishment(config.punishment_spam, "spam", L),
        inline: true,
      },
      {
        name: L.configFieldSpambotThreshold,
        value: config.spam_threshold > 0
          ? t(L.configValueInfractions, config.spam_threshold)
          : L.configValueSpambotThresholdDisabled,
        inline: true,
      },
      {
        name: L.configFieldLanguage,
        value: getLanguageDisplayName(config.language),
        inline: true,
      },
      {
        name: L.configFieldScanMemberAgeThreshold,
        value: formatScanMemberAgeThreshold(config.scan_member_age_threshold, L),
        inline: true,
      },
      {
        name: L.configFieldExcludedChannels,
        value: excludedChannels.length > 0
          ? excludedChannels.map((id) => `<#${id}>`).join(", ")
          : L.configValueNone,
        inline: false,
      },
      {
        name: L.configFieldExcludedRoles,
        value: excludedRoles.length > 0
          ? excludedRoles.map((id) => `<@&${id}>`).join(", ")
          : L.configValueNone,
        inline: false,
      },
      {
        name: L.configFieldExcludedUrls,
        value: excludedUrls.length > 0
          ? excludedUrls.map((url) => `\`${url}\``).join(", ")
          : L.configValueNone,
        inline: false,
      }
    )
    .setFooter({ text: t(L.configFooter, packageJson.version) });

  if (categoryDescription) {
    embed.setDescription(categoryDescription);
  }

  return embed;
}

// ─── Component Builders ──────────────────────────────────────────────────────

function buildHomeComponents(
  guildId: string,
  L: LocaleStrings
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cfg:${guildId}:cat:general`)
      .setLabel(L.configBtnGeneral)
      .setEmoji("⚙️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cfg:${guildId}:cat:punishments`)
      .setLabel(L.configBtnPunishments)
      .setEmoji("⚔️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cfg:${guildId}:cat:exclusions`)
      .setLabel(L.configBtnExclusions)
      .setEmoji("🚫")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cfg:${guildId}:cat:targeting`)
      .setLabel(L.configBtnTargeting)
      .setEmoji("🎯")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cfg:${guildId}:cat:reset`)
      .setLabel(L.configBtnResetAll)
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Danger),
  );

  return [row];
}

function buildGeneralComponents(
  guildId: string,
  config: GuildConfig,
  L: LocaleStrings
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  // Row 1: Channel select menu for log channel
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`cfg:${guildId}:channel_select:log`)
        .setPlaceholder(L.configSelectLogChannel)
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    )
  );

  // Row 2: Clear log channel + toggle buttons
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:clear:log`)
        .setLabel(L.configBtnClearLogChannel)
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!config.log_channel_id),
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:toggle:scan_images`)
        .setLabel(config.scan_images ? L.configBtnScanImagesOn : L.configBtnScanImagesOff)
        .setEmoji("🖼️")
        .setStyle(config.scan_images ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:toggle:scan_links`)
        .setLabel(config.scan_links ? L.configBtnScanLinksOn : L.configBtnScanLinksOff)
        .setEmoji("🔗")
        .setStyle(config.scan_links ? ButtonStyle.Success : ButtonStyle.Secondary),
    )
  );

  // Row 3: Language select menu
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`cfg:${guildId}:select:language`)
        .setPlaceholder(L.configSelectLanguage)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(L.configLangAuto)
            .setValue("auto")
            .setEmoji("🌐")
            .setDefault(config.language === "auto"),
          new StringSelectMenuOptionBuilder()
            .setLabel(L.configLangEnUS)
            .setValue("en-US")
            .setEmoji("🇺🇸")
            .setDefault(config.language === "en-US"),
          new StringSelectMenuOptionBuilder()
            .setLabel(L.configLangKo)
            .setValue("ko")
            .setEmoji("🇰🇷")
            .setDefault(config.language === "ko"),
        )
    )
  );

  // Row 4: Threshold + Back
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:modal_open:threshold`)
        .setLabel(t(L.configBtnThreshold, (config.confidence_threshold * 100).toFixed(0)))
        .setEmoji("🎯")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:home`)
        .setLabel(L.configBtnBack)
        .setEmoji("◀️")
        .setStyle(ButtonStyle.Secondary),
    )
  );

  return rows;
}

function buildPunishmentsComponents(
  guildId: string,
  config: GuildConfig,
  L: LocaleStrings
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  // Row 1: Single infraction punishment select
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`cfg:${guildId}:select:punishment_single`)
        .setPlaceholder(L.configSelectSinglePunishment)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(L.punishOptNone)
            .setValue("none")
            .setEmoji("🟢")
            .setDefault(config.punishment_single === "none"),
          new StringSelectMenuOptionBuilder()
            .setLabel(L.punishOptTimeoutSingle)
            .setValue("timeout")
            .setEmoji("🟡")
            .setDefault(config.punishment_single === "timeout"),
        )
    )
  );

  // Row 2: Spambot punishment select
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`cfg:${guildId}:select:punishment_spam`)
        .setPlaceholder(L.configSelectSpambotPunishment)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(L.punishOptTimeoutSpam)
            .setValue("timeout")
            .setEmoji("🟠")
            .setDefault(config.punishment_spam === "timeout"),
          new StringSelectMenuOptionBuilder()
            .setLabel(L.punishOptKick)
            .setValue("kick")
            .setEmoji("🔴")
            .setDefault(config.punishment_spam === "kick"),
          new StringSelectMenuOptionBuilder()
            .setLabel(L.punishOptBan)
            .setValue("ban")
            .setEmoji("⛔")
            .setDefault(config.punishment_spam === "ban"),
        )
    )
  );

  // Row 3: Spam threshold button + Back
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:modal_open:spam_threshold`)
        .setLabel(
          config.spam_threshold > 0
            ? t(L.configBtnSpamThreshold, config.spam_threshold)
            : L.configBtnSpamThresholdOff
        )
        .setEmoji("📊")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:home`)
        .setLabel(L.configBtnBack)
        .setEmoji("◀️")
        .setStyle(ButtonStyle.Secondary),
    )
  );

  return rows;
}

function buildExclusionsComponents(
  guildId: string,
  config: GuildConfig,
  guild: Guild,
  L: LocaleStrings
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  const excludedChannels: string[] = JSON.parse(config.excluded_channels);
  const excludedRoles: string[] = JSON.parse(config.excluded_roles);

  // Row 1: Channel select for adding exclusions
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`cfg:${guildId}:channel_select:excl_add`)
        .setPlaceholder(L.configSelectAddChannel)
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    )
  );

  // Row 2: Remove excluded channel (StringSelectMenu if any, disabled button if empty)
  if (excludedChannels.length > 0) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`cfg:${guildId}:select:excl_channel_remove`)
          .setPlaceholder(L.configSelectRemoveChannel)
          .addOptions(
            excludedChannels.map((id) => {
              const channel = guild.channels.cache.get(id);
              return new StringSelectMenuOptionBuilder()
                .setLabel(`#${channel?.name ?? id}`)
                .setDescription(channel ? `ID: ${id}` : "Channel not found")
                .setValue(id);
            }
            )
          )
      )
    );
  } else {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`cfg:${guildId}:noop:excl_ch`)
          .setLabel(L.configBtnNoExcludedChannels)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );
  }

  // Row 3: Role select for adding exclusions
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`cfg:${guildId}:role_select:excl_add`)
        .setPlaceholder(L.configSelectAddRole)
        .setMinValues(1)
        .setMaxValues(1)
    )
  );

  // Row 4: Remove excluded role (StringSelectMenu if any, disabled button if empty)
  if (excludedRoles.length > 0) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`cfg:${guildId}:select:excl_role_remove`)
          .setPlaceholder(L.configSelectRemoveRole)
          .addOptions(
            excludedRoles.map((id) => {
              const role = guild.roles.cache.get(id);
              return new StringSelectMenuOptionBuilder()
                .setLabel(`@${role?.name ?? id}`)
                .setDescription(role ? `ID: ${id}` : "Role not found")
                .setValue(id);
            })
          )
      )
    );
  } else {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`cfg:${guildId}:noop:excl_rl`)
          .setLabel(L.configBtnNoExcludedRoles)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );
  }

  // Row 5: Edit URLs + Back
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:modal_open:urls`)
        .setLabel(L.configBtnEditUrls)
        .setEmoji("🔗")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:home`)
        .setLabel(L.configBtnBack)
        .setEmoji("◀️")
        .setStyle(ButtonStyle.Secondary),
    )
  );

  return rows;
}

function buildTargetingComponents(
  guildId: string,
  config: GuildConfig,
  L: LocaleStrings
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  // Row 1: String select menu for age threshold
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`cfg:${guildId}:select:scan_member_age_threshold`)
        .setPlaceholder(L.configSelectScanMemberAgeThreshold)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(L.configValScanMemberAgeAll)
            .setValue("all")
            .setEmoji("🌐")
            .setDefault(config.scan_member_age_threshold === "all"),
          new StringSelectMenuOptionBuilder()
            .setLabel(L.configValScanMemberAge1w)
            .setValue("1w")
            .setEmoji("⏱️")
            .setDefault(config.scan_member_age_threshold === "1w"),
          new StringSelectMenuOptionBuilder()
            .setLabel(L.configValScanMemberAge1m)
            .setValue("1m")
            .setEmoji("📅")
            .setDefault(config.scan_member_age_threshold === "1m"),
          new StringSelectMenuOptionBuilder()
            .setLabel(L.configValScanMemberAge6m)
            .setValue("6m")
            .setEmoji("⏳")
            .setDefault(config.scan_member_age_threshold === "6m"),
        )
    )
  );

  // Row 2: Back button
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:home`)
        .setLabel(L.configBtnBack)
        .setEmoji("◀️")
        .setStyle(ButtonStyle.Secondary),
    )
  );

  return rows;
}

function buildResetComponents(
  guildId: string,
  L: LocaleStrings
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:reset:confirm`)
        .setLabel(L.configBtnConfirmReset)
        .setEmoji("✅")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:reset:cancel`)
        .setLabel(L.configBtnCancelReset)
        .setEmoji("❌")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Locale Resolution Helper ────────────────────────────────────────────────

function resolveL(guildId: string, guildLocale?: string | null, userLocale?: string | null): LocaleStrings {
  const config = guild_config.getConfig(guildId);
  return getLocale(config.language, guildLocale, userLocale);
}

// ─── Render Helpers ──────────────────────────────────────────────────────────

function renderHome(guildId: string, L: LocaleStrings) {
  const config = guild_config.getConfig(guildId);
  return {
    embeds: [buildDashboardEmbed(config, guildId, L)],
    components: buildHomeComponents(guildId, L),
  };
}

function renderGeneral(guildId: string, L: LocaleStrings) {
  const config = guild_config.getConfig(guildId);
  return {
    embeds: [
      buildDashboardEmbed(config, guildId, L, L.configDescGeneral),
    ],
    components: buildGeneralComponents(guildId, config, L),
  };
}

function renderPunishments(guildId: string, L: LocaleStrings) {
  const config = guild_config.getConfig(guildId);
  return {
    embeds: [
      buildDashboardEmbed(config, guildId, L, L.configDescPunishments),
    ],
    components: buildPunishmentsComponents(guildId, config, L),
  };
}

function renderExclusions(guildId: string, guild: Guild, L: LocaleStrings) {
  const config = guild_config.getConfig(guildId);
  return {
    embeds: [
      buildDashboardEmbed(config, guildId, L, L.configDescExclusions),
    ],
    components: buildExclusionsComponents(guildId, config, guild, L),
  };
}

function renderTargeting(guildId: string, L: LocaleStrings) {
  const config = guild_config.getConfig(guildId);
  return {
    embeds: [
      buildDashboardEmbed(config, guildId, L, L.configDescTargeting),
    ],
    components: buildTargetingComponents(guildId, config, L),
  };
}

function renderReset(guildId: string, L: LocaleStrings) {
  const config = guild_config.getConfig(guildId);
  return {
    embeds: [
      buildDashboardEmbed(config, guildId, L, L.configDescReset),
    ],
    components: buildResetComponents(guildId, L),
  };
}

// ─── Interaction Handlers ────────────────────────────────────────────────────

/**
 * `/config` slash command — opens the dashboard.
 */
export async function handleConfigCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    const L = getLocale("auto", null, interaction.locale);
    await interaction.reply({ content: L.errorNotInServer, flags: ["Ephemeral"] });
    return;
  }

  const L = resolveL(interaction.guildId, interaction.guildLocale, interaction.locale);

  try {
    await interaction.reply({ ...renderHome(interaction.guildId, L), flags: ["Ephemeral"] });
  } catch (error) {
    logger.error("Error opening config dashboard:", error, "CONFIG");
    await interaction.reply({ content: L.errorGeneric, flags: ["Ephemeral"] });
  }
}

/**
 * Handles all button interactions with the `cfg:` prefix.
 */
export async function handleConfigButton(interaction: ButtonInteraction) {
  const parts = interaction.customId.split(":");
  // cfg:<guildId>:<action>:<target?>
  const guildId = parts[1];
  const action = parts[2];
  const target = parts[3];

  // Verify the user has ManageGuild permission
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    const L = resolveL(guildId, interaction.guildLocale, interaction.locale);
    await interaction.reply({ content: L.errorNoPermission, flags: ["Ephemeral"] });
    return;
  }

  // Resolve locale — note: for language changes, we re-resolve after the change
  let L = resolveL(guildId, interaction.guildLocale, interaction.locale);

  try {
    switch (action) {
      // ── Navigation ──
      case "home":
        await interaction.update(renderHome(guildId, L));
        break;

      case "cat":
        switch (target) {
          case "general":
            await interaction.update(renderGeneral(guildId, L));
            break;
          case "punishments":
            await interaction.update(renderPunishments(guildId, L));
            break;
          case "exclusions":
            await interaction.update(renderExclusions(guildId, interaction.guild!, L));
            break;
          case "targeting":
            await interaction.update(renderTargeting(guildId, L));
            break;
          case "reset":
            await interaction.update(renderReset(guildId, L));
            break;
        }
        break;

      // ── General actions ──
      case "clear":
        if (target === "log") {
          guild_config.setLogChannel(guildId, null);
          logger.info(`Guild ${guildId}: Log channel cleared.`, "CONFIG");
          await interaction.update(renderGeneral(guildId, L));
        }
        break;

      case "toggle":
        if (target === "scan_images") {
          const config = guild_config.getConfig(guildId);
          guild_config.setScanImages(guildId, !config.scan_images);
          logger.info(`Guild ${guildId}: Image scanning set to ${!config.scan_images}.`, "CONFIG");
          await interaction.update(renderGeneral(guildId, L));
        } else if (target === "scan_links") {
          const config = guild_config.getConfig(guildId);
          guild_config.setScanLinks(guildId, !config.scan_links);
          logger.info(`Guild ${guildId}: Link scanning set to ${!config.scan_links}.`, "CONFIG");
          await interaction.update(renderGeneral(guildId, L));
        }
        break;

      // ── Modals ──
      case "modal_open":
        if (target === "threshold") {
          const config = guild_config.getConfig(guildId);
          const modal = new ModalBuilder()
            .setCustomId(`cfg:${guildId}:modal:threshold`)
            .setTitle(L.modalThresholdTitle)
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel(L.modalThresholdLabel)
                  .setPlaceholder(t(L.modalThresholdPlaceholder, (config.confidence_threshold * 100).toFixed(0)))
                  .setStyle(TextInputStyle.Short)
                  .setMinLength(2)
                  .setMaxLength(3)
                  .setRequired(true)
              )
            );
          await interaction.showModal(modal);
        } else if (target === "spam_threshold") {
          const config = guild_config.getConfig(guildId);
          const modal = new ModalBuilder()
            .setCustomId(`cfg:${guildId}:modal:spam_threshold`)
            .setTitle(L.modalSpamThresholdTitle)
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel(L.modalSpamThresholdLabel)
                  .setPlaceholder(t(L.modalSpamThresholdPlaceholder, String(config.spam_threshold)))
                  .setStyle(TextInputStyle.Short)
                  .setMinLength(1)
                  .setMaxLength(3)
                  .setRequired(true)
              )
            );
          await interaction.showModal(modal);
        } else if (target === "urls") {
          const config = guild_config.getConfig(guildId);
          const excludedUrls: string[] = JSON.parse(config.excluded_urls);
          const currentUrls = excludedUrls.join("\n");
          
          const modal = new ModalBuilder()
            .setCustomId(`cfg:${guildId}:modal:urls`)
            .setTitle(L.modalUrlsTitle)
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel(L.modalUrlsLabel)
                  .setPlaceholder(L.modalUrlsPlaceholder)
                  .setStyle(TextInputStyle.Paragraph)
                  .setValue(currentUrls)
                  .setRequired(false)
              )
            );
          await interaction.showModal(modal);
        }
        break;

      // ── Reset ──
      case "reset":
        if (target === "confirm") {
          guild_config.resetConfig(guildId);
          logger.info(`Guild ${guildId}: Configuration reset to defaults.`, "CONFIG");
          // Re-resolve L since config was reset (language is now "auto")
          L = resolveL(guildId, interaction.guildLocale, interaction.locale);
          await interaction.update(renderHome(guildId, L));
        } else if (target === "cancel") {
          await interaction.update(renderHome(guildId, L));
        }
        break;
    }
  } catch (error) {
    logger.error("Error handling config button:", error, "CONFIG");
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: L.errorGeneric, flags: ["Ephemeral"] });
    }
  }
}

/**
 * Handles all select menu interactions with the `cfg:` prefix.
 */
export async function handleConfigSelect(interaction: AnySelectMenuInteraction) {
  const parts = interaction.customId.split(":");
  const guildId = parts[1];
  const action = parts[2]; // "channel_select" | "role_select" | "select"
  const target = parts[3]; // "log" | "excl_add" | "punishment_single" | "language" | etc.

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    const L = resolveL(guildId, interaction.guildLocale, interaction.locale);
    await interaction.reply({ content: L.errorNoPermission, flags: ["Ephemeral"] });
    return;
  }

  // Resolve locale (will be re-resolved after language change)
  let L = resolveL(guildId, interaction.guildLocale, interaction.locale);

  try {
    switch (action) {
      // ── Channel select menus ──
      case "channel_select": {
        if (!interaction.isChannelSelectMenu()) break;
        const channelId = interaction.values[0];

        if (target === "log") {
          guild_config.setLogChannel(guildId, channelId);
          logger.info(`Guild ${guildId}: Log channel set to ${channelId}.`, "CONFIG");
          await interaction.update(renderGeneral(guildId, L));
        } else if (target === "excl_add") {
          const added = guild_config.addExcludedChannel(guildId, channelId);
          if (added) {
            logger.info(`Guild ${guildId}: Excluded channel ${channelId} from scanning.`, "CONFIG");
          }
          await interaction.update(renderExclusions(guildId, interaction.guild!, L));
        }
        break;
      }

      // ── Role select menus ──
      case "role_select": {
        if (!interaction.isRoleSelectMenu()) break;
        const roleId = interaction.values[0];

        if (target === "excl_add") {
          const added = guild_config.addExcludedRole(guildId, roleId);
          if (added) {
            logger.info(`Guild ${guildId}: Excluded role ${roleId} from scanning.`, "CONFIG");
          }
          await interaction.update(renderExclusions(guildId, interaction.guild!, L));
        }
        break;
      }

      // ── String select menus ──
      case "select": {
        if (!interaction.isStringSelectMenu()) break;
        const value = interaction.values[0];

        if (target === "punishment_single") {
          guild_config.setPunishmentSingle(guildId, value as PunishmentSingle);
          logger.info(`Guild ${guildId}: Single infraction punishment set to '${value}'.`, "CONFIG");
          await interaction.update(renderPunishments(guildId, L));
        } else if (target === "punishment_spam") {
          guild_config.setPunishmentSpam(guildId, value as PunishmentSpam);
          logger.info(`Guild ${guildId}: Spambot punishment set to '${value}'.`, "CONFIG");
          await interaction.update(renderPunishments(guildId, L));
        } else if (target === "excl_channel_remove") {
          const removed = guild_config.removeExcludedChannel(guildId, value);
          if (removed) {
            logger.info(`Guild ${guildId}: Re-enabled scanning in channel ${value}.`, "CONFIG");
          }
          await interaction.update(renderExclusions(guildId, interaction.guild!, L));
        } else if (target === "excl_role_remove") {
          const removed = guild_config.removeExcludedRole(guildId, value);
          if (removed) {
            logger.info(`Guild ${guildId}: Re-enabled scanning for role ${value}.`, "CONFIG");
          }
          await interaction.update(renderExclusions(guildId, interaction.guild!, L));
        } else if (target === "language") {
          guild_config.setLanguage(guildId, value);
          logger.info(`Guild ${guildId}: Language set to '${value}'.`, "CONFIG");
          // Re-resolve locale since language just changed
          L = resolveL(guildId, interaction.guildLocale, interaction.locale);
          await interaction.update(renderGeneral(guildId, L));
        } else if (target === "scan_member_age_threshold") {
          guild_config.setScanMemberAgeThreshold(guildId, value as ScanMemberAgeThreshold);
          logger.info(`Guild ${guildId}: Scan member age threshold set to '${value}'.`, "CONFIG");
          await interaction.update(renderTargeting(guildId, L));
        }
        break;
      }
    }
  } catch (error) {
    logger.error("Error handling config select:", error, "CONFIG");
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: L.errorGeneric, flags: ["Ephemeral"] });
    }
  }
}

/**
 * Handles modal submissions with the `cfg:` prefix.
 */
export async function handleConfigModal(interaction: ModalSubmitInteraction) {
  const parts = interaction.customId.split(":");
  const guildId = parts[1];
  const target = parts[3]; // "threshold" | "spam_threshold"

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    const L = resolveL(guildId, interaction.guildLocale, interaction.locale);
    await interaction.reply({ content: L.errorNoPermission, flags: ["Ephemeral"] });
    return;
  }

  const L = resolveL(guildId, interaction.guildLocale, interaction.locale);

  try {
    const rawValue = interaction.fields.getTextInputValue("value").trim();

    if (target === "threshold") {
      const num = Number(rawValue);
      if (isNaN(num) || num < 50 || num > 100) {
        await interaction.reply({
          content: L.errorThresholdInvalid,
          flags: ["Ephemeral"],
        });
        return;
      }
      const normalized = num / 100;
      guild_config.setThreshold(guildId, normalized);
      logger.info(`Guild ${guildId}: Confidence threshold set to ${normalized}.`, "CONFIG");

      // Modal submissions can't use .update() — they need deferUpdate + editReply
      await interaction.deferUpdate();
      await interaction.editReply(renderGeneral(guildId, L));
    } else if (target === "spam_threshold") {
      const num = Number(rawValue);
      if (isNaN(num) || !Number.isInteger(num) || num < 0) {
        await interaction.reply({
          content: L.errorSpamThresholdInvalid,
          flags: ["Ephemeral"],
        });
        return;
      }
      guild_config.setSpamThreshold(guildId, num);
      logger.info(`Guild ${guildId}: Spambot threshold set to ${num}.`, "CONFIG");

      await interaction.deferUpdate();
      await interaction.editReply(renderPunishments(guildId, L));
    } else if (target === "urls") {
      const parsedUrls = rawValue
        .split(/[\n,]+/)
        .map(u => u.trim().toLowerCase())
        .filter(u => u.length > 0);
      
      guild_config.setExcludedUrls(guildId, parsedUrls);
      logger.info(`Guild ${guildId}: Excluded URLs updated to: ${parsedUrls.join(", ")}`, "CONFIG");

      await interaction.deferUpdate();
      await interaction.editReply(renderExclusions(guildId, interaction.guild!, L));
    }
  } catch (error) {
    logger.error("Error handling config modal:", error, "CONFIG");
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: L.errorGeneric, flags: ["Ephemeral"] });
    }
  }
}
