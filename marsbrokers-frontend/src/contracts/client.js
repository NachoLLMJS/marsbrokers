import {
  BrowserProvider,
  Contract,
  formatEther,
  Interface,
  isAddress,
  JsonRpcProvider,
  parseEther,
  parseUnits,
  solidityPacked,
  ZeroAddress
} from 'ethers';
import nftAbi from './abi/MarsBrokersNFT.json';
import accountAbi from './abi/MarsBrokerAccount.json';
import stakingAbi from './abi/MarsBrokersStaking.json';
import marketAbi from './abi/MarsBrokersMarket.json';
import routerAbi from './abi/MarsBrokerRouter.json';

const TREASURY = '0xF215614466D02F698d6dD0d9d940d4f51CF892a4';
const MINT_PRICE = parseEther('0.035');
const PANCAKE_ROUTER = '0x1b81D678ffb9C0263b24A97847620C99d213eB14';
const PANCAKE_QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const WBNB_USDT_FEE = 100;
const USDT_MARS_FEE = 2500;
const pancakeRouterAbi = [
  'function exactInput((bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum)) payable returns(uint256)',
  'function multicall(bytes[] data) payable returns(bytes[])',
  'function unwrapWETH9(uint256 amountMinimum,address recipient) payable'
];
const pancakeQuoterAbi = [
  'function quoteExactInput(bytes path,uint256 amountIn) returns(uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)'
];
const configuredChainId = Number(import.meta.env.VITE_CHAIN_ID || 56);

export const deployment = Object.freeze({
  chainId: configuredChainId,
  nft: import.meta.env.VITE_MARS_BROKERS_NFT_ADDRESS || '',
  staking: import.meta.env.VITE_MARS_BROKERS_STAKING_ADDRESS || '',
  market: import.meta.env.VITE_MARS_BROKERS_MARKET_ADDRESS || '',
  router: import.meta.env.VITE_MARS_BROKER_ROUTER_ADDRESS || '',
  marscoin: import.meta.env.VITE_MARSCOIN_ADDRESS || (configuredChainId === 56 ? '0xfe189e97832da1573e4e4ff034f4ffc3a15c7777' : '')
});

function configuredAddress(value) {
  return isAddress(value) && value !== ZeroAddress;
}

export function deploymentConfigured() {
  return [deployment.nft, deployment.staking, deployment.market, deployment.router]
    .every(configuredAddress);
}

function requireConfigured() {
  if (!deploymentConfigured()) {
    throw new Error('MarsBrokers contracts are not configured');
  }
}

async function switchToExpectedChain(eip1193) {
  const expectedHex = `0x${deployment.chainId.toString(16)}`;
  const current = await eip1193.request({ method: 'eth_chainId' });
  if (String(current).toLowerCase() === expectedHex.toLowerCase()) return;
  await eip1193.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: expectedHex }]
  });
}

async function requireExpectedWalletState(provider, expectedAccount) {
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== deployment.chainId) {
    throw new Error(`Switch wallet to BNB Chain ${deployment.chainId}`);
  }
  const signer = await provider.getSigner();
  const account = await signer.getAddress();
  if (expectedAccount && account.toLowerCase() !== expectedAccount.toLowerCase()) {
    throw new Error('Active wallet changed — reconnect before signing');
  }
  return { signer, account };
}

export async function verifyDeployment(provider) {
  requireConfigured();
  const addresses = [deployment.nft, deployment.staking, deployment.market, deployment.router];
  if (deployment.chainId === 56) addresses.push(PANCAKE_ROUTER, PANCAKE_QUOTER, deployment.marscoin);
  const code = await Promise.all(addresses.map((address) => provider.getCode(address)));
  if (code.some((bytecode) => bytecode === '0x')) throw new Error('Configured contract bytecode is missing');

  const nft = new Contract(deployment.nft, nftAbi, provider);
  const staking = new Contract(deployment.staking, stakingAbi, provider);
  const market = new Contract(deployment.market, marketAbi, provider);
  const router = new Contract(deployment.router, routerAbi, provider);
  const [treasury, mintPrice, stakingNft, marketNft, routerNft] = await Promise.all([
    nft.treasury(),
    nft.MINT_PRICE(),
    staking.marsBrokers(),
    market.marsBrokers(),
    router.marsBrokers()
  ]);
  if (treasury.toLowerCase() !== TREASURY.toLowerCase()) throw new Error('Unexpected treasury');

  if (mintPrice !== MINT_PRICE) throw new Error('Unexpected mint price');
  if ([stakingNft, marketNft, routerNft].some((value) => value.toLowerCase() !== deployment.nft.toLowerCase())) {
    throw new Error('Contract relationship verification failed');
  }
  return true;
}

