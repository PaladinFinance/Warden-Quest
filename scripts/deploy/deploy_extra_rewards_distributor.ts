export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;


const {
    BOARD_ADDRESS
} = require('./utils/main_params');

async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    const ROOT_MANAGER = "0x5ACbD1C0Ad98349BCA68B33E1dD3041aa3EeA1Ba"

    const ExtraRewardsMultiMerkle = await ethers.getContractFactory("ExtraRewardsMultiMerkle");
    console.log('Deploying Extra Rewards Distributor  ...')

    const distributor = await ExtraRewardsMultiMerkle.deploy(
        ROOT_MANAGER
    )
    await distributor.deployed()

    console.log('Distributor : ', distributor.address)

    await distributor.deployTransaction.wait(15);


    /*await hre.run("verify:verify", {
        address: distributor.address,
        constructorArguments: [
            ROOT_MANAGER
        ],
    });*/
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });