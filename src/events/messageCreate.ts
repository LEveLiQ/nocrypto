import {
  Message,
  EmbedBuilder,
  TextChannel,
  PermissionsBitField,
  Client,
  GuildMember,
} from "discord.js";
import { logger } from "../utils/logger";
import { scanMessageForScam } from "../utils/gemini";
import { guild_config } from "../utils/database";
import packageJson from "../../package.json";
import * as crypto from "crypto";

// ─── Infraction Tracking ───────────────────────────────────────────
// Tracks per-user scam infractions in a 5-minute sliding window to
// distinguish single violations from active spambot attacks.

export interface UserInfraction {
  count: number;
  firstSeen: number;
  channels: Set<string>;
}

export const INFRACTION_WINDOW = 5 * 60 * 1000; // 5 minutes
export const userInfractions = new Map<string, UserInfraction>();

export function recordInfraction(userId: string, channelId: string): UserInfraction {
  const now = Date.now();

  // Prune expired entries
  for (const [uid, record] of userInfractions.entries()) {
    if (now - record.firstSeen > INFRACTION_WINDOW) {
      userInfractions.delete(uid);
    }
  }

  let record = userInfractions.get(userId);
  if (!record || now - record.firstSeen > INFRACTION_WINDOW) {
    // Start a fresh window
    record = { count: 0, firstSeen: now, channels: new Set() };
    userInfractions.set(userId, record);
  }

  record.count++;
  record.channels.add(channelId);
  return record;
}

export function classifyOffender(record: UserInfraction, spamThreshold: number): { isSpammer: boolean; label: string } {
  if (spamThreshold <= 0) {
    return { isSpammer: false, label: "Single Infraction" };
  }
  if (record.channels.size > 1) {
    return { isSpammer: true, label: `Active Spammer (${record.channels.size} channels, ${record.count} infractions)` };
  }
  if (record.count >= spamThreshold) {
    return { isSpammer: true, label: `Repeat Offender (${record.count} infractions in same channel)` };
  }
  return { isSpammer: false, label: "Single Infraction" };
}

export interface CacheEntry {
  promise: Promise<any>;
  timestamp: number;
  logMessageId?: string;
  flaggedChannels?: string[];
}

export const scanCache = new Map<string, CacheEntry>();
export const CACHE_TTL = 3 * 60 * 1000; // 3 minutes in-memory cache

