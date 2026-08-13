/**
 * See All AI investor-contact handler - Cloudflare Pages Function
 * Route: /api/lead
 * Adapted from the ShopMora reference implementation.
 * Rule: NEVER fake success. Every failure returns a real error page with a
 * human fallback (info@seeall.ai), sets X-Lead-Error, and logs.
 * Backend failures return 424, never 5xx (Cloudflare replaces 5xx bodies).
 * Env (Pages > Settings > Variables and secrets): RESEND_API_KEY (Secret), LEAD_TO, LEAD_FROM.
 * Without them, this endpoint honestly reports the form as not yet configured.
 */

const FORM = {
  subject: 'New investor inquiry - See All AI site',
  thankYou: '/thank-you',
  required: ['name', 'email', 'message'],
  autoSubject: 'We received your message - See All AI',
  autoBody: function (d) {
    return 'Hi ' + d.name + ',\n\n' +
      'Thank you for your interest in See All AI. Your message has been received and a member of our team will be in touch.\n\n' +
      'See All AI\nNashua, New Hampshire\ninfo@seeall.ai\nhttps://www.seeall.ai';
  }
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s == null ? '' : s).trim());
}

function page(title, heading, msg, status, detail) {
  const html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<title>' + esc(title) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,400;6..12,700;6..12,800&display=swap" rel="stylesheet">' +
    '<style>body{font-family:"Nunito Sans",Arial,sans-serif;background:#042333;color:#fff;' +
    'display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;line-height:1.6}' +
    '.box{max-width:540px;text-align:center}h1{font-size:2.2rem;font-weight:800;margin:0 0 14px;line-height:1.15}' +
    'p{color:rgba(255,255,255,.85);margin:0 0 22px}a.inline{color:#80cc28;font-weight:700}' +
    'a.btn{display:inline-block;background:#80cc28;color:#042333;padding:14px 28px;border-radius:8px;' +
    'text-decoration:none;font-weight:800}</style></head><body><div class="box">' +
    '<h1>' + esc(heading) + '</h1><p>' + esc(msg) + '</p>' +
    '<p>You can always reach us directly at <a class="inline" href="mailto:info@seeall.ai">info@seeall.ai</a>.</p>' +
    '<a class="btn" href="/#contact">Back to the site</a></div></body></html>';
  const headers = { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' };
  if (detail) headers['X-Lead-Error'] = String(detail).replace(/[\r\n]+/g, ' ').slice(0, 300);
  return new Response(html, { status: status, headers: headers });
}

function errorPage(msg, status, detail) {
  return page('Message not sent - See All AI', 'That did not send.', msg, status, detail);
}

async function sendViaResend(env, payload) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + text.slice(0, 200));
  return text;
}

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const env = context.env || {};

    if (!env.RESEND_API_KEY || !env.LEAD_TO || !env.LEAD_FROM) {
      console.error('lead: NOT CONFIGURED (missing RESEND_API_KEY / LEAD_TO / LEAD_FROM)');
      return errorPage('Our contact form is not accepting messages yet.', 424, 'not configured');
    }

    let data;
    try {
      const ct = request.headers.get('content-type') || '';
      if (ct.indexOf('application/json') !== -1) data = await request.json();
      else data = Object.fromEntries(await request.formData());
    } catch (e) {
      return errorPage('We could not read that submission.', 400, 'parse: ' + e.message);
    }

    const missing = FORM.required.filter(function (f) {
      return !String(data[f] == null ? '' : data[f]).trim();
    });
    if (missing.length) {
      return errorPage('Please fill in: ' + missing.join(', ') + '.', 400, 'missing: ' + missing.join(','));
    }
    if (!isEmail(data.email)) {
      return errorPage('That email address does not look right.', 400, 'bad email');
    }

    const clean = {};
    Object.keys(data).forEach(function (k) { if (k.charAt(0) !== '_') clean[k] = data[k]; });

    try {
      const rows = Object.keys(clean).map(function (k) {
        return '<tr><td style="padding:8px 14px;border:1px solid #cfd8dc;font-weight:700;text-transform:capitalize">' +
          esc(k) + '</td><td style="padding:8px 14px;border:1px solid #cfd8dc">' + esc(clean[k]) + '</td></tr>';
      }).join('');
      await sendViaResend(env, {
        from: env.LEAD_FROM,
        to: [env.LEAD_TO],
        reply_to: String(data.email).trim(),
        subject: FORM.subject,
        html: '<div style="font-family:system-ui,sans-serif;color:#042333">' +
          '<h2>New investor inquiry</h2>' +
          '<table style="border-collapse:collapse;margin:16px 0">' + rows + '</table>' +
          '<p style="color:#546e7a;font-size:12px">' + esc(new Date().toISOString()) + '</p></div>'
      });
    } catch (e) {
      console.error('lead: NOTIFICATION FAILED', e && e.message);
      return errorPage('We could not deliver your message just now.', 424, e && e.message);
    }

    try {
      await sendViaResend(env, {
        from: env.LEAD_FROM,
        to: [String(data.email).trim()],
        reply_to: env.LEAD_TO,
        subject: FORM.autoSubject,
        text: FORM.autoBody(data)
      });
    } catch (e) {
      console.error('lead: AUTORESPONSE FAILED (lead still captured)', e && e.message);
    }

    return new Response(null, { status: 303, headers: { Location: FORM.thankYou, 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('lead: UNHANDLED', e && e.stack);
    return errorPage('Something broke on our end.', 424, 'unhandled: ' + (e && e.message));
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const env = context.env || {};

  if (url.searchParams.get('selftest') === '1') {
    if (!env.RESEND_API_KEY || !env.LEAD_TO || !env.LEAD_FROM) {
      return new Response('SELFTEST: NOT CONFIGURED (missing RESEND_API_KEY / LEAD_TO / LEAD_FROM)', {
        status: 424, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
      });
    }
    const started = Date.now();
    try {
      const r = await sendViaResend(env, {
        from: env.LEAD_FROM,
        to: [env.LEAD_TO],
        subject: 'See All AI site selftest (/api/lead?selftest=1)',
        text: 'Selftest of the investor-contact delivery path. Timestamp: ' + new Date().toISOString()
      });
      return new Response('SELFTEST OK in ' + (Date.now() - started) + 'ms\n' + r, {
        status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
      });
    } catch (e) {
      return new Response('SELFTEST FAILED after ' + (Date.now() - started) + 'ms\n' + (e && e.message), {
        status: 424, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
      });
    }
  }

  return new Response('See All AI lead endpoint is alive. POST only.', {
    status: 405, headers: { 'Content-Type': 'text/plain', Allow: 'POST' }
  });
}
