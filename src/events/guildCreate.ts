import { Guild, EmbedBuilder, ChannelType, PermissionsBitField, AuditLogEvent } from "discord.js";
import { logger } from "../utils/logger";
import { guild_config } from "../utils/database";
import { getLocale, t, resolveLocaleKey } from "../i18n";
import packageJson from "../../package.json";

export async function onGuildCreate(guild: Guild) {
  let inviterTag = "Unknown User";
  let inviterId = "";
  let missingPermission = false;

  // Check if we have permission to view audit logs to discover who invited the bot
  const me = guild.members.me;
  if (me) {
    if (me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
      try {
        // Sleep 500ms to allow Discord to write the audit log entry
        await new Promise((resolve) => setTimeout(resolve, 500));

        const auditLogs = await guild.fetchAuditLogs({
          limit: 5,
          type: AuditLogEvent.BotAdd,
        });
        const entry = auditLogs.entries.find((e) => e.target?.id === me.id);
        if (entry && entry.executor) {
          inviterTag = entry.executor.tag ?? "Unknown User";
          inviterId = entry.executor.id ?? "";
        }
      } catch (err) {
        logger.warn(`Failed to fetch audit logs for inviter in ${guild.name}: ${err}`, "CLIENT");
      }
    } else {
      missingPermission = true;
    }
  }

  const logInviterSuffix = inviterTag !== "Unknown User" 
    ? ` invited by ${inviterTag} (ID: ${inviterId})` 
    : (missingPermission ? " (Missing 'ViewAuditLog' permission to fetch inviter)" : "");

  logger.info(`Joined new guild: ${guild.name} (ID: ${guild.id})${logInviterSuffix}`, "CLIENT");

  // Resolve locale for this guild (getConfig also creates default row)
  const config = guild_config.getConfig(guild.id);
  const localeKey = resolveLocaleKey(config.language, guild.preferredLocale);
  const L = getLocale(config.language, guild.preferredLocale);

  // Find a suitable channel to send the onboarding message
  let targetChannel = guild.systemChannel;

  if (!targetChannel || !targetChannel.permissionsFor(guild.members.me!)?.has(PermissionsBitField.Flags.SendMessages)) {
    // If system channel is not writable, look for the first writable text channel
    targetChannel = guild.channels.cache.find((channel) =>
      channel.type === ChannelType.GuildText &&
      channel.permissionsFor(guild.members.me!)?.has(PermissionsBitField.Flags.SendMessages)
    ) as any;
  }

  if (!targetChannel) {
    logger.warn(`Could not find a writable channel to send onboarding message in ${guild.name}`, "CLIENT");
    return;
  }

  try {
    const inviterMention = inviterId 
      ? (localeKey === "ko" ? `, <@${inviterId}>님` : `, <@${inviterId}>`) 
      : "";

    const onboardEmbed = new EmbedBuilder()
      .setColor(0x5865f2) // Discord Blurple
      .setTitle(L.onboardTitle)
      .setDescription(t(L.onboardDescription, inviterMention))
      .addFields(
        {
          name: L.onboardStep1Title,
          value: L.onboardStep1Value,
        },
        {
          name: L.onboardStep2Title,
          value: L.onboardStep2Value,
        },
        {
          name: L.onboardStep3Title,
          value: L.onboardStep3Value,
        },
        {
          name: L.onboardStep4Title,
          value: L.onboardStep4Value,
        }
      )
      .setFooter({ text: t(L.onboardFooter, packageJson.version) });

    await targetChannel.send({ embeds: [onboardEmbed] });
    logger.success(`Successfully sent onboarding message to ${guild.name} in #${targetChannel.name}`, "CLIENT");
  } catch (err) {
    logger.error(`Failed to send onboarding message in ${guild.name}:`, err, "CLIENT");
  }
}
