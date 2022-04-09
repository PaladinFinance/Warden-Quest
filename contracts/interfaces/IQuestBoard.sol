// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @dev Interface for QuestBoard tokens whitelist
 */
interface IQuestBoard {

    function whitelistedTokens(address token) external view returns(bool);
    
}