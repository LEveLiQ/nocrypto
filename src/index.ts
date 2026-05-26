import {
  Client,
  GatewayIntentBits,
  Interaction,
  ChatInputCommandInteraction,
} from "discord.js";
import * as dotenv from "dotenv";
import { execSync } from "child_process";
import packageJson from "../package.json";
import { logger } from "./utils/logger";
import { initGemini } from "./utils/gemini";
import { onReady } from "./events/ready";
import { onMessageCreate } from "./events/messageCreate";
import { onGuildCreate } from "./events/guildCreate";
import { handleConfigCommand, handleConfigButton, handleConfigSelect, handleConfigModal } from "./commands/config";
import { handleReportCommand } from "./commands/report";
import { handleOnboardingCommand } from "./commands/onboarding";
import { MessageContextMenuCommandInteraction } from "discord.js";

// Load environment variables
dotenv.config();

// Get current git commit hash dynamically
let commitHash = "";
try {
  commitHash = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch (e) {
  // Fallback if git is not available
}

console.log(`NoCrypto v${packageJson.version}${commitHash ? ` (${commitHash})` : ""}`);

// Initialize Gemini SDK
initGemini();

const token = process.env.DISCORD_TOKEN;
if (!token || token === "your_discord_bot_token_here") {
  logger.error("DISCORD_TOKEN is missing or not configured in your .env file! Exiting...", undefined, "CLIENT");
  process.exit(1);
}

// Initialize the Discord Client with necessary Intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Event: Bot ready — register slash commands
client.once("clientReady", () => onReady(client));

// Event: New message — scan for scams
client.on("messageCreate", (message) => onMessageCreate(message, client));

// Event: Joined a new server — send onboarding message
client.on("guildCreate", (guild) => onGuildCreate(guild));

// Event: Interaction (Slash command or Context Menu)
client.on("interactionCreate", async (interaction: Interaction) => {
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction as ChatInputCommandInteraction;
    switch (commandName) {
      case "config":
        await handleConfigCommand(interaction as ChatInputCommandInteraction);
        break;
      case "onboarding":
        await handleOnboardingCommand(interaction as ChatInputCommandInteraction);
        break;
    }
  } else if (interaction.isMessageContextMenuCommand()) {
    const { commandName } = interaction;
    switch (commandName) {
      case "Report to NoCrypto":
        await handleReportCommand(interaction as MessageContextMenuCommandInteraction);
        break;
    }
  } else if (interaction.isButton() && interaction.customId.startsWith("cfg:")) {
    await handleConfigButton(interaction);
  } else if (interaction.isAnySelectMenu() && interaction.customId.startsWith("cfg:")) {
    await handleConfigSelect(interaction);
  } else if (interaction.isModalSubmit() && interaction.customId.startsWith("cfg:")) {
    await handleConfigModal(interaction);
  }
});

import { db } from "./utils/database";

// Graceful shutdown handling
const shutdown = () => {
  logger.info("Shutdown signal received. Logging out bot and closing database...", "SYSTEM");
  try {
    client.destroy();
  } catch (err) {
    logger.error("Error during client destroy:", err, "SYSTEM");
  }
  try {
    db.close();
  } catch (err) {
    logger.error("Error during database close:", err, "SYSTEM");
  }
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Process-level safety handlers to prevent crash loops in production
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at promise:", reason, "SYSTEM");
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception thrown:", error, "SYSTEM");
});

// Connect to Discord
client.login(token).catch((err) => {
  logger.error("Failed to login to Discord. Please check your credentials.", err, "CLIENT");
});

