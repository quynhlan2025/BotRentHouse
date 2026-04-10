const axios = require('axios');
const Room = require('../models/Room');
const ZaloConversation = require('../models/ZaloConversation');
const MaintenanceRequest = require('../models/MaintenanceRequest');
const RoomBill = require('../models/RoomBill');
const { askClaude } = require('../handlers/claudeHandler');

const OA_TOKEN = process.env.ZALO_OA_TOKEN;
const ZALO_API = 'https://openapi.zalo.me/v2.0/oa';
const zaloHeaders = { access_token: OA_TOKEN };

const LANDLORD_NAME  = process.env.LANDLORD_NAME  || 'Chủ nhà';
const LANDLORD_PHONE = process.env.LANDLORD_PHONE || '0901 234 567';
const LANDLORD_HOURS = process.env.LANDLORD_HOURS || '7:00 – 22:00';

// Gửi thông báo Telegram cho chủ nhà
async function notifyLandlord(req) {
  const chatId = process.env.LANDLORD_TELEGRAM_ID;
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !token) return;
  const isUrgent = /khẩn|gấp|cháy|điện giật|nguy hiểm/i.test(req.description);
  const msg =
    `${isUrgent ? '🚨 SỰ CỐ KHẨN' : '🔧 Sự cố mới'}\n\n` +
    `🏠 Phòng: ${req.roomNumber}\n` +
    `👤 ${req.displayName}${req.phone ? ' · ' + req.phone : ''}\n` +
    `📋 ${req.description}\n` +
    `🕐 ${new Date().toLocaleString('vi-VN')}\n\n` +
    `👉 Xem tại: ${process.env.APP_URL || 'http://localhost:3000'}/admin/maintenance`;
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId, text: msg,
  }).catch(() => {});
}

// Lấy profile user từ Zalo API
async function fetchUserProfile(userId) {
  try {
    const res = await axios.get(`${ZALO_API}/getprofile`, {
      headers: zaloHeaders,
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
  await axios.post(`${ZALO_API}/message`, {
    recipient: { user_id: userId },
    message:   { text },
  }, { headers: zaloHeaders }).catch(e => console.error('Zalo sendText error:', e.response?.data || e.message));
}

// Gửi tin nhắn kèm nút bấm (tối đa 5 nút)
async function sendWithButtons(userId, text, buttons, profile) {
  await saveMessage(userId, profile || {}, 'bot', text);
  await axios.post(`${ZALO_API}/message`, {
    recipient: { user_id: userId },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button_list',
          elements: [{
            title:    '🏠 Nhà trọ quận 3',
            subtitle: text,
            buttons,
          }],
        },
      },
    },
  }, { headers: zaloHeaders }).catch(e => console.error('Zalo sendButtons error:', e.response?.data || e.message));
}

// Gửi menu chính với nút bấm
async function sendWithMenu(userId, text, profile) {
  await sendText(userId, text, profile);
  await sendWithButtons(userId, 'Chọn mục bạn cần:', [
    { title: '📋 Danh sách phòng',     type: 'oa.query.hide', payload: '1' },
    { title: '🔍 Tìm phòng theo giá',  type: 'oa.query.hide', payload: '2' },
    { title: '📞 Liên hệ chủ nhà',     type: 'oa.query.hide', payload: '3' },
    { title: '🔧 Báo sự cố',           type: 'oa.query.hide', payload: '5' },
    { title: '💰 Xem hóa đơn',         type: 'oa.query.hide', payload: '6' },
  ], profile);
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
    await axios.post(`${ZALO_API}/message`, {
      recipient: { user_id: userId },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'media',
            elements: [{
              media_type: 'image',
              url: room.images[0],
              title: `🏠 Phòng ${room.roomNumber}`,
              subtitle: text,
            }],
          },
        },
      },
    }, { headers: zaloHeaders }).catch(() => sendText(userId, text, profile));
  } else {
    await sendText(userId, text, profile);
  }
}

// Lưu trạng thái user
const userState = {};
// Trạng thái maintenance
const maintenanceState = {};
// Trạng thái xem hóa đơn
const billState = {};

