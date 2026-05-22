<div align="center">

# NoCrypto - Discord Scam Scanner

A Discord bot that automatically scans sent media for scam and phishing patterns using Google Gemini.

<a href="https://discord.com/oauth2/authorize?client_id=1506592486221414482">
  <img src="https://img.shields.io/badge/Invite-Discord_Bot-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Invite Bot" height="40" />
</a>

</div>

## ✨ Features
- Automatically monitors channels for potential crypto scams and phishing attempts.
- Powered by Google's Gemini AI to analyze media and text contexts.
- Uses local SQLite database for efficient configuration management.
- Multi-language support and configurable thresholds.
## ⚙️ Configuration
The bot can be configured directly in your server using the `/config` command. Administrators can adjust the following settings:
- **Scan Settings**: Toggle scanning for images and/or links.
- **Member Age Threshold**: Choose whether to scan everyone or only members who joined recently (e.g., within the last 24 hours or 7 days).
- **Scam Probability Threshold**: Adjust how confident the AI needs to be before flagging a message as a scam (default: 70%).
- **Exclusions**: Whitelist specific channels, roles, or URLs from being scanned.
- **Punishments**: Configure automated actions (none, kick, ban) for single offenses or repeated spam.
- **Spam Threshold**: Set how many consecutive scams a user must post to trigger the spam punishment.
- **Language**: Set the bot's language (defaults to auto-detecting based on the server).
- **Log Channel**: Set a specific channel where the bot logs scam detections and actions taken.

## 🔐 Required Permissions
To function effectively, NoCrypto requires the following Discord permissions:
- **View Channels & Read Message History**: Required to actively monitor and scan new messages for scams.
- **Send Messages**: Required to post automated warning messages in channels and detailed alerts in the designated admin log channel.
- **Manage Messages**: Required to immediately delete detected scam and phishing messages.
- **Moderate Members (Timeout), Kick & Ban**: Required if you configure the bot to automatically punish offenders (e.g., timing out or banning Spambots). *Note: The bot's role must be placed higher in the role hierarchy than the members it needs to punish.*

## 📄 License
> This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 
>
> [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
