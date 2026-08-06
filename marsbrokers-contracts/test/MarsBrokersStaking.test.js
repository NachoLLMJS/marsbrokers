const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRICE = ethers.parseEther("0.035");
const TREASURY = "0xF215614466D02F698d6dD0d9d940d4f51CF892a4";

async function deployNFT() {
  const Registry = await ethers.getContractFactory("ERC6551Registry");
  const registry = await Registry.deploy();
  const Account = await ethers.getContractFactory("MarsBrokerAccount");
  const implementation = await Account.deploy();
  const NFT = await ethers.getContractFactory("MarsBrokersNFT");
  const nft = await NFT.deploy(
    TREASURY,
    await registry.getAddress(),
    await implementation.getAddress(),
    "ipfs://marsbrokers/"
  );
  return nft;
}

describe("MarsBrokersStaking", function () {
  it("locks an NFT for one week, blocks early withdrawal and returns the same NFT with points", async function () {
    const [owner, staker] = await ethers.getSigners();
    const nft = await deployNFT();
    await nft.connect(staker).mint(ethers.ZeroAddress, { value: PRICE });

    const Staking = await ethers.getContractFactory("MarsBrokersStaking");
    const staking = await Staking.deploy(await nft.getAddress());
    await nft.connect(staker).approve(await staking.getAddress(), 4);

    await expect(staking.connect(staker).stakeNFT(4, 0))
      .to.emit(staking, "NFTStaked");

    expect(await nft.ownerOf(4)).to.equal(await staking.getAddress());
    expect((await staking.nftStakes(4)).staker).to.equal(staker.address);
    await expect(staking.connect(staker).unstakeNFT(4))
      .to.be.revertedWithCustomError(staking, "StillLocked");

    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await staking.connect(staker).unstakeNFT(4);

    expect(await nft.ownerOf(4)).to.equal(staker.address);
    expect(await staking.loyaltyPoints(staker.address)).to.equal(7n);
  });

  it("keeps ERC-20 principal solvent and returns it after a one-month lock", async function () {
    const [owner, staker] = await ethers.getSigners();
    const nft = await deployNFT();
    const Staking = await ethers.getContractFactory("MarsBrokersStaking");
    const staking = await Staking.deploy(await nft.getAddress());
    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Flap", "FLAP", 18);
    const amount = ethers.parseEther("10");
    await token.mint(staker.address, ethers.parseEther("100"));
    await staking.connect(owner).setTokenAllowed(await token.getAddress(), true);
    await token.connect(staker).approve(await staking.getAddress(), amount);

    await expect(staking.connect(staker).stakeToken(await token.getAddress(), amount, 1))
      .to.emit(staking, "TokenStaked");

    expect(await token.balanceOf(await staking.getAddress())).to.equal(amount);
    expect(await staking.totalTokenPrincipal(await token.getAddress())).to.equal(amount);
    await expect(staking.connect(staker).unstakeToken(1))
      .to.be.revertedWithCustomError(staking, "StillLocked");

    await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await staking.connect(staker).unstakeToken(1);

    expect(await token.balanceOf(staker.address)).to.equal(ethers.parseEther("100"));
    expect(await staking.totalTokenPrincipal(await token.getAddress())).to.equal(0n);
    expect(await staking.loyaltyPoints(staker.address)).to.equal(1200n);
  });

  it("lets the staker claim ERC-20 stocks from the broker TBA while the NFT remains locked", async function () {
    const [, staker] = await ethers.getSigners();
    const nft = await deployNFT();
    await nft.connect(staker).mint(ethers.ZeroAddress, { value: PRICE });
    const Staking = await ethers.getContractFactory("MarsBrokersStaking");
    const staking = await Staking.deploy(await nft.getAddress());
    await nft.connect(staker).approve(await staking.getAddress(), 4);
    await staking.connect(staker).stakeNFT(4, 2);

    const Token = await ethers.getContractFactory("MockERC20");
    const stock = await Token.deploy("Tokenized Stock", "STOCK", 18);
    const amount = ethers.parseEther("3");
    const account = await nft.accountOf(4);
    await stock.mint(account, amount);
    await expect(staking.connect(staker).claimBrokerERC20(4, await stock.getAddress(), amount)).to.be.reverted;
    await staking.setTokenAllowed(await stock.getAddress(), true);
    await staking.connect(staker).claimBrokerERC20(4, await stock.getAddress(), amount);

    expect(await stock.balanceOf(staker.address)).to.equal(amount);
    expect(await nft.ownerOf(4)).to.equal(await staking.getAddress());
  });

  it("allows recovery of donated surplus but never staked principal", async function () {
    const [owner, staker, donor] = await ethers.getSigners();
    const nft = await deployNFT();
    const Staking = await ethers.getContractFactory("MarsBrokersStaking");
    const staking = await Staking.deploy(await nft.getAddress());
    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Flap", "FLAP", 18);
    const principal = ethers.parseEther("10");
    const surplus = ethers.parseEther("2");
    await token.mint(staker.address, principal);
    await token.mint(donor.address, surplus);
    await staking.setTokenAllowed(await token.getAddress(), true);
    await token.connect(staker).approve(await staking.getAddress(), principal);
    await staking.connect(staker).stakeToken(await token.getAddress(), principal, 0);
    await token.connect(donor).transfer(await staking.getAddress(), surplus);

    await staking.recoverTokenSurplus(await token.getAddress(), owner.address, surplus);
    expect(await token.balanceOf(await staking.getAddress())).to.equal(principal);
    await expect(staking.recoverTokenSurplus(await token.getAddress(), owner.address, 1))
      .to.be.revertedWithCustomError(staking, "InsufficientSurplus");

    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await staking.connect(staker).unstakeToken(1);
    expect(await token.balanceOf(staker.address)).to.equal(principal);
  });

  it("rejects fee-on-transfer tokens before recording insolvent principal", async function () {
    const [, staker] = await ethers.getSigners();
    const nft = await deployNFT();
    const Staking = await ethers.getContractFactory("MarsBrokersStaking");
    const staking = await Staking.deploy(await nft.getAddress());
    const FeeToken = await ethers.getContractFactory("MockFeeERC20");
    const token = await FeeToken.deploy();
    const amount = ethers.parseEther("10");
    await token.mint(staker.address, amount);
    await staking.setTokenAllowed(await token.getAddress(), true);
    await token.connect(staker).approve(await staking.getAddress(), amount);

    await expect(staking.connect(staker).stakeToken(await token.getAddress(), amount, 0))
      .to.be.revertedWithCustomError(staking, "UnsupportedTransferBehavior");
    expect(await staking.totalTokenPrincipal(await token.getAddress())).to.equal(0n);
    expect(await token.balanceOf(await staking.getAddress())).to.equal(0n);
  });

  it("halts every withdrawal after a negative rebase until the exact shortfall is topped up", async function () {
    const [, staker, funder] = await ethers.getSigners();
    const nft = await deployNFT();
    const Staking = await ethers.getContractFactory("MarsBrokersStaking");
    const staking = await Staking.deploy(await nft.getAddress());
    const Token = await ethers.getContractFactory("MockMutableERC20");
    const token = await Token.deploy();
    const amount = ethers.parseEther("10");
    const shortfall = ethers.parseEther("1");
    await token.mint(staker.address, amount);
    await staking.setTokenAllowed(await token.getAddress(), true);
    await token.connect(staker).approve(await staking.getAddress(), amount);
    await staking.connect(staker).stakeToken(await token.getAddress(), amount, 0);
    await token.slash(await staking.getAddress(), shortfall);
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(staking.connect(staker).unstakeToken(1)).to.be.reverted;
    await token.mint(funder.address, shortfall);
    await token.connect(funder).approve(await staking.getAddress(), shortfall);
    await staking.connect(funder).topUpToken(await token.getAddress(), shortfall);
    await staking.connect(staker).unstakeToken(1);
    expect(await token.balanceOf(staker.address)).to.equal(amount);
  });

  it("preserves the position if an allowlisted token later enables an exit fee", async function () {
    const [, staker] = await ethers.getSigners();
    const nft = await deployNFT();
    const Staking = await ethers.getContractFactory("MarsBrokersStaking");
    const staking = await Staking.deploy(await nft.getAddress());
    const Token = await ethers.getContractFactory("MockMutableERC20");
    const token = await Token.deploy();
    const amount = ethers.parseEther("10");
    await token.mint(staker.address, amount);
    await staking.setTokenAllowed(await token.getAddress(), true);
    await token.connect(staker).approve(await staking.getAddress(), amount);
    await staking.connect(staker).stakeToken(await token.getAddress(), amount, 0);
    await token.setFeeEnabled(true);
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(staking.connect(staker).unstakeToken(1)).to.be.reverted;
    expect((await staking.tokenStakes(1)).amount).to.equal(amount);
    expect(await staking.totalTokenPrincipal(await token.getAddress())).to.equal(amount);
  });
});
