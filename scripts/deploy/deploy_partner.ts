import { BigNumber } from "ethers";

export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;


const {
    BOARD_ADDRESS,
    CHEST_ADDRESS
} = require('./utils/main_params');

async function main() {

    const partner_address = ""
    const partner_receiver_address = ""
    const partenr_share = BigNumber.from('500')

    const deployer = (await hre.ethers.getSigners())[0];

    const QuestPartner = await ethers.getContractFactory("QuestPartner");
    console.log('Deploying QuestPartner  ...')

    const partner = await QuestPartner.deploy(
        BOARD_ADDRESS,
        CHEST_ADDRESS,
        partner_address,
        partner_receiver_address,
        partenr_share
    )
    await partner.deployed()

    console.log('QuestPartner : ', partner.address)

    await partner.deployTransaction.wait(15);


    await hre.run("verify:verify", {
        address: partner.address,
        constructorArguments: [
            BOARD_ADDRESS,
            CHEST_ADDRESS,
            partner_address,
            partner_receiver_address,
            partenr_share
        ],
    });

    console.log('To Do: Give approval from QuestChest to the QuestPartner contract')
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });