const axios = require('axios');
const Room = require('../models/Room');

const OA_TOKEN = process.env.ZALO_OA_TOKEN;
const ZALO_API = 'https://openapi.zalo.me/v2.0/oa';

// Gửi tin nhắn text
async function sendText(userId, text) {
  await axios.post(`${ZALO_API}/message`, {
    recipient: { user_id: userId },
    message: { text },
  }, {
    headers: { access_token: OA_TOKEN },
  });
}

// Gửi tin nhắn kèm 4 nút menu
async function sendWithMenu(userId, text) {
  await axios.post(`${ZALO_API}/message`, {
    recipient: { user_id: userId },
    message: {
      text,
      attachment: {
        type: 'template',
        payload: {
          buttons: [
            { title: '📋 Danh sách phòng', payload: 'menu_danhsach', type: 'oa.query.show' },
            { title: '🔍 Tìm theo giá',    payload: 'menu_timgia',   type: 'oa.query.show' },
            { title: '📞 Liên hệ',          payload: 'menu_lienhe',   type: 'oa.query.show' },
            { title: '🏠 Giới thiệu',       payload: 'menu_gioithieu',type: 'oa.query.show' },
          ],
        },
      },
    },
  }, {
    headers: { access_token: OA_TOKEN },
  });
}

// Gửi card phòng kèm ảnh
async function sendRoomCard(userId, room) {
  const furniture = { none: 'Không nội thất', basic: 'Nội thất cơ bản', full: 'Đầy đủ nội thất' };
  const status = { available: '✅ Còn trống', rented: '❌ Đã có người thuê' };

  const elements = [{
    title: `🏠 Phòng ${room.roomNumber} - ${room.price.toLocaleString('vi-VN')}đ/tháng`,
    subtitle: `📍 ${room.address}, ${room.district}\n📐 ${room.area}m² | ${furniture[room.furniture]}\n${status[room.status]}`,
    image_url: room.images && room.images.length > 0 ? room.images[0] : '',
    default_action: { type: 'oa.open.url', url: '' },
  }];

  await axios.post(`${ZALO_API}/message`, {
    recipient: { user_id: userId },
    message: {
      attachment: {
        type: 'template',
        payload: { template_type: 'list', elements },
      },
    },
  }, {
    headers: { access_token: OA_TOKEN },
  }).catch(() => {
    // Fallback text nếu gửi ảnh lỗi
    sendText(userId,
      `🏠 Phòng ${room.roomNumber}\n💰 ${room.price.toLocaleString('vi-VN')}đ/tháng\n📍 ${room.address}, ${room.district}\n📐 ${room.area}m² | ${furniture[room.furniture]}\n${status[room.status]}\n📞 ${room.contact}`
    );
  });
}

// Lưu trạng thái user
const userState = {};

// Xử lý tin nhắn từ Zalo webhook
async function handleZaloMessage(event) {
  const userId = event.sender.id;
  const text = event.message?.text || event.message?.msg || '';

  // Xử lý menu buttons
  const payload = event.message?.msg || text;

  if (payload === 'menu_danhsach' || text === 'Danh sách phòng' || text === '/danhsach') {
    const rooms = await Room.find().sort({ price: 1 });
    if (rooms.length === 0) return sendWithMenu(userId, 'Hiện chưa có phòng trọ nào.');
    await sendText(userId, `📋 Danh sách ${rooms.length} phòng trọ:`);
    for (const room of rooms) await sendRoomCard(userId, room);
    await sendWithMenu(userId, 'Bạn cần hỗ trợ thêm gì không?');
    return;
  }

  if (payload === 'menu_timgia' || text === 'Tìm theo giá') {
    userState[userId] = 'waiting_price';
    await sendText(userId, '🔍 Nhập ngân sách tối đa của bạn (đơn vị đồng)\nVí dụ: 3000000 hoặc 3tr');
    return;
  }

  if (payload === 'menu_lienhe' || text === 'Liên hệ') {
    await sendWithMenu(userId,
      '📞 Thông tin liên hệ\n\n👤 Chủ nhà: Nguyễn Văn A\n📱 SĐT: 0901 234 567\n🕐 Giờ làm việc: 8:00 - 20:00'
    );
    return;
  }

  if (payload === 'menu_gioithieu' || text === 'Giới thiệu') {
    const total = await Room.countDocuments();
    const available = await Room.countDocuments({ status: 'available' });
    await sendWithMenu(userId,
      `🏠 Giới thiệu\n\nChúng tôi cho thuê phòng trọ chất lượng tại TP.HCM.\n\n📊 Tổng phòng: ${total}\n✅ Còn trống: ${available}\n\nLiên hệ ngay để được tư vấn miễn phí!`
    );
    return;
  }

  // Đang chờ nhập giá
  if (userState[userId] === 'waiting_price') {
    delete userState[userId];
    const normalized = text.replace(/tr$/i, '000000').replace(/[.,\s]/g, '');
    const maxPrice = parseInt(normalized);

    if (isNaN(maxPrice) || maxPrice <= 0) {
      return sendWithMenu(userId, '❌ Giá không hợp lệ. Vui lòng nhập lại, ví dụ: 3000000');
    }

    const rooms = await Room.find({ price: { $lte: maxPrice } }).sort({ price: 1 });
    if (rooms.length === 0) {
      return sendWithMenu(userId, `😔 Không có phòng nào dưới ${maxPrice.toLocaleString('vi-VN')}đ.`);
    }

    await sendText(userId, `🔍 Tìm thấy ${rooms.length} phòng dưới ${maxPrice.toLocaleString('vi-VN')}đ:`);
    for (const room of rooms) await sendRoomCard(userId, room);
    await sendWithMenu(userId, 'Bạn cần hỗ trợ thêm gì không?');
    return;
  }

  // Tin nhắn thường
  await sendWithMenu(userId,
    `Xin chào! 👋 Tôi là Bot Thuê Nhà.\nChọn một trong các mục bên dưới để bắt đầu!`
  );
}

module.exports = { handleZaloMessage };
