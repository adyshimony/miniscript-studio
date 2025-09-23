//! Processor implementation

use std::collections::HashMap;
use regex::Regex;
use bitcoin::bip32::{DerivationPath, Fingerprint};
use std::str::FromStr;
use crate::descriptors::types::{DescriptorPatterns, DescriptorInfo, ParsedDescriptor};
use crate::descriptors::utils::{parse_fingerprint, parse_derivation_path, parse_xpub, parse_child_paths};
use crate::console_log;

// Helper function to process a single pattern type
fn process_pattern<F>(
    expression: &str,
    pattern: &Regex,
    descriptors: &mut HashMap<String, ParsedDescriptor>,
    info_creator: F
) -> Result<(), String>
where
    F: Fn(&regex::Captures) -> Result<DescriptorInfo, String>
{
    for caps in pattern.captures_iter(expression) {
        let descriptor_str = caps.get(0).unwrap().as_str();

        // Skip if already processed by a higher priority pattern
        if descriptors.contains_key(descriptor_str) {
            continue;
        }

        let info = info_creator(&caps)?;
        descriptors.insert(
            descriptor_str.to_string(),
            ParsedDescriptor {
                original: descriptor_str.to_string(),
                info,
            }
        );
    }
    Ok(())
}

/// Comprehensive descriptor processing for all patterns
pub fn process_comprehensive_descriptors(
    expression: &str,
    patterns: &DescriptorPatterns,
    descriptors: &mut HashMap<String, ParsedDescriptor>
) -> Result<(), String> {
    // Process all pattern types systematically

    // 1. Multipath patterns (highest priority - most specific)
    process_pattern(expression, &patterns.full_multipath, descriptors, |caps| {
        let fingerprint = parse_fingerprint(caps.get(1).unwrap().as_str())?;
        let derivation_path = parse_derivation_path(caps.get(2).unwrap().as_str())?;
        let xpub = parse_xpub(caps.get(3).unwrap().as_str())?;
        let child_paths = parse_child_paths(Some(caps.get(4).unwrap().as_str()))?;
        Ok(DescriptorInfo {
            fingerprint,
            derivation_path,
            xpub,
            child_paths,
            is_wildcard: true,
        })
    })?;

    process_pattern(expression, &patterns.bare_multipath, descriptors, |caps| {
        let xpub = parse_xpub(caps.get(1).unwrap().as_str())?;
        let child_paths = parse_child_paths(Some(caps.get(2).unwrap().as_str()))?;
        Ok(DescriptorInfo {
            fingerprint: Fingerprint::from([0, 0, 0, 0]),
            derivation_path: DerivationPath::from_str("m").unwrap(),
            xpub,
            child_paths,
            is_wildcard: true,
        })
    })?;

    // 2. Double wildcard patterns
    process_pattern(expression, &patterns.full_wildcard_double, descriptors, |caps| {
        let fingerprint = parse_fingerprint(caps.get(1).unwrap().as_str())?;
        let derivation_path = parse_derivation_path(caps.get(2).unwrap().as_str())?;
        let xpub = parse_xpub(caps.get(3).unwrap().as_str())?;
        Ok(DescriptorInfo {
            fingerprint,
            derivation_path,
            xpub,
            child_paths: vec![], // Double wildcard
            is_wildcard: true,
        })
    })?;

    process_pattern(expression, &patterns.bare_wildcard_double, descriptors, |caps| {
        let xpub = parse_xpub(caps.get(1).unwrap().as_str())?;
        Ok(DescriptorInfo {
            fingerprint: Fingerprint::from([0, 0, 0, 0]),
            derivation_path: DerivationPath::from_str("m").unwrap(),
            xpub,
            child_paths: vec![], // Double wildcard
            is_wildcard: true,
        })
    })?;

    // 3. Fixed wildcard patterns
    process_pattern(expression, &patterns.full_fixed_wildcard, descriptors, |caps| {
        let fingerprint = parse_fingerprint(caps.get(1).unwrap().as_str())?;
        let derivation_path = parse_derivation_path(caps.get(2).unwrap().as_str())?;
        let xpub = parse_xpub(caps.get(3).unwrap().as_str())?;
        let first_deriv = caps.get(4).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid derivation index")?;
        Ok(DescriptorInfo {
            fingerprint,
            derivation_path,
            xpub,
            child_paths: vec![first_deriv],
            is_wildcard: true,
        })
    })?;

    process_pattern(expression, &patterns.bare_fixed_wildcard, descriptors, |caps| {
        let first_deriv = caps.get(2).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid derivation index")?;
        Ok(DescriptorInfo {
            fingerprint: Fingerprint::from([0, 0, 0, 0]),
            derivation_path: DerivationPath::from_str("m").unwrap(),
            xpub: parse_xpub(caps.get(1).unwrap().as_str())?,
            child_paths: vec![first_deriv],
            is_wildcard: true,
        })
    })?;

    // 4. Wildcard fixed patterns
    process_pattern(expression, &patterns.full_wildcard_fixed, descriptors, |caps| {
        let fingerprint = parse_fingerprint(caps.get(1).unwrap().as_str())?;
        let derivation_path = parse_derivation_path(caps.get(2).unwrap().as_str())?;
        let xpub = parse_xpub(caps.get(3).unwrap().as_str())?;
        let second_deriv = caps.get(4).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid second derivation index")?;
        Ok(DescriptorInfo {
            fingerprint,
            derivation_path,
            xpub,
            child_paths: vec![u32::MAX, second_deriv], // Use MAX to indicate wildcard in first position
            is_wildcard: true,
        })
    })?;

    process_pattern(expression, &patterns.bare_wildcard_fixed, descriptors, |caps| {
        let second_deriv = caps.get(2).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid second derivation index")?;
        Ok(DescriptorInfo {
            fingerprint: Fingerprint::from([0, 0, 0, 0]),
            derivation_path: DerivationPath::from_str("m").unwrap(),
            xpub: parse_xpub(caps.get(1).unwrap().as_str())?,
            child_paths: vec![u32::MAX, second_deriv], // Use MAX to indicate wildcard
            is_wildcard: true,
        })
    })?;

    // 5. Single wildcard patterns
    process_pattern(expression, &patterns.full_wildcard_single, descriptors, |caps| {
        let fingerprint = parse_fingerprint(caps.get(1).unwrap().as_str())?;
        let derivation_path = parse_derivation_path(caps.get(2).unwrap().as_str())?;
        let xpub = parse_xpub(caps.get(3).unwrap().as_str())?;
        Ok(DescriptorInfo {
            fingerprint,
            derivation_path,
            xpub,
            child_paths: vec![],
            is_wildcard: true,
        })
    })?;

    process_pattern(expression, &patterns.bare_wildcard_single, descriptors, |caps| {
        let xpub = parse_xpub(caps.get(1).unwrap().as_str())?;
        Ok(DescriptorInfo {
            fingerprint: Fingerprint::from([0, 0, 0, 0]),
            derivation_path: DerivationPath::from_str("m").unwrap(),
            xpub,
            child_paths: vec![],
            is_wildcard: true,
        })
    })?;

    // 6. Fixed double patterns
    process_pattern(expression, &patterns.full_fixed_double, descriptors, |caps| {
        let fingerprint = parse_fingerprint(caps.get(1).unwrap().as_str())?;
        let derivation_path = parse_derivation_path(caps.get(2).unwrap().as_str())?;
        let xpub = parse_xpub(caps.get(3).unwrap().as_str())?;
        let first_deriv = caps.get(4).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid first derivation index")?;
        let second_deriv = caps.get(5).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid second derivation index")?;
        Ok(DescriptorInfo {
            fingerprint,
            derivation_path,
            xpub,
            child_paths: vec![first_deriv, second_deriv],
            is_wildcard: false,
        })
    })?;

    process_pattern(expression, &patterns.bare_fixed_double, descriptors, |caps| {
        let first_deriv = caps.get(2).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid first derivation index")?;
        let second_deriv = caps.get(3).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid second derivation index")?;
        Ok(DescriptorInfo {
            fingerprint: Fingerprint::from([0, 0, 0, 0]),
            derivation_path: DerivationPath::from_str("m").unwrap(),
            xpub: parse_xpub(caps.get(1).unwrap().as_str())?,
            child_paths: vec![first_deriv, second_deriv],
            is_wildcard: false,
        })
    })?;

    // 7. Fixed single patterns
    process_pattern(expression, &patterns.full_fixed_single, descriptors, |caps| {
        let fingerprint = parse_fingerprint(caps.get(1).unwrap().as_str())?;
        let derivation_path = parse_derivation_path(caps.get(2).unwrap().as_str())?;
        let xpub = parse_xpub(caps.get(3).unwrap().as_str())?;
        let first_deriv = caps.get(4).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid derivation index")?;
        Ok(DescriptorInfo {
            fingerprint,
            derivation_path,
            xpub,
            child_paths: vec![first_deriv],
            is_wildcard: false,
        })
    })?;

    process_pattern(expression, &patterns.bare_fixed_single, descriptors, |caps| {
        let first_deriv = caps.get(2).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid derivation index")?;
        Ok(DescriptorInfo {
            fingerprint: Fingerprint::from([0, 0, 0, 0]),
            derivation_path: DerivationPath::from_str("m").unwrap(),
            xpub: parse_xpub(caps.get(1).unwrap().as_str())?,
            child_paths: vec![first_deriv],
            is_wildcard: false,
        })
    })?;

    Ok(())
}

/// Process expression descriptors
pub fn process_expression_descriptors(expression: &str) -> Result<String, String> {
    console_log!("Detected descriptor keys in expression, processing...");
    
    match crate::descriptors::parse_descriptors(expression) {
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
                    match crate::descriptors::utils::replace_descriptors_with_keys(expression, &descriptors) {
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