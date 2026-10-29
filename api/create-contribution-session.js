// POST /api/create-contribution-session
// Creates a Stripe Checkout session for a player contribution.
// Body: { playerName, amountCents, recurring, event, successUrl, cancelUrl }
// Requires: STRIPE_SECRET_KEY in Vercel env vars.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { playerName, amountCents, recurring, event: eventLabel, successUrl, cancelUrl } = req.body || {};

  if (!playerName || !amountCents || amountCents < 1000) {
    return res.status(400).json({ error: 'playerName and amountCents (min 1000) are required.' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(500).json({ error: 'Stripe is not configured.' });
  }

  const safePlayer = playerName.trim().slice(0, 100);
  const safeEvent  = (eventLabel || 'program').trim().slice(0, 100);

  const sessionParams = {
    mode: recurring ? 'subscription' : 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Support ${safePlayer}'s Spot`,
          description: `Contribution toward ${safePlayer}'s balance at California Athletic Academy`,
        },
        unit_amount: Math.round(amountCents),
        ...(recurring ? { recurring: { interval: 'month' } } : {}),
      },
      quantity: 1,
    }],
    payment_intent_data: recurring ? undefined : {
      metadata: {
        player_name: safePlayer,
        event: safeEvent,
        type: 'one_time',
      },
    },
    subscription_data: recurring ? {
      metadata: {
        player_name: safePlayer,
        event: safeEvent,
        type: 'recurring',
      },
    } : undefined,
    metadata: {
      player_name: safePlayer,
      event: safeEvent,
      type: recurring ? 'recurring' : 'one_time',
    },
    success_url: successUrl || 'https://californiaathleticacademy.com/support?success=1',
    cancel_url:  cancelUrl  || 'https://californiaathleticacademy.com/support',
  };

  // Remove undefined keys (Stripe rejects them)
  if (!recurring) delete sessionParams.subscription_data;
  if (recurring)  delete sessionParams.payment_intent_data;

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
    console.error('create-contribution-session error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session.' });
  }
}

// Stripe's API uses form-encoded bodies with nested params (param[key]=val)
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
