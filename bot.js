require('dotenv').config();
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const Room = require('./src/models/Room');
const adminApp = require('./src/admin/server');

const ADMIN_PORT = process.env.PORT || process.env.ADMIN_PORT || 3000;
const Conversation = require('./src/models/Conversation');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Tạo system prompt từ dữ liệu phòng thật trong DB
async function buildSystemPrompt() {
  const rooms = await Room.find().sort({ price: 1 });
  const furnitureLabel = { none: 'Không nội thất', basic: 'Nội thất cơ bản', full: 'Đầy đủ nội thất' };
  const statusLabel = { available: 'Còn trống', rented: 'Đã có người thuê' };

  const roomList = rooms.length > 0
    ? rooms.map(r =>
        `- Phòng ${r.roomNumber}: ${r.price.toLocaleString('vi-VN')}đ/tháng | ${r.address}, ${r.district} | ${r.area}m² | ${furnitureLabel[r.furniture]} | ${statusLabel[r.status]}`
      ).join('\n')
    : 'Chưa có dữ liệu phòng trọ.';

  return `Bạn là trợ lý tư vấn thuê nhà tên "Bot Thuê Nhà".
Nhiệm vụ: hỗ trợ khách tìm phòng trọ, tư vấn hợp đồng thuê nhà, giải đáp thắc mắc liên quan.

Danh sách phòng trọ hiện có:
${roomList}

Liên hệ đặt xem phòng: 0901 234 567 (8:00 - 20:00)

Trả lời ngắn gọn, thân thiện bằng tiếng Việt. Gợi ý phòng phù hợp với nhu cầu khách.`;
}

// Gọi Claude với lịch sử từ MongoDB
async function askClaude(userId, firstName, username, userMessage) {
  let conv = await Conversation.findOne({ userId });
  if (!conv) {
    conv = new Conversation({ userId, firstName, username, messages: [] });
  }

  conv.messages.push({ role: 'user', content: userMessage });
  if (conv.messages.length > 20) conv.messages = conv.messages.slice(-20);

  const systemPrompt = await buildSystemPrompt();

  const response = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: conv.messages.map(m => ({ role: m.role, content: m.content })),
  });

  const reply = response.content[0].text;
  conv.messages.push({ role: 'assistant', content: reply });
  conv.updatedAt = new Date();
  await conv.save();

  return reply;
}

// Format phòng để hiển thị
function formatRoom(room) {
  const furniture = { none: 'Không nội thất', basic: 'Nội thất cơ bản', full: 'Đầy đủ nội thất' };
  const status = { available: '✅ Còn trống', rented: '❌ Đã có người thuê' };
  return (
    `🏠 *Phòng ${room.roomNumber}*\n` +
    `💰 ${room.price.toLocaleString('vi-VN')}đ/tháng\n` +
    `📍 ${room.address}, ${room.district}\n` +
    `📐 ${room.area}m² | ${furniture[room.furniture]}\n` +
    `${status[room.status]}\n` +
    (room.description ? `📝 ${room.description}\n` : '') +
    `📞 ${room.contact}`
  );
}

console.log('Đang kết nối MongoDB...');

// /start
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || 'bạn';
  bot.sendMessage(msg.chat.id,
    `Xin chào ${name}! 👋 Tôi là Bot Thuê Nhà.\n\n` +
    `Nhắn tin bất kỳ để hỏi tôi, ví dụ:\n` +
    `• "Có phòng nào dưới 3 triệu không?"\n` +
    `• "Phòng Quận 1 còn trống không?"\n` +
    `• "Hợp đồng thuê nhà cần lưu ý gì?"\n\n` +
    `📋 /danhsach — Xem tất cả phòng\n` +
    `🔄 /reset — Xóa lịch sử hội thoại`
  );
});

