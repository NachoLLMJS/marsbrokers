import './style.css';
import { actions, createWriteSession, deployment, deploymentConfigured, loadRecentMarketEntries } from './contracts/client.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const toast = $('#toast');
const sidebar = $('#sidebar');
let toastTimer;
let brokers = [];
let currentModule = 'hub';
let walletAddress = null;
let contractSession = null;
let liveMarketEntries = null;
let selectedMarketItem = null;
let marketOwnerFilter = false;
let brokerRouteMode = 'seal';
let providerListenersBound = false;

const contractActionIds = [
  'mintBroker', 'approveNftStake', 'stakeNft', 'unstakeNft',
  'approveTokenStake', 'stakeToken', 'unstakeToken', 'modalBuy', 'myBrokers', 'listBroker',
  'approveBrokerAsset', 'executeBrokerRoute', 'claimStockAction',
  'refreshSwapQuote', 'approveClaimSwap', 'executeClaimSwap', 'selectMarsClaim'
];

function setContractActionsEnabled(enabled) {
  const mainnetOnly = new Set(['refreshSwapQuote', 'approveClaimSwap', 'executeClaimSwap', 'selectMarsClaim']);
  contractActionIds.forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = !enabled
      || (id === 'modalBuy' && !selectedMarketItem?.listed)
      || (id === 'approveClaimSwap' && $('#marsSwapDirection')?.value !== 'marsToBnb')
      || (mainnetOnly.has(id) && deployment.chainId !== 56);
  });
}

setContractActionsEnabled(false);
if (deployment.marscoin) {
  $('#claimStockToken').value = deployment.marscoin;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
}

async function refreshOnchainMarket() {
  if (!contractSession) return;
  liveMarketEntries = await loadRecentMarketEntries(contractSession);
  renderMarket();
}

function showModule(name) {
  const target = $(`[data-module-panel="${name}"]`);
  if (!target) return;
  currentModule = name;
  $$('.module').forEach((panel) => panel.classList.toggle('active', panel === target));
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.module === name));
  sidebar.classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'instant' });
  const moduleTitles = { market: 'NFT Market', swap: 'Swap', rewards: 'Claim Center', box: 'Broker Box', vault: 'Vault', options: 'Options Desk', referrals: 'Referrals', docs: 'Docs' };
  document.title = name === 'hub' ? 'MarsBrokers — Interplanetary Exchange' : `${moduleTitles[name] || name} — MarsBrokers`;
  history.replaceState(null, '', name === 'hub' ? location.pathname : `#${name}`);
}

$$('[data-module]').forEach((button) => button.addEventListener('click', () => showModule(button.dataset.module)));
$$('[data-module-link]').forEach((button) => button.addEventListener('click', (event) => {
  event.preventDefault();
  showModule(button.dataset.moduleLink);
}));
$('#mobileMenu').addEventListener('click', () => sidebar.classList.toggle('open'));

document.addEventListener('click', (event) => {
  if (window.innerWidth <= 820 && sidebar.classList.contains('open') && !sidebar.contains(event.target) && event.target !== $('#mobileMenu')) sidebar.classList.remove('open');
});

function shortAddress(address) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

async function connectWallet() {
  if (!deploymentConfigured()) {
    showToast('Contracts are not deployed/configured · No wallet request sent');
    return;
  }
  if (!window.ethereum || typeof window.ethereum.request !== 'function') {
    showToast('No EIP-1193 wallet detected · Install a browser wallet to connect');
    return;
  }
  const button = $('#walletButton');
  try {
    button.disabled = true;
    contractSession = await createWriteSession();
    walletAddress = contractSession.account;
    $('#walletLabel').textContent = shortAddress(walletAddress);
    $('#referralInput').value = `${location.origin}/?ref=${walletAddress}`;
    if (!$('#brokerRouteRecipient').value) $('#brokerRouteRecipient').value = walletAddress;
    bindProviderListeners();
    setContractActionsEnabled(true);
    refreshOnchainMarket().catch((error) => console.error('Market state refresh failed', error));
    showToast('Wallet connected · Contracts verified');
  } catch (error) {
    showToast(error?.code === 4001 ? 'Wallet connection cancelled' : 'Unable to connect this wallet');
  } finally {
    button.disabled = false;
  }
}
$('#walletButton').addEventListener('click', connectWallet);

