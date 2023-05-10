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
  

Dark Quest Board: 0xF9F6F5F2250Bd151797DDF2e02644123b0c4A114  

Dark MultiMerkleDistributor:
0xce6dc32252d85e2e955Bfd3b85660917F040a933  
  

Light Quest Board - vlCVX: 0x05CaDb2CCC5bE3f6BF8592B9be39c78FF03Cc0DB  

Light MultiMerkleDistributor - vlCVX:
0xE329134C2384cF59c34c98B0ABD0C70aB524e335 

**veBAL:**
Quest Board: 0x8b2ba835056965808aD88e7Ad7866BD57aE75839  

MultiMerkleDistributor:
0x8EdcFE9Bc7d2a735117B94C16456D8303777abbb  
  

Dark Quest Board: 0x609FB23b9EA7CB3eDaF56DB5dAF07C8E94C155De  

Dark MultiMerkleDistributor:
0x358549D4Cb7f97f389812B86673a6cf8c1FF59D2  
  

Light Quest Board - vlAURA: 0x653D8f14292A1C5239d6183b333De1F2e8669310  

Light MultiMerkleDistributor - vlAURA:
0xbc269b4e4D056821edDa92D936b8EC8979b1129C 

**veLIT:**
Quest Board: 0xA6Ed52EB3e39891CE5029817CdB5eAc97A2834B3  

MultiMerkleDistributor:
0x3682518b529e4404fb05250F9ad590C3218E5F9f

Dark Quest Board: 0x790F07657389F590d91330a75ccD633F4ab1B4c9  

Dark MultiMerkleDistributor:
0x98b8d3F9C08a082C593D54DE4633E503eD40c77c  

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


Warden Quest was audited by Spearbit: [Report](https://github.com/PaladinFinance/Warden-Quest/blob/526eecb1594353223ebc6d3459867ecfadbc38e7/audit/Spearbit%20-%20Quest%20audit.pdf)


## Ressources


Website : [paladin.vote](https://.paladin.vote)

Documentation : [doc.paladin.vote](https://doc.paladin.vote)


## Community

For any question about this project, or to engage with us :

[Twitter](https://twitter.com/Paladin_vote)

[Discord](https://discord.com/invite/esZhmTbKHc)



## License


This project is licensed under the [MIT](https://github.com/PaladinFinance/Warden-Quest/blob/main/MIT-LICENSE.TXT) license


