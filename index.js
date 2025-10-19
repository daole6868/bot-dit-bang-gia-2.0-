require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, Events, ChannelType } = require('discord.js');
const fs = require('fs');
const express = require('express');

let services = [];
try {
  services = JSON.parse(fs.readFileSync('./services.json', 'utf8'));
} catch {
  services = [];
}

// Quản lý ticket
let tickets = [];
const TICKET_FILE = './tickets.json';
try {
  tickets = JSON.parse(fs.readFileSync(TICKET_FILE, 'utf8'));
} catch { tickets = []; }

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const TICKET_CATEGORY = 'Tickets';
const DELETE_TIME = 24 * 60 * 60 * 1000; // 24h
const WARNING_TIME = 23 * 60 * 60 * 1000; // 1h trước
const INACTIVITY_LIMIT = 12 * 60 * 60 * 1000; // 12h

function saveTickets() {
  fs.writeFileSync(TICKET_FILE, JSON.stringify(tickets, null, 2));
}

// === BOT READY ===
client.once(Events.ClientReady, async () => {
  console.log(`🤖 Bot đã đăng nhập: ${client.user.tag}`);

  const channel = await client.channels.fetch(process.env.WELCOME_CHANNEL_ID).catch(() => null);
  if (!channel) return console.log("❌ Không tìm thấy kênh welcome");

  const welcomeEmbed = new EmbedBuilder()
    .setTitle("🎉 Chào mừng bạn đến với dịch vụ cày thuê!")
    .setDescription("Chúng tôi cung cấp dịch vụ cày thuê Genshin Impact chất lượng cao. Nhấn nút bên dưới để mở ticket và xem bảng giá.")
    .setColor(0x00AE86)
    .setImage("https://fastcdn.hoyoverse.com/content-v2/hk4e/159934/9a54a8fc8b9183740df28a36f56da634_4301838442485055543.jpg")
    .addFields({ name: "⚠️ Lưu ý", value: "🔴 Không spam Ticket nếu bạn không muốn bị KICK !!!" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("open_ticket").setLabel("Mở Ticket").setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [welcomeEmbed], components: [row] });

  // Khôi phục ticket khi restart
  for (const t of tickets) {
    const ticketChannel = await client.channels.fetch(t.id).catch(() => null);
    if (!ticketChannel) continue;
    scheduleTicketDeletion(ticketChannel, t);
  }
});

// === HÀM TIỆN ÍCH ===
function scheduleTicketDeletion(channel, ticketData) {
  const elapsed = Date.now() - ticketData.createdAt;

  // Cảnh báo 1h trước khi xóa
  if (elapsed < WARNING_TIME) {
    setTimeout(() => channel.send("⚠️ Ticket sẽ tự động bị xóa sau 1 giờ!").catch(console.error),
      WARNING_TIME - elapsed);
  }

  // Xóa ticket sau 24h
  if (elapsed < DELETE_TIME) {
    setTimeout(async () => {
      if (channel.deletable) {
        await channel.send("⏰ Ticket đã hết hạn và sẽ bị xóa.").catch(console.error);
        await channel.delete().catch(console.error);
        tickets = tickets.filter(t => t.id !== channel.id);
        saveTickets();
      }
    }, DELETE_TIME - elapsed);
  }
}

