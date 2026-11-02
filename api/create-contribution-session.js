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

    // Send email notification to admin
    await sendDonationEmail({ playerName: safePlayer, amountCents, recurring, eventLabel: safeEvent });

    return res.status(200).json({ url: data.url });
  } catch (err) {
    console.error('create-contribution-session error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session.' });
  }
}

async function sendDonationEmail({ playerName, amountCents, recurring, eventLabel }) {
  const resendKey = process.env.Resend_API_KEY || process.env.Resend_KEY;
  if (!resendKey) return;
  const dollars = (amountCents / 100).toFixed(2);
  const type = recurring ? 'Monthly Recurring' : 'One-Time';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'California Athletic Academy <no-reply@californiaathleticacademy.com>',
        to: 'qcarr@rowlandschools.org',
        subject: `New Donation — $${dollars} for ${playerName}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#0C2340;margin-bottom:16px;">New Donation Initiated</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 0;color:#666;font-size:13px;width:140px;">Athlete</td><td style="padding:8px 0;font-weight:600;color:#111;font-size:14px;">${playerName}</td></tr>
              <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;font-size:13px;">Amount</td><td style="padding:8px 0;font-weight:600;color:#0C2340;font-size:14px;">$${dollars}</td></tr>
              <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;font-size:13px;">Type</td><td style="padding:8px 0;color:#333;font-size:14px;">${type}</td></tr>
              <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;font-size:13px;">Event</td><td style="padding:8px 0;color:#333;font-size:14px;">${eventLabel}</td></tr>
            </table>
          </div>`,
      }),
    });
  } catch (e) {
    console.error('donation email error:', e);
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
