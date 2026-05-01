require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  AuditLogEvent,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ChannelType,
} = require("discord.js");
const mongoose = require("mongoose");
const express = require("express");
const session = require("express-session");
const path = require("path");

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

const OWNER_IDS = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(",").map((x) => x.trim()).filter(Boolean) : [];
const GLOBAL_LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const GLOBAL_WHITELIST_ROLE_ID = process.env.WHITELIST_ROLE_ID || null;

const spamMap = new Map();
const joinMap = new Map();
const warnMap = new Map();
const dangerMap = new Map();

const DEFAULT_CONFIG = {
  securityEnabled: process.env.SECURITY_ENABLED !== "false",
  logChannelId: GLOBAL_LOG_CHANNEL_ID,
  whitelistRoleId: GLOBAL_WHITELIST_ROLE_ID,
  spamLimit: 7,
  spamTime: 8000,
  mentionLimit: 5,
  capsPercent: 80,
  punishmentDuration: "10m",
  raidJoinLimit: 5,
  raidJoinTime: 10000,
  badWords: ["yatim"],
  antiInvite: true,
  antiSpam: true,
  antiBadword: true,
  antiCaps: true,
  antiMention: true,
  antiRaid: true,
  antiNuke: true,
};

const configSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true },
    guildName: String,
    securityEnabled: { type: Boolean, default: DEFAULT_CONFIG.securityEnabled },
    logChannelId: { type: String, default: DEFAULT_CONFIG.logChannelId },
    whitelistRoleId: { type: String, default: DEFAULT_CONFIG.whitelistRoleId },
    spamLimit: { type: Number, default: DEFAULT_CONFIG.spamLimit },
    spamTime: { type: Number, default: DEFAULT_CONFIG.spamTime },
    mentionLimit: { type: Number, default: DEFAULT_CONFIG.mentionLimit },
    capsPercent: { type: Number, default: DEFAULT_CONFIG.capsPercent },
    punishmentDuration: { type: String, default: DEFAULT_CONFIG.punishmentDuration },
    raidJoinLimit: { type: Number, default: DEFAULT_CONFIG.raidJoinLimit },
    raidJoinTime: { type: Number, default: DEFAULT_CONFIG.raidJoinTime },
    badWords: { type: [String], default: DEFAULT_CONFIG.badWords },
    antiInvite: { type: Boolean, default: DEFAULT_CONFIG.antiInvite },
    antiSpam: { type: Boolean, default: DEFAULT_CONFIG.antiSpam },
    antiBadword: { type: Boolean, default: DEFAULT_CONFIG.antiBadword },
    antiCaps: { type: Boolean, default: DEFAULT_CONFIG.antiCaps },
    antiMention: { type: Boolean, default: DEFAULT_CONFIG.antiMention },
    antiRaid: { type: Boolean, default: DEFAULT_CONFIG.antiRaid },
    antiNuke: { type: Boolean, default: DEFAULT_CONFIG.antiNuke },
  },
  { timestamps: true }
);

const warnSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    reason: String,
    moderatorId: String,
    moderatorTag: String,
  },
  { timestamps: true }
);

const GuildConfig = mongoose.model("GuildConfig", configSchema);
const UserWarn = mongoose.model("UserWarn", warnSchema);

async function connectMongo() {
  if (!process.env.MONGO_URI) {
    console.warn("MONGO_URI belum diisi. Bot tetap jalan, tapi config database tidak aktif.");
    return false;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected.");
    return true;
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    return false;
  }
}

async function getConfig(guild) {
  if (!guild) return { ...DEFAULT_CONFIG };

  if (mongoose.connection.readyState !== 1) {
    return {
      ...DEFAULT_CONFIG,
      logChannelId: GLOBAL_LOG_CHANNEL_ID,
      whitelistRoleId: GLOBAL_WHITELIST_ROLE_ID,
    };
  }

  let cfg = await GuildConfig.findOne({ guildId: guild.id });
  if (!cfg) {
    cfg = await GuildConfig.create({
      guildId: guild.id,
      guildName: guild.name,
      ...DEFAULT_CONFIG,
      logChannelId: GLOBAL_LOG_CHANNEL_ID,
      whitelistRoleId: GLOBAL_WHITELIST_ROLE_ID,
    });
  }

  if (cfg.guildName !== guild.name) {
    cfg.guildName = guild.name;
    await cfg.save().catch(() => {});
  }

  return cfg;
}

function isOwner(memberOrUser) {
  return OWNER_IDS.includes(memberOrUser?.id);
}

function isAdmin(member) {
  if (!member) return false;
  return (
    isOwner(member) ||
    member.permissions?.has(PermissionsBitField.Flags.Administrator)
  );
}

async function isWhitelisted(member) {
  if (!member?.guild || !member?.roles?.cache) return false;
  if (isAdmin(member)) return true;

  const cfg = await getConfig(member.guild);
  if (!cfg.whitelistRoleId) return false;
  return member.roles.cache.has(cfg.whitelistRoleId);
}

async function canBypass(member) {
  return isAdmin(member) || (await isWhitelisted(member));
}

