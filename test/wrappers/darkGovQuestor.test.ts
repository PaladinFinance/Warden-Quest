const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { DarkQuestBoard } from "../../typechain/DarkQuestBoard";
import { GovernanceDarkQuestor } from "../../typechain/GovernanceDarkQuestor";
import { QuestTreasureChest } from "../../typechain/QuestTreasureChest";
import { MultiMerkleDistributor } from "../../typechain/MultiMerkleDistributor";
import { MockGaugeController } from "../../typechain/MockGaugeController";
import { IERC20 } from "../../typechain/IERC20";
import { IERC20__factory } from "../../typechain/factories/IERC20__factory";
import { Useless } from "../../typechain/Useless";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";
import BalanceTree from "../../scripts/merkle/src/balance-tree";

import {
    advanceTime,
    getERC20,
    resetFork,
} from "../utils/utils";

const { TOKEN1_ADDRESS, BIG_HOLDER1, TOKEN2_ADDRESS, BIG_HOLDER2 } = require("../utils/constant");


chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;

let boardFactory: ContractFactory
let questorFactory: ContractFactory
let distributorFactory: ContractFactory
let controllerFactory: ContractFactory
let chestFactory: ContractFactory

const WEEK = BigNumber.from(86400 * 7)
const UNIT = ethers.utils.parseEther('1')


