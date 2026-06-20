/* ============================================
   VideoSLK Bot — Unlock Token Validator
   Mirrors functions/api/unlock.js.

   Token wire format (URL-safe, fits Telegram /start 64-char limit):
     "<slug>_<exp36>[_<ref>]_<sig>"
   Signed payload (for HMAC, NOT on wire):
     "<slug>|<exp36>|<ref|''>"
   sig = first 12 chars of base64url(HMAC-SHA256(secret, signedPayload))
   ============================================ */

const crypto = require('crypto');
const { config } = require('../config');

// Sig is hex (only [0-9a-f]) so it can never collide with the '_' field separator.
const SIG_LEN = 16;

function validateUnlockToken(token) {
  const secret = config.unlockHmacSecret;
  if (!secret || secret.length < 16) {
    return { ok: false, reason: 'no_secret', videoId: null, ref: '' };
  }
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'missing_token', videoId: null, ref: '' };
  }
  if (token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, reason: 'bad_charset', videoId: null, ref: '' };
  }

  // Split into parts. We know:
  //   - last part = sig (12 chars from base64url)
  //   - first part = slug ([a-z0-9-] only, may contain hyphens — NO underscores)
  //   - middle = exp36, and optionally ref
  const parts = token.split('_');
  if (parts.length < 3 || parts.length > 4) {
    return { ok: false, reason: 'bad_format', videoId: null, ref: '' };
  }

  const sig = parts[parts.length - 1];
  const slug = parts[0];
  let exp36, ref;
  if (parts.length === 3) { exp36 = parts[1]; ref = ''; }
  else { exp36 = parts[1]; ref = parts[2]; }

  if (sig.length !== SIG_LEN || !/^[0-9a-f]+$/.test(sig)) return { ok: false, reason: 'bad_sig_format', videoId: slug, ref };
  if (!/^[a-z0-9-]+$/.test(slug)) return { ok: false, reason: 'bad_slug', videoId: slug, ref };
  if (!/^[a-z0-9]+$/.test(exp36)) return { ok: false, reason: 'bad_exp', videoId: slug, ref };
  if (ref && !/^[a-z0-9_-]{1,8}$/.test(ref)) return { ok: false, reason: 'bad_ref', videoId: slug, ref };

  const expSec = parseInt(exp36, 36);
  if (!expSec || isNaN(expSec)) return { ok: false, reason: 'bad_exp_value', videoId: slug, ref };
  const now = Math.floor(Date.now() / 1000);
  const maxAge = config.unlockTokenMaxAgeSec || 600;
  if (expSec < now) return { ok: false, reason: 'expired', videoId: slug, ref };
  if (expSec > now + maxAge + 60) return { ok: false, reason: 'exp_too_far', videoId: slug, ref };

  const signedPayload = `${slug}|${exp36}|${ref}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex').slice(0, SIG_LEN);

  if (!timingSafeEq(sig, expected)) {
    return { ok: false, reason: 'bad_sig', videoId: slug, ref };
  }
  return { ok: true, videoId: slug, ref };
}

function timingSafeEq(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

// Detect whether a /start param looks like a token vs a legacy raw slug.
// New tokens always contain at least 2 underscores; raw slugs never contain underscores.
function looksLikeToken(s) {
  if (!s) return false;
  if (s.length < 20) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return false;
  return s.split('_').length >= 3;
}

module.exports = { validateUnlockToken, looksLikeToken };
