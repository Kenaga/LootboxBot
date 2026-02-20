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
  }
});

const User = mongoose.model('User', userSchema);

// In-memory cache for faster access
const userCoins = new Map();
const userStats = new Map();
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

// Lootbox items with their probabilities
const lootboxItems = [
  { message: 'Blue 🔵', probability: 99.945 },
  { message: 'Purple 🟣', probability: 0.04 },
  { message: 'Gold 🟡', probability: 0.015 }
];

// VIP lootbox items (for users with special role)
const vipLootboxItems = [
  { message: 'Blue 🔵', probability: 98.7 },
  { message: 'Purple 🟣', probability: 1 },
  { message: 'Gold 🟡', probability: 0.3 }
];

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
    
    // Track blue stat
    incrementStat(userId, 'blues').catch(err => console.error('Error tracking stat:', err));
  }

  if (item.includes('Purple')) {
    incrementStat(message.author.id, 'purples').catch(err => console.error('Error tracking stat:', err));
  }

  if (item.includes('Gold')) {
    incrementStat(message.author.id, 'golds').catch(err => console.error('Error tracking stat:', err));
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
      userStats.set(user.userId, user.stats || { blues: 0, purples: 0, golds: 0, slotsWins: 0, blackjackWins: 0 });
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
    
    // Check if user has enough coins
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
      // Tie
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

  // Slots command
  if (message.content.toLowerCase().startsWith('!slots')) {
    // Check if in allowed channels
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;
    
    const userId = message.author.id;
    const args = message.content.split(' ');
    const bet = parseInt(args[1]);
    
    if (isNaN(bet) || bet <= 0) {
      message.reply(`Usage: \`!slots <bet>\`\nExample: \`!slots 10\``);
      return;
    }
    
    // Get user coins
    let coins = userCoins.get(userId);
    if (coins === undefined) {
      await loadUserData(userId);
      coins = userCoins.get(userId) || 0;
    }
    
    // Check if user has enough coins
    if (coins < bet) {
      message.reply(`You don't have enough coins! You have **${coins}** coins but tried to bet **${bet}** coins.`);
      return;
    }
    
    // Custom emojis
    const emoji1 = '<:emoji1:1403981675540516965>';
    const emoji2 = '<:emoji2:1452790713401217165>';
    const emoji3 = '<:emoji3:1350188678668095572>';
    const slotEmojis = [emoji1, emoji2, emoji3];
    
    // Spin the slots
    const reel1 = slotEmojis[Math.floor(Math.random() * slotEmojis.length)];
    const reel2 = slotEmojis[Math.floor(Math.random() * slotEmojis.length)];
    const reel3 = slotEmojis[Math.floor(Math.random() * slotEmojis.length)];
    
    // Check for matches
    let coinsChange = 0;
    let resultText = '';
    
    if (reel1 === reel2 && reel2 === reel3) {
      // All 3 match - win 3x the bet
      resultText = '🎰 **JACKPOT! THREE OF A KIND!** 🎉';
      coinsChange = bet * 3;
      incrementStat(userId, 'slotsWins').catch(err => console.error('Error tracking stat:', err));
    } else if (reel1 === reel2 || reel2 === reel3 || reel1 === reel3) {
      // 2 match - no win or loss
      resultText = '🎰 **TWO OF A KIND!** - No win, no loss! 🤝';
      coinsChange = 0;
    } else {
      // No matches - lose
      resultText = '💔 **No luck!** You lose!';
      coinsChange = -bet;
    }
    
    const newCoins = Math.max(0, coins + coinsChange);
    userCoins.set(userId, newCoins);
    saveUserCoins(userId, newCoins).catch(err => console.error('Error saving coins:', err));
    
    let replyText = `🎰 **SLOTS**\n\n` +
      `${reel1} ${reel2} ${reel3}\n\n` +
      `${resultText}\n`;
    
    if (coinsChange > 0) {
      replyText += `You won **${coinsChange}** coins! 💰\n`;
    } else if (coinsChange < 0) {
      replyText += `You lost **${Math.abs(coinsChange)}** coins! 💸\n`;
    }
    
    replyText += `Balance: **${newCoins}** coins`;
    
    message.reply(replyText);
  }

  // Leaderboard command
  if (message.content.toLowerCase() === '!leaderboard') {
    // Check if in allowed channels
    if (!ALLOWED_COMMAND_CHANNELS.includes(message.channel.id)) return;

    const userId = message.author.id;

    // Fetch top 5 users by coins from database
    const topUsers = await User.find().sort({ coins: -1 }).limit(5);

    // Find the calling user's rank
    const allUsers = await User.find().sort({ coins: -1 });
    const userRank = allUsers.findIndex(u => u.userId === userId) + 1;
    const userData = allUsers.find(u => u.userId === userId);

    // Format a user entry
    const formatEntry = async (user, rank) => {
      let username = `Unknown User`;
      try {
        const member = await message.guild.members.fetch(user.userId);
        username = member.displayName;
      } catch {
        // User might have left the server
      }
      const s = user.stats || {};
      return (
        `**#${rank} — ${username}**\n` +
        `🪙 Coins: **${user.coins}**\n` +
        `🔵 Blues: **${s.blues || 0}** | 🟣 Purples: **${s.purples || 0}** | 🟡 Golds: **${s.golds || 0}**\n` +
        `🎰 Slots Wins: **${s.slotsWins || 0}** | 🃏 Blackjack Wins: **${s.blackjackWins || 0}**`
      );
    };

    // Build top 5 entries
    let leaderboardText = `🏆 **LEADERBOARD — Top 5**\n\n`;
    for (let i = 0; i < topUsers.length; i++) {
      leaderboardText += await formatEntry(topUsers[i], i + 1);
      leaderboardText += '\n\n';
    }

    // Add calling user's entry if not in top 5
    if (userRank > 5 && userData) {
      leaderboardText += `─────────────────\n`;
      leaderboardText += `📍 **Your Position**\n`;
      leaderboardText += await formatEntry(userData, userRank);
    } else if (!userData) {
      leaderboardText += `─────────────────\n`;
      leaderboardText += `📍 You haven't opened any lootboxes yet!`;
    }

    message.reply(leaderboardText);
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
