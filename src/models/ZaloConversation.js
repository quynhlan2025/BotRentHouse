const mongoose = require('mongoose');

const zaloConversationSchema = new mongoose.Schema({
  zaloUserId: { type: String, required: true, unique: true },
  displayName: { type: String, default: 'Khách hàng' },
  avatar:      { type: String, default: '' },
  phone:       { type: String, default: '' },
  messages: [{
    role:      { type: String, enum: ['user', 'bot'] },
    text:      { type: String },
    createdAt: { type: Date, default: Date.now },
  }],
  lastMessage:   { type: String, default: '' },
  lastMessageAt: { type: Date, default: Date.now },
  unread:        { type: Number, default: 0 },
});

module.exports = mongoose.model('ZaloConversation', zaloConversationSchema);
