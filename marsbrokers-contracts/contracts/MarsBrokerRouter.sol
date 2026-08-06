// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IMarsBrokerAccounts {
    function accountOf(uint256 tokenId) external view returns (address);
}

contract MarsBrokerRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IMarsBrokerAccounts public immutable marsBrokers;

    event SealedToBroker(
        address indexed sender,
        uint256 indexed tokenId,
        address indexed token,
        address account,
        uint256 amount
    );

    constructor(address marsBrokers_) {
        require(marsBrokers_ != address(0), "zero NFT");
        marsBrokers = IMarsBrokerAccounts(marsBrokers_);
    }

    function sealToBroker(uint256 tokenId, address token, uint256 amount)
        external
        nonReentrant
        returns (uint256 received)
    {
        require(amount != 0, "zero amount");
        address account = marsBrokers.accountOf(tokenId);
        uint256 beforeBalance = IERC20(token).balanceOf(account);
        IERC20(token).safeTransferFrom(msg.sender, account, amount);
        received = IERC20(token).balanceOf(account) - beforeBalance;
        require(received != 0, "nothing received");
        emit SealedToBroker(msg.sender, tokenId, token, account, received);
    }
}