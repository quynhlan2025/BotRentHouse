const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomNumber: { type: String, required: true, unique: true },
  price: { type: Number, required: true },
  address: { type: String, required: true },
  district: { type: String, required: true },
  area: { type: Number }, // m2
  furniture: { type: String, enum: ['none', 'basic', 'full'], default: 'basic' },
  status: { type: String, enum: ['available', 'rented'], default: 'available' },
  description: { type: String },
  images: [{ type: String }],
  contact: { type: String, default: '0901 234 567' },
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);
