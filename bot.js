require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Lootbox items with their probabilities
const lootboxItems = [
  { message: 'Blue 🔵', probability: 99.75 },
  { message: 'Purple 🟣', probability: 0.2 },
  { message: 'Gold 🟡', probability: 0.05 }
];

// Function to get a random item based on weighted probabilities
function getRandomItem() {
  const random = Math.random() * 100; // Random number between 0 and 100
  let cumulativeProbability = 0;

  for (const item of lootboxItems) {
    cumulativeProbability += item.probability;
    if (random <= cumulativeProbability) {
      return item.message;
    }
  }

  // Fallback (should never reach here)
  return lootboxItems[0].message;
}

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
  console.log(`🎁 Lootbox bot is ready!`);
});

client.on('messageCreate', (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check if the message is the lootbox command
  if (message.content.toLowerCase() === '!lootbox') {
    // Get 1 random item
    const item = getRandomItem();

    // Check if it's a rare item (Purple or Gold) and ping both the user and the owner
    if (item.includes('Purple') || item.includes('Gold')) {
      message.reply(`${message.author} <@334000664130617345> ${item}`);
    } else {
      message.reply(item);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
