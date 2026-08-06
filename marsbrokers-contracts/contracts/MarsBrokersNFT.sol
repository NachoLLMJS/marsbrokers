// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "erc6551/ERC6551Registry.sol";

contract MarsBrokersNFT is ERC721Enumerable, Ownable2Step, Pausable, ReentrancyGuard {
    using Strings for uint256;

    uint256 public constant MINT_PRICE = 0.035 ether;
    uint8 public constant IDENTITY_COUNT = 27;
    uint8 public constant MAX_REFERRALS_PER_HOLDER = 10;
    bytes32 public constant ACCOUNT_SALT = bytes32(0);

    address payable public immutable treasury;
    IERC6551Registry public immutable accountRegistry;
    address public immutable accountImplementation;

    uint256 private _nextTokenId = 1;
    bool public genesisMinted;
    string private _metadataBaseURI;
    mapping(uint256 => address) public tokenBoundAccount;
    mapping(address => bool) public referralUsed;
    mapping(address => uint8) public referrerUseCount;

    error IncorrectPayment();
    error InvalidReferral();

    error ReferralAlreadyUsed();
    error ReferralBudgetExhausted();
    error TreasuryTransferFailed();

    event BrokerMinted(
        address indexed minter,
        uint256 indexed tokenId,
        uint8 identityId,
        address indexed referrer
    );

    constructor(
        address payable treasury_,
        address registry_,
        address implementation_,
        string memory metadataBaseURI_
    ) ERC721("MarsBrokers", "MARSBROKER") {
        require(treasury_ != address(0), "zero treasury");
        require(registry_ != address(0), "zero registry");
        require(implementation_ != address(0), "zero implementation");
        treasury = treasury_;
        accountRegistry = IERC6551Registry(registry_);
        accountImplementation = implementation_;
        _metadataBaseURI = metadataBaseURI_;
        genesisMinted = true;
        _mintBroker(treasury, address(0));
        _mintBroker(treasury, address(0));
        _mintBroker(treasury, address(0));
    }

    function mint(address referrer) external payable nonReentrant whenNotPaused {
        if (msg.value != MINT_PRICE) revert IncorrectPayment();

        uint256 quantity = 1;
        if (referrer != address(0)) {
            if (referrer == msg.sender || balanceOf(referrer) == 0) revert InvalidReferral();
            if (referralUsed[msg.sender]) revert ReferralAlreadyUsed();
            if (referrerUseCount[referrer] >= MAX_REFERRALS_PER_HOLDER) {
                revert ReferralBudgetExhausted();
            }
            referralUsed[msg.sender] = true;
            ++referrerUseCount[referrer];
            quantity = 2;
        }

        for (uint256 i; i < quantity; ++i) {
            _mintBroker(msg.sender, referrer);
        }

        (bool sent,) = treasury.call{value: msg.value}("");
        if (!sent) revert TreasuryTransferFailed();
    }
    function brokerIdentity(uint256 tokenId) public view returns (uint8) {
        require(_exists(tokenId), "nonexistent token");
        return uint8(((tokenId - 1) % IDENTITY_COUNT) + 1);
    }

    function accountOf(uint256 tokenId) external view returns (address) {
        require(_exists(tokenId), "nonexistent token");
        return tokenBoundAccount[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        uint8 identity = brokerIdentity(tokenId);
        return string.concat(_metadataBaseURI, uint256(identity).toString(), ".json");
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _mintBroker(address recipient, address referrer) internal {
        uint256 tokenId = _nextTokenId++;
        _safeMint(recipient, tokenId);
        address account = accountRegistry.createAccount(
            accountImplementation,
            ACCOUNT_SALT,
            block.chainid,
            address(this),
            tokenId
        );
        tokenBoundAccount[tokenId] = account;
        emit BrokerMinted(recipient, tokenId, brokerIdentity(tokenId), referrer);
    }
}
