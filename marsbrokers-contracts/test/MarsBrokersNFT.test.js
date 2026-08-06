const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MarsBrokersNFT", function () {
  const PRICE = ethers.parseEther("0.035");
  const TREASURY = "0xF215614466D02F698d6dD0d9d940d4f51CF892a4";

  async function deployFixture() {
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
    return { registry, implementation, nft };
  }

  it("reserves Genesis IDs 1-3 in the constructor and allows public mint immediately", async function () {
    const [, buyer] = await ethers.getSigners();
    const { nft } = await deployFixture();
    expect(await nft.ownerOf(1)).to.equal(TREASURY);
    expect(await nft.ownerOf(2)).to.equal(TREASURY);
    expect(await nft.ownerOf(3)).to.equal(TREASURY);
    expect(await nft.totalSupply()).to.equal(3n);
    await nft.connect(buyer).mint(ethers.ZeroAddress, { value: PRICE });
    expect(await nft.ownerOf(4)).to.equal(buyer.address);
  });

  it("mints one NFT for exactly 0.035 BNB and forwards all BNB to treasury", async function () {
    const [, buyer] = await ethers.getSigners();
    const { nft } = await deployFixture();
    const before = await ethers.provider.getBalance(TREASURY);

    await expect(nft.connect(buyer).mint(ethers.ZeroAddress, { value: PRICE }))
      .to.emit(nft, "BrokerMinted")
      .withArgs(buyer.address, 4n, 4n, ethers.ZeroAddress);

    expect(await nft.ownerOf(4)).to.equal(buyer.address);
    expect(await ethers.provider.getBalance(TREASURY)).to.equal(before + PRICE);
    expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(0n);
  });

  it("creates a distinct ERC-6551 account during mint", async function () {
    const [, buyer] = await ethers.getSigners();
    const { nft } = await deployFixture();
    await nft.connect(buyer).mint(ethers.ZeroAddress, { value: PRICE });

    const accountAddress = await nft.accountOf(4);
    expect(accountAddress).not.to.equal(ethers.ZeroAddress);
    expect(await ethers.provider.getCode(accountAddress)).not.to.equal("0x");
    const account = await ethers.getContractAt("MarsBrokerAccount", accountAddress);
    const [chainId, tokenContract, tokenId] = await account.token();
    expect(chainId).to.equal((await ethers.provider.getNetwork()).chainId);
    expect(tokenContract).to.equal(await nft.getAddress());
    expect(tokenId).to.equal(4n);
  });

  it("gives one buyer a single 2-for-1 mint when referred by an existing holder", async function () {
    const [, holder, buyer] = await ethers.getSigners();
    const { nft } = await deployFixture();
    await nft.connect(holder).mint(ethers.ZeroAddress, { value: PRICE });
    const before = await ethers.provider.getBalance(TREASURY);

    await nft.connect(buyer).mint(holder.address, { value: PRICE });
    expect(await nft.balanceOf(buyer.address)).to.equal(2n);
    expect(await nft.ownerOf(5)).to.equal(buyer.address);
    expect(await nft.ownerOf(6)).to.equal(buyer.address);
    expect(await nft.accountOf(5)).not.to.equal(await nft.accountOf(6));
    expect(await ethers.provider.getBalance(TREASURY)).to.equal(before + PRICE);
    await expect(nft.connect(buyer).mint(holder.address, { value: PRICE })).to.be.reverted;
  });

  it("limits one referrer to ten successful 2-for-1 uses", async function () {
    const signers = await ethers.getSigners();
    const holder = signers[1];
    const { nft } = await deployFixture();
    await nft.connect(holder).mint(ethers.ZeroAddress, { value: PRICE });
    for (const buyer of signers.slice(2, 12)) {
      await nft.connect(buyer).mint(holder.address, { value: PRICE });
    }
    await expect(nft.connect(signers[12]).mint(holder.address, { value: PRICE })).to.be.reverted;
  });

  it("rejects wrong payments, self referrals and referrals from non-holders", async function () {
    const [, buyer, stranger] = await ethers.getSigners();
    const { nft } = await deployFixture();
    await expect(nft.connect(buyer).mint(ethers.ZeroAddress, { value: PRICE - 1n }))
      .to.be.revertedWithCustomError(nft, "IncorrectPayment");
    await expect(nft.connect(buyer).mint(stranger.address, { value: PRICE }))
      .to.be.revertedWithCustomError(nft, "InvalidReferral");
    await nft.connect(buyer).mint(ethers.ZeroAddress, { value: PRICE });
    await expect(nft.connect(buyer).mint(buyer.address, { value: PRICE }))
      .to.be.revertedWithCustomError(nft, "InvalidReferral");
  });

  it("has no collection cap and cycles 27 identities without reusing token IDs", async function () {
    const [, buyer] = await ethers.getSigners();
    const { nft } = await deployFixture();
    for (let i = 0; i < 28; i += 1) {
      await nft.connect(buyer).mint(ethers.ZeroAddress, { value: PRICE });
    }
    expect(await nft.totalSupply()).to.equal(31n);
    expect(await nft.brokerIdentity(4)).to.equal(4n);
    expect(await nft.brokerIdentity(31)).to.equal(4n);
    expect(await nft.accountOf(4)).not.to.equal(await nft.accountOf(31));
  });
});
