// POST /api/stripe-webhook
// Listens for Stripe checkout.session.completed and invoice.payment_succeeded events.
// Sends a confirmation email to the customer via Resend.
// Requires: STRIPE_WEBHOOK_SECRET, RESEND_API_KEY in Vercel env vars.

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function verifyStripeSignature(rawBody, signature, secret) {
  const encoder = new TextEncoder();
  const parts = signature.split(',');
  const timestamp = parts.find(p => p.startsWith('t=')).slice(2);
  const v1 = parts.find(p => p.startsWith('v1=')).slice(3);

  const payload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === v1;
}

async function sendConfirmationEmail({ to, firstName, sessionLabel }) {
  const portalLink = 'https://billing.stripe.com/p/login/4gM6ol2888zV16se8487K00';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#0C2340;padding:24px 32px;border-radius:8px 8px 0 0;">
        <h1 style="color:#D4A017;font-size:22px;margin:0;letter-spacing:1px;">CALIFORNIA ATHLETIC ACADEMY</h1>
        <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;">Rowland Heights, CA</p>
      </div>
      <div style="background:#f9f9f9;padding:32px;border-radius:0 0 8px 8px;">
        <h2 style="color:#0C2340;margin-top:0;">You're Registered! 🏀</h2>
        <p>Hi ${firstName},</p>
        <p>Thank you for registering for the California Athletic Academy Monthly Program. We're excited to have you with us!</p>

        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:6px;padding:20px;margin:24px 0;">
          <p style="margin:0 0 8px;font-size:13px;color:#666;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">Registration Details</p>
          <p style="margin:4px 0;"><strong>Program:</strong> Monthly Basketball Development Program</p>
          <p style="margin:4px 0;"><strong>Session:</strong> ${sessionLabel}</p>
          <p style="margin:4px 0;"><strong>Location:</strong> Rowland High School Gymnasium, Rowland Heights CA</p>
          <p style="margin:4px 0;"><strong>Starts:</strong> November 8, 2026</p>
        </div>

        <p>A coach will be in touch to confirm your session details and what to bring.</p>

        <div style="margin:24px 0;padding:16px;background:#0C2340;border-radius:6px;text-align:center;">
          <p style="color:#fff;margin:0 0 12px;font-size:14px;">Manage your subscription — update payment, view invoices, or cancel anytime.</p>
          <a href="${portalLink}" style="display:inline-block;background:#D4A017;color:#0C2340;font-weight:bold;padding:10px 24px;border-radius:4px;text-decoration:none;font-size:14px;">Manage My Subscription</a>
        </div>

        <p style="color:#666;font-size:13px;">Questions? Reply to this email or visit <a href="https://californiaathleticacademy.com" style="color:#0C2340;">californiaathleticacademy.com</a></p>

        <p style="margin-bottom:0;">See you on the court!<br><strong>Quentin Carr</strong><br>California Athletic Academy</p>
      </div>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'California Athletic Academy <noreply@californiaathleticacademy.com>',
      to,
      subject: "You're Registered! California Athletic Academy — Monthly Program",
      html,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Resend error: ${err}`);
  }
  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const signature = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) return res.status(500).json({ error: 'Webhook secret not configured' });

  try {
    const valid = await verifyStripeSignature(rawBody.toString(), signature, secret);
    if (!valid) return res.status(400).json({ error: 'Invalid signature' });
  } catch (e) {
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  const event = JSON.parse(rawBody.toString());

  // Only handle new subscriptions (not renewals)
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    const metadata = session.metadata || {};
    const athleteName = metadata.athlete_name || '';
    const firstName = athleteName.split(' ')[0] || 'Athlete';
    const sessionLabel = metadata.session || 'Monthly Program Session';

    if (email) {
      try {
        await sendConfirmationEmail({ to: email, firstName, sessionLabel });
        console.log(`Confirmation sent to ${email}`);
      } catch (e) {
        console.error('Email send failed:', e.message);
      }
    }
  }

  return res.status(200).json({ received: true });
}
