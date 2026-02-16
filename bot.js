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

// VIP lootbox items (for users with special role)
const vipLootboxItems = [
  { message: 'Blue 🔵', probability: 97.5 },
  { message: 'Purple 🟣', probability: 2 },
  { message: 'Gold 🟡', probability: 0.5 }
];

// VIP Role ID
const VIP_ROLE_ID = '1472362801992306871';

// Track processed messages to prevent duplicates
const processedMessages = new Set();

// Function to get a random item based on weighted probabilities
function getRandomItem(itemsArray) {
  const random = Math.random() * 100; // Random number between 0 and 100
  let cumulativeProbability = 0;

  for (const item of itemsArray) {
    cumulativeProbability += item.probability;
    if (random <= cumulativeProbability) {
      return item.message;
    }
  }

  // Fallback (should never reach here)
  return itemsArray[0].message;
}

// Function to handle lootbox command
function handleLootboxCommand(message) {
  // Check if this message has already been processed
  if (processedMessages.has(message.id)) return;

  // Mark this message as processed
  processedMessages.add(message.id);

  // Clean up old messages from the set (keep only last 100)
  if (processedMessages.size > 100) {
    const firstItem = processedMessages.values().next().value;
    processedMessages.delete(firstItem);
  }

  // Check if user has the VIP role
  const hasVipRole = message.member.roles.cache.has(VIP_ROLE_ID);
  
  // Get 1 random item based on whether they have VIP role
  const item = hasVipRole ? getRandomItem(vipLootboxItems) : getRandomItem(lootboxItems);

  // Check if it's a rare item (Purple or Gold) and ping both the user and the owner
  if (item.includes('Purple') || item.includes('Gold')) {
    message.reply(`${message.author} <@334000664130617345> ${item}`);
  } else {
    message.reply(item);
  }
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
    handleLootboxCommand(message);
  }
});

client.on('messageUpdate', (oldMessage, newMessage) => {
  // Ignore messages from bots
  if (newMessage.author.bot) return;

  // Check if the edited message is now the lootbox command
  if (newMessage.content.toLowerCase() === '!lootbox') {
    handleLootboxCommand(newMessage);
  }
});

client.login(process.env.DISCORD_TOKEN);
