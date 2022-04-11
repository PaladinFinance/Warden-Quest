// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "../oz/utils/Ownable.sol";

/** @title Extend OZ Ownable contract  */
/// @author Paladin

contract Owner is Ownable {

    address public pendingOwner;

    event NewPendingOwner(address indexed previousPendingOwner, address indexed newPendingOwner);

    function transferOwnership(address newOwner) public override virtual onlyOwner {
        require(newOwner != address(0), "Owner: new owner is the zero address");
        require(newOwner != owner(), "Owner: new owner cannot be current owner");
        address oldPendingOwner = pendingOwner;

        pendingOwner = newOwner;

        emit NewPendingOwner(oldPendingOwner, newOwner);
    }

    function acceptOwnership() public virtual {
        require(msg.sender == pendingOwner, "Owner: caller is not pending owner");
        address newOwner = pendingOwner;
        _transferOwnership(pendingOwner);
        pendingOwner = address(0);

        emit NewPendingOwner(newOwner, address(0));
    }

}