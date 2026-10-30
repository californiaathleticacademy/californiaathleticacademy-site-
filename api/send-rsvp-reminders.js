// GET /api/send-rsvp-reminders
// Called by Vercel cron every day at 10 AM PT (18:00 UTC).
// Sends a 48-hour balance-due reminder to any RSVP athlete whose event_date
// is exactly 2 days from today — so it works for any event on any day at any location.
// Skips athletes whose metadata already has balance_paid=true.

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!stripeKey || !resendKey) return res.status(500).json({ error: 'Missing env vars.' });

  // Today in PT — what date is it right now in Los Angeles?
  const nowPT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  // Target: event_date == 2 days from today (the 48-hour window)
  const target = new Date(nowPT);
  target.setDate(nowPT.getDate() + 2);
  const targetStr = target.toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // Human-readable event date for email body
  const eventDateLabel = target.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
  const deadlineTarget = new Date(nowPT);
  deadlineTarget.setDate(nowPT.getDate() + 1);
  const deadlineStr = deadlineTarget.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

  // Fetch all recent RSVP payment intents from Stripe (paginate if needed)
  let allIntents = [];
  let hasMore = true;
  let startingAfter = undefined;

  while (hasMore) {
    const url = new URL('https://api.stripe.com/v1/payment_intents');
    url.searchParams.set('limit', '100');
    if (startingAfter) url.searchParams.set('starting_after', startingAfter);

    const stripeRes = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${stripeKey}` },
    });
    const stripeData = await stripeRes.json();
    if (!stripeRes.ok) return res.status(502).json({ error: 'Stripe fetch failed.', detail: stripeData });

    allIntents = allIntents.concat(stripeData.data || []);
    hasMore = stripeData.has_more;
    if (hasMore && stripeData.data.length > 0) {
      startingAfter = stripeData.data[stripeData.data.length - 1].id;
    }
  }

  // Filter: succeeded RSVP deposits whose event_date matches the 48-hr target
  const rsvps = allIntents.filter(pi =>
    pi.status === 'succeeded' &&
    pi.metadata?.type === 'rsvp_deposit' &&
    pi.metadata?.event_date === targetStr &&
    pi.metadata?.balance_paid !== 'true'
  );

  if (rsvps.length === 0) {
    return res.status(200).json({ sent: 0, message: `No RSVPs found for event_date ${targetStr}.` });
  }

  const results = [];

  for (const pi of rsvps) {
    const athleteEmail = pi.metadata?.athlete_email;
    const athleteName  = pi.metadata?.athlete_name || 'Athlete';
    const firstName    = athleteName.split(' ')[0];
    const balanceCents = parseInt(pi.metadata?.balance_due || '15920', 10);
    const balanceDollars = (balanceCents / 100).toFixed(2);

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
        subject: `Balance due ${deadlineStr} — California Athletic Academy`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:8px;overflow:hidden;">
            <div style="background:#0C2340;padding:28px;">
              <h1 style="color:#D4A017;font-size:20px;margin:0 0 6px;letter-spacing:2px;text-transform:uppercase;">Balance Due in 48 Hours</h1>
              <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0;">California Athletic Academy</p>
            </div>
            <div style="padding:28px;">
              <p style="font-size:15px;color:#222;margin:0 0 16px;">Hi ${firstName},</p>
              <p style="font-size:14px;color:#333;margin:0 0 20px;">Your session is <strong>${eventDateLabel}</strong>. Your remaining balance of <strong>$${balanceDollars}</strong> is due by <strong>${deadlineStr}</strong> — 24 hours before the session.</p>

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

    results.push({ email: athleteEmail, event_date: targetStr, sent: emailRes.ok });
  }

  return res.status(200).json({ sent: results.length, event_date: targetStr, results });
}
