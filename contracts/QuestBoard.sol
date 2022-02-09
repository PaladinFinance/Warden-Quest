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

    address public immutable GAUGE_CONTROLLER;

    uint256 public constant WEEK = 604800;
    uint256 public constant UNIT = 1e18;
    uint256 public constant MAX_BPS = 10000;


    enum PeriodState { ACTIVE, CLOSED, DISTRIBUTED } // State of each Period for each Quest
    // All Periods are ACTIVE by default since they voters from past periods are also accounted for the future period



    struct QuestPeriod {
        uint256 periodStart;
        PeriodState currentState;
        uint256 rewardAmountPerPeriod;
        uint256 rewardPerVote;
        uint256 objectiveVotes;
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

    mapping(address => bool) public whitelistedTokens;

    bool public isKilled;
    uint256 public kill_ts;
    uint256 public constant KILL_DELAY = 2 * 604800; //2 weeks

    // Events

    event NewQuest(
        uint256 questID,
        address indexed creator,
        address indexed gauge,
        address rewardToken,
        uint256 duration,
        uint256 startPeriod,
        uint256 objectiveVotes,
        uint256 rewardPerVote
    );

    event IncreasedQuestReward(uint256 indexed questID, uint256 indexed updatePeriod, uint256 newRewardPerVote, uint256 addedRewardAmount);
    event IncreasedQuestObjective(uint256 indexed questID, uint256 indexed updatePeriod, uint256 newObjective, uint256 addedRewardAmount);
    event IncreasedQuestDuration(uint256 indexed questID, uint256 addedDuration, uint256 addedRewardAmount);

    event WithdrawUnusedRewards(uint256 indexed questID, address recipient, uint256 amount);

    event PeriodClosed(uint256 indexed period);

    event WhitelistToken(address indexed token);

    event Killed();
    event Unkilled();
    event EmergencyWithdraw(uint256 indexed questID, address recipient, uint256 amount);

    // Modifiers

    modifier onlyAllowed(){
        require(approvedManagers[msg.sender] || msg.sender == owner(), "QuestBoard: Not allowed");
        _;
    }

    modifier isAlive(){
        require(!isKilled, "QuestBoard: Killed");
        _;
    }


    // Constructor
    constructor(address _gaugeController, address _chest){
        GAUGE_CONTROLLER = _gaugeController;

        questChest = _chest;

        currentPeriod = (block.timestamp / WEEK) * WEEK;
    }


    // View Functions

    function getQuestIdsForPeriod(uint256 period) external view returns(uint256[] memory) {
        return questsByPeriod[period];
    }

    function getAllPeriodsForQuestId(uint256 questId) external view returns(uint256[] memory) {
        return quests[questId].periods;
    }

    function getAllQuestPeriodsForQuestId(uint256 questId) external view returns(QuestPeriod[] memory) {
        QuestPeriod[] memory periods = new QuestPeriod[](quests[questId].periods.length);
        for(uint i = 0; i < quests[questId].periods.length; i++){
            periods[i] = periodsByQuest[questId][quests[questId].periods[i]];
        }
        return periods;
    }

    function _getRemainingDuration(uint256 questID) internal view returns(uint256) {
        // Since we have the current period, the start period for the Quest, and each period is 1 WEEK
        // We can find the number of remaining periods in the Quest simply by dividing the remaining time between
        // currentPeriod and the last QuestPeriod start by a WEEK.
        // If the current period is the last period of the Quest, we want to return 0
        uint256 lastPeriod = quests[questID].periods[quests[questID].periods.length - 1];
        return (lastPeriod - currentPeriod) / WEEK;
    }


    // Functions

    function updatePeriod() public {
        if (block.timestamp >= currentPeriod + WEEK) {
            currentPeriod = (block.timestamp / WEEK) * WEEK;
        }
    }


    struct CreateVars {
        address creator;
        uint256 rewardPerPeriod;
        uint256 nextPeriod;
    }

    function createQuest(
        address gauge,
        address rewardToken,
        uint256 duration,
        uint256 objective,
        uint256 rewardPerVote,
        uint256 totalRewardAmount,
        uint256 feeAmount
    ) external isAlive nonReentrant returns(uint256) {
        updatePeriod();
        require(distributor != address(0), "QuestBoard: no Distributor set");
        CreateVars memory vars;
        vars.creator = msg.sender;

        require(gauge != address(0) && rewardToken != address(0), "QuestBoard: Zero Address");
        require(IGaugeController(GAUGE_CONTROLLER).gauge_types(gauge) >= 0, "QuestBoard: Invalid Gauge");
        require(whitelistedTokens[rewardToken], "QuestBoard: Token not allowed");
        require(duration > 0, "QuestBoard: Incorrect duration");
        require(objective != 0, "QuestBoard: Null objective");
        require(rewardPerVote != 0 && totalRewardAmount != 0 && feeAmount != 0, "QuestBoard: Null amount");

        vars.rewardPerPeriod = objective * rewardPerVote;

        require((vars.rewardPerPeriod * duration) == totalRewardAmount, "QuestBoard: totalRewardAmount incorrect");
        require((totalRewardAmount * platformFee)/MAX_BPS == feeAmount, "QuestBoard: feeAmount incorrect");

        // Pull all the rewards in this contract
        IERC20(rewardToken).safeTransferFrom(vars.creator, address(this), totalRewardAmount);
        // And transfer the fees from the Quest creator to the Chest contract
        IERC20(rewardToken).safeTransferFrom(vars.creator, questChest, feeAmount);


        vars.nextPeriod = ((currentPeriod + WEEK) / WEEK) * WEEK;

        uint256 newQuestID = nextID;
        nextID += 1;

        // Fill the Quest struct data
        quests[newQuestID].creator = vars.creator;
        quests[newQuestID].rewardToken = rewardToken;
        quests[newQuestID].gauge = gauge;
        quests[newQuestID].duration = duration;
        quests[newQuestID].totalRewardAmount = totalRewardAmount;
        quests[newQuestID].periodStart = vars.nextPeriod;
        // The periods array is filled in the following loop

        uint256 periodIterator = vars.nextPeriod;
        for(uint i = 0; i < duration; i++){
            questsByPeriod[periodIterator].push(newQuestID);

            quests[newQuestID].periods.push(periodIterator);

            periodsByQuest[newQuestID][periodIterator].periodStart = periodIterator;
            periodsByQuest[newQuestID][periodIterator].objectiveVotes = objective;
            periodsByQuest[newQuestID][periodIterator].rewardPerVote = rewardPerVote;
            periodsByQuest[newQuestID][periodIterator].rewardAmountPerPeriod = vars.rewardPerPeriod;
            // Rest of the struct shoud laready have the correct base data:
            // currentState => PeriodState.ACTIVE
            // rewardAmountDistributed => 0
            // withdrawableAmount => 0

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;
        }

        MultiMerkleDistributor(distributor).addQuest(newQuestID, rewardToken);

        emit NewQuest(
            newQuestID,
            vars.creator,
            gauge,
            rewardToken,
            duration,
            vars.nextPeriod,
            objective,
            rewardPerVote
        );

        return newQuestID;
    }


    function increaseQuestDuration(
        uint256 questID,
        uint256 newDuration,
        uint256 addedRewardAmount,
        uint256 feeAmount
    ) external isAlive nonReentrant {
        updatePeriod();
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(addedRewardAmount != 0 && feeAmount != 0, "QuestBoard: Null amount");
        require(newDuration > 0, "QuestBoard: Incorrect newDuration");

        //We take data from the last period of the Quest to account for any other changes in the Quest parameters
        uint256 lastPeriod = quests[questID].periods[quests[questID].periods.length - 1];

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

        uint256 objective = periodsByQuest[questID][lastPeriod].objectiveVotes;
        uint256 rewardPerVote = periodsByQuest[questID][lastPeriod].rewardPerVote;

        for(uint i = 0; i < newDuration; i++){
            questsByPeriod[periodIterator].push(questID);

            quests[questID].periods.push(periodIterator);

            periodsByQuest[questID][periodIterator].periodStart = periodIterator;
            periodsByQuest[questID][periodIterator].objectiveVotes = objective;
            periodsByQuest[questID][periodIterator].rewardPerVote = rewardPerVote;
            periodsByQuest[questID][periodIterator].rewardAmountPerPeriod = rewardPerPeriod;
            // Rest of the struct shoud laready have the correct base data:
            // currentState => PeriodState.ACTIVE
            // rewardAmountDistributed => 0
            // redeemableAmount => 0

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;
        }

        emit IncreasedQuestDuration(questID, newDuration, addedRewardAmount);

    }

    function increaseQuestReward(
        uint256 questID,
        uint256 newRewardPerVote,
        uint256 addedRewardAmount,
        uint256 feeAmount
    ) external isAlive nonReentrant {
        updatePeriod();
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(newRewardPerVote != 0 && addedRewardAmount != 0 && feeAmount != 0, "QuestBoard: Null amount");

        require(newRewardPerVote > periodsByQuest[questID][currentPeriod].rewardPerVote, "QuestBoard: New reward must be higher");

        uint256 newRewardPerPeriod = periodsByQuest[questID][currentPeriod].objectiveVotes * newRewardPerVote;
        uint256 diffRewardPerPeriod = newRewardPerPeriod - periodsByQuest[questID][currentPeriod].rewardAmountPerPeriod;

        uint256 remainingDuration = _getRemainingDuration(questID);
        require(remainingDuration > 0, "QuestBoard: no more incoming QuestPeriods");

        require((diffRewardPerPeriod * remainingDuration) == addedRewardAmount, "QuestBoard: addedRewardAmount incorrect");
        require((addedRewardAmount * platformFee)/MAX_BPS == feeAmount, "QuestBoard: feeAmount incorrect");

        address rewardToken = quests[questID].rewardToken;
        // Pull all the rewards in this contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), addedRewardAmount);
        // And transfer the fees from the Quest creator to the Chest contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, questChest, feeAmount);


        uint256 nextPeriod = ((currentPeriod + WEEK) / WEEK) * WEEK;
        uint256 periodIterator = nextPeriod;

        uint256 lastPeriod = quests[questID].periods[quests[questID].periods.length - 1];

        quests[questID].totalRewardAmount += addedRewardAmount;

        for(uint i = 0; i < remainingDuration; i++){

            if(periodIterator > lastPeriod) break; //Safety check, we never want to write on non-initialized QuestPeriods (that were not initialized)

            periodsByQuest[questID][periodIterator].rewardPerVote = newRewardPerVote;
            periodsByQuest[questID][periodIterator].rewardAmountPerPeriod = newRewardPerPeriod;

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;
        }

        emit IncreasedQuestReward(questID, nextPeriod, newRewardPerVote, addedRewardAmount);
    }


    function increaseQuestObjective(
        uint256 questID,
        uint256 newObjective,
        uint256 addedRewardAmount,
        uint256 feeAmount
    ) external isAlive nonReentrant {
        updatePeriod();
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(addedRewardAmount != 0 && feeAmount != 0, "QuestBoard: Null amount");

        require(newObjective > periodsByQuest[questID][currentPeriod].objectiveVotes, "QuestBoard: New objective must be higher");

        uint256 newRewardPerPeriod = newObjective * periodsByQuest[questID][currentPeriod].rewardPerVote;
        uint256 diffRewardPerPeriod = newRewardPerPeriod - periodsByQuest[questID][currentPeriod].rewardAmountPerPeriod;

        uint256 remainingDuration = _getRemainingDuration(questID);
        require(remainingDuration > 0, "QuestBoard: no more incoming QuestPeriods");

        require((diffRewardPerPeriod * remainingDuration) == addedRewardAmount, "QuestBoard: addedRewardAmount incorrect");
        require((addedRewardAmount * platformFee)/MAX_BPS == feeAmount, "QuestBoard: feeAmount incorrect");

        address rewardToken = quests[questID].rewardToken;
        // Pull all the rewards in this contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), addedRewardAmount);
        // And transfer the fees from the Quest creator to the Chest contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, questChest, feeAmount);


        uint256 nextPeriod = ((currentPeriod + WEEK) / WEEK) * WEEK;
        uint256 periodIterator = nextPeriod;

        uint256 lastPeriod = quests[questID].periods[quests[questID].periods.length - 1];

        quests[questID].totalRewardAmount += addedRewardAmount;

        for(uint i = 0; i < remainingDuration; i++){

            if(periodIterator > lastPeriod) break; //Safety check, we never want to write on non-existing QuestPeriods (that were not initialized)

            periodsByQuest[questID][periodIterator].objectiveVotes = newObjective;
            periodsByQuest[questID][periodIterator].rewardAmountPerPeriod = newRewardPerPeriod;

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;
        }

        emit IncreasedQuestObjective(questID, nextPeriod, newObjective, addedRewardAmount);
    }

    function withdrawUnusedRewards(uint256 questID, address recipient) external isAlive nonReentrant {
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(recipient != address(0), "QuestBoard: Zero Address");

        uint256 totalWithdraw = 0;

        uint256[] storage questPeriods = quests[questID].periods;
        for(uint i = 0; i < questPeriods.length; i++){
            // Wa allow to withdraw unused rewards after the period was closed, or after it was distributed
            if(periodsByQuest[questID][questPeriods[i]].currentState == PeriodState.ACTIVE) continue;

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

    function emergencyWithdraw(uint256 questID, address recipient) external nonReentrant {
        require(isKilled, "QuestBoard: Not killed");
        require(block.timestamp >= kill_ts + KILL_DELAY, "QuestBoard: Wait kill delay");

        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(recipient != address(0), "QuestBoard: Zero Address");

        uint256 totalWithdraw = 0;

        uint256[] storage questPeriods = quests[questID].periods;
        for(uint i = 0; i < questPeriods.length; i++){
            if(periodsByQuest[questID][questPeriods[i]].currentState != PeriodState.ACTIVE){
                uint256 withdrawableForPeriod = periodsByQuest[questID][questPeriods[i]].withdrawableAmount;

                if(withdrawableForPeriod > 0){
                    totalWithdraw += withdrawableForPeriod;
                    periodsByQuest[questID][questPeriods[i]].withdrawableAmount = 0;
                }
            } else {
                totalWithdraw += periodsByQuest[questID][questPeriods[i]].rewardAmountPerPeriod;
                periodsByQuest[questID][questPeriods[i]].rewardAmountPerPeriod = 0;
            }
        }

        if(totalWithdraw != 0){
            address rewardToken = quests[questID].rewardToken;
            IERC20(rewardToken).safeTransfer(recipient, totalWithdraw);

            emit EmergencyWithdraw(questID, recipient, totalWithdraw);
        }

    }



    // Manager functions

    // The one to Close the period and send rewards to Distributor
    function closeQuestPeriod(uint256 period) external isAlive onlyAllowed nonReentrant {
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

        uint256 nextPeriod = ((period + WEEK) / WEEK) * WEEK;

        for(uint i = 0; i < questsForPeriod.length; i++){
            Quest storage _quest = quests[questsForPeriod[i]];
            QuestPeriod storage _questPeriod = periodsByQuest[questsForPeriod[i]][period];
            _questPeriod.currentState = PeriodState.CLOSED;

            gaugeController.checkpoint_gauge(_quest.gauge);

            uint256 periodBias = gaugeController.points_weight(_quest.gauge, nextPeriod).bias;

            if(periodBias == 0) { //Because we don't want to divide by 0
                // Here since the slope is 0, we consider 0% completion
                // => no rewards to be distributed
                _questPeriod.rewardAmountDistributed = 0;
                _questPeriod.withdrawableAmount = _questPeriod.rewardAmountPerPeriod;
            }
            else{
                // For here, 100% completion is 1e18 (represented by the UNIT constant).
                // The completion percentage is calculated based on the Gauge bias for 
                // the next period (all accrued from previous periods),
                // and the Bias objective for this period as listed in the Quest Period.
                // To get how much rewards to distribute, we can multiply by the completion value
                // (that will be between 0 & UNIT), and divided by UNIT.

                uint256 objectiveCompletion = periodBias >= _questPeriod.objectiveVotes ? UNIT : (periodBias * UNIT) / _questPeriod.objectiveVotes;

                uint256 toDistributeAmount = (_questPeriod.rewardAmountPerPeriod * objectiveCompletion) / UNIT;

                _questPeriod.rewardAmountDistributed = toDistributeAmount;
                _questPeriod.withdrawableAmount = _questPeriod.rewardAmountPerPeriod - toDistributeAmount;

                IERC20(_quest.rewardToken).safeTransfer(distributor, toDistributeAmount);
            } 
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


    function addMerkleRoot(uint256 questID, uint256 period, bytes32 merkleRoot) external isAlive onlyAllowed nonReentrant {
        _addMerkleRoot(questID, period, merkleRoot);
    }


    function addMultipleMerkleRoot(uint256[] calldata questIDs, uint256 period, bytes32[] calldata merkleRoots) external isAlive onlyAllowed nonReentrant {
        require(questIDs.length == merkleRoots.length, "QuestBoard: Diff list size");
        for(uint i = 0; i < questIDs.length; i++){
            _addMerkleRoot(questIDs[i], period, merkleRoots[i]);
        }
    }

    function whitelistToken(address newToken) public onlyAllowed {
        require(newToken != address(0), "QuestBoard: Zero Address");
        whitelistedTokens[newToken] = true;

        emit WhitelistToken(newToken);
    }

    function whitelistMultipleTokens(address[] memory newTokens) external onlyAllowed {
        require(newTokens.length != 0, "QuestBoard: empty list");
        for(uint i = 0; i < newTokens.length; i++){
            whitelistToken(newTokens[i]);
        }
    }

    // Admin functions

    function initiateDistributor(address newDistributor) external onlyOwner {
        require(distributor == address(0), "QuestBoard: Already initialized");
        distributor = newDistributor;
    }

    function approveManager(address newManager) external onlyOwner {
        require(newManager != address(0), "QuestBoard: Zero Address");
        approvedManagers[newManager] = true;
    }

    function removeManager(address manager) external onlyOwner {
        require(manager != address(0), "QuestBoard: Zero Address");
        approvedManagers[manager] = false;
    }

    function updateChest(address chest) external onlyOwner {
        require(chest != address(0), "QuestBoard: Zero Address");
        questChest = chest;
    }

    function updateDistributor(address newDistributor) external onlyOwner {
        require(newDistributor != address(0), "QuestBoard: Zero Address");
        distributor = newDistributor;
    }

    function updatePlatformFee(uint256 newFee) external onlyOwner {
        require(newFee <= 500, "QuestBoard: Fee too high");
        platformFee = newFee;
    }

    function recoverERC20(address token, uint256 amount) external onlyOwner returns(bool) {
        require(!whitelistedTokens[token], "QuestBoard: Cannot recover whitelisted token");
        IERC20(token).safeTransfer(owner(), amount);

        return true;
    }

    function killBoard() external onlyOwner {
        require(!isKilled, "QuestBoard: Already killed");
        isKilled = true;
        kill_ts = block.timestamp;

        emit Killed();
    }

    function unkillBoard() external onlyOwner {
        require(isKilled, "QuestBoard: Not killed");
        require(block.timestamp < kill_ts + KILL_DELAY, "QuestBoard: Too late");
        isKilled = false;

        emit Unkilled();
    }

}