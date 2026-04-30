require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  AuditLogEvent,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const PREFIX = "sqs";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
});

const spamMap = new Map();
const joinMap = new Map();
const warnMap = new Map();
const dangerMap = new Map();

const BAD_WORDS = ["yatim",];

const OWNER_IDS = process.env.OWNER_IDS?.split(",") || [];

function isAdmin(member) {
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    OWNER_IDS.includes(member.id)
  );
}

function isWhitelisted(member) {
  const roleId = process.env.WHITELIST_ROLE_ID;
  if (!roleId || !member?.roles?.cache) return false;
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
    .setDescription(desc || "Tidak ada deskripsi.")
    .setFooter({ text: "Security System • SQS Premium" })
    .setTimestamp();
}

function statusDescription() {
  return [
    "✅ Anti Spam: **ON**",
    "✅ Anti Invite: **ON**",
    "✅ Anti Badword: **ON**",
    "✅ Anti Caps Spam: **ON**",
    "✅ Anti Mention Spam: **ON**",
    "✅ Anti Raid: **ON**",
    "✅ Mass Delete Protection: **ON**",
    "",
    "Mode: **Premium Protection**",
  ].join("\n");
}

function panelEmbed(guild) {
  return new EmbedBuilder()
    .setColor("Blurple")
    .setAuthor({
      name: "SteakQurban Security",
      iconURL: client.user?.displayAvatarURL(),
    })
    .setTitle("🛡️ Premium Security Control Panel")
    .setDescription("Dashboard keamanan modern untuk kontrol cepat server.")
    .addFields(
      {
        name: "Protection",
        value: "✅ Anti Spam\n✅ Anti Invite\n✅ Anti Badword\n✅ Anti Mention\n✅ Anti Caps\n✅ Anti Raid",
        inline: true,
      },
      {
        name: "Moderation",
        value: "✅ Lock / Unlock\n✅ Lockdown\n✅ Clear Messages\n✅ Timeout\n✅ Ban / Kick\n✅ Warn System",
        inline: true,
      },
      {
        name: "Server",
        value: `**${guild.name}**\nMembers: **${guild.memberCount ?? "Unknown"}**`,
        inline: false,
      }
    )
    .setFooter({ text: "SQS Premium Panel • Admin Only" })
    .setTimestamp();
}

function panelRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("sqs_panel_status")
      .setLabel("Status")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("sqs_panel_lock")
      .setLabel("Lock")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("sqs_panel_unlock")
      .setLabel("Unlock")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("sqs_panel_clear10")
      .setLabel("Clear 10")
      .setEmoji("🧹")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("sqs_panel_lockdown")
      .setLabel("Panic Lockdown")
      .setEmoji("🚨")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("sqs_panel_unlockall")
      .setLabel("Unlock All")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("sqs_panel_help")
      .setLabel("Help")
      .setEmoji("📘")
      .setStyle(ButtonStyle.Primary)
  );

  return [row1, row2];
}

function cutText(value, max = 1024) {
  const text = String(value ?? "Tidak ada");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

async function sendLog(guild, title, desc, color = "Red", data = {}) {
  const ch = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
  if (!ch) return;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: "SteakQurban Security Logs",
      iconURL: client.user?.displayAvatarURL(),
    })
    .setTitle(title)
    .setDescription(cutText(desc, 2048))
    .addFields(
      {
        name: "Executor",
        value: data.executor || "Unknown / System",
        inline: true,
      },
      {
        name: "Target",
        value: data.target || "N/A",
        inline: true,
      },
      {
        name: "Action",
        value: data.action || title,
        inline: true,
      },
      {
        name: "Channel",
        value: data.channel || "N/A",
        inline: true,
      },
      {
        name: "Reason",
        value: cutText(data.reason || "Tidak ada", 1024),
        inline: false,
      },
      {
        name: "Server",
        value: `${guild.name} (${guild.id})`,
        inline: false,
      }
    )
    .setFooter({ text: "SQS Premium Logging • Audit Trail" })
    .setTimestamp();

  await ch.send({ embeds: [embed] }).catch(() => {});
}

async function premiumLog(guild, payload = {}) {
  return sendLog(
    guild,
    payload.title || "📊 Security Log",
    payload.description || "Aktivitas tercatat oleh sistem keamanan.",
    payload.color || "Blurple",
    {
      executor: payload.executor,
      target: payload.target,
      action: payload.action,
      channel: payload.channel,
      reason: payload.reason,
    }
  );
}

async function fetchLatestAudit(guild, type) {
  const logs = await guild.fetchAuditLogs({ type, limit: 1 }).catch(() => null);
  return logs?.entries.first() || null;
}

function parseDuration(input) {
  if (!input) return null;
  const match = input.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const num = parseInt(match[1], 10);
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
    "🚨 Lockdown Active",
    `Executor: **${executorTag}**\nLocked channels: **${count}**`,
    "DarkRed"
  );

  return count;
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
    "✅ Lockdown Removed",
    `Executor: **${executorTag}**\nUnlocked channels: **${count}**`,
    "Green"
  );

  return count;
}

function helpEmbed() {
  return modernEmbed(
    "🛡️ SQS Premium Commands",
    [
      "**Prefix Commands**",
      "`sqs panel`, `sqs help`, `sqs ping`, `sqs status`",
      "`sqs clear 10`, `sqs lock`, `sqs unlock`",
      "`sqs lockdown`, `sqs unlockall`",
      "`sqs warn @user alasan`, `sqs warnings @user`, `sqs clearwarn @user`",
      "`sqs ban @user alasan`, `sqs kick @user alasan`",
      "`sqs timeout @user 10m alasan`, `sqs untimeout @user`",
      "",
      "**Slash Commands**",
      "`/panel`, `/status`, `/ping`, `/clear`, `/lock`, `/unlock`, `/lockdown`, `/unlockall`",
    ].join("\n"),
    "Blurple"
  );
}

async function ensureAdminReply(ctx) {
  const member = ctx.member;
  if (isAdmin(member)) return true;

  const payload = {
    embeds: [modernEmbed("❌ Access Denied", "Command ini khusus admin.", "Red")],
    ephemeral: true,
  };

  if (ctx.isChatInputCommand?.() || ctx.isButton?.()) {
    await ctx.reply(payload).catch(() => {});
  } else {
    await ctx.reply({ embeds: payload.embeds }).catch(() => {});
  }

  return false;
}