function cutText(value, max = 1024) {
  const text = String(value ?? "Tidak ada");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function msToText(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function parseDuration(input) {
  if (!input) return null;
  const match = String(input).match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (unit === "s") return num * 1000;
  if (unit === "m") return num * 60 * 1000;
  if (unit === "h") return num * 60 * 60 * 1000;
  if (unit === "d") return num * 24 * 60 * 60 * 1000;
  return null;
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
    .setFooter({ text: "Security System • SQS Public" })
    .setTimestamp();
}

function configText(cfg) {
  return [
    `Security: **${cfg.securityEnabled ? "ON" : "OFF"}**`,
    `Anti Invite: **${cfg.antiInvite ? "ON" : "OFF"}**`,
    `Anti Spam: **${cfg.antiSpam ? "ON" : "OFF"}**`,
    `Anti Badword: **${cfg.antiBadword ? "ON" : "OFF"}**`,
    `Anti Caps: **${cfg.antiCaps ? "ON" : "OFF"}**`,
    `Anti Mention: **${cfg.antiMention ? "ON" : "OFF"}**`,
    `Anti Raid: **${cfg.antiRaid ? "ON" : "OFF"}**`,
    `Anti Nuke: **${cfg.antiNuke ? "ON" : "OFF"}**`,
    "",
    `Spam Limit: **${cfg.spamLimit} pesan / ${msToText(cfg.spamTime)}**`,
    `Mention Limit: **${cfg.mentionLimit} mention**`,
    `Caps Limit: **${cfg.capsPercent}%**`,
    `Timeout Punishment: **${cfg.punishmentDuration}**`,
    `Raid Limit: **${cfg.raidJoinLimit} join / ${msToText(cfg.raidJoinTime)}**`,
    `Log Channel: ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : "**Belum diset**"}`,
    `Whitelist Role: ${cfg.whitelistRoleId ? `<@&${cfg.whitelistRoleId}>` : "**Belum diset**"}`,
  ].join("\n");
}

async function statusDescription(guild) {
  const cfg = await getConfig(guild);
  return [
    `Mode: **Public Protection**`,
    `Database: **${mongoose.connection.readyState === 1 ? "Connected" : "Offline/Fallback"}**`,
    "",
    configText(cfg),
  ].join("\n");
}

async function sendLog(guild, title, desc, color = "Red", data = {}) {
  const cfg = await getConfig(guild);
  const logId = cfg.logChannelId || GLOBAL_LOG_CHANNEL_ID;
  if (!logId) return;

  const ch = guild.channels.cache.get(logId);
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
      { name: "Executor", value: cutText(data.executor || "Unknown / System", 1024), inline: true },
      { name: "Target", value: cutText(data.target || "N/A", 1024), inline: true },
      { name: "Action", value: cutText(data.action || title, 1024), inline: true },
      { name: "Channel", value: cutText(data.channel || "N/A", 1024), inline: true },
      { name: "Reason", value: cutText(data.reason || "Tidak ada", 1024), inline: false },
      { name: "Server", value: `${guild.name} (${guild.id})`, inline: false }
    )
    .setFooter({ text: "SQS Premium Logging • Audit Trail" })
    .setTimestamp();

  await ch.send({ embeds: [embed] }).catch(() => {});
}

async function fetchLatestAudit(guild, type) {
  const logs = await guild.fetchAuditLogs({ type, limit: 1 }).catch(() => null);
  return logs?.entries.first() || null;
}

function panelRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("sqs_panel_status").setLabel("Status").setEmoji("📊").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("sqs_panel_config").setLabel("Config").setEmoji("⚙️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("sqs_panel_toggle").setLabel("Security ON/OFF").setEmoji("🛡️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("sqs_panel_clear10").setLabel("Clear 10").setEmoji("🧹").setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("sqs_panel_lock").setLabel("Lock").setEmoji("🔒").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("sqs_panel_unlock").setLabel("Unlock").setEmoji("🔓").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("sqs_panel_lockdown").setLabel("Panic Lockdown").setEmoji("🚨").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("sqs_panel_unlockall").setLabel("Unlock All").setEmoji("✅").setStyle(ButtonStyle.Success)
  );

  return [row1, row2];
}

async function panelEmbed(guild) {
  const cfg = await getConfig(guild);
  return new EmbedBuilder()
    .setColor(cfg.securityEnabled ? "Green" : "Red")
    .setAuthor({
      name: "SteakQurban Security",
      iconURL: client.user?.displayAvatarURL(),
    })
    .setTitle("🛡️ Public Security Control Panel")
    .setDescription("Dashboard keamanan modern untuk kontrol cepat server.")
    .addFields(
      {
        name: "Protection",
        value: [
          `Security: **${cfg.securityEnabled ? "ON" : "OFF"}**`,
          `Anti Spam: **${cfg.antiSpam ? "ON" : "OFF"}**`,
          `Anti Invite: **${cfg.antiInvite ? "ON" : "OFF"}**`,
          `Anti Nuke: **${cfg.antiNuke ? "ON" : "OFF"}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Config",
        value: [
          `Spam: **${cfg.spamLimit}/${msToText(cfg.spamTime)}**`,
          `Mention: **${cfg.mentionLimit}**`,
          `Caps: **${cfg.capsPercent}%**`,
          `Timeout: **${cfg.punishmentDuration}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Server",
        value: `**${guild.name}**\nMembers: **${guild.memberCount ?? "Unknown"}**`,
        inline: false,
      }
    )
    .setFooter({ text: "SQS Public Panel • Admin Only" })
    .setTimestamp();
}

function helpEmbed() {
  return modernEmbed(
    "🛡️ SQS Public Commands",
    [
      "**Prefix Commands**",
      "`sqs setup` — auto setup config server",
      "`sqs panel` — panel utama",
      "`sqs config show`",
      "`sqs config spam 10`",
      "`sqs config spamtime 8`",
      "`sqs config mention 5`",
      "`sqs config caps 70`",
      "`sqs config timeout 10m`",
      "`sqs config security on/off`",
      "`sqs config log #channel`",
      "`sqs config whitelist @role`",
      "`sqs config reset`",
      "",
      "**Moderation**",
      "`sqs clear 10`, `sqs lock`, `sqs unlock`",
      "`sqs lockdown`, `sqs unlockall`",
      "`sqs warn @user alasan`, `sqs warnings @user`, `sqs clearwarn @user`",
      "`sqs ban @user alasan`, `sqs kick @user alasan`",
      "`sqs timeout @user 10m alasan`, `sqs untimeout @user`",
    ].join("\n"),
    "Blurple"
  );
}

async function ensureAdminReply(ctx) {
  const member = ctx.member;
  if (isAdmin(member)) return true;

  const payload = {
    embeds: [modernEmbed("❌ Access Denied", "Command ini khusus admin / owner.", "Red")],
    flags: MessageFlags.Ephemeral,
  };

  if (ctx.isChatInputCommand?.() || ctx.isButton?.()) {
    await ctx.reply(payload).catch(() => {});
  } else {
    await ctx.reply({ embeds: payload.embeds }).catch(() => {});
  }

  return false;
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
    "DarkRed",
    { executor: executorTag, action: "Lockdown", reason: "Manual / Auto Security" }
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
    "Green",
    { executor: executorTag, action: "Unlock All", reason: "Manual" }
  );

  return count;
}

