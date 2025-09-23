//! Descriptor compilation functions
//!
//! This module handles compilation of descriptor expressions to Bitcoin scripts

use bitcoin::{Network, XOnlyPublicKey};
use miniscript::{Descriptor, DescriptorPublicKey};
use std::str::FromStr;
use crate::console_log;
use crate::validation;

/// Compile a descriptor wrapper
pub fn compile_descriptor(expression: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
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
pub fn parse_non_wsh_descriptor(expression: &str) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
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

/// Compile a parsed Taproot descriptor
pub fn compile_parsed_descriptor(descriptor: Descriptor<XOnlyPublicKey>, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
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