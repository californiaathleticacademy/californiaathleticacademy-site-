// GET /api/registrations?password=<ADMIN_PASSWORD>&session=s1|s2|all
// Returns all registrations stored in KV, password-protected.

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { password, session } = req.query;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const sessionFilter = session || 'all';

  try {
    const sessions = sessionFilter === 'all' ? ['s1', 's2'] : [sessionFilter];
    const allKeys = [];

    for (const s of sessions) {
      // Scan for all keys matching registrations:<session>:*
      let cursor = 0;
      do {
        const [nextCursor, keys] = await kv.scan(cursor, {
          match: `registrations:${s}:*`,
          count: 100,
        });
        allKeys.push(...keys);
        cursor = nextCursor;
      } while (cursor !== 0);
    }

    if (allKeys.length === 0) {
      return res.status(200).json({ registrations: [], total: 0 });
    }

    // Fetch all records in parallel
    const records = await Promise.all(allKeys.map(key => kv.get(key)));

    // Filter nulls, sort by registeredAt descending (newest first)
    const registrations = records
      .filter(Boolean)
      .sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));

    return res.status(200).json({ registrations, total: registrations.length });

  } catch (err) {
    console.error('Registrations fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
}
