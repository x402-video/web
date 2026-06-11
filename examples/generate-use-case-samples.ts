/**
 * Batch-generate sample videos for each use-case card on /use-cases/.
 *
 * Usage:
 *   npm i @x402/fetch @x402/evm viem
 *
 *   # Generate all 6 clips (saves to web/assets/samples/use-case-<slug>.mp4):
 *   BUYER_PRIVATE_KEY=0x... npx tsx examples/generate-use-case-samples.ts
 *
 *   # Generate a single clip by slug:
 *   BUYER_PRIVATE_KEY=0x... npx tsx examples/generate-use-case-samples.ts social-shorts
 *
 * Slugs: ad-creative | product-demo | social-shorts | blog-broll | previz | agent-commerce
 *
 * Cost: ~$0.45–$4.62 per clip depending on endpoint. See prices below.
 * Clips land in  web/assets/samples/use-case-<slug>.mp4  (paths match the <video> tags on the page).
 */

import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import * as fs from "node:fs";
import * as path from "node:path";

const GATEWAY = process.env.GATEWAY ?? "https://api.x402-video.com";

// ---------------------------------------------------------------------------
// Use-case definitions — prompts exactly match the /use-cases/ page
// ---------------------------------------------------------------------------
interface UseCase {
  slug: string;
  label: string;
  endpoint: string;
  body: Record<string, unknown>;
  estimatedCost: string;
}

const USE_CASES: UseCase[] = [
  {
    slug: "ad-creative",
    label: "Ad Creative",
    endpoint: "/generate/seedance-fast/5s-720p",
    body: {
      prompt:
        "golden sneaker rotating on a clean white pedestal, dramatic product lighting, slow 360 spin, luxury feel, 5 seconds",
    },
    estimatedCost: "~$0.45",
  },
  {
    slug: "product-demo",
    label: "Product Demo B-Roll",
    endpoint: "/generate/seedance/5s-720p",
    body: {
      prompt:
        "golden retriever bounding joyfully through a sunlit park covered in autumn leaves, slow motion, warm bokeh, cinematic",
    },
    estimatedCost: "~$0.56",
  },
  {
    slug: "social-shorts",
    label: "Social Shorts (9:16 Vertical)",
    endpoint: "/generate/seedance-fast/custom",
    body: {
      prompt:
        "aerial drone flyover of a neon-lit Tokyo street crossing at night, rain-slicked pavement reflections, vertical framing, vivid colors",
      duration: 5,
      resolution: "720p",
      ratio: "9:16",
    },
    estimatedCost: "~$0.45",
  },
  {
    slug: "blog-broll",
    label: "Blog & News Auto B-Roll",
    endpoint: "/generate/seedance-fast/5s-720p",
    body: {
      prompt:
        "rain-soaked Tokyo intersection at dusk, neon signs reflected on wet asphalt, pedestrians with umbrellas, cinematic wide angle, moody atmosphere",
    },
    estimatedCost: "~$0.45",
  },
  {
    slug: "previz",
    label: "Game / Film Previz",
    endpoint: "/generate/seedance/custom",
    body: {
      prompt:
        "epic fantasy castle interior, low camera tracking shot through stone corridor lined with torches, fog rolling on the floor, ominous orchestral mood, cinematic 2.39:1",
      duration: 10,
      resolution: "1080p",
    },
    estimatedCost: "$0.27–$4.62",
  },
  {
    slug: "agent-commerce",
    label: "Agent-to-Agent Commerce",
    endpoint: "/generate/seedance-fast/5s-720p",
    body: {
      prompt:
        "smooth aerial reveal of Santorini whitewashed village at golden hour, camera slowly rising to show the caldera and sea, dreamy travel vibe",
    },
    estimatedCost: "~$0.45",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollJob(
  jobId: string,
): Promise<string> {
  for (;;) {
    await sleep(5000);
    const job = (await (
      await fetch(`${GATEWAY}/jobs/${jobId}`)
    ).json()) as {
      status: string;
      video_url: string | null;
      error: unknown;
    };
    console.log(`  poll → ${job.status}`);
    if (job.status === "succeeded" && job.video_url) return job.video_url;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(`Job ${jobId} ${job.status}: ${JSON.stringify(job.error)}`);
    }
  }
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(buf));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const slugFilter = process.argv[2] ?? null;

// Output dir relative to this script: ../assets/samples/
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const samplesDir = path.resolve(scriptDir, "../assets/samples");

const account = privateKeyToAccount(
  process.env.BUYER_PRIVATE_KEY as `0x${string}`,
);
const signer = toClientEvmSigner(
  account,
  createPublicClient({ chain: base, transport: http() }),
);
const fetchPay = wrapFetchWithPayment(
  fetch,
  new x402Client().register("eip155:*", new ExactEvmScheme(signer)),
);

const targets = slugFilter
  ? USE_CASES.filter((uc) => uc.slug === slugFilter)
  : USE_CASES;

if (targets.length === 0) {
  console.error(
    `No use case found for slug "${slugFilter}". Valid slugs:\n` +
      USE_CASES.map((u) => `  ${u.slug}`).join("\n"),
  );
  process.exit(1);
}

let totalSpent = 0;
const results: Array<{ slug: string; status: "ok" | "error"; note: string }> =
  [];

for (const uc of targets) {
  console.log(`\n[${uc.slug}] ${uc.label} — ${uc.estimatedCost}`);
  console.log(`  POST ${GATEWAY}${uc.endpoint}`);

  try {
    const res = await fetchPay(`${GATEWAY}${uc.endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(uc.body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const { job_id } = (await res.json()) as { job_id: string };
    console.log(`  paid → job_id: ${job_id}`);

    const videoUrl = await pollJob(job_id);
    const dest = path.join(samplesDir, `use-case-${uc.slug}.mp4`);
    console.log(`  downloading → ${dest}`);
    await downloadFile(videoUrl, dest);
    console.log(`  saved (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);

    results.push({ slug: uc.slug, status: "ok", note: dest });

    // Rough cost tracking (parse from estimatedCost label)
    const match = uc.estimatedCost.match(/[\d.]+/);
    if (match) totalSpent += parseFloat(match[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR: ${msg}`);
    results.push({ slug: uc.slug, status: "error", note: msg });
  }

  // Rate-limit courtesy pause between requests
  if (targets.indexOf(uc) < targets.length - 1) {
    console.log("  (sleeping 3s before next request)");
    await sleep(3000);
  }
}

// Summary
console.log("\n=== Summary ===");
for (const r of results) {
  const icon = r.status === "ok" ? "OK" : "FAIL";
  console.log(`  [${icon}] ${r.slug}: ${r.note}`);
}
console.log(`\nEstimated total spend: ~$${totalSpent.toFixed(2)} USDC`);
console.log(
  "Note: actual prices come from the 402 quote at call time — run GET https://api.x402-video.com/ for live prices.",
);
