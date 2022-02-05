// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @dev Mock GaugeController used for tests
 */
contract MockGaugeController {
    
    struct Point {
        uint bias;
        uint slope;
    }

    mapping(address => bool) public gaugeCheckpointed;

    // Put storage stuff here
    mapping(address => mapping(uint256 => Point)) point_weights;

    mapping(address => int128) types;

    function set_points_weight(address gauge, uint256 period, uint256 slope) external {
        point_weights[gauge][period].slope = slope;
    }

    function points_weight(address gauge, uint256 period) external view returns (Point memory){
        return point_weights[gauge][period];
    }

    function checkpoint_gauge(address gauge) external{
        //No need for implementation here, but this needs to be called on the real GaugeController
        //by the questBoard contract
        gaugeCheckpointed[gauge] = true;
    }

    function add_gauge(address gauge, int128 _type) external {
        require(_type > 0);
        types[gauge] = _type;
    }

    function gauge_types(address gauge) external view returns(int128){
        return types[gauge] - 1;
    }
    
}