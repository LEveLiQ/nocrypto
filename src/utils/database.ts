import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'config.db'));

// Ensure the table exists on import (auto-creates if running fresh without init-db)
db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    log_channel_id TEXT,
    scan_images INTEGER DEFAULT 1,
    scan_links INTEGER DEFAULT 1,
    confidence_threshold REAL DEFAULT 0.70,
    excluded_channels TEXT DEFAULT '[]',
    excluded_roles TEXT DEFAULT '[]',
    punishment_single TEXT DEFAULT 'none',
    punishment_spam TEXT DEFAULT 'ban',
    spam_threshold INTEGER DEFAULT 3,
    language TEXT DEFAULT 'auto'
  );
`);

// Auto-migration: add punishment and threshold columns to existing databases
try {
  db.exec(`ALTER TABLE guild_config ADD COLUMN punishment_single TEXT DEFAULT 'none';`);
} catch (_) { /* Column already exists */ }
try {
  db.exec(`ALTER TABLE guild_config ADD COLUMN punishment_spam TEXT DEFAULT 'ban';`);
} catch (_) { /* Column already exists */ }
try {
  db.exec(`ALTER TABLE guild_config ADD COLUMN spam_threshold INTEGER DEFAULT 3;`);
} catch (_) { /* Column already exists */ }
try {
  db.exec(`ALTER TABLE guild_config ADD COLUMN language TEXT DEFAULT 'auto';`);
} catch (_) { /* Column already exists */ }

export type PunishmentSingle = 'none' | 'timeout';
export type PunishmentSpam = 'timeout' | 'kick' | 'ban';

export interface GuildConfig {
  guild_id: string;
  log_channel_id: string | null;
  scan_images: number;       // 1 = true, 0 = false (SQLite doesn't have booleans)
  scan_links: number;
  confidence_threshold: number;
  excluded_channels: string; // JSON array string
  excluded_roles: string;    // JSON array string
  punishment_single: PunishmentSingle;
  punishment_spam: PunishmentSpam;
  spam_threshold: number;
  language: string;          // 'auto' | 'en-US' | 'ko'
}

const guild_config = {
  /**
   * Returns the guild's config, creating a default row if it doesn't exist.
   */
  getConfig(guildId: string): GuildConfig {
    const insertStmt = db.prepare(`
      INSERT INTO guild_config (guild_id)
      VALUES (?)
      ON CONFLICT(guild_id) DO NOTHING
    `);
    const selectStmt = db.prepare(`
      SELECT * FROM guild_config WHERE guild_id = ?
    `);

    const transaction = db.transaction((id: string) => {
      insertStmt.run(id);
      return selectStmt.get(id);
    });

    return transaction(guildId) as GuildConfig;
  },

  setLogChannel(guildId: string, channelId: string | null) {
    guild_config.getConfig(guildId); // ensure row exists
    return db.prepare(`
      UPDATE guild_config SET log_channel_id = ? WHERE guild_id = ?
    `).run(channelId, guildId);
  },

  setScanImages(guildId: string, enabled: boolean) {
    guild_config.getConfig(guildId);
    return db.prepare(`
      UPDATE guild_config SET scan_images = ? WHERE guild_id = ?
    `).run(enabled ? 1 : 0, guildId);
  },

  setScanLinks(guildId: string, enabled: boolean) {
    guild_config.getConfig(guildId);
    return db.prepare(`
      UPDATE guild_config SET scan_links = ? WHERE guild_id = ?
    `).run(enabled ? 1 : 0, guildId);
  },

  setThreshold(guildId: string, value: number) {
    guild_config.getConfig(guildId);
    return db.prepare(`
      UPDATE guild_config SET confidence_threshold = ? WHERE guild_id = ?
    `).run(value, guildId);
  },

  addExcludedChannel(guildId: string, channelId: string): boolean {
    const config = guild_config.getConfig(guildId);
    const channels: string[] = JSON.parse(config.excluded_channels);
    if (channels.includes(channelId)) return false; // already excluded
    channels.push(channelId);
    db.prepare(`
      UPDATE guild_config SET excluded_channels = ? WHERE guild_id = ?
    `).run(JSON.stringify(channels), guildId);
    return true;
  },

  removeExcludedChannel(guildId: string, channelId: string): boolean {
    const config = guild_config.getConfig(guildId);
    const channels: string[] = JSON.parse(config.excluded_channels);
    const idx = channels.indexOf(channelId);
    if (idx === -1) return false; // wasn't excluded
    channels.splice(idx, 1);
    db.prepare(`
      UPDATE guild_config SET excluded_channels = ? WHERE guild_id = ?
    `).run(JSON.stringify(channels), guildId);
    return true;
  },

  addExcludedRole(guildId: string, roleId: string): boolean {
    const config = guild_config.getConfig(guildId);
    const roles: string[] = JSON.parse(config.excluded_roles);
    if (roles.includes(roleId)) return false;
    roles.push(roleId);
    db.prepare(`
      UPDATE guild_config SET excluded_roles = ? WHERE guild_id = ?
    `).run(JSON.stringify(roles), guildId);
    return true;
  },

  removeExcludedRole(guildId: string, roleId: string): boolean {
    const config = guild_config.getConfig(guildId);
    const roles: string[] = JSON.parse(config.excluded_roles);
    const idx = roles.indexOf(roleId);
    if (idx === -1) return false;
    roles.splice(idx, 1);
    db.prepare(`
      UPDATE guild_config SET excluded_roles = ? WHERE guild_id = ?
    `).run(JSON.stringify(roles), guildId);
    return true;
  },

  setPunishmentSingle(guildId: string, action: PunishmentSingle) {
    guild_config.getConfig(guildId);
    return db.prepare(`
      UPDATE guild_config SET punishment_single = ? WHERE guild_id = ?
    `).run(action, guildId);
  },

  setPunishmentSpam(guildId: string, action: PunishmentSpam) {
    guild_config.getConfig(guildId);
    return db.prepare(`
      UPDATE guild_config SET punishment_spam = ? WHERE guild_id = ?
    `).run(action, guildId);
  },

  setSpamThreshold(guildId: string, value: number) {
    guild_config.getConfig(guildId);
    return db.prepare(`
      UPDATE guild_config SET spam_threshold = ? WHERE guild_id = ?
    `).run(value, guildId);
  },

  setLanguage(guildId: string, lang: string) {
    guild_config.getConfig(guildId);
    return db.prepare(`
      UPDATE guild_config SET language = ? WHERE guild_id = ?
    `).run(lang, guildId);
  },

  resetConfig(guildId: string) {
    return db.prepare(`
      DELETE FROM guild_config WHERE guild_id = ?
    `).run(guildId);
  },

  /**
   * Helper: parses the excluded channels/roles into typed arrays.
   */
  getExcludedChannels(guildId: string): string[] {
    const config = guild_config.getConfig(guildId);
    return JSON.parse(config.excluded_channels);
  },

  getExcludedRoles(guildId: string): string[] {
    const config = guild_config.getConfig(guildId);
    return JSON.parse(config.excluded_roles);
  },
};

export { db, guild_config };
