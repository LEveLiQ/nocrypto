import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import { guild_config, PunishmentSingle, PunishmentSpam } from "../utils/database";
import { logger } from "../utils/logger";
import packageJson from "../../package.json";

function formatPunishment(action: string, tier: "single" | "spam"): string {
  const labels: Record<string, string> = {
    none: "🟢 None (Delete Only)",
    timeout: tier === "single" ? "🟡 Timeout (1 Hour)" : "🟠 Timeout (24 Hours)",
    kick: "🔴 Kick Member",
    ban: "⛔ Ban Member",
  };
  return labels[action] || action;
}

export const configCommand = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure the scam scanner for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("view")
      .setDescription("View the current scanner configuration")
  )
  .addSubcommand((sub) =>
    sub
      .setName("logchannel")
      .setDescription("Set the channel where scam alerts are logged")
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("The text channel for scam alert logs")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("scan-images")
      .setDescription("Toggle image scanning on or off")
      .addBooleanOption((opt) =>
        opt
          .setName("enabled")
          .setDescription("Enable or disable image scanning")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("scan-links")
      .setDescription("Toggle link scanning on or off")
      .addBooleanOption((opt) =>
        opt
          .setName("enabled")
          .setDescription("Enable or disable link scanning")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("threshold")
      .setDescription("Set the minimum confidence threshold for flagging scams")
      .addNumberOption((opt) =>
        opt
          .setName("value")
          .setDescription("Confidence threshold (0.50 - 1.00)")
          .setRequired(true)
          .setMinValue(0.50)
          .setMaxValue(1.00)
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("exclude-channel")
      .setDescription("Manage channels excluded from scanning")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Exclude a channel from scanning")
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("Channel to exclude")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Re-enable scanning in a previously excluded channel")
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("Channel to remove from exclusion list")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("exclude-role")
      .setDescription("Manage roles excluded from scanning")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Exclude users with a role from scanning")
          .addRoleOption((opt) =>
            opt
              .setName("role")
              .setDescription("Role to exclude")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Re-enable scanning for a previously excluded role")
          .addRoleOption((opt) =>
            opt
              .setName("role")
              .setDescription("Role to remove from exclusion list")
              .setRequired(true)
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("reset")
      .setDescription("Reset all settings to defaults")
  )
  .addSubcommand((sub) =>
    sub
      .setName("punishment-single")
      .setDescription("Set the punishment for a single scam infraction")
      .addStringOption((opt) =>
        opt
          .setName("action")
          .setDescription("What to do when a user sends a single scam")
          .setRequired(true)
          .addChoices(
            { name: "None (Delete message only)", value: "none" },
            { name: "Timeout 1 Hour", value: "timeout" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("punishment-spam")
      .setDescription("Set the punishment for detected spambots / multi-channel spammers")
      .addStringOption((opt) =>
        opt
          .setName("action")
          .setDescription("What to do when a user is classified as a spambot")
          .setRequired(true)
          .addChoices(
            { name: "Timeout 24 Hours", value: "timeout" },
            { name: "Kick Member", value: "kick" },
            { name: "Ban Member", value: "ban" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("spam-threshold")
      .setDescription("Infractions limit in 5m before classification as spambot (0 to disable)")
      .addIntegerOption((opt) =>
        opt
          .setName("value")
          .setDescription("Number of infractions (e.g. 3, set to 0 to disable)")
          .setRequired(true)
          .setMinValue(0)
      )
  );

export async function handleConfigCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command can only be used in a server.", flags: ["Ephemeral"] });
    return;
  }

  const guildId = interaction.guildId;
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  try {
    // --- Subcommand groups ---
    if (subcommandGroup === "exclude-channel") {
      const channel = interaction.options.getChannel("channel", true);

      if (subcommand === "add") {
        const added = guild_config.addExcludedChannel(guildId, channel.id);
        if (added) {
          await interaction.reply({
            content: `✅ <#${channel.id}> has been **excluded** from scanning.`,
            flags: ["Ephemeral"],
          });
          logger.info(`Guild ${guildId}: Excluded channel ${channel.id} from scanning.`, "CONFIG");
        } else {
          await interaction.reply({
            content: `⚠️ <#${channel.id}> is already excluded.`,
            flags: ["Ephemeral"],
          });
        }
      } else if (subcommand === "remove") {
        const removed = guild_config.removeExcludedChannel(guildId, channel.id);
        if (removed) {
          await interaction.reply({
            content: `✅ <#${channel.id}> will now be **scanned** again.`,
            flags: ["Ephemeral"],
          });
          logger.info(`Guild ${guildId}: Re-enabled scanning in channel ${channel.id}.`, "CONFIG");
        } else {
          await interaction.reply({
            content: `⚠️ <#${channel.id}> was not in the exclusion list.`,
            flags: ["Ephemeral"],
          });
        }
      }
      return;
    }

    if (subcommandGroup === "exclude-role") {
      const role = interaction.options.getRole("role", true);

      if (subcommand === "add") {
        const added = guild_config.addExcludedRole(guildId, role.id);
        if (added) {
          await interaction.reply({
            content: `✅ Users with the **${role.name}** role will no longer be scanned.`,
            flags: ["Ephemeral"],
          });
          logger.info(`Guild ${guildId}: Excluded role ${role.id} (${role.name}) from scanning.`, "CONFIG");
        } else {
          await interaction.reply({
            content: `⚠️ The **${role.name}** role is already excluded.`,
            flags: ["Ephemeral"],
          });
        }
      } else if (subcommand === "remove") {
        const removed = guild_config.removeExcludedRole(guildId, role.id);
        if (removed) {
          await interaction.reply({
            content: `✅ Users with the **${role.name}** role will now be **scanned** again.`,
            flags: ["Ephemeral"],
          });
          logger.info(`Guild ${guildId}: Re-enabled scanning for role ${role.id} (${role.name}).`, "CONFIG");
        } else {
          await interaction.reply({
            content: `⚠️ The **${role.name}** role was not in the exclusion list.`,
            flags: ["Ephemeral"],
          });
        }
      }
      return;
    }

    // --- Top-level subcommands ---
    switch (subcommand) {
      case "view": {
        const config = guild_config.getConfig(guildId);
        const excludedChannels: string[] = JSON.parse(config.excluded_channels);
        const excludedRoles: string[] = JSON.parse(config.excluded_roles);

        const embed = new EmbedBuilder()
          .setColor(0x5865f2) // Discord blurple
          .setTitle("⚙️ Scam Scanner Configuration")
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
              value: config.spam_threshold > 0 ? `⚠️ ${config.spam_threshold} Infractions` : "🟢 Disabled (Single Only)",
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
          .setFooter({ text: `Guild ID: ${guildId} | NoCrypto v${packageJson.version}` });

        await interaction.reply({ embeds: [embed], flags: ["Ephemeral"] });
        break;
      }

      case "logchannel": {
        const channel = interaction.options.getChannel("channel", true);
        guild_config.setLogChannel(guildId, channel.id);
        await interaction.reply({
          content: `✅ Log channel set to <#${channel.id}>. Scam alerts will be sent there.`,
          flags: ["Ephemeral"],
        });
        logger.info(`Guild ${guildId}: Log channel set to ${channel.id}.`, "CONFIG");
        break;
      }

      case "scan-images": {
        const enabled = interaction.options.getBoolean("enabled", true);
        guild_config.setScanImages(guildId, enabled);
        await interaction.reply({
          content: `✅ Image scanning is now **${enabled ? "enabled" : "disabled"}**.`,
          flags: ["Ephemeral"],
        });
        logger.info(`Guild ${guildId}: Image scanning set to ${enabled}.`, "CONFIG");
        break;
      }

      case "scan-links": {
        const enabled = interaction.options.getBoolean("enabled", true);
        guild_config.setScanLinks(guildId, enabled);
        await interaction.reply({
          content: `✅ Link scanning is now **${enabled ? "enabled" : "disabled"}**.`,
          flags: ["Ephemeral"],
        });
        logger.info(`Guild ${guildId}: Link scanning set to ${enabled}.`, "CONFIG");
        break;
      }

      case "threshold": {
        const value = interaction.options.getNumber("value", true);
        guild_config.setThreshold(guildId, value);
        await interaction.reply({
          content: `✅ Confidence threshold set to **${(value * 100).toFixed(0)}%**. Messages flagged below this level will be ignored.`,
          flags: ["Ephemeral"],
        });
        logger.info(`Guild ${guildId}: Confidence threshold set to ${value}.`, "CONFIG");
        break;
      }

      case "reset": {
        guild_config.resetConfig(guildId);
        await interaction.reply({
          content: "✅ All settings have been reset to defaults. The next scan will use default values.",
          flags: ["Ephemeral"],
        });
        logger.info(`Guild ${guildId}: Configuration reset to defaults.`, "CONFIG");
        break;
      }

      case "punishment-single": {
        const action = interaction.options.getString("action", true) as PunishmentSingle;
        guild_config.setPunishmentSingle(guildId, action);
        await interaction.reply({
          content: `✅ Single infraction punishment set to **${formatPunishment(action, "single")}**.`,
          flags: ["Ephemeral"],
        });
        logger.info(`Guild ${guildId}: Single infraction punishment set to '${action}'.`, "CONFIG");
        break;
      }

      case "punishment-spam": {
        const action = interaction.options.getString("action", true) as PunishmentSpam;
        guild_config.setPunishmentSpam(guildId, action);
        await interaction.reply({
          content: `✅ Spambot punishment set to **${formatPunishment(action, "spam")}**.`,
          flags: ["Ephemeral"],
        });
        logger.info(`Guild ${guildId}: Spambot punishment set to '${action}'.`, "CONFIG");
        break;
      }

      case "spam-threshold": {
        const value = interaction.options.getInteger("value", true);
        guild_config.setSpamThreshold(guildId, value);
        if (value === 0) {
          await interaction.reply({
            content: `✅ Spambot detection has been **disabled**. All infractions will receive the Single Infraction punishment.`,
            flags: ["Ephemeral"],
          });
        } else {
          await interaction.reply({
            content: `✅ Spambot threshold set to **${value} infractions**. Repeat offenses or multi-channel spam will trigger spambot punishment.`,
            flags: ["Ephemeral"],
          });
        }
        logger.info(`Guild ${guildId}: Spambot threshold set to ${value}.`, "CONFIG");
        break;
      }
    }
  } catch (error) {
    logger.error("Error handling /config command:", error, "CONFIG");
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "An error occurred while updating the configuration.", flags: ["Ephemeral"] });
    } else {
      await interaction.reply({ content: "An error occurred while updating the configuration.", flags: ["Ephemeral"] });
    }
  }
}
