// GET /api/spots
// Returns current spot configuration for all sessions.
// Uses Vercel KV (REDIS_URL / KV_REST_API_URL env vars set in Vercel dashboard).
// Falls back to defaults if KV is not yet connected.

import { kv } from '@vercel/kv';

const DEFAULTS = {
  s1: { max: 64, available: 64, threshold: 20, open: true },
  s2: { max: 64, available: 64, threshold: 20, open: true },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const [s1, s2] = await Promise.all([
      kv.hgetall('spots:s1'),
      kv.hgetall('spots:s2'),
    ]);

    const parse = (raw, def) => {
      if (!raw) return def;
      return {
        max:       parseInt(raw.max)       || def.max,
        available: parseInt(raw.available) || 0,
        threshold: parseInt(raw.threshold) || def.threshold,
        open:      raw.open === 'true' || raw.open === true,
      };
    };

    return res.status(200).json({
      s1: parse(s1, DEFAULTS.s1),
      s2: parse(s2, DEFAULTS.s2),
    });
  } catch (err) {
    // KV not connected yet — return defaults so page still renders
    return res.status(200).json(DEFAULTS);
  }
}
