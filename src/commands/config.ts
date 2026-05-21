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
import { guild_config, GuildConfig, PunishmentSingle, PunishmentSpam } from "../utils/database";
import { logger } from "../utils/logger";
import packageJson from "../../package.json";

// ─── Slash Command (no subcommands) ──────────────────────────────────────────

export const configCommand = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Open the interactive scam scanner configuration panel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function formatPunishment(action: string, tier: "single" | "spam"): string {
  const labels: Record<string, string> = {
    none: "🟢 None (Delete Only)",
    timeout: tier === "single" ? "🟡 Timeout (1 Hour)" : "🟠 Timeout (24 Hours)",
    kick: "🔴 Kick Member",
    ban: "⛔ Ban Member",
  };
  return labels[action] || action;
}

// ─── Dashboard Embed ─────────────────────────────────────────────────────────

function buildDashboardEmbed(
  config: GuildConfig,
  guildId: string,
  categoryDescription?: string
): EmbedBuilder {
  const excludedChannels: string[] = JSON.parse(config.excluded_channels);
  const excludedRoles: string[] = JSON.parse(config.excluded_roles);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("⚙️ Scam Scanner — Server Configuration")
    .addFields(
      {
        name: "Log Channel",
        value: config.log_channel_id ? `<#${config.log_channel_id}>` : "Not set",
        inline: true,
      },
      {
        name: "Scan Images",
        value: config.scan_images ? "✅ Enabled" : "❌ Disabled",
        inline: true,
      },
      {
        name: "Scan Links",
        value: config.scan_links ? "✅ Enabled" : "❌ Disabled",
        inline: true,
      },
      {
        name: "Confidence Threshold",
        value: `${(config.confidence_threshold * 100).toFixed(0)}%`,
        inline: true,
      },
      {
        name: "Single Infraction",
        value: formatPunishment(config.punishment_single, "single"),
        inline: true,
      },
      {
        name: "Spambot Punishment",
        value: formatPunishment(config.punishment_spam, "spam"),
        inline: true,
      },
      {
        name: "Spambot Threshold",
        value: config.spam_threshold > 0
          ? `⚠️ ${config.spam_threshold} Infractions`
          : "🟢 Disabled (Single Only)",
        inline: true,
      },
      {
        name: "Excluded Channels",
        value: excludedChannels.length > 0
          ? excludedChannels.map((id) => `<#${id}>`).join(", ")
          : "None",
        inline: false,
      },
      {
        name: "Excluded Roles",
        value: excludedRoles.length > 0
          ? excludedRoles.map((id) => `<@&${id}>`).join(", ")
          : "None",
        inline: false,
      }
    )
    .setFooter({ text: `Made with ❤️ by LEveLiQ | NoCrypto v${packageJson.version}` });

  if (categoryDescription) {
    embed.setDescription(categoryDescription);
  }

  return embed;
}

// ─── Component Builders ──────────────────────────────────────────────────────

function buildHomeComponents(
  guildId: string
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cfg:${guildId}:cat:general`)
      .setLabel("General")
      .setEmoji("⚙️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cfg:${guildId}:cat:punishments`)
      .setLabel("Punishments")
      .setEmoji("⚔️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cfg:${guildId}:cat:exclusions`)
      .setLabel("Exclusions")
      .setEmoji("🚫")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cfg:${guildId}:cat:reset`)
      .setLabel("Reset All")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Danger),
  );

  return [row];
}

function buildGeneralComponents(
  guildId: string,
  config: GuildConfig
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  // Row 1: Channel select menu for log channel
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`cfg:${guildId}:channel_select:log`)
        .setPlaceholder("Select a log channel...")
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
        .setLabel("Clear Log Channel")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!config.log_channel_id),
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:toggle:scan_images`)
        .setLabel(`Scan Images: ${config.scan_images ? "ON" : "OFF"}`)
        .setEmoji("🖼️")
        .setStyle(config.scan_images ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:toggle:scan_links`)
        .setLabel(`Scan Links: ${config.scan_links ? "ON" : "OFF"}`)
        .setEmoji("🔗")
        .setStyle(config.scan_links ? ButtonStyle.Success : ButtonStyle.Secondary),
    )
  );

  // Row 3: Threshold + Back
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:modal_open:threshold`)
        .setLabel(`Threshold: ${(config.confidence_threshold * 100).toFixed(0)}%`)
        .setEmoji("🎯")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:home`)
        .setLabel("Back")
        .setEmoji("◀️")
        .setStyle(ButtonStyle.Secondary),
    )
  );

  return rows;
}

function buildPunishmentsComponents(
  guildId: string,
  config: GuildConfig
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  // Row 1: Single infraction punishment select
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`cfg:${guildId}:select:punishment_single`)
        .setPlaceholder("Single Infraction Punishment")
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("None (Delete message only)")
            .setValue("none")
            .setEmoji("🟢")
            .setDefault(config.punishment_single === "none"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Timeout (1 Hour)")
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
        .setPlaceholder("Spambot Punishment")
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("Timeout (24 Hours)")
            .setValue("timeout")
            .setEmoji("🟠")
            .setDefault(config.punishment_spam === "timeout"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Kick Member")
            .setValue("kick")
            .setEmoji("🔴")
            .setDefault(config.punishment_spam === "kick"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Ban Member")
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
            ? `Spam Threshold: ${config.spam_threshold} Infractions`
            : "Spam Threshold: Disabled"
        )
        .setEmoji("📊")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:home`)
        .setLabel("Back")
        .setEmoji("◀️")
        .setStyle(ButtonStyle.Secondary),
    )
  );

  return rows;
}

