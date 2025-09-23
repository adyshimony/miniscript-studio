//! Utility functions

use bitcoin::bip32::{Xpub, DerivationPath, Fingerprint, ChildNumber};
use bitcoin::secp256k1::Secp256k1;
use std::str::FromStr;
use std::collections::HashMap;
use crate::descriptors::types::ParsedDescriptor;
use crate::console_log;

/// Parse fingerprint from hex string
pub fn parse_fingerprint(hex_str: &str) -> Result<Fingerprint, String> {
    let bytes = hex::decode(hex_str)
        .map_err(|e| format!("Invalid fingerprint hex: {}", e))?;
    
    if bytes.len() != 4 {
        return Err("Fingerprint must be 4 bytes".to_string());
    }
    
    let mut fp_array = [0u8; 4];
    fp_array.copy_from_slice(&bytes);
    Ok(Fingerprint::from(fp_array))
}

/// Parse derivation path from string
pub fn parse_derivation_path(path_str: &str) -> Result<DerivationPath, String> {
    let normalized_path = path_str.replace("h", "'");
    
    DerivationPath::from_str(&normalized_path)
        .map_err(|e| format!("Invalid derivation path: {}", e))
}

/// Parse extended public key
pub fn parse_xpub(xpub_str: &str) -> Result<Xpub, String> {
    Xpub::from_str(xpub_str)
        .map_err(|e| format!("Invalid xpub: {}", e))
}

/// Parse child paths from range notation
pub fn parse_child_paths(range_str: Option<&str>) -> Result<Vec<u32>, String> {
    match range_str {
        Some(range) => {
            range.split(';')
                .map(|s| s.parse::<u32>()
                    .map_err(|_| format!("Invalid child path: {}", s)))
                .collect()
        },
        None => Ok(vec![]),
    }
}

/// Expand a descriptor at a specific child index
pub fn expand_descriptor(descriptor: &ParsedDescriptor, child_index: u32) -> Result<String, String> {
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
                    .map_err(|e| format!("Single wildcard derivation failed: {}", e))?
            },
            1 => {
                // Fixed wildcard: xpub/0/*
                let first_child = ChildNumber::from_normal_idx(descriptor.info.child_paths[0])
                    .map_err(|e| format!("Invalid first child number: {}", e))?;
                let second_child = ChildNumber::from_normal_idx(child_index)
                    .map_err(|e| format!("Invalid child index: {}", e))?;

                console_log!("Fixed wildcard derivation: {}/{}", descriptor.info.child_paths[0], child_index);
                descriptor.info.xpub
                    .derive_pub(&secp, &[first_child, second_child])
                    .map_err(|e| format!("Fixed wildcard derivation failed: {}", e))?
            },
            2 => {
                // Wildcard fixed: xpub/*/0 or double wildcard: xpub/*/*
                if descriptor.info.child_paths[0] == u32::MAX {
                    // Wildcard fixed: xpub/*/0
                    let first_child = ChildNumber::from_normal_idx(child_index)
                        .map_err(|e| format!("Invalid child index: {}", e))?;
                    let second_child = ChildNumber::from_normal_idx(descriptor.info.child_paths[1])
                        .map_err(|e| format!("Invalid second child number: {}", e))?;

                    console_log!("Wildcard fixed derivation: {}/{}", child_index, descriptor.info.child_paths[1]);
                    descriptor.info.xpub
                        .derive_pub(&secp, &[first_child, second_child])
                        .map_err(|e| format!("Wildcard fixed derivation failed: {}", e))?
                } else {
                    // Double wildcard: xpub/*/*
                    let first_child = ChildNumber::from_normal_idx(child_index)
                        .map_err(|e| format!("Invalid child index: {}", e))?;
                    let second_child = ChildNumber::from_normal_idx(child_index)
                        .map_err(|e| format!("Invalid child index: {}", e))?;

                    console_log!("Double wildcard derivation: {}/{}", child_index, child_index);
                    descriptor.info.xpub
                        .derive_pub(&secp, &[first_child, second_child])
                        .map_err(|e| format!("Double wildcard derivation failed: {}", e))?
                }
            },
            _ => return Err("Unsupported wildcard derivation path length".to_string()),
        }
    };
    
    // Get the public key and return as hex string
    let pubkey = final_xpub.public_key;
    let hex_key = hex::encode(pubkey.serialize());
    console_log!("Derived key for descriptor: {}", hex_key);
    Ok(hex_key)
}

/// Replace descriptors in expression with concrete keys
pub fn replace_descriptors_with_keys(expression: &str, descriptors: &HashMap<String, ParsedDescriptor>) -> Result<String, String> {
    let mut result = expression.to_string();
    
    // Sort descriptors by length (longest first) to prevent substring conflicts
    let mut sorted_descriptors: Vec<_> = descriptors.iter().collect();
    sorted_descriptors.sort_by_key(|(descriptor_str, _)| std::cmp::Reverse(descriptor_str.len()));
    
    for (descriptor_str, descriptor_info) in sorted_descriptors {
        // For wildcard descriptors, we need to expand them at a specific index
        let replacement = if descriptor_info.info.is_wildcard {
            // Use index 0 for wildcard expansion
            expand_descriptor(descriptor_info, 0)?
        } else {
            // For fixed descriptors, expand directly
            expand_descriptor(descriptor_info, 0)?
        };
        
        result = result.replace(descriptor_str, &replacement);
    }
    
    console_log!("Final processed expression: {}", result);
    Ok(result)
}