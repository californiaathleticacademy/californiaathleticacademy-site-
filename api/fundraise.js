// GET  /api/fundraise?slug=clinic  → returns totals for the event
// POST /api/fundraise?slug=clinic  → records a donation intent (called before Stripe redirect)
//
// Totals are stored in Vercel KV under fundraise:{event.id}
// Actual payment confirmation comes via Stripe webhook (future enhancement).
// For now, intent is recorded on click so you see activity even before Stripe confirms.

import { kv } from '@vercel/kv';
import { getEventBySlug } from '../data/events.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { slug } = req.query;
  const event = slug ? getEventBySlug(slug) : null;

  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!event.allowFundraising) {
    return res.status(403).json({ error: 'Fundraising is not enabled for this event.' });
  }

  const key = `fundraise:${event.id}`;
  const goal = event.fundraising.goal;

  // ── GET — return current totals ───────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const data = await kv.hgetall(key);
      const total = data ? parseInt(data.total) || 0 : 0;
      const count = data ? parseInt(data.count) || 0 : 0;
      const pct   = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;
      return res.status(200).json({ total, count, goal, pct });
    } catch {
      return res.status(200).json({ total: 0, count: 0, goal, pct: 0 });
    }
  }

  // ── POST — record intent ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { amount } = req.body || {};
    const amt = parseInt(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Invalid amount.' });
    }
    try {
      await kv.hincrby(key, 'total', amt);
      await kv.hincrby(key, 'count', 1);
      return res.status(200).json({ success: true, recorded: amt });
    } catch {
      // KV not connected yet — fail silently so the Stripe redirect still works
      return res.status(200).json({ success: true, recorded: amt });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
