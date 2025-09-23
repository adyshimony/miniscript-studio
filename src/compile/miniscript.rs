//! Miniscript implementation

use miniscript::{Miniscript, Tap, Segwitv0, Legacy, Descriptor};
use miniscript::descriptor::TapTree;
use bitcoin::{PublicKey, XOnlyPublicKey, Network, Address, secp256k1::Secp256k1, taproot::TaprootBuilder};
use std::str::FromStr;
use std::sync::Arc;
use crate::console_log;
use crate::taproot::utils::get_taproot_nums_point;
use crate::NUMS_POINT;
use crate::descriptors::compiler::compile_parsed_descriptor;


/// Compile Legacy context miniscript
pub fn compile_legacy_miniscript(expression: &str, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    match expression.parse::<Miniscript<PublicKey, Legacy>>() {
        Ok(ms) => {
            let normalized_miniscript = ms.to_string();
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            // Calculate weight using descriptor
            console_log!("Creating Legacy descriptor for weight calculation");
            let desc = Descriptor::new_sh(ms.clone())
                .map_err(|e| format!("Descriptor creation failed: {}", e))?;
            let max_weight = desc.max_weight_to_satisfy()
                .map_err(|e| format!("Weight calculation failed: {}", e))?;
            
            console_log!("Legacy max_weight_to_satisfy: {} WU", max_weight.to_wu());
            
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
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable),
                Some(normalized_miniscript)
            ))
        }
        Err(e) => {
            let error_msg = format!("{}", e);
            if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                Err(format!("Legacy parsing failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Legacy requires compressed public keys (66 characters).", e))
            } else {
                Err(format!("Legacy parsing failed: {}", e))
            }
        }
    }
}

/// Compile Segwit v0 context miniscript
pub fn compile_segwit_miniscript(expression: &str, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    match expression.parse::<Miniscript<PublicKey, Segwitv0>>() {
        Ok(ms) => {
            let normalized_miniscript = ms.to_string();
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            // Calculate weight using descriptor
            console_log!("Creating Segwit descriptor for direct miniscript weight calculation");
            let desc = Descriptor::new_wsh(ms.clone())
                .map_err(|e| format!("Descriptor creation failed: {}", e))?;
            let total_weight = desc.max_weight_to_satisfy()
                .map_err(|e| format!("Weight calculation failed: {}", e))?;
            
            console_log!("Direct Segwit total max_weight_to_satisfy: {} WU", total_weight.to_wu());
            
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
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable),
                Some(normalized_miniscript)
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

/// Compile miniscript for single-leaf taproot (shows raw script, not taproot address)
pub fn compile_taproot_miniscript_raw(expression: &str) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("=== COMPILE_TAPROOT_MINISCRIPT_RAW ===");
    console_log!("Expression: {}", expression);
    
    let network = Network::Bitcoin;
    let processed_expr = expression.trim();
    
    // Parse as XOnlyPublicKey miniscript for Taproot
    match processed_expr.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        Ok(ms) => {
            let normalized_miniscript = ms.to_string();
            console_log!("Parsed miniscript: {}", normalized_miniscript);
            
            // Get the raw script (this is what we want for single-leaf mode)
            let script = ms.encode();
            let script_hex = script.to_hex_string();
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            
            // Calculate script size
            let script_size = script.len();
            
            // For single-leaf mode, we still generate the same taproot address
            // but show the raw miniscript script in HEX/ASM
            let nums_point_str = NUMS_POINT;
            let nums_key = match XOnlyPublicKey::from_str(nums_point_str) {
                Ok(key) => key,
                Err(_) => return Err("Failed to parse NUMS point".to_string())
            };
            
            // Create taproot address (same as multi-leaf for address consistency)
            let secp = Secp256k1::verification_only();
            match TaprootBuilder::new().add_leaf(0, script.clone()) {
                Ok(builder) => {
                    match builder.finalize(&secp, nums_key) {
                        Ok(spend_info) => {
                            let output_key = spend_info.output_key();
                            let address = Address::p2tr(&secp, output_key.to_x_only_public_key(), None, network);
                            
                            // Calculate weight info based on raw script
                            let max_satisfaction_size = ms.max_satisfaction_size().ok();
                            let max_weight_to_satisfy = ms.max_satisfaction_witness_elements().ok().map(|w| w as u64);
                            
                            console_log!("Single-leaf taproot compilation successful");
                            console_log!("Raw script hex: {}", script_hex);
                            console_log!("Address: {}", address);
                            
                            Ok((
                                script_hex,           // Raw miniscript HEX (not taproot address)
                                script_asm,          // Raw miniscript ASM (not taproot address)  
                                Some(address.to_string()),
                                script_size,
                                "Taproot".to_string(),
                                max_satisfaction_size,
                                max_weight_to_satisfy,
                                Some(true), // sanity_check
                                Some(true), // is_non_malleable  
                                {
                                    let nums_point_str = NUMS_POINT;
                                    let tr_descriptor_str = format!("tr({},{})", nums_point_str, normalized_miniscript);
                                    match tr_descriptor_str.parse::<Descriptor<XOnlyPublicKey>>() {
                                        Ok(descriptor) => Some(descriptor.to_string()),
                                        Err(_) => Some(tr_descriptor_str)
                                    }
                                }
                            ))
                        },
                        Err(e) => Err(format!("TapTree finalization failed: {:?}", e))
                    }
                },
                Err(e) => Err(format!("TapTree creation failed: {:?}", e))
            }
        },
        Err(e) => Err(format!("Miniscript parsing failed: {}", e))
    }
}

