// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IBlindDeal {
    function getDealState(uint256 dealId) external view returns (uint8);
}

/// @title BlindDealResolver — Condition resolver for Reineira escrow
/// @notice Returns true when the linked BlindDeal is finalized as Matched (state == 1).
///         Used as a condition resolver so escrow auto-releases on successful negotiation.
contract BlindDealResolver {
    IBlindDeal public immutable blindDeal;

    // escrowId => dealId
    mapping(uint256 => uint256) public escrowToDeal;
    mapping(uint256 => bool) public registered;

    event EscrowLinked(uint256 indexed escrowId, uint256 indexed dealId, address indexed linker);

    error AlreadyRegistered();

    constructor(address _blindDeal) {
        blindDeal = IBlindDeal(_blindDeal);
    }

    /// @notice Called by ConfidentialEscrow.create() — no-op, linking is done via linkEscrow.
    function onConditionSet(uint256, bytes calldata) external {}

    /// @notice Link a Reineira escrow to a BlindDeal so the condition resolver
    ///         can check the deal state when redeem is attempted.
    /// @param escrowId The Reineira escrow ID
    /// @param dealId   The BlindDeal deal ID
    function linkEscrow(uint256 escrowId, uint256 dealId) external {
        if (registered[escrowId]) revert AlreadyRegistered();
        escrowToDeal[escrowId] = dealId;
        registered[escrowId] = true;
        emit EscrowLinked(escrowId, dealId, msg.sender);
    }

    /// @notice Reineira calls this to check if escrow can be redeemed.
    ///         Returns true only when the BlindDeal state is Matched (1).
    function isConditionMet(uint256 escrowId) external view returns (bool) {
        if (!registered[escrowId]) return false;
        return blindDeal.getDealState(escrowToDeal[escrowId]) == 1; // DealState.Matched
    }
}
