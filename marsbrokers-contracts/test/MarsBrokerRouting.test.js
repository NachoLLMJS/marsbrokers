const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRICE = ethers.parseEther("0.035");

async function fixture() {
  const [deployer, holder, recipient] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("ERC6551Registry");
  const registry = await Registry.deploy();
  const Account = await ethers.getContractFactory("MarsBrokerAccount");
  const implementation = await Account.deploy();
  const NFT = await ethers.getContractFactory("MarsBrokersNFT");
  const nft = await NFT.deploy(deployer.address, await registry.getAddress(), await implementation.getAddress(), "ipfs://marsbrokers/");
  const Router = await ethers.getContractFactory("MarsBrokerRouter");
  const router = await Router.deploy(await nft.getAddress());
  await nft.connect(holder).mint(ethers.ZeroAddress, { value: PRICE });
  const Token = await ethers.getContractFactory("MockERC20");
  const stock = await Token.deploy("Tokenized Stock", "STOCK", 18);
  return { holder, recipient, nft, router, stock };
}

describe("MarsBroker routing", function () {
  it("seals a stock into the TBA and lets the NFT owner route it to a wallet", async function () {
    const { holder, recipient, nft, router, stock } = await fixture();
    const amount = ethers.parseEther("5");
    await stock.mint(holder.address, amount);
    await stock.connect(holder).approve(await router.getAddress(), amount);

    await router.connect(holder).sealToBroker(4, await stock.getAddress(), amount);
    const accountAddress = await nft.accountOf(4);
    expect(await stock.balanceOf(accountAddress)).to.equal(amount);

    const account = await ethers.getContractAt("MarsBrokerAccount", accountAddress);
    await account.connect(holder).routeERC20(await stock.getAddress(), recipient.address, amount);
    expect(await stock.balanceOf(recipient.address)).to.equal(amount);
    expect(await stock.balanceOf(accountAddress)).to.equal(0n);
  });

  it("rejects arbitrary approvals through the generic ERC-6551 execute entrypoint", async function () {
    const { holder, recipient, nft, stock } = await fixture();
    const account = await ethers.getContractAt("MarsBrokerAccount", await nft.accountOf(4));
    const approval = stock.interface.encodeFunctionData("approve", [recipient.address, ethers.MaxUint256]);
    await expect(account.connect(holder).execute(await stock.getAddress(), 0, approval, 0)).to.be.reverted;
    expect(await stock.allowance(await account.getAddress(), recipient.address)).to.equal(0n);
  });
});
