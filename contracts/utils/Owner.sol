// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "../oz/utils/Ownable.sol";

/** @title Extend OZ Ownable contract  */
/// @author Paladin

contract Owner is Ownable {

    address private _pendingOwner;

    event NewPendingOwner(address indexed previousPendingOwner, address indexed newPendingOwner);

    function pendingOwner() public view virtual returns (address) {
        return _pendingOwner;
    }

    function transferOwnership(address newOwner) public override virtual onlyOwner {
        require(newOwner != address(0), "Owner: new owner is the zero address");
        address oldPendingOwner = _pendingOwner;

        _pendingOwner = newOwner;

        emit NewPendingOwner(oldPendingOwner, newOwner);
    }

    function acceptOwnership() public virtual {
        require(msg.sender == _pendingOwner, "Owner: caller is not pending owner");
        _transferOwnership(_pendingOwner);
    }

}