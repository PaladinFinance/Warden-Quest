//██████╗  █████╗ ██╗      █████╗ ██████╗ ██╗███╗   ██╗
//██╔══██╗██╔══██╗██║     ██╔══██╗██╔══██╗██║████╗  ██║
//██████╔╝███████║██║     ███████║██║  ██║██║██╔██╗ ██║
//██╔═══╝ ██╔══██║██║     ██╔══██║██║  ██║██║██║╚██╗██║
//██║     ██║  ██║███████╗██║  ██║██████╔╝██║██║ ╚████║
//╚═╝     ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═════╝ ╚═╝╚═╝  ╚═══╝
 

// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../oz/interfaces/IERC20.sol";
import "../oz/libraries/SafeERC20.sol";
import "../oz/utils/ReentrancyGuard.sol";
import "../utils/Errors.sol";
import "../QuestBoard.sol";
import "../interfaces/ISimpleDistributor.sol";

/** @title Warden Quest Governance Questor contract */
/// @author Paladin
/*
    Contract allowing to create (and manage) Quests
    while sharing fees if the partner
    Alows to set a blacklist of claimers to be applied to all Quests
    created by that contract
*/

contract GovernanceQuestor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /** @notice 1e18 scale */
    uint256 private constant UNIT = 1e18;
    /** @notice Max BPS value (100%) */
    uint256 private constant MAX_BPS = 10000;


    QuestBoard public immutable board;

    address public immutable governance;

    address public immutable manager;

    uint256[] public createdQuests;

    bool public killed;

    // Quest parameters

    address public gauge;
    
    address public rewardToken;
    
    uint48 public duration;
    
    uint256 public objective;
    
    uint256 public rewardPerVote;


    event DurationUpdated(uint48 oldDuration, uint48 newDuration);
    event ObjectiveUpdated(uint256 oldOjective, uint256 newObjective);    
    event RewardPerVoteUpdated(uint256 oldReward, uint256 newReward);

    event Killed();


    modifier onlyManager(){
        if(msg.sender != manager) revert Errors.CallerNotAllowed();
        _;
    }

    modifier onlyGov(){
        if(msg.sender != governance) revert Errors.CallerNotAllowed();
        _;
    }

    modifier notKilled(){
        if(killed) revert Errors.Killed();
        _;
    }

    constructor(
        address _board,
        address _governance,
        address _manager,
        address _gauge,
        address _rewardToken,
        uint48 _duration,
        uint256 _objective,
        uint256 _rewardPerVote
    ){
        if(_board == address(0) || _governance == address(0) || _manager == address(0) || _gauge == address(0) || _rewardToken == address(0)) revert Errors.ZeroAddress();
        if(_duration == 0 || _objective == 0 || _rewardPerVote == 0) revert Errors.NullAmount();

        board = QuestBoard(_board);

        governance = _governance;
        manager = _manager;

        gauge = _gauge;
        rewardToken = _rewardToken;
        duration = _duration;
        objective = _objective;
        rewardPerVote = _rewardPerVote;
    }

    function createQuest() external notKilled onlyManager nonReentrant returns(uint256) {
        uint256 totalRewardAmount = (objective * rewardPerVote * duration) / UNIT;
        uint256 platformFee = board.platformFee();
        uint256 feeAmount = (totalRewardAmount * platformFee) / MAX_BPS;

        IERC20(rewardToken).safeIncreaseAllowance(address(board), totalRewardAmount + feeAmount);

        uint256 newQuestId = board.createQuest(gauge, rewardToken, duration, objective, rewardPerVote, totalRewardAmount, feeAmount);

        createdQuests.push(newQuestId);

        return newQuestId;

    }

    function withdrawUnusedRewards(uint256 questID, address recipient) external notKilled onlyManager nonReentrant {
        if(recipient == address(0)) revert Errors.ZeroAddress();
        board.withdrawUnusedRewards(questID, recipient);
    }

    function withdrawUnusedRewardsMultiple(uint256[] calldata questIDs, address recipient) external notKilled onlyManager nonReentrant {
        if(recipient == address(0)) revert Errors.ZeroAddress();
        uint256 length = questIDs.length;
        for(uint256 i; i < length;){
            board.withdrawUnusedRewards(questIDs[i], recipient);
            unchecked {
                ++i;
            }
        }
        
    }

    function retrieveBlacklistRewards(
        address distributor,
        address recipient,
        uint256 questID,
        uint256 period,
        uint256 index,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external notKilled onlyManager nonReentrant {
        if(recipient == address(0)) revert Errors.ZeroAddress();
        if(distributor == address(0)) revert Errors.ZeroAddress();

        ISimpleDistributor(distributor).claim(questID, period, index, address(this), amount, merkleProof);

        IERC20(rewardToken).safeTransfer(recipient, amount);

    }

    function emergencyWithdraw(uint256 questID, address recipient) external notKilled onlyManager nonReentrant {
        if(recipient == address(0)) revert Errors.ZeroAddress();
        board.emergencyWithdraw(questID, recipient);
    }

    function changeDuration(uint48 newDuration) external onlyManager {
        if(newDuration == 0) revert Errors.NullAmount();

        uint48 oldDuration = duration;
        duration = newDuration;

        emit DurationUpdated(oldDuration, newDuration);
    }

    function changeDuration(uint256 newObjective) external onlyManager {
        if(newObjective == 0) revert Errors.NullAmount();

        uint256 oldOjective = objective;
        objective = newObjective;

        emit ObjectiveUpdated(oldOjective, newObjective);
    }

    function changeRewardPerVote(uint256 newReward) external onlyManager {
        if(newReward == 0) revert Errors.NullAmount();

        uint256 oldReward = rewardPerVote;
        rewardPerVote = newReward;

        emit RewardPerVoteUpdated(oldReward, newReward);
    }

    function execute(
        address to,
        uint256 value,
        bytes calldata data
    ) external payable onlyGov notKilled returns (bool, bytes memory) {
        (bool success, bytes memory result) = to.call{value: value}(data);
        require(success, _getRevertMsg(result));

        return (success, result);
    }

    function _getRevertMsg(bytes memory _returnData)
        internal
        pure
        returns (string memory)
    {
        if (_returnData.length < 68) return "Transaction reverted silently";

        assembly {
            _returnData := add(_returnData, 0x04)
        }

        return abi.decode(_returnData, (string));
    }


    function recoverERC20(address token, address recipient) external onlyGov returns(bool) {
        if(recipient == address(0)) revert Errors.ZeroAddress();
        uint256 amount = IERC20(token).balanceOf(address(this));
        if(amount == 0) revert Errors.NullAmount();
        IERC20(token).safeTransfer(recipient, amount);

        return true;
    }

    function kill() external onlyGov {
        if(killed) revert Errors.AlreadyKilled();
        killed = true;

        emit Killed();
    }

}