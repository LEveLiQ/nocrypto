import { Guild, EmbedBuilder, ChannelType, PermissionsBitField, AuditLogEvent } from "discord.js";
import { logger } from "../utils/logger";
import { guild_config } from "../utils/database";
import { getLocale, t, resolveLocaleKey, LocaleStrings } from "../i18n";
import packageJson from "../../package.json";
import { diagnoseAndConfigurePermissions } from "../utils/permissions";

function translatePermission(perm: string, L: LocaleStrings): string {
  switch (perm) {
    case "ModerateMembers": return L.permTimeoutMembers;
    case "KickMembers": return L.permKickMembers;
    case "BanMembers": return L.permBanMembers;
    case "ViewChannel": return L.permViewChannel;
    case "SendMessages": return L.permSendMessages;
    case "ManageMessages": return L.permManageMessages;
    case "ReadMessageHistory": return L.permReadMessageHistory;
    default: return perm;
  }
}

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
        logger.warn(`Failed to fetch audit logs for inviter: ${err}`, "CLIENT", guild.name);
      }
    } else {
      missingPermission = true;
    }
  }

  const logInviterSuffix = inviterTag !== "Unknown User" 
    ? ` (Invited by: @${inviterTag})` 
    : (missingPermission ? " (Missing 'ViewAuditLog' permission to fetch inviter)" : "");

  logger.info(`Joined new guild (ID: ${guild.id})${logInviterSuffix}`, "CLIENT", guild.name);

  // Resolve locale for this guild (getConfig also creates default row)
  const config = guild_config.getConfig(guild.id);
  const localeKey = resolveLocaleKey(config.language, guild.preferredLocale);
  const L = getLocale(config.language, guild.preferredLocale);

  // Run the diagnostic and auto-repair logic immediately
  const checkResult = await diagnoseAndConfigurePermissions(guild);

  // Find a suitable channel to send the onboarding message
  let targetChannel = guild.systemChannel;

  if (
    !targetChannel || 
    !targetChannel.permissionsFor(guild.members.me!)?.has(PermissionsBitField.Flags.ViewChannel) ||
    !targetChannel.permissionsFor(guild.members.me!)?.has(PermissionsBitField.Flags.SendMessages)
  ) {
    // If system channel is not writable, look for the first writable text channel
    targetChannel = guild.channels.cache.find((channel) => {
      if (channel.type !== ChannelType.GuildText) return false;
      const perms = channel.permissionsFor(guild.members.me!);
      return perms?.has(PermissionsBitField.Flags.ViewChannel) && perms?.has(PermissionsBitField.Flags.SendMessages);
    }) as any;
  }

  if (!targetChannel) {
    logger.warn(`Could not find a writable channel to send onboarding message.`, "CLIENT", guild.name);
    return;
  }

  try {
    const inviterMention = inviterId 
      ? (localeKey === "ko" ? `, <@${inviterId}>님` : `, <@${inviterId}>`) 
      : "";

    const configCmd = guild.client.application?.commands.cache.find(c => c.name === "config");
    const configMention = configCmd ? `</config:${configCmd.id}>` : "`/config`";

    const onboardEmbed = new EmbedBuilder()
      .setColor(0x5865f2) // Discord Blurple
      .setTitle(L.onboardTitle)
      .setDescription(t(L.onboardDescription, inviterMention))
      .addFields(
        { name: L.onboardStep1Title, value: L.onboardStep1Value.replace(/`\/config`/g, configMention) },
        { name: L.onboardStep2Title, value: L.onboardStep2Value.replace(/`\/config`/g, configMention) },
        { name: L.onboardStep3Title, value: L.onboardStep3Value.replace(/`\/config`/g, configMention) },
        { name: L.onboardStep4Title, value: L.onboardStep4Value }
      )
      .setFooter({ text: t(L.onboardFooter, packageJson.version) });

    if (checkResult.allOk && !checkResult.autoFixed) {
       let msg = L.onboardCheckNoMissing;
       if (checkResult.hasAdmin) msg += "\n\n" + L.onboardCheckHasAdminTip;
       onboardEmbed.addFields({ name: L.onboardCheckTitle, value: msg });
    } else if (checkResult.autoFixed) {
       const visibleFixed = checkResult.fixedChannels.filter(c => !c.isHidden).map(c => `• <#${c.id}>`);
       const hiddenFixedCount = checkResult.fixedChannels.filter(c => c.isHidden).length;
       if (hiddenFixedCount > 0) visibleFixed.push(`• ${hiddenFixedCount} ${L.onboardCheckHiddenChannels}`);
       let msg = t(L.onboardCheckMissingFixedAdmin, visibleFixed.join("\n"));
       if (checkResult.hasAdmin && checkResult.missingGlobal.length === 0) msg += "\n\n" + L.onboardCheckHasAdminTip;
       onboardEmbed.addFields({ name: L.onboardCheckTitle, value: msg });
       
       if (checkResult.missingGlobal.length > 0) {
         const globalList = checkResult.missingGlobal.map(m => `• **${translatePermission(m, L)}**`).join("\n");
         onboardEmbed.addFields({ name: L.onboardCheckGlobalTitle, value: t(L.onboardCheckMissingGlobal, globalList) });
       }
       
       if (checkResult.missingChannels.length > 0) {
         const visibleMissing = checkResult.missingChannels.filter(c => !c.isHidden).map(m => `• <#${m.id}>: ${m.missing.map(p => translatePermission(p, L)).join(", ")}`);
         const hiddenMissingCount = checkResult.missingChannels.filter(c => c.isHidden).length;
         if (hiddenMissingCount > 0) visibleMissing.push(`• ${hiddenMissingCount} ${L.onboardCheckHiddenChannels}`);
         onboardEmbed.addFields({ name: L.onboardCheckPartialTitle, value: t(L.onboardCheckPartialDesc, visibleMissing.join("\n")) });
       }
    } else {
       const onboardingCmd = guild.client.application?.commands.cache.find(c => c.name === "onboarding");
       const cmdMention = onboardingCmd ? `</onboarding:${onboardingCmd.id}>` : "`/onboarding`";
       const missingTip = L.onboardCheckMissingTip.replace(/`\/onboarding`/g, cmdMention);

       if (checkResult.missingGlobal.length > 0) {
         const globalList = checkResult.missingGlobal.map(m => `• **${translatePermission(m, L)}**`).join("\n");
         onboardEmbed.addFields({ name: L.onboardCheckGlobalTitle, value: t(L.onboardCheckMissingGlobal, globalList) });
       }
       if (checkResult.missingChannels.length > 0) {
         const visibleMissing = checkResult.missingChannels.filter(c => !c.isHidden).map(m => `• <#${m.id}>: ${m.missing.map(p => translatePermission(p, L)).join(", ")}`);
         const hiddenMissingCount = checkResult.missingChannels.filter(c => c.isHidden).length;
         if (hiddenMissingCount > 0) visibleMissing.push(`• ${hiddenMissingCount} ${L.onboardCheckHiddenChannels}`);
         onboardEmbed.addFields({ name: L.onboardCheckTitle, value: t(L.onboardCheckMissingReport, visibleMissing.join("\n")) + missingTip });
       } else {
         onboardEmbed.addFields({ name: L.onboardCheckTitle, value: L.onboardCheckFixGlobalTip });
       }
    }

    await targetChannel.send({ embeds: [onboardEmbed] });
    logger.success(`Successfully sent onboarding message.`, "CLIENT", `${guild.name} | #${targetChannel.name}`);
  } catch (err) {
    logger.error(`Failed to send onboarding message:`, err, "CLIENT", guild.name);
  }
}
