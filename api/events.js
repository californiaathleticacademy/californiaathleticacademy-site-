// GET /api/events
// Returns event config for the site.
// ?slug=clinic  → single event (full config)
// (no params)   → all upcoming events (public summary fields only)

import { getEventBySlug, getUpcomingEvents } from '../data/events.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.query;

  if (slug) {
    const event = getEventBySlug(slug);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Return full config (server-side only — never expose emailTo to client)
    const { emailTo, ...publicEvent } = event;
    return res.status(200).json(publicEvent);
  }

  // Summary list for the homepage events section
  const upcoming = getUpcomingEvents().map(e => ({
    id:               e.id,
    slug:             e.slug,
    name:             e.name,
    subtitle:         e.subtitle,
    badge:            e.badge,
    date:             e.date,
    displayDate:      e.displayDate,
    location:         e.location,
    allowRSVP:        e.allowRSVP,
    allowFundraising: e.allowFundraising,
    allowMerch:       e.allowMerch,
  }));

  return res.status(200).json(upcoming);
}
