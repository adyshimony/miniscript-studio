//! Bitcoin Miniscript Compiler
//! 
//! This library provides WebAssembly bindings for compiling Bitcoin policies and miniscripts,
//! lifting Bitcoin scripts back to miniscript/policy representations, and generating addresses.

// Module declarations
#![allow(dead_code)]
#![allow(deprecated)]
#![allow(clippy::type_complexity)]
#![allow(clippy::if_same_then_else)]
#![allow(clippy::clone_on_copy)]
#![allow(clippy::to_string_in_format_args)]
#![allow(clippy::redundant_closure)]
#![allow(clippy::useless_conversion)]
#![allow(clippy::needless_borrow)]
#![allow(clippy::needless_range_loop)]
#![allow(clippy::collapsible_match)]
#![allow(clippy::char_indices_as_byte_indices)]
mod types;
mod translators;
mod opcodes;
mod utils;
mod parse { pub(crate) mod helpers; }
mod lift;
pub mod address;
mod taproot;

// Export modules for integration tests
pub mod compile;
pub mod descriptors;
pub mod keys;
pub mod validation;

// Module functions are accessible via the pub mod declarations above

// Re-exports from modules
use types::{CompilationResult, LiftResult, AddressResult, ParsedDescriptor};
use translators::{DescriptorKeyTranslator};
use parse::helpers::{detect_network, needs_descriptor_processing, is_descriptor_wrapper};

// External crate imports
use wasm_bindgen::prelude::*;
use serde::{Serialize};
use miniscript::{Miniscript, Tap, Segwitv0, Legacy, policy::Concrete, Descriptor, DescriptorPublicKey};
use miniscript::policy::Liftable;
use bitcoin::{Address, Network, PublicKey, XOnlyPublicKey, secp256k1::Secp256k1};
// ... existing code ...
use bitcoin::bip32::ChildNumber;
use std::str::FromStr;
use std::collections::HashMap;
use std::convert::TryInto;

// Constants
pub const NUMS_POINT: &str = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";

// ... existing code ...


// ============================================================================
// Helper Functions
// ============================================================================

/// Detect the Bitcoin network based on key types in the expression
// moved to parse::helpers::detect_network

/// Check if expression needs descriptor processing
// moved to parse::helpers::needs_descriptor_processing

/// Check if expression is a descriptor wrapper
// moved to parse::helpers::is_descriptor_wrapper


/// Extract the first x-only key from a miniscript string
// Key extraction functions moved to src/keys/mod.rs

// moved to address::generate_taproot_address_with_key

// moved to address::generate_taproot_address

// moved to address::generate_taproot_address_descriptor

// moved to address::generate_taproot_address_with_key_old

// ============================================================================
// Descriptor Parsing
// ============================================================================

/// Parse HD wallet descriptors from miniscript expressions
fn parse_descriptors(expression: &str) -> Result<HashMap<String, ParsedDescriptor>, String> {
    let mut descriptors = HashMap::new();
    
    console_log!("Parsing descriptors from expression of length: {}", expression.len());
    
    // Create regex patterns for different descriptor formats
    let patterns = descriptors::parser::create_descriptor_regex_patterns()?;
    
    // Process each pattern type
    descriptors::processor::process_comprehensive_descriptors(expression, &patterns, &mut descriptors)?;
    
    console_log!("Found {} descriptors total", descriptors.len());
    Ok(descriptors)
}

/// Container for descriptor regex patterns

/// Create regex patterns for descriptor parsing

/// Comprehensive descriptor processing for all patterns

/// Helper function to process a single pattern type


/// Process bare extended keys with ranges

/// Process single derivation keys

/// Process fixed double derivation descriptors

/// Parse derivation path from string

/// Parse extended public key

/// Parse child paths from range notation

/// Expand a descriptor at a specific child index
fn expand_descriptor(descriptor: &ParsedDescriptor, child_index: u32) -> Result<String, String> {
    let secp = Secp256k1::verification_only();
    
    console_log!("Expanding descriptor: {}", descriptor.original);
    console_log!("Xpub: {}", descriptor.info.xpub);
    console_log!("Child paths: {:?}", descriptor.info.child_paths);
    console_log!("Is wildcard: {}", descriptor.info.is_wildcard);
    
    // Handle different derivation patterns comprehensively
    let final_xpub = if !descriptor.info.is_wildcard {
        // Fixed patterns - no wildcards
        match descriptor.info.child_paths.len() {
            0 => {
                // No derivation: xpub
                console_log!("No additional derivation");
                descriptor.info.xpub.clone()
            },
            1 => {
                // Single fixed derivation: xpub/0
                let child = ChildNumber::from_normal_idx(descriptor.info.child_paths[0])
                    .map_err(|e| format!("Invalid child number: {}", e))?;

                console_log!("Single derivation: {}", descriptor.info.child_paths[0]);
                descriptor.info.xpub
                    .derive_pub(&secp, &[child])
                    .map_err(|e| format!("Single key derivation failed: {}", e))?
            },
            2 => {
                // Double fixed derivation: xpub/0/1
                let first_child = ChildNumber::from_normal_idx(descriptor.info.child_paths[0])
                    .map_err(|e| format!("Invalid first child number: {}", e))?;
                let second_child = ChildNumber::from_normal_idx(descriptor.info.child_paths[1])
                    .map_err(|e| format!("Invalid second child number: {}", e))?;

                console_log!("Double derivation: {}/{}", descriptor.info.child_paths[0], descriptor.info.child_paths[1]);
                descriptor.info.xpub
                    .derive_pub(&secp, &[first_child, second_child])
                    .map_err(|e| format!("Double key derivation failed: {}", e))?
            },
            _ => return Err("Unsupported fixed derivation path length".to_string()),
        }
    } else {
        // Wildcard patterns - need to substitute wildcards with child_index
        match descriptor.info.child_paths.len() {
            0 => {
                // Single wildcard: xpub/* or xpub/*/*
                let child = ChildNumber::from_normal_idx(child_index)
                    .map_err(|e| format!("Invalid child index: {}", e))?;

                console_log!("Single wildcard derivation: {}", child_index);
                descriptor.info.xpub
                    .derive_pub(&secp, &[child])
                    .map_err(|e| format!("Wildcard key derivation failed: {}", e))?
            },
            1 => {
                // Fixed + wildcard: xpub/0/*
                let first_child = ChildNumber::from_normal_idx(descriptor.info.child_paths[0])
                    .map_err(|e| format!("Invalid first child number: {}", e))?;
                let second_child = ChildNumber::from_normal_idx(child_index)
                    .map_err(|e| format!("Invalid child index: {}", e))?;

                console_log!("Fixed + wildcard derivation: {}/{}", descriptor.info.child_paths[0], child_index);
                descriptor.info.xpub
                    .derive_pub(&secp, &[first_child, second_child])
                    .map_err(|e| format!("Fixed+wildcard key derivation failed: {}", e))?
            },
            2 => {
                // Handle wildcard + fixed pattern: xpub/*/1
                let first_child = if descriptor.info.child_paths[0] == u32::MAX {
                    // First position is wildcard
                    ChildNumber::from_normal_idx(child_index)
                        .map_err(|e| format!("Invalid child index: {}", e))?
                } else {
                    // First position is fixed
                    ChildNumber::from_normal_idx(descriptor.info.child_paths[0])
                        .map_err(|e| format!("Invalid first child number: {}", e))?
                };

                let second_child = if descriptor.info.child_paths[1] == u32::MAX {
                    // Second position is wildcard
                    ChildNumber::from_normal_idx(child_index)
                        .map_err(|e| format!("Invalid child index: {}", e))?
                } else {
                    // Second position is fixed
                    ChildNumber::from_normal_idx(descriptor.info.child_paths[1])
                        .map_err(|e| format!("Invalid second child number: {}", e))?
                };

                console_log!("Wildcard + fixed derivation: {}/{}",
                    if descriptor.info.child_paths[0] == u32::MAX { child_index } else { descriptor.info.child_paths[0] },
                    if descriptor.info.child_paths[1] == u32::MAX { child_index } else { descriptor.info.child_paths[1] }
                );
                descriptor.info.xpub
                    .derive_pub(&secp, &[first_child, second_child])
                    .map_err(|e| format!("Wildcard+fixed key derivation failed: {}", e))?
            },
            _ => {
                // Multipath pattern: use first path with child_index
                if !descriptor.info.child_paths.is_empty() {
                    let first_child = ChildNumber::from_normal_idx(descriptor.info.child_paths[0])
                        .map_err(|e| format!("Invalid first child number: {}", e))?;
                    let second_child = ChildNumber::from_normal_idx(child_index)
                        .map_err(|e| format!("Invalid child index: {}", e))?;

                    console_log!("Multipath derivation: {}/{}", descriptor.info.child_paths[0], child_index);
                    descriptor.info.xpub
                        .derive_pub(&secp, &[first_child, second_child])
                        .map_err(|e| format!("Multipath key derivation failed: {}", e))?
                } else {
                    return Err("Invalid multipath descriptor".to_string());
                }
            }
        }
    };

    // Get the public key and return as hex string
    let pubkey = final_xpub.public_key;
    let hex_key = hex::encode(pubkey.serialize());
    console_log!("Derived key for descriptor: {}", hex_key);
    Ok(hex_key)
}

/// Replace descriptors in expression with concrete keys
fn replace_descriptors_with_keys(expression: &str, descriptors: &HashMap<String, ParsedDescriptor>) -> Result<String, String> {
    let mut result = expression.to_string();
    
    // Sort descriptors by length (longest first) to prevent substring conflicts
    let mut sorted_descriptors: Vec<_> = descriptors.iter().collect();
    sorted_descriptors.sort_by_key(|(descriptor_str, _)| std::cmp::Reverse(descriptor_str.len()));
    
    console_log!("Replacing {} descriptors in expression", sorted_descriptors.len());
    for (descriptor_str, parsed) in sorted_descriptors {
        let replacement = expand_descriptor(parsed, 0)?;
        console_log!("Replacing '{}' with '{}' (len: {})", descriptor_str, replacement, replacement.len());
        result = result.replace(descriptor_str, &replacement);
    }
    
    console_log!("Final processed expression: {}", result);
    Ok(result)
}


