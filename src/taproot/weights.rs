//! Weights implementation

use miniscript::{Miniscript, Tap};
use bitcoin::XOnlyPublicKey;

/// Compute Taproot witness weight breakdown for display
pub(crate) fn taproot_witness_breakdown(ms: &Miniscript<XOnlyPublicKey, Tap>, leaf_script_len: usize, _depth: usize) -> (u64, u64, u64, u64) {
	use crate::console_log;

	// Get the maximum satisfaction size to calculate witness elements
	let max_sat_size = ms.max_satisfaction_size();
	console_log!("DEBUG WEIGHTS: max_satisfaction_size = {:?}", max_sat_size);
	console_log!("DEBUG WEIGHTS: leaf_script_len = {}", leaf_script_len);

	// Count signatures by analyzing the miniscript structure
	// For Taproot, max_satisfaction_size() returns ONLY the witness stack items size
	// (signatures + any other witness data), NOT including script or control block
	let num_sigs = if let Ok(size) = max_sat_size {
		// max_sat_size includes only: signatures (65 bytes each) + other witness data
		// Each signature is 65 bytes (64 + 1 sighash byte)
		// Most witness data is signatures, so estimate: size / 65
		size / 65 // Each signature is ~65 bytes
	} else {
		// Fallback: count pk() in the miniscript string (may overcount)
		(ms.to_string().matches("pk(").count() + ms.to_string().matches("pk_h(").count()) as usize
	};

	console_log!("DEBUG WEIGHTS: calculated num_sigs = {}", num_sigs);

	let sig_wu = (num_sigs as u64) * 65; // Each signature is 65 WU (64 bytes + 1 sighash byte)

	// Script component: script size + 1 (push opcode)
	let script_wu = leaf_script_len as u64 + 1;

	// Control component: 33 bytes + 1 push opcode = 34 WU
	let control_wu = 34;

	// Total: all signatures + script push + control push + witness count (1)
	let total_wu = sig_wu + script_wu + control_wu + 1;

	console_log!("DEBUG WEIGHTS: sig_wu={}, script_wu={}, control_wu={}, total_wu={}", sig_wu, script_wu, control_wu, total_wu);

	(sig_wu, script_wu, control_wu, total_wu)
}
