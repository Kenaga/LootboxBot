const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the real handlers with Discord and timers mocked; never connect to live services.
const source = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
const helpers = source.slice(source.indexOf('async function openTrainChannel('), source.indexOf('// Function to handle lootbox command'));
const findHandler = source.slice(source.indexOf('  // Find a Discord user,'), source.indexOf('  // Check if the message is the lootbox command'));
const trains = source.slice(source.indexOf('  // Train command (admin only)'), source.indexOf('  // Rob command'));

function setup() {
  const edits = [], replies = [], sends = [], timers = [];
  const channel = {
    id: 'station',
    permissionOverwrites: { edit: async (...args) => edits.push(args) },
    send: async text => sends.push(text),
  };
  const message = {
    author: { id: '334000664130617345' }, channel,
    guild: { members: { fetch: async () => ({ displayName: 'Nickname' }) } },
    reply: async text => replies.push(text),
  };
  const context = vm.createContext({
    console: { error() {} },
    client: {
      channels: { fetch: async () => channel },
      users: { fetch: async id => ({ id, username: 'testuser', globalName: 'Global Name' }) },
    },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout() {},
  });
  vm.runInContext(`
    const ADMIN_USER_ID = '334000664130617345';
    const TRAIN_ROLE_ID = '1265303728668414064';
    const TRAIN_CHANNELS = ['station', 'other'];
    const TRAIN_COIN_POOLS = [200];
    const TRAIN_DURATION_MS = 1800000, BOSS_TRAIN_DURATION_MS = 3600000, BOSS_TRAIN_COINS = 1000;
    let activeTrain = null, trainTransitionInProgress = false;
    ${helpers}
    async function handle(message) { ${findHandler}\n${trains} }
  `, context);
  return { context, channel, message, edits, replies, sends, timers,
    run: content => { message.content = content; return context.handle(message); },
    active: () => vm.runInContext('activeTrain', context),
  };
}

for (const command of ['!train', '!bosstrain']) {
  for (const reason of ['timeout', 'emptied', 'stopped']) {
    test(`${command} toggles access on start and ${reason}`, async () => {
      const s = setup();
      await s.run(command);
      assert.equal(s.active().channelId, 'station');
      assert.equal(s.edits[0][0], '1265303728668414064');
      assert.deepEqual({ ...s.edits[0][1] }, { SendMessages: true });
      if (reason === 'stopped') {
        s.message.channel = { id: 'other' };
        await s.run('!stoptrain');
      } else if (reason === 'timeout') {
        s.timers[0]();
        await new Promise(resolve => setImmediate(resolve));
      } else await s.context.endTrain(reason);
      assert.equal(s.active(), null);
      assert.deepEqual({ ...s.edits[1][1] }, { SendMessages: false });
    });
  }
}

test('commands reject other users', async () => {
  const s = setup();
  s.message.author.id = 'other-user';
  for (const command of ['!finduser 123456789012345678', '!train', '!bosstrain', '!stoptrain']) await s.run(command);
  assert.equal(s.edits.length, 0);
  assert.equal(s.replies.length, 0);
});

test('opening permission failure prevents start', async () => {
  const s = setup();
  s.channel.permissionOverwrites.edit = async () => { throw new Error('Forbidden'); };
  await s.run('!train');
  assert.equal(s.active(), null);
  assert.equal(s.timers.length, 0);
  assert.match(s.replies[0], /Could not start/);
});

test('concurrent starts cannot create duplicate trains', async () => {
  const s = setup();
  let release;
  s.channel.permissionOverwrites.edit = () => new Promise(resolve => { release = resolve; });
  const first = s.run('!train');
  await s.run('!bosstrain');
  release();
  await first;
  assert.equal(s.timers.length, 1);
});

test('closing permission failure reports manual correction', async () => {
  const s = setup();
  await s.run('!train');
  s.channel.permissionOverwrites.edit = async () => { throw new Error('Forbidden'); };
  await s.context.endTrain('emptied');
  assert.match(s.sends[0], /disable it manually/);
  assert.equal(s.active(), null);
});

test('finduser accepts mentions and IDs and shows server nicknames', async () => {
  const s = setup();
  for (const arg of ['<@123456789012345678>', '<@!123456789012345678>', '123456789012345678']) {
    await s.run(`!finduser ${arg}`);
    const reply = s.replies.at(-1);
    assert.match(reply.content, /Nickname/);
    assert.match(reply.content, /@testuser/);
    assert.match(reply.content, /In this server: \*\*Yes\*\*/);
    assert.equal(reply.allowedMentions.parse.length, 0);
  }
});

test('absent members show global names and No', async () => {
  const s = setup();
  s.message.guild.members.fetch = async () => { throw { code: 10007 }; };
  await s.run('!finduser 123456789012345678');
  assert.match(s.replies[0].content, /Global Name/);
  assert.match(s.replies[0].content, /In this server: \*\*No\*\*/);
});

test('membership errors do not falsely report absence', async () => {
  const s = setup();
  s.message.guild.members.fetch = async () => { throw { code: 50013 }; };
  await s.run('!finduser 123456789012345678');
  assert.match(s.replies[0], /Could not look up/);
});

test('invalid inputs, missing users, and DMs have useful responses', async () => {
  const s = setup();
  await s.run('!finduser invalid');
  assert.match(s.replies.at(-1), /Usage:/);
  s.context.client.users.fetch = async () => { throw { code: 10013 }; };
  await s.run('!finduser 123456789012345678');
  assert.match(s.replies.at(-1), /No Discord user/);
  s.message.guild = null;
  await s.run('!finduser 123456789012345678');
  assert.match(s.replies.at(-1), /Use this command in a server/);
});
