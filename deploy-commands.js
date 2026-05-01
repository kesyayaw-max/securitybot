require("dotenv").config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const adminOnly = (cmd) => cmd.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const commands = [
  adminOnly(
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Setup / create config server di database")
  ),

  adminOnly(
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Tampilkan public security control panel")
  ),

  adminOnly(
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Cek latency bot")
  ),

  adminOnly(
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Cek status security system")
  ),

  adminOnly(
    new SlashCommandBuilder()
      .setName("config")
      .setDescription("Atur config security server")
      .addSubcommand((s) => s.setName("show").setDescription("Lihat config server"))
      .addSubcommand((s) =>
        s
          .setName("spam")
          .setDescription("Atur limit anti spam")
          .addIntegerOption((o) =>
            o.setName("limit").setDescription("Jumlah pesan").setRequired(true).setMinValue(2).setMaxValue(50)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("spamtime")
          .setDescription("Atur window anti spam dalam detik")
          .addIntegerOption((o) =>
            o.setName("seconds").setDescription("Detik").setRequired(true).setMinValue(3).setMaxValue(120)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("mention")
          .setDescription("Atur limit mention spam")
          .addIntegerOption((o) =>
            o.setName("limit").setDescription("Jumlah mention").setRequired(true).setMinValue(2).setMaxValue(50)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("caps")
          .setDescription("Atur persen caps spam")
          .addIntegerOption((o) =>
            o.setName("percent").setDescription("Persen 40-100").setRequired(true).setMinValue(40).setMaxValue(100)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("timeout")
          .setDescription("Atur durasi timeout punishment")
          .addStringOption((o) =>
            o.setName("duration").setDescription("Contoh: 10m, 1h, 1d").setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("security")
          .setDescription("ON/OFF security")
          .addStringOption((o) =>
            o
              .setName("mode")
              .setDescription("on/off")
              .setRequired(true)
              .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })
          )
      )
      .addSubcommand((s) =>
        s
          .setName("log")
          .setDescription("Set channel log")
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("Channel log")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("whitelist")
          .setDescription("Set role whitelist/bypass")
          .addRoleOption((o) =>
            o.setName("role").setDescription("Role whitelist").setRequired(true)
          )
      )
      .addSubcommand((s) => s.setName("reset").setDescription("Reset config server"))
  ),

  adminOnly(
    new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Hapus pesan di channel")
      .addIntegerOption((o) =>
        o.setName("amount").setDescription("Jumlah pesan 1-100").setRequired(true).setMinValue(1).setMaxValue(100)
      )
  ),

  adminOnly(new SlashCommandBuilder().setName("lock").setDescription("Lock channel ini")),
  adminOnly(new SlashCommandBuilder().setName("unlock").setDescription("Unlock channel ini")),
  adminOnly(new SlashCommandBuilder().setName("lockdown").setDescription("Lock semua channel server")),
  adminOnly(new SlashCommandBuilder().setName("unlockall").setDescription("Unlock semua channel server")),

  adminOnly(
    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Beri warning ke user")
      .addUserOption((o) => o.setName("user").setDescription("User target").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Alasan warning").setRequired(false))
  ),

  adminOnly(
    new SlashCommandBuilder()
      .setName("warnings")
      .setDescription("Lihat warning user")
      .addUserOption((o) => o.setName("user").setDescription("User target").setRequired(true))
  ),

  adminOnly(
    new SlashCommandBuilder()
      .setName("clearwarn")
      .setDescription("Hapus semua warning user")
      .addUserOption((o) => o.setName("user").setDescription("User target").setRequired(true))
  ),

  adminOnly(
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban user")
      .addUserOption((o) => o.setName("user").setDescription("User target").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Alasan ban").setRequired(false))
  ),

  adminOnly(
    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Kick user")
      .addUserOption((o) => o.setName("user").setDescription("User target").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Alasan kick").setRequired(false))
  ),

  adminOnly(
    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Timeout user")
      .addUserOption((o) => o.setName("user").setDescription("User target").setRequired(true))
      .addStringOption((o) => o.setName("duration").setDescription("Contoh: 10m, 1h, 1d").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Alasan timeout").setRequired(false))
  ),

  adminOnly(
    new SlashCommandBuilder()
      .setName("untimeout")
      .setDescription("Hapus timeout user")
      .addUserOption((o) => o.setName("user").setDescription("User target").setRequired(true))
  ),
].map((command) => command.toJSON());

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.log("TOKEN dan CLIENT_ID wajib diisi di .env / Railway Variables.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("Deploying slash commands...");

    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log("Slash commands berhasil deploy ke guild.");
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log("Slash commands berhasil deploy global.");
    }
  } catch (error) {
    console.error(error);
  }
})();
