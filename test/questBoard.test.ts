const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { QuestBoard } from "../typechain/QuestBoard";
import { MultiMerkleDistributor } from "../typechain/MultiMerkleDistributor";
import { MockGaugeController } from "../typechain/MockGaugeController";
import { IERC20 } from "../typechain/IERC20";
import { IERC20__factory } from "../typechain/factories/IERC20__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import {
    advanceTime,
    getERC20,
} from "./utils/utils";

const { TOKEN1_ADDRESS, BIG_HOLDER1, TOKEN2_ADDRESS, BIG_HOLDER2 } = require("./utils/constant");


chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;

let boardFactory: ContractFactory
let distributorFactory: ContractFactory
let controllerFactory: ContractFactory

const WEEK = BigNumber.from(86400 * 7)
const UNIT = ethers.utils.parseEther('1')

describe('QuestBoard contract tests', () => {
    let admin: SignerWithAddress

    let mockChest: SignerWithAddress

    let gauge1: SignerWithAddress
    let gauge2: SignerWithAddress
    let gauge3: SignerWithAddress

    let manager: SignerWithAddress
    let manager2: SignerWithAddress

    let creator1: SignerWithAddress
    let creator2: SignerWithAddress
    let creator3: SignerWithAddress

    let user1: SignerWithAddress
    let user2: SignerWithAddress

    let receiver: SignerWithAddress

    let newChest: SignerWithAddress
    let newDistributor: SignerWithAddress

    let otherAddress: SignerWithAddress

    let board: QuestBoard
    let distributor: MultiMerkleDistributor
    let controller: MockGaugeController

    let CRV: IERC20
    let DAI: IERC20

    before(async () => {
        [admin, mockChest, manager, manager2, creator1, creator2, creator3, gauge1, gauge2, gauge3, user1, user2, receiver, newChest, newDistributor, otherAddress] = await ethers.getSigners();

        boardFactory = await ethers.getContractFactory("QuestBoard");

        distributorFactory = await ethers.getContractFactory("MultiMerkleDistributor");

        controllerFactory = await ethers.getContractFactory("MockGaugeController");

        const crv_amount = ethers.utils.parseEther('75000000');
        const dai_amount = ethers.utils.parseEther('840000000');

        CRV = IERC20__factory.connect(TOKEN1_ADDRESS, provider);
        DAI = IERC20__factory.connect(TOKEN2_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER1, CRV, admin.address, crv_amount);

        await getERC20(admin, BIG_HOLDER2, DAI, admin.address, dai_amount);

    })

    beforeEach(async () => {

        controller = (await controllerFactory.connect(admin).deploy()) as MockGaugeController;
        await controller.deployed();

        board = (await boardFactory.connect(admin).deploy(controller.address, mockChest.address)) as QuestBoard;
        await board.deployed();

        distributor = (await distributorFactory.connect(admin).deploy(board.address)) as MultiMerkleDistributor;
        await distributor.deployed();

    });

    it(' should be deployed & have correct parameters', async () => {
        expect(board.address).to.properAddress

        expect(await board.GAUGE_CONTROLLER()).to.be.eq(controller.address)
        expect(await board.questChest()).to.be.eq(mockChest.address)

        expect(await board.nextID()).to.be.eq(0)

        expect(await board.platformFee()).to.be.eq(500)

        expect(await board.minObjective()).to.be.eq(ethers.utils.parseEther('1000'))

        expect(await board.distributor()).to.be.eq(ethers.constants.AddressZero)

        const block_number = await provider.getBlockNumber()
        const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)
        const expected_period = current_ts.div(WEEK).mul(WEEK)

        expect(await board.currentPeriod()).to.be.eq(expected_period)

        expect(await board.isKilled()).to.be.false
        expect(await board.kill_ts()).to.be.eq(0)

        expect(await board.whitelistedTokens(CRV.address)).to.be.false
        expect(await board.whitelistedTokens(DAI.address)).to.be.false

        expect(await board.whitelistedTokens(otherAddress.address)).to.be.false

    });

    describe('updatePeriod', async () => {


        it(' should update the period correctly', async () => {

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)
            const expected_period = current_ts.div(WEEK).mul(WEEK)

            expect(await board.currentPeriod()).to.be.eq(expected_period)

            await advanceTime(WEEK.toNumber())

            const next_expected_period = expected_period.add(WEEK).div(WEEK).mul(WEEK)

            await board.updatePeriod()

            expect(await board.currentPeriod()).to.be.eq(next_expected_period)

        });

        it(' should update the period correctly after multiple missed periods', async () => {

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)
            const expected_period = current_ts.div(WEEK).mul(WEEK)

            expect(await board.currentPeriod()).to.be.eq(expected_period)

            await advanceTime(WEEK.mul(3).toNumber())

            const next_expected_period = expected_period.add(WEEK.mul(3)).div(WEEK).mul(WEEK)

            await board.updatePeriod()

            expect(await board.currentPeriod()).to.be.eq(next_expected_period)

        });

    });


    describe('initiateDistributor', async () => {

        it(' should set the correct distributor address', async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            expect(await board.distributor()).to.be.eq(distributor.address)

        });

        it(' should only be initiated once', async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await expect(
                board.connect(admin).initiateDistributor(distributor.address)
            ).to.be.revertedWith('QuestBoard: Already initialized')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                board.connect(user2).recoverERC20(DAI.address, ethers.utils.parseEther('10'))
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('createQuest', async () => {

        const target_votes = ethers.utils.parseEther('150000')
        const reward_per_vote = ethers.utils.parseEther('6')

        const rewards_per_period = ethers.utils.parseEther('900000')

        const duration = 4

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(500).div(10000)

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).whitelistToken(DAI.address)

            await controller.add_gauge(gauge1.address, 2)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))

        });

        it(' should update the period', async () => {

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            await advanceTime(WEEK.toNumber())

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees
            )

            expect(await board.currentPeriod()).to.be.eq(expected_period)

        });

        it(' should create the Quest with correct data (& emit the correct Event)', async () => {

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            const expected_id = await board.nextID()

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            const create_tx = await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees
            )

            await expect(
                create_tx
            ).to.emit(board, "NewQuest")
                .withArgs(
                    expected_id,
                    creator1.address,
                    gauge1.address,
                    DAI.address,
                    duration,
                    expected_period,
                    target_votes,
                    reward_per_vote
                );

            expect(await board.nextID()).to.be.eq(expected_id.add(1))

            const quest_data = await board.quests(expected_id)

            expect(quest_data.creator).to.be.eq(creator1.address)
            expect(quest_data.rewardToken).to.be.eq(DAI.address)
            expect(quest_data.gauge).to.be.eq(gauge1.address)
            expect(quest_data.duration).to.be.eq(duration)
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount)
            expect(quest_data.periodStart).to.be.eq(expected_period)


            const quest_periods = await board.getAllPeriodsForQuestId(expected_id)
            expect(quest_periods.length).to.be.eq(duration)

            for (let i = 0; i < duration; i++) {
                expect(quest_periods[i]).to.be.eq(expected_period.add(WEEK.mul(i)).div(WEEK).mul(WEEK))
            }

            const ids_for_period = await board.getQuestIdsForPeriod(expected_period)
            expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(expected_id)

        });

        it(' should create a QuestPeriod for all periods of the Quest', async () => {

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            const expected_id = await board.nextID()

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees
            )

            const quest_periods = await board.getAllQuestPeriodsForQuestId(expected_id)

            for (let i = 0; i < quest_periods.length; i++) {
                let quest_period = quest_periods[i]
                let expected_future_period = expected_period.add(WEEK.mul(i)).div(WEEK).mul(WEEK)

                expect(quest_period.periodStart).to.be.eq(expected_future_period)
                expect(quest_period.rewardAmountPerPeriod).to.be.eq(rewards_per_period)
                expect(quest_period.rewardPerVote).to.be.eq(reward_per_vote)
                expect(quest_period.objectiveVotes).to.be.eq(target_votes)
                expect(quest_period.rewardAmountDistributed).to.be.eq(0)
                expect(quest_period.withdrawableAmount).to.be.eq(0)

                expect(quest_period.currentState).to.be.eq(0) // => PeriodState.ACTIVE

                const ids_for_period = await board.getQuestIdsForPeriod(expected_future_period)
                expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(expected_id)
            }

        });

        it(' should do the transfer correctly', async () => {

            const old_board_balance = await DAI.balanceOf(board.address)
            const old_chest_balance = await DAI.balanceOf(mockChest.address)

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            const create_tx = await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees
            )

            await expect(
                create_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, board.address, total_rewards_amount);

            await expect(
                create_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, mockChest.address, total_fees);

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_chest_balance = await DAI.balanceOf(mockChest.address)

            expect(new_board_balance).to.be.eq(old_board_balance.add(total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(total_fees))

        });

        it(' should add the Quest to the Distributor', async () => {

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            const expected_id = await board.nextID()

            const create_tx = await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees
            )

            await expect(
                create_tx
            ).to.emit(distributor, "NewQuest")
                .withArgs(expected_id, DAI.address);

            expect(await distributor.questRewardToken(expected_id)).to.be.eq(DAI.address)

        });

        it(' should allow to create other quests', async () => {

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees
            )

            const target_votes2 = ethers.utils.parseEther('1000000')
            const reward_per_vote2 = ethers.utils.parseEther('0.5')

            const rewards_per_period2 = ethers.utils.parseEther('500000')

            const duration2 = 4

            const total_rewards_amount2 = rewards_per_period2.mul(duration2)
            const total_fees2 = total_rewards_amount2.mul(500).div(10000)


            await board.connect(admin).whitelistToken(CRV.address)

            await controller.add_gauge(gauge2.address, 1)

            await CRV.connect(admin).transfer(creator2.address, total_rewards_amount2.add(total_fees2))


            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            const expected_id = await board.nextID()

            await CRV.connect(creator2).approve(board.address, total_rewards_amount2.add(total_fees2))

            const create_tx2 = await board.connect(creator2).createQuest(
                gauge2.address,
                CRV.address,
                duration2,
                target_votes2,
                reward_per_vote2,
                total_rewards_amount2,
                total_fees2
            )

            await expect(
                create_tx2
            ).to.emit(board, "NewQuest")
                .withArgs(
                    expected_id,
                    creator2.address,
                    gauge2.address,
                    CRV.address,
                    duration2,
                    expected_period,
                    target_votes2,
                    reward_per_vote2
                );

            const quest_data = await board.quests(expected_id)

            expect(quest_data.creator).to.be.eq(creator2.address)
            expect(quest_data.rewardToken).to.be.eq(CRV.address)
            expect(quest_data.gauge).to.be.eq(gauge2.address)
            expect(quest_data.duration).to.be.eq(duration2)
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount2)
            expect(quest_data.periodStart).to.be.eq(expected_period)


            const quest_periods = await board.getAllPeriodsForQuestId(expected_id)
            expect(quest_periods.length).to.be.eq(duration2)

        });

        it(' should fail if no distributor set', async () => {

            let otherBoard = (await boardFactory.connect(admin).deploy(controller.address, mockChest.address)) as QuestBoard;
            await otherBoard.deployed();

            await otherBoard.connect(admin).whitelistToken(DAI.address)

            await otherBoard.connect(admin).whitelistToken(DAI.address)

            await controller.add_gauge(gauge1.address, 2)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))
            await DAI.connect(creator1).approve(otherBoard.address, total_rewards_amount.add(total_fees))

            await expect(
                otherBoard.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: no Distributor set')

        });

        it(' should fail if given incorrect parameters', async () => {

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            await expect(
                board.connect(creator1).createQuest(
                    ethers.constants.AddressZero,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: Zero Address')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    ethers.constants.AddressZero,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: Zero Address')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    0,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: Incorrect duration')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    ethers.utils.parseEther('50'),
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: Objective too low')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    0,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: Objective too low')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    0,
                    total_rewards_amount,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: Null amount')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    0,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: Null amount')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    0
                )
            ).to.be.revertedWith('QuestBoard: Null amount')

        });

        it(' should fail if the token is not whitelisted', async () => {

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    CRV.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: Token not allowed')

        });

        it(' should fail if the given gauge is incorrect', async () => {

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            await expect(
                board.connect(creator1).createQuest(
                    gauge3.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: Invalid Gauge')

        });

        it(' should fail if given amounts (rewards or fees) are incorrect', async () => {

            const wrong_total_rewards_amount = ethers.utils.parseEther('800000').mul(duration)
            const wrong_total_fees = total_rewards_amount.mul(400).div(10000)

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    wrong_total_rewards_amount,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: totalRewardAmount incorrect')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    wrong_total_fees
                )
            ).to.be.revertedWith('QuestBoard: feeAmount incorrect')

        });

    });


    describe('increaseQuestDuration', async () => {

        const target_votes = ethers.utils.parseEther('150000')
        const reward_per_vote = ethers.utils.parseEther('0.3')

        const rewards_per_period = ethers.utils.parseEther('45000')

        const duration = 4

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(500).div(10000)

        const extend_duration = 3
        const added_total_rewards_amount = rewards_per_period.mul(extend_duration)
        const added_total_fees = added_total_rewards_amount.mul(500).div(10000)

        let questID: BigNumber;

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).whitelistToken(DAI.address)

            await controller.add_gauge(gauge1.address, 2)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))
            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            questID = await board.nextID()

            await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees
            )

            await DAI.connect(admin).transfer(creator1.address, added_total_rewards_amount.add(added_total_fees))

        });

        it(' should add the new QuestPeriods after the last one (& emit the correct Event)', async () => {

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            const old_periods_length = (await board.getAllPeriodsForQuestId(questID)).length
            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            const increase_tx = await board.connect(creator1).increaseQuestDuration(
                questID,
                extend_duration,
                added_total_rewards_amount,
                added_total_fees
            )

            await expect(
                increase_tx
            ).to.emit(board, "IncreasedQuestDuration")
                .withArgs(
                    questID,
                    extend_duration,
                    added_total_rewards_amount
                );

            const new_periods_length = (await board.getAllPeriodsForQuestId(questID)).length

            expect(new_periods_length).to.be.eq(old_periods_length + extend_duration)

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            const last_old_period = old_quest_periods[old_periods_length - 1]

            for (let i = old_periods_length; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]
                let expected_future_period = BigNumber.from(last_old_period.periodStart).add(WEEK.mul(i - old_periods_length + 1)).div(WEEK).mul(WEEK)

                expect(quest_period.periodStart).to.be.eq(expected_future_period)
                expect(quest_period.rewardAmountPerPeriod).to.be.eq(last_old_period.rewardAmountPerPeriod)
                expect(quest_period.rewardPerVote).to.be.eq(last_old_period.rewardPerVote)
                expect(quest_period.objectiveVotes).to.be.eq(last_old_period.objectiveVotes)
                expect(quest_period.rewardAmountDistributed).to.be.eq(0)
                expect(quest_period.withdrawableAmount).to.be.eq(0)

                expect(quest_period.currentState).to.be.eq(0) // => PeriodState.ACTIVE

                const ids_for_period = await board.getQuestIdsForPeriod(expected_future_period)
                expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questID)
            }

        });

        it(' should not change the other QuestPeriods', async () => {

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            const old_periods_length = (await board.getAllPeriodsForQuestId(questID)).length
            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            await board.connect(creator1).increaseQuestDuration(
                questID,
                extend_duration,
                added_total_rewards_amount,
                added_total_fees
            )

            const new_periods_length = (await board.getAllPeriodsForQuestId(questID)).length

            expect(new_periods_length).to.be.eq(old_periods_length + extend_duration)

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            for (let i = 0; i < old_periods_length; i++) {
                let old_quest_period = old_quest_periods[i]
                let new_quest_period = new_quest_periods[i]

                expect(new_quest_period.periodStart).to.be.eq(old_quest_period.periodStart)
                expect(new_quest_period.rewardAmountPerPeriod).to.be.eq(old_quest_period.rewardAmountPerPeriod)
                expect(new_quest_period.rewardPerVote).to.be.eq(old_quest_period.rewardPerVote)
                expect(new_quest_period.objectiveVotes).to.be.eq(old_quest_period.objectiveVotes)
                expect(new_quest_period.rewardAmountDistributed).to.be.eq(old_quest_period.rewardAmountDistributed)
                expect(new_quest_period.withdrawableAmount).to.be.eq(old_quest_period.withdrawableAmount)
                expect(new_quest_period.currentState).to.be.eq(old_quest_period.currentState)
            }

        });

        it(' should do the correct transfers', async () => {

            const old_board_balance = await DAI.balanceOf(board.address)
            const old_chest_balance = await DAI.balanceOf(mockChest.address)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            const increase_tx = await board.connect(creator1).increaseQuestDuration(
                questID,
                extend_duration,
                added_total_rewards_amount,
                added_total_fees
            )

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, board.address, added_total_rewards_amount);

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, mockChest.address, added_total_fees);

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_chest_balance = await DAI.balanceOf(mockChest.address)

            expect(new_board_balance).to.be.eq(old_board_balance.add(added_total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(added_total_fees))

        });

        it(' should not change previous QuestPeriod (CLOSED or DISTRIBUTED)', async () => {

            await advanceTime(WEEK.mul(3).toNumber())

            const periods_list = await board.getAllPeriodsForQuestId(questID)

            const first_period = periods_list[0]
            const second_period = periods_list[1]

            await board.connect(admin).closeQuestPeriod(first_period)
            await board.connect(admin).closeQuestPeriod(second_period)

            const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
            await board.connect(admin).addMerkleRoot(questID, first_period, mockRoot)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            const old_periods_length = (await board.getAllPeriodsForQuestId(questID)).length
            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            await board.connect(creator1).increaseQuestDuration(
                questID,
                extend_duration,
                added_total_rewards_amount,
                added_total_fees
            )

            const new_periods_length = (await board.getAllPeriodsForQuestId(questID)).length

            expect(new_periods_length).to.be.eq(old_periods_length + extend_duration)

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            for (let i = 0; i < old_periods_length; i++) {
                let old_quest_period = old_quest_periods[i]
                let new_quest_period = new_quest_periods[i]

                expect(new_quest_period.periodStart).to.be.eq(old_quest_period.periodStart)
                expect(new_quest_period.rewardAmountPerPeriod).to.be.eq(old_quest_period.rewardAmountPerPeriod)
                expect(new_quest_period.rewardPerVote).to.be.eq(old_quest_period.rewardPerVote)
                expect(new_quest_period.objectiveVotes).to.be.eq(old_quest_period.objectiveVotes)
                expect(new_quest_period.rewardAmountDistributed).to.be.eq(old_quest_period.rewardAmountDistributed)
                expect(new_quest_period.withdrawableAmount).to.be.eq(old_quest_period.withdrawableAmount)
                expect(new_quest_period.currentState).to.be.eq(old_quest_period.currentState)
            }

        });

        it(' should fail if the quest does not exist', async () => {

            const wrong_ID = questID.add(12)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    wrong_ID,
                    extend_duration,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Non valid ID')

        });

        it(' should fail if not Quest creator', async () => {

            await DAI.connect(creator2).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await expect(
                board.connect(creator2).increaseQuestDuration(
                    questID,
                    extend_duration,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Not allowed')

        });

        it(' should fail if given incorrect parameters', async () => {

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    questID,
                    0,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Incorrect addedDuration')

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    questID,
                    extend_duration,
                    0,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Null amount')

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    questID,
                    extend_duration,
                    added_total_rewards_amount,
                    0
                )
            ).to.be.revertedWith('QuestBoard: Null amount')

        });

        it(' should fail if given amounts (rewards or fees) are incorrect', async () => {

            const wrong_total_rewards_amount = ethers.utils.parseEther('40000').mul(extend_duration)
            const wrong_total_fees = added_total_rewards_amount.mul(400).div(10000)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    questID,
                    extend_duration,
                    wrong_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: addedRewardAmount incorrect')

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    questID,
                    extend_duration,
                    added_total_rewards_amount,
                    wrong_total_fees
                )
            ).to.be.revertedWith('QuestBoard: feeAmount incorrect')

        });

    });


    describe('increaseQuestReward', async () => {

        const target_votes = ethers.utils.parseEther('150000')
        const reward_per_vote = ethers.utils.parseEther('0.3')

        const rewards_per_period = ethers.utils.parseEther('45000')

        const duration = 6
        const ellapsedDuration = 3
        const remainingDuration = duration - ellapsedDuration

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(500).div(10000)

        const new_reward_per_vote = ethers.utils.parseEther('0.6')
        const new_rewards_per_period = ethers.utils.parseEther('90000')
        const added_total_rewards_amount = new_rewards_per_period.sub(rewards_per_period).mul(remainingDuration)
        const added_total_fees = added_total_rewards_amount.mul(500).div(10000)

        let questID: BigNumber;

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).whitelistToken(DAI.address)

            await controller.add_gauge(gauge1.address, 2)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))
            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            questID = await board.nextID()

            await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees
            )

            await DAI.connect(admin).transfer(creator1.address, added_total_rewards_amount.add(added_total_fees))

        });

        it(' should update the upcoming Periods & not change past and current period (& emit the correct Event)', async () => {

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const old_periods_length = (await board.getAllPeriodsForQuestId(questID)).length
            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            const increase_tx = await board.connect(creator1).increaseQuestReward(
                questID,
                new_reward_per_vote,
                added_total_rewards_amount,
                added_total_fees
            )

            const current_period = await board.currentPeriod()
            const applied_period = current_period.add(WEEK).div(WEEK).mul(WEEK)

            await expect(
                increase_tx
            ).to.emit(board, "IncreasedQuestReward")
                .withArgs(
                    questID,
                    applied_period,
                    new_reward_per_vote,
                    added_total_rewards_amount
                );

            const new_periods_length = (await board.getAllPeriodsForQuestId(questID)).length

            expect(new_periods_length).to.be.eq(old_periods_length)

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            const quest_data = await board.quests(questID)
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount.add(added_total_rewards_amount))

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                let old_quest_period = old_quest_periods[i]

                if (BigNumber.from(quest_period.periodStart).lte(current_period)) {
                    //Past & current should stay the same
                    expect(quest_period.periodStart).to.be.eq(old_quest_period.periodStart)
                    expect(quest_period.rewardAmountPerPeriod).to.be.eq(old_quest_period.rewardAmountPerPeriod)
                    expect(quest_period.rewardPerVote).to.be.eq(old_quest_period.rewardPerVote)
                    expect(quest_period.objectiveVotes).to.be.eq(old_quest_period.objectiveVotes)
                    expect(quest_period.rewardAmountDistributed).to.be.eq(old_quest_period.rewardAmountDistributed)
                    expect(quest_period.withdrawableAmount).to.be.eq(old_quest_period.withdrawableAmount)
                    expect(quest_period.currentState).to.be.eq(old_quest_period.currentState)
                } else {
                    expect(quest_period.periodStart).to.be.eq(old_quest_period.periodStart)

                    expect(quest_period.rewardAmountPerPeriod).to.be.eq(new_rewards_per_period)
                    expect(quest_period.rewardPerVote).to.be.eq(new_reward_per_vote)

                    expect(quest_period.objectiveVotes).to.be.eq(old_quest_period.objectiveVotes)
                    expect(quest_period.rewardAmountDistributed).to.be.eq(old_quest_period.rewardAmountDistributed)
                    expect(quest_period.withdrawableAmount).to.be.eq(old_quest_period.withdrawableAmount)
                    expect(quest_period.currentState).to.be.eq(old_quest_period.currentState)
                }
            }

        });

        it(' should do the correct transfers', async () => {

            const old_board_balance = await DAI.balanceOf(board.address)
            const old_chest_balance = await DAI.balanceOf(mockChest.address)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const increase_tx = await board.connect(creator1).increaseQuestReward(
                questID,
                new_reward_per_vote,
                added_total_rewards_amount,
                added_total_fees
            )

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, board.address, added_total_rewards_amount);

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, mockChest.address, added_total_fees);

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_chest_balance = await DAI.balanceOf(mockChest.address)

            expect(new_board_balance).to.be.eq(old_board_balance.add(added_total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(added_total_fees))

        });

        it(' should not change previous QuestPeriod (CLOSED or DISTRIBUTED)', async () => {

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const periods_list = await board.getAllPeriodsForQuestId(questID)

            const first_period = periods_list[0]
            const second_period = periods_list[1]

            await board.connect(admin).closeQuestPeriod(first_period)
            await board.connect(admin).closeQuestPeriod(second_period)

            const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
            await board.connect(admin).addMerkleRoot(questID, first_period, mockRoot)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            await board.connect(creator1).increaseQuestReward(
                questID,
                new_reward_per_vote,
                added_total_rewards_amount,
                added_total_fees
            )

            const current_period = await board.currentPeriod()

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                let old_quest_period = old_quest_periods[i]

                if (BigNumber.from(quest_period.periodStart).lte(current_period)) {
                    //Past & current should stay the same
                    expect(quest_period.periodStart).to.be.eq(old_quest_period.periodStart)
                    expect(quest_period.rewardAmountPerPeriod).to.be.eq(old_quest_period.rewardAmountPerPeriod)
                    expect(quest_period.rewardPerVote).to.be.eq(old_quest_period.rewardPerVote)
                    expect(quest_period.objectiveVotes).to.be.eq(old_quest_period.objectiveVotes)
                    expect(quest_period.rewardAmountDistributed).to.be.eq(old_quest_period.rewardAmountDistributed)
                    expect(quest_period.withdrawableAmount).to.be.eq(old_quest_period.withdrawableAmount)
                    expect(quest_period.currentState).to.be.eq(old_quest_period.currentState)
                }
            }

        });

        it(' should fail if new reward per SlopePoint is less than current one', async () => {

            const lower_reward_per_vote = reward_per_vote.div(2)
            const lower_total_rewards_amount = rewards_per_period.div(2).mul(remainingDuration)
            const lower_total_fees = lower_total_rewards_amount.mul(500).div(10000)

            await DAI.connect(creator1).approve(board.address, lower_total_rewards_amount.add(lower_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            await expect(
                board.connect(creator1).increaseQuestReward(
                    questID,
                    lower_reward_per_vote,
                    lower_total_rewards_amount,
                    lower_total_fees
                )
            ).to.be.revertedWith('QuestBoard: New reward must be higher')

        });

        it(' should fail if not Quest creator', async () => {

            await DAI.connect(creator2).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            await expect(
                board.connect(creator2).increaseQuestReward(
                    questID,
                    new_reward_per_vote,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Not allowed')

        });

        it(' should fail if the quest does not exist', async () => {

            const wrong_ID = questID.add(12)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            await expect(
                board.connect(creator1).increaseQuestReward(
                    wrong_ID,
                    new_reward_per_vote,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Non valid ID')

        });

        it(' should fail if given incorrect parameters', async () => {

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            await expect(
                board.connect(creator1).increaseQuestReward(
                    questID,
                    0,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Null amount')

            await expect(
                board.connect(creator1).increaseQuestReward(
                    questID,
                    new_reward_per_vote,
                    0,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Null amount')

            await expect(
                board.connect(creator1).increaseQuestReward(
                    questID,
                    new_reward_per_vote,
                    added_total_rewards_amount,
                    0
                )
            ).to.be.revertedWith('QuestBoard: Null amount')

        });

        it(' should fail if given amounts (rewards or fees) are incorrect', async () => {

            const wrong_total_rewards_amount = ethers.utils.parseEther('80000').sub(rewards_per_period).mul(remainingDuration)
            const wrong_total_fees = added_total_rewards_amount.mul(400).div(10000)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            await expect(
                board.connect(creator1).increaseQuestReward(
                    questID,
                    new_reward_per_vote,
                    wrong_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: addedRewardAmount incorrect')

            await expect(
                board.connect(creator1).increaseQuestReward(
                    questID,
                    new_reward_per_vote,
                    added_total_rewards_amount,
                    wrong_total_fees
                )
            ).to.be.revertedWith('QuestBoard: feeAmount incorrect')

        });

    });


    describe('increaseQuestObjective', async () => {

        const target_votes = ethers.utils.parseEther('15000')
        const reward_per_vote = ethers.utils.parseEther('0.3')

        const rewards_per_period = ethers.utils.parseEther('4500')

        const duration = 6
        const ellapsedDuration = 3
        const remainingDuration = duration - ellapsedDuration

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(500).div(10000)

        const new_target_votes = ethers.utils.parseEther('20000')
        const new_rewards_per_period = ethers.utils.parseEther('6000')
        const added_total_rewards_amount = new_rewards_per_period.sub(rewards_per_period).mul(remainingDuration)
        const added_total_fees = added_total_rewards_amount.mul(500).div(10000)

        let questID: BigNumber;

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).whitelistToken(DAI.address)

            await controller.add_gauge(gauge1.address, 2)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))
            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            questID = await board.nextID()

            await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees
            )

            await DAI.connect(admin).transfer(creator1.address, added_total_rewards_amount.add(added_total_fees))

        });

        it(' should update the upcoming Periods & not change past and current period (& emit the correct Event)', async () => {

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const old_periods_length = (await board.getAllPeriodsForQuestId(questID)).length
            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            const increase_tx = await board.connect(creator1).increaseQuestObjective(
                questID,
                new_target_votes,
                added_total_rewards_amount,
                added_total_fees
            )

            const current_period = await board.currentPeriod()
            const applied_period = current_period.add(WEEK).div(WEEK).mul(WEEK)

            await expect(
                increase_tx
            ).to.emit(board, "IncreasedQuestObjective")
                .withArgs(
                    questID,
                    applied_period,
                    new_target_votes,
                    added_total_rewards_amount
                );

            const new_periods_length = (await board.getAllPeriodsForQuestId(questID)).length

            expect(new_periods_length).to.be.eq(old_periods_length)

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            const quest_data = await board.quests(questID)
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount.add(added_total_rewards_amount))

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                let old_quest_period = old_quest_periods[i]

                if (BigNumber.from(quest_period.periodStart).lte(current_period)) {
                    //Past & current should stay the same
                    expect(quest_period.periodStart).to.be.eq(old_quest_period.periodStart)
                    expect(quest_period.rewardAmountPerPeriod).to.be.eq(old_quest_period.rewardAmountPerPeriod)
                    expect(quest_period.rewardPerVote).to.be.eq(old_quest_period.rewardPerVote)
                    expect(quest_period.objectiveVotes).to.be.eq(old_quest_period.objectiveVotes)
                    expect(quest_period.rewardAmountDistributed).to.be.eq(old_quest_period.rewardAmountDistributed)
                    expect(quest_period.withdrawableAmount).to.be.eq(old_quest_period.withdrawableAmount)
                    expect(quest_period.currentState).to.be.eq(old_quest_period.currentState)
                } else {
                    expect(quest_period.periodStart).to.be.eq(old_quest_period.periodStart)

                    expect(quest_period.objectiveVotes).to.be.eq(new_target_votes)
                    expect(quest_period.rewardAmountPerPeriod).to.be.eq(new_rewards_per_period)

                    expect(quest_period.rewardPerVote).to.be.eq(old_quest_period.rewardPerVote)
                    expect(quest_period.rewardAmountDistributed).to.be.eq(old_quest_period.rewardAmountDistributed)
                    expect(quest_period.withdrawableAmount).to.be.eq(old_quest_period.withdrawableAmount)
                    expect(quest_period.currentState).to.be.eq(old_quest_period.currentState)
                }
            }

        });

        it(' should do the correct transfers', async () => {

            const old_board_balance = await DAI.balanceOf(board.address)
            const old_chest_balance = await DAI.balanceOf(mockChest.address)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const increase_tx = await board.connect(creator1).increaseQuestObjective(
                questID,
                new_target_votes,
                added_total_rewards_amount,
                added_total_fees
            )

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, board.address, added_total_rewards_amount);

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, mockChest.address, added_total_fees);

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_chest_balance = await DAI.balanceOf(mockChest.address)

            expect(new_board_balance).to.be.eq(old_board_balance.add(added_total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(added_total_fees))

        });

        it(' should not change previous QuestPeriod (CLOSED or DISTRIBUTED)', async () => {

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const periods_list = await board.getAllPeriodsForQuestId(questID)

            const first_period = periods_list[0]
            const second_period = periods_list[1]

            await board.connect(admin).closeQuestPeriod(first_period)
            await board.connect(admin).closeQuestPeriod(second_period)

            const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
            await board.connect(admin).addMerkleRoot(questID, first_period, mockRoot)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            await board.connect(creator1).increaseQuestObjective(
                questID,
                new_target_votes,
                added_total_rewards_amount,
                added_total_fees
            )

            const current_period = await board.currentPeriod()

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                let old_quest_period = old_quest_periods[i]

                if (BigNumber.from(quest_period.periodStart).lte(current_period)) {
                    //Past & current should stay the same
                    expect(quest_period.periodStart).to.be.eq(old_quest_period.periodStart)
                    expect(quest_period.rewardAmountPerPeriod).to.be.eq(old_quest_period.rewardAmountPerPeriod)
                    expect(quest_period.rewardPerVote).to.be.eq(old_quest_period.rewardPerVote)
                    expect(quest_period.objectiveVotes).to.be.eq(old_quest_period.objectiveVotes)
                    expect(quest_period.rewardAmountDistributed).to.be.eq(old_quest_period.rewardAmountDistributed)
                    expect(quest_period.withdrawableAmount).to.be.eq(old_quest_period.withdrawableAmount)
                    expect(quest_period.currentState).to.be.eq(old_quest_period.currentState)
                }
            }

        });

        it(' should fail if new reward per SlopePoint is less than current one', async () => {

            const lower_target_votes = target_votes.div(2)
            const lower_total_rewards_amount = reward_per_vote.mul(lower_target_votes).mul(remainingDuration)
            const lower_total_fees = lower_total_rewards_amount.mul(500).div(10000)

            await DAI.connect(creator1).approve(board.address, lower_total_rewards_amount.add(lower_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            await expect(
                board.connect(creator1).increaseQuestObjective(
                    questID,
                    lower_target_votes,
                    lower_total_rewards_amount,
                    lower_total_fees
                )
            ).to.be.revertedWith('QuestBoard: New objective must be higher')

        });

        it(' should fail if not Quest creator', async () => {

            await DAI.connect(creator2).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            await expect(
                board.connect(creator2).increaseQuestObjective(
                    questID,
                    new_target_votes,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Not allowed')

        });

        it(' should fail if the quest does not exist', async () => {

            const wrong_ID = questID.add(12)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            await expect(
                board.connect(creator1).increaseQuestObjective(
                    wrong_ID,
                    new_target_votes,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Non valid ID')

        });

        it(' should fail if given incorrect parameters', async () => {

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            await expect(
                board.connect(creator1).increaseQuestObjective(
                    questID,
                    new_target_votes,
                    0,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Null amount')

            await expect(
                board.connect(creator1).increaseQuestObjective(
                    questID,
                    new_target_votes,
                    added_total_rewards_amount,
                    0
                )
            ).to.be.revertedWith('QuestBoard: Null amount')

        });

        it(' should fail if given amounts (rewards or fees) are incorrect', async () => {

            const wrong_total_rewards_amount = ethers.utils.parseEther('50000').sub(rewards_per_period).mul(remainingDuration)
            const wrong_total_fees = added_total_rewards_amount.mul(400).div(10000)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            await expect(
                board.connect(creator1).increaseQuestObjective(
                    questID,
                    new_target_votes,
                    wrong_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: addedRewardAmount incorrect')

            await expect(
                board.connect(creator1).increaseQuestObjective(
                    questID,
                    new_target_votes,
                    added_total_rewards_amount,
                    wrong_total_fees
                )
            ).to.be.revertedWith('QuestBoard: feeAmount incorrect')

        });

    });


    describe('closeQuestPeriod', async () => {

        let gauges: string[] = []
        let rewardToken: IERC20[] = []

        const target_votes = [ethers.utils.parseEther('15000'), ethers.utils.parseEther('25000'), ethers.utils.parseEther('8000')]
        const reward_per_vote = [ethers.utils.parseEther('2'), ethers.utils.parseEther('1.5'), ethers.utils.parseEther('0.5')]
        const duration = [6, 4, 7]

        let questIDs: BigNumber[] = [];

        const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000'), ethers.utils.parseEther('12000')]
        const gauge2_biases = [ethers.utils.parseEther('18000'), ethers.utils.parseEther('25000'), ethers.utils.parseEther('30000')]
        const gauge3_biases = [ethers.utils.parseEther('10000'), ethers.utils.parseEther('11000'), ethers.utils.parseEther('15000')]

        const all_biases = [gauge1_biases, gauge2_biases, gauge3_biases]

        let first_period: BigNumber;

        let rewards_per_period: BigNumber[] = []
        let total_rewards_amount: BigNumber[] = []
        let total_fees: BigNumber[] = []

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address, gauge3.address]
            rewardToken = [DAI, CRV, DAI]

            let creators = [creator1, creator2, creator3]

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address)
            await board.connect(admin).whitelistToken(CRV.address)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.currentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            for (let i = 0; i < gauges.length; i++) {
                rewards_per_period[i] = target_votes[i].mul(reward_per_vote[i]).div(UNIT)
                total_rewards_amount[i] = rewards_per_period[i].mul(duration[i])
                total_fees[i] = total_rewards_amount[i].mul(500).div(10000)

                await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount[i].add(total_fees[i]))
                await rewardToken[i].connect(creators[i]).approve(board.address, 0)
                await rewardToken[i].connect(creators[i]).approve(board.address, total_rewards_amount[i].add(total_fees[i]))

                questIDs[i] = await board.nextID()

                await board.connect(creators[i]).createQuest(
                    gauges[i],
                    rewardToken[i].address,
                    duration[i],
                    target_votes[i],
                    reward_per_vote[i],
                    total_rewards_amount[i],
                    total_fees[i]
                )
            }

            //setup the gauges slopes
            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
                await controller.set_points_weight(gauge3.address, period_end_to_set, gauge3_biases[i])
            }

        });

        it(' 1 period - should update the period', async () => {
            await advanceTime(WEEK.mul(2).toNumber())

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const current_period = current_ts.div(WEEK).mul(WEEK)

            await board.connect(manager).closeQuestPeriod(first_period)

            expect(await board.currentPeriod()).to.be.eq(current_period)

        });

        it(' 1 period - should close the period correctly & update all questPeriods (& emit the correct event)', async () => {
            await advanceTime(WEEK.mul(2).toNumber())

            const close_tx = await board.connect(manager).closeQuestPeriod(first_period)

            for (let i = 0; i < gauges.length; i++) {
                const questPriod_data = await board.periodsByQuest(questIDs[i], first_period)

                const expected_completion = all_biases[i][0].gte(target_votes[i]) ? UNIT : all_biases[i][0].mul(UNIT).div(target_votes[i])
                const expected_distribute_amount = rewards_per_period[i].mul(expected_completion).div(UNIT)
                const expected_withdraw_amount = rewards_per_period[i].sub(expected_distribute_amount)

                expect(questPriod_data.currentState).to.be.eq(1)
                expect(questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
                expect(questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

                await expect(
                    close_tx
                ).to.emit(rewardToken[i], "Transfer")
                    .withArgs(board.address, distributor.address, expected_distribute_amount);

            }

            await expect(
                close_tx
            ).to.emit(board, "PeriodClosed")
                .withArgs(first_period);

        });

        it(' 1 period - should not be able to close the same period twice', async () => {
            await advanceTime(WEEK.mul(2).toNumber())

            await board.connect(manager).closeQuestPeriod(first_period)

            await expect(
                board.connect(manager).closeQuestPeriod(first_period)
            ).to.be.revertedWith('QuestBoard: Period already closed')

        });

        it(' 1 period - should fail on current active period', async () => {
            await advanceTime(WEEK.toNumber())

            await expect(
                board.connect(manager).closeQuestPeriod(first_period)
            ).to.be.revertedWith('QuestBoard: Period still active')

        });

        it(' multiple period - should close the periods correctly & update all questPeriods for each (& emit the correct event)', async () => {
            await advanceTime(WEEK.mul(4).toNumber())

            const ellapsed_periods = 3

            for (let j = 0; j < ellapsed_periods; j++) {
                let toClose_period = first_period.add(WEEK.mul(j)).div(WEEK).mul(WEEK)

                let close_tx = await board.connect(manager).closeQuestPeriod(toClose_period)

                for (let i = 0; i < gauges.length; i++) {
                    let questPriod_data = await board.periodsByQuest(questIDs[i], toClose_period)

                    let expected_completion = all_biases[i][j].gte(target_votes[i]) ? UNIT : all_biases[i][j].mul(UNIT).div(target_votes[i])
                    let expected_distribute_amount = rewards_per_period[i].mul(expected_completion).div(UNIT)
                    let expected_withdraw_amount = rewards_per_period[i].sub(expected_distribute_amount)

                    expect(questPriod_data.currentState).to.be.eq(1)
                    expect(questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
                    expect(questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

                    await expect(
                        close_tx
                    ).to.emit(rewardToken[i], "Transfer")
                        .withArgs(board.address, distributor.address, expected_distribute_amount);

                }

                await expect(
                    close_tx
                ).to.emit(board, "PeriodClosed")
                    .withArgs(toClose_period);

            }

        });

        it(' should fail on incorrect period', async () => {
            await advanceTime(WEEK.toNumber())

            await expect(
                board.connect(manager).closeQuestPeriod(0)
            ).to.be.revertedWith('QuestBoard: invalid Period')

        });

        it(' should fail on empty period', async () => {
            await advanceTime(WEEK.toNumber())

            let previous_period = first_period.sub(WEEK).div(WEEK).mul(WEEK)

            await expect(
                board.connect(manager).closeQuestPeriod(previous_period)
            ).to.be.revertedWith('QuestBoard: empty Period')

        });

        it(' should fail if no distributor set', async () => {

            let otherBoard = (await boardFactory.connect(admin).deploy(controller.address, mockChest.address)) as QuestBoard;
            await otherBoard.deployed();

            await otherBoard.connect(admin).whitelistToken(DAI.address)

            first_period = (await otherBoard.currentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            await advanceTime(WEEK.mul(2).toNumber())

            await expect(
                otherBoard.connect(admin).closeQuestPeriod(first_period)
            ).to.be.revertedWith('QuestBoard: no Distributor set')

        });

        it(' should only be allowed for admin and managers', async () => {

            await expect(
                board.connect(manager2).closeQuestPeriod(first_period)
            ).to.be.revertedWith('QuestBoard: Not allowed')

            await expect(
                board.connect(user1).closeQuestPeriod(first_period)
            ).to.be.revertedWith('QuestBoard: Not allowed')

        });

    });


    describe('addMerkleRoot & addMultipleMerkleRoot', async () => {

        const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"

        let gauges: string[] = []
        let rewardToken: IERC20[] = []

        const target_votes = [ethers.utils.parseEther('15000'), ethers.utils.parseEther('25000'), ethers.utils.parseEther('8000')]
        const reward_per_vote = [ethers.utils.parseEther('2'), ethers.utils.parseEther('1.5'), ethers.utils.parseEther('0.5')]
        const duration = [6, 4, 7]

        let questIDs: BigNumber[] = [];

        const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000')]
        const gauge2_biases = [ethers.utils.parseEther('18000'), ethers.utils.parseEther('25000')]
        const gauge3_biases = [ethers.utils.parseEther('10000'), ethers.utils.parseEther('11000')]

        let ID_to_distribute: BigNumber;

        const all_biases = [gauge1_biases, gauge2_biases, gauge3_biases]

        let first_period: BigNumber;

        let rewards_per_period: BigNumber[] = []
        let total_rewards_amount: BigNumber[] = []
        let total_fees: BigNumber[] = []

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address, gauge3.address]
            rewardToken = [DAI, CRV, DAI]

            let creators = [creator1, creator2, creator3]

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address)
            await board.connect(admin).whitelistToken(CRV.address)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.currentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            for (let i = 0; i < gauges.length; i++) {
                rewards_per_period[i] = target_votes[i].mul(reward_per_vote[i]).div(UNIT)
                total_rewards_amount[i] = rewards_per_period[i].mul(duration[i])
                total_fees[i] = total_rewards_amount[i].mul(500).div(10000)

                await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount[i].add(total_fees[i]))
                await rewardToken[i].connect(creators[i]).approve(board.address, 0)
                await rewardToken[i].connect(creators[i]).approve(board.address, total_rewards_amount[i].add(total_fees[i]))

                questIDs[i] = await board.nextID()

                await board.connect(creators[i]).createQuest(
                    gauges[i],
                    rewardToken[i].address,
                    duration[i],
                    target_votes[i],
                    reward_per_vote[i],
                    total_rewards_amount[i],
                    total_fees[i]
                )
            }

            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
                await controller.set_points_weight(gauge3.address, period_end_to_set, gauge3_biases[i])
            }

            await advanceTime(WEEK.mul(2).toNumber())

            await board.connect(manager).closeQuestPeriod(first_period)

            ID_to_distribute = questIDs[0]

        });

        it(' should set the QuestPeriod as DISTRIBUTED and add the MerkleRoot to the Distributor', async () => {

            await board.connect(manager).addMerkleRoot(ID_to_distribute, first_period, mockRoot)

            expect(await distributor.questMerkleRootPerPeriod(ID_to_distribute, first_period)).to.be.eq(mockRoot)

            expect((await board.periodsByQuest(ID_to_distribute, first_period)).currentState).to.be.eq(2)


        });

        it(' should fail if tried twice', async () => {

            await board.connect(manager).addMerkleRoot(ID_to_distribute, first_period, mockRoot)

            await expect(
                board.connect(manager).addMerkleRoot(ID_to_distribute, first_period, mockRoot)
            ).to.be.reverted

        });

        it(' should fail if empty Merkle Root', async () => {

            await expect(
                board.connect(manager).addMerkleRoot(ID_to_distribute, first_period, "0x0000000000000000000000000000000000000000000000000000000000000000")
            ).to.be.revertedWith('QuestBoard: Empty MerkleRoot')

        });

        it(' should fail if Quest ID is invalid', async () => {

            const invalid_id = (await board.nextID()).add(15)

            await expect(
                board.connect(manager).addMerkleRoot(invalid_id, first_period, mockRoot)
            ).to.be.revertedWith('QuestBoard: Non valid ID')

        });

        it(' should fail if period is not CLOSED', async () => {

            const next_period = first_period.add(WEEK).div(WEEK).mul(WEEK)

            await expect(
                board.connect(manager).addMerkleRoot(ID_to_distribute, next_period, mockRoot)
            ).to.be.revertedWith('QuestBoard: Quest Period not closed')

        });

        it(' should only be allowed for admin and managers', async () => {

            await expect(
                board.connect(manager2).addMerkleRoot(ID_to_distribute, first_period, mockRoot)
            ).to.be.revertedWith('QuestBoard: Not allowed')

            await expect(
                board.connect(user1).addMerkleRoot(ID_to_distribute, first_period, mockRoot)
            ).to.be.revertedWith('QuestBoard: Not allowed')

        });

        it(' addMultipleMerkleRoot - should set all QuestPeriod as DISTRIBUTED and add the roots to the Distributor', async () => {

            let mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"
            let mockRoot3 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8ca6"

            const roots = [mockRoot, mockRoot2, mockRoot3]

            await board.connect(manager).addMultipleMerkleRoot(questIDs, first_period, roots)

            expect(await distributor.questMerkleRootPerPeriod(questIDs[0], first_period)).to.be.eq(roots[0])
            expect(await distributor.questMerkleRootPerPeriod(questIDs[1], first_period)).to.be.eq(roots[1])
            expect(await distributor.questMerkleRootPerPeriod(questIDs[2], first_period)).to.be.eq(roots[2])

            expect((await board.periodsByQuest(questIDs[0], first_period)).currentState).to.be.eq(2)
            expect((await board.periodsByQuest(questIDs[1], first_period)).currentState).to.be.eq(2)
            expect((await board.periodsByQuest(questIDs[2], first_period)).currentState).to.be.eq(2)


        });

        it(' addMultipleMerkleRoot - should fail if given inequal list sizes', async () => {

            let mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"

            const roots = [mockRoot, mockRoot2]

            await expect(
                board.connect(manager).addMultipleMerkleRoot(questIDs, first_period, roots)
            ).to.be.revertedWith('QuestBoard: Diff list size')

        });

        it(' addMultipleMerkleRoot - should only be allowed for admin and managers', async () => {

            let mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"
            let mockRoot3 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8ca6"

            const roots = [mockRoot, mockRoot2, mockRoot3]

            await expect(
                board.connect(manager2).addMultipleMerkleRoot(questIDs, first_period, roots)
            ).to.be.revertedWith('QuestBoard: Not allowed')

            await expect(
                board.connect(user1).addMultipleMerkleRoot(questIDs, first_period, roots)
            ).to.be.revertedWith('QuestBoard: Not allowed')

        });

    });


    describe('withdrawUnusedRewards', async () => {

        const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
        const mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"

        let gauges: string[] = []
        let rewardToken: IERC20[] = []

        const target_votes = [ethers.utils.parseEther('15000'), ethers.utils.parseEther('25000'), ethers.utils.parseEther('8000')]
        const reward_per_vote = [ethers.utils.parseEther('2'), ethers.utils.parseEther('1.5'), ethers.utils.parseEther('0.5')]
        const duration = [6, 4, 7]

        let questIDs: BigNumber[] = [];

        const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000'), ethers.utils.parseEther('12000')]
        const gauge2_biases = [ethers.utils.parseEther('12000'), ethers.utils.parseEther('15000'), ethers.utils.parseEther('18000')]
        const gauge3_biases = [ethers.utils.parseEther('0'), ethers.utils.parseEther('0'), ethers.utils.parseEther('0')]

        let first_period: BigNumber;

        let rewards_per_period: BigNumber[] = []
        let total_rewards_amount: BigNumber[] = []
        let total_fees: BigNumber[] = []

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address, gauge3.address]
            rewardToken = [DAI, CRV, DAI]

            let creators = [creator1, creator2, creator3]

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address)
            await board.connect(admin).whitelistToken(CRV.address)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.currentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            for (let i = 0; i < gauges.length; i++) {
                rewards_per_period[i] = target_votes[i].mul(reward_per_vote[i]).div(UNIT)
                total_rewards_amount[i] = rewards_per_period[i].mul(duration[i])
                total_fees[i] = total_rewards_amount[i].mul(500).div(10000)

                await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount[i].add(total_fees[i]))
                await rewardToken[i].connect(creators[i]).approve(board.address, 0)
                await rewardToken[i].connect(creators[i]).approve(board.address, total_rewards_amount[i].add(total_fees[i]))

                questIDs[i] = await board.nextID()

                await board.connect(creators[i]).createQuest(
                    gauges[i],
                    rewardToken[i].address,
                    duration[i],
                    target_votes[i],
                    reward_per_vote[i],
                    total_rewards_amount[i],
                    total_fees[i]
                )
            }

            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
                await controller.set_points_weight(gauge3.address, period_end_to_set, gauge3_biases[i])
            }

            await advanceTime(WEEK.mul(3).toNumber())

            await board.connect(manager).closeQuestPeriod(first_period)

            const next_period = first_period.add(WEEK).div(WEEK).mul(WEEK)

            await board.connect(manager).closeQuestPeriod(next_period)

            await board.connect(manager).addMerkleRoot(questIDs[0], first_period, mockRoot)
            await board.connect(manager).addMerkleRoot(questIDs[0], next_period, mockRoot)

            await board.connect(manager).addMerkleRoot(questIDs[1], first_period, mockRoot2)

        });

        it(' should withdraw all unused rewards for DISTRIBUTED QuestPeriods (& set storage to 0 & emit correct Events)', async () => {

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[0])

            let expected_withdrawable_amount = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods.length; i++) {
                let quest_period = old_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).not.to.be.eq(0)
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.withdrawableAmount)
                }
            }

            const old_board_balance = await rewardToken[0].balanceOf(board.address)
            const old_receiver_balance = await rewardToken[0].balanceOf(receiver.address)

            const withdraw_tx = await board.connect(creator1).withdrawUnusedRewards(questIDs[0], receiver.address)

            await expect(
                withdraw_tx
            ).to.emit(board, "WithdrawUnusedRewards")
                .withArgs(questIDs[0], receiver.address, expected_withdrawable_amount);

            await expect(
                withdraw_tx
            ).to.emit(rewardToken[0], "Transfer")
                .withArgs(board.address, receiver.address, expected_withdrawable_amount);

            const new_board_balance = await rewardToken[0].balanceOf(board.address)
            const new_receiver_balance = await rewardToken[0].balanceOf(receiver.address)

            expect(new_board_balance).to.be.eq(old_board_balance.sub(expected_withdrawable_amount))
            expect(new_receiver_balance).to.be.eq(old_receiver_balance.add(expected_withdrawable_amount))

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[0])

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
            }

        });

        it(' should withdraw all unused rewards for DISTRIBUTED & CLOSED QuestPeriods (& set storage to 0 & emit correct Events)', async () => {

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[1])

            let expected_withdrawable_amount = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods.length; i++) {
                let quest_period = old_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).not.to.be.eq(0)
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.withdrawableAmount)
                }
            }

            const old_board_balance = await rewardToken[1].balanceOf(board.address)
            const old_receiver_balance = await rewardToken[1].balanceOf(receiver.address)

            const withdraw_tx = await board.connect(creator2).withdrawUnusedRewards(questIDs[1], receiver.address)

            await expect(
                withdraw_tx
            ).to.emit(board, "WithdrawUnusedRewards")
                .withArgs(questIDs[1], receiver.address, expected_withdrawable_amount);

            await expect(
                withdraw_tx
            ).to.emit(rewardToken[1], "Transfer")
                .withArgs(board.address, receiver.address, expected_withdrawable_amount);

            const new_board_balance = await rewardToken[1].balanceOf(board.address)
            const new_receiver_balance = await rewardToken[1].balanceOf(receiver.address)

            expect(new_board_balance).to.be.eq(old_board_balance.sub(expected_withdrawable_amount))
            expect(new_receiver_balance).to.be.eq(old_receiver_balance.add(expected_withdrawable_amount))

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[1])

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
            }

        });

        it(' should withdraw all rewards if Gauge Slope was 0 for the period (& set storage to 0 & emit correct Events)', async () => {

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[2])

            let expected_withdrawable_amount = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods.length; i++) {
                let quest_period = old_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).not.to.be.eq(0)
                    expect(quest_period.withdrawableAmount).to.be.eq(quest_period.rewardAmountPerPeriod)
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.withdrawableAmount)
                }
            }

            const old_board_balance = await rewardToken[2].balanceOf(board.address)
            const old_receiver_balance = await rewardToken[2].balanceOf(receiver.address)

            const withdraw_tx = await board.connect(creator3).withdrawUnusedRewards(questIDs[2], receiver.address)

            await expect(
                withdraw_tx
            ).to.emit(board, "WithdrawUnusedRewards")
                .withArgs(questIDs[2], receiver.address, expected_withdrawable_amount);

            await expect(
                withdraw_tx
            ).to.emit(rewardToken[2], "Transfer")
                .withArgs(board.address, receiver.address, expected_withdrawable_amount);

            const new_board_balance = await rewardToken[2].balanceOf(board.address)
            const new_receiver_balance = await rewardToken[2].balanceOf(receiver.address)

            expect(new_board_balance).to.be.eq(old_board_balance.sub(expected_withdrawable_amount))
            expect(new_receiver_balance).to.be.eq(old_receiver_balance.add(expected_withdrawable_amount))

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[2])

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
            }

        });

        it(' should not make a Transfer if no amount to withdraw', async () => {

            await board.connect(creator1).withdrawUnusedRewards(questIDs[0], receiver.address)

            const second_withdraw_tx = await board.connect(creator1).withdrawUnusedRewards(questIDs[0], receiver.address)

            await expect(
                second_withdraw_tx
            ).to.not.emit(board, "WithdrawUnusedRewards")

            await expect(
                second_withdraw_tx
            ).to.not.emit(rewardToken[0], "Transfer")

        });

        it(' should fail if given an invalid QuestID', async () => {

            const incorrectID = questIDs[0].add(50)

            await expect(
                board.connect(creator1).withdrawUnusedRewards(incorrectID, receiver.address)
            ).to.be.revertedWith('QuestBoard: Non valid ID')

        });

        it(' should fail if caller is not Quest creator', async () => {

            await expect(
                board.connect(creator2).withdrawUnusedRewards(questIDs[0], receiver.address)
            ).to.be.revertedWith('QuestBoard: Not allowed')

            await expect(
                board.connect(user1).withdrawUnusedRewards(questIDs[0], user1.address)
            ).to.be.revertedWith('QuestBoard: Not allowed')

        });

        it(' should fail if given address 0x0 as recipient', async () => {

            await expect(
                board.connect(creator1).withdrawUnusedRewards(questIDs[0], ethers.constants.AddressZero)
            ).to.be.revertedWith('QuestBoard: Zero Address')

        });

    });


    describe('killBoard', async () => {

        it(' should kill & set the timestamp (& emit the correct Event)', async () => {

            const kill_tx = await board.connect(admin).killBoard()

            await expect(
                kill_tx
            ).to.emit(board, "Killed")

            expect(await board.isKilled()).to.be.true

            const kill_blockNumber = (await kill_tx).blockNumber || 0
            const kill_timestamp = BigNumber.from((await provider.getBlock(kill_blockNumber)).timestamp)

            expect(await board.kill_ts()).to.be.eq(kill_timestamp)

        });

        it(' should block all isAlive methods', async () => {

            await board.connect(admin).killBoard()

            const target_votes = ethers.utils.parseEther('15000')
            const reward_per_vote = ethers.utils.parseEther('6')

            const rewards_per_period = ethers.utils.parseEther('90000')

            const duration = 4

            const total_rewards_amount = rewards_per_period.mul(duration)
            const total_fees = total_rewards_amount.mul(500).div(10000)

            const extend_duration = 3
            const added_total_rewards_amount = rewards_per_period.mul(extend_duration)
            const added_total_fees = added_total_rewards_amount.mul(500).div(10000)

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees
                )
            ).to.be.revertedWith('QuestBoard: Killed')

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    0,
                    extend_duration,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('QuestBoard: Killed')

            await expect(
                board.connect(creator1).withdrawUnusedRewards(0, receiver.address)
            ).to.be.revertedWith('QuestBoard: Killed')

        });

        it(' should not block other methods', async () => {

            await board.connect(admin).killBoard()

            await expect(
                board.connect(manager).updatePeriod()
            ).to.not.be.reverted

            await expect(
                board.connect(admin).whitelistToken(DAI.address)
            ).to.not.be.reverted

        });

        it(' should not be killable twice', async () => {

            await board.connect(admin).killBoard()

            expect(await board.isKilled()).to.be.true

            await expect(
                board.connect(admin).killBoard()
            ).to.be.revertedWith('QuestBoard: Already killed')

            expect(await board.isKilled()).to.be.true

        });

        it(' should only be allowed for admin', async () => {

            await expect(
                board.connect(user1).killBoard()
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                board.connect(manager).killBoard()
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('unkillBoard', async () => {

        it(' should unkill the Board (& emit the correct event)', async () => {

            await board.connect(admin).killBoard()

            expect(await board.isKilled()).to.be.true

            await expect(
                board.connect(admin).unkillBoard()
            ).to.emit(board, "Unkilled")

            expect(await board.isKilled()).to.be.false

        });

        it(' should unblock all isAlive methods', async () => {

            const target_votes = ethers.utils.parseEther('150000')
            const reward_per_vote = ethers.utils.parseEther('6')

            const rewards_per_period = ethers.utils.parseEther('900000')

            const duration = 4

            const total_rewards_amount = rewards_per_period.mul(duration)
            const total_fees = total_rewards_amount.mul(500).div(10000)

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).whitelistToken(DAI.address)

            await controller.add_gauge(gauge1.address, 2)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            await board.connect(admin).killBoard()

            await board.connect(admin).unkillBoard()

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees
                )
            ).to.not.be.reverted

        });

        it(' should fail if board was not killed', async () => {

            await expect(
                board.connect(admin).unkillBoard()
            ).to.be.revertedWith('QuestBoard: Not killed')

        });

        it(' should only be possible before delay is over', async () => {

            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            await expect(
                board.connect(admin).unkillBoard()
            ).to.be.revertedWith('QuestBoard: Too late')

        });

        it(' should only be allowed for admin', async () => {

            await board.connect(admin).killBoard()

            await expect(
                board.connect(user1).unkillBoard()
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                board.connect(manager).unkillBoard()
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });

    describe('emergencyWithdraw', async () => {

        const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
        const mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"

        let gauges: string[] = []
        let rewardToken: IERC20[] = []

        const target_votes = [ethers.utils.parseEther('15000'), ethers.utils.parseEther('25000'), ethers.utils.parseEther('8000')]
        const reward_per_vote = [ethers.utils.parseEther('2'), ethers.utils.parseEther('1.5'), ethers.utils.parseEther('0.5')]
        const duration = [6, 4, 7]

        let questIDs: BigNumber[] = [];

        const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000'), ethers.utils.parseEther('12000')]
        const gauge2_biases = [ethers.utils.parseEther('12000'), ethers.utils.parseEther('15000'), ethers.utils.parseEther('18000')]
        const gauge3_biases = [ethers.utils.parseEther('0'), ethers.utils.parseEther('0'), ethers.utils.parseEther('0')]

        let first_period: BigNumber;

        let rewards_per_period: BigNumber[] = []
        let total_rewards_amount: BigNumber[] = []
        let total_fees: BigNumber[] = []

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address, gauge3.address]
            rewardToken = [DAI, CRV, DAI]

            let creators = [creator1, creator2, creator3]

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address)
            await board.connect(admin).whitelistToken(CRV.address)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.currentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            for (let i = 0; i < gauges.length; i++) {
                rewards_per_period[i] = target_votes[i].mul(reward_per_vote[i]).div(UNIT)
                total_rewards_amount[i] = rewards_per_period[i].mul(duration[i])
                total_fees[i] = total_rewards_amount[i].mul(500).div(10000)

                await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount[i].add(total_fees[i]))
                await rewardToken[i].connect(creators[i]).approve(board.address, 0)
                await rewardToken[i].connect(creators[i]).approve(board.address, total_rewards_amount[i].add(total_fees[i]))

                questIDs[i] = await board.nextID()

                await board.connect(creators[i]).createQuest(
                    gauges[i],
                    rewardToken[i].address,
                    duration[i],
                    target_votes[i],
                    reward_per_vote[i],
                    total_rewards_amount[i],
                    total_fees[i]
                )
            }

            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
                await controller.set_points_weight(gauge3.address, period_end_to_set, gauge3_biases[i])
            }

            await advanceTime(WEEK.mul(3).toNumber())

            await board.connect(manager).closeQuestPeriod(first_period)

            const next_period = first_period.add(WEEK).div(WEEK).mul(WEEK)

            await board.connect(manager).closeQuestPeriod(next_period)

            await board.connect(manager).addMerkleRoot(questIDs[0], first_period, mockRoot)
            await board.connect(manager).addMerkleRoot(questIDs[0], next_period, mockRoot)

            await board.connect(manager).addMerkleRoot(questIDs[1], first_period, mockRoot2)

        });

        it(' should fail if Board is not killed & should wait for delay', async () => {

            await expect(
                board.connect(creator1).emergencyWithdraw(questIDs[0], user1.address)
            ).to.be.revertedWith('QuestBoard: Not killed')

            await board.connect(admin).killBoard()

            await expect(
                board.connect(creator1).emergencyWithdraw(questIDs[0], user1.address)
            ).to.be.revertedWith('QuestBoard: Wait kill delay')

        });

        it(' should emergency withdraw all unused rewards for DISTRIBUTED QuestPeriods & all rewards for ACTIVE QuestPeriods (& set storage to 0 & emit correct Events)', async () => {

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[0])

            let expected_withdrawable_amount = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods.length; i++) {
                let quest_period = old_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).not.to.be.eq(0)
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.withdrawableAmount)
                }
                else {
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.rewardAmountPerPeriod)
                }
            }

            const old_board_balance = await rewardToken[0].balanceOf(board.address)
            const old_receiver_balance = await rewardToken[0].balanceOf(receiver.address)


            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            const withdraw_tx = await board.connect(creator1).emergencyWithdraw(questIDs[0], receiver.address)

            await expect(
                withdraw_tx
            ).to.emit(board, "EmergencyWithdraw")
                .withArgs(questIDs[0], receiver.address, expected_withdrawable_amount);

            await expect(
                withdraw_tx
            ).to.emit(rewardToken[0], "Transfer")
                .withArgs(board.address, receiver.address, expected_withdrawable_amount);

            const new_board_balance = await rewardToken[0].balanceOf(board.address)
            const new_receiver_balance = await rewardToken[0].balanceOf(receiver.address)

            expect(new_board_balance).to.be.eq(old_board_balance.sub(expected_withdrawable_amount))
            expect(new_receiver_balance).to.be.eq(old_receiver_balance.add(expected_withdrawable_amount))

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[0])

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
                else {
                    expect(quest_period.rewardAmountPerPeriod).to.be.eq(0) //Should have been set to 0
                }
            }

        });

        it(' should emergency withdraw all unused rewards for DISTRIBUTED & CLOSED QuestPeriods & all rewards for ACTIVE QuestPeriods (& set storage to 0 & emit correct Events)', async () => {

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[1])

            let expected_withdrawable_amount = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods.length; i++) {
                let quest_period = old_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).not.to.be.eq(0)
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.withdrawableAmount)
                }
                else {
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.rewardAmountPerPeriod)
                }
            }

            const old_board_balance = await rewardToken[1].balanceOf(board.address)
            const old_receiver_balance = await rewardToken[1].balanceOf(receiver.address)


            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            const withdraw_tx = await board.connect(creator2).emergencyWithdraw(questIDs[1], receiver.address)

            await expect(
                withdraw_tx
            ).to.emit(board, "EmergencyWithdraw")
                .withArgs(questIDs[1], receiver.address, expected_withdrawable_amount);

            await expect(
                withdraw_tx
            ).to.emit(rewardToken[1], "Transfer")
                .withArgs(board.address, receiver.address, expected_withdrawable_amount);

            const new_board_balance = await rewardToken[1].balanceOf(board.address)
            const new_receiver_balance = await rewardToken[1].balanceOf(receiver.address)

            expect(new_board_balance).to.be.eq(old_board_balance.sub(expected_withdrawable_amount))
            expect(new_receiver_balance).to.be.eq(old_receiver_balance.add(expected_withdrawable_amount))

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[1])

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
                else {
                    expect(quest_period.rewardAmountPerPeriod).to.be.eq(0) //Should have been set to 0
                }
            }

        });

        it(' should emergency withdraw all rewards if Gauge Slope was 0 for the period & all rewards for ACTIVE QuestPeriods (& set storage to 0 & emit correct Events)', async () => {

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[2])

            let expected_withdrawable_amount = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods.length; i++) {
                let quest_period = old_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).not.to.be.eq(0)
                    expect(quest_period.withdrawableAmount).to.be.eq(quest_period.rewardAmountPerPeriod)
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.withdrawableAmount)
                }
                else {
                    expected_withdrawable_amount = expected_withdrawable_amount.add(quest_period.rewardAmountPerPeriod)
                }
            }

            const old_board_balance = await rewardToken[2].balanceOf(board.address)
            const old_receiver_balance = await rewardToken[2].balanceOf(receiver.address)


            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            const withdraw_tx = await board.connect(creator3).emergencyWithdraw(questIDs[2], receiver.address)

            await expect(
                withdraw_tx
            ).to.emit(board, "EmergencyWithdraw")
                .withArgs(questIDs[2], receiver.address, expected_withdrawable_amount);

            await expect(
                withdraw_tx
            ).to.emit(rewardToken[2], "Transfer")
                .withArgs(board.address, receiver.address, expected_withdrawable_amount);

            const new_board_balance = await rewardToken[2].balanceOf(board.address)
            const new_receiver_balance = await rewardToken[2].balanceOf(receiver.address)

            expect(new_board_balance).to.be.eq(old_board_balance.sub(expected_withdrawable_amount))
            expect(new_receiver_balance).to.be.eq(old_receiver_balance.add(expected_withdrawable_amount))

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[2])

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                if (quest_period.currentState != 0) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
                else {
                    expect(quest_period.rewardAmountPerPeriod).to.be.eq(0) //Should have been set to 0
                }
            }

        });

        it(' should not make a Transfer if no amount to withdraw', async () => {

            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            await board.connect(creator1).emergencyWithdraw(questIDs[0], receiver.address)

            const second_withdraw_tx = await board.connect(creator1).emergencyWithdraw(questIDs[0], receiver.address)

            await expect(
                second_withdraw_tx
            ).to.not.emit(board, "EmergencyWithdraw")

            await expect(
                second_withdraw_tx
            ).to.not.emit(rewardToken[0], "Transfer")

        });

        it(' should fail if given an invalid QuestID', async () => {

            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            const incorrectID = questIDs[0].add(50)

            await expect(
                board.connect(creator1).emergencyWithdraw(incorrectID, receiver.address)
            ).to.be.revertedWith('QuestBoard: Non valid ID')

        });

        it(' should fail if caller is not Quest creator', async () => {

            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            await expect(
                board.connect(creator2).emergencyWithdraw(questIDs[0], receiver.address)
            ).to.be.revertedWith('QuestBoard: Not allowed')

            await expect(
                board.connect(user1).emergencyWithdraw(questIDs[0], user1.address)
            ).to.be.revertedWith('QuestBoard: Not allowed')

        });

        it(' should fail if given address 0x0 as recipient', async () => {

            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            await expect(
                board.connect(creator1).emergencyWithdraw(questIDs[0], ethers.constants.AddressZero)
            ).to.be.revertedWith('QuestBoard: Zero Address')

        });

    });


    describe('whitelistToken', async () => {

        beforeEach(async () => {

            await board.connect(admin).approveManager(manager.address)

        });

        it(' should add the token (& emit the correct Event)', async () => {

            await expect(
                board.connect(manager).whitelistToken(CRV.address)
            ).to.emit(board, "WhitelistToken")
                .withArgs(CRV.address);

            expect(await board.whitelistedTokens(CRV.address)).to.be.true
            expect(await board.whitelistedTokens(DAI.address)).to.be.false
            expect(await board.whitelistedTokens(otherAddress.address)).to.be.false

            await expect(
                board.connect(manager).whitelistToken(DAI.address)
            ).to.emit(board, "WhitelistToken")
                .withArgs(DAI.address);

            expect(await board.whitelistedTokens(CRV.address)).to.be.true
            expect(await board.whitelistedTokens(DAI.address)).to.be.true
            expect(await board.whitelistedTokens(otherAddress.address)).to.be.false

        });

        it(' should fail if given address 0x0', async () => {

            await expect(
                board.connect(manager).whitelistToken(ethers.constants.AddressZero)
            ).to.be.revertedWith('QuestBoard: Zero Address')

        });

        it(' should only be calalble by admin & allowed addresses', async () => {

            await expect(
                board.connect(user1).whitelistToken(CRV.address)
            ).to.be.revertedWith('QuestBoard: Not allowed')

            await expect(
                board.connect(user2).whitelistToken(DAI.address)
            ).to.be.revertedWith('QuestBoard: Not allowed')

        });

    });


    describe('whitelistMultipleTokens', async () => {

        beforeEach(async () => {

            await board.connect(admin).approveManager(manager.address)

        });

        it(' should whitelist all the tokens (& emit the correct Events)', async () => {

            const tx = board.connect(manager).whitelistMultipleTokens([CRV.address, DAI.address])

            await expect(
                tx
            ).to.emit(board, "WhitelistToken")
                .withArgs(CRV.address);

            await expect(
                tx
            ).to.emit(board, "WhitelistToken")
                .withArgs(DAI.address);

            expect(await board.whitelistedTokens(CRV.address)).to.be.true
            expect(await board.whitelistedTokens(DAI.address)).to.be.true
            expect(await board.whitelistedTokens(otherAddress.address)).to.be.false

        });

        it(' should fail if empty lsit given', async () => {

            await expect(
                board.connect(manager).whitelistMultipleTokens([])
            ).to.be.revertedWith('QuestBoard: empty list')

        });

        it(' should fail if address 0x0 is in the list', async () => {

            await expect(
                board.connect(manager).whitelistMultipleTokens([ethers.constants.AddressZero, DAI.address])
            ).to.be.revertedWith('QuestBoard: Zero Address')

            await expect(
                board.connect(manager).whitelistMultipleTokens([CRV.address, ethers.constants.AddressZero])
            ).to.be.revertedWith('QuestBoard: Zero Address')

        });

        it(' should only be calalble by admin & allowed addresses', async () => {

            await expect(
                board.connect(user1).whitelistMultipleTokens([CRV.address, DAI.address])
            ).to.be.revertedWith('QuestBoard: Not allowed')

            await expect(
                board.connect(user2).whitelistMultipleTokens([CRV.address, DAI.address])
            ).to.be.revertedWith('QuestBoard: Not allowed')

        });

    });


    describe('updateChest', async () => {

        it(' should update the chest address', async () => {

            await board.connect(admin).updateChest(newChest.address)

            expect(await board.questChest()).to.be.eq(newChest.address)

        });

        it(' should fail if address 0x0 is given', async () => {

            await expect(
                board.connect(admin).updateChest(ethers.constants.AddressZero)
            ).to.be.revertedWith('QuestBoard: Zero Address')

        });

        it(' should only be allowed for admin', async () => {

            await expect(
                board.connect(user2).updateChest(newChest.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('updateDistributor', async () => {

        it(' should update the distributor address', async () => {

            await board.connect(admin).updateDistributor(newDistributor.address)

            expect(await board.distributor()).to.be.eq(newDistributor.address)

        });

        it(' should fail if address 0x0 is given', async () => {

            await expect(
                board.connect(admin).updateDistributor(ethers.constants.AddressZero)
            ).to.be.revertedWith('QuestBoard: Zero Address')

        });

        it(' should only be allowed for admin', async () => {

            await expect(
                board.connect(user2).updateDistributor(newDistributor.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('updatePlatformFee', async () => {

        const new_fee = 400

        it(' should update the fee BPS', async () => {

            await board.connect(admin).updatePlatformFee(new_fee)

            expect(await board.platformFee()).to.be.eq(new_fee)

        });

        it(' should fail if given fee is too high', async () => {

            await expect(
                board.connect(admin).updatePlatformFee(1000)
            ).to.be.revertedWith('QuestBoard: Fee too high')

        });

        it(' should only be allowed for admin', async () => {

            await expect(
                board.connect(user2).updatePlatformFee(new_fee)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('updateMinObjective', async () => {

        const new_min = ethers.utils.parseEther('500')

        it(' should update the min objective', async () => {

            await board.connect(admin).updateMinObjective(new_min)

            expect(await board.minObjective()).to.be.eq(new_min)

        });

        it(' should fail if given 0', async () => {

            await expect(
                board.connect(admin).updateMinObjective(0)
            ).to.be.revertedWith('QuestBoard: Null value')

        });

        it(' should only be allowed for admin', async () => {

            await expect(
                board.connect(user2).updateMinObjective(new_min)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('approveManager', async () => {

        it(' should allow the added address as manager', async () => {

            await expect(
                board.connect(manager).whitelistToken(DAI.address)
            ).to.be.revertedWith('QuestBoard: Not allowed')

            await board.connect(admin).approveManager(manager.address)

            await expect(
                board.connect(manager).whitelistToken(DAI.address)
            ).to.not.be.reverted

        });

        it(' should only be allowed for admin', async () => {

            await expect(
                board.connect(manager).approveManager(manager.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                board.connect(manager2).approveManager(manager2.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('removeManager', async () => {

        beforeEach(async () => {

            await board.connect(admin).approveManager(manager.address)
            await board.connect(admin).approveManager(manager2.address)

        });

        it(' should remove the address as manager', async () => {

            await expect(
                board.connect(manager).whitelistToken(DAI.address)
            ).to.not.be.reverted

            await board.connect(admin).removeManager(manager.address)

            await expect(
                board.connect(manager).whitelistToken(CRV.address)
            ).to.be.revertedWith('QuestBoard: Not allowed')

        });

        it(' should not remove other managers', async () => {

            await board.connect(admin).removeManager(manager.address)

            await expect(
                board.connect(manager2).whitelistToken(DAI.address)
            ).to.not.be.reverted

        });

        it(' should only be allowed for admin', async () => {

            await expect(
                board.connect(manager).removeManager(manager.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                board.connect(manager2).removeManager(manager.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('recoverERC20', async () => {

        const lost_amount = ethers.utils.parseEther('1000');

        beforeEach(async () => {

            await DAI.connect(admin).transfer(board.address, lost_amount)

        });


        it(' should retrieve the lost tokens and send it to the admin', async () => {

            const oldBalance = await DAI.balanceOf(admin.address);

            await board.connect(admin).recoverERC20(DAI.address, lost_amount)

            const newBalance = await DAI.balanceOf(admin.address);

            expect(newBalance.sub(oldBalance)).to.be.eq(lost_amount)

        });

        it(' should fail for whitelisted tokens', async () => {

            await board.connect(admin).whitelistToken(DAI.address)

            await expect(
                board.connect(admin).recoverERC20(DAI.address, lost_amount)
            ).to.be.revertedWith('QuestBoard: Cannot recover whitelisted token')

        });

        it(' should block non-admin caller', async () => {

            await expect(
                board.connect(user2).recoverERC20(DAI.address, ethers.utils.parseEther('10'))
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });

});