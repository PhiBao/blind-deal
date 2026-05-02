// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title BlindDeal — Confidential P2P Price Negotiation
/// @notice Two parties submit encrypted prices. If buyer's max >= seller's min,
///         the deal closes at the midpoint. If not, neither price is revealed.
/// @dev Uses Fhenix CoFHE for fully homomorphic encryption operations on-chain.
contract BlindDeal {
    enum DealState {
        Open,       // Waiting for both parties to submit
        Matched,    // Prices overlapped — deal succeeded
        NoMatch,    // Prices didn't overlap — no deal
        Cancelled,  // One party cancelled before completion
        Expired     // Past deadline without resolution
    }

    struct Deal {
        address buyer;
        address seller;
        euint64 buyerMax;
        euint64 sellerMin;
        euint64 dealPrice;
        ebool   isMatch;
        DealState state;
        bool buyerSubmitted;
        bool sellerSubmitted;
        string description;
        uint256 deadline;
        uint256 createdAt;
    }

    uint256 public dealCount;
    mapping(uint256 => Deal) private deals;
    mapping(address => uint256[]) private userDeals;

    // ── Constants ───────────────────────────────────────────────────────
    uint256 public constant MAX_DEADLINE_DURATION = 365 days;

    // ── Events ──────────────────────────────────────────────────────────
    event DealCreated(uint256 indexed dealId, address indexed buyer, address indexed seller, string description, uint256 deadline);
    event PriceSubmitted(uint256 indexed dealId, address indexed party);
    event DealResolving(uint256 indexed dealId);
    event DealResolved(uint256 indexed dealId, DealState state);
    event DealCancelled(uint256 indexed dealId, address indexed cancelledBy);
    event DealExpired(uint256 indexed dealId, uint256 deadline);

    // ── Errors ──────────────────────────────────────────────────────────
    error NotParticipant();
    error DealNotOpen();
    error AlreadySubmitted();
    error DealNotResolved();
    error NotBuyer();
    error NotSeller();
    error DealDeadlinePassed();
    error DealNotExpired();
    error InvalidDeadline();
    error SelfDeal();
    error ZeroAddress();
    error DeadlineTooLong();

    // ── Create a new negotiation ────────────────────────────────────────
    /// @param _seller The counterparty's address
    /// @param _description Human-readable context for the deal
    /// @param _duration Seconds until deal expires (0 = no deadline)
    function createDeal(address _seller, string calldata _description, uint256 _duration) external returns (uint256 dealId) {
        if (_seller == address(0)) revert ZeroAddress();
        if (_seller == msg.sender) revert SelfDeal();
        if (_duration > MAX_DEADLINE_DURATION) revert DeadlineTooLong();

        dealId = dealCount++;
        Deal storage d = deals[dealId];
        d.buyer = msg.sender;
        d.seller = _seller;
        d.state = DealState.Open;
        d.description = _description;
        d.deadline = _duration > 0 ? block.timestamp + _duration : 0;
        d.createdAt = block.timestamp;

        userDeals[msg.sender].push(dealId);
        userDeals[_seller].push(dealId);

        emit DealCreated(dealId, msg.sender, _seller, _description, d.deadline);
    }

    // ── Submit encrypted prices ─────────────────────────────────────────

    /// @notice Buyer submits their maximum acceptable price (encrypted)
    function submitBuyerPrice(uint256 dealId, InEuint64 calldata encryptedMax) external {
        Deal storage d = deals[dealId];
        if (d.state != DealState.Open) revert DealNotOpen();
        if (d.deadline > 0 && block.timestamp > d.deadline) revert DealDeadlinePassed();
        if (msg.sender != d.buyer) revert NotBuyer();
        if (d.buyerSubmitted) revert AlreadySubmitted();

        d.buyerMax = FHE.asEuint64(encryptedMax);
        FHE.allowThis(d.buyerMax);
        d.buyerSubmitted = true;

        emit PriceSubmitted(dealId, msg.sender);

        if (d.sellerSubmitted) {
            _resolve(dealId);
        }
    }

    /// @notice Seller submits their minimum acceptable price (encrypted)
    function submitSellerPrice(uint256 dealId, InEuint64 calldata encryptedMin) external {
        Deal storage d = deals[dealId];
        if (d.state != DealState.Open) revert DealNotOpen();
        if (d.deadline > 0 && block.timestamp > d.deadline) revert DealDeadlinePassed();
        if (msg.sender != d.seller) revert NotSeller();
        if (d.sellerSubmitted) revert AlreadySubmitted();

        d.sellerMin = FHE.asEuint64(encryptedMin);
        FHE.allowThis(d.sellerMin);
        d.sellerSubmitted = true;

        emit PriceSubmitted(dealId, msg.sender);

        if (d.buyerSubmitted) {
            _resolve(dealId);
        }
    }

    // ── Core FHE resolution ─────────────────────────────────────────────

    /// @dev Computes match and midpoint entirely on encrypted data.
    ///      Only allows ACL on values that need to persist or be decrypted.
    function _resolve(uint256 dealId) internal {
        Deal storage d = deals[dealId];

        // 1. Encrypted comparison: does buyer's max >= seller's min?
        ebool match_ = FHE.gte(d.buyerMax, d.sellerMin);
        d.isMatch = match_;
        FHE.allowThis(d.isMatch);

        // 2. Compute midpoint: (buyerMax + sellerMin) / 2
        euint64 sum = FHE.add(d.buyerMax, d.sellerMin);
        euint64 two = FHE.asEuint64(2);
        euint64 midpoint = FHE.div(sum, two);

        // 3. Deal price = midpoint if matched, 0 if not
        euint64 zero = FHE.asEuint64(0);
        d.dealPrice = FHE.select(match_, midpoint, zero);
        FHE.allowThis(d.dealPrice);

        // 4. Allow both parties to decrypt their result
        FHE.allow(d.isMatch, d.buyer);
        FHE.allow(d.isMatch, d.seller);

        // Allow global decryption of match result
        FHE.allowGlobal(d.isMatch);

        // Request decryption of match result for on-chain state transition.
        // Not all testnet TASK_MANAGER instances support createDecryptTask yet.
        // If it reverts, clientFinalizeDeal is still available as a fallback.
        try ITaskManager(TASK_MANAGER_ADDRESS).createDecryptTask(uint256(ebool.unwrap(d.isMatch)), address(this)) {
            // Task registered for threshold decryption
        } catch {
            // TASK_MANAGER doesn't support createDecryptTask — client-side finalize still works
        }

        emit DealResolving(dealId);
    }

    /// @notice Finalize deal state after off-chain decryption of match result.
    ///         Anyone can call once the Threshold Network has decrypted isMatch.
    function finalizeDeal(uint256 dealId) external {
        Deal storage d = deals[dealId];
        if (d.state != DealState.Open) revert DealNotOpen();
        require(d.buyerSubmitted && d.sellerSubmitted, "Not resolved yet");

        (bool matched, bool decrypted) = FHE.getDecryptResultSafe(d.isMatch);
        require(decrypted, "Match result not ready");

        _finalize(dealId, matched);
    }

    /// @notice Finalize using client-side CoFHE SDK decryption result.
    ///         Either party can call with the match result obtained via decryptForView.
    function clientFinalizeDeal(uint256 dealId, bool matched) external {
        Deal storage d = deals[dealId];
        if (d.state != DealState.Open) revert DealNotOpen();
        require(d.buyerSubmitted && d.sellerSubmitted, "Not resolved yet");
        if (msg.sender != d.buyer && msg.sender != d.seller) revert NotParticipant();

        _finalize(dealId, matched);
    }

    function _finalize(uint256 dealId, bool matched) internal {
        Deal storage d = deals[dealId];

        if (matched) {
            d.state = DealState.Matched;

            // On match: allow both parties to see the deal price
            FHE.allow(d.dealPrice, d.buyer);
            FHE.allow(d.dealPrice, d.seller);
        } else {
            d.state = DealState.NoMatch;
            // No match: nobody gets to see prices — privacy preserved
        }

        emit DealResolved(dealId, d.state);
    }

    // ── Cancel ──────────────────────────────────────────────────────────

    /// @notice Either party can cancel before both prices are submitted
    function cancelDeal(uint256 dealId) external {
        Deal storage d = deals[dealId];
        if (d.state != DealState.Open) revert DealNotOpen();
        if (msg.sender != d.buyer && msg.sender != d.seller) revert NotParticipant();
        // Can only cancel before resolution starts
        require(!d.buyerSubmitted || !d.sellerSubmitted, "Already resolving");

        d.state = DealState.Cancelled;
        emit DealCancelled(dealId, msg.sender);
    }

    // ── Expire ──────────────────────────────────────────────────────────

    /// @notice Anyone can expire a deal past its deadline
    function expireDeal(uint256 dealId) external {
        Deal storage d = deals[dealId];
        if (d.state != DealState.Open) revert DealNotOpen();
        if (d.deadline == 0 || block.timestamp <= d.deadline) revert DealNotExpired();

        d.state = DealState.Expired;
        emit DealExpired(dealId, d.deadline);
    }

    // ── View functions ──────────────────────────────────────────────────

    function getDealState(uint256 dealId) external view returns (DealState) {
        return deals[dealId].state;
    }

    function getDealParties(uint256 dealId) external view returns (address buyer, address seller) {
        return (deals[dealId].buyer, deals[dealId].seller);
    }

    function getDealDescription(uint256 dealId) external view returns (string memory) {
        return deals[dealId].description;
    }

    function isDealSubmitted(uint256 dealId) external view returns (bool buyerDone, bool sellerDone) {
        return (deals[dealId].buyerSubmitted, deals[dealId].sellerSubmitted);
    }

    /// @notice Returns the encrypted deal price handle (only accessible by allowed parties)
    function getDealPrice(uint256 dealId) external view returns (euint64) {
        Deal storage d = deals[dealId];
        if (d.state != DealState.Matched) revert DealNotResolved();
        return d.dealPrice;
    }

    /// @notice Returns the encrypted match result handle
    function getMatchResult(uint256 dealId) external view returns (ebool) {
        return deals[dealId].isMatch;
    }

    /// @notice Returns the deal deadline (0 = no deadline)
    function getDealDeadline(uint256 dealId) external view returns (uint256) {
        return deals[dealId].deadline;
    }

    /// @notice Returns the deal creation timestamp
    function getDealCreatedAt(uint256 dealId) external view returns (uint256) {
        return deals[dealId].createdAt;
    }

    /// @notice Returns all deal IDs that an address is involved in
    function getUserDeals(address user) external view returns (uint256[] memory) {
        return userDeals[user];
    }

    /// @notice Check if the Threshold Network has decrypted the match result
    /// @return ready Whether decryption has completed
    /// @return matched Whether the prices matched (only valid if ready == true)
    function isDecryptionReady(uint256 dealId) external view returns (bool ready, bool matched) {
        Deal storage d = deals[dealId];
        if (!d.buyerSubmitted || !d.sellerSubmitted) return (false, false);
        (bool matchResult, bool decrypted) = FHE.getDecryptResultSafe(d.isMatch);
        return (decrypted, matchResult);
    }
}
