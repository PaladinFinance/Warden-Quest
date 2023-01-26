import { ethers } from "hardhat";
import { BigNumber } from "@ethersproject/bignumber";

const TOKEN1_ADDRESS = "0xfd0205066521550D7d7AB19DA8F72bb004b4C341"; //here : LIT
const TOKEN2_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F"; //here : DAI

const VOTING_ESCROW_ADDRESS = "0xf17d23136B4FeAd139f54fB766c8795faae09660"; //here : veLIT

const BIG_HOLDER1 = "0x63F2695207f1d625a9B0B8178D95cD517bC5E82C"; //here : LIT holder
const BIG_HOLDER2 = "0x075e72a5eDf65F0A5f44699c7654C1a76941Ddc8"; //here : DAI holder

const TOKEN1_AMOUNT = ethers.utils.parseEther('750000'); //here : LIT
const TOKEN2_AMOUNT = ethers.utils.parseEther('8000000'); //here : DAI

const VETOKEN_LOCKING_TIME = Math.floor((86400 * 365) / (86400 * 7)) * (86400 * 7)

const GAUGE_CONTROLLER = "0x901c8aA6A61f74aC95E7f397E22A0Ac7c1242218";

const GAUGES = [
    "0x13A227b851ed1274e205535b3CF1daF6e2bA1E5a",
    "0x7a5252e430C58E527016B2cFF68641C8b8BE21B7",
    "0xE61C1E33dF4921F8B4EF0ee3f7031b472AFB52cF"
]

const TARGET_VOTES = [
    ethers.utils.parseEther("65000"),
    ethers.utils.parseEther("15000"),
    ethers.utils.parseEther("10000")
]

const GAUGE_VOTER = "0x5f350bF5feE8e254D6077f8661E9C7B83a30364e"

const LIGHT_TARGET_VOTES = [
    ethers.utils.parseEther("5000"),
    ethers.utils.parseEther("3500"),
    ethers.utils.parseEther("4200")
]

const BLACKLISTS = [
    ["0x5f350bF5feE8e254D6077f8661E9C7B83a30364e"],
    ["0x5f350bF5feE8e254D6077f8661E9C7B83a30364e", "0x9E8784794cd73B52886cBB1A3538A4594A6c9e8d"],
    ["0xE2763df5eAfe829705f2B49a713b887d3b208C02", "0x5f350bF5feE8e254D6077f8661E9C7B83a30364e"]
]

const BLOCK_NUMBER = 16492100


module.exports = {
    TOKEN1_ADDRESS,
    TOKEN2_ADDRESS,
    VOTING_ESCROW_ADDRESS,
    BIG_HOLDER1,
    BIG_HOLDER2,
    TOKEN1_AMOUNT,
    TOKEN2_AMOUNT,
    VETOKEN_LOCKING_TIME,
    GAUGE_CONTROLLER,
    GAUGES,
    TARGET_VOTES,
    GAUGE_VOTER,
    LIGHT_TARGET_VOTES,
    BLACKLISTS,
    BLOCK_NUMBER
};