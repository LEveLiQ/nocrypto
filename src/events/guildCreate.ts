import { Guild, EmbedBuilder, ChannelType, PermissionsBitField } from "discord.js";
import { logger } from "../utils/logger";
import packageJson from "../../package.json";

export async function onGuildCreate(guild: Guild) {
  logger.info(`Joined new guild: ${guild.name} (ID: ${guild.id})`, "CLIENT");

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
        "Thanks for adding me to your server! I am a security scanner powered by Google Gemini, designed to automatically detect and eliminate common scam patterns such as phishing links, fake Nitro giveaways, and malicious images before they compromise your community."
      )
      .addFields(
        {
          name: "🚀 1. Set Up an Admin Log Channel (Highly Recommended)",
          value: "Register a private admin channel where I will log detailed scam alerts, confidence ratings, and actions taken:\n`/config logchannel channel:#admin-logs`"
        },
        {
          name: "⚙️ 2. Review Your Settings",
          value: "Type `/config view` to see your current setup. Default settings scan both links and images with a 70% confidence threshold."
        },
        {
          name: "⛔ 3. Configure Tiered Punishments",
          value: "Customize what happens when scams are flagged:\n• `/config punishment-single` (e.g., delete-only or 1-hour timeout)\n• `/config punishment-spam` (e.g., 24h timeout, kick, or ban for active spambots)\n• `/config spam-threshold` (number of fast infractions to trigger spambot mode)"
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