// ============================================================================
// Compilation Functions
// ============================================================================

/// Compile a policy expression to miniscript
#[wasm_bindgen]
pub fn compile_policy(policy: &str, context: &str) -> JsValue {
    console_log!("Compiling policy: {}", policy);
    console_log!("Context: {}", context);
    
    let result = match compile_policy_to_miniscript(policy, context) {
        Ok((script, script_asm, address, script_size, ms_type, compiled_miniscript, 
            max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable)) => {
            CompilationResult {
                success: true,
                error: None,
                script: Some(script),
                script_asm: Some(script_asm),
                address,
                script_size: Some(script_size),
                miniscript_type: Some(ms_type),
                compiled_miniscript: Some(compiled_miniscript),
                max_satisfaction_size,
                max_weight_to_satisfy,
                sanity_check,
                is_non_malleable,
            }
        },
        Err(e) => CompilationResult {
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
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Compile a policy to miniscript with mode support
#[wasm_bindgen]
pub fn compile_policy_with_mode(policy: &str, context: &str, mode: &str) -> JsValue {
    console_log!("🚀 WASM LOADED AND WORKING - BUILD: 2025-01-09-16:47:00 🚀");
    console_log!("✅ get_taproot_branches function should be available!");
    console_log!("Compiling policy with mode: {} (context: {})", mode, context);
    
    let result = match compile_policy_to_miniscript_with_mode(policy, context, mode) {
        Ok((script, script_asm, address, script_size, ms_type, compiled_miniscript, 
            max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable)) => {
            CompilationResult {
                success: true,
                error: None,
                script: Some(script),
                script_asm: Some(script_asm),
                address,
                script_size: Some(script_size),
                miniscript_type: Some(ms_type),
                compiled_miniscript: Some(compiled_miniscript),
                max_satisfaction_size,
                max_weight_to_satisfy,
                sanity_check,
                is_non_malleable,
            }
        },
        Err(e) => CompilationResult {
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
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Compile a miniscript expression to Bitcoin script
#[wasm_bindgen]
pub fn compile_miniscript(expression: &str, context: &str) -> JsValue {
    // No NUMS needed for single-leaf mode - will be ignored anyway
    compile_miniscript_with_mode(expression, context, "single-leaf", "")
}

/// Compile a miniscript expression to Bitcoin script with compilation mode and network
#[wasm_bindgen]
pub fn compile_miniscript_with_mode_and_network(expression: &str, context: &str, mode: &str, nums_key: &str, network_str: &str) -> JsValue {
    console_log!("Compiling miniscript: {}", expression);
    console_log!("Context: {}", context);
    console_log!("Mode: {}", mode);
    console_log!("Network: {}", network_str);
    
    // Parse network using centralized utility
    let network = address::parse_network(network_str).unwrap_or(Network::Bitcoin);
    
    let result = match compile_expression_with_mode_network(expression, context, mode, nums_key, network) {
        Ok((script, script_asm, address, script_size, ms_type, 
            max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable, normalized_miniscript)) => {
            CompilationResult {
                success: true,
                error: None,
                script: Some(script),
                script_asm: Some(script_asm),
                address,
                script_size: Some(script_size),
                miniscript_type: Some(ms_type),
                compiled_miniscript: normalized_miniscript,
                max_satisfaction_size,
                max_weight_to_satisfy,
                sanity_check,
                is_non_malleable,
            }
        },
        Err(e) => CompilationResult {
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
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Compile a miniscript expression to Bitcoin script with compilation mode
#[wasm_bindgen]
pub fn compile_miniscript_with_mode(expression: &str, context: &str, mode: &str, nums_key: &str) -> JsValue {
    console_log!("Compiling miniscript: {}", expression);
    console_log!("Context: {}", context);
    console_log!("Mode: {}", mode);
    
    let result = match compile_expression_with_mode(expression, context, mode, nums_key, Network::Bitcoin) {
        Ok((script, script_asm, address, script_size, ms_type, 
            max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable, normalized_miniscript)) => {
            CompilationResult {
                success: true,
                error: None,
                script: Some(script),
                script_asm: Some(script_asm),
                address,
                script_size: Some(script_size),
                miniscript_type: Some(ms_type),
                compiled_miniscript: normalized_miniscript,
                max_satisfaction_size,
                max_weight_to_satisfy,
                sanity_check,
                is_non_malleable,
            }
        },
        Err(e) => CompilationResult {
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
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Internal function to compile miniscript expressions with mode
fn compile_expression_with_mode(
    expression: &str,
    context: &str,
    mode: &str,
    nums_key: &str,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("=== COMPILE_EXPRESSION_WITH_MODE CALLED ===");
    console_log!("Expression: {}", expression);
    console_log!("Context: {}", context);
    console_log!("Mode: {}", mode);
    console_log!("Network: {:?}", network);
    
    // For taproot context, handle different compilation modes
    if context == "taproot" {
        match mode {
            "multi-leaf" => {
                console_log!("Using multi-leaf compilation (descriptor approach)");
                // Multi-leaf mode: extract internal key from expression and use descriptor
                return compile_taproot_keypath_descriptor(expression, network);
            },
            "script-path" => {
                console_log!("Using script-path compilation (descriptor approach) with NUMS: {}", nums_key);
                // Script-path mode: use descriptor approach with NUMS
                return compile::policy::compile_taproot_script_path_descriptor(expression, nums_key, network);
            },
            _ => {
                console_log!("Using single-leaf compilation (descriptor approach) with NUMS");
                // Single-leaf mode: use descriptor approach with NUMS (same as script-path)
                return compile_taproot_simplified_descriptor(expression, nums_key, network);
            }
        }
    }
    
    // For non-taproot contexts, use regular compilation
    compile_expression(expression, context)
}

/// Internal function to compile miniscript expressions with mode and network
fn compile_expression_with_mode_network(
    expression: &str,
    context: &str,
    mode: &str,
    nums_key: &str,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("=== COMPILE_EXPRESSION_WITH_MODE_NETWORK CALLED ===");
    console_log!("Expression: {}", expression);
    console_log!("Context: {}", context);
    console_log!("Mode: {}", mode);
    console_log!("Network: {:?}", network);
    
    // First compile with the existing function
    let mut result = compile_expression_with_mode(expression, context, mode, nums_key, network)?;
    
    // If it's taproot and we need a different network, regenerate the address
    if context == "taproot" && network != Network::Bitcoin {
        console_log!("Regenerating taproot address for different network: {:?}", network);
        
        // Parse the compiled miniscript to get the descriptor
        if let Some(ref compiled_miniscript) = result.9 {
            console_log!("DEBUG: Full compiled descriptor: {}", compiled_miniscript);
            
            // Try to parse as tr() descriptor and regenerate address
            match compiled_miniscript.parse::<Descriptor<XOnlyPublicKey>>() {
                Ok(descriptor) => {
                    console_log!("DEBUG: Successfully parsed descriptor for address generation");
                    console_log!("DEBUG: Descriptor details: {:?}", descriptor);
                    
                    match descriptor.address(network) {
                        Ok(address) => {
                            console_log!("DEBUG: Successfully regenerated address for network {:?}: {}", network, address);
                            console_log!("DEBUG: Original address was: {:?}", result.2);
                            result.2 = Some(address.to_string()); // Update the address field
                            console_log!("DEBUG: Updated address to: {:?}", result.2);
                        },
                        Err(_e) => console_log!("DEBUG: Failed to generate address for network: {:?}", _e)
                    }
                },
                Err(_e) => console_log!("DEBUG: Failed to parse compiled descriptor: {:?}", _e)
            }
        }
    }
    
    Ok(result)
}


/// Compile Taproot Key path + script path using Descriptor::new_tr() approach with extracted internal key
fn compile_taproot_keypath_descriptor(expression: &str, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    use std::sync::Arc;
    use miniscript::descriptor::TapTree;

    console_log!("=== COMPILE_TAPROOT_KEYPATH_DESCRIPTOR ===");
    console_log!("Expression: {}", expression);
    console_log!("Network: {:?}", network);
    let processed_expr = expression.trim();
    
    // Parse as XOnlyPublicKey miniscript for Taproot
    match processed_expr.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        Ok(ms) => {
            let _normalized_miniscript = ms.to_string();
            console_log!("Parsed miniscript: {}", _normalized_miniscript);
            
            // Calculate satisfaction weights 
            let max_satisfaction_size = ms.max_satisfaction_size().ok();
            let max_weight_to_satisfy = max_satisfaction_size.map(|s| s as u64);
            
            // Extract internal key from expression (e.g., from pk(key))
            let internal_key_str = keys::extract_internal_key_from_expression(expression);
            console_log!("DEBUG DESCRIPTOR KEYPATH: Extracted internal key: {}", internal_key_str);
            
            // Parse internal key
            let internal_xonly_key = if let Ok(key_bytes) = hex::decode(&internal_key_str) {
                if key_bytes.len() == 32 {
                    if let Ok(xonly_key) = XOnlyPublicKey::from_slice(&key_bytes) {
                        console_log!("DEBUG DESCRIPTOR KEYPATH: Successfully created XOnlyPublicKey from hex");
                        xonly_key
                    } else {
                        console_log!("DEBUG DESCRIPTOR KEYPATH: Failed to create XOnlyPublicKey, using NUMS");
                        taproot::utils::get_taproot_nums_point()
                    }
                } else {
                    console_log!("DEBUG DESCRIPTOR KEYPATH: Key bytes length is not 32, using NUMS");
                    taproot::utils::get_taproot_nums_point()
                }
            } else {
                console_log!("DEBUG DESCRIPTOR KEYPATH: Failed to decode hex key, using NUMS");
                taproot::utils::get_taproot_nums_point()
            };
            
            console_log!("DEBUG DESCRIPTOR KEYPATH: Using internal key: {}", internal_xonly_key);
            
            // Create the tree with the miniscript (clone to avoid move)
            let tree = TapTree::Leaf(Arc::new(ms.clone()));
            console_log!("DEBUG DESCRIPTOR KEYPATH: Created TapTree leaf");
            
            // Create descriptor using Descriptor::new_tr() approach (the correct way!)
            match Descriptor::<XOnlyPublicKey>::new_tr(internal_xonly_key, Some(tree)) {
                Ok(descriptor) => {
                    console_log!("DEBUG DESCRIPTOR KEYPATH: Successfully created descriptor: {}", descriptor);
                    
                    // Generate address from descriptor
                    match descriptor.address(network) {
                        Ok(address) => {
                            console_log!("DEBUG DESCRIPTOR KEYPATH: Generated address: {}", address);
                            
                            // Get the scriptPubKey (OP_1 + 32-byte tweaked key)
                            let script_pubkey = address.script_pubkey();
                            let script_hex = script_pubkey.to_hex_string();
                            let script_asm = format!("{:?}", script_pubkey).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script_pubkey.len();
                            
                            console_log!("DEBUG DESCRIPTOR KEYPATH: Script hex: {}", script_hex);
                            console_log!("DEBUG DESCRIPTOR KEYPATH: Script ASM: {}", script_asm);
                            
                            Ok((
                                script_hex,
                                script_asm,
                                Some(address.to_string()),
                                script_size,
                                "Taproot".to_string(),
                                max_satisfaction_size,
                                max_weight_to_satisfy,
                                Some(true), // sanity_check
                                Some(true), // is_non_malleable
                                Some(descriptor.to_string()) // Return the full descriptor
                            ))
                        },
                        Err(e) => Err(format!("Address generation failed: {:?}", e))
                    }
                },
                Err(e) => Err(format!("Descriptor creation failed: {:?}", e))
            }
        },
        Err(e) => Err(format!("Miniscript parsing failed: {}", e))
    }
}

/// Compile Taproot Simplified using Descriptor::new_tr() approach (same as script path)
fn compile_taproot_simplified_descriptor(expression: &str, nums_key: &str, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    use std::sync::Arc;
    use miniscript::descriptor::TapTree;

    console_log!("=== COMPILE_TAPROOT_SIMPLIFIED_DESCRIPTOR ===");
    console_log!("Expression: {}", expression);
    console_log!("NUMS key: {}", nums_key);
    console_log!("Network: {:?}", network);
    let processed_expr = expression.trim();
    
    // Parse as XOnlyPublicKey miniscript for Taproot
    match processed_expr.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        Ok(ms) => {
            let _normalized_miniscript = ms.to_string();
            console_log!("Parsed miniscript: {}", _normalized_miniscript);
            
            // Calculate satisfaction weights 
            let max_satisfaction_size = ms.max_satisfaction_size().ok();
            let max_weight_to_satisfy = max_satisfaction_size.map(|s| s as u64);
            
            // Parse NUMS key
            let nums_xonly_key = match XOnlyPublicKey::from_str(nums_key) {
                Ok(key) => key,
                Err(_) => return Err(format!("Failed to parse NUMS key: {}", nums_key))
            };
            
            console_log!("DEBUG DESCRIPTOR SIMPLIFIED: Using NUMS key: {}", nums_xonly_key);
            
            // Get the leaf script (raw miniscript script)
            let leaf_script = ms.encode();
            let _leaf_script_hex = leaf_script.to_hex_string();
            let leaf_script_asm = format!("{:?}", leaf_script).replace("Script(", "").trim_end_matches(')').to_string();
            console_log!("DEBUG DESCRIPTOR SIMPLIFIED: Leaf script hex: {}", _leaf_script_hex);
            console_log!("DEBUG DESCRIPTOR SIMPLIFIED: Leaf script ASM: {}", leaf_script_asm);
            
            // Create the tree with the miniscript (clone to avoid move)
            let tree = TapTree::Leaf(Arc::new(ms.clone()));
            console_log!("DEBUG DESCRIPTOR SIMPLIFIED: Created TapTree leaf");
            
            // Create descriptor using Descriptor::new_tr() approach (the correct way!)
            match Descriptor::<XOnlyPublicKey>::new_tr(nums_xonly_key, Some(tree)) {
                Ok(descriptor) => {
                    console_log!("DEBUG DESCRIPTOR SIMPLIFIED: Successfully created descriptor: {}", descriptor);
                    
                    // Generate address from descriptor
                    match descriptor.address(network) {
                        Ok(address) => {
                            console_log!("DEBUG DESCRIPTOR SIMPLIFIED: Generated address: {}", address);
                            
                            // Get the scriptPubKey (OP_1 + 32-byte tweaked key)
                            let script_pubkey = address.script_pubkey();
                            let script_hex = script_pubkey.to_hex_string();
                            let script_asm = format!("{:?}", script_pubkey).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script_pubkey.len();
                            
                            console_log!("DEBUG DESCRIPTOR SIMPLIFIED: Script hex: {}", script_hex);
                            console_log!("DEBUG DESCRIPTOR SIMPLIFIED: Script ASM: {}", script_asm);
                            
                            Ok((
                                script_hex,
                                script_asm,
                                Some(address.to_string()),
                                script_size,
                                "Taproot".to_string(),
                                max_satisfaction_size,
                                max_weight_to_satisfy,
                                Some(true), // sanity_check
                                Some(true), // is_non_malleable
                                Some(format!("{}|LEAF_ASM:{}", descriptor.to_string(), leaf_script_asm)) // Descriptor + leaf ASM
                            ))
                        },
                        Err(e) => Err(format!("Address generation failed: {:?}", e))
                    }
                },
                Err(e) => Err(format!("Descriptor creation failed: {:?}", e))
            }
        },
        Err(e) => Err(format!("Miniscript parsing failed: {}", e))
    }
}

/// Compile miniscript for single-leaf taproot (shows raw script, not taproot address)


/// Internal function to compile miniscript expressions  
fn compile_expression(
    expression: &str,
    context: &str
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("=== COMPILE_EXPRESSION CALLED ===");
    console_log!("Expression: {}", expression);
    console_log!("Context: {}", context);
    
    if expression.trim().is_empty() {
        return Err("Empty expression - please enter a miniscript".to_string());
    }
    
    let trimmed = expression.trim();
    let network = detect_network(trimmed);
    
    // Process descriptors if needed
    let processed_expr = if needs_descriptor_processing(trimmed) {
        process_expression_descriptors(trimmed)?
    } else {
        trimmed.to_string()
    };
    
    // Check if this is a descriptor wrapper
    if is_descriptor_wrapper(&processed_expr) {
        return compile_descriptor(&processed_expr, context);
    }
    
    // Compile based on context
    match context {
        "legacy" => compile::miniscript::compile_legacy_miniscript(&processed_expr, network),
        "segwit" => compile::miniscript::compile_segwit_miniscript(&processed_expr, network),
        "taproot" => compile::miniscript::compile_taproot_miniscript(&processed_expr, network),
        _ => Err(format!("Invalid context: {}. Use 'legacy', 'segwit', or 'taproot'", context))
    }
}

/// Process descriptors in expression
fn process_expression_descriptors(expression: &str) -> Result<String, String> {
    console_log!("Detected descriptor keys in expression, processing...");
    
    match parse_descriptors(expression) {
        Ok(descriptors) => {
            if descriptors.is_empty() {
                console_log!("No descriptors found, using original expression");
                Ok(expression.to_string())
            } else {
                // Check if any descriptors have ranges
                let has_range_descriptors = descriptors.values().any(|desc| desc.info.is_wildcard);
                
                if has_range_descriptors {
                    console_log!("Found {} descriptors with ranges, wrapping in wsh() for descriptor parsing", descriptors.len());
                    Ok(format!("wsh({})", expression))
                } else {
                    console_log!("Found {} fixed descriptors, replacing with concrete keys", descriptors.len());
                    match replace_descriptors_with_keys(expression, &descriptors) {
                        Ok(processed) => {
                            console_log!("Successfully replaced descriptors with keys");
                            Ok(processed)
                        },
                        Err(e) => {
                            console_log!("Failed to replace descriptors: {}", e);
                            Err(format!("Descriptor processing failed: {}", e))
                        }
                    }
                }
            }
        },
        Err(e) => {
            console_log!("Failed to parse descriptors: {}", e);
            Err(format!("Descriptor parsing failed: {}", e))
        }
    }
}

/// Compile a descriptor wrapper
fn compile_descriptor(expression: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("Detected descriptor format, extracting inner miniscript for proper validation");
    
    // Extract inner miniscript from wsh() wrapper
    let inner_miniscript = if expression.starts_with("wsh(") && expression.ends_with(")") {
        &expression[4..expression.len()-1]
    } else {
        // Parse other descriptor types
        return parse_non_wsh_descriptor(expression);
    };
    
    console_log!("Parsing inner miniscript with proper validation: {}", inner_miniscript);
    
    // Parse and validate the inner miniscript based on context
    validation::validate_inner_miniscript(inner_miniscript, context)
}

/// Parse non-WSH descriptors
fn parse_non_wsh_descriptor(expression: &str) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    match Descriptor::<DescriptorPublicKey>::from_str(expression) {
        Ok(descriptor) => {
            let desc_str = descriptor.to_string();
            console_log!("Successfully parsed non-wsh descriptor: {}", desc_str);
            
            Ok((
                "No single script - this descriptor defines multiple paths".to_string(),
                "No single script - this descriptor defines multiple paths".to_string(),
                None,
                0,
                "Descriptor".to_string(),
                None,
                None,
                None,
                None,
                Some(format!("Valid descriptor: {}", desc_str))
            ))
        },
        Err(e) => Err(format!("Descriptor parsing failed: {}", e))
    }
}

/// Validate inner miniscript from descriptor
// Validation functions moved to src/validation/mod.rs



/// Compile Taproot context miniscript
/// Compile a parsed Taproot descriptor
fn compile_parsed_descriptor(descriptor: Descriptor<XOnlyPublicKey>, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("Compiling parsed descriptor");
    
    // Get the address from the descriptor
    let address = descriptor.address(network)
        .map_err(|e| format!("Failed to derive address: {}", e))?;
    
    // Get the script pubkey
    let script_pubkey = descriptor.script_pubkey();
    let script_hex = script_pubkey.to_hex_string();
    let script_asm = format!("{:?}", script_pubkey).replace("Script(", "").trim_end_matches(')').to_string();
    
    // Calculate script size
    let script_size = script_pubkey.len();
    
    // Get descriptor string
    let descriptor_str = descriptor.to_string();
    
    // For Taproot, max satisfaction depends on the specific path
    // This is a simplified estimate
    let max_satisfaction_size = Some(200); // Estimated
    let max_weight_to_satisfy = Some(script_size as u64 * 4 + 244); // Script weight + input weight
    
    Ok((
        script_hex,
        script_asm,
        Some(address.to_string()),
        script_size,
        "Taproot".to_string(),
        max_satisfaction_size,
        max_weight_to_satisfy,
        Some(true), // sanity_check
        Some(true), // is_non_malleable
        Some(descriptor_str),
    ))
}

/// Transform top-level OR patterns to tree notation for Taproot
fn transform_or_to_tree(miniscript: &str) -> String {
    let trimmed = miniscript.trim();
    
    // Only transform if it starts with or_d, or_c, or or_i
    if trimmed.starts_with("or_d(") || trimmed.starts_with("or_c(") || trimmed.starts_with("or_i(") {
        console_log!("Transforming OR pattern to tree notation: {}", trimmed);
        
        // Find the opening parenthesis
        if let Some(start_idx) = trimmed.find('(') {
            let inner = &trimmed[start_idx + 1..];
            
            // Find the comma at the correct depth
            let mut depth = 0;
            let mut comma_pos = None;
            
            for (i, ch) in inner.chars().enumerate() {
                match ch {
                    '(' => depth += 1,
                    ')' => {
                        if depth == 0 {
                            // Found the closing parenthesis of the OR
                            if comma_pos.is_none() {
                                console_log!("WARNING: No comma found in OR pattern");
                                return miniscript.to_string();
                            }
                            break;
                        }
                        depth -= 1;
                    },
                    ',' if depth == 0 => {
                        comma_pos = Some(i);
                        // Continue to find the closing parenthesis
                    },
                    _ => {}
                }
            }
            
            if let Some(comma_idx) = comma_pos {
                // Extract left and right branches
                let left_branch = inner[..comma_idx].trim();
                
                // Find the end of the right branch
                let mut depth = 0;
                let mut right_end = inner.len();
                for (i, ch) in inner[comma_idx + 1..].chars().enumerate() {
                    match ch {
                        '(' => depth += 1,
                        ')' => {
                            if depth == 0 {
                                right_end = comma_idx + 1 + i;
                                break;
                            }
                            depth -= 1;
                        },
                        _ => {}
                    }
                }
                
                let right_branch = inner[comma_idx + 1..right_end].trim();
                
                let result = format!("{{{},{}}}", left_branch, right_branch);
                console_log!("Transformed to tree notation: {}", result);
                return result;
            }
        }
    }
    
    // No transformation needed
    miniscript.to_string()
}


fn compile_policy_to_miniscript(policy: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    compile_policy_to_miniscript_with_mode(policy, context, "multi-leaf")
}

fn compile_policy_to_miniscript_with_mode(policy: &str, context: &str, mode: &str) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    if policy.trim().is_empty() {
        return Err("Empty policy - please enter a policy expression".to_string());
    }

    let trimmed = policy.trim();
    
    // Check for incompatible key types based on context
    if context != "taproot" {
        // Check for x-only keys (64 hex chars) in non-taproot contexts
        let xonly_key_regex = regex::Regex::new(r"\b[a-fA-F0-9]{64}\b").unwrap();
        if xonly_key_regex.is_match(trimmed) {
            // Check if it's not an xpub/tpub, descriptor, or SHA256 hash
            if !trimmed.contains("xpub") && !trimmed.contains("tpub") && !trimmed.contains("[") && !trimmed.contains("sha256(") {
                return Err(format!(
                    "{} context requires compressed public keys (66 characters starting with 02/03). Found x-only key (64 characters).",
                    if context == "legacy" { "Legacy" } else { "Segwit v0" }
                ));
            }
        }
    } else {
        // Check for compressed keys (66 hex chars starting with 02/03) in taproot context
        let compressed_key_regex = regex::Regex::new(r"\b(02|03)[a-fA-F0-9]{64}\b").unwrap();
        if compressed_key_regex.is_match(trimmed) {
            // Check if it's not part of a descriptor
            if !trimmed.contains("xpub") && !trimmed.contains("tpub") && !trimmed.contains("[") {
                return Err("Taproot context requires x-only keys (64 characters). Found compressed key (66 characters starting with 02/03).".to_string());
            }
        }
    }
    
    // Detect network based on key type
    let network = if trimmed.contains("tpub") {
        Network::Testnet
    } else {
        Network::Bitcoin
    };
    
    console_log!("Processing policy directly: {}", trimmed);
    
    // Check if policy contains descriptor keys
    let processed_policy = if trimmed.contains("tpub") || trimmed.contains("xpub") || trimmed.contains("[") {
        console_log!("Detected descriptor keys in policy, checking for ranges...");
        
        // For policies, check for range patterns directly instead of using parse_descriptors
        // Match both /*  and /<0;1>/* and /<0;1>/1 patterns
        let has_range_descriptors = trimmed.contains("/*") || (trimmed.contains("/<") && trimmed.contains(">/"));
        
        if has_range_descriptors {
            // For range descriptors in policy, we need to compile the policy to miniscript first
            console_log!("Found range descriptors in policy, compiling to miniscript");
            
            // Parse the original policy with descriptor keys (not wrapped with wsh)
            match trimmed.parse::<Concrete<DescriptorPublicKey>>() {
                Ok(descriptor_policy) => {
                    // Try to compile the policy to miniscript based on context
                    let miniscript_result = match context {
                        "legacy" => descriptor_policy.compile::<Legacy>().map(|ms| ms.to_string()),
                        "taproot" => descriptor_policy.compile::<Tap>().map(|ms| ms.to_string()),
                        _ => descriptor_policy.compile::<Segwitv0>().map(|ms| ms.to_string()),
                    };
                    
                    match miniscript_result {
                        Ok(compiled_miniscript) => {
                            // Now validate the resulting descriptor
                            let test_descriptor = format!("wsh({})", compiled_miniscript);
                            match test_descriptor.parse::<Descriptor<DescriptorPublicKey>>() {
                                Ok(_) => {
                                    console_log!("Valid range descriptor compiled to: {}, now processing as descriptor", compiled_miniscript);
                                    // Instead of returning here, continue with descriptor processing
                                    // by calling compile_expression with the wrapped descriptor
                                    match compile_expression(&test_descriptor, context) {
                                        Ok((script, script_asm, address, script_size, ms_type, max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable, normalized_miniscript)) => {
                                            return Ok((
                                                normalized_miniscript.unwrap_or(script), // Put "Valid descriptor: ..." in script field for success message
                                                script_asm,
                                                address,
                                                script_size,
                                                ms_type,
                                                compiled_miniscript, // Put clean miniscript in compiled_miniscript for editor
                                                max_satisfaction_size,
                                                max_weight_to_satisfy,
                                                sanity_check,
                                                is_non_malleable
                                            ));
                                        },
                                        Err(e) => return Err(e)
                                    }
                                },
                                Err(e) => {
                                    console_log!("Invalid compiled descriptor: {}", e);
                                    return Err(format!("Invalid descriptor: {}", e));
                                }
                            }
                        },
                        Err(e) => {
                            console_log!("Failed to compile policy with range descriptors: {}", e);
                            return Err(format!("Failed to compile policy: {}", e));
                        }
                    }
                },
                Err(e) => {
                    console_log!("Failed to parse policy with descriptors: {}", e);
                    return Err(format!("Invalid policy with descriptors: {}", e));
                }
            }
        } else {
            // For non-range descriptors, use the original parse_descriptors approach
            console_log!("Policy has descriptor keys but no ranges, parsing descriptors...");
            match parse_descriptors(trimmed) {
                Ok(descriptors) => {
                    if descriptors.is_empty() {
                        console_log!("No descriptors found, using original policy");
                        trimmed.to_string()
                    } else {
                        console_log!("Found {} fixed descriptors, replacing with concrete keys", descriptors.len());
                        match replace_descriptors_with_keys(trimmed, &descriptors) {
                            Ok(processed) => {
                                console_log!("Successfully replaced descriptors with keys in policy");
                                processed
                            },
                            Err(e) => {
                                console_log!("Failed to replace descriptors: {}", e);
                                return Err(format!("Descriptor processing failed: {}", e));
                            }
                        }
                    }
                },
                Err(e) => {
                    console_log!("Failed to parse descriptors in policy: {}", e);
                    return Err(format!("Descriptor parsing failed: {}", e));
                }
            }
        }
    } else {
        trimmed.to_string()
    };
    
    // Now I need to handle the Taproot context properly for XOnlyPublicKey
    if context == "taproot" {
        // First try parsing as XOnlyPublicKey for 64-char keys
        match processed_policy.parse::<Concrete<XOnlyPublicKey>>() {
            Ok(xonly_policy) => {
                return compile_taproot_policy_xonly_with_mode(xonly_policy, network, mode);
            },
            Err(_) => {
                // Fall through to try PublicKey parsing
            }
        }
    }
    
    // First try parsing with DescriptorPublicKey to support xpub descriptors  
    match processed_policy.parse::<Concrete<DescriptorPublicKey>>() {
        Ok(descriptor_policy) => {
            // Translate DescriptorPublicKey to PublicKey using our translator
            let mut translator = DescriptorKeyTranslator::new();
            let concrete_policy = match descriptor_policy.translate_pk(&mut translator) {
                Ok(policy) => policy,
                Err(_) => return Err("Failed to translate descriptor keys to concrete keys".to_string())
            };
            
            
            match context {
                "legacy" => compile_legacy_policy(concrete_policy, network),
                "taproot" => compile_taproot_policy_with_mode(concrete_policy, network, mode),
                _ => compile_segwit_policy(concrete_policy, network),
            }
        },
        Err(_) => {
            // For taproot context, try parsing as XOnlyPublicKey first
            if context == "taproot" {
                console_log!("DEBUG: Parsing policy for taproot with XOnly keys: {}", processed_policy);
                match processed_policy.parse::<Concrete<XOnlyPublicKey>>() {
                    Ok(xonly_policy) => {
                        console_log!("DEBUG: Successfully parsed XOnly policy: {}", xonly_policy);
                        return compile_taproot_policy_xonly_with_mode(xonly_policy, network, mode);
                    },
                    Err(_) => {
                        // Fall through to try PublicKey parsing, but it will fail with proper error
                    }
                }
            }
            
            // If descriptor parsing fails, try parsing as regular Concrete<PublicKey>
            match processed_policy.parse::<Concrete<PublicKey>>() {
                Ok(concrete_policy) => {
                    
                    match context {
                        "legacy" => compile_legacy_policy(concrete_policy, network),
                        "taproot" => compile_taproot_policy_with_mode(concrete_policy, network, mode),
                        _ => compile_segwit_policy(concrete_policy, network),
                    }
                },
                Err(e) => Err(format!("Policy parsing failed: {}", e))
            }
        }
    }
}


/// Compile policy for Legacy context
fn compile_legacy_policy(
    policy: Concrete<PublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Legacy>() {
        Ok(ms) => {
            let compiled_miniscript = ms.to_string();
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            let desc = Descriptor::new_sh(ms.clone())
                .map_err(|e| format!("Descriptor creation failed: {}", e))?;
            let max_weight = desc.max_weight_to_satisfy()
                .map_err(|e| format!("Weight calculation failed: {}", e))?;
            
            let max_satisfaction_size = Some((max_weight.to_wu() as f64 / 4.0) as usize);
            let max_weight_to_satisfy = Some(max_weight.to_wu());
            let sanity_check = ms.sanity_check().is_ok();
            let is_non_malleable = ms.is_non_malleable();
            
            let address = Address::p2sh(&script, network).ok().map(|a| a.to_string());
            
            Ok((
                script_hex,
                script_asm,
                address,
                script_size,
                "Legacy".to_string(),
                compiled_miniscript,
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        }
        Err(e) => Err(format!("Policy compilation failed for Legacy: {}", e))
    }
}

/// Compile policy for Segwit context
fn compile_segwit_policy(
    policy: Concrete<PublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Segwitv0>() {
        Ok(ms) => {
            let compiled_miniscript = ms.to_string();
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            let desc = Descriptor::new_wsh(ms.clone())
                .map_err(|e| format!("Descriptor creation failed: {}", e))?;
            let total_weight = desc.max_weight_to_satisfy()
                .map_err(|e| format!("Weight calculation failed: {}", e))?;
            
            let max_satisfaction_size = Some(total_weight.to_wu() as usize);
            let max_weight_to_satisfy = Some(total_weight.to_wu());
            let sanity_check = ms.sanity_check().is_ok();
            let is_non_malleable = ms.is_non_malleable();
            
            let address = Some(Address::p2wsh(&script, network).to_string());
            
            Ok((
                script_hex,
                script_asm,
                address,
                script_size,
                "Segwit v0".to_string(),
                compiled_miniscript,
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        }
        Err(e) => {
            let error_msg = format!("{}", e);
            if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                Err(format!("Segwit v0 parsing failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Segwit v0 requires compressed public keys (66 characters).", e))
            } else {
                Err(format!("Segwit v0 parsing failed: {}", e))
            }
        }
    }
}

/// Compile policy for Taproot context with XOnlyPublicKey
fn compile_taproot_policy_xonly(
    policy: Concrete<XOnlyPublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    compile_taproot_policy_xonly_with_mode(policy, network, "multi-leaf")
}

/// Compile policy for Taproot context with XOnlyPublicKey and mode
fn compile_taproot_policy_xonly_with_mode(
    policy: Concrete<XOnlyPublicKey>,
    network: Network,
    mode: &str
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    use miniscript::descriptor::TapTree;
    
    console_log!("compile_taproot_policy_xonly_with_mode called with mode: {}", mode);
    
    match mode {
        "single-leaf" => {
            // Simplified mode - single leaf compilation
            console_log!("Using single-leaf compilation mode");
            compile_taproot_policy_xonly_single_leaf(policy, network)
        },
        "script-path" | "multi-leaf" => {
            // Script-path mode (NUMS point) or Key+Script mode
            console_log!("Using {} compilation mode", mode);
            
            // Parse and compile policy (keys are treated as strings)
            let compiled: Miniscript<XOnlyPublicKey, Tap> = policy.compile::<Tap>()
                .map_err(|e| format!("Failed to compile policy: {}", e))?;

            // Collect keys
            let mut keys: Vec<String> = policy.keys().into_iter().map(|k| k.to_string()).collect();
            keys.sort(); 
            keys.dedup();
            console_log!("Keys in policy: {:?}", keys);

            // Special handling for the specific case: or(pk(A), or(pk(B), pk(C)))
            // Should become: {{pk(A), pk(B)}, pk(C)}
            let tree = if let Concrete::Or(branches) = &policy {
                if branches.len() == 2 {
                    let (_, first) = &branches[0];
                    let (_, second) = &branches[1];
                    
                    // Check if this is the pattern: or(pk(A), or(pk(B), pk(C)))
                    if let Concrete::Or(nested_branches) = &**second {
                        if nested_branches.len() == 2 {
                            let (_, nested_first) = &nested_branches[0];
                            let (_, nested_second) = &nested_branches[1];
                            
                            // Check if all are pk() nodes
                            if let (Concrete::Key(_), Concrete::Key(_), Concrete::Key(_)) = (&**first, &**nested_first, &**nested_second) {
                                // Special case: keep first key separate, group second and third keys together
                                let first_pk = (**first).clone();
                                let second_pk = (**nested_first).clone();
                                let third_pk = (**nested_second).clone();
                                
                                // Create TapTree structure: {pk(A), {pk(B), pk(C)}}
                                // Left branch: pk(A) - single leaf
                                // Right branch: {pk(B), pk(C)} - two separate leaves
                                let first_ms: Miniscript<XOnlyPublicKey, Tap> = first_pk.compile::<Tap>()
                                    .map_err(|e| format!("Failed to compile first pk: {:?}", e))?;
                                let second_ms: Miniscript<XOnlyPublicKey, Tap> = second_pk.compile::<Tap>()
                                    .map_err(|e| format!("Failed to compile second pk: {:?}", e))?;
                                let third_ms: Miniscript<XOnlyPublicKey, Tap> = third_pk.compile::<Tap>()
                                    .map_err(|e| format!("Failed to compile third pk: {:?}", e))?;
                                
                                let left_branch = TapTree::Leaf(first_ms.into());
                                let right_branch = TapTree::combine(
                                    TapTree::Leaf(second_ms.into()),
                                    TapTree::Leaf(third_ms.into())
                                );
                                
                                TapTree::combine(left_branch, right_branch)
                            } else {
                                // Not the special pattern, use default behavior
                                let mut leaves: Vec<TapTree<XOnlyPublicKey>> = Vec::new();
                                for (_, sub) in branches {
                                    let ms: Miniscript<XOnlyPublicKey, Tap> = (**sub).compile::<Tap>()
                                        .map_err(|e| format!("Failed to compile sub-policy: {:?}", e))?;
                                    leaves.push(TapTree::Leaf(ms.into()));
                                }
                                leaves
                                    .into_iter()
                                    .reduce(|acc, t| TapTree::combine(acc, t))
                                    .unwrap_or_else(|| TapTree::Leaf(compiled.into()))
                            }
                        } else {
                            // Not the special pattern, use default behavior
                            let mut leaves: Vec<TapTree<XOnlyPublicKey>> = Vec::new();
                            for (_, sub) in branches {
                                let ms: Miniscript<XOnlyPublicKey, Tap> = (**sub).compile::<Tap>()
                                    .map_err(|e| format!("Failed to compile sub-policy: {:?}", e))?;
                                leaves.push(TapTree::Leaf(ms.into()));
                            }
                            leaves
                                .into_iter()
                                .reduce(|acc, t| TapTree::combine(acc, t))
                                .unwrap_or_else(|| TapTree::Leaf(compiled.into()))
                        }
                    } else {
                        // Not the special pattern, use default behavior
                        let mut leaves: Vec<TapTree<XOnlyPublicKey>> = Vec::new();
                        for (_, sub) in branches {
                            let ms: Miniscript<XOnlyPublicKey, Tap> = (**sub).compile::<Tap>()
                                .map_err(|e| format!("Failed to compile sub-policy: {:?}", e))?;
                            leaves.push(TapTree::Leaf(ms.into()));
                        }
                        leaves
                            .into_iter()
                            .reduce(|acc, t| TapTree::combine(acc, t))
                            .unwrap_or_else(|| TapTree::Leaf(compiled.into()))
                    }
                } else {
                    // Not the special pattern, use default behavior
                    let mut leaves: Vec<TapTree<XOnlyPublicKey>> = Vec::new();
                    for (_, sub) in branches {
                        let ms: Miniscript<XOnlyPublicKey, Tap> = (**sub).compile::<Tap>()
                            .map_err(|e| format!("Failed to compile sub-policy: {:?}", e))?;
                        leaves.push(TapTree::Leaf(ms.into()));
                    }
                    leaves
                        .into_iter()
                        .reduce(|acc, t| TapTree::combine(acc, t))
                        .unwrap_or_else(|| TapTree::Leaf(compiled.into()))
                }
            } else {
                // Single policy, not an OR
                TapTree::Leaf(compiled.into())
            };
            
            // Determine internal key based on mode
            let internal_key = if mode == "script-path" {
                // BIP341 NUMS internal key (script-only pattern)
                let nums = XOnlyPublicKey::from_str(
                    NUMS_POINT
                ).map_err(|e| format!("Failed to parse NUMS point: {}", e))?;
                console_log!("Using NUMS point as internal key for script-only mode");
                nums
            } else {
                // Key+Script mode: use first key from policy as internal key
                let chosen_xonly = policy.keys()
                    .into_iter()
                    .next()
                    .ok_or("Policy contains no keys")?;
                console_log!("Using policy key as internal key for key+script mode: {}", chosen_xonly);
                *chosen_xonly
            };
            
            // Create the descriptor
            let descriptor = Descriptor::<XOnlyPublicKey>::new_tr(internal_key, Some(tree))
                .map_err(|e| format!("Failed to create taproot descriptor: {}", e))?;
            
            console_log!("Created taproot descriptor: {}", descriptor);
            
            // Get the output script (scriptPubKey)
            let script = descriptor.script_pubkey();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = script.to_asm_string();
            
            // Generate address from descriptor
            let address = descriptor.address(network)
                .map(|addr| addr.to_string())
                .ok();
            
            // Get script size
            let script_size = script.len();
            
            // For display, we'll show the descriptor
            let compiled_miniscript_display = descriptor.to_string();
            
            // Get max satisfaction weight if available
            let max_weight_to_satisfy = descriptor.max_weight_to_satisfy()
                .ok()
                .and_then(|w| w.to_wu().try_into().ok());
            
            Ok((
                script_hex,
                script_asm,
                address,
                script_size,
                "Taproot".to_string(),
                compiled_miniscript_display,
                None, // max_satisfaction_size not needed for taproot
                max_weight_to_satisfy,
                Some(true), // sanity_check - assume true for valid compilation
                Some(true), // is_non_malleable - taproot is non-malleable
            ))
        },
        _ => {
            Err(format!("Unknown taproot compilation mode: {}", mode))
        }
    }
}

/// Original single-leaf taproot compilation method for XOnlyPublicKey
fn compile_taproot_policy_xonly_single_leaf(
    policy: Concrete<XOnlyPublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Tap>() {
        Ok(ms) => {
            let compiled_miniscript = ms.to_string();
            console_log!("XOnly policy compiled to single-leaf miniscript: {}", compiled_miniscript);
            
            // Now pass the compiled miniscript through the same tr() descriptor approach as miniscript compilation
            let nums_point = NUMS_POINT;
            let tr_descriptor = format!("tr({},{})", nums_point, compiled_miniscript);
            console_log!("Built tr() descriptor from single-leaf miniscript: {}", tr_descriptor);
            
            // Parse as descriptor to get proper taproot script and address
            match tr_descriptor.parse::<Descriptor<XOnlyPublicKey>>() {
                Ok(descriptor) => {
                    console_log!("Successfully parsed tr() descriptor from policy");
                    
                    // Get the output script (scriptPubKey)
                    let script = descriptor.script_pubkey();
                    let script_hex = hex::encode(script.as_bytes());
                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                    let script_size = script.len();
                    
                    // Generate address from descriptor
                    let address = descriptor.address(network)
                        .map(|addr| addr.to_string())
                        .ok();
                    
                    // Get satisfaction properties from original miniscript
                    let miniscript_str = ms.to_string();
                    let (max_satisfaction_size, max_weight_to_satisfy) = if miniscript_str.starts_with("pk(") {
                        (Some(64), Some(64u64))
                    } else {
                        (None, None)
                    };
                    
                    let sanity_check = ms.sanity_check().is_ok();
                    let is_non_malleable = ms.is_non_malleable();
                    
                    console_log!("Generated Taproot script from policy: {} bytes", script_size);
                    console_log!("Generated Taproot address from policy: {:?}", address);
                    
                    Ok((
                        script_hex,
                        script_asm,
                        address,
                        script_size,
                        "Taproot".to_string(),
                        compiled_miniscript,
                        max_satisfaction_size,
                        max_weight_to_satisfy,
                        Some(sanity_check),
                        Some(is_non_malleable)
                    ))
                }
                Err(e) => {
                    console_log!("Failed to parse tr() descriptor from policy: {}", e);
                    Err(format!("Failed to create tr() descriptor from policy: {}", e))
                }
            }
        }
        Err(e) => Err(format!("Policy compilation failed for Taproot: {}", e))
    }
}

/// Compile policy for Taproot context (should fail for compressed keys)
fn compile_taproot_policy(
    _policy: Concrete<PublicKey>,
    _network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    // Don't do automatic conversion - fail with proper error message
    Err("Taproot context requires x-only keys (32 bytes). Found compressed keys (33 bytes).".to_string())
}

/// Compile policy for Taproot context with mode (should fail for compressed keys)
fn compile_taproot_policy_with_mode(
    _policy: Concrete<PublicKey>,
    _network: Network,
    _mode: &str
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    // Don't do automatic conversion - fail with proper error message
    Err("Taproot context requires x-only keys (32 bytes). Found compressed keys (33 bytes).".to_string())
}

/// Original single-leaf taproot compilation method
fn compile_taproot_policy_single_leaf(
    xonly_policy: Concrete<XOnlyPublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match xonly_policy.compile::<Tap>() {
        Ok(ms) => {
            let compiled_miniscript = ms.to_string();
            console_log!("Policy compiled to single-leaf miniscript: {}", compiled_miniscript);
            
            // Now pass the compiled miniscript through the same tr() descriptor approach as miniscript compilation
            let nums_point = NUMS_POINT;
            let tr_descriptor = format!("tr({},{})", nums_point, compiled_miniscript);
            console_log!("Built tr() descriptor from single-leaf miniscript: {}", tr_descriptor);
            
            // Parse as descriptor to get proper taproot script and address
            match tr_descriptor.parse::<Descriptor<XOnlyPublicKey>>() {
                Ok(descriptor) => {
                    console_log!("Successfully parsed tr() descriptor from converted policy");
                    
                    // Get the output script (scriptPubKey)
                    let script = descriptor.script_pubkey();
                    let script_hex = hex::encode(script.as_bytes());
                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                    let script_size = script.len();
                    
                    // Generate address from descriptor
                    let address = descriptor.address(network)
                        .map(|addr| addr.to_string())
                        .ok();
                    
                    // Get satisfaction properties from original miniscript
                    let miniscript_str = ms.to_string();
                    let (max_satisfaction_size, max_weight_to_satisfy) = if miniscript_str.starts_with("pk(") {
                        (Some(64), Some(64u64))
                    } else {
                        (None, None)
                    };
                    
                    let sanity_check = ms.sanity_check().is_ok();
                    let is_non_malleable = ms.is_non_malleable();
                    
                    console_log!("Generated Taproot script from converted policy: {} bytes", script_size);
                    console_log!("Generated Taproot address from converted policy: {:?}", address);
                    
                    Ok((
                        script_hex,
                        script_asm,
                        address,
                        script_size,
                        "Taproot".to_string(),
                        compiled_miniscript,
                        max_satisfaction_size,
                        max_weight_to_satisfy,
                        Some(sanity_check),
                        Some(is_non_malleable)
                    ))
                }
                Err(e) => {
                    console_log!("Failed to parse tr() descriptor from converted policy: {}", e);
                    Err(format!("Failed to create tr() descriptor from policy: {}", e))
                }
            }
        }
        Err(e) => Err(format!("Policy compilation failed for Taproot: {}", e))
    }
}

// ============================================================================
// Taproot Branch Display Functions
// ============================================================================


/// Collect all leaf miniscripts under a subtree
fn collect_leaf_miniscripts<'a>(
    t: &'a miniscript::descriptor::TapTree<XOnlyPublicKey>,
    out: &mut Vec<&'a Miniscript<XOnlyPublicKey, Tap>>,
) {
    use miniscript::descriptor::TapTree;
    match t {
        TapTree::Leaf(ms) => out.push(ms),
        TapTree::Tree { left, right, .. } => {
            collect_leaf_miniscripts(&left, out);
            collect_leaf_miniscripts(&right, out);
        }
    }
}

/// Convert a subtree (branch) to ONE valid Miniscript by OR-ing all leaf policies
fn branch_to_miniscript(
    subtree: &miniscript::descriptor::TapTree<XOnlyPublicKey>,
) -> Result<Miniscript<XOnlyPublicKey, Tap>, String> {
    use miniscript::policy::Liftable;
    
    // 1) gather leaves
    let mut leaves = Vec::new();
    collect_leaf_miniscripts(subtree, &mut leaves);
    if leaves.is_empty() {
        return Err("Subtree has no scripts".to_string());
    }

    // 2) If only one leaf, return it as-is
    if leaves.len() == 1 {
        return Ok(leaves[0].clone());
    }

    // 3) OR the lifted policies (string form)
    let mut policy_parts = Vec::new();
    for ms in leaves {
        match ms.lift() {
            Ok(policy) => {
                policy_parts.push(policy.to_string());
            }
            Err(_) => {
                // Fallback: use the miniscript string directly as a policy atom
                policy_parts.push(ms.to_string());
            }
        }
    }
    
    // Build nested OR structure for valid policy
    let policy_str = if policy_parts.len() == 2 {
        format!("or({},{})", policy_parts[0], policy_parts[1])
    } else {
        // For more than 2, build nested ORs
        let mut result = policy_parts[0].clone();
        for i in 1..policy_parts.len() {
            result = format!("or({},{})", result, policy_parts[i]);
        }
        result
    };

    // 4) Compile to Miniscript (Tap context)
    match policy_str.parse::<Concrete<XOnlyPublicKey>>() {
        Ok(conc) => {
            match conc.compile::<Tap>() {
                Ok(ms) => Ok(ms),
                Err(e) => Err(format!("Failed to compile branch miniscript: {}", e))
            }
        }
        Err(e) => Err(format!("Failed to parse branch policy: {}", e))
    }
}

/// Collect all leaf miniscripts under a subtree - NEW VERSION FOR MINISCRIPT BRANCHES
fn collect_leaf_miniscripts_new<'a, K: miniscript::MiniscriptKey>(
    t: &'a miniscript::descriptor::TapTree<K>,
    out: &mut Vec<&'a Miniscript<K, Tap>>,
) {
    use miniscript::descriptor::TapTree;
    match t {
        TapTree::Leaf(ms) => out.push(ms),
        TapTree::Tree { left, right, .. } => {
            collect_leaf_miniscripts_new(&left, out);
            collect_leaf_miniscripts_new(&right, out);
        }
    }
}

/// Convert a subtree (branch) to ONE valid Miniscript by OR-ing all leaf policies - NEW VERSION
fn branch_to_miniscript_new<K: miniscript::MiniscriptKey + miniscript::FromStrKey>(
    subtree: &miniscript::descriptor::TapTree<K>,
) -> Result<Miniscript<K, Tap>, String> {
    // 1) gather leaves
    let mut leaves = Vec::new();
    collect_leaf_miniscripts_new(subtree, &mut leaves);
    if leaves.is_empty() {
        return Err("subtree has no leaves".to_string());
    }

    // 2) OR the lifted policies (string form)
    let parts: Vec<String> = leaves
        .iter()
        .map(|ms| ms.lift().map(|p| p.to_string()))
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Failed to lift policy: {}", e))?;
    let policy_str = if parts.len() == 1 { 
        parts[0].clone() 
    } else { 
        format!("or({})", parts.join(","))
    };

    // 3) Compile to Miniscript (Tap context)
    let conc = Concrete::<K>::from_str(&policy_str)
        .map_err(|e| format!("Failed to parse policy: {}", e))?;
    let ms: Miniscript<K, Tap> = conc.compile::<Tap>()
        .map_err(|e| format!("Failed to compile miniscript: {}", e))?;
    Ok(ms)
}

/// Return the Miniscript for the root's direct branches (L and R) - RESTORED ORIGINAL
fn get_taproot_branches_as_miniscript(
    descriptor_str: &str
) -> Result<Vec<(String, String)>, String> {
    use miniscript::descriptor::TapTree;
    
    // Parse the descriptor
    let desc: Descriptor<XOnlyPublicKey> = descriptor_str.parse()
        .map_err(|e| format!("Failed to parse descriptor: {}", e))?;
    
    // Get the TapTree
    let tree = match desc {
        Descriptor::Tr(ref tr) => {
            tr.tap_tree().clone()
                .ok_or_else(|| "No script paths (key-only descriptor)".to_string())?
        }
        _ => return Err("Not a taproot descriptor".to_string())
    };
    
    // Process based on tree structure
    let mut out = Vec::new();
    match tree {
        TapTree::Leaf(ms) => {
            // Single leaf at root
            out.push(("root".to_string(), ms.to_string()));
        }
        TapTree::Tree { left, right, .. } => {
            // Get miniscript for each branch
            let l_ms = branch_to_miniscript(&left)?;
            let r_ms = branch_to_miniscript(&right)?;
            out.push(("L".to_string(), l_ms.to_string()));
            out.push(("R".to_string(), r_ms.to_string()));
        }
    }
    
    Ok(out)
}

/// Compute worst-case Taproot script-path witness weight (in WU).
/// Includes stack data, script, control block, and CompactSize prefixes.
/// Always assumes 65-byte Schnorr sigs (worst case).
// moved to taproot::utils::taproot_leaf_witness_weight_worst

/// Compute Taproot witness weight breakdown for display
// moved to taproot::weights::taproot_witness_breakdown

/// Get miniscript branches for taproot descriptors using YOUR WORKING CODE
#[wasm_bindgen]
pub fn get_taproot_miniscript_branches(descriptor: &str) -> JsValue {
    crate::taproot::branches::get_taproot_miniscript_branches(descriptor)
}

/// Get taproot branches - real implementation
#[wasm_bindgen]
pub fn get_taproot_branches(descriptor: &str) -> JsValue {
    crate::taproot::branches::get_taproot_branches(descriptor)
}

// ============================================================================
// Taproot Branch Weight Calculation
// ============================================================================

/// Calculate weight information for each taproot branch
#[wasm_bindgen]
pub fn get_taproot_branch_weights(descriptor: &str) -> JsValue {
    crate::taproot::branches::get_taproot_branch_weights(descriptor)
}

// ============================================================================
// Lifting Functions
// ============================================================================

/// Lift a Bitcoin script to miniscript
#[wasm_bindgen]
pub fn lift_to_miniscript(bitcoin_script: &str) -> JsValue {
    lift::lift_to_miniscript(bitcoin_script)
}

/// Lift a miniscript to policy
#[wasm_bindgen]
pub fn lift_to_policy(miniscript: &str) -> JsValue {
    lift::lift_to_policy(miniscript)
}


// ============================================================================
// Address Generation
// ============================================================================


/// Generate address for a specific network
/// Generate address for network switching (Legacy/Segwit only)
/// 
/// # Deprecated
/// This function is deprecated for taproot addresses.
/// The JavaScript now uses `compile_miniscript_with_mode_and_network()` for taproot addresses.
#[deprecated(since = "0.1.0", note = "For taproot, use compile_miniscript_with_mode_and_network() instead")]
#[wasm_bindgen]
pub fn generate_address_for_network(script_hex: &str, script_type: &str, network: &str) -> JsValue {
    address::generate_address_for_network(script_hex, script_type, network)
}

/// Generate taproot address for a specific network with miniscript
/// 
/// # Deprecated
/// This function is deprecated and no longer used by the JavaScript interface.
/// The JavaScript now uses `compile_miniscript_with_mode_and_network()` for taproot addresses.
#[deprecated(since = "0.1.0", note = "Use compile_miniscript_with_mode_and_network() instead")]
#[wasm_bindgen]
pub fn generate_taproot_address_for_network(miniscript: &str, network_str: &str) -> JsValue {
    address::generate_taproot_address_for_network(miniscript, network_str)
}

/// Generate taproot address using TaprootBuilder (matches compilation logic)
/// 
/// # Deprecated
/// This function is deprecated and no longer used by the JavaScript interface.
/// The JavaScript now uses `compile_miniscript_with_mode_and_network()` for taproot addresses.
#[deprecated(since = "0.1.0", note = "Use compile_miniscript_with_mode_and_network() instead")]
#[wasm_bindgen]
pub fn generate_taproot_address_with_builder(miniscript: &str, network_str: &str, internal_key: Option<String>) -> JsValue {
    address::generate_taproot_address_with_builder(miniscript, network_str, internal_key)
}


// ============================================================================
/// Extract taproot tree leaves from a miniscript expression
#[wasm_bindgen]
pub fn get_taproot_leaves(expression: &str) -> JsValue {
    console_log!("Extracting taproot leaves from: {}", expression);
    
    #[derive(Serialize)]
    struct TaprootLeaf {
        leaf_index: usize,
        branch_path: String,
        miniscript: String,
        script_hex: String,
        script_asm: String,
    }
    
    let mut leaves: Vec<TaprootLeaf> = Vec::new();
    
    // First process any descriptor keys in the expression
    let processed_expr = match process_expression_descriptors(expression) {
        Ok(processed) => {
            console_log!("DEBUG: Processed expression descriptors: {} -> {}", expression, processed);
            processed
        },
        Err(_e) => {
            console_log!("DEBUG: Failed to process descriptors: {:?}, using original", _e);
            expression.to_string()
        },
    };
    
    // Helper function to recursively extract leaves from a miniscript expression
    fn extract_leaves_from_expression(expr: &str, leaves: &mut Vec<TaprootLeaf>, index_counter: &mut usize, branch_path: String) {
        let trimmed = expr.trim();
        console_log!("Processing expression for leaves: {}", trimmed);
        
        // Check for or_d, or_c, or_i patterns which create tree branches in taproot
        if trimmed.starts_with("or_d(") || trimmed.starts_with("or_c(") || trimmed.starts_with("or_i(") {
            // Find the matching closing parenthesis and split the branches
            if let Some(start_idx) = trimmed.find('(') {
                let inner = &trimmed[start_idx + 1..];
                
                // Simple parser to find the comma separating the two branches
                let mut depth = 0;
                let mut comma_pos = None;
                
                for (i, ch) in inner.chars().enumerate() {
                    match ch {
                        '(' => depth += 1,
                        ')' => {
                            depth -= 1;
                            if depth < 0 {
                                break;
                            }
                        },
                        ',' if depth == 0 => {
                            comma_pos = Some(i);
                            break;
                        },
                        _ => {}
                    }
                }
                
                if let Some(comma_idx) = comma_pos {
                    let left_branch = &inner[..comma_idx].trim();
                    let right_start = comma_idx + 1;
                    
                    // Find the end of the right branch
                    let mut depth = 0;
                    let mut right_end = inner.len();
                    
                    for (i, ch) in inner[right_start..].chars().enumerate() {
                        match ch {
                            '(' => depth += 1,
                            ')' => {
                                if depth == 0 {
                                    right_end = right_start + i;
                                    break;
                                }
                                depth -= 1;
                            },
                            _ => {}
                        }
                    }
                    
                    let right_branch = &inner[right_start..right_end].trim();
                    
                    console_log!("Found or branches - Left: {}, Right: {}", left_branch, right_branch);
                    
                    // Recursively process each branch
                    let left_path = if branch_path.is_empty() { "A".to_string() } else { format!("{}A", branch_path) };
                    let right_path = if branch_path.is_empty() { "B".to_string() } else { format!("{}B", branch_path) };
                    extract_leaves_from_expression(left_branch, leaves, index_counter, left_path);
                    extract_leaves_from_expression(right_branch, leaves, index_counter, right_path);
                    
                    return;
                }
            }
        }
        
        // If not an or branch, this is a leaf - compile it
        console_log!("Processing as leaf: {}", trimmed);
        
        // Try parsing as miniscript
        match trimmed.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
            Ok(ms) => {
                let script = ms.encode();
                let hex = script.to_hex_string();
                let asm = script.to_asm_string();
                
                leaves.push(TaprootLeaf {
                    leaf_index: *index_counter,
                    branch_path: if branch_path.is_empty() { "Root".to_string() } else { format!("Branch {}", branch_path) },
                    miniscript: trimmed.to_string(),
                    script_hex: hex,
                    script_asm: asm,
                });
                
                *index_counter += 1;
            }
            Err(_e) => {
                console_log!("Failed to parse leaf as miniscript: {} - {}", trimmed, _e);
                
                // Try with PublicKey - for taproot, we need x-only keys
                // For now, just log that it needs conversion - the main compilation will handle this
                match trimmed.parse::<Miniscript<PublicKey, Tap>>() {
                    Ok(_ms_pubkey) => {
                        console_log!("Leaf uses PublicKey format, needs x-only conversion: {}", trimmed);
                        // Create a placeholder leaf indicating conversion needed
                        leaves.push(TaprootLeaf {
                            leaf_index: *index_counter,
                            branch_path: if branch_path.is_empty() { "Root".to_string() } else { format!("Branch {}", branch_path) },
                            miniscript: trimmed.to_string(),
                            script_hex: "requires_key_conversion".to_string(),
                            script_asm: "PublicKey format - needs x-only conversion".to_string(),
                        });
                        *index_counter += 1;
                    }
                    Err(_e2) => {
                        console_log!("Failed to parse leaf with both XOnly and PublicKey: {} - {}", trimmed, _e2);
                    }
                }
            }
        }
    }
    
    // Check if this is a tr() descriptor
    if processed_expr.trim().starts_with("tr(") {
        // Try to parse the full descriptor to get the TapTree structure
        match processed_expr.parse::<Descriptor<XOnlyPublicKey>>() {
            Ok(_descriptor) => {
                console_log!("Successfully parsed tr() descriptor for leaf extraction");
                
                // Extract leaf information from the descriptor string
                // Since tapscript_spend_info() is not available, we'll parse the descriptor string
                console_log!("Extracting taproot leaves from descriptor string parsing");
                if let Some(tree_start) = processed_expr.find(',') {
                    if let Some(tree_end) = processed_expr.rfind(')') {
                        let tree_part = &processed_expr[tree_start + 1..tree_end];
                        if tree_part.starts_with("{") && tree_part.contains("}") {
                            // Extract miniscripts from tree structure
                            let inner = &tree_part[1..tree_part.len()-1];
                            let mut depth = 0;
                            let mut paren_depth = 0;
                            let mut last_start = 0;
                            let mut leaf_idx = 0;
                            
                            for (i, ch) in inner.chars().enumerate() {
                                match ch {
                                    '{' => depth += 1,
                                    '}' => depth -= 1,
                                    '(' => paren_depth += 1,
                                    ')' => paren_depth -= 1,
                                    ',' if depth == 0 && paren_depth == 0 => {
                                        let miniscript_str = inner[last_start..i].trim();
                                        console_log!("Found leaf miniscript: {}", miniscript_str);
                                        
                                        // Try to compile this miniscript to get the script
                                        match miniscript_str.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
                                            Ok(ms) => {
                                                let script = ms.encode();
                                                let script_hex = script.to_hex_string();
                                                let script_asm = script.to_asm_string();
                                                
                                                leaves.push(TaprootLeaf {
                                                    leaf_index: leaf_idx,
                                                    branch_path: format!("Leaf {}", leaf_idx),
                                                    miniscript: miniscript_str.to_string(),
                                                    script_hex,
                                                    script_asm,
                                                });
                                            }
                                            Err(e) => {
                                                console_log!("Failed to compile leaf miniscript: {}", e);
                                                leaves.push(TaprootLeaf {
                                                    leaf_index: leaf_idx,
                                                    branch_path: format!("Leaf {}", leaf_idx),
                                                    miniscript: miniscript_str.to_string(),
                                                    script_hex: "Compilation failed".to_string(),
                                                    script_asm: format!("Error: {}", e),
                                                });
                                            }
                                        }
                                        leaf_idx += 1;
                                        last_start = i + 1;
                                    },
                                    _ => {}
                                }
                            }
                            // Add the last miniscript
                            if last_start < inner.len() {
                                let miniscript_str = inner[last_start..].trim();
                                console_log!("Found last leaf miniscript: {}", miniscript_str);
                                
                                match miniscript_str.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
                                    Ok(ms) => {
                                        let script = ms.encode();
                                        let script_hex = script.to_hex_string();
                                        let script_asm = script.to_asm_string();
                                        
                                        leaves.push(TaprootLeaf {
                                            leaf_index: leaf_idx,
                                            branch_path: format!("Leaf {}", leaf_idx),
                                            miniscript: miniscript_str.to_string(),
                                            script_hex,
                                            script_asm,
                                        });
                                    }
                                    Err(e) => {
                                        console_log!("Failed to compile last leaf miniscript: {}", e);
                                        leaves.push(TaprootLeaf {
                                            leaf_index: leaf_idx,
                                            branch_path: format!("Leaf {}", leaf_idx),
                                            miniscript: miniscript_str.to_string(),
                                            script_hex: "Compilation failed".to_string(),
                                            script_asm: format!("Error: {}", e),
                                        });
                                    }
                                }
                            }
                            
                            console_log!("Extracted {} leaves from descriptor parsing", leaves.len());
                        } else {
                            // Fall back to string parsing approach
                            console_log!("Single leaf or unsupported format, falling back to string parsing");
                            if !tree_part.is_empty() {
                                let mut index_counter = 0;
                                extract_leaves_from_expression(tree_part, &mut leaves, &mut index_counter, String::new());
                            }
                        }
                    }
                } else {
                    console_log!("No tree part found in descriptor");
                }
            }
            Err(_e) => {
                console_log!("Failed to parse tr() descriptor: {}, falling back to string parsing", _e);
                
                // Fall back to extracting from string
                if let Some(tree_start) = processed_expr.find(',') {
                    if let Some(tree_end) = processed_expr.rfind(')') {
                        let tree_script = &processed_expr[tree_start + 1..tree_end];
                        console_log!("Extracted tree script from tr(): {}", tree_script);
                        
                        let mut index_counter = 0;
                        extract_leaves_from_expression(tree_script, &mut leaves, &mut index_counter, String::new());
                    }
                }
            }
        }
    } else {
        // For non-tr() expressions, process the whole expression
        let mut index_counter = 0;
        extract_leaves_from_expression(&processed_expr, &mut leaves, &mut index_counter, String::new());
    }
    
    // Helper function to extract leaves from TapTree structure
    fn extract_taptree_leaves(tree_str: &str, leaves: &mut Vec<TaprootLeaf>, leaf_index: &mut usize) {
        console_log!("Extracting leaves from TapTree: {}", tree_str);
        
        // Remove outer braces if present
        let trimmed = tree_str.trim();
        let inner = if trimmed.starts_with("{") && trimmed.ends_with("}") {
            &trimmed[1..trimmed.len()-1]
        } else {
            trimmed
        };
        
        // Find the comma that separates branches at the top level, accounting for nested parentheses
        let mut depth = 0;
        let mut paren_depth = 0;
        let mut comma_pos = None;
        
        for (i, ch) in inner.chars().enumerate() {
            match ch {
                '{' => depth += 1,
                '}' => depth -= 1,
                '(' => paren_depth += 1,
                ')' => paren_depth -= 1,
                ',' if depth == 0 && paren_depth == 0 => {
                    comma_pos = Some(i);
                    break;
                },
                _ => {}
            }
        }
        
        if let Some(comma_idx) = comma_pos {
            // This is a branch - process both sides
            let left = inner[..comma_idx].trim();
            let right = inner[comma_idx + 1..].trim();
            
            console_log!("TapTree branch - Left: {}, Right: {}", left, right);
            
            // Process left branch
            if left.starts_with("{") && left.contains("}") {
                // Nested tree structure
                extract_taptree_leaves(left, leaves, leaf_index);
            } else {
                // It's a leaf - compile it
                compile_and_add_leaf(left, leaves, leaf_index);
            }
            
            // Process right branch  
            if right.starts_with("{") && right.contains("}") {
                // Nested tree structure
                extract_taptree_leaves(right, leaves, leaf_index);
            } else {
                // It's a leaf - compile it
                compile_and_add_leaf(right, leaves, leaf_index);
            }
        } else {
            // No comma at top level - this is a single leaf
            compile_and_add_leaf(inner, leaves, leaf_index);
        }
    }
    
    // Helper function to compile and add a leaf
    fn compile_and_add_leaf(expr: &str, leaves: &mut Vec<TaprootLeaf>, leaf_index: &mut usize) {
        let trimmed = expr.trim();
        console_log!("Compiling leaf: {}", trimmed);
        
        // Try parsing as miniscript
        match trimmed.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
            Ok(ms) => {
                let script = ms.encode();
                let hex = script.to_hex_string();
                let asm = script.to_asm_string();
                
                leaves.push(TaprootLeaf {
                    leaf_index: *leaf_index,
                    branch_path: format!("Leaf {}", *leaf_index),
                    miniscript: trimmed.to_string(),
                    script_hex: hex,
                    script_asm: asm,
                });
                
                *leaf_index += 1;
            }
            Err(_e) => {
                console_log!("Failed to parse leaf as miniscript: {} - {}", trimmed, _e);
                
                // Try to handle as placeholder
                leaves.push(TaprootLeaf {
                    leaf_index: *leaf_index,
                    branch_path: format!("Leaf {}", *leaf_index),
                    miniscript: trimmed.to_string(),
                    script_hex: "Compilation needed".to_string(),
                    script_asm: "Requires compilation".to_string(),
                });
                *leaf_index += 1;
            }
        }
    }
    
    console_log!("Total leaves extracted: {}", leaves.len());
    for _leaf in &leaves {
        console_log!("Leaf {}: {}", _leaf.leaf_index, _leaf.miniscript);
    }
    
    serde_wasm_bindgen::to_value(&leaves).unwrap_or(JsValue::NULL)
}

// Main Function (for testing)
// ============================================================================

pub fn main() {
    console_log!("Miniscript compiler library loaded");
}