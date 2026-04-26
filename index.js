
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

function isAdmin(member) {
  return member?.permissions?.has(PermissionsBitField.Flags.Administrator);
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
    .setDescription(desc)
    .setFooter({ text: "Security System • SQS Premium" })
    .setTimestamp();
}

function panelEmbed(guild) {
  return new EmbedBuilder()
    .setColor("Blurple")
    .setAuthor({
      name: "SteakQurban Security",
      iconURL: client.user?.displayAvatarURL(),
    })
    .setTitle("🛡️ Premium Security Control Panel")
    .setDescription(
      [
        "Kontrol keamanan server langsung dari tombol modern di bawah.",
        "",
        "```ansi",
        "\u001b[1;36mSTATUS\u001b[0m  : Online",
        "\u001b[1;32mMODE\u001b[0m    : Protection Active",
        "\u001b[1;35mSYSTEM\u001b[0m  : SQS Premium",
        "```",
      ].join("\n")
    )
    .addFields(
      {
        name: "Protection",
        value:
          "✅ Anti Spam\n✅ Anti Invite\n✅ Anti Badword\n✅ Anti Mention Spam\n✅ Anti Caps\n✅ Anti Raid",
        inline: true,
      },
      {
        name: "Moderation",
        value:
          "✅ Lock / Unlock\n✅ Lockdown\n✅ Clear Messages\n✅ Timeout\n✅ Ban / Kick\n✅ Warn System",
        inline: true,
      },
      {
        name: "Server",
        value: `**${guild.name}**\nMembers: **${guild.memberCount}**`,
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
      .setLabel("Lock Channel")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("sqs_panel_unlock")
      .setLabel("Unlock Channel")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("sqs_panel_clear")
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
      .setCustomId("sqs_panel_refresh")
      .setLabel("Refresh Panel")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Primary)
  );

  return [row1, row2];
}

async function sendLog(guild, title, desc, color = "Red") {
  const ch = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
  if (!ch) return;
  ch.send({ embeds: [modernEmbed(title, desc, color)] }).catch(() => {});
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
    "✅ Lockdown Released",
    `Executor: **${executorTag}**\nUnlocked channels: **${count}**`,
    "Green"
  );

  return count;
}

async function replyAdminOnly(interaction) {
  if (isAdmin(interaction.member)) return true;

  await interaction.reply({
    embeds: [modernEmbed("❌ Access Denied", "Command ini khusus admin.", "Red")],
    ephemeral: true,
  }).catch(() => {});

  return false;
}

client.once("clientReady", () => {
  console.log(`Security Bot aktif: ${client.user.tag}`);
});

// ================= AUTO MOD MESSAGE SECURITY =================
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const member = message.member;
  const content = message.content;

  const inviteRegex = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)/i;
  if (inviteRegex.test(content) && !canBypass(member)) {
    await message.delete().catch(() => {});
    await member.timeout(5 * 60 * 1000, "Anti invite").catch(() => {});
    await sendLog(message.guild, "🔗 Anti Invite", `User: ${message.author}\nAction: **Delete + Timeout 5 menit**`, "Red");
    return;
  }

  const lower = content.toLowerCase();
  if (BAD_WORDS.some((word) => lower.includes(word)) && !canBypass(member)) {
    await message.delete().catch(() => {});
    await member.timeout(3 * 60 * 1000, "Badword").catch(() => {});
    await sendLog(message.guild, "🤬 Anti Badword", `User: ${message.author}\nAction: **Delete + Timeout 3 menit**`, "Orange");
    return;
  }

  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  if (mentionCount >= 5 && !canBypass(member)) {
    await message.delete().catch(() => {});
    await member.timeout(10 * 60 * 1000, "Mention spam").catch(() => {});
    await sendLog(message.guild, "📢 Anti Mention Spam", `User: ${message.author}\nMentions: **${mentionCount}**\nAction: **Timeout 10 menit**`, "Red");
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
    await sendLog(message.guild, "⚡ Anti Spam", `User: ${message.author}\nAction: **Timeout 10 menit**`, "Red");
  }
});

