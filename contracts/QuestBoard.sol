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

    /** @notice Address of the Curve Gauge Controller */
    address public immutable GAUGE_CONTROLLER;

    /** @notice Seconds in a Week */
    uint256 public constant WEEK = 604800;
    /** @notice 1e18 scale */
    uint256 public constant UNIT = 1e18;
    /** @notice Max BPS value (100%) */
    uint256 public constant MAX_BPS = 10000;


    /** @notice State of each Period for each Quest */
    enum PeriodState { ACTIVE, CLOSED, DISTRIBUTED }
    // All Periods are ACTIVE by default since they voters from past periods are also accounted for the future period


    /** @notice Struct for a Period of a Quest */
    struct QuestPeriod {
        // Total reward amount that can be distributed for that period
        uint256 rewardAmountPerPeriod;
        // Amount of reward for each vote (for 1 veCRV)
        uint256 rewardPerVote;
        // Tartget Bias for the Gauge
        uint256 objectiveVotes;
        // Amount of reward to distribute, at period closing
        uint256 rewardAmountDistributed;
        // Amount not distributed, for Quest creator to redeem
        uint256 withdrawableAmount;
        // Timestamp of the Period start
        uint48 periodStart;
        // Current state of the Period
        PeriodState currentState;
    }

    /** @notice Struct holding the parameters of the Quest common for all periods */
    struct Quest {
        // Address of the Quest creator (caller of createQuest() method)
        address creator;
        // Address of the ERC20 used for rewards
        address rewardToken;
        // Address of the target Gauge
        address gauge;
        // Total number of periods for the Quest
        uint48 duration;
        // Timestamp where the 1st QuestPeriod starts
        uint48 periodStart;
        // Total amount of rewards paid for this Quest
        // If changes were made to the parameters of this Quest, this will account
        // any added reward amounts
        uint256 totalRewardAmount;
    }

    /** @notice Current active period timestamp */
    uint256 public currentPeriod;
    /** @notice ID for the next Quest to be created */
    uint256 public nextID;

    /** @notice List of Quest (indexed by ID) */
    // ID => Quest
    mapping(uint256 => Quest) public quests;
    /** @notice List of timestamp periods the Quest is active in */
    // QuestID => Periods (timestamps)
    mapping(uint256 => uint48[]) public questPeriods;
    /** @notice Mapping of all QuestPeriod struct for each period of each Quest */
    // QuestID => period => QuestPeriod
    mapping(uint256 => mapping(uint256 => QuestPeriod)) public periodsByQuest;
    /** @notice All the Quests present in this period */
    // period => array of Quest
    mapping(uint256 => uint256[]) public questsByPeriod;


    /** @notice Platform fees ratio (in BPS) */
    uint256 public platformFee = 500;

    /** @notice Minimum Objective required */
    uint256 public minObjective;

    /** @notice Address of the Chest to receive platform fees */
    address public questChest;
    /** @notice Address of the reward Distributor contract */
    address public distributor;

    /** @notice Mapping of addresses allowed to call manager methods */
    mapping(address => bool) approvedManagers;
    /** @notice Whitelisted tokens that can be used as reward tokens */
    mapping(address => bool) public whitelistedTokens;
    /** @notice Min rewardPerVote per token (to avoid spam creation of useless Quest) */
    mapping(address => uint256) public minRewardPerVotePerToken;

    /** @notice Boolean, true if the cotnract was killed, stopping main user functions */
    bool public isKilled;
    /** @notice Timestam pwhen the contract was killed */
    uint256 public kill_ts;
    /** @notice Delay where contract can be unkilled */
    uint256 public constant KILL_DELAY = 2 * 604800; //2 weeks

    // Events

    /** @notice Event emitted when a new Quest is created */
    event NewQuest(
        uint256 questID,
        address indexed creator,
        address indexed gauge,
        address rewardToken,
        uint48 duration,
        uint256 startPeriod,
        uint256 objectiveVotes,
        uint256 rewardPerVote
    );

    /** @notice Event emitted when rewards of a Quest are increased */
    event IncreasedQuestReward(uint256 indexed questID, uint256 indexed updatePeriod, uint256 newRewardPerVote, uint256 addedRewardAmount);
    /** @notice Event emitted when the Quest objective bias is increased */
    event IncreasedQuestObjective(uint256 indexed questID, uint256 indexed updatePeriod, uint256 newObjective, uint256 addedRewardAmount);
    /** @notice Event emitted when the Quest duration is extended */
    event IncreasedQuestDuration(uint256 indexed questID, uint256 addedDuration, uint256 addedRewardAmount);

    /** @notice Event emitted when Quest creator withdraw undistributed rewards */
    event WithdrawUnusedRewards(uint256 indexed questID, address recipient, uint256 amount);

    /** @notice Event emitted when a Period is Closed */
    event PeriodClosed(uint256 indexed period);
    /** @notice Event emitted when a part of the Period is Closed */
    event PeriodClosedPart(uint256 indexed period);

    /** @notice Event emitted when a new reward token is whitelisted */
    event WhitelistToken(address indexed token, uint256 minRewardPerVote);
    event UpdateRewardToken(address indexed token, uint256 newMinRewardPerVote);

    /** @notice Event emitted when the contract is killed */
    event Killed(uint256 killTime);
    /** @notice Event emitted when the contract is unkilled */
    event Unkilled(uint256 unkillTime);
    /** @notice Event emitted when the Quest creator withdraw all unused funds (if the contract was killed) */
    event EmergencyWithdraw(uint256 indexed questID, address recipient, uint256 amount);

    // Modifiers

    /** @notice Check the caller is either the admin or an approved manager */
    modifier onlyAllowed(){
        require(approvedManagers[msg.sender] || msg.sender == owner(), "QuestBoard: Not allowed");
        _;
    }

    /** @notice Check that contract was not killed */
    modifier isAlive(){
        require(!isKilled, "QuestBoard: Killed");
        _;
    }


    // Constructor
    constructor(address _gaugeController, address _chest){
        GAUGE_CONTROLLER = _gaugeController;

        questChest = _chest;

        currentPeriod = (block.timestamp / WEEK) * WEEK;

        minObjective = 1000 * UNIT;
    }


    // View Functions
   
    /**
    * @notice Returns the list of all Quest IDs active on a given period
    * @dev Returns the list of all Quest IDs active on a given period
    * @param period Timestamp of the period
    * @return uint256[] : Quest IDs for the period
    */
    function getQuestIdsForPeriod(uint256 period) external view returns(uint256[] memory) {
        return questsByPeriod[period];
    }
   
    /**
    * @notice Returns all periods for a Quest
    * @dev Returns all period timestamps for a Quest ID
    * @param questId ID of the Quest
    * @return uint256[] : List of period timestamps
    */
    function getAllPeriodsForQuestId(uint256 questId) external view returns(uint48[] memory) {
        return questPeriods[questId];
    }
   
    /**
    * @notice Returns all QuestPeriod of a given Quest
    * @dev Returns all QuestPeriod of a given Quest ID
    * @param questId ID of the Quest
    * @return QuestPeriod[] : list of QuestPeriods
    */
    function getAllQuestPeriodsForQuestId(uint256 questId) external view returns(QuestPeriod[] memory) {
        uint256 nbPeriods = questPeriods[questId].length;
        QuestPeriod[] memory periods = new QuestPeriod[](nbPeriods);
        for(uint256 i = 0; i < nbPeriods; i++){
            periods[i] = periodsByQuest[questId][questPeriods[questId][i]];
        }
        return periods;
    }
   
    /**
    * @dev Returns the number of periods to come for a give nQuest
    * @param questID ID of the Quest
    * @return uint : remaining duration (non active periods)
    */
    function _getRemainingDuration(uint256 questID) internal view returns(uint256) {
        // Since we have the current period, the start period for the Quest, and each period is 1 WEEK
        // We can find the number of remaining periods in the Quest simply by dividing the remaining time between
        // currentPeriod and the last QuestPeriod start by a WEEK.
        // If the current period is the last period of the Quest, we want to return 0
        uint256 lastPeriod = questPeriods[questID][questPeriods[questID].length - 1];
        return (lastPeriod - currentPeriod) / WEEK;
    }


    // Functions
   
    /**
    * @notice Updates the current Period for the contract
    * @dev Updates the current Period for the contract
    */
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
   
    /**
    * @notice Creates a new Quest
    * @dev Creates a new Quest struct, and QuestPeriods for the Quest duration
    * @param gauge Address of the Gauge targeted by the Quest
    * @param rewardToken Address of the reward token
    * @param duration Duration (in number of periods) of the Quest
    * @param objective Target bias to reach (equivalent to amount of veCRV in wei to reach)
    * @param rewardPerVote Amount of reward per veCRV (in wei)
    * @param totalRewardAmount Total amount of rewards for the whole Quest (in wei)
    * @param feeAmount Platform fees amount (in wei)
    * @return uint256 : ID of the newly created Quest
    */
    function createQuest(
        address gauge,
        address rewardToken,
        uint48 duration,
        uint256 objective,
        uint256 rewardPerVote,
        uint256 totalRewardAmount,
        uint256 feeAmount
    ) external isAlive nonReentrant returns(uint256) {
        updatePeriod();
        require(distributor != address(0), "QuestBoard: no Distributor set");
        // Local memory variables
        CreateVars memory vars;
        vars.creator = msg.sender;

        // Check all parameters
        require(gauge != address(0) && rewardToken != address(0), "QuestBoard: Zero Address");
        require(IGaugeController(GAUGE_CONTROLLER).gauge_types(gauge) >= 0, "QuestBoard: Invalid Gauge");
        require(whitelistedTokens[rewardToken], "QuestBoard: Token not allowed");
        require(duration > 0, "QuestBoard: Incorrect duration");
        require(objective >= minObjective, "QuestBoard: Objective too low");
        require(rewardPerVote != 0 && totalRewardAmount != 0 && feeAmount != 0, "QuestBoard: Null amount");
        require(rewardPerVote >= minRewardPerVotePerToken[rewardToken], "QuestBoard: RewardPerVote too low");

        // Verifiy the given amounts of reward token are correct
        vars.rewardPerPeriod = (objective * rewardPerVote) / UNIT;

        require((vars.rewardPerPeriod * duration) == totalRewardAmount, "QuestBoard: totalRewardAmount incorrect");
        require((totalRewardAmount * platformFee)/MAX_BPS == feeAmount, "QuestBoard: feeAmount incorrect");

        // Pull all the rewards in this contract
        IERC20(rewardToken).safeTransferFrom(vars.creator, address(this), totalRewardAmount);
        // And transfer the fees from the Quest creator to the Chest contract
        IERC20(rewardToken).safeTransferFrom(vars.creator, questChest, feeAmount);

        // Quest will start on next period
        vars.nextPeriod = ((currentPeriod + WEEK) / WEEK) * WEEK;

        // Get the ID for that new Quest and increment the nextID counter
        uint256 newQuestID = nextID;
        nextID += 1;

        // Fill the Quest struct data
        quests[newQuestID].creator = vars.creator;
        quests[newQuestID].rewardToken = rewardToken;
        quests[newQuestID].gauge = gauge;
        quests[newQuestID].duration = duration;
        quests[newQuestID].totalRewardAmount = totalRewardAmount;
        quests[newQuestID].periodStart = safe48(vars.nextPeriod);

        uint48[] memory _periods = new uint48[](duration);

        // Iterate on periods based on Quest duration
        uint256 periodIterator = vars.nextPeriod;
        for(uint256 i = 0; i < duration;){
            // Add the Quest on the list of Quests active on the period
            questsByPeriod[periodIterator].push(newQuestID);

            // And add the period in the list of periods of the Quest
            _periods[i] = safe48(periodIterator);

            periodsByQuest[newQuestID][periodIterator].periodStart = safe48(periodIterator);
            periodsByQuest[newQuestID][periodIterator].objectiveVotes = objective;
            periodsByQuest[newQuestID][periodIterator].rewardPerVote = rewardPerVote;
            periodsByQuest[newQuestID][periodIterator].rewardAmountPerPeriod = vars.rewardPerPeriod;
            // Rest of the struct shoud laready have the correct base data:
            // currentState => PeriodState.ACTIVE
            // rewardAmountDistributed => 0
            // withdrawableAmount => 0

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;

            unchecked{ ++i; }
        }

        // Write the array of period timestamp of that Quest in storage
        questPeriods[newQuestID] = _periods;

        // Add that Quest & the reward token in the Distributor
        require(MultiMerkleDistributor(distributor).addQuest(newQuestID, rewardToken), "QuestBoard: Fail add to Distributor");

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

   
    /**
    * @notice Increases the duration of a Quest
    * @dev Adds more QuestPeriods and extends the duration of a Quest
    * @param questID ID of the Quest
    * @param addedDuration Number of period to add
    * @param addedRewardAmount Amount of reward to add for the new periods (in wei)
    * @param feeAmount Platform fees amount (in wei)
    */
    function increaseQuestDuration(
        uint256 questID,
        uint48 addedDuration,
        uint256 addedRewardAmount,
        uint256 feeAmount
    ) external isAlive nonReentrant {
        updatePeriod();
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(addedRewardAmount != 0 && feeAmount != 0, "QuestBoard: Null amount");
        require(addedDuration > 0, "QuestBoard: Incorrect addedDuration");

        //We take data from the last period of the Quest to account for any other changes in the Quest parameters
        uint256 lastPeriod = questPeriods[questID][questPeriods[questID].length - 1];

        // Check that the given amounts are correct
        uint rewardPerPeriod = periodsByQuest[questID][lastPeriod].rewardAmountPerPeriod;

        require((rewardPerPeriod * addedDuration) == addedRewardAmount, "QuestBoard: addedRewardAmount incorrect");
        require((addedRewardAmount * platformFee)/MAX_BPS == feeAmount, "QuestBoard: feeAmount incorrect");

        address rewardToken = quests[questID].rewardToken;
        // Pull all the rewards in this contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), addedRewardAmount);
        // And transfer the fees from the Quest creator to the Chest contract
        IERC20(rewardToken).safeTransferFrom(msg.sender, questChest, feeAmount);

        uint256 periodIterator = ((lastPeriod + WEEK) / WEEK) * WEEK;

        // Update the Quest struct with added reward admounts & added duration
        quests[questID].totalRewardAmount += addedRewardAmount;
        quests[questID].duration += addedDuration;

        uint256 objective = periodsByQuest[questID][lastPeriod].objectiveVotes;
        uint256 rewardPerVote = periodsByQuest[questID][lastPeriod].rewardPerVote;

        // Add QuestPeriods for the new added duration
        for(uint256 i = 0; i < addedDuration;){
            questsByPeriod[periodIterator].push(questID);

            questPeriods[questID].push(safe48(periodIterator));

            periodsByQuest[questID][periodIterator].periodStart = safe48(periodIterator);
            periodsByQuest[questID][periodIterator].objectiveVotes = objective;
            periodsByQuest[questID][periodIterator].rewardPerVote = rewardPerVote;
            periodsByQuest[questID][periodIterator].rewardAmountPerPeriod = rewardPerPeriod;
            // Rest of the struct shoud laready have the correct base data:
            // currentState => PeriodState.ACTIVE
            // rewardAmountDistributed => 0
            // redeemableAmount => 0

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;

            unchecked{ ++i; }
        }

        emit IncreasedQuestDuration(questID, addedDuration, addedRewardAmount);

    }
   
    /**
    * @notice Increases the reward per votes for a Quest
    * @dev Increases the reward per votes for a Quest
    * @param questID ID of the Quest
    * @param newRewardPerVote New amount of reward per veCRV (in wei)
    * @param addedRewardAmount Amount of rewards to add (in wei)
    * @param feeAmount Platform fees amount (in wei)
    */
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

        // The new reward amount must be higher 
        require(newRewardPerVote > periodsByQuest[questID][currentPeriod].rewardPerVote, "QuestBoard: New reward must be higher");

        // For all non active QuestPeriods (non Closed, nor the current Active one)
        // Calculates the amount of reward token needed with the new rewardPerVote value
        // by calculating the new amount of reward per period, and the difference with the current amount of reward per period
        // to have the exact amount to add for each non-active period, and the exact total amount to add to the Quest
        // (because we don't want to pay for Periods that are Closed or the current period)
        uint256 newRewardPerPeriod = (periodsByQuest[questID][currentPeriod].objectiveVotes * newRewardPerVote) / UNIT;
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

        uint256 lastPeriod = questPeriods[questID][questPeriods[questID].length - 1];

        // Update the Quest struct with the added reward amount
        quests[questID].totalRewardAmount += addedRewardAmount;

        // Update all QuestPeriods, starting with the nextPeriod one
        for(uint256 i = 0; i < remainingDuration;){

            if(periodIterator > lastPeriod) break; //Safety check, we never want to write on non-initialized QuestPeriods (that were not initialized)

            // And update each QuestPeriod with the new values
            periodsByQuest[questID][periodIterator].rewardPerVote = newRewardPerVote;
            periodsByQuest[questID][periodIterator].rewardAmountPerPeriod = newRewardPerPeriod;

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;

            unchecked{ ++i; }
        }

        emit IncreasedQuestReward(questID, nextPeriod, newRewardPerVote, addedRewardAmount);
    }
   
    /**
    * @notice Increases the target bias/veCRV amount to reach on the Gauge
    * @dev CIncreases the target bias/veCRV amount to reach on the Gauge
    * @param questID ID of the Quest
    * @param newObjective New target bias to reach (equivalent to amount of veCRV in wei to reach)
    * @param addedRewardAmount Amount of rewards to add (in wei)
    * @param feeAmount Platform fees amount (in wei)
    */
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

        // No need to compare to minObjective : the new value must be higher than current Objective
        // and current objective needs to be >= minObjective
        require(newObjective > periodsByQuest[questID][currentPeriod].objectiveVotes, "QuestBoard: New objective must be higher");

        // For all non active QuestPeriods (non Closed, nor the current Active one)
        // Calculates the amount of reward token needed with the new objective bias
        // by calculating the new amount of reward per period, and the difference with the current amount of reward per period
        // to have the exact amount to add for each non-active period, and the exact total amount to add to the Quest
        // (because we don't want to pay for Periods that are Closed or the current period)
        uint256 newRewardPerPeriod = (newObjective * periodsByQuest[questID][currentPeriod].rewardPerVote) / UNIT;
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

        uint256 lastPeriod = questPeriods[questID][questPeriods[questID].length - 1];

        // Update the Quest struct with the added reward amount
        quests[questID].totalRewardAmount += addedRewardAmount;

        // Update all QuestPeriods, starting with the nextPeriod one
        for(uint256 i = 0; i < remainingDuration;){

            if(periodIterator > lastPeriod) break; //Safety check, we never want to write on non-existing QuestPeriods (that were not initialized)

            // And update each QuestPeriod with the new values
            periodsByQuest[questID][periodIterator].objectiveVotes = newObjective;
            periodsByQuest[questID][periodIterator].rewardAmountPerPeriod = newRewardPerPeriod;

            periodIterator = ((periodIterator + WEEK) / WEEK) * WEEK;

            unchecked{ ++i; }
        }

        emit IncreasedQuestObjective(questID, nextPeriod, newObjective, addedRewardAmount);
    }
   
    /**
    * @notice Withdraw all undistributed rewards from Closed Quest Periods
    * @dev Withdraw all undistributed rewards from Closed Quest Periods
    * @param questID ID of the Quest
    * @param recipient Address to send the reward tokens to
    */
    function withdrawUnusedRewards(uint256 questID, address recipient) external isAlive nonReentrant {
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(recipient != address(0), "QuestBoard: Zero Address");

        // Total amount available to withdraw
        uint256 totalWithdraw = 0;

        uint48[] memory _questPeriods = questPeriods[questID];
        uint256 length = _questPeriods.length;
        for(uint256 i = 0; i < length;){
            // We allow to withdraw unused rewards after the period was closed, or after it was distributed
            if(periodsByQuest[questID][_questPeriods[i]].currentState == PeriodState.ACTIVE) {
                unchecked{ ++i; }
                continue;
            }

            uint256 withdrawableForPeriod = periodsByQuest[questID][_questPeriods[i]].withdrawableAmount;

            // If there is token to withdraw for that period, add they to the total to withdraw,
            // and set the withdrawable amount to 0
            if(withdrawableForPeriod > 0){
                totalWithdraw += withdrawableForPeriod;
                periodsByQuest[questID][_questPeriods[i]].withdrawableAmount = 0;
            }

            unchecked{ ++i; }
        }

        // If there is a non null amount of token to withdraw, execute a transfer
        if(totalWithdraw != 0){
            address rewardToken = quests[questID].rewardToken;
            IERC20(rewardToken).safeTransfer(recipient, totalWithdraw);

            emit WithdrawUnusedRewards(questID, recipient, totalWithdraw);
        }
    }
   
    /**
    * @notice Emergency withdraws all undistributed rewards from Closed Quest Periods & all rewards for Active Periods
    * @dev Emergency withdraws all undistributed rewards from Closed Quest Periods & all rewards for Active Periods
    * @param questID ID of the Quest
    * @param recipient Address to send the reward tokens to
    */
    function emergencyWithdraw(uint256 questID, address recipient) external nonReentrant {
        require(isKilled, "QuestBoard: Not killed");
        require(block.timestamp >= kill_ts + KILL_DELAY, "QuestBoard: Wait kill delay");

        require(questID < nextID, "QuestBoard: Non valid ID");
        require(msg.sender == quests[questID].creator, "QuestBoard: Not allowed");
        require(recipient != address(0), "QuestBoard: Zero Address");

        // Total amount to emergency withdraw
        uint256 totalWithdraw = 0;

        uint48[] memory _questPeriods = questPeriods[questID];
        uint256 length = _questPeriods.length;
        for(uint256 i = 0; i < length;){
            // For CLOSED or DISTRIBUTED periods
            if(periodsByQuest[questID][_questPeriods[i]].currentState != PeriodState.ACTIVE){
                uint256 withdrawableForPeriod = periodsByQuest[questID][_questPeriods[i]].withdrawableAmount;

                // If there is a non_null withdrawable amount for the period,
                // add it to the total to withdraw, et set the withdrawable amount ot 0
                if(withdrawableForPeriod > 0){
                    totalWithdraw += withdrawableForPeriod;
                    periodsByQuest[questID][_questPeriods[i]].withdrawableAmount = 0;
                }
            } else {
                // And for the active period, and the next ones, withdraw the total reward amount
                totalWithdraw += periodsByQuest[questID][_questPeriods[i]].rewardAmountPerPeriod;
                periodsByQuest[questID][_questPeriods[i]].rewardAmountPerPeriod = 0;
            }

            unchecked{ ++i; }
        }

        // If the total amount to emergency withdraw is non_null, execute a transfer
        if(totalWithdraw != 0){
            address rewardToken = quests[questID].rewardToken;
            IERC20(rewardToken).safeTransfer(recipient, totalWithdraw);

            emit EmergencyWithdraw(questID, recipient, totalWithdraw);
        }

    }



    // Manager functions
 
    /**
    * @notice Closes the Period, and all QuestPeriods for this period
    * @dev Closes all QuestPeriod for the given period, calculating rewards to distribute & send them to distributor
    * @param period Timestamp of the period
    */
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

        // We use the Gauge Point data from nextPeriod => the end of the period we are closing
        uint256 nextPeriod = ((period + WEEK) / WEEK) * WEEK;

        // For each QuestPeriod
        uint256 length = questsForPeriod.length;
        for(uint256 i = 0; i < length;){
            Quest storage _quest = quests[questsForPeriod[i]];
            QuestPeriod memory _questPeriod = periodsByQuest[questsForPeriod[i]][period];
            _questPeriod.currentState = PeriodState.CLOSED;

            // Call a checkpoint on the Gauge, in case it was not written yet
            gaugeController.checkpoint_gauge(_quest.gauge);

            // Get the bias of the Gauge for the end of the period
            uint256 periodBias = gaugeController.points_weight(_quest.gauge, nextPeriod).bias;

            if(periodBias == 0) { 
                //Because we don't want to divide by 0
                // Here since the bias is 0, we consider 0% completion
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

                // Using the completion ratio, we calculate the amount to distribute
                uint256 toDistributeAmount = (_questPeriod.rewardAmountPerPeriod * objectiveCompletion) / UNIT;

                _questPeriod.rewardAmountDistributed = toDistributeAmount;
                // And the rest is set as withdrawable amount, that the Quest creator can retrieve
                _questPeriod.withdrawableAmount = _questPeriod.rewardAmountPerPeriod - toDistributeAmount;

                IERC20(_quest.rewardToken).safeTransfer(distributor, toDistributeAmount);
            }

            periodsByQuest[questsForPeriod[i]][period] =  _questPeriod;

            unchecked{ ++i; }
        }

        emit PeriodClosed(period);
    }

    /**
    * @notice Closes the given QuestPeriods for the Period
    * @dev Closes the given QuestPeriods for the Period, calculating rewards to distribute & send them to distributor
    * @param period Timestamp of the period
    * @param questIDs List of the Quest IDs to close
    */
    function closePartOfQuestPeriod(uint256 period, uint256[] calldata questIDs) external isAlive onlyAllowed nonReentrant {
        updatePeriod();
        require(questIDs.length != 0, "QuestBoard: empty array");
        require(distributor != address(0), "QuestBoard: no Distributor set");
        require(period != 0, "QuestBoard: invalid Period");
        require(period < currentPeriod, "QuestBoard: Period still active");
        require(questsByPeriod[period].length != 0, "QuestBoard: empty Period");

        IGaugeController gaugeController = IGaugeController(GAUGE_CONTROLLER);

        // We use the Gauge Point data from nextPeriod => the end of the period we are closing
        uint256 nextPeriod = ((period + WEEK) / WEEK) * WEEK;

        // For each QuestPeriod
        uint256 length = questIDs.length;
        for(uint256 i = 0; i < length;){
            // We chack that this period was not already closed
            require(
                periodsByQuest[questIDs[i]][period].currentState == PeriodState.ACTIVE,
                "QuestBoard: Period already closed"
            );

            Quest storage _quest = quests[questIDs[i]];
            QuestPeriod memory _questPeriod = periodsByQuest[questIDs[i]][period];
            _questPeriod.currentState = PeriodState.CLOSED;

            // Call a checkpoint on the Gauge, in case it was not written yet
            gaugeController.checkpoint_gauge(_quest.gauge);

            // Get the bias of the Gauge for the end of the period
            uint256 periodBias = gaugeController.points_weight(_quest.gauge, nextPeriod).bias;

            if(periodBias == 0) { 
                //Because we don't want to divide by 0
                // Here since the bias is 0, we consider 0% completion
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

                // Using the completion ratio, we calculate the amount to distribute
                uint256 toDistributeAmount = (_questPeriod.rewardAmountPerPeriod * objectiveCompletion) / UNIT;

                _questPeriod.rewardAmountDistributed = toDistributeAmount;
                // And the rest is set as withdrawable amount, that the Quest creator can retrieve
                _questPeriod.withdrawableAmount = _questPeriod.rewardAmountPerPeriod - toDistributeAmount;

                IERC20(_quest.rewardToken).safeTransfer(distributor, toDistributeAmount);
            }

            periodsByQuest[questIDs[i]][period] =  _questPeriod;

            unchecked{ ++i; }
        }

        emit PeriodClosedPart(period);
    }
   
    /**
    * @dev Sets the QuestPeriod as disitrbuted, and adds the MerkleRoot to the Distributor contract
    * @param questID ID of the Quest
    * @param period Timestamp of the period
    * @param merkleRoot MerkleRoot to add
    */
    function _addMerkleRoot(uint256 questID, uint256 period, bytes32 merkleRoot) internal {
        require(questID < nextID, "QuestBoard: Non valid ID");
        require(merkleRoot != 0, "QuestBoard: Empty MerkleRoot");

        // This also allows to check if the given period is correct => If not, the currentState is never set to CLOSED for the QuestPeriod
        require(periodsByQuest[questID][period].currentState == PeriodState.CLOSED, "QuestBoard: Quest Period not closed");

        // Add the MerkleRoot to the Distributor & set the QuestPeriod as DISTRIBUTED
        require(MultiMerkleDistributor(distributor).updateQuestPeriod(questID, period, merkleRoot), "QuestBoard: Failed to add MerkleRoot");

        periodsByQuest[questID][period].currentState = PeriodState.DISTRIBUTED;
    }
   
    /**
    * @notice Sets the QuestPeriod as disitrbuted, and adds the MerkleRoot to the Distributor contract
    * @dev internal call to _addMerkleRoot()
    * @param questID ID of the Quest
    * @param period Timestamp of the period
    * @param merkleRoot MerkleRoot to add
    */
    function addMerkleRoot(uint256 questID, uint256 period, bytes32 merkleRoot) external isAlive onlyAllowed nonReentrant {
        _addMerkleRoot(questID, period, merkleRoot);
    }

    /**
    * @notice Sets a list of QuestPeriods as disitrbuted, and adds the MerkleRoot to the Distributor contract for each
    * @dev Loop and internal call to _addMerkleRoot()
    * @param questIDs List of Quest IDs
    * @param period Timestamp of the period
    * @param merkleRoots List of MerkleRoots to add
    */
    function addMultipleMerkleRoot(uint256[] calldata questIDs, uint256 period, bytes32[] calldata merkleRoots) external isAlive onlyAllowed nonReentrant {
        require(questIDs.length == merkleRoots.length, "QuestBoard: Diff list size");

        uint256 length = questIDs.length;
        for(uint256 i = 0; i < length;){
            _addMerkleRoot(questIDs[i], period, merkleRoots[i]);

            unchecked{ ++i; }
        }
    }
   
    /**
    * @notice Whitelists a reward token
    * @dev Whitelists a reward token
    * @param newToken Address of the reward token
    */
    function whitelistToken(address newToken, uint256 minRewardPerVote) public onlyAllowed {
        require(newToken != address(0), "QuestBoard: Zero Address");
        require(minRewardPerVote != 0, "QuestBoard: Null value");

        whitelistedTokens[newToken] = true;

        minRewardPerVotePerToken[newToken] = minRewardPerVote;

        emit WhitelistToken(newToken, minRewardPerVote);
    }
   
    /**
    * @notice Whitelists a list of reward tokens
    * @dev Whitelists a list of reward tokens
    * @param newTokens List of reward tokens addresses
    */
    function whitelistMultipleTokens(address[] calldata newTokens, uint256[] calldata minRewardPerVotes) external onlyAllowed {
        require(newTokens.length != 0, "QuestBoard: empty list");
        require(newTokens.length == minRewardPerVotes.length, "QuestBoard: list sizes inequal");

        uint256 length = newTokens.length;
        for(uint256 i = 0; i < length;){
            whitelistToken(newTokens[i], minRewardPerVotes[i]);

            unchecked{ ++i; }
        }
    }

    function updateRewardToken(address newToken, uint256 newMinRewardPerVote) public onlyAllowed {
        require(whitelistedTokens[newToken], "QuestBoard: Token not whitelisted");
        require(newMinRewardPerVote != 0, "QuestBoard: Null value");

        minRewardPerVotePerToken[newToken] = newMinRewardPerVote;

        emit UpdateRewardToken(newToken, newMinRewardPerVote);
    }

    // Admin functions
   
    /**
    * @notice Sets an initial Distributor address
    * @dev Sets an initial Distributor address
    * @param newDistributor Address of the Distributor
    */
    function initiateDistributor(address newDistributor) external onlyOwner {
        require(distributor == address(0), "QuestBoard: Already initialized");
        distributor = newDistributor;
    }
   
    /**
    * @notice Approves a new address as manager 
    * @dev Approves a new address as manager
    * @param newManager Address to add
    */
    function approveManager(address newManager) external onlyOwner {
        require(newManager != address(0), "QuestBoard: Zero Address");
        approvedManagers[newManager] = true;
    }
   
    /**
    * @notice Removes an address from the managers
    * @dev Removes an address from the managers
    * @param manager Address to remove
    */
    function removeManager(address manager) external onlyOwner {
        require(manager != address(0), "QuestBoard: Zero Address");
        approvedManagers[manager] = false;
    }
   
    /**
    * @notice Updates the Chest address
    * @dev Updates the Chest address
    * @param chest Address of the new Chest
    */
    function updateChest(address chest) external onlyOwner {
        require(chest != address(0), "QuestBoard: Zero Address");
        questChest = chest;
    }
   
    /**
    * @notice Updates the Distributor address
    * @dev Updates the Distributor address
    * @param newDistributor Address of the new Distributor
    */
    function updateDistributor(address newDistributor) external onlyOwner {
        require(newDistributor != address(0), "QuestBoard: Zero Address");
        distributor = newDistributor;
    }
   
    /**
    * @notice Updates the Platfrom fees BPS ratio
    * @dev Updates the Platfrom fees BPS ratio
    * @param newFee New fee ratio
    */
    function updatePlatformFee(uint256 newFee) external onlyOwner {
        require(newFee <= 500, "QuestBoard: Fee too high");
        platformFee = newFee;
    }
   
    /**
    * @notice Updates the min objective value
    * @dev Updates the min objective value
    * @param newMinObjective New min objective
    */
    function updateMinObjective(uint256 newMinObjective) external onlyOwner {
        require(newMinObjective > 0, "QuestBoard: Null value");
        minObjective = newMinObjective;
    }
   
    /**
    * @notice Recovers ERC2O tokens sent by mistake to the contract
    * @dev Recovers ERC2O tokens sent by mistake to the contract
    * @param token Address tof the EC2O token
    * @param amount Amount to recover
    * @return bool: success
    */
    function recoverERC20(address token, uint256 amount) external onlyOwner returns(bool) {
        require(!whitelistedTokens[token], "QuestBoard: Cannot recover whitelisted token");
        IERC20(token).safeTransfer(owner(), amount);

        return true;
    }
   
    /**
    * @notice Kills the contract
    * @dev Kills the contract
    */
    function killBoard() external onlyOwner {
        require(!isKilled, "QuestBoard: Already killed");
        isKilled = true;
        kill_ts = block.timestamp;

        emit Killed(kill_ts);
    }
   
    /**
    * @notice Unkills the contract
    * @dev Unkills the contract
    */
    function unkillBoard() external onlyOwner {
        require(isKilled, "QuestBoard: Not killed");
        require(block.timestamp < kill_ts + KILL_DELAY, "QuestBoard: Too late");
        isKilled = false;

        emit Unkilled(block.timestamp);
    }



    // Utils 

    function safe48(uint n) internal pure returns (uint48) {
        require(n <= type(uint48).max, "QuestBoard : Number exceed 48 bits");
        return uint48(n);
    }

}