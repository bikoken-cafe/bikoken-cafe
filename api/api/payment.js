import { randomUUID } from 'crypto';

const MENU_INFO = {
  'm1': { name: 'フルーツシロップソーダ(ハイビスカス)', price: 350 },
  'm4': { name: 'フルーツシロップソーダ(カシス)', price: 350 },
  'm2': { name: 'カシスウーロン(ソフトドリンク)', price: 350 },
  'm3': { name: 'アイスコーヒー', price: 300 }
};

const FIREBASE_DB_URL = 'https://bikokenn-cafe-default-rtdb.firebaseio.com/bikoken';

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
    const validatedItems = [];
    for (const item of cartItems) {
      const info = MENU_INFO[item.id];
      const qty = Number(item.q);
      if (!info || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ error: `無効な商品です (${item.id})` });
      }
      total += info.price * qty;
      validatedItems.push({
        id: item.id,
        payId: item.id,
        nm: info.name,
        pr: info.price,
        q: qty,
        sp: item.sp ? String(item.sp).slice(0, 50) : ''
      });
    }

    const envToken = (process.env.SQUARE_ACCESS_TOKEN || '').trim();
    const envLoc = (process.env.SQUARE_LOCATION_ID || '').trim();
    const accessToken = envLoc.startsWith('EAAA') ? envLoc : envToken;
    const locationId = 'LRYBX5AH6PHXB';

    if (!accessToken) {
      return res.status(500).json({ error: 'Vercelにトークンが設定されていません' });
    }

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
      return res.status(response.status).json({
        error: `Square拒否(${code}): ${detail}`
      });
    }

    // Firebaseのセキュリティルール（id, md, tm, it, st, ts の6項目のみ許可）に完全準拠した注文データを作成
    const orderId = 'BIKO-' + Math.floor(1000 + Math.random() * 9000);
    const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const tm = String(jstNow.getUTCHours()).padStart(2, '0') + ':' + String(jstNow.getUTCMinutes()).padStart(2, '0');

    const orderData = {
      id: orderId,
      md: '事前決済',
      tm: tm,
      it: validatedItems,
      st: 'new',
      ts: Date.now()
    };

    try {
      await fetch(`${FIREBASE_DB_URL}/ord/${orderId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });

      const stkRes = await fetch(`${FIREBASE_DB_URL}/stk.json`);
      if (stkRes.ok) {
        const curStk = (await stkRes.json()) || {};
        for (const item of validatedItems) {
          if (curStk[item.id] !== undefined) {
            curStk[item.id] = Math.max(0, Number(curStk[item.id]) - item.q);
          }
        }
        await fetch(`${FIREBASE_DB_URL}/stk.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(curStk)
        });
      }
    } catch (fbErr) {
      console.error('Firebase Write Error:', fbErr);
    }

    return res.status(200).json({
      success: true,
      orderId: orderId,
      order: orderData
    });
  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: 'サーバーエラー: ' + error.message });
  }
}
