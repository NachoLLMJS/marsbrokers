// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockMutableERC20 is ERC20 {
    bool public feeEnabled;

    constructor() ERC20("Mutable Token", "MUT") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function slash(address account, uint256 amount) external { _burn(account, amount); }
    function setFeeEnabled(bool enabled) external { feeEnabled = enabled; }

    function _transfer(address from, address to, uint256 amount) internal override {
        if (!feeEnabled) {
            super._transfer(from, to, amount);
            return;
        }
        uint256 fee = amount / 10;
        super._transfer(from, to, amount - fee);
        _burn(from, fee);
    }
}
