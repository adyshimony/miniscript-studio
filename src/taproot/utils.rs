use bitcoin::XOnlyPublicKey;
use miniscript::{Miniscript, Tap};
use crate::console_log;
use crate::NUMS_POINT;

/// Get the Taproot NUMS (Nothing Up My Sleeve) point for unspendable key-path
pub fn get_taproot_nums_point() -> XOnlyPublicKey {
    // Standard NUMS point used in Taproot when key-path spending should be disabled
    let nums_bytes = hex::decode(NUMS_POINT).expect("Valid NUMS hex");
    XOnlyPublicKey::from_slice(&nums_bytes).expect("Valid NUMS point")
}

/// Determine the internal key for Taproot address generation
/// For pk(key) uses the key itself, for everything else uses NUMS
pub fn get_taproot_internal_key(miniscript_str: &str) -> XOnlyPublicKey {
    // Check if this is a simple pk(key) miniscript
    if miniscript_str.starts_with("pk(") && miniscript_str.ends_with(")") {
        // Extract the key from pk(key)
        let key_part = &miniscript_str[3..miniscript_str.len()-1];
        if let Ok(key_bytes) = hex::decode(key_part) {
            if key_bytes.len() == 32 {
                if let Ok(xonly_key) = XOnlyPublicKey::from_slice(&key_bytes) {
                    console_log!("Using pk() key as internal key: {}", key_part);
                    return xonly_key;
                }
            }
        }
    }
    
    // For all other miniscripts, use NUMS point
    console_log!("Using NUMS point as internal key (script-path only)");
    get_taproot_nums_point()
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
