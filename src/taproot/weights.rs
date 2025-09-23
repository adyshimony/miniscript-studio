//! Weights implementation

use miniscript::{Miniscript, Tap};
use bitcoin::XOnlyPublicKey;

/// Compute Taproot witness weight breakdown for display
pub(crate) fn taproot_witness_breakdown(_ms: &Miniscript<XOnlyPublicKey, Tap>, leaf_script_len: usize, _depth: usize) -> (u64, u64, u64, u64) {
	// Signature component: always 66 WU
	let sig_wu = 66;
	
	// Script component: script size + 1
	let script_wu = leaf_script_len as u64 + 1;
	
	// Control component: always 34 WU  
	let control_wu = 34;
	
	// Total: sig + script + control + 1
	let total_wu = sig_wu + script_wu + control_wu + 1;
	
	(sig_wu, script_wu, control_wu, total_wu)
}
