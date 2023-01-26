const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { LightQuestBoard } from "../typechain/LightQuestBoard";
import { MultiMerkleDistributor } from "../typechain/MultiMerkleDistributor";
import { IGaugeController } from "../typechain/IGaugeController";
import { IERC20 } from "../typechain/IERC20";
import { IERC20__factory } from "../typechain/factories/IERC20__factory";
import { IGaugeController__factory } from "../typechain/factories/IGaugeController__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import {
    advanceTime,
    getERC20,
    resetFork
} from "./utils/utils";

require("dotenv").config();

let constants_path = "./utils/constant" // by default: veCRV

const VE_TOKEN = process.env.VE_TOKEN ? String(process.env.VE_TOKEN) : "VECRV";
if(VE_TOKEN === "VEBAL") constants_path = "./utils/balancer-constant"
if(VE_TOKEN === "VELIT") constants_path = "./utils/lit-constant"

const { 
    TOKEN1_ADDRESS,
    BIG_HOLDER1,
    TOKEN2_ADDRESS,
    BIG_HOLDER2, 
    TOKEN1_AMOUNT,
    TOKEN2_AMOUNT,
    GAUGE_CONTROLLER,
    GAUGES,
    LIGHT_TARGET_VOTES,
    GAUGE_VOTER,
    BLOCK_NUMBER
} = require(constants_path);

chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;

let boardFactory: ContractFactory
let distributorFactory: ContractFactory

const WEEK = BigNumber.from(86400 * 7)
const UNIT = ethers.utils.parseEther('1')

