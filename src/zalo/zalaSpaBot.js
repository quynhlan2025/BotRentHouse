const axios      = require('axios');
const Booking    = require('../models/Booking');
const ZaloConversation = require('../models/ZaloConversation');
const { askClaudeSpa } = require('../handlers/claudeSpaHandler');

const OA_TOKEN   = process.env.ZALO_SPA_OA_TOKEN;
const ZALO_API   = 'https://openapi.zalo.me/v2.0/oa';
const zaloHeaders = { access_token: OA_TOKEN };

const SPA_NAME    = process.env.SPA_NAME    || 'Beauty Spa';
const SPA_PHONE   = process.env.SPA_PHONE   || '0901 234 567';
const SPA_HOURS   = process.env.SPA_HOURS   || '09:30 – 22:00';
const SPA_ADDRESS = process.env.SPA_ADDRESS || 'TP.HCM';

// Danh sách dịch vụ và giá
const SERVICES = [
  { name: 'Massage thư giãn 60 phút',   price: 350000 },
  { name: 'Massage thư giãn 90 phút',   price: 480000 },
  { name: 'Chăm sóc da mặt (Facial)',   price: 420000 },
  { name: 'Tẩy da chết body',           price: 380000 },
  { name: 'Wax lông',                   price: 280000 },
  { name: 'Nail (tay + chân)',          price: 250000 },
  { name: 'Gội đầu dưỡng sinh',         price: 180000 },
];

// Gợi ý upsell theo dịch vụ đã chọn
const UPSELL_MAP = {
  0: { idx: 2, label: 'Chăm sóc da mặt', save: '20%' },  // Massage 60 → Facial
  1: { idx: 2, label: 'Chăm sóc da mặt', save: '20%' },  // Massage 90 → Facial
  2: { idx: 3, label: 'Tẩy da chết body', save: '15%' }, // Facial → Body
  3: { idx: 2, label: 'Chăm sóc da mặt', save: '15%' }, // Body → Facial
  4: { idx: 5, label: 'Nail (tay + chân)', save: '10%' },// Wax → Nail
  5: { idx: 6, label: 'Gội đầu dưỡng sinh', save: '20%' },// Nail → Gội đầu
  6: { idx: 0, label: 'Massage thư giãn 60 phút', save: '20%' }, // Gội đầu → Massage
};

const fmt = n => (+n || 0).toLocaleString('vi-VN');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendText(userId, text, profile) {
  await saveMessage(userId, profile || {}, 'bot', text);
  await axios.post(`${ZALO_API}/message`, {
    recipient: { user_id: userId },
    message:   { text },
  }, { headers: zaloHeaders }).catch(e => console.error('Spa sendText error:', e.response?.data || e.message));
}

async function sendWithButtons(userId, text, buttons, profile) {
  await saveMessage(userId, profile || {}, 'bot', text);
  await axios.post(`${ZALO_API}/message`, {
    recipient: { user_id: userId },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button_list',
          elements: [{ title: SPA_NAME, subtitle: text, buttons }],
        },
      },
    },
  }, { headers: zaloHeaders }).catch(e => console.error('Spa sendButtons error:', e.response?.data || e.message));
}

// Menu chính gồm 5 nút (có thêm Ưu đãi)
async function sendMenu(userId, text, profile) {
  await sendWithButtons(userId, text || 'Chọn mục bạn cần:', [
    { title: '📅 Đặt lịch hẹn',         type: 'oa.query.hide', payload: 'spa_book'      },
    { title: '🎁 Ưu đãi hôm nay',        type: 'oa.query.hide', payload: 'spa_promo'     },
    { title: '💆 Dịch vụ & bảng giá',   type: 'oa.query.hide', payload: 'spa_services'  },
    { title: '🗓 Lịch hẹn của tôi',      type: 'oa.query.hide', payload: 'spa_mybooking' },
    { title: '📞 Liên hệ & địa chỉ',     type: 'oa.query.hide', payload: 'spa_contact'   },
  ], profile);
}