function bindProviderListeners() {
  if (providerListenersBound || !window.ethereum?.on) return;
  providerListenersBound = true;
  window.ethereum.on('accountsChanged', () => {
    contractSession = null;
    walletAddress = null;
    $('#walletLabel').textContent = 'CONNECT WALLET';
    setContractActionsEnabled(false);
  });
  window.ethereum.on('chainChanged', () => {
    contractSession = null;
    setContractActionsEnabled(false);
    showToast('Network changed · Reconnect and verify contracts');
  });
}

function positiveInteger(selector, label) {
  const value = $(selector).value.trim();
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${label} must be a positive whole number`);
  return BigInt(value);
}

function requiredValue(selector, label) {
  const value = $(selector).value.trim();
  if (!value) throw new Error(`${label} is required`);
  return value;
}

async function runContractAction(button, pendingLabel, successLabel, operation) {
  if (!contractSession) {
    showToast(deploymentConfigured() ? 'Connect and verify your wallet first' : 'Contract addresses are not configured');
    return;
  }
  const previous = button.textContent;
  try {
    button.disabled = true;
    button.textContent = pendingLabel;
    await operation();
    showToast(successLabel);
  } catch (error) {
    const rejected = error?.code === 4001 || error?.code === 'ACTION_REJECTED';
    showToast(rejected ? 'Transaction cancelled' : (error?.shortMessage || error?.message || 'Transaction failed'));
  } finally {
    button.textContent = previous;
    button.disabled = false;
  }
}


function openNftModal(item, price) {
  selectedMarketItem = item;
  $('#modalImage').src = item.image;
  $('#modalImage').alt = `${item.name}, ${item.sector} signal`;
  $('#modalSignal').textContent = `${item.sector} SIGNAL / ERC-6551`;
  $('#modalTitle').textContent = item.name.toUpperCase();
  $('#modalId').textContent = item.id;
  $('#modalStock').textContent = `$${item.stock.symbol} · ${item.stock.name}`;
  $('#modalPrice').textContent = price ? `${price} BNB` : 'NOT LISTED';
  const buyButton = $('#modalBuy');
  buyButton.disabled = !contractSession || !item.listed;
  buyButton.textContent = item.listed ? `BUY · ${price} BNB` : 'NOT LISTED';
  $('#nftModal').showModal();
}

function renderMarket() {
  const query = $('#marketSearch').value.trim().toLowerCase();
  const signal = $('#marketSignal').value;
  const source = liveMarketEntries
    ? liveMarketEntries.map((entry) => {
        const identity = brokers[(entry.identity - 1) % Math.max(1, brokers.length)] || {};
        return { ...identity, ...entry, id: `MARSBROKER #${String(entry.tokenId).padStart(4, '0')}` };
      })
    : brokers.map((item) => ({ ...item, listed: false, priceBnb: null }));
  const filtered = source.filter((item) => {
    const matchesSignal = signal === 'ALL' || item.sector === signal;
    const matchesQuery = !query || item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query);
    const matchesOwner = !marketOwnerFilter || item.owner?.toLowerCase() === walletAddress?.toLowerCase();
    return matchesSignal && matchesQuery && matchesOwner;
  });
  const grid = $('#marketGrid');
  grid.replaceChildren();
  filtered.forEach((item) => {
    const listed = Boolean(item.listed);
    const price = listed ? item.priceBnb : null;
    const card = document.createElement('button');
    card.className = 'market-item';
    card.type = 'button';
    card.setAttribute('aria-label', `Open ${item.name}, ${item.sector}`);
    const image = document.createElement('img');
    image.src = item.image;
    image.alt = `${item.name} with ${item.sector} signal background`;
    image.loading = 'eager';
    const tag = document.createElement('span');
    tag.className = 'listing-tag';
    tag.textContent = listed ? 'BUY NOW' : 'UNLISTED';
    const info = document.createElement('div');
    info.className = 'market-item-info';
    const signalText = document.createElement('span');
    signalText.textContent = `${item.sector} SIGNAL`;
    const benefits = document.createElement('div');
    benefits.className = 'market-benefits';
    const stockBenefit = document.createElement('span');
    stockBenefit.textContent = `$${item.stock.symbol} STOCK`;
    const marsBenefit = document.createElement('span');
    marsBenefit.textContent = '+ MARSCOIN';
    benefits.append(stockBenefit, marsBenefit);
    const heading = document.createElement('h3');
    heading.textContent = item.name.toUpperCase();
    const priceRow = document.createElement('div');
    priceRow.className = 'market-price';
    const label = document.createElement('small');
    label.textContent = listed ? 'PRICE' : 'STATUS';
    const value = document.createElement('b');
    value.textContent = listed ? `${price} BNB` : '—';
    priceRow.append(label, value);
    info.append(signalText, heading, benefits, priceRow);
    card.append(tag, image, info);
    card.addEventListener('click', () => openNftModal(item, price));
    grid.append(card);
  });
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-table';
    empty.textContent = 'No brokers match this search';
    grid.append(empty);
  }
}

