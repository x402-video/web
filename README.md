# x402-video.com — web storefront

Public storefront for the **x402 Video Gateway**: pay-per-call AI video generation over the
[x402 payment protocol](https://docs.x402.org), settled in USDC on Base.
No accounts, no API keys: `HTTP 402 → pay → generate`.

**New buyer? Start here → [GETTING-STARTED.md](GETTING-STARTED.md)** — zero to
first video in 5 minutes (create a spending wallet, fund USDC on Base, pay per call).

This is a single static page, no build step:

- `index.html` — fetches the live SKU table from the gateway's `GET /` and live stats from
  `GET /status`. Falls back to reference prices when the gateway is unreachable.
  Point it at any gateway with `?api=https://your-gateway`.
- `llms.txt` — static pointer for agents; the canonical, always-in-sync version is served
  by the gateway itself at `/llms.txt`.
- `examples/` — minimal buyer code.

## Run locally

```bash
python3 -m http.server 8080   # or any static server
open "http://localhost:8080/?api=http://localhost:3000"
```

## Deploy

Any static host (GitHub Pages / Cloudflare Pages / Railway). Canonical domain: `x402-video.com`,
gateway at `api.x402-video.com`.

## Content policy

Prompts are screened before payment — rejected requests are never charged. Hard red lines:
content involving minors, real-person likeness/deepfakes. Sexually explicit content and
graphic violence are rejected.

This is an independent gateway. Not affiliated with or endorsed by model vendors.
