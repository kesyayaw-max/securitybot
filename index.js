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

const BAD_WORDS = ["yatim"];

const OWNER_IDS = process.env.OWNER_IDS?.split(",").map((id) => id.trim()).filter(Boolean) || [];
let SECURITY_ENABLED = process.env.SECURITY_ENABLED !== "false";

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
    `🛡️ Security Engine: **${SECURITY_ENABLED ? "ONLINE" : "OFFLINE"}**`,
    "",
    "✅ Anti Spam: **ON**",
    "✅ Anti Invite: **ON**",
    "✅ Anti Badword: **ON**",
    "✅ Anti Caps Spam: **ON**",
    "✅ Anti Mention Spam: **ON**",
    "✅ Anti Raid: **ON**",
    "✅ Mass Delete Protection: **ON**",
    "✅ Premium Panel UI: **ON**",
    "",
    "Mode: **STEAK QURBAN!**",
  ].join("\n");
}

function panelEmbed(guild) {
  return new EmbedBuilder()
    .setColor(SECURITY_ENABLED ? "Blurple" : "DarkButNotBlack")
    .setAuthor({
      name: "SteakQurban Security",
      iconURL: client.user?.displayAvatarURL(),
    })
    .setTitle("🛡️ SQS Premium Security Panel")
    .setDescription(
      [
        "```ansi",
        `\u001b[1;36mSYSTEM\u001b[0m   : SQS Premium`,
        `\u001b[1;35mMODE\u001b[0m     : Wick / Dyno Style`,
        `\u001b[1;32mSTATUS\u001b[0m   : ${SECURITY_ENABLED ? "ONLINE" : "OFFLINE"}`,
        "```",
        "Gunakan tombol di bawah untuk mengontrol keamanan server secara cepat.",
      ].join("\n")
    )
    .addFields(
      {
        name: "🛡️ Protection",
        value:
          "✅ Anti Spam\n✅ Anti Invite\n✅ Anti Badword\n✅ Anti Mention\n✅ Anti Caps\n✅ Anti Raid",
        inline: true,
      },
      {
        name: "⚔️ Moderation",
        value:
          "✅ Lock / Unlock\n✅ Lockdown\n✅ Clear Messages\n✅ Timeout\n✅ Ban / Kick\n✅ Warn System",
        inline: true,
      },
      {
        name: "📊 Server",
        value: `**${guild.name}**\nMembers: **${guild.memberCount ?? "Unknown"}**\nPing: **${client.ws.ping}ms**`,
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
      .setCustomId("sqs_panel_toggle")
      .setLabel(SECURITY_ENABLED ? "Security ON" : "Security OFF")
      .setEmoji("🛡️")
      .setStyle(SECURITY_ENABLED ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("sqs_panel_refresh")
      .setLabel("Refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Primary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("sqs_panel_help")
      .setLabel("Help")
      .setEmoji("📘")
      .setStyle(ButtonStyle.Primary)
  );

  return [row1, row2, row3];
}

function premiumLogEmbed(guild, title, desc, color = "Red") {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: "SQS Premium Security Log",
      iconURL: client.user?.displayAvatarURL(),
    })
    .setTitle(title)
    .setDescription(desc || "Tidak ada detail.")
    .addFields(
      { name: "🏠 Server", value: guild?.name || "Unknown", inline: true },
      { name: "🆔 Guild ID", value: guild?.id || "Unknown", inline: true },
      { name: "⚙️ Security", value: SECURITY_ENABLED ? "ONLINE" : "OFFLINE", inline: true }
    )
    .setFooter({ text: "SQS Premium Logging • Audit Trail" })
    .setTimestamp();
}

async function sendLog(guild, title, desc, color = "Red") {
  const ch = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
  if (!ch) return;
  await ch.send({ embeds: [premiumLogEmbed(guild, title, desc, color)] }).catch(() => {});
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
      "`sqs panel`, `sqs help`, `sqs ping`, `sqs status`, `sqs toggle`",
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

  if (cmd === "toggle") {
    SECURITY_ENABLED = !SECURITY_ENABLED;
    await sendLog(
      guild,
      "🛡️ Security Toggle",
      `Executor: ${user}\nNew Status: **${SECURITY_ENABLED ? "ONLINE" : "OFFLINE"}**`,
      SECURITY_ENABLED ? "Green" : "Orange"
    );
    return reply({
      embeds: [modernEmbed("🛡️ Security Toggle", `Security sekarang: **${SECURITY_ENABLED ? "ONLINE" : "OFFLINE"}**`, SECURITY_ENABLED ? "Green" : "Orange")],
    });
  }

  return reply({ embeds: [modernEmbed("❔ Unknown Command", "Gunakan `sqs help` atau `/panel`.", "Orange")] });
}

client.once("clientReady", () => {
  console.log(`Security Bot aktif: ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "SQS Security System 🛡️",
        type: 3, // Watching
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

    if (id === "sqs_panel_toggle") {
      SECURITY_ENABLED = !SECURITY_ENABLED;
      await sendLog(
        interaction.guild,
        "🛡️ Security Toggle",
        `Executor: ${interaction.user}\nNew Status: **${SECURITY_ENABLED ? "ONLINE" : "OFFLINE"}**`,
        SECURITY_ENABLED ? "Green" : "Orange"
      );
      return interaction.update({
        embeds: [panelEmbed(interaction.guild)],
        components: panelRows(),
      });
    }

    if (id === "sqs_panel_refresh") {
      return interaction.update({
        embeds: [panelEmbed(interaction.guild)],
        components: panelRows(),
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

  if (!SECURITY_ENABLED && !content.toLowerCase().startsWith(PREFIX)) return;

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
  if (mentionCount >= 5 && !canBypass(member)) {
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

  if (timestamps.length >= 5 && !canBypass(member)) {
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

client.login(process.env.TOKEN).catch((err) => {
  console.error("LOGIN ERROR:", err.message);
});