async function saveMessage(userId, fromEvent, role, text) {
  try {
    const profile = { displayName: fromEvent.displayName || '', avatar: fromEvent.avatar || '', phone: fromEvent.phone || '' };
    await ZaloConversation.findOneAndUpdate(
      { zaloUserId: `spa_${userId}` },
      {
        $set: {
          ...(profile.displayName && { displayName: profile.displayName }),
          lastMessage: text,
          lastMessageAt: new Date(),
          source: 'spa',
        },
        $push: { messages: { role, text, createdAt: new Date() } },
        $inc:  { unread: role === 'user' ? 1 : 0 },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('Spa saveMessage error:', err.message);
  }
}

// Giờ còn trống trong ngày
async function getAvailableSlots(dateStr) {
  const booked = await Booking.find({ date: dateStr, status: { $ne: 'cancelled' } });
  const bookedTimes = booked.map(b => b.time);
  const slots = [];
  let h = 9, m = 30;
  while (h < 22 || (h === 22 && m === 0)) {
    const time = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    if (!bookedTimes.includes(time)) slots.push(time);
    m += 30; if (m >= 60) { m = 0; h++; }
  }
  return slots;
}

// Thông báo Telegram cho owner
async function notifySpaOwner(booking) {
  const chatId = process.env.SPA_TELEGRAM_ID || process.env.LANDLORD_TELEGRAM_ID;
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !token) return;
  const msg =
    `📅 LỊCH MỚI — ${SPA_NAME}\n\n` +
    `👤 ${booking.customerName} — ${booking.phone}\n` +
    `💆 ${booking.service}\n` +
    `📅 ${booking.date} lúc ${booking.time}\n` +
    `📝 ${booking.note || '—'}\n` +
    `🕐 ${new Date().toLocaleString('vi-VN')}\n\n` +
    `👉 ${process.env.APP_URL || 'http://localhost:3000'}/spa-admin`;
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId, text: msg,
  }).catch(() => {});
}

// Gửi upsell offer sau khi đặt lịch xong
async function sendUpsellOffer(userId, svcIdx, profile) {
  const upsell = UPSELL_MAP[svcIdx];
  if (!upsell) return;
  const uSvc = SERVICES[upsell.idx];
  const discountedPrice = Math.round(uSvc.price * 0.8);
  await sendWithButtons(userId,
    `🎁 ƯU ĐÃI CHO BẠN HÔM NAY!\n\n` +
    `Thêm "${uSvc.name}" cùng buổi\n` +
    `Giá gốc: ${fmt(uSvc.price)}đ → Chỉ còn ${fmt(discountedPrice)}đ\n` +
    `💰 Tiết kiệm ngay ${upsell.save}!\n\n` +
    `Bạn có muốn thêm dịch vụ này không?`,
    [
      { title: `✅ Thêm ${uSvc.name}`, type: 'oa.query.hide', payload: `upsell_yes_${upsell.idx}` },
      { title: '❌ Không, cảm ơn',      type: 'oa.query.hide', payload: 'upsell_no'               },
    ], profile
  );
}

