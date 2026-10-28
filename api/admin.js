// POST /api/admin
// Password-protected endpoint to update spot counts.
// Body: { password, session, max, available, threshold, open }
// ADMIN_PASSWORD env var set in Vercel dashboard.

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, session, max, available, threshold, open } = req.body;

  // Auth
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Validate session
  if (!['s1', 's2'].includes(session)) {
    return res.status(400).json({ error: 'Invalid session. Must be s1 or s2.' });
  }

  // Validate numbers
  const maxN       = parseInt(max);
  const availableN = parseInt(available);
  const thresholdN = parseInt(threshold);

  if (isNaN(maxN) || isNaN(availableN) || isNaN(thresholdN)) {
    return res.status(400).json({ error: 'max, available, and threshold must be numbers.' });
  }
  if (availableN < 0 || availableN > maxN) {
    return res.status(400).json({ error: 'available must be between 0 and max.' });
  }

  try {
    await kv.hset(`spots:${session}`, {
      max:       maxN,
      available: availableN,
      threshold: thresholdN,
      open:      open === true || open === 'true' ? 'true' : 'false',
    });

    return res.status(200).json({ success: true, session, max: maxN, available: availableN, threshold: thresholdN, open });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
