// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface IMarsBrokersAccounts {
    function accountOf(uint256 tokenId) external view returns (address);
}

interface IMarsBrokerAccount {
    function routeERC20(address token, address recipient, uint256 amount) external;
}

contract MarsBrokersStaking is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct NFTStake {
        address staker;
        uint64 unlockAt;
        uint32 lockDays;
        uint16 multiplier;
    }

    struct TokenStake {
        address staker;
        address token;
        uint256 amount;
        uint64 unlockAt;
        uint32 lockDays;
        uint16 multiplier;
        uint8 decimals;
    }

    IERC721 public immutable marsBrokers;
    mapping(uint256 => NFTStake) public nftStakes;
    mapping(uint256 => TokenStake) public tokenStakes;
    mapping(address => bool) public allowedTokens;
    mapping(address => uint256) public totalTokenPrincipal;
    mapping(address => uint256) public loyaltyPoints;
    uint256 public nextTokenStakeId = 1;

    error InvalidTier();
    error NotTokenOwner();
    error AlreadyStaked();
    error NotStaker();
    error StillLocked();
    error TokenNotAllowed();
    error ZeroAmount();
    error InsufficientSurplus();
    error UnsupportedTransferBehavior();
    error InsolventToken();

    event NFTStaked(address indexed staker, uint256 indexed tokenId, uint8 indexed tier, uint64 unlockAt);
    event NFTUnstaked(address indexed staker, uint256 indexed tokenId, uint256 pointsEarned);
    event TokenAllowed(address indexed token, bool allowed);
    event TokenStaked(address indexed staker, address indexed token, uint256 indexed stakeId, uint256 amount, uint8 tier, uint64 unlockAt);
    event TokenUnstaked(address indexed staker, address indexed token, uint256 indexed stakeId, uint256 amount, uint256 pointsEarned);
    event TokenSurplusRecovered(address indexed token, address indexed recipient, uint256 amount);
    event BrokerERC20Claimed(address indexed staker, uint256 indexed tokenId, address indexed token, uint256 amount);
    event TokenToppedUp(address indexed funder, address indexed token, uint256 amount);

    constructor(address marsBrokers_) {
        require(marsBrokers_ != address(0), "zero NFT");
        marsBrokers = IERC721(marsBrokers_);
    }

    function tierTerms(uint8 tier) public pure returns (uint32 lockDays, uint16 multiplier) {
        if (tier == 0) return (7, 1);
        if (tier == 1) return (30, 4);
        if (tier == 2) return (365, 20);
        revert InvalidTier();
    }

    function stakeNFT(uint256 tokenId, uint8 tier) external nonReentrant whenNotPaused {
        if (nftStakes[tokenId].staker != address(0)) revert AlreadyStaked();
        if (marsBrokers.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        (uint32 lockDays, uint16 multiplier) = tierTerms(tier);
        uint64 unlockAt = uint64(block.timestamp + uint256(lockDays) * 1 days);
        nftStakes[tokenId] = NFTStake(msg.sender, unlockAt, lockDays, multiplier);
        marsBrokers.transferFrom(msg.sender, address(this), tokenId);
        emit NFTStaked(msg.sender, tokenId, tier, unlockAt);
    }

    function unstakeNFT(uint256 tokenId) external nonReentrant {
        NFTStake memory position = nftStakes[tokenId];
        if (position.staker != msg.sender) revert NotStaker();
        if (block.timestamp < position.unlockAt) revert StillLocked();
        uint256 points = uint256(position.lockDays) * position.multiplier;
        delete nftStakes[tokenId];
        loyaltyPoints[msg.sender] += points;
        marsBrokers.transferFrom(address(this), msg.sender, tokenId);
        emit NFTUnstaked(msg.sender, tokenId, points);
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        require(token.code.length != 0, "token has no code");
        require(IERC20Metadata(token).decimals() <= 18, "decimals above 18");
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function stakeToken(address token, uint256 amount, uint8 tier) external nonReentrant whenNotPaused returns (uint256 stakeId) {
        if (!allowedTokens[token]) revert TokenNotAllowed();
        if (amount == 0) revert ZeroAmount();
        (uint32 lockDays, uint16 multiplier) = tierTerms(tier);
        uint8 decimals = IERC20Metadata(token).decimals();
        uint64 unlockAt = uint64(block.timestamp + uint256(lockDays) * 1 days);
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) - beforeBalance != amount) {
            revert UnsupportedTransferBehavior();
        }
        stakeId = nextTokenStakeId++;
        tokenStakes[stakeId] = TokenStake(msg.sender, token, amount, unlockAt, lockDays, multiplier, decimals);
        totalTokenPrincipal[token] += amount;
        emit TokenStaked(msg.sender, token, stakeId, amount, tier, unlockAt);
    }

    function unstakeToken(uint256 stakeId) external nonReentrant {
        TokenStake memory position = tokenStakes[stakeId];
        if (position.staker != msg.sender) revert NotStaker();
        if (block.timestamp < position.unlockAt) revert StillLocked();
        uint256 contractBalanceBefore = IERC20(position.token).balanceOf(address(this));
        if (contractBalanceBefore < totalTokenPrincipal[position.token]) revert InsolventToken();
        uint256 recipientBalanceBefore = IERC20(position.token).balanceOf(msg.sender);
        uint256 normalizedAmount = position.amount * (10 ** (18 - position.decimals));
        uint256 points = Math.mulDiv(normalizedAmount, uint256(position.lockDays) * position.multiplier, 1e18);
        delete tokenStakes[stakeId];
        totalTokenPrincipal[position.token] -= position.amount;
        loyaltyPoints[msg.sender] += points;
        IERC20(position.token).safeTransfer(msg.sender, position.amount);
        uint256 contractBalanceAfter = IERC20(position.token).balanceOf(address(this));
        uint256 recipientBalanceAfter = IERC20(position.token).balanceOf(msg.sender);
        if (
            contractBalanceBefore - contractBalanceAfter != position.amount
                || recipientBalanceAfter - recipientBalanceBefore != position.amount
        ) revert UnsupportedTransferBehavior();
        emit TokenUnstaked(msg.sender, position.token, stakeId, position.amount, points);
    }

    function topUpToken(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) - beforeBalance != amount) {
            revert UnsupportedTransferBehavior();
        }
        emit TokenToppedUp(msg.sender, token, amount);
    }

    function claimBrokerERC20(uint256 tokenId, address token, uint256 amount) external nonReentrant {
        if (nftStakes[tokenId].staker != msg.sender) revert NotStaker();
        if (!allowedTokens[token]) revert TokenNotAllowed();
        if (amount == 0) revert ZeroAmount();
        address account = IMarsBrokersAccounts(address(marsBrokers)).accountOf(tokenId);
        IMarsBrokerAccount(account).routeERC20(token, msg.sender, amount);
        emit BrokerERC20Claimed(msg.sender, tokenId, token, amount);
    }

    function recoverTokenSurplus(address token, address recipient, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 principal = totalTokenPrincipal[token];
        uint256 surplus = balance > principal ? balance - principal : 0;
        if (amount > surplus) revert InsufficientSurplus();
        IERC20(token).safeTransfer(recipient, amount);
        emit TokenSurplusRecovered(token, recipient, amount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
