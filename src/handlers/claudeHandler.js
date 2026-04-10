const Anthropic = require('@anthropic-ai/sdk');
const Conversation = require('../models/Conversation');
const { getRoomsSummary } = require('./roomHandler');

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Bot AI = haiku (rẻ), Bot AI Pro = sonnet (xịn hơn)
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

async function buildSystemPrompt() {
  const roomList = await getRoomsSummary();
  return `Bạn là trợ lý tư vấn thuê nhà tên "Nhà trọ quận 3". Hỗ trợ khách tìm phòng trọ, tư vấn hợp đồng, giải đáp thắc mắc về thuê nhà.

Danh sách phòng trọ hiện có:
${roomList}

Liên hệ đặt xem phòng: SĐT 0901 234 567 (8:00 - 20:00)

Trả lời ngắn gọn, thân thiện bằng tiếng Việt. Gợi ý phòng phù hợp với nhu cầu khách. Nếu câu hỏi không liên quan đến thuê nhà, lịch sự chuyển hướng về chủ đề chính.`;
}

async function askClaude(userId, firstName, username, userMessage) {
  let conv = await Conversation.findOne({ userId });
  if (!conv) {
    conv = new Conversation({ userId, firstName, username, messages: [] });
  }

  conv.messages.push({ role: 'user', content: userMessage });

  // Giữ tối đa 20 tin nhắn gần nhất
  if (conv.messages.length > 20) {
    conv.messages = conv.messages.slice(-20);
  }

  const systemPrompt = await buildSystemPrompt();

  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: conv.messages.map(m => ({ role: m.role, content: m.content })),
  });

  const reply = response.content[0].text;
  conv.messages.push({ role: 'assistant', content: reply });
  conv.updatedAt = new Date();
  await conv.save();

  return reply;
}

async function resetConversation(userId) {
  await Conversation.findOneAndUpdate({ userId }, { messages: [], updatedAt: new Date() });
}

module.exports = { askClaude, resetConversation };
