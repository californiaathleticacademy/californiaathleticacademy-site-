// POST /api/stripe-webhook
// Stripe sends a signed event here when a checkout.session completes.
// We parse the client_reference_id to find which session slot was purchased
// and decrement that KV counter automatically.
//
// client_reference_id format: "{slug}|{sessionId}|{firstName lastName}"
// e.g. "coed-nov-16|s1|Jane Smith"
//
// Required env vars (Vercel dashboard → Settings → Environment Variables):
//   STRIPE_WEBHOOK_SECRET  — from Stripe dashboard → Webhooks → signing secret
//   KV_REST_API_URL        — already set (used by /api/spots)
//   KV_REST_API_TOKEN      — already set (used by /api/spots)

import Stripe from 'stripe';
import { kv } from '@vercel/kv';

// Vercel parses the body by default; we need the raw bytes to verify the signature.
export const config = { api: { bodyParser: false } };

const VALID_SESSIONS = new Set(['s1', 's2']);

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET env var not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Only act on completed checkouts
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, action: 'ignored' });
  }

  const session = event.data.object;
  const refId = session.client_reference_id || '';

  // Parse format: "{slug}|{sessionId}|{name}"
  const parts = refId.split('|');
  const sessionId = parts[1]; // e.g. "s1" or "s2"

  if (!sessionId || !VALID_SESSIONS.has(sessionId)) {
    // Not a co-ed event or missing session — log and return 200 so Stripe doesn't retry
    console.log(`Webhook received but no valid session ID in ref: "${refId}" — skipping KV decrement`);
    return res.status(200).json({ received: true, action: 'skipped', refId });
  }

  const kvKey = `spots:${sessionId}`;

  try {
    // Read current available count
    const current = await kv.hgetall(kvKey);
    const available = parseInt(current?.available ?? 64);

    if (available <= 0) {
      console.warn(`Session ${sessionId} already at 0 spots — no decrement`);
      return res.status(200).json({ received: true, action: 'already_full', sessionId });
    }

    const newAvailable = available - 1;
    const isOpen = newAvailable > 0;

    await kv.hset(kvKey, {
      available: newAvailable,
      open: isOpen,
    });

    console.log(`Spot decremented: ${sessionId} → ${newAvailable} remaining (ref: ${refId})`);
    return res.status(200).json({ received: true, action: 'decremented', sessionId, newAvailable });

  } catch (err) {
    // Log the error but return 200 so Stripe doesn't keep retrying.
    // The admin panel can manually adjust if KV is temporarily unreachable.
    console.error(`KV decrement failed for ${sessionId}:`, err.message);
    return res.status(200).json({ received: true, action: 'kv_error', error: err.message });
  }
}
