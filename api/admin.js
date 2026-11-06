// /api/admin — password-protected admin actions
//
// POST ?action=update-spots   → update session spot counts
// GET  ?action=get-contributions → per-player Stripe contribution totals
// GET  ?action=send-rsvp-reminders → send 48-hr balance-due reminder emails (also called by cron)
//
// Requires: ADMIN_PASSWORD, STRIPE_SECRET_KEY, RESEND_API_KEY in Vercel env vars.

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || 'update-spots';

  // ── GET actions ────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    // Auth via query param for GET requests
    const { password } = req.query;
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ── get-contributions ────────────────────────────────────────────────────
    if (action === 'get-contributions') {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) return res.status(500).json({ error: 'Stripe is not configured.' });

      try {
        const players = {};
        let hasMore = true;
        let startingAfter = null;
        let pageCount = 0;

        while (hasMore && pageCount < 4) {
          let url = 'https://api.stripe.com/v1/checkout/sessions?limit=100&status=complete&expand[]=data.payment_intent';
          if (startingAfter) url += `&starting_after=${startingAfter}`;

          const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${stripeKey}` },
          });

          if (!response.ok) {
            const err = await response.json();
            return res.status(502).json({ error: err.error?.message || 'Stripe error' });
          }

          const data = await response.json();

          for (const session of data.data) {
            const playerName = session.metadata?.player_name;
            if (!playerName) continue;

            const amount = session.amount_total || 0;
            const event  = session.metadata?.event || 'unknown';
            const type   = session.metadata?.type || 'one_time';
            const date   = new Date(session.created * 1000).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
            });

            if (!players[playerName]) {
              players[playerName] = { total: 0, count: 0, recurring: 0, events: {}, last: null };
            }
            players[playerName].total += amount;
            players[playerName].count += 1;
            if (type === 'recurring') players[playerName].recurring += 1;
            players[playerName].events[event] = (players[playerName].events[event] || 0) + 1;
            if (!players[playerName].last || session.created > players[playerName].lastTs) {
              players[playerName].last = date;
              players[playerName].lastTs = session.created;
            }
          }

          hasMore = data.has_more;
          if (hasMore && data.data.length > 0) {
            startingAfter = data.data[data.data.length - 1].id;
          }
          pageCount++;
        }

        const sorted = Object.entries(players)
          .map(([name, d]) => ({
            player: name, total: d.total, count: d.count,
            recurring: d.recurring, events: d.events, last: d.last,
          }))
          .sort((a, b) => b.total - a.total);

        const grandTotal = sorted.reduce((s, p) => s + p.total, 0);
        return res.status(200).json({ players: sorted, grandTotal, fetched: new Date().toISOString() });
      } catch (err) {
        console.error('get-contributions error:', err);
        return res.status(500).json({ error: 'Failed to fetch contributions.' });
      }
    }

    // ── send-rsvp-reminders ──────────────────────────────────────────────────
    if (action === 'send-rsvp-reminders') {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      const resendKey = process.env.Resend_API_KEY || process.env.Resend_KEY;
      if (!stripeKey || !resendKey) return res.status(500).json({ error: 'Missing env vars.' });

      const nowPT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      const target = new Date(nowPT);
      target.setDate(nowPT.getDate() + 2);
      const targetStr = target.toISOString().slice(0, 10);

      const eventDateLabel = target.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles',
      });
      const deadlineTarget = new Date(nowPT);
      deadlineTarget.setDate(nowPT.getDate() + 1);
      const deadlineStr = deadlineTarget.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles',
      });

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
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
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
                  <p style="font-size:14px;color:#333;margin:0 0 20px;">Your session is <strong>${eventDateLabel}</strong>. Your remaining balance of <strong>$${balanceDollars}</strong> is due by <strong>${deadlineStr}</strong>.</p>
                  <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
                    <p style="font-size:13px;color:#856404;margin:0;font-weight:600;">⚠️ Important Reminder</p>
                    <p style="font-size:13px;color:#856404;margin:8px 0 0;">If the balance is not paid in full by ${deadlineStr}, your RSVP and any contributions raised on your behalf will be forfeited.</p>
                  </div>
                  <a href="https://californiaathleticacademy.com/monthly-program" style="display:inline-block;background:#B8860B;color:#fff;font-weight:700;font-size:14px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:14px 28px;border-radius:3px;">Complete Payment →</a>
                  <p style="font-size:13px;color:#999;margin:24px 0 0;">Questions? Reply to this email.<br>— California Athletic Academy · Rowland Heights</p>
                </div>
              </div>
            `,
          }),
        });

        results.push({ email: athleteEmail, event_date: targetStr, sent: emailRes.ok });
      }

      return res.status(200).json({ sent: results.length, event_date: targetStr, results });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  }

  // ── POST actions ───────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { password, session, max, available, threshold, open } = req.body;

    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // ── update-spots (default POST action) ──────────────────────────────────
    if (!['s1', 's2'].includes(session)) {
      return res.status(400).json({ error: 'Invalid session. Must be s1 or s2.' });
    }

    const maxN       = parseInt(max);
    const availableN = parseInt(available);
    const thresholdN = parseInt(threshold);

    if (isNaN(maxN) || isNaN(availableN) || isNaN(thresholdN)) {
      return res.status(400).json({ error: 'max, available, and threshold must be numbers.' });
    }
    if (availableN < 0 || availableN > maxN) {
      return res.status(400).json({ error: 'available must be between 0 and max.' });
    }

    try {
      await kv.hset(`spots:${session}`, {
        max:       maxN,
        available: availableN,
        threshold: thresholdN,
        open:      open === true || open === 'true' ? 'true' : 'false',
      });

      return res.status(200).json({ success: true, session, max: maxN, available: availableN, threshold: thresholdN, open });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
