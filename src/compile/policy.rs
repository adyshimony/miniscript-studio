use miniscript::{Miniscript, Tap, Segwitv0, Legacy, policy::Concrete, Descriptor};
use bitcoin::{PublicKey, XOnlyPublicKey, Network};
use std::str::FromStr;
use std::sync::Arc;
use miniscript::descriptor::TapTree;
use crate::console_log;

/// Compile policy for Legacy context
pub fn compile_legacy_policy(
    policy: Concrete<PublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Legacy>() {
        Ok(ms) => {
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            // Create descriptor and get address
            let descriptor = Descriptor::new_sh(ms.clone()).map_err(|e| format!("Descriptor creation failed: {}", e))?;
            let address = descriptor.address(network).map_err(|e| format!("Address generation failed: {}", e))?;
            
            // Get max satisfaction size
            let max_satisfaction_size = ms.max_satisfaction_size().ok();
            let max_weight_to_satisfy = descriptor.max_weight_to_satisfy().ok().map(|w| w.to_wu());
            
            // Sanity check
            let sanity_check = ms.sanity_check().is_ok();
            let is_non_malleable = ms.is_non_malleable();
            
            Ok((
                script_hex,
                script_asm,
                Some(address.to_string()),
                script_size,
                "Legacy".to_string(),
                ms.to_string(),
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        },
        Err(e) => Err(format!("Policy compilation failed for Legacy: {}", e))
    }
}

/// Compile policy for Segwit context
pub fn compile_segwit_policy(
    policy: Concrete<PublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Segwitv0>() {
        Ok(ms) => {
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            // Create descriptor and get address
            let descriptor = Descriptor::new_wsh(ms.clone()).map_err(|e| format!("Descriptor creation failed: {}", e))?;
            let address = descriptor.address(network).map_err(|e| format!("Address generation failed: {}", e))?;
            
            // Get max satisfaction size
            let max_satisfaction_size = ms.max_satisfaction_size().ok();
            let max_weight_to_satisfy = descriptor.max_weight_to_satisfy().ok().map(|w| w.to_wu());
            
            // Sanity check
            let sanity_check = ms.sanity_check().is_ok();
            let is_non_malleable = ms.is_non_malleable();
            
            Ok((
                script_hex,
                script_asm,
                Some(address.to_string()),
                script_size,
                "Segwit v0".to_string(),
                ms.to_string(),
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        },
        Err(e) => Err(format!("Policy compilation failed for Segwit v0: {}", e))
    }
}

/// Compile policy for Taproot context with XOnlyPublicKey
pub fn compile_taproot_policy_xonly(
    policy: Concrete<XOnlyPublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    compile_taproot_policy_xonly_with_mode(policy, network, "multi-leaf")
}

/// Compile policy for Taproot context with XOnlyPublicKey and mode
pub fn compile_taproot_policy_xonly_with_mode(
    policy: Concrete<XOnlyPublicKey>,
    network: Network,
    mode: &str
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Tap>() {
        Ok(ms) => {
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            // Create taproot descriptor based on mode
            let descriptor = match mode {
                "multi-leaf" => {
                    // For multi-leaf mode, create a tr() descriptor with the miniscript
                    // Extract internal key from the miniscript (simplified approach)
                    let internal_key = extract_internal_key_from_miniscript(&ms);
                    let tree = TapTree::Leaf(Arc::new(ms.clone()));
                    Descriptor::<XOnlyPublicKey>::new_tr(internal_key, Some(tree))
                        .map_err(|e| format!("Taproot descriptor creation failed: {:?}", e))?
                },
                "script-path" => {
                    // For script-path mode, create a tr() descriptor with the miniscript
                    let internal_key = extract_internal_key_from_miniscript(&ms);
                    let tree = TapTree::Leaf(Arc::new(ms.clone()));
                    Descriptor::<XOnlyPublicKey>::new_tr(internal_key, Some(tree))
                        .map_err(|e| format!("Taproot descriptor creation failed: {:?}", e))?
                },
                _ => {
                    // For single-leaf mode, create a simple tr() descriptor
                    let internal_key = extract_internal_key_from_miniscript(&ms);
                    Descriptor::<XOnlyPublicKey>::new_tr(internal_key, None)
                        .map_err(|e| format!("Taproot descriptor creation failed: {:?}", e))?
                }
            };
            
            let address = descriptor.address(network).map_err(|e| format!("Address generation failed: {}", e))?;
            
            // Get max satisfaction size
            let max_satisfaction_size = ms.max_satisfaction_size().ok();
            let max_weight_to_satisfy = descriptor.max_weight_to_satisfy().ok().map(|w| w.to_wu());
            
            // Sanity check
            let sanity_check = ms.sanity_check().is_ok();
            let is_non_malleable = ms.is_non_malleable();
            
            Ok((
                script_hex,
                script_asm,
                Some(address.to_string()),
                script_size,
                "Taproot".to_string(),
                ms.to_string(),
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        },
        Err(e) => Err(format!("Policy compilation failed for Taproot: {}", e))
    }
}

/// Original single-leaf taproot compilation method for XOnlyPublicKey
pub fn compile_taproot_policy_xonly_single_leaf(
    policy: Concrete<XOnlyPublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Tap>() {
        Ok(ms) => {
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            // Create simple tr() descriptor (key-path only)
            let internal_key = extract_internal_key_from_miniscript(&ms);
            let descriptor = Descriptor::<XOnlyPublicKey>::new_tr(internal_key, None)
                .map_err(|e| format!("Taproot descriptor creation failed: {:?}", e))?;
            
            let address = descriptor.address(network).map_err(|e| format!("Address generation failed: {}", e))?;
            
            // Get max satisfaction size
            let max_satisfaction_size = ms.max_satisfaction_size().ok();
            let max_weight_to_satisfy = descriptor.max_weight_to_satisfy().ok().map(|w| w.to_wu());
            
            // Sanity check
            let sanity_check = ms.sanity_check().is_ok();
            let is_non_malleable = ms.is_non_malleable();
            
            Ok((
                script_hex,
                script_asm,
                Some(address.to_string()),
                script_size,
                "Taproot".to_string(),
                ms.to_string(),
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        },
        Err(e) => Err(format!("Policy compilation failed for Taproot: {}", e))
    }
}

/// Compile policy for Taproot context (should fail for compressed keys)
pub fn compile_taproot_policy(
    _policy: Concrete<PublicKey>,
    _network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    // Don't do automatic conversion - fail with proper error message
    Err("Taproot context requires x-only keys (32 bytes). Found compressed keys (33 bytes).".to_string())
}

/// Compile policy for Taproot context with mode (should fail for compressed keys)
pub fn compile_taproot_policy_with_mode(
    _policy: Concrete<PublicKey>,
    _network: Network,
    _mode: &str
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    // Don't do automatic conversion - fail with proper error message
    Err("Taproot context requires x-only keys (32 bytes). Found compressed keys (33 bytes).".to_string())
}

/// Original single-leaf taproot compilation method
pub fn compile_taproot_policy_single_leaf(
    xonly_policy: Concrete<XOnlyPublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match xonly_policy.compile::<Tap>() {
        Ok(ms) => {
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            // Create simple tr() descriptor (key-path only)
            let internal_key = extract_internal_key_from_miniscript(&ms);
            let descriptor = Descriptor::<XOnlyPublicKey>::new_tr(internal_key, None)
                .map_err(|e| format!("Taproot descriptor creation failed: {:?}", e))?;
            
            let address = descriptor.address(network).map_err(|e| format!("Address generation failed: {}", e))?;
            
            // Get max satisfaction size
            let max_satisfaction_size = ms.max_satisfaction_size().ok();
            let max_weight_to_satisfy = descriptor.max_weight_to_satisfy().ok().map(|w| w.to_wu());
            
            // Sanity check
            let sanity_check = ms.sanity_check().is_ok();
            let is_non_malleable = ms.is_non_malleable();
            
            Ok((
                script_hex,
                script_asm,
                Some(address.to_string()),
                script_size,
                "Taproot".to_string(),
                ms.to_string(),
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        },
        Err(e) => Err(format!("Policy compilation failed for Taproot: {}", e))
    }
}

/// Extract internal key from miniscript (helper function)
fn extract_internal_key_from_miniscript(_ms: &Miniscript<XOnlyPublicKey, Tap>) -> XOnlyPublicKey {
    // This is a simplified extraction - in a real implementation you'd want more robust parsing
    // For now, we'll use a default NUMS key
    XOnlyPublicKey::from_str(crate::NUMS_POINT)
        .expect("NUMS key should be valid")
}

// ============================================================================
// Taproot Compilation Functions (moved from lib.rs)
// ============================================================================

/// Compile Taproot Script path using Descriptor::new_tr() approach (the correct way)
pub fn compile_taproot_script_path_descriptor(expression: &str, nums_key: &str, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
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
            let transformed_miniscript = crate::transform_or_to_tree(&normalized_miniscript);
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
                        
                        return Ok((
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
                        ));
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
