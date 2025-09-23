//! WebAssembly Interface for Bitcoin Miniscript Compiler
//!
//! This module serves as the primary entry point for all WebAssembly exports.
//! It provides JavaScript bindings for compiling Bitcoin policies and miniscripts,
//! lifting scripts, generating addresses, and analyzing taproot branches.
//! All implementation logic resides in submodules - this file only handles
//! WASM serialization and delegation to the appropriate modules.

mod types;
pub mod compile;
mod translators;
mod opcodes;
mod utils;
pub(crate) mod parse;
mod lift;
pub mod address;
mod taproot;

// Public modules for integration tests
pub mod descriptors;
pub mod keys;
pub mod validation;

use types::{CompilationResult, LiftResult, AddressResult};
use wasm_bindgen::prelude::*;



// Compile policies and miniscripts with unified options interface
#[wasm_bindgen]
pub fn compile_unified(expression: &str, options_js: JsValue) -> JsValue {
    let options: compile::options::CompileOptions = match serde_wasm_bindgen::from_value(options_js) {
        Ok(opts) => opts,
        Err(e) => {
            let result = CompilationResult {
                success: false,
                error: Some(format!("Invalid options: {}", e)),
                script: None,
                script_asm: None,
                address: None,
                script_size: None,
                miniscript_type: None,
                compiled_miniscript: None,
                max_satisfaction_size: None,
                max_weight_to_satisfy: None,
                sanity_check: None,
                is_non_malleable: None,
            };
            return serde_wasm_bindgen::to_value(&result).unwrap();
        }
    };

    let result = compile::engine::compile_unified(expression, options)
        .unwrap_or_else(|e| CompilationResult {
            success: false,
            error: Some(e),
            script: None,
            script_asm: None,
            address: None,
            script_size: None,
            miniscript_type: None,
            compiled_miniscript: None,
            max_satisfaction_size: None,
            max_weight_to_satisfy: None,
            sanity_check: None,
            is_non_malleable: None,
        });

    serde_wasm_bindgen::to_value(&result).unwrap()
}


// These functions are now in taproot/branches.rs module

// Get miniscript branches for taproot descriptors
#[wasm_bindgen]
pub fn get_taproot_miniscript_branches(descriptor: &str) -> JsValue {
    crate::taproot::branches::get_taproot_miniscript_branches(descriptor)
}

// Get taproot branches
#[wasm_bindgen]
pub fn get_taproot_branches(descriptor: &str) -> JsValue {
    crate::taproot::branches::get_taproot_branches(descriptor)
}

// Calculate weight information for each taproot branch
#[wasm_bindgen]
pub fn get_taproot_branch_weights(descriptor: &str) -> JsValue {
    crate::taproot::branches::get_taproot_branch_weights(descriptor)
}

// Lift a Bitcoin script to miniscript
#[wasm_bindgen]
pub fn lift_to_miniscript(bitcoin_script: &str) -> JsValue {
    lift::lift_to_miniscript(bitcoin_script)
}

// Lift a miniscript to policy
#[wasm_bindgen]
pub fn lift_to_policy(miniscript: &str) -> JsValue {
    lift::lift_to_policy(miniscript)
}
// Generate address for network switching (Legacy/Segwit/Taproot)
#[wasm_bindgen]
pub fn generate_address_for_network(script_hex: &str, script_type: &str, network: &str) -> JsValue {
    address::generate_address_for_network(script_hex, script_type, network)
}
