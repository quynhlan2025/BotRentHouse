const mongoose = require('mongoose');

const maintenanceSchema = new mongoose.Schema({
  zaloUserId:  { type: String, required: true },
  displayName: { type: String, default: 'Khách hàng' },
  phone:       { type: String, default: '' },
  roomNumber:  { type: String, default: '' },
  description: { type: String, required: true },
  status:      { type: String, enum: ['pending', 'processing', 'done'], default: 'pending' },
  note:        { type: String, default: '' }, // ghi chú của chủ nhà
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },
});

module.exports = mongoose.model('MaintenanceRequest', maintenanceSchema);
