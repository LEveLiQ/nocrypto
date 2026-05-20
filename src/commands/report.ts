import {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  MessageContextMenuCommandInteraction,
  EmbedBuilder,
  TextChannel,
  PermissionsBitField,
  Collection,
} from "discord.js";
import { scanMessageForScam } from "../utils/gemini";
import { guild_config } from "../utils/database";
import { logger } from "../utils/logger";
import {
  recordInfraction,
  classifyOffender,
  executePunishment,
  getPunishmentPastTense,
  scanCache,
  CACHE_TTL,
  INFRACTION_WINDOW,
  userInfractions,
} from "../events/messageCreate";
import packageJson from "../../package.json";
import * as crypto from "crypto";

// Define the "Report to NoCrypto" message context command
export const reportCommand = new ContextMenuCommandBuilder()
  .setName("Report to NoCrypto")
  .setType(ApplicationCommandType.Message);

// Tracking report cooldowns per server
const reportCooldowns = new Map<string, number>();
const COOLDOWN_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * Handles the "Report to NoCrypto" Message context menu interaction.
 */
export async function handleReportCommand(interaction: MessageContextMenuCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId || !interaction.guild) {
    await interaction.reply({
      content: "❌ This command can only be used within a server.",
      ephemeral: true,
    });
    return;
  }

  // Enforce a 1-hour global cooldown per server to protect Gemini API costs
  const now = Date.now();
  const lastReport = reportCooldowns.get(guildId);
  const isModerator = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) || 
                      interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages);

  if (!isModerator && lastReport && (now - lastReport) < COOLDOWN_DURATION) {
    const timeLeft = COOLDOWN_DURATION - (now - lastReport);
    const minutesLeft = Math.ceil(timeLeft / (60 * 1000));
    await interaction.reply({
      content: `⏱️ **Server Cooldown Active:** To protect API quotas, manual scam reporting is limited to once per hour for regular members. Try again in **${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}**.\n*(Server Administrators and Moderators bypass this cooldown)*`,
      ephemeral: true,
    });
    return;
  }

  // Set report cooldown timestamp for regular users
  if (!isModerator) {
    reportCooldowns.set(guildId, now);
  }

  // Defer the reply ephemerally to give Gemini enough time to process
  await interaction.deferReply({ ephemeral: true });

  const targetMessage = interaction.targetMessage;
  const content = targetMessage.content || "";
  const attachments = targetMessage.attachments;

  // Identify image attachments
  const imageAttachments = attachments.filter((attachment) =>
    attachment.contentType?.startsWith("image/") || false
  );

  // Extract image URLs from message text (e.g. https://i.imgur.com/scam.png)
  const IMAGE_URL_REGEX = /https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|bmp|tiff?)(?:[?#][^\s]*)?/gi;
  const linkedImageUrls: string[] = (content.match(IMAGE_URL_REGEX) || []).map((url) => url.replace(/[)>\]]+$/, "")); // strip trailing markdown/html chars

  // Merge attachment image URLs and linked image URLs for visual scanning
  const imageUrls = [
    ...imageAttachments.map((att) => att.url),
    ...linkedImageUrls,
  ];

  logger.info(`On-demand manual report scan initiated by ${interaction.user.tag} for message sent by ${targetMessage.author.tag} (Msg ID: ${targetMessage.id}).`, "MONITOR");

  const config = guild_config.getConfig(guildId);
  const confidenceThreshold = config.confidence_threshold;
  const logChannelId = config.log_channel_id;

  // 1. Build cache keys (including MD5 text hash to cover linkless messages!)
  const linkMatch = content.match(/https?:\/\/[^\s]+/i);
  const linkKey = linkMatch ? linkMatch[0].toLowerCase() : null;

  let textKey: string | null = null;
  if (content && content.trim().length > 0) {
    textKey = "txt_" + crypto
      .createHash("md5")
      .update(content.trim().toLowerCase())
      .digest("hex");
  }

  const imageKeys: string[] = [];
  imageAttachments.forEach((att) => {
    imageKeys.push(`img_${att.size}_${att.name}`);
  });
  linkedImageUrls.forEach((url) => {
    imageKeys.push(`imgurl_${url.toLowerCase()}`);
  });

  const allKeys: string[] = [];
  if (linkKey) allKeys.push(linkKey);
  if (textKey) allKeys.push(textKey);
  imageKeys.forEach((key) => allKeys.push(key));

  if (allKeys.length === 0) {
    // Ultimate fallback to message ID if message has no contents at all
    allKeys.push(`msg_${targetMessage.id}`);
  }

  // 2. Cleanup expired cache entries
  for (const [key, entry] of scanCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      scanCache.delete(key);
    }
  }

  // 3. Check for cache hits across all keys
  let hitKey: string | null = null;
  let existingEntry = null;

  for (const key of allKeys) {
    if (scanCache.has(key)) {
      hitKey = key;
      existingEntry = scanCache.get(key)!;
      break;
    }
  }

  let scanPromise;

  if (existingEntry && hitKey) {
    logger.info(`DEDUPLICATOR: Coalescing manual report, reusing scan due to cache hit on key: ${hitKey}`, "MONITOR");
    scanPromise = existingEntry.promise;
    if (existingEntry.flaggedChannels && !existingEntry.flaggedChannels.includes(targetMessage.channelId)) {
      existingEntry.flaggedChannels.push(targetMessage.channelId);
    }

    // Bind all other keys to this existing entry
    for (const key of allKeys) {
      if (!scanCache.has(key)) {
        scanCache.set(key, existingEntry);
      }
    }
  } else {
    logger.info(`DEDUPLICATOR: Manual report cache miss, initiating new Gemini scan...`, "MONITOR");
    scanPromise = scanMessageForScam(content, imageUrls, confidenceThreshold);
    const newEntry = {
      promise: scanPromise,
      timestamp: now,
      flaggedChannels: [targetMessage.channelId],
      logMessageId: undefined as string | undefined,
    };

    for (const key of allKeys) {
      scanCache.set(key, newEntry);
    }
  }

  try {
    // Await scan result (shared promise if coalesced)
    const result = await scanPromise;

    if (result.isScam && result.confidence >= confidenceThreshold) {
      logger.warn(`On-demand scan flagged scam: Guild ${interaction.guild.name} | Sender: ${targetMessage.author.tag} | Reported by: ${interaction.user.tag}.`, "MONITOR");

      // A. Delete the manually reported scam message
      let messageDeleted = false;
      const botPermissions = interaction.guild.members.me?.permissionsIn(interaction.channel as any);
      const canDelete = botPermissions?.has(PermissionsBitField.Flags.ManageMessages) ?? true;

      if (canDelete) {
        try {
          await targetMessage.delete();
          messageDeleted = true;
          logger.success(`Successfully deleted manually reported scam message.`, "MONITOR");
        } catch (err) {
          logger.error(`Failed to delete reported message:`, err, "MONITOR");
        }
      } else {
        logger.warn(`Lacking 'ManageMessages' permission to delete scam message in channel: ${interaction.channelId}`, "MONITOR");
      }

      // B. Record the infraction for the reported message
      recordInfraction(targetMessage.author.id, targetMessage.channelId);

      // C. Retroactive threat sweep over the 5-minute sliding window (INFRACTION_WINDOW)
      const entry = scanCache.get(allKeys[0]);
      const sweepResult = await sweepRecentMessagesFromOffender(
        interaction,
        targetMessage.author.id,
        targetMessage.id,
        INFRACTION_WINDOW,
        confidenceThreshold,
        entry?.flaggedChannels
      );

      // D. Classify the offender using the fully swept infraction history
      const infraction = userInfractions.get(targetMessage.author.id)!;
      const classification = classifyOffender(infraction, config.spam_threshold);
      const punishmentAction = classification.isSpammer
        ? config.punishment_spam
        : config.punishment_single;

      logger.info(`Classification for offender after threat sweep: ${classification.label} → Punishment: ${punishmentAction}`, "MONITOR");

      // E. Execute final server punishment
      let punishmentResult = "None";
      const member = targetMessage.member || await interaction.guild.members.fetch(targetMessage.author.id).catch(() => null);

      if (punishmentAction !== "none" && member) {
        punishmentResult = await executePunishment(
          member,
          interaction.guild,
          punishmentAction,
          classification,
          `[Manually Reported & Swept by ${interaction.user.tag}] ${result.reason}`
        );
      }

      // F. Send warning to the channel where the message was reported
      try {
        const punishmentLabel = punishmentAction === "none" ? "" : ` The user has been **${getPunishmentPastTense(punishmentAction)}**.`;
        const sweepLabel = sweepResult.deletedCount > 0 
          ? ` Retroactively swept all channels and removed **${sweepResult.deletedCount}** other scam messages.` 
          : "";
        const warningEmbed = new EmbedBuilder()
          .setColor(classification.isSpammer ? 0xcc0000 : 0xff3333)
          .setTitle(classification.isSpammer ? "🚨 Spambot Attack Detected" : "⚠️ Scam / Malicious Content Detected")
          .setDescription(
            `A message sent by **${targetMessage.author.username}** was flagged as a scam (manually reported by a member) and has been automatically removed to protect the server.${sweepLabel}${punishmentLabel}`
          )
          .addFields({ name: "Reason", value: result.reason })
          .setFooter({ text: `NoCrypto v${packageJson.version}` });

        const warnMessage = await (interaction.channel as TextChannel).send({ embeds: [warningEmbed] });

        // Auto-delete the warning message after 10 seconds
        setTimeout(async () => {
          try {
            await warnMessage.delete();
          } catch (e) {
            // Ignore if warning message was already deleted
          }
        }, 10000);
      } catch (err) {
        logger.error(`Could not send warning message to channel ${interaction.channelId}:`, err, "MONITOR");
      }

      // G. Send / edit detailed log in admin log channel
      if (logChannelId) {
        try {
          const logChannel = await interaction.client.channels.fetch(logChannelId) as TextChannel;
          if (logChannel && logChannel.isTextBased()) {
            const entry = scanCache.get(allKeys[0]);

            if (entry) {
              // Lock / Queue to handle concurrent thread race conditions
              if (entry.logMessageId === "pending") {
                let waitAttempts = 10;
                while (entry.logMessageId === "pending" && waitAttempts > 0) {
                  await new Promise((resolve) => setTimeout(resolve, 500));
                  waitAttempts--;
                }
              }

              const channelsList = entry.flaggedChannels
                ? entry.flaggedChannels.map((cid) => `<#${cid}>`).join(", ")
                : `<#${targetMessage.channelId}>`;

              if (entry.logMessageId && entry.logMessageId !== "pending") {
                // Dynamically edit existing log embed
                try {
                  const existingLogMsg = await logChannel.messages.fetch(entry.logMessageId);
                  const existingEmbed = existingLogMsg.embeds[0];

                  if (existingEmbed) {
                    const updatedEmbed = EmbedBuilder.from(existingEmbed);

                    const fields = existingEmbed.fields.map((f) => {
                      if (f.name === "Channel" || f.name === "Channels") {
                        return { name: "Channels", value: channelsList, inline: false };
                      }
                      if (f.name === "Status") {
                        return { name: "Status", value: "Deleted (All Spans)", inline: true };
                      }
                      if (f.name === "Classification") {
                        return { name: "Classification", value: `${classification.label} (Manual Report + Threat Sweep)`, inline: false };
                      }
                      if (f.name === "Punishment") {
                        return { name: "Punishment", value: punishmentResult, inline: true };
                      }
                      return f;
                    });

                    updatedEmbed.setFields(fields);

                    if (classification.isSpammer) {
                      updatedEmbed.setColor(0x8b0000);
                      updatedEmbed.setTitle("🚨 Spambot Attack Flagged (Manual Report + Threat Sweep)");
                    }

                    await existingLogMsg.edit({ embeds: [updatedEmbed] });
                    logger.success(`DEDUPLICATOR: Updated manual report log message with sweep details: ${entry.logMessageId}`, "MONITOR");
                  }
                } catch (editErr) {
                  logger.error("Failed to edit existing log message, sending a new one:", editErr, "MONITOR");
                }
              } else {
                entry.logMessageId = "pending";

                const logEmbed = new EmbedBuilder()
                  .setColor(classification.isSpammer ? 0x8b0000 : 0xdc3545)
                  .setTitle(classification.isSpammer ? "🚨 Spambot Attack Flagged (Manual Report + Sweep)" : "🚨 Scam Alert Flagged (Manual Report)")
                  .addFields(
                    { name: "Sender", value: `${targetMessage.author.tag} (<@${targetMessage.author.id}>)`, inline: true },
                    { name: "Reporter", value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                    { name: "Channels", value: channelsList, inline: false },
                    { name: "Confidence", value: `${(result.confidence * 100).toFixed(0)}%`, inline: true },
                    { name: "Status", value: messageDeleted ? "Deleted" : "Deletion Failed / No Permission", inline: true },
                    { name: "Classification", value: `${classification.label} (Manual Report + Threat Sweep)`, inline: false },
                    { name: "Punishment", value: punishmentResult, inline: true },
                    { name: "Reason", value: result.reason }
                  )
                  .setFooter({ text: `NoCrypto v${packageJson.version}` });

                if (sweepResult.deletedCount > 0) {
                  logEmbed.addFields({ name: "Threat Sweep Clean-up", value: `Successfully deleted **${sweepResult.deletedCount}** other copies of this scam in active channels.` });
                }

                if (content) {
                  const maxContentLength = 1024 - 9; // 1015 (accounting for codeblock markup)
                  const truncatedText = content.length > maxContentLength
                    ? content.substring(0, maxContentLength - 3) + "..."
                    : content;
                  logEmbed.addFields({ name: "Message Content", value: `\`\`\`\n${truncatedText}\n\`\`\`` });
                }

                if (imageAttachments.size > 0) {
                  const imageLinks = Array.from(imageAttachments.values())
                    .map((att, idx) => `[Image ${idx + 1}](${att.url})`)
                    .join(", ");
                  logEmbed.addFields({ name: "Flagged Image Files", value: imageLinks });

                  const firstImage = imageAttachments.first();
                  if (firstImage) {
                    logEmbed.setImage(firstImage.url);
                  }
                }

                const sentMsg = await logChannel.send({ embeds: [logEmbed] });
                entry.logMessageId = sentMsg.id;
                logger.success(`Logged manual report scam alert with threat sweep to channel ${logChannelId} (Msg ID: ${sentMsg.id}).`, "MONITOR");
              }
            }
          }
        } catch (err) {
          logger.error(`Failed to send log in admin log channel ${logChannelId}:`, err, "MONITOR");
        }
      }

      // H. Ephemerally reply to the reporter confirming it was handled and clean-up details
      const sweepReportLabel = sweepResult.deletedCount > 0 
        ? `\n\n🧹 **Retroactive Threat Sweep:** Successfully scanned active server channels and purged **${sweepResult.deletedCount}** other copies of this scam!` 
        : "";
      await interaction.editReply({
        content: `⚠️ **Scam Detected!**\nThe message from **${targetMessage.author.username}** was flagged as a scam with **${(result.confidence * 100).toFixed(0)}%** confidence and has been automatically removed.${sweepReportLabel}\n\n**Reason:** *${result.reason}*`,
      });
    } else {
      // Safe! Ephemerally reply to the reporter
      logger.info(`On-demand scan marked message SAFE: Guild ${interaction.guild.name} | Sender: ${targetMessage.author.tag} | Reported by: ${interaction.user.tag}.`, "MONITOR");

      await interaction.editReply({
        content: `✅ **No Scam Detected**\nWe analyzed the reported message and it appears to be safe.\n\n**Safety Confidence:** **${(100 - result.confidence * 100).toFixed(0)}%** safe.\n**Analysis Reason:** *${result.reason}*`,
      });
    }
  } catch (error) {
    logger.error("Error executing manual report scam scan:", error, "MONITOR");
    await interaction.editReply({
      content: `❌ **Scan Failed:** An error occurred while processing the report: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * Retroactively sweeps and scans other recent messages sent by the offender across all text channels
 * within a consistent sliding timeline (INFRACTION_WINDOW / 5 minutes).
 */
async function sweepRecentMessagesFromOffender(
  interaction: MessageContextMenuCommandInteraction,
  offenderId: string,
  targetMsgId: string,
  timeframeMs: number,
  confidenceThreshold: number,
  flaggedChannels?: string[]
): Promise<{ sweptCount: number; deletedCount: number }> {
  logger.info(`RETROACTIVE SWEEP: Initiating sweep for user ${offenderId} messages sent in the last 5 minutes...`, "MONITOR");

  const guild = interaction.guild!;
  
  // Get all text-based channels in the guild
  const textChannels = guild.channels.cache.filter((c) => c.isTextBased()) as Collection<string, TextChannel>;
  
  let sweptCount = 0;
  let deletedCount = 0;

  const sweepPromises = Array.from(textChannels.values()).map(async (channel) => {
    // Check bot read/write permissions
    const botPermissions = guild.members.me?.permissionsIn(channel);
    if (!botPermissions?.has(PermissionsBitField.Flags.ViewChannel) || 
        !botPermissions?.has(PermissionsBitField.Flags.ReadMessageHistory)) {
      return;
    }

    try {
      const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      if (!messages) return;

      const userMessages = messages.filter((msg) => 
        msg.author.id === offenderId && 
        msg.id !== targetMsgId && 
        (Date.now() - msg.createdTimestamp) <= timeframeMs
      );

      for (const msg of userMessages.values()) {
        sweptCount++;
        const content = msg.content || "";
        const imageAttachments = msg.attachments.filter((att) => att.contentType?.startsWith("image/") || false);

        // Also extract image URLs from message text
        const SWEEP_IMAGE_URL_REGEX = /https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|bmp|tiff?)(?:[?#][^\s]*)?/gi;
        const sweepLinkedImageUrls: string[] = (content.match(SWEEP_IMAGE_URL_REGEX) || []).map((url) => url.replace(/[)>\]]+$/, ""));

        const imageUrls = [
          ...imageAttachments.map((att) => att.url),
          ...sweepLinkedImageUrls,
        ];

        // Scan the message (uses our shared memory cache, making duplicate scans instant/free!)
        const scanResult = await scanMessageForScam(content, imageUrls, confidenceThreshold);

        if (scanResult.isScam && scanResult.confidence >= confidenceThreshold) {
          // A. Record infraction in that channel to update sliding infraction window
          recordInfraction(offenderId, channel.id);

          if (flaggedChannels && !flaggedChannels.includes(channel.id)) {
            flaggedChannels.push(channel.id);
          }

          // B. Delete the spam message
          if (botPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
            try {
              await msg.delete();
              deletedCount++;
              logger.success(`RETROACTIVE SWEEP: Deleted duplicate scam message ${msg.id} in channel <#${channel.id}>.`, "MONITOR");
            } catch (err) {
              logger.error(`RETROACTIVE SWEEP: Failed to delete duplicate message ${msg.id}:`, err, "MONITOR");
            }
          }
        }
      }
    } catch (err) {
      logger.error(`RETROACTIVE SWEEP: Error sweeping channel ${channel.id}:`, err, "MONITOR");
    }
  });

  await Promise.all(sweepPromises);
  logger.success(`RETROACTIVE SWEEP: Sweep complete. Swept ${sweptCount} messages, purged ${deletedCount} other copies of the scam.`, "MONITOR");
  return { sweptCount, deletedCount };
}
