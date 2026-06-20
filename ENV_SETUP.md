# VideoSLK Bot — Required Environment Variables

Copy these into `bot/.env`. Restart the bot after any change.

```ini
# ===== Telegram bot core =====
BOT_TOKEN=123456:ABC-DEF...           # From @BotFather
ADMIN_ID=1234567890                   # Your Telegram user ID (numeric)

# ===== Channels =====
# Free channel — auto-receives 5-8s preview clip + website link
FREE_CHANNEL_ID=-1001234567890        # numeric, NOT @username
FREE_CHANNEL_USERNAME=ukussafree69    # without the @

# Premium channel — auto-receives the FULL video (silent, no ads)
PREMIUM_CHANNEL_ID=-1009876543210     # numeric, NOT @username
PREMIUM_CHANNEL_USERNAME=ukussa_vip_sl
PREMIUM_INVITE_LINK=https://t.me/+abc...   # single-use or join-request link
PREMIUM_STARS_PRICE=150                     # Telegram Stars for lifetime access

# ===== GitHub (site deploys) =====
GITHUB_TOKEN=ghp_xxxxxxxx             # fine-grained PAT: Contents read+write on ONE repo only
GITHUB_REPO=rajivkenzo23/VideoLK
GITHUB_BRANCH=main

# ===== Site =====
SITE_URL=https://videoslk.eu.cc
BOT_LINK=https://t.me/ukussa_69_bot

# ===== Anti-bypass: HMAC unlock token =====
# Set the SAME 32+ character random string here AND in Cloudflare Pages → Settings → Env Variables (UNLOCK_HMAC_SECRET).
# Generate one:    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
UNLOCK_HMAC_SECRET=replace-with-32-char-random-hex
UNLOCK_TOKEN_MAX_AGE_SEC=600

# ===== Cloudflare Turnstile (optional — if set, embeds widget on watch pages) =====
TURNSTILE_SITE_KEY=                   # public — also set TURNSTILE_SECRET on Cloudflare side

# ===== Optional tuning =====
FREE_CHANNEL_POST_DELAY_MS=60000      # wait after site publish before posting preview
```

## Smoke test

Run before deploying after changes:
```bash
node scripts/smoketest.js
# or
npm test
```
Expected: `35 passed, 0 failed`. Validates module wiring, token format, slug capping, channel CRUD, tag generation, broadcaster.

## Cloudflare Pages — environment variables

In the Cloudflare dashboard → Pages → your project → Settings → Environment variables → Production:

| Variable | Value |
|---|---|
| `UNLOCK_HMAC_SECRET` | **Same value as the bot's `.env`** |
| `BOT_URL` | `https://t.me/ukussa_69_bot` |
| `ADMIN_API_KEY` | Long random string. Use this to log in at `/admin/`. |
| `SPONSORS_T1` | `["https://...adsterra-tier1...","https://...alt..."]` |
| `SPONSORS_T2` | `["https://omg10.com/4/10712300","https://omg10.com/4/10695679"]` |
| `SPONSORS_T3` | `["https://omg10.com/4/10712300","https://omg10.com/4/10695679"]` |

Generate strong values:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

KV bindings (Cloudflare Pages → Settings → Functions → KV namespace bindings):
- `CLICK_KV` — counts daily clicks per tier/ref/country/video (drives the admin dashboard).
- `RATE_KV` — IP-level rate-limit on `/api/unlock`.
- `CHALLENGE_KV` — **required** for strict click verification. Stores "consumed" markers proving each sponsor click was actually taken before /api/unlock will issue a token.

Optional Pages env (additional hardening):
| Variable | What it does |
|---|---|
| `TURNSTILE_SECRET` | Server-side Turnstile secret. If set, /api/unlock requires a valid `ts` token in body. |
| `STRICT_CLICK_VERIFY` | Set to `0` to bypass /api/c challenge verification (legacy migration only). Default: enabled. |
| `STRICT_ADBLOCK_GATE` | Set to `0` to allow /api/unlock without the `vslk_adok=1` cookie. Default: enabled. |

## Admin dashboard

After deploy: visit `https://videoslk.eu.cc/admin/` → enter `ADMIN_API_KEY`. Shows daily clicks, geo tier mix, top channels, top countries, top videos, and bot snapshot.

## Bot — multi-channel commands

| Command | What it does |
|---|---|
| `/addchannel @name niche=funny delay=90 style=short` | Add a free channel; bot must already be admin there |
| `/addchannel` then forward a post from the channel | Easier — auto-detects the channel ID |
| `/listchannels` | All registered channels with per-ref delivery stats |
| `/togglechannel <id>` | Enable/disable a channel without removing it |
| `/removechannel <id>` | Remove a channel |
| `/premium` | Send Stars invoice (test as admin too) |

## Telegram Stars setup

1. Talk to @BotFather → `/mybots` → your bot → Payments → enable Telegram Stars.
2. Create the premium channel.
3. Bot must be an **admin** of the premium channel (Post Messages permission).
4. Set `PREMIUM_CHANNEL_ID` to the negative-prefixed numeric ID (use `@RawDataBot` to get it).
5. Set `PREMIUM_INVITE_LINK` to either:
   - A join-request link (best — you approve each Star-paying user), OR
   - A multi-use invite link (auto-join).