function buildExclusionsComponents(
  guildId: string,
  config: GuildConfig,
  guild: Guild
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  const excludedChannels: string[] = JSON.parse(config.excluded_channels);
  const excludedRoles: string[] = JSON.parse(config.excluded_roles);

  // Row 1: Channel select for adding exclusions
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`cfg:${guildId}:channel_select:excl_add`)
        .setPlaceholder("Add a channel to exclude...")
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
          .setPlaceholder("Remove a channel from exclusions...")
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
          .setLabel("No excluded channels to remove")
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
        .setPlaceholder("Add a role to exclude...")
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
          .setPlaceholder("Remove a role from exclusions...")
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
          .setLabel("No excluded roles to remove")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );
  }

  // Row 5: Back
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:home`)
        .setLabel("Back")
        .setEmoji("◀️")
        .setStyle(ButtonStyle.Secondary),
    )
  );

  return rows;
}

function buildResetComponents(
  guildId: string
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:reset:confirm`)
        .setLabel("Confirm Reset")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`cfg:${guildId}:reset:cancel`)
        .setLabel("Cancel")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Render Helpers ──────────────────────────────────────────────────────────

function renderHome(guildId: string) {
  const config = guild_config.getConfig(guildId);
  return {
    embeds: [buildDashboardEmbed(config, guildId)],
    components: buildHomeComponents(guildId),
  };
}

function renderGeneral(guildId: string) {
  const config = guild_config.getConfig(guildId);
  return {
    embeds: [
      buildDashboardEmbed(config, guildId, "**⚙️ General Settings** — Configure scanning behavior and log output."),
    ],
    components: buildGeneralComponents(guildId, config),
  };
}

function renderPunishments(guildId: string) {
  const config = guild_config.getConfig(guildId);
  return {
    embeds: [
      buildDashboardEmbed(config, guildId, "**⚔️ Punishment Settings** — Configure actions taken against scam offenders."),
    ],
    components: buildPunishmentsComponents(guildId, config),
  };
}

function renderExclusions(guildId: string, guild: Guild) {
  const config = guild_config.getConfig(guildId);
  return {
    embeds: [
      buildDashboardEmbed(config, guildId, "**🚫 Exclusions** — Channels and roles that bypass the scanner."),
    ],
    components: buildExclusionsComponents(guildId, config, guild),
  };
}

function renderReset(guildId: string) {
  const config = guild_config.getConfig(guildId);
  return {
    embeds: [
      buildDashboardEmbed(
        config,
        guildId,
        "**🔄 Reset Configuration**\n\n⚠️ This will reset **all** settings to their defaults. This action cannot be undone."
      ),
    ],
    components: buildResetComponents(guildId),
  };
}

// ─── Interaction Handlers ────────────────────────────────────────────────────

/**
 * `/config` slash command — opens the dashboard.
 */
