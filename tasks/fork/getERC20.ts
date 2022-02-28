import { task } from 'hardhat/config';
import { IERC20 } from "../../typechain/IERC20";
import { IERC20__factory } from "../../typechain/factories/IERC20__factory";

require("dotenv").config();

task('fork-get-ERC20', 'Steal ERC20 amount from holder to send to receiver on the Fork')
    .addPositionalParam(
        'receiver',
        'User address'
    )
    .addPositionalParam(
        'amount',
        'Amount of ETH to send'
    )
    .addPositionalParam(
        'token',
        'Address of the ERC20 token'
    )
    .addPositionalParam(
        'holder',
        'Address of the holder'
    )
    .setAction(async ({receiver, amount, token, holder}, hre) => {

        if (hre.network.name != 'fork') {
            console.log('Wrong network - Connect to Fork')
            process.exit(1)
        }

        hre.ethers.provider = new hre.ethers.providers.JsonRpcProvider(process.env.FORK_URI)

        const ERC20 = IERC20__factory.connect(token, hre.ethers.provider);

        console.log("Sending", amount, " tokens to", receiver)
    
        /*await hre.network.provider.request({
            method: "hardhat_setBalance",
            params: [holder, hre.ethers.utils.parseEther("500000").toHexString()],
        });*/

        await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [holder],
        });
        const signer = await hre.ethers.getSigner(holder)
    
        await ERC20.connect(signer).transfer(receiver, hre.ethers.utils.parseEther(amount));
    
        await hre.network.provider.request({
            method: "hardhat_stopImpersonatingAccount",
            params: [holder],
        });
    })