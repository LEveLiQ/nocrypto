# Invite: https://discord.com/oauth2/authorize?client_id=1506592486221414482

# Setup
1. install node.js: https://nodejs.org/en
2. install dependencies:
```
npm install
```
3. initialize database:
```
npm run init-db
```
4. configure your tokens in the `.env` file:
```
DISCORD_TOKEN=discord_bot_token (https://discord.com/developers)
GEMINI_API_KEY=google_gemini_api_key (https://aistudio.google.com)
GEMINI_MODEL=gemini-3.1-flash-lite (gemma-4-31b if your server's big, gemini-3.5-flash if you're rich)
```

# Run
```
npm run build
npm run start
```
(if you feel brave feel free to do `npm run dev`)