// ================= SLASH COMMANDS + BUTTON UI =================
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (!(await replyAdminOnly(interaction))) return;
      const id = interaction.customId;

      if (id === "sqs_panel_status") {
        return interaction.reply({
          embeds: [
            modernEmbed(
              "📊 Security Status",
              [
                "Anti Spam: **ON**",
                "Anti Invite: **ON**",
                "Anti Badword: **ON**",
                "Anti Caps: **ON**",
                "Anti Mention Spam: **ON**",
                "Anti Raid: **ON**",
                "Mass Delete Protection: **ON**",
                `Ping: **${client.ws.ping}ms**`,
              ].join("\n"),
              "Green"
            ),
          ],
          ephemeral: true,
        });
      }

      if (id === "sqs_panel_lock") {
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
        await sendLog(interaction.guild, "🔒 Channel Locked", `${interaction.channel} dikunci oleh ${interaction.user}`, "Orange");
        return interaction.reply({ embeds: [modernEmbed("🔒 Channel Locked", "Channel ini berhasil dikunci.", "Orange")], ephemeral: true });
      }

      if (id === "sqs_panel_unlock") {
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
        await sendLog(interaction.guild, "🔓 Channel Unlocked", `${interaction.channel} dibuka oleh ${interaction.user}`, "Green");
        return interaction.reply({ embeds: [modernEmbed("🔓 Channel Unlocked", "Channel ini berhasil dibuka.", "Green")], ephemeral: true });
      }

      if (id === "sqs_panel_clear") {
        await interaction.channel.bulkDelete(10, true).catch(() => {});
        return interaction.reply({ embeds: [modernEmbed("🧹 Clear Complete", "10 pesan terakhir sudah dibersihkan.", "Green")], ephemeral: true });
      }

      if (id === "sqs_panel_lockdown") {
        await interaction.deferReply({ ephemeral: true });
        const count = await lockdownGuild(interaction.guild, interaction.user.tag);
        return interaction.editReply({ embeds: [modernEmbed("🚨 Panic Lockdown", `Server berhasil dikunci.\nChannels affected: **${count}**`, "DarkRed")] });
      }

      if (id === "sqs_panel_unlockall") {
        await interaction.deferReply({ ephemeral: true });
        const count = await unlockGuild(interaction.guild, interaction.user.tag);
        return interaction.editReply({ embeds: [modernEmbed("✅ Unlock All", `Server berhasil dibuka.\nChannels affected: **${count}**`, "Green")] });
      }

      if (id === "sqs_panel_refresh") {
        return interaction.update({ embeds: [panelEmbed(interaction.guild)], components: panelRows() });
      }
    }

    if (!interaction.isChatInputCommand()) return;
    if (!(await replyAdminOnly(interaction))) return;

    const { commandName } = interaction;

    if (commandName === "panel") {
      return interaction.reply({
        embeds: [panelEmbed(interaction.guild)],
        components: panelRows(),
      });
    }

    if (commandName === "ping") {
      return interaction.reply({ embeds: [modernEmbed("🏓 Pong", `Latency: **${client.ws.ping}ms**`, "Green")], ephemeral: true });
    }

    if (commandName === "status") {
      return interaction.reply({
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
        ephemeral: true,
      });
    }

    if (commandName === "clear") {
      const amount = interaction.options.getInteger("amount");
      await interaction.channel.bulkDelete(amount, true).catch(() => {});
      return interaction.reply({ embeds: [modernEmbed("🧹 Messages Cleared", `Berhasil hapus **${amount}** pesan.`, "Green")], ephemeral: true });
    }

    if (commandName === "lock") {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
      await sendLog(interaction.guild, "🔒 Channel Locked", `${interaction.channel} dikunci oleh ${interaction.user}`, "Orange");
      return interaction.reply({ embeds: [modernEmbed("🔒 Locked", "Channel ini dikunci.", "Orange")] });
    }

    if (commandName === "unlock") {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
      await sendLog(interaction.guild, "🔓 Channel Unlocked", `${interaction.channel} dibuka oleh ${interaction.user}`, "Green");
      return interaction.reply({ embeds: [modernEmbed("🔓 Unlocked", "Channel ini dibuka.", "Green")] });
    }

    if (commandName === "lockdown") {
      await interaction.deferReply();
      const count = await lockdownGuild(interaction.guild, interaction.user.tag);
      return interaction.editReply({ embeds: [modernEmbed("🚨 Lockdown", `Semua channel berhasil dikunci.\nChannels affected: **${count}**`, "DarkRed")] });
    }

    if (commandName === "unlockall") {
      await interaction.deferReply();
      const count = await unlockGuild(interaction.guild, interaction.user.tag);
      return interaction.editReply({ embeds: [modernEmbed("✅ Unlock All", `Semua channel berhasil dibuka.\nChannels affected: **${count}**`, "Green")] });
    }

    if (commandName === "warn") {
      const target = interaction.options.getMember("user");
      const reason = interaction.options.getString("reason") || "Tidak ada alasan";

      const key = `${interaction.guild.id}-${target.id}`;
      if (!warnMap.has(key)) warnMap.set(key, []);
      warnMap.get(key).push({ reason, mod: interaction.user.tag, time: new Date().toLocaleString("id-ID") });

      await sendLog(interaction.guild, "⚠️ User Warned", `User: ${target}\nMod: ${interaction.user}\nReason: ${reason}`, "Orange");
      return interaction.reply({ embeds: [modernEmbed("⚠️ Warn Added", `${target} diberi warning.\nReason: **${reason}**`, "Orange")] });
    }

    if (commandName === "warnings") {
      const target = interaction.options.getMember("user");
      const key = `${interaction.guild.id}-${target.id}`;
      const warns = warnMap.get(key) || [];

      if (!warns.length) {
        return interaction.reply({ embeds: [modernEmbed("✅ Clean", `${target} tidak punya warning.`, "Green")], ephemeral: true });
      }

      const list = warns.map((w, i) => `**${i + 1}.** ${w.reason}\nMod: ${w.mod}\nTime: ${w.time}`).join("\n\n");
      return interaction.reply({ embeds: [modernEmbed(`⚠️ Warnings: ${target.user.tag}`, list, "Orange")], ephemeral: true });
    }

    if (commandName === "clearwarn") {
      const target = interaction.options.getMember("user");
      const key = `${interaction.guild.id}-${target.id}`;
      warnMap.delete(key);
      return interaction.reply({ embeds: [modernEmbed("✅ Warnings Cleared", `Warning ${target} sudah dihapus.`, "Green")] });
    }

    if (commandName === "ban") {
      const target = interaction.options.getMember("user");
      const reason = interaction.options.getString("reason") || "Tidak ada alasan";

      await target.ban({ reason }).catch(() => null);
      await sendLog(interaction.guild, "🔨 User Banned", `User: ${target.user.tag}\nMod: ${interaction.user.tag}\nReason: ${reason}`, "Red");
      return interaction.reply({ embeds: [modernEmbed("🔨 Banned", `${target.user.tag} diban.\nReason: ${reason}`, "Red")] });
    }

    if (commandName === "kick") {
      const target = interaction.options.getMember("user");
      const reason = interaction.options.getString("reason") || "Tidak ada alasan";

      await target.kick(reason).catch(() => null);
      await sendLog(interaction.guild, "👢 User Kicked", `User: ${target.user.tag}\nMod: ${interaction.user.tag}\nReason: ${reason}`, "Orange");
      return interaction.reply({ embeds: [modernEmbed("👢 Kicked", `${target.user.tag} dikick.\nReason: ${reason}`, "Orange")] });
    }

    if (commandName === "timeout") {
      const target = interaction.options.getMember("user");
      const durationInput = interaction.options.getString("duration");
      const reason = interaction.options.getString("reason") || "Tidak ada alasan";
      const duration = parseDuration(durationInput);

      if (!duration) {
        return interaction.reply({ content: "Format durasi salah. Contoh: `10m`, `1h`, `1d`", ephemeral: true });
      }

      await target.timeout(duration, reason).catch(() => null);
      await sendLog(interaction.guild, "⏳ User Timeout", `User: ${target}\nDurasi: ${durationInput}\nReason: ${reason}`, "Orange");
      return interaction.reply({ embeds: [modernEmbed("⏳ Timeout", `${target} timeout **${durationInput}**.\nReason: ${reason}`, "Orange")] });
    }

    if (commandName === "untimeout") {
      const target = interaction.options.getMember("user");
      await target.timeout(null).catch(() => null);
      await sendLog(interaction.guild, "✅ Timeout Removed", `User: ${target}\nMod: ${interaction.user}`, "Green");
      return interaction.reply({ embeds: [modernEmbed("✅ Untimeout", `${target} sudah bebas timeout.`, "Green")] });
    }
  } catch (err) {
    console.error("INTERACTION ERROR:", err);
    if (interaction.deferred || interaction.replied) {
      interaction.editReply({ content: "Terjadi error saat menjalankan command." }).catch(() => {});
    } else {
      interaction.reply({ content: "Terjadi error saat menjalankan command.", ephemeral: true }).catch(() => {});
    }
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
    await sendLog(member.guild, "🚨 Anti Raid", `Join cepat terdeteksi.\nMember baru ${member.user.tag} diberi timeout **30 menit**.`, "DarkRed");
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