export async function onMessageCreate(message: Message, client: Client) {
  // 1. Ignore bot messages to prevent infinite loops
  if (message.author.bot) return;

  // 2. Must be in a guild
  if (!message.guild) return;

  const guildId = message.guild.id;
  const config = guild_config.getConfig(guildId);

  // 3. Check if this channel is excluded from scanning
  const excludedChannels: string[] = JSON.parse(config.excluded_channels);
  if (excludedChannels.includes(message.channelId)) return;

  // 4. Check if the author has an excluded role
  const excludedRoles: string[] = JSON.parse(config.excluded_roles);
  if (excludedRoles.length > 0 && message.member) {
    const hasExcludedRole = message.member.roles.cache.some((role) =>
      excludedRoles.includes(role.id)
    );
    if (hasExcludedRole) return;
  }

  // 5. Determine scanning decisions from per-guild config
  const SCAN_IMAGES = !!config.scan_images;
  const SCAN_LINKS = !!config.scan_links;
  const CONFIDENCE_THRESHOLD = config.confidence_threshold;
  const logChannelId = config.log_channel_id;

  // 6. Identify image attachments AND image URLs embedded in message text
  const imageAttachments = message.attachments.filter((attachment) =>
    attachment.contentType?.startsWith("image/") || false
  );

  // Extract image URLs from message text (e.g. https://i.imgur.com/scam.png)
  const IMAGE_URL_REGEX = /https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|bmp|tiff?)(?:[?#][^\s]*)?/gi;
  const linkedImageUrls: string[] = SCAN_IMAGES
    ? (message.content?.match(IMAGE_URL_REGEX) || []).map((url) => url.replace(/[)>\]]+$/, "")) // strip trailing markdown/html chars
    : [];

  const urlRegex = /https?:\/\/[^\s]+/i;
  const hasUrl = urlRegex.test(message.content || "");
  const hasImage = imageAttachments.size > 0 || linkedImageUrls.length > 0;

  const shouldScanImage = hasImage && SCAN_IMAGES;
  const shouldScanLink = hasUrl && SCAN_LINKS;

  // OPTIMIZATION: Only query Gemini if the message contains a scan-enabled media type.
  if (!shouldScanImage && !shouldScanLink) {
    return;
  }

  // 7. De-duplication & Request Coalescing Cache
  const linkMatch = shouldScanLink ? message.content.match(/https?:\/\/[^\s]+/i) : null;
  const linkKey = linkMatch ? linkMatch[0].toLowerCase() : null;

  let textKey: string | null = null;
  if (message.content && message.content.trim().length > 0) {
    textKey = "txt_" + crypto
      .createHash("md5")
      .update(message.content.trim().toLowerCase())
      .digest("hex");
  }

  // Build individual image cache keys (attachments + linked images)
  const imageKeys: string[] = [];
  if (shouldScanImage && imageAttachments.size > 0) {
    imageAttachments.forEach((att) => {
      imageKeys.push(`img_${att.size}_${att.name}`);
    });
  }
  if (shouldScanImage && linkedImageUrls.length > 0) {
    linkedImageUrls.forEach((url) => {
      imageKeys.push(`imgurl_${url.toLowerCase()}`);
    });
  }

  const allKeys: string[] = [];
  if (linkKey) allKeys.push(linkKey);
  if (textKey) allKeys.push(textKey);
  imageKeys.forEach((key) => allKeys.push(key));

  if (allKeys.length === 0) {
    return;
  }

  // Cleanup expired entries
  const now = Date.now();
  for (const [key, entry] of scanCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      scanCache.delete(key);
    }
  }

  // Look for any existing cache hit among the link or individual images
  let hitKey: string | null = null;
  let existingEntry: CacheEntry | null = null;

  for (const key of allKeys) {
    if (scanCache.has(key)) {
      hitKey = key;
      existingEntry = scanCache.get(key)!;
      break;
    }
  }

  // Merge attachment image URLs and linked image URLs for visual scanning
  const imageUrls = [
    ...imageAttachments.map((att) => att.url),
    ...linkedImageUrls,
  ];
  const textContent = message.content;
  let scanPromise;

  if (existingEntry && hitKey) {
    logger.info(`DEDUPLICATOR: Coalesced request, reusing scan due to cache hit on individual key: ${hitKey}`, "MONITOR");
    scanPromise = existingEntry.promise;
    if (existingEntry.flaggedChannels && !existingEntry.flaggedChannels.includes(message.channelId)) {
      existingEntry.flaggedChannels.push(message.channelId);
    }

    // Ensure all other keys of this message are also mapped to this existing entry
    for (const key of allKeys) {
      if (!scanCache.has(key)) {
        scanCache.set(key, existingEntry);
      }
    }
  } else {
    const keysSummary = allKeys.join(", ");
    logger.info(`DEDUPLICATOR: Cache miss, starting new scan for key(s): [${keysSummary}]`, "MONITOR");

    scanPromise = scanMessageForScam(textContent, imageUrls, CONFIDENCE_THRESHOLD);
    const newEntry: CacheEntry = {
      promise: scanPromise,
      timestamp: now,
      flaggedChannels: [message.channelId],
    };

    // Store the scan promise under every individual key
    for (const key of allKeys) {
      scanCache.set(key, newEntry);
    }
  }

  // 8. Process the scan result
  try {
    const scanResult = await scanPromise;

    if (scanResult.isScam && scanResult.confidence >= CONFIDENCE_THRESHOLD) {
      logger.warn(`Scam detected in guild ${message.guild?.name} by ${message.author.tag}! Action required.`, "MONITOR");

      // A. Record infraction and classify the offender
      const infraction = recordInfraction(message.author.id, message.channelId);
      const classification = classifyOffender(infraction, config.spam_threshold);
      const punishmentAction = classification.isSpammer
        ? config.punishment_spam
        : config.punishment_single;

      logger.info(`Classification: ${classification.label} → Punishment: ${punishmentAction}`, "MONITOR");

      // B. Delete the scam message
      let messageDeleted = false;

      const botPermissions = !message.guild ? null : message.guild.members.me?.permissionsIn(message.channel as any);
      const canDelete = botPermissions?.has(PermissionsBitField.Flags.ManageMessages) ?? true;

      if (canDelete) {
        try {
          await message.delete();
          messageDeleted = true;
          logger.success(`Successfully deleted scam message sent by ${message.author.tag}.`, "MONITOR");
        } catch (err) {
          logger.error(`Failed to delete message:`, err, "MONITOR");
        }
      } else {
        logger.warn(`Lacking 'ManageMessages' permission to delete scam message in channel: ${message.channelId}`, "MONITOR");
      }

      // C. Execute the punishment
      let punishmentResult = "None";
      const member = message.member;

      if (punishmentAction !== "none" && member) {
        punishmentResult = await executePunishment(member, message.guild!, punishmentAction, classification, scanResult.reason);
      }

      // D. Send warning to the channel where it occurred
      try {
        const punishmentLabel = punishmentAction === "none" ? "" : ` The user has been **${getPunishmentPastTense(punishmentAction)}**.`;
        const warningEmbed = new EmbedBuilder()
          .setColor(classification.isSpammer ? 0xcc0000 : 0xff3333)
          .setTitle(classification.isSpammer ? "🚨 Spambot Attack Detected" : "⚠️ Scam / Malicious Content Detected")
          .setDescription(
            `A message sent by **${message.author.username}** was flagged as a scam and has been automatically removed to protect the server.${punishmentLabel}`
          )
          .addFields({ name: "Reason", value: scanResult.reason })
          .setFooter({ text: `NoCrypto v${packageJson.version}` });

        const warnMessage = await (message.channel as TextChannel).send({ embeds: [warningEmbed] });

        // Auto-delete the warning message after 10 seconds
        setTimeout(async () => {
          try {
            await warnMessage.delete();
          } catch (e) {
            // Quietly ignore if warning message was already deleted
          }
        }, 10000);
      } catch (err) {
        logger.error(`Could not send warning message to channel ${message.channelId}:`, err, "MONITOR");
      }

      // E. Send a detailed log to the dedicated admin log channel (if configured)
      if (logChannelId) {
        try {
          const logChannel = await client.channels.fetch(logChannelId) as TextChannel;
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
                : `<#${message.channelId}>`;

              if (entry.logMessageId && entry.logMessageId !== "pending") {
                // Dynamically edit existing log embed instead of flooding the channel
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
                        return { name: "Classification", value: classification.label, inline: false };
                      }
                      if (f.name === "Punishment") {
                        return { name: "Punishment", value: punishmentResult, inline: true };
                      }
                      return f;
                    });

                    updatedEmbed.setFields(fields);

                    // Escalate embed appearance if user has been reclassified as a spammer
                    if (classification.isSpammer) {
                      updatedEmbed.setColor(0x8b0000);
                      updatedEmbed.setTitle("🚨 Spambot Attack Flagged");
                    }

                    await existingLogMsg.edit({ embeds: [updatedEmbed] });
                    logger.success(`DEDUPLICATOR: Updated existing log message with escalated classification: ${entry.logMessageId}`, "MONITOR");
                  }
                } catch (editErr) {
                  logger.error("Failed to edit existing log message, sending a new one:", editErr, "MONITOR");
                }
              } else {
                // First log! Block duplicate attempts by setting to pending while sending
                entry.logMessageId = "pending";

                const logEmbed = new EmbedBuilder()
                  .setColor(classification.isSpammer ? 0x8b0000 : 0xdc3545)
                  .setTitle(classification.isSpammer ? "🚨 Spambot Attack Flagged" : "🚨 Scam Alert Flagged")
                  .addFields(
                    { name: "Sender", value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
                    { name: "User ID", value: message.author.id, inline: true },
                    { name: "Channels", value: channelsList, inline: false },
                    { name: "Confidence", value: `${(scanResult.confidence * 100).toFixed(0)}%`, inline: true },
                    { name: "Status", value: messageDeleted ? "Deleted" : "Deletion Failed / No Permission", inline: true },
                    { name: "Classification", value: classification.label, inline: false },
                    { name: "Punishment", value: punishmentResult, inline: true },
                    { name: "Reason", value: scanResult.reason }
                  )
                  .setFooter({ text: `NoCrypto v${packageJson.version}` });

                if (textContent) {
                  const maxContentLength = 1024 - 9; // 1015 (accounting for codeblock markup)
                  const truncatedText = textContent.length > maxContentLength
                    ? textContent.substring(0, maxContentLength - 3) + "..."
                    : textContent;
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
                logger.success(`Logged new scam alert to channel ${logChannelId} (Msg ID: ${sentMsg.id}).`, "MONITOR");
              }
            }
          }
        } catch (err) {
          logger.error(`Failed to send/edit log in admin log channel ${logChannelId}:`, err, "MONITOR");
        }
      }
    }
  } catch (error) {
    logger.error("Error processing message:", error, "MONITOR");
  }
}

