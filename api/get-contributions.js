// GET /api/get-contributions
// Returns per-player contribution totals from Stripe.
// Password-protected — requires ?password=ADMIN_PASSWORD in query.
// Requires: STRIPE_SECRET_KEY, ADMIN_PASSWORD in Vercel env vars.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.query;
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(500).json({ error: 'Stripe is not configured.' });
  }

  try {
    // Search completed Stripe Checkout sessions with our metadata
    // We page through up to 200 sessions to build the totals
    const players = {};
    let hasMore = true;
    let startingAfter = null;
    let pageCount = 0;

    while (hasMore && pageCount < 4) { // max 4 pages = 400 sessions
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

    // Sort by total descending
    const sorted = Object.entries(players)
      .map(([name, d]) => ({
        player: name,
        total:     d.total,
        count:     d.count,
        recurring: d.recurring,
        events:    d.events,
        last:      d.last,
      }))
      .sort((a, b) => b.total - a.total);

    const grandTotal = sorted.reduce((s, p) => s + p.total, 0);

    return res.status(200).json({ players: sorted, grandTotal, fetched: new Date().toISOString() });
  } catch (err) {
    console.error('get-contributions error:', err);
    return res.status(500).json({ error: 'Failed to fetch contributions.' });
  }
}
