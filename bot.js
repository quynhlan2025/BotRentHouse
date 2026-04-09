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

// Lưu trạng thái user đang chờ nhập giá
const userState = {};

// 4 nút menu hiển thị sau mỗi tin nhắn
const MAIN_MENU = {
  inline_keyboard: [[
    { text: '📋 Danh sách phòng', callback_data: 'menu_danhsach' },
    { text: '🔍 Tìm theo giá', callback_data: 'menu_timgia' },
  ], [
    { text: '📞 Liên hệ', callback_data: 'menu_lienhe' },
    { text: '🏠 Giới thiệu', callback_data: 'menu_gioithieu' },
  ]]
};

// Gửi tin nhắn kèm menu
function sendWithMenu(chatId, text, options = {}) {
  return bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: MAIN_MENU,
    ...options,
  });
}

// Gọi Claude AI
async function askClaude(userId, firstName, username, userMessage) {
  let conv = await Conversation.findOne({ userId });
  if (!conv) conv = new Conversation({ userId, firstName, username, messages: [] });

  conv.messages.push({ role: 'user', content: userMessage });
  if (conv.messages.length > 20) conv.messages = conv.messages.slice(-20);

  const rooms = await Room.find().sort({ price: 1 });
  const furnitureLabel = { none: 'Không nội thất', basic: 'Nội thất cơ bản', full: 'Đầy đủ nội thất' };
  const statusLabel = { available: 'Còn trống', rented: 'Đã có người thuê' };
  const roomList = rooms.length > 0
    ? rooms.map(r => `- Phòng ${r.roomNumber}: ${r.price.toLocaleString('vi-VN')}đ/tháng | ${r.address}, ${r.district} | ${r.area}m² | ${furnitureLabel[r.furniture]} | ${statusLabel[r.status]}`).join('\n')
    : 'Chưa có dữ liệu phòng trọ.';

  const systemPrompt = `Bạn là trợ lý tư vấn thuê nhà tên "Nhà trọ quận 3". Hỗ trợ khách tìm phòng trọ, tư vấn hợp đồng, giải đáp thắc mắc.\n\nDanh sách phòng:\n${roomList}\n\nLiên hệ: 0901 234 567 (8:00-20:00)\n\nTrả lời ngắn gọn, thân thiện bằng tiếng Việt.`;

  const response = await claude.messages.create({
    model: 'claude-haiku-4-5-20251001',
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

// Gửi card phòng
async function sendRoomCard(chatId, room) {
  const furniture = { none: 'Không nội thất', basic: 'Nội thất cơ bản', full: 'Đầy đủ nội thất' };
  const status = { available: '✅ Còn trống', rented: '❌ Đã có người thuê' };
  const caption =
    `🏠 *Phòng ${room.roomNumber}*\n` +
    `💰 ${room.price.toLocaleString('vi-VN')}đ/tháng\n` +
    `📍 ${room.address}, ${room.district}\n` +
    `📐 ${room.area}m² | ${furniture[room.furniture]}\n` +
    `${status[room.status]}`;

  const keyboard = { inline_keyboard: [[{ text: '🔍 Xem chi tiết', callback_data: `detail_${room._id}` }]] };

  if (room.images && room.images.length > 0) {
    await bot.sendPhoto(chatId, room.images[0], { caption, parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

console.log('Đang kết nối MongoDB...');

// /start
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || 'bạn';
  sendWithMenu(msg.chat.id,
    `Xin chào *${name}*! 👋 Tôi là Nhà trọ quận 3.\n\nChọn một trong các mục bên dưới hoặc nhắn tin để hỏi tôi!`
  );
});

// /reset
bot.onText(/\/reset/, async (msg) => {
  await Conversation.findOneAndUpdate({ userId: msg.chat.id }, { messages: [] });
  sendWithMenu(msg.chat.id, '🔄 Đã xóa lịch sử. Bắt đầu lại nào!');
});

// Xử lý các nút menu + callback
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  bot.answerCallbackQuery(query.id);

  // Danh sách phòng
  if (data === 'menu_danhsach') {
    bot.sendChatAction(chatId, 'typing');
    const rooms = await Room.find().sort({ price: 1 });
    if (rooms.length === 0) return sendWithMenu(chatId, 'Hiện chưa có phòng trọ nào.');
    await bot.sendMessage(chatId, `📋 *Danh sách ${rooms.length} phòng trọ:*`, { parse_mode: 'Markdown' });
    for (const room of rooms) await sendRoomCard(chatId, room);
    sendWithMenu(chatId, 'Bạn cần hỗ trợ thêm gì không?');
  }

  // Tìm theo giá
  else if (data === 'menu_timgia') {
    userState[chatId] = 'waiting_price';
    bot.sendMessage(chatId,
      `🔍 Nhập ngân sách tối đa của bạn (đơn vị: đồng)\n\nVí dụ: *3000000* hoặc *3tr*`,
      { parse_mode: 'Markdown' }
    );
  }

  // Liên hệ
  else if (data === 'menu_lienhe') {
    sendWithMenu(chatId,
      `📞 *Thông tin liên hệ*\n\n` +
      `👤 Chủ nhà: Nguyễn Văn A\n` +
      `📱 SĐT: *0901 234 567*\n` +
      `🕐 Giờ làm việc: 8:00 - 20:00\n` +
      `📍 Địa chỉ: TP. Hồ Chí Minh`
    );
  }

  // Giới thiệu
  else if (data === 'menu_gioithieu') {
    const total = await Room.countDocuments();
    const available = await Room.countDocuments({ status: 'available' });
    sendWithMenu(chatId,
      `🏠 *Giới thiệu về chúng tôi*\n\n` +
      `Chúng tôi cho thuê phòng trọ chất lượng tại TP.HCM.\n\n` +
      `📊 Tổng số phòng: *${total} phòng*\n` +
      `✅ Đang còn trống: *${available} phòng*\n\n` +
      `Liên hệ ngay để được tư vấn miễn phí!`
    );
  }

  // Xem chi tiết phòng
  else if (data.startsWith('detail_')) {
    const roomId = data.replace('detail_', '');
    try {
      const room = await Room.findById(roomId);
      if (!room) return bot.sendMessage(chatId, 'Không tìm thấy phòng!');

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

      if (room.images && room.images.length > 1) {
        const mediaGroup = room.images.map((img, i) => ({
          type: 'photo', media: img,
          ...(i === 0 ? { caption: detail, parse_mode: 'Markdown' } : {}),
        }));
        await bot.sendMediaGroup(chatId, mediaGroup);
        sendWithMenu(chatId, 'Bạn cần hỗ trợ thêm gì không?');
      } else {
        sendWithMenu(chatId, detail);
      }
    } catch (err) {
      console.error(err);
      sendWithMenu(chatId, '⚠️ Có lỗi xảy ra, vui lòng thử lại!');
    }
  }
});

// Tin nhắn thường
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  // Đang chờ nhập giá
  if (userState[chatId] === 'waiting_price') {
    delete userState[chatId];
    const normalized = text.replace(/tr$/i, '000000').replace(/[.,\s]/g, '');
    const maxPrice = parseInt(normalized);

    if (isNaN(maxPrice) || maxPrice <= 0) {
      return sendWithMenu(chatId, '❌ Giá không hợp lệ. Vui lòng nhập lại số tiền, ví dụ: *3000000*');
    }

    bot.sendChatAction(chatId, 'typing');
    const rooms = await Room.find({ price: { $lte: maxPrice } }).sort({ price: 1 });

    if (rooms.length === 0) {
      return sendWithMenu(chatId, `😔 Không có phòng nào dưới *${maxPrice.toLocaleString('vi-VN')}đ*.\n\nBạn có muốn xem tất cả phòng không?`);
    }

    await bot.sendMessage(chatId,
      `🔍 Tìm thấy *${rooms.length} phòng* dưới *${maxPrice.toLocaleString('vi-VN')}đ*:`,
      { parse_mode: 'Markdown' }
    );
    for (const room of rooms) await sendRoomCard(chatId, room);
    sendWithMenu(chatId, 'Bạn cần hỗ trợ thêm gì không?');
    return;
  }

  // Claude AI
  bot.sendChatAction(chatId, 'typing');
  try {
    const reply = await askClaude(chatId, msg.from.first_name, msg.from.username, text);
    sendWithMenu(chatId, reply);
  } catch (err) {
    console.error('Lỗi:', err.message);
    sendWithMenu(chatId, '⚠️ Xin lỗi, tôi đang gặp sự cố. Vui lòng thử lại sau!');
  }
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));

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
