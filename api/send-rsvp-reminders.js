// GET /api/send-rsvp-reminders
// Called by Vercel cron every Friday at 10 AM PT (18:00 UTC).
// Queries Stripe for all RSVP deposits for the monthly program,
// sends a 48-hour balance-due reminder email to each athlete via Resend.
// Skips athletes whose metadata already has balance_paid=true (set manually if needed).

export default async function handler(req, res) {
  // Only allow GET from Vercel cron (or internal call)
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const stripeKey   = process.env.STRIPE_SECRET_KEY;
  const resendKey   = process.env.RESEND_API_KEY;
  if (!stripeKey || !resendKey) return res.status(500).json({ error: 'Missing env vars.' });

  // Calculate next Sunday date for the reminder
  const now = new Date();
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + daysUntilSunday);
  const eventDate = nextSunday.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    timeZone: 'America/Los_Angeles'
  });
  const deadlineDate = new Date(nextSunday);
  deadlineDate.setDate(nextSunday.getDate() - 1);
  const deadlineStr = deadlineDate.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    timeZone: 'America/Los_Angeles'
  });

  // Fetch RSVP payment intents from Stripe
  const stripeRes = await fetch(
    'https://api.stripe.com/v1/payment_intents?limit=100',
    { headers: { 'Authorization': `Bearer ${stripeKey}` } }
  );
  const stripeData = await stripeRes.json();
  if (!stripeRes.ok) return res.status(502).json({ error: 'Stripe fetch failed.' });

  // Filter to monthly program RSVP deposits that succeeded
  const rsvps = (stripeData.data || []).filter(pi =>
    pi.status === 'succeeded' &&
    pi.metadata?.type === 'rsvp_deposit' &&
    pi.metadata?.event === 'monthly-program-nov-2026' &&
    pi.metadata?.balance_paid !== 'true'
  );

  const results = [];
  for (const pi of rsvps) {
    const athleteEmail = pi.metadata?.athlete_email;
    const athleteName  = pi.metadata?.athlete_name || 'Athlete';
    const firstName    = athleteName.split(' ')[0];
    if (!athleteEmail) continue;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'California Athletic Academy <noreply@californiaathleticacademy.com>',
        to: athleteEmail,
        subject: `Balance due ${deadlineStr} — Monthly Program`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:8px;overflow:hidden;">
            <div style="background:#0C2340;padding:28px;">
              <h1 style="color:#D4A017;font-size:20px;margin:0 0 6px;letter-spacing:2px;text-transform:uppercase;">Balance Due in 48 Hours</h1>
              <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0;">Monthly Program · California Athletic Academy</p>
            </div>
            <div style="padding:28px;">
              <p style="font-size:15px;color:#222;margin:0 0 16px;">Hi ${firstName},</p>
              <p style="font-size:14px;color:#333;margin:0 0 20px;">Your next session is <strong>${eventDate}</strong>. Your remaining balance of <strong>$159.20</strong> is due by <strong>${deadlineStr}</strong> — 24 hours before the session.</p>

              <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
                <p style="font-size:13px;color:#856404;margin:0;font-weight:600;">⚠️ Important Reminder</p>
                <p style="font-size:13px;color:#856404;margin:8px 0 0;">If the balance is not paid in full by ${deadlineStr}, your RSVP and any contributions raised on your behalf will be forfeited.</p>
              </div>

              <a href="https://californiaathleticacademy.com/monthly-program" style="display:inline-block;background:#B8860B;color:#fff;font-weight:700;font-size:14px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:14px 28px;border-radius:3px;">Complete Payment →</a>

              <p style="font-size:13px;color:#999;margin:24px 0 0;">Questions? Reply to this email and we'll get back to you.<br>— California Athletic Academy · Rowland Heights</p>
            </div>
          </div>
        `,
      }),
    });

    results.push({ email: athleteEmail, sent: emailRes.ok });
  }

  return res.status(200).json({ sent: results.length, results });
}
