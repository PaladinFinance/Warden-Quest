const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { MultiMerkleDistributor } from "../typechain/MultiMerkleDistributor";
import { QuestBoard } from "../typechain/QuestBoard";
import { IERC20 } from "../typechain/IERC20";
import { IERC20__factory } from "../typechain/factories/IERC20__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";
import { parseBalanceMap } from "../scripts/merkle/src/parse-balance-map";
import BalanceTree from "../scripts/merkle/src/balance-tree";

import {
    advanceTime,
    getERC20,
} from "./utils/utils";

const { TOKEN1_ADDRESS, BIG_HOLDER1, TOKEN2_ADDRESS, BIG_HOLDER2 } = require("./utils/constant");


chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;

let distributorFactory: ContractFactory
let boardFactory: ContractFactory

let tree: BalanceTree;

const WEEK = BigNumber.from(86400 * 7)

describe('MultiMerkleDistributor contract tests', () => {
    let admin: SignerWithAddress
    let mockQuestBoard: SignerWithAddress
    let user1: SignerWithAddress
    let user2: SignerWithAddress
    let user3: SignerWithAddress
    let user4: SignerWithAddress

    let signers: SignerWithAddress[]

    let distributor: MultiMerkleDistributor

    let CRV: IERC20
    let DAI: IERC20

    const distrib_amount = ethers.utils.parseEther('122')

    const user1_claim_amount = ethers.utils.parseEther('25')
    const user2_claim_amount = ethers.utils.parseEther('50')
    const user3_claim_amount = ethers.utils.parseEther('15')
    const user4_claim_amount = ethers.utils.parseEther('32')

    before(async () => {
        [admin, mockQuestBoard, user1, user2, user3, user4] = await ethers.getSigners();

        signers = (await ethers.getSigners()).slice(2) || []; //all signers exepct the one used as admin & the mock quest address

        distributorFactory = await ethers.getContractFactory("MultiMerkleDistributor");
        boardFactory = await ethers.getContractFactory("QuestBoard");

        const crv_amount = ethers.utils.parseEther('5000');
        const dai_amount = ethers.utils.parseEther('100000');

        CRV = IERC20__factory.connect(TOKEN1_ADDRESS, provider);
        DAI = IERC20__factory.connect(TOKEN2_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER1, CRV, admin.address, crv_amount);

        await getERC20(admin, BIG_HOLDER2, DAI, admin.address, dai_amount);

        tree = new BalanceTree([
            { account: user1.address, amount: user1_claim_amount },
            { account: user2.address, amount: user2_claim_amount },
            { account: user3.address, amount: user3_claim_amount },
            { account: user4.address, amount: user4_claim_amount },
        ]);

    })

    beforeEach(async () => {

        distributor = (await distributorFactory.connect(admin).deploy(mockQuestBoard.address)) as MultiMerkleDistributor;
        await distributor.deployed();

    });

    it(' should be deployed & have correct parameters', async () => {
        expect(distributor.address).to.properAddress

        expect(await distributor.owner()).to.be.eq(admin.address)

        expect(await distributor.questBoard()).to.be.eq(mockQuestBoard.address)

    });


    describe('addQuest', async () => {

        const quest_id1 = 1011
        const quest_id2 = 1012

        it(' should add a new Quest with correct parameters (& emit correct event)', async () => {

            await expect(
                distributor.connect(mockQuestBoard).addQuest(quest_id1, CRV.address)
            ).to.emit(distributor, "NewQuest")
            .withArgs(quest_id1, CRV.address);

            expect(await distributor.questRewardToken(quest_id1)).to.be.eq(CRV.address)

        });

        it(' should allow to add other Quests', async () => {

            await distributor.connect(mockQuestBoard).addQuest(quest_id1, CRV.address)

            await distributor.connect(mockQuestBoard).addQuest(quest_id2, DAI.address)

            expect(await distributor.questRewardToken(quest_id1)).to.be.eq(CRV.address)
            expect(await distributor.questRewardToken(quest_id2)).to.be.eq(DAI.address)

        });

        it(' should not allow to add the same Quest twice', async () => {

            await distributor.connect(mockQuestBoard).addQuest(quest_id1, CRV.address)

            await expect(
                distributor.connect(mockQuestBoard).addQuest(quest_id1, CRV.address)
            ).to.be.revertedWith('MultiMerkle: Quest already listed')

        });

        it(' should fail is reward token is incorrect', async () => {

            await expect(
                distributor.connect(mockQuestBoard).addQuest(quest_id1, ethers.constants.AddressZero)
            ).to.be.revertedWith('MultiMerkle: Incorrect reward token')

        });

        it(' should only be callable by allowed managers', async () => {

            await expect(
                distributor.connect(user1).addQuest(quest_id1, CRV.address)
            ).to.be.revertedWith('MultiMerkle: Not allowed')

            await expect(
                distributor.connect(user2).addQuest(quest_id1, CRV.address)
            ).to.be.revertedWith('MultiMerkle: Not allowed')

        });

    });


    describe('updateQuestPeriod', async () => {

        const quest_id1 = 1011
        const quest_id2 = 1012

        const period = BigNumber.from(1639612800)

        let tree_root: string

        beforeEach(async () => {

            await distributor.connect(mockQuestBoard).addQuest(quest_id1, CRV.address)

            tree_root = tree.getHexRoot()   

        });

        it(' should update the given period and set the Merkle Root (& emit the correct Event)', async () => {

            await expect(
                distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id1, period, tree_root)
            ).to.emit(distributor, "QuestPeriodUpdated")
            .withArgs(quest_id1, period, tree_root);

            expect(await distributor.questMerkleRootPerPeriod(quest_id1, period)).to.be.eq(tree_root)

            expect(await distributor.questClosedPeriods(quest_id1, 0)).to.be.eq(period)

        });

        it(' should not allow to update the same period twice', async () => {

            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id1, period, tree_root)

            await expect(
                distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id1, period, tree_root)
            ).to.be.revertedWith('MultiMerkle: period already updated')

        });

        it(' should fail if Quest is not listed', async () => {

            await expect(
                distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id2, period, tree_root)
            ).to.be.revertedWith('MultiMerkle: Quest not listed')

        });

        it(' should fail if empry MerkleRoot', async () => {

            await expect(
                distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id1, period, "0x0000000000000000000000000000000000000000000000000000000000000000")
            ).to.be.revertedWith('MultiMerkle: Empty MerkleRoot')

        });

        it(' should fail if an incorrect period is given', async () => {

            await expect(
                distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id1, 0, tree_root)
            ).to.be.revertedWith('MultiMerkle: incorrect period')

        });

        it(' should allow to update multiple periods for the same Quest', async () => {

            let tree2 = new BalanceTree([
                { account: user1.address, amount: user1_claim_amount },
                { account: user2.address, amount: user2_claim_amount },
                { account: user3.address, amount: user3_claim_amount },
            ]);

            let tree3 = new BalanceTree([
                { account: user1.address, amount: user1_claim_amount },
                { account: user3.address, amount: user3_claim_amount },
                { account: user4.address, amount: user4_claim_amount },
            ]);

            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id1, period, tree_root)

            expect(await distributor.questMerkleRootPerPeriod(quest_id1, period)).to.be.eq(tree_root)

            let next_period = period.add(WEEK).div(WEEK).mul(WEEK)

            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id1, next_period, tree2.getHexRoot())

            expect(await distributor.questMerkleRootPerPeriod(quest_id1, next_period)).to.be.eq(tree2.getHexRoot())

            next_period = next_period.add(WEEK).div(WEEK).mul(WEEK)

            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id1, next_period, tree3.getHexRoot())

            expect(await distributor.questMerkleRootPerPeriod(quest_id1, next_period)).to.be.eq(tree3.getHexRoot())

            const closed_periods = await distributor.getClosedPeriodsByQuests(quest_id1)

            expect(closed_periods[0]).to.be.eq(period)
            expect(closed_periods[2]).to.be.eq(next_period)

        });

        it(' should only be callable by allowed managers', async () => {

            await expect(
                distributor.connect(user1).updateQuestPeriod(quest_id1, period, tree_root)
            ).to.be.revertedWith('MultiMerkle: Not allowed')

            await expect(
                distributor.connect(user2).updateQuestPeriod(quest_id1, period, tree_root)
            ).to.be.revertedWith('MultiMerkle: Not allowed')

        });

    });

    describe('claim', async () => {

        const quest_id = 1011
    
        const period = BigNumber.from(1639612800)

        describe('claim - small tree', async () => {
    
            beforeEach(async () => {
    
                await distributor.connect(mockQuestBoard).addQuest(quest_id, CRV.address)

                await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id, period, tree.getHexRoot())

                await CRV.connect(admin).transfer(distributor.address, distrib_amount)
    
            });

            it(' should claim correctly', async () => {
    
                let proof = tree.getProof(0, user1.address, user1_claim_amount);
    
                let old_balance = await CRV.balanceOf(user1.address)
    
                await expect(
                    distributor.connect(user1).claim(quest_id, period, 0, user1.address, user1_claim_amount, proof)
                ).to.emit(distributor, "Claimed")
                    .withArgs(quest_id, period, 0, user1_claim_amount, CRV.address, user1.address);
    
                let new_balance = await CRV.balanceOf(user1.address)
    
                expect(new_balance.sub(old_balance)).to.be.eq(user1_claim_amount)
    
                expect(await distributor.isClaimed(quest_id, period, 0)).to.be.true
    
            });
    
            it(' should not allow double claim', async () => {
    
                let proof = tree.getProof(0, user1.address, user1_claim_amount);
    
                await distributor.connect(user1).claim(quest_id, period, 0, user1.address, user1_claim_amount, proof)
    
                await expect(
                    distributor.connect(user1).claim(quest_id, period, 0, user1.address, user1_claim_amount, proof)
                ).to.be.revertedWith('MultiMerkle: already claimed')
    
            });
    
            it(' should not allow to claim on non updated period', async () => {
    
                let proof = tree.getProof(0, user1.address, user1_claim_amount);
    
                let next_period = period.add(WEEK).div(WEEK).mul(WEEK)
    
                await expect(
                    distributor.connect(user1).claim(quest_id, next_period, 0, user1.address, user1_claim_amount, proof)
                ).to.be.revertedWith('MultiMerkle: not updated yet')
    
            });
    
            it(' should fail if proof is incorrect', async () => {
    
                let proof = tree.getProof(0, user1.address, user1_claim_amount);
    
                //empty proof
                await expect(
                    distributor.connect(user1).claim(quest_id, period, 0, user1.address, user1_claim_amount, [])
                ).to.be.revertedWith('MultiMerkle: Invalid proof')
    
                //wrong proof
                await expect(
                    distributor.connect(user1).claim(
                        quest_id,
                        period,
                        0,
                        user1.address,
                        user1_claim_amount,
                        tree.getProof(2, user3.address, user3_claim_amount)
                    )
                ).to.be.revertedWith('MultiMerkle: Invalid proof')
    
                //incorrect index
                await expect(
                    distributor.connect(user1).claim(quest_id, period, 1, user1.address, user1_claim_amount, proof)
                ).to.be.revertedWith('MultiMerkle: Invalid proof')
    
            });
    
            it(' should fail if amount is incorrect', async () => {
    
                let proof = tree.getProof(0, user1.address, user1_claim_amount);
    
                await expect(
                    distributor.connect(user1).claim(quest_id, period, 0, user1.address, user3_claim_amount, proof)
                ).to.be.revertedWith('MultiMerkle: Invalid proof')
    
            });
    
            it(' should fail if claimer address is incorrect', async () => {
    
                let proof = tree.getProof(0, user1.address, user1_claim_amount);
    
                await expect(
                    distributor.connect(user2).claim(quest_id, period, 0, user2.address, user1_claim_amount, proof)
                ).to.be.revertedWith('MultiMerkle: Invalid proof')
    
            });
    
            it(' should not allow double claims: 0 then 1', async () => {
    
                let proof_1 = tree.getProof(0, user1.address, user1_claim_amount);
                let proof_2 = tree.getProof(1, user2.address, user2_claim_amount);
    
                await distributor.connect(user1).claim(quest_id, period, 0, user1.address, user1_claim_amount, proof_1)
    
                await distributor.connect(user2).claim(quest_id, period, 1, user2.address, user2_claim_amount, proof_2)
    
                await expect(
                    distributor.connect(user1).claim(quest_id, period, 0, user1.address, user1_claim_amount, proof_1)
                ).to.be.revertedWith('MultiMerkle: already claimed')
    
            });
    
            it(' should not allow double claims: 1 then 0', async () => {
    
                let proof_1 = tree.getProof(0, user1.address, user1_claim_amount);
                let proof_2 = tree.getProof(1, user2.address, user2_claim_amount);
    
                await distributor.connect(user2).claim(quest_id, period, 1, user2.address, user2_claim_amount, proof_2)
    
                await distributor.connect(user1).claim(quest_id, period, 0, user1.address, user1_claim_amount, proof_1)
    
                await expect(
                    distributor.connect(user2).claim(quest_id, period, 1, user2.address, user2_claim_amount, proof_2)
                ).to.be.revertedWith('MultiMerkle: already claimed')
    
            });
    
            it(' should not allow double claims: 0 then 2', async () => {
    
                let proof_1 = tree.getProof(0, user1.address, user1_claim_amount);
                let proof_3 = tree.getProof(2, user3.address, user3_claim_amount);
    
                await distributor.connect(user1).claim(quest_id, period, 0, user1.address, user1_claim_amount, proof_1)
    
                await distributor.connect(user3).claim(quest_id, period, 2, user3.address, user3_claim_amount, proof_3)
    
                await expect(
                    distributor.connect(user1).claim(quest_id, period, 0, user1.address, user1_claim_amount, proof_1)
                ).to.be.revertedWith('MultiMerkle: already claimed')
    
            });
    
            it(' should not allow double claims: 2 then 0', async () => {
    
                let proof_1 = tree.getProof(0, user1.address, user1_claim_amount);
                let proof_3 = tree.getProof(2, user3.address, user3_claim_amount);
    
                await distributor.connect(user3).claim(quest_id, period, 2, user3.address, user3_claim_amount, proof_3)
    
                await distributor.connect(user1).claim(quest_id, period, 0, user1.address, user1_claim_amount, proof_1)
    
                await expect(
                    distributor.connect(user3).claim(quest_id, period, 2, user3.address, user3_claim_amount, proof_3)
                ).to.be.revertedWith('MultiMerkle: already claimed')
    
            });
    
        });


        describe('claim - larger tree', async () => {
    
            let new_tree: BalanceTree;
    
            let total_claim = 0;
    
            beforeEach(async () => {
    
                new_tree = new BalanceTree(
                    signers.map((s, i) => {
                        total_claim += i + 1
    
                        return { account: s.address, amount: BigNumber.from(i + 1) };
                    })
                );

                await distributor.connect(mockQuestBoard).addQuest(quest_id, CRV.address)

                await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id, period, new_tree.getHexRoot())

                await CRV.connect(admin).transfer(distributor.address, total_claim)
    
            });
    
            it(' claim index 0', async () => {
    
                const index = 0
    
                const claim_amount = BigNumber.from(index + 1)
    
                let proof = new_tree.getProof(index, signers[index].address, claim_amount);
    
                let old_balance = await CRV.balanceOf(signers[index].address)
    
                await expect(
                    distributor.connect(signers[index]).claim(quest_id, period, index, signers[index].address, claim_amount, proof)
                ).to.emit(distributor, "Claimed")
                    .withArgs(quest_id, period, index, claim_amount, CRV.address, signers[index].address);
    
                let new_balance = await CRV.balanceOf(signers[index].address)
    
                expect(new_balance.sub(old_balance)).to.be.eq(claim_amount)
    
                expect(await distributor.isClaimed(quest_id, period, index)).to.be.true
    
                await expect(
                    distributor.connect(signers[index]).claim(quest_id, period, index, signers[index].address, claim_amount, proof)
                ).to.be.revertedWith('MultiMerkle: already claimed')
    
            });
    
            it(' claim index 5', async () => {
    
                const index = 5
    
                const claim_amount = BigNumber.from(index + 1)
    
                let proof = new_tree.getProof(index, signers[index].address, claim_amount);
    
                let old_balance = await CRV.balanceOf(signers[index].address)
    
                await expect(
                    distributor.connect(signers[index]).claim(quest_id, period, index, signers[index].address, claim_amount, proof)
                ).to.emit(distributor, "Claimed")
                    .withArgs(quest_id, period, index, claim_amount, CRV.address, signers[index].address);
    
                let new_balance = await CRV.balanceOf(signers[index].address)
    
                expect(new_balance.sub(old_balance)).to.be.eq(claim_amount)
    
                expect(await distributor.isClaimed(quest_id, period, index)).to.be.true
    
                await expect(
                    distributor.connect(signers[index]).claim(quest_id, period, index, signers[index].address, claim_amount, proof)
                ).to.be.revertedWith('MultiMerkle: already claimed')
    
            });
    
            it(' claim index 15', async () => {
    
                const index = 15
    
                const claim_amount = BigNumber.from(index + 1)
    
                let proof = new_tree.getProof(index, signers[index].address, claim_amount);
    
                let old_balance = await CRV.balanceOf(signers[index].address)
    
                await expect(
                    distributor.connect(signers[index]).claim(quest_id, period, index, signers[index].address, claim_amount, proof)
                ).to.emit(distributor, "Claimed")
                    .withArgs(quest_id, period, index, claim_amount, CRV.address, signers[index].address);
    
                let new_balance = await CRV.balanceOf(signers[index].address)
    
                expect(new_balance.sub(old_balance)).to.be.eq(claim_amount)
    
                expect(await distributor.isClaimed(quest_id, period, index)).to.be.true
    
                await expect(
                    distributor.connect(signers[index]).claim(quest_id, period, index, signers[index].address, claim_amount, proof)
                ).to.be.revertedWith('MultiMerkle: already claimed')
    
            });
    
        });
    
    
        describe('claim - tree 10 000 users', async () => {
    
            let new_tree: BalanceTree;
            const nb_leaves = 10000;
            const nb_tests = 25;
            const user_claims: { account: string; amount: BigNumber }[] = [];
    
            const claim_amount = BigNumber.from(50)
    
            const getRandomIndex = (nb_leaves: number, nb_tests: number) => {
                return Math.floor(Math.random() * (nb_leaves / nb_tests))
            }
    
            beforeEach(async () => {
    
                for (let i = 0; i < nb_leaves; i++) {
                    const n = { account: user1.address, amount: claim_amount };
                    user_claims.push(n);
                }
    
                new_tree = new BalanceTree(user_claims);

                await distributor.connect(mockQuestBoard).addQuest(quest_id, CRV.address)

                await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id, period, new_tree.getHexRoot())

                await CRV.connect(admin).transfer(distributor.address, claim_amount.mul(nb_leaves))
    
            });
    
            it(' check proof verification works', async () => {
    
                const root = Buffer.from(new_tree.getHexRoot().slice(2), "hex");
    
                for (let index = 0; index < nb_leaves; index += nb_leaves / nb_tests) {
    
                    let proof = new_tree
                        .getProof(index, user1.address, claim_amount)
                        .map((el) => Buffer.from(el.slice(2), "hex"));
    
                    let validProof = BalanceTree.verifyProof(
                        index,
                        user1.address,
                        claim_amount,
                        proof,
                        root
                    );
    
                    expect(validProof).to.be.true;
                }
    
            });
    
            it(' should not allow double claims', async () => {
    
                for (let index = 0; index < nb_tests; index += getRandomIndex(nb_leaves, nb_tests)) {
                    let proof = new_tree.getProof(index, user1.address, claim_amount);
    
                    let old_balance = await CRV.balanceOf(user1.address)
    
                    await expect(
                        distributor.connect(user1).claim(quest_id, period, index, user1.address, claim_amount, proof)
                    ).to.emit(distributor, "Claimed")
                        .withArgs(quest_id, period, index, claim_amount, CRV.address, user1.address);
    
                    let new_balance = await CRV.balanceOf(user1.address)
    
                    expect(new_balance.sub(old_balance)).to.be.eq(claim_amount)
    
                    await expect(
                        distributor.connect(user1).claim(quest_id, period, index, user1.address, claim_amount, proof)
                    ).to.be.revertedWith('MultiMerkle: already claimed')
                }
    
            });
    
        });

    });


    describe('multiClaim', async () => {

        const quest_id1 = 1011
        const quest_id2 = 1022
        const quest_id3 = 1033
    
        const period = BigNumber.from(1639612800)
        const next_period = period.add(WEEK).div(WEEK).mul(WEEK)

        let tree2: BalanceTree;
        let tree3: BalanceTree;

        const user_claims = [
            [user1_claim_amount, ethers.utils.parseEther('15'), ethers.utils.parseEther('12')],
            [user2_claim_amount, ethers.utils.parseEther('20'), ethers.utils.parseEther('50')],
            [user3_claim_amount, ethers.utils.parseEther('0'), ethers.utils.parseEther('3')],
            [user4_claim_amount, ethers.utils.parseEther('37'), ethers.utils.parseEther('0')],
        ]
    
        beforeEach(async () => {

            await distributor.connect(mockQuestBoard).addQuest(quest_id1, CRV.address)
            await distributor.connect(mockQuestBoard).addQuest(quest_id2, CRV.address)
            await distributor.connect(mockQuestBoard).addQuest(quest_id3, DAI.address)

            tree2 = new BalanceTree([
                { account: user1.address, amount: user_claims[0][1] },
                { account: user2.address, amount: user_claims[1][1] },
                { account: user4.address, amount: user_claims[3][1] },
            ]);

            tree3 = new BalanceTree([
                { account: user1.address, amount: user_claims[0][2] },
                { account: user2.address, amount: user_claims[1][2] },
                { account: user3.address, amount: user_claims[2][2] },
            ]);

            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id1, period, tree.getHexRoot())
            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id2, period, tree2.getHexRoot())
            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id3, next_period, tree3.getHexRoot())

            await CRV.connect(admin).transfer(distributor.address, distrib_amount.mul(2))
            await DAI.connect(admin).transfer(distributor.address, distrib_amount)

        });

        it(' should claim for 2 different Quests', async () => {

            let claim_params = [
                { 
                    questID: quest_id1,
                    period: period,
                    index: 0,
                    amount: user_claims[0][0],
                    merkleProof: tree.getProof(0, user1.address, user_claims[0][0])
                },
                { 
                    questID: quest_id2,
                    period: period,
                    index: 0,
                    amount: user_claims[0][1],
                    merkleProof: tree2.getProof(0, user1.address, user_claims[0][1])
                }
            ]


            await distributor.connect(user1).multiClaim(user1.address, claim_params)

            expect(await distributor.isClaimed(quest_id1, period, 0)).to.be.true
            expect(await distributor.isClaimed(quest_id2, period, 0)).to.be.true

            expect(await distributor.isClaimed(quest_id3, next_period, 0)).to.be.false
            expect(await distributor.isClaimed(quest_id1, period, 1)).to.be.false

        });

        it(' should claim from different periods from same Quest', async () => {

            let tree4 = new BalanceTree([
                { account: user1.address, amount: ethers.utils.parseEther('20') },
                { account: user2.address, amount: ethers.utils.parseEther('4') },
                { account: user4.address, amount: ethers.utils.parseEther('15') },
            ]);

            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id2, next_period, tree4.getHexRoot())

            let claim_params = [
                { 
                    questID: quest_id2,
                    period: period,
                    index: 2,
                    amount: user_claims[3][1],
                    merkleProof: tree2.getProof(2, user4.address, user_claims[3][1])
                },
                { 
                    questID: quest_id2,
                    period: next_period,
                    index: 2,
                    amount: ethers.utils.parseEther('15'),
                    merkleProof: tree4.getProof(2, user4.address, ethers.utils.parseEther('15'))
                }
            ]


            await distributor.connect(user4).multiClaim(user4.address, claim_params)

            expect(await distributor.isClaimed(quest_id2, period, 2)).to.be.true
            expect(await distributor.isClaimed(quest_id2, next_period, 2)).to.be.true

            expect(await distributor.isClaimed(quest_id1, period, 1)).to.be.false
            expect(await distributor.isClaimed(quest_id1, period, 0)).to.be.false

        });

        it(' should claim from different periods from different Quests', async () => {

            let claim_params = [
                { 
                    questID: quest_id2,
                    period: period,
                    index: 1,
                    amount: user_claims[1][1],
                    merkleProof: tree2.getProof(1, user2.address, user_claims[1][1])
                },
                { 
                    questID: quest_id3,
                    period: next_period,
                    index: 1,
                    amount: user_claims[1][2],
                    merkleProof: tree3.getProof(1, user2.address, user_claims[1][2])
                }
            ]


            await distributor.connect(user2).multiClaim(user2.address, claim_params)

            expect(await distributor.isClaimed(quest_id2, period, 1)).to.be.true
            expect(await distributor.isClaimed(quest_id3, next_period, 1)).to.be.true

            expect(await distributor.isClaimed(quest_id1, period, 1)).to.be.false
            expect(await distributor.isClaimed(quest_id1, period, 0)).to.be.false

        });

        it(' should fail if empty claimParams', async () => {

            await expect(
                distributor.connect(user1).multiClaim(user1.address, [])
            ).to.be.revertedWith("MultiMerkle: empty parameters")

        });

    });


    describe('claimQuest', async () => {

        const quest_id = 1011
        const quest_id2 = 1022
    
        const period = BigNumber.from(1639612800)
        const next_period = period.add(WEEK).div(WEEK).mul(WEEK)
        const next_period2 = next_period.add(WEEK).div(WEEK).mul(WEEK)

        let tree2: BalanceTree;
        let tree3: BalanceTree;

        const user_claims = [
            [user1_claim_amount, ethers.utils.parseEther('15'), ethers.utils.parseEther('12')],
            [user1_claim_amount, ethers.utils.parseEther('20'), ethers.utils.parseEther('50')],
            [user1_claim_amount, ethers.utils.parseEther('0'), ethers.utils.parseEther('3')],
            [user1_claim_amount, ethers.utils.parseEther('37'), ethers.utils.parseEther('0')],
        ]
    
        beforeEach(async () => {

            await distributor.connect(mockQuestBoard).addQuest(quest_id, CRV.address)
            await distributor.connect(mockQuestBoard).addQuest(quest_id2, DAI.address)

            tree2 = new BalanceTree([
                { account: user1.address, amount: user_claims[0][1] },
                { account: user2.address, amount: user_claims[1][1] },
                { account: user4.address, amount: user_claims[3][1] },
            ]);

            tree3 = new BalanceTree([
                { account: user1.address, amount: user_claims[0][2] },
                { account: user2.address, amount: user_claims[1][2] },
                { account: user3.address, amount: user_claims[2][2] },
            ]);

            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id, period, tree.getHexRoot())
            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id, next_period, tree2.getHexRoot())
            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id, next_period2, tree3.getHexRoot())

            await distributor.connect(mockQuestBoard).updateQuestPeriod(quest_id2, period, tree.getHexRoot())

            await CRV.connect(admin).transfer(distributor.address, distrib_amount.mul(3))
            await DAI.connect(admin).transfer(distributor.address, distrib_amount)

        });

        it(' should claim for all periods of the Quest', async () => {

            let claim_params = [
                { 
                    questID: quest_id,
                    period: period,
                    index: 0,
                    amount: user_claims[0][0],
                    merkleProof: tree.getProof(0, user1.address, user_claims[0][0])
                },
                { 
                    questID: quest_id,
                    period: next_period,
                    index: 0,
                    amount: user_claims[0][1],
                    merkleProof: tree2.getProof(0, user1.address, user_claims[0][1])
                },
                { 
                    questID: quest_id,
                    period: next_period2,
                    index: 0,
                    amount: user_claims[0][2],
                    merkleProof: tree3.getProof(0, user1.address, user_claims[0][2])
                },
            ]

            const claim_tx = await distributor.connect(user1).claimQuest(user1.address, quest_id, claim_params)

            expect(await distributor.isClaimed(quest_id, period, 0)).to.be.true
            expect(await distributor.isClaimed(quest_id, next_period, 0)).to.be.true
            expect(await distributor.isClaimed(quest_id, next_period2, 0)).to.be.true

            expect(await distributor.isClaimed(quest_id2, period, 0)).to.be.false

            // Check that the tx only has 1 transfer with the total claim amount
            const total_claim_amount = user_claims[0][0].add(user_claims[0][1]).add(user_claims[0][2])
            await expect(
                claim_tx
            ).to.emit(CRV, "Transfer")
            .withArgs(distributor.address, user1.address, total_claim_amount);

        });

        it(' should skip the 2nd period and claim for other periods', async () => {

            let claim_params = [
                { 
                    questID: quest_id,
                    period: period,
                    index: 0,
                    amount: user_claims[0][0],
                    merkleProof: tree.getProof(0, user1.address, user_claims[0][0])
                },
                { 
                    questID: quest_id,
                    period: next_period2,
                    index: 0,
                    amount: user_claims[0][2],
                    merkleProof: tree3.getProof(0, user1.address, user_claims[0][2])
                },
            ]

            const claim_tx = await distributor.connect(user1).claimQuest(user1.address, quest_id, claim_params)

            expect(await distributor.isClaimed(quest_id, period, 0)).to.be.true
            expect(await distributor.isClaimed(quest_id, next_period2, 0)).to.be.true

            expect(await distributor.isClaimed(quest_id, next_period, 0)).to.be.false
            expect(await distributor.isClaimed(quest_id2, period, 0)).to.be.false

            // Check that the tx only has 1 transfer with the total claim amount
            const total_claim_amount = user_claims[0][0].add(user_claims[0][2])
            await expect(
                claim_tx
            ).to.emit(CRV, "Transfer")
            .withArgs(distributor.address, user1.address, total_claim_amount);

        });

        it(' should fail if the questId is not the same', async () => {

            let claim_params = [
                { 
                    questID: quest_id,
                    period: period,
                    index: 0,
                    amount: user_claims[0][0],
                    merkleProof: tree.getProof(0, user1.address, user_claims[0][0])
                },
                { 
                    questID: quest_id,
                    period: next_period,
                    index: 0,
                    amount: user_claims[0][1],
                    merkleProof: tree2.getProof(0, user1.address, user_claims[0][1])
                },
                { 
                    questID: quest_id,
                    period: next_period2,
                    index: 0,
                    amount: user_claims[0][2],
                    merkleProof: tree3.getProof(0, user1.address, user_claims[0][2])
                },
            ]

            await expect(
                distributor.connect(user1).claimQuest(user1.address, quest_id2, claim_params)
            ).to.be.revertedWith("MultiMerkle: incorrect Quest")

        });

        it(' should fail if a given period is not updated yet', async () => {

            let claim_params = [
                { 
                    questID: quest_id,
                    period: period,
                    index: 0,
                    amount: user_claims[0][0],
                    merkleProof: tree.getProof(0, user1.address, user_claims[0][0])
                },
                { 
                    questID: quest_id,
                    period: next_period,
                    index: 0,
                    amount: user_claims[0][1],
                    merkleProof: tree2.getProof(0, user1.address, user_claims[0][1])
                },
                { 
                    questID: quest_id,
                    period: next_period.add(WEEK.mul(2)).div(WEEK).mul(WEEK),
                    index: 0,
                    amount: user_claims[0][2],
                    merkleProof: tree3.getProof(0, user1.address, user_claims[0][2])
                },
            ]

            await expect(
                distributor.connect(user1).claimQuest(user1.address, quest_id, claim_params)
            ).to.be.revertedWith("MultiMerkle: not updated yet")

        });

        it(' should fail if one of the period was already claimed', async () => {

            let claim_params = [
                { 
                    questID: quest_id,
                    period: period,
                    index: 0,
                    amount: user_claims[0][0],
                    merkleProof: tree.getProof(0, user1.address, user_claims[0][0])
                },
                { 
                    questID: quest_id,
                    period: next_period,
                    index: 0,
                    amount: user_claims[0][1],
                    merkleProof: tree2.getProof(0, user1.address, user_claims[0][1])
                },
                { 
                    questID: quest_id,
                    period: next_period2,
                    index: 0,
                    amount: user_claims[0][2],
                    merkleProof: tree3.getProof(0, user1.address, user_claims[0][2])
                },
            ]

            await distributor.connect(user1).claim(quest_id, next_period, 0, user1.address, user_claims[0][1], tree2.getProof(0, user1.address, user_claims[0][1]))

            await expect(
                distributor.connect(user1).claimQuest(user1.address, quest_id, claim_params)
            ).to.be.revertedWith("MultiMerkle: already claimed")

        });

        it(' should fail if empty claimParams', async () => {

            await expect(
                distributor.connect(user1).claimQuest(user1.address, quest_id, [])
            ).to.be.revertedWith("MultiMerkle: empty parameters")

        });

        it(' should fail if invalid proof is given', async () => {

            let wrong_claim_params1 = [
                { 
                    questID: quest_id,
                    period: period,
                    index: 0,
                    amount: user_claims[0][0],
                    merkleProof: tree.getProof(0, user1.address, user_claims[0][0])
                },
                { 
                    questID: quest_id,
                    period: next_period,
                    index: 0,
                    amount: user_claims[0][1],
                    merkleProof: tree2.getProof(1, user2.address, user_claims[1][1])
                },
                { 
                    questID: quest_id,
                    period: next_period2,
                    index: 0,
                    amount: user_claims[0][2],
                    merkleProof: tree3.getProof(0, user1.address, user_claims[0][2])
                },
            ]

            let wrong_claim_params2 = [
                { 
                    questID: quest_id,
                    period: period,
                    index: 0,
                    amount: user_claims[0][0],
                    merkleProof: tree.getProof(0, user1.address, user_claims[0][0])
                },
                { 
                    questID: quest_id,
                    period: next_period,
                    index: 1,
                    amount: user_claims[1][1],
                    merkleProof: tree2.getProof(0, user1.address, user_claims[0][1])
                },
                { 
                    questID: quest_id,
                    period: next_period2,
                    index: 0,
                    amount: user_claims[0][2],
                    merkleProof: tree3.getProof(0, user1.address, user_claims[0][2])
                },
            ]

            await expect(
                distributor.connect(user1).claimQuest(user1.address, quest_id, wrong_claim_params1)
            ).to.be.revertedWith("MultiMerkle: Invalid proof")

            await expect(
                distributor.connect(user1).claimQuest(user1.address, quest_id, wrong_claim_params2)
            ).to.be.revertedWith("MultiMerkle: Invalid proof")

        });

    });


    describe('updateQuestManager', async () => {

        it(' should update the QuestBoard address', async () => {

            await distributor.connect(admin).updateQuestManager(user2.address)

            expect(await distributor.questBoard()).to.be.eq(user2.address)

        });


        it(' should block non-admin caller', async () => {

            await expect(
                distributor.connect(user2).updateQuestManager(user2.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('recoverERC20', async () => {

        const lost_amount = ethers.utils.parseEther('1000');

        let mockController: SignerWithAddress
        let mockChest: SignerWithAddress

        let board: QuestBoard

        let distributor2: MultiMerkleDistributor

        let minDAIAmount = ethers.utils.parseEther("0.005")

        beforeEach(async () => {

            mockController = signers[1]
            mockChest = signers[2]

            board = (await boardFactory.connect(admin).deploy(mockController.address, mockChest.address)) as QuestBoard;
            await board.deployed();

            distributor2 = (await distributorFactory.connect(admin).deploy(board.address)) as MultiMerkleDistributor;
            await distributor2.deployed();

            await DAI.connect(admin).transfer(distributor2.address, lost_amount)

        });


        it(' should retrieve the lost tokens and send it to the admin', async () => {

            const oldBalance = await DAI.balanceOf(admin.address);

            await distributor2.connect(admin).recoverERC20(DAI.address, lost_amount)

            const newBalance = await DAI.balanceOf(admin.address);

            expect(newBalance.sub(oldBalance)).to.be.eq(lost_amount)

        });

        it(' should fail for whitelisted tokens', async () => {

            await board.connect(admin).whitelistToken(DAI.address, minDAIAmount)

            await expect(
                distributor2.connect(admin).recoverERC20(DAI.address, lost_amount)
            ).to.be.revertedWith('MultiMerkle: Cannot recover whitelisted token')

        });

        it(' should block non-admin caller', async () => {

            await expect(
                distributor2.connect(user2).recoverERC20(DAI.address, ethers.utils.parseEther('10'))
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });

});