describe('LightQuestBoard & GaugeController interaction tests - ' + VE_TOKEN + ' version', () => {
    let admin: SignerWithAddress

    let mockChest: SignerWithAddress

    let manager: SignerWithAddress

    let creator1: SignerWithAddress
    let creator2: SignerWithAddress
    let creator3: SignerWithAddress

    let user1: SignerWithAddress
    let user2: SignerWithAddress

    let fakeGauge: SignerWithAddress

    let receiver: SignerWithAddress

    let board: LightQuestBoard
    let distributor: MultiMerkleDistributor
    let controller: IGaugeController

    let token1: IERC20
    let token2: IERC20

    let minToken1Amount = ethers.utils.parseEther("0.0001")
    let minToken2Amount = ethers.utils.parseEther("0.005")

    before(async () => {
        await resetFork(BLOCK_NUMBER);

        [admin, mockChest, manager, creator1, creator2, creator3, fakeGauge, user1, user2, receiver] = await ethers.getSigners();

        boardFactory = await ethers.getContractFactory("LightQuestBoard");

        distributorFactory = await ethers.getContractFactory("MultiMerkleDistributor");

        token1 = IERC20__factory.connect(TOKEN1_ADDRESS, provider);
        token2 = IERC20__factory.connect(TOKEN2_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER1, token1, admin.address, TOKEN1_AMOUNT);

        await getERC20(admin, BIG_HOLDER2, token2, admin.address, TOKEN2_AMOUNT);

    })

    beforeEach(async () => {

        controller = IGaugeController__factory.connect(GAUGE_CONTROLLER, provider);

        board = (await boardFactory.connect(admin).deploy(controller.address, GAUGE_VOTER, mockChest.address)) as LightQuestBoard;
        await board.deployed();

        distributor = (await distributorFactory.connect(admin).deploy(board.address)) as MultiMerkleDistributor;
        await distributor.deployed();

    });

    const getVoterBias = async (voter: string, gauge: string, period: BigNumber): Promise<BigNumber> => {
        const last_user_vote = await controller.last_user_vote(voter, gauge)
        const last_user_slope = (await controller.vote_user_slopes(voter, gauge)).slope
        const user_end = (await controller.vote_user_slopes(voter, gauge)).end

        let user_bias = BigNumber.from(0)

        if(last_user_vote.lte(period) && user_end.gt(period) && !last_user_slope.eq(0)){
            user_bias = last_user_slope.mul(user_end.sub(period))
        }

        return user_bias
    }

    describe('Interactions with GaugeController', async () => {

        let rewardToken: IERC20[] = []

        let creators: SignerWithAddress[] = []

        const reward_per_vote = [ethers.utils.parseEther('0.02'), ethers.utils.parseEther('0.35'), ethers.utils.parseEther('0.005')]
        const duration = [6, 4, 7]

        let questIDs: BigNumber[] = [];

        let first_period: BigNumber;

        beforeEach(async () => {
            rewardToken = [token1, token2, token1]

            creators = [creator1, creator2, creator3]

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(token1.address, minToken1Amount)
            await board.connect(admin).whitelistToken(token2.address, minToken2Amount)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

        });

        it(' should allow to create Quests correctly', async () => {

            let i = 0;
            let create_tx;
            let current_ts;
            let expected_period;
            let block_number;

            let quest_data
            let quest_periods
            let periods

            let rewards_per_period;
            let total_rewards_amount;
            let total_fees;

            let old_board_balance
            let old_chest_balance
            let new_board_balance
            let new_chest_balance

            // ---------------------------------

            rewards_per_period = LIGHT_TARGET_VOTES[i].mul(reward_per_vote[i]).div(UNIT)
            total_rewards_amount = rewards_per_period.mul(duration[i])
            total_fees = total_rewards_amount.mul(400).div(10000)

            await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount.add(total_fees))
            await rewardToken[i].connect(creators[i]).approve(board.address, 0)
            await rewardToken[i].connect(creators[i]).approve(board.address, total_rewards_amount.add(total_fees))

            questIDs[i] = await board.nextID()

            old_board_balance = await rewardToken[i].balanceOf(board.address)
            old_chest_balance = await rewardToken[i].balanceOf(mockChest.address)

            block_number = await provider.getBlockNumber()
            current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)
            expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            create_tx = await board.connect(creators[i]).createQuest(
                GAUGES[i],
                rewardToken[i].address,
                duration[i],
                LIGHT_TARGET_VOTES[i],
                reward_per_vote[i],
                total_rewards_amount,
                total_fees
            )

            await expect(
                create_tx
            ).to.emit(board, "NewQuest")
                .withArgs(
                    questIDs[i],
                    creators[i].address,
                    GAUGES[i],
                    rewardToken[i].address,
                    duration[i],
                    expected_period,
                    LIGHT_TARGET_VOTES[i],
                    reward_per_vote[i]
                );

            expect(await board.nextID()).to.be.eq(questIDs[i].add(1))

            quest_data = await board.quests(questIDs[i])
    
            expect(quest_data.creator).to.be.eq(creators[i].address)
            expect(quest_data.rewardToken).to.be.eq(rewardToken[i].address)
            expect(quest_data.gauge).to.be.eq(GAUGES[i])
            expect(quest_data.duration).to.be.eq(duration[i])
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount)
            expect(quest_data.periodStart).to.be.eq(expected_period)
    
            expect(await board.questDistributors(questIDs[i])).to.be.eq(distributor.address)
    
            periods = await board.getAllPeriodsForQuestId(questIDs[i])
            expect(periods.length).to.be.eq(duration[i])

            quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[i])
    
            for (let j = 0; j < quest_periods.length; j++) {

                expect(periods[j]).to.be.eq(expected_period.add(WEEK.mul(j)).div(WEEK).mul(WEEK))

                let quest_period = quest_periods[j]
                let expected_future_period = expected_period.add(WEEK.mul(j)).div(WEEK).mul(WEEK)

                expect(quest_period.periodStart).to.be.eq(expected_future_period)
                expect(quest_period.rewardAmountPerPeriod).to.be.eq(rewards_per_period)
                expect(quest_period.rewardPerVote).to.be.eq(reward_per_vote[i])
                expect(quest_period.objectiveVotes).to.be.eq(LIGHT_TARGET_VOTES[i])
                expect(quest_period.rewardAmountDistributed).to.be.eq(0)
                expect(quest_period.withdrawableAmount).to.be.eq(0)

                expect(quest_period.currentState).to.be.eq(1) // => PeriodState.ACTIVE

                const ids_for_period = await board.getQuestIdsForPeriod(expected_future_period)
                expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questIDs[i])
            }

            await expect(
                create_tx
            ).to.emit(distributor, "NewQuest")
                .withArgs(questIDs[i], rewardToken[i].address);

            expect(await distributor.questRewardToken(questIDs[i])).to.be.eq(rewardToken[i].address)

            await expect(
                create_tx
            ).to.emit(rewardToken[i], "Transfer")
                .withArgs(creators[i].address, board.address, total_rewards_amount);

            await expect(
                create_tx
            ).to.emit(rewardToken[i], "Transfer")
                .withArgs(creators[i].address, mockChest.address, total_fees);

            new_board_balance = await rewardToken[i].balanceOf(board.address)
            new_chest_balance = await rewardToken[i].balanceOf(mockChest.address)

            expect(new_board_balance).to.be.eq(old_board_balance.add(total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(total_fees))


            // ---------------------------------

            i = 1

            rewards_per_period = LIGHT_TARGET_VOTES[i].mul(reward_per_vote[i]).div(UNIT)
            total_rewards_amount = rewards_per_period.mul(duration[i])
            total_fees = total_rewards_amount.mul(400).div(10000)

            await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount.add(total_fees))
            await rewardToken[i].connect(creators[i]).approve(board.address, 0)
            await rewardToken[i].connect(creators[i]).approve(board.address, total_rewards_amount.add(total_fees))

            questIDs[i] = await board.nextID()

            old_board_balance = await rewardToken[i].balanceOf(board.address)
            old_chest_balance = await rewardToken[i].balanceOf(mockChest.address)

            block_number = await provider.getBlockNumber()
            current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)
            expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            create_tx = await board.connect(creators[i]).createQuest(
                GAUGES[i],
                rewardToken[i].address,
                duration[i],
                LIGHT_TARGET_VOTES[i],
                reward_per_vote[i],
                total_rewards_amount,
                total_fees
            )

            await expect(
                create_tx
            ).to.emit(board, "NewQuest")
                .withArgs(
                    questIDs[i],
                    creators[i].address,
                    GAUGES[i],
                    rewardToken[i].address,
                    duration[i],
                    expected_period,
                    LIGHT_TARGET_VOTES[i],
                    reward_per_vote[i]
                );

            expect(await board.nextID()).to.be.eq(questIDs[i].add(1))

            quest_data = await board.quests(questIDs[i])
    
            expect(quest_data.creator).to.be.eq(creators[i].address)
            expect(quest_data.rewardToken).to.be.eq(rewardToken[i].address)
            expect(quest_data.gauge).to.be.eq(GAUGES[i])
            expect(quest_data.duration).to.be.eq(duration[i])
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount)
            expect(quest_data.periodStart).to.be.eq(expected_period)
    
            expect(await board.questDistributors(questIDs[i])).to.be.eq(distributor.address)
    
    
            periods = await board.getAllPeriodsForQuestId(questIDs[i])
            expect(periods.length).to.be.eq(duration[i])

            quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[i])
    
            for (let j = 0; j < quest_periods.length; j++) {
                expect(periods[j]).to.be.eq(expected_period.add(WEEK.mul(j)).div(WEEK).mul(WEEK))

                let quest_period = quest_periods[j]
                let expected_future_period = expected_period.add(WEEK.mul(j)).div(WEEK).mul(WEEK)

                expect(quest_period.periodStart).to.be.eq(expected_future_period)
                expect(quest_period.rewardAmountPerPeriod).to.be.eq(rewards_per_period)
                expect(quest_period.rewardPerVote).to.be.eq(reward_per_vote[i])
                expect(quest_period.objectiveVotes).to.be.eq(LIGHT_TARGET_VOTES[i])
                expect(quest_period.rewardAmountDistributed).to.be.eq(0)
                expect(quest_period.withdrawableAmount).to.be.eq(0)

                expect(quest_period.currentState).to.be.eq(1) // => PeriodState.ACTIVE

                const ids_for_period = await board.getQuestIdsForPeriod(expected_future_period)
                expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questIDs[i])
            }

            await expect(
                create_tx
            ).to.emit(distributor, "NewQuest")
                .withArgs(questIDs[i], rewardToken[i].address);

            expect(await distributor.questRewardToken(questIDs[i])).to.be.eq(rewardToken[i].address)

            await expect(
                create_tx
            ).to.emit(rewardToken[i], "Transfer")
                .withArgs(creators[i].address, board.address, total_rewards_amount);

            await expect(
                create_tx
            ).to.emit(rewardToken[i], "Transfer")
                .withArgs(creators[i].address, mockChest.address, total_fees);

            new_board_balance = await rewardToken[i].balanceOf(board.address)
            new_chest_balance = await rewardToken[i].balanceOf(mockChest.address)

            expect(new_board_balance).to.be.eq(old_board_balance.add(total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(total_fees))

            // ---------------------------------

            i = 2

            rewards_per_period = LIGHT_TARGET_VOTES[i].mul(reward_per_vote[i]).div(UNIT)
            total_rewards_amount = rewards_per_period.mul(duration[i])
            total_fees = total_rewards_amount.mul(400).div(10000)

            await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount.add(total_fees))
            await rewardToken[i].connect(creators[i]).approve(board.address, 0)
            await rewardToken[i].connect(creators[i]).approve(board.address, total_rewards_amount.add(total_fees))

            questIDs[i] = await board.nextID()

            old_board_balance = await rewardToken[i].balanceOf(board.address)
            old_chest_balance = await rewardToken[i].balanceOf(mockChest.address)

            block_number = await provider.getBlockNumber()
            current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)
            expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            create_tx = await board.connect(creators[i]).createQuest(
                GAUGES[i],
                rewardToken[i].address,
                duration[i],
                LIGHT_TARGET_VOTES[i],
                reward_per_vote[i],
                total_rewards_amount,
                total_fees
            )

            await expect(
                create_tx
            ).to.emit(board, "NewQuest")
                .withArgs(
                    questIDs[i],
                    creators[i].address,
                    GAUGES[i],
                    rewardToken[i].address,
                    duration[i],
                    expected_period,
                    LIGHT_TARGET_VOTES[i],
                    reward_per_vote[i]
                );

            expect(await board.nextID()).to.be.eq(questIDs[i].add(1))

            quest_data = await board.quests(questIDs[i])
    
            expect(quest_data.creator).to.be.eq(creators[i].address)
            expect(quest_data.rewardToken).to.be.eq(rewardToken[i].address)
            expect(quest_data.gauge).to.be.eq(GAUGES[i])
            expect(quest_data.duration).to.be.eq(duration[i])
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount)
            expect(quest_data.periodStart).to.be.eq(expected_period)
    
            expect(await board.questDistributors(questIDs[i])).to.be.eq(distributor.address)
    
    
            periods = await board.getAllPeriodsForQuestId(questIDs[i])
            expect(periods.length).to.be.eq(duration[i])

            quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[i])
    
            for (let j = 0; j < quest_periods.length; j++) {
                expect(periods[j]).to.be.eq(expected_period.add(WEEK.mul(j)).div(WEEK).mul(WEEK))

                let quest_period = quest_periods[j]
                let expected_future_period = expected_period.add(WEEK.mul(j)).div(WEEK).mul(WEEK)

                expect(quest_period.periodStart).to.be.eq(expected_future_period)
                expect(quest_period.rewardAmountPerPeriod).to.be.eq(rewards_per_period)
                expect(quest_period.rewardPerVote).to.be.eq(reward_per_vote[i])
                expect(quest_period.objectiveVotes).to.be.eq(LIGHT_TARGET_VOTES[i])
                expect(quest_period.rewardAmountDistributed).to.be.eq(0)
                expect(quest_period.withdrawableAmount).to.be.eq(0)

                expect(quest_period.currentState).to.be.eq(1) // => PeriodState.ACTIVE

                const ids_for_period = await board.getQuestIdsForPeriod(expected_future_period)
                expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questIDs[i])
            }

            await expect(
                create_tx
            ).to.emit(distributor, "NewQuest")
                .withArgs(questIDs[i], rewardToken[i].address);

            expect(await distributor.questRewardToken(questIDs[i])).to.be.eq(rewardToken[i].address)

            await expect(
                create_tx
            ).to.emit(rewardToken[i], "Transfer")
                .withArgs(creators[i].address, board.address, total_rewards_amount);

            await expect(
                create_tx
            ).to.emit(rewardToken[i], "Transfer")
                .withArgs(creators[i].address, mockChest.address, total_fees);

            new_board_balance = await rewardToken[i].balanceOf(board.address)
            new_chest_balance = await rewardToken[i].balanceOf(mockChest.address)

            expect(new_board_balance).to.be.eq(old_board_balance.add(total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(total_fees))

        });

        it(' should fail if Gauge not listed', async () => {

            let i = 0;

            let rewards_per_period = LIGHT_TARGET_VOTES[i].mul(reward_per_vote[i]).div(UNIT)
            let total_rewards_amount = rewards_per_period.mul(duration[i])
            let total_fees = total_rewards_amount.mul(400).div(10000)

            await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount.add(total_fees))
            await rewardToken[i].connect(creators[i]).approve(board.address, 0)
            await rewardToken[i].connect(creators[i]).approve(board.address, total_rewards_amount.add(total_fees))

            questIDs[i] = await board.nextID()

            await expect(
                board.connect(creators[i]).createQuest(
                    fakeGauge.address,
                    rewardToken[i].address,
                    duration[i],
                    LIGHT_TARGET_VOTES[i],
                    reward_per_vote[i],
                    total_rewards_amount,
                    total_fees
                )
            ).to.be.reverted

        });

        it(' should close 1 period correctly for all Quests', async () => {

            let rewards_per_period: BigNumber[] = []
            let total_rewards_amount: BigNumber[] = []
            let total_fees: BigNumber[] = []

            for (let i = 0; i < GAUGES.length; i++) {
                rewards_per_period[i] = LIGHT_TARGET_VOTES[i].mul(reward_per_vote[i]).div(UNIT)
                total_rewards_amount[i] = rewards_per_period[i].mul(duration[i])
                total_fees[i] = total_rewards_amount[i].mul(400).div(10000)

                await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount[i].add(total_fees[i]))
                await rewardToken[i].connect(creators[i]).approve(board.address, 0)
                await rewardToken[i].connect(creators[i]).approve(board.address, total_rewards_amount[i].add(total_fees[i]))

                questIDs[i] = await board.nextID()

                await board.connect(creators[i]).createQuest(
                    GAUGES[i],
                    rewardToken[i].address,
                    duration[i],
                    LIGHT_TARGET_VOTES[i],
                    reward_per_vote[i],
                    total_rewards_amount[i],
                    total_fees[i]
                )
            }

            await advanceTime(WEEK.mul(2).toNumber())

            const close_tx = await board.connect(manager).closeQuestPeriod(first_period)

            for (let i = 0; i < GAUGES.length; i++) {
                const questPriod_data = await board.periodsByQuest(questIDs[i], first_period)

                await controller.connect(admin).checkpoint_gauge(GAUGES[i]);
                const next_period = first_period.add(WEEK)
                const voterBias = await getVoterBias(GAUGE_VOTER, GAUGES[i], next_period)

                const expected_distribute_amount = voterBias.gte(LIGHT_TARGET_VOTES[i]) ? rewards_per_period[i] : voterBias.mul(reward_per_vote[i]).div(UNIT)
                const expected_withdraw_amount = rewards_per_period[i].sub(expected_distribute_amount)

                expect(questPriod_data.currentState).to.be.eq(2)
                expect(questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
                expect(questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

                expect(await distributor.questRewardsPerPeriod(questIDs[i], first_period)).to.be.eq(questPriod_data.rewardAmountDistributed)

                if(!expected_distribute_amount.eq(0)){
                    await expect(
                        close_tx
                    ).to.emit(rewardToken[i], "Transfer")
                        .withArgs(board.address, distributor.address, expected_distribute_amount);
                }

                await expect(
                    close_tx
                ).to.emit(board, "PeriodClosed")
                    .withArgs(questIDs[i], first_period);

            }

        });

        it(' should close multiple periods correctly for all Quests', async () => {

            let rewards_per_period: BigNumber[] = []
            let total_rewards_amount: BigNumber[] = []
            let total_fees: BigNumber[] = []

            for (let i = 0; i < GAUGES.length; i++) {
                rewards_per_period[i] = LIGHT_TARGET_VOTES[i].mul(reward_per_vote[i]).div(UNIT)
                total_rewards_amount[i] = rewards_per_period[i].mul(duration[i])
                total_fees[i] = total_rewards_amount[i].mul(400).div(10000)

                await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount[i].add(total_fees[i]))
                await rewardToken[i].connect(creators[i]).approve(board.address, 0)
                await rewardToken[i].connect(creators[i]).approve(board.address, total_rewards_amount[i].add(total_fees[i]))

                questIDs[i] = await board.nextID()

                await board.connect(creators[i]).createQuest(
                    GAUGES[i],
                    rewardToken[i].address,
                    duration[i],
                    LIGHT_TARGET_VOTES[i],
                    reward_per_vote[i],
                    total_rewards_amount[i],
                    total_fees[i]
                )
            }

            await advanceTime(WEEK.mul(2).toNumber())

            let current_period = first_period
            let close_tx = await board.connect(manager).closeQuestPeriod(current_period)

            for (let i = 0; i < GAUGES.length; i++) {
                const questPriod_data = await board.periodsByQuest(questIDs[i], current_period)

                await controller.connect(admin).checkpoint_gauge(GAUGES[i]);
                const next_period = current_period.add(WEEK)
                const voterBias = await getVoterBias(GAUGE_VOTER, GAUGES[i], next_period)

                const expected_distribute_amount = voterBias.gte(LIGHT_TARGET_VOTES[i]) ? rewards_per_period[i] : voterBias.mul(reward_per_vote[i]).div(UNIT)
                const expected_withdraw_amount = rewards_per_period[i].sub(expected_distribute_amount)

                expect(questPriod_data.currentState).to.be.eq(2)
                expect(questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
                expect(questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

                expect(await distributor.questRewardsPerPeriod(questIDs[i], current_period)).to.be.eq(questPriod_data.rewardAmountDistributed)

                if(!expected_distribute_amount.eq(0)){
                    await expect(
                        close_tx
                    ).to.emit(rewardToken[i], "Transfer")
                        .withArgs(board.address, distributor.address, expected_distribute_amount);
                }

                await expect(
                    close_tx
                ).to.emit(board, "PeriodClosed")
                    .withArgs(questIDs[i], current_period);

            }

            await advanceTime(WEEK.toNumber())

            current_period = current_period.add(WEEK)
            close_tx = await board.connect(manager).closeQuestPeriod(current_period)

            for (let i = 0; i < GAUGES.length; i++) {
                const questPriod_data = await board.periodsByQuest(questIDs[i], current_period)

                await controller.connect(admin).checkpoint_gauge(GAUGES[i]);
                const next_period = current_period.add(WEEK)
                const voterBias = await getVoterBias(GAUGE_VOTER, GAUGES[i], next_period)

                const expected_distribute_amount = voterBias.gte(LIGHT_TARGET_VOTES[i]) ? rewards_per_period[i] : voterBias.mul(reward_per_vote[i]).div(UNIT)
                const expected_withdraw_amount = rewards_per_period[i].sub(expected_distribute_amount)

                expect(questPriod_data.currentState).to.be.eq(2)
                expect(questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
                expect(questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

                expect(await distributor.questRewardsPerPeriod(questIDs[i], current_period)).to.be.eq(questPriod_data.rewardAmountDistributed)

                if(!expected_distribute_amount.eq(0)){
                    await expect(
                        close_tx
                    ).to.emit(rewardToken[i], "Transfer")
                        .withArgs(board.address, distributor.address, expected_distribute_amount);
                }

                await expect(
                    close_tx
                ).to.emit(board, "PeriodClosed")
                    .withArgs(questIDs[i], current_period);

            }

        });

    });

});
