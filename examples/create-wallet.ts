/**
 * Create a dedicated spending wallet for x402 purchases.
 *
 * npm i viem
 * npx tsx create-wallet.ts
 *
 * Treat it like a prepaid card: fund it with only what you plan to spend
 * (USDC on Base — no ETH needed, gas is paid by the facilitator).
 * The private key never leaves your machine; payments are signed locally.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log(`
Your x402 spending wallet:

  address      ${account.address}
  private key  ${privateKey}

1. Save the private key somewhere safe (env var / secret manager).
   Anyone with this key can spend the wallet's balance.
2. Send USDC on the Base network to the address above ($1 buys ~2 videos).
   ⚠ Base network, not Ethereum mainnet. No ETH needed.
3. Buy your first video:

   BUYER_PRIVATE_KEY=${privateKey} npx tsx buy-with-x402-fetch.ts "your prompt"
`);
