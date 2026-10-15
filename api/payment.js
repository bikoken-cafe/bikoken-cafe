import { randomUUID } from 'crypto';

const MENU_PRICES = {
  'm1': 350, // フルーツシロップソーダ(ハイビスカス)
  'm4': 350, // フルーツシロップソーダ(カシス)
  'm2': 350, // カシスウーロン(ソフトドリンク) ※350円に修正済み
  'm3': 300  // アイスコーヒー
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { sourceId, cartItems } = req.body;

    if (!sourceId || typeof sourceId !== 'string') {
      return res.status(400).json({ error: '無効な決済トークンです' });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0 || cartItems.length > 50) {
      return res.status(400).json({ error: 'カート情報が不正です' });
    }

    let total = 0;
    for (const item of cartItems) {
      const price = MENU_PRICES[item.id];
      const qty = Number(item.q);
      if (!price || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ error: '無効な商品または数量です' });
      }
      total += price * qty;
    }
    if (total <= 0 || total > 50000) {
      return res.status(400).json({ error: '決済金額が範囲外です' });
    }

    const accessToken = (process.env.SQUARE_ACCESS_TOKEN || '').trim();
    const locationId = (process.env.SQUARE_LOCATION_ID || 'LRYBX5AH6PHXB').trim();
    if (!accessToken) {
      throw new Error('Squareの認証情報が設定されていません');
    }

    // 本番環境
    const response = await fetch('https://connect.squareup.com/v2/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2025-01-23',
      },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: randomUUID(),
        amount_money: { amount: total, currency: 'JPY' },
        location_id: locationId,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Square API Error:', JSON.stringify(data));
      return res.status(response.status).json({ error: '決済が承認されませんでした' });
    }

    return res.status(200).json({ success: true, paymentId: data.payment?.id });
  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}