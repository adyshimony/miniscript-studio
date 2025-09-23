//! Utility functions

use bitcoin::XOnlyPublicKey;
/// Standard NUMS point for taproot (unspendable key)
pub const NUMS_POINT: &str = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";

/// Get the Taproot NUMS (Nothing Up My Sleeve) point for unspendable key-path
pub(crate) fn get_taproot_nums_point() -> XOnlyPublicKey {
    // Standard NUMS point used in Taproot when key-path spending should be disabled
    let nums_bytes = hex::decode(NUMS_POINT).expect("Valid NUMS hex");
    XOnlyPublicKey::from_slice(&nums_bytes).expect("Valid NUMS point")
}


