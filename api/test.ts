import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    success: true,
    message: 'Parcel Measurement API is working!',
    timestamp: new Date().toISOString(),
    endpoints: {
      'POST /api/measure-parcel': 'Get locker recommendation from measurements',
      'GET /api/test': 'Test endpoint'
    }
  });
}
