# Buy AI video with x402 — zero to first video in 5 minutes

No account. No API key. No credit card. You create a small spending wallet,
put a few dollars of USDC on it, and your code pays per call:

```
POST /generate/...  →  HTTP 402 (exact USDC quote)  →  pay & retry  →  { job_id }  →  poll  →  video MP4
```

**What you need:** Node 20+, and ~$1 of USDC on the Base network. That's it.

---

## Step 1 — Create a spending wallet (30 seconds)

Your wallet is just a keypair generated locally — think of it as a **prepaid
card** for API calls. The private key signs payments on your machine and is
never sent anywhere.

```bash
npm i viem
npx tsx examples/create-wallet.ts
```

This prints an `address` (where you deposit USDC) and a `private key`
(what your code signs with). Keep the key in an env var or secret manager,
and only fund the wallet with what you plan to spend.

Already have a wallet (MetaMask, Coinbase Wallet, …)? You can use any EVM
key — but a dedicated low-balance wallet is safer for automation.

## Step 2 — Fund it with USDC on Base

Send USDC to your wallet address **on the Base network**:

- From Coinbase / Binance / OKX: withdraw USDC and pick **Base** as the network.
- From another wallet: a normal USDC transfer on Base.

⚠ Base, not Ethereum mainnet. **You do not need ETH** — x402 payments are
gasless for the buyer (the facilitator submits the transaction).