async function runAction(ctx, cmd, args = []) {
  const isInteraction = Boolean(ctx.isChatInputCommand?.());
  const guild = ctx.guild;
  const channel = ctx.channel;
  const member = ctx.member;
  const user = ctx.user || ctx.author;

  if (!(await ensureAdminReply(ctx))) return;

  const reply = async (payload) => {
    if (isInteraction) {
      if (ctx.replied || ctx.deferred) return ctx.followUp(payload);
      return ctx.reply(payload);
    }
    return ctx.reply(payload);
  };

  if (cmd === "help") {
    return reply({ embeds: [helpEmbed()] });
  }

  if (cmd === "panel") {
    return reply({ embeds: [panelEmbed(guild)], components: panelRows() });
  }

  if (cmd === "ping") {
    return reply({
      embeds: [modernEmbed("🏓 Pong", `Latency: **${client.ws.ping}ms**`, "Green")],
    });
  }

  if (cmd === "status") {
    return reply({
      embeds: [modernEmbed("🛡️ Security Status", statusDescription(), "Green")],
    });
  }

  if (cmd === "clear") {
    const amount = isInteraction
      ? ctx.options.getInteger("amount")
      : parseInt(args[0], 10);

    if (!amount || amount < 1 || amount > 100) {
      return reply({ content: "Gunakan: `sqs clear 10` atau `/clear amount:10`", ephemeral: true });
    }

    await channel.bulkDelete(amount, true).catch(() => {});
    return reply({
      embeds: [modernEmbed("🧹 Messages Cleared", `Berhasil hapus **${amount}** pesan.`, "Green")],
      ephemeral: true,
    });
  }

  if (cmd === "lock") {
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    await sendLog(guild, "🔒 Channel Locked", `${channel} dikunci oleh ${user}`, "Orange");
    return reply({ embeds: [modernEmbed("🔒 Locked", "Channel ini dikunci.", "Orange")] });
  }

  if (cmd === "unlock") {
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
    await sendLog(guild, "🔓 Channel Unlocked", `${channel} dibuka oleh ${user}`, "Green");
    return reply({ embeds: [modernEmbed("🔓 Unlocked", "Channel ini dibuka.", "Green")] });
  }

  if (cmd === "lockdown") {
    const count = await lockdownGuild(guild, user.tag);
    return reply({ embeds: [modernEmbed("🚨 Lockdown", `Semua channel berhasil dikunci.\nTotal: **${count}**`, "DarkRed")] });
  }

  if (cmd === "unlockall") {
    const count = await unlockGuild(guild, user.tag);
    return reply({ embeds: [modernEmbed("✅ Unlock All", `Semua channel berhasil dibuka.\nTotal: **${count}**`, "Green")] });
  }

  if (cmd === "warn") {
    const target = isInteraction
      ? ctx.options.getMember("user")
      : ctx.mentions.members.first();

    const reason = isInteraction
      ? (ctx.options.getString("reason") || "Tidak ada alasan")
      : (args.slice(1).join(" ") || "Tidak ada alasan");

    if (!target) return reply({ content: "Gunakan: `sqs warn @user alasan`", ephemeral: true });

    const key = `${guild.id}-${target.id}`;
    if (!warnMap.has(key)) warnMap.set(key, []);

    warnMap.get(key).push({
      reason,
      mod: user.tag,
      time: new Date().toLocaleString("id-ID"),
    });

    await sendLog(guild, "⚠️ User Warned", `User: ${target}\nMod: ${user}\nReason: ${reason}`, "Orange");
    return reply({ embeds: [modernEmbed("⚠️ Warn Added", `${target} diberi warning.\nReason: **${reason}**`, "Orange")] });
  }

  if (cmd === "warnings") {
    const target = isInteraction
      ? ctx.options.getMember("user")
      : ctx.mentions.members.first();

    if (!target) return reply({ content: "Gunakan: `sqs warnings @user`", ephemeral: true });

    const key = `${guild.id}-${target.id}`;
    const warns = warnMap.get(key) || [];

    if (!warns.length) {
      return reply({ embeds: [modernEmbed("✅ Clean", `${target} tidak punya warning.`, "Green")] });
    }

    const list = warns
      .map((w, i) => `**${i + 1}.** ${w.reason}\nMod: ${w.mod}\nTime: ${w.time}`)
      .join("\n\n");

    return reply({ embeds: [modernEmbed(`⚠️ Warnings: ${target.user.tag}`, list, "Orange")] });
  }

  if (cmd === "clearwarn") {
    const target = isInteraction
      ? ctx.options.getMember("user")
      : ctx.mentions.members.first();

    if (!target) return reply({ content: "Gunakan: `sqs clearwarn @user`", ephemeral: true });

    warnMap.delete(`${guild.id}-${target.id}`);
    return reply({ embeds: [modernEmbed("✅ Warnings Cleared", `Warning ${target} sudah dihapus.`, "Green")] });
  }

  if (cmd === "ban") {
    const target = isInteraction
      ? ctx.options.getMember("user")
      : ctx.mentions.members.first();

    const reason = isInteraction
      ? (ctx.options.getString("reason") || "Tidak ada alasan")
      : (args.slice(1).join(" ") || "Tidak ada alasan");

    if (!target) return reply({ content: "Gunakan: `sqs ban @user alasan`", ephemeral: true });

    await target.ban({ reason }).catch(() => null);
    await sendLog(guild, "🔨 User Banned", `User: ${target.user.tag}\nMod: ${user.tag}\nReason: ${reason}`, "Red");
    return reply({ embeds: [modernEmbed("🔨 Banned", `${target.user.tag} diban.\nReason: ${reason}`, "Red")] });
  }

  if (cmd === "kick") {
    const target = isInteraction
      ? ctx.options.getMember("user")
      : ctx.mentions.members.first();

    const reason = isInteraction
      ? (ctx.options.getString("reason") || "Tidak ada alasan")
      : (args.slice(1).join(" ") || "Tidak ada alasan");

    if (!target) return reply({ content: "Gunakan: `sqs kick @user alasan`", ephemeral: true });

    await target.kick(reason).catch(() => null);
    await sendLog(guild, "👢 User Kicked", `User: ${target.user.tag}\nMod: ${user.tag}\nReason: ${reason}`, "Orange");
    return reply({ embeds: [modernEmbed("👢 Kicked", `${target.user.tag} dikick.\nReason: ${reason}`, "Orange")] });
  }

  if (cmd === "timeout") {
    const target = isInteraction
      ? ctx.options.getMember("user")
      : ctx.mentions.members.first();

    const durationInput = isInteraction
      ? ctx.options.getString("duration")
      : args[1];

    const reason = isInteraction
      ? (ctx.options.getString("reason") || "Tidak ada alasan")
      : (args.slice(2).join(" ") || "Tidak ada alasan");

    const duration = parseDuration(durationInput);
    if (!target || !duration) {
      return reply({ content: "Gunakan: `sqs timeout @user 10m alasan`", ephemeral: true });
    }

    await target.timeout(duration, reason).catch(() => null);
    await sendLog(guild, "⏳ User Timeout", `User: ${target}\nDurasi: ${durationInput}\nReason: ${reason}`, "Orange");
    return reply({ embeds: [modernEmbed("⏳ Timeout", `${target} timeout **${durationInput}**.\nReason: ${reason}`, "Orange")] });
  }

  if (cmd === "untimeout") {
    const target = isInteraction
      ? ctx.options.getMember("user")
      : ctx.mentions.members.first();

    if (!target) return reply({ content: "Gunakan: `sqs untimeout @user`", ephemeral: true });

    await target.timeout(null).catch(() => null);
    await sendLog(guild, "✅ Timeout Removed", `User: ${target}\nMod: ${user}`, "Green");
    return reply({ embeds: [modernEmbed("✅ Untimeout", `${target} sudah bebas timeout.`, "Green")] });
  }

  return reply({ embeds: [modernEmbed("❔ Unknown Command", "Gunakan `sqs help` atau `/panel`.", "Orange")] });
}