/// Compile miniscript for multi-leaf taproot (using TapTree optimization)
pub fn compile_taproot_miniscript_multiline(expression: &str, internal_key: Option<&str>) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("=== COMPILE_TAPROOT_MINISCRIPT_MULTILINE ===");
    console_log!("Expression: {}", expression);
    
    let network = Network::Bitcoin;
    let processed_expr = expression.trim();
    
    // Parse as XOnlyPublicKey miniscript for Taproot
    match processed_expr.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        Ok(ms) => {
            let normalized_miniscript = ms.to_string();
            console_log!("Parsed miniscript: {}", normalized_miniscript);
            
            // Use provided internal key or extract from expression
            let internal_key_name = match internal_key {
                Some(key) => {
                    console_log!("DEBUG MULTILINE: Using provided internal key: {}", key);
                    key.to_string()
                },
                None => {
                    let extracted = crate::keys::extract_internal_key_from_expression(expression);
                    console_log!("DEBUG MULTILINE: Extracted internal key from expression: {}", extracted);
                    extracted
                }
            };
            
            let internal_key = if internal_key_name == NUMS_POINT {
                console_log!("DEBUG MULTILINE: Using NUMS point as internal key");
                get_taproot_nums_point()
            } else if let Ok(key_bytes) = hex::decode(&internal_key_name) {
                console_log!("DEBUG MULTILINE: Trying to decode hex key: {} (length: {})", internal_key_name, key_bytes.len());
                if key_bytes.len() == 32 {
                    if let Ok(xonly_key) = XOnlyPublicKey::from_slice(&key_bytes) {
                        console_log!("DEBUG MULTILINE: Successfully created XOnlyPublicKey from hex");
                        xonly_key
                    } else {
                        console_log!("DEBUG MULTILINE: Failed to create XOnlyPublicKey from slice, using NUMS");
                        get_taproot_nums_point()
                    }
                } else {
                    console_log!("DEBUG MULTILINE: Key bytes length is not 32 ({}), using NUMS", key_bytes.len());
                    get_taproot_nums_point()
                }
            } else {
                console_log!("DEBUG MULTILINE: Failed to decode hex key: {}, using NUMS", internal_key_name);
                get_taproot_nums_point()
            };
            
            // Create TapTree with the miniscript
            let secp = Secp256k1::verification_only();
            match TaprootBuilder::new().add_leaf(0, ms.encode()) {
                Ok(builder) => {
                    match builder.finalize(&secp, internal_key) {
                        Ok(spend_info) => {
                            // Get the output key for address
                            let output_key = spend_info.output_key();
                            let address = Address::p2tr(&secp, output_key.to_x_only_public_key(), None, network);
                            
                            // Build the scriptPubKey (OP_1 + 32-byte key)
                            let script_pubkey = address.script_pubkey();
                            let script_hex = script_pubkey.to_hex_string();
                            let script_asm = format!("{:?}", script_pubkey).replace("Script(", "").trim_end_matches(')').to_string();
                            
                            // Calculate script size and weight
                            let script_size = script_pubkey.len();
                            let max_satisfaction_size = Some(200); // Estimated satisfaction size for taproot
                            let max_weight_to_satisfy = Some(script_size as u64 * 4 + 244); // Script weight + input weight
                            
                            console_log!("Multi-leaf taproot compilation successful");
                            console_log!("Script hex: {}", script_hex);
                            console_log!("Address: {}", address);
                            
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
                                {
                                    let tr_descriptor_str = format!("tr({},{})", internal_key_name, normalized_miniscript);
                                    console_log!("DEBUG MULTILINE: Generated descriptor: {}", tr_descriptor_str);
                                    match tr_descriptor_str.parse::<Descriptor<XOnlyPublicKey>>() {
                                        Ok(descriptor) => Some(descriptor.to_string()),
                                        Err(_) => Some(tr_descriptor_str)
                                    }
                                }
                            ))
                        },
                        Err(e) => Err(format!("TapTree finalization failed: {:?}", e))
                    }
                },
                Err(e) => Err(format!("TapTree creation failed: {:?}", e))
            }
        },
        Err(e) => Err(format!("Miniscript parsing failed: {}", e))
    }
}
/// Compile Taproot context miniscript
pub fn compile_taproot_miniscript(expression: &str, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    // New approach: wrap miniscript in tr() descriptor with extracted internal key
    console_log!("Compiling Taproot miniscript using tr() descriptor approach");
    console_log!("Original expression: {}", expression);
    
    // First validate that we can parse the miniscript
    match expression.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        Ok(ms) => {
            let normalized_miniscript = ms.to_string();
            console_log!("Normalized miniscript: {}", normalized_miniscript);
            
            // Transform top-level OR patterns to tree notation
            let transformed_miniscript = super::utils::transform_or_to_tree(&normalized_miniscript);
            console_log!("After OR transformation: {}", transformed_miniscript);
            
            // Extract internal key name and resolve to actual key
            let internal_key_name = crate::keys::extract_internal_key_from_expression(expression);
            console_log!("Extracted internal key name: {}", internal_key_name);
            
            // If we transformed an OR pattern, create a new tr() descriptor with tree notation
            // Otherwise use the original approach
            console_log!("Comparing: transformed='{}' vs normalized='{}'", transformed_miniscript, normalized_miniscript);
            if transformed_miniscript != normalized_miniscript {
                // We transformed an OR to tree notation - create a tr() descriptor
                console_log!("OR pattern detected and transformed! Creating tr() descriptor with tree notation");
                
                // Build the tr() descriptor string with tree notation
                let tr_descriptor_str = format!("tr({},{})", internal_key_name, transformed_miniscript);
                console_log!("Attempting to parse descriptor: {}", tr_descriptor_str);
                
                // Parse the descriptor with tree notation
                match tr_descriptor_str.parse::<Descriptor<XOnlyPublicKey>>() {
                    Ok(descriptor) => {
                        console_log!("Successfully parsed tr() descriptor with tree notation");
                        return compile_parsed_descriptor(descriptor, network);
                    }
                    Err(_e) => {
                        console_log!("Failed to parse tr() descriptor with tree notation: {}", _e);
                        // Fall back to original single-leaf approach
                    }
                }
            } else {
                console_log!("No OR transformation applied, using original single-leaf approach");
            }
            
            // Original single-leaf approach (no OR transformation)
            console_log!("Falling back to single-leaf approach");
            // Parse the tree part as miniscript and create TapTree
            match expression.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
                Ok(tree_ms) => {
                    // Create TapTree from the miniscript
                    let tap_tree = TapTree::Leaf(Arc::new(tree_ms));
                    
                    // Resolve internal key name to actual XOnlyPublicKey
                    let internal_key = if internal_key_name == NUMS_POINT {
                        console_log!("DEBUG: Using NUMS point as internal key");
                        get_taproot_nums_point()
                    } else if let Ok(key_bytes) = hex::decode(&internal_key_name) {
                        console_log!("DEBUG: Trying to decode hex key: {} (length: {})", internal_key_name, key_bytes.len());
                        if key_bytes.len() == 32 {
                            if let Ok(xonly_key) = XOnlyPublicKey::from_slice(&key_bytes) {
                                console_log!("DEBUG: Successfully created XOnlyPublicKey from hex");
                                xonly_key
                            } else {
                                console_log!("DEBUG: Failed to create XOnlyPublicKey from slice, using NUMS");
                                get_taproot_nums_point()
                            }
                        } else {
                            console_log!("DEBUG: Key bytes length is not 32 ({}), using NUMS", key_bytes.len());
                            get_taproot_nums_point()
                        }
                    } else {
                        console_log!("DEBUG: Failed to decode hex key: {}, using NUMS", internal_key_name);
                        get_taproot_nums_point()
                    };
                    
                    // Create descriptor using new_tr method
                    match Descriptor::new_tr(internal_key, Some(tap_tree)) {
                Ok(descriptor) => {
                    console_log!("Successfully parsed tr() descriptor");
                    
                    // For taproot, we need the output script (scriptPubKey), not the leaf script
                    // This is OP_1 (0x51) followed by 32 bytes of the taproot output key
                    let script = descriptor.script_pubkey();
                    console_log!("Got taproot output script (scriptPubKey): {} bytes", script.len());
                    
                    // Log the taproot output key from the script for debugging
                    if script.len() == 34 && script.as_bytes()[0] == 0x51 {
                        let _taproot_key = &script.as_bytes()[2..34];
                        console_log!("Taproot output key from script: {}", hex::encode(_taproot_key));
                    }
                    
                    let script_hex = hex::encode(script.as_bytes());
                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                    let script_size = script.len();
                    
                    // Generate address from descriptor
                    let address = descriptor.address(network)
                        .map(|addr| addr.to_string())
                        .ok();
                    
                    // Get satisfaction properties from original miniscript
                    let (max_satisfaction_size, max_weight_to_satisfy) = if normalized_miniscript.starts_with("pk(") {
                        console_log!("Taproot pk() detected, estimating 64 bytes");
                        (Some(64), Some(64u64))
                    } else {
                        console_log!("Taproot complex script, cannot estimate");
                        (None, None)
                    };
                    
                    let sanity_check = ms.sanity_check().is_ok();
                    let is_non_malleable = ms.is_non_malleable();
                    
                    // Build descriptor string with resolved internal key name  
                    let descriptor_string = format!("tr({},{})", internal_key_name, expression);
                    console_log!("Generated Taproot descriptor: {}", descriptor_string);
                    console_log!("Generated Taproot script hex: {}", script_hex);
                    console_log!("Generated Taproot address: {:?}", address);
                    
                    Ok((
                        script_hex,
                        script_asm,
                        address,
                        script_size,
                        "Taproot".to_string(),
                        max_satisfaction_size,
                        max_weight_to_satisfy,
                        Some(sanity_check),
                        Some(is_non_malleable),
                        Some(descriptor_string)
                    ))
                }
                Err(e) => {
                    console_log!("Failed to parse tr() descriptor: {}", e);
                    Err(format!("Failed to create tr() descriptor: {}", e))
                }
            }
                }
                Err(e) => Err(format!("Failed to parse miniscript for TapTree: {}", e))
            }
        }
        Err(e) => {
            let error_msg = format!("{}", e);
            if error_msg.contains("malformed public key") {
                Err(format!("Taproot parsing failed: {}. Note: Taproot requires X-only public keys (64 characters, no 02/03 prefix).", e))
            } else {
                Err(format!("Taproot parsing failed: {}", e))
            }
        }
    }
}
