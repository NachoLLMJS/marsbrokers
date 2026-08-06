# MarsBrokers

MarsBrokers is a BNB Chain mainnet NFT broker protocol with deterministic ERC-6551 token-bound accounts, marketplace escrow, staking, ERC-20 routing and direct PancakeSwap V3 access to MARSCOIN.

Live application: https://marsbrokers.vercel.app

## Mainnet contracts

- NFT: `0x8eb1F4FA6C514e3b1fecA7395b52Cf2a9768482F`
- Staking: `0xd30425269276F023085cF09EB153Cc8f333d5c90`
- Market: `0xAf04F60f3E6f7284EedCA201fD109421654aD386`
- Broker Router: `0x93dd0Dc8ca554a19aF488d30862D027b129d7Fd5`
- Account implementation: `0x39D7F5e3aA6a31FaAe45571EA68ECF7D396cb441`
- ERC-6551 Registry: `0x7f164739576A3916ac0B0ce6e565cAF23e9f0F90`
- MARSCOIN: `0xfe189e97832da1573e4e4ff034f4ffc3a15c7777`
- Treasury: `0xF215614466D02F698d6dD0d9d940d4f51CF892a4`

## Workspace

- `marsbrokers-contracts`: Solidity contracts, tests, deployment scripts and mainnet deployment record.
- `marsbrokers-frontend`: Vite frontend configured for BNB Chain mainnet.

## Verification

```bash
cd marsbrokers-contracts
npm install
npm test
npm run compile

cd ../marsbrokers-frontend
npm install
npm run build
```

The deployer private key is never stored in this repository.
