# Warden Quest


Warden Quest smart contracts


## Overview


Warden Quest is a new system of reward of veCRV Gauge Weight voters. Quests will allow to set a certain objective for a Gauge for 1 or multiple Gauge Weight Votes, and rewards all votes filling that objective (any vote over that objective will not be rewarded by the Quest).  
The rewards of the Quest will be distributed to voters based on age of the vote (the oldest vote get the reward first), and based on the amount of veCRV the user voted with.  
  
Quest creates a new alternative to bribes on Curve Gauge Weight Votes, by allowing to set a fix reward for each vote, and a defined objective of veCRV to the Gauge, and to avoid distributing more rewards than the vote received each period.  
  
Quest parameters (such as the objective, the reward per vote, or the duration), can be changed by the Quest owner, but will only be applied to the next periods.

### Deployed contracts

Quest Treasure Chest:
0x0482A2d6e2F895125b7237de70c675cd55FE17Ca  

**veCRV:**
Quest Board: 0xA6Ed52EB3e39891CE5029817CdB5eAc97A2834B3  

MultiMerkleDistributor:
0x3682518b529e4404fb05250F9ad590C3218E5F9f  

**veBAL:**
Quest Board: 0x8b2ba835056965808aD88e7Ad7866BD57aE75839  

MultiMerkleDistributor:
0x8EdcFE9Bc7d2a735117B94C16456D8303777abbb  

## Dependencies & Installation


To start, make sure you have `node` & `npm` installed : 
* `node` - tested with v16.4.0
* `npm` - tested with v7.18.1

Then, clone this repo, and install the dependencies : 

```
git clone https://github.com/PaladinFinance/Warden-Quest.git
cd Warden-Quest
npm install
```

This will install `Hardhat`, `Ethers v5`, and all the hardhat plugins used in this project.


## Contracts


* [QuestBoard](https://github.com/PaladinFinance/Warden-Quest/tree/main/contracts/QuestBoard.sol) : Main contract, allowing the creation and management of Quest.  
* [MultiMerkleDistributor](https://github.com/PaladinFinance/Warden-Quest/tree/main/contracts/MultiMerkleDistributor.sol) : Contract distributing Quest rewards based on Merkle Trees.
* [QuestTreasureChest](https://github.com/PaladinFinance/Warden-Quest/tree/main/contracts/QuestTreasureChest.sol) : Contract holding the protocol fees paid for Quests.


## Tests


Unit tests can be found in the [test](https://github.com/PaladinFinance/Warden-Quest/tree/main/test) directory.

To run all the tests : 
```
npm run test
```

To run the test on only one contract : 
```
npm run test ./test/questBoard.test.ts  
```


## Deploy


```
npm run build
npm run deploy
```

To deploy some contracts only, see the scripts in [scripts/deploy](https://github.com/PaladinFinance/Warden-Quest/tree/main/scripts/deploy), and setting the correct parameters in [scripts/utils/main_params.js](https://github.com/PaladinFinance/Warden-Quest/tree/main/scripts/deploy/utils/main_params.js)


## Security & Audit


On-going


## Ressources


Website : [paladin.vote](https://.paladin.vote)

Documentation : [doc.paladin.vote](https://doc.paladin.vote)


## Community

For any question about this project, or to engage with us :

[Twitter](https://twitter.com/Paladin_vote)

[Discord](https://discord.com/invite/esZhmTbKHc)



## License


This project is licensed under the [MIT](https://github.com/PaladinFinance/Warden-Quest/blob/main/MIT-LICENSE.TXT) license


