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
import { getLocale, resolveLocaleKey, t, LocaleStrings } from "../i18n";
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

export function classifyOffender(record: UserInfraction, spamThreshold: number, L: LocaleStrings): { isSpammer: boolean; label: string } {
  if (spamThreshold <= 0) {
    return { isSpammer: false, label: L.classifySingle };
  }
  if (record.count >= spamThreshold) {
    return { isSpammer: true, label: t(L.classifyRepeatOffender, record.count) };
  }
  return { isSpammer: false, label: L.classifySingle };
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

  // 3. Resolve locale for this guild
  const localeKey = resolveLocaleKey(config.language, message.guild.preferredLocale);
  const L = getLocale(config.language, message.guild.preferredLocale);

  // Build scan context label for terminal logs
  const channelName = (message.channel as TextChannel).name ?? message.channelId;
  const scanContext = `${message.guild.name} | #${channelName} | @${message.author.tag}`;

  // 4. Check if this channel is excluded from scanning
  const excludedChannels: string[] = JSON.parse(config.excluded_channels);
  if (excludedChannels.includes(message.channelId)) return;

  // 5. Check if the author has an excluded role
  const excludedRoles: string[] = JSON.parse(config.excluded_roles);
  if (excludedRoles.length > 0 && message.member) {
    const hasExcludedRole = message.member.roles.cache.some((role) =>
      excludedRoles.includes(role.id)
    );
    if (hasExcludedRole) return;
  }

  // 6. Check member age threshold if configured
  if (config.scan_member_age_threshold && config.scan_member_age_threshold !== 'all' && message.member) {
    const joinedAt = message.member.joinedAt;
    if (joinedAt) {
      const memberAgeMs = Date.now() - joinedAt.getTime();
      let thresholdMs = 0;
      if (config.scan_member_age_threshold === '1w') {
        thresholdMs = 7 * 24 * 60 * 60 * 1000;
      } else if (config.scan_member_age_threshold === '1m') {
        thresholdMs = 30 * 24 * 60 * 60 * 1000;
      } else if (config.scan_member_age_threshold === '6m') {
        thresholdMs = 180 * 24 * 60 * 60 * 1000;
      }

      if (thresholdMs > 0 && memberAgeMs > thresholdMs) {
        // Member has been in the server longer than the configured threshold - skip scan
        logger.info(`Skipping message scan because they joined the server on ${joinedAt.toDateString()} (threshold: ${config.scan_member_age_threshold})`, "MONITOR", scanContext);
        return;
      }
    }
  }

  // 7. Redact excluded URLs from text content
  const excludedUrls: string[] = JSON.parse(config.excluded_urls);
  let textContent = message.content || "";
  if (excludedUrls.length > 0 && textContent) {
    for (const url of excludedUrls) {
      if (url.trim()) {
        const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedUrl, 'gi');
        textContent = textContent.replace(regex, '[SAFE_LINK_REDACTED]');
      }
    }
  }

  // 8. Determine scanning decisions from per-guild config
  const SCAN_IMAGES = !!config.scan_images;
  const SCAN_LINKS = !!config.scan_links;
  const CONFIDENCE_THRESHOLD = config.confidence_threshold;
  const logChannelId = config.log_channel_id;

  // 9. Identify image attachments AND image URLs embedded in message text
  const imageAttachments = message.attachments.filter((attachment) =>
    attachment.contentType?.startsWith("image/") || false
  );

  // Extract image URLs from message text (e.g. https://i.imgur.com/scam.png)
  const IMAGE_URL_REGEX = /https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|bmp|tiff?)(?:[?#][^\s]*)?/gi;
  const linkedImageUrls: string[] = SCAN_IMAGES
    ? (textContent.match(IMAGE_URL_REGEX) || []).map((url) => url.replace(/[)>\]]+$/, "")) // strip trailing markdown/html chars
    : [];

  const urlRegex = /https?:\/\/[^\s]+/i;
  const hasUrl = urlRegex.test(textContent);
  const hasImage = imageAttachments.size > 0 || linkedImageUrls.length > 0;

  const shouldScanImage = hasImage && SCAN_IMAGES;
  const shouldScanLink = hasUrl && SCAN_LINKS;

  // OPTIMIZATION: Only query Gemini if the message contains a scan-enabled media type.
  if (!shouldScanImage && !shouldScanLink) {
    return;
  }

  // 10. De-duplication & Request Coalescing Cache
  const linkMatch = shouldScanLink ? textContent.match(/https?:\/\/[^\s]+/i) : null;
  const linkKey = linkMatch ? linkMatch[0].toLowerCase() : null;

  let textKey: string | null = null;
  if (textContent.trim().length > 0) {
    textKey = "txt_" + crypto
      .createHash("md5")
      .update(textContent.trim().toLowerCase())
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
  let scanPromise;

  if (existingEntry && hitKey) {
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
    scanPromise = scanMessageForScam(textContent, imageUrls, CONFIDENCE_THRESHOLD, localeKey, scanContext, keysSummary);
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

  // 11. Process the scan result
  try {
    const scanResult = await scanPromise;

    if (scanResult.isScam && scanResult.confidence >= CONFIDENCE_THRESHOLD) {
      // A. Record infraction and classify the offender
      const infraction = recordInfraction(message.author.id, message.channelId);
      const classification = classifyOffender(infraction, config.spam_threshold, L);
      const punishmentAction = classification.isSpammer
        ? config.punishment_spam
        : config.punishment_single;

      logger.warn(`Scam detected: ${classification.label} → ${punishmentAction}`, "MONITOR", scanContext);

      // B. Delete the scam message
      let messageDeleted = false;

      const botPermissions = !message.guild ? null : message.guild.members.me?.permissionsIn(message.channel as any);
      const canDelete = botPermissions?.has(PermissionsBitField.Flags.ManageMessages) ?? true;

      if (canDelete) {
        try {
          await message.delete();
          messageDeleted = true;
          logger.success(`Successfully deleted scam message.`, "MONITOR", scanContext);
        } catch (err) {
          logger.error(`Failed to delete message:`, err, "MONITOR", scanContext);
        }
      } else {
        logger.warn(`Lacking 'ManageMessages' permission to delete scam message.`, "MONITOR", scanContext);
      }

      // C. Execute the punishment
      let punishmentResult = L.punishResultNone;
      const member = message.member;

      if (punishmentAction !== "none" && member) {
        punishmentResult = await executePunishment(member, message.guild!, punishmentAction, classification, scanResult.reason, L);
      }

      // D. Send warning to the channel where it occurred
      try {
        const punishmentLabel = punishmentAction === "none" ? "" : t(L.warnPunishmentSuffix, getPunishmentPastTense(punishmentAction, L));
        const warningEmbed = new EmbedBuilder()
          .setColor(classification.isSpammer ? 0xcc0000 : 0xff3333)
          .setTitle(classification.isSpammer ? L.warnTitleSpammer : L.warnTitleSingle)
          .setDescription(t(L.warnDescription, message.author.username, punishmentLabel))
          .addFields({ name: L.warnFieldReason, value: scanResult.reason })
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
        logger.error(`Could not send warning message to channel.`, err, "MONITOR", scanContext);
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
                      if (f.name === L.logFieldChannels || f.name === "Channel" || f.name === "Channels") {
                        return { name: L.logFieldChannels, value: channelsList, inline: false };
                      }
                      if (f.name === L.logFieldStatus || f.name === "Status") {
                        return { name: L.logFieldStatus, value: L.logStatusDeletedAllSpans, inline: true };
                      }
                      if (f.name === L.logFieldClassification || f.name === "Classification") {
                        return { name: L.logFieldClassification, value: classification.label, inline: false };
                      }
                      if (f.name === L.logFieldPunishment || f.name === "Punishment") {
                        return { name: L.logFieldPunishment, value: punishmentResult, inline: true };
                      }
                      return f;
                    });

                    updatedEmbed.setFields(fields);

                    // Escalate embed appearance if user has been reclassified as a spammer
                    if (classification.isSpammer) {
                      updatedEmbed.setColor(0x8b0000);
                      updatedEmbed.setTitle(L.logTitleSpambotUpdate);
                    }

                    await existingLogMsg.edit({ embeds: [updatedEmbed] });
                  }
                } catch (editErr) {
                  logger.error("Failed to edit existing log message, sending a new one:", editErr, "MONITOR", scanContext);
                }
              } else {
                // First log! Block duplicate attempts by setting to pending while sending
                entry.logMessageId = "pending";

                const logEmbed = new EmbedBuilder()
                  .setColor(classification.isSpammer ? 0x8b0000 : 0xdc3545)
                  .setTitle(classification.isSpammer ? L.logTitleSpambot : L.logTitleScam)
                  .addFields(
                    { name: L.logFieldSender, value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
                    { name: "User ID", value: message.author.id, inline: true },
                    { name: L.logFieldChannels, value: channelsList, inline: false },
                    { name: L.logFieldConfidence, value: `${(scanResult.confidence * 100).toFixed(0)}%`, inline: true },
                    { name: L.logFieldStatus, value: messageDeleted ? L.logStatusDeleted : L.logStatusFailed, inline: true },
                    { name: L.logFieldClassification, value: classification.label, inline: false },
                    { name: L.logFieldPunishment, value: punishmentResult, inline: true },
                    { name: L.logFieldReason, value: scanResult.reason }
                  )
                  .setFooter({ text: `NoCrypto v${packageJson.version}` });

                if (textContent) {
                  const maxContentLength = 1024 - 9; // 1015 (accounting for codeblock markup)
                  const truncatedText = textContent.length > maxContentLength
                    ? textContent.substring(0, maxContentLength - 3) + "..."
                    : textContent;
                  logEmbed.addFields({ name: L.logFieldMessageContent, value: `\`\`\`\n${truncatedText}\n\`\`\`` });
                }

                if (imageAttachments.size > 0) {
                  const imageLinks = Array.from(imageAttachments.values())
                    .map((att, idx) => `[Image ${idx + 1}](${att.url})`)
                    .join(", ");
                  logEmbed.addFields({ name: L.logFieldFlaggedImages, value: imageLinks });

                  const firstImage = imageAttachments.first();
                  if (firstImage) {
                    logEmbed.setImage(firstImage.url);
                  }
                }

                const sentMsg = await logChannel.send({ embeds: [logEmbed] });
                entry.logMessageId = sentMsg.id;
                logger.success(`Logged new scam alert (Msg ID: ${sentMsg.id}).`, "MONITOR", scanContext);
              }
            }
          }
        } catch (err) {
          logger.error(`Failed to send/edit log in admin log channel.`, err, "MONITOR", scanContext);
        }
      }
    }
  } catch (error) {
    logger.error("Error processing message:", error, "MONITOR", scanContext);
  }
}

