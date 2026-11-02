// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Kinwarden activity-log anchors
/// @notice Kinwarden keeps a SHA-256 hash-chained log of everything its agent, the family and the outside
/// world did on a case. At each milestone the log's latest ("head") hash is written here, so anyone can
/// later check that the log was not edited after that point. Only hashes are stored: no names, amounts
/// or accounts. Only the deploying wallet can write, so an anchor can't be faked by someone else.
contract KinwardenAnchor {
    address public immutable owner;
    uint256 public count;

    /// @param head  head hash of the log after entry `seq` (SHA-256, 32 bytes)
    /// @param seq   number of the log entry the head hash belongs to
    /// @param label what happened, e.g. "th-medical:payment.completed" (never personal data)
    event Anchored(uint256 indexed index, bytes32 indexed head, uint64 seq, string label, uint256 at);

    constructor() {
        owner = msg.sender;
    }

    function anchor(bytes32 head, uint64 seq, string calldata label) external returns (uint256 index) {
        require(msg.sender == owner, "only the Kinwarden anchor wallet");
        require(bytes(label).length <= 96, "label too long");
        index = count++;
        emit Anchored(index, head, seq, label, block.timestamp);
    }
}
