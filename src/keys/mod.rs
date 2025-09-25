//! Key extraction and processing utilities
//! 
//! This module contains functions for extracting and processing various types of keys
//! from miniscript expressions and scripts.

use bitcoin::XOnlyPublicKey;
use crate::console_log;
use crate::taproot::utils::NUMS_POINT;
use crate::descriptors::parser::parse_descriptors;
use crate::descriptors::utils::expand_descriptor_xonly;

/// Extract x-only key from miniscript expression
pub fn extract_xonly_key_from_miniscript(miniscript: &str) -> Option<XOnlyPublicKey> {
    // Use regex to find all 64-character hex strings (x-only keys)
    let key_regex = regex::Regex::new(r"\b[a-fA-F0-9]{64}\b").ok()?;
    
    for cap in key_regex.captures_iter(miniscript) {
        if let Some(key_match) = cap.get(0) {
            let key_str = key_match.as_str();
            if let Ok(key_bytes) = hex::decode(key_str) {
                if let Ok(xonly_key) = XOnlyPublicKey::from_slice(&key_bytes) {
                    console_log!("Found x-only key for Taproot address: {}", key_str);
                    return Some(xonly_key);
                }
            }
        }
    }
    
    console_log!("No valid x-only key found in miniscript");
    None
}

/// Extract internal key from expression (same logic as JavaScript)
pub fn extract_internal_key_from_expression(expression: &str) -> String {
    console_log!("DEBUG: Extracting internal key from expression: {}", expression);

    // Match first pk() pattern to extract internal key
    let re = regex::Regex::new(r"pk\(([^)]+)\)").unwrap();
    if let Some(captures) = re.captures(expression) {
        if let Some(key_match) = captures.get(1) {
            let extracted_content = key_match.as_str().to_string();
            console_log!("DEBUG: Extracted content from pk(): {}", extracted_content);

            // Check if the extracted content is a descriptor (contains [ or xpub/tpub)
            if extracted_content.contains('[') || extracted_content.contains("xpub") || extracted_content.contains("tpub") {
                console_log!("DEBUG: Content appears to be a descriptor, processing...");

                // Try to parse and expand the descriptor to get the actual key
                match parse_descriptors(&extracted_content) {
                    Ok(descriptors) => {
                        if let Some((_desc_str, desc_info)) = descriptors.iter().next() {
                            console_log!("DEBUG: Successfully parsed descriptor");
                            match expand_descriptor_xonly(desc_info, 0) {
                                Ok(derived_key) => {
                                    console_log!("DEBUG: Successfully derived x-only key from descriptor: {}", derived_key);
                                    return derived_key;
                                },
                                Err(_e) => {
                                    console_log!("DEBUG: Failed to expand descriptor: {}", _e);
                                }
                            }
                        }
                    },
                    Err(_e) => {
                        console_log!("DEBUG: Failed to parse as descriptor: {}", _e);
                    }
                }

                // If descriptor processing failed, fall back to NUMS point
                console_log!("DEBUG: Descriptor processing failed, using NUMS point");
                return NUMS_POINT.to_string();
            } else {
                // Not a descriptor, return as-is
                console_log!("DEBUG: Content is a regular key, returning as-is");
                return extracted_content;
            }
        }
    }

    // If no pk() found, use NUMS point
    console_log!("DEBUG: No pk() found, using NUMS point");
    NUMS_POINT.to_string()
}

/// Extract x-only key from script hex (for Taproot address generation)
pub fn extract_xonly_key_from_script_hex(script_hex: &str) -> Option<XOnlyPublicKey> {
    // Look for 32-byte key pushes in the script hex
    // Pattern: 20 (OP_PUSHBYTES_32) followed by 64 hex chars (32 bytes)
    let key_regex = regex::Regex::new(r"20([a-fA-F0-9]{64})").ok()?;
    
    for cap in key_regex.captures_iter(script_hex) {
        if let Some(key_match) = cap.get(1) {  // Group 1 is the key without the 20 prefix
            let key_str = key_match.as_str();
            if let Ok(key_bytes) = hex::decode(key_str) {
                if let Ok(xonly_key) = XOnlyPublicKey::from_slice(&key_bytes) {
                    console_log!("Found x-only key in script hex: {}", key_str);
                    return Some(xonly_key);
                }
            }
        }
    }
    
    console_log!("No valid x-only key found in script hex");
    None
}
