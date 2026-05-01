require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  AuditLogEvent,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
});

const PREFIX = "sqs";

const spamMap = new Map();
const joinMap = new Map();
const warnMap = new Map();
const dangerMap = new Map();

const BAD_WORDS = [
  "yatim",
];

function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function isWhitelisted(member) {
  const roleId = process.env.WHITELIST_ROLE_ID;
  if (!roleId) return false;
  return member.roles.cache.has(roleId);
}

function canBypass(member) {
  return isAdmin(member) || isWhitelisted(member);
}

function modernEmbed(title, desc, color = "Blurple") {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: "SteakQurban Security",
      iconURL: client.user?.displayAvatarURL(),
    })
    .setTitle(title)
    .setDescription(desc)
    .setFooter({ text: "Security System • SQS" })
    .setTimestamp();
}

async function sendLog(guild, title, desc, color = "Red") {
  const ch = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
  if (!ch) return;

  const embed = modernEmbed(title, desc, color);
  ch.send({ embeds: [embed] }).catch(() => {});
}

function parseDuration(input) {
  if (!input) return null;

  const match = input.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const num = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  if (unit === "s") return num * 1000;
  if (unit === "m") return num * 60 * 1000;
  if (unit === "h") return num * 60 * 60 * 1000;
  if (unit === "d") return num * 24 * 60 * 60 * 1000;

  return null;
}

async function lockdownGuild(guild, executorTag = "System") {
  let count = 0;

  for (const channel of guild.channels.cache.values()) {
    if (!channel.permissionOverwrites) continue;

    await channel.permissionOverwrites
      .edit(guild.roles.everyone, { SendMessages: false })
      .then(() => count++)
      .catch(() => {});
  }

  await sendLog(
    guild,
    "🚨 Auto Lockdown Aktif",
    `Server dikunci oleh **${executorTag}**\nChannel terkunci: **${count}**`,
    "DarkRed"
  );
}

async function unlockGuild(guild, executorTag = "System") {
  let count = 0;

  for (const channel of guild.channels.cache.values()) {
    if (!channel.permissionOverwrites) continue;

    await channel.permissionOverwrites
      .edit(guild.roles.everyone, { SendMessages: null })
      .then(() => count++)
      .catch(() => {});
  }

  await sendLog(
    guild,
    "✅ Lockdown Dibuka",
    `Server dibuka oleh **${executorTag}**\nChannel dibuka: **${count}**`,
    "Green"
  );
}

client.once("clientReady", () => {
  console.log(`Security Bot aktif: ${client.user.tag}`);
});

// ================= MESSAGE SECURITY =================
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const member = message.member;
  const content = message.content;

  // Anti Invite
  const inviteRegex = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)/i;

  if (inviteRegex.test(content) && !canBypass(member)) {
    await message.delete().catch(() => {});
    await member.timeout(5 * 60 * 1000, "Anti invite").catch(() => {});

    await sendLog(
      message.guild,
      "🔗 Anti Invite Triggered",
      `User: ${message.author}\nAction: **Delete + Timeout 5 menit**`,
      "Red"
    );
    return;
  }

  // Anti Badword
  const lower = content.toLowerCase();
  if (BAD_WORDS.some((word) => lower.includes(word)) && !canBypass(member)) {
    await message.delete().catch(() => {});
    await member.timeout(3 * 60 * 1000, "Badword").catch(() => {});

    await sendLog(
      message.guild,
      "🤬 Anti Badword Triggered",
      `User: ${message.author}\nAction: **Delete + Timeout 3 menit**`,
      "Orange"
    );
    return;
  }

  // Anti Mention Spam
  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  if (mentionCount >= 5 && !canBypass(member)) {
    await message.delete().catch(() => {});
    await member.timeout(10 * 60 * 1000, "Mention spam").catch(() => {});

    await sendLog(
      message.guild,
      "📢 Anti Mention Spam",
      `User: ${message.author}\nMention: **${mentionCount}**\nAction: **Timeout 10 menit**`,
      "Red"
    );
    return;
  }

  // Anti Caps Spam
  const letters = content.replace(/[^a-zA-Z]/g, "");
  const caps = content.replace(/[^A-Z]/g, "");

  if (
    letters.length >= 12 &&
    caps.length / letters.length >= 0.8 &&
    !canBypass(member)
  ) {
    await message.delete().catch(() => {});
    await member.timeout(2 * 60 * 1000, "Caps spam").catch(() => {});

    await sendLog(
      message.guild,
      "🔠 Anti Caps Spam",
      `User: ${message.author}\nAction: **Delete + Timeout 2 menit**`,
      "Orange"
    );
    return;
  }

  // Anti Spam
  const now = Date.now();
  const id = message.author.id;

  if (!spamMap.has(id)) spamMap.set(id, []);

  const timestamps = spamMap.get(id).filter((t) => now - t < 7000);
  timestamps.push(now);
  spamMap.set(id, timestamps);

  if (timestamps.length >= 5 && !canBypass(member)) {
    await member.timeout(10 * 60 * 1000, "Spam").catch(() => {});
    spamMap.set(id, []);

    await sendLog(
      message.guild,
      "⚡ Anti Spam Triggered",
      `User: ${message.author}\nAction: **Timeout 10 menit**`,
      "Red"
    );
    return;
  }

  // ================= COMMANDS =================
  if (!content.startsWith(PREFIX)) return;

  if (!isAdmin(member)) {
    return message.reply({
      embeds: [modernEmbed("❌ Access Denied", "Command ini khusus admin.", "Red")],
    });
  }

  const args = content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === "help") {
    return message.reply({
      embeds: [
        modernEmbed(
          "🛡️ SQS Security Commands",
          [
            "`sqs ping` — cek latency",
            "`sqs status` — status security",
            "`sqs clear 10` — hapus pesan",
            "`sqs lock` / `sqs unlock` — lock channel",
            "`sqs lockdown` / `sqs unlockall` — lock semua channel",
            "`sqs warn @user alasan` — beri warning",
            "`sqs warnings @user` — lihat warning",
            "`sqs clearwarn @user` — hapus warning",
            "`sqs ban @user alasan`",
            "`sqs kick @user alasan`",
            "`sqs timeout @user 10m alasan`",
            "`sqs untimeout @user`",
          ].join("\n"),
          "Blurple"
        ),
      ],
    });
  }

  if (cmd === "ping") {
    return message.reply({
      embeds: [modernEmbed("🏓 Pong", `Latency: **${client.ws.ping}ms**`, "Green")],
    });
  }

  if (cmd === "status") {
    return message.reply({
      embeds: [
        modernEmbed(
          "🛡️ Security Status",
          [
            "Anti Spam: **ON**",
            "Anti Invite: **ON**",
            "Anti Badword: **ON**",
            "Anti Caps Spam: **ON**",
            "Anti Mention Spam: **ON**",
            "Anti Raid: **ON**",
            "Mass Delete Protection: **ON**",
          ].join("\n"),
          "Green"
        ),
      ],
    });
  }

  if (cmd === "clear") {
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) {
      return message.reply("Gunakan: `sqs clear 10`");
    }

    await message.channel.bulkDelete(amount, true).catch(() => {});
    return message.channel.send({
      embeds: [modernEmbed("🧹 Messages Cleared", `Berhasil hapus **${amount}** pesan.`, "Green")],
    });
  }

  if (cmd === "lock") {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
      SendMessages: false,
    });

    await sendLog(message.guild, "🔒 Channel Locked", `${message.channel} dikunci oleh ${message.author}`, "Orange");
    return message.reply({ embeds: [modernEmbed("🔒 Locked", "Channel ini dikunci.", "Orange")] });
  }

  if (cmd === "unlock") {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
      SendMessages: null,
    });

    await sendLog(message.guild, "🔓 Channel Unlocked", `${message.channel} dibuka oleh ${message.author}`, "Green");
    return message.reply({ embeds: [modernEmbed("🔓 Unlocked", "Channel ini dibuka.", "Green")] });
  }

  if (cmd === "lockdown") {
    await lockdownGuild(message.guild, message.author.tag);
    return message.reply({ embeds: [modernEmbed("🚨 Lockdown", "Semua channel berhasil dikunci.", "DarkRed")] });
  }

  if (cmd === "unlockall") {
    await unlockGuild(message.guild, message.author.tag);
    return message.reply({ embeds: [modernEmbed("✅ Unlock All", "Semua channel berhasil dibuka.", "Green")] });
  }

  if (cmd === "warn") {
    const target = message.mentions.members.first();
    const reason = args.slice(1).join(" ") || "Tidak ada alasan";

    if (!target) return message.reply("Gunakan: `sqs warn @user alasan`");

    const key = `${message.guild.id}-${target.id}`;
    if (!warnMap.has(key)) warnMap.set(key, []);

    warnMap.get(key).push({
      reason,
      mod: message.author.tag,
      time: new Date().toLocaleString("id-ID"),
    });

    await sendLog(message.guild, "⚠️ User Warned", `User: ${target}\nMod: ${message.author}\nReason: ${reason}`, "Orange");

    return message.reply({
      embeds: [modernEmbed("⚠️ Warn Added", `${target} diberi warning.\nReason: **${reason}**`, "Orange")],
    });
  }

  if (cmd === "warnings") {
    const target = message.mentions.members.first();
    if (!target) return message.reply("Gunakan: `sqs warnings @user`");

    const key = `${message.guild.id}-${target.id}`;
    const warns = warnMap.get(key) || [];

    if (!warns.length) {
      return message.reply({ embeds: [modernEmbed("✅ Clean", `${target} tidak punya warning.`, "Green")] });
    }

    const list = warns
      .map((w, i) => `**${i + 1}.** ${w.reason}\nMod: ${w.mod}\nTime: ${w.time}`)
      .join("\n\n");

    return message.reply({
      embeds: [modernEmbed(`⚠️ Warnings: ${target.user.tag}`, list, "Orange")],
    });
  }

  if (cmd === "clearwarn") {
    const target = message.mentions.members.first();
    if (!target) return message.reply("Gunakan: `sqs clearwarn @user`");

    const key = `${message.guild.id}-${target.id}`;
    warnMap.delete(key);

    return message.reply({
      embeds: [modernEmbed("✅ Warnings Cleared", `Warning ${target} sudah dihapus.`, "Green")],
    });
  }

  if (cmd === "ban") {
    const target = message.mentions.members.first();
    const reason = args.slice(1).join(" ") || "Tidak ada alasan";

    if (!target) return message.reply("Gunakan: `sqs ban @user alasan`");

    await target.ban({ reason }).catch(() => {
      return message.reply("Gagal ban user. Cek role bot.");
    });

    await sendLog(message.guild, "🔨 User Banned", `User: ${target.user.tag}\nMod: ${message.author.tag}\nReason: ${reason}`, "Red");
    return message.reply({ embeds: [modernEmbed("🔨 Banned", `${target.user.tag} diban.\nReason: ${reason}`, "Red")] });
  }

  if (cmd === "kick") {
    const target = message.mentions.members.first();
    const reason = args.slice(1).join(" ") || "Tidak ada alasan";

    if (!target) return message.reply("Gunakan: `sqs kick @user alasan`");

    await target.kick(reason).catch(() => {
      return message.reply("Gagal kick user. Cek role bot.");
    });

    await sendLog(message.guild, "👢 User Kicked", `User: ${target.user.tag}\nMod: ${message.author.tag}\nReason: ${reason}`, "Orange");
    return message.reply({ embeds: [modernEmbed("👢 Kicked", `${target.user.tag} dikick.\nReason: ${reason}`, "Orange")] });
  }

  if (cmd === "timeout") {
    const target = message.mentions.members.first();
    const durationInput = args[1];
    const reason = args.slice(2).join(" ") || "Tidak ada alasan";
    const duration = parseDuration(durationInput);

    if (!target || !duration) {
      return message.reply("Gunakan: `sqs timeout @user 10m alasan`");
    }

    await target.timeout(duration, reason).catch(() => {
      return message.reply("Gagal timeout user. Cek role bot.");
    });

    await sendLog(message.guild, "⏳ User Timeout", `User: ${target}\nDurasi: ${durationInput}\nReason: ${reason}`, "Orange");
    return message.reply({ embeds: [modernEmbed("⏳ Timeout", `${target} timeout **${durationInput}**.\nReason: ${reason}`, "Orange")] });
  }

  if (cmd === "untimeout") {
    const target = message.mentions.members.first();
    if (!target) return message.reply("Gunakan: `sqs untimeout @user`");

    await target.timeout(null).catch(() => {
      return message.reply("Gagal remove timeout.");
    });

    await sendLog(message.guild, "✅ Timeout Removed", `User: ${target}\nMod: ${message.author}`, "Green");
    return message.reply({ embeds: [modernEmbed("✅ Untimeout", `${target} sudah bebas timeout.`, "Green")] });
  }
});

// ================= ANTI RAID JOIN =================
client.on("guildMemberAdd", async (member) => {
  const guildId = member.guild.id;
  const now = Date.now();

  if (!joinMap.has(guildId)) joinMap.set(guildId, []);

  const joins = joinMap.get(guildId).filter((t) => now - t < 10000);
  joins.push(now);
  joinMap.set(guildId, joins);

  if (joins.length >= 5) {
    await member.timeout(30 * 60 * 1000, "Anti raid").catch(() => {});

    await sendLog(
      member.guild,
      "🚨 Anti Raid Triggered",
      `Join cepat terdeteksi.\nMember baru ${member.user.tag} diberi timeout **30 menit**.`,
      "DarkRed"
    );
  }
});

// ================= ANTI MASS DELETE CHANNEL / ROLE =================
async function handleDangerDelete(guild, type) {
  await new Promise((r) => setTimeout(r, 1000));

  const auditType = type === "channel" ? AuditLogEvent.ChannelDelete : AuditLogEvent.RoleDelete;
  const logs = await guild.fetchAuditLogs({ type: auditType, limit: 1 }).catch(() => null);
  const entry = logs?.entries.first();

  if (!entry || !entry.executor) return;

  const executorId = entry.executor.id;
  if (executorId === client.user.id || executorId === guild.ownerId) return;

  const key = `${guild.id}-${executorId}-${type}`;
  const now = Date.now();

  if (!dangerMap.has(key)) dangerMap.set(key, []);

  const actions = dangerMap.get(key).filter((t) => now - t < 60000);
  actions.push(now);
  dangerMap.set(key, actions);

  if (actions.length >= 3) {
    await lockdownGuild(guild, "Anti Mass Delete");

    const member = await guild.members.fetch(executorId).catch(() => null);

    if (member && !canBypass(member)) {
      await member.ban({ reason: `Anti mass ${type} delete` }).catch(() => {});
    }

    await sendLog(
      guild,
      "🚨 Mass Delete Protection",
      `Executor: <@${executorId}>\nType: **${type} delete**\nAction: **Auto Lockdown + Ban attempt**`,
      "DarkRed"
    );

    dangerMap.set(key, []);
  }
}

client.on("channelDelete", async (channel) => {
  if (!channel.guild) return;
  handleDangerDelete(channel.guild, "channel");
});

client.on("roleDelete", async (role) => {
  if (!role.guild) return;
  handleDangerDelete(role.guild, "role");
});

client.login(process.env.TOKEN);