export async function createWriteSession() {
  requireConfigured();
  if (!window.ethereum?.request) throw new Error('No EIP-1193 wallet detected');
  await switchToExpectedChain(window.ethereum);
  const provider = new BrowserProvider(window.ethereum);
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || !accounts[0]) throw new Error('No wallet account returned');
  await requireExpectedWalletState(provider, accounts[0]);
  await verifyDeployment(provider);
  return { provider, account: accounts[0] };
}

export async function loadRecentMarketEntries(session, maxItems = 100) {
  await requireExpectedWalletState(session.provider, session.account);
  const nft = new Contract(deployment.nft, nftAbi, session.provider);
  const market = new Contract(deployment.market, marketAbi, session.provider);
  const supply = Number(await nft.totalSupply());
  const first = Math.max(1, supply - maxItems + 1);
  const ids = Array.from({ length: Math.max(0, supply - first + 1) }, (_, index) => first + index);
  return Promise.all(ids.map(async (tokenId) => {
    const [identity, owner, listing] = await Promise.all([
      nft.brokerIdentity(tokenId),
      nft.ownerOf(tokenId),
      market.listings(tokenId)
    ]);
    const priceWei = listing.price;
    return {
      tokenId,
      identity: Number(identity),
      owner,
      seller: listing.seller,
      listed: listing.seller !== ZeroAddress && priceWei > 0n,
      priceWei,
      priceBnb: priceWei > 0n ? formatEther(priceWei) : null
    };
  }));
}

export async function loadPublicMintState() {
  requireConfigured();
  const rpcUrl = import.meta.env.VITE_BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  const provider = new JsonRpcProvider(rpcUrl, deployment.chainId, { staticNetwork: true });
  const nft = new Contract(deployment.nft, nftAbi, provider);
  return { totalSupply: await nft.totalSupply() };
}

async function write(session, address, abi, method, args = [], overrides = undefined) {
  const { signer } = await requireExpectedWalletState(session.provider, session.account);
  const contract = new Contract(address, abi, signer);
  const tx = overrides ? await contract[method](...args, overrides) : await contract[method](...args);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted');
  return receipt;
}

function marsSwapPath(direction) {
  if (direction === 'bnbToMars') {
    return solidityPacked(
      ['address', 'uint24', 'address', 'uint24', 'address'],
      [WBNB, WBNB_USDT_FEE, USDT, USDT_MARS_FEE, deployment.marscoin]
    );
  }
  if (direction === 'marsToBnb') {
    return solidityPacked(
      ['address', 'uint24', 'address', 'uint24', 'address'],
      [deployment.marscoin, USDT_MARS_FEE, USDT, WBNB_USDT_FEE, WBNB]
    );
  }
  throw new Error('Unsupported swap direction');
}

async function confirmedReceipt(tx) {
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted');
  return receipt;
}

