require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Define MongoDB Schemas
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  coins: { type: Number, default: 0 },
  roleExpiresAt: { type: Number, default: null }
});

const User = mongoose.model('User', userSchema);

// In-memory cache for faster access
const userCoins = new Map();
const roleExpirationsData = new Map();

// Load user data from database
async function loadUserData(userId) {
  try {
    let user = await User.findOne({ userId });
    if (!user) {
      user = await User.create({ userId, coins: 0 });
    }
    userCoins.set(userId, user.coins);
    if (user.roleExpiresAt) {
      roleExpirationsData.set(userId, user.roleExpiresAt);
    }
    return user;
  } catch (error) {
    console.error('Error loading user data:', error);
    return null;
  }
}

// Save user coins to database
async function saveUserCoins(userId, coins) {
  try {
    await User.findOneAndUpdate(
      { userId },
      { coins },
      { upsert: true, new: true }
    );
    userCoins.set(userId, coins);
    console.log(`💾 Saved ${coins} coins for user ${userId}`);
  } catch (error) {
    console.error('Error saving user coins:', error);
  }
}

// Save role expiration to database
async function saveRoleExpiration(userId, expiresAt) {
  try {
    await User.findOneAndUpdate(
      { userId },
      { roleExpiresAt: expiresAt },
      { upsert: true, new: true }
    );
    roleExpirationsData.set(userId, expiresAt);
  } catch (error) {
    console.error('Error saving role expiration:', error);
  }
}

// Remove role expiration from database
async function removeRoleExpiration(userId) {
  try {
    await User.findOneAndUpdate(
      { userId },
      { roleExpiresAt: null }
    );
    roleExpirationsData.delete(userId);
  } catch (error) {
    console.error('Error removing role expiration:', error);
  }
}

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

// Track when bot is removing roles (to avoid triggering manual removal detection)
const botRemovals = new Set();

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
    
    // Mark this as a bot removal to avoid triggering manual removal detection
    botRemovals.add(userId);
    
    await member.roles.remove(VIP_ROLE_ID);
    
    // Remove from tracking after a short delay
    setTimeout(() => botRemovals.delete(userId), 1000);
    
    if (channel) {
      channel.send(`<@${userId}> Your **Gambit** role has expired after 5 days. You can purchase it again with !gambit command!`);
    }
    
    // Remove from database
    await removeRoleExpiration(userId);
    roleExpirations.delete(userId);
    
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
async function handleLootboxCommand(message) {
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
    
    // Get current coins from cache or default to 0
    const currentCoins = userCoins.get(userId) || 0;
    const newCoins = currentCoins + 1;
    
    // Update cache immediately
    userCoins.set(userId, newCoins);
    
    // Save to database asynchronously (non-blocking)
    saveUserCoins(userId, newCoins).catch(err => 
      console.error('Error saving coins:', err)
    );
  }

  // Check if it's a rare item (Purple or Gold) and ping both the user and the owner
  if (item.includes('Purple') || item.includes('Gold')) {
    message.reply(`${message.author} <@334000664130617345> ${item}`);
  } else {
    message.reply(item);
  }
}

client.on('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
  console.log(`🎁 Lootbox bot is ready!`);
  
  // Load all users from database
  try {
    const users = await User.find({});
    for (const user of users) {
      userCoins.set(user.userId, user.coins);
      if (user.roleExpiresAt) {
        roleExpirationsData.set(user.userId, user.roleExpiresAt);
        
        // Restore role expiration timers
        const guildId = client.guilds.cache.first()?.id;
        if (guildId) {
          scheduleRoleRemoval(user.userId, guildId, user.roleExpiresAt);
        }
      }
    }
    
    console.log(`📊 Loaded ${userCoins.size} users with coins`);
    console.log(`⏰ Restored ${roleExpirationsData.size} role expiration timers`);
  } catch (error) {
    console.error('Error loading users from database:', error);
  }
});

client.on('messageCreate', async (message) => {
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
    
    // Get from cache, or load from DB if not present
    let coins = userCoins.get(userId);
    
    if (coins === undefined) {
      await loadUserData(userId);
      coins = userCoins.get(userId) || 0;
    }
    
    message.reply(`You have **${coins}** coins! 🪙`);
  }

  // Check gambit command (buy VIP role)
  if (message.content.toLowerCase() === '!gambit') {
    // Check if in economy channel
    if (message.channel.id !== ECONOMY_CHANNEL) return;
    
    const userId = message.author.id;
    
    // Get from cache, or load from DB if not present
    let coins = userCoins.get(userId);
    
    if (coins === undefined) {
      await loadUserData(userId);
      coins = userCoins.get(userId) || 0;
    }
    
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
    const newCoins = coins - 40;
    userCoins.set(userId, newCoins);
    
    // Save to database asynchronously
    saveUserCoins(userId, newCoins).catch(err => 
      console.error('Error saving coins:', err)
    );
    
    message.member.roles.add(VIP_ROLE_ID)
      .then(async () => {
        message.reply(`Congratulations! You've purchased the **Gambit** role for 40 coins! You now have **${newCoins}** coins remaining.\n\n✨ Your chances for rare items have been increased!\n\nThe role will expire in 5 days. 🎉`);
        
        // Set up automatic role removal after 5 days
        const fiveDays = 5 * 24 * 60 * 60 * 1000; // 5 days in milliseconds
        const expiresAt = Date.now() + fiveDays;
        
        // Save to database asynchronously
        saveRoleExpiration(userId, expiresAt).catch(err => 
          console.error('Error saving role expiration:', err)
        );
        
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
    
    const targetUserId = targetUser.id;
    
    // Get from cache, or load from DB if not present
    let currentCoins = userCoins.get(targetUserId);
    
    if (currentCoins === undefined) {
      await loadUserData(targetUserId);
      currentCoins = userCoins.get(targetUserId) || 0;
    }
    
    const newCoins = currentCoins + amount;
    userCoins.set(targetUserId, newCoins);
    
    // Save to database asynchronously
    saveUserCoins(targetUserId, newCoins).catch(err => 
      console.error('Error saving coins:', err)
    );
    
    message.reply(`Given **${amount} coins** to ${targetUser}! They now have **${newCoins}** coins.`);
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
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

// Detect when Gambit role is manually removed by admin
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    // Check if Gambit role was removed
    const hadRole = oldMember.roles.cache.has(VIP_ROLE_ID);
    const hasRole = newMember.roles.cache.has(VIP_ROLE_ID);
    
    // If role was removed
    if (hadRole && !hasRole) {
      const userId = newMember.id;
      
      // Check if this was a bot removal (automated expiration)
      if (botRemovals.has(userId)) {
        return; // This was the bot removing it, don't notify
      }
      
      // This was a manual removal by an admin
      console.log(`Gambit role manually removed from user ${userId}`);
      
      // Clear the expiration timer
      if (roleExpirations.has(userId)) {
        clearTimeout(roleExpirations.get(userId));
        roleExpirations.delete(userId);
      }
      
      // Remove from database
      await removeRoleExpiration(userId);
      
      // Notify the user in economy channel
      const channel = await newMember.guild.channels.fetch(ECONOMY_CHANNEL);
      if (channel) {
        channel.send(`<@${userId}> Your **Gambit** role has been removed by an admin.`);
      }
    }
  } catch (error) {
    console.error('Error handling role update:', error);
  }
});

client.login(process.env.DISCORD_TOKEN);
