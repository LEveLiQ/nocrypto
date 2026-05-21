import { Guild, EmbedBuilder, ChannelType, PermissionsBitField, AuditLogEvent } from "discord.js";
import { logger } from "../utils/logger";
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
    const onboardEmbed = new EmbedBuilder()
      .setColor(0x5865f2) // Discord Blurple
      .setTitle("👋 Hello, I'm NoCrypto!")
      .setDescription(
        `Thanks for adding me to your server${inviterId ? `, <@${inviterId}>` : ""}! I am a security scanner powered by Google Gemini, designed to automatically detect and eliminate common scam patterns such as phishing links, fake Nitro giveaways, and malicious images before they compromise your community.`
      )
      .addFields(
        {
          name: "🚀 1. Set Up an Admin Log Channel (Highly Recommended)",
          value: "Use `/config` to open the interactive settings panel and set a private admin channel where I will log detailed scam alerts, confidence ratings, and actions taken."
        },
        {
          name: "⚙️ 2. Review Your Settings",
          value: "The `/config` panel shows your full configuration at a glance. Default settings scan both links and images with a 70% confidence threshold."
        },
        {
          name: "⛔ 3. Configure Tiered Punishments",
          value: "Customize what happens when scams are flagged from the **Punishments** section in `/config`:\n• Single infraction: delete-only or 1-hour timeout\n• Spambot mode: 24h timeout, kick, or ban for active spambots\n• Spam threshold: number of fast infractions to trigger spambot mode"
        },
        {
          name: "⚠️ 4. Role Hierarchy Check",
          value: "To allow me to execute timeouts, kicks, or bans, please go to **Server Settings -> Roles** and drag my bot role **above** your standard member roles."
        }
      )
      .setFooter({ text: `Made with ❤️ by LEveLiQ | v${packageJson.version}` });

    await targetChannel.send({ embeds: [onboardEmbed] });
    logger.success(`Successfully sent onboarding message to ${guild.name} in #${targetChannel.name}`, "CLIENT");
  } catch (err) {
    logger.error(`Failed to send onboarding message in ${guild.name}:`, err, "CLIENT");
  }
}
