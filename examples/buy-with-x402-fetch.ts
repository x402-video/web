/**
 * Minimal buyer: 402 -> pay USDC -> job_id -> poll until video URL.
 *
 * npm i @x402/fetch @x402/evm viem
 * BUYER_PRIVATE_KEY=0x... GATEWAY=https://api.x402.video npx tsx buy-with-x402-fetch.ts "your prompt"
 */
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const GATEWAY = process.env.GATEWAY ?? "https://api.x402.video";
const PROMPT = process.argv[2] ?? "a corgi surfing a small wave at sunset, cinematic";

const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`);
const signer = toClientEvmSigner(account, createPublicClient({ chain: base, transport: http() }));
const fetchPay = wrapFetchWithPayment(
  fetch,
  new x402Client().register("eip155:*", new ExactEvmScheme(signer)),
);

const res = await fetchPay(`${GATEWAY}/generate/seedance/5s-720p`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: PROMPT }),
});
const { job_id } = (await res.json()) as { job_id: string };
console.log("paid, job:", job_id);

for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const job = (await (await fetch(`${GATEWAY}/jobs/${job_id}`)).json()) as {
    status: string;
    video_url: string | null;
    error: unknown;
  };
  console.log("status:", job.status);
  if (job.status === "succeeded") {
    console.log("video (24h):", job.video_url);
    break;
  }
  if (job.status === "failed" || job.status === "cancelled") {
    throw new Error(JSON.stringify(job.error));
  }
}
