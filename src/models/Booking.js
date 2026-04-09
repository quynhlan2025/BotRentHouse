const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  phone:        { type: String, required: true },
  service:      { type: String, required: true },
  date:         { type: String, required: true }, // YYYY-MM-DD
  time:         { type: String, required: true }, // HH:MM
  note:         { type: String, default: '' },
  status:       { type: String, enum: ['pending', 'confirmed', 'done', 'cancelled'], default: 'pending' },
  source:       { type: String, enum: ['admin', 'zalo', 'telegram'], default: 'admin' },
  createdAt:    { type: Date, default: Date.now },
});

module.exports = mongoose.model('Booking', bookingSchema);
