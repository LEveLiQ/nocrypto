import { Client } from "discord.js";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import { configCommand } from "../commands/config";
import { reportCommand } from "../commands/report";
import { onboardingCommand } from "../commands/onboarding";
import { logger } from "../utils/logger";

export async function onReady(client: Client) {
  logger.success(`Logged in as ${client.user?.tag}! Bot is ready and actively monitoring for scams.`, "CLIENT");

  // Register slash commands globally
  const rest = new REST({ version: "9" }).setToken(process.env.DISCORD_TOKEN!);

  try {
    logger.info("Registering commands (slash & context menu)...", "SYSTEM");

    const commands = [configCommand.toJSON(), reportCommand.toJSON(), onboardingCommand.toJSON()];

    await rest.put(
      Routes.applicationCommands(client.user!.id),
      { body: commands }
    );

    // Fetch commands into cache so we can generate clickable slash command mentions
    if (client.application) {
      await client.application.commands.fetch();
    }

    logger.success("Slash commands registered successfully.", "SYSTEM");
  } catch (error) {
    logger.error("Failed to register slash commands:", error, "SYSTEM");
  }
}