async function updateConfig(guild, patch) {
  if (mongoose.connection.readyState !== 1) return null;
  return GuildConfig.findOneAndUpdate(
    { guildId: guild.id },
    { $set: { guildName: guild.name, ...patch } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function handleConfig(ctx, args = []) {
  const isInteraction = Boolean(ctx.isChatInputCommand?.());
  const guild = ctx.guild;

  const reply = async (payload) => {
    if (isInteraction) {
      if (ctx.replied || ctx.deferred) return ctx.followUp(payload);
      return ctx.reply(payload);
    }
    return ctx.reply(payload);
  };

  const cfg = await getConfig(guild);

  let action = args[0]?.toLowerCase();

  if (isInteraction) {
    action = ctx.options.getSubcommand(false);
  }

  if (!action || action === "show") {
    return reply({ embeds: [modernEmbed("⚙️ Server Config", configText(cfg), "Blue")] });
  }

  if (action === "reset") {
    if (mongoose.connection.readyState === 1) {
      await GuildConfig.findOneAndDelete({ guildId: guild.id });
    }
    const newCfg = await getConfig(guild);
    return reply({ embeds: [modernEmbed("♻️ Config Reset", configText(newCfg), "Green")] });
  }

  let patch = {};
  let label = "";

  if (action === "spam") {
    const value = isInteraction ? ctx.options.getInteger("limit") : parseInt(args[1], 10);
    if (!value || value < 2 || value > 50) return reply({ content: "Spam limit harus 2-50.", flags: MessageFlags.Ephemeral });
    patch.spamLimit = value;
    label = `Spam limit diubah ke **${value}**`;
  }

  if (action === "spamtime") {
    const value = isInteraction ? ctx.options.getInteger("seconds") : parseInt(args[1], 10);
    if (!value || value < 3 || value > 120) return reply({ content: "Spam time harus 3-120 detik.", flags: MessageFlags.Ephemeral });
    patch.spamTime = value * 1000;
    label = `Spam time diubah ke **${value}s**`;
  }

  if (action === "mention") {
    const value = isInteraction ? ctx.options.getInteger("limit") : parseInt(args[1], 10);
    if (!value || value < 2 || value > 50) return reply({ content: "Mention limit harus 2-50.", flags: MessageFlags.Ephemeral });
    patch.mentionLimit = value;
    label = `Mention limit diubah ke **${value}**`;
  }

  if (action === "caps") {
    const value = isInteraction ? ctx.options.getInteger("percent") : parseInt(args[1], 10);
    if (!value || value < 40 || value > 100) return reply({ content: "Caps percent harus 40-100.", flags: MessageFlags.Ephemeral });
    patch.capsPercent = value;
    label = `Caps limit diubah ke **${value}%**`;
  }

  if (action === "timeout") {
    const value = isInteraction ? ctx.options.getString("duration") : args[1];
    if (!parseDuration(value)) return reply({ content: "Format timeout salah. Contoh: 10m, 1h, 1d.", flags: MessageFlags.Ephemeral });
    patch.punishmentDuration = value;
    label = `Timeout punishment diubah ke **${value}**`;
  }

  if (action === "security") {
    const value = isInteraction ? ctx.options.getString("mode") : args[1]?.toLowerCase();
    if (!["on", "off"].includes(value)) return reply({ content: "Gunakan: on/off.", flags: MessageFlags.Ephemeral });
    patch.securityEnabled = value === "on";
    label = `Security diubah ke **${value.toUpperCase()}**`;
  }

  if (action === "log") {
    const channel = isInteraction ? ctx.options.getChannel("channel") : ctx.mentions.channels.first();
    if (!channel) return reply({ content: "Mention channel log. Contoh: sqs config log #security-log", flags: MessageFlags.Ephemeral });
    patch.logChannelId = channel.id;
    label = `Log channel diset ke ${channel}`;
  }

  if (action === "whitelist") {
    const role = isInteraction ? ctx.options.getRole("role") : ctx.mentions.roles.first();
    if (!role) return reply({ content: "Mention role whitelist. Contoh: sqs config whitelist @Trusted", flags: MessageFlags.Ephemeral });
    patch.whitelistRoleId = role.id;
    label = `Whitelist role diset ke ${role}`;
  }

  if (!Object.keys(patch).length) {
    return reply({ embeds: [modernEmbed("❔ Config Unknown", "Gunakan `sqs config show`.", "Orange")] });
  }

  const saved = await updateConfig(guild, patch);
  if (!saved) {
    return reply({ embeds: [modernEmbed("❌ Database Offline", "MongoDB belum connect. Config tidak bisa disimpan permanen.", "Red")] });
  }

  await sendLog(guild, "⚙️ Config Updated", label, "Blue", {
    executor: `${ctx.user?.tag || ctx.author?.tag} (${ctx.user?.id || ctx.author?.id})`,
    action: "Config Update",
    reason: label,
  });

  return reply({ embeds: [modernEmbed("✅ Config Updated", label, "Green")] });
}

async function runAction(ctx, cmd, args = []) {
  const isInteraction = Boolean(ctx.isChatInputCommand?.());
  const guild = ctx.guild;
  const channel = ctx.channel;
  const user = ctx.user || ctx.author;

  if (!(await ensureAdminReply(ctx))) return;

  const reply = async (payload) => {
    if (isInteraction) {
      if (ctx.replied || ctx.deferred) return ctx.followUp(payload);
      return ctx.reply(payload);
    }
    return ctx.reply(payload);
  };

  if (cmd === "setup") {
    const cfg = await getConfig(guild);
    return reply({
      embeds: [
        modernEmbed(
          "✅ Setup Complete",
          `Config server berhasil dibuat / dimuat.\n\n${configText(cfg)}`,
          "Green"
        ),
      ],
    });
  }

  if (cmd === "help") return reply({ embeds: [helpEmbed()] });

  if (cmd === "panel" || cmd === "configpanel") {
    return reply({ embeds: [await panelEmbed(guild)], components: panelRows() });
  }

  if (cmd === "config") return handleConfig(ctx, args);

  if (cmd === "ping") {
    return reply({ embeds: [modernEmbed("🏓 Pong", `Latency: **${client.ws.ping}ms**`, "Green")] });
  }

  if (cmd === "status") {
    return reply({ embeds: [modernEmbed("🛡️ Security Status", await statusDescription(guild), "Green")] });
  }

  if (cmd === "clear") {
    const amount = isInteraction ? ctx.options.getInteger("amount") : parseInt(args[0], 10);
    if (!amount || amount < 1 || amount > 100) {
      return reply({ content: "Gunakan: `sqs clear 10` atau `/clear amount:10`", flags: MessageFlags.Ephemeral });
    }

    await channel.bulkDelete(amount, true).catch(() => {});
    await sendLog(guild, "🧹 Messages Cleared", `Berhasil hapus **${amount}** pesan.`, "Green", {
      executor: `${user.tag} (${user.id})`,
      action: "Clear Messages",
      channel: `${channel} (${channel.id})`,
      reason: `${amount} messages`,
    });

    return reply({ embeds: [modernEmbed("🧹 Messages Cleared", `Berhasil hapus **${amount}** pesan.`, "Green")], flags: MessageFlags.Ephemeral });
  }

  if (cmd === "lock") {
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    await sendLog(guild, "🔒 Channel Locked", `${channel} dikunci oleh ${user}`, "Orange", {
      executor: `${user.tag} (${user.id})`,
      action: "Lock Channel",
      channel: `${channel} (${channel.id})`,
    });
    return reply({ embeds: [modernEmbed("🔒 Locked", "Channel ini dikunci.", "Orange")] });
  }

  if (cmd === "unlock") {
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
    await sendLog(guild, "🔓 Channel Unlocked", `${channel} dibuka oleh ${user}`, "Green", {
      executor: `${user.tag} (${user.id})`,
      action: "Unlock Channel",
      channel: `${channel} (${channel.id})`,
    });
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
    const target = isInteraction ? ctx.options.getMember("user") : ctx.mentions.members.first();
    const reason = isInteraction ? (ctx.options.getString("reason") || "Tidak ada alasan") : (args.slice(1).join(" ") || "Tidak ada alasan");
    if (!target) return reply({ content: "Gunakan: `sqs warn @user alasan`", flags: MessageFlags.Ephemeral });

    if (mongoose.connection.readyState === 1) {
      await UserWarn.create({
        guildId: guild.id,
        userId: target.id,
        reason,
        moderatorId: user.id,
        moderatorTag: user.tag,
      });
    } else {
      const key = `${guild.id}-${target.id}`;
      if (!warnMap.has(key)) warnMap.set(key, []);
      warnMap.get(key).push({ reason, mod: user.tag, time: new Date().toLocaleString("id-ID") });
    }

    await sendLog(guild, "⚠️ User Warned", `User: ${target}\nMod: ${user}\nReason: ${reason}`, "Orange", {
      executor: `${user.tag} (${user.id})`,
      target: `${target.user.tag} (${target.id})`,
      action: "Warn User",
      reason,
    });

    return reply({ embeds: [modernEmbed("⚠️ Warn Added", `${target} diberi warning.\nReason: **${reason}**`, "Orange")] });
  }

  if (cmd === "warnings") {
    const target = isInteraction ? ctx.options.getMember("user") : ctx.mentions.members.first();
    if (!target) return reply({ content: "Gunakan: `sqs warnings @user`", flags: MessageFlags.Ephemeral });

    let warns = [];
    if (mongoose.connection.readyState === 1) {
      warns = await UserWarn.find({ guildId: guild.id, userId: target.id }).sort({ createdAt: 1 }).limit(15);
    } else {
      warns = warnMap.get(`${guild.id}-${target.id}`) || [];
    }

    if (!warns.length) return reply({ embeds: [modernEmbed("✅ Clean", `${target} tidak punya warning.`, "Green")] });

    const list = warns
      .map((w, i) => `**${i + 1}.** ${w.reason}\nMod: ${w.moderatorTag || w.mod}\nTime: ${w.createdAt ? new Date(w.createdAt).toLocaleString("id-ID") : w.time}`)
      .join("\n\n");

    return reply({ embeds: [modernEmbed(`⚠️ Warnings: ${target.user.tag}`, list, "Orange")] });
  }

  if (cmd === "clearwarn") {
    const target = isInteraction ? ctx.options.getMember("user") : ctx.mentions.members.first();
    if (!target) return reply({ content: "Gunakan: `sqs clearwarn @user`", flags: MessageFlags.Ephemeral });

    if (mongoose.connection.readyState === 1) {
      await UserWarn.deleteMany({ guildId: guild.id, userId: target.id });
    } else {
      warnMap.delete(`${guild.id}-${target.id}`);
    }

    return reply({ embeds: [modernEmbed("✅ Warnings Cleared", `Warning ${target} sudah dihapus.`, "Green")] });
  }

  if (cmd === "ban") {
    const target = isInteraction ? ctx.options.getMember("user") : ctx.mentions.members.first();
    const reason = isInteraction ? (ctx.options.getString("reason") || "Tidak ada alasan") : (args.slice(1).join(" ") || "Tidak ada alasan");
    if (!target) return reply({ content: "Gunakan: `sqs ban @user alasan`", flags: MessageFlags.Ephemeral });

    await target.ban({ reason }).catch(() => null);
    await sendLog(guild, "🔨 User Banned", `User: ${target.user.tag}\nMod: ${user.tag}\nReason: ${reason}`, "Red", {
      executor: `${user.tag} (${user.id})`,
      target: `${target.user.tag} (${target.id})`,
      action: "Ban User",
      reason,
    });

    return reply({ embeds: [modernEmbed("🔨 Banned", `${target.user.tag} diban.\nReason: ${reason}`, "Red")] });
  }

  if (cmd === "kick") {
    const target = isInteraction ? ctx.options.getMember("user") : ctx.mentions.members.first();
    const reason = isInteraction ? (ctx.options.getString("reason") || "Tidak ada alasan") : (args.slice(1).join(" ") || "Tidak ada alasan");
    if (!target) return reply({ content: "Gunakan: `sqs kick @user alasan`", flags: MessageFlags.Ephemeral });

    await target.kick(reason).catch(() => null);
    await sendLog(guild, "👢 User Kicked", `User: ${target.user.tag}\nMod: ${user.tag}\nReason: ${reason}`, "Orange", {
      executor: `${user.tag} (${user.id})`,
      target: `${target.user.tag} (${target.id})`,
      action: "Kick User",
      reason,
    });

    return reply({ embeds: [modernEmbed("👢 Kicked", `${target.user.tag} dikick.\nReason: ${reason}`, "Orange")] });
  }

  if (cmd === "timeout") {
    const target = isInteraction ? ctx.options.getMember("user") : ctx.mentions.members.first();
    const durationInput = isInteraction ? ctx.options.getString("duration") : args[1];
    const reason = isInteraction ? (ctx.options.getString("reason") || "Tidak ada alasan") : (args.slice(2).join(" ") || "Tidak ada alasan");
    const duration = parseDuration(durationInput);

    if (!target || !duration) return reply({ content: "Gunakan: `sqs timeout @user 10m alasan`", flags: MessageFlags.Ephemeral });

    await target.timeout(duration, reason).catch(() => null);
    await sendLog(guild, "⏳ User Timeout", `User: ${target}\nDurasi: ${durationInput}\nReason: ${reason}`, "Orange", {
      executor: `${user.tag} (${user.id})`,
      target: `${target.user.tag} (${target.id})`,
      action: "Timeout User",
      reason,
    });

    return reply({ embeds: [modernEmbed("⏳ Timeout", `${target} timeout **${durationInput}**.\nReason: ${reason}`, "Orange")] });
  }

  if (cmd === "untimeout") {
    const target = isInteraction ? ctx.options.getMember("user") : ctx.mentions.members.first();
    if (!target) return reply({ content: "Gunakan: `sqs untimeout @user`", flags: MessageFlags.Ephemeral });

    await target.timeout(null).catch(() => null);
    await sendLog(guild, "✅ Timeout Removed", `User: ${target}\nMod: ${user}`, "Green", {
      executor: `${user.tag} (${user.id})`,
      target: `${target.user.tag} (${target.id})`,
      action: "Untimeout User",
    });

    return reply({ embeds: [modernEmbed("✅ Untimeout", `${target} sudah bebas timeout.`, "Green")] });
  }

  return reply({ embeds: [modernEmbed("❔ Unknown Command", "Gunakan `sqs help` atau `/panel`.", "Orange")] });
}

client.once("clientReady", async () => {
  console.log(`Security Bot aktif: ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: "Anti Nuke Protection 🛡️", type: 3 }],
    status: "dnd",
  });

  for (const guild of client.guilds.cache.values()) {
    await getConfig(guild).catch(() => {});
  }
});

// ================= SLASH + BUTTON HANDLER =================
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "config") return runAction(interaction, "config");
      return runAction(interaction, interaction.commandName);
    }

    if (!interaction.isButton()) return;
    if (!(await ensureAdminReply(interaction))) return;

    const id = interaction.customId;

    if (id === "sqs_panel_status") {
      return interaction.reply({
        embeds: [modernEmbed("📊 Security Status", await statusDescription(interaction.guild), "Green")],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (id === "sqs_panel_config") {
      const cfg = await getConfig(interaction.guild);
      return interaction.reply({
        embeds: [modernEmbed("⚙️ Server Config", configText(cfg), "Blue")],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (id === "sqs_panel_toggle") {
      const cfg = await getConfig(interaction.guild);
      const saved = await updateConfig(interaction.guild, { securityEnabled: !cfg.securityEnabled });
      return interaction.update({
        embeds: [await panelEmbed(interaction.guild)],
        components: panelRows(),
      });
    }

    if (id === "sqs_panel_lock") {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
      await sendLog(interaction.guild, "🔒 Channel Locked", `${interaction.channel} dikunci oleh ${interaction.user}`, "Orange");
      return interaction.reply({ embeds: [modernEmbed("🔒 Locked", "Channel ini dikunci.", "Orange")], flags: MessageFlags.Ephemeral });
    }

    if (id === "sqs_panel_unlock") {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
      await sendLog(interaction.guild, "🔓 Channel Unlocked", `${interaction.channel} dibuka oleh ${interaction.user}`, "Green");
      return interaction.reply({ embeds: [modernEmbed("🔓 Unlocked", "Channel ini dibuka.", "Green")], flags: MessageFlags.Ephemeral });
    }

    if (id === "sqs_panel_lockdown") {
      const count = await lockdownGuild(interaction.guild, interaction.user.tag);
      return interaction.reply({ embeds: [modernEmbed("🚨 Lockdown", `Semua channel berhasil dikunci.\nTotal: **${count}**`, "DarkRed")] });
    }

    if (id === "sqs_panel_unlockall") {
      const count = await unlockGuild(interaction.guild, interaction.user.tag);
      return interaction.reply({ embeds: [modernEmbed("✅ Unlock All", `Semua channel berhasil dibuka.\nTotal: **${count}**`, "Green")] });
    }

    if (id === "sqs_panel_clear10") {
      await interaction.channel.bulkDelete(10, true).catch(() => {});
      return interaction.reply({
        embeds: [modernEmbed("🧹 Clear 10", "10 pesan terakhir berhasil dihapus.", "Green")],
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    console.error("INTERACTION ERROR:", err);
    const payload = {
      embeds: [modernEmbed("❌ Interaction Error", "Terjadi error saat menjalankan command/button.", "Red")],
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => {});
    return interaction.reply(payload).catch(() => {});
  }
});

// ================= MESSAGE SECURITY + PREFIX COMMANDS =================
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const cfg = await getConfig(message.guild);
  const member = message.member;
  const content = message.content;

  if (cfg.securityEnabled) {
    const bypass = await canBypass(member);
    const punishmentMs = parseDuration(cfg.punishmentDuration) || 10 * 60 * 1000;

    const inviteRegex = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)/i;
    if (cfg.antiInvite && inviteRegex.test(content) && !bypass) {
      await message.delete().catch(() => {});
      await member.timeout(punishmentMs, "Anti invite").catch(() => {});
      await sendLog(message.guild, "🔗 Anti Invite Triggered", `User: ${message.author}\nAction: **Delete + Timeout ${cfg.punishmentDuration}**`, "Red", {
        executor: `${message.author.tag} (${message.author.id})`,
        target: `${message.author.tag} (${message.author.id})`,
        action: "Anti Invite",
        channel: `${message.channel} (${message.channel.id})`,
        reason: content,
      });
      return;
    }

    const lower = content.toLowerCase();
    if (cfg.antiBadword && cfg.badWords.some((word) => lower.includes(String(word).toLowerCase())) && !bypass) {
      await message.delete().catch(() => {});
      await member.timeout(punishmentMs, "Badword").catch(() => {});
      await sendLog(message.guild, "🤬 Anti Badword Triggered", `User: ${message.author}\nAction: **Delete + Timeout ${cfg.punishmentDuration}**`, "Orange", {
        executor: `${message.author.tag} (${message.author.id})`,
        target: `${message.author.tag} (${message.author.id})`,
        action: "Anti Badword",
        channel: `${message.channel} (${message.channel.id})`,
        reason: content,
      });
      return;
    }

    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    if (cfg.antiMention && mentionCount >= cfg.mentionLimit && !bypass) {
      await message.delete().catch(() => {});
      await member.timeout(punishmentMs, "Mention spam").catch(() => {});
      await sendLog(message.guild, "📢 Anti Mention Spam", `User: ${message.author}\nMention: **${mentionCount}**\nAction: **Timeout ${cfg.punishmentDuration}**`, "Red", {
        executor: `${message.author.tag} (${message.author.id})`,
        target: `${message.author.tag} (${message.author.id})`,
        action: "Anti Mention Spam",
        channel: `${message.channel} (${message.channel.id})`,
        reason: `${mentionCount} mentions`,
      });
      return;
    }

    const letters = content.replace(/[^a-zA-Z]/g, "");
    const caps = content.replace(/[^A-Z]/g, "");
    if (cfg.antiCaps && letters.length >= 12 && caps.length / letters.length >= cfg.capsPercent / 100 && !bypass) {
      await message.delete().catch(() => {});
      await member.timeout(punishmentMs, "Caps spam").catch(() => {});
      await sendLog(message.guild, "🔠 Anti Caps Spam", `User: ${message.author}\nAction: **Delete + Timeout ${cfg.punishmentDuration}**`, "Orange", {
        executor: `${message.author.tag} (${message.author.id})`,
        target: `${message.author.tag} (${message.author.id})`,
        action: "Anti Caps Spam",
        channel: `${message.channel} (${message.channel.id})`,
        reason: content,
      });
      return;
    }

    if (cfg.antiSpam && !bypass) {
      const now = Date.now();
      const id = `${message.guild.id}-${message.author.id}`;

      if (!spamMap.has(id)) spamMap.set(id, []);

      const timestamps = spamMap.get(id).filter((t) => now - t < cfg.spamTime);
      timestamps.push(now);
      spamMap.set(id, timestamps);

      if (timestamps.length >= cfg.spamLimit) {
        await member.timeout(punishmentMs, "Spam").catch(() => {});
        spamMap.set(id, []);
        await sendLog(message.guild, "⚡ Anti Spam Triggered", `User: ${message.author}\nMessages: **${timestamps.length}/${msToText(cfg.spamTime)}**\nAction: **Timeout ${cfg.punishmentDuration}**`, "Red", {
          executor: `${message.author.tag} (${message.author.id})`,
          target: `${message.author.tag} (${message.author.id})`,
          action: "Anti Spam",
          channel: `${message.channel} (${message.channel.id})`,
          reason: `${timestamps.length} messages in ${msToText(cfg.spamTime)}`,
        });
        return;
      }
    }
  }

  if (!content.toLowerCase().startsWith(PREFIX)) return;

  const args = content.slice(PREFIX.length).trim().split(/ +/).filter(Boolean);
  const cmd = args.shift()?.toLowerCase() || "help";
  return runAction(message, cmd, args);
});

// ================= ANTI RAID JOIN =================
client.on("guildMemberAdd", async (member) => {
  const cfg = await getConfig(member.guild);

  await sendLog(member.guild, "📥 Member Joined", `${member.user} bergabung ke server.`, "Green", {
    executor: "System",
    target: `${member.user.tag} (${member.id})`,
    action: "Member Join",
    reason: `Account created: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
  });

  if (!cfg.securityEnabled || !cfg.antiRaid) return;

  const guildId = member.guild.id;
  const now = Date.now();

  if (!joinMap.has(guildId)) joinMap.set(guildId, []);

  const joins = joinMap.get(guildId).filter((t) => now - t < cfg.raidJoinTime);
  joins.push(now);
  joinMap.set(guildId, joins);

  if (joins.length >= cfg.raidJoinLimit) {
    const punishmentMs = parseDuration(cfg.punishmentDuration) || 30 * 60 * 1000;
    await member.timeout(punishmentMs, "Anti raid").catch(() => {});
    await sendLog(member.guild, "🚨 Anti Raid Triggered", `Join cepat terdeteksi.\nMember baru ${member.user.tag} diberi timeout **${cfg.punishmentDuration}**.`, "DarkRed", {
      executor: "System",
      target: `${member.user.tag} (${member.id})`,
      action: "Anti Raid",
      reason: `${joins.length} joins in ${msToText(cfg.raidJoinTime)}`,
    });
  }
});

client.on("guildMemberRemove", async (member) => {
  await sendLog(member.guild, "📤 Member Left", `${member.user?.tag || member.id} keluar dari server.`, "Grey", {
    executor: "System / Unknown",
    target: `${member.user?.tag || "Unknown"} (${member.id})`,
    action: "Member Leave",
  });
});

// ================= ANTI NUKE + PREMIUM LOG EVENTS =================
async function handleDangerDelete(guild, type) {
  await new Promise((r) => setTimeout(r, 1000));

  const cfg = await getConfig(guild);
  const auditType = type === "channel" ? AuditLogEvent.ChannelDelete : AuditLogEvent.RoleDelete;
  const logs = await guild.fetchAuditLogs({ type: auditType, limit: 1 }).catch(() => null);
  const entry = logs?.entries.first();

  if (!entry || !entry.executor) return;

  const executorId = entry.executor.id;
  if (executorId === client.user.id || executorId === guild.ownerId) return;

  await sendLog(
    guild,
    `🧨 ${type === "channel" ? "Channel" : "Role"} Deleted`,
    `Executor: ${entry.executor}\nAction: **${type} delete**`,
    "Red",
    {
      executor: `${entry.executor.tag} (${entry.executor.id})`,
      target: "Deleted object",
      action: `${type} delete`,
      reason: entry.reason || "Tidak ada",
    }
  );

  if (!cfg.securityEnabled || !cfg.antiNuke) return;

  const key = `${guild.id}-${executorId}-${type}`;
  const now = Date.now();

  if (!dangerMap.has(key)) dangerMap.set(key, []);

  const actions = dangerMap.get(key).filter((t) => now - t < 60000);
  actions.push(now);
  dangerMap.set(key, actions);

  if (actions.length >= 3) {
    await lockdownGuild(guild, "Anti Mass Delete");

    const member = await guild.members.fetch(executorId).catch(() => null);
    if (member && !(await canBypass(member))) {
      await member.ban({ reason: `Anti mass ${type} delete` }).catch(() => {});
    }

    await sendLog(
      guild,
      "🚨 Mass Delete Protection",
      `Executor: <@${executorId}>\nType: **${type} delete**\nAction: **Auto Lockdown + Ban attempt**`,
      "DarkRed",
      {
        executor: `${entry.executor.tag} (${entry.executor.id})`,
        action: "Auto Lockdown + Ban attempt",
        reason: `Mass ${type} delete detected`,
      }
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

client.on("channelCreate", async (channel) => {
  const entry = await fetchLatestAudit(channel.guild, AuditLogEvent.ChannelCreate);
  await sendLog(channel.guild, "📁 Channel Created", `Channel baru dibuat: ${channel}`, "Green", {
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${channel.name} (${channel.id})`,
    action: "Channel Create",
    channel: `${channel.name} (${channel.id})`,
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("roleCreate", async (role) => {
  const entry = await fetchLatestAudit(role.guild, AuditLogEvent.RoleCreate);
  await sendLog(role.guild, "🎭 Role Created", `Role baru dibuat: **${role.name}**`, "Green", {
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${role.name} (${role.id})`,
    action: "Role Create",
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
  await sendLog(newRole.guild, "🎭 Role Updated", changes.join("\n"), newRole.permissions.has(PermissionsBitField.Flags.Administrator) ? "Red" : "Yellow", {
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${newRole.name} (${newRole.id})`,
    action: "Role Update",
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("guildBanAdd", async (ban) => {
  const entry = await fetchLatestAudit(ban.guild, AuditLogEvent.MemberBanAdd);
  await sendLog(ban.guild, "🔨 Member Banned", `${ban.user.tag} diban dari server.`, "Red", {
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${ban.user.tag} (${ban.user.id})`,
    action: "Member Ban",
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("guildBanRemove", async (ban) => {
  const entry = await fetchLatestAudit(ban.guild, AuditLogEvent.MemberBanRemove);
  await sendLog(ban.guild, "✅ Member Unbanned", `${ban.user.tag} di-unban dari server.`, "Green", {
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${ban.user.tag} (${ban.user.id})`,
    action: "Member Unban",
    reason: entry?.reason || "Tidak ada",
  });
});

client.on("webhooksUpdate", async (channel) => {
  const entry = await fetchLatestAudit(channel.guild, AuditLogEvent.WebhookCreate);
  await sendLog(channel.guild, "🪝 Webhook Activity", `Webhook berubah di ${channel}`, "Orange", {
    executor: entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : "Unknown",
    target: `${channel.name} (${channel.id})`,
    action: "Webhook Update/Create/Delete",
    channel: `${channel} (${channel.id})`,
    reason: entry?.reason || "Tidak ada",
  });
});


// ================= WEB DASHBOARD + ADMIN LOGIN =================
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: process.env.DASHBOARD_SECRET || "change-this-dashboard-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 },
}));

function dashboardAuth(req, res, next) {
  if (req.session?.loggedIn) return next();
  return res.redirect("/login");
}

function dashBool(value) {
  return value === "on" || value === "true" || value === true;
}

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", (req, res) => {
  const username = process.env.DASHBOARD_USERNAME || "admin";
  const password = process.env.DASHBOARD_PASSWORD || "admin123";

  if (req.body.username === username && req.body.password === password) {
    req.session.loggedIn = true;
    return res.redirect("/");
  }

  return res.render("login", { error: "Username atau password salah." });
});

app.post("/logout", dashboardAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", dashboardAuth, async (req, res) => {
  const guilds = client.guilds.cache.map((g) => ({
    id: g.id,
    name: g.name,
    memberCount: g.memberCount,
  }));

  res.render("dashboard", {
    guilds,
    bot: client.user,
    dbStatus: mongoose.connection.readyState === 1 ? "Connected" : "Offline",
  });
});

app.get("/guild/:guildId", dashboardAuth, async (req, res) => {
  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return res.status(404).send("Guild tidak ditemukan.");

  const cfg = await getConfig(guild);

  const channels = guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildText)
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id)
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.render("guild", {
    guild,
    cfg,
    channels,
    roles,
    saved: req.query.saved === "1",
    error: req.query.error || null,
  });
});

app.post("/guild/:guildId/config", dashboardAuth, async (req, res) => {
  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return res.status(404).send("Guild tidak ditemukan.");

  const badWords = String(req.body.badWords || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const punishmentDuration = String(req.body.punishmentDuration || "10m");

  if (!parseDuration(punishmentDuration)) {
    return res.redirect(`/guild/${guild.id}?error=Format timeout salah. Contoh 10m, 1h, 1d`);
  }

  await updateConfig(guild, {
    securityEnabled: dashBool(req.body.securityEnabled),
    antiInvite: dashBool(req.body.antiInvite),
    antiSpam: dashBool(req.body.antiSpam),
    antiBadword: dashBool(req.body.antiBadword),
    antiCaps: dashBool(req.body.antiCaps),
    antiMention: dashBool(req.body.antiMention),
    antiRaid: dashBool(req.body.antiRaid),
    antiNuke: dashBool(req.body.antiNuke),
    spamLimit: Math.min(Math.max(Number(req.body.spamLimit || 7), 2), 50),
    spamTime: Math.min(Math.max(Number(req.body.spamTime || 8), 3), 120) * 1000,
    mentionLimit: Math.min(Math.max(Number(req.body.mentionLimit || 5), 2), 50),
    capsPercent: Math.min(Math.max(Number(req.body.capsPercent || 80), 40), 100),
    punishmentDuration,
    raidJoinLimit: Math.min(Math.max(Number(req.body.raidJoinLimit || 5), 2), 50),
    raidJoinTime: Math.min(Math.max(Number(req.body.raidJoinTime || 10), 3), 300) * 1000,
    logChannelId: req.body.logChannelId || null,
    whitelistRoleId: req.body.whitelistRoleId || null,
    badWords,
  });

  await sendLog(guild, "🌐 Dashboard Config Updated", "Config server diubah melalui dashboard web.", "Blue", {
    executor: "Dashboard Admin",
    action: "Dashboard Config Update",
    reason: "Live edit from web dashboard",
  }).catch(() => {});

  return res.redirect(`/guild/${guild.id}?saved=1`);
});

app.post("/guild/:guildId/reset", dashboardAuth, async (req, res) => {
  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return res.status(404).send("Guild tidak ditemukan.");

  if (mongoose.connection.readyState === 1) {
    await GuildConfig.findOneAndDelete({ guildId: guild.id });
  }

  await getConfig(guild);
  return res.redirect(`/guild/${guild.id}?saved=1`);
});

function startDashboard() {
  const port = process.env.PORT || process.env.DASHBOARD_PORT || 3000;
  app.listen(port, () => console.log(`Dashboard aktif di port ${port}`));
}

process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));

(async () => {
  await connectMongo();
  await client.login(process.env.TOKEN);
  startDashboard();
})();
