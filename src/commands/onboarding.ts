import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits
} from "discord.js";
import { guild_config } from "../utils/database";
import { logger } from "../utils/logger";
import { getLocale, t, LocaleStrings } from "../i18n";
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

import { enUS } from "../i18n/locales/en-US";
import { ko } from "../i18n/locales/ko";

export const onboardingCommand = new SlashCommandBuilder()
  .setName("onboarding")
  .setDescription(enUS.onboardCommandDesc)
  .setDescriptionLocalizations({
    ko: ko.onboardCommandDesc
  })
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function handleOnboardingCommand(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guildId || !guild) {
    const L = getLocale("auto", null, interaction.locale);
    await interaction.reply({ content: L.errorNotInServer, flags: ["Ephemeral"] });
    return;
  }

  const config = guild_config.getConfig(guildId);
  const L = getLocale(config.language, interaction.guildLocale, interaction.locale);

  await interaction.deferReply({ flags: ["Ephemeral"] });

  try {
    const result = await diagnoseAndConfigurePermissions(guild);

    const embed = new EmbedBuilder()
      .setTitle(L.onboardCheckTitle);

    if (result.allOk && !result.autoFixed) {
      embed.setColor(0x57F287); // Green
      let msg = L.onboardCheckNoMissing;
      if (result.hasAdmin) msg += "\n\n" + L.onboardCheckHasAdminTip;
      embed.setDescription(msg);
    } else if (result.autoFixed) {
      embed.setColor(0x5865f2); // Blurple
      
      const fixedList = result.fixedChannels.map(c => `• <#${c.id}>`).join("\n");
      let desc = t(L.onboardCheckMissingFixedAdmin, fixedList);
      if (result.hasAdmin && result.missingGlobal.length === 0) desc += "\n\n" + L.onboardCheckHasAdminTip;
      embed.setDescription(desc);
      
      if (result.missingGlobal.length > 0) {
        const globalList = result.missingGlobal.map(m => `• **${translatePermission(m, L)}**`).join("\n");
        embed.addFields({ name: L.onboardCheckGlobalTitle, value: t(L.onboardCheckMissingGlobal, globalList) });
      }

      if (result.missingChannels.length > 0) {
        // Some failed
        const missingList = result.missingChannels.map(m => `• <#${m.id}>: ${m.missing.map(p => translatePermission(p, L)).join(", ")}`).join("\n");
        embed.addFields({
          name: L.onboardCheckPartialTitle,
          value: t(L.onboardCheckPartialDesc, missingList)
        });
      }
    } else {
      embed.setColor(0xED4245); // Red
      const cmdMention = `</onboarding:${interaction.commandId}>`;
      const missingTip = L.onboardCheckMissingTip.replace(/`\/onboarding`/g, cmdMention);

      if (result.missingGlobal.length > 0) {
        const globalList = result.missingGlobal.map(m => `• **${translatePermission(m, L)}**`).join("\n");
        embed.addFields({ name: L.onboardCheckGlobalTitle, value: t(L.onboardCheckMissingGlobal, globalList) });
      }
      
      if (result.missingChannels.length > 0) {
        const missingList = result.missingChannels.map(m => `• <#${m.id}>: ${m.missing.map(p => translatePermission(p, L)).join(", ")}`).join("\n");
        const desc = t(L.onboardCheckMissingReport, missingList) + missingTip;
        embed.setDescription(desc);
      } else {
        embed.setDescription(L.onboardCheckFixGlobalTip);
      }
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error("Failed to run onboarding command:", error, "SYSTEM");
    await interaction.editReply({ content: L.errorGeneric });
  }
}