// Gửi 1 phòng với ảnh thumbnail + nút xem chi tiết
async function sendRoomCard(chatId, room) {
  const furniture = { none: 'Không nội thất', basic: 'Nội thất cơ bản', full: 'Đầy đủ nội thất' };
  const status = { available: '✅ Còn trống', rented: '❌ Đã có người thuê' };
  const caption =
    `🏠 *Phòng ${room.roomNumber}*\n` +
    `💰 ${room.price.toLocaleString('vi-VN')}đ/tháng\n` +
    `📍 ${room.address}, ${room.district}\n` +
    `📐 ${room.area}m² | ${furniture[room.furniture]}\n` +
    `${status[room.status]}`;

  const keyboard = {
    inline_keyboard: [[
      { text: '🔍 Xem chi tiết', callback_data: `detail_${room._id}` }
    ]]
  };

  if (room.images && room.images.length > 0) {
    const imgUrl = room.images[0];
    await bot.sendPhoto(chatId, imgUrl, {
      caption,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } else {
    await bot.sendMessage(chatId, caption, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}

// /danhsach
bot.onText(/\/danhsach/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendChatAction(chatId, 'typing');
  try {
    const rooms = await Room.find().sort({ price: 1 });
    if (rooms.length === 0) return bot.sendMessage(chatId, 'Hiện chưa có phòng trọ nào.');
    await bot.sendMessage(chatId, `📋 *Danh sách ${rooms.length} phòng trọ:*`, { parse_mode: 'Markdown' });
    for (const room of rooms) {
      await sendRoomCard(chatId, room);
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, 'Không thể tải danh sách phòng. Thử lại sau!');
  }
});

// Xử lý nút "Xem chi tiết"
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('detail_')) {
    const roomId = data.replace('detail_', '');
    try {
      const room = await Room.findById(roomId);
      if (!room) return bot.answerCallbackQuery(query.id, { text: 'Không tìm thấy phòng!' });

      const furniture = { none: 'Không nội thất', basic: 'Nội thất cơ bản', full: 'Đầy đủ nội thất' };
      const status = { available: '✅ Còn trống', rented: '❌ Đã có người thuê' };

      const detail =
        `🏠 *Chi tiết Phòng ${room.roomNumber}*\n\n` +
        `💰 Giá: *${room.price.toLocaleString('vi-VN')}đ/tháng*\n` +
        `📍 Địa chỉ: ${room.address}\n` +
        `🗺 Khu vực: ${room.district}\n` +
        `📐 Diện tích: ${room.area}m²\n` +
        `🛋 Nội thất: ${furniture[room.furniture]}\n` +
        `📊 Trạng thái: ${status[room.status]}\n` +
        (room.description ? `\n📝 ${room.description}\n` : '') +
        `\n📞 Liên hệ: *${room.contact}*`;

      // Gửi tất cả ảnh nếu có nhiều hơn 1
      if (room.images && room.images.length > 1) {
        const mediaGroup = room.images.map((img, i) => ({
          type: 'photo',
          media: img,
          ...(i === 0 ? { caption: detail, parse_mode: 'Markdown' } : {}),
        }));
        await bot.sendMediaGroup(chatId, mediaGroup);
      } else {
        await bot.sendMessage(chatId, detail, { parse_mode: 'Markdown' });
      }

      bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error(err);
      bot.answerCallbackQuery(query.id, { text: 'Có lỗi xảy ra!' });
    }
  }
});

// /reset
bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;
  await Conversation.findOneAndUpdate({ userId: chatId }, { messages: [] });
  bot.sendMessage(chatId, '🔄 Đã xóa lịch sử. Bắt đầu lại nào!');
});

// Tin nhắn thường → Claude AI
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  bot.sendChatAction(chatId, 'typing');
  try {
    const reply = await askClaude(chatId, msg.from.first_name, msg.from.username, text);
    bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error('Lỗi:', err.message);
    bot.sendMessage(chatId, '⚠️ Xin lỗi, tôi đang gặp sự cố. Vui lòng thử lại sau!');
  }
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));

// Kết nối MongoDB rồi mới chạy bot + admin
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Đã kết nối MongoDB. Bot đang chạy...');
    adminApp.listen(ADMIN_PORT, () => {
      console.log(`🌐 Admin page: http://localhost:${ADMIN_PORT}/admin`);
    });
  })
  .catch(err => {
    console.error('❌ Lỗi kết nối MongoDB:', err.message);
    process.exit(1);
  });
