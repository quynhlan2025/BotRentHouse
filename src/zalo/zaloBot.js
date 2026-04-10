const axios = require('axios');
const Room = require('../models/Room');
const ZaloConversation = require('../models/ZaloConversation');
const MaintenanceRequest = require('../models/MaintenanceRequest');
const { askClaude } = require('../handlers/claudeHandler');

const BOT_TOKEN = process.env.ZALO_OA_TOKEN;
const BASE_URL = `https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}`;

// Lấy profile user từ Zalo API
async function fetchUserProfile(userId) {
  try {
    const res = await axios.get(`${BASE_URL}/getUserInfo`, {
      params: { user_id: userId }
    });
    const data = res.data?.data || res.data || {};
    return {
      displayName: data.display_name || data.name || data.zaloName || '',
      avatar:      data.avatar       || data.avatarUrl || '',
      phone:       data.phone        || '',
    };
  } catch {
    return { displayName: '', avatar: '', phone: '' };
  }
}

// Lưu tin nhắn vào DB
async function saveMessage(userId, fromEvent, role, text) {
  try {
    const existing = await ZaloConversation.findOne({ zaloUserId: userId });

    // Nếu chưa có profile đầy đủ thì gọi API lấy
    let profile = { displayName: fromEvent.displayName || '', avatar: fromEvent.avatar || '', phone: fromEvent.phone || '' };
    if (!existing || !existing.displayName || existing.displayName === 'Khách hàng') {
      const fetched = await fetchUserProfile(userId);
      if (fetched.displayName) profile = { ...profile, ...fetched };
    }

    await ZaloConversation.findOneAndUpdate(
      { zaloUserId: userId },
      {
        $set: {
          ...(profile.displayName && { displayName: profile.displayName }),
          ...(profile.avatar      && { avatar: profile.avatar }),
          ...(profile.phone       && { phone: profile.phone }),
          lastMessage: text,
          lastMessageAt: new Date(),
        },
        $push: { messages: { role, text, createdAt: new Date() } },
        $inc:  { unread: role === 'user' ? 1 : 0 },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('Lỗi lưu ZaloConversation:', err.message);
  }
}

// Gửi tin nhắn text
async function sendText(userId, text, profile) {
  await saveMessage(userId, profile || {}, 'bot', text);
  await axios.post(`${BASE_URL}/sendMessage`, {
    chat_id: userId,
    text,
  });
}

// Gửi tin nhắn kèm menu dạng text
async function sendWithMenu(userId, text, profile) {
  await sendText(userId,
    text + '\n\n' +
    '━━━━━━━━━━━━━━━\n' +
    '1️⃣ Danh sách phòng\n' +
    '2️⃣ Tìm phòng theo giá\n' +
    '3️⃣ Liên hệ chủ nhà\n' +
    '4️⃣ Giới thiệu dịch vụ\n' +
    '5️⃣ Báo sự cố / sửa chữa\n' +
    '━━━━━━━━━━━━━━━\n' +
    '👉 Nhắn số để chọn',
    profile
  );
}

// Gửi card phòng
async function sendRoomCard(userId, room, profile) {
  const furniture = { none: 'Không nội thất', basic: 'Nội thất cơ bản', full: 'Đầy đủ nội thất' };
  const status = { available: '✅ Còn trống', rented: '❌ Đã có người thuê' };
  const text =
    `🏠 Phòng ${room.roomNumber}\n` +
    `💰 ${room.price.toLocaleString('vi-VN')}đ/tháng\n` +
    `📍 ${room.address}, ${room.district}\n` +
    `📐 ${room.area}m² | ${furniture[room.furniture]}\n` +
    `${status[room.status]}\n` +
    `📞 ${room.contact}`;

  if (room.images && room.images.length > 0) {
    await saveMessage(userId, profile || {}, 'bot', text);
    await axios.post(`${BASE_URL}/sendPhoto`, {
      chat_id: userId,
      photo: room.images[0],
      caption: text,
    }).catch(() => sendText(userId, text, profile));
  } else {
    await sendText(userId, text, profile);
  }
}

// Lưu trạng thái user
const userState = {};
// Trạng thái maintenance
const maintenanceState = {};

// Xử lý tin nhắn
async function handleZaloMessage(event) {
  const userId = event.callback_query?.from?.id || event.message?.from?.id || event.sender?.id;
  const profile = {
    displayName: event.message?.from?.first_name || event.sender?.display_name || event.sender?.name || '',
    avatar:      event.sender?.avatar || event.message?.from?.avatar || '',
    phone:       event.sender?.phone  || event.message?.from?.phone  || '',
  };
  const callbackData = event.callback_query?.data || '';
  const text   = (event.message?.text || '').trim();
  const action = callbackData || text;

  if (!userId) return;

  // Lưu tin nhắn của user
  if (text) await saveMessage(userId, profile, 'user', text);

  // Nếu admin đang tiếp quản → bot im lặng
  const conv = await ZaloConversation.findOne({ zaloUserId: userId });
  if (conv?.takenOver) return;

  if (action === '/start' || action === 'Bắt đầu' || action === 'start') {
    return sendWithMenu(userId, 'Xin chào! 👋 Tôi là Nhà trọ quận 3.', profile);
  }

  if (action === 'menu_danhsach' || action === '1') {
    const rooms = await Room.find().sort({ price: 1 });
    if (rooms.length === 0) return sendWithMenu(userId, 'Hiện chưa có phòng trọ nào.', profile);
    await sendText(userId, `📋 Danh sách ${rooms.length} phòng trọ:`, profile);
    for (const room of rooms) await sendRoomCard(userId, room, profile);
    return sendWithMenu(userId, 'Bạn cần hỗ trợ thêm gì không?', profile);
  }

  if (action === 'menu_timgia' || action === '2') {
    userState[userId] = 'waiting_price';
    return sendText(userId, '🔍 Nhập ngân sách tối đa (đơn vị đồng)\nVí dụ: 3000000 hoặc 3tr', profile);
  }

  if (action === 'menu_lienhe' || action === '3') {
    return sendWithMenu(userId,
      '📞 Thông tin liên hệ\n\n👤 Chủ nhà: Nguyễn Văn A\n📱 SĐT: 0901 234 567\n🕐 Giờ làm việc: 8:00 - 20:00',
      profile
    );
  }

  if (action === 'menu_gioithieu' || action === '4') {
    const total     = await Room.countDocuments();
    const available = await Room.countDocuments({ status: 'available' });
    return sendWithMenu(userId,
      `🏠 Giới thiệu\n\nChúng tôi cho thuê phòng trọ tại TP.HCM.\n\n📊 Tổng phòng: ${total}\n✅ Còn trống: ${available}\n\nLiên hệ ngay để được tư vấn!`,
      profile
    );
  }

  if (action === 'menu_suachua' || action === '5' || /báo sự cố|sửa chữa|hỏng|bị hỏng|bị hư/i.test(action)) {
    maintenanceState[userId] = { step: 'waiting_form' };
    return sendText(userId,
      '🔧 Báo sự cố / Yêu cầu sửa chữa\n\n' +
      'Vui lòng copy mẫu bên dưới, điền thông tin và gửi lại:\n\n' +
      '━━━━━━━━━━━━━━━\n' +
      'Phòng: [số phòng]\n' +
      'Sự cố: [mô tả vấn đề]\n' +
      'Mức độ: [khẩn / bình thường]\n' +
      '━━━━━━━━━━━━━━━\n\n' +
      'Ví dụ:\n' +
      'Phòng: 101\n' +
      'Sự cố: Đèn phòng ngủ bị hỏng\n' +
      'Mức độ: bình thường',
      profile
    );
  }

  if (maintenanceState[userId]?.step === 'waiting_form') {
    // Parse template: tìm "Phòng: xxx" và "Sự cố: xxx"
    const roomMatch = text.match(/ph[oò]ng\s*[:\-]\s*(.+)/i);
    const descMatch = text.match(/s[ựu]\s*c[oố]\s*[:\-]\s*(.+)/i);
    const levelMatch = text.match(/m[uứ]c\s*[đd][oộ]\s*[:\-]\s*(.+)/i);

    if (!roomMatch || !descMatch) {
      return sendText(userId,
        '⚠️ Chưa đúng mẫu. Vui lòng điền đầy đủ:\n\n' +
        'Phòng: [số phòng]\n' +
        'Sự cố: [mô tả vấn đề]\n' +
        'Mức độ: [khẩn / bình thường]',
        profile
      );
    }

    delete maintenanceState[userId];
    const roomNumber  = roomMatch[1].trim();
    const description = descMatch[1].trim();
    const level       = levelMatch ? levelMatch[1].trim() : 'bình thường';
    const isUrgent    = /khẩn|gấp|nguy hiểm|cháy|điện giật/i.test(level + description);

    await MaintenanceRequest.create({
      zaloUserId:  userId,
      displayName: profile.displayName || 'Khách hàng',
      phone:       profile.phone || '',
      roomNumber,
      description: `${description} (Mức độ: ${level})`,
    });

    if (isUrgent) {
      return sendText(userId,
        '🚨 Đã ghi nhận SỰ CỐ KHẨN!\n\n' +
        `🏠 Phòng: ${roomNumber}\n` +
        `📋 Sự cố: ${description}\n\n` +
        '📞 Liên hệ chủ nhà NGAY:\n' +
        '👤 Nguyễn Văn A — 0901 234 567\n' +
        '🕐 Trực 7:00 – 22:00',
        profile
      );
    }

    return sendText(userId,
      '✅ Đã ghi nhận yêu cầu!\n\n' +
      `🏠 Phòng: ${roomNumber}\n` +
      `📋 Sự cố: ${description}\n` +
      `⚡ Mức độ: ${level}\n\n` +
      '⏳ Chủ nhà sẽ liên hệ bạn sớm.\n\n' +
      'Cần liên hệ ngay?\n' +
      '📞 0901 234 567 (7:00 – 22:00)',
      profile
    );
  }

  if (userState[userId] === 'waiting_price') {
    delete userState[userId];
    const normalized = text.replace(/tr$/i, '000000').replace(/[.,\s]/g, '');
    const maxPrice   = parseInt(normalized);

    if (isNaN(maxPrice) || maxPrice <= 0) {
      return sendWithMenu(userId, '❌ Giá không hợp lệ. Ví dụ: 3000000 hoặc 3tr', profile);
    }

    const rooms = await Room.find({ price: { $lte: maxPrice } }).sort({ price: 1 });
    if (rooms.length === 0) {
      return sendWithMenu(userId, `😔 Không có phòng nào dưới ${maxPrice.toLocaleString('vi-VN')}đ.`, profile);
    }

    await sendText(userId, `🔍 Tìm thấy ${rooms.length} phòng dưới ${maxPrice.toLocaleString('vi-VN')}đ:`, profile);
    for (const room of rooms) await sendRoomCard(userId, room, profile);
    return sendWithMenu(userId, 'Bạn cần hỗ trợ thêm gì không?', profile);
  }

  // Không khớp menu → gọi Claude AI trả lời tự nhiên
  try {
    const aiReply = await askClaude(userId, profile.displayName, '', text);
    return sendText(userId, aiReply, profile);
  } catch (err) {
    console.error('Claude error:', err.message);
    return sendWithMenu(userId, 'Xin chào! 👋 Chọn một mục bên dưới để bắt đầu!', profile);
  }
}

module.exports = { handleZaloMessage };
