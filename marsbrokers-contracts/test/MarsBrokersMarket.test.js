const { expect } = require("chai");
const { ethers } = require("hardhat");

async function deployFixture() {
  const [deployer, genesisSeller, buyer, recipient] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("ERC6551Registry");
  const registry = await Registry.deploy();
  const Account = await ethers.getContractFactory("MarsBrokerAccount");
  const implementation = await Account.deploy();
  const NFT = await ethers.getContractFactory("MarsBrokersNFT");
  const nft = await NFT.deploy(
    genesisSeller.address,
    await registry.getAddress(),
    await implementation.getAddress(),
    "ipfs://marsbrokers/"
  );
  const Market = await ethers.getContractFactory("MarsBrokersMarket");
  const market = await Market.deploy(await nft.getAddress());
  return { deployer, genesisSeller, buyer, recipient, nft, market };
}

describe("MarsBrokersMarket", function () {
  it("escrows a Genesis broker, freezes seller TBA control and sends sale proceeds to treasury seller", async function () {
    const { genesisSeller, buyer, recipient, nft, market } = await deployFixture();
    const price = ethers.parseEther("0.1");
    const Token = await ethers.getContractFactory("MockERC20");
    const stock = await Token.deploy("Tokenized Stock", "STOCK", 18);
    const stockAmount = ethers.parseEther("3");
    const accountAddress = await nft.accountOf(1);
    await stock.mint(accountAddress, stockAmount);
    const account = await ethers.getContractAt("MarsBrokerAccount", accountAddress);

    await nft.connect(genesisSeller).setApprovalForAll(await market.getAddress(), true);
    await market.connect(genesisSeller).list(1, price);
    expect(await nft.ownerOf(1)).to.equal(await market.getAddress());
    await expect(account.connect(genesisSeller).routeERC20(await stock.getAddress(), recipient.address, stockAmount)).to.be.reverted;

    await expect(market.connect(buyer).buy(1, { value: price }))
      .to.emit(market, "Sale")
      .withArgs(1n, genesisSeller.address, buyer.address, price);

    expect(await nft.ownerOf(1)).to.equal(buyer.address);
    expect(await market.pendingProceeds(genesisSeller.address)).to.equal(price);
    await account.connect(buyer).routeERC20(await stock.getAddress(), buyer.address, stockAmount);
    expect(await stock.balanceOf(buyer.address)).to.equal(stockAmount);
  });

  it("returns the escrowed NFT when its seller cancels", async function () {
    const { genesisSeller, nft, market } = await deployFixture();
    const price = ethers.parseEther("0.1");
    await nft.connect(genesisSeller).setApprovalForAll(await market.getAddress(), true);
    await market.connect(genesisSeller).list(1, price);
    await expect(nft.connect(genesisSeller).transferFrom(genesisSeller.address, ethers.ZeroAddress, 1)).to.be.reverted;
    await market.connect(genesisSeller).cancel(1);
    expect(await nft.ownerOf(1)).to.equal(genesisSeller.address);
  });

  it("recovers only forced BNB surplus and preserves all seller liabilities", async function () {
    const { deployer, genesisSeller, buyer, nft, market } = await deployFixture();
    const price = ethers.parseEther("0.1");
    const surplus = ethers.parseEther("1");
    await deployer.sendTransaction({ to: await market.getAddress(), value: surplus });
    await nft.connect(genesisSeller).setApprovalForAll(await market.getAddress(), true);
    await market.connect(genesisSeller).list(1, price);
    await market.connect(buyer).buy(1, { value: price });

    expect(await market.totalPendingProceeds()).to.equal(price);
    await market.recoverNativeSurplus(deployer.address, surplus);
    expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(price);
    await expect(market.recoverNativeSurplus(deployer.address, 1)).to.be.reverted;

    await market.connect(genesisSeller).withdrawProceeds();
    expect(await market.totalPendingProceeds()).to.equal(0n);
    expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);
  });
});
