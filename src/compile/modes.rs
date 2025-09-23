//! Taproot-specific compilation modes
//! 
//! This module contains the three distinct taproot compilation functions
//! that must remain separate to generate different addresses.

use crate::compile::types::CompileResponse;
use crate::console_log;
use bitcoin::{Network, XOnlyPublicKey};
use miniscript::{Miniscript, Tap, Descriptor};
use std::sync::Arc;
use std::str::FromStr;
use miniscript::descriptor::TapTree;

/// Compile taproot multi-leaf mode (extracts internal key from miniscript)
pub fn compile_taproot_multi_leaf(expression: &str, network: Network) -> Result<CompileResponse, String> {

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
            let internal_key_str = crate::keys::extract_internal_key_from_expression(expression);
            console_log!("DEBUG DESCRIPTOR KEYPATH: Extracted internal key: {}", internal_key_str);
            
            // Parse internal key
            let internal_xonly_key = if let Ok(key_bytes) = hex::decode(&internal_key_str) {
                if key_bytes.len() == 32 {
                    if let Ok(xonly_key) = XOnlyPublicKey::from_slice(&key_bytes) {
                        console_log!("DEBUG DESCRIPTOR KEYPATH: Successfully created XOnlyPublicKey from hex");
                        xonly_key
                    } else {
                        console_log!("DEBUG DESCRIPTOR KEYPATH: Failed to create XOnlyPublicKey, using NUMS");
                        crate::taproot::utils::get_taproot_nums_point()
                    }
                } else {
                    console_log!("DEBUG DESCRIPTOR KEYPATH: Key bytes length is not 32, using NUMS");
                    crate::taproot::utils::get_taproot_nums_point()
                }
            } else {
                console_log!("DEBUG DESCRIPTOR KEYPATH: Failed to decode hex key, using NUMS");
                crate::taproot::utils::get_taproot_nums_point()
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
                            
                            Ok(CompileResponse {
                                success: true,
                                error: None,
                                script: Some(script_hex),
                                script_asm: Some(script_asm),
                                address: Some(address.to_string()),
                                script_size: Some(script_size),
                                miniscript_type: Some("Taproot".to_string()),
                                compiled_miniscript: Some(ms.to_string()),
                                max_satisfaction_size,
                                max_weight_to_satisfy,
                                sanity_check: Some(true),
                                is_non_malleable: Some(true),
                            })
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

/// Compile taproot single-leaf mode (uses NUMS point)
pub fn compile_taproot_single_leaf(expression: &str, nums_key: &str, network: Network) -> Result<CompileResponse, String> {
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
                            
                            Ok(CompileResponse {
                                success: true,
                                error: None,
                                script: Some(script_hex),
                                script_asm: Some(script_asm),
                                address: Some(address.to_string()),
                                script_size: Some(script_size),
                                miniscript_type: Some("Taproot".to_string()),
                                compiled_miniscript: Some(format!("{}|LEAF_ASM:{}", descriptor.to_string(), leaf_script_asm)),
                                max_satisfaction_size,
                                max_weight_to_satisfy,
                                sanity_check: Some(true),
                                is_non_malleable: Some(true),
                            })
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

/// Compile taproot script-path mode (uses NUMS point)
pub fn compile_taproot_script_path(expression: &str, nums_key: &str, network: Network) -> Result<CompileResponse, String> {
    use std::sync::Arc;
    use miniscript::descriptor::TapTree;

    console_log!("=== COMPILE_TAPROOT_SCRIPT_PATH_DESCRIPTOR ===");
    console_log!("Expression: {}", expression);
    console_log!("NUMS key: {}", nums_key);
    console_log!("Network: {:?}", network);
    let processed_expr = expression.trim();
    
    // Parse as XOnlyPublicKey miniscript for Taproot
    match processed_expr.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        Ok(ms) => {
            let normalized_miniscript = ms.to_string();
            console_log!("Parsed miniscript: {}", normalized_miniscript);
            
            // Transform top-level OR patterns to tree notation
            let transformed_miniscript = super::utils::transform_or_to_tree(&normalized_miniscript);
            console_log!("After OR transformation: {}", transformed_miniscript);
            
            // Calculate satisfaction weights 
            let max_satisfaction_size = ms.max_satisfaction_size().ok();
            let max_weight_to_satisfy = max_satisfaction_size.map(|s| s as u64);
            
            // Parse NUMS key
            let nums_xonly_key = match XOnlyPublicKey::from_str(nums_key) {
                Ok(key) => key,
                Err(_) => return Err(format!("Failed to parse NUMS key: {}", nums_key))
            };
            
            console_log!("DEBUG DESCRIPTOR: Using NUMS key: {}", nums_xonly_key);
            
            // If we transformed an OR pattern, create a new tr() descriptor with tree notation
            if transformed_miniscript != normalized_miniscript {
                console_log!("OR pattern detected! Creating tr() descriptor with tree notation");
                
                // Build the tr() descriptor string with tree notation
                let tr_descriptor_str = format!("tr({},{})", nums_key, transformed_miniscript);
                console_log!("Attempting to parse descriptor: {}", tr_descriptor_str);
                
                // Parse the descriptor with tree notation
                match tr_descriptor_str.parse::<Descriptor<XOnlyPublicKey>>() {
                    Ok(descriptor) => {
                        console_log!("Successfully parsed tr() descriptor with tree notation");
                        let descriptor_str = descriptor.to_string();
                        console_log!("DEBUG DESCRIPTOR: Successfully created descriptor: {}", descriptor_str);
                        
                        // Get the address from the descriptor
                        let address = descriptor.address(network)
                            .map_err(|e| format!("Failed to derive address: {}", e))?;
                        console_log!("DEBUG DESCRIPTOR: Generated address: {}", address);
                        
                        // Get the script pubkey
                        let script_pubkey = descriptor.script_pubkey();
                        let script_hex = script_pubkey.to_hex_string();
                        let script_asm = format!("{:?}", script_pubkey)
                            .replace("Script(", "")
                            .trim_end_matches(')')
                            .to_string();
                        
                        console_log!("DEBUG DESCRIPTOR: Script hex: {}", script_hex);
                        console_log!("DEBUG DESCRIPTOR: Script ASM: {}", script_asm);
                        
                        // Calculate script size
                        let script_size = script_pubkey.len();
                        
                        return Ok(CompileResponse {
                            success: true,
                            error: None,
                            script: Some(script_hex),
                            script_asm: Some(script_asm),
                            address: Some(address.to_string()),
                            script_size: Some(script_size),
                            miniscript_type: Some("Taproot".to_string()),
                            compiled_miniscript: Some(descriptor_str),
                            max_satisfaction_size,
                            max_weight_to_satisfy,
                            sanity_check: Some(true),
                            is_non_malleable: Some(true),
                        });
                    }
                    Err(_e) => {
                        console_log!("Failed to parse tr() descriptor with tree notation: {}", _e);
                        // Fall back to original single-leaf approach
                    }
                }
            }
            
            // Original single-leaf approach (no OR transformation)
            console_log!("Using single-leaf approach");
            
            // Create the tree with the miniscript (clone to avoid move)
            let tree = TapTree::Leaf(Arc::new(ms.clone()));
            console_log!("DEBUG DESCRIPTOR: Created TapTree leaf");
            
            // Create descriptor using Descriptor::new_tr() approach (the correct way!)
            match Descriptor::<XOnlyPublicKey>::new_tr(nums_xonly_key, Some(tree)) {
                Ok(descriptor) => {
                    console_log!("DEBUG DESCRIPTOR: Successfully created descriptor: {}", descriptor);
                    
                    // Generate address from descriptor
                    match descriptor.address(network) {
                        Ok(address) => {
                            console_log!("DEBUG DESCRIPTOR: Generated address: {}", address);
                            
                            // Get the scriptPubKey (OP_1 + 32-byte tweaked key)
                            let script_pubkey = address.script_pubkey();
                            let script_hex = script_pubkey.to_hex_string();
                            let script_asm = format!("{:?}", script_pubkey).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script_pubkey.len();
                            
                            console_log!("DEBUG DESCRIPTOR: Script hex: {}", script_hex);
                            console_log!("DEBUG DESCRIPTOR: Script ASM: {}", script_asm);
                            
                            Ok(CompileResponse {
                                success: true,
                                error: None,
                                script: Some(script_hex),
                                script_asm: Some(script_asm),
                                address: Some(address.to_string()),
                                script_size: Some(script_size),
                                miniscript_type: Some("Taproot".to_string()),
                                compiled_miniscript: Some(descriptor.to_string()),
                                max_satisfaction_size,
                                max_weight_to_satisfy,
                                sanity_check: Some(true),
                                is_non_malleable: Some(true),
                            })
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
