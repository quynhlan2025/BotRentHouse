const Room = require('../models/Room');

const furnitureLabel = { none: 'Không nội thất', basic: 'Nội thất cơ bản', full: 'Đầy đủ nội thất' };
const statusLabel = { available: '✅ Còn trống', rented: '❌ Đã có người thuê' };

function formatRoom(room) {
  return (
    `🏠 Phòng ${room.roomNumber}\n` +
    `💰 ${room.price.toLocaleString('vi-VN')}đ/tháng\n` +
    `📍 ${room.address}, ${room.district}\n` +
    `📐 ${room.area}m² | ${furnitureLabel[room.furniture]}\n` +
    `${statusLabel[room.status]}\n` +
    (room.description ? `📝 ${room.description}\n` : '') +
    `📞 ${room.contact}`
  );
}

async function getAllRooms() {
  const rooms = await Room.find().sort({ price: 1 });
  if (rooms.length === 0) return 'Hiện chưa có phòng trọ nào.';
  return rooms.map(formatRoom).join('\n\n───────────\n\n');
}

async function getRoomsSummary() {
  const rooms = await Room.find().sort({ price: 1 });
  if (rooms.length === 0) return 'Chưa có dữ liệu phòng trọ.';
  return rooms.map(r =>
    `- Phòng ${r.roomNumber}: ${r.price.toLocaleString('vi-VN')}đ/tháng | ${r.district} | ${r.area}m² | ${statusLabel[r.status]}`
  ).join('\n');
}

async function searchRooms(maxPrice) {
  const rooms = await Room.find({ price: { $lte: maxPrice } }).sort({ price: 1 });
  if (rooms.length === 0) return `Không tìm thấy phòng nào dưới ${maxPrice.toLocaleString('vi-VN')}đ.`;
  return rooms.map(formatRoom).join('\n\n───────────\n\n');
}

module.exports = { getAllRooms, getRoomsSummary, searchRooms };