export async function handleConfigCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command can only be used in a server.", flags: ["Ephemeral"] });
    return;
  }

  try {
    await interaction.reply({ ...renderHome(interaction.guildId), flags: ["Ephemeral"] });
  } catch (error) {
    logger.error("Error opening config dashboard:", error, "CONFIG");
    await interaction.reply({ content: "An error occurred while opening the configuration panel.", flags: ["Ephemeral"] });
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
    await interaction.reply({ content: "You don't have permission to manage server settings.", flags: ["Ephemeral"] });
    return;
  }

  try {
    switch (action) {
      // ── Navigation ──
      case "home":
        await interaction.update(renderHome(guildId));
        break;

      case "cat":
        switch (target) {
          case "general":
            await interaction.update(renderGeneral(guildId));
            break;
          case "punishments":
            await interaction.update(renderPunishments(guildId));
            break;
          case "exclusions":
            await interaction.update(renderExclusions(guildId, interaction.guild!));
            break;
          case "reset":
            await interaction.update(renderReset(guildId));
            break;
        }
        break;

      // ── General actions ──
      case "clear":
        if (target === "log") {
          guild_config.setLogChannel(guildId, null);
          logger.info(`Guild ${guildId}: Log channel cleared.`, "CONFIG");
          await interaction.update(renderGeneral(guildId));
        }
        break;

      case "toggle":
        if (target === "scan_images") {
          const config = guild_config.getConfig(guildId);
          guild_config.setScanImages(guildId, !config.scan_images);
          logger.info(`Guild ${guildId}: Image scanning set to ${!config.scan_images}.`, "CONFIG");
          await interaction.update(renderGeneral(guildId));
        } else if (target === "scan_links") {
          const config = guild_config.getConfig(guildId);
          guild_config.setScanLinks(guildId, !config.scan_links);
          logger.info(`Guild ${guildId}: Link scanning set to ${!config.scan_links}.`, "CONFIG");
          await interaction.update(renderGeneral(guildId));
        }
        break;

      // ── Modals ──
      case "modal_open":
        if (target === "threshold") {
          const config = guild_config.getConfig(guildId);
          const modal = new ModalBuilder()
            .setCustomId(`cfg:${guildId}:modal:threshold`)
            .setTitle("Set Confidence Threshold")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel("Threshold (50 – 100)")
                  .setPlaceholder(`Current: ${(config.confidence_threshold * 100).toFixed(0)}%`)
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
            .setTitle("Set Spam Threshold")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel("Infractions before spambot (0=off)")
                  .setPlaceholder(`Current: ${config.spam_threshold}`)
                  .setStyle(TextInputStyle.Short)
                  .setMinLength(1)
                  .setMaxLength(3)
                  .setRequired(true)
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
          await interaction.update(renderHome(guildId));
        } else if (target === "cancel") {
          await interaction.update(renderHome(guildId));
        }
        break;
    }
  } catch (error) {
    logger.error("Error handling config button:", error, "CONFIG");
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "An error occurred while updating the configuration.", flags: ["Ephemeral"] });
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
  const target = parts[3]; // "log" | "excl_add" | "punishment_single" | etc.

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You don't have permission to manage server settings.", flags: ["Ephemeral"] });
    return;
  }

  try {
    switch (action) {
      // ── Channel select menus ──
      case "channel_select": {
        if (!interaction.isChannelSelectMenu()) break;
        const channelId = interaction.values[0];

        if (target === "log") {
          guild_config.setLogChannel(guildId, channelId);
          logger.info(`Guild ${guildId}: Log channel set to ${channelId}.`, "CONFIG");
          await interaction.update(renderGeneral(guildId));
        } else if (target === "excl_add") {
          const added = guild_config.addExcludedChannel(guildId, channelId);
          if (added) {
            logger.info(`Guild ${guildId}: Excluded channel ${channelId} from scanning.`, "CONFIG");
          }
          await interaction.update(renderExclusions(guildId, interaction.guild!));
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
          await interaction.update(renderExclusions(guildId, interaction.guild!));
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
          await interaction.update(renderPunishments(guildId));
        } else if (target === "punishment_spam") {
          guild_config.setPunishmentSpam(guildId, value as PunishmentSpam);
          logger.info(`Guild ${guildId}: Spambot punishment set to '${value}'.`, "CONFIG");
          await interaction.update(renderPunishments(guildId));
        } else if (target === "excl_channel_remove") {
          const removed = guild_config.removeExcludedChannel(guildId, value);
          if (removed) {
            logger.info(`Guild ${guildId}: Re-enabled scanning in channel ${value}.`, "CONFIG");
          }
          await interaction.update(renderExclusions(guildId, interaction.guild!));
        } else if (target === "excl_role_remove") {
          const removed = guild_config.removeExcludedRole(guildId, value);
          if (removed) {
            logger.info(`Guild ${guildId}: Re-enabled scanning for role ${value}.`, "CONFIG");
          }
          await interaction.update(renderExclusions(guildId, interaction.guild!));
        }
        break;
      }
    }
  } catch (error) {
    logger.error("Error handling config select:", error, "CONFIG");
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "An error occurred while updating the configuration.", flags: ["Ephemeral"] });
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
    await interaction.reply({ content: "You don't have permission to manage server settings.", flags: ["Ephemeral"] });
    return;
  }

  try {
    const rawValue = interaction.fields.getTextInputValue("value").trim();

    if (target === "threshold") {
      const num = Number(rawValue);
      if (isNaN(num) || num < 50 || num > 100) {
        await interaction.reply({
          content: "❌ Invalid value. Please enter a number between **50** and **100** (e.g., `70` for 70%).",
          flags: ["Ephemeral"],
        });
        return;
      }
      const normalized = num / 100;
      guild_config.setThreshold(guildId, normalized);
      logger.info(`Guild ${guildId}: Confidence threshold set to ${normalized}.`, "CONFIG");

      // Modal submissions can't use .update() — they need deferUpdate + editReply
      // or just reply. We'll reply with the updated panel.
      await interaction.deferUpdate();
      await interaction.editReply(renderGeneral(guildId));
    } else if (target === "spam_threshold") {
      const num = Number(rawValue);
      if (isNaN(num) || !Number.isInteger(num) || num < 0) {
        await interaction.reply({
          content: "❌ Invalid value. Please enter a non-negative whole number (e.g., `3` for 3 infractions, `0` to disable).",
          flags: ["Ephemeral"],
        });
        return;
      }
      guild_config.setSpamThreshold(guildId, num);
      logger.info(`Guild ${guildId}: Spambot threshold set to ${num}.`, "CONFIG");

      await interaction.deferUpdate();
      await interaction.editReply(renderPunishments(guildId));
    }
  } catch (error) {
    logger.error("Error handling config modal:", error, "CONFIG");
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "An error occurred while updating the configuration.", flags: ["Ephemeral"] });
    }
  }
}
