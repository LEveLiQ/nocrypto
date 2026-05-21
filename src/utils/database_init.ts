import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'config.db');

if (fs.existsSync(dbPath)) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('Database already exists. Do you want to delete it? (yes/no): ', (answer: string) => {
        if (answer.toLowerCase() === 'yes') {
            fs.unlinkSync(dbPath);
            console.log('Existing database deleted.');
            rl.close();
            initializeDatabase();
        } else {
            console.log('Keeping existing database.');
            rl.close();
        }
    });
} else {
    initializeDatabase();
}

function initializeDatabase() {
    const db = new Database(dbPath);
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
    console.log('Database initialized successfully at:', dbPath);
    db.close();
}
