const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { DarkQuestBoard } from "../typechain/DarkQuestBoard";
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
    resetFork,
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

describe('DarkQuestBoard contract tests', () => {
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

    let voter1: SignerWithAddress
    let voter2: SignerWithAddress
    let voter3: SignerWithAddress

    let receiver: SignerWithAddress

    let newChest: SignerWithAddress
    let newDistributor: SignerWithAddress

    let otherAddress: SignerWithAddress

    let board: DarkQuestBoard
    let distributor: MultiMerkleDistributor
    let controller: MockGaugeController

    let otherDistributor: MultiMerkleDistributor

    let CRV: IERC20
    let DAI: IERC20

    let minCRVAmount = ethers.utils.parseEther("0.0001")
    let minDAIAmount = ethers.utils.parseEther("0.005")

    let BLACKLIST: string[]

    before(async () => {
        await resetFork();
        [admin, mockChest, manager, manager2, creator1, creator2, creator3, gauge1, gauge2, gauge3, user1, user2, voter1, voter2, voter3, receiver, newChest, newDistributor, otherAddress] = await ethers.getSigners();

        BLACKLIST = [voter1.address, voter2.address]

        boardFactory = await ethers.getContractFactory("DarkQuestBoard");

        distributorFactory = await ethers.getContractFactory("MultiMerkleDistributor");

        controllerFactory = await ethers.getContractFactory("MockGaugeController");

        const crv_amount = ethers.utils.parseEther('75000000');
        const dai_amount = ethers.utils.parseEther('90000000');

        CRV = IERC20__factory.connect(TOKEN1_ADDRESS, provider);
        DAI = IERC20__factory.connect(TOKEN2_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER1, CRV, admin.address, crv_amount);

        await getERC20(admin, BIG_HOLDER2, DAI, admin.address, dai_amount);

    })

    beforeEach(async () => {

        controller = (await controllerFactory.connect(admin).deploy()) as MockGaugeController;
        await controller.deployed();

        board = (await boardFactory.connect(admin).deploy(controller.address, mockChest.address)) as DarkQuestBoard;
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

        expect(await board.getCurrentPeriod()).to.be.eq(expected_period)

        expect(await board.isKilled()).to.be.false
        expect(await board.kill_ts()).to.be.eq(0)

        expect(await board.whitelistedTokens(CRV.address)).to.be.false
        expect(await board.whitelistedTokens(DAI.address)).to.be.false

        expect(await board.whitelistedTokens(otherAddress.address)).to.be.false

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
            ).to.be.revertedWith('AlreadyInitialized')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                board.connect(user2).initiateDistributor(distributor.address)
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

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)

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
                total_fees,
                BLACKLIST
            )

            expect(await board.getCurrentPeriod()).to.be.eq(expected_period)

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
                total_fees,
                BLACKLIST
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

            expect(await board.questDistributors(expected_id)).to.be.eq(distributor.address)


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
                total_fees,
                BLACKLIST
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

                expect(quest_period.currentState).to.be.eq(1) // => PeriodState.ACTIVE

                const ids_for_period = await board.getQuestIdsForPeriod(expected_future_period)
                expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(expected_id)
            }

        });

        it(' should have set the correct blacklsit for the Quest', async () => {
            
            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const expected_id = await board.nextID()

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            const create_tx = await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees,
                BLACKLIST
            )

            const quest_blacklist = await board.getQuestBlacklsit(expected_id)

            expect(quest_blacklist[0]).to.be.eq(BLACKLIST[0])
            expect(await board.questBlacklist(expected_id, 0)).to.be.eq(BLACKLIST[0])
            expect(quest_blacklist[1]).to.be.eq(BLACKLIST[1])
            expect(await board.questBlacklist(expected_id, 1)).to.be.eq(BLACKLIST[1])

            await expect(
                create_tx
            ).to.emit(board, "AddVoterBlacklist")
                .withArgs(
                    expected_id,
                    voter1.address
                );

            await expect(
                create_tx
            ).to.emit(board, "AddVoterBlacklist")
                .withArgs(
                    expected_id,
                    voter2.address
                );
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
                total_fees,
                BLACKLIST
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
                total_fees,
                BLACKLIST
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
                total_fees,
                BLACKLIST
            )

            const target_votes2 = ethers.utils.parseEther('1000000')
            const reward_per_vote2 = ethers.utils.parseEther('0.5')

            const rewards_per_period2 = ethers.utils.parseEther('500000')

            const duration2 = 4

            const total_rewards_amount2 = rewards_per_period2.mul(duration2)
            const total_fees2 = total_rewards_amount2.mul(500).div(10000)


            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

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
                total_fees2,
                BLACKLIST
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

        it(' should have the correct data if the distributor is updated', async () => {

            otherDistributor = (await distributorFactory.connect(admin).deploy(board.address)) as MultiMerkleDistributor;
            await otherDistributor.deployed();

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees,
                BLACKLIST
            )


            await board.connect(admin).updateDistributor(otherDistributor.address)

            expect(await board.distributor()).to.be.eq(otherDistributor.address)

            const target_votes2 = ethers.utils.parseEther('1000000')
            const reward_per_vote2 = ethers.utils.parseEther('0.5')

            const rewards_per_period2 = ethers.utils.parseEther('500000')

            const duration2 = 4

            const total_rewards_amount2 = rewards_per_period2.mul(duration2)
            const total_fees2 = total_rewards_amount2.mul(500).div(10000)


            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

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
                total_fees2,
                BLACKLIST
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

            expect(await board.questDistributors(expected_id)).to.be.eq(otherDistributor.address)

            expect(await distributor.questRewardToken(expected_id)).to.be.eq(ethers.constants.AddressZero)
            expect(await otherDistributor.questRewardToken(expected_id)).to.be.eq(CRV.address)

        });

        it(' should fail if no distributor set', async () => {

            let otherBoard = (await boardFactory.connect(admin).deploy(controller.address, mockChest.address)) as DarkQuestBoard;
            await otherBoard.deployed();

            await otherBoard.connect(admin).whitelistToken(DAI.address, minDAIAmount)

            await otherBoard.connect(admin).whitelistToken(DAI.address, minDAIAmount)

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
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('NoDistributorSet')

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
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    ethers.constants.AddressZero,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    0,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('IncorrectDuration')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    ethers.utils.parseEther('50'),
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('ObjectiveTooLow')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    0,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('ObjectiveTooLow')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    0,
                    total_rewards_amount,
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    500000,
                    total_rewards_amount,
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('RewardPerVoteTooLow')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    0,
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    0,
                    BLACKLIST
                )
            ).to.be.revertedWith('NullAmount')

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
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('TokenNotWhitelisted')

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
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('InvalidGauge')

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
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('IncorrectTotalRewardAmount')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    wrong_total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('IncorrectFeeAmount')

        });

        it(' should fail if given an incorrect blacklist', async () => {

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees,
                    [voter1.address, ethers.constants.AddressZero]
                )
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                board.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees,
                    [voter1.address, voter1.address]
                )
            ).to.be.revertedWith('AlreadyBlacklisted')

        });

        it(' should not set a blacklist of given an empty array', async () => {

            const expected_id = await board.nextID()

            await DAI.connect(creator1).approve(board.address, total_rewards_amount.add(total_fees))

            await board.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees,
                []
            )

            const quest_blacklist = await board.getQuestBlacklsit(expected_id)

            expect(quest_blacklist).to.be.empty
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

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)

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
                total_fees,
                BLACKLIST
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

                expect(quest_period.currentState).to.be.eq(1) // => PeriodState.ACTIVE

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

            const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000'), ethers.utils.parseEther('12000')]

            const start_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = start_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
            }

            await advanceTime(WEEK.mul(3).toNumber())

            const periods_list = await board.getAllPeriodsForQuestId(questID)

            const first_period = periods_list[0]
            const second_period = periods_list[1]

            await board.connect(admin).closeQuestPeriod(first_period)
            await board.connect(admin).closeQuestPeriod(second_period)

            const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
            const period_rewards = (await board.periodsByQuest(questID, first_period)).rewardAmountDistributed
            await board.connect(admin).addMerkleRoot(questID, first_period, period_rewards, mockRoot)

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
            ).to.be.revertedWith('InvalidQuestID')

        });

        it(' should fail if Quest is already over', async () => {

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(duration + 2).toNumber())

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    questID,
                    extend_duration,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('ExpiredQuest')

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
            ).to.be.revertedWith('CallerNotAllowed')

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
            ).to.be.revertedWith('IncorrectAddDuration')

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    questID,
                    extend_duration,
                    0,
                    added_total_fees
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    questID,
                    extend_duration,
                    added_total_rewards_amount,
                    0
                )
            ).to.be.revertedWith('NullAmount')

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
            ).to.be.revertedWith('IncorrectAddedRewardAmount')

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    questID,
                    extend_duration,
                    added_total_rewards_amount,
                    wrong_total_fees
                )
            ).to.be.revertedWith('IncorrectFeeAmount')

        });

    });


    describe('increaseQuestReward', async () => {

        const target_votes = ethers.utils.parseEther('150000')
        const reward_per_vote = ethers.utils.parseEther('0.3')

        const rewards_per_period = ethers.utils.parseEther('45000')

        const duration = 6
        const ellapsedDuration = 3
        const remainingDuration = duration - ellapsedDuration + 1

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(500).div(10000)

        const new_reward_per_vote = ethers.utils.parseEther('0.6')
        const new_rewards_per_period = ethers.utils.parseEther('90000')
        const added_total_rewards_amount = new_rewards_per_period.sub(rewards_per_period).mul(remainingDuration)
        const added_total_fees = added_total_rewards_amount.mul(500).div(10000)

        let questID: BigNumber;

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)

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
                total_fees,
                BLACKLIST
            )

            await DAI.connect(admin).transfer(creator1.address, added_total_rewards_amount.add(added_total_fees))

        });

        it(' should update the current and upcoming Periods & not change past Periods (& emit the correct Event)', async () => {

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

            const current_period = await board.getCurrentPeriod()

            await expect(
                increase_tx
            ).to.emit(board, "IncreasedQuestReward")
                .withArgs(
                    questID,
                    current_period,
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

                if (BigNumber.from(quest_period.periodStart).lt(current_period)) {
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

            const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000'), ethers.utils.parseEther('12000')]

            const start_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = start_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
            }

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const periods_list = await board.getAllPeriodsForQuestId(questID)

            const first_period = periods_list[0]
            const second_period = periods_list[1]

            await board.connect(admin).closeQuestPeriod(first_period)
            await board.connect(admin).closeQuestPeriod(second_period)

            const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
            const period_rewards = (await board.periodsByQuest(questID, first_period)).rewardAmountDistributed
            await board.connect(admin).addMerkleRoot(questID, first_period, period_rewards, mockRoot)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            await board.connect(creator1).increaseQuestReward(
                questID,
                new_reward_per_vote,
                added_total_rewards_amount,
                added_total_fees
            )

            const current_period = await board.getCurrentPeriod()

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                let old_quest_period = old_quest_periods[i]

                if (BigNumber.from(quest_period.periodStart).lt(current_period)) {
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
            ).to.be.revertedWith('LowerRewardPerVote')

        });

        it(' should fail if Quest is already over', async () => {

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(duration + 1).toNumber())

            await expect(
                board.connect(creator1).increaseQuestReward(
                    questID,
                    new_reward_per_vote,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('ExpiredQuest')

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
            ).to.be.revertedWith('CallerNotAllowed')

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
            ).to.be.revertedWith('InvalidQuestID')

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
            ).to.be.revertedWith('NullAmount')

            await expect(
                board.connect(creator1).increaseQuestReward(
                    questID,
                    new_reward_per_vote,
                    0,
                    added_total_fees
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                board.connect(creator1).increaseQuestReward(
                    questID,
                    new_reward_per_vote,
                    added_total_rewards_amount,
                    0
                )
            ).to.be.revertedWith('NullAmount')

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
            ).to.be.revertedWith('IncorrectAddedRewardAmount')

            await expect(
                board.connect(creator1).increaseQuestReward(
                    questID,
                    new_reward_per_vote,
                    added_total_rewards_amount,
                    wrong_total_fees
                )
            ).to.be.revertedWith('IncorrectFeeAmount')

        });

    });


    describe('increaseQuestObjective', async () => {

        const target_votes = ethers.utils.parseEther('15000')
        const reward_per_vote = ethers.utils.parseEther('0.3')

        const rewards_per_period = ethers.utils.parseEther('4500')

        const duration = 6
        const ellapsedDuration = 3
        const remainingDuration = duration - ellapsedDuration + 1

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(500).div(10000)

        const new_target_votes = ethers.utils.parseEther('20000')
        const new_rewards_per_period = ethers.utils.parseEther('6000')
        const added_total_rewards_amount = new_rewards_per_period.sub(rewards_per_period).mul(remainingDuration)
        const added_total_fees = added_total_rewards_amount.mul(500).div(10000)

        let questID: BigNumber;

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)

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
                total_fees,
                BLACKLIST
            )

            await DAI.connect(admin).transfer(creator1.address, added_total_rewards_amount.add(added_total_fees))

        });

        it(' should update the current and upcoming Periods & not change past Periods (& emit the correct Event)', async () => {

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

            const current_period = await board.getCurrentPeriod()

            await expect(
                increase_tx
            ).to.emit(board, "IncreasedQuestObjective")
                .withArgs(
                    questID,
                    current_period,
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

                if (BigNumber.from(quest_period.periodStart).lt(current_period)) {
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

            const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000'), ethers.utils.parseEther('12000')]

            const start_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = start_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
            }

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const periods_list = await board.getAllPeriodsForQuestId(questID)

            const first_period = periods_list[0]
            const second_period = periods_list[1]

            await board.connect(admin).closeQuestPeriod(first_period)
            await board.connect(admin).closeQuestPeriod(second_period)

            const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
            const period_rewards = (await board.periodsByQuest(questID, first_period)).rewardAmountDistributed
            await board.connect(admin).addMerkleRoot(questID, first_period, period_rewards, mockRoot)

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            await board.connect(creator1).increaseQuestObjective(
                questID,
                new_target_votes,
                added_total_rewards_amount,
                added_total_fees
            )

            const current_period = await board.getCurrentPeriod()

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID)

            for (let i = 0; i < new_quest_periods.length; i++) {
                let quest_period = new_quest_periods[i]

                let old_quest_period = old_quest_periods[i]

                if (BigNumber.from(quest_period.periodStart).lt(current_period)) {
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
            ).to.be.revertedWith('LowerObjective')

        });

        it(' should fail if Quest is already over', async () => {

            await DAI.connect(creator1).approve(board.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(duration + 1).toNumber())

            await expect(
                board.connect(creator1).increaseQuestObjective(
                    questID,
                    new_target_votes,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('ExpiredQuest')

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
            ).to.be.revertedWith('CallerNotAllowed')

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
            ).to.be.revertedWith('InvalidQuestID')

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
            ).to.be.revertedWith('NullAmount')

            await expect(
                board.connect(creator1).increaseQuestObjective(
                    questID,
                    new_target_votes,
                    added_total_rewards_amount,
                    0
                )
            ).to.be.revertedWith('NullAmount')

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
            ).to.be.revertedWith('IncorrectAddedRewardAmount')

            await expect(
                board.connect(creator1).increaseQuestObjective(
                    questID,
                    new_target_votes,
                    added_total_rewards_amount,
                    wrong_total_fees
                )
            ).to.be.revertedWith('IncorrectFeeAmount')

        });

    });


    describe('getCurrentReducedBias', async () => {

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

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

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
                    total_fees[i],
                    [voter1.address, voter2.address, voter3.address]
                )
            }

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            // mock votes
            await controller.set_user_vote(voter1.address, gauge1.address, first_period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter1.address, gauge2.address, first_period, ethers.utils.parseEther('400'), current_ts.add(WEEK.mul(182)))

            await controller.set_user_vote(voter2.address, gauge2.address, first_period, ethers.utils.parseEther('250'), current_ts.add(WEEK.mul(150)))
            await controller.set_user_vote(voter2.address, gauge3.address, first_period, ethers.utils.parseEther('275'), current_ts.add(WEEK.mul(150)))

            await controller.set_user_vote(voter3.address, gauge1.address, first_period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge2.address, first_period, ethers.utils.parseEther('520'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge3.address, first_period, ethers.utils.parseEther('370'), current_ts.add(WEEK.mul(195)))

            //setup the gauges slopes
            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
                await controller.set_points_weight(gauge3.address, period_end_to_set, gauge3_biases[i])
            }
        });

        const getUserBias = async (voter: string, gauge: string, period: BigNumber): Promise<BigNumber> => {
            const last_user_vote = await controller.last_user_vote(voter, gauge)
            const last_user_slope = (await controller.vote_user_slopes(voter, gauge)).slope
            const user_end = (await controller.vote_user_slopes(voter, gauge)).end

            let user_bias = BigNumber.from(0)

            if(last_user_vote.lte(period) && user_end.gt(period) && !last_user_slope.eq(0)){
                user_bias = last_user_slope.mul(user_end.sub(period))
            }

            return user_bias
        }

        it(' should return the correct value', async () => {
            let user1_bias: BigNumber
            let user2_bias: BigNumber
            let user3_bias: BigNumber

            await advanceTime(WEEK.toNumber())
            
            const next_period = first_period.add(WEEK)

            //Gauge1
            user1_bias = await getUserBias(voter1.address, gauge1.address, next_period)
            user3_bias = await getUserBias(voter3.address, gauge1.address, next_period)

            const expected_reduced_bias_1 = gauge1_biases[0].sub(user1_bias.add(user3_bias))

            expect(await board.getCurrentReducedBias(questIDs[0])).to.be.eq(expected_reduced_bias_1)

            //Gauge2
            user1_bias = await getUserBias(voter1.address, gauge2.address, next_period)
            user2_bias = await getUserBias(voter2.address, gauge2.address, next_period)
            user3_bias = await getUserBias(voter3.address, gauge2.address, next_period)

            const expected_reduced_bias_2 = gauge2_biases[0].sub(user1_bias.add(user2_bias).add(user3_bias))

            expect(await board.getCurrentReducedBias(questIDs[1])).to.be.eq(expected_reduced_bias_2)

            //Gauge3
            user2_bias = await getUserBias(voter2.address, gauge3.address, next_period)
            user3_bias = await getUserBias(voter3.address, gauge3.address, next_period)

            const expected_reduced_bias_3 = gauge3_biases[0].sub(user2_bias.add(user3_bias))

            expect(await board.getCurrentReducedBias(questIDs[2])).to.be.eq(expected_reduced_bias_3)

        });

        it(' should return 0 if reduced bias is > gauge bias', async () => {
            await advanceTime(WEEK.toNumber())

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            await controller.set_user_vote(voter3.address, gauge3.address, first_period, ethers.utils.parseEther('37000'), current_ts.add(WEEK.mul(195)))
            
            await advanceTime(WEEK.toNumber())

            expect(await board.getCurrentReducedBias(questIDs[2])).to.be.eq(0)

        });


    });

    describe('addToBlacklist / addMultipleToBlacklist / removeFromBlacklist', async () => {

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

        let blacklists: string[][]

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address, gauge3.address]
            rewardToken = [DAI, CRV, DAI]

            blacklists = [
                [voter1.address, voter2.address],
                [voter2.address],
                [voter1.address, voter2.address, voter3.address]
            ]

            let creators = [creator1, creator2, creator3]

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

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
                    total_fees[i],
                    blacklists[i]
                )
            }

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            // mock votes
            await controller.set_user_vote(voter1.address, gauge1.address, first_period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter1.address, gauge2.address, first_period, ethers.utils.parseEther('400'), current_ts.add(WEEK.mul(182)))

            await controller.set_user_vote(voter2.address, gauge2.address, first_period, ethers.utils.parseEther('250'), current_ts.add(WEEK.mul(150)))
            await controller.set_user_vote(voter2.address, gauge3.address, first_period, ethers.utils.parseEther('275'), current_ts.add(WEEK.mul(150)))

            await controller.set_user_vote(voter3.address, gauge1.address, first_period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge2.address, first_period, ethers.utils.parseEther('520'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge3.address, first_period, ethers.utils.parseEther('370'), current_ts.add(WEEK.mul(195)))

            //setup the gauges slopes
            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
                await controller.set_points_weight(gauge3.address, period_end_to_set, gauge3_biases[i])
            }
        });

        const getUserBias = async (voter: string, gauge: string, period: BigNumber): Promise<BigNumber> => {
            const last_user_vote = await controller.last_user_vote(voter, gauge)
            const last_user_slope = (await controller.vote_user_slopes(voter, gauge)).slope
            const user_end = (await controller.vote_user_slopes(voter, gauge)).end

            let user_bias = BigNumber.from(0)

            if(last_user_vote.lte(period) && user_end.gt(period) && !last_user_slope.eq(0)){
                user_bias = last_user_slope.mul(user_end.sub(period))
            }

            return user_bias
        }

        it(' should list the new address correctly (& emit correct Event)', async () => {
            
            const add_tx = await board.connect(creator1).addToBlacklist(questIDs[0], voter3.address)

            await expect(
                add_tx
            ).to.emit(board, "AddVoterBlacklist")
                .withArgs(
                    questIDs[0],
                    voter3.address
                );

            const quest_blacklist = await board.getQuestBlacklsit(questIDs[0])

            expect(quest_blacklist[0]).to.be.eq(blacklists[0][0])
            expect(await board.questBlacklist(questIDs[0], 0)).to.be.eq(blacklists[0][0])
            expect(quest_blacklist[1]).to.be.eq(blacklists[0][1])
            expect(await board.questBlacklist(questIDs[0], 1)).to.be.eq(blacklists[0][1])
            expect(quest_blacklist[2]).to.be.eq(voter3.address)
            expect(await board.questBlacklist(questIDs[0], 2)).to.be.eq(voter3.address)

        });

        it(' should list multiple new addresses correctly (& emit correct Event)', async () => {
            
            const add_tx = await board.connect(creator2).addMultipleToBlacklist(questIDs[1], [voter3.address, voter1.address])

            await expect(
                add_tx
            ).to.emit(board, "AddVoterBlacklist")
                .withArgs(
                    questIDs[1],
                    voter3.address
                );

            await expect(
                add_tx
            ).to.emit(board, "AddVoterBlacklist")
                .withArgs(
                    questIDs[1],
                    voter1.address
                );

            const quest_blacklist = await board.getQuestBlacklsit(questIDs[1])

            expect(quest_blacklist[0]).to.be.eq(blacklists[1][0])
            expect(await board.questBlacklist(questIDs[1], 0)).to.be.eq(blacklists[1][0])
            expect(quest_blacklist[1]).to.be.eq(voter3.address)
            expect(await board.questBlacklist(questIDs[1], 1)).to.be.eq(voter3.address)
            expect(quest_blacklist[2]).to.be.eq(voter1.address)
            expect(await board.questBlacklist(questIDs[1], 2)).to.be.eq(voter1.address)

        });

        it(' should remove the address from the list correctly (& emit correct Event)', async () => {
            
            const remove_tx = await board.connect(creator3).removeFromBlacklist(questIDs[2], voter2.address)

            await expect(
                remove_tx
            ).to.emit(board, "RemoveVoterBlacklist")
                .withArgs(
                    questIDs[2],
                    voter2.address
                );

            const quest_blacklist = await board.getQuestBlacklsit(questIDs[2])

            expect(quest_blacklist[0]).to.be.eq(voter1.address)
            expect(await board.questBlacklist(questIDs[2], 0)).to.be.eq(voter1.address)
            expect(quest_blacklist[1]).to.be.eq(voter3.address)
            expect(await board.questBlacklist(questIDs[2], 1)).to.be.eq(voter3.address)

        });

        it(' should not allow to add the same address twice', async () => {
            
            await expect(
                board.connect(creator1).addToBlacklist(questIDs[0], voter2.address)
            ).to.be.revertedWith('AlreadyBlacklisted')

            await expect(
                board.connect(creator2).addMultipleToBlacklist(questIDs[1], [voter2.address, voter1.address])
            ).to.be.revertedWith('AlreadyBlacklisted')

            await expect(
                board.connect(creator2).addMultipleToBlacklist(questIDs[1], [voter3.address, voter3.address])
            ).to.be.revertedWith('AlreadyBlacklisted')

        });

        it(' should not change anything if trying to remove non listed address', async () => {
            
            await board.connect(creator3).removeFromBlacklist(questIDs[2], user1.address)

            const quest_blacklist = await board.getQuestBlacklsit(questIDs[2])

            expect(quest_blacklist[0]).to.be.eq(voter1.address)
            expect(await board.questBlacklist(questIDs[2], 0)).to.be.eq(voter1.address)
            expect(quest_blacklist[1]).to.be.eq(voter2.address)
            expect(await board.questBlacklist(questIDs[2], 1)).to.be.eq(voter2.address)
            expect(quest_blacklist[2]).to.be.eq(voter3.address)
            expect(await board.questBlacklist(questIDs[2], 2)).to.be.eq(voter3.address)

        });

        it(' should fail if given address 0', async () => {
            
            await expect(
                board.connect(creator1).addToBlacklist(questIDs[0], ethers.constants.AddressZero)
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                board.connect(creator2).addMultipleToBlacklist(questIDs[1], [ethers.constants.AddressZero])
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                board.connect(creator2).addMultipleToBlacklist(questIDs[1], [voter3.address, ethers.constants.AddressZero])
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                board.connect(creator3).removeFromBlacklist(questIDs[2], ethers.constants.AddressZero)
            ).to.be.revertedWith('ZeroAddress')
            
        });

        it(' should only be callable by Quest creator', async () => {
            
            await expect(
                board.connect(creator2).addToBlacklist(questIDs[0], voter3.address)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                board.connect(creator3).addMultipleToBlacklist(questIDs[1], [voter3.address, voter1.address])
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                board.connect(creator1).removeFromBlacklist(questIDs[2], voter2.address)
            ).to.be.revertedWith('CallerNotAllowed')

        });

        it(' should fail if Quest does not exist', async () => {

            const incorrectID = questIDs[2].add(1)
            
            await expect(
                board.connect(creator1).addToBlacklist(incorrectID, voter3.address)
            ).to.be.revertedWith('InvalidQuestID')

            await expect(
                board.connect(creator2).addMultipleToBlacklist(incorrectID, [voter3.address, voter1.address])
            ).to.be.revertedWith('InvalidQuestID')

            await expect(
                board.connect(creator3).removeFromBlacklist(incorrectID, voter2.address)
            ).to.be.revertedWith('InvalidQuestID')

        });

        it(' should fail if Quest is expired', async () => {
            
            await advanceTime(WEEK.mul(8).toNumber())

            await expect(
                board.connect(creator1).addToBlacklist(questIDs[0], voter3.address)
            ).to.be.revertedWith('ExpiredQuest')

            await expect(
                board.connect(creator2).addMultipleToBlacklist(questIDs[1], [voter3.address, voter1.address])
            ).to.be.revertedWith('ExpiredQuest')

            await expect(
                board.connect(creator3).removeFromBlacklist(questIDs[2], voter2.address)
            ).to.be.revertedWith('ExpiredQuest')

        });

        it(' should find correct reduced bias - add to blacklist', async () => {

            await advanceTime(WEEK.toNumber())
            
            const next_period = first_period.add(WEEK)

            const bl_bias_sum1 = (await getUserBias(voter1.address, gauge1.address, next_period)).add(
                await getUserBias(voter2.address, gauge1.address, next_period)
            )

            const expected_reduced_bias_1 = gauge1_biases[0].sub(bl_bias_sum1)

            expect(await board.getCurrentReducedBias(questIDs[0])).to.be.eq(expected_reduced_bias_1)

            await board.connect(creator1).addToBlacklist(questIDs[0], voter3.address)

            await advanceTime(WEEK.toNumber())
            
            const next_period2 = next_period.add(WEEK)

            const bl_bias_sum2 = (await getUserBias(voter1.address, gauge1.address, next_period2)).add(
                await getUserBias(voter2.address, gauge1.address, next_period2)
            ).add(
                await getUserBias(voter3.address, gauge1.address, next_period2)
            )

            const expected_reduced_bias_2 = gauge1_biases[1].sub(bl_bias_sum2)

            expect(await board.getCurrentReducedBias(questIDs[0])).to.be.eq(expected_reduced_bias_2)
            

        });

        it(' should find correct reduced bias - remove from blacklist', async () => {
            
            await advanceTime(WEEK.toNumber())
            
            const next_period = first_period.add(WEEK)

            const bl_bias_sum1 = (await getUserBias(voter1.address, gauge3.address, next_period)).add(
                await getUserBias(voter2.address, gauge3.address, next_period)
            ).add(
                await getUserBias(voter3.address, gauge3.address, next_period)
            )

            const expected_reduced_bias_1 = gauge3_biases[0].sub(bl_bias_sum1)

            expect(await board.getCurrentReducedBias(questIDs[2])).to.be.eq(expected_reduced_bias_1)

            await board.connect(creator3).removeFromBlacklist(questIDs[2], voter2.address)

            await advanceTime(WEEK.toNumber())
            
            const next_period2 = next_period.add(WEEK)

            const bl_bias_sum2 = (await getUserBias(voter1.address, gauge3.address, next_period2)).add(
                await getUserBias(voter3.address, gauge3.address, next_period2)
            )

            const expected_reduced_bias_2 = gauge3_biases[1].sub(bl_bias_sum2)

            expect(await board.getCurrentReducedBias(questIDs[2])).to.be.eq(expected_reduced_bias_2)

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

        const getUserBias = async (voter: string, gauge: string, period: BigNumber): Promise<BigNumber> => {
            const last_user_vote = await controller.last_user_vote(voter, gauge)
            const last_user_slope = (await controller.vote_user_slopes(voter, gauge)).slope
            const user_end = (await controller.vote_user_slopes(voter, gauge)).end

            let user_bias = BigNumber.from(0)

            if(last_user_vote.lte(period) && user_end.gt(period) && !last_user_slope.eq(0)){
                user_bias = last_user_slope.mul(user_end.sub(period))
            }

            return user_bias
        }

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address, gauge3.address]
            rewardToken = [DAI, CRV, DAI]

            let creators = [creator1, creator2, creator3]

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

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
                    total_fees[i],
                    BLACKLIST
                )
            }

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            // mock votes
            await controller.set_user_vote(voter1.address, gauge1.address, first_period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter1.address, gauge2.address, first_period, ethers.utils.parseEther('400'), current_ts.add(WEEK.mul(182)))

            await controller.set_user_vote(voter2.address, gauge2.address, first_period, ethers.utils.parseEther('250'), current_ts.add(WEEK.mul(150)))
            await controller.set_user_vote(voter2.address, gauge3.address, first_period, ethers.utils.parseEther('275'), current_ts.add(WEEK.mul(150)))

            await controller.set_user_vote(voter3.address, gauge1.address, first_period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge2.address, first_period, ethers.utils.parseEther('520'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge3.address, first_period, ethers.utils.parseEther('370'), current_ts.add(WEEK.mul(195)))

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

            expect(await board.getCurrentPeriod()).to.be.eq(current_period)

        });

        it(' 1 period - should close the period correctly & update all questPeriods (& emit the correct event)', async () => {
            await advanceTime(WEEK.mul(2).toNumber())

            const close_tx = await board.connect(manager).closeQuestPeriod(first_period)

            for (let i = 0; i < gauges.length; i++) {
                const questPriod_data = await board.periodsByQuest(questIDs[i], first_period)

                // calculate the expected reduced bias, account for it,
                // and check that we got correct data for closed periods
                const next_period = first_period.add(WEEK)
                const reduced_bias = all_biases[i][0].sub(
                    (await getUserBias(BLACKLIST[0], gauges[i], next_period))
                    .add(await getUserBias(BLACKLIST[1], gauges[i], next_period))
                )

                const expected_distribute_amount = reduced_bias.gte(target_votes[i]) ? rewards_per_period[i] : reduced_bias.mul(reward_per_vote[i]).div(UNIT)
                const expected_withdraw_amount = rewards_per_period[i].sub(expected_distribute_amount)

                expect(questPriod_data.currentState).to.be.eq(2)
                expect(questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
                expect(questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

                expect(await distributor.questRewardsPerPeriod(questIDs[i], first_period)).to.be.eq(questPriod_data.rewardAmountDistributed)

                await expect(
                    close_tx
                ).to.emit(rewardToken[i], "Transfer")
                    .withArgs(board.address, distributor.address, expected_distribute_amount);

                await expect(
                    close_tx
                ).to.emit(board, "PeriodClosed")
                    .withArgs(questIDs[i], first_period);

            }

        });

        it(' 1 period - should fail on current active period', async () => {
            await advanceTime(WEEK.toNumber())

            await expect(
                board.connect(manager).closeQuestPeriod(first_period)
            ).to.be.revertedWith('PeriodStillActive')

        });

        it(' multiple period - should close the periods correctly & update all questPeriods for each (& emit the correct event)', async () => {
            await advanceTime(WEEK.mul(4).toNumber())

            const ellapsed_periods = 3

            for (let j = 0; j < ellapsed_periods; j++) {
                let toClose_period = first_period.add(WEEK.mul(j)).div(WEEK).mul(WEEK)

                let close_tx = await board.connect(manager).closeQuestPeriod(toClose_period)

                for (let i = 0; i < gauges.length; i++) {
                    let questPriod_data = await board.periodsByQuest(questIDs[i], toClose_period)

                    // calculate the expected reduced bias, account for it,
                    // and check that we got correct data for closed periods
                    const next_period = toClose_period.add(WEEK)
                    const reduced_bias = all_biases[i][j].sub(
                        (await getUserBias(BLACKLIST[0], gauges[i], next_period))
                        .add(await getUserBias(BLACKLIST[1], gauges[i], next_period))
                    )

                    let expected_distribute_amount = reduced_bias.gte(target_votes[i]) ? rewards_per_period[i] : reduced_bias.mul(reward_per_vote[i]).div(UNIT)
                    let expected_withdraw_amount = rewards_per_period[i].sub(expected_distribute_amount)

                    expect(questPriod_data.currentState).to.be.eq(2)
                    expect(questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
                    expect(questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

                    expect(await distributor.questRewardsPerPeriod(questIDs[i], toClose_period)).to.be.eq(questPriod_data.rewardAmountDistributed)

                    await expect(
                        close_tx
                    ).to.emit(rewardToken[i], "Transfer")
                        .withArgs(board.address, distributor.address, expected_distribute_amount);

                    await expect(
                        close_tx
                    ).to.emit(board, "PeriodClosed")
                        .withArgs(questIDs[i], toClose_period);

                }

            }

        });

        it(' should fail on incorrect period', async () => {
            await advanceTime(WEEK.toNumber())

            await expect(
                board.connect(manager).closeQuestPeriod(0)
            ).to.be.revertedWith('InvalidPeriod')

        });

        it(' should fail on empty period', async () => {
            await advanceTime(WEEK.toNumber())

            let previous_period = first_period.sub(WEEK).div(WEEK).mul(WEEK)

            await expect(
                board.connect(manager).closeQuestPeriod(previous_period)
            ).to.be.revertedWith('EmptyPeriod')

        });

        it(' should fail if no distributor set', async () => {

            let otherBoard = (await boardFactory.connect(admin).deploy(controller.address, mockChest.address)) as DarkQuestBoard;
            await otherBoard.deployed();

            await otherBoard.connect(admin).whitelistToken(DAI.address, minDAIAmount)

            first_period = (await otherBoard.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            await advanceTime(WEEK.mul(2).toNumber())

            await expect(
                otherBoard.connect(admin).closeQuestPeriod(first_period)
            ).to.be.revertedWith('NoDistributorSet')

        });

        it(' should only be allowed for admin and managers', async () => {

            await expect(
                board.connect(manager2).closeQuestPeriod(first_period)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                board.connect(user1).closeQuestPeriod(first_period)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });

    
    describe('closePartOfQuestPeriod', async () => {

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

        let toCloseIDs: BigNumber[] = []; 

        const getUserBias = async (voter: string, gauge: string, period: BigNumber): Promise<BigNumber> => {
            const last_user_vote = await controller.last_user_vote(voter, gauge)
            const last_user_slope = (await controller.vote_user_slopes(voter, gauge)).slope
            const user_end = (await controller.vote_user_slopes(voter, gauge)).end

            let user_bias = BigNumber.from(0)

            if(last_user_vote.lte(period) && user_end.gt(period) && !last_user_slope.eq(0)){
                user_bias = last_user_slope.mul(user_end.sub(period))
            }

            return user_bias
        }

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address, gauge3.address]
            rewardToken = [DAI, CRV, DAI]

            let creators = [creator1, creator2, creator3]

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

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
                    total_fees[i],
                    BLACKLIST
                )
            }

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            // mock votes
            await controller.set_user_vote(voter1.address, gauge1.address, first_period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter1.address, gauge2.address, first_period, ethers.utils.parseEther('400'), current_ts.add(WEEK.mul(182)))

            await controller.set_user_vote(voter2.address, gauge2.address, first_period, ethers.utils.parseEther('250'), current_ts.add(WEEK.mul(150)))
            await controller.set_user_vote(voter2.address, gauge3.address, first_period, ethers.utils.parseEther('275'), current_ts.add(WEEK.mul(150)))

            await controller.set_user_vote(voter3.address, gauge1.address, first_period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge2.address, first_period, ethers.utils.parseEther('520'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge3.address, first_period, ethers.utils.parseEther('370'), current_ts.add(WEEK.mul(195)))

            //setup the gauges slopes
            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
                await controller.set_points_weight(gauge3.address, period_end_to_set, gauge3_biases[i])
            }

            toCloseIDs = [questIDs[0], questIDs[2]]

        });

        it(' 1 period - should update the period', async () => {
            await advanceTime(WEEK.mul(2).toNumber())

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const current_period = current_ts.div(WEEK).mul(WEEK)

            await board.connect(manager).closePartOfQuestPeriod(first_period, toCloseIDs)

            expect(await board.getCurrentPeriod()).to.be.eq(current_period)

        });

        it(' 1 period - should close & update the given questPeriods correctly (& emit the correct event)', async () => {
            await advanceTime(WEEK.mul(2).toNumber())

            const close_tx = await board.connect(manager).closePartOfQuestPeriod(first_period, toCloseIDs)

            for (let i = 0; i < questIDs.length; i++) {
                if(!toCloseIDs.includes(questIDs[i])) continue;

                const questPriod_data = await board.periodsByQuest(questIDs[i], first_period)

                // calculate the expected reduced bias, account for it,
                // and check that we got correct data for closed periods
                const next_period = first_period.add(WEEK)
                const reduced_bias = all_biases[i][0].sub(
                    (await getUserBias(BLACKLIST[0], gauges[i], next_period))
                    .add(await getUserBias(BLACKLIST[1], gauges[i], next_period))
                )

                const expected_distribute_amount = reduced_bias.gte(target_votes[i]) ? rewards_per_period[i] : reduced_bias.mul(reward_per_vote[i]).div(UNIT)
                const expected_withdraw_amount = rewards_per_period[i].sub(expected_distribute_amount)

                expect(questPriod_data.currentState).to.be.eq(2)
                expect(questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
                expect(questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

                expect(await distributor.questRewardsPerPeriod(questIDs[i], first_period)).to.be.eq(questPriod_data.rewardAmountDistributed)

                await expect(
                    close_tx
                ).to.emit(rewardToken[i], "Transfer")
                    .withArgs(board.address, distributor.address, expected_distribute_amount);

                await expect(
                    close_tx
                ).to.emit(board, "PeriodClosed")
                    .withArgs(questIDs[i], first_period);

            }

        });

        it(' 1 period - should not close & update the other questPeriods', async () => {
            await advanceTime(WEEK.mul(2).toNumber())

            await board.connect(manager).closePartOfQuestPeriod(first_period, toCloseIDs)

            const questPriod_data = await board.periodsByQuest(questIDs[1], first_period)

            expect(questPriod_data.currentState).to.be.eq(1)
            expect(questPriod_data.rewardAmountDistributed).to.be.eq(0)
            expect(questPriod_data.withdrawableAmount).to.be.eq(0)

        });

        it(' 1 period - should fail on current active period', async () => {
            await advanceTime(WEEK.toNumber())

            await expect(
                board.connect(manager).closePartOfQuestPeriod(first_period, toCloseIDs)
            ).to.be.revertedWith('PeriodStillActive')

        });

        it(' multiple period - should close & update the given questPeriods correctly for each period (& emit the correct event)', async () => {
            await advanceTime(WEEK.mul(4).toNumber())

            const ellapsed_periods = 3

            for (let j = 0; j < ellapsed_periods; j++) {
                let toClose_period = first_period.add(WEEK.mul(j)).div(WEEK).mul(WEEK)

                let close_tx = await board.connect(manager).closePartOfQuestPeriod(toClose_period, toCloseIDs)

                for (let i = 0; i < gauges.length; i++) {

                    if(!toCloseIDs.includes(questIDs[i])) continue;

                    let questPriod_data = await board.periodsByQuest(questIDs[i], toClose_period)

                    // calculate the expected reduced bias, account for it,
                    // and check that we got correct data for closed periods
                    const next_period = toClose_period.add(WEEK)
                    const reduced_bias = all_biases[i][j].sub(
                        (await getUserBias(BLACKLIST[0], gauges[i], next_period))
                        .add(await getUserBias(BLACKLIST[1], gauges[i], next_period))
                    )

                    let expected_distribute_amount = reduced_bias.gte(target_votes[i]) ? rewards_per_period[i] : reduced_bias.mul(reward_per_vote[i]).div(UNIT)
                    let expected_withdraw_amount = rewards_per_period[i].sub(expected_distribute_amount)

                    expect(questPriod_data.currentState).to.be.eq(2)
                    expect(questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
                    expect(questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

                    expect(await distributor.questRewardsPerPeriod(questIDs[i], toClose_period)).to.be.eq(questPriod_data.rewardAmountDistributed)

                    await expect(
                        close_tx
                    ).to.emit(rewardToken[i], "Transfer")
                        .withArgs(board.address, distributor.address, expected_distribute_amount);

                    await expect(
                        close_tx
                    ).to.emit(board, "PeriodClosed")
                        .withArgs(questIDs[i], toClose_period);
                }

            }

        });

        it(' should fail if empty array is given', async () => {
            await advanceTime(WEEK.toNumber())

            await expect(
                board.connect(manager).closePartOfQuestPeriod(first_period, [])
            ).to.be.revertedWith('EmptyArray')

        });

        it(' should fail on incorrect period', async () => {
            await advanceTime(WEEK.toNumber())

            await expect(
                board.connect(manager).closePartOfQuestPeriod(0, toCloseIDs)
            ).to.be.revertedWith('InvalidPeriod')

        });

        it(' should fail on empty period', async () => {
            await advanceTime(WEEK.toNumber())

            let previous_period = first_period.sub(WEEK).div(WEEK).mul(WEEK)

            await expect(
                board.connect(manager).closePartOfQuestPeriod(previous_period, toCloseIDs)
            ).to.be.revertedWith('EmptyPeriod')

        });

        it(' should fail if no distributor set', async () => {

            let otherBoard = (await boardFactory.connect(admin).deploy(controller.address, mockChest.address)) as DarkQuestBoard;
            await otherBoard.deployed();

            await otherBoard.connect(admin).whitelistToken(DAI.address, minDAIAmount)

            first_period = (await otherBoard.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            await advanceTime(WEEK.mul(2).toNumber())

            await expect(
                otherBoard.connect(admin).closePartOfQuestPeriod(first_period, toCloseIDs)
            ).to.be.revertedWith('NoDistributorSet')

        });

        it(' should only be allowed for admin and managers', async () => {

            await expect(
                board.connect(manager2).closePartOfQuestPeriod(first_period, toCloseIDs)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                board.connect(user1).closePartOfQuestPeriod(first_period, toCloseIDs)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('closeQuestPeriod & closePartOfQuestPeriod', async () => {

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

        let toCloseIDs: BigNumber[] = []; 

        const getUserBias = async (voter: string, gauge: string, period: BigNumber): Promise<BigNumber> => {
            const last_user_vote = await controller.last_user_vote(voter, gauge)
            const last_user_slope = (await controller.vote_user_slopes(voter, gauge)).slope
            const user_end = (await controller.vote_user_slopes(voter, gauge)).end

            let user_bias = BigNumber.from(0)

            if(last_user_vote.lte(period) && user_end.gt(period) && !last_user_slope.eq(0)){
                user_bias = last_user_slope.mul(user_end.sub(period))
            }

            return user_bias
        }

        beforeEach(async () => {

            otherDistributor = (await distributorFactory.connect(admin).deploy(board.address)) as MultiMerkleDistributor;
            await otherDistributor.deployed();

            gauges = [gauge1.address, gauge2.address, gauge3.address]
            rewardToken = [DAI, CRV, DAI]

            let creators = [creator1, creator2, creator3]

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            for (let i = 0; i < gauges.length; i++) {
                rewards_per_period[i] = target_votes[i].mul(reward_per_vote[i]).div(UNIT)
                total_rewards_amount[i] = rewards_per_period[i].mul(duration[i])
                total_fees[i] = total_rewards_amount[i].mul(500).div(10000)

                await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount[i].add(total_fees[i]))
                await rewardToken[i].connect(creators[i]).approve(board.address, 0)
                await rewardToken[i].connect(creators[i]).approve(board.address, total_rewards_amount[i].add(total_fees[i]))

                questIDs[i] = await board.nextID()

                if(i > (gauges.length / 2)){
                    await board.connect(admin).updateDistributor(otherDistributor.address)
                }

                await board.connect(creators[i]).createQuest(
                    gauges[i],
                    rewardToken[i].address,
                    duration[i],
                    target_votes[i],
                    reward_per_vote[i],
                    total_rewards_amount[i],
                    total_fees[i],
                    BLACKLIST
                )
            }

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            // mock votes
            await controller.set_user_vote(voter1.address, gauge1.address, first_period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter1.address, gauge2.address, first_period, ethers.utils.parseEther('400'), current_ts.add(WEEK.mul(182)))

            await controller.set_user_vote(voter2.address, gauge2.address, first_period, ethers.utils.parseEther('250'), current_ts.add(WEEK.mul(150)))
            await controller.set_user_vote(voter2.address, gauge3.address, first_period, ethers.utils.parseEther('275'), current_ts.add(WEEK.mul(150)))

            await controller.set_user_vote(voter3.address, gauge1.address, first_period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge2.address, first_period, ethers.utils.parseEther('520'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge3.address, first_period, ethers.utils.parseEther('370'), current_ts.add(WEEK.mul(195)))

            //setup the gauges slopes
            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
                await controller.set_points_weight(gauge3.address, period_end_to_set, gauge3_biases[i])
            }

            toCloseIDs = [questIDs[0], questIDs[2]]

        });

        it(' should send the rewards to the correct Distributor - closeQuestPeriod', async () => {
            await advanceTime(WEEK.mul(2).toNumber())

            const close_tx = await board.connect(manager).closeQuestPeriod(first_period)

            for (let i = 0; i < gauges.length; i++) {
                const questDistributor = await board.questDistributors(questIDs[i])

                const questPriod_data = await board.periodsByQuest(questIDs[i], first_period)

                // calculate the expected reduced bias, account for it,
                // and check that we got correct data for closed periods
                const next_period = first_period.add(WEEK)
                const reduced_bias = all_biases[i][0].sub(
                    (await getUserBias(BLACKLIST[0], gauges[i], next_period))
                    .add(await getUserBias(BLACKLIST[1], gauges[i], next_period))
                )

                const expected_distribute_amount = reduced_bias.gte(target_votes[i]) ? rewards_per_period[i] : reduced_bias.mul(reward_per_vote[i]).div(UNIT)
                const expected_withdraw_amount = rewards_per_period[i].sub(expected_distribute_amount)

                expect(questPriod_data.currentState).to.be.eq(2)
                expect(questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
                expect(questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

                if(questDistributor == distributor.address) {
                    expect(await distributor.questRewardsPerPeriod(questIDs[i], first_period)).to.be.eq(questPriod_data.rewardAmountDistributed)
                    expect(await otherDistributor.questRewardsPerPeriod(questIDs[i], first_period)).to.be.eq(0)
                }
                else {
                    expect(await distributor.questRewardsPerPeriod(questIDs[i], first_period)).to.be.eq(0)
                    expect(await otherDistributor.questRewardsPerPeriod(questIDs[i], first_period)).to.be.eq(questPriod_data.rewardAmountDistributed)
                }

                await expect(
                    close_tx
                ).to.emit(rewardToken[i], "Transfer")
                    .withArgs(board.address, questDistributor, expected_distribute_amount);

                await expect(
                    close_tx
                ).to.emit(board, "PeriodClosed")
                    .withArgs(questIDs[i], first_period);

            }

        });

        it(' should send the rewards to the correct Distributor - closePartOfQuestPeriod', async () => {
            await advanceTime(WEEK.mul(2).toNumber())

            const close_tx = await board.connect(manager).closePartOfQuestPeriod(first_period, toCloseIDs)

            for (let i = 0; i < questIDs.length; i++) {
                if(!toCloseIDs.includes(questIDs[i])) continue;

                const questDistributor = await board.questDistributors(questIDs[i])

                const questPriod_data = await board.periodsByQuest(questIDs[i], first_period)

                // calculate the expected reduced bias, account for it,
                // and check that we got correct data for closed periods
                const next_period = first_period.add(WEEK)
                const reduced_bias = all_biases[i][0].sub(
                    (await getUserBias(BLACKLIST[0], gauges[i], next_period))
                    .add(await getUserBias(BLACKLIST[1], gauges[i], next_period))
                )

                const expected_distribute_amount = reduced_bias.gte(target_votes[i]) ? rewards_per_period[i] : reduced_bias.mul(reward_per_vote[i]).div(UNIT)
                const expected_withdraw_amount = rewards_per_period[i].sub(expected_distribute_amount)

                expect(questPriod_data.currentState).to.be.eq(2)
                expect(questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
                expect(questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

                if(questDistributor == distributor.address) {
                    expect(await distributor.questRewardsPerPeriod(questIDs[i], first_period)).to.be.eq(questPriod_data.rewardAmountDistributed)
                    expect(await otherDistributor.questRewardsPerPeriod(questIDs[i], first_period)).to.be.eq(0)
                }
                else {
                    expect(await distributor.questRewardsPerPeriod(questIDs[i], first_period)).to.be.eq(0)
                    expect(await otherDistributor.questRewardsPerPeriod(questIDs[i], first_period)).to.be.eq(questPriod_data.rewardAmountDistributed)
                }

                await expect(
                    close_tx
                ).to.emit(rewardToken[i], "Transfer")
                    .withArgs(board.address, questDistributor, expected_distribute_amount);

                await expect(
                    close_tx
                ).to.emit(board, "PeriodClosed")
                    .withArgs(questIDs[i], first_period);

            }

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

        let total_distributed_rewards: BigNumber[] = []

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address, gauge3.address]
            rewardToken = [DAI, CRV, DAI]

            let creators = [creator1, creator2, creator3]

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

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
                    total_fees[i],
                    BLACKLIST
                )
            }

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            // mock votes
            await controller.set_user_vote(voter1.address, gauge1.address, first_period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter1.address, gauge2.address, first_period, ethers.utils.parseEther('400'), current_ts.add(WEEK.mul(182)))

            await controller.set_user_vote(voter2.address, gauge2.address, first_period, ethers.utils.parseEther('250'), current_ts.add(WEEK.mul(150)))
            await controller.set_user_vote(voter2.address, gauge3.address, first_period, ethers.utils.parseEther('275'), current_ts.add(WEEK.mul(150)))

            await controller.set_user_vote(voter3.address, gauge1.address, first_period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge2.address, first_period, ethers.utils.parseEther('520'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge3.address, first_period, ethers.utils.parseEther('370'), current_ts.add(WEEK.mul(195)))

            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
                await controller.set_points_weight(gauge3.address, period_end_to_set, gauge3_biases[i])
            }

            await advanceTime(WEEK.mul(2).toNumber())

            await board.connect(manager).closeQuestPeriod(first_period)

            for (let i = 0; i < questIDs.length; i++) {
                total_distributed_rewards[i] = await distributor.questRewardsPerPeriod(questIDs[i], first_period)
            }

            ID_to_distribute = questIDs[0]

        });

        it(' should set the QuestPeriod as DISTRIBUTED and add the MerkleRoot to the Distributor', async () => {

            await board.connect(manager).addMerkleRoot(ID_to_distribute, first_period, total_distributed_rewards[0], mockRoot)

            expect(await distributor.questMerkleRootPerPeriod(ID_to_distribute, first_period)).to.be.eq(mockRoot)

            expect((await board.periodsByQuest(ID_to_distribute, first_period)).currentState).to.be.eq(3)


        });

        it(' should fail if tried twice', async () => {

            await board.connect(manager).addMerkleRoot(ID_to_distribute, first_period, total_distributed_rewards[0], mockRoot)

            await expect(
                board.connect(manager).addMerkleRoot(ID_to_distribute, first_period, total_distributed_rewards[0], mockRoot)
            ).to.be.reverted

        });

        it(' should fail if empty Merkle Root', async () => {

            await expect(
                board.connect(manager).addMerkleRoot(ID_to_distribute, first_period, total_distributed_rewards[0], "0x0000000000000000000000000000000000000000000000000000000000000000")
            ).to.be.revertedWith('EmptyMerkleRoot')

        });

        it(' should fail if totalAmount is null', async () => {

            await expect(
                board.connect(manager).addMerkleRoot(ID_to_distribute, first_period, 0, mockRoot)
            ).to.be.revertedWith('NullAmount')

        });

        it(' should fail if Quest ID is invalid', async () => {

            const invalid_id = (await board.nextID()).add(15)

            await expect(
                board.connect(manager).addMerkleRoot(invalid_id, first_period, total_distributed_rewards[0], mockRoot)
            ).to.be.revertedWith('InvalidQuestID')

        });

        it(' should fail if period is not CLOSED', async () => {

            const next_period = first_period.add(WEEK).div(WEEK).mul(WEEK)

            await expect(
                board.connect(manager).addMerkleRoot(ID_to_distribute, next_period, total_distributed_rewards[0], mockRoot)
            ).to.be.revertedWith('PeriodNotClosed')

        });

        it(' should only be allowed for admin and managers', async () => {

            await expect(
                board.connect(manager2).addMerkleRoot(ID_to_distribute, first_period, total_distributed_rewards[0], mockRoot)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                board.connect(user1).addMerkleRoot(ID_to_distribute, first_period, total_distributed_rewards[0], mockRoot)
            ).to.be.revertedWith('CallerNotAllowed')

        });

        it(' addMultipleMerkleRoot - should set all QuestPeriod as DISTRIBUTED and add the roots to the Distributor', async () => {

            let mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"
            let mockRoot3 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8ca6"

            const roots = [mockRoot, mockRoot2, mockRoot3]

            await board.connect(manager).addMultipleMerkleRoot(questIDs, first_period, total_distributed_rewards, roots)

            expect(await distributor.questMerkleRootPerPeriod(questIDs[0], first_period)).to.be.eq(roots[0])
            expect(await distributor.questMerkleRootPerPeriod(questIDs[1], first_period)).to.be.eq(roots[1])
            expect(await distributor.questMerkleRootPerPeriod(questIDs[2], first_period)).to.be.eq(roots[2])

            expect((await board.periodsByQuest(questIDs[0], first_period)).currentState).to.be.eq(3)
            expect((await board.periodsByQuest(questIDs[1], first_period)).currentState).to.be.eq(3)
            expect((await board.periodsByQuest(questIDs[2], first_period)).currentState).to.be.eq(3)


        });

        it(' addMultipleMerkleRoot - should fail if given inequal list sizes', async () => {

            let mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"
            let mockRoot3 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8ca6"

            const roots = [mockRoot, mockRoot2]

            await expect(
                board.connect(manager).addMultipleMerkleRoot(questIDs, first_period, total_distributed_rewards, roots)
            ).to.be.revertedWith('InequalArraySizes')

            const rewards = [total_distributed_rewards[0], total_distributed_rewards[1]]
            const correct_roots = [mockRoot, mockRoot2, mockRoot3]

            await expect(
                board.connect(manager).addMultipleMerkleRoot(questIDs, first_period, rewards, correct_roots)
            ).to.be.revertedWith('InequalArraySizes')

        });

        it(' addMultipleMerkleRoot - should only be allowed for admin and managers', async () => {

            let mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"
            let mockRoot3 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8ca6"

            const roots = [mockRoot, mockRoot2, mockRoot3]

            await expect(
                board.connect(manager2).addMultipleMerkleRoot(questIDs, first_period, total_distributed_rewards, roots)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                board.connect(user1).addMultipleMerkleRoot(questIDs, first_period, total_distributed_rewards, roots)
            ).to.be.revertedWith('CallerNotAllowed')

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

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

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
                    total_fees[i],
                    BLACKLIST
                )
            }

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            // mock votes
            await controller.set_user_vote(voter1.address, gauge1.address, first_period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter1.address, gauge2.address, first_period, ethers.utils.parseEther('400'), current_ts.add(WEEK.mul(182)))

            await controller.set_user_vote(voter2.address, gauge2.address, first_period, ethers.utils.parseEther('250'), current_ts.add(WEEK.mul(150)))
            await controller.set_user_vote(voter2.address, gauge3.address, first_period, ethers.utils.parseEther('275'), current_ts.add(WEEK.mul(150)))

            await controller.set_user_vote(voter3.address, gauge1.address, first_period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge2.address, first_period, ethers.utils.parseEther('520'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge3.address, first_period, ethers.utils.parseEther('370'), current_ts.add(WEEK.mul(195)))

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

            const period_rewards1 = (await board.periodsByQuest(questIDs[0], first_period)).rewardAmountDistributed
            const period_rewards2 = (await board.periodsByQuest(questIDs[0], next_period)).rewardAmountDistributed
            const period_rewards3 = (await board.periodsByQuest(questIDs[1], first_period)).rewardAmountDistributed

            await board.connect(manager).addMerkleRoot(questIDs[0], first_period, period_rewards1, mockRoot)
            await board.connect(manager).addMerkleRoot(questIDs[0], next_period, period_rewards2, mockRoot)

            await board.connect(manager).addMerkleRoot(questIDs[1], first_period, period_rewards3, mockRoot2)

        });

        it(' should withdraw all unused rewards for DISTRIBUTED QuestPeriods (& set storage to 0 & emit correct Events)', async () => {

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[0])

            let expected_withdrawable_amount = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods.length; i++) {
                let quest_period = old_quest_periods[i]

                if (quest_period.currentState > 1) {
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

                if (quest_period.currentState > 1) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
            }

        });

        it(' should withdraw all unused rewards for DISTRIBUTED & CLOSED QuestPeriods (& set storage to 0 & emit correct Events)', async () => {

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[1])

            let expected_withdrawable_amount = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods.length; i++) {
                let quest_period = old_quest_periods[i]

                if (quest_period.currentState > 1) {
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

                if (quest_period.currentState > 1) {
                    expect(quest_period.withdrawableAmount).to.be.eq(0) //Should have been set to 0
                }
            }

        });

        it(' should withdraw all rewards if Gauge Slope was 0 for the period (& set storage to 0 & emit correct Events)', async () => {

            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questIDs[2])

            let expected_withdrawable_amount = BigNumber.from(0)

            for (let i = 0; i < old_quest_periods.length; i++) {
                let quest_period = old_quest_periods[i]

                if (quest_period.currentState > 1) {
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

                if (quest_period.currentState > 1) {
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
            ).to.be.revertedWith('InvalidQuestID')

        });

        it(' should fail if caller is not Quest creator', async () => {

            await expect(
                board.connect(creator2).withdrawUnusedRewards(questIDs[0], receiver.address)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                board.connect(user1).withdrawUnusedRewards(questIDs[0], user1.address)
            ).to.be.revertedWith('CallerNotAllowed')

        });

        it(' should fail if given address 0x0 as recipient', async () => {

            await expect(
                board.connect(creator1).withdrawUnusedRewards(questIDs[0], ethers.constants.AddressZero)
            ).to.be.revertedWith('ZeroAddress')

        });

    });


    describe('killBoard', async () => {

        it(' should kill & set the timestamp (& emit the correct Event)', async () => {

            const kill_tx = await board.connect(admin).killBoard()

            const kill_blockNumber = (await kill_tx).blockNumber || 0
            const kill_timestamp = BigNumber.from((await provider.getBlock(kill_blockNumber)).timestamp)

            await expect(
                kill_tx
            ).to.emit(board, "Killed").withArgs(kill_timestamp);

            expect(await board.isKilled()).to.be.true

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
                    total_fees,
                    BLACKLIST
                )
            ).to.be.revertedWith('Killed')

            await expect(
                board.connect(creator1).increaseQuestDuration(
                    0,
                    extend_duration,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('Killed')

            await expect(
                board.connect(creator1).withdrawUnusedRewards(0, receiver.address)
            ).to.be.revertedWith('Killed')

        });

        it(' should not block other methods', async () => {

            await board.connect(admin).killBoard()

            await expect(
                board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            ).to.not.be.reverted

        });

        it(' should not be killable twice', async () => {

            await board.connect(admin).killBoard()

            expect(await board.isKilled()).to.be.true

            await expect(
                board.connect(admin).killBoard()
            ).to.be.revertedWith('AlreadyKilled')

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

            const unkill_tx = await board.connect(admin).unkillBoard()

            const unkill_blockNumber = (await unkill_tx).blockNumber || 0
            const unkill_timestamp = BigNumber.from((await provider.getBlock(unkill_blockNumber)).timestamp)

            await expect(
                unkill_tx
            ).to.emit(board, "Unkilled").withArgs(unkill_timestamp);

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

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)

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
                    total_fees,
                    BLACKLIST
                )
            ).to.not.be.reverted

        });

        it(' should fail if board was not killed', async () => {

            await expect(
                board.connect(admin).unkillBoard()
            ).to.be.revertedWith('NotKilled')

        });

        it(' should only be possible before delay is over', async () => {

            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            await expect(
                board.connect(admin).unkillBoard()
            ).to.be.revertedWith('KillDelayExpired')

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

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

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
                    total_fees[i],
                    BLACKLIST
                )
            }

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            // mock votes
            await controller.set_user_vote(voter1.address, gauge1.address, first_period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter1.address, gauge2.address, first_period, ethers.utils.parseEther('400'), current_ts.add(WEEK.mul(182)))

            await controller.set_user_vote(voter2.address, gauge2.address, first_period, ethers.utils.parseEther('250'), current_ts.add(WEEK.mul(150)))
            await controller.set_user_vote(voter2.address, gauge3.address, first_period, ethers.utils.parseEther('275'), current_ts.add(WEEK.mul(150)))

            await controller.set_user_vote(voter3.address, gauge1.address, first_period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge2.address, first_period, ethers.utils.parseEther('520'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge3.address, first_period, ethers.utils.parseEther('370'), current_ts.add(WEEK.mul(195)))

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

            const period_rewards1 = (await board.periodsByQuest(questIDs[0], first_period)).rewardAmountDistributed
            const period_rewards2 = (await board.periodsByQuest(questIDs[0], next_period)).rewardAmountDistributed
            const period_rewards3 = (await board.periodsByQuest(questIDs[1], first_period)).rewardAmountDistributed

            await board.connect(manager).addMerkleRoot(questIDs[0], first_period, period_rewards1, mockRoot)
            await board.connect(manager).addMerkleRoot(questIDs[0], next_period, period_rewards2, mockRoot)

            await board.connect(manager).addMerkleRoot(questIDs[1], first_period, period_rewards3, mockRoot2)

        });

        it(' should fail if Board is not killed & should wait for delay', async () => {

            await expect(
                board.connect(creator1).emergencyWithdraw(questIDs[0], user1.address)
            ).to.be.revertedWith('NotKilled')

            await board.connect(admin).killBoard()

            await expect(
                board.connect(creator1).emergencyWithdraw(questIDs[0], user1.address)
            ).to.be.revertedWith('KillDelayNotExpired')

        });

        it(' should emergency withdraw all unused rewards for DISTRIBUTED QuestPeriods & all rewards for ACTIVE QuestPeriods (& set storage to 0 & emit correct Events)', async () => {

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

                if (quest_period.currentState > 1) {
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

                if (quest_period.currentState > 1) {
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

                if (quest_period.currentState > 1) {
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

                if (quest_period.currentState > 1) {
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

                if (quest_period.currentState > 1) {
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
            ).to.be.revertedWith('InvalidQuestID')

        });

        it(' should fail if caller is not Quest creator', async () => {

            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            await expect(
                board.connect(creator2).emergencyWithdraw(questIDs[0], receiver.address)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                board.connect(user1).emergencyWithdraw(questIDs[0], user1.address)
            ).to.be.revertedWith('CallerNotAllowed')

        });

        it(' should fail if given address 0x0 as recipient', async () => {

            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            await expect(
                board.connect(creator1).emergencyWithdraw(questIDs[0], ethers.constants.AddressZero)
            ).to.be.revertedWith('ZeroAddress')

        });

    });


    describe('whitelistToken', async () => {

        beforeEach(async () => {

            await board.connect(admin).approveManager(manager.address)

        });

        it(' should add the token (& emit the correct Event)', async () => {

            await expect(
                board.connect(manager).whitelistToken(CRV.address, minCRVAmount)
            ).to.emit(board, "WhitelistToken")
                .withArgs(CRV.address, minCRVAmount);

            expect(await board.whitelistedTokens(CRV.address)).to.be.true
            expect(await board.whitelistedTokens(DAI.address)).to.be.false
            expect(await board.whitelistedTokens(otherAddress.address)).to.be.false

            expect(await board.minRewardPerVotePerToken(CRV.address)).to.be.eq(minCRVAmount)
            expect(await board.minRewardPerVotePerToken(DAI.address)).to.be.eq(0)

            await expect(
                board.connect(manager).whitelistToken(DAI.address, minDAIAmount)
            ).to.emit(board, "WhitelistToken")
                .withArgs(DAI.address, minDAIAmount);

            expect(await board.whitelistedTokens(CRV.address)).to.be.true
            expect(await board.whitelistedTokens(DAI.address)).to.be.true
            expect(await board.whitelistedTokens(otherAddress.address)).to.be.false

            expect(await board.minRewardPerVotePerToken(CRV.address)).to.be.eq(minCRVAmount)
            expect(await board.minRewardPerVotePerToken(DAI.address)).to.be.eq(minDAIAmount)

        });

        it(' should fail if given 0 value', async () => {

            await expect(
                board.connect(manager).whitelistToken(CRV.address, 0)
            ).to.be.revertedWith('InvalidParameter')

        });

        it(' should fail if given address 0x0', async () => {

            await expect(
                board.connect(manager).whitelistToken(ethers.constants.AddressZero, 100)
            ).to.be.revertedWith('ZeroAddress')

        });

        it(' should only be calalble by admin & allowed addresses', async () => {

            await expect(
                board.connect(user1).whitelistToken(CRV.address, minCRVAmount)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                board.connect(user2).whitelistToken(DAI.address, minDAIAmount)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('whitelistMultipleTokens', async () => {

        beforeEach(async () => {

            await board.connect(admin).approveManager(manager.address)

        });

        it(' should whitelist all the tokens (& emit the correct Events)', async () => {

            const tx = board.connect(manager).whitelistMultipleTokens([CRV.address, DAI.address], [minCRVAmount, minDAIAmount])

            await expect(
                tx
            ).to.emit(board, "WhitelistToken")
                .withArgs(CRV.address, minCRVAmount);

            await expect(
                tx
            ).to.emit(board, "WhitelistToken")
                .withArgs(DAI.address, minDAIAmount);

            expect(await board.whitelistedTokens(CRV.address)).to.be.true
            expect(await board.whitelistedTokens(DAI.address)).to.be.true
            expect(await board.whitelistedTokens(otherAddress.address)).to.be.false

        });

        it(' should fail if empty list given', async () => {

            await expect(
                board.connect(manager).whitelistMultipleTokens([], [])
            ).to.be.revertedWith('EmptyArray')

        });

        it(' should fail if inequal lists given', async () => {

            await expect(
                board.connect(manager).whitelistMultipleTokens([CRV.address, DAI.address], [minCRVAmount])
            ).to.be.revertedWith('InequalArraySizes')

        });

        it(' should fail if address 0x0 is in the list', async () => {

            await expect(
                board.connect(manager).whitelistMultipleTokens([ethers.constants.AddressZero, DAI.address], [minCRVAmount, minDAIAmount])
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                board.connect(manager).whitelistMultipleTokens([CRV.address, ethers.constants.AddressZero], [minCRVAmount, minDAIAmount])
            ).to.be.revertedWith('ZeroAddress')

        });

        it(' should only be calalble by admin & allowed addresses', async () => {

            await expect(
                board.connect(user1).whitelistMultipleTokens([CRV.address, DAI.address], [minCRVAmount, minDAIAmount])
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                board.connect(user2).whitelistMultipleTokens([CRV.address, DAI.address], [minCRVAmount, minDAIAmount])
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });

    describe('fixQuestPeriodBias', async () => {

        let gauges: string[] = []
        let rewardToken: IERC20[] = []

        const target_votes = [ethers.utils.parseEther('15000'), ethers.utils.parseEther('25000'), ethers.utils.parseEther('8000')]
        const reward_per_vote = [ethers.utils.parseEther('2'), ethers.utils.parseEther('1.5'), ethers.utils.parseEther('0.5')]
        const duration = [6, 4, 7]

        let questIDs: BigNumber[] = [];

        const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000')]
        const gauge2_biases = [ethers.utils.parseEther('18000'), ethers.utils.parseEther('25000')]
        const gauge3_biases = [ethers.utils.parseEther('10000'), ethers.utils.parseEther('11000')]

        let first_period: BigNumber;

        let rewards_per_period: BigNumber[] = []
        let total_rewards_amount: BigNumber[] = []
        let total_fees: BigNumber[] = []

        let total_distributed_rewards: BigNumber[] = []

        const new_bias = ethers.utils.parseEther('5500')
        const new_bias2 = ethers.utils.parseEther('21000')
        const new_bias3 = ethers.utils.parseEther('17500')

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address, gauge3.address]
            rewardToken = [DAI, CRV, DAI]

            let creators = [creator1, creator2, creator3]

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)
            await controller.add_gauge(gauge3.address, 2)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

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
                    total_fees[i],
                    BLACKLIST
                )
            }

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            // mock votes
            await controller.set_user_vote(voter1.address, gauge1.address, first_period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter1.address, gauge2.address, first_period, ethers.utils.parseEther('400'), current_ts.add(WEEK.mul(182)))

            await controller.set_user_vote(voter2.address, gauge2.address, first_period, ethers.utils.parseEther('250'), current_ts.add(WEEK.mul(150)))
            await controller.set_user_vote(voter2.address, gauge3.address, first_period, ethers.utils.parseEther('275'), current_ts.add(WEEK.mul(150)))

            await controller.set_user_vote(voter3.address, gauge1.address, first_period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge2.address, first_period, ethers.utils.parseEther('520'), current_ts.add(WEEK.mul(195)))
            await controller.set_user_vote(voter3.address, gauge3.address, first_period, ethers.utils.parseEther('370'), current_ts.add(WEEK.mul(195)))

            for (let i = 0; i < gauge1_biases.length; i++) {
                let period_end_to_set = first_period.add(WEEK.mul(i + 1)).div(WEEK).mul(WEEK)

                await controller.set_points_weight(gauge1.address, period_end_to_set, gauge1_biases[i])
                await controller.set_points_weight(gauge2.address, period_end_to_set, gauge2_biases[i])
                await controller.set_points_weight(gauge3.address, period_end_to_set, gauge3_biases[i])
            }

            await advanceTime(WEEK.mul(2).toNumber())

            await board.connect(manager).closeQuestPeriod(first_period)

            for (let i = 0; i < questIDs.length; i++) {
                total_distributed_rewards[i] = await distributor.questRewardsPerPeriod(questIDs[i], first_period)
            }

        });

        it(' should take the new bias and reduce the rewards to distribute (& send them back)', async () => { 

            const old_board_balance = await DAI.balanceOf(board.address)
            const old_distributor_balance = await DAI.balanceOf(distributor.address)

            const old_distributed_amount = (await board.periodsByQuest(questIDs[0], first_period)).rewardAmountDistributed

            const fix_tx = await board.connect(admin).fixQuestPeriodBias(first_period, questIDs[0], new_bias)

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_distributor_balance = await DAI.balanceOf(distributor.address)

            const new_questPriod_data = await board.periodsByQuest(questIDs[0], first_period)
            const expected_distribute_amount = new_bias.mul(reward_per_vote[0]).div(UNIT)
            const expected_withdraw_amount = rewards_per_period[0].sub(expected_distribute_amount)

            expect(new_questPriod_data.currentState).to.be.eq(2)
            expect(new_questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
            expect(new_questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

            const reward_diff = old_distributed_amount.sub(expected_distribute_amount)

            expect(new_board_balance).to.be.eq(old_board_balance.add(reward_diff))
            expect(new_distributor_balance).to.be.eq(old_distributor_balance.sub(reward_diff))

            await expect(
                fix_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(distributor.address, board.address, reward_diff);

            await expect(
                fix_tx
            ).to.emit(board, "PeriodBiasFixed")
                .withArgs(first_period, questIDs[0], new_bias);

        });

        it(' should take the new bias and increase the rewards to distribute (& send them to distributor)', async () => {

            const old_board_balance = await CRV.balanceOf(board.address)
            const old_distributor_balance = await CRV.balanceOf(distributor.address)

            const old_distributed_amount = (await board.periodsByQuest(questIDs[1], first_period)).rewardAmountDistributed

            const fix_tx = await board.connect(admin).fixQuestPeriodBias(first_period, questIDs[1], new_bias2)

            const new_board_balance = await CRV.balanceOf(board.address)
            const new_distributor_balance = await CRV.balanceOf(distributor.address)

            const new_questPriod_data = await board.periodsByQuest(questIDs[1], first_period)
            const expected_distribute_amount = new_bias2.mul(reward_per_vote[1]).div(UNIT)
            const expected_withdraw_amount = rewards_per_period[1].sub(expected_distribute_amount)

            expect(new_questPriod_data.currentState).to.be.eq(2)
            expect(new_questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
            expect(new_questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

            const reward_diff = expected_distribute_amount.sub(old_distributed_amount)

            expect(new_board_balance).to.be.eq(old_board_balance.sub(reward_diff))
            expect(new_distributor_balance).to.be.eq(old_distributor_balance.add(reward_diff))

            await expect(
                fix_tx
            ).to.emit(CRV, "Transfer")
                .withArgs(board.address, distributor.address, reward_diff);

            await expect(
                fix_tx
            ).to.emit(board, "PeriodBiasFixed")
                .withArgs(first_period, questIDs[1], new_bias2);
        });

        it(' should take the new bias and increase the rewards to distribute (& send them back) - set new bias over objective', async () => { 
            
            const old_board_balance = await DAI.balanceOf(board.address)
            const old_distributor_balance = await DAI.balanceOf(distributor.address)

            const old_distributed_amount = (await board.periodsByQuest(questIDs[0], first_period)).rewardAmountDistributed

            const fix_tx = await board.connect(admin).fixQuestPeriodBias(first_period, questIDs[0], new_bias3)

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_distributor_balance = await DAI.balanceOf(distributor.address)

            const new_questPriod_data = await board.periodsByQuest(questIDs[0], first_period)
            const expected_distribute_amount = rewards_per_period[0]
            const expected_withdraw_amount = rewards_per_period[0].sub(expected_distribute_amount)

            expect(new_questPriod_data.currentState).to.be.eq(2)
            expect(new_questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
            expect(new_questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

            const reward_diff = expected_distribute_amount.sub(old_distributed_amount)

            expect(new_board_balance).to.be.eq(old_board_balance.sub(reward_diff))
            expect(new_distributor_balance).to.be.eq(old_distributor_balance.add(reward_diff))

            await expect(
                fix_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(board.address, distributor.address, reward_diff);

            await expect(
                fix_tx
            ).to.emit(board, "PeriodBiasFixed")
                .withArgs(first_period, questIDs[0], new_bias3);
            
        });

        it(' should take the new bias and reduce the rewards to distribute (& send them to distributor) - set new bias to 0', async () => {

            const zero_bias = BigNumber.from(0)

            const old_board_balance = await DAI.balanceOf(board.address)
            const old_distributor_balance = await DAI.balanceOf(distributor.address)

            const old_distributed_amount = (await board.periodsByQuest(questIDs[0], first_period)).rewardAmountDistributed

            const fix_tx = await board.connect(admin).fixQuestPeriodBias(first_period, questIDs[0], zero_bias)

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_distributor_balance = await DAI.balanceOf(distributor.address)

            const new_questPriod_data = await board.periodsByQuest(questIDs[0], first_period)
            const expected_distribute_amount = BigNumber.from(0)
            const expected_withdraw_amount = rewards_per_period[0].sub(expected_distribute_amount)

            expect(new_questPriod_data.currentState).to.be.eq(2)
            expect(new_questPriod_data.rewardAmountDistributed).to.be.eq(expected_distribute_amount)
            expect(new_questPriod_data.withdrawableAmount).to.be.eq(expected_withdraw_amount)

            const reward_diff = old_distributed_amount.sub(expected_distribute_amount)

            expect(new_board_balance).to.be.eq(old_board_balance.add(reward_diff))
            expect(new_distributor_balance).to.be.eq(old_distributor_balance.sub(reward_diff))

            await expect(
                fix_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(distributor.address, board.address, reward_diff);

            await expect(
                fix_tx
            ).to.emit(board, "PeriodBiasFixed")
                .withArgs(first_period, questIDs[0], zero_bias);

        });

        it(' should fail if incorrect Quest', async () => {

            const incorrectID = questIDs[2].add(2)

            await expect(
                board.connect(admin).fixQuestPeriodBias(first_period, incorrectID, new_bias)
            ).to.be.revertedWith('InvalidQuestID')

        });

        it(' should fail if incorrect period', async () => {

            await expect(
                board.connect(admin).fixQuestPeriodBias(0, questIDs[0], new_bias)
            ).to.be.revertedWith('InvalidPeriod')

            await expect(
                board.connect(admin).fixQuestPeriodBias(first_period.sub(WEEK), questIDs[0], new_bias)
            ).to.be.revertedWith('PeriodNotClosed')

            await expect(
                board.connect(admin).fixQuestPeriodBias(first_period.add(WEEK), questIDs[0], new_bias)
            ).to.be.revertedWith('PeriodNotClosed')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                board.connect(creator1).fixQuestPeriodBias(first_period, questIDs[0], new_bias)
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                board.connect(manager).fixQuestPeriodBias(first_period, questIDs[0], new_bias)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('updateRewardToken', async () => {

        let newMinCRVAmount = ethers.utils.parseEther("0.002")

        beforeEach(async () => {

            await board.connect(admin).approveManager(manager.address)

            await board.connect(manager).whitelistToken(CRV.address, minCRVAmount)

        });

        it(' should update the token minPricePerVote (& emit the correct Event)', async () => {

            await expect(
                board.connect(manager).updateRewardToken(CRV.address, newMinCRVAmount)
            ).to.emit(board, "UpdateRewardToken")
                .withArgs(CRV.address, newMinCRVAmount);

            expect(await board.minRewardPerVotePerToken(CRV.address)).to.be.eq(newMinCRVAmount)

        });

        it(' should fail if given 0 value', async () => {

            await expect(
                board.connect(manager).updateRewardToken(CRV.address, 0)
            ).to.be.revertedWith('InvalidParameter')

        });

        it(' should fail if given token is not whitelisted', async () => {

            await expect(
                board.connect(manager).updateRewardToken(DAI.address, 100)
            ).to.be.revertedWith('TokenNotWhitelisted')

        });

        it(' should only be calalble by admin & allowed addresses', async () => {

            await expect(
                board.connect(user1).updateRewardToken(CRV.address, newMinCRVAmount)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                board.connect(user2).updateRewardToken(DAI.address, newMinCRVAmount)
            ).to.be.revertedWith('CallerNotAllowed')

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
            ).to.be.revertedWith('ZeroAddress')

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
            ).to.be.revertedWith('ZeroAddress')

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
            ).to.be.revertedWith('InvalidParameter')

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
            ).to.be.revertedWith('InvalidParameter')

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
                board.connect(manager).whitelistToken(DAI.address, minDAIAmount)
            ).to.be.revertedWith('CallerNotAllowed')

            await board.connect(admin).approveManager(manager.address)

            await expect(
                board.connect(manager).whitelistToken(DAI.address, minDAIAmount)
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
                board.connect(manager).whitelistToken(DAI.address, minDAIAmount)
            ).to.not.be.reverted

            await board.connect(admin).removeManager(manager.address)

            await expect(
                board.connect(manager).whitelistToken(CRV.address, minCRVAmount)
            ).to.be.revertedWith('CallerNotAllowed')

        });

        it(' should not remove other managers', async () => {

            await board.connect(admin).removeManager(manager.address)

            await expect(
                board.connect(manager2).whitelistToken(DAI.address, minDAIAmount)
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

            await board.connect(admin).recoverERC20(DAI.address)

            const newBalance = await DAI.balanceOf(admin.address);

            expect(newBalance.sub(oldBalance)).to.be.eq(lost_amount)

        });

        it(' should fail for whitelisted tokens', async () => {

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)

            await expect(
                board.connect(admin).recoverERC20(DAI.address)
            ).to.be.revertedWith('CannotRecoverToken')

        });

        it(' should block non-admin caller', async () => {

            await expect(
                board.connect(user2).recoverERC20(DAI.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });

});