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
pub mod analyze;
pub mod export;

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
                debug_info: None,
                debug_info_leaves: None,
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
            debug_info: None,
            debug_info_leaves: None,
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

// Analyze a miniscript expression
#[wasm_bindgen]
pub fn analyze_miniscript(expression: &str, context: &str) -> JsValue {
    analyze::analyze_miniscript(expression, context)
}

// Analyze a policy expression
#[wasm_bindgen]
pub fn analyze_policy(policy: &str) -> JsValue {
    analyze::analyze_policy(policy)
}
// Generate address for network switching (Legacy/Segwit/Taproot)
#[wasm_bindgen]
pub fn generate_address_for_network(script_hex: &str, script_type: &str, network: &str) -> JsValue {
    address::generate_address_for_network(script_hex, script_type, network)
}

// Get build information for debugging deployment issues
#[wasm_bindgen]
pub fn get_wasm_build_info() -> JsValue {
    use serde::Serialize;

    #[derive(Serialize)]
    struct BuildInfo {
        version: &'static str,
        has_descriptor_support: bool,
        has_xonly_conversion: bool,
        has_export_feature: bool,
        build_id: &'static str,
    }

    let info = BuildInfo {
        version: env!("CARGO_PKG_VERSION"),
        has_descriptor_support: true,  // This indicates the new version with descriptor support
        has_xonly_conversion: true,    // Indicates x-only key conversion support for taproot
        has_export_feature: true,      // Export feature for Bitcoin Core/Sparrow/Developer JSON
        build_id: "2026-02-06-checksum", // Manual build identifier
    };

    serde_wasm_bindgen::to_value(&info).unwrap()
}

// Export for Bitcoin Core importdescriptors format
#[wasm_bindgen]
pub fn export_for_bitcoin_core(descriptor: &str, options_js: JsValue) -> JsValue {
    export::export_for_bitcoin_core(descriptor, options_js)
}

// Export comprehensive data (Developer JSON)
#[wasm_bindgen]
pub fn export_comprehensive(expression: &str, context: &str, input_type: &str, options_js: JsValue) -> JsValue {
    export::export_comprehensive(expression, context, input_type, options_js)
}

// Export simple descriptor (Sparrow/Liana compatible)
#[wasm_bindgen]
pub fn export_descriptor(expression: &str, context: &str, input_type: &str) -> JsValue {
    export::export_descriptor(expression, context, input_type)
}