// ─── Punishment Helpers ─────────────────────────────────────────────

export async function executePunishment(
  member: GuildMember,
  guild: Message["guild"] & {},
  action: string,
  classification: { isSpammer: boolean; label: string },
  reason: string
): Promise<string> {
  const botMember = guild.members.me;
  if (!botMember) return "❌ Bot member not found in guild";

  // Role hierarchy check: bot must be higher than the target
  if (member.roles.highest.position >= botMember.roles.highest.position) {
    logger.warn(`Cannot punish ${member.user.tag}: their highest role is equal to or above the bot's.`, "PUNISH");
    return "⚠️ Skipped (User's role is too high)";
  }

  // Don't punish the server owner
  if (member.id === guild.ownerId) {
    logger.warn(`Cannot punish ${member.user.tag}: they are the server owner.`, "PUNISH");
    return "⚠️ Skipped (Server Owner)";
  }

  const punishReason = `[NoCrypto] ${classification.label}: ${reason}`;

  try {
    switch (action) {
      case "timeout": {
        const duration = classification.isSpammer
          ? 24 * 60 * 60 * 1000  // 24 hours for spambots
          : 1 * 60 * 60 * 1000;  // 1 hour for single infraction
        const label = classification.isSpammer ? "24 hours" : "1 hour";

        if (!botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return "❌ Missing ModerateMembers permission";
        }
        await member.timeout(duration, punishReason);
        logger.success(`Timed out ${member.user.tag} for ${label}.`, "PUNISH");
        return `🟡 Timed Out (${label})`;
      }
      case "kick": {
        if (!botMember.permissions.has(PermissionsBitField.Flags.KickMembers)) {
          return "❌ Missing KickMembers permission";
        }
        await member.kick(punishReason);
        logger.success(`Kicked ${member.user.tag} from the server.`, "PUNISH");
        return "🔴 Kicked";
      }
      case "ban": {
        if (!botMember.permissions.has(PermissionsBitField.Flags.BanMembers)) {
          return "❌ Missing BanMembers permission";
        }
        await member.ban({ reason: punishReason, deleteMessageSeconds: 86400 }); // also purge 24h of messages
        logger.success(`Banned ${member.user.tag} from the server.`, "PUNISH");
        return "⛔ Banned";
      }
      default:
        return "None";
    }
  } catch (err) {
    logger.error(`Failed to execute punishment '${action}' on ${member.user.tag}:`, err, "PUNISH");
    return `❌ Failed (${action})`;
  }
}

export function getPunishmentPastTense(action: string): string {
  switch (action) {
    case "timeout": return "timed out";
    case "kick": return "kicked";
    case "ban": return "banned";
    default: return "punished";
  }
}
