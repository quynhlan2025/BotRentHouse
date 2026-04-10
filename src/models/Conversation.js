const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String },
  firstName: { type: String },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'] },
    content: { type: String },
    createdAt: { type: Date, default: Date.now },
  }],
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Conversation', conversationSchema);
