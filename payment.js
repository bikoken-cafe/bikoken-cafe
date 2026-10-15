import { randomUUID } from 'crypto';

const MENU_MASTER = {
  'm1': { name: 'フルーツシロップソーダ(ハイビスカス)', price: 350, stock: 20 },
  'm4': { name: 'フルーツシロップソーダ(カシス)', price: 350, stock: 20 },
  'm2': { name: 'カシスウーロン(ソフトドリンク)', price: 300, stock: 15 },
  'm3': { name: 'アイスコーヒー', price: 300, stock: 30 }
};

const FIREBASE_DB_URL = 'https://bikokenn-cafe-default-rtdb.firebaseio.com/bikoken';

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

    let secureTotalAmount = 0;
    const verifiedItems = [];
    const totalsById = {};

    for (const item of cartItems) {
      const master = MENU_MASTER[item.id];
      const qty = Number(item.q);

      if (!master || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ error: '無効な商品または数量が含まれています' });
      }
      secureTotalAmount += (master.price * qty);
      totalsById[item.id] = (totalsById[item.id] || 0) + qty;
      verifiedItems.push({
        id: item.id,
        nm: master.name,
        pr: master.price,
        q: qty,
        sp: typeof item.sp === 'string' ? item.sp.slice(0, 50) : ''
      });
    }

    if (secureTotalAmount <= 0 || secureTotalAmount > 50000) {
      return res.status(400).json({ error: '決済金額が範囲外です' });
    }

    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;

    if (!accessToken || !locationId) {
      return res.status(500).json({ error: 'サーバーのSquare認証情報が未設定です' });
    }

    // 1. 本番環境（Production）のSquareへ決済リクエスト
    const response = await fetch('https://connect.squareup.com/v2/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: randomUUID(),
        amount_money: {
          amount: secureTotalAmount,
          currency: 'JPY',
        },
        location_id: locationId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Square API Error:', data);
      return res.status(response.status).json({ error: '決済が承認されませんでした' });
    }

    // 2. 決済成功と同時に、サーバーから直接Firebaseへ注文と在庫減算を書き込む
    const oid = 'BIKO-' + Math.floor(1000 + Math.random() * 9000);
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const tm = String(jstNow.getUTCHours()).padStart(2, '0') + ':' + String(jstNow.getUTCMinutes()).padStart(2, '0');

    const orderData = {
      id: oid,
      md: '事前決済',
      paymentId: data.payment.id,
      tm: tm,
      it: verifiedItems,
      st: 'new',
      ts: Date.now()
    };

    try {
      await fetch(`${FIREBASE_DB_URL}/ord/${oid}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });

      const stkRes = await fetch(`${FIREBASE_DB_URL}/stk.json`);
      const currentStk = stkRes.ok ? ((await stkRes.json()) || {}) : {};
      for (const [id, deductQty] of Object.entries(totalsById)) {
        const cur = currentStk[id] ?? MENU_MASTER[id].stock;
        await fetch(`${FIREBASE_DB_URL}/stk/${id}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Math.max(0, cur - deductQty))
        });
      }
    } catch (fbErr) {
      console.error('Firebase Sync Error:', fbErr);
      return res.status(200).json({ success: true, payment: data.payment });
    }

    return res.status(200).json({ success: true, orderId: oid, payment: data.payment });

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}