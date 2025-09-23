//! WebAssembly Interface for Bitcoin Miniscript Compiler
//!
//! This module serves as the primary entry point for all WebAssembly exports.
//! It provides JavaScript bindings for compiling Bitcoin policies and miniscripts,
//! lifting scripts, generating addresses, and analyzing taproot branches.
//! All implementation logic resides in submodules - this file only handles
//! WASM serialization and delegation to the appropriate modules.

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

// Public modules for integration tests
pub mod descriptors;
pub mod keys;
pub mod validation;

use types::{CompilationResult, LiftResult, AddressResult};
use wasm_bindgen::prelude::*;
use miniscript::{Miniscript, Tap, policy::Concrete, Descriptor, policy::Liftable};
use bitcoin::XOnlyPublicKey;
use std::str::FromStr;

// Standard NUMS point for taproot (unspendable key)
pub const NUMS_POINT: &str = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";


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

// Transform top-level OR patterns to tree notation for Taproot
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

// Collect all leaf miniscripts under a subtree
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

// Convert a subtree (branch) to ONE valid Miniscript by OR-ing all leaf policies
fn branch_to_miniscript(
    subtree: &miniscript::descriptor::TapTree<XOnlyPublicKey>,
) -> Result<Miniscript<XOnlyPublicKey, Tap>, String> {
    use miniscript::policy::Liftable;
    
    // Gather leaves
    let mut leaves = Vec::new();
    collect_leaf_miniscripts(subtree, &mut leaves);
    if leaves.is_empty() {
        return Err("Subtree has no scripts".to_string());
    }

    // If only one leaf, return it as-is
    if leaves.len() == 1 {
        return Ok(leaves[0].clone());
    }

    // OR the lifted policies (string form)
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

    // Compile to Miniscript (Tap context)
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

// Collect all leaf miniscripts under a subtree (generic version)
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

// Convert a subtree (branch) to ONE valid Miniscript by OR-ing all leaf policies (generic version)
fn branch_to_miniscript_new<K: miniscript::MiniscriptKey + miniscript::FromStrKey>(
    subtree: &miniscript::descriptor::TapTree<K>,
) -> Result<Miniscript<K, Tap>, String> {
    // Gather leaves
    let mut leaves = Vec::new();
    collect_leaf_miniscripts_new(subtree, &mut leaves);
    if leaves.is_empty() {
        return Err("subtree has no leaves".to_string());
    }

    // OR the lifted policies (string form)
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

    // Compile to Miniscript (Tap context)
    let conc = Concrete::<K>::from_str(&policy_str)
        .map_err(|e| format!("Failed to parse policy: {}", e))?;
    let ms: Miniscript<K, Tap> = conc.compile::<Tap>()
        .map_err(|e| format!("Failed to compile miniscript: {}", e))?;
    Ok(ms)
}

// Return the Miniscript for the root's direct branches (L and R)
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
// Main function for testing
pub fn main() {
    console_log!("Miniscript compiler library loaded");
}