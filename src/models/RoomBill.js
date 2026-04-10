const mongoose = require('mongoose');

const roomBillSchema = new mongoose.Schema({
  roomNumber:      { type: String, required: true },
  tenantName:      { type: String, default: '' },
  tenantZaloId:    { type: String, default: '' },
  tenantPhone:     { type: String, default: '' },
  month:           { type: Number, required: true }, // 1-12
  year:            { type: Number, required: true },

  // Tiền phòng
  rentAmount:      { type: Number, default: 0 },

  // Điện
  electricStart:   { type: Number, default: 0 },
  electricEnd:     { type: Number, default: 0 },
  electricPrice:   { type: Number, default: 3500 }, // đ/kWh

  // Nước
  waterStart:      { type: Number, default: 0 },
  waterEnd:        { type: Number, default: 0 },
  waterPrice:      { type: Number, default: 15000 }, // đ/m³

  // Phí khác
  internetFee:     { type: Number, default: 0 },
  parkingFee:      { type: Number, default: 0 },
  otherFee:        { type: Number, default: 0 },
  otherFeeNote:    { type: String, default: '' },

  totalAmount:     { type: Number, default: 0 },
  status:          { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
  sentAt:          { type: Date },
  createdAt:       { type: Date, default: Date.now },
});

module.exports = mongoose.model('RoomBill', roomBillSchema);
