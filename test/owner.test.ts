const hre = require("hardhat");
import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { QuestTreasureChest } from "../typechain/QuestTreasureChest";
import { QuestBoard } from "../typechain/QuestBoard";
import { MultiMerkleDistributor } from "../typechain/MultiMerkleDistributor";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "@ethersproject/contracts";


chai.use(solidity);
const { expect } = chai;
const { provider } = ethers;

let chestFactory: ContractFactory
let boardFactory: ContractFactory
let distributorFactory: ContractFactory

describe('Owner contract tests', () => {
    let admin: SignerWithAddress
    let newOwner: SignerWithAddress
    let otherOwner: SignerWithAddress

    let fakeController: SignerWithAddress

    let chest: QuestTreasureChest
    let board: QuestBoard
    let distributor: MultiMerkleDistributor

    before(async () => {
        [admin, newOwner, otherOwner, fakeController] = await ethers.getSigners();

        chestFactory = await ethers.getContractFactory("QuestTreasureChest");

        boardFactory = await ethers.getContractFactory("QuestBoard");

        distributorFactory = await ethers.getContractFactory("MultiMerkleDistributor");

    })

    beforeEach(async () => {

        chest = (await chestFactory.connect(admin).deploy()) as QuestTreasureChest;
        await chest.deployed();

        board = (await boardFactory.connect(admin).deploy(fakeController.address, chest.address)) as QuestBoard;
        await board.deployed();

        distributor = (await distributorFactory.connect(admin).deploy(board.address)) as MultiMerkleDistributor;
        await distributor.deployed();

    });


    it(' should be deployed & have correct owner', async () => {
        expect(chest.address).to.properAddress

        expect(await chest.owner()).to.be.eq(admin.address)
        expect(await board.owner()).to.be.eq(admin.address)
        expect(await distributor.owner()).to.be.eq(admin.address)

    });


    describe('transferOwnership', async () => {

        it(' should set the correct _pendingOwner', async () => {

            const tx = await chest.connect(admin).transferOwnership(newOwner.address)

            await expect(
                tx
            ).to.emit(chest, "NewPendingOwner")
            .withArgs(ethers.constants.AddressZero, newOwner.address);

            expect(await chest.pendingOwner()).to.be.eq(newOwner.address)

            await board.connect(admin).transferOwnership(newOwner.address)

            expect(await board.pendingOwner()).to.be.eq(newOwner.address)

            await distributor.connect(admin).transferOwnership(newOwner.address)

            expect(await distributor.pendingOwner()).to.be.eq(newOwner.address)

        });

        it(' should fail if address 0 is given', async () => {

            await expect(
                chest.connect(admin).transferOwnership(ethers.constants.AddressZero)
            ).to.be.revertedWith('Owner: new owner is the zero address')

            await expect(
                board.connect(admin).transferOwnership(ethers.constants.AddressZero)
            ).to.be.revertedWith('Owner: new owner is the zero address')

            await expect(
                distributor.connect(admin).transferOwnership(ethers.constants.AddressZero)
            ).to.be.revertedWith('Owner: new owner is the zero address')

        });

        it(' should fail if not called by owner', async () => {

            await expect(
                chest.connect(newOwner).transferOwnership(newOwner.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                board.connect(newOwner).transferOwnership(newOwner.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

            await expect(
                distributor.connect(otherOwner).transferOwnership(newOwner.address)
            ).to.be.revertedWith('Ownable: caller is not the owner')

        });

        it(' should fail if giving the current owner as parameter', async () => {

            await expect(
                chest.connect(admin).transferOwnership(admin.address)
            ).to.be.revertedWith('Owner: new owner cannot be current owner')

            await expect(
                board.connect(admin).transferOwnership(admin.address)
            ).to.be.revertedWith('Owner: new owner cannot be current owner')

            await expect(
                distributor.connect(admin).transferOwnership(admin.address)
            ).to.be.revertedWith('Owner: new owner cannot be current owner')

        });

    });


    describe('acceptOwnership', async () => {

        beforeEach(async () => {

            await chest.connect(admin).transferOwnership(newOwner.address)
            await board.connect(admin).transferOwnership(newOwner.address)
            await distributor.connect(admin).transferOwnership(newOwner.address)

        });

        it(' should update the owner correctly', async () => {

            const tx = await chest.connect(newOwner).acceptOwnership()

            await expect(
                tx
            ).to.emit(chest, "OwnershipTransferred")
            .withArgs(admin.address, newOwner.address);

            await expect(
                tx
            ).to.emit(chest, "NewPendingOwner")
            .withArgs(newOwner.address, ethers.constants.AddressZero);

            expect(await chest.owner()).to.be.eq(newOwner.address)

            await board.connect(newOwner).acceptOwnership()

            expect(await board.owner()).to.be.eq(newOwner.address)

            await distributor.connect(newOwner).acceptOwnership()

            expect(await distributor.owner()).to.be.eq(newOwner.address)

        });

        it(' should fail if not called by the pending owner', async () => {

            await expect(
                chest.connect(admin).acceptOwnership()
            ).to.be.revertedWith('Owner: caller is not pending owner')

            await expect(
                board.connect(otherOwner).acceptOwnership()
            ).to.be.revertedWith('Owner: caller is not pending owner')

            await expect(
                distributor.connect(otherOwner).acceptOwnership()
            ).to.be.revertedWith('Owner: caller is not pending owner')

        });

    });

});