// ─── Punishment Helpers ─────────────────────────────────────────────

export async function executePunishment(
  member: GuildMember,
  guild: Message["guild"] & {},
  action: string,
  classification: { isSpammer: boolean; label: string },
  reason: string,
  L: LocaleStrings
): Promise<string> {
  const botMember = guild.members.me;
  if (!botMember) return L.punishResultBotNotFound;

  const punishCtx = `${guild.name} | @${member.user.tag}`;

  // Role hierarchy check: bot must be higher than the target
  if (member.roles.highest.position >= botMember.roles.highest.position) {
    logger.warn(`Cannot punish: their highest role is equal to or above the bot's.`, "PUNISH", punishCtx);
    return L.punishResultSkippedRoleHierarchy;
  }

  // Don't punish the server owner
  if (member.id === guild.ownerId) {
    logger.warn(`Cannot punish: they are the server owner.`, "PUNISH", punishCtx);
    return L.punishResultSkippedOwner;
  }

  const punishReason = `[NoCrypto] ${classification.label}: ${reason}`;

  try {
    switch (action) {
      case "timeout": {
        const duration = classification.isSpammer
          ? 24 * 60 * 60 * 1000  // 24 hours for spambots
          : 1 * 60 * 60 * 1000;  // 1 hour for single infraction
        const label = classification.isSpammer ? "24h" : "1h";

        if (!botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return L.punishResultMissingModerate;
        }
        await member.timeout(duration, punishReason);
        logger.success(`Timed out for ${label}.`, "PUNISH", punishCtx);
        return t(L.punishResultTimedOut, label);
      }
      case "kick": {
        if (!botMember.permissions.has(PermissionsBitField.Flags.KickMembers)) {
          return L.punishResultMissingKick;
        }
        await member.kick(punishReason);
        logger.success(`Kicked from the server.`, "PUNISH", punishCtx);
        return L.punishResultKicked;
      }
      case "ban": {
        if (!botMember.permissions.has(PermissionsBitField.Flags.BanMembers)) {
          return L.punishResultMissingBan;
        }
        await member.ban({ reason: punishReason, deleteMessageSeconds: 86400 }); // also purge 24h of messages
        logger.success(`Banned from the server.`, "PUNISH", punishCtx);
        return L.punishResultBanned;
      }
      default:
        return L.punishResultNone;
    }
  } catch (err) {
    logger.error(`Failed to execute punishment '${action}':`, err, "PUNISH", punishCtx);
    return t(L.punishResultFailed, action);
  }
}

export function getPunishmentPastTense(action: string, L: LocaleStrings): string {
  switch (action) {
    case "timeout": return L.punishPastTimeout;
    case "kick": return L.punishPastKick;
    case "ban": return L.punishPastBan;
    default: return L.punishPastDefault;
  }
}
