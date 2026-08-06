// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract MarsBrokersMarket is Ownable2Step, Pausable, ReentrancyGuard {
    struct Listing { address seller; uint256 price; }

    IERC721 public immutable marsBrokers;
    mapping(uint256 => Listing) public listings;
    mapping(address => uint256) public pendingProceeds;
    uint256 public totalPendingProceeds;

    error NotTokenOwner();
    error MarketNotApproved();
    error InvalidPrice();
    error NotSeller();
    error ListingUnavailable();
    error IncorrectPayment();
    error NothingToWithdraw();
    error PaymentFailed();
    error InsufficientSurplus();
    error InvalidRecipient();

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed tokenId, address indexed seller);
    event Sale(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);
    event ProceedsWithdrawn(address indexed seller, uint256 amount);
    event NativeSurplusRecovered(address indexed recipient, uint256 amount);

    constructor(address marsBrokers_) {
        require(marsBrokers_ != address(0), "zero NFT");
        marsBrokers = IERC721(marsBrokers_);
    }

    receive() external payable {}

    function list(uint256 tokenId, uint256 price) external nonReentrant whenNotPaused {
        if (price == 0) revert InvalidPrice();
        if (marsBrokers.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (marsBrokers.getApproved(tokenId) != address(this) && !marsBrokers.isApprovedForAll(msg.sender, address(this))) {
            revert MarketNotApproved();
        }
        listings[tokenId] = Listing(msg.sender, price);
        marsBrokers.transferFrom(msg.sender, address(this), tokenId);
        emit Listed(tokenId, msg.sender, price);
    }

    function cancel(uint256 tokenId) external nonReentrant {
        Listing memory listing = listings[tokenId];
        if (listing.seller != msg.sender) revert NotSeller();
        delete listings[tokenId];
        marsBrokers.transferFrom(address(this), msg.sender, tokenId);
        emit ListingCancelled(tokenId, msg.sender);
    }

    function buy(uint256 tokenId) external payable nonReentrant whenNotPaused {
        Listing memory listing = listings[tokenId];
        if (listing.seller == address(0) || marsBrokers.ownerOf(tokenId) != address(this)) revert ListingUnavailable();
        if (msg.value != listing.price) revert IncorrectPayment();
        delete listings[tokenId];
        pendingProceeds[listing.seller] += listing.price;
        totalPendingProceeds += listing.price;
        marsBrokers.transferFrom(address(this), msg.sender, tokenId);
        emit Sale(tokenId, listing.seller, msg.sender, listing.price);
    }

    function withdrawProceeds() external nonReentrant {
        uint256 amount = pendingProceeds[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingProceeds[msg.sender] = 0;
        totalPendingProceeds -= amount;
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert PaymentFailed();
        emit ProceedsWithdrawn(msg.sender, amount);
    }

    function recoverNativeSurplus(address payable recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidRecipient();
        uint256 balance = address(this).balance;
        uint256 surplus = balance > totalPendingProceeds ? balance - totalPendingProceeds : 0;
        if (amount > surplus) revert InsufficientSurplus();
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert PaymentFailed();
        emit NativeSurplusRecovered(recipient, amount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