client.once("clientReady", () => {
  console.log(`Security Bot aktif: ${client.user.tag}`);
  client.user.setPresence({
  activities: [
    {
      name: "Anti Nuke Protection 🛡️",
      type: 3,
    },
  ],
  status: "dnd",
});
});

// ================= SLASH + BUTTON HANDLER =================
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      return runAction(interaction, interaction.commandName);
    }

    if (!interaction.isButton()) return;

    if (!(await ensureAdminReply(interaction))) return;

    const id = interaction.customId;

    if (id === "sqs_panel_status") {
      return interaction.reply({
        embeds: [modernEmbed("📊 Security Status", statusDescription(), "Green")],
        ephemeral: true,
      });
    }

    if (id === "sqs_panel_help") {
      return interaction.reply({ embeds: [helpEmbed()], ephemeral: true });
    }

    if (id === "sqs_panel_lock") {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: false,
      });
      await sendLog(interaction.guild, "🔒 Channel Locked", `${interaction.channel} dikunci oleh ${interaction.user}`, "Orange");
      return interaction.reply({ embeds: [modernEmbed("🔒 Locked", "Channel ini dikunci.", "Orange")] });
    }

    if (id === "sqs_panel_unlock") {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: null,
      });
      await sendLog(interaction.guild, "🔓 Channel Unlocked", `${interaction.channel} dibuka oleh ${interaction.user}`, "Green");
      return interaction.reply({ embeds: [modernEmbed("🔓 Unlocked", "Channel ini dibuka.", "Green")] });
    }

    if (id === "sqs_panel_lockdown") {
      const count = await lockdownGuild(interaction.guild, interaction.user.tag);
      return interaction.reply({
        embeds: [modernEmbed("🚨 Lockdown", `Semua channel berhasil dikunci.\nTotal: **${count}**`, "DarkRed")],
      });
    }

    if (id === "sqs_panel_unlockall") {
      const count = await unlockGuild(interaction.guild, interaction.user.tag);
      return interaction.reply({
        embeds: [modernEmbed("✅ Unlock All", `Semua channel berhasil dibuka.\nTotal: **${count}**`, "Green")],
      });
    }

    if (id === "sqs_panel_clear10") {
      await interaction.channel.bulkDelete(10, true).catch(() => {});
      return interaction.reply({
        embeds: [modernEmbed("🧹 Clear 10", "10 pesan terakhir berhasil dihapus.", "Green")],
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error("INTERACTION ERROR:", err);
    const payload = {
      embeds: [modernEmbed("❌ Interaction Error", "Terjadi error saat menjalankan command/button.", "Red")],
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => {});
    return interaction.reply(payload).catch(() => {});
  }
});

