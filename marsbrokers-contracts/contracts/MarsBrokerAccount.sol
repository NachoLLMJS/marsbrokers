// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "erc6551/examples/simple/ERC6551Account.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MarsBrokerAccount is ERC6551Account {
    using SafeERC20 for IERC20;

    error UnsupportedCall();
    error InvalidRecipient();
    error NativeTransferFailed();

    event ERC20Routed(address indexed token, address indexed recipient, uint256 amount);
    event NativeRouted(address indexed recipient, uint256 amount);

    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        override
        returns (bytes memory result)
    {
        if (!_isValidSigner(msg.sender)) revert("Invalid signer");
        if (operation != 0 || value != 0 || msg.value != 0 || data.length != 68) revert UnsupportedCall();
        bytes4 selector = bytes4(data[:4]);
        if (selector != IERC20.transfer.selector) revert UnsupportedCall();
        (address recipient, uint256 amount) = abi.decode(data[4:], (address, uint256));
        _routeERC20(to, recipient, amount);
        return abi.encode(true);
    }

    function routeERC20(address token_, address recipient, uint256 amount) external {
        if (!_isValidSigner(msg.sender)) revert("Invalid signer");
        _routeERC20(token_, recipient, amount);
    }

    function routeNative(address payable recipient, uint256 amount) external {
        if (!_isValidSigner(msg.sender)) revert("Invalid signer");
        if (recipient == address(0)) revert InvalidRecipient();
        ++state;
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
        emit NativeRouted(recipient, amount);
    }

    function _routeERC20(address token_, address recipient, uint256 amount) internal {
        if (recipient == address(0)) revert InvalidRecipient();
        ++state;
        IERC20(token_).safeTransfer(recipient, amount);
        emit ERC20Routed(token_, recipient, amount);
    }
}
