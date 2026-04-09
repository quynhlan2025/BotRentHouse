const express = require('express');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const ZaloConversation = require('../models/ZaloConversation');
const { handleZaloMessage } = require('../zalo/zaloBot');

const app = express();
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

// Cấu hình Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload thẳng lên Cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'renthouse',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Zalo webhook
app.get('/zalo/webhook', (req, res) => {
  res.json({ error: 0, data: req.query });
});

app.post('/zalo/webhook', async (req, res) => {
  res.json({ ok: true });
  const event = req.body;
  console.log('Zalo event:', JSON.stringify(event));
  if (event.message || event.callback_query) {
    handleZaloMessage(event).catch(err => console.error('Zalo error:', err.message));
  }
});

// Landing page
app.get('/', (req, res) => res.render('landing'));

// Spa landing page
app.get('/spa', (req, res) => res.render('spa-landing'));

// Bots comparison landing page
app.get('/bots', (req, res) => res.render('bots-landing'));

// SaaS provider landing page
app.get('/mia', (req, res) => res.render('saas-landing'));

// ── ZALO INBOX ───────────────────────────────────────────────────────────────
app.get('/zalo-inbox', async (req, res) => {
  const conversations = await ZaloConversation.find().sort({ lastMessageAt: -1 });
  let selectedUser = null;
  if (req.query.user) {
    selectedUser = await ZaloConversation.findOne({ zaloUserId: req.query.user });
  }
  res.render('zalo-inbox', { conversations, selectedUser });
});

app.post('/zalo-inbox/send', async (req, res) => {
  const { userId, text } = req.body;
  if (!userId || !text) return res.json({ ok: false });
  try {
    const axios = require('axios');
    const BOT_TOKEN = process.env.ZALO_OA_TOKEN;
    await axios.post(`https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: userId, text,
    });
    await ZaloConversation.findOneAndUpdate(
      { zaloUserId: userId },
      { $push: { messages: { role: 'bot', text, createdAt: new Date() } }, $set: { lastMessage: text, lastMessageAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post('/zalo-inbox/read', async (req, res) => {
  const { userId } = req.body;
  await ZaloConversation.findOneAndUpdate({ zaloUserId: userId }, { $set: { unread: 0 } });
  res.json({ ok: true });
});

app.post('/zalo-inbox/takeover', async (req, res) => {
  const { userId, takenOver } = req.body;
  await ZaloConversation.findOneAndUpdate({ zaloUserId: userId }, { $set: { takenOver } });
  res.json({ ok: true });
});

// ── SPA ADMIN ─────────────────────────────────────────────────────────────────

// Tạo các khung giờ trong ngày (09:30 – 22:00, bước 30 phút)
function buildSlots(bookingsToday) {
  const slots = [];
  const bookedTimes = bookingsToday
    .filter(b => b.status !== 'cancelled')
    .map(b => b.time);
  let h = 9, m = 30;
  while (h < 22 || (h === 22 && m === 0)) {
    const time = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    slots.push({ time, booked: bookedTimes.includes(time) });
    m += 30;
    if (m >= 60) { m = 0; h++; }
  }
  return slots;
}

app.get('/spa-admin', async (req, res) => {
  const { date: filterDate = '', status: filterStatus = '' } = req.query;
  const query = {};
  if (filterDate)   query.date   = filterDate;
  if (filterStatus) query.status = filterStatus;

  const [bookings, total, pending, confirmed, done] = await Promise.all([
    Booking.find(query).sort({ date: 1, time: 1 }),
    Booking.countDocuments(),
    Booking.countDocuments({ status: 'pending' }),
    Booking.countDocuments({ status: 'confirmed' }),
    Booking.countDocuments({ status: 'done' }),
  ]);

  const todayStr = new Date().toISOString().split('T')[0];
  const bookingsToday = await Booking.find({ date: todayStr });
  const slots = buildSlots(bookingsToday);

  const message = req.query.msg
    ? { type: req.query.type || 'success', text: req.query.msg }
    : null;

  res.render('spa-admin', {
    bookings, stats: { total, pending, confirmed, done },
    slots, todayStr, filterDate, filterStatus, message,
  });
});

app.post('/spa-admin/bookings', async (req, res) => {
  try {
    const { customerName, phone, service, date, time, note } = req.body;
    // Validate giờ mở cửa
    const [h, m] = time.split(':').map(Number);
    const minutes = h * 60 + m;
    if (minutes < 9 * 60 + 30 || minutes > 22 * 60) {
      return res.redirect('/spa-admin?msg=Giờ hẹn ngoài giờ mở cửa (09:30–22:00)&type=error');
    }
    await Booking.create({ customerName, phone, service, date, time, note, source: 'admin' });
    res.redirect('/spa-admin?msg=Đặt lịch thành công!&type=success');
  } catch (err) {
    res.redirect(`/spa-admin?msg=${encodeURIComponent('Lỗi: ' + err.message)}&type=error`);
  }
});

app.post('/spa-admin/bookings/:id/status', async (req, res) => {
  await Booking.findByIdAndUpdate(req.params.id, { status: req.body.status });
  const label = { confirmed: 'Đã xác nhận', done: 'Hoàn thành', cancelled: 'Đã hủy' }[req.body.status];
  res.redirect(`/spa-admin?msg=${encodeURIComponent(label + '!')}&type=success`);
});

app.post('/spa-admin/bookings/:id/delete', async (req, res) => {
  await Booking.findByIdAndDelete(req.params.id);
  res.redirect('/spa-admin?msg=Đã xóa lịch hẹn!&type=success');
});

// Trang chi tiết phòng (public)
app.get('/rooms/:id', async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).send('Không tìm thấy phòng');
    res.render('room-detail', { room });
  } catch {
    res.status(404).send('Không tìm thấy phòng');
  }
});

// Trang chính
app.get('/admin', async (req, res) => {
  const rooms = await Room.find().sort({ roomNumber: 1 });
  const message = req.query.msg
    ? { type: req.query.type || 'success', text: req.query.msg }
    : null;
  res.render('index', { rooms, message });
});

// Thêm phòng mới
app.post('/admin/rooms', (req, res) => {
  upload.array('images', 5)(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.redirect(`/admin?msg=${encodeURIComponent('Lỗi upload ảnh: ' + err.message)}&type=error`);
    }
    try {
      const { roomNumber, price, address, district, area, furniture, status, contact, description } = req.body;
      const images = req.files ? req.files.map(f => f.path) : [];
      await Room.create({ roomNumber, price, address, district, area, furniture, status, contact, description, images });
      res.redirect('/admin?msg=Thêm phòng thành công!&type=success');
    } catch (err) {
      console.error('DB error:', err);
      const msg = err.code === 11000 ? 'Số phòng đã tồn tại!' : 'Lỗi khi thêm phòng: ' + err.message;
      res.redirect(`/admin?msg=${encodeURIComponent(msg)}&type=error`);
    }
  });
});

// Đổi trạng thái phòng
app.post('/admin/rooms/:id/toggle', async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (room) {
    room.status = room.status === 'available' ? 'rented' : 'available';
    await room.save();
  }
  res.redirect('/admin?msg=Đã cập nhật trạng thái!&type=success');
});

// Xóa phòng
app.post('/admin/rooms/:id/delete', async (req, res) => {
  await Room.findByIdAndDelete(req.params.id);
  res.redirect('/admin?msg=Đã xóa phòng!&type=success');
});

module.exports = app;
