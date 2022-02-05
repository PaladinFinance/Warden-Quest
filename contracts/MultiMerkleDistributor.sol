// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./oz/interfaces/IERC20.sol";
import "./oz/libraries/SafeERC20.sol";
import "./oz/utils/MerkleProof.sol";
import "./oz/utils/Ownable.sol";

/** @title Warden Quest Multi Merkle Distributor  */
/// @author Paladin
/*
    Contract holds ERC20 rewards from Quests
    Can handle multiple MerkleRoots
*/

contract MultiMerkleDistributor is Ownable {
    using SafeERC20 for IERC20;

    // QuestID => reward token
    mapping(uint256 => address) public questRewardToken;

    //Periods: timestamp => start of a week, used as a voting period 
    //in the Curve GaugeController though the timestamp / WEEK *  WEEK logic.
    //Handled through the QuestManager contract.
    //Those can be fetched through this contract when they are closed, or through the QuestManager contract.

    // QuestID => array of periods
    mapping(uint256 => uint256[]) public questClosedPeriods;

    // QuestID => period => merkleRoot
    mapping(uint256 => mapping(uint256 => bytes32)) public questMerkleRootPerPeriod;

    // QuestID => period => claimedBitMap
    // This is a packed array of booleans.
    mapping(uint256 => mapping(uint256 => mapping(uint256 => uint256))) private questPeriodClaimedBitMap;


    address public questBoard;


    // Events
    event Claimed(
        uint256 indexed questID,
        uint256 indexed period,
        uint256 index,
        uint256 amount,
        address rewardToken,
        address indexed account
    );
    event NewQuest(uint256 indexed questID, address rewardToken);
    event QuestPeriodUpdated(uint256 indexed questID, uint256 indexed period, bytes32 merkleRoot);


    // Modifier

    modifier onlyAllowed(){
        require(msg.sender == questBoard || msg.sender == owner(), "MultiMerkle: Not allowed");
        _;
    }


    // Constructor

    constructor(address _questBoard){
        questBoard = _questBoard;
    }

    // Functions

    function isClaimed(uint256 questID, uint256 period, uint256 index) public view returns (bool) {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        uint256 claimedWord = questPeriodClaimedBitMap[questID][period][claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    function _setClaimed(uint256 questID, uint256 period, uint256 index) private {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        questPeriodClaimedBitMap[questID][period][claimedWordIndex] = questPeriodClaimedBitMap[questID][period][claimedWordIndex] | (1 << claimedBitIndex);
    }

    //Basic Claim
    function claim(uint256 questID, uint256 period, uint256 index, address account, uint256 amount, bytes32[] calldata merkleProof) public {
        require(questMerkleRootPerPeriod[questID][period] != 0, "MultiMerkle: not updated yet");
        require(!isClaimed(questID, period, index), "MultiMerkle: already claimed");

        bytes32 node = keccak256(abi.encodePacked(index, account, amount));
        require(
            MerkleProof.verify(merkleProof, questMerkleRootPerPeriod[questID][period], node),
            "MultiMerkle: Invalid proof"
        );

        address rewardToken = questRewardToken[questID];
        _setClaimed(questID, period, index);
        IERC20(rewardToken).safeTransfer(account, amount);

        emit Claimed(questID, period, index, amount, rewardToken, account);
    }


    //Struct ClaimParams
    struct ClaimParams {
        uint256 questID;
        uint256 period;
        uint256 index;
        uint256 amount;
        bytes32[] merkleProof;
    }


    //Multi Claim
    function multiClaim(address account, ClaimParams[] calldata claims) external {
        require(claims.length != 0, "MultiMerkle: empty parameters");

        for(uint i = 0; i < claims.length; i++){
            claim(claims[i].questID, claims[i].period, claims[i].index, account, claims[i].amount, claims[i].merkleProof);
        }
    }


    //FullQuest Claim (form of Multi Claim but for only one Quest => only one ERC20 transfer)
    //Only works for the given periods (in ClaimParams) for the Quest. Any omitted period will be skipped
    function claimQuest(address account, uint256 questID, ClaimParams[] calldata claims) external {
        require(claims.length != 0, "MultiMerkle: empty parameters");

        uint256 totalClaimAmount = 0;
        address rewardToken = questRewardToken[questID];

        for(uint i = 0; i < claims.length; i++){
            require(claims[i].questID == questID, "MultiMerkle: incorrect Quest");
            require(questMerkleRootPerPeriod[claims[i].questID][claims[i].period] != 0, "MultiMerkle: not updated yet");
            require(!isClaimed(questID, claims[i].period, claims[i].index), "MultiMerkle: already claimed");

            bytes32 node = keccak256(abi.encodePacked(claims[i].index, account, claims[i].amount));
            require(
                MerkleProof.verify(claims[i].merkleProof, questMerkleRootPerPeriod[questID][claims[i].period], node),
                "MultiMerkle: Invalid proof"
            );

            _setClaimed(questID, claims[i].period, claims[i].index);
            totalClaimAmount += claims[i].amount;

            emit Claimed(questID, claims[i].period, claims[i].index, claims[i].amount, rewardToken, account);
        }
            
        IERC20(rewardToken).safeTransfer(account, totalClaimAmount);
    }


    function getClosedPeriodsByQuests(uint256 questID) external view returns (uint256[] memory) {
        return questClosedPeriods[questID];
    }

    // Manager functions

    function addQuest(uint256 questID, address token) external onlyAllowed returns(bool) {
        require(questRewardToken[questID] == address(0), "MultiMerkle: Quest already listed");
        require(token != address(0), "MultiMerkle: Incorrect reward token");

        // Add a new Quest using the QuestID, and list the reward token for that Quest
        questRewardToken[questID] = token;

        emit NewQuest(questID, token);

        return true;
    }

    function updateQuestPeriod(uint256 questID, uint256 period, bytes32 merkleRoot) external onlyAllowed returns(bool) {
        require(questRewardToken[questID] != address(0), "MultiMerkle: Quest not listed");
        require(questMerkleRootPerPeriod[questID][period] == 0, "MultiMerkle: period already updated");
        require(merkleRoot != 0, "MultiMerkle: Empty MerkleRoot");

        // Add a new Closed Period for the Quest
        require(period != 0, "MultiMerkle: incorrect period");
        questClosedPeriods[questID].push(period);

        // Add the new MerkleRoot for that Closed Period
        questMerkleRootPerPeriod[questID][period] = merkleRoot;

        emit QuestPeriodUpdated(questID, period, merkleRoot);

        return true;
    }


    //  Admin functions
    function updateQuestManager(address newQuestBoard) external onlyOwner {
        questBoard = newQuestBoard;
    }

    function recoverERC20(address token, uint256 amount) external onlyOwner returns(bool) {
        IERC20(token).safeTransfer(owner(), amount);

        return true;
    }

    // In case the given MerkleRoot was incorrect => allows to update with the correct one so users can claim
    function emergencyUpdatequestPeriod(uint256 questID, uint256 period, bytes32 merkleRoot) external onlyOwner returns(bool) {
        require(questRewardToken[questID] != address(0), "MultiMerkle: Quest not listed");
        require(merkleRoot != 0, "MultiMerkle: Empty MerkleRoot");
        require(period != 0, "MultiMerkle: incorrect period");

        questMerkleRootPerPeriod[questID][period] = merkleRoot;

        emit QuestPeriodUpdated(questID, period, merkleRoot);

        return true;
    }

}