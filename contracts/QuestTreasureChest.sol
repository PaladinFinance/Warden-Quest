//██████╗  █████╗ ██╗      █████╗ ██████╗ ██╗███╗   ██╗
//██╔══██╗██╔══██╗██║     ██╔══██╗██╔══██╗██║████╗  ██║
//██████╔╝███████║██║     ███████║██║  ██║██║██╔██╗ ██║
//██╔═══╝ ██╔══██║██║     ██╔══██║██║  ██║██║██║╚██╗██║
//██║     ██║  ██║███████╗██║  ██║██████╔╝██║██║ ╚████║
//╚═╝     ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═════╝ ╚═╝╚═╝  ╚═══╝
 

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

    /** @notice Address approved to use methods to manage funds */
    mapping(address => bool) approvedManagers;

    /** @notice Check the caller is either the admin or an approved manager */
    modifier onlyAllowed(){
        require(approvedManagers[msg.sender] || msg.sender == owner(), "TreasureChest: Not allowed");
        _;
    }

    /**
    * @notice Returns the balance of this contract for the given ERC20 token
    * @dev Returns the balance of this contract for the given ERC20 token
    * @param token Address of the ERC2O token
    * @return uint256 : current balance in the given ERC20 token
    */
    function currentBalance(address token) external view returns(uint256){
        return IERC20(token).balanceOf(address(this));
    }
   
    /**
    * @notice Approves the given amount for the given ERC20 token
    * @dev Approves the given amount for the given ERC20 token
    * @param token Address of the ERC2O token
    * @param spender Address to approve for spending
    * @param amount Amount to approve
    */
    function approveERC20(address token, address spender, uint256 amount) external onlyAllowed nonReentrant {
        IERC20(token).safeApprove(spender, amount);
    }
   
    /**
    * @notice Transfers a given amount of ERC20 token to the given recipient
    * @dev Transfers a given amount of ERC20 token to the given recipient
    * @param token Address of the ERC2O token
    * @param recipient Address fo the recipient
    * @param amount Amount to transfer
    */
    function transferERC20(address token, address recipient, uint256 amount) external onlyAllowed nonReentrant {
        IERC20(token).safeTransfer(recipient, amount);
    }

    // Admin methods
   
    /**
    * @notice Approves a given address to be manager on this contract
    * @dev Approves a given address to be manager on this contract
    * @param newManager Address to approve as manager
    */
    function approveManager(address newManager) external onlyOwner {
        approvedManagers[newManager] = true;
    }
   
    /**
    * @notice Removes a given address from being manager on this contract
    * @dev Removes a given address from being manager on this contract
    * @param manager Address to remove
    */
    function removeManager(address manager) external onlyOwner {
        approvedManagers[manager] = false;
    }

}