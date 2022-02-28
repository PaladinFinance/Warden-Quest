import { task } from 'hardhat/config';

task('fork-get-ETH', 'Set address ETH balance on the Fork')
    .addPositionalParam(
        'receiver',
        'User address'
    )
    .addPositionalParam(
        'amount',
        'Amount of ETH to send'
    )
    .setAction(async ({receiver, amount}, hre) => {

        if (hre.network.name != 'fork') {
            console.log('Wrong network - Connect to Fork')
            process.exit(1)
        }

        console.log("Sending", amount, " ETH to", receiver)

        await hre.network.provider.request({
            method: "hardhat_setBalance",
            params: [receiver, hre.ethers.utils.parseEther(amount).toHexString()],
        });
    })