// --- Xử lý button ---
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  const guild = interaction.guild;

  if (interaction.customId === "open_ticket") {
    let category = guild.channels.cache.find(c => c.name === TICKET_CATEGORY && c.type === ChannelType.GuildCategory);
    if (!category) {
      category = await guild.channels.create({ name: TICKET_CATEGORY, type: ChannelType.GuildCategory });
    }

    const ticketChannel = await guild.channels.create({
      name: `ticket-${interaction.user.username.toLowerCase()}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });

    // Nút đóng ticket
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("close_ticket").setLabel("Đóng Ticket").setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      content: `🟢 Chào ${interaction.user}, đây là kênh ticket riêng của bạn.\nGõ !banggia để xem bảng giá, !tim <tên> hoặc !timgia <giá> để tìm dịch vụ.\n⚠️ Ticket sẽ tự động bị xóa sau 24h, cảnh báo trước 1h.`,
      components: [closeRow]
    });

    await interaction.reply({ content: `✅ Ticket đã được tạo: ${ticketChannel}`, ephemeral: true });

    // Lưu ticket và lên lịch xóa
    const ticketData = { id: ticketChannel.id, userId: interaction.user.id, createdAt: Date.now(), lastActivity: Date.now() };
    tickets.push(ticketData);
    saveTickets();
    scheduleTicketDeletion(ticketChannel, ticketData);
  }

  if (interaction.customId === "close_ticket") {
    const channel = interaction.channel;
    if (channel.deletable) {
      await channel.send("⏹ Ticket đã được đóng bởi người dùng.").catch(console.error);
      await channel.delete().catch(console.error);
      tickets = tickets.filter(t => t.id !== channel.id);
      saveTickets();
    }
  }
});

// --- Xử lý lệnh trong ticket ---
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.channel.name.startsWith("ticket-")) return; // chỉ cho phép lệnh trong ticket

  // Cập nhật lastActivity
  tickets = tickets.map(t => t.id === message.channel.id ? { ...t, lastActivity: Date.now() } : t);
  saveTickets();

  const content = message.content.toLowerCase();

  function createEmbed(service) {
    const embed = new EmbedBuilder().setTitle(`📜 ${service.type}`).setColor(0x00AE86);
    service.items.forEach(i => embed.addFields({ name: i.name, value: `💰 Giá: ${i.price}` }));
    return embed;
  }

  if (content === "!banggia") {
    for (const service of services) message.channel.send({ embeds: [createEmbed(service)] });
  }

  if (content.startsWith("!tim ")) {
    const keyword = content.slice(5).trim();
    const results = services.map(s => {
      const matched = s.items.filter(i => i.name.toLowerCase().includes(keyword));
      if (matched.length > 0) return { type: s.type, items: matched };
      return null;
    }).filter(x => x);
    if (!results.length) return message.channel.send("❌ Không tìm thấy dịch vụ theo tên.");
    results.forEach(s => message.channel.send({ embeds: [createEmbed(s)] }));
  }

  if (content.startsWith("!timgia ")) {
    const keyword = content.slice(8).trim();
    const results = services.map(s => {
      const matched = s.items.filter(i => i.price.toLowerCase().includes(keyword));
      if (matched.length > 0) return { type: s.type, items: matched };
      return null;
    }).filter(x => x);
    if (!results.length) return message.channel.send("❌ Không tìm thấy dịch vụ theo giá.");
    results.forEach(s => message.channel.send({ embeds: [createEmbed(s)] }));
  }
});

// --- Xóa ticket không hoạt động 12h ---
setInterval(async () => {
  const now = Date.now();
  for (const t of tickets) {
    if (now - t.lastActivity > INACTIVITY_LIMIT) {
      const channel = await client.channels.fetch(t.id).catch(() => null);
      if (!channel) continue;
      if (channel.deletable) {
        await channel.send("⏰ Ticket bị xóa do không hoạt động 12h.").catch(console.error);
        await channel.delete().catch(console.error);
        tickets = tickets.filter(tt => tt.id !== t.id);
        saveTickets();
      }
    }
  }
}, 15 * 60 * 1000);

// --- LOGIN BOT ---
client.login(process.env.DISCORD_TOKEN);

// Fake web server
const expressApp = express();
expressApp.get("/", (req, res) => res.send("✅ Bot Discord đang hoạt động!"));
expressApp.listen(process.env.PORT || 3000, () => console.log(`🌐 Web server chạy port ${process.env.PORT || 3000}`));