// ── State machines ─────────────────────────────────────────────────────────────
const spaBookingState = {};   // { step, customerName, phone, service, svcIdx, date, slots, slotPage }
const spaCheckinState = {};   // { step }

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleSpaBotMessage(event) {
  const userId = event.sender?.id || event.follower?.id;
  const profile = {
    displayName: event.sender?.display_name || '',
    avatar:      event.sender?.avatar || '',
    phone:       event.sender?.phone  || '',
  };
  const text   = (event.message?.text || '').trim();
  const action = text;

  if (!userId) return;

  // ── Follow → chào mừng + gửi ưu đãi sau 1.5s ──────────────────────────────
  if (event.event_name === 'follow') {
    await sendMenu(userId,
      `Xin chào! 👋 Chào mừng bạn đến ${SPA_NAME}!\n` +
      `Tôi là trợ lý AI — có thể đặt lịch, tư vấn dịch vụ và gửi ưu đãi cho bạn 24/7.`,
      profile
    );
    // Gửi ưu đãi chào mừng sau 1.5 giây
    setTimeout(async () => {
      await sendWithButtons(userId,
        `🎁 QUÀ CHÀO MỪNG ĐẶC BIỆT!\n\n` +
        `Giảm ngay 15% dịch vụ đầu tiên khi đặt qua Zalo hôm nay!\n` +
        `Nhập code: WELCOME15 khi đặt lịch.\n\n` +
        `⏰ Ưu đãi có hiệu lực đến hết ngày hôm nay!`,
        [
          { title: '📅 Đặt lịch ngay',    type: 'oa.query.hide', payload: 'spa_book'  },
          { title: '💆 Xem dịch vụ',      type: 'oa.query.hide', payload: 'spa_services' },
        ], profile
      );
    }, 1500);
    return;
  }

  if (text) await saveMessage(userId, profile, 'user', text);

  // Admin takeover
  const conv = await ZaloConversation.findOne({ zaloUserId: `spa_${userId}` });
  if (conv?.takenOver) return;

  // ── UPSELL RESPONSE ──────────────────────────────────────────────────────────
  if (action.startsWith('upsell_yes_')) {
    const uIdx = parseInt(action.replace('upsell_yes_', ''));
    const uSvc = SERVICES[uIdx];
    if (!uSvc) return sendMenu(userId, 'Bạn cần hỗ trợ thêm gì?', profile);
    // Khởi tạo đặt lịch mới với dịch vụ upsell, giữ lại tên/SĐT từ lần trước
    const lastBooking = await Booking.findOne({ source: 'zalo' }).sort({ createdAt: -1 });
    spaBookingState[userId] = {
      step: 'waiting_date',
      customerName: lastBooking?.customerName || profile.displayName || '',
      phone:        lastBooking?.phone || '',
      service:      uSvc.name,
      svcIdx:       uIdx,
    };
    const todayStr = new Date().toISOString().split('T')[0];
    return sendText(userId,
      `✅ Tuyệt! Đặt thêm "${uSvc.name}"\n\nNhập ngày hẹn (YYYY-MM-DD):\nVí dụ: ${todayStr}`,
      profile
    );
  }

  if (action === 'upsell_no') {
    return sendMenu(userId, '😊 Cảm ơn bạn! Chúc bạn một buổi spa thật thư giãn 🌸', profile);
  }

  // ── TRẠNG THÁI ĐẶT LỊCH ──────────────────────────────────────────────────────

  if (spaBookingState[userId]?.step === 'waiting_name') {
    if (!text) return sendText(userId, '⚠️ Vui lòng nhập tên của bạn:', profile);
    spaBookingState[userId].customerName = text;
    spaBookingState[userId].step = 'waiting_phone';
    return sendText(userId, `✅ Xin chào ${text}!\n\nVui lòng nhập số điện thoại:`, profile);
  }

  if (spaBookingState[userId]?.step === 'waiting_phone') {
    if (!text || !/^[0-9]{9,11}$/.test(text.replace(/\s/g, ''))) {
      return sendText(userId, '⚠️ Số điện thoại không hợp lệ. Vui lòng nhập lại:', profile);
    }
    spaBookingState[userId].phone = text.replace(/\s/g, '');
    spaBookingState[userId].step = 'waiting_service';
    return sendWithButtons(userId,
      `💆 Chọn dịch vụ (1/2):`,
      [
        { title: `${SERVICES[0].name} — ${fmt(SERVICES[0].price)}đ`, type: 'oa.query.hide', payload: 'svc_0' },
        { title: `${SERVICES[1].name} — ${fmt(SERVICES[1].price)}đ`, type: 'oa.query.hide', payload: 'svc_1' },
        { title: `${SERVICES[2].name} — ${fmt(SERVICES[2].price)}đ`, type: 'oa.query.hide', payload: 'svc_2' },
        { title: `${SERVICES[3].name} — ${fmt(SERVICES[3].price)}đ`, type: 'oa.query.hide', payload: 'svc_3' },
        { title: '➡️ Xem thêm dịch vụ', type: 'oa.query.hide', payload: 'svc_more' },
      ], profile
    );
  }

  if (spaBookingState[userId]?.step === 'waiting_service') {
    if (action === 'svc_more') {
      return sendWithButtons(userId, '💆 Chọn dịch vụ (2/2):', [
        { title: `${SERVICES[4].name} — ${fmt(SERVICES[4].price)}đ`, type: 'oa.query.hide', payload: 'svc_4' },
        { title: `${SERVICES[5].name} — ${fmt(SERVICES[5].price)}đ`, type: 'oa.query.hide', payload: 'svc_5' },
        { title: `${SERVICES[6].name} — ${fmt(SERVICES[6].price)}đ`, type: 'oa.query.hide', payload: 'svc_6' },
        { title: '⬅️ Quay lại', type: 'oa.query.hide', payload: 'svc_back' },
      ], profile);
    }
    if (action === 'svc_back') {
      return sendWithButtons(userId, '💆 Chọn dịch vụ (1/2):', [
        { title: `${SERVICES[0].name} — ${fmt(SERVICES[0].price)}đ`, type: 'oa.query.hide', payload: 'svc_0' },
        { title: `${SERVICES[1].name} — ${fmt(SERVICES[1].price)}đ`, type: 'oa.query.hide', payload: 'svc_1' },
        { title: `${SERVICES[2].name} — ${fmt(SERVICES[2].price)}đ`, type: 'oa.query.hide', payload: 'svc_2' },
        { title: `${SERVICES[3].name} — ${fmt(SERVICES[3].price)}đ`, type: 'oa.query.hide', payload: 'svc_3' },
        { title: '➡️ Xem thêm dịch vụ', type: 'oa.query.hide', payload: 'svc_more' },
      ], profile);
    }
    const svcMatch = action.match(/^svc_(\d+)$/);
    if (!svcMatch || !SERVICES[+svcMatch[1]]) {
      return sendText(userId, '⚠️ Vui lòng chọn dịch vụ bằng nút bên trên.', profile);
    }
    const svcIdx = +svcMatch[1];
    const svc    = SERVICES[svcIdx];
    spaBookingState[userId].service = svc.name;
    spaBookingState[userId].svcIdx  = svcIdx;
    spaBookingState[userId].step    = 'waiting_date';

    // Gợi ý combo TRƯỚC khi chọn ngày (upsell sớm)
    const upsell = UPSELL_MAP[svcIdx];
    const todayStr = new Date().toISOString().split('T')[0];
    if (upsell) {
      const uSvc = SERVICES[upsell.idx];
      const comboPrice = svc.price + Math.round(uSvc.price * 0.8);
      await sendWithButtons(userId,
        `✅ Đã chọn: ${svc.name} — ${fmt(svc.price)}đ\n\n` +
        `💡 GỢI Ý COMBO tiết kiệm hơn:\n` +
        `"${svc.name}" + "${uSvc.name}"\n` +
        `Giá combo chỉ: ${fmt(comboPrice)}đ (tiết kiệm ${upsell.save})\n\n` +
        `Bạn muốn đặt combo hay dịch vụ đơn?`,
        [
          { title: `✨ Đặt combo (tiết kiệm ${upsell.save})`, type: 'oa.query.hide', payload: `combo_${svcIdx}_${upsell.idx}` },
          { title: `▶️ Tiếp tục với ${svc.name}`,              type: 'oa.query.hide', payload: `solo_${svcIdx}`              },
        ], profile
      );
      spaBookingState[userId].step = 'waiting_combo_choice';
      return;
    }

    return sendText(userId,
      `✅ Dịch vụ: ${svc.name}\n\nNhập ngày hẹn (YYYY-MM-DD):\nVí dụ: ${todayStr}`,
      profile
    );
  }

  // Xử lý chọn combo hay đơn
  if (spaBookingState[userId]?.step === 'waiting_combo_choice') {
    const todayStr = new Date().toISOString().split('T')[0];
    if (action.startsWith('combo_')) {
      const parts     = action.split('_');
      const mainIdx   = +parts[1];
      const addonIdx  = +parts[2];
      const mainSvc   = SERVICES[mainIdx];
      const addonSvc  = SERVICES[addonIdx];
      spaBookingState[userId].service = `${mainSvc.name} + ${addonSvc.name} (Combo)`;
      spaBookingState[userId].step    = 'waiting_date';
      return sendText(userId,
        `🎉 Tuyệt vời! Đã chọn COMBO:\n✅ ${mainSvc.name}\n✅ ${addonSvc.name}\n\nNhập ngày hẹn (YYYY-MM-DD):\nVí dụ: ${todayStr}`,
        profile
      );
    }
    if (action.startsWith('solo_')) {
      const svcIdx = +action.replace('solo_', '');
      spaBookingState[userId].service = SERVICES[svcIdx].name;
      spaBookingState[userId].step    = 'waiting_date';
      return sendText(userId,
        `✅ Dịch vụ: ${SERVICES[svcIdx].name}\n\nNhập ngày hẹn (YYYY-MM-DD):\nVí dụ: ${todayStr}`,
        profile
      );
    }
    return; // chờ user bấm nút
  }

  if (spaBookingState[userId]?.step === 'waiting_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return sendText(userId, '⚠️ Định dạng ngày không đúng. Nhập theo dạng YYYY-MM-DD\nVí dụ: 2025-05-20', profile);
    }
    const slots = await getAvailableSlots(text);
    if (slots.length === 0) {
      return sendText(userId, `😔 Ngày ${text} đã đầy lịch.\nVui lòng chọn ngày khác:`, profile);
    }
    spaBookingState[userId].date     = text;
    spaBookingState[userId].slots    = slots;
    spaBookingState[userId].slotPage = 0;
    spaBookingState[userId].step     = 'waiting_time';
    const first5 = slots.slice(0, 5);
    const btns   = first5.map(t => ({ title: `🕐 ${t}`, type: 'oa.query.hide', payload: `time_${t}` }));
    if (slots.length > 5) btns.push({ title: '➡️ Xem thêm giờ', type: 'oa.query.hide', payload: 'time_more' });
    return sendWithButtons(userId, `📅 Ngày ${text} — Chọn giờ hẹn:`, btns, profile);
  }

  if (spaBookingState[userId]?.step === 'waiting_time') {
    if (action === 'time_more' || action === 'time_back') {
      const { slots, slotPage = 0 } = spaBookingState[userId];
      const newPage = action === 'time_more' ? slotPage + 1 : slotPage - 1;
      spaBookingState[userId].slotPage = newPage;
      const page5 = slots.slice(newPage * 5, newPage * 5 + 5);
      const btns  = page5.map(t => ({ title: `🕐 ${t}`, type: 'oa.query.hide', payload: `time_${t}` }));
      if ((newPage + 1) * 5 < slots.length) btns.push({ title: '➡️ Xem thêm giờ', type: 'oa.query.hide', payload: 'time_more' });
      if (newPage > 0) btns.unshift({ title: '⬅️ Giờ trước', type: 'oa.query.hide', payload: 'time_back' });
      return sendWithButtons(userId, `📅 ${spaBookingState[userId].date} — Chọn giờ hẹn:`, btns, profile);
    }
    const timeMatch = action.match(/^time_(\d{2}:\d{2})$/);
    if (!timeMatch) return sendText(userId, '⚠️ Vui lòng chọn giờ bằng nút bên trên.', profile);

    const time = timeMatch[1];
    const { customerName, phone, service, svcIdx, date } = spaBookingState[userId];
    delete spaBookingState[userId];

    const conflict = await Booking.findOne({ date, time, status: { $ne: 'cancelled' } });
    if (conflict) {
      spaBookingState[userId] = { step: 'waiting_date', customerName, phone, service, svcIdx };
      return sendText(userId, `😔 Giờ ${time} vừa có người đặt. Vui lòng chọn ngày/giờ khác:`, profile);
    }

    const booking = await Booking.create({ customerName, phone, service, date, time, source: 'zalo' });
    await notifySpaOwner(booking);

    // Xác nhận đặt lịch thành công
    await sendWithButtons(userId,
      `🎉 ĐẶT LỊCH THÀNH CÔNG!\n\n` +
      `👤 ${customerName} — ${phone}\n` +
      `💆 ${service}\n` +
      `📅 ${date} lúc ${time}\n\n` +
      `📍 ${SPA_ADDRESS}\n` +
      `⏰ Chúng tôi sẽ nhắc lịch trước 1 tiếng 🌸`,
      [
        { title: '📅 Đặt lịch khác',    type: 'oa.query.hide', payload: 'spa_book'      },
        { title: '🗓 Xem lịch của tôi', type: 'oa.query.hide', payload: 'spa_mybooking' },
      ], profile
    );

    // Gửi upsell offer sau 2 giây (nếu có dịch vụ gợi ý)
    if (svcIdx !== undefined && UPSELL_MAP[svcIdx]) {
      setTimeout(() => sendUpsellOffer(userId, svcIdx, profile), 2000);
    }
    return;
  }

  // ── MENU ACTIONS ─────────────────────────────────────────────────────────────

  if (action === '/start' || action === 'start' || action === 'Bắt đầu' || !action) {
    return sendMenu(userId, `Xin chào! 👋 Tôi là trợ lý AI của ${SPA_NAME}. Tôi có thể giúp gì cho bạn?`, profile);
  }

  // Đặt lịch
  if (action === 'spa_book' || /đặt lịch|book|hẹn|đặt hẹn/i.test(action)) {
    spaBookingState[userId] = { step: 'waiting_name' };
    return sendText(userId, `📅 Đặt lịch tại ${SPA_NAME}\n\nVui lòng nhập tên của bạn:`, profile);
  }

  // Ưu đãi hôm nay
  if (action === 'spa_promo' || /ưu đãi|khuyến mãi|giảm giá|deal|promo/i.test(action)) {
    const promoText = process.env.SPA_PROMO || `Giảm 20% tất cả dịch vụ khi đặt qua Zalo`;
    return sendWithButtons(userId,
      `🎁 ƯU ĐÃI THÁNG NÀY\n\n` +
      `🔥 ${promoText}\n\n` +
      `✨ Combo Massage + Facial: Tiết kiệm 20%\n` +
      `💅 Nail + Gội đầu: Tiết kiệm 15%\n` +
      `🌟 Khách quay lại lần 2: Tặng thêm 1 dịch vụ nhỏ\n\n` +
      `⏰ Ưu đãi áp dụng khi đặt qua Zalo này!`,
      [
        { title: '📅 Đặt lịch ngay',    type: 'oa.query.hide', payload: 'spa_book'     },
        { title: '💆 Xem tất cả dịch vụ', type: 'oa.query.hide', payload: 'spa_services' },
      ], profile
    );
  }

  // Xem dịch vụ
  if (action === 'spa_services' || /dịch vụ|bảng giá|giá|service/i.test(action)) {
    const list = SERVICES.map((s, i) => `${['💆','💆','✨','🌸','🌿','💅','🌊'][i]} ${s.name} — ${fmt(s.price)}đ`).join('\n');
    return sendWithButtons(userId,
      `💆 DỊCH VỤ & BẢNG GIÁ\n━━━━━━━━━━━━━━━\n${list}\n━━━━━━━━━━━━━━━\n📞 ${SPA_PHONE}`,
      [
        { title: '📅 Đặt lịch ngay',   type: 'oa.query.hide', payload: 'spa_book'  },
        { title: '🎁 Xem ưu đãi',      type: 'oa.query.hide', payload: 'spa_promo' },
      ], profile
    );
  }

  // Xem lịch hẹn
  if (action === 'spa_mybooking' || /lịch của tôi|lịch hẹn|kiểm tra|xem lịch/i.test(action)) {
    spaCheckinState[userId] = { step: 'waiting_phone' };
    return sendText(userId, '🗓 Xem lịch hẹn\n\nNhập số điện thoại đã đặt lịch:', profile);
  }

  // Liên hệ
  if (action === 'spa_contact' || /liên hệ|địa chỉ|ở đâu|contact/i.test(action)) {
    return sendMenu(userId,
      `📞 THÔNG TIN LIÊN HỆ\n\n🏪 ${SPA_NAME}\n📍 ${SPA_ADDRESS}\n📞 ${SPA_PHONE}\n🕐 ${SPA_HOURS} (hàng ngày)`,
      profile
    );
  }

  // Xem lịch – nhập SĐT
  if (spaCheckinState[userId]?.step === 'waiting_phone') {
    delete spaCheckinState[userId];
    const phone = text.replace(/\s/g, '');
    if (!/^[0-9]{9,11}$/.test(phone)) {
      return sendText(userId, '⚠️ Số điện thoại không hợp lệ. Thử lại nhé!', profile);
    }
    const now      = new Date();
    const upcoming = await Booking.find({
      phone,
      status: { $in: ['pending', 'confirmed'] },
      date:   { $gte: now.toISOString().split('T')[0] },
    }).sort({ date: 1, time: 1 }).limit(5);

    if (upcoming.length === 0) {
      return sendWithButtons(userId,
        `😔 Không tìm thấy lịch hẹn cho SĐT ${phone}.\n\nBạn có muốn đặt lịch mới không?`,
        [{ title: '📅 Đặt lịch ngay', type: 'oa.query.hide', payload: 'spa_book' }],
        profile
      );
    }

    const statusLabel = { pending: '⏳ Chờ xác nhận', confirmed: '✅ Đã xác nhận' };
    const lines = upcoming.map((b, i) =>
      `${i + 1}. ${b.date} ${b.time}\n   💆 ${b.service}\n   ${statusLabel[b.status] || b.status}`
    ).join('\n\n');

    return sendWithButtons(userId,
      `🗓 Lịch hẹn của bạn:\n\n${lines}\n\n📞 Để thay đổi: ${SPA_PHONE}`,
      [
        { title: '📅 Đặt thêm lịch', type: 'oa.query.hide', payload: 'spa_book'  },
        { title: '🎁 Xem ưu đãi',    type: 'oa.query.hide', payload: 'spa_promo' },
      ], profile
    );
  }

  // Không khớp → Claude AI chốt sale
  try {
    const aiReply = await askClaudeSpa(userId, profile.displayName, text);
    return sendText(userId, aiReply, profile);
  } catch (err) {
    console.error('Spa Claude error:', err.message);
    return sendMenu(userId, `Xin chào! 👋 Chọn mục bên dưới để bắt đầu!`, profile);
  }
}

// Broadcast ưu đãi đến tất cả khách (gọi từ admin)
async function broadcastPromo(message) {
  const conversations = await ZaloConversation.find({ source: 'spa' });
  let sent = 0;
  for (const conv of conversations) {
    const userId = conv.zaloUserId.replace('spa_', '');
    await sendWithButtons(userId, message, [
      { title: '📅 Đặt lịch ngay', type: 'oa.query.hide', payload: 'spa_book'  },
      { title: '🎁 Xem thêm',      type: 'oa.query.hide', payload: 'spa_promo' },
    ], {}).catch(() => {});
    sent++;
    await new Promise(r => setTimeout(r, 300)); // tránh rate limit
  }
  return sent;
}

module.exports = { handleSpaBotMessage, broadcastPromo };
