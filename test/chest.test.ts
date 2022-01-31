const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { QuestTreasureChest } from "../typechain/QuestTreasureChest";
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

let chestFactory: ContractFactory

describe('QuestTreasureChest contract tests', () => {
    let admin: SignerWithAddress
    let manager1: SignerWithAddress
    let manager2: SignerWithAddress

    let chest: QuestTreasureChest

    let CRV: IERC20
    let DAI: IERC20

    before(async () => {
        [admin, manager1, manager2] = await ethers.getSigners();

        chestFactory = await ethers.getContractFactory("QuestTreasureChest");

        const crv_amount = ethers.utils.parseEther('5000');
        const dai_amount = ethers.utils.parseEther('100000');

        CRV = IERC20__factory.connect(TOKEN1_ADDRESS, provider);
        DAI = IERC20__factory.connect(TOKEN2_ADDRESS, provider);

        await getERC20(admin, BIG_HOLDER1, CRV, admin.address, crv_amount);

        await getERC20(admin, BIG_HOLDER2, DAI, admin.address, dai_amount);

    })

    beforeEach(async () => {

        chest = (await chestFactory.connect(admin).deploy()) as QuestTreasureChest;
        await chest.deployed();

    });


    it(' should be deployed & have correct parameters', async () => {
        expect(chest.address).to.properAddress

        expect(await chest.owner()).to.be.eq(admin.address)

    });


    describe('currentBalance', async () => {

        const dai_transfer1 = ethers.utils.parseEther("2500")
        const dai_transfer2 = ethers.utils.parseEther("1700")

        const crv_transfer = ethers.utils.parseEther("550")

        it(' should return the correct balances', async () => {

            expect(await CRV.balanceOf(chest.address)).to.be.eq(0)
            expect(await DAI.balanceOf(chest.address)).to.be.eq(0)

            expect(await chest.currentBalance(CRV.address)).to.be.eq(0)
            expect(await chest.currentBalance(DAI.address)).to.be.eq(0)

            await DAI.connect(admin).transfer(chest.address, dai_transfer1)

            expect(await chest.currentBalance(CRV.address)).to.be.eq(0)
            expect(await chest.currentBalance(DAI.address)).to.be.eq(dai_transfer1)

            await CRV.connect(admin).transfer(chest.address, crv_transfer)

            expect(await chest.currentBalance(CRV.address)).to.be.eq(crv_transfer)
            expect(await chest.currentBalance(DAI.address)).to.be.eq(dai_transfer1)

            await DAI.connect(admin).transfer(chest.address, dai_transfer2)

            expect(await chest.currentBalance(CRV.address)).to.be.eq(crv_transfer)
            expect(await chest.currentBalance(DAI.address)).to.be.eq(dai_transfer1.add(dai_transfer2))

        });

    });


    describe('approveERC20', async () => {

        const approve_amount = ethers.utils.parseEther("1000")

        beforeEach(async () => {

            await chest.connect(admin).approveManager(manager1.address)

        });

        it(' should approve the correct amount', async () => {

            expect(await CRV.allowance(chest.address, manager1.address)).to.be.eq(0)

            await chest.connect(manager1).approveERC20(CRV.address, manager1.address, approve_amount)

            expect(await CRV.allowance(chest.address, manager1.address)).to.be.eq(approve_amount)

        });

        it(' should approve back to 0', async () => {

            expect(await CRV.allowance(chest.address, manager1.address)).to.be.eq(0)

            await chest.connect(manager1).approveERC20(CRV.address, manager1.address, approve_amount)

            expect(await CRV.allowance(chest.address, manager1.address)).to.be.eq(approve_amount)

            await chest.connect(manager1).approveERC20(CRV.address, manager1.address, 0)

            expect(await CRV.allowance(chest.address, manager1.address)).to.be.eq(0)

        });

        it(' should fail if token address is address Zero', async () => {

            await expect(
                chest.connect(admin).approveERC20(ethers.constants.AddressZero, admin.address, approve_amount)
            ).to.be.reverted

        });

        it(' should only be allowed for admin & managers', async () => {

            await expect(
                chest.connect(manager2).approveERC20(DAI.address, manager2.address, approve_amount)
            ).to.be.revertedWith('TreasureChest: Not allowed')

        });

    });


    describe('transferERC20', async () => {

        const dai_transfer = ethers.utils.parseEther("2500")

        const crv_transfer = ethers.utils.parseEther("550")

        const withdraw_amount1 = ethers.utils.parseEther("300")
        const withdraw_amount2 = ethers.utils.parseEther("750")

        const withdraw_bigger_amount = ethers.utils.parseEther("1000")

        beforeEach(async () => {

            await chest.connect(admin).approveManager(manager1.address)

            await DAI.connect(admin).transfer(chest.address, dai_transfer)

            await CRV.connect(admin).transfer(chest.address, crv_transfer)

        });

        it(' should transfer the tokens', async () => {

            const manager_old_balance = await CRV.balanceOf(manager1.address)
            const admin_old_balance = await DAI.balanceOf(admin.address)

            const chest_old_balance1 = await chest.currentBalance(CRV.address)
            const chest_old_balance2 = await chest.currentBalance(DAI.address)

            await chest.connect(manager1).transferERC20(CRV.address, manager1.address, withdraw_amount1)

            const manager_new_balance = await CRV.balanceOf(manager1.address)
            const chest_new_balance1 = await chest.currentBalance(CRV.address)

            expect(manager_new_balance).to.be.eq(manager_old_balance.add(withdraw_amount1))
            expect(chest_new_balance1).to.be.eq(chest_old_balance1.sub(withdraw_amount1))
            expect(await DAI.balanceOf(admin.address)).to.be.eq(admin_old_balance)
            expect(await chest.currentBalance(DAI.address)).to.be.eq(chest_old_balance2)

            await chest.connect(admin).transferERC20(DAI.address, admin.address, withdraw_amount2)

            const admin_new_balance = await DAI.balanceOf(admin.address)
            const chest_new_balance2 = await chest.currentBalance(DAI.address)

            expect(admin_new_balance).to.be.eq(admin_old_balance.add(withdraw_amount2))
            expect(chest_new_balance2).to.be.eq(chest_old_balance2.sub(withdraw_amount2))
            expect(await CRV.balanceOf(manager1.address)).to.be.eq(manager_new_balance)
            expect(await chest.currentBalance(CRV.address)).to.be.eq(chest_new_balance1)

        });

        it(' should not allow to transfer more than available balance', async () => {

            await expect(
                chest.connect(manager1).transferERC20(CRV.address, manager1.address, withdraw_bigger_amount)
            ).to.be.reverted

        });

        it(' should fail if token address is address Zero', async () => {

            await expect(
                chest.connect(admin).transferERC20(ethers.constants.AddressZero, admin.address, dai_transfer)
            ).to.be.reverted

        });

        it(' should only be allowed for admin & managers', async () => {

            await expect(
                chest.connect(manager2).transferERC20(DAI.address, manager2.address, dai_transfer)
            ).to.be.revertedWith('TreasureChest: Not allowed')

        });

    });


    describe('approveManager', async () => {

        const dai_transfer = ethers.utils.parseEther("2500")

        const withdraw_amount = ethers.utils.parseEther("500")

        beforeEach(async () => {

            await DAI.connect(admin).transfer(chest.address, dai_transfer)

        });

        it(' should allow the added address as manager', async () => {

            await expect(
                chest.connect(manager1).transferERC20(DAI.address, manager1.address, withdraw_amount)
            ).to.be.revertedWith('TreasureChest: Not allowed')

            await chest.connect(admin).approveManager(manager1.address)

            await expect(
                chest.connect(manager1).transferERC20(DAI.address, manager1.address, withdraw_amount)
            ).to.not.be.reverted

        });

        it(' should only be allowed for admin', async () => {

            await expect(
                chest.connect(manager1).approveManager(manager1.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                chest.connect(manager2).approveManager(manager2.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });


    describe('removeManager', async () => {

        const dai_transfer = ethers.utils.parseEther("2500")

        const withdraw_amount = ethers.utils.parseEther("500")

        beforeEach(async () => {

            await chest.connect(admin).approveManager(manager1.address)
            await chest.connect(admin).approveManager(manager2.address)

            await DAI.connect(admin).transfer(chest.address, dai_transfer)

        });

        it(' should remove the address as manager', async () => {

            await expect(
                chest.connect(manager1).transferERC20(DAI.address, manager1.address, withdraw_amount)
            ).to.not.be.reverted

            await chest.connect(admin).removeManager(manager1.address)

            await expect(
                chest.connect(manager1).transferERC20(DAI.address, manager1.address, withdraw_amount)
            ).to.be.revertedWith('TreasureChest: Not allowed')

        });

        it(' should not remove other managers', async () => {

            await chest.connect(admin).removeManager(manager1.address)

            await expect(
                chest.connect(manager2).transferERC20(DAI.address, manager2.address, withdraw_amount)
            ).to.not.be.reverted

        });

        it(' should only be allowed for admin', async () => {

            await expect(
                chest.connect(manager1).removeManager(manager1.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                chest.connect(manager2).removeManager(manager1.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

    });

});