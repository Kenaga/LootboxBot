# Lootbox Discord Bot

A simple Discord bot that simulates opening lootboxes with weighted random rewards.

## Features

- Responds to `!lootbox` command
- Returns 1 random item with weighted probabilities:
  - Blue 🔵 (99.95%)
  - Purple 🟣 (0.04%)
  - Gold 🟡 (0.01%)

## Setup Instructions

### 1. Install Node.js

Make sure you have Node.js installed (version 16.9.0 or higher).
Download from: https://nodejs.org/

### 2. Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application" and give it a name
3. Go to the "Bot" section in the left sidebar
4. Click "Add Bot"
5. Under the bot's username, click "Reset Token" and copy the token
6. Scroll down to "Privileged Gateway Intents" and enable:
   - MESSAGE CONTENT INTENT

### 3. Invite the Bot to Your Server

1. Go to the "OAuth2" > "URL Generator" section
2. Select scopes: `bot`
3. Select bot permissions: `Send Messages`, `Read Messages/View Channels`
4. Copy the generated URL and open it in your browser
5. Select your server and authorize the bot

### 4. Configure the Bot

1. Open the `.env` file
2. Replace `your_bot_token_here` with your actual bot token

### 5. Install Dependencies

```bash
npm install
```

### 6. Run the Bot

```bash
npm start
```

You should see "✅ Logged in as [BotName]!" in the console.

## Usage

### Admin commands

Only user `334000664130617345` can use these commands:

- `!finduser @user` (or `!finduser <UserID>`) shows the user's display name, username, and whether they are in the current server.
- `!train` and `!bosstrain` enable **Send Messages** for role `1265303728668414064` in the train's channel. Access is disabled when the train times out, runs out of coins, or is stopped with `!stoptrain`, including when stopped from another allowed train channel.

Train commands remain limited to the configured train channels. The bot needs **Manage Roles** and sufficient role hierarchy to edit channel permission overwrites for the train role. Other permission overwrite settings are preserved. If opening the channel fails, the train does not start; closing failures are reported in the channel.

Run command regression checks with `node --test`.

In any channel where the bot has access, type:

```
!lootbox
```

The bot will respond with 1 random item based on their probabilities.

## Example Output

```
🎁 Lootbox opened! 🎁
Blue 🔵
```
