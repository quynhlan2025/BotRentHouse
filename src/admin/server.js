const express = require('express');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Room = require('../models/Room');
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
