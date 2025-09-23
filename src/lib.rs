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
pub mod compile;
mod translators;
mod opcodes;
mod utils;
mod parse { pub(crate) mod helpers; }
mod lift;
pub mod address;
mod taproot;

// Export modules for integration tests
pub mod descriptors;
pub mod keys;
pub mod validation;

// Module functions are accessible via the pub mod declarations above

// Re-exports from modules
use types::{CompilationResult, LiftResult, AddressResult, ParsedDescriptor};

// External crate imports
use wasm_bindgen::prelude::*;
use miniscript::{Miniscript, Tap, policy::Concrete, Descriptor, DescriptorPublicKey, policy::Liftable};
use bitcoin::{Network, XOnlyPublicKey, secp256k1::Secp256k1};
// ... existing code ...
use bitcoin::bip32::ChildNumber;
use std::str::FromStr;
use std::collections::HashMap;

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





/// Unified compilation function accepting options as JavaScript object
///
/// This is the new recommended way to compile both policies and miniscripts.
/// It provides a single entry point with full control over all compilation options.
///
/// # Example JavaScript usage:
/// ```javascript
/// const options = {
///     input_type: "Policy",  // or "Miniscript"
///     context: "Taproot",    // or "Legacy", "Segwit"
///     mode: "MultiLeaf",     // or "SingleLeaf", "ScriptPath", "Default"
///     network: "Bitcoin",    // or "Testnet", etc.
///     nums_key: "..."        // optional NUMS key for taproot
/// };
/// const result = compile_unified("or(pk(key1),pk(key2))", options);
/// ```
#[wasm_bindgen]
pub fn compile_unified(expression: &str, options_js: JsValue) -> JsValue {
    // Parse options from JavaScript
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
#[wasm_bindgen]
pub fn generate_address_for_network(script_hex: &str, script_type: &str, network: &str) -> JsValue {
    address::generate_address_for_network(script_hex, script_type, network)
}




// Main Function (for testing)
// ============================================================================

pub fn main() {
    console_log!("Miniscript compiler library loaded");
}