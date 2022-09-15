const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ExtraRewardsMultiMerkle } from "../../typechain/ExtraRewardsMultiMerkle";
import { IERC20 } from "../../typechain/IERC20";
import { IERC20__factory } from "../../typechain/factories/IERC20__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";
import { parseBalanceMap } from "../utils/merkle/parse-balance-map";
import BalanceTree from "../utils/merkle/balance-tree";

import {
    advanceTime,
    getERC20,
} from "../utils/utils";

const { TOKEN1_ADDRESS, BIG_HOLDER1, TOKEN2_ADDRESS, BIG_HOLDER2 } = require("../utils/constant");


chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;

let distributorFactory: ContractFactory

let tree: BalanceTree;

describe('ExtraRewardsMultiMerkle contract tests', () => {
    let admin: SignerWithAddress

    let user1: SignerWithAddress
    let user2: SignerWithAddress
    let user3: SignerWithAddress
    let user4: SignerWithAddress

    let rootManager: SignerWithAddress

    let signers: SignerWithAddress[]

    let distributor: ExtraRewardsMultiMerkle

    let token1: IERC20
    let token2: IERC20

    const claim_amounts1 = [ethers.utils.parseEther('25'), ethers.utils.parseEther('50'), ethers.utils.parseEther('15'), ethers.utils.parseEther('32')]
    const claim_amounts2 = [ethers.utils.parseEther('12'), ethers.utils.parseEther('45'), ethers.utils.parseEther('10'), ethers.utils.parseEther('37')]
    const claim_amounts3 = [ethers.utils.parseEther('20'), ethers.utils.parseEther('25'), ethers.utils.parseEther('30'), ethers.utils.parseEther('6')]

    before(async () => {
        [admin, rootManager, user1, user2, user3, user4] = await ethers.getSigners();

        signers = (await ethers.getSigners()).slice(2) || []; //all signers exepct the one used as admin & the mock quest address

        distributorFactory = await ethers.getContractFactory("ExtraRewardsMultiMerkle");

        const crv_amount = ethers.utils.parseEther('50000');
        const dai_amount = ethers.utils.parseEther('100000');

        token1 = IERC20__factory.connect(TOKEN1_ADDRESS, provider);
        token2 = IERC20__factory.connect(TOKEN2_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER1, token1, admin.address, crv_amount);

        await getERC20(admin, BIG_HOLDER2, token2, admin.address, dai_amount);

    })

    beforeEach(async () => {

        distributor = (await distributorFactory.connect(admin).deploy(rootManager.address)) as ExtraRewardsMultiMerkle;
        await distributor.deployed();

    });

    it(' should be deployed & have correct parameters', async () => {
        expect(distributor.address).to.properAddress

        expect(await distributor.owner()).to.be.eq(admin.address)
        expect(await distributor.rootManager()).to.be.eq(rootManager.address)

    });

    describe('freezeRoot', async () => {

        it(' should freeze the token (& emit Event)', async () => {

            const token_nonce = await distributor.nonce(token1.address)

            const freeze_tx = await distributor.connect(rootManager).freezeRoot(token1.address)

            expect(await distributor.frozen(token1.address)).to.be.true

            await expect(
                freeze_tx
            ).to.emit(distributor, "FrozenRoot")
                .withArgs(token1.address, token_nonce);

        });

        it(' should allow to freeze multiple tokens', async () => {

            await distributor.connect(rootManager).freezeRoot(token1.address)

            expect(await distributor.frozen(token1.address)).to.be.true
            expect(await distributor.frozen(token2.address)).to.be.false

            await distributor.connect(rootManager).freezeRoot(token2.address)

            expect(await distributor.frozen(token1.address)).to.be.true
            expect(await distributor.frozen(token2.address)).to.be.true

        });

        it(' should fail if already frozen', async () => {

            await distributor.connect(rootManager).freezeRoot(token1.address)

            await expect(
                distributor.connect(rootManager).freezeRoot(token1.address)
            ).to.be.revertedWith('AlreadyFrozen')

        });

        it(' should fail if given address 0x0', async () => {

            await expect(
                distributor.connect(rootManager).freezeRoot(ethers.constants.AddressZero)
            ).to.be.revertedWith('ZeroAddress')

        });


        it(' should block non-admin caller', async () => {

            await expect(
                distributor.connect(user1).freezeRoot(token1.address)
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                distributor.connect(user2).freezeRoot(token1.address)
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });

    describe('multiFreezeRoot', async () => {

        it(' should freeze the tokens (& emit Event)', async () => {

            const token_nonce = await distributor.nonce(token1.address)
            const token_nonce2 = await distributor.nonce(token2.address)

            const freeze_tx = await distributor.connect(rootManager).multiFreezeRoot([token1.address, token2.address])

            expect(await distributor.frozen(token1.address)).to.be.true
            expect(await distributor.frozen(token2.address)).to.be.true

            await expect(
                freeze_tx
            ).to.emit(distributor, "FrozenRoot")
                .withArgs(token1.address, token_nonce);
            
            await expect(
                freeze_tx
            ).to.emit(distributor, "FrozenRoot")
                .withArgs(token2.address, token_nonce2);

        });

        it(' should fail if already frozen', async () => {

            await distributor.connect(rootManager).freezeRoot(token1.address)

            await expect(
                distributor.connect(rootManager).multiFreezeRoot([token1.address, token2.address])
            ).to.be.revertedWith('AlreadyFrozen')

        });

        it(' should fail if array is empty', async () => {

            await expect(
                distributor.connect(rootManager).multiFreezeRoot([])
            ).to.be.revertedWith('EmptyArray')

        });

        it(' should fail if given address 0x0', async () => {

            await expect(
                distributor.connect(rootManager).multiFreezeRoot([ethers.constants.AddressZero, token2.address])
            ).to.be.revertedWith('ZeroAddress')

        });


        it(' should block non-admin caller', async () => {

            await expect(
                distributor.connect(user1).multiFreezeRoot([token1.address, token2.address])
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                distributor.connect(user2).multiFreezeRoot([token1.address, token2.address])
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });

    describe('updateRoot', async () => {

        let tree_root: string

        beforeEach(async () => {
            
            tree = new BalanceTree([
                { account: user1.address, amount: claim_amounts1[0] },
                { account: user2.address, amount: claim_amounts1[1] },
                { account: user3.address, amount: claim_amounts1[2] },
                { account: user4.address, amount: claim_amounts1[3] },
            ]); 

            tree_root = tree.getHexRoot()

            await distributor.connect(rootManager).freezeRoot(token1.address)

        });

        it(' should set the correct Merkle Root for the token (& emit Event)', async () => {

            const old_nonce = await distributor.nonce(token1.address)

            const update_tx = await distributor.connect(rootManager).updateRoot(token1.address, tree_root)

            expect(await distributor.merkleRoots(token1.address)).to.be.eq(tree_root)

            expect(await distributor.nonce(token1.address)).to.be.eq(old_nonce.add(1))

            await expect(
                update_tx
            ).to.emit(distributor, "UpdateRoot")
                .withArgs(token1.address, tree_root, old_nonce.add(1));

        });

        it(' should unfreeze the token', async () => {

            await distributor.connect(rootManager).updateRoot(token1.address, tree_root)

            expect(await distributor.frozen(token1.address)).to.be.false

        });

        it(' should fail if the token was not frozen', async () => {

            await expect(
                distributor.connect(rootManager).updateRoot(token2.address, tree_root)
            ).to.be.revertedWith("NotFrozen")

        });

        it(' should allow to update the same root again', async () => {

            const old_nonce = await distributor.nonce(token1.address)

            await distributor.connect(rootManager).updateRoot(token1.address, tree_root)

            expect(await distributor.merkleRoots(token1.address)).to.be.eq(tree_root)

            expect(await distributor.nonce(token1.address)).to.be.eq(old_nonce.add(1))

            const tree2 = new BalanceTree([
                { account: user1.address, amount: claim_amounts2[0] },
                { account: user2.address, amount: claim_amounts2[1] },
                { account: user4.address, amount: claim_amounts2[3] },
            ]); 

            const tree_root2 = tree2.getHexRoot()

            await distributor.connect(rootManager).freezeRoot(token1.address)

            const update_tx = await distributor.connect(rootManager).updateRoot(token1.address, tree_root2)

            expect(await distributor.merkleRoots(token1.address)).to.be.eq(tree_root2)

            expect(await distributor.nonce(token1.address)).to.be.eq(old_nonce.add(2))

            await expect(
                update_tx
            ).to.emit(distributor, "UpdateRoot")
                .withArgs(token1.address, tree_root2, old_nonce.add(2));

        });

        it(' should fail if the root is 0', async () => {

            await expect(
                distributor.connect(rootManager).updateRoot(token1.address, "0x0000000000000000000000000000000000000000000000000000000000000000")
            ).to.be.revertedWith("EmptyMerkleRoot")

        });

        it(' should fail if given the address 0x0', async () => {

            await expect(
                distributor.connect(rootManager).updateRoot(ethers.constants.AddressZero, tree_root)
            ).to.be.revertedWith("ZeroAddress")

        });

        it(' should only be callable by allowed addresses', async () => {

            await expect(
                distributor.connect(user1).updateRoot(token1.address, tree_root)
            ).to.be.revertedWith("CallerNotAllowed")

            await expect(
                distributor.connect(user4).updateRoot(token1.address, tree_root)
            ).to.be.revertedWith("CallerNotAllowed")

        });

    });

    describe('multiUpdateRoot', async () => {

        let tree2: BalanceTree;
        let tree3: BalanceTree;

        let tree_root: string
        let tree_root2: string
        let tree_root3: string

        beforeEach(async () => {
            
            tree = new BalanceTree([
                { account: user1.address, amount: claim_amounts1[0] },
                { account: user2.address, amount: claim_amounts1[1] },
                { account: user3.address, amount: claim_amounts1[2] },
                { account: user4.address, amount: claim_amounts1[3] },
            ]);
            tree2 = new BalanceTree([
                { account: user1.address, amount: claim_amounts2[0] },
                { account: user2.address, amount: claim_amounts2[1] },
                { account: user4.address, amount: claim_amounts2[3] },
            ]); 
            tree3 = new BalanceTree([
                { account: user1.address, amount: claim_amounts3[0] },
                { account: user3.address, amount: claim_amounts3[2] },
                { account: user4.address, amount: claim_amounts3[3] },
            ]); 

            tree_root = tree.getHexRoot()
            tree_root2 = tree2.getHexRoot()
            tree_root3 = tree3.getHexRoot()

            await distributor.connect(rootManager).freezeRoot(token1.address)
            await distributor.connect(rootManager).freezeRoot(token2.address)

        });

        it(' should set the correct Merkle Roots for the tokens (& emit Event)', async () => {

            const old_nonce1 = await distributor.nonce(token1.address)
            const old_nonce2 = await distributor.nonce(token2.address)

            const update_tx = await distributor.connect(rootManager).multiUpdateRoot(
                [token1.address, token2.address],
                [tree_root, tree_root2]
            )

            expect(await distributor.merkleRoots(token1.address)).to.be.eq(tree_root)
            expect(await distributor.merkleRoots(token2.address)).to.be.eq(tree_root2)

            expect(await distributor.nonce(token1.address)).to.be.eq(old_nonce1.add(1))
            expect(await distributor.nonce(token1.address)).to.be.eq(old_nonce2.add(1))

            expect(await distributor.frozen(token1.address)).to.be.false
            expect(await distributor.frozen(token2.address)).to.be.false

            await expect(
                update_tx
            ).to.emit(distributor, "UpdateRoot")
                .withArgs(token1.address, tree_root, old_nonce1.add(1));

            await expect(
                update_tx
            ).to.emit(distributor, "UpdateRoot")
                .withArgs(token2.address, tree_root2, old_nonce2.add(1));

        });

        it(' should allow to update the same root again', async () => {

            const old_nonce1 = await distributor.nonce(token1.address)
            const old_nonce2 = await distributor.nonce(token2.address)

            await distributor.connect(rootManager).multiUpdateRoot(
                [token1.address, token2.address],
                [tree_root3, tree_root]
            )

            await distributor.connect(rootManager).freezeRoot(token1.address)
            await distributor.connect(rootManager).freezeRoot(token2.address)

            const update_tx = await distributor.connect(rootManager).multiUpdateRoot(
                [token1.address, token2.address],
                [tree_root, tree_root2]
            )

            expect(await distributor.merkleRoots(token1.address)).to.be.eq(tree_root)
            expect(await distributor.merkleRoots(token2.address)).to.be.eq(tree_root2)

            expect(await distributor.nonce(token1.address)).to.be.eq(old_nonce1.add(2))
            expect(await distributor.nonce(token1.address)).to.be.eq(old_nonce2.add(2))

            expect(await distributor.frozen(token1.address)).to.be.false
            expect(await distributor.frozen(token2.address)).to.be.false

            await expect(
                update_tx
            ).to.emit(distributor, "UpdateRoot")
                .withArgs(token1.address, tree_root, old_nonce1.add(2));

            await expect(
                update_tx
            ).to.emit(distributor, "UpdateRoot")
                .withArgs(token2.address, tree_root2, old_nonce2.add(2));

        });

        it(' should fail if the array is empty', async () => {

            await expect(
                distributor.connect(rootManager).multiUpdateRoot(
                    [],
                    [tree_root, tree_root2]
                )
            ).to.be.revertedWith('EmptyArray')

        });

        it(' should fail if list are inequal', async () => {

            await expect(
                distributor.connect(rootManager).multiUpdateRoot(
                    [token1.address, token2.address],
                    [tree_root, tree_root2, tree_root3]
                )
            ).to.be.revertedWith('InequalArraySizes')

            await expect(
                distributor.connect(rootManager).multiUpdateRoot(
                    [token1.address],
                    [tree_root, tree_root2]
                )
            ).to.be.revertedWith('InequalArraySizes')

        });

        it(' should only be callable by allowed addresses', async () => {

            await expect(
                distributor.connect(user1).multiUpdateRoot(
                    [token1.address, token2.address],
                    [tree_root, tree_root2]
                )
            ).to.be.revertedWith('CallerNotAllowed')

            await expect(
                distributor.connect(user4).multiUpdateRoot(
                    [token1.address, token2.address],
                    [tree_root, tree_root2]
                )
            ).to.be.revertedWith('CallerNotAllowed')

        });

    });

    describe('claim', async () => {

        describe('small tree', async () => {

            let tree_root: string

            let tree2: BalanceTree;
            let tree_root2: string

            beforeEach(async () => {
                
                tree = new BalanceTree([
                    { account: user1.address, amount: claim_amounts1[0] },
                    { account: user2.address, amount: claim_amounts1[1] },
                    { account: user3.address, amount: claim_amounts1[2] },
                    { account: user4.address, amount: claim_amounts1[3] },
                ]);
                tree2 = new BalanceTree([
                    { account: user1.address, amount: claim_amounts2[0] },
                    { account: user2.address, amount: claim_amounts2[1] },
                    { account: user4.address, amount: claim_amounts2[3] },
                ]); 

                tree_root = tree.getHexRoot()
                tree_root2 = tree2.getHexRoot()

                await distributor.connect(rootManager).freezeRoot(token1.address)
                await distributor.connect(rootManager).updateRoot(token1.address, tree_root)

                await token1.connect(admin).transfer(distributor.address, ethers.utils.parseEther("1000"))

            });

            it(' should claim correctly', async () => {

                const token_nonce = await distributor.nonce(token1.address)

                const proof = tree.getProof(0, user1.address, claim_amounts1[0]);
    
                const old_balance = await token1.balanceOf(user1.address)

                const claim_tx = await distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], proof)
    
                await expect(
                    claim_tx
                ).to.emit(distributor, "Claimed")
                    .withArgs(token1.address, 0, user1.address, claim_amounts1[0], token_nonce);
    
                    const new_balance = await token1.balanceOf(user1.address)
    
                expect(new_balance.sub(old_balance)).to.be.eq(claim_amounts1[0])
    
                expect(await distributor.isClaimed(token1.address, 0)).to.be.true
    
            });
    
            it(' should allow to claim from 2 different tokens', async () => {

                await distributor.connect(rootManager).freezeRoot(token2.address)
                await distributor.connect(rootManager).updateRoot(token2.address, tree_root2)
                await token2.connect(admin).transfer(distributor.address, ethers.utils.parseEther("1000"))

                const token_nonce = await distributor.nonce(token1.address)

                const proof = tree.getProof(0, user1.address, claim_amounts1[0]);
    
                const old_balance = await token1.balanceOf(user1.address)

                const claim_tx = await distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], proof)
    
                await expect(
                    claim_tx
                ).to.emit(distributor, "Claimed")
                    .withArgs(token1.address, 0, user1.address, claim_amounts1[0], token_nonce);
    
                const new_balance = await token1.balanceOf(user1.address)
    
                expect(new_balance.sub(old_balance)).to.be.eq(claim_amounts1[0])
    
                expect(await distributor.isClaimed(token1.address, 0)).to.be.true
                expect(await distributor.isClaimed(token2.address, 0)).to.be.false

                const proof2 = tree2.getProof(0, user1.address, claim_amounts2[0]);
    
                const old_balance2 = await token2.balanceOf(user1.address)

                const token_nonce2 = await distributor.nonce(token2.address)

                const claim_tx2 = await distributor.connect(user1).claim(token2.address, 0, user1.address, claim_amounts2[0], proof2)
    
                await expect(
                    claim_tx2
                ).to.emit(distributor, "Claimed")
                    .withArgs(token2.address, 0, user1.address, claim_amounts2[0], token_nonce2);
    
                const new_balance2 = await token2.balanceOf(user1.address)
    
                expect(new_balance2.sub(old_balance2)).to.be.eq(claim_amounts2[0])
    
                expect(await distributor.isClaimed(token2.address, 0)).to.be.true
    
            });
    
            it(' should not allow double claim', async () => {
    
                const proof = tree.getProof(0, user1.address, claim_amounts1[0]);
    
                await distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], proof)
    
                await expect(
                    distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], proof)
                ).to.be.revertedWith('AlreadyClaimed')
    
            });
    
            it(' should fail if frozen', async () => {
    
                const proof = tree.getProof(0, user1.address, claim_amounts1[0]);
    
                await distributor.connect(rootManager).freezeRoot(token1.address)
    
                await expect(
                    distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], proof)
                ).to.be.revertedWith('MerkleRootFrozen')
    
            });
    
            it(' should fail if no root updated', async () => {
    
                const proof = tree.getProof(0, user1.address, claim_amounts1[0]);
    
                await expect(
                    distributor.connect(user1).claim(token2.address, 0, user1.address, claim_amounts1[0], proof)
                ).to.be.revertedWith('MerkleRootNotUpdated')
    
            });
    
            it(' should fail if proof is incorrect', async () => {
    
                const proof = tree.getProof(0, user1.address, claim_amounts1[0]);
    
                //empty proof
                await expect(
                    distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], [])
                ).to.be.revertedWith('InvalidProof')
    
                //wrong proof
                await expect(
                    distributor.connect(user1).claim(
                        token1.address,
                        0,
                        user1.address,
                        claim_amounts1[0],
                        tree.getProof(2, user3.address, claim_amounts1[2])
                    )
                ).to.be.revertedWith('InvalidProof')
    
                //incorrect index
                await expect(
                    distributor.connect(user1).claim(token1.address, 1, user1.address, claim_amounts1[0], proof)
                ).to.be.revertedWith('InvalidProof')
    
            });
    
            it(' should fail if amount is incorrect', async () => {
    
                const proof = tree.getProof(0, user1.address, claim_amounts1[0]);
    
                await expect(
                    distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[2], proof)
                ).to.be.revertedWith('InvalidProof')
    
            });
    
            it(' should fail if claimer address is incorrect', async () => {
    
                const proof = tree.getProof(0, user1.address, claim_amounts1[0]);
    
                await expect(
                    distributor.connect(user2).claim(token1.address, 0, user2.address, claim_amounts1[0], proof)
                ).to.be.revertedWith('InvalidProof')
    
            });
    
            it(' should not allow double claims: 0 then 1', async () => {
    
                const proof_1 = tree.getProof(0, user1.address, claim_amounts1[0]);
                const proof_2 = tree.getProof(1, user2.address, claim_amounts1[1]);
    
                await distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], proof_1)
    
                await distributor.connect(user2).claim(token1.address, 1, user2.address, claim_amounts1[1], proof_2)
    
                await expect(
                    distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], proof_1)
                ).to.be.revertedWith('AlreadyClaimed')
    
            });
    
            it(' should not allow double claims: 1 then 0', async () => {
    
                const proof_1 = tree.getProof(0, user1.address, claim_amounts1[0]);
                const proof_2 = tree.getProof(1, user2.address, claim_amounts1[1]);
    
                await distributor.connect(user2).claim(token1.address, 1, user2.address, claim_amounts1[1], proof_2)
    
                await distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], proof_1)
    
                await expect(
                    distributor.connect(user2).claim(token1.address, 1, user2.address, claim_amounts1[1], proof_2)
                ).to.be.revertedWith('AlreadyClaimed')
    
            });
    
            it(' should not allow double claims: 0 then 2', async () => {
    
                const proof_1 = tree.getProof(0, user1.address, claim_amounts1[0]);
                const proof_3 = tree.getProof(2, user3.address, claim_amounts1[2]);
    
                await distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], proof_1)
    
                await distributor.connect(user3).claim(token1.address, 2, user3.address, claim_amounts1[2], proof_3)
    
                await expect(
                    distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], proof_1)
                ).to.be.revertedWith('AlreadyClaimed')
    
            });
    
            it(' should not allow double claims: 2 then 0', async () => {
    
                const proof_1 = tree.getProof(0, user1.address, claim_amounts1[0]);
                const proof_3 = tree.getProof(2, user3.address, claim_amounts1[2]);
    
                await distributor.connect(user3).claim(token1.address, 2, user3.address, claim_amounts1[2], proof_3)
    
                await distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], proof_1)
    
                await expect(
                    distributor.connect(user3).claim(token1.address, 2, user3.address, claim_amounts1[2], proof_3)
                ).to.be.revertedWith('AlreadyClaimed')
    
            });
        
        });

        describe('larger tree', async () => {
        
            let new_tree: BalanceTree;

            let total_claim = 0;

            beforeEach(async () => {

                new_tree = new BalanceTree(
                    signers.map((s, i) => {
                        total_claim += i + 1

                        return { account: s.address, amount: BigNumber.from(i + 1) };
                    })
                );

                const tree_root = new_tree.getHexRoot()

                await distributor.connect(rootManager).freezeRoot(token1.address)
                await distributor.connect(rootManager).updateRoot(token1.address, tree_root)

                await token1.connect(admin).transfer(distributor.address, ethers.utils.parseEther("1000"))

            });

            it(' claim index 0', async () => {

                const index = 0

                const claim_amount = BigNumber.from(index + 1)

                const token_nonce = await distributor.nonce(token1.address)

                const proof = new_tree.getProof(index, signers[index].address, claim_amount);

                const old_balance = await token1.balanceOf(signers[index].address)

                await expect(
                    distributor.connect(signers[index]).claim(token1.address, index, signers[index].address, claim_amount, proof)
                ).to.emit(distributor, "Claimed")
                    .withArgs(token1.address, index, signers[index].address, claim_amount, token_nonce);

                    const new_balance = await token1.balanceOf(signers[index].address)

                expect(new_balance.sub(old_balance)).to.be.eq(claim_amount)

                expect(await distributor.isClaimed(token1.address, index)).to.be.true

                await expect(
                    distributor.connect(signers[index]).claim(token1.address, index, signers[index].address, claim_amount, proof)
                ).to.be.revertedWith('AlreadyClaimed')

            });

            it(' claim index 5', async () => {

                const index = 5

                const claim_amount = BigNumber.from(index + 1)

                const token_nonce = await distributor.nonce(token1.address)

                const proof = new_tree.getProof(index, signers[index].address, claim_amount);

                const old_balance = await token1.balanceOf(signers[index].address)

                await expect(
                    distributor.connect(signers[index]).claim(token1.address, index, signers[index].address, claim_amount, proof)
                ).to.emit(distributor, "Claimed")
                    .withArgs(token1.address, index, signers[index].address, claim_amount, token_nonce);

                const new_balance = await token1.balanceOf(signers[index].address)

                expect(new_balance.sub(old_balance)).to.be.eq(claim_amount)

                expect(await distributor.isClaimed(token1.address, index)).to.be.true

                await expect(
                    distributor.connect(signers[index]).claim(token1.address, index, signers[index].address, claim_amount, proof)
                ).to.be.revertedWith('AlreadyClaimed')

            });

            it(' claim index 15', async () => {

                const index = 15

                const claim_amount = BigNumber.from(index + 1)

                const token_nonce = await distributor.nonce(token1.address)

                const proof = new_tree.getProof(index, signers[index].address, claim_amount);

                const old_balance = await token1.balanceOf(signers[index].address)

                await expect(
                    distributor.connect(signers[index]).claim(token1.address, index, signers[index].address, claim_amount, proof)
                ).to.emit(distributor, "Claimed")
                    .withArgs(token1.address, index, signers[index].address, claim_amount, token_nonce);

                const new_balance = await token1.balanceOf(signers[index].address)

                expect(new_balance.sub(old_balance)).to.be.eq(claim_amount)

                expect(await distributor.isClaimed(token1.address, index)).to.be.true

                await expect(
                    distributor.connect(signers[index]).claim(token1.address, index, signers[index].address, claim_amount, proof)
                ).to.be.revertedWith('AlreadyClaimed')

            });

        });

        describe('tree 10 000 users', async () => {

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

                const tree_root = new_tree.getHexRoot()

                await distributor.connect(rootManager).freezeRoot(token1.address)
                await distributor.connect(rootManager).updateRoot(token1.address, tree_root)

                await token1.connect(admin).transfer(distributor.address, claim_amount.mul(nb_tests * 2))
    
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
                    const proof = new_tree.getProof(index, user1.address, claim_amount);
    
                    const old_balance = await token1.balanceOf(user1.address)

                    const token_nonce = await distributor.nonce(token1.address)
    
                    await expect(
                        distributor.connect(user1).claim(token1.address, index, user1.address, claim_amount, proof)
                    ).to.emit(distributor, "Claimed")
                        .withArgs(token1.address, index, user1.address, claim_amount, token_nonce);
    
                    const new_balance = await token1.balanceOf(user1.address)
    
                    expect(new_balance.sub(old_balance)).to.be.eq(claim_amount)
    
                    await expect(
                        distributor.connect(user1).claim(token1.address, index, user1.address, claim_amount, proof)
                    ).to.be.revertedWith('AlreadyClaimed')
                }
    
            });
    
        });

    });

    describe('multiClaim', async () => {let tree_root: string

        let tree2: BalanceTree;
        let tree_root2: string

        beforeEach(async () => {
            
            tree = new BalanceTree([
                { account: user1.address, amount: claim_amounts1[0] },
                { account: user2.address, amount: claim_amounts1[1] },
                { account: user3.address, amount: claim_amounts1[2] },
                { account: user4.address, amount: claim_amounts1[3] },
            ]);
            tree2 = new BalanceTree([
                { account: user1.address, amount: claim_amounts2[0] },
                { account: user2.address, amount: claim_amounts2[1] },
                { account: user4.address, amount: claim_amounts2[3] },
            ]); 

            tree_root = tree.getHexRoot()
            tree_root2 = tree2.getHexRoot()

            await distributor.connect(rootManager).freezeRoot(token1.address)
            await distributor.connect(rootManager).freezeRoot(token2.address)
            await distributor.connect(rootManager).updateRoot(token1.address, tree_root)
            await distributor.connect(rootManager).updateRoot(token2.address, tree_root2)

            await token1.connect(admin).transfer(distributor.address, ethers.utils.parseEther("1000"))
            await token2.connect(admin).transfer(distributor.address, ethers.utils.parseEther("1000"))

        });

        it(' should claim for both tokens at once', async () => {

            const claim_params = [
                { 
                    token: token1.address,
                    index: 0,
                    amount: claim_amounts1[0],
                    merkleProof: tree.getProof(0, user1.address, claim_amounts1[0])
                },
                { 
                    token: token2.address,
                    index: 0,
                    amount: claim_amounts2[0],
                    merkleProof: tree2.getProof(0, user1.address, claim_amounts2[0])
                }
            ]

            const token_nonce1 = await distributor.nonce(token1.address)
            const token_nonce2 = await distributor.nonce(token2.address)

            const old_balance1 = await token1.balanceOf(user1.address)
            const old_balance2 = await token2.balanceOf(user1.address)

            const claim_tx = await distributor.connect(user1).multiClaim(
                user1.address,
                claim_params
            )
    
            await expect(
                claim_tx
            ).to.emit(distributor, "Claimed")
                .withArgs(token1.address, 0, user1.address, claim_amounts1[0], token_nonce1);
    
            await expect(
                claim_tx
            ).to.emit(distributor, "Claimed")
                .withArgs(token2.address, 0, user1.address, claim_amounts2[0], token_nonce2);

            const new_balance1 = await token1.balanceOf(user1.address)
            const new_balance2 = await token2.balanceOf(user1.address)

            expect(new_balance1.sub(old_balance1)).to.be.eq(claim_amounts1[0])
            expect(new_balance2.sub(old_balance2)).to.be.eq(claim_amounts2[0])

            expect(await distributor.isClaimed(token1.address, 0)).to.be.true
            expect(await distributor.isClaimed(token2.address, 0)).to.be.true


        });

        it(' should fail if 1 already claimed', async () => {

            await distributor.connect(user1).claim(token1.address, 0, user1.address, claim_amounts1[0], tree.getProof(0, user1.address, claim_amounts1[0]))

            const claim_params = [
                { 
                    token: token1.address,
                    index: 0,
                    amount: claim_amounts1[0],
                    merkleProof: tree.getProof(0, user1.address, claim_amounts1[0])
                },
                { 
                    token: token2.address,
                    index: 0,
                    amount: claim_amounts2[0],
                    merkleProof: tree2.getProof(0, user1.address, claim_amounts2[0])
                }
            ]

            await expect(
                distributor.connect(user1).multiClaim(
                    user1.address,
                    claim_params
                )
            ).to.be.revertedWith('AlreadyClaimed')

        });

        it(' should fail if the claims are frozen', async () => {

            await distributor.connect(rootManager).freezeRoot(token1.address)
            await distributor.connect(rootManager).freezeRoot(token2.address)

            const claim_params = [
                { 
                    token: token1.address,
                    index: 0,
                    amount: claim_amounts1[0],
                    merkleProof: tree.getProof(0, user1.address, claim_amounts1[0])
                },
                { 
                    token: token2.address,
                    index: 0,
                    amount: claim_amounts2[0],
                    merkleProof: tree2.getProof(0, user1.address, claim_amounts2[0])
                }
            ]

            await expect(
                distributor.connect(user1).multiClaim(
                    user1.address,
                    claim_params
                )
            ).to.be.revertedWith('MerkleRootFrozen')

        });

        it(' should fail if given an empty array', async () => {

            await expect(
                distributor.connect(user1).multiClaim(
                    user1.address,
                    []
                )
            ).to.be.revertedWith('EmptyParameters')

        });

        it(' should fail if given address 0x0', async () => {

            const claim_params = [
                { 
                    token: token1.address,
                    index: 0,
                    amount: claim_amounts1[0],
                    merkleProof: tree.getProof(0, user1.address, claim_amounts1[0])
                },
                { 
                    token: token2.address,
                    index: 0,
                    amount: claim_amounts2[0],
                    merkleProof: tree2.getProof(0, user1.address, claim_amounts2[0])
                }
            ]

            await expect(
                distributor.connect(user1).multiClaim(
                    ethers.constants.AddressZero,
                    claim_params
                )
            ).to.be.revertedWith('ZeroAddress')

        });

    });

    describe('updateRootManager', async () => {

        it(' should update the QuestBoard address', async () => {

            const update_tx = await distributor.connect(admin).updateRootManager(user2.address)

            expect(await distributor.rootManager()).to.be.eq(user2.address)

            await expect(
                update_tx
            ).to.emit(distributor, "UpdateRootManager")
                .withArgs(rootManager.address, user2.address);

        });


        it(' should block non-admin caller', async () => {

            await expect(
                distributor.connect(rootManager).updateRootManager(user2.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                distributor.connect(user2).updateRootManager(user2.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


});