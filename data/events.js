// ─────────────────────────────────────────────────────────────────────────────
// California Athletic Academy — Event Configuration
// Add a new event here and it automatically appears everywhere on the site.
// No other files need to be edited.
// ─────────────────────────────────────────────────────────────────────────────

export const events = [
  {
    // ── Identity ──────────────────────────────────────────────────────────────
    id:       "clinic-nov-2026",
    slug:     "clinic",                          // → californiaathleticacademy.com/clinic
    name:     "Girls Basketball Skills Clinic",
    subtitle: "Free Community Event",
    badge:    "100% Free — No Cost to Attend",

    // ── Date & Location ───────────────────────────────────────────────────────
    date:        "2026-11-01",                   // ISO — used for sorting / expiry
    displayDate: "Sunday, November 1, 2026",
    location:    "Rowland High School Gymnasium",
    locationDetail: "Rowland Heights, CA",

    // ── Feature Toggles (flip without touching any other file) ───────────────
    allowRSVP:        true,
    allowFundraising: true,
    allowMerch:       false,                     // flip when Printful is connected

    // ── Sessions ──────────────────────────────────────────────────────────────
    sessions: [
      {
        id:    "s1",
        label: "Session 1",
        grade: "Grades 4th – 8th",
        time:  "10:00 AM – 12:00 PM",
      },
      {
        id:    "s2",
        label: "Session 2",
        grade: "High School Division",
        time:  "12:00 PM – 2:00 PM",
      },
    ],

    // ── Fees (0 = free) ───────────────────────────────────────────────────────
    fees: {
      registration:     0,
      earlyBird:        null,   // e.g. 50  — set a number to enable
      earlyBirdDeadline: null,  // e.g. "2026-10-15"
      stripeLink:       null,   // Stripe Payment Link for paid events
    },

    // ── Fundraising ───────────────────────────────────────────────────────────
    fundraising: {
      goal:        500,
      amounts:     [25, 50, 100],
      // Stripe Payment Link — custom amount, min $1, preset $25
      // Currently sandbox/test mode. Replace with live link when ready.
      stripeLink:  "https://buy.stripe.com/test_7sY4gA6pR85kauWaVggUM04",
      heading:     "Support California Athletic Academy",
      description: "Help cover training costs, gear, and clinic fees for our athletes. Every contribution makes a difference.",
    },

    // ── Merch (populate when Printful is ready) ───────────────────────────────
    merch: {
      items: [
        // { name: "CAA Hoodie", price: 45, printfulId: "", image: "" },
        // { name: "CAA Cap",    price: 22, printfulId: "", image: "" },
      ],
    },

    // ── Notifications ─────────────────────────────────────────────────────────
    emailTo: "Quentincarr@gmail.com",
  },

  // ── ADD FUTURE EVENTS BELOW ─────────────────────────────────────────────────
  // {
  //   id:       "camp-spring-2027",
  //   slug:     "camp",
  //   name:     "Spring Training Camp",
  //   subtitle: "Competitive Skills Development",
  //   badge:    "Limited Enrollment",
  //   date:     "2027-03-15",
  //   displayDate: "Saturday, March 15, 2027",
  //   location: "Rowland High School Gymnasium",
  //   locationDetail: "Rowland Heights, CA",
  //   allowRSVP:        true,
  //   allowFundraising: true,
  //   allowMerch:       true,
  //   sessions: [
  //     { id: "s1", label: "Full Day", grade: "Grades 6th – 12th", time: "9:00 AM – 4:00 PM" },
  //   ],
  //   fees: {
  //     registration:      75,
  //     earlyBird:         50,
  //     earlyBirdDeadline: "2027-02-15",
  //     stripeLink:        "https://buy.stripe.com/...",
  //   },
  //   fundraising: {
  //     goal:        250,
  //     amounts:     [50, 100, 150],
  //     stripeLink:  "https://buy.stripe.com/...",
  //     heading:     "Help Send an Athlete to Camp",
  //     description: "Contributions go toward camp fees and gear for athletes who need support.",
  //   },
  //   merch: { items: [] },
  //   emailTo: "Quentincarr@gmail.com",
  // },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (used by API functions — do not edit)
// ─────────────────────────────────────────────────────────────────────────────

export function getEventBySlug(slug) {
  return events.find(e => e.slug === slug) || null;
}

export function getEventById(id) {
  return events.find(e => e.id === id) || null;
}

export function getUpcomingEvents() {
  const now = new Date();
  return events
    .filter(e => new Date(e.date) >= now)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}
