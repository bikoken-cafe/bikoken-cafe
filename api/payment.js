import { randomUUID } from 'crypto';

const MENU_PRICES = {
  'm1': 350, // フルーツシロップソーダ(ハイビスカス)
  'm4': 350, // フルーツシロップソーダ(カシス)
  'm2': 350, // カシスウーロン(ソフトドリンク)
  'm3': 300  // アイスコーヒー
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { sourceId, cartItems } = req.body || {};

    if (!sourceId || typeof sourceId !== 'string') {
      return res.status(400).json({ error: '決済トークンが空です' });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0 || cartItems.length > 50) {
      return res.status(400).json({ error: 'カート情報が不正です' });
    }

    let total = 0;
    for (const item of cartItems) {
      const price = MENU_PRICES[item.id];
      const qty = Number(item.q);
      if (!price || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ error: `無効な商品です (${item.id})` });
      }
      total += price * qty;
    }

    // Vercelの環境変数を取り出す（SQUARE_LOCATION_IDにEAAA...が入ってしまっていても自動で救済する）
    const envToken = (process.env.SQUARE_ACCESS_TOKEN || '').trim();
    const envLoc = (process.env.SQUARE_LOCATION_ID || '').trim();
    const accessToken = envLoc.startsWith('EAAA') ? envLoc : envToken;

    // 店舗IDは本番の LRYBX5AH6PHXB に完全固定
    const locationId = 'LRYBX5AH6PHXB';

    if (!accessToken) {
      return res.status(500).json({ error: 'Vercelにトークンが設定されていません' });
    }

    // 本番環境へ送信
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
      const code = data.errors?.[0]?.code || 'UNKNOWN';
      const detail = data.errors?.[0]?.detail || '';
      console.error('Square API Error:', JSON.stringify(data));
      if (code === 'UNAUTHORIZED') {
        return res.status(401).json({
          error: `Square認証エラー: トークンがSandbox用か無効です(先頭:${accessToken.slice(0, 7)}...)`
        });
      }
      return res.status(response.status).json({
        error: `Square拒否(${code}): ${detail}`
      });
    }

    return res.status(200).json({ success: true, paymentId: data.payment?.id });
  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: 'サーバーエラー: ' + error.message });
  }
}