// ================= MESSAGE SECURITY + PREFIX COMMANDS =================
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const member = message.member;
  const content = message.content;

  const inviteRegex = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)/i;

  if (inviteRegex.test(content) && !canBypass(member)) {
    await message.delete().catch(() => {});
    await member.timeout(5 * 60 * 1000, "Anti invite").catch(() => {});
    await sendLog(message.guild, "🔗 Anti Invite Triggered", `User: ${message.author}\nAction: **Delete + Timeout 5 menit**`, "Red");
    return;
  }

  const lower = content.toLowerCase();
  if (BAD_WORDS.some((word) => lower.includes(word)) && !canBypass(member)) {
    await message.delete().catch(() => {});
    await member.timeout(3 * 60 * 1000, "Badword").catch(() => {});
    await sendLog(message.guild, "🤬 Anti Badword Triggered", `User: ${message.author}\nAction: **Delete + Timeout 3 menit**`, "Orange");
    return;
  }

  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  if (mentionCount >= 15 && !canBypass(member)) {
    await message.delete().catch(() => {});
    await member.timeout(10 * 60 * 1000, "Mention spam").catch(() => {});
    await sendLog(message.guild, "📢 Anti Mention Spam", `User: ${message.author}\nMention: **${mentionCount}**\nAction: **Timeout 10 menit**`, "Red");
    return;
  }

  const letters = content.replace(/[^a-zA-Z]/g, "");
  const caps = content.replace(/[^A-Z]/g, "");

  if (letters.length >= 12 && caps.length / letters.length >= 0.8 && !canBypass(member)) {
    await message.delete().catch(() => {});
    await member.timeout(2 * 60 * 1000, "Caps spam").catch(() => {});
    await sendLog(message.guild, "🔠 Anti Caps Spam", `User: ${message.author}\nAction: **Delete + Timeout 2 menit**`, "Orange");
    return;
  }

  const now = Date.now();
  const id = message.author.id;

  if (!spamMap.has(id)) spamMap.set(id, []);

  const timestamps = spamMap.get(id).filter((t) => now - t < 7000);
  timestamps.push(now);
  spamMap.set(id, timestamps);

  if (timestamps.length >= 15 && !canBypass(member)) {
    await member.timeout(10 * 60 * 1000, "Spam").catch(() => {});
    spamMap.set(id, []);
    await sendLog(message.guild, "⚡ Anti Spam Triggered", `User: ${message.author}\nAction: **Timeout 10 menit**`, "Red");
    return;
  }

  if (!content.toLowerCase().startsWith(PREFIX)) return;

  const args = content.slice(PREFIX.length).trim().split(/ +/).filter(Boolean);
  const cmd = args.shift()?.toLowerCase() || "help";

  return runAction(message, cmd, args);
});