Pricing (live quotes at [api.x402-video.com](https://api.x402-video.com/)):

| Endpoint | Output | Price |
|---|---|---|
| `POST /generate/seedance-fast/5s-720p` | 5s 720p MP4 | ~$0.45 |
| `POST /generate/seedance/5s-720p` | 5s 720p MP4 (highest quality) | ~$0.56 |
| `POST /generate/seedance-fast/custom` | 4–15s, 480p/720p, audio… | $0.13–$2.03 |
| `POST /generate/seedance/custom` | 4–15s, up to 1080p, audio… | $0.27–$6.30 |

The HTTP 402 response always quotes the **exact** price for your request
before you pay.

## Step 3 — Buy your first video

```bash
npm i @x402/fetch @x402/evm viem
BUYER_PRIVATE_KEY=0x... npx tsx examples/buy-with-x402-fetch.ts "a corgi surfing a wave at sunset"
```

The whole client is ~20 lines ([examples/buy-with-x402-fetch.ts](examples/buy-with-x402-fetch.ts)).
The key part:

```ts
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";

const fetchPay = wrapFetchWithPayment(fetch, client); // wraps plain fetch

// fetchPay handles 402 → sign USDC payment → retry, automatically:
const res = await fetchPay("https://api.x402-video.com/generate/seedance-fast/5s-720p", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "a corgi surfing a wave at sunset" }),
});
const { job_id } = await res.json();
```

### Option B — curl (see the raw 402 flow)

Not on Node? Probe the endpoint with plain curl to see exactly what the
protocol looks like:

```bash
curl -i -X POST https://api.x402-video.com/generate/seedance-fast/5s-720p \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a corgi surfing a wave at sunset"}'
```

You'll get `HTTP/1.1 402 Payment Required` with a JSON body quoting the
exact USDC amount, the recipient, and the payment scheme (`exact`, USDC on
Base). An x402 client signs that quote (EIP-3009 — gasless for you) and
retries with an `X-PAYMENT` header; the paid response is `200 { job_id }`.
`@x402/fetch` (Option A) does the sign-and-retry automatically; for manual
signing in other languages see [docs.x402.org](https://docs.x402.org).

## Step 4 — Poll and download

Generation is async (~1–3 minutes). Poll the free status endpoint:

```bash
curl https://api.x402-video.com/jobs/<job_id>
```

Response shape:

```json
{
  "job_id": "3f6e9a3a-…",
  "sku": "seedance-fast-5s-720p",
  "status": "succeeded",
  "created_at": "2026-06-11T08:00:00.000Z",
  "updated_at": "2026-06-11T08:02:10.000Z",
  "attempts": 1,
  "video_url": "https://…",
  "video_expires_at": "2026-06-12T08:02:10.000Z",
  "seed": 1234567,
  "frames_per_second": 24,
  "error": null
}
```

`status` walks through `pending_settlement → queued → generating →
succeeded`. Two other terminal states:

- **`cancelled`** — on-chain settlement failed. Nothing was generated and
  **you were not charged**.
- **`failed`** — generation failed after payment. Contact us with your
  `job_id` (every outcome is recorded in an audit log).

When `status` is `succeeded`, download `video_url` — the link **expires
~24h** after completion (see `video_expires_at`), so store the file, not
the URL.

## Custom endpoints — full parameter reference

`/generate/seedance/custom` and `/generate/seedance-fast/custom` let you
pick duration, resolution, ratio, and audio. The 402 quote is computed from
**your** parameters, so you only pay for what you requested.

```ts
const res = await fetchPay("https://api.x402-video.com/generate/seedance/custom", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt: "a corgi surfing a wave, slow motion", // required
    duration: 8,            // integer 4–15 seconds (default 5)
    resolution: "1080p",    // seedance: "480p"|"720p"|"1080p" · fast: "480p"|"720p" (default "720p")
    ratio: "9:16",          // "16:9"|"4:3"|"1:1"|"3:4"|"9:16"|"21:9"|"adaptive" (default "adaptive")
    seed: 42,               // optional integer, -1..2^32-1 (reproducibility)
    generate_audio: true,   // optional boolean (default false; audio multiplies cost ×1.5)
    camera_fixed: false,    // optional boolean
  }),
});
```

Body validation is strict and happens **before** payment: unknown fields
are rejected, `duration` must be an explicit integer (auto-duration `-1`
is not sold — the price depends on duration), and `--flag` directives
inside the prompt are rejected too. A rejected request is never charged.

---

## Production tips

- **Idempotency**: send an `Idempotency-Key` header on POST. Retrying with
  the same key returns the original job instead of charging twice (24h TTL).
- **You are never charged for failures before generation**: prompts are
  screened *before* payment; rejected requests (403), rate limits (429), and
  capacity rejections (503) all happen pre-payment.
- **Limits**: 20 generation POSTs/min per IP, 5 in-flight jobs per wallet.
- **Machine-readable everything**: agents can discover the full catalog at
  [`/llms.txt`](https://api.x402-video.com/llms.txt),
  [`/openapi.json`](https://api.x402-video.com/openapi.json) (with `x-payment-info` pricing), and
  [`/.well-known/x402`](https://api.x402-video.com/.well-known/x402).
- **Live reliability stats**: [`/status`](https://api.x402-video.com/status) —
  success rate, p50 generation time, delivered count.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `@x402/fetch` throws an insufficient-funds error | Not enough USDC on Base in your wallet | Check the balance on [basescan.org](https://basescan.org); top up USDC **on Base** |
| Sent USDC but the wallet shows zero | Sent on the wrong network (Ethereum mainnet, etc.) | Withdraw again choosing **Base**, or bridge via [bridge.base.org](https://bridge.base.org) |
| Job sits in `pending_settlement` | On-chain settlement takes a few seconds | Normal — keep polling |
| `status` is `cancelled` | Settlement failed | You were **not** charged; just retry the request |
| HTTP 403 before any payment | Prompt rejected by the content filter | Rewrite the prompt — you were not charged. Repeated rejections temporarily block your IP |
| HTTP 429 | >20 generation POSTs/min per IP, or >5 in-flight jobs per wallet | Back off and retry; limits reset per minute |
| HTTP 503 | Queue at capacity | Retry with exponential backoff — you were not charged |
| `npx tsx` fails with a module error | Missing `"type": "module"` in your `package.json` | Add it, or run the examples inside this repo's `web/` folder |

## FAQ

**Is my private key sent anywhere?**
No. Payments are EIP-3009 authorizations signed locally; only the signature
travels. Still, treat the wallet as a prepaid card — small balances only.

**Which chain / token?**
USDC on Base (`eip155:8453`). The 402 quote includes the exact asset and
amount; `@x402/fetch` handles the rest.

**What is x402?**
An open protocol for HTTP-native payments built on the 402 status code —
see [docs.x402.org](https://docs.x402.org). Any x402 client works with this
gateway; `@x402/fetch` is just the shortest path.

**Refunds?**
You're only charged after on-chain settlement, and generation starts only
after settlement succeeds. If generation fails permanently after payment,
contact us with your `job_id` (all outcomes are recorded in an audit log).

## Content policy

Prompts are screened before payment — rejected requests are never charged.
Hard red lines: content involving minors, real-person likeness/deepfakes.
Sexually explicit content and graphic violence are rejected.
