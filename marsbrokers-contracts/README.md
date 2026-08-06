# MarsBrokers contracts

Production-intent Solidity workspace for MarsBrokers on BNB Smart Chain. No mainnet address is published by this repository until the deployment script is signed and the resulting bytecode is verified.

## Implemented contracts

- `MarsBrokersNFT.sol`
  - Unlimited ERC-721 supply.
  - `0.035 BNB` exact public mint price.
  - Native mint payment forwarded atomically to `0xF215614466D02F698d6dD0d9d940d4f51CF892a4`.
  - 2×1 mint when the referrer is a different address that already owns a MarsBroker.
  - Three one-time Genesis reserve NFTs for initial treasury listings.
  - A distinct ERC-6551 account is created during every mint through the ERC-6551 registry.
  - The 27 collection artworks are reusable base identities: identity `((tokenId - 1) % 27) + 1`. Every edition still has a unique token ID and TBA.

- `MarsBrokerAccount.sol`
  - ERC-6551 account implementation.
  - Current NFT ownership controls execution.
  - `routeERC20` provides a direct Route-to-Wallet path.

- `MarsBrokerRouter.sol`
  - `sealToBroker` transfers an ERC-20 from the caller into a selected NFT's TBA.
  - Measures the amount actually received before emitting the deposit event.

- `MarsBrokersStaking.sol`
  - Real NFT and allowlisted ERC-20 staking.
  - Principal remains in the contract and is not transferable to the treasury.
  - Lock tiers: 7 days at 1×, 30 days at 4× and 365 days at 20×.
  - Loyalty points only; no APY and no promised financial yield.
  - The recorded NFT staker can execute the broker TBA while the NFT is held in escrow.
  - ERC-20 accounting rejects fee-on-transfer tokens.
  - The owner can recover only provable token surplus above all recorded principal.

- `MarsBrokersMarket.sol`
  - Non-custodial on-chain listings.
  - Stale listings are rejected if ownership or approval changes.
  - Purchases transfer the NFT atomically and credit seller proceeds.
  - Sellers withdraw their own proceeds; the marketplace does not silently redirect sale value.

## Economic boundary

Treasury-managed stock acquisition and contract custody are separate paths:

1. Mint BNB reaches the configured treasury.
2. The treasury may acquire supported tokenized-stock assets.
3. Assets become on-chain broker holdings only after they are deposited into the NFT's TBA.
4. The current NFT owner controls unclaimed TBA assets.
5. Already-routed assets in a personal wallet do not follow a later NFT sale.

Traditional broker-account shares cannot be held by an ERC-6551 wallet. Claim and routing require on-chain assets compatible with BNB Smart Chain, normally ERC-20 tokens.

## Install and verify

```bash
npm install
npm test
npm run compile
```

The current suite covers:

- exact mint price and treasury forwarding;
- TBA creation during mint;
- valid and invalid 2×1 referrals;
- more than 27 mints without token-ID reuse;
- Genesis marketplace sale at `0.1 BNB`;
- stale listing invalidation;
- Seal-to-Broker and Route-to-Wallet;
- NFT lock, early-withdrawal rejection and return;
- ERC-20 principal solvency and return;
- stock claim while the NFT is staked;
- surplus recovery boundaries;
- rejection of fee-on-transfer staking tokens.

## Local deployment

```bash
METADATA_BASE_URI='ipfs://your-cid/' npm run deploy:local
npm run export:abis
```

The script deploys the ERC-6551 registry, account implementation, NFT, staking, market and router, verifies their relationships, and writes `deployments/<chainId>.json`.

## BNB Mainnet deployment

Copy variable names from `.env.example` into your secure shell or secret manager. Never commit a private key or seed phrase.

MarsBrokers is mainnet-only. Public testnet deployment is intentionally disabled. Local Hardhat remains available for tests.

Mainnet requires:

```bash
export BSC_MAINNET_RPC_URL='https://...'
export DEPLOYER_PRIVATE_KEY='0x...'
export METADATA_CID='bafy...'
export CONFIRM_MAINNET='I_UNDERSTAND_BNB_MAINNET'
npm run deploy:mainnet
```

To mint and list the three Genesis NFTs at `0.1 BNB` during deployment, the deployment signer must be the exact treasury address and `GENESIS_AND_LIST=true` must be set.

## Required before mainnet

- Upload and freeze the metadata catalog; set the final IPFS base URI.
- Decide and record the exact ERC-20 token contracts allowed for staking.
- Complete a no-broadcast BNB Mainnet preflight: signer/treasury match, chain ID, nonce, gas estimate, full-sequence balance, dependency bytecode and IPFS reachability.
- Re-run local adversarial tests and verify deployed mainnet bytecode/state and transaction receipts immediately after launch.
- Complete an external professional Solidity audit.
- Verify the frontend addresses and chain ID against deployed bytecode before enabling approvals or writes.
