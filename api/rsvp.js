// POST /api/rsvp
// Free RSVP — no payment required.
// Saves RSVP to KV, sends athlete a confirmation email with their community support share link.
// Body: { firstName, lastName, email, grade, session }
// Requires: RESEND_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN in Vercel env vars.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, lastName, email, grade, session } = req.body || {};

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName, and email are required.' });
  }

  const sessionLabel = session === 's2'
    ? 'Session 2: High School Division (12:00 PM – 2:00 PM)'
    : 'Session 1: Grades 4th–8th (10:00 AM – 12:00 PM)';

  // Build share link — supporter lands on /monthly-program pre-filled for this athlete
  const shareLink = `https://californiaathleticacademy.com/monthly-program?sponsor=1` +
    `&first=${encodeURIComponent(firstName)}` +
    `&last=${encodeURIComponent(lastName)}` +
    `&session=${encodeURIComponent(session || 's1')}`;

  // Save RSVP to KV store
  try {
    const kvUrl  = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;
    if (kvUrl && kvToken) {
      const key = `rsvp:${Date.now()}:${email.replace(/[^a-z0-9]/gi, '_')}`;
      await fetch(`${kvUrl}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ firstName, lastName, email, grade, session, shareLink, createdAt: new Date().toISOString() }),
      });
    }
  } catch (e) {
    console.error('KV save error:', e.message);
    // Non-fatal — continue to send email
  }

  // Send confirmation email to athlete
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#0C2340;padding:24px 32px;border-radius:8px 8px 0 0;">
        <h1 style="color:#D4A017;font-size:22px;margin:0;letter-spacing:1px;">CALIFORNIA ATHLETIC ACADEMY</h1>
        <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;">Rowland Heights, CA</p>
      </div>
      <div style="background:#f9f9f9;padding:32px;border-radius:0 0 8px 8px;">
        <h2 style="color:#0C2340;margin-top:0;">You're on the list! 🏀</h2>
        <p>Hi ${firstName},</p>
        <p>Your RSVP for the California Athletic Academy Monthly Program is confirmed. We've reserved your spot — now let's get you locked in.</p>

        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:6px;padding:20px;margin:24px 0;">
          <p style="margin:0 0 8px;font-size:13px;color:#666;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">Your RSVP Details</p>
          <p style="margin:4px 0;"><strong>Athlete:</strong> ${firstName} ${lastName}</p>
          <p style="margin:4px 0;"><strong>Session:</strong> ${sessionLabel}</p>
          <p style="margin:4px 0;"><strong>Grade:</strong> ${grade || 'Not specified'}</p>
          <p style="margin:4px 0;"><strong>Location:</strong> Rowland High School Gymnasium, Rowland Heights CA</p>
          <p style="margin:4px 0;"><strong>Starts:</strong> November 8, 2026 · Every Sunday</p>
        </div>

        <div style="background:#0C2340;border-radius:6px;padding:20px;margin:24px 0;">
          <p style="color:#D4A017;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Secure Your Spot — 2 Ways</p>
          <p style="color:#fff;font-size:14px;margin:0 0 16px;line-height:1.6;">
            <strong style="color:#D4A017;">Option 1:</strong> Pay yourself at $199/month<br>
            <strong style="color:#D4A017;">Option 2:</strong> Share your link — a parent, grandparent, family friend, or community supporter can pay on your behalf.
          </p>
          <a href="${shareLink}" style="display:inline-block;background:#D4A017;color:#0C2340;font-weight:bold;padding:12px 24px;border-radius:4px;text-decoration:none;font-size:14px;margin-bottom:12px;">Pay Now — Secure My Spot →</a>
          <p style="color:rgba(255,255,255,0.6);font-size:12px;margin:12px 0 0;">Or share this link with someone who can support you:</p>
          <p style="background:rgba(255,255,255,0.1);border-radius:4px;padding:10px;font-size:12px;color:#fff;word-break:break-all;margin:8px 0 0;">${shareLink}</p>
        </div>

        <p style="color:#666;font-size:13px;">Your spot is held but not guaranteed until payment is received. Questions? Reply to this email or visit <a href="https://californiaathleticacademy.com" style="color:#0C2340;">californiaathleticacademy.com</a></p>

        <p style="margin-bottom:0;">See you on the court!<br><strong>Coach Carr</strong><br>California Athletic Academy</p>
      </div>
    </div>
  `;

  // Also notify admin
  const adminHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2>New Free RSVP — Monthly Program</h2>
      <p><strong>Name:</strong> ${firstName} ${lastName}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Grade:</strong> ${grade || '—'}</p>
      <p><strong>Session:</strong> ${sessionLabel}</p>
      <p><strong>Share link:</strong> <a href="${shareLink}">${shareLink}</a></p>
      <p style="color:#888;font-size:12px;">Status: RSVP only — payment not yet received</p>
    </div>
  `;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Email not configured.' });

  try {
    // Send to athlete
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'California Athletic Academy <noreply@californiaathleticacademy.com>',
        to: email,
        subject: `${firstName}, you're on the list! California Athletic Academy Monthly Program`,
        html,
      }),
    });

    // Notify admin
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'California Athletic Academy <noreply@californiaathleticacademy.com>',
        to: 'Quentincarr@gmail.com',
        subject: `New RSVP — ${firstName} ${lastName} (${sessionLabel.split(':')[0]})`,
        html: adminHtml,
      }),
    });

    return res.status(200).json({ ok: true, shareLink });
  } catch (err) {
    console.error('RSVP email error:', err);
    return res.status(500).json({ error: 'Failed to send confirmation.' });
  }
}
