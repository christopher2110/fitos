/**
 * lib/email/templates.js — HTML email templates for the trial drip sequence
 *
 * Owns: rendering each email step's HTML and plain-text body.
 * Does NOT: sending, scheduling, or tracking email state.
 *
 * Brand: olive green (#4a5c3a), cream (#f5f0e8), Fraunces + DM Sans.
 * All templates include an unsubscribe footer (compliance requirement).
 */

const APP_URL = process.env.APP_URL || 'https://fitos-zc11.polsia.app';
const STRIPE_URL = 'https://buy.stripe.com/eVq5kD5iPaEj2kk2mYfAc02';
const GITHUB_URL = 'https://github.com/Polsia-Inc/fitos';
const REPLY_TO = 'fitos@polsia.app';

// Shared inline styles
const STYLES = {
  wrapper: 'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Georgia, sans-serif; background: #f5f0e8; padding: 32px 16px; min-height: 100vh;',
  card: 'background: #ffffff; max-width: 560px; margin: 0 auto; border-radius: 16px; padding: 40px 40px 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.07);',
  logo: 'font-size: 22px; font-weight: 700; color: #4a5c3a; letter-spacing: -0.5px; margin: 0 0 32px;',
  heading: 'font-size: 24px; font-weight: 700; color: #2c2c2c; line-height: 1.3; margin: 0 0 16px;',
  body: 'font-size: 15px; color: #444; line-height: 1.7; margin: 0 0 20px;',
  ctaPrimary: 'display: inline-block; background: #4a5c3a; color: #f5f0e8; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-size: 15px; font-weight: 600; margin: 8px 0;',
  ctaSecondary: 'display: inline-block; border: 1.5px solid #4a5c3a; color: #4a5c3a; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-size: 14px; font-weight: 500; margin: 8px 0;',
  highlight: 'background: #f0f4eb; border-left: 3px solid #4a5c3a; border-radius: 6px; padding: 14px 18px; font-size: 14px; color: #4a5c3a; font-weight: 500; margin: 20px 0;',
  divider: 'border: none; border-top: 1px solid #eee; margin: 28px 0;',
  footer: 'font-size: 12px; color: #aaa; margin-top: 28px; line-height: 1.6; text-align: center;',
  footerLink: 'color: #888; text-decoration: underline;',
};

function unsubscribeFooter(unsubscribeUrl) {
  return `
<hr style="${STYLES.divider}">
<p style="${STYLES.footer}">
  FitOS · <a href="mailto:${REPLY_TO}" style="${STYLES.footerLink}">${REPLY_TO}</a><br>
  <a href="${unsubscribeUrl}" style="${STYLES.footerLink}">Unsubscribe</a> from this sequence
</p>`;
}

