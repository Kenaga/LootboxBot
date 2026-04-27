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
  roleExpiresAt: { type: Number, default: null },
  stats: {
    blues: { type: Number, default: 0 },
    purples: { type: Number, default: 0 },
    golds: { type: Number, default: 0 },
    slotsWins: { type: Number, default: 0 },
    blackjackWins: { type: Number, default: 0 }
  },
  inventory: { type: [Number], default: [] },
  equippedColor: { type: Number, default: null },
  equippedBadge: { type: Number, default: null }
});

const User = mongoose.model('User', userSchema);

// In-memory cache for faster access
const userCoins = new Map();
const userStats = new Map();
const userInventory = new Map();
const userEquipped = new Map();
const roleExpirationsData = new Map();

// Load user data from database
async function loadUserData(userId) {
  try {
    let user = await User.findOne({ userId });
    if (!user) {
      user = await User.create({ userId, coins: 0 });
    }
    userCoins.set(userId, user.coins);
    userStats.set(userId, user.stats || { blues: 0, purples: 0, golds: 0, slotsWins: 0, blackjackWins: 0 });
    userInventory.set(userId, user.inventory || []);
    userEquipped.set(userId, { color: user.equippedColor || null, badge: user.equippedBadge || null });
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

// Increment a stat for a user
async function incrementStat(userId, statName) {
  try {
    const stats = userStats.get(userId) || { blues: 0, purples: 0, golds: 0, slotsWins: 0, blackjackWins: 0 };
    stats[statName] = (stats[statName] || 0) + 1;
    userStats.set(userId, stats);
    
    await User.findOneAndUpdate(
      { userId },
      { $inc: { [`stats.${statName}`]: 1 } },
      { upsert: true }
    );
  } catch (error) {
    console.error('Error incrementing stat:', error);
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

// Lootbox items with their probabilities (Blue split into 8 languages)
const lootboxItems = [
  { message: 'Blue <:blue:1479814519994974208>', type: 'blue', probability: 12.371 },
  { message: 'Mavi <:blue:1479814519994974208>', type: 'blue', probability: 12.371 },
  { message: 'Blau <:blue:1479814519994974208>', type: 'blue', probability: 12.371 },
  { message: 'Bleu <:blue:1479814519994974208>', type: 'blue', probability: 12.371 },
  { message: 'Blu <:blue:1479814519994974208>', type: 'blue', probability: 12.371 },
  { message: 'Azul <:blue:1479814519994974208>', type: 'blue', probability: 12.371 },
  { message: 'Azul <:blue:1479814519994974208>', type: 'blue', probability: 12.371 },
  { message: 'Синий <:blue:1479814519994974208>', type: 'blue', probability: 12.371 },
  { message: 'jeff', type: 'jeff', probability: 1 },
  { message: 'Purple <:purple:1479814559555522745>', type: 'purple', probability: 0.023 },
  { message: 'Gold <:gold:1479814535220166708>', type: 'gold', probability: 0.009 }
];

// VIP lootbox items (Gambit users - no Jeff, Blue split into 8 languages)
const vipLootboxItems = [
  { message: 'Blue <:blue:1479814519994974208>', type: 'blue', probability: 12.49375 },
  { message: 'Mavi <:blue:1479814519994974208>', type: 'blue', probability: 12.49375 },
  { message: 'Blau <:blue:1479814519994974208>', type: 'blue', probability: 12.49375 },
  { message: 'Bleu <:blue:1479814519994974208>', type: 'blue', probability: 12.49375 },
  { message: 'Blu <:blue:1479814519994974208>', type: 'blue', probability: 12.49375 },
  { message: 'Azul <:blue:1479814519994974208>', type: 'blue', probability: 12.49375 },
  { message: 'Azul <:blue:1479814519994974208>', type: 'blue', probability: 12.49375 },
  { message: 'Синий <:blue:1479814519994974208>', type: 'blue', probability: 12.49375 },
  { message: 'Purple <:purple:1479814559555522745>', type: 'purple', probability: 0.045 },
  { message: 'Gold <:gold:1479814535220166708>', type: 'gold', probability: 0.015 }
];

// Test lootbox items for admin testing - removed after testing

// Market items
const marketItems = {
  // Mega Colors
  1:  { name: 'Mega Blue',   roleId: '1498265198354628720', price: 75,  type: 'megaColor' },
  2:  { name: 'Mega Yellow', roleId: '1498265205187149954', price: 75,  type: 'megaColor' },
  3:  { name: 'Mega Green',  roleId: '1498265208119099543', price: 75,  type: 'megaColor' },
  4:  { name: 'Mega Red',    roleId: '1498265213005336586', price: 75,  type: 'megaColor' },
  5:  { name: 'Mega Purple', roleId: '1498265217396641822', price: 75,  type: 'megaColor' },
  6:  { name: 'Mega Cyan',   roleId: '1498265221800792164', price: 75,  type: 'megaColor' },
  7:  { name: 'Mega Orange', roleId: '1498265226905129030', price: 75,  type: 'megaColor' },
  8:  { name: 'Mega Pink',   roleId: '1498265232911630336', price: 75,  type: 'megaColor' },
  9:  { name: 'Mega Brown',  roleId: '1498265237936410685', price: 75,  type: 'megaColor' },
  // Normal Colors
  10: { name: 'Blue',        roleId: '1498263709552742410', price: 50,  type: 'color' },
  11: { name: 'Yellow',      roleId: '1498264132338716692', price: 50,  type: 'color' },
  12: { name: 'Green',       roleId: '1498264148843434085', price: 50,  type: 'color' },
  13: { name: 'Red',         roleId: '1498264159098376284', price: 50,  type: 'color' },
  14: { name: 'Purple',      roleId: '1498264167717801996', price: 50,  type: 'color' },
  15: { name: 'Cyan',        roleId: '1498264714881532025', price: 50,  type: 'color' },
  16: { name: 'Orange',      roleId: '1498264831155765362', price: 50,  type: 'color' },
  17: { name: 'Pink',        roleId: '1498264868833464490', price: 50,  type: 'color' },
  18: { name: 'Brown',       roleId: '1498264945614262302', price: 50,  type: 'color' },
  // Badges
  19: { name: 'Jeff Badge',      roleId: '1498268031422566440', price: 200, type: 'badge' },
  20: { name: 'Kuno Badge',      roleId: '1498267868695887983', price: 150, type: 'badge' },
  21: { name: 'PJ Badge',        roleId: '1498267666161602560', price: 100, type: 'badge' },
  22: { name: 'Lexa Badge',      roleId: '1498268236557586462', price: 100, type: 'badge' },
  23: { name: 'Luna Badge',      roleId: '1498268370930241606', price: 100, type: 'badge' },
  24: { name: 'White Fox Badge', roleId: '1498268583757611109', price: 100, type: 'badge' },
};

// Helper: is item a color (mega or normal)?
function isColorItem(item) {
  return item.type === 'megaColor' || item.type === 'color';
}

// VIP Role ID
const VIP_ROLE_ID = '1472362801992306871';

// Channel IDs
const LOOTBOX_CHANNELS = ['1471881938502418442', '1265305843331497995'];
const ECONOMY_CHANNEL = '1474179171843313926';
const ALLOWED_COMMAND_CHANNELS = [ECONOMY_CHANNEL, '1265305843331497995'];

// Admin user ID
const ADMIN_USER_ID = '334000664130617345';

// Track processed messages to prevent duplicates
const processedMessages = new Set();

// Track Gambit role expiration timeouts (in-memory for active timers)
const roleExpirations = new Map();

// Track when bot is removing roles (to avoid triggering manual removal detection)
const botRemovals = new Set();

// Track active blackjack games
const activeBlackjackGames = new Map();

// Blackjack deck and logic
const CARD_SUITS = ['♠️', '♥️', '♣️', '♦️'];
const CARD_VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck() {
  const deck = [];
  for (const suit of CARD_SUITS) {
    for (const value of CARD_VALUES) {
      deck.push({ value, suit, display: `${value}${suit}` });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getCardValue(card) {
  if (card.value === 'A') return 11;
  if (['J', 'Q', 'K'].includes(card.value)) return 10;
  return parseInt(card.value);
}

function calculateHandValue(hand) {
  let value = 0;
  let aces = 0;
  
  for (const card of hand) {
    const cardValue = getCardValue(card);
    value += cardValue;
    if (card.value === 'A') aces++;
  }
  
  // Adjust for aces
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  
  return value;
}

function formatHand(hand, hideFirst = false) {
  if (hideFirst) {
    return `🂠 ${hand.slice(1).map(c => c.display).join(' ')}`;
  }
  return hand.map(c => c.display).join(' ');
}

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
  const random = Math.random() * 100;
  let cumulativeProbability = 0;

  for (const item of itemsArray) {
    cumulativeProbability += item.probability;
    if (random <= cumulativeProbability) {
      return item;
    }
  }

  // Fallback (should never reach here)
  return itemsArray[0];
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

  // Get 1 random item based on role
  const item = hasVipRole ? getRandomItem(vipLootboxItems) : getRandomItem(lootboxItems);

  // Award coins (1 coin for Blue, 10 coins for Jeff)
  if (item.type === 'blue') {
    const userId = message.author.id;
    const currentCoins = userCoins.get(userId) || 0;
    const newCoins = currentCoins + 1;
    userCoins.set(userId, newCoins);
    saveUserCoins(userId, newCoins).catch(err => console.error('Error saving coins:', err));
    incrementStat(userId, 'blues').catch(err => console.error('Error tracking stat:', err));
  }

  if (item.type === 'jeff') {
    const userId = message.author.id;
    const currentCoins = userCoins.get(userId) || 0;
    const newCoins = currentCoins + 10;
    userCoins.set(userId, newCoins);
    saveUserCoins(userId, newCoins).catch(err => console.error('Error saving coins:', err));
    message.reply(`# <:jeffHappy:1394970332477132830>\nYou found Jeff! And he gives you 10 coins! :coin:`);
    return;
  }

  if (item.type === 'purple') {
    incrementStat(message.author.id, 'purples').catch(err => console.error('Error tracking stat:', err));
  }

  if (item.type === 'gold') {
    incrementStat(message.author.id, 'golds').catch(err => console.error('Error tracking stat:', err));
  }

  // Ping user and owner for rare items
  if (item.type === 'purple' || item.type === 'gold') {
    message.reply(`${message.author} <@334000664130617345> ${item.message}`);
  } else {
    message.reply(item.message);
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
      userStats.set(user.userId, user.stats || { blues: 0, purples: 0, golds: 0, slotsWins: 0, blackjackWins: 0 });
      userInventory.set(user.userId, user.inventory || []);
      userEquipped.set(user.userId, { color: user.equippedColor || null, badge: user.equippedBadge || null });
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
    // Check if in allowed channels
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;
    
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
    // Check if in allowed channels
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;
    
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
    // Check if in allowed channels
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;
    
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

  // Blackjack command
  if (message.content.toLowerCase().startsWith('!blackjack')) {
    // Check if in allowed channels
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;
    
    const userId = message.author.id;
    
    // Check if user already has an active game
    if (activeBlackjackGames.has(userId)) {
      message.reply(`You already have an active blackjack game! Use \`!hit\` or \`!stand\` to continue.`);
      return;
    }
    
    const args = message.content.split(' ');
    const bet = parseInt(args[1]);
    
    if (isNaN(bet) || bet <= 0) {
      message.reply(`Usage: \`!blackjack <bet>\`\nExample: \`!blackjack 10\``);
      return;
    }
    
    // Get user coins
    let coins = userCoins.get(userId);
    if (coins === undefined) {
      await loadUserData(userId);
      coins = userCoins.get(userId) || 0;
    }

    // Check if user has any coins at all
    if (coins <= 0) {
      message.reply(`You don't have any coins to play Blackjack! Use \`!lootbox\` to earn coins.`);
      return;
    }
    
    // Check if user has enough coins for the bet
    if (coins < bet) {
      message.reply(`You don't have enough coins! You have **${coins}** coins but tried to bet **${bet}** coins.`);
      return;
    }
    
    // Create and shuffle deck
    const deck = shuffleDeck(createDeck());
    
    // Deal initial cards
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];
    
    const playerValue = calculateHandValue(playerHand);
    const dealerValue = calculateHandValue(dealerHand);
    
    // Check for immediate blackjack or bust
    if (playerValue === 21) {
      // Player blackjack!
      const winnings = bet;
      const newCoins = Math.max(0, coins + winnings);
      userCoins.set(userId, newCoins);
      saveUserCoins(userId, newCoins).catch(err => console.error('Error saving coins:', err));
      incrementStat(userId, 'blackjackWins').catch(err => console.error('Error tracking stat:', err));
      
      message.reply(
        `🃏 **BLACKJACK!** 🎉\n\n` +
        `Your hand: ${formatHand(playerHand)} = **${playerValue}**\n` +
        `Dealer hand: ${formatHand(dealerHand)} = **${dealerValue}**\n\n` +
        `You win **${winnings}** coins! 💰\n` +
        `Balance: **${newCoins}** coins`
      );
      return;
    }
    
    if (dealerValue === 21) {
      // Dealer blackjack!
      const loss = bet;
      const newCoins = Math.max(0, coins - loss);
      userCoins.set(userId, newCoins);
      saveUserCoins(userId, newCoins).catch(err => console.error('Error saving coins:', err));
      
      message.reply(
        `🃏 **Dealer Blackjack!** 😭\n\n` +
        `Your hand: ${formatHand(playerHand)} = **${playerValue}**\n` +
        `Dealer hand: ${formatHand(dealerHand)} = **${dealerValue}**\n\n` +
        `You lose **${loss}** coins! 💸\n` +
        `Balance: **${newCoins}** coins`
      );
      return;
    }
    
    // Save game state
    activeBlackjackGames.set(userId, {
      deck,
      playerHand,
      dealerHand,
      bet,
      startCoins: coins
    });
    
    message.reply(
      `🃏 **Blackjack Started!**\n\n` +
      `Your hand: ${formatHand(playerHand)} = **${playerValue}**\n` +
      `Dealer hand: ${formatHand(dealerHand, true)}\n\n` +
      `Bet: **${bet}** coins\n\n` +
      `Type \`!hit\` to draw another card or \`!stand\` to hold.`
    );
  }

  // Hit command
  if (message.content.toLowerCase() === '!hit') {
    // Check if in allowed channels
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;
    
    const userId = message.author.id;
    const game = activeBlackjackGames.get(userId);
    
    if (!game) {
      message.reply(`You don't have an active blackjack game! Start one with \`!blackjack <bet>\``);
      return;
    }
    
    // Draw a card
    const newCard = game.deck.pop();
    game.playerHand.push(newCard);
    
    const playerValue = calculateHandValue(game.playerHand);
    
    // Check for bust
    if (playerValue > 21) {
      const loss = game.bet;
      const newCoins = Math.max(0, game.startCoins - loss);
      userCoins.set(userId, newCoins);
      saveUserCoins(userId, newCoins).catch(err => console.error('Error saving coins:', err));
      
      activeBlackjackGames.delete(userId);
      
      message.reply(
        `🃏 **BUST!** 💥\n\n` +
        `Your hand: ${formatHand(game.playerHand)} = **${playerValue}**\n\n` +
        `You lose **${loss}** coins! 💸\n` +
        `Balance: **${newCoins}** coins`
      );
      return;
    }
    
    message.reply(
      `🃏 **You drew: ${newCard.display}**\n\n` +
      `Your hand: ${formatHand(game.playerHand)} = **${playerValue}**\n` +
      `Dealer hand: ${formatHand(game.dealerHand, true)}\n\n` +
      `Type \`!hit\` to draw another card or \`!stand\` to hold.`
    );
  }

  // Stand command
  if (message.content.toLowerCase() === '!stand') {
    // Check if in allowed channels
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;
    
    const userId = message.author.id;
    const game = activeBlackjackGames.get(userId);
    
    if (!game) {
      message.reply(`You don't have an active blackjack game! Start one with \`!blackjack <bet>\``);
      return;
    }
    
    const playerValue = calculateHandValue(game.playerHand);
    let dealerValue = calculateHandValue(game.dealerHand);
    
    // Dealer draws until 17 or higher
    const dealerDraws = [];
    while (dealerValue < 17) {
      const newCard = game.deck.pop();
      game.dealerHand.push(newCard);
      dealerDraws.push(newCard.display);
      dealerValue = calculateHandValue(game.dealerHand);
    }
    
    let result = '';
    let coinsChange = 0;
    
    // Determine winner
    if (dealerValue > 21) {
      // Dealer bust, player wins
      result = '**You win!** Dealer busted! 🎉';
      coinsChange = game.bet;
      incrementStat(userId, 'blackjackWins').catch(err => console.error('Error tracking stat:', err));
    } else if (playerValue > dealerValue) {
      // Player has higher value
      result = '**You win!** 🎉';
      coinsChange = game.bet;
      incrementStat(userId, 'blackjackWins').catch(err => console.error('Error tracking stat:', err));
    } else if (playerValue < dealerValue) {
      // Dealer has higher value
      result = '**You lose!** 😭';
      coinsChange = -game.bet;
    } else {
      // Tie - user gets their bet back
      result = '**Push!** It\'s a tie! 🤝';
      coinsChange = 0;
    }
    
    const newCoins = Math.max(0, game.startCoins + coinsChange);
    userCoins.set(userId, newCoins);
    saveUserCoins(userId, newCoins).catch(err => console.error('Error saving coins:', err));
    
    activeBlackjackGames.delete(userId);
    
    // Format the end game display
    const hiddenCard = game.dealerHand[0].display;
    
    let replyText = `🃏 **Game Over!**\n\n` +
      `Your hand: ${formatHand(game.playerHand)} = **${playerValue}**\n\n` +
      `Dealer reveals: ${hiddenCard}\n`;
    
    if (dealerDraws.length > 0) {
      replyText += `Dealer drew: ${dealerDraws.join(' ')}\n`;
    }
    
    replyText += `Dealer hand: ${formatHand(game.dealerHand)} = **${dealerValue}**\n\n`;
    
    replyText += `${result}\n`;
    
    if (coinsChange > 0) {
      replyText += `You won **${coinsChange}** coins! 💰\n`;
    } else if (coinsChange < 0) {
      replyText += `You lost **${Math.abs(coinsChange)}** coins! 💸\n`;
    }
    
    replyText += `Balance: **${newCoins}** coins`;
    
    message.reply(replyText);
  }

  // Leaderboard command (admin only)
  if (message.content.toLowerCase() === '!leaderboard') {
    // Check if in allowed channels
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;

    // Admin only
    if (message.author.id !== ADMIN_USER_ID) return;

    // Fetch top 5 users by coins from database
    const topUsers = await User.find().sort({ coins: -1 }).limit(5);

    if (topUsers.length === 0) {
      message.reply(`No users found on the leaderboard yet!`);
      return;
    }

    let leaderboardText = `🏆 **LEADERBOARD — Top 5**\n\n`;

    for (let i = 0; i < topUsers.length; i++) {
      let username = `Unknown User`;
      try {
        const member = await message.guild.members.fetch(topUsers[i].userId);
        username = member.displayName;
      } catch {
        // User might have left the server
      }
      leaderboardText += `**#${i + 1} — ${username}**\n`;
      leaderboardText += `🪙 Coins: **${topUsers[i].coins}**\n\n`;
    }

    message.reply(leaderboardText);
  }

  // Market command
  if (message.content.toLowerCase() === '!market') {
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;

    const marketText =
      `🛒 **MARKET**\n\n` +
      `**✨ Mega Colors — 75 coins each**\n` +
      `\`1\` Mega Blue\n\`2\` Mega Yellow\n\`3\` Mega Green\n\`4\` Mega Red\n` +
      `\`5\` Mega Purple\n\`6\` Mega Cyan\n\`7\` Mega Orange\n\`8\` Mega Pink\n\`9\` Mega Brown\n\n` +
      `**🎨 Colors — 50 coins each**\n` +
      `\`10\` Blue\n\`11\` Yellow\n\`12\` Green\n\`13\` Red\n` +
      `\`14\` Purple\n\`15\` Cyan\n\`16\` Orange\n\`17\` Pink\n\`18\` Brown\n\n` +
      `**🏅 Badges**\n` +
      `\`19\` Jeff Badge — 200 coins\n` +
      `\`20\` Kuno Badge — 150 coins\n` +
      `\`21\` PJ Badge — 100 coins\n` +
      `\`22\` Lexa Badge — 100 coins\n` +
      `\`23\` Luna Badge — 100 coins\n` +
      `\`24\` White Fox Badge — 100 coins\n\n` +
      `Use \`!buy <id>\` to purchase an item.\n` +
      `Use \`!inventory\` to see your items.\n` +
      `Use \`!equip <id>\` to equip an item.`;

    message.reply(marketText);
  }

  // Buy command
  if (message.content.toLowerCase().startsWith('!buy')) {
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;

    const args = message.content.split(' ');
    const itemId = parseInt(args[1]);
    const userId = message.author.id;

    if (isNaN(itemId) || !marketItems[itemId]) {
      message.reply(`Invalid item ID! Use \`!market\` to see available items.`);
      return;
    }

    const item = marketItems[itemId];

    // Load user data if not cached
    if (!userCoins.has(userId)) await loadUserData(userId);

    const coins = userCoins.get(userId) || 0;
    const inventory = userInventory.get(userId) || [];

    // Check if already owned
    if (inventory.includes(itemId)) {
      message.reply(`You already own **${item.name}**!`);
      return;
    }

    // Check coins
    if (coins < item.price) {
      message.reply(`You don't have enough coins! **${item.name}** costs **${item.price}** coins but you only have **${coins}** coins.`);
      return;
    }

    // Deduct coins and add to inventory
    const newCoins = coins - item.price;
    const newInventory = [...inventory, itemId];

    userCoins.set(userId, newCoins);
    userInventory.set(userId, newInventory);

    saveUserCoins(userId, newCoins).catch(err => console.error('Error saving coins:', err));
    User.findOneAndUpdate(
      { userId },
      { inventory: newInventory },
      { upsert: true }
    ).catch(err => console.error('Error saving inventory:', err));

    message.reply(`✅ You purchased **${item.name}** for **${item.price}** coins! You now have **${newCoins}** coins.\nUse \`!equip ${itemId}\` to equip it.`);
  }

  // Inventory command
  if (message.content.toLowerCase() === '!inventory') {
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;

    const userId = message.author.id;

    // Load user data if not cached
    if (!userInventory.has(userId)) await loadUserData(userId);

    const inventory = userInventory.get(userId) || [];
    const equipped = userEquipped.get(userId) || { color: null, badge: null };

    if (inventory.length === 0) {
      message.reply(`Your inventory is empty! Use \`!market\` to see available items.`);
      return;
    }

    const megaColors = inventory.filter(id => marketItems[id]?.type === 'megaColor');
    const colors = inventory.filter(id => marketItems[id]?.type === 'color');
    const badges = inventory.filter(id => marketItems[id]?.type === 'badge');

    let inventoryText = `🎒 **YOUR INVENTORY**\n\n`;

    if (megaColors.length > 0) {
      inventoryText += `**✨ Mega Colors**\n`;
      megaColors.forEach(id => {
        const equippedMark = equipped.color === id ? ' *(equipped)*' : '';
        inventoryText += `\`${id}\` ${marketItems[id].name}${equippedMark}\n`;
      });
      inventoryText += '\n';
    }

    if (colors.length > 0) {
      inventoryText += `**🎨 Colors**\n`;
      colors.forEach(id => {
        const equippedMark = equipped.color === id ? ' *(equipped)*' : '';
        inventoryText += `\`${id}\` ${marketItems[id].name}${equippedMark}\n`;
      });
      inventoryText += '\n';
    }

    if (badges.length > 0) {
      inventoryText += `**🏅 Badges**\n`;
      badges.forEach(id => {
        const equippedMark = equipped.badge === id ? ' *(equipped)*' : '';
        inventoryText += `\`${id}\` ${marketItems[id].name}${equippedMark}\n`;
      });
    }

    inventoryText += `\nUse \`!equip <id>\` to equip an item.`;
    message.reply(inventoryText);
  }

  // Equip command
  if (message.content.toLowerCase().startsWith('!equip')) {
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;

    const args = message.content.split(' ');
    const itemId = parseInt(args[1]);
    const userId = message.author.id;

    if (isNaN(itemId) || !marketItems[itemId]) {
      message.reply(`Invalid item ID! Use \`!inventory\` to see your items.`);
      return;
    }

    // Load user data if not cached
    if (!userInventory.has(userId)) await loadUserData(userId);

    const inventory = userInventory.get(userId) || [];
    const equipped = userEquipped.get(userId) || { color: null, badge: null };

    // Check if user owns item
    if (!inventory.includes(itemId)) {
      message.reply(`You don't own **${marketItems[itemId].name}**! Use \`!buy ${itemId}\` to purchase it.`);
      return;
    }

    const item = marketItems[itemId];
    const isColor = isColorItem(item);
    const isBadge = item.type === 'badge';

    // Remove currently equipped role of same type
    if (isColor && equipped.color !== null && equipped.color !== itemId) {
      const oldItem = marketItems[equipped.color];
      if (oldItem) {
        await message.member.roles.remove(oldItem.roleId).catch(err => console.error('Error removing old color role:', err));
      }
    }
    if (isBadge && equipped.badge !== null && equipped.badge !== itemId) {
      const oldItem = marketItems[equipped.badge];
      if (oldItem) {
        await message.member.roles.remove(oldItem.roleId).catch(err => console.error('Error removing old badge role:', err));
      }
    }

    // Add new role
    await message.member.roles.add(item.roleId).catch(err => console.error('Error adding role:', err));

    // Update equipped cache
    const newEquipped = { ...equipped };
    if (isColor) newEquipped.color = itemId;
    if (isBadge) newEquipped.badge = itemId;
    userEquipped.set(userId, newEquipped);

    // Save to database
    User.findOneAndUpdate(
      { userId },
      { equippedColor: newEquipped.color, equippedBadge: newEquipped.badge },
      { upsert: true }
    ).catch(err => console.error('Error saving equipped:', err));

    message.reply(`✅ You equipped **${item.name}**!`);
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

// Age verification - assign role if user types a valid birth year less than 2008
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Spam check channel - auto ban anyone who messages here
  if (message.channel.id === '1494079451087241296') {
    try {
      await message.member.ban({ 
        deleteMessageSeconds: 3600, // Delete messages from the previous hour
        reason: 'Suspicious or spam account'
      });
      console.log(`Banned user ${message.author.tag} for messaging in spam check channel`);
    } catch (error) {
      console.error('Error banning user:', error);
    }
    return;
  }

  if (message.channel.id !== '1269762954685976647') return;

  const input = message.content.trim();

  // If not exactly 4 digits, prompt the user
  if (!/^\d{4}$/.test(input)) {
    message.channel.send(`${message.author} Please **only** write your **birth year**`);
    return;
  }

  const year = parseInt(input);

  // If year is less than 1926, it's not a valid year
  if (year < 1926) {
    message.channel.send(`${message.author} Please enter a valid year.`);
    return;
  }

  // If year is 2008 or higher, user is under 18 - silently ignore
  if (year >= 2008) return;

  // Valid year between 1926-2007, give role
  try {
    await message.member.roles.add('1265303728668414064');
  } catch (error) {
    console.error('Error adding age verification role:', error);
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

    // Check if user removed their server boost
    const wasBosting = oldMember.premiumSince !== null;
    const isBoosting = newMember.premiumSince !== null;

    if (wasBosting && !isBoosting && newMember.guild.id === '1265290521199509627') {
      const boostChannel = await newMember.guild.channels.fetch('1265305805998002307');
      if (boostChannel) {
        boostChannel.send(`💔 <@${newMember.id}> has removed their boost from the server.`);
      }
    }
  } catch (error) {
    console.error('Error handling role update:', error);
  }
});

client.login(process.env.DISCORD_TOKEN);
