// POST /api/register
// Saves registration to Vercel KV and attempts to send a confirmation email.
// Email is best-effort — form succeeds even if RESEND_API_KEY is not set.
//
// Body: { firstName, lastName, email, phone, grade, session }
// session: 's1' | 's2'

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, lastName, email, phone, grade, session } = req.body || {};

  // Validate required fields
  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName, and email are required.' });
  }
  if (!['s1', 's2'].includes(session)) {
    return res.status(400).json({ error: 'session must be s1 or s2.' });
  }

  const timestamp = Date.now();
  const key = `registrations:${session}:${timestamp}`;

  const record = {
    firstName: firstName.trim(),
    lastName:  lastName.trim(),
    email:     email.trim(),
    phone:     (phone || '').trim(),
    grade:     grade || '',
    session,
    registeredAt: new Date(timestamp).toISOString(),
  };

  try {
    // 1. Save registration to KV
    await kv.set(key, record);

    // 2. Decrement available spots in KV (best-effort — don't fail the request if this errors)
    try {
      const spotData = await kv.hgetall(`spots:${session}`);
      if (spotData && spotData.available !== undefined) {
        const current = parseInt(spotData.available);
        if (!isNaN(current) && current > 0) {
          await kv.hset(`spots:${session}`, { available: current - 1 });
        }
      }
    } catch (_) {
      // Spot decrement failed — not fatal
    }

    // 3. Send email notification (best-effort — no RESEND_API_KEY = silent skip)
    if (process.env.RESEND_API_KEY) {
      const sessionLabel = session === 's1'
        ? 'Session 1: Grades 4th–8th (10:00 AM – 12:00 PM)'
        : 'Session 2: High School Division (12:00 PM – 1:30 PM)';

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'California Athletic Academy <onboarding@resend.dev>',
            to: 'Quentincarr@gmail.com',
            subject: `New Clinic Registration — ${record.firstName} ${record.lastName}`,
            html: `
              <h2 style="color:#0C2340;font-family:Arial,sans-serif">New Registration</h2>
              <p style="font-family:Arial,sans-serif"><strong>Event:</strong> Girls Basketball Skills Clinic — November 1, 2026</p>
              <p style="font-family:Arial,sans-serif"><strong>Athlete:</strong> ${record.firstName} ${record.lastName}</p>
              <p style="font-family:Arial,sans-serif"><strong>Session:</strong> ${sessionLabel}</p>
              <p style="font-family:Arial,sans-serif"><strong>Grade:</strong> ${record.grade || 'Not specified'}</p>
              <p style="font-family:Arial,sans-serif"><strong>Parent Email:</strong> ${record.email}</p>
              <p style="font-family:Arial,sans-serif"><strong>Parent Phone:</strong> ${record.phone || 'Not provided'}</p>
              <hr style="border:1px solid #eee;margin:16px 0">
              <p style="font-family:Arial,sans-serif;font-size:12px;color:#666">Registered at ${record.registeredAt}</p>
            `,
          }),
        });
      } catch (_) {
        // Email failed — not fatal; registration is already saved to KV
      }
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: err.message || 'Registration failed. Please try again.' });
  }
}
