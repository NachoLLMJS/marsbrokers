const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = hre;

const TREASURY = "0xF215614466D02F698d6dD0d9d940d4f51CF892a4";
const MAINNET_MARSCOIN = "0xfe189e97832da1573e4e4ff034f4ffc3a15c7777";
const GENESIS_PRICE = ethers.parseEther("0.1");
const envFile = process.env.MARS_ENV_FILE || path.join(process.env.USERPROFILE || "", "Desktop", "MarsBrokers-launch.env");
const deploymentDir = path.join(__dirname, "..", "deployments");

function atomicJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function setEnvValues(values) {
  let text = fs.readFileSync(envFile, "utf8");
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const regex = new RegExp(`^${key}=.*$`, "m");
    text = regex.test(text) ? text.replace(regex, line) : `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(envFile, text);
}

function writeFrontendEnv(chainId, addresses) {
  const frontendDir = path.join(__dirname, "..", "..", "marsbrokers-frontend");
  const content = [
    `VITE_CHAIN_ID=${chainId}`,
    `VITE_MARS_BROKERS_NFT_ADDRESS=${addresses.NFT_ADDRESS}`,
    `VITE_MARS_BROKERS_STAKING_ADDRESS=${addresses.STAKING_ADDRESS}`,
    `VITE_MARS_BROKERS_MARKET_ADDRESS=${addresses.MARKET_ADDRESS}`,
    `VITE_MARS_BROKER_ROUTER_ADDRESS=${addresses.ROUTER_ADDRESS}`,
    `VITE_MARSCOIN_ADDRESS=${addresses.MARSCOIN_ADDRESS}`,
    ""
  ].join("\n");
  fs.writeFileSync(path.join(frontendDir, ".env.local"), content);
}

async function main() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== 56 && chainId !== 31337) {
    throw new Error(`MarsBrokers deployment is mainnet-only; unsupported chain ${chainId}.`);
  }
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No deployment signer. Set DEPLOYER_PRIVATE_KEY in the Desktop env file.");
  const deployer = await signer.getAddress();
  const metadataCID = (process.env.METADATA_CID || "").trim();
  if (!/^[A-Za-z0-9]+$/.test(metadataCID)) throw new Error("METADATA_CID is missing or invalid.");
  if (chainId === 56 && process.env.CONFIRM_MAINNET !== "I_UNDERSTAND_BNB_MAINNET") {
    throw new Error("Mainnet blocked. Set CONFIRM_MAINNET=I_UNDERSTAND_BNB_MAINNET after reviewing every value.");
  }
  if ((process.env.CONFIRM_TREASURY || "").toLowerCase() !== TREASURY.toLowerCase()) {
    throw new Error(`CONFIRM_TREASURY must equal ${TREASURY}`);
  }
  const genesisAndList = process.env.GENESIS_AND_LIST === "true";
  if (genesisAndList && deployer.toLowerCase() !== TREASURY.toLowerCase()) {
    throw new Error(`Genesis listing requires the treasury signer ${TREASURY}; current signer is ${deployer}`);
  }

  const confirmations = Math.max(1, Number(process.env.DEPLOY_CONFIRMATIONS || (chainId === 56 ? 5 : 1)));
  const marscoinAddress = (chainId === 56 ? (process.env.MARSCOIN_ADDRESS || MAINNET_MARSCOIN) : "").trim();
  if (marscoinAddress && !ethers.isAddress(marscoinAddress)) throw new Error(`Invalid MARSCOIN_ADDRESS: ${marscoinAddress}`);
  if (marscoinAddress && await ethers.provider.getCode(marscoinAddress) === "0x") {
    throw new Error(`MARSCOIN_ADDRESS has no bytecode on chain ${chainId}: ${marscoinAddress}`);
  }
  const allowedTokens = (process.env.ALLOWED_STAKING_TOKENS || "").split(",").map(v => v.trim()).filter(Boolean);
  if (marscoinAddress && !allowedTokens.some((token) => token.toLowerCase() === marscoinAddress.toLowerCase())) allowedTokens.push(marscoinAddress);
  for (const token of allowedTokens) if (!ethers.isAddress(token)) throw new Error(`Invalid allowlist token: ${token}`);
  const config = { chainId, deployer, treasury: TREASURY, metadataCID, genesisAndList, marscoinAddress, allowedTokens };
  const configHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(config)));
  const recordFile = path.join(deploymentDir, `${chainId}.json`);
  let record = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, "utf8")) : {
    status: "in_progress", config, configHash, contracts: {}, actions: {}, createdAt: new Date().toISOString()
  };
  if (record.configHash !== configHash) throw new Error(`Existing checkpoint has different configuration: ${recordFile}`);
  const save = () => { record.updatedAt = new Date().toISOString(); atomicJSON(recordFile, record); };
  save();

  async function deployStep(name, factoryName, args = []) {
    const Factory = await ethers.getContractFactory(factoryName);
    let step = record.contracts[name];
    if (step?.expectedAddress) {
      const code = await ethers.provider.getCode(step.expectedAddress);
      if (code !== "0x") {
        step.status = "confirmed"; step.address = step.expectedAddress; save();
        return Factory.attach(step.address);
      }
      if (step.txHash) {
        const receipt = await ethers.provider.getTransactionReceipt(step.txHash);
        if (receipt && receipt.status === 0) throw new Error(`${name} deployment reverted: ${step.txHash}`);
      }
      const nonceNow = await ethers.provider.getTransactionCount(deployer, "pending");
      if (nonceNow !== step.nonce) throw new Error(`Cannot safely resume ${name}; inspect nonce ${step.nonce} and ${step.txHash || "missing tx hash"}.`);
    }
    const nonce = await ethers.provider.getTransactionCount(deployer, "pending");
    const expectedAddress = ethers.getCreateAddress({ from: deployer, nonce });
    const request = await Factory.getDeployTransaction(...args);
    step = record.contracts[name] = {
      status: "prepared", factoryName, nonce, expectedAddress,
      initCodeHash: ethers.keccak256(request.data), preparedAt: new Date().toISOString()
    };
    save();
    const contract = await Factory.deploy(...args);
    const tx = contract.deploymentTransaction();
    step.status = "submitted"; step.txHash = tx.hash; save();
    const receipt = await tx.wait(confirmations);
    if (!receipt || receipt.status !== 1 || (await contract.getAddress()).toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error(`${name} deployment verification failed`);
    }
    step.status = "confirmed";
    step.address = expectedAddress;
    step.blockNumber = receipt.blockNumber;
    step.gasUsed = receipt.gasUsed.toString();
    step.effectiveGasPrice = receipt.gasPrice?.toString() || null;
    save();
    return contract;
  }

  async function actionStep(name, contract, method, args, verify) {
    if (await verify()) {
      record.actions[name] = { ...(record.actions[name] || {}), status: "confirmed", verifiedAt: new Date().toISOString() }; save(); return;
    }
    let step = record.actions[name];
    if (step?.txHash) {
      const receipt = await ethers.provider.getTransactionReceipt(step.txHash);
      if (receipt?.status === 0) throw new Error(`${name} reverted: ${step.txHash}`);
      if (receipt?.status === 1 && await verify()) {
        step.status = "confirmed";
        step.blockNumber = receipt.blockNumber;
        step.gasUsed = receipt.gasUsed.toString();
        step.effectiveGasPrice = receipt.gasPrice?.toString() || null;
        save();
        return;
      }
    }
    if (step?.nonce !== undefined) {
      const nonceNow = await ethers.provider.getTransactionCount(deployer, "pending");
      if (nonceNow !== step.nonce) throw new Error(`Cannot safely resume action ${name}; inspect nonce ${step.nonce}.`);
    }
    const nonce = await ethers.provider.getTransactionCount(deployer, "pending");
    const request = await contract[method].populateTransaction(...args);
    step = record.actions[name] = {
      status: "prepared", nonce, to: await contract.getAddress(),
      dataHash: ethers.keccak256(request.data), value: String(request.value || 0), preparedAt: new Date().toISOString()
    };
    save();
    const tx = await contract[method](...args);
    step.status = "submitted"; step.txHash = tx.hash; save();
    const receipt = await tx.wait(confirmations);
    if (!receipt || receipt.status !== 1 || !(await verify())) throw new Error(`${name} postcondition failed`);
    step.status = "confirmed";
    step.blockNumber = receipt.blockNumber;
    step.gasUsed = receipt.gasUsed.toString();
    step.effectiveGasPrice = receipt.gasPrice?.toString() || null;
    save();
  }

  const registry = await deployStep("registry", "ERC6551Registry");
  const account = await deployStep("accountImplementation", "MarsBrokerAccount");
  const nft = await deployStep("nft", "MarsBrokersNFT", [TREASURY, await registry.getAddress(), await account.getAddress(), `ipfs://${metadataCID}/`]);
  const staking = await deployStep("staking", "MarsBrokersStaking", [await nft.getAddress()]);
  const market = await deployStep("market", "MarsBrokersMarket", [await nft.getAddress()]);
  const router = await deployStep("router", "MarsBrokerRouter", [await nft.getAddress()]);

  if (genesisAndList) {
    await actionStep("approveMarket", nft, "setApprovalForAll", [await market.getAddress(), true], async () => await nft.isApprovedForAll(TREASURY, await market.getAddress()));
    for (const tokenId of [1, 2, 3]) {
      await actionStep(`listGenesis${tokenId}`, market, "list", [tokenId, GENESIS_PRICE], async () => {
        const listing = await market.listings(tokenId);
        return listing.seller.toLowerCase() === TREASURY.toLowerCase() && listing.price === GENESIS_PRICE;
      });
    }
  }
  for (const token of allowedTokens) {
    await actionStep(`allow-${token.toLowerCase()}`, staking, "setTokenAllowed", [token, true], async () => await staking.allowedTokens(token));
  }
  const addresses = {
    NFT_ADDRESS: await nft.getAddress(), STAKING_ADDRESS: await staking.getAddress(),
    MARKET_ADDRESS: await market.getAddress(), ROUTER_ADDRESS: await router.getAddress(),
    MARSCOIN_ADDRESS: marscoinAddress,
    ACCOUNT_IMPLEMENTATION_ADDRESS: await account.getAddress(), REGISTRY_ADDRESS: await registry.getAddress()
  };
  if (chainId === 56) {
    setEnvValues(addresses);
    writeFrontendEnv(chainId, addresses);
  }
  record.status = "complete"; record.completedAt = new Date().toISOString(); record.addresses = addresses; save();
  console.log(JSON.stringify({ chainId, deployer, treasury: TREASURY, confirmations, ...addresses }, null, 2));
}

main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
