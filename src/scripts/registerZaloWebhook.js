// Chạy 1 lần để đăng ký webhook Zalo Bot
// node src/scripts/registerZaloWebhook.js

require('dotenv').config();
const axios = require('axios');

const BOT_TOKEN = process.env.ZALO_OA_TOKEN;
const WEBHOOK_URL = process.env.RAILWAY_URL || 'https://web-production-d0627.up.railway.app';
const SECRET_TOKEN = 'renthouse-secret-2024';

async function registerWebhook() {
  try {
    const res = await axios.post(
      `https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}/setWebhook`,
      {
        url: `${WEBHOOK_URL}/zalo/webhook`,
        secret_token: SECRET_TOKEN,
      }
    );
    console.log('✅ Đăng ký webhook thành công:', res.data);
  } catch (err) {
    console.error('❌ Lỗi:', err.response?.data || err.message);
  }
}

registerWebhook();
