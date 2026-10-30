// POST /api/monthly-rsvp
// Creates a Stripe Checkout session for Monthly Program RSVP deposit ($39.80 one-time).
// Body: { firstName, lastName, email, session, grade, skillLevel }
// Requires: STRIPE_SECRET_KEY in Vercel env vars.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, lastName, email, session, grade, skillLevel, promoCode } = req.body || {};

  // Promo codes — keep in sync with monthly-checkout.js
  const PROMOS = { 'RUSD': 0.25 };
  const discount   = PROMOS[(promoCode || '').toUpperCase()] || 0;
  const totalCents = Math.round(19900 * (1 - discount));      // e.g. 14925
  const depositCents  = Math.round(totalCents * 0.20);        // 20% deposit
  const balanceCents  = totalCents - depositCents;            // remainder

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName, and email are required.' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe is not configured.' });

  const sessionLabel = session === 's1'
    ? 'Session 1: Grades 4th–8th (10:00 AM – 12:00 PM)'
    : 'Session 2: High School Division (12:00 PM – 1:30 PM)';

  const sessionParams = {
    mode: 'payment',
    customer_email: email,
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Monthly Program RSVP — California Athletic Academy',
          description: `20% deposit · ${sessionLabel} · Balance of $${(balanceCents/100).toFixed(2)} due at first session`,
        },
        unit_amount: depositCents, // 20% of discounted total
      },
      quantity: 1,
    }],
    payment_intent_data: {
      metadata: {
        athlete_name: `${firstName} ${lastName}`,
        athlete_email: email,
        grade: grade || '',
        skill_level: skillLevel || '',
        session: sessionLabel,
        event: 'monthly-program-nov-2026',
        event_date: '2026-11-08',
        type: 'rsvp_deposit',
        balance_due: String(balanceCents),
        promo_code: promoCode || '',
      },
    },
    success_url: `https://californiaathleticacademy.com/monthly-program?rsvp=1&first=${encodeURIComponent(firstName)}&last=${encodeURIComponent(lastName)}&session=${encodeURIComponent(session || 's1')}`,
    cancel_url: `https://californiaathleticacademy.com/monthly-program?cancelled=1`,
  };

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: buildStripeBody(sessionParams),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Stripe error:', data);
      return res.status(502).json({ error: data.error?.message || 'Stripe error' });
    }

    return res.status(200).json({ url: data.url });
  } catch (err) {
    console.error('monthly-rsvp error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session.' });
  }
}

function buildStripeBody(params, prefix = '') {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) {
      parts.push(buildStripeBody(value, fullKey));
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object') {
          parts.push(buildStripeBody(item, `${fullKey}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(item)}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}
