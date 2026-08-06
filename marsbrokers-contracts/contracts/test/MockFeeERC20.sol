// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockFeeERC20 is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function _transfer(address from, address to, uint256 amount) internal override {
        uint256 fee = amount / 10;
        super._transfer(from, to, amount - fee);
        _burn(from, fee);
    }
}
