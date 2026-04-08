// Chạy script này 1 lần để thêm dữ liệu mẫu vào MongoDB
// node src/scripts/seedData.js

require('dotenv').config();
const mongoose = require('mongoose');
const Room = require('../models/Room');

const sampleRooms = [
  {
    roomNumber: '01',
    price: 2500000,
    address: '123 Nguyễn Trãi',
    district: 'Quận 1, TP.HCM',
    area: 20,
    furniture: 'basic',
    status: 'available',
    description: 'Phòng thoáng mát, gần trung tâm',
    contact: '0901 234 567',
  },
  {
    roomNumber: '02',
    price: 3000000,
    address: '456 Lê Văn Sỹ',
    district: 'Quận 3, TP.HCM',
    area: 25,
    furniture: 'full',
    status: 'available',
    description: 'Đầy đủ nội thất, có ban công',
    contact: '0901 234 567',
  },
  {
    roomNumber: '03',
    price: 4500000,
    address: '789 Đinh Bộ Lĩnh',
    district: 'Bình Thạnh, TP.HCM',
    area: 35,
    furniture: 'full',
    status: 'rented',
    description: 'Phòng cao cấp, view đẹp',
    contact: '0901 234 567',
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Đã kết nối MongoDB');

  await Room.deleteMany({});
  await Room.insertMany(sampleRooms);
  console.log(`Đã thêm ${sampleRooms.length} phòng trọ mẫu`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
