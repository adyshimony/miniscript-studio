//! Utility functions

use bitcoin::XOnlyPublicKey;
use miniscript::{Miniscript, Tap};
use crate::NUMS_POINT;

/// Get the Taproot NUMS (Nothing Up My Sleeve) point for unspendable key-path
pub fn get_taproot_nums_point() -> XOnlyPublicKey {
    // Standard NUMS point used in Taproot when key-path spending should be disabled
    let nums_bytes = hex::decode(NUMS_POINT).expect("Valid NUMS hex");
    XOnlyPublicKey::from_slice(&nums_bytes).expect("Valid NUMS point")
}


/// Calculate the worst-case witness weight for a taproot leaf
pub fn taproot_leaf_witness_weight_worst(_ms: &Miniscript<XOnlyPublicKey, Tap>, leaf_script_len: usize, depth: usize) -> u64 {
    // Signature component (always 66 weight units)
    let sig_wu = 66;
    
    // Script component: script size + 1 (for the script length byte)
    let script_wu = (leaf_script_len + 1) as u64;
    
    // Control block component: 33 bytes (taproot output key) + 32 bytes per depth level
    let control_wu = (33 + 32 * depth) as u64;
    
    // Total witness weight
    sig_wu + script_wu + control_wu
}
