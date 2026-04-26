require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = "sqs";

// ===== CHECK ADMIN =====
function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

// ===== LOG =====
async function sendLog(guild, title, desc, color = "Red") {
  const ch = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
  if (!ch) return;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(desc)
    .setTimestamp();

  ch.send({ embeds: [embed] }).catch(() => {});
}

// ===== READY =====
client.once("clientReady", () => {
  console.log(`Security Bot aktif: ${client.user.tag}`);
});

// ===== ANTI SPAM =====
const spamMap = new Map();

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const member = message.member;

  // ===== ANTI INVITE =====
  const inviteRegex = /(discord\.gg|discord\.com\/invite)/i;

  if (
    inviteRegex.test(message.content) &&
    !isAdmin(member)
  ) {
    await message.delete().catch(() => {});
    await member.timeout(5 * 60 * 1000, "Invite link").catch(() => {});

    sendLog(
      message.guild,
      "Anti Invite",
      `${message.author.tag} kirim invite → timeout 5 menit`
    );
    return;
  }

  // ===== ANTI SPAM =====
  const now = Date.now();
  const id = message.author.id;

  if (!spamMap.has(id)) spamMap.set(id, []);

  const timestamps = spamMap.get(id).filter(t => now - t < 7000);
  timestamps.push(now);
  spamMap.set(id, timestamps);

  if (timestamps.length >= 5 && !isAdmin(member)) {
    await member.timeout(10 * 60 * 1000, "Spam").catch(() => {});
    spamMap.set(id, []);

    sendLog(
      message.guild,
      "Anti Spam",
      `${message.author.tag} spam → timeout 10 menit`
    );

    return;
  }

  // ===== COMMAND =====
  if (!message.content.startsWith(PREFIX)) return;

  if (!isAdmin(member)) {
    return message.reply("❌ Command khusus admin.");
  }

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // ===== PING =====
  if (cmd === "ping") {
    return message.reply(`🏓 ${client.ws.ping}ms`);
  }

  // ===== STATUS =====
  if (cmd === "status") {
    return message.reply("🛡️ Security aktif.");
  }

  // ===== CLEAR =====
  if (cmd === "clear") {
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) {
      return message.reply("Gunakan: `sqs clear 10`");
    }

    await message.channel.bulkDelete(amount, true);
    return message.channel.send(`✅ Hapus ${amount} pesan`).then(msg => {
      setTimeout(() => msg.delete(), 3000);
    });
  }

  // ===== LOCK =====
  if (cmd === "lock") {
    await message.channel.permissionOverwrites.edit(
      message.guild.roles.everyone,
      { SendMessages: false }
    );

    sendLog(
      message.guild,
      "Channel Locked",
      `${message.channel} oleh ${message.author.tag}`,
      "Orange"
    );

    return message.reply("🔒 Channel dikunci.");
  }

  // ===== UNLOCK =====
  if (cmd === "unlock") {
    await message.channel.permissionOverwrites.edit(
      message.guild.roles.everyone,
      { SendMessages: null }
    );

    sendLog(
      message.guild,
      "Channel Unlocked",
      `${message.channel} oleh ${message.author.tag}`,
      "Green"
    );

    return message.reply("🔓 Channel dibuka.");
  }
});

// ===== ANTI RAID =====
const joinMap = new Map();

client.on("guildMemberAdd", async (member) => {
  const guildId = member.guild.id;
  const now = Date.now();

  if (!joinMap.has(guildId)) joinMap.set(guildId, []);

  const joins = joinMap.get(guildId).filter(t => now - t < 10000);
  joins.push(now);
  joinMap.set(guildId, joins);

  if (joins.length >= 5) {
    await member.timeout(30 * 60 * 1000, "Raid").catch(() => {});

    sendLog(
      member.guild,
      "Anti Raid",
      `${member.user.tag} kena timeout (raid)`
    );
  }
});

client.login(process.env.TOKEN);