async function loadCollection() {
  try {
    const response = await fetch('/martians/manifest.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    brokers = await response.json();
    renderMarket();
    $$('.formation-card').forEach((card) => card.addEventListener('click', () => {
      const item = brokers.find((broker) => broker.id === card.dataset.featureId);
      if (item) openNftModal({ ...item, listed: false }, null);
    }));
  } catch (error) {
    console.error('MarsBrokers collection failed to load', error);
    $('#marketGrid').textContent = 'Collection signal offline';
  }
}

$('#marketSearch').addEventListener('input', renderMarket);
$('#marketSignal').addEventListener('change', renderMarket);
$('#modalClose').addEventListener('click', () => $('#nftModal').close());
$('#nftModal').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
$('#modalBuy').addEventListener('click', (event) => {
  if (!selectedMarketItem?.listed) return;
  runContractAction(event.currentTarget, 'BUYING…', 'Purchase confirmed on-chain', async () => {
    await actions.buy(contractSession, selectedMarketItem.tokenId, selectedMarketItem.priceWei);
    $('#nftModal').close();
    await refreshOnchainMarket();
  });
});

$('#myBrokers').addEventListener('click', () => {
  if (!contractSession) return;
  marketOwnerFilter = !marketOwnerFilter;
  $('#myBrokers').classList.toggle('active', marketOwnerFilter);
  renderMarket();
});
$('#listBroker').addEventListener('click', (event) => {
  if (!contractSession) return;
  const tokenIdRaw = window.prompt('MarsBroker token ID to list');
  if (tokenIdRaw === null) return;
  const priceBnb = window.prompt('Listing price in BNB');
  if (priceBnb === null) return;
  if (!/^\d+$/.test(tokenIdRaw.trim()) || BigInt(tokenIdRaw.trim()) <= 0n || !/^(?:\d+\.?\d*|\.\d+)$/.test(priceBnb.trim()) || Number(priceBnb) <= 0) {
    showToast('Enter a valid token ID and positive BNB price');
    return;
  }
  if (!window.confirm('This sends two transactions: marketplace approval, then the listing. Continue?')) return;
  runContractAction(event.currentTarget, 'LISTING…', 'Listing confirmed on-chain', async () => {
    await actions.approveMarket(contractSession, true);
    await actions.list(contractSession, BigInt(tokenIdRaw.trim()), priceBnb.trim());
    await refreshOnchainMarket();
  });
});
$('#mintBroker').addEventListener('click', (event) => {
  const referrer = new URLSearchParams(location.search).get('ref') || undefined;
  runContractAction(event.currentTarget, 'MINTING…', 'Mint confirmed on-chain', async () => {
    await actions.mint(contractSession, referrer);
    await refreshOnchainMarket();
  });
});
$('#selectBroker').addEventListener('click', () => {
  if (!walletAddress) connectWallet();
  else showToast('Wallet connected');
});
$('#selectMarsClaim').addEventListener('click', () => {
  if (!deployment.marscoin) return showToast('MarsCoin address is not configured');
  $('#claimStockToken').value = deployment.marscoin;
  $('#claimBrokerTokenId').focus();
  showToast('MarsCoin selected · Enter broker ID and amount');
});
$('#claimStockAction').addEventListener('click', (event) => {
  runContractAction(event.currentTarget, 'CLAIMING…', 'Claim token routed to connected wallet', () => {
    const tokenId = positiveInteger('#claimBrokerTokenId', 'Broker token ID');
    const token = requiredValue('#claimStockToken', 'Token contract');
    const amount = requiredValue('#claimStockAmount', 'Amount');
    return $('#claimControlMode').value === 'staked'
      ? actions.routeFromStakedBroker(contractSession, tokenId, token, walletAddress, amount)
      : actions.routeToWallet(contractSession, tokenId, token, walletAddress, amount);
  });
});

async function refreshMarsSwapQuote() {
  if (!contractSession) throw new Error('Connect a verified wallet first');
  const direction = $('#marsSwapDirection').value;
  const amount = requiredValue('#marsSwapAmount', 'Swap amount');
  const quote = await actions.readMarsSwapQuote(contractSession, direction, amount);
  const outputSymbol = direction === 'bnbToMars' ? 'MarsCoin' : 'BNB';
  $('#swapQuoteOutput').textContent = `${quote.formattedOut} ${outputSymbol}`;
  $('#swapLiquidityStatus').textContent = 'Live route · PancakeSwap V3';
  $('#marsSwapMinimum').value = quote.formattedMinimum;
  return quote;
}
$('#marsSwapDirection').addEventListener('change', () => {
  $('#swapQuoteOutput').textContent = '—';
  $('#marsSwapMinimum').value = '';
  $('#swapLiquidityStatus').textContent = 'Official PancakeSwap QuoterV2';
  $('#approveClaimSwap').disabled = !contractSession || $('#marsSwapDirection').value !== 'marsToBnb';
});
$('#refreshSwapQuote').addEventListener('click', (event) => {
  runContractAction(event.currentTarget, 'READING…', 'Live PancakeSwap quote loaded', refreshMarsSwapQuote);
});
$('#approveClaimSwap').addEventListener('click', (event) => {
  runContractAction(event.currentTarget, 'APPROVING…', 'MarsCoin approval confirmed', async () => {
    if ($('#marsSwapDirection').value !== 'marsToBnb') throw new Error('Approval is only required for MarsCoin → BNB');
    await actions.approveMarsSwap(contractSession, requiredValue('#marsSwapAmount', 'MarsCoin amount'));
  });
});
$('#executeClaimSwap').addEventListener('click', (event) => {
  runContractAction(event.currentTarget, 'SWAPPING…', 'PancakeSwap transaction confirmed on-chain', async () => {
    const direction = $('#marsSwapDirection').value;
    const amount = requiredValue('#marsSwapAmount', 'Swap amount');
    await refreshMarsSwapQuote();
    const minimum = requiredValue('#marsSwapMinimum', 'Minimum output');
    if (direction === 'bnbToMars') await actions.swapBnbForMars(contractSession, amount, minimum);
    else await actions.swapMarsForBnb(contractSession, amount, minimum);
    await refreshMarsSwapQuote();
  });
});

$$('.destination-options button').forEach((button) => button.addEventListener('click', () => {
  $$('.destination-options button').forEach((item) => item.classList.toggle('active', item === button));
  brokerRouteMode = button.dataset.routeMode;
  $('.box-control').classList.toggle('route-mode', brokerRouteMode === 'route');
  $('#executeBrokerRoute').textContent = brokerRouteMode === 'seal' ? '02 · SEAL TO BROKER' : 'ROUTE TO WALLET';
}));

$('#approveBrokerAsset').addEventListener('click', (event) => {
  runContractAction(event.currentTarget, 'APPROVING…', 'Router approval confirmed', () => {
    const token = requiredValue('#brokerRouteAsset', 'Token contract');
    const amount = requiredValue('#brokerRouteAmount', 'Amount');
    return actions.approveSeal(contractSession, token, amount);
  });
});
$('#executeBrokerRoute').addEventListener('click', (event) => {
  const pending = brokerRouteMode === 'seal' ? 'SEALING…' : 'ROUTING…';
  const success = brokerRouteMode === 'seal' ? 'Asset sealed into broker TBA' : 'Asset routed to wallet';
  runContractAction(event.currentTarget, pending, success, () => {
    const tokenId = positiveInteger('#brokerRouteTokenId', 'Broker token ID');
    const token = requiredValue('#brokerRouteAsset', 'Token contract');
    const amount = requiredValue('#brokerRouteAmount', 'Amount');
    if (brokerRouteMode === 'seal') return actions.sealToBroker(contractSession, tokenId, token, amount);
    const recipient = requiredValue('#brokerRouteRecipient', 'Destination wallet');
    return $('#brokerRouteControl').value === 'staked'
      ? actions.routeFromStakedBroker(contractSession, tokenId, token, recipient, amount)
      : actions.routeToWallet(contractSession, tokenId, token, recipient, amount);
  });
});

$$('.vault-tabs button').forEach((button) => button.addEventListener('click', () => {
  const target = button.dataset.vaultTab;
  $$('.vault-tabs button').forEach((item) => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  $$('[data-vault-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.vaultPanel === target));
}));
$('#vaultSelectBroker').addEventListener('click', () => {
  if (!walletAddress) connectWallet();
  else showToast('Wallet connected');
});

$('#approveNftStake').addEventListener('click', (event) => {
  runContractAction(event.currentTarget, 'APPROVING…', 'NFT approval confirmed', () => {
    const tokenId = positiveInteger('#stakeNftId', 'Token ID');
    return actions.approveNftStaking(contractSession, tokenId);
  });
});
$('#stakeNft').addEventListener('click', (event) => {
  runContractAction(event.currentTarget, 'STAKING…', 'MarsBroker staked on-chain', () => {
    const tokenId = positiveInteger('#stakeNftId', 'Token ID');
    const tier = Number($('#stakeNftTier').value);
    return actions.stakeNft(contractSession, tokenId, tier);
  });
});
$('#unstakeNft').addEventListener('click', (event) => {
  runContractAction(event.currentTarget, 'UNSTAKING…', 'MarsBroker returned to wallet', () => {
    const tokenId = positiveInteger('#stakeNftId', 'Token ID');
    return actions.unstakeNft(contractSession, tokenId);
  });
});
$('#approveTokenStake').addEventListener('click', (event) => {
  runContractAction(event.currentTarget, 'APPROVING…', 'Token approval confirmed', () => {
    const token = requiredValue('#stakeTokenAddress', 'Token contract');
    const amount = requiredValue('#stakeTokenAmount', 'Amount');
    return actions.approveTokenStaking(contractSession, token, amount);
  });
});
$('#stakeToken').addEventListener('click', (event) => {
  runContractAction(event.currentTarget, 'STAKING…', 'Token position staked on-chain', () => {
    const token = requiredValue('#stakeTokenAddress', 'Token contract');
    const amount = requiredValue('#stakeTokenAmount', 'Amount');
    const tier = Number($('#stakeTokenTier').value);
    return actions.stakeToken(contractSession, token, amount, tier);
  });
});
$('#unstakeToken').addEventListener('click', (event) => {
  runContractAction(event.currentTarget, 'UNSTAKING…', 'Token principal returned to wallet', () => {
    const stakeId = positiveInteger('#unstakeTokenId', 'Stake position ID');
    return actions.unstakeToken(contractSession, stakeId);
  });
});

$('#copyReferral').addEventListener('click', async () => {
  if (!walletAddress) { connectWallet(); return; }
  try {
    await navigator.clipboard.writeText($('#referralInput').value);
    showToast('Referral route copied');
  } catch {
    $('#referralInput').select();
    showToast('Referral route selected — copy it manually');
  }
});

$$('[data-doc-target]').forEach((button) => button.addEventListener('click', () => {
  const target = button.dataset.docTarget;
  $$('[data-doc-target]').forEach((item) => item.classList.toggle('active', item === button));
  $$('[data-doc-section]').forEach((section) => section.classList.toggle('active', section.dataset.docSection === target));
  const content = $('.docs-content');
  if (content) content.scrollTo({ top: 0, behavior: 'instant' });
}));

$('#globalSearch').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const query = event.currentTarget.value.trim().toLowerCase();
  const modules = ['hub','market','swap','rewards','box','vault','options','referrals','docs'];
  const match = modules.find((name) => name.includes(query) || (query === 'nft' && name === 'market') || (query === 'broker' && name === 'market'));
  if (match) showModule(match);
  else showToast('No module matches that search');
});

window.addEventListener('hashchange', () => {
  const hashModule = location.hash.slice(1) || 'hub';
  const validModules = ['hub','market','swap','rewards','box','vault','options','referrals','docs'];
  if (hashModule !== currentModule) showModule(validModules.includes(hashModule) ? hashModule : 'hub');
});

const initialModule = location.hash.slice(1);
if (initialModule) showModule(['market','swap','rewards','box','vault','options','referrals','docs'].includes(initialModule) ? initialModule : 'hub');

loadCollection();