export const actions = {
  readMintState: async (session) => {
    await requireExpectedWalletState(session.provider, session.account);
    const nft = new Contract(deployment.nft, nftAbi, session.provider);
    return { totalSupply: await nft.totalSupply() };
  },
  mint: async (session, referrer = ZeroAddress) => {
    const receipt = await write(session, deployment.nft, nftAbi, 'mint', [referrer || ZeroAddress], { value: MINT_PRICE });
    const iface = new Interface(nftAbi);
    const mintedTokenIds = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== deployment.nft.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'Transfer'
          && parsed.args.from === ZeroAddress
          && parsed.args.to.toLowerCase() === session.account.toLowerCase()) {
          mintedTokenIds.push(parsed.args.tokenId);
        }
      } catch {
        // Ignore unrelated logs emitted during ERC-6551 account creation.
      }
    }
    if (!mintedTokenIds.length) throw new Error('Mint receipt confirmed but no NFT Transfer event was found');
    const nft = new Contract(deployment.nft, nftAbi, session.provider);
    const minted = await Promise.all(mintedTokenIds.map(async (tokenId) => ({
      tokenId,
      account: await nft.accountOf(tokenId)
    })));
    return { receipt, minted, totalSupply: await nft.totalSupply() };
  },
  approveMarket: (session, approved = true) => write(session, deployment.nft, nftAbi, 'setApprovalForAll', [deployment.market, approved]),
  list: (session, tokenId, priceBnb) => write(session, deployment.market, marketAbi, 'list', [tokenId, parseEther(priceBnb)]),
  cancelListing: (session, tokenId) => write(session, deployment.market, marketAbi, 'cancel', [tokenId]),
  buy: (session, tokenId, priceWei) => write(session, deployment.market, marketAbi, 'buy', [tokenId], { value: priceWei }),
  withdrawMarketProceeds: (session) => write(session, deployment.market, marketAbi, 'withdrawProceeds'),
  approveNftStaking: (session, tokenId) => write(session, deployment.nft, nftAbi, 'approve', [deployment.staking, tokenId]),
  stakeNft: (session, tokenId, tier) => write(session, deployment.staking, stakingAbi, 'stakeNFT', [tokenId, tier]),
  unstakeNft: (session, tokenId) => write(session, deployment.staking, stakingAbi, 'unstakeNFT', [tokenId]),
  approveTokenStaking: async (session, token, amount) => {
    const { signer } = await requireExpectedWalletState(session.provider, session.account);
    const erc20 = new Contract(token, ['function decimals() view returns(uint8)', 'function approve(address,uint256) returns(bool)'], signer);
    const decimals = await erc20.decimals();
    const tx = await erc20.approve(deployment.staking, parseUnits(amount, decimals));
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error('Approval reverted');
    return receipt;
  },
  stakeToken: async (session, token, amount, tier) => {
    const erc20 = new Contract(token, ['function decimals() view returns(uint8)'], session.provider);
    const decimals = await erc20.decimals();
    return write(session, deployment.staking, stakingAbi, 'stakeToken', [token, parseUnits(amount, decimals), tier]);
  },
  unstakeToken: (session, stakeId) => write(session, deployment.staking, stakingAbi, 'unstakeToken', [stakeId]),
  readMarsSwapQuote: async (session, direction, amount) => {
    await requireExpectedWalletState(session.provider, session.account);
    const quoter = new Contract(PANCAKE_QUOTER, pancakeQuoterAbi, session.provider);
    const result = await quoter.quoteExactInput.staticCall(marsSwapPath(direction), parseEther(amount));
    const minimumOut = result[0] * 995n / 1000n;
    return {
      amountOut: result[0],
      formattedOut: formatEther(result[0]),
      minimumOut,
      formattedMinimum: formatEther(minimumOut),
      gasEstimate: result[3]
    };
  },
  approveMarsSwap: async (session, amount) => {
    const { signer } = await requireExpectedWalletState(session.provider, session.account);
    const mars = new Contract(deployment.marscoin, ['function approve(address,uint256) returns(bool)'], signer);
    return confirmedReceipt(await mars.approve(PANCAKE_ROUTER, parseEther(amount)));
  },
  swapBnbForMars: async (session, amount, minMarsOut) => {
    const { signer, account } = await requireExpectedWalletState(session.provider, session.account);
    const router = new Contract(PANCAKE_ROUTER, pancakeRouterAbi, signer);
    const amountIn = parseEther(amount);
    const params = [marsSwapPath('bnbToMars'), account, Math.floor(Date.now() / 1000) + 1200, amountIn, parseEther(minMarsOut)];
    return confirmedReceipt(await router.exactInput(params, { value: amountIn }));
  },
  swapMarsForBnb: async (session, amount, minBnbOut) => {
    const { signer, account } = await requireExpectedWalletState(session.provider, session.account);
    const amountIn = parseEther(amount);
    const minimum = parseEther(minBnbOut);
    const iface = new Interface(pancakeRouterAbi);
    const exactInput = iface.encodeFunctionData('exactInput', [[marsSwapPath('marsToBnb'), PANCAKE_ROUTER, Math.floor(Date.now() / 1000) + 1200, amountIn, minimum]]);
    const unwrap = iface.encodeFunctionData('unwrapWETH9', [minimum, account]);
    const router = new Contract(PANCAKE_ROUTER, pancakeRouterAbi, signer);
    return confirmedReceipt(await router.multicall([exactInput, unwrap]));
  },
  approveSeal: async (session, token, amount) => {
    const { signer } = await requireExpectedWalletState(session.provider, session.account);
    const erc20 = new Contract(token, ['function decimals() view returns(uint8)', 'function approve(address,uint256) returns(bool)'], signer);
    const decimals = await erc20.decimals();
    const tx = await erc20.approve(deployment.router, parseUnits(amount, decimals));
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error('Approval reverted');
    return receipt;
  },
  sealToBroker: async (session, tokenId, token, amount) => {
    const erc20 = new Contract(token, ['function decimals() view returns(uint8)'], session.provider);
    const decimals = await erc20.decimals();
    return write(session, deployment.router, routerAbi, 'sealToBroker', [tokenId, token, parseUnits(amount, decimals)]);
  },
  routeToWallet: async (session, tokenId, token, recipient, amount) => {
    const nft = new Contract(deployment.nft, nftAbi, session.provider);
    const accountAddress = await nft.accountOf(tokenId);
    const erc20 = new Contract(token, ['function decimals() view returns(uint8)'], session.provider);
    const decimals = await erc20.decimals();
    return write(session, accountAddress, accountAbi, 'routeERC20', [token, recipient, parseUnits(amount, decimals)]);
  },
  routeFromStakedBroker: async (session, tokenId, token, recipient, amount) => {
    if (recipient.toLowerCase() !== session.account.toLowerCase()) {
      throw new Error('A staked broker can only claim to the connected staker wallet');
    }
    const erc20 = new Contract(token, ['function decimals() view returns(uint8)'], session.provider);
    const decimals = await erc20.decimals();
    return write(session, deployment.staking, stakingAbi, 'claimBrokerERC20', [tokenId, token, parseUnits(amount, decimals)]);
  }
};
