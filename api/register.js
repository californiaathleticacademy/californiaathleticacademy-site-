// POST /api/register
// Sends registration details to Coach via Resend email.
// Requires RESEND_API_KEY environment variable in Vercel.
//
// Body: { firstName, lastName, email, phone, grade, session }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, lastName, email, phone, grade, skillLevel, session, event } = req.body || {};

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName, and email are required.' });
  }
  if (!['s1', 's2'].includes(session)) {
    return res.status(400).json({ error: 'session must be s1 or s2.' });
  }

  const isMonthly = event && event.toLowerCase().includes('monthly');
  const eventLabel = isMonthly
    ? 'Monthly Program — Every Sunday · Starting November 8th'
    : 'Girls Basketball Skills Clinic';

  const sessionLabel = session === 's1'
    ? 'Session 1: Grades 4th–8th (10:00 AM – 12:00 PM)'
    : 'Session 2: High School Division (12:00 PM – 2:00 PM)';

  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'California Athletic Academy <noreply@californiaathleticacademy.com>',
        to: 'qcarr@rowlandschools.org',
        reply_to: email,
        subject: `New Registration — ${firstName} ${lastName} · ${eventLabel}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:8px;overflow:hidden;">
            <div style="background:#0C2340;padding:24px 28px;">
              <h1 style="color:#D4A017;font-size:20px;margin:0;letter-spacing:2px;text-transform:uppercase;">New Registration</h1>
              <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:6px 0 0;">${eventLabel}</p>
            </div>
            <div style="padding:28px;">
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:8px 0;color:#666;font-size:13px;width:140px;">Athlete</td><td style="padding:8px 0;font-weight:600;color:#111;font-size:14px;">${firstName} ${lastName}</td></tr>
                <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;font-size:13px;">Session</td><td style="padding:8px 0;font-weight:600;color:#0C2340;font-size:14px;">${sessionLabel}</td></tr>
                <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;font-size:13px;">Grade</td><td style="padding:8px 0;color:#333;font-size:14px;">${grade || 'Not specified'}</td></tr>
                <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;font-size:13px;">Skill Level</td><td style="padding:8px 0;color:#333;font-size:14px;">${skillLevel || 'Not specified'}</td></tr>
                <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;font-size:13px;">Parent Email</td><td style="padding:8px 0;color:#333;font-size:14px;">${email}</td></tr>
                <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;font-size:13px;">Parent Phone</td><td style="padding:8px 0;color:#333;font-size:14px;">${phone || 'Not provided'}</td></tr>
                <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;font-size:13px;">Submitted</td><td style="padding:8px 0;color:#999;font-size:13px;">${timestamp} PT</td></tr>
              </table>
            </div>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Resend error:', err);
      return res.status(500).json({ error: 'Email delivery failed. Please try again.' });
    }

    // Confirmation email to athlete/parent
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'California Athletic Academy <noreply@californiaathleticacademy.com>',
        to: email,
        subject: `You're registered — ${eventLabel}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:8px;overflow:hidden;">
            <div style="background:#0C2340;padding:28px;">
              <h1 style="color:#D4A017;font-size:22px;margin:0 0 6px;letter-spacing:2px;text-transform:uppercase;">You're Registered!</h1>
              <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0;">${eventLabel}</p>
            </div>
            <div style="padding:28px;">
              <p style="font-size:15px;color:#222;margin:0 0 20px;">Hi ${firstName}, welcome to California Athletic Academy. Your spot is confirmed for <strong>${sessionLabel}</strong>.</p>

              ${isMonthly ? `
              <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
                <p style="font-size:13px;color:#856404;margin:0;font-weight:700;">⚠️ RSVP Balance Due — Action Required</p>
                <p style="font-size:13px;color:#856404;margin:8px 0 0;">Your remaining balance of <strong>$159.20</strong> must be paid in full <strong>24 hours before your first session (November 8th)</strong>. If payment is not received by then, your RSVP and any contributions raised on your behalf will be forfeited.</p>
                <a href="https://californiaathleticacademy.com/monthly-program" style="display:inline-block;margin-top:14px;background:#B8860B;color:#fff;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:10px 20px;border-radius:3px;">Complete Payment →</a>
              </div>
              ` : `
              <div style="background:#f7f5f0;border-radius:6px;padding:20px 24px;margin-bottom:24px;">
                <p style="font-size:13px;color:#666;margin:0 0 12px;text-transform:uppercase;letter-spacing:2px;font-weight:700;">Get Your Participant Card</p>
                <p style="font-size:14px;color:#333;margin:0 0 16px;">Save your official card and share it on social media to let everyone know you're competing.</p>
                <a href="https://californiaathleticacademy.com/my-card" style="display:inline-block;background:#B8860B;color:#fff;font-weight:700;font-size:14px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:14px 28px;border-radius:3px;">Get My Card →</a>
              </div>
              `}

              <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
                <tr><td style="padding:8px 0;color:#666;font-size:13px;width:140px;">Athlete</td><td style="padding:8px 0;font-weight:600;color:#111;font-size:14px;">${firstName} ${lastName}</td></tr>
                <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;font-size:13px;">Session</td><td style="padding:8px 0;font-weight:600;color:#0C2340;font-size:14px;">${sessionLabel}</td></tr>
                <tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;font-size:13px;">Grade</td><td style="padding:8px 0;color:#333;font-size:14px;">${grade || 'Not specified'}</td></tr>
              </table>

              <p style="font-size:13px;color:#999;margin:0;">Questions? Reply to this email and we'll get back to you.<br>— California Athletic Academy · Rowland Heights</p>
            </div>
          </div>
        `,
      }),
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
