const crypto = require('crypto');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { amount, sourceId } = req.body;

    // Vercelの金庫から鍵を取り出す
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;

    if (!accessToken || !locationId) {
      throw new Error('Squareの認証情報が設定されていません');
    }

    const response = await fetch('https://connect.squareupsandbox.com/v2/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: crypto.randomUUID(), // 二重決済を防ぐためのユニークな鍵
        amount_money: {
          amount: amount, // 金額（例：300）
          currency: 'JPY',
        },
        location_id: locationId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Square API Error:', data);
      return res.status(response.status).json({ error: data });
    }

    return res.status(200).json({ success: true, payment: data.payment });

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}