function wrap(content, unsubscribeUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="${STYLES.wrapper}">
  <div style="${STYLES.card}">
    <p style="${STYLES.logo}">FitOS</p>
    ${content}
    ${unsubscribeFooter(unsubscribeUrl)}
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Day 0 — Welcome + setup wizard
// ---------------------------------------------------------------------------
function day0({ name, unsubscribeUrl }) {
  const greeting = name ? name.split(' ')[0] : 'Coach';
  const setupUrl = `${APP_URL}/setup`;

  const html = wrap(`
    <h1 style="${STYLES.heading}">Your FitOS trial is live — let's get your first client in.</h1>
    <p style="${STYLES.body}">
      Hey ${greeting}, you're set. 14 days to see if FitOS fits the way you coach.
    </p>
    <p style="${STYLES.body}">
      First step: connect your Google Sheet. It takes under 3 minutes and that Sheet becomes
      the source of truth for everything — workouts, check-ins, progress photos, AI programs.
      <strong>You own the data. Always.</strong>
    </p>
    <div style="${STYLES.highlight}">
      ✓ Your data lives in your Google Sheet — not our servers.<br>
      ✓ Cancel anytime. The Sheet stays yours.
    </div>
    <a href="${setupUrl}" style="${STYLES.ctaPrimary}">Set up your Sheet →</a>
    <p style="${STYLES.body}" style="margin-top: 20px;">
      Questions? Just reply to this email.
    </p>
  `, unsubscribeUrl);

  const text = `Your FitOS trial is live.

Hey ${greeting},

You're set. 14 days to see if FitOS fits the way you coach.

First step: connect your Google Sheet: ${setupUrl}

It takes under 3 minutes. The Sheet is yours — your data doesn't live on our servers.

Questions? Reply here.

— FitOS`;

  return {
    subject: "Your FitOS trial is live — let's get your first client in.",
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Day 3 — AI Program Builder spotlight
// ---------------------------------------------------------------------------
function day3({ name, unsubscribeUrl }) {
  const greeting = name ? name.split(' ')[0] : 'Coach';
  const builderUrl = `${APP_URL}/dashboard/agents/builder`;

  const html = wrap(`
    <h1 style="${STYLES.heading}">Try this: "Build me a 4-week hypertrophy block."</h1>
    <p style="${STYLES.body}">
      Hey ${greeting}, day 3. Have you tried the AI Program Builder yet?
    </p>
    <p style="${STYLES.body}">
      Open the Builder, type what you'd say to a colleague, and watch it generate
      a full structured program with weeks, days, and exercises — then assign it to a client
      in one click. It writes directly to their Sheet.
    </p>
    <div style="${STYLES.highlight}">
      "Build me a 12-week powerlifting peaking cycle for an intermediate lifter."<br>
      "Give me a 3-day full-body program for a busy mom, 45-minute sessions."
    </div>
    <a href="${builderUrl}" style="${STYLES.ctaPrimary}">Open the Program Builder →</a>
    <p style="${STYLES.body}" style="margin-top: 16px;">
      It uses your own Anthropic API key — no markup, no tokens counted against us.
      Bring your own key, keep full control.
    </p>
  `, unsubscribeUrl);

  const text = `Try this: "Build me a 4-week hypertrophy block."

Hey ${greeting},

Day 3. Have you tried the AI Program Builder?

Open it, describe what you need, and it generates a full structured program — then assigns it to a client in one click. Writes directly to their Sheet.

Try it here: ${builderUrl}

It uses your own Anthropic key. No markup.

— FitOS`;

  return {
    subject: 'Try this: "Build me a 4-week hypertrophy block."',
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Day 7 — Mid-trial: Client Calendar + Results
// ---------------------------------------------------------------------------
function day7({ name, unsubscribeUrl }) {
  const greeting = name ? name.split(' ')[0] : 'Coach';
  const calendarUrl = `${APP_URL}/dashboard`;
  const resultsUrl = `${APP_URL}/dashboard`;

  const html = wrap(`
    <h1 style="${STYLES.heading}">Your clients see their progress. You see everything.</h1>
    <p style="${STYLES.body}">
      Hey ${greeting}, halfway through. Two features worth spending time on today:
    </p>
    <p style="${STYLES.body}">
      <strong>Client Calendar</strong> — program days plotted on real dates anchored to each
      client's start date. Coaches can mark workouts complete or reschedule from the calendar
      view. Clients see exactly where they are in the program.
    </p>
    <p style="${STYLES.body}">
      <strong>Client Results</strong> — bodyweight trend (90 days), wellness scores (30 days),
      circumference measurements (12 weeks), lift progression, photo comparison with delta cards.
      Everything a client needs to see they're making progress. Everything you need to show your value.
    </p>
    <div style="${STYLES.highlight}">
      Open any client → Calendar tab or Results tab (📊)
    </div>
    <a href="${calendarUrl}" style="${STYLES.ctaPrimary}">Go to dashboard →</a>
  `, unsubscribeUrl);

  const text = `Your clients see their progress. You see everything.

Hey ${greeting},

Halfway through. Two features worth trying:

Client Calendar — program days on real dates. Mark complete or reschedule. Clients know exactly where they are.

Client Results — bodyweight, wellness, circumferences, lifts, photo comparison. Show your clients they're progressing.

Open any client → Calendar tab or Results (📊) tab: ${calendarUrl}

— FitOS`;

  return {
    subject: 'Your clients see their progress. You see everything.',
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Day 12 — Countdown: 2 days left
// ---------------------------------------------------------------------------
function day12({ name, unsubscribeUrl }) {
  const greeting = name ? name.split(' ')[0] : 'Coach';
  const pricingUrl = `${APP_URL}/pricing`;
  const vsUrl = `${APP_URL}/vs/trainerize`;

  const html = wrap(`
    <h1 style="${STYLES.heading}">2 days left — $497 once, then $7/mo hosted or free self-host.</h1>
    <p style="${STYLES.body}">
      Hey ${greeting}, your trial ends in 2 days.
    </p>
    <p style="${STYLES.body}">
      Two choices when it does:
    </p>
    <p style="${STYLES.body}">
      <strong>Buy the lifetime license — $497 once.</strong> Includes 3 months of free managed hosting.
      Month 4 onward: $7/mo if you want us to keep running it. Or self-host free any time — MIT licensed.
    </p>
    <a href="${STRIPE_URL}" style="${STYLES.ctaPrimary}">Buy FitOS — $497 Lifetime →</a>
    <p style="${STYLES.body}" style="margin-top: 16px;">
      <strong>Self-deploy for free.</strong> FitOS is open source. Clone the repo, deploy to
      your own Render account, connect your own Sheet. Free forever — you just run it yourself.
    </p>
    <a href="${GITHUB_URL}" style="${STYLES.ctaSecondary}">Self-deploy on GitHub →</a>
    <div style="${STYLES.highlight}" style="margin-top: 20px;">
      Either way, your Google Sheet data is yours. Nothing disappears.
    </div>
    <p style="${STYLES.body}" style="margin-top: 16px; font-size: 13px;">
      See the full pricing breakdown: <a href="${pricingUrl}" style="color: #4a5c3a;">${pricingUrl}</a><br>
      How we compare to Trainerize: <a href="${vsUrl}" style="color: #4a5c3a;">${vsUrl}</a>
    </p>
  `, unsubscribeUrl);

  const text = `2 days left — $497 + $7/mo hosted (month 4+) or self-deploy free.

Hey ${greeting},

Your trial ends in 2 days. Two choices:

1. Buy the lifetime license — $497 once. Includes 3 months free hosting. Then $7/mo month 4+ (or self-host free).
   ${STRIPE_URL}

2. Self-deploy free — open source, your own Render account, your own Sheet.
   ${GITHUB_URL}

Either way, your Sheet data is yours.

See full pricing: ${pricingUrl}
How we compare: ${vsUrl}

— FitOS`;

  return {
    subject: '2 days left — $497 lifetime + $7/mo hosted (month 4+) or self-host free.',
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Day 14 — Last chance
// ---------------------------------------------------------------------------
function day14({ name, unsubscribeUrl }) {
  const greeting = name ? name.split(' ')[0] : 'Coach';

  const html = wrap(`
    <h1 style="${STYLES.heading}">Trial ends today. Your data is yours either way.</h1>
    <p style="${STYLES.body}">
      Hey ${greeting}, today's the last day.
    </p>
    <p style="${STYLES.body}">
      If FitOS worked for you — buy it. One payment, no recurring fees, no expiration.
    </p>
    <a href="${STRIPE_URL}" style="${STYLES.ctaPrimary}">Buy FitOS — $497 Lifetime →</a>
    <p style="${STYLES.body}" style="margin-top: 16px;">
      If you'd rather run it yourself — it's open source and always will be.
    </p>
    <a href="${GITHUB_URL}" style="${STYLES.ctaSecondary}">Self-deploy on GitHub →</a>
    <div style="${STYLES.highlight}" style="margin-top: 20px;">
      ✓ Your Google Sheet data stays in your Sheet regardless.<br>
      ✓ No data deleted. No lock-in.
    </div>
    <p style="${STYLES.body}" style="margin-top: 16px; font-size: 14px; color: #888;">
      Questions? Just reply — someone will respond.
    </p>
  `, unsubscribeUrl);

  const text = `Trial ends today. Your data is yours either way.

Hey ${greeting},

Today's the last day.

If FitOS worked — buy it. One payment, no recurring fees.
${STRIPE_URL}

Or self-deploy free:
${GITHUB_URL}

Your Google Sheet data stays yours regardless.

Questions? Reply here.

— FitOS`;

  return {
    subject: 'Trial ends today. Your data is yours either way.',
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Day 16 — Win-back (post-expiry)
// ---------------------------------------------------------------------------
function day16({ name, unsubscribeUrl }) {
  const greeting = name ? name.split(' ')[0] : 'Coach';

  const html = wrap(`
    <h1 style="${STYLES.heading}">Still on the fence? Reply with what's missing.</h1>
    <p style="${STYLES.body}">
      Hey ${greeting}.
    </p>
    <p style="${STYLES.body}">
      Your trial ended a couple days ago. If you didn't buy, something didn't land — and
      that's useful information.
    </p>
    <p style="${STYLES.body}">
      Hit reply and tell me what was missing. Too expensive? Missing a feature? Didn't
      have time to try it properly? I read every reply.
    </p>
    <p style="${STYLES.body}">
      If you're ready to get it and just needed a nudge — here's the link:
    </p>
    <a href="${STRIPE_URL}" style="${STYLES.ctaPrimary}">Buy FitOS — $497 Lifetime →</a>
    <p style="${STYLES.body}" style="margin-top: 16px;">
      Or self-deploy free if you'd rather own the infra:
    </p>
    <a href="${GITHUB_URL}" style="${STYLES.ctaSecondary}">GitHub →</a>
  `, unsubscribeUrl);

  const text = `Still on the fence? Reply with what's missing.

Hey ${greeting},

Your trial ended. If you didn't buy, something didn't land.

Reply and tell me what was missing — too expensive, missing a feature, didn't have time. I read every reply.

Ready to get it: ${STRIPE_URL}

Or self-deploy free: ${GITHUB_URL}

— FitOS`;

  return {
    subject: "Still on the fence? Reply with what's missing.",
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Email step definitions: name → { dayOffset, template, skipIfConverted }
// ---------------------------------------------------------------------------
// dayOffset is days since trial creation (created_at).
// skipIfConverted: don't send if coach already paid.
const DRIP_STEPS = [
  { step: 'day0',  dayOffset: 0,  template: day0,  skipIfConverted: false },
  { step: 'day3',  dayOffset: 3,  template: day3,  skipIfConverted: true  },
  { step: 'day7',  dayOffset: 7,  template: day7,  skipIfConverted: true  },
  { step: 'day12', dayOffset: 12, template: day12, skipIfConverted: true  },
  { step: 'day14', dayOffset: 14, template: day14, skipIfConverted: true  },
  { step: 'day16', dayOffset: 16, template: day16, skipIfConverted: true  },
];

module.exports = { DRIP_STEPS };
