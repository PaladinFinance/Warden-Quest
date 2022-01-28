// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./oz/interfaces/IERC20.sol";
import "./oz/libraries/SafeERC20.sol";
import "./oz/utils/Ownable.sol";
import "./oz/utils/ReentrancyGuard.sol";
import "./MultiMerkleDistributor.sol";
import "./interfaces/IGaugeController.sol";

/** @title Warden Quest Board  */
/// @author Paladin
/*
    Main contract, holding all the Quests data & ressources
    Allowing users to add/update Quests
    And the managers to update Quests to the next period & trigger the rewards for closed periods 
*/

contract QuestBoard is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant GAUGE_CONTROLLER = 0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB;

    uint256 public constant WEEK = 604800;
    uint256 public constant UNIT = 1e18;
    uint256 public constant MAX_BPS = 10000;


    enum PeriodState { ACTIVE, CLOSED, DISTRIBUTED } // State of each Period for each Quest
    // All Periods are ACTIVE by default since they voters from past periods are also accounted for the future period



    struct QuestPeriod {
        uint256 periodStart;
        PeriodState currentState;
        uint256 rewardAmountPerPeriod;
        uint256 rewardPerSlopePoint;
        uint256 objectiveSlope;
        uint256 rewardAmountDistributed;
        uint256 withdrawableAmount; // Amount not distributed, for Quest creator to redeem
    }

    struct Quest {
        address creator;
        address rewardToken;
        address gauge;
        // Total amount of rewards paid for this Quest
        // If changes were made to the parameters of this Quest, this will account
        // any added reward amounts
        uint256 totalRewardAmount;
        uint256 duration; //number of periods
        uint256 periodStart;
        uint256[] periods;
    }


    uint256 public currentPeriod;

    uint256 public nextID;

    // ID => Quest
    mapping(uint256 => Quest) public quests;
    // QuestID => period => QuestPeriod
    mapping(uint256 => mapping(uint256 => QuestPeriod)) public periodsByQuest;
    // period => array of Quest
    mapping(uint256 => uint256[]) public questsByPeriod; // All the Quests present in this period


    uint256 public platformFee = 500;

    address public questChest;
    address public distributor;

    mapping(address => bool) approvedManagers;


    // Events

    event NewQuest(
        address indexed creator,
        address indexed gauge,
        address rewardToken,
        uint256 duration,
        uint256 startPeriod,
        uint256 rewardPerSlopePoint
    );

    event IncreasedQuestReward(uint256 indexed questID, uint256 indexed updatePeriod, uint256 newRewardPerSlopePoint, uint256 addedRewardAmount);
    event IncreasedQuestObjective(uint256 indexed questID, uint256 indexed updatePeriod, uint256 newObjective, uint256 addedRewardAmount);
    event IncreasedQuestDuration(uint256 indexed questID, uint256 addedDuration, uint256 addedRewardAmount);

    event WithdrawUnusedRewards(uint256 indexed questID, address recipient, uint256 amount);

    event PeriodClosed(uint256 indexed period);

    // Modifiers

    modifier onlyAllowed(){
        require(approvedManagers[msg.sender] || msg.sender == owner(), "QuestBoard: Not allowed");
        _;
    }


    // Constructor
    constructor(address _chest){
        questChest = _chest;

        currentPeriod = (block.timestamp / WEEK) * WEEK;
    }


    // View Functions

    function getQuestIdsForPeriod(uint256 period) external view returns(uint256[] memory) {
        return questsByPeriod[period];
    }

    function getAllQuestPeriodsForQuestId(uint256 questId) external view returns(QuestPeriod[] memory) {
        QuestPeriod[] memory periods = new QuestPeriod[](quests[questId].periods.length);
        for(uint i = 0; i < quests[questId].periods.length; i++){
            periods[i] = periodsByQuest[questId][quests[questId].periods[i]];
        }
        return periods;
    }

    function _getRemainingDuration(uint256 questID) internal view returns(uint256) {
        // Since we have the current period, the start period for the Quest, and each period is 1 WWEK
        // We can find the number of remaining periods in the Quest simply by dividing the ellapsed time between
        // currentPeriod and startPeriod by a WEEK.
        return (currentPeriod - quests[questID].periodStart) / WEEK;
    }


    // Functions

    function updatePeriod() public {
        if (block.timestamp >= currentPeriod + WEEK) {
            currentPeriod = (block.timestamp / WEEK) * WEEK;
        }
    }


    function createQuest(
        address gauge,
        address rewardToken,
        uint256 duration,
        uint256 objective,
        uint256 rewardPerSlopePoint,
        uint256 totalRewardAmount,
        uint256 feeAmount
    ) external nonReentrant returns(uint256) {
        updatePeriod();
        address creator = msg.sender;

        require(gauge != address(0) && rewardToken != address(0), "QuestBoard: Zero Address");
        require(duration > 0, "QuestBoard: Incorrect duration");
        require(objective != 0, "QuestBoard: Null objective");
        require(rewardPerSlopePoint != 0 && totalRewardAmount != 0 && feeAmount != 0, "QuestBoard: Null amount");

        uint256 rewardPerPeriod = (objective * rewardPerSlopePoint) / UNIT;

        require((rewardPerPeriod * duration) == totalRewardAmount, "QuestBoard: totalRewardAmount incorrect");
        require((totalRewardAmount * platformFee)/MAX_BPS == feeAmount, "QuestBoard: feeAmount incorrect");

        // Pull all the rewards in this contract
        IERC20(rewardToken).safeTransferFrom(creator, address(this), totalRewardAmount);
        // And transfer the fees from the Quest creator to the Chest contract
        IERC20(rewardToken).safeTransferFrom(creator, questChest, feeAmount);


        uint256 nextPeriod = ((currentPeriod + WEEK) / WEEK) * WEEK;

        uint256 newQuestID = nextID;
        nextID += 1;

        // Fill the Quest struct data
        quests[newQuestID].creator = creator;
        quests[newQuestID].rewardToken = rewardToken;
        quests[newQuestID].gauge = gauge;
        quests[newQuestID].duration = duration;
        quests[newQuestID].totalRewardAmount = totalRewardAmount;
        quests[newQuestID].periodStart = nextPeriod;
        // The periods array is filled in the following loop

        uint256 periodIterator = nextPeriod;
        for(uint i = 0; i < duration; i++){
            questsByPeriod[periodIterator].push(newQuestID);

            quests[newQuestID].periods.push(periodIterator);

            periodsByQuest[newQuestID][periodIterator].periodStart = periodIterator;
            periodsByQuest[newQuestID][periodIterator].objectiveSlope = objective;
            periodsByQuest[newQuestID][periodIterator].rewardPerSlopePoint = rewardPerSlopePoint;
            periodsByQuest[newQuestID][periodIterator].rewardAmountPerPeriod = rewardPerPeriod;
            // Rest of the struct shoud laready have the correct base data:
            // currentState => PeriodState.ACTIVE
            // rewardAmountDistributed => 0
            // withdrawableAmount => 0

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;
        }

        MultiMerkleDistributor(distributor).addQuest(newQuestID, rewardToken);

        emit NewQuest(creator, gauge, rewardToken, duration, nextPeriod, rewardPerSlopePoint);

        return newQuestID;
    }

    function increaseQuestReward(
        uint256 questID,
        uint256 newRewardPerSlopePoint,
        uint256 addedRewardAmount,
        uint256 feeAmount
    ) external nonReentrant {
        updatePeriod();
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(newRewardPerSlopePoint != 0 && addedRewardAmount != 0 && feeAmount != 0, "QuestBoard: Null amount");

        require(newRewardPerSlopePoint > periodsByQuest[questID][currentPeriod].rewardPerSlopePoint, "QuestBoard: New reward must be higher");

        uint256 newRewardPerPeriod = (periodsByQuest[questID][currentPeriod].objectiveSlope * newRewardPerSlopePoint) / UNIT;
        uint256 diffRewardPerPeriod = newRewardPerPeriod - periodsByQuest[questID][currentPeriod].rewardAmountPerPeriod;

        uint256 remainingDuration = _getRemainingDuration(questID);

        require((diffRewardPerPeriod * remainingDuration) == addedRewardAmount, "QuestBoard: addedRewardAmount incorrect");
        require((addedRewardAmount * platformFee)/MAX_BPS == feeAmount, "QuestBoard: feeAmount incorrect");

        address rewardToken = quests[questID].rewardToken;
        // Pull all the rewards in this contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), addedRewardAmount);
        // And transfer the fees from the Quest creator to the Chest contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, questChest, feeAmount);


        uint256 nextPeriod = ((currentPeriod + WEEK) / WEEK) * WEEK;
        uint256 periodIterator = quests[questID].periodStart;

        quests[questID].totalRewardAmount += addedRewardAmount;

        for(uint i = 0; i < remainingDuration; i++){
            //safety check, don't want to change past or current periods
            if(periodsByQuest[questID][periodIterator].periodStart < nextPeriod) continue;

            periodsByQuest[questID][periodIterator].rewardPerSlopePoint = newRewardPerSlopePoint;
            periodsByQuest[questID][periodIterator].rewardAmountPerPeriod = newRewardPerPeriod;

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;
        }

        emit IncreasedQuestReward(questID, nextPeriod, newRewardPerSlopePoint, addedRewardAmount);
    }


    function increaseQuestDuration(
        uint256 questID,
        uint256 newDuration,
        uint256 addedRewardAmount,
        uint256 feeAmount
    ) external nonReentrant {
        updatePeriod();
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(addedRewardAmount != 0 && feeAmount != 0, "QuestBoard: Null amount");
        require(newDuration > 0, "QuestBoard: Incorrect newDuration");

        //We take data from the last period of the Quest to account for any other changes in the Quest parameters
        uint256 lastPeriod = quests[questID].periods[quests[questID].periods.length];

        uint rewardPerPeriod = periodsByQuest[questID][lastPeriod].rewardAmountPerPeriod;

        require((rewardPerPeriod * newDuration) == addedRewardAmount, "QuestBoard: addedRewardAmount incorrect");
        require((addedRewardAmount * platformFee)/MAX_BPS == feeAmount, "QuestBoard: feeAmount incorrect");

        address rewardToken = quests[questID].rewardToken;
        // Pull all the rewards in this contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), addedRewardAmount);
        // And transfer the fees from the Quest creator to the Chest contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, questChest, feeAmount);

        uint256 periodIterator = ((lastPeriod + WEEK) / WEEK) * WEEK;

        quests[questID].totalRewardAmount += addedRewardAmount;

        uint256 objective = periodsByQuest[questID][lastPeriod].objectiveSlope;
        uint256 rewardPerSlopePoint = periodsByQuest[questID][lastPeriod].rewardPerSlopePoint;

        for(uint i = 0; i < newDuration; i++){
            questsByPeriod[periodIterator].push(questID);

            quests[questID].periods.push(periodIterator);

            periodsByQuest[questID][periodIterator].periodStart = periodIterator;
            periodsByQuest[questID][periodIterator].objectiveSlope = objective;
            periodsByQuest[questID][periodIterator].rewardPerSlopePoint = rewardPerSlopePoint;
            periodsByQuest[questID][periodIterator].rewardAmountPerPeriod = rewardPerPeriod;
            // Rest of the struct shoud laready have the correct base data:
            // currentState => PeriodState.ACTIVE
            // rewardAmountDistributed => 0
            // redeemableAmount => 0

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;
        }

        emit IncreasedQuestDuration(questID, newDuration, addedRewardAmount);

    }


    function increaseQuestObjective(
        uint256 questID,
        uint256 newObjective,
        uint256 addedRewardAmount,
        uint256 feeAmount
    ) external nonReentrant {
        updatePeriod();
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(addedRewardAmount != 0 && feeAmount != 0, "QuestBoard: Null amount");

        require(newObjective > periodsByQuest[questID][currentPeriod].objectiveSlope, "QuestBoard: New objective must be higher");

        uint256 newRewardPerPeriod = (newObjective * periodsByQuest[questID][currentPeriod].rewardPerSlopePoint) / UNIT;
        uint256 diffRewardPerPeriod = newRewardPerPeriod - periodsByQuest[questID][currentPeriod].rewardAmountPerPeriod;

        uint256 remainingDuration = _getRemainingDuration(questID);

        require((diffRewardPerPeriod * remainingDuration) == addedRewardAmount, "QuestBoard: addedRewardAmount incorrect");
        require((addedRewardAmount * platformFee)/MAX_BPS == feeAmount, "QuestBoard: feeAmount incorrect");

        address rewardToken = quests[questID].rewardToken;
        // Pull all the rewards in this contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), addedRewardAmount);
        // And transfer the fees from the Quest creator to the Chest contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, questChest, feeAmount);


        uint256 nextPeriod = ((currentPeriod + WEEK) / WEEK) * WEEK;
        uint256 periodIterator = quests[questID].periodStart;

        quests[questID].totalRewardAmount += addedRewardAmount;

        for(uint i = 0; i < remainingDuration; i++){
            //safety check, don't want to change past or current periods
            if(periodsByQuest[questID][periodIterator].periodStart < nextPeriod) continue;

            periodsByQuest[questID][periodIterator].objectiveSlope = newObjective;
            periodsByQuest[questID][periodIterator].rewardAmountPerPeriod = newRewardPerPeriod;

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;
        }

        emit IncreasedQuestObjective(questID, nextPeriod, newObjective, addedRewardAmount);
    }

    function withdrawUnusedRewards(uint256 questID, address recipient) external nonReentrant {
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(recipient != address(0), "QuestBoard: Zero Address");

        uint256 totalWithdraw = 0;

        uint256[] storage questPeriods = quests[questID].periods;
        for(uint i = 0; i < questPeriods.length; i++){
            if(periodsByQuest[questID][questPeriods[i]].currentState != PeriodState.DISTRIBUTED) continue;

            uint256 withdrawableForPeriod = periodsByQuest[questID][questPeriods[i]].withdrawableAmount;

            if(withdrawableForPeriod > 0){
                totalWithdraw += withdrawableForPeriod;
                periodsByQuest[questID][questPeriods[i]].withdrawableAmount = 0;
            }
        }

        if(totalWithdraw != 0){
            address rewardToken = quests[questID].rewardToken;
            IERC20(rewardToken).safeTransfer(recipient, totalWithdraw);

            emit WithdrawUnusedRewards(questID, recipient, totalWithdraw);
        }
    }



    // Manager functions

    // The one to Close the period and send rewards to Distributor
    function closeQuestPeriod(uint256 period) external onlyAllowed nonReentrant {
        updatePeriod();
        require(distributor != address(0), "QuestBoard: no Distributor set");
        require(period != 0, "QuestBoard: invalid Period");
        require(period < currentPeriod, "QuestBoard: Period still active");
        require(questsByPeriod[period].length != 0, "QuestBoard: empty Period");
        // We use the 1st QuestPeriod of this period to check it was not Closed
        uint256[] memory questsForPeriod = questsByPeriod[period];
        require(
            periodsByQuest[questsForPeriod[0]][period].currentState == PeriodState.ACTIVE,
            "QuestBoard: Period already closed"
        );

        IGaugeController gaugeController = IGaugeController(GAUGE_CONTROLLER);

        uint256 nextPeriod = (period + WEEK / WEEK) * WEEK;

        for(uint i = 0; i < questsForPeriod.length; i++){
            Quest storage _quest = quests[questsForPeriod[0]];
            QuestPeriod storage _questPeriod = periodsByQuest[questsForPeriod[0]][period];
            _questPeriod.currentState = PeriodState.CLOSED;

            gaugeController.checkpoint_gauge(_quest.gauge);

            uint256 periodSlope = gaugeController.points_weight(_quest.gauge, nextPeriod).slope;

            // For here, 100% completion is 1e18 (represented by the UNIT constant).
            // The commpletion percentage is calculated based on the Gauge slope for the next period (all accrued from previous periods),
            // and the Slope objective for this period as listed in the Quest Period.
            // To get how much rewards to distribute, we can multiply by the completion value
            // (that will be between 0 & UNIT), and divided by UNIT.

            uint256 objectiveCompletion = periodSlope >= _questPeriod.objectiveSlope ? UNIT : (_questPeriod.objectiveSlope * UNIT) / periodSlope;

            uint256 toDistributeAmount = (_questPeriod.rewardAmountPerPeriod * objectiveCompletion) / UNIT;

            _questPeriod.rewardAmountDistributed = toDistributeAmount;
            _questPeriod.withdrawableAmount = _questPeriod.rewardAmountPerPeriod - toDistributeAmount;

            IERC20(_quest.rewardToken).safeTransfer(distributor, toDistributeAmount);
        }

        emit PeriodClosed(period);
    }


    function _addMerkleRoot(uint256 questID, uint256 period, bytes32 merkleRoot) internal {
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(merkleRoot != 0, "QuestBoard: Empty MerkleRoot");

        // This also allows to check if the given period is correct => If not, the currentState is never set to CLOSED for the QuestPeriod
        require(periodsByQuest[questID][period].currentState == PeriodState.CLOSED, "QuestBoard: Quest Period not closed");

        MultiMerkleDistributor(distributor).updateQuestPeriod(questID, period, merkleRoot);

        periodsByQuest[questID][period].currentState = PeriodState.DISTRIBUTED;
    }


    function addMerkleRoot(uint256 questID, uint256 period, bytes32 merkleRoot) external onlyAllowed nonReentrant {
        _addMerkleRoot(questID, period, merkleRoot);
    }


    function addMultipleMerkleRoot(uint256[] calldata questIDs, uint256 period, bytes32[] calldata merkleRoots) external onlyAllowed nonReentrant {
        require(questIDs.length == merkleRoots.length, "QuestBoard: Diff list size");
        for(uint i = 0; i < questIDs.length; i++){
            _addMerkleRoot(questIDs[i], period, merkleRoots[i]);
        }
    }

    // Admin functions

    function initiateDistributor(address newDistributor) external onlyOwner {
        require(distributor == address(0), "QuestBoard: Already initialized");
        distributor = newDistributor;
    }

    function approveManager(address newManager) external onlyOwner {
        approvedManagers[newManager] = true;
    }

    function removeManager(address manager) external onlyOwner {
        approvedManagers[manager] = false;
    }

    function updateChest(address chest) external onlyOwner {
        questChest = chest;
    }

    function updateDistributor(address newDistributor) external onlyOwner {
        distributor = newDistributor;
    }

    function updatePlatformFee(uint256 newFee) external onlyOwner {
        require(newFee <= 500, "QuestBoard: Fee too high");
        platformFee = newFee;
    }

    function recoverERC20(address token, uint256 amount) external onlyOwner returns(bool) {
        IERC20(token).safeTransfer(owner(), amount);

        return true;
    }

}