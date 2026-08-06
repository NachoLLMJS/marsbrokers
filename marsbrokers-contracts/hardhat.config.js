if (process.env.MARS_ENV_FILE) {
  require("dotenv").config({ path: process.env.MARS_ENV_FILE });
}
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

const rawPrivateKey = (process.env.DEPLOYER_PRIVATE_KEY || "").trim();
const privateKey = rawPrivateKey && !rawPrivateKey.startsWith("0x") ? `0x${rawPrivateKey}` : rawPrivateKey;
const validPrivateKey = /^0x[0-9a-fA-F]{64}$/.test(privateKey);
const networks = {};

if (process.env.BSC_MAINNET_RPC_URL) {
  networks.bscMainnet = {
    url: process.env.BSC_MAINNET_RPC_URL,
    chainId: 56,
    accounts: validPrivateKey ? [privateKey] : []
  };
}

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 500 },
      evmVersion: "paris"
    }
  },
  networks,
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
