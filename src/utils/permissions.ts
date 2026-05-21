import { Guild, ChannelType, PermissionFlagsBits, TextChannel, VoiceChannel, NewsChannel } from "discord.js";
import { logger } from "./logger";

export interface PermissionCheckResult {
  allOk: boolean;
  autoFixed: boolean;
  fixedChannels: { id: string; name: string; isHidden: boolean }[];
  missingChannels: { id: string; name: string; isHidden: boolean; missing: string[] }[];
  missingGlobal: string[];
  hasAdmin: boolean;
}

import { GuildMember, PermissionsBitField } from "discord.js";

/**
 * Manually evaluates a member's permissions in a channel *without* applying the Administrator bypass.
 */
function getPermissionsWithoutAdmin(channel: TextChannel | VoiceChannel | NewsChannel, member: GuildMember): PermissionsBitField {
  if (member.id === channel.guild.ownerId) return new PermissionsBitField(PermissionsBitField.Flags.Administrator);

  // 1. Base permissions (guild level) without Administrator
  let base = new PermissionsBitField();
  for (const [_, role] of member.roles.cache) {
    base.add(role.permissions);
  }
  base.remove(PermissionFlagsBits.Administrator);

  // 2. Apply channel overwrites
  const overwrites = channel.permissionOverwrites.cache;

  // a. @everyone overwrite
  const everyoneOverwrite = overwrites.get(channel.guild.id);
  if (everyoneOverwrite) {
    base.remove(everyoneOverwrite.deny);
    base.add(everyoneOverwrite.allow);
  }

  // b. Role overwrites
  let roleAllow = new PermissionsBitField();
  let roleDeny = new PermissionsBitField();
  for (const [_, role] of member.roles.cache) {
    if (role.id === channel.guild.id) continue;
    const roleOverwrite = overwrites.get(role.id);
    if (roleOverwrite) {
      roleDeny.add(roleOverwrite.deny);
      roleAllow.add(roleOverwrite.allow);
    }
  }
  base.remove(roleDeny);
  base.add(roleAllow);

  // c. Member overwrite
  const memberOverwrite = overwrites.get(member.id);
  if (memberOverwrite) {
    base.remove(memberOverwrite.deny);
    base.add(memberOverwrite.allow);
  }

  return base;
}

/**
 * Scans all text-capable channels in the guild to verify the bot has ViewChannel,
 * SendMessages, and ManageMessages. If the bot has ManageRoles/Administrator, 
 * it will automatically configure the correct permission overrides.
 */
export async function diagnoseAndConfigurePermissions(guild: Guild): Promise<PermissionCheckResult> {
  const me = guild.members.me;
  if (!me) {
    return { allOk: false, autoFixed: false, fixedChannels: [], missingChannels: [], missingGlobal: [], hasAdmin: false };
  }

  const hasAdmin = me.permissions.has(PermissionFlagsBits.Administrator);
  const canEditOverrides = hasAdmin || me.permissions.has(PermissionFlagsBits.ManageRoles);

  // 1. Check Global Permissions (without Administrator)
  let baseGlobal = new PermissionsBitField();
  for (const [_, role] of me.roles.cache) {
    baseGlobal.add(role.permissions);
  }
  baseGlobal.remove(PermissionFlagsBits.Administrator);

  const missingGlobal: string[] = [];
  if (!baseGlobal.has(PermissionFlagsBits.ModerateMembers)) missingGlobal.push("ModerateMembers");
  if (!baseGlobal.has(PermissionFlagsBits.KickMembers)) missingGlobal.push("KickMembers");
  if (!baseGlobal.has(PermissionFlagsBits.BanMembers)) missingGlobal.push("BanMembers");

  // 2. Check Channel Permissions
  const missingChannels: { channelName: string; missing: string[]; channel: TextChannel | VoiceChannel | NewsChannel; id: string; isHidden: boolean }[] = [];
  const fixedChannels: { id: string; name: string; isHidden: boolean }[] = [];
  const everyoneRole = guild.roles.everyone;

  for (const [_, channel] of guild.channels.cache) {
    if (!channel.isTextBased() || channel.isThread()) continue;

    // We specifically target GuildText, GuildAnnouncement, and GuildVoice.
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement && channel.type !== ChannelType.GuildVoice) {
      continue;
    }

    const permissions = getPermissionsWithoutAdmin(channel as TextChannel | VoiceChannel | NewsChannel, me);

    const missing: string[] = [];
    if (!permissions.has(PermissionFlagsBits.ViewChannel)) missing.push("ViewChannel");
    if (!permissions.has(PermissionFlagsBits.SendMessages)) missing.push("SendMessages");
    if (!permissions.has(PermissionFlagsBits.ManageMessages)) missing.push("ManageMessages");
    if (!permissions.has(PermissionFlagsBits.ReadMessageHistory)) missing.push("ReadMessageHistory");

    if (missing.length > 0) {
      const isHidden = !channel.permissionsFor(everyoneRole)?.has(PermissionFlagsBits.ViewChannel);
      missingChannels.push({ channelName: channel.name, missing, channel: channel as TextChannel | VoiceChannel | NewsChannel, id: channel.id, isHidden });
    }
  }

  const channelsOk = missingChannels.length === 0;
  const globalOk = missingGlobal.length === 0;

  if (channelsOk && globalOk) {
    return { allOk: true, autoFixed: false, fixedChannels: [], missingChannels: [], missingGlobal, hasAdmin };
  }

  if (canEditOverrides && !channelsOk) {
    // Attempt auto-fix for channels
    for (const item of missingChannels) {
      try {
        await item.channel.permissionOverwrites.edit(me, {
          ViewChannel: true,
          SendMessages: true,
          ManageMessages: true,
          ReadMessageHistory: true
        });
        fixedChannels.push({ id: item.id, name: item.channelName, isHidden: item.isHidden });
      } catch (err) {
        logger.warn(`Failed to auto-configure permissions for #${item.channelName} in ${guild.name}: ${err}`, "SYSTEM");
      }
    }
    
    const fullyFixed = fixedChannels.length === missingChannels.length;
    
    if (fullyFixed && globalOk) {
      return { allOk: true, autoFixed: true, fixedChannels, missingChannels: [], missingGlobal, hasAdmin };
    } else {
      const actuallyMissing = missingChannels.filter(m => !fixedChannels.some(f => f.id === m.id));
      return {
        allOk: false,
        autoFixed: fixedChannels.length > 0,
        fixedChannels,
        missingChannels: actuallyMissing.map(m => ({ id: m.id, name: m.channelName, isHidden: m.isHidden, missing: m.missing })),
        missingGlobal,
        hasAdmin
      };
    }
  }

  return {
    allOk: false,
    autoFixed: false,
    fixedChannels: [],
    missingChannels: missingChannels.map(m => ({ id: m.id, name: m.channelName, isHidden: m.isHidden, missing: m.missing })),
    missingGlobal,
    hasAdmin
  };
}