// ================= ANTI RAID JOIN =================
client.on("guildMemberAdd", async (member) => {
  const guildId = member.guild.id;
  const now = Date.now();

  if (!joinMap.has(guildId)) joinMap.set(guildId, []);

  const joins = joinMap.get(guildId).filter((t) => now - t < 10000);
  joins.push(now);
  joinMap.set(guildId, joins);

  if (joins.length >= 15) {
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

  if (actions.length >= 7) {
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

// ================= PREMIUM PANEL UI =================
let SECURITY_ENABLED = true;

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (
    !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
    !process.env.OWNER_IDS?.split(",").includes(interaction.member.id)
  ) {
    return interaction.reply({ content: "❌ Admin only", ephemeral: true });
  }

  if (interaction.customId === "toggle_security") {
    SECURITY_ENABLED = !SECURITY_ENABLED;

    return interaction.update({
      embeds: [
        modernEmbed(
          "🛡️ Security Panel",
          `Status: **${SECURITY_ENABLED ? "ON" : "OFF"}**`
        ),
      ],
    });
  }
});

// COMMAND PANEL
client.on("messageCreate", async (message) => {
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === "panel") {
    if (!isAdmin(message.member)) {
      return message.reply("❌ Admin only");
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("toggle_security")
        .setLabel("Toggle Security")
        .setStyle(ButtonStyle.Primary)
    );

    return message.reply({
      embeds: [
        modernEmbed(
          "🛡️ SQS Premium Panel",
          `Security Status: **${SECURITY_ENABLED ? "ON" : "OFF"}**`
        ),
      ],
      components: [row],
    });
  }
});



// ================= PREMIUM LOGGING EVENTS =================
client.on("messageDelete", async (message) => {
  if (!message.guild || message.author?.bot) return;

  await premiumLog(message.guild, {
    title: "🗑️ Message Deleted",
    description: `Pesan dari ${message.author || "Unknown"} dihapus.`,
    color: "Orange",
    executor: "Unknown / Auto / Moderator",
    target: message.author ? `${message.author.tag} (${message.author.id})` : "Unknown",
    action: "Message Delete",
    channel: `${message.channel} (${message.channel.id})`,
    reason: cutText(message.content || "Pesan kosong / embed / attachment", 1024),
  });
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  await premiumLog(newMessage.guild, {
    title: "✏️ Message Edited",
    description: `Pesan dari ${newMessage.author} diedit.`,
    color: "Yellow",
    executor: `${newMessage.author.tag} (${newMessage.author.id})`,
    target: `${newMessage.author.tag} (${newMessage.author.id})`,
    action: "Message Edit",
    channel: `${newMessage.channel} (${newMessage.channel.id})`,
    reason: `Before: ${cutText(oldMessage.content || "Unknown", 450)}\nAfter: ${cutText(newMessage.content || "Unknown", 450)}`,
  });
});

client.on("guildMemberAdd", async (member) => {
  await premiumLog(member.guild, {
    title: "📥 Member Joined",
    description: `${member.user} bergabung ke server.`,
    color: "Green",
    executor: "System",
    target: `${member.user.tag} (${member.id})`,
    action: "Member Join",
    reason: `Account created: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
  });
});

client.on("guildMemberRemove", async (member) => {
  await premiumLog(member.guild, {
    title: "📤 Member Left",
    description: `${member.user?.tag || member.id} keluar dari server.`,
    color: "Grey",
    executor: "System / Unknown",
    target: `${member.user?.tag || "Unknown"} (${member.id})`,
    action: "Member Leave",
  });
});

client.on("channelCreate", async (channel) => {
  const entry = await fetchLatestAudit(channel.guild, AuditLogEvent.ChannelCreate);
  await premiumLog(channel.guild, {
    title: "📁 Channel Created",
    description: `Channel baru dibuat: ${channel}`,
    color: "Green",
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${channel.name} (${channel.id})`,
    action: "Channel Create",
    channel: `${channel.name} (${channel.id})`,
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("channelDelete", async (channel) => {
  const entry = await fetchLatestAudit(channel.guild, AuditLogEvent.ChannelDelete);
  await premiumLog(channel.guild, {
    title: "🧨 Channel Deleted",
    description: `Channel dihapus: **${channel.name}**`,
    color: "Red",
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${channel.name} (${channel.id})`,
    action: "Channel Delete",
    channel: `${channel.name} (${channel.id})`,
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("channelUpdate", async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  const changes = [];
  if (oldChannel.name !== newChannel.name) changes.push(`Name: ${oldChannel.name} → ${newChannel.name}`);
  if (oldChannel.topic !== newChannel.topic) changes.push("Topic changed");
  if (!changes.length) return;

  const entry = await fetchLatestAudit(newChannel.guild, AuditLogEvent.ChannelUpdate);
  await premiumLog(newChannel.guild, {
    title: "🛠️ Channel Updated",
    description: changes.join("\n"),
    color: "Yellow",
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${newChannel.name} (${newChannel.id})`,
    action: "Channel Update",
    channel: `${newChannel} (${newChannel.id})`,
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("roleCreate", async (role) => {
  const entry = await fetchLatestAudit(role.guild, AuditLogEvent.RoleCreate);
  await premiumLog(role.guild, {
    title: "🎭 Role Created",
    description: `Role baru dibuat: **${role.name}**`,
    color: "Green",
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${role.name} (${role.id})`,
    action: "Role Create",
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("roleDelete", async (role) => {
  const entry = await fetchLatestAudit(role.guild, AuditLogEvent.RoleDelete);
  await premiumLog(role.guild, {
    title: "🧨 Role Deleted",
    description: `Role dihapus: **${role.name}**`,
    color: "Red",
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${role.name} (${role.id})`,
    action: "Role Delete",
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("roleUpdate", async (oldRole, newRole) => {
  const changes = [];
  if (oldRole.name !== newRole.name) changes.push(`Name: ${oldRole.name} → ${newRole.name}`);
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
    changes.push("Permissions changed");
    if (!oldRole.permissions.has(PermissionsBitField.Flags.Administrator) && newRole.permissions.has(PermissionsBitField.Flags.Administrator)) {
      changes.push("⚠️ Administrator permission added");
    }
  }
  if (!changes.length) return;

  const entry = await fetchLatestAudit(newRole.guild, AuditLogEvent.RoleUpdate);
  await premiumLog(newRole.guild, {
    title: "🎭 Role Updated",
    description: changes.join("\n"),
    color: newRole.permissions.has(PermissionsBitField.Flags.Administrator) ? "Red" : "Yellow",
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${newRole.name} (${newRole.id})`,
    action: "Role Update",
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("guildBanAdd", async (ban) => {
  const entry = await fetchLatestAudit(ban.guild, AuditLogEvent.MemberBanAdd);
  await premiumLog(ban.guild, {
    title: "🔨 Member Banned",
    description: `${ban.user.tag} diban dari server.`,
    color: "Red",
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${ban.user.tag} (${ban.user.id})`,
    action: "Member Ban",
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("guildBanRemove", async (ban) => {
  const entry = await fetchLatestAudit(ban.guild, AuditLogEvent.MemberBanRemove);
  await premiumLog(ban.guild, {
    title: "✅ Member Unbanned",
    description: `${ban.user.tag} di-unban dari server.`,
    color: "Green",
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${ban.user.tag} (${ban.user.id})`,
    action: "Member Unban",
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("webhooksUpdate", async (channel) => {
  const entry = await fetchLatestAudit(channel.guild, AuditLogEvent.WebhookCreate);
  await premiumLog(channel.guild, {
    title: "🪝 Webhook Activity",
    description: `Webhook berubah di ${channel}`,
    color: "Orange",
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${channel.name} (${channel.id})`,
    action: "Webhook Update/Create/Delete",
    channel: `${channel} (${channel.id})`,
    reason: entry?.reason || "Tidak ada",
  });
});

client.login(process.env.TOKEN).catch((err) => {
  console.error("LOGIN ERROR:", err.message);
});