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

## Step 4 — Poll and download

Generation is async (~1–3 minutes). Poll the free status endpoint:

```bash
curl https://api.x402-video.com/jobs/<job_id>
```

When `status` is `succeeded`, download `video_url` — the link **expires
~24h** after completion, so store the file, not the URL.

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