// Xử lý tin nhắn
async function handleZaloMessage(event) {
  // Zalo OA event: sender.id cho text/image, follower.id cho follow event
  const userId = event.sender?.id || event.follower?.id;
  const profile = {
    displayName: event.sender?.display_name || '',
    avatar:      event.sender?.avatar || '',
    phone:       event.sender?.phone  || '',
  };
  const text   = (event.message?.text || '').trim();
  const action = text;

  if (!userId) return;

  // Follow event → gửi chào mừng
  if (event.event_name === 'follow') {
    return sendWithMenu(userId, 'Xin chào! 👋 Cảm ơn bạn đã quan tâm đến Nhà trọ quận 3.\nTôi có thể giúp gì cho bạn?', profile);
  }

  // Lưu tin nhắn của user
  if (text) await saveMessage(userId, profile, 'user', text);

  // Nếu admin đang tiếp quản → bot im lặng
  const conv = await ZaloConversation.findOne({ zaloUserId: userId });
  if (conv?.takenOver) return;

  // ── TRẠNG THÁI (ưu tiên kiểm tra trước menu) ─────────────────────────────────

  // BƯỚC 2: Nhận form báo sự cố → parse → lưu DB
  if (maintenanceState[userId]?.step === 'waiting_form') {
    const roomMatch  = text.match(/ph[oò]ng\s*[:\-]\s*(.+)/i);
    const descMatch  = text.match(/s[ựu]\s*c[oố]\s*[:\-]\s*(.+)/i);
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

    const roomNumber  = roomMatch[1].trim();
    const description = descMatch[1].trim();
    const level       = levelMatch ? levelMatch[1].trim() : 'bình thường';
    const isUrgent    = /khẩn|gấp|cháy|điện giật|nguy hiểm/i.test(level + description);

    const saved = await MaintenanceRequest.create({
      zaloUserId:  userId,
      displayName: profile.displayName || 'Khách hàng',
      phone:       profile.phone || '',
      roomNumber,
      description: `${description} (Mức độ: ${level})`,
      status: 'pending',
    });

    await notifyLandlord(saved);
    maintenanceState[userId] = { step: 'waiting_choice', roomNumber, description, isUrgent };

    if (isUrgent) {
      return sendWithButtons(userId,
        `🚨 Đã ghi nhận SỰ CỐ KHẨN!\n🏠 Phòng: ${roomNumber}\n📋 ${description}\n\nBạn muốn làm gì?`,
        [
          { title: '📞 Liên hệ chủ nhà NGAY', type: 'oa.query.hide', payload: 'contact_landlord' },
          { title: '⏳ Chờ chủ nhà xử lý',    type: 'oa.query.hide', payload: 'wait_landlord'   },
        ], profile
      );
    }

    return sendWithButtons(userId,
      `✅ Đã ghi nhận yêu cầu!\n🏠 Phòng: ${roomNumber}\n📋 ${description}\n⚡ Mức độ: ${level}\n\nBạn muốn làm gì?`,
      [
        { title: '📞 Liên hệ chủ nhà ngay',  type: 'oa.query.hide', payload: 'contact_landlord' },
        { title: '⏳ Để chủ nhà xử lý sau',   type: 'oa.query.hide', payload: 'wait_landlord'   },
      ], profile
    );
  }

  // BƯỚC 3: Xử lý lựa chọn sau báo sự cố
  if (maintenanceState[userId]?.step === 'waiting_choice') {
    const { isUrgent } = maintenanceState[userId];
    delete maintenanceState[userId];

    if (action === 'contact_landlord' || /liên hệ|gọi|phone|sđt/i.test(action)) {
      return sendText(userId,
        `📞 Thông tin liên hệ chủ nhà:\n\n` +
        `👤 ${LANDLORD_NAME}\n` +
        `📱 ${LANDLORD_PHONE}\n` +
        `🕐 Giờ trực: ${LANDLORD_HOURS}\n\n` +
        `${isUrgent ? '🚨 Sự cố khẩn — gọi ngay nhé!' : 'Chủ nhà đã nhận thông báo, sẽ phản hồi sớm!'}`,
        profile
      );
    }

    if (action === 'wait_landlord' || /chờ|để|sau/i.test(action)) {
      return sendText(userId,
        '⏳ Đã ghi nhận!\n\n' +
        'Chủ nhà đã nhận thông báo và sẽ liên hệ bạn sớm nhất.\n\n' +
        'Nếu cần gấp, gọi:\n' +
        `📞 ${LANDLORD_PHONE} (${LANDLORD_HOURS})`,
        profile
      );
    }

    // Nhắn lung tung → nhắc lại
    maintenanceState[userId] = { step: 'waiting_choice', isUrgent };
    return sendWithButtons(userId,
      'Bạn muốn làm gì?',
      [
        { title: '📞 Liên hệ chủ nhà ngay', type: 'oa.query.hide', payload: 'contact_landlord' },
        { title: '⏳ Để chủ nhà xử lý sau',  type: 'oa.query.hide', payload: 'wait_landlord'   },
      ], profile
    );
  }

  // XEM HÓA ĐƠN – bước 2: đợi số phòng
  if (billState[userId]?.step === 'waiting_room') {
    delete billState[userId];
    const roomNumber = text;
    const now   = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();

    if (!roomNumber) {
      billState[userId] = { step: 'waiting_room' };
      return sendText(userId, '⚠️ Vui lòng nhắn số phòng của bạn (ví dụ: 101)', profile);
    }

    const bill = await RoomBill.findOne({ roomNumber, month, year });

    if (!bill) {
      return sendText(userId,
        `📋 Phòng ${roomNumber} — Tháng ${month}/${year}\n\n` +
        'Chưa có hóa đơn tháng này.\n' +
        `📞 Liên hệ chủ nhà: ${LANDLORD_PHONE}`,
        profile
      );
    }

    const fmt     = n => (+n || 0).toLocaleString('vi-VN');
    const eUsed   = Math.max(0, bill.electricEnd - bill.electricStart);
    const wUsed   = Math.max(0, bill.waterEnd    - bill.waterStart);
    const statusText = bill.status === 'paid' ? '✅ Đã thanh toán' : '⏳ Chưa thanh toán';

    return sendText(userId,
      `💰 HÓA ĐƠN THÁNG ${month}/${year}\n` +
      `🏠 Phòng ${bill.roomNumber}` + (bill.tenantName ? ` — ${bill.tenantName}` : '') + '\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      `🏠 Tiền phòng:     ${fmt(bill.rentAmount)}đ\n` +
      `⚡ Điện ${eUsed} kWh:  ${fmt(eUsed * (bill.electricPrice || 3500))}đ\n` +
      `💧 Nước ${wUsed} m³:   ${fmt(wUsed * (bill.waterPrice || 15000))}đ\n` +
      (bill.internetFee ? `📶 Internet:       ${fmt(bill.internetFee)}đ\n` : '') +
      (bill.parkingFee  ? `🛵 Gửi xe:         ${fmt(bill.parkingFee)}đ\n`  : '') +
      (bill.otherFee    ? `📌 ${bill.otherFeeNote || 'Khác'}:  ${fmt(bill.otherFee)}đ\n` : '') +
      '━━━━━━━━━━━━━━━━━━\n' +
      `💵 TỔNG: ${fmt(bill.totalAmount)}đ\n` +
      `📌 ${statusText}\n\n` +
      (bill.status === 'unpaid'
        ? `⏰ Vui lòng thanh toán trước ngày 5/${month + 1 > 12 ? 1 : month + 1}/${year}\n📞 Liên hệ: ${LANDLORD_PHONE}`
        : '🎉 Cảm ơn bạn đã thanh toán!'),
      profile
    );
  }

  // TÌM PHÒNG THEO GIÁ – bước 2: đợi nhập giá
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

  // ── MENU CHÍNH ────────────────────────────────────────────────────────────────

  if (action === '/start' || action === 'start' || action === 'Bắt đầu' || !action) {
    return sendWithMenu(userId, 'Xin chào! 👋 Tôi là trợ lý ảo Nhà trọ quận 3.\nChọn mục bạn cần:', profile);
  }

  if (action === '1') {
    const rooms = await Room.find().sort({ price: 1 });
    if (rooms.length === 0) return sendWithMenu(userId, 'Hiện chưa có phòng trọ nào.', profile);
    await sendText(userId, `📋 Danh sách ${rooms.length} phòng trọ:`, profile);
    for (const room of rooms) await sendRoomCard(userId, room, profile);
    return sendWithMenu(userId, 'Bạn cần hỗ trợ thêm gì không?', profile);
  }

  if (action === '2') {
    userState[userId] = 'waiting_price';
    return sendText(userId, '🔍 Nhập ngân sách tối đa (đơn vị đồng)\nVí dụ: 3000000 hoặc 3tr', profile);
  }

  if (action === '3') {
    return sendWithMenu(userId,
      `📞 Thông tin liên hệ\n\n👤 Chủ nhà: ${LANDLORD_NAME}\n📱 SĐT: ${LANDLORD_PHONE}\n🕐 Giờ làm việc: ${LANDLORD_HOURS}`,
      profile
    );
  }

  // BƯỚC 1: Kích hoạt báo sự cố
  if (action === '5' || /báo sự cố|sửa chữa|hỏng|bị hỏng|bị hư/i.test(action)) {
    maintenanceState[userId] = { step: 'waiting_form' };
    return sendText(userId,
      '🔧 Báo sự cố / Yêu cầu sửa chữa\n\n' +
      'Copy mẫu bên dưới, điền và gửi lại:\n\n' +
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

  // BƯỚC 1: Kích hoạt xem hóa đơn
  if (action === '6' || /xem hóa đơn|tiền phòng|hóa đơn|bill/i.test(action)) {
    billState[userId] = { step: 'waiting_room' };
    return sendText(userId,
      '💰 Xem hóa đơn tiền phòng\n\nBạn ở phòng số mấy?\n(Nhắn số phòng, ví dụ: 101)',
      profile
    );
  }

  // Không khớp → gọi Claude AI trả lời tự nhiên
  try {
    const aiReply = await askClaude(userId, profile.displayName, '', text);
    return sendText(userId, aiReply, profile);
  } catch (err) {
    console.error('Claude error:', err.message);
    return sendWithMenu(userId, 'Xin chào! 👋 Chọn một mục bên dưới để bắt đầu!', profile);
  }
}

// Gửi bill tiền phòng cho khách qua Zalo
async function sendBillToTenant(bill) {
  const fmt = n => (+n || 0).toLocaleString('vi-VN');
  const eUsed = Math.max(0, bill.electricEnd - bill.electricStart);
  const wUsed = Math.max(0, bill.waterEnd - bill.waterStart);

  const text =
    `💰 HÓA ĐƠN TIỀN PHÒNG\n` +
    `📅 Tháng ${bill.month}/${bill.year} — Phòng ${bill.roomNumber}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🏠 Tiền phòng:       ${fmt(bill.rentAmount)}đ\n` +
    `⚡ Điện (${eUsed} kWh × ${fmt(bill.electricPrice)}đ): ${fmt(eUsed * bill.electricPrice)}đ\n` +
    `💧 Nước (${wUsed} m³ × ${fmt(bill.waterPrice)}đ):  ${fmt(wUsed * bill.waterPrice)}đ\n` +
    (bill.internetFee ? `📶 Internet:         ${fmt(bill.internetFee)}đ\n` : '') +
    (bill.parkingFee  ? `🛵 Gửi xe:           ${fmt(bill.parkingFee)}đ\n`  : '') +
    (bill.otherFee    ? `📌 ${bill.otherFeeNote || 'Khác'}:  ${fmt(bill.otherFee)}đ\n` : '') +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💵 TỔNG:             ${fmt(bill.totalAmount)}đ\n\n` +
    `📞 Liên hệ chủ nhà: ${process.env.LANDLORD_PHONE || '0901 234 567'}\n` +
    `⏰ Hạn thanh toán: trước ngày 5 tháng ${bill.month + 1 > 12 ? 1 : bill.month + 1}`;

  await sendText(bill.tenantZaloId, text, {});
}

module.exports = { handleZaloMessage, sendBillToTenant };
