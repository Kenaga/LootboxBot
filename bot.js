require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Database file path
const DB_FILE = './database.json';

// Load database
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading database:', error);
  }
  return { coins: {}, roleExpirations: {} };
}

// Save database
function saveDatabase() {
  try {
    const data = {
      coins: Object.fromEntries(userCoins),
      roleExpirations: Object.fromEntries(roleExpirationsData)
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

// Load initial data
const db = loadDatabase();
const userCoins = new Map(Object.entries(db.coins || {}));
const roleExpirationsData = new Map(Object.entries(db.roleExpirations || {}));

// Lootbox items with their probabilities
const lootboxItems = [
  { message: 'Blue 🔵', probability: 99.945 },
  { message: 'Purple 🟣', probability: 0.04 },
  { message: 'Gold 🟡', probability: 0.015 }
];

// VIP lootbox items (for users with special role)
const vipLootboxItems = [
  { message: 'Blue 🔵', probability: 97.5 },
  { message: 'Purple 🟣', probability: 2 },
  { message: 'Gold 🟡', probability: 0.5 }
];

// VIP Role ID
const VIP_ROLE_ID = '1472362801992306871';

// Channel IDs
const LOOTBOX_CHANNELS = ['1471881938502418442', '1265305843331497995'];
const ECONOMY_CHANNEL = '1474179171843313926';

// Admin user ID
const ADMIN_USER_ID = '334000664130617345';

// Track processed messages to prevent duplicates
const processedMessages = new Set();

// Track Gambit role expiration timeouts (in-memory for active timers)
const roleExpirations = new Map();

// Function to schedule role removal
function scheduleRoleRemoval(userId, guildId, expiresAt) {
  const now = Date.now();
  const timeLeft = expiresAt - now;
  
  if (timeLeft <= 0) {
    // Already expired, remove immediately
    removeUserRole(userId, guildId);
    return;
  }
  
  // Clear any existing timeout
  if (roleExpirations.has(userId)) {
    clearTimeout(roleExpirations.get(userId));
  }
  
  // Schedule role removal
  const timeout = setTimeout(() => {
    removeUserRole(userId, guildId);
  }, timeLeft);
  
  roleExpirations.set(userId, timeout);
}

// Function to remove role and notify
async function removeUserRole(userId, guildId) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    const channel = await guild.channels.fetch(ECONOMY_CHANNEL);
    
    await member.roles.remove(VIP_ROLE_ID);
    
    if (channel) {
      channel.send(`<@${userId}> Your **Gambit** role has expired after 5 days. You can purchase it again with !gambit command!`);
    }
    
    // Remove from database
    roleExpirationsData.delete(userId);
    roleExpirations.delete(userId);
    saveDatabase();
    
    console.log(`Removed Gambit role from user ${userId}`);
  } catch (error) {
    console.error('Error removing role:', error);
  }
}

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

  // Award coins (1 coin for Blue only)
  if (item.includes('Blue')) {
    const userId = message.author.id;
    const currentCoins = userCoins.get(userId) || 0;
    userCoins.set(userId, currentCoins + 1);
    saveDatabase();
  }

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
  
  // Restore role expiration timers from database
  for (const [userId, expiresAt] of roleExpirationsData.entries()) {
    const guildId = client.guilds.cache.first()?.id;
    if (guildId) {
      scheduleRoleRemoval(userId, guildId, parseInt(expiresAt));
    }
  }
  
  console.log(`📊 Loaded ${userCoins.size} users with coins`);
  console.log(`⏰ Restored ${roleExpirationsData.size} role expiration timers`);
  
  // Auto-save database every 5 minutes to prevent data loss
  setInterval(() => {
    saveDatabase();
    console.log('💾 Auto-saved database');
  }, 5 * 60 * 1000);
});

client.on('messageCreate', (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check if the message is the lootbox command
  if (message.content.toLowerCase() === '!lootbox') {
    // Check if in allowed lootbox channels
    if (!LOOTBOX_CHANNELS.includes(message.channel.id)) {
      message.reply(`You can only use !lootbox command in <#1471881938502418442> channel.`);
      return;
    }
    handleLootboxCommand(message);
  }

  // Check coins command
  if (message.content.toLowerCase() === '!coins') {
    // Check if in economy channel
    if (message.channel.id !== ECONOMY_CHANNEL) return;
    
    const userId = message.author.id;
    const coins = userCoins.get(userId) || 0;
    message.reply(`You have **${coins}** coins! 🪙`);
  }

  // Check gambit command (buy VIP role)
  if (message.content.toLowerCase() === '!gambit') {
    // Check if in economy channel
    if (message.channel.id !== ECONOMY_CHANNEL) return;
    
    const userId = message.author.id;
    const coins = userCoins.get(userId) || 0;
    
    // Check if user already has the role
    if (message.member.roles.cache.has(VIP_ROLE_ID)) {
      message.reply(`You already have the Gambit role!`);
      return;
    }
    
    // Check if user has enough coins
    if (coins < 40) {
      message.reply(`You need **40 coins** to get the Gambit role. You currently have **${coins} coins**.`);
      return;
    }
    
    // Deduct coins and give role
    userCoins.set(userId, coins - 40);
    message.member.roles.add(VIP_ROLE_ID)
      .then(() => {
        message.reply(`Congratulations! You've purchased the **Gambit** role for 40 coins! You now have **${coins - 40}** coins remaining.\n\n✨ Your chances for rare items have been increased!\n\nThe role will expire in 5 days. 🎉`);
        
        // Set up automatic role removal after 5 days
        const fiveDays = 5 * 24 * 60 * 60 * 1000; // 5 days in milliseconds
        const expiresAt = Date.now() + fiveDays;
        
        // Save to database
        roleExpirationsData.set(userId, expiresAt.toString());
        saveDatabase();
        
        // Schedule role removal
        scheduleRoleRemoval(userId, message.guild.id, expiresAt);
      })
      .catch(err => {
        console.error('Error adding role:', err);
        message.reply(`There was an error giving you the role. Please contact an admin.`);
      });
  }

  // Check givecoin command (admin only)
  if (message.content.toLowerCase().startsWith('!givecoin')) {
    // Check if in economy channel
    if (message.channel.id !== ECONOMY_CHANNEL) return;
    
    // Check if user is admin
    if (message.author.id !== ADMIN_USER_ID) return;
    
    const args = message.content.split(' ');
    const targetUser = message.mentions.users.first();
    const amount = parseInt(args[2]);
    
    if (!targetUser || isNaN(amount)) {
      message.reply(`Usage: !givecoin @user <amount>`);
      return;
    }
    
    const currentCoins = userCoins.get(targetUser.id) || 0;
    userCoins.set(targetUser.id, currentCoins + amount);
    saveDatabase();
    message.reply(`Given **${amount} coins** to ${targetUser}! They now have **${currentCoins + amount}** coins.`);
  }
});

client.on('messageUpdate', (oldMessage, newMessage) => {
  // Ignore messages from bots
  if (newMessage.author.bot) return;

  // Check if the edited message is now the lootbox command
  if (newMessage.content.toLowerCase() === '!lootbox') {
    // Check if in allowed lootbox channels
    if (!LOOTBOX_CHANNELS.includes(newMessage.channel.id)) {
      newMessage.reply(`You can only use !lootbox command in <#1471881938502418442> channel.`);
      return;
    }
    handleLootboxCommand(newMessage);
  }
});

client.login(process.env.DISCORD_TOKEN);
