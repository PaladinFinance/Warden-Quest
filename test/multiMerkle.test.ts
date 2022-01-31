const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { MultiMerkleDistributor } from "../typechain/MultiMerkleDistributor";
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

let distributorFactory: ContractFactory

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

    before(async () => {
        [admin, mockQuestBoard, user1, user2, user3, user4] = await ethers.getSigners();

        signers = (await ethers.getSigners()).slice(2) || []; //all signers exepct the one used as admin & the mock quest address

        distributorFactory = await ethers.getContractFactory("MultiMerkleDistributor");

        const crv_amount = ethers.utils.parseEther('5000');
        const dai_amount = ethers.utils.parseEther('100000');

        CRV = IERC20__factory.connect(TOKEN1_ADDRESS, provider);
        DAI = IERC20__factory.connect(TOKEN2_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER1, CRV, admin.address, crv_amount);

        await getERC20(admin, BIG_HOLDER2, DAI, admin.address, dai_amount);

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


    describe('aaaaa', async () => {

        it(' should aaaa', async () => {

            

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

        beforeEach(async () => {


            await DAI.connect(admin).transfer(distributor.address, lost_amount)

        });


        it(' should retrieve the lost tokens and send it to the admin', async () => {

            const oldBalance = await DAI.balanceOf(admin.address);

            await distributor.connect(admin).recoverERC20(DAI.address, lost_amount)

            const newBalance = await DAI.balanceOf(admin.address);

            expect(newBalance.sub(oldBalance)).to.be.eq(lost_amount)

        });

        it(' should block non-admin caller', async () => {

            await expect(
                distributor.connect(user2).recoverERC20(DAI.address, ethers.utils.parseEther('10'))
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });

});