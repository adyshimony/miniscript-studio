//! Validation utilities for miniscript expressions
//! 
//! This module contains functions for validating miniscript expressions
//! in different script contexts (Legacy, Segwit v0, Taproot).

use miniscript::{Miniscript, Legacy, Segwitv0, Tap, DescriptorPublicKey, Descriptor, ScriptContext};
use std::str::FromStr;

/// Validate inner miniscript for a specific context
pub fn validate_inner_miniscript(inner_miniscript: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    let validation_result = match context {
        "legacy" => validate_miniscript::<Legacy>(inner_miniscript),
        "taproot" => validate_miniscript::<Tap>(inner_miniscript),
        _ => validate_miniscript::<Segwitv0>(inner_miniscript),
    };
    
    match validation_result {
        Ok(desc_str) => Ok((
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
        )),
        Err(e) => Err(format!("Miniscript parsing failed: {}", e))
    }
}

/// Validate miniscript for a specific context
pub fn validate_miniscript<Ctx>(inner_miniscript: &str) -> Result<String, String>
where
    Ctx: ScriptContext,
    Miniscript<DescriptorPublicKey, Ctx>: FromStr,
    <Miniscript<DescriptorPublicKey, Ctx> as FromStr>::Err: std::fmt::Display,
{
    match inner_miniscript.parse::<Miniscript<DescriptorPublicKey, Ctx>>() {
        Ok(ms) => {
            let full_descriptor = format!("wsh({})", ms);
            match Descriptor::<DescriptorPublicKey>::from_str(&full_descriptor) {
                Ok(descriptor) => Ok(descriptor.to_string()),
                Err(e) => Err(format!("Descriptor validation failed: {}", e))
            }
        },
        Err(e) => Err(e.to_string())
    }
}
