const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { DarkQuestBoard } from "../../typechain/DarkQuestBoard";
import { DarkQuestPartner } from "../../typechain/DarkQuestPartner";
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
let partnerWrapperFactory: ContractFactory
let distributorFactory: ContractFactory
let controllerFactory: ContractFactory
let chestFactory: ContractFactory

const WEEK = BigNumber.from(86400 * 7)
const UNIT = ethers.utils.parseEther('1')


describe('DarkQuestPartner contract tests', () => {
    let admin: SignerWithAddress

    let partner: SignerWithAddress
    let partner_feesReceiver: SignerWithAddress

    let gauge1: SignerWithAddress
    let gauge2: SignerWithAddress

    let manager: SignerWithAddress

    let creator1: SignerWithAddress
    let creator2: SignerWithAddress

    let user1: SignerWithAddress
    let user2: SignerWithAddress
    let user3: SignerWithAddress

    let voter1: SignerWithAddress
    let voter2: SignerWithAddress
    let voter3: SignerWithAddress

    let receiver: SignerWithAddress

    let board: DarkQuestBoard
    let partnerWrapper: DarkQuestPartner
    let distributor: MultiMerkleDistributor
    let controller: MockGaugeController
    let chest: QuestTreasureChest

    let CRV: IERC20
    let DAI: IERC20

    let minCRVAmount = ethers.utils.parseEther("0.0001")
    let minDAIAmount = ethers.utils.parseEther("0.005")

    let partner_share = BigNumber.from('5000')

    before(async () => {
        await resetFork();

        [admin, partner, partner_feesReceiver, manager, creator1, creator2, gauge1, gauge2, receiver, user1, user2, user3, voter1, voter2, voter3] = await ethers.getSigners();

        boardFactory = await ethers.getContractFactory("DarkQuestBoard");

        partnerWrapperFactory = await ethers.getContractFactory("DarkQuestPartner");

        distributorFactory = await ethers.getContractFactory("MultiMerkleDistributor");

        controllerFactory = await ethers.getContractFactory("MockGaugeController");

        chestFactory = await ethers.getContractFactory("QuestTreasureChest");

        const crv_amount = ethers.utils.parseEther('75000000');
        const dai_amount = ethers.utils.parseEther('80000000');

        CRV = IERC20__factory.connect(TOKEN1_ADDRESS, provider);
        DAI = IERC20__factory.connect(TOKEN2_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER1, CRV, admin.address, crv_amount);

        await getERC20(admin, BIG_HOLDER2, DAI, admin.address, dai_amount);

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

        partnerWrapper = (await partnerWrapperFactory.connect(admin).deploy(
            board.address,
            chest.address,
            partner.address,
            partner_feesReceiver.address,
            partner_share
        )) as DarkQuestPartner;
        await partnerWrapper.deployed();

    });

    it(' should be deployed & have correct parameters', async () => {
        expect(partnerWrapper.address).to.properAddress

        expect(await partnerWrapper.board()).to.be.eq(board.address)
        expect(await partnerWrapper.chest()).to.be.eq(chest.address)
        expect(await partnerWrapper.partner()).to.be.eq(partner.address)
        expect(await partnerWrapper.feesReceiver()).to.be.eq(partner_feesReceiver.address)
        expect(await partnerWrapper.partnerShare()).to.be.eq(partner_share)

    });


    describe('createQuest', async () => {

        const target_votes = ethers.utils.parseEther('150000')
        const reward_per_vote = ethers.utils.parseEther('6')
        const target_votes2 = ethers.utils.parseEther('1000000')
        const reward_per_vote2 = ethers.utils.parseEther('0.5')

        const rewards_per_period = ethers.utils.parseEther('900000')
        const rewards_per_period2 = ethers.utils.parseEther('500000')

        const duration = 4
        const duration2 = 2

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(400).div(10000)
        const total_rewards_amount2 = rewards_per_period2.mul(duration2)
        const total_fees2 = total_rewards_amount2.mul(400).div(10000)

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await chest.connect(admin).approveManager(partnerWrapper.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))
            await CRV.connect(admin).transfer(creator2.address, total_rewards_amount2.add(total_fees2))

            await DAI.connect(creator1).approve(partnerWrapper.address, total_rewards_amount.add(total_fees))
            //await CRV.connect(creator2).approve(partnerWrapper.address, total_rewards_amount2.add(total_fees2))

        });

        it(' should create the Quest correctly', async () => {

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            const expected_period = current_ts.add(WEEK).div(WEEK).mul(WEEK)

            const expected_id = await board.nextID()

            const create_tx = await partnerWrapper.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees,
                [voter1.address, voter2.address]
            )

            expect(await board.nextID()).to.be.eq(expected_id.add(1))

            const quest_data = await board.quests(expected_id)

            expect(quest_data.creator).to.be.eq(partnerWrapper.address)
            expect(quest_data.rewardToken).to.be.eq(DAI.address)
            expect(quest_data.gauge).to.be.eq(gauge1.address)
            expect(quest_data.duration).to.be.eq(duration)
            expect(quest_data.totalRewardAmount).to.be.eq(total_rewards_amount)
            expect(quest_data.periodStart).to.be.eq(expected_period)

            expect(await board.questDistributors(expected_id)).to.be.eq(distributor.address)


            const periods = await board.getAllPeriodsForQuestId(expected_id)
            expect(periods.length).to.be.eq(duration)

            for (let i = 0; i < duration; i++) {
                expect(periods[i]).to.be.eq(expected_period.add(WEEK.mul(i)).div(WEEK).mul(WEEK))
            }

            const ids_for_period = await board.getQuestIdsForPeriod(expected_period)
            expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(expected_id)

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

            const quest_blacklist = await board.getQuestBlacklsit(expected_id)

            expect(quest_blacklist[0]).to.be.eq(voter1.address)
            expect(await board.questBlacklist(expected_id, 0)).to.be.eq(voter1.address)
            expect(quest_blacklist[1]).to.be.eq(voter2.address)
            expect(await board.questBlacklist(expected_id, 1)).to.be.eq(voter2.address)

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

        it(' should list the Quest correctly (& emit the correct Event)', async () => {

            const expected_id = await board.nextID()

            const create_tx = await partnerWrapper.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees,
                [voter1.address, voter2.address]
            )

            expect(await board.nextID()).to.be.eq(expected_id.add(1))

            await expect(
                create_tx
            ).to.emit(partnerWrapper, "NewPartnerQuest")
                .withArgs(expected_id, creator1.address);

            expect(await partnerWrapper.creators(expected_id)).to.be.eq(creator1.address)

            expect(await partnerWrapper.rewardTokens(expected_id)).to.be.eq(DAI.address)

        });

        it(' should send the correct share to partner', async () => {

            const old_board_balance = await DAI.balanceOf(board.address)
            const old_chest_balance = await DAI.balanceOf(chest.address)
            const old_partner_recevier_balance = await DAI.balanceOf(partner_feesReceiver.address)

            const partner_share_amount = total_fees.mul(partner_share).div(10000)

            const create_tx = await partnerWrapper.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees,
                [voter1.address, voter2.address]
            )

            await expect(
                create_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, partnerWrapper.address, total_rewards_amount.add(total_fees));

            await expect(
                create_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(partnerWrapper.address, board.address, total_rewards_amount);

            await expect(
                create_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(partnerWrapper.address, chest.address, total_fees);

            await expect(
                    create_tx
                ).to.emit(DAI, "Transfer")
                    .withArgs(chest.address, partner_feesReceiver.address, partner_share_amount);

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_chest_balance = await DAI.balanceOf(chest.address)
            const new_partner_recevier_balance = await DAI.balanceOf(partner_feesReceiver.address)

            expect(new_board_balance).to.be.eq(old_board_balance.add(total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(total_fees.sub(partner_share_amount)))
            expect(new_partner_recevier_balance).to.be.eq(old_partner_recevier_balance.add(partner_share_amount))

        });

        it(' should fail if partner wrapper is not approved maanger for the Chest', async () => {

            await chest.connect(admin).removeManager(partnerWrapper.address)

            await expect(
                partnerWrapper.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees,
                    [voter1.address, voter2.address]
                )
            ).to.be.revertedWith('CallerNotAllowed')

        });

        it(' should fail if token not approved', async () => {

            await expect(
                partnerWrapper.connect(creator2).createQuest(
                    gauge2.address,
                    CRV.address,
                    duration2,
                    target_votes2,
                    reward_per_vote2,
                    total_rewards_amount2,
                    total_fees2,
                    [voter1.address, voter2.address]
                )
            ).to.be.reverted

        });

        it(' should fail if given incorrect parameters', async () => {

            await expect(
                partnerWrapper.connect(creator1).createQuest(
                    ethers.constants.AddressZero,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees,
                    [voter1.address, voter2.address]
                )
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                partnerWrapper.connect(creator1).createQuest(
                    gauge1.address,
                    ethers.constants.AddressZero,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees,
                    [voter1.address, voter2.address]
                )
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                partnerWrapper.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    0,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees,
                    [voter1.address, voter2.address]
                )
            ).to.be.revertedWith('IncorrectDuration')

            await expect(
                partnerWrapper.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    0,
                    total_rewards_amount,
                    total_fees,
                    [voter1.address, voter2.address]
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                partnerWrapper.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    0,
                    total_fees,
                    [voter1.address, voter2.address]
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                partnerWrapper.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    0,
                    [voter1.address, voter2.address]
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                partnerWrapper.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount.div(2),
                    total_fees,
                    [voter1.address, voter2.address]
                )
            ).to.be.revertedWith('IncorrectTotalRewardAmount')

        });

    });


    describe('increaseQuestDuration', async () => {

        const target_votes = ethers.utils.parseEther('15000')
        const reward_per_vote = ethers.utils.parseEther('0.3')

        const rewards_per_period = ethers.utils.parseEther('4500')

        const target_votes2 = ethers.utils.parseEther('30000')
        const reward_per_vote2 = ethers.utils.parseEther('0.5')

        const rewards_per_period2 = ethers.utils.parseEther('15000')

        const duration = 4
        const duration2 = 2

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(400).div(10000)
        const total_rewards_amount2 = rewards_per_period2.mul(duration2)
        const total_fees2 = total_rewards_amount2.mul(400).div(10000)

        const extend_duration = 3
        const added_total_rewards_amount = rewards_per_period.mul(extend_duration)
        const added_total_fees = added_total_rewards_amount.mul(400).div(10000)

        let questID1: BigNumber;
        let questID2: BigNumber;

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await chest.connect(admin).approveManager(partnerWrapper.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))
            await CRV.connect(admin).transfer(creator2.address, total_rewards_amount2.add(total_fees2))

            await DAI.connect(creator1).approve(partnerWrapper.address, total_rewards_amount.add(total_fees))
            await CRV.connect(creator2).approve(board.address, total_rewards_amount2.add(total_fees2))

            questID1 = await board.nextID()

            await partnerWrapper.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees,
                [voter1.address, voter2.address]
            )

            questID2 = await board.nextID()

            await board.connect(creator2).createQuest(
                gauge2.address,
                CRV.address,
                duration2,
                target_votes2,
                reward_per_vote2,
                total_rewards_amount2,
                total_fees2,
                [voter1.address, voter2.address]
            )

            await DAI.connect(admin).transfer(creator1.address, added_total_rewards_amount.add(added_total_fees))

        });

        it(' should increase correctly', async () => {

            await DAI.connect(creator1).approve(partnerWrapper.address, added_total_rewards_amount.add(added_total_fees))

            const old_periods_length = (await board.getAllPeriodsForQuestId(questID1)).length
            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID1)

            const increase_tx = await partnerWrapper.connect(creator1).increaseQuestDuration(
                questID1,
                extend_duration,
                added_total_rewards_amount,
                added_total_fees
            )

            await expect(
                increase_tx
            ).to.emit(board, "IncreasedQuestDuration")
                .withArgs(
                    questID1,
                    extend_duration,
                    added_total_rewards_amount
                );

            const new_periods_length = (await board.getAllPeriodsForQuestId(questID1)).length

            expect(new_periods_length).to.be.eq(old_periods_length + extend_duration)

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID1)

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
                expect(ids_for_period[ids_for_period.length - 1]).to.be.eq(questID1)
            }

        });

        it(' should only be callable by the creator of the Quest', async () => {

            await expect(
                partnerWrapper.connect(creator2).increaseQuestDuration(
                    questID1,
                    extend_duration,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('CallerNotAllowed')

        });

        it(' should send the correct share to partner', async () => {

            const old_board_balance = await DAI.balanceOf(board.address)
            const old_chest_balance = await DAI.balanceOf(chest.address)
            const old_partner_recevier_balance = await DAI.balanceOf(partner_feesReceiver.address)

            const partner_share_amount = added_total_fees.mul(partner_share).div(10000)

            await DAI.connect(creator1).approve(partnerWrapper.address, added_total_rewards_amount.add(added_total_fees))

            const increase_tx = await partnerWrapper.connect(creator1).increaseQuestDuration(
                questID1,
                extend_duration,
                added_total_rewards_amount,
                added_total_fees
            )

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, partnerWrapper.address, added_total_rewards_amount.add(added_total_fees));

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(partnerWrapper.address, board.address, added_total_rewards_amount);

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(partnerWrapper.address, chest.address, added_total_fees);

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(chest.address, partner_feesReceiver.address, partner_share_amount);

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_chest_balance = await DAI.balanceOf(chest.address)
            const new_partner_recevier_balance = await DAI.balanceOf(partner_feesReceiver.address)
    
            expect(new_board_balance).to.be.eq(old_board_balance.add(added_total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(added_total_fees.sub(partner_share_amount)))
            expect(new_partner_recevier_balance).to.be.eq(old_partner_recevier_balance.add(partner_share_amount))

        });

        it(' should fail if given a Quest not created through the wrapper', async () => {

            await expect(
                partnerWrapper.connect(creator2).increaseQuestDuration(
                    questID2,
                    extend_duration,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.reverted

        });

        it(' should fail if given incorrect parameters', async () => {

            await expect(
                partnerWrapper.connect(creator1).increaseQuestDuration(
                    questID1,
                    extend_duration,
                    0,
                    added_total_fees
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                partnerWrapper.connect(creator1).increaseQuestDuration(
                    questID1,
                    extend_duration,
                    added_total_rewards_amount,
                    0
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                partnerWrapper.connect(creator1).increaseQuestDuration(
                    questID1,
                    0,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('IncorrectAddDuration')

        });

    });


    describe('increaseQuestReward', async () => {

        const target_votes = ethers.utils.parseEther('150000')
        const reward_per_vote = ethers.utils.parseEther('0.3')

        const rewards_per_period = ethers.utils.parseEther('45000')

        const target_votes2 = ethers.utils.parseEther('30000')
        const reward_per_vote2 = ethers.utils.parseEther('0.5')

        const rewards_per_period2 = ethers.utils.parseEther('15000')

        const duration = 4
        const duration2 = 2

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(400).div(10000)
        const total_rewards_amount2 = rewards_per_period2.mul(duration2)
        const total_fees2 = total_rewards_amount2.mul(400).div(10000)

        const ellapsedDuration = 3
        const remainingDuration = duration - ellapsedDuration + 1

        const new_reward_per_vote = ethers.utils.parseEther('0.6')
        const new_rewards_per_period = ethers.utils.parseEther('90000')
        const added_total_rewards_amount = new_rewards_per_period.sub(rewards_per_period).mul(remainingDuration)
        const added_total_fees = added_total_rewards_amount.mul(400).div(10000)

        let questID1: BigNumber;
        let questID2: BigNumber;

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await chest.connect(admin).approveManager(partnerWrapper.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))
            await CRV.connect(admin).transfer(creator2.address, total_rewards_amount2.add(total_fees2))

            await DAI.connect(creator1).approve(partnerWrapper.address, total_rewards_amount.add(total_fees))
            await CRV.connect(creator2).approve(partnerWrapper.address, total_rewards_amount2.add(total_fees2))

            questID1 = await board.nextID()

            await partnerWrapper.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees,
                [voter1.address, voter2.address]
            )

            questID2 = await board.nextID()

            await partnerWrapper.connect(creator2).createQuest(
                gauge2.address,
                CRV.address,
                duration2,
                target_votes2,
                reward_per_vote2,
                total_rewards_amount2,
                total_fees2,
                [voter1.address, voter2.address]
            )

            await DAI.connect(admin).transfer(creator1.address, added_total_rewards_amount.add(added_total_fees))

        });

        it(' should increase correctly', async () => {

            await DAI.connect(creator1).approve(partnerWrapper.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const old_periods_length = (await board.getAllPeriodsForQuestId(questID1)).length
            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID1)

            const increase_tx = await partnerWrapper.connect(creator1).increaseQuestReward(
                questID1,
                new_reward_per_vote,
                added_total_rewards_amount,
                added_total_fees
            )

            const current_period = await board.getCurrentPeriod()

            await expect(
                increase_tx
            ).to.emit(board, "IncreasedQuestReward")
                .withArgs(
                    questID1,
                    current_period,
                    new_reward_per_vote,
                    added_total_rewards_amount
                );

            const new_periods_length = (await board.getAllPeriodsForQuestId(questID1)).length

            expect(new_periods_length).to.be.eq(old_periods_length)

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID1)

            const quest_data = await board.quests(questID1)
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

        it(' should only be callable by the creator of the Quest', async () => {

            await expect(
                partnerWrapper.connect(creator2).increaseQuestReward(
                    questID1,
                    new_reward_per_vote,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('CallerNotAllowed')

        });

        it(' should send the correct share to partner', async () => {

            const old_board_balance = await DAI.balanceOf(board.address)
            const old_chest_balance = await DAI.balanceOf(chest.address)
            const old_partner_recevier_balance = await DAI.balanceOf(partner_feesReceiver.address)

            const partner_share_amount = added_total_fees.mul(partner_share).div(10000)

            await DAI.connect(creator1).approve(partnerWrapper.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const increase_tx = await partnerWrapper.connect(creator1).increaseQuestReward(
                questID1,
                new_reward_per_vote,
                added_total_rewards_amount,
                added_total_fees
            )

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, partnerWrapper.address, added_total_rewards_amount.add(added_total_fees));

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(partnerWrapper.address, board.address, added_total_rewards_amount);

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(partnerWrapper.address, chest.address, added_total_fees);

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(chest.address, partner_feesReceiver.address, partner_share_amount);

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_chest_balance = await DAI.balanceOf(chest.address)
            const new_partner_recevier_balance = await DAI.balanceOf(partner_feesReceiver.address)
    
            expect(new_board_balance).to.be.eq(old_board_balance.add(added_total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(added_total_fees.sub(partner_share_amount)))
            expect(new_partner_recevier_balance).to.be.eq(old_partner_recevier_balance.add(partner_share_amount))

        });

        it(' should fail if given a Quest not created through the wrapper', async () => {

            await expect(
                partnerWrapper.connect(creator2).increaseQuestReward(
                    questID2,
                    new_reward_per_vote,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.reverted

        });

        it(' should fail if given incorrect parameters', async () => {

            await expect(
                partnerWrapper.connect(creator1).increaseQuestReward(
                    questID1,
                    0,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                partnerWrapper.connect(creator1).increaseQuestReward(
                    questID1,
                    new_reward_per_vote,
                    0,
                    added_total_fees
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                partnerWrapper.connect(creator1).increaseQuestReward(
                    questID1,
                    new_reward_per_vote,
                    added_total_rewards_amount,
                    0
                )
            ).to.be.revertedWith('NullAmount')

        });

    });


    describe('increaseQuestObjective', async () => {

        const target_votes = ethers.utils.parseEther('15000')
        const reward_per_vote = ethers.utils.parseEther('0.3')

        const rewards_per_period = ethers.utils.parseEther('4500')

        const target_votes2 = ethers.utils.parseEther('30000')
        const reward_per_vote2 = ethers.utils.parseEther('0.5')

        const rewards_per_period2 = ethers.utils.parseEther('15000')

        const duration = 4
        const duration2 = 2

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(400).div(10000)
        const total_rewards_amount2 = rewards_per_period2.mul(duration2)
        const total_fees2 = total_rewards_amount2.mul(400).div(10000)

        const ellapsedDuration = 2
        const remainingDuration = duration - ellapsedDuration + 1

        const new_target_votes = ethers.utils.parseEther('20000')
        const new_rewards_per_period = ethers.utils.parseEther('6000')
        const added_total_rewards_amount = new_rewards_per_period.sub(rewards_per_period).mul(remainingDuration)
        const added_total_fees = added_total_rewards_amount.mul(400).div(10000)

        let questID1: BigNumber;
        let questID2: BigNumber;

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await chest.connect(admin).approveManager(partnerWrapper.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))
            await CRV.connect(admin).transfer(creator2.address, total_rewards_amount2.add(total_fees2))

            await DAI.connect(creator1).approve(partnerWrapper.address, total_rewards_amount.add(total_fees))
            await CRV.connect(creator2).approve(partnerWrapper.address, total_rewards_amount2.add(total_fees2))

            questID1 = await board.nextID()

            await partnerWrapper.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees,
                [voter1.address, voter2.address]
            )

            questID2 = await board.nextID()

            await partnerWrapper.connect(creator2).createQuest(
                gauge2.address,
                CRV.address,
                duration2,
                target_votes2,
                reward_per_vote2,
                total_rewards_amount2,
                total_fees2,
                [voter1.address, voter2.address]
            )

            await DAI.connect(admin).transfer(creator1.address, added_total_rewards_amount.add(added_total_fees))

        });

        it(' should increase correctly', async () => {

            await DAI.connect(creator1).approve(partnerWrapper.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const old_periods_length = (await board.getAllPeriodsForQuestId(questID1)).length
            const old_quest_periods = await board.getAllQuestPeriodsForQuestId(questID1)

            const increase_tx = await partnerWrapper.connect(creator1).increaseQuestObjective(
                questID1,
                new_target_votes,
                added_total_rewards_amount,
                added_total_fees
            )

            const current_period = await board.getCurrentPeriod()

            await expect(
                increase_tx
            ).to.emit(board, "IncreasedQuestObjective")
                .withArgs(
                    questID1,
                    current_period,
                    new_target_votes,
                    added_total_rewards_amount
                );

            const new_periods_length = (await board.getAllPeriodsForQuestId(questID1)).length

            expect(new_periods_length).to.be.eq(old_periods_length)

            const new_quest_periods = await board.getAllQuestPeriodsForQuestId(questID1)

            const quest_data = await board.quests(questID1)
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

        it(' should only be callable by the creator of the Quest', async () => {

            await expect(
                partnerWrapper.connect(creator2).increaseQuestObjective(
                    questID1,
                    new_target_votes,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('CallerNotAllowed')

        });

        it(' should send the correct share to partner', async () => {

            const old_board_balance = await DAI.balanceOf(board.address)
            const old_chest_balance = await DAI.balanceOf(chest.address)
            const old_partner_recevier_balance = await DAI.balanceOf(partner_feesReceiver.address)

            const partner_share_amount = added_total_fees.mul(partner_share).div(10000)

            await DAI.connect(creator1).approve(partnerWrapper.address, added_total_rewards_amount.add(added_total_fees))

            await advanceTime(WEEK.mul(ellapsedDuration).toNumber())

            const increase_tx = await partnerWrapper.connect(creator1).increaseQuestObjective(
                questID1,
                new_target_votes,
                added_total_rewards_amount,
                added_total_fees
            )

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, partnerWrapper.address, added_total_rewards_amount.add(added_total_fees));

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(partnerWrapper.address, board.address, added_total_rewards_amount);

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(partnerWrapper.address, chest.address, added_total_fees);

            await expect(
                increase_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(chest.address, partner_feesReceiver.address, partner_share_amount);

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_chest_balance = await DAI.balanceOf(chest.address)
            const new_partner_recevier_balance = await DAI.balanceOf(partner_feesReceiver.address)
    
            expect(new_board_balance).to.be.eq(old_board_balance.add(added_total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(added_total_fees.sub(partner_share_amount)))
            expect(new_partner_recevier_balance).to.be.eq(old_partner_recevier_balance.add(partner_share_amount))

        });

        it(' should fail if given a Quest not created through the wrapper', async () => {

            await expect(
                partnerWrapper.connect(creator2).increaseQuestObjective(
                    questID2,
                    new_target_votes,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.reverted

        });

        it(' should fail if given incorrect parameters', async () => {

            await expect(
                partnerWrapper.connect(creator1).increaseQuestObjective(
                    questID1,
                    0,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                partnerWrapper.connect(creator1).increaseQuestObjective(
                    questID1,
                    new_target_votes,
                    0,
                    added_total_fees
                )
            ).to.be.revertedWith('NullAmount')

            await expect(
                partnerWrapper.connect(creator1).increaseQuestObjective(
                    questID1,
                    new_target_votes,
                    added_total_rewards_amount,
                    0
                )
            ).to.be.revertedWith('NullAmount')

        });

    });


    describe('withdrawUnusedRewards', async () => {

        const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
        const mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"

        let gauges: string[] = []
        let rewardToken: IERC20[] = []

        const target_votes = [ethers.utils.parseEther('15000'), ethers.utils.parseEther('25000')]
        const reward_per_vote = [ethers.utils.parseEther('2'), ethers.utils.parseEther('1.5')]
        const duration = [6, 4]

        let questIDs: BigNumber[] = [];

        const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000'), ethers.utils.parseEther('12000')]
        const gauge2_biases = [ethers.utils.parseEther('12000'), ethers.utils.parseEther('15000'), ethers.utils.parseEther('18000')]

        let first_period: BigNumber;

        let rewards_per_period: BigNumber[] = []
        let total_rewards_amount: BigNumber[] = []
        let total_fees: BigNumber[] = []

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address]
            rewardToken = [DAI, CRV]

            let creators = [creator1, creator2]

            await board.connect(admin).initiateDistributor(distributor.address)

            await chest.connect(admin).approveManager(partnerWrapper.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            for (let i = 0; i < gauges.length; i++) {
                rewards_per_period[i] = target_votes[i].mul(reward_per_vote[i]).div(UNIT)
                total_rewards_amount[i] = rewards_per_period[i].mul(duration[i])
                total_fees[i] = total_rewards_amount[i].mul(400).div(10000)

                await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount[i].add(total_fees[i]))
                await rewardToken[i].connect(creators[i]).approve(partnerWrapper.address, 0)
                await rewardToken[i].connect(creators[i]).approve(partnerWrapper.address, total_rewards_amount[i].add(total_fees[i]))

                questIDs[i] = await board.nextID()

                await partnerWrapper.connect(creators[i]).createQuest(
                    gauges[i],
                    rewardToken[i].address,
                    duration[i],
                    target_votes[i],
                    reward_per_vote[i],
                    total_rewards_amount[i],
                    total_fees[i],
                    [voter1.address, voter2.address]
                )
            }

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

            const old_board_balance = await rewardToken[0].balanceOf(board.address)
            const old_receiver_balance = await rewardToken[0].balanceOf(receiver.address)

            const withdraw_tx = await partnerWrapper.connect(creator1).withdrawUnusedRewards(questIDs[0], receiver.address)

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

        it(' should only allow the Quest creator to call', async () => {

            await expect(
                partnerWrapper.connect(creator2).withdrawUnusedRewards(questIDs[0], receiver.address)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('emergencyWithdraw', async () => {

        const mockRoot = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
        const mockRoot2 = "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cd4"

        let gauges: string[] = []
        let rewardToken: IERC20[] = []

        const target_votes = [ethers.utils.parseEther('15000'), ethers.utils.parseEther('25000')]
        const reward_per_vote = [ethers.utils.parseEther('2'), ethers.utils.parseEther('1.5')]
        const duration = [6, 4]

        let questIDs: BigNumber[] = [];

        const gauge1_biases = [ethers.utils.parseEther('8000'), ethers.utils.parseEther('10000'), ethers.utils.parseEther('12000')]
        const gauge2_biases = [ethers.utils.parseEther('12000'), ethers.utils.parseEther('15000'), ethers.utils.parseEther('18000')]

        let first_period: BigNumber;

        let rewards_per_period: BigNumber[] = []
        let total_rewards_amount: BigNumber[] = []
        let total_fees: BigNumber[] = []

        beforeEach(async () => {

            gauges = [gauge1.address, gauge2.address]
            rewardToken = [DAI, CRV]

            let creators = [creator1, creator2]

            await board.connect(admin).initiateDistributor(distributor.address)

            await chest.connect(admin).approveManager(partnerWrapper.address)

            await board.connect(admin).approveManager(manager.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)

            first_period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            for (let i = 0; i < gauges.length; i++) {
                rewards_per_period[i] = target_votes[i].mul(reward_per_vote[i]).div(UNIT)
                total_rewards_amount[i] = rewards_per_period[i].mul(duration[i])
                total_fees[i] = total_rewards_amount[i].mul(400).div(10000)

                await rewardToken[i].connect(admin).transfer(creators[i].address, total_rewards_amount[i].add(total_fees[i]))
                await rewardToken[i].connect(creators[i]).approve(partnerWrapper.address, 0)
                await rewardToken[i].connect(creators[i]).approve(partnerWrapper.address, total_rewards_amount[i].add(total_fees[i]))

                questIDs[i] = await board.nextID()

                await partnerWrapper.connect(creators[i]).createQuest(
                    gauges[i],
                    rewardToken[i].address,
                    duration[i],
                    target_votes[i],
                    reward_per_vote[i],
                    total_rewards_amount[i],
                    total_fees[i],
                    [voter1.address, voter2.address]
                )
            }

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

            const old_board_balance = await rewardToken[0].balanceOf(board.address)
            const old_receiver_balance = await rewardToken[0].balanceOf(receiver.address)


            await board.connect(admin).killBoard()

            await advanceTime((await (await board.KILL_DELAY()).toNumber()) + 10)

            const withdraw_tx = await partnerWrapper.connect(creator1).emergencyWithdraw(questIDs[0], receiver.address)

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

        it(' should only allow the Quest creator to call', async () => {

            await expect(
                partnerWrapper.connect(creator2).emergencyWithdraw(questIDs[0], receiver.address)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('retrieveRewards', async () => {

        const target_votes = ethers.utils.parseEther('150000')
        const reward_per_vote = ethers.utils.parseEther('6')

        const rewards_per_period = ethers.utils.parseEther('900000')

        const duration = 4

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(400).div(10000)

        let tree: BalanceTree

        let quest_id: BigNumber
        let period: BigNumber

        const wrapper_claim_amount = ethers.utils.parseEther('105')

        const distrib_amount = ethers.utils.parseEther('180')

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await board.connect(admin).approveManager(manager.address)

            await chest.connect(admin).approveManager(partnerWrapper.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)

            await controller.add_gauge(gauge1.address, 2)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))

            await DAI.connect(creator1).approve(partnerWrapper.address, total_rewards_amount.add(total_fees))

            quest_id = await board.nextID()
            period = (await board.getCurrentPeriod()).add(WEEK).div(WEEK).mul(WEEK)

            await partnerWrapper.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees,
                [voter1.address, voter2.address]
            )
            await advanceTime(WEEK.mul(2).toNumber())
            
            let period_end_to_set = period.add(WEEK).div(WEEK).mul(WEEK)

            await controller.set_points_weight(gauge1.address, period_end_to_set, ethers.utils.parseEther('8000'))

            const block_number = await provider.getBlockNumber()
            const current_ts = BigNumber.from((await provider.getBlock(block_number)).timestamp)

            await controller.set_user_vote(voter1.address, gauge1.address, period, ethers.utils.parseEther('200'), current_ts.add(WEEK.mul(182)))
            await controller.set_user_vote(voter2.address, gauge1.address, period, ethers.utils.parseEther('140'), current_ts.add(WEEK.mul(195)))

            await board.connect(manager).closeQuestPeriod(period)

            tree = new BalanceTree([
                { account: user1.address, amount: ethers.utils.parseEther('30'), questID: quest_id, period: period },
                { account: user2.address, amount: ethers.utils.parseEther('45'), questID: quest_id, period: period },
                { account: partnerWrapper.address, amount: wrapper_claim_amount, questID: quest_id, period: period },
            ]);

            const period_rewards1 = (await board.periodsByQuest(quest_id, period)).rewardAmountDistributed

            await board.connect(manager).addMerkleRoot(quest_id, period, period_rewards1, tree.getHexRoot())

        });

        it(' should allow Quest creator to claim back any rewards assigned to the Wrapper contract', async () => {

            let proof = tree.getProof(quest_id, period, 2, partnerWrapper.address, wrapper_claim_amount);

            expect(await distributor.isClaimed(quest_id, period, 2)).to.be.false
    
            let old_balance = await DAI.balanceOf(creator1.address)
    
            await expect(
                partnerWrapper.connect(creator1).retrieveRewards(
                    distributor.address,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.emit(distributor, "Claimed")
                .withArgs(quest_id, period, 2, wrapper_claim_amount, DAI.address, partnerWrapper.address);
    
            let new_balance = await DAI.balanceOf(creator1.address)
    
            expect(new_balance.sub(old_balance)).to.be.eq(wrapper_claim_amount)
    
            expect(await distributor.isClaimed(quest_id, period, 2)).to.be.true

        });

        it(' should only allow the Quest creator to call', async () => {

            let proof = tree.getProof(quest_id, period, 2, partnerWrapper.address, wrapper_claim_amount);

            await expect(
                partnerWrapper.connect(creator2).retrieveRewards(
                    distributor.address,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                partnerWrapper.connect(user1).retrieveRewards(
                    distributor.address,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.revertedWith('CallerNotAllowed')

        });

        it(' should fail if given incorrect Distributor address', async () => {

            let proof = tree.getProof(quest_id, period, 2, partnerWrapper.address, wrapper_claim_amount);

            await expect(
                partnerWrapper.connect(creator1).retrieveRewards(
                    ethers.constants.AddressZero,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.revertedWith('ZeroAddress')

            await expect(
                partnerWrapper.connect(creator1).retrieveRewards(
                    receiver.address,
                    quest_id,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.reverted
        });

        it(' should fail if given incorrect parameters or proofs', async () => {

            let proof = tree.getProof(quest_id, period, 2, partnerWrapper.address, wrapper_claim_amount);

            await expect(
                partnerWrapper.connect(creator1).retrieveRewards(
                    distributor.address,
                    112,
                    period,
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.reverted

            await expect(
                partnerWrapper.connect(creator1).retrieveRewards(
                    distributor.address,
                    quest_id,
                    period.add(WEEK),
                    2,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.reverted

            await expect(
                partnerWrapper.connect(creator1).retrieveRewards(
                    distributor.address,
                    quest_id,
                    period,
                    0,
                    wrapper_claim_amount,
                    proof
                )
            ).to.be.reverted

            await expect(
                partnerWrapper.connect(creator1).retrieveRewards(
                    distributor.address,
                    quest_id,
                    period,
                    2,
                    ethers.utils.parseEther('45'),
                    proof
                )
            ).to.be.reverted

            await expect(
                partnerWrapper.connect(creator1).retrieveRewards(
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

        let call_data1: string
        let call_data2: string

        beforeEach(async () => {

            const function_ABI_1 = ["function transferERC20(address token, address recipient, uint256 amount)"]
            const args1 = [DAI.address, partner.address, ethers.utils.parseEther('400')]
    
            const function_ABI_2 = ["function setValue(uint256 _value)"]
            const args2 = [12]

            await DAI.connect(admin).transfer(chest.address, ethers.utils.parseEther('1500'))

            uselessFactory = await ethers.getContractFactory("Useless");

            useless = (await uselessFactory.connect(admin).deploy()) as Useless;
            await useless.deployed();

            const iface1 = new ethers.utils.Interface(function_ABI_1)
            const iface2 = new ethers.utils.Interface(function_ABI_2)

            call_data1 = iface1.encodeFunctionData("transferERC20", args1)
            call_data2 = iface2.encodeFunctionData("setValue", args2)

        });

        it(' should execute the call correctly', async () => {

            await partnerWrapper.connect(partner).execute(
                useless.address,
                0,
                call_data2
            )

            expect(await useless.called()).to.be.true
            expect(await useless.value()).to.be.eq(12)

        });

        it(' should not allow to call forbidden contracts', async () => {

            await expect(
                partnerWrapper.connect(partner).execute(
                    chest.address,
                    0,
                    call_data1
                )
            ).to.be.revertedWith('ForbiddenCall')

            await expect(
                partnerWrapper.connect(partner).execute(
                    board.address,
                    0,
                    call_data1
                )
            ).to.be.revertedWith('ForbiddenCall')

            await chest.connect(admin).approveManager(partnerWrapper.address)

            await expect(
                partnerWrapper.connect(partner).execute(
                    chest.address,
                    0,
                    call_data1
                )
            ).to.be.revertedWith('ForbiddenCall')

        });

        it(' should block if caller not allowed', async () => {

            await expect(
                partnerWrapper.connect(creator2).execute(
                    useless.address,
                    0,
                    call_data2
                )
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });

    describe('updatePartnerShare', async () => {
        
        const newShare = 2500

        const target_votes = ethers.utils.parseEther('150000')
        const reward_per_vote = ethers.utils.parseEther('6')
        const target_votes2 = ethers.utils.parseEther('1000000')
        const reward_per_vote2 = ethers.utils.parseEther('0.5')

        const rewards_per_period = ethers.utils.parseEther('900000')
        const rewards_per_period2 = ethers.utils.parseEther('500000')

        const duration = 4
        const duration2 = 2

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(400).div(10000)
        const total_rewards_amount2 = rewards_per_period2.mul(duration2)
        const total_fees2 = total_rewards_amount2.mul(400).div(10000)

        beforeEach(async () => {

            await board.connect(admin).initiateDistributor(distributor.address)

            await chest.connect(admin).approveManager(partnerWrapper.address)

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)
            await board.connect(admin).whitelistToken(CRV.address, minCRVAmount)

            await controller.add_gauge(gauge1.address, 2)
            await controller.add_gauge(gauge2.address, 1)

            await DAI.connect(admin).transfer(creator1.address, total_rewards_amount.add(total_fees))
            await CRV.connect(admin).transfer(creator2.address, total_rewards_amount2.add(total_fees2))

            await DAI.connect(creator1).approve(partnerWrapper.address, total_rewards_amount.add(total_fees))
            await CRV.connect(creator2).approve(partnerWrapper.address, total_rewards_amount2.add(total_fees2))

        });

        it(' should update the partnerShare correctly (& emit the correct Event)', async () => {

            await expect(
                partnerWrapper.connect(admin).updatePartnerShare(newShare)
            ).to.emit(partnerWrapper, "PartnerShareUpdate")
                .withArgs(newShare);
            
            expect(await partnerWrapper.partnerShare()).to.be.eq(newShare)

        });

        it(' should upse the new partner share when creating a Quest', async () => {

            const old_board_balance = await DAI.balanceOf(board.address)
            const old_chest_balance = await DAI.balanceOf(chest.address)
            const old_partner_recevier_balance = await DAI.balanceOf(partner_feesReceiver.address)

            const partner_share_amount = total_fees.mul(partner_share).div(10000)

            const create_tx = await partnerWrapper.connect(creator1).createQuest(
                gauge1.address,
                DAI.address,
                duration,
                target_votes,
                reward_per_vote,
                total_rewards_amount,
                total_fees,
                [voter1.address, voter2.address]
            )

            await expect(
                create_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(creator1.address, partnerWrapper.address, total_rewards_amount.add(total_fees));

            await expect(
                create_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(partnerWrapper.address, board.address, total_rewards_amount);

            await expect(
                create_tx
            ).to.emit(DAI, "Transfer")
                .withArgs(partnerWrapper.address, chest.address, total_fees);

            await expect(
                    create_tx
                ).to.emit(DAI, "Transfer")
                    .withArgs(chest.address, partner_feesReceiver.address, partner_share_amount);

            const new_board_balance = await DAI.balanceOf(board.address)
            const new_chest_balance = await DAI.balanceOf(chest.address)
            const new_partner_recevier_balance = await DAI.balanceOf(partner_feesReceiver.address)

            expect(new_board_balance).to.be.eq(old_board_balance.add(total_rewards_amount))
            expect(new_chest_balance).to.be.eq(old_chest_balance.add(total_fees.sub(partner_share_amount)))
            expect(new_partner_recevier_balance).to.be.eq(old_partner_recevier_balance.add(partner_share_amount))

            await partnerWrapper.connect(admin).updatePartnerShare(newShare)

            const old_board_balance2 = await CRV.balanceOf(board.address)
            const old_chest_balance2 = await CRV.balanceOf(chest.address)
            const old_partner_recevier_balance2 = await CRV.balanceOf(partner_feesReceiver.address)

            const partner_share_amount2 = total_fees2.mul(newShare).div(10000)

            const create_tx2 = await partnerWrapper.connect(creator2).createQuest(
                gauge2.address,
                CRV.address,
                duration2,
                target_votes2,
                reward_per_vote2,
                total_rewards_amount2,
                total_fees2,
                [voter1.address, voter2.address]
            )

            await expect(
                create_tx2
            ).to.emit(CRV, "Transfer")
                .withArgs(creator2.address, partnerWrapper.address, total_rewards_amount2.add(total_fees2));

            await expect(
                create_tx2
            ).to.emit(CRV, "Transfer")
                .withArgs(partnerWrapper.address, board.address, total_rewards_amount2);

            await expect(
                create_tx2
            ).to.emit(CRV, "Transfer")
                .withArgs(partnerWrapper.address, chest.address, total_fees2);

            await expect(
                create_tx2
            ).to.emit(CRV, "Transfer")
                .withArgs(chest.address, partner_feesReceiver.address, partner_share_amount2);

            const new_board_balance2 = await CRV.balanceOf(board.address)
            const new_chest_balance2 = await CRV.balanceOf(chest.address)
            const new_partner_recevier_balance2 = await CRV.balanceOf(partner_feesReceiver.address)

            expect(new_board_balance2).to.be.eq(old_board_balance2.add(total_rewards_amount2))
            expect(new_chest_balance2).to.be.eq(old_chest_balance2.add(total_fees2.sub(partner_share_amount2)))
            expect(new_partner_recevier_balance2).to.be.eq(old_partner_recevier_balance2.add(partner_share_amount2))

        });

        it(' should only be callable by admin', async () => {

            await expect(
                partnerWrapper.connect(partner).updatePartnerShare(newShare)
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                partnerWrapper.connect(creator1).updatePartnerShare(newShare)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('recoverERC20', async () => {

        const lost_amount = ethers.utils.parseEther('1000');

        beforeEach(async () => {

            await DAI.connect(admin).transfer(partnerWrapper.address, lost_amount)

        });


        it(' should retrieve the lost tokens and send it to the admin', async () => {

            const oldBalance = await DAI.balanceOf(admin.address);

            await partnerWrapper.connect(admin).recoverERC20(DAI.address)

            const newBalance = await DAI.balanceOf(admin.address);

            expect(newBalance.sub(oldBalance)).to.be.eq(lost_amount)

        });

        it(' should block non-admin caller', async () => {

            await expect(
                partnerWrapper.connect(user2).recoverERC20(DAI.address)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });


    describe('kill', async () => {

        const questID = 0

        const target_votes = ethers.utils.parseEther('15000')
        const reward_per_vote = ethers.utils.parseEther('0.3')

        const rewards_per_period = ethers.utils.parseEther('4500')

        const duration = 4

        const total_rewards_amount = rewards_per_period.mul(duration)
        const total_fees = total_rewards_amount.mul(400).div(10000)

        const ellapsedDuration = 2

        const extend_duration = 3
        const new_target_votes = ethers.utils.parseEther('20000')
        const new_reward_per_vote = ethers.utils.parseEther('0.6')

        const added_total_rewards_amount = ethers.utils.parseEther('5000')
        const added_total_fees = added_total_rewards_amount.mul(400).div(10000)

        it(' should block all notKilled methods', async () => {

            await partnerWrapper.connect(admin).kill()

            await expect(
                partnerWrapper.connect(creator1).createQuest(
                    gauge1.address,
                    DAI.address,
                    duration,
                    target_votes,
                    reward_per_vote,
                    total_rewards_amount,
                    total_fees,
                    [voter1.address, voter2.address]
                )
            ).to.be.revertedWith('Killed')

            await expect(
                partnerWrapper.connect(creator1).increaseQuestDuration(
                    questID,
                    extend_duration,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('Killed')

            await expect(
                partnerWrapper.connect(creator1).increaseQuestReward(
                    questID,
                    new_reward_per_vote,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('Killed')

            await expect(
                partnerWrapper.connect(creator1).increaseQuestObjective(
                    questID,
                    new_target_votes,
                    added_total_rewards_amount,
                    added_total_fees
                )
            ).to.be.revertedWith('Killed')

            await expect(
                partnerWrapper.connect(creator1).withdrawUnusedRewards(
                    questID,
                    receiver.address
                )
            ).to.be.revertedWith('Killed')

            await expect(
                partnerWrapper.connect(creator1).emergencyWithdraw(
                    questID,
                    receiver.address
                )
            ).to.be.revertedWith('Killed')

            await expect(
                partnerWrapper.connect(creator1).retrieveRewards(
                    distributor.address,
                    questID,
                    10,
                    0,
                    100,
                    []
                )
            ).to.be.revertedWith('Killed')

            await expect(
                partnerWrapper.connect(partner).execute(
                    distributor.address,
                    0,
                    "0x7849a18e2c98b65ae515d22c2344ac1b515a7016e86b320c78ed07d0f1fa8cc3"
                )
            ).to.be.revertedWith('Killed')

        });

        it(' should only be callable by admin', async () => {

            await expect(
                partnerWrapper.connect(partner).kill()
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                partnerWrapper.connect(user3).kill()
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


});