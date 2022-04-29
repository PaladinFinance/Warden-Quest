export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;

const { 
    GAUGE_CONTROLLER
} = require('./utils/constant');

async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    const QuestTreasureChest = await ethers.getContractFactory("QuestTreasureChest");
    const QuestBoard = await ethers.getContractFactory("QuestBoard");
    const MultiMerkleDistributor = await ethers.getContractFactory("MultiMerkleDistributor");

    console.log('Deploying TresaureChest  ...')

    const chest = await QuestTreasureChest.deploy()
    await chest.deployed()

    console.log('TreasureChest : ', chest.address)

    await chest.deployTransaction.wait(15);

    console.log()
    console.log('Deploying QuestBoard  ...')

    const board = await QuestBoard.deploy(
        GAUGE_CONTROLLER,
        chest.address
    )
    await board.deployed()

    console.log('QuestBoard : ', board.address)

    await board.deployTransaction.wait(15);

    console.log()
    console.log('Deploying Distributor  ...')

    const distributor = await MultiMerkleDistributor.deploy(
        board.address
    )
    await distributor.deployed()

    console.log('Distributor : ', distributor.address)

    await distributor.deployTransaction.wait(15);

    console.log()
    console.log('Initiate Distributor  ...')

    let tx;

    tx = await board.connect(deployer).initiateDistributor(distributor.address)
    await tx.wait(10)

    console.log()
    console.log('Approve Manager  ...')

    tx = await board.connect(deployer).approveManager(deployer.address)
    await tx.wait(10)
    tx = await chest.connect(deployer).approveManager(deployer.address)
    await tx.wait(10)


    if(network === 'mainnet') {
        await hre.run("verify:verify", {
            address: distributor.address,
            constructorArguments: [
                board.address
            ],
        });

        await hre.run("verify:verify", {
            address: board.address,
            constructorArguments: [
                GAUGE_CONTROLLER,
                chest.address
            ],
        });

        await hre.run("verify:verify", {
            address: chest.address,
            constructorArguments: [],
        });
    }
}

main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });