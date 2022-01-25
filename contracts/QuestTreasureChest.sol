// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./oz/interfaces/IERC20.sol";
import "./oz/libraries/SafeERC20.sol";
import "./oz/utils/Ownable.sol";
import "./oz/utils/ReentrancyGuard.sol";

/** @title Warden Quest Treasure Chest  */
/// @author Paladin
/*
    Contract holding protocol fees from Quest creations
*/

contract QuestTreasureChest is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    mapping(address => bool) approvedManagers;


    modifier onlyAllowed(){
        require(approvedManagers[msg.sender] || msg.sender == owner(), "TreasureChest: Not allowed");
        _;
    }

    function currentBalance(address token) external view returns(uint256){
        return IERC20(token).balanceOf(address(this));
    }

    function approveERC20(address token, address spender, uint256 amount) external onlyAllowed nonReentrant {
        IERC20(token).safeApprove(spender, amount);
    }

    function transferERC20(address token, address recipient, uint256 amount) external onlyAllowed nonReentrant {
        IERC20(token).safeTransfer(recipient, amount);
    }

    // Admin methods

    function approveManager(address newManager) external onlyOwner {
        approvedManagers[newManager] = true;
    }

    function removeManager(address manager) external onlyOwner {
        approvedManagers[manager] = false;
    }

}