const axios = require('axios');
const Room = require('../models/Room');

const BOT_TOKEN = process.env.ZALO_OA_TOKEN;
const BASE_URL = `https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}`;

// Gửi tin nhắn text
async function sendText(userId, text) {
  await axios.post(`${BASE_URL}/sendMessage`, {
    chat_id: userId,
    text,
  });
}

// Gửi tin nhắn kèm menu dạng text
async function sendWithMenu(userId, text) {
  await sendText(userId,
    text + '\n\n' +
    '━━━━━━━━━━━━━━━\n' +
    '1️⃣ Danh sách phòng\n' +
    '2️⃣ Tìm phòng theo giá\n' +
    '3️⃣ Liên hệ chủ nhà\n' +
    '4️⃣ Giới thiệu dịch vụ\n' +
    '━━━━━━━━━━━━━━━\n' +
    '👉 Nhắn số để chọn'
  );
}

// Gửi card phòng
async function sendRoomCard(userId, room) {
  const furniture = { none: 'Không nội thất', basic: 'Nội thất cơ bản', full: 'Đầy đủ nội thất' };
  const status = { available: '✅ Còn trống', rented: '❌ Đã có người thuê' };
  const text =
    `🏠 Phòng ${room.roomNumber}\n` +
    `💰 ${room.price.toLocaleString('vi-VN')}đ/tháng\n` +
    `📍 ${room.address}, ${room.district}\n` +
    `📐 ${room.area}m² | ${furniture[room.furniture]}\n` +
    `${status[room.status]}\n` +
    `📞 ${room.contact}`;

  // Gửi ảnh nếu có
  if (room.images && room.images.length > 0) {
    await axios.post(`${BASE_URL}/sendPhoto`, {
      chat_id: userId,
      photo: room.images[0],
      caption: text,
    }).catch(() => sendText(userId, text));
  } else {
    await sendText(userId, text);
  }
}

// Lưu trạng thái user
const userState = {};

// Xử lý tin nhắn
async function handleZaloMessage(event) {
  // Xử lý cả message và callback_query
  const userId = event.callback_query?.from?.id || event.message?.from?.id || event.sender?.id;
  const callbackData = event.callback_query?.data || '';
  const text = (event.message?.text || '').trim();
  const action = callbackData || text;

  if (!userId) return;

  if (action === '/start' || action === 'Bắt đầu' || action === 'start') {
    return sendWithMenu(userId, 'Xin chào! 👋 Tôi là Nhà trọ quận 3.');
  }

  if (action === 'menu_danhsach' || action === '1') {
    const rooms = await Room.find().sort({ price: 1 });
    if (rooms.length === 0) return sendWithMenu(userId, 'Hiện chưa có phòng trọ nào.');
    await sendText(userId, `📋 Danh sách ${rooms.length} phòng trọ:`);
    for (const room of rooms) await sendRoomCard(userId, room);
    return sendWithMenu(userId, 'Bạn cần hỗ trợ thêm gì không?');
  }

  if (action === 'menu_timgia' || action === '2') {
    userState[userId] = 'waiting_price';
    return sendText(userId, '🔍 Nhập ngân sách tối đa (đơn vị đồng)\nVí dụ: 3000000 hoặc 3tr');
  }

  if (action === 'menu_lienhe' || action === '3') {
    return sendWithMenu(userId,
      '📞 Thông tin liên hệ\n\n👤 Chủ nhà: Nguyễn Văn A\n📱 SĐT: 0901 234 567\n🕐 Giờ làm việc: 8:00 - 20:00'
    );
  }

  if (action === 'menu_gioithieu' || action === '4') {
    const total = await Room.countDocuments();
    const available = await Room.countDocuments({ status: 'available' });
    return sendWithMenu(userId,
      `🏠 Giới thiệu\n\nChúng tôi cho thuê phòng trọ tại TP.HCM.\n\n📊 Tổng phòng: ${total}\n✅ Còn trống: ${available}\n\nLiên hệ ngay để được tư vấn!`
    );
  }

  // Đang chờ nhập giá
  if (userState[userId] === 'waiting_price') {
    delete userState[userId];
    const normalized = text.replace(/tr$/i, '000000').replace(/[.,\s]/g, '');
    const maxPrice = parseInt(normalized);

    if (isNaN(maxPrice) || maxPrice <= 0) {
      return sendWithMenu(userId, '❌ Giá không hợp lệ. Ví dụ: 3000000 hoặc 3tr');
    }

    const rooms = await Room.find({ price: { $lte: maxPrice } }).sort({ price: 1 });
    if (rooms.length === 0) {
      return sendWithMenu(userId, `😔 Không có phòng nào dưới ${maxPrice.toLocaleString('vi-VN')}đ.`);
    }

    await sendText(userId, `🔍 Tìm thấy ${rooms.length} phòng dưới ${maxPrice.toLocaleString('vi-VN')}đ:`);
    for (const room of rooms) await sendRoomCard(userId, room);
    return sendWithMenu(userId, 'Bạn cần hỗ trợ thêm gì không?');
  }

  // Mặc định
  return sendWithMenu(userId, 'Xin chào! 👋 Chọn một mục bên dưới để bắt đầu!');
}

module.exports = { handleZaloMessage };
