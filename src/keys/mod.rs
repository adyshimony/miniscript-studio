//! Key extraction and processing utilities
//! 
//! This module contains functions for extracting and processing various types of keys
//! from miniscript expressions and scripts.

use bitcoin::XOnlyPublicKey;
use crate::console_log;
use crate::NUMS_POINT;

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
            let extracted_key = key_match.as_str().to_string();
            console_log!("DEBUG: Extracted key from pk(): {}", extracted_key);
            return extracted_key;
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