describe('GovernanceQuestor contract tests', () => {
    let admin: SignerWithAddress

    let governance: SignerWithAddress

    let manager: SignerWithAddress

    let gauge1: SignerWithAddress
    let gauge2: SignerWithAddress

    let user1: SignerWithAddress
    let user2: SignerWithAddress
    let user3: SignerWithAddress

    let voter1: SignerWithAddress
    let voter2: SignerWithAddress
    let voter3: SignerWithAddress

    let receiver: SignerWithAddress

    let board: DarkQuestBoard
    let questor: GovernanceDarkQuestor
    let distributor: MultiMerkleDistributor
    let controller: MockGaugeController
    let chest: QuestTreasureChest

    let rewardToken: IERC20

    let minrewardTokenAmount = ethers.utils.parseEther("0.005")

    const target_votes = ethers.utils.parseEther('150000')
    const reward_per_vote = ethers.utils.parseEther('6')
    const duration = 2

    before(async () => {
        await resetFork();

        [admin, governance, manager, gauge1, gauge2, receiver, user1, user2, user3, voter1, voter2, voter3] = await ethers.getSigners();

        boardFactory = await ethers.getContractFactory("DarkQuestBoard");

        questorFactory = await ethers.getContractFactory("GovernanceDarkQuestor");

        distributorFactory = await ethers.getContractFactory("MultiMerkleDistributor");

        controllerFactory = await ethers.getContractFactory("MockGaugeController");

        chestFactory = await ethers.getContractFactory("QuestTreasureChest");

        const rewardToken_amount = ethers.utils.parseEther('100000000');

        rewardToken = IERC20__factory.connect(TOKEN2_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER2, rewardToken, admin.address, rewardToken_amount);

    })

    beforeEach(async () => {

        chest = (await chestFactory.connect(admin).deploy()) as QuestTreasureChest;
        await chest.deployed();

        controller = (await controllerFactory.connect(admin).deploy()) as MockGaugeController;
        await controller.deployed();

        board = (await boardFactory.connect(admin).deploy(controller.address, chest.address)) as DarkQuestBoard;
        await board.deployed();

        distributor = (await distributorFactory.connect(admin).deploy(board.address)) as MultiMerkleDistributor;
        await distributor.deployed();

        questor = (await questorFactory.connect(admin).deploy(
            board.address,
            governance.address,
            manager.address,
            gauge1.address,
            rewardToken.address,
            duration,
            target_votes,
            reward_per_vote
        )) as GovernanceDarkQuestor;
        await questor.deployed();

        await board.connect(admin).initiateDistributor(distributor.address)

        await board.connect(admin).whitelistToken(rewardToken.address, minrewardTokenAmount)

        await controller.add_gauge(gauge1.address, 2)
        await controller.add_gauge(gauge2.address, 1)

        await board.connect(admin).approveManager(admin.address)

    });

    it(' should be deployed & have correct parameters', async () => {
        expect(questor.address).to.properAddress

        expect(await questor.board()).to.be.eq(board.address)
        expect(await questor.governance()).to.be.eq(governance.address)
        expect(await questor.manager()).to.be.eq(manager.address)
        expect(await questor.gauge()).to.be.eq(gauge1.address)
        expect(await questor.rewardToken()).to.be.eq(rewardToken.address)
        expect(await questor.duration()).to.be.eq(duration)
        expect(await questor.objective()).to.be.eq(target_votes)
        expect(await questor.rewardPerVote()).to.be.eq(reward_per_vote)

    });


    describe('Voter Blacklist', async () => {

        it(' should add address to blacklist (& emit correct Event)', async () => {

            const add_tx = await questor.connect(manager).addVoterBlacklist(voter2.address)

            await expect(
                add_tx
            ).to.emit(questor, "AddVoterBlacklist")
                .withArgs(voter2.address);

            expect(await questor.voterBlacklist(0)).to.be.eq(voter2.address)

            const blacklist = await questor.getBlacklistedVoters()

            expect(blacklist.includes(voter2.address)).to.be.true

        });

        it(' should allow to add other address to blacklist', async () => {

            await questor.connect(governance).addVoterBlacklist(voter2.address)

            expect(await questor.voterBlacklist(0)).to.be.eq(voter2.address)

            const blacklist = await questor.getBlacklistedVoters()

            expect(blacklist.includes(voter2.address)).to.be.true

            const add_tx = await questor.connect(manager).addVoterBlacklist(voter3.address)

            await expect(
                add_tx
            ).to.emit(questor, "AddVoterBlacklist")
                .withArgs(voter3.address);

            expect(await questor.voterBlacklist(1)).to.be.eq(voter3.address)

            const blacklist2 = await questor.getBlacklistedVoters()

            expect(blacklist2.includes(voter2.address)).to.be.true
            expect(blacklist2.includes(voter3.address)).to.be.true

        });

        it(' should not allow to add the same address twice', async () => {

            await questor.connect(manager).addVoterBlacklist(voter2.address)

            const previous_blacklist = await questor.getBlacklistedVoters()
            const previous_blacklist_size = previous_blacklist.length

            await questor.connect(manager).addVoterBlacklist(voter2.address)

            const new_blacklist = await questor.getBlacklistedVoters()
            const new_blacklist_size = new_blacklist.length

            expect(previous_blacklist).to.eql(new_blacklist)
            expect(previous_blacklist_size).to.be.eq(new_blacklist_size)

        });

        it(' should remove the address correctly (& emit correct Event)', async () => {

            await questor.connect(manager).addVoterBlacklist(voter2.address)
            await questor.connect(manager).addVoterBlacklist(voter3.address)

            const remove_tx = await questor.connect(manager).removeVoterBlacklist(voter2.address)

            await expect(
                remove_tx
            ).to.emit(questor, "RemoveVoterBlacklist")
                .withArgs(voter2.address);

            expect(await questor.voterBlacklist(0)).to.be.eq(voter3.address)

            const blacklist = await questor.getBlacklistedVoters()
    
            expect(blacklist.includes(voter2.address)).to.be.false
            expect(blacklist.includes(voter3.address)).to.be.true

        });

        it(' should allow to empty the list', async () => {

            await questor.connect(manager).addVoterBlacklist(voter2.address)
            await questor.connect(manager).addVoterBlacklist(voter3.address)

            await questor.connect(manager).removeVoterBlacklist(voter2.address)
            await questor.connect(manager).removeVoterBlacklist(voter3.address)

            const blacklist = await questor.getBlacklistedVoters()

            expect(blacklist.length).to.be.eq(0)
    
            expect(blacklist.includes(voter2.address)).to.be.false
            expect(blacklist.includes(voter3.address)).to.be.false

        });

        it(' should not remove an address not blacklisted', async () => {

            await questor.connect(manager).addVoterBlacklist(voter1.address)
            await questor.connect(manager).addVoterBlacklist(voter2.address)

            const previous_blacklist = await questor.getBlacklistedVoters()
            const previous_blacklist_size = previous_blacklist.length

            await questor.connect(manager).removeVoterBlacklist(voter3.address)

            const new_blacklist = await questor.getBlacklistedVoters()
            const new_blacklist_size = new_blacklist.length

            expect(previous_blacklist).to.eql(new_blacklist)
            expect(previous_blacklist_size).to.be.eq(new_blacklist_size)

        });

        it(' should only allow partner & admin to call methods', async () => {

            await expect(
                questor.connect(voter2).addVoterBlacklist(voter2.address)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                questor.connect(user3).removeVoterBlacklist(voter2.address)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('createQuest', async () => {

        let questor2: GovernanceDarkQuestor

        let questID: BigNumber;

        const total_rewards_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)

        const rewards_per_period = target_votes.mul(reward_per_vote).div(UNIT)

        beforeEach(async () => {

            await questor.connect(manager).addVoterBlacklist(voter1.address)
            await questor.connect(manager).addVoterBlacklist(voter2.address)

        });

        it(' should create the Quest correctly & list the Quest', async () => {

            await rewardToken.connect(admin).transfer(questor.address, total_rewards_amount.mul(3))

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            const create_tx = await questor.connect(manager).createQuest()

            questID = (await board.nextID()).sub(1)

            await expect(
                create_tx
            ).to.emit(board, "NewQuest")
                .withArgs(
                    questID,
                    questor.address,
                    gauge1.address,
                    rewardToken.address,
                    duration,
                    expected_period,
                    target_votes,
                    reward_per_vote
                );
            
            expect(await questor.createdQuests(0)).to.be.eq(questID)

            const quest_data = await board.quests(questID)

            expect(quest_data.creator).to.be.eq(questor.address)
            expect(quest_data.rewardToken).to.be.eq(rewardToken.address)
            expect(quest_data.gauge).to.be.eq(gauge1.address)
            expect(quest_data.duration).to.be.eq(duration)
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount)
            expect(quest_data.periodStart).to.be.eq(expected_period)

            expect(await board.questDistributors(questID)).to.be.eq(distributor.address)

            const periods = await board.getAllPeriodsForQuestId(questID)
            expect(periods.length).to.be.eq(duration)

            for (let i = 0; i < duration; i++) {
                expect(periods[i]).to.be.eq(expected_period.add(WEEK.mul(i)).div(WEEK).mul(WEEK))
            }

            const ids_for_period = await board.getQuestIdsForPeriod(expected_period)
            expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questID)

            const quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            for (let i = 0; i < quest_periods.length; i++) {
                let quest_period = quest_periods[i]
                let expected_future_period = expected_period.add(WEEK.mul(i)).div(WEEK).mul(WEEK)

                expect(quest_period.periodStart).to.be.eq(expected_future_period)
                expect(quest_period.rewardAmountPerPeriod).to.be.eq(rewards_per_period)
                expect(quest_period.rewardPerVote).to.be.eq(reward_per_vote)
                expect(quest_period.objectiveVotes).to.be.eq(target_votes)
                expect(quest_period.rewardAmountDistributed).to.be.eq(0)
                expect(quest_period.withdrawableAmount).to.be.eq(0)

                expect(quest_period.currentState).to.be.eq(1) // => PeriodState.ACTIVE

                const ids_for_period = await board.getQuestIdsForPeriod(expected_future_period)
                expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questID)
            }

            const quest_blacklist = await board.getQuestBlacklsit(questID)

            expect(quest_blacklist[0]).to.be.eq(voter1.address)
            expect(await board.questBlacklist(questID, 0)).to.be.eq(voter1.address)
            expect(quest_blacklist[1]).to.be.eq(voter2.address)
            expect(await board.questBlacklist(questID, 1)).to.be.eq(voter2.address)

            await expect(
                create_tx
            ).to.emit(board, "AddVoterBlacklist")
                .withArgs(
                    questID,
                    voter1.address
                );

            await expect(
                create_tx
            ).to.emit(board, "AddVoterBlacklist")
                .withArgs(
                    questID,
                    voter2.address
                );

        });

        it(' should allow to create multiple Quests', async () => {

            await rewardToken.connect(admin).transfer(questor.address, total_rewards_amount.mul(3))

            let block_number = await provider.getBlockNumber()
            let current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            let expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            await questor.connect(manager).createQuest()

            questID = (await board.nextID()).sub(1)

            expect(await questor.createdQuests(0)).to.be.eq(questID)

            let quest_data = await board.quests(questID)

            expect(quest_data.creator).to.be.eq(questor.address)
            expect(quest_data.rewardToken).to.be.eq(rewardToken.address)
            expect(quest_data.gauge).to.be.eq(gauge1.address)
            expect(quest_data.duration).to.be.eq(duration)
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount)
            expect(quest_data.periodStart).to.be.eq(expected_period)

            expect(await board.questDistributors(questID)).to.be.eq(distributor.address)

            await advanceTime(WEEK.mul(2).toNumber())

            block_number = await provider.getBlockNumber()
            current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            await questor.connect(manager).createQuest()

            questID = (await board.nextID()).sub(1)

            expect(await questor.createdQuests(1)).to.be.eq(questID)

            quest_data = await board.quests(questID)

            expect(quest_data.creator).to.be.eq(questor.address)
            expect(quest_data.rewardToken).to.be.eq(rewardToken.address)
            expect(quest_data.gauge).to.be.eq(gauge1.address)
            expect(quest_data.duration).to.be.eq(duration)
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount)
            expect(quest_data.periodStart).to.be.eq(expected_period)

            expect(await board.questDistributors(questID)).to.be.eq(distributor.address)

        });

        it(' should fail if Questor has not funds', async () => {

            await expect(
                questor.connect(manager).createQuest()
            ).to.be.reverted

        });

        it(' should fail if parameters are invalids - gauge target', async () => {

            questor2 = (await questorFactory.connect(admin).deploy(
                board.address,
                governance.address,
                manager.address,
                user1.address,
                rewardToken.address,
                duration,
                target_votes,
                reward_per_vote
            )) as GovernanceDarkQuestor;
            await questor2.deployed();

            await expect(
                questor2.connect(manager).createQuest()
            ).to.be.reverted

        });

        it(' should fail if parameters are invalids - reward token', async () => {

            questor2 = (await questorFactory.connect(admin).deploy(
                board.address,
                governance.address,
                manager.address,
                gauge1.address,
                user1.address,
                duration,
                target_votes,
                reward_per_vote
            )) as GovernanceDarkQuestor;
            await questor2.deployed();

            await expect(
                questor2.connect(manager).createQuest()
            ).to.be.reverted

            

        });

        it(' should fail if parameters are invalids - low objective', async () => {

            await questor.connect(manager).changeObjective(ethers.utils.parseEther('10'))

            await expect(
                questor.connect(manager).createQuest()
            ).to.be.reverted

            

        });

        it(' should fail if parameters are invalids - low rewards', async () => {

            await questor.connect(manager).changeRewardPerVote(minrewardTokenAmount.div(2))

            await expect(
                questor.connect(manager).createQuest()
            ).to.be.reverted

            

        });

        it(' should only be callable by the manager', async () => {

            await expect(
                questor.connect(governance).createQuest()
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                questor.connect(user1).createQuest()
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                questor.connect(admin).createQuest()
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('withdrawUnusedRewards & withdrawUnusedRewardsMultiple', async () => {

        const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
        const mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"

        let gauges: string[] = []

        let questIDs: BigNumber[] = [];

        const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000'), ethers.utils.parseEther('12000'), ethers.utils.parseEther('11000'), ethers.utils.parseEther('12000'), ethers.utils.parseEther('10000')]
        const gauge2_biases = [ethers.utils.parseEther('12000'), ethers.utils.parseEther('15000'), ethers.utils.parseEther('18000'), ethers.utils.parseEther('20000'), ethers.utils.parseEther('17000'), ethers.utils.parseEther('18000')]

        let first_period: BigNumber;

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address]

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            const total_rewards_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)

            await rewardToken.connect(admin).transfer(questor.address, total_rewards_amount.mul(3))

            await questor.connect(manager).addVoterBlacklist(voter1.address)
            await questor.connect(manager).addVoterBlacklist(voter2.address)

            await questor.connect(manager).createQuest()

            questIDs.push(await questor.createdQuests(0))

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            await controller.set_user_vote(voter1.address, gauge1.address, first_period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter1.address, gauge2.address, first_period, ethers.utils.parseEther('400'), current_ts.add(WEEK.mul(182)))

            await controller.set_user_vote(voter2.address, gauge2.address, first_period, ethers.utils.parseEther('250'), current_ts.add(WEEK.mul(150)))

            await controller.set_user_vote(voter3.address, gauge1.address, first_period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge2.address, first_period, ethers.utils.parseEther('520'), current_ts.add(WEEK.mul(195)))

            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
            }

            await advanceTime(WEEK.mul(3).toNumber())

            await board.connect(admin).closeQuestPeriod(first_period)

            const next_period = first_period.add(WEEK).div(WEEK).mul(WEEK)

            await board.connect(admin).closeQuestPeriod(next_period)

            const period_rewards1 = (await board.periodsByQuest(questIDs[0], first_period)).rewardAmountDistributed
            const period_rewards2 = (await board.periodsByQuest(questIDs[0], next_period)).rewardAmountDistributed

            await board.connect(admin).addMerkleRoot(questIDs[0], first_period, period_rewards1, mockRoot)
            await board.connect(admin).addMerkleRoot(questIDs[0], next_period, period_rewards2, mockRoot2)

        });

        it(' should send back the undistributed tokens correctly', async () => {

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[0])

            let expected_withdrawable_amount = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods.length; i++) {
                let quest_period = old_quest_periods[i]

                if (quest_period.currentState > 1) {
                    expect(quest_period.withdrawableAmount).not.to.be.eq(0)
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.withdrawableAmount)
                }
            }

            const old_board_balance = await rewardToken.balanceOf(board.address)
            const old_receiver_balance = await rewardToken.balanceOf(receiver.address)

            const withdraw_tx = await questor.connect(manager).withdrawUnusedRewards(questIDs[0], receiver.address)

            await expect(
                withdraw_tx
            ).to.emit(board, "WithdrawUnusedRewards")
                .withArgs(questIDs[0], receiver.address, expected_withdrawable_amount);

            await expect(
                withdraw_tx
            ).to.emit(rewardToken, "Transfer")
                .withArgs(board.address, receiver.address, expected_withdrawable_amount);

            const new_board_balance = await rewardToken.balanceOf(board.address)
            const new_receiver_balance = await rewardToken.balanceOf(receiver.address)

            expect(new_board_balance).to.be.eq(old_board_balance.sub(expected_withdrawable_amount))
            expect(new_receiver_balance).to.be.eq(old_receiver_balance.add(expected_withdrawable_amount))

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[0])

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                if (quest_period.currentState > 1) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
            }

        });

        it(' should withdraw from multiple Quests at once', async () => {

            const new_first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            await questor.connect(manager).createQuest()

            questIDs = [
                await questor.createdQuests(0),
                await questor.createdQuests(1)
            ]

            await advanceTime(WEEK.mul(3).toNumber())

            await board.connect(admin).closeQuestPeriod(new_first_period)

            const new_next_period = new_first_period.add(WEEK).div(WEEK).mul(WEEK)

            await board.connect(admin).closeQuestPeriod(new_next_period)

            const period_rewards1 = (await board.periodsByQuest(questIDs[1], new_first_period)).rewardAmountDistributed
            const period_rewards2 = (await board.periodsByQuest(questIDs[1], new_next_period)).rewardAmountDistributed

            await board.connect(admin).addMerkleRoot(questIDs[1], new_first_period, period_rewards1, mockRoot)
            await board.connect(admin).addMerkleRoot(questIDs[1], new_next_period, period_rewards2, mockRoot2)

            const old_quest_periods0 = await board.getAllQuestPeriodsForQuestId(questIDs[0])
            const old_quest_periods1 = await board.getAllQuestPeriodsForQuestId(questIDs[1])

            let expected_withdrawable_amount0 = BigNumber.from(0)
            let expected_withdrawable_amount1 = BigNumber.from(0)
            let expected_withdrawable_amount_total = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods0.length; i++) {
                let quest_period = old_quest_periods0[i]

                if (quest_period.currentState > 1) {
                    expect(quest_period.withdrawableAmount).not.to.be.eq(0)
                    expected_withdrawable_amount0 = expected_withdrawable_amount0.add(quest_period.withdrawableAmount)
                }
            }

            for (let i = 0; i < old_quest_periods1.length; i++) {
                let quest_period = old_quest_periods1[i]

                if (quest_period.currentState > 1) {
                    expect(quest_period.withdrawableAmount).not.to.be.eq(0)
                    expected_withdrawable_amount1 = expected_withdrawable_amount1.add(quest_period.withdrawableAmount)
                }
            }

            expected_withdrawable_amount_total = expected_withdrawable_amount0.add(expected_withdrawable_amount1)

            const old_board_balance = await rewardToken.balanceOf(board.address)
            const old_receiver_balance = await rewardToken.balanceOf(receiver.address)

            const withdraw_tx = await questor.connect(manager).withdrawUnusedRewardsMultiple(questIDs, receiver.address)

            await expect(
                withdraw_tx
            ).to.emit(board, "WithdrawUnusedRewards")
                .withArgs(questIDs[0], receiver.address, expected_withdrawable_amount0);

            await expect(
                withdraw_tx
            ).to.emit(board, "WithdrawUnusedRewards")
                .withArgs(questIDs[1], receiver.address, expected_withdrawable_amount1);

            await expect(
                withdraw_tx
            ).to.emit(rewardToken, "Transfer")
                .withArgs(board.address, receiver.address, expected_withdrawable_amount0);

            await expect(
                withdraw_tx
            ).to.emit(rewardToken, "Transfer")
                .withArgs(board.address, receiver.address, expected_withdrawable_amount1);

            const new_board_balance = await rewardToken.balanceOf(board.address)
            const new_receiver_balance = await rewardToken.balanceOf(receiver.address)

            expect(new_board_balance).to.be.eq(old_board_balance.sub(expected_withdrawable_amount_total))
            expect(new_receiver_balance).to.be.eq(old_receiver_balance.add(expected_withdrawable_amount_total))

            const new_quest_periods0 = await board.getAllQuestPeriodsForQuestId(questIDs[0])

            for (let i = 0; i < new_quest_periods0.length; i++) {
                let quest_period = new_quest_periods0[i]

                if (quest_period.currentState > 1) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
            }

            const new_quest_periods1 = await board.getAllQuestPeriodsForQuestId(questIDs[1])

            for (let i = 0; i < new_quest_periods1.length; i++) {
                let quest_period = new_quest_periods1[i]

                if (quest_period.currentState > 1) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
            }

        });

        it(' should fail if recipient is address 0x0', async () => {

            await expect(
                questor.connect(manager).withdrawUnusedRewards(questIDs[0], ethers.constants.AddressZero)
            ).to.be.revertedWith('ZeroAddress')
            
        });

        it(' should only be allowed for Manager & Governance', async () => {

            await expect(
                questor.connect(user1).withdrawUnusedRewards(questIDs[0], receiver.address)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                questor.connect(admin).withdrawUnusedRewards(questIDs[0], receiver.address)
            ).to.be.revertedWith('CallerNotAllowed')
            
        });

    });


    describe('changeDuration', async () => {

        let questID: BigNumber;

        const new_duration = 4

        const total_rewards_amount = target_votes.mul(reward_per_vote).mul(new_duration).div(UNIT)

        const rewards_per_period = target_votes.mul(reward_per_vote).div(UNIT)

        it(' should update the parameter correctly', async () => {

            const change_tx = await questor.connect(manager).changeDuration(new_duration)

            expect(await questor.duration()).to.be.eq(new_duration)

            await expect(change_tx).to.emit(questor, "DurationUpdated").withArgs(duration, new_duration);

        });

        it(' should create a Quest with the new parameter', async () => {

            await questor.connect(manager).changeDuration(new_duration)
            
            await rewardToken.connect(admin).transfer(questor.address, total_rewards_amount.mul(3))

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            const create_tx = await questor.connect(manager).createQuest()

            questID = (await board.nextID()).sub(1)

            await expect(
                create_tx
            ).to.emit(board, "NewQuest")
                .withArgs(
                    questID,
                    questor.address,
                    gauge1.address,
                    rewardToken.address,
                    new_duration,
                    expected_period,
                    target_votes,
                    reward_per_vote
                );
            
            expect(await questor.createdQuests(0)).to.be.eq(questID)

            const quest_data = await board.quests(questID)

            expect(quest_data.creator).to.be.eq(questor.address)
            expect(quest_data.rewardToken).to.be.eq(rewardToken.address)
            expect(quest_data.gauge).to.be.eq(gauge1.address)
            expect(quest_data.duration).to.be.eq(new_duration)
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount)
            expect(quest_data.periodStart).to.be.eq(expected_period)

            expect(await board.questDistributors(questID)).to.be.eq(distributor.address)

            const periods = await board.getAllPeriodsForQuestId(questID)
            expect(periods.length).to.be.eq(new_duration)

            for (let i = 0; i < new_duration; i++) {
                expect(periods[i]).to.be.eq(expected_period.add(WEEK.mul(i)).div(WEEK).mul(WEEK))
            }

            const ids_for_period = await board.getQuestIdsForPeriod(expected_period)
            expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questID)

            const quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            for (let i = 0; i < quest_periods.length; i++) {
                let quest_period = quest_periods[i]
                let expected_future_period = expected_period.add(WEEK.mul(i)).div(WEEK).mul(WEEK)

                expect(quest_period.periodStart).to.be.eq(expected_future_period)
                expect(quest_period.rewardAmountPerPeriod).to.be.eq(rewards_per_period)
                expect(quest_period.rewardPerVote).to.be.eq(reward_per_vote)
                expect(quest_period.objectiveVotes).to.be.eq(target_votes)
                expect(quest_period.rewardAmountDistributed).to.be.eq(0)
                expect(quest_period.withdrawableAmount).to.be.eq(0)

                expect(quest_period.currentState).to.be.eq(1) // => PeriodState.ACTIVE

                const ids_for_period = await board.getQuestIdsForPeriod(expected_future_period)
                expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questID)
            }

        });

        it(' should fail if given value is 0', async () => {

            await expect(
                questor.connect(manager).changeDuration(0)
            ).to.be.revertedWith('NullAmount')

        });

        it(' should only be allowed for Manager', async () => {

            await expect(
                questor.connect(user1).changeDuration(new_duration)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                questor.connect(governance).changeDuration(new_duration)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('changeObjective', async () => {

        let questID: BigNumber;

        const new_objective = ethers.utils.parseEther('200000')

        const total_rewards_amount = new_objective.mul(reward_per_vote).mul(duration).div(UNIT)

        const rewards_per_period = new_objective.mul(reward_per_vote).div(UNIT)

        it(' should update the parameter correctly', async () => {

            const change_tx = await questor.connect(manager).changeObjective(new_objective)

            expect(await questor.objective()).to.be.eq(new_objective)

            await expect(change_tx).to.emit(questor, "ObjectiveUpdated").withArgs(target_votes, new_objective);

        });

        it(' should create a Quest with the new parameter', async () => {

            await questor.connect(manager).changeObjective(new_objective)
            
            await rewardToken.connect(admin).transfer(questor.address, total_rewards_amount.mul(3))

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            const create_tx = await questor.connect(manager).createQuest()

            questID = (await board.nextID()).sub(1)

            await expect(
                create_tx
            ).to.emit(board, "NewQuest")
                .withArgs(
                    questID,
                    questor.address,
                    gauge1.address,
                    rewardToken.address,
                    duration,
                    expected_period,
                    new_objective,
                    reward_per_vote
                );
            
            expect(await questor.createdQuests(0)).to.be.eq(questID)

            const quest_data = await board.quests(questID)

            expect(quest_data.creator).to.be.eq(questor.address)
            expect(quest_data.rewardToken).to.be.eq(rewardToken.address)
            expect(quest_data.gauge).to.be.eq(gauge1.address)
            expect(quest_data.duration).to.be.eq(duration)
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount)
            expect(quest_data.periodStart).to.be.eq(expected_period)

            expect(await board.questDistributors(questID)).to.be.eq(distributor.address)

            const periods = await board.getAllPeriodsForQuestId(questID)
            expect(periods.length).to.be.eq(duration)

            for (let i = 0; i < duration; i++) {
                expect(periods[i]).to.be.eq(expected_period.add(WEEK.mul(i)).div(WEEK).mul(WEEK))
            }

            const ids_for_period = await board.getQuestIdsForPeriod(expected_period)
            expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questID)

            const quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            for (let i = 0; i < quest_periods.length; i++) {
                let quest_period = quest_periods[i]
                let expected_future_period = expected_period.add(WEEK.mul(i)).div(WEEK).mul(WEEK)

                expect(quest_period.periodStart).to.be.eq(expected_future_period)
                expect(quest_period.rewardAmountPerPeriod).to.be.eq(rewards_per_period)
                expect(quest_period.rewardPerVote).to.be.eq(reward_per_vote)
                expect(quest_period.objectiveVotes).to.be.eq(new_objective)
                expect(quest_period.rewardAmountDistributed).to.be.eq(0)
                expect(quest_period.withdrawableAmount).to.be.eq(0)

                expect(quest_period.currentState).to.be.eq(1) // => PeriodState.ACTIVE

                const ids_for_period = await board.getQuestIdsForPeriod(expected_future_period)
                expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questID)
            }

        });

        it(' should fail if given value is 0', async () => {

            await expect(
                questor.connect(manager).changeObjective(0)
            ).to.be.revertedWith('NullAmount')

        });

        it(' should only be allowed for Manager', async () => {

            await expect(
                questor.connect(user1).changeObjective(new_objective)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                questor.connect(governance).changeObjective(new_objective)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('changeRewardPerVote', async () => {

        let questID: BigNumber;

        const new_reward_per_vote = ethers.utils.parseEther('2')

        const total_rewards_amount = target_votes.mul(new_reward_per_vote).mul(duration).div(UNIT)

        const rewards_per_period = target_votes.mul(new_reward_per_vote).div(UNIT)

        it(' should update the parameter correctly', async () => {

            const change_tx = await questor.connect(manager).changeRewardPerVote(new_reward_per_vote)

            expect(await questor.rewardPerVote()).to.be.eq(new_reward_per_vote)

            await expect(change_tx).to.emit(questor, "RewardPerVoteUpdated").withArgs(reward_per_vote, new_reward_per_vote);

        });

        it(' should create a Quest with the new parameter', async () => {

            await questor.connect(manager).changeRewardPerVote(new_reward_per_vote)
            
            await rewardToken.connect(admin).transfer(questor.address, total_rewards_amount.mul(3))

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            const create_tx = await questor.connect(manager).createQuest()

            questID = (await board.nextID()).sub(1)

            await expect(
                create_tx
            ).to.emit(board, "NewQuest")
                .withArgs(
                    questID,
                    questor.address,
                    gauge1.address,
                    rewardToken.address,
                    duration,
                    expected_period,
                    target_votes,
                    new_reward_per_vote
                );
            
            expect(await questor.createdQuests(0)).to.be.eq(questID)

            const quest_data = await board.quests(questID)

            expect(quest_data.creator).to.be.eq(questor.address)
            expect(quest_data.rewardToken).to.be.eq(rewardToken.address)
            expect(quest_data.gauge).to.be.eq(gauge1.address)
            expect(quest_data.duration).to.be.eq(duration)
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount)
            expect(quest_data.periodStart).to.be.eq(expected_period)

            expect(await board.questDistributors(questID)).to.be.eq(distributor.address)

            const periods = await board.getAllPeriodsForQuestId(questID)
            expect(periods.length).to.be.eq(duration)

            for (let i = 0; i < duration; i++) {
                expect(periods[i]).to.be.eq(expected_period.add(WEEK.mul(i)).div(WEEK).mul(WEEK))
            }

            const ids_for_period = await board.getQuestIdsForPeriod(expected_period)
            expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questID)

            const quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            for (let i = 0; i < quest_periods.length; i++) {
                let quest_period = quest_periods[i]
                let expected_future_period = expected_period.add(WEEK.mul(i)).div(WEEK).mul(WEEK)

                expect(quest_period.periodStart).to.be.eq(expected_future_period)
                expect(quest_period.rewardAmountPerPeriod).to.be.eq(rewards_per_period)
                expect(quest_period.rewardPerVote).to.be.eq(new_reward_per_vote)
                expect(quest_period.objectiveVotes).to.be.eq(target_votes)
                expect(quest_period.rewardAmountDistributed).to.be.eq(0)
                expect(quest_period.withdrawableAmount).to.be.eq(0)

                expect(quest_period.currentState).to.be.eq(1) // => PeriodState.ACTIVE

                const ids_for_period = await board.getQuestIdsForPeriod(expected_future_period)
                expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questID)
            }

        });

        it(' should fail if given value is 0', async () => {

            await expect(
                questor.connect(manager).changeRewardPerVote(0)
            ).to.be.revertedWith('NullAmount')

        });

        it(' should only be allowed for Manager', async () => {

            await expect(
                questor.connect(user1).changeRewardPerVote(new_reward_per_vote)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                questor.connect(governance).changeRewardPerVote(new_reward_per_vote)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('emergencyWithdraw', async () => {

        const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
        const mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"

        let gauges: string[] = []

        let questIDs: BigNumber[] = [];

        const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000'), ethers.utils.parseEther('12000')]
        const gauge2_biases = [ethers.utils.parseEther('12000'), ethers.utils.parseEther('15000'), ethers.utils.parseEther('18000')]

        let first_period: BigNumber;

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address]

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            const total_rewards_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)

            await rewardToken.connect(admin).transfer(questor.address, total_rewards_amount.mul(3))

            await questor.connect(manager).addVoterBlacklist(voter1.address)
            await questor.connect(manager).addVoterBlacklist(voter2.address)

            await questor.connect(manager).createQuest()

            questIDs.push(await questor.createdQuests(0))

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            await controller.set_user_vote(voter1.address, gauge1.address, first_period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter1.address, gauge2.address, first_period, ethers.utils.parseEther('400'), current_ts.add(WEEK.mul(182)))

            await controller.set_user_vote(voter2.address, gauge2.address, first_period, ethers.utils.parseEther('250'), current_ts.add(WEEK.mul(150)))

            await controller.set_user_vote(voter3.address, gauge1.address, first_period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge2.address, first_period, ethers.utils.parseEther('520'), current_ts.add(WEEK.mul(195)))

            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
            }

            await advanceTime(WEEK.mul(3).toNumber())

            await board.connect(admin).closeQuestPeriod(first_period)

            const next_period = first_period.add(WEEK).div(WEEK).mul(WEEK)

            await board.connect(admin).closeQuestPeriod(next_period)

            const period_rewards1 = (await board.periodsByQuest(questIDs[0], first_period)).rewardAmountDistributed
            const period_rewards2 = (await board.periodsByQuest(questIDs[0], next_period)).rewardAmountDistributed

            await board.connect(admin).addMerkleRoot(questIDs[0], first_period, period_rewards1, mockRoot)
            await board.connect(admin).addMerkleRoot(questIDs[0], next_period, period_rewards2, mockRoot2)

        });

        it(' should send back the undistributed tokens & future periods tokens correctly', async () => {

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[0])

            let expected_withdrawable_amount = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods.length; i++) {
                let quest_period = old_quest_periods[i]

                if (quest_period.currentState > 1) {
                    expect(quest_period.withdrawableAmount).not.to.be.eq(0)
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.withdrawableAmount)
                }
                else {
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.rewardAmountPerPeriod)
                }
            }

            const old_board_balance = await rewardToken.balanceOf(board.address)
            const old_receiver_balance = await rewardToken.balanceOf(receiver.address)


            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            const withdraw_tx = await questor.connect(manager).emergencyWithdraw(questIDs[0], receiver.address)

            await expect(
                withdraw_tx
            ).to.emit(board, "EmergencyWithdraw")
                .withArgs(questIDs[0], receiver.address, expected_withdrawable_amount);

            await expect(
                withdraw_tx
            ).to.emit(rewardToken, "Transfer")
                .withArgs(board.address, receiver.address, expected_withdrawable_amount);

            const new_board_balance = await rewardToken.balanceOf(board.address)
            const new_receiver_balance = await rewardToken.balanceOf(receiver.address)

            expect(new_board_balance).to.be.eq(old_board_balance.sub(expected_withdrawable_amount))
            expect(new_receiver_balance).to.be.eq(old_receiver_balance.add(expected_withdrawable_amount))

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[0])

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                if (quest_period.currentState > 1) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
                else {
                    expect(quest_period.rewardAmountPerPeriod).to.be.eq(0) //Should have been set to 0
                }
            }

        });

        it(' should only allow the Manager & Governance to call', async () => {

            await expect(
                questor.connect(user2).emergencyWithdraw(questIDs[0], receiver.address)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('retrieveRewards', async () => {

        let tree: BalanceTree

        let quest_id: BigNumber
        let period: BigNumber

        const wrapper_claim_amount = ethers.utils.parseEther('105')

        beforeEach(async () => {

            const total_rewards_amount = target_votes.mul(reward_per_vote).mul(duration).div(UNIT)

            await rewardToken.connect(admin).transfer(questor.address, total_rewards_amount.mul(3))

            quest_id = await board.nextID()
            period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            await questor.connect(manager).addVoterBlacklist(voter1.address)
            await questor.connect(manager).addVoterBlacklist(voter2.address)

            await questor.connect(manager).createQuest()
            await advanceTime(WEEK.mul(2).toNumber())
            
            let period_end_to_set = period.add(WEEK).div(WEEK).mul(WEEK)

            await controller.set_points_weight(gauge1.address, period_end_to_set, ethers.utils.parseEther('8000'))

            await board.connect(admin).closeQuestPeriod(period)

            tree = new BalanceTree([
                { account: user1.address, amount: ethers.utils.parseEther('30'), questID: quest_id, period: period },
                { account: user2.address, amount: ethers.utils.parseEther('45'), questID: quest_id, period: period },
                { account: questor.address, amount: wrapper_claim_amount, questID: quest_id, period: period },
            ]);

            const period_rewards1 = (await board.periodsByQuest(quest_id, period)).rewardAmountDistributed

            await board.connect(admin).addMerkleRoot(quest_id, period, period_rewards1, tree.getHexRoot())

        });

        it(' should allow Quest creator to claim back any rewards assigned to the Wrapper contract', async () => {

            let proof = tree.getProof(quest_id, period, 2, questor.address, wrapper_claim_amount);

            expect(await distributor.isClaimed(quest_id, period, 2)).to.be.false
    
            let old_balance = await rewardToken.balanceOf(governance.address)
    
            await expect(
                questor.connect(governance).retrieveRewards(
                    distributor.address,
                    governance.address,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.emit(distributor, "Claimed")
                .withArgs(quest_id, period, 2, wrapper_claim_amount, rewardToken.address, questor.address);
    
            let new_balance = await rewardToken.balanceOf(governance.address)
    
            expect(new_balance.sub(old_balance)).to.be.eq(wrapper_claim_amount)
    
            expect(await distributor.isClaimed(quest_id, period, 2)).to.be.true

        });

        it(' should only allow Manager & Governance', async () => {

            let proof = tree.getProof(quest_id, period, 2, questor.address, wrapper_claim_amount);

            await expect(
                questor.connect(user1).retrieveRewards(
                    distributor.address,
                    governance.address,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                questor.connect(admin).retrieveRewards(
                    distributor.address,
                    governance.address,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.revertedWith('CallerNotAllowed')

        });

        it(' should fail if given incorrect Distributor address', async () => {

            let proof = tree.getProof(quest_id, period, 2, questor.address, wrapper_claim_amount);

            await expect(
                questor.connect(governance).retrieveRewards(
                    ethers.constants.AddressZero,
                    governance.address,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                questor.connect(governance).retrieveRewards(
                    distributor.address,
                    ethers.constants.AddressZero,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                questor.connect(governance).retrieveRewards(
                    receiver.address,
                    governance.address,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.reverted
        });

        it(' should fail if given incorrect parameters or proofs', async () => {

            let proof = tree.getProof(quest_id, period, 2, questor.address, wrapper_claim_amount);

            await expect(
                questor.connect(governance).retrieveRewards(
                    distributor.address,
                    governance.address,
                    112,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.reverted

            await expect(
                questor.connect(governance).retrieveRewards(
                    distributor.address,
                    governance.address,
                    quest_id,
                    period.add(WEEK),
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.reverted

            await expect(
                questor.connect(governance).retrieveRewards(
                    distributor.address,
                    governance.address,
                    quest_id,
                    period,
                    0,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.reverted

            await expect(
                questor.connect(governance).retrieveRewards(
                    distributor.address,
                    governance.address,
                    quest_id,
                    period,
                    2,
                    ethers.utils.parseEther('45'),
                    proof
                )
            ).to.be.reverted

            await expect(
                questor.connect(governance).retrieveRewards(
                    distributor.address,
                    distributor.address,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    []
                )
            ).to.be.reverted

        });

    });


    describe('execute', async () => {

        let uselessFactory: ContractFactory

        let useless: Useless

        let call_data: string

        beforeEach(async () => {
    
            const function_ABI = ["function setValue(uint256 _value)"]
            const args = [12]

            await rewardToken.connect(admin).transfer(chest.address, ethers.utils.parseEther('1500'))

            uselessFactory = await ethers.getContractFactory("Useless");

            useless = (await uselessFactory.connect(admin).deploy()) as Useless;
            await useless.deployed();

            const iface = new ethers.utils.Interface(function_ABI)

            call_data = iface.encodeFunctionData("setValue", args)

        });

        it(' should execute the call correctly', async () => {

            await questor.connect(governance).execute(
                useless.address,
                0,
                call_data
            )

            expect(await useless.called()).to.be.true
            expect(await useless.value()).to.be.eq(12)

        });

        it(' should block if caller not allowed', async () => {

            await expect(
                questor.connect(user1).execute(
                    useless.address,
                    0,
                    call_data
                )
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('recoverERC20', async () => {

        const lost_amount = ethers.utils.parseEther('1000');

        beforeEach(async () => {

            await rewardToken.connect(admin).transfer(questor.address, lost_amount)

        });


        it(' should retrieve the lost tokens and send it to the admin', async () => {

            const oldBalance = await rewardToken.balanceOf(admin.address);

            await questor.connect(governance).recoverERC20(rewardToken.address, admin.address)

            const newBalance = await rewardToken.balanceOf(admin.address);

            expect(newBalance.sub(oldBalance)).to.be.eq(lost_amount)

        });

        it(' should block non-admin caller', async () => {

            await expect(
                questor.connect(user2).recoverERC20(rewardToken.address, admin.address)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('kill', async () => {

        it(' should block from creating new Quests', async () => {

            await questor.connect(governance).kill()

            await expect(
                questor.connect(manager).createQuest()
            ).to.be.revertedWith('Killed')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                questor.connect(manager).kill()
            ).to.be.revertedWith('CallerNotAllowed()')

            await expect(
                questor.connect(user3).kill()
            ).to.be.revertedWith('CallerNotAllowed()')

        });

    });


});