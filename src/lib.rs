//! Bitcoin Miniscript Compiler
//! 
//! This library provides WebAssembly bindings for compiling Bitcoin policies and miniscripts,
//! lifting Bitcoin scripts back to miniscript/policy representations, and generating addresses.

// Module declarations
mod types;
mod translators;
mod opcodes;
mod utils;

// Re-exports from modules
use types::{CompilationResult, LiftResult, AddressResult, DescriptorInfo, ParsedDescriptor};
use translators::{DescriptorKeyTranslator, XOnlyKeyTranslator, PublicKeyToXOnlyTranslator};
use opcodes::{OPCODE_MAP, parse_asm_to_script};

// External crate imports
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use miniscript::{Miniscript, Tap, Segwitv0, Legacy, policy::Concrete, Descriptor, DescriptorPublicKey, Translator, ToPublicKey, ScriptContext};
use miniscript::policy::Liftable;
use bitcoin::{Address, Network, PublicKey, XOnlyPublicKey, secp256k1::Secp256k1, ScriptBuf};
use bitcoin::blockdata::script::{Builder, PushBytesBuf};
use bitcoin::blockdata::opcodes::all;
use bitcoin::bip32::{Xpub, DerivationPath, Fingerprint, ChildNumber};
use regex::Regex;
use std::str::FromStr;
use std::collections::HashMap;
use lazy_static::lazy_static;


// ============================================================================
// Helper Functions
// ============================================================================

/// Detect the Bitcoin network based on key types in the expression
fn detect_network(expression: &str) -> Network {
    if expression.contains("tpub") {
        Network::Testnet
    } else {
        Network::Bitcoin
    }
}

/// Check if expression needs descriptor processing
fn needs_descriptor_processing(expression: &str) -> bool {
    let trimmed = expression.trim();
    (trimmed.contains("tpub") || trimmed.contains("xpub") || trimmed.contains("[")) 
        && !trimmed.starts_with("wsh(") 
        && !trimmed.starts_with("sh(") 
        && !trimmed.starts_with("wpkh(")
}

/// Check if expression is a descriptor wrapper
fn is_descriptor_wrapper(expression: &str) -> bool {
    expression.starts_with("wsh(") || expression.starts_with("sh(") || expression.starts_with("wpkh(")
}

/// Extract the first x-only key from a miniscript string
fn extract_xonly_key_from_miniscript(miniscript: &str) -> Option<XOnlyPublicKey> {
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

/// Get the Taproot NUMS (Nothing Up My Sleeve) point for unspendable key-path
fn get_taproot_nums_point() -> XOnlyPublicKey {
    // Standard NUMS point used in Taproot when key-path spending should be disabled
    const NUMS_POINT: &str = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";
    
    let nums_bytes = hex::decode(NUMS_POINT).expect("Valid NUMS hex");
    XOnlyPublicKey::from_slice(&nums_bytes).expect("Valid NUMS point")
}

/// Determine the internal key for Taproot address generation
/// For pk(key) uses the key itself, for everything else uses NUMS
fn get_taproot_internal_key(miniscript_str: &str) -> XOnlyPublicKey {
    // Check if this is a simple pk(key) miniscript
    if miniscript_str.starts_with("pk(") && miniscript_str.ends_with(")") {
        // Extract the key from pk(key)
        let key_part = &miniscript_str[3..miniscript_str.len()-1];
        if let Ok(key_bytes) = hex::decode(key_part) {
            if key_bytes.len() == 32 {
                if let Ok(xonly_key) = XOnlyPublicKey::from_slice(&key_bytes) {
                    console_log!("Using pk() key as internal key: {}", key_part);
                    return xonly_key;
                }
            }
        }
    }
    
    // For all other miniscripts, use NUMS point
    console_log!("Using NUMS point as internal key (script-path only)");
    get_taproot_nums_point()
}

/// Extract x-only key from script hex (for Taproot address generation)
fn extract_xonly_key_from_script_hex(script_hex: &str) -> Option<XOnlyPublicKey> {
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

/// Generate a Taproot address with a specific internal key and script
fn generate_taproot_address_with_key(script: &bitcoin::Script, internal_key: XOnlyPublicKey, network: Network) -> Option<String> {
    use bitcoin::taproot::TaprootBuilder;
    
    // For simple pk(key), just use key-path only
    let script_bytes = script.as_bytes();
    if script_bytes.len() == 34 && script_bytes[0] == 0x20 && script_bytes[33] == 0xac {
        // This is a simple pk() script (32-byte key push + OP_CHECKSIG)
        return Some(Address::p2tr(&Secp256k1::verification_only(), internal_key, None, network).to_string());
    }
    
    // For complex scripts, create a taproot tree with the script
    match TaprootBuilder::new()
        .add_leaf(0, script.to_owned())
        .map(|builder| builder.finalize(&Secp256k1::verification_only(), internal_key))
    {
        Ok(Ok(spend_info)) => {
            // Create the P2TR address with both key-path and script-path
            let output_key = spend_info.output_key();
            let address = Address::p2tr(&Secp256k1::verification_only(), output_key.to_x_only_public_key(), None, network);
            Some(address.to_string())
        },
        _ => {
            console_log!("Failed to create Taproot spend info");
            None
        }
    }
}

/// Generate a Taproot address from a script (fallback for complex scripts)
fn generate_taproot_address(_script: &bitcoin::Script, _network: Network) -> Option<String> {
    // This is now only used as a fallback if no x-only key is found
    console_log!("No x-only key found for Taproot address generation");
    None
}

/// Generate a Taproot address using the descriptor approach (correct method)
/// Uses tr(internal_key, taptree) descriptor to generate deterministic address
fn generate_taproot_address_descriptor(
    miniscript: &Miniscript<XOnlyPublicKey, Tap>,
    internal_key: XOnlyPublicKey,
    network: Network
) -> Option<String> {
    use miniscript::descriptor::TapTree;
    use std::sync::Arc;
    
    console_log!("Generating Taproot address using descriptor approach");
    console_log!("Internal key: {}", internal_key);
    console_log!("Miniscript: {}", miniscript);
    
    // Create a TapTree with the miniscript as a leaf
    let taptree = TapTree::Leaf(Arc::new(miniscript.clone()));
    
    // Build the tr() descriptor
    match Descriptor::new_tr(internal_key, Some(taptree)) {
        Ok(descriptor) => {
            // Generate the address from the descriptor
            match descriptor.address(network) {
                Ok(address) => {
                    console_log!("Successfully generated Taproot address: {}", address);
                    Some(address.to_string())
                },
                Err(e) => {
                    console_log!("Failed to generate address from descriptor: {}", e);
                    None
                }
            }
        },
        Err(e) => {
            console_log!("Failed to create tr() descriptor: {}", e);
            None
        }
    }
}

/// OLD VERSION - Generate a Taproot address with a specific internal key and script
/// Keeping this for rollback if needed
fn generate_taproot_address_with_key_old(script: &bitcoin::Script, internal_key: XOnlyPublicKey, network: Network) -> Option<String> {
    use bitcoin::taproot::TaprootBuilder;
    
    // For simple pk(key), just use key-path only
    let script_bytes = script.as_bytes();
    if script_bytes.len() == 34 && script_bytes[0] == 0x20 && script_bytes[33] == 0xac {
        // This is a simple pk() script (32-byte key push + OP_CHECKSIG)
        return Some(Address::p2tr(&Secp256k1::verification_only(), internal_key, None, network).to_string());
    }
    
    // For complex scripts, create a taproot tree with the script
    match TaprootBuilder::new()
        .add_leaf(0, script.to_owned())
        .map(|builder| builder.finalize(&Secp256k1::verification_only(), internal_key))
    {
        Ok(Ok(spend_info)) => {
            // Create the P2TR address with both key-path and script-path
            let output_key = spend_info.output_key();
            let address = Address::p2tr(&Secp256k1::verification_only(), output_key.to_x_only_public_key(), None, network);
            Some(address.to_string())
        },
        _ => {
            console_log!("Failed to create Taproot spend info");
            None
        }
    }
}

// ============================================================================
// Descriptor Parsing
// ============================================================================

/// Parse HD wallet descriptors from miniscript expressions
fn parse_descriptors(expression: &str) -> Result<HashMap<String, ParsedDescriptor>, String> {
    let mut descriptors = HashMap::new();
    
    console_log!("Parsing descriptors from expression of length: {}", expression.len());
    
    // Create regex patterns for different descriptor formats
    let patterns = create_descriptor_regex_patterns()?;
    
    // Process each pattern type
    process_full_descriptors(expression, &patterns.full_descriptor, &mut descriptors)?;
    process_bare_extended_keys(expression, &patterns.bare_extended, &mut descriptors)?;
    process_single_derivation_keys(expression, &patterns.single_deriv, &mut descriptors)?;
    process_fixed_double_derivation(expression, &patterns.full_fixed_double, &patterns.fixed_double, &mut descriptors)?;
    
    console_log!("Found {} descriptors total", descriptors.len());
    Ok(descriptors)
}

/// Container for descriptor regex patterns
struct DescriptorPatterns {
    full_descriptor: Regex,
    bare_extended: Regex,
    single_deriv: Regex,
    full_fixed_double: Regex,
    fixed_double: Regex,
}

/// Create regex patterns for descriptor parsing
fn create_descriptor_regex_patterns() -> Result<DescriptorPatterns, String> {
    Ok(DescriptorPatterns {
        full_descriptor: Regex::new(r"\[([A-Fa-f0-9]{8})/([0-9h'/]+)\]([xyzt]pub[A-Za-z0-9]+)/<([0-9;]+)>/(?:\*|[0-9]+)")
            .map_err(|e| format!("Full descriptor regex error: {}", e))?,
        bare_extended: Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/<([0-9;]+)>/(?:\*|[0-9]+)")
            .map_err(|e| format!("Bare extended regex error: {}", e))?,
        single_deriv: Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/([0-9]+)/\*")
            .map_err(|e| format!("Single derivation regex error: {}", e))?,
        full_fixed_double: Regex::new(r"\[([A-Fa-f0-9]{8})/([0-9h'/]+)\]([xyzt]pub[A-Za-z0-9]+)/([0-9]+)/([0-9]+)")
            .map_err(|e| format!("Full fixed double derivation regex error: {}", e))?,
        fixed_double: Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/([0-9]+)/([0-9]+)")
            .map_err(|e| format!("Fixed double derivation regex error: {}", e))?,
    })
}

/// Process full descriptors with fingerprint and path
fn process_full_descriptors(
    expression: &str,
    pattern: &Regex,
    descriptors: &mut HashMap<String, ParsedDescriptor>
) -> Result<(), String> {
    for caps in pattern.captures_iter(expression) {
        let fingerprint = parse_fingerprint(caps.get(1).unwrap().as_str())?;
        let derivation_path = parse_derivation_path(caps.get(2).unwrap().as_str())?;
        let xpub = parse_xpub(caps.get(3).unwrap().as_str())?;
        let child_paths = parse_child_paths(caps.get(4).map(|m| m.as_str()))?;
        
        let descriptor_str = caps.get(0).unwrap().as_str();
        let info = DescriptorInfo {
            fingerprint,
            derivation_path,
            xpub,
            child_paths,
            is_wildcard: true,
        };
        
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

/// Process bare extended keys with ranges
fn process_bare_extended_keys(
    expression: &str,
    pattern: &Regex,
    descriptors: &mut HashMap<String, ParsedDescriptor>
) -> Result<(), String> {
    for caps in pattern.captures_iter(expression) {
        let xpub = parse_xpub(caps.get(1).unwrap().as_str())?;
        let child_paths = parse_child_paths(caps.get(2).map(|m| m.as_str()))?;
        
        let descriptor_str = caps.get(0).unwrap().as_str();
        let info = DescriptorInfo {
            fingerprint: Fingerprint::from([0, 0, 0, 0]),
            derivation_path: DerivationPath::from_str("m").unwrap(),
            xpub,
            child_paths,
            is_wildcard: true,
        };
        
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

/// Process single derivation keys
fn process_single_derivation_keys(
    expression: &str,
    pattern: &Regex,
    descriptors: &mut HashMap<String, ParsedDescriptor>
) -> Result<(), String> {
    for caps in pattern.captures_iter(expression) {
        let xpub = parse_xpub(caps.get(1).unwrap().as_str())?;
        let index = caps.get(2).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid derivation index")?;
        
        let descriptor_str = caps.get(0).unwrap().as_str();
        let info = DescriptorInfo {
            fingerprint: Fingerprint::from([0, 0, 0, 0]),
            derivation_path: DerivationPath::from_str("m").unwrap(),
            xpub,
            child_paths: vec![index],
            is_wildcard: true,
        };
        
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

/// Process fixed double derivation descriptors
fn process_fixed_double_derivation(
    expression: &str,
    full_pattern: &Regex,
    bare_pattern: &Regex,
    descriptors: &mut HashMap<String, ParsedDescriptor>
) -> Result<(), String> {
    // Process full descriptors with fixed double derivation
    for caps in full_pattern.captures_iter(expression) {
        let fingerprint = parse_fingerprint(caps.get(1).unwrap().as_str())?;
        let derivation_path = parse_derivation_path(caps.get(2).unwrap().as_str())?;
        let xpub = parse_xpub(caps.get(3).unwrap().as_str())?;
        let first_deriv = caps.get(4).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid first derivation index")?;
        let second_deriv = caps.get(5).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid second derivation index")?;
        
        let descriptor_str = caps.get(0).unwrap().as_str();
        let info = DescriptorInfo {
            fingerprint,
            derivation_path,
            xpub,
            child_paths: vec![first_deriv, second_deriv],
            is_wildcard: false,
        };
        
        descriptors.insert(
            descriptor_str.to_string(),
            ParsedDescriptor {
                original: descriptor_str.to_string(),
                info,
            }
        );
    }
    
    // Process bare extended keys with fixed double derivation
    for caps in bare_pattern.captures_iter(expression) {
        let xpub = parse_xpub(caps.get(1).unwrap().as_str())?;
        let first_deriv = caps.get(2).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid first derivation index")?;
        let second_deriv = caps.get(3).unwrap().as_str().parse::<u32>()
            .map_err(|_| "Invalid second derivation index")?;
        
        let descriptor_str = caps.get(0).unwrap().as_str();
        let info = DescriptorInfo {
            fingerprint: Fingerprint::from([0, 0, 0, 0]),
            derivation_path: DerivationPath::from_str("m").unwrap(),
            xpub,
            child_paths: vec![first_deriv, second_deriv],
            is_wildcard: false,
        };
        
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

/// Parse fingerprint from hex string
fn parse_fingerprint(hex_str: &str) -> Result<Fingerprint, String> {
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
fn parse_derivation_path(path_str: &str) -> Result<DerivationPath, String> {
    let normalized_path = if path_str.starts_with("/") {
        format!("m/{}", path_str)
    } else {
        format!("m/{}", path_str)
    };
    
    let normalized_path = normalized_path.replace("h", "'");
    
    DerivationPath::from_str(&normalized_path)
        .map_err(|e| format!("Invalid derivation path: {}", e))
}

/// Parse extended public key
fn parse_xpub(xpub_str: &str) -> Result<Xpub, String> {
    Xpub::from_str(xpub_str)
        .map_err(|e| format!("Invalid xpub: {}", e))
}

/// Parse child paths from range notation
fn parse_child_paths(range_str: Option<&str>) -> Result<Vec<u32>, String> {
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
fn expand_descriptor(descriptor: &ParsedDescriptor, child_index: u32) -> Result<String, String> {
    let secp = Secp256k1::verification_only();
    
    console_log!("Expanding descriptor: {}", descriptor.original);
    console_log!("Xpub: {}", descriptor.info.xpub);
    console_log!("Child paths: {:?}", descriptor.info.child_paths);
    console_log!("Is wildcard: {}", descriptor.info.is_wildcard);
    
    // Handle different derivation patterns
    let final_key = if descriptor.info.child_paths.len() >= 2 && !descriptor.info.is_wildcard {
        // Double derivation case: xpub/0/0
        let first_child = ChildNumber::from_normal_idx(descriptor.info.child_paths[0])
            .map_err(|e| format!("Invalid first child number: {}", e))?;
        let second_child = ChildNumber::from_normal_idx(descriptor.info.child_paths[1])
            .map_err(|e| format!("Invalid second child number: {}", e))?;
        
        console_log!("Double derivation: {}/{}", descriptor.info.child_paths[0], descriptor.info.child_paths[1]);
        descriptor.info.xpub
            .derive_pub(&secp, &[first_child, second_child])
            .map_err(|e| format!("Double key derivation failed: {}", e))?
    } else if descriptor.info.child_paths.len() == 1 && !descriptor.info.is_wildcard {
        // Single derivation case: xpub/0
        let child = ChildNumber::from_normal_idx(descriptor.info.child_paths[0])
            .map_err(|e| format!("Invalid child number: {}", e))?;
        
        console_log!("Single derivation: {}", descriptor.info.child_paths[0]);
        descriptor.info.xpub
            .derive_pub(&secp, &[child])
            .map_err(|e| format!("Single key derivation failed: {}", e))?
    } else if descriptor.info.is_wildcard {
        // Wildcard case: use provided child_index
        let child = ChildNumber::from_normal_idx(child_index)
            .map_err(|e| format!("Invalid child index: {}", e))?;
        
        console_log!("Wildcard derivation: {}", child_index);
        descriptor.info.xpub
            .derive_pub(&secp, &[child])
            .map_err(|e| format!("Wildcard key derivation failed: {}", e))?
    } else {
        // No additional derivation needed
        console_log!("No additional derivation");
        descriptor.info.xpub.clone()
    };
    
    // Get the public key and return as hex string
    let pubkey = final_key.to_pub();
    let hex_key = hex::encode(pubkey.0.serialize());
    console_log!("Derived key for descriptor: {}", hex_key);
    Ok(hex_key)
}

/// Replace descriptors in expression with concrete keys
fn replace_descriptors_with_keys(expression: &str, descriptors: &HashMap<String, ParsedDescriptor>) -> Result<String, String> {
    let mut result = expression.to_string();
    
    // Sort descriptors by length (longest first) to prevent substring conflicts
    let mut sorted_descriptors: Vec<_> = descriptors.iter().collect();
    sorted_descriptors.sort_by_key(|(descriptor_str, _)| std::cmp::Reverse(descriptor_str.len()));
    
    console_log!("Replacing {} descriptors in expression", sorted_descriptors.len());
    for (descriptor_str, parsed) in sorted_descriptors {
        let replacement = expand_descriptor(parsed, 0)?;
        console_log!("Replacing '{}' with '{}' (len: {})", descriptor_str, replacement, replacement.len());
        result = result.replace(descriptor_str, &replacement);
    }
    
    console_log!("Final processed expression: {}", result);
    Ok(result)
}


// ============================================================================
// Compilation Functions
// ============================================================================

/// Compile a policy expression to miniscript
#[wasm_bindgen]
pub fn compile_policy(policy: &str, context: &str) -> JsValue {
    console_log!("Compiling policy: {}", policy);
    console_log!("Context: {}", context);
    
    let result = match compile_policy_to_miniscript(policy, context) {
        Ok((script, script_asm, address, script_size, ms_type, compiled_miniscript, 
            max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable)) => {
            CompilationResult {
                success: true,
                error: None,
                script: Some(script),
                script_asm: Some(script_asm),
                address,
                script_size: Some(script_size),
                miniscript_type: Some(ms_type),
                compiled_miniscript: Some(compiled_miniscript),
                max_satisfaction_size,
                max_weight_to_satisfy,
                sanity_check,
                is_non_malleable,
            }
        },
        Err(e) => CompilationResult {
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
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Compile a miniscript expression to Bitcoin script
#[wasm_bindgen]
pub fn compile_miniscript(expression: &str, context: &str) -> JsValue {
    console_log!("Compiling miniscript: {}", expression);
    console_log!("Context: {}", context);
    
    let result = match compile_expression(expression, context) {
        Ok((script, script_asm, address, script_size, ms_type, 
            max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable, normalized_miniscript)) => {
            CompilationResult {
                success: true,
                error: None,
                script: Some(script),
                script_asm: Some(script_asm),
                address,
                script_size: Some(script_size),
                miniscript_type: Some(ms_type),
                compiled_miniscript: normalized_miniscript,
                max_satisfaction_size,
                max_weight_to_satisfy,
                sanity_check,
                is_non_malleable,
            }
        },
        Err(e) => CompilationResult {
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
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Internal function to compile miniscript expressions
fn compile_expression(
    expression: &str,
    context: &str
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("=== COMPILE_EXPRESSION CALLED ===");
    console_log!("Expression: {}", expression);
    console_log!("Context: {}", context);
    
    if expression.trim().is_empty() {
        return Err("Empty expression - please enter a miniscript".to_string());
    }
    
    let trimmed = expression.trim();
    let network = detect_network(trimmed);
    
    // Process descriptors if needed
    let processed_expr = if needs_descriptor_processing(trimmed) {
        process_expression_descriptors(trimmed)?
    } else {
        trimmed.to_string()
    };
    
    // Check if this is a descriptor wrapper
    if is_descriptor_wrapper(&processed_expr) {
        return compile_descriptor(&processed_expr, context);
    }
    
    // Compile based on context
    match context {
        "legacy" => compile_legacy_miniscript(&processed_expr, network),
        "segwit" => compile_segwit_miniscript(&processed_expr, network),
        "taproot" => compile_taproot_miniscript(&processed_expr, network),
        _ => Err(format!("Invalid context: {}. Use 'legacy', 'segwit', or 'taproot'", context))
    }
}

/// Process descriptors in expression
fn process_expression_descriptors(expression: &str) -> Result<String, String> {
    console_log!("Detected descriptor keys in expression, processing...");
    
    match parse_descriptors(expression) {
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
                    match replace_descriptors_with_keys(expression, &descriptors) {
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

/// Compile a descriptor wrapper
fn compile_descriptor(expression: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
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
    validate_inner_miniscript(inner_miniscript, context)
}

/// Parse non-WSH descriptors
fn parse_non_wsh_descriptor(expression: &str) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
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

/// Validate inner miniscript from descriptor
fn validate_inner_miniscript(inner_miniscript: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
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
fn validate_miniscript<Ctx>(inner_miniscript: &str) -> Result<String, String>
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

/// Compile Legacy context miniscript
fn compile_legacy_miniscript(expression: &str, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
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
fn compile_segwit_miniscript(expression: &str, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
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

/// Compile Taproot context miniscript
fn compile_taproot_miniscript(expression: &str, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    // New approach: wrap miniscript in tr() descriptor with NUMS point
    console_log!("Compiling Taproot miniscript using tr() descriptor approach");
    console_log!("Original expression: {}", expression);
    
    // First validate that we can parse the miniscript
    match expression.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        Ok(ms) => {
            let normalized_miniscript = ms.to_string();
            console_log!("Normalized miniscript: {}", normalized_miniscript);
            
            // Build tr() descriptor with NUMS point - use original expression, not normalized
            let nums_point = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";
            let tr_descriptor = format!("tr({},{})", nums_point, expression);
            console_log!("Built tr() descriptor: {}", tr_descriptor);
            
            // Parse as descriptor to get proper taproot script
            match tr_descriptor.parse::<Descriptor<XOnlyPublicKey>>() {
                Ok(descriptor) => {
                    console_log!("Successfully parsed tr() descriptor");
                    
                    // For taproot, we need the output script (scriptPubKey), not the leaf script
                    // This is OP_1 (0x51) followed by 32 bytes of the taproot output key
                    let script = descriptor.script_pubkey();
                    console_log!("Got taproot output script (scriptPubKey): {} bytes", script.len());
                    
                    // Log the taproot output key from the script for debugging
                    if script.len() == 34 && script.as_bytes()[0] == 0x51 {
                        let taproot_key = &script.as_bytes()[2..34];
                        console_log!("Taproot output key from script: {}", hex::encode(taproot_key));
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
                        Some(normalized_miniscript)
                    ))
                }
                Err(e) => {
                    console_log!("Failed to parse tr() descriptor: {}", e);
                    Err(format!("Failed to create tr() descriptor: {}", e))
                }
            }
        }
        Err(e) => {
            let error_msg = format!("{}", e);
            if error_msg.contains("malformed public key") {
                Err(format!("Taproot parsing failed: {}. Note: Taproot requires X-only public keys (64 characters, no 02/03 prefix). Check that you're using the correct key format for Taproot context.", e))
            } else {
                Err(format!("Taproot parsing failed: {}", e))
            }
        }
    }
}

fn compile_policy_to_miniscript(policy: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    if policy.trim().is_empty() {
        return Err("Empty policy - please enter a policy expression".to_string());
    }

    let trimmed = policy.trim();
    
    // Detect network based on key type
    let network = if trimmed.contains("tpub") {
        Network::Testnet
    } else {
        Network::Bitcoin
    };
    
    console_log!("Processing policy directly: {}", trimmed);
    
    // Check if policy contains descriptor keys
    let processed_policy = if trimmed.contains("tpub") || trimmed.contains("xpub") || trimmed.contains("[") {
        console_log!("Detected descriptor keys in policy, checking for ranges...");
        
        // For policies, check for range patterns directly instead of using parse_descriptors
        // Match both /*  and /<0;1>/* and /<0;1>/1 patterns
        let has_range_descriptors = trimmed.contains("/*") || (trimmed.contains("/<") && trimmed.contains(">/"));
        
        if has_range_descriptors {
            // For range descriptors in policy, we need to compile the policy to miniscript first
            console_log!("Found range descriptors in policy, compiling to miniscript");
            
            // Parse the original policy with descriptor keys (not wrapped with wsh)
            match trimmed.parse::<Concrete<DescriptorPublicKey>>() {
                Ok(descriptor_policy) => {
                    // Try to compile the policy to miniscript based on context
                    let miniscript_result = match context {
                        "legacy" => descriptor_policy.compile::<Legacy>().map(|ms| ms.to_string()),
                        "taproot" => descriptor_policy.compile::<Tap>().map(|ms| ms.to_string()),
                        _ => descriptor_policy.compile::<Segwitv0>().map(|ms| ms.to_string()),
                    };
                    
                    match miniscript_result {
                        Ok(compiled_miniscript) => {
                            // Now validate the resulting descriptor
                            let test_descriptor = format!("wsh({})", compiled_miniscript);
                            match test_descriptor.parse::<Descriptor<DescriptorPublicKey>>() {
                                Ok(_) => {
                                    console_log!("Valid range descriptor compiled to: {}, now processing as descriptor", compiled_miniscript);
                                    // Instead of returning here, continue with descriptor processing
                                    // by calling compile_expression with the wrapped descriptor
                                    match compile_expression(&test_descriptor, context) {
                                        Ok((script, script_asm, address, script_size, ms_type, max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable, normalized_miniscript)) => {
                                            return Ok((
                                                normalized_miniscript.unwrap_or(script), // Put "Valid descriptor: ..." in script field for success message
                                                script_asm,
                                                address,
                                                script_size,
                                                ms_type,
                                                compiled_miniscript, // Put clean miniscript in compiled_miniscript for editor
                                                max_satisfaction_size,
                                                max_weight_to_satisfy,
                                                sanity_check,
                                                is_non_malleable
                                            ));
                                        },
                                        Err(e) => return Err(e)
                                    }
                                },
                                Err(e) => {
                                    console_log!("Invalid compiled descriptor: {}", e);
                                    return Err(format!("Invalid descriptor: {}", e));
                                }
                            }
                        },
                        Err(e) => {
                            console_log!("Failed to compile policy with range descriptors: {}", e);
                            return Err(format!("Failed to compile policy: {}", e));
                        }
                    }
                },
                Err(e) => {
                    console_log!("Failed to parse policy with descriptors: {}", e);
                    return Err(format!("Invalid policy with descriptors: {}", e));
                }
            }
        } else {
            // For non-range descriptors, use the original parse_descriptors approach
            console_log!("Policy has descriptor keys but no ranges, parsing descriptors...");
            match parse_descriptors(trimmed) {
                Ok(descriptors) => {
                    if descriptors.is_empty() {
                        console_log!("No descriptors found, using original policy");
                        trimmed.to_string()
                    } else {
                        console_log!("Found {} fixed descriptors, replacing with concrete keys", descriptors.len());
                        match replace_descriptors_with_keys(trimmed, &descriptors) {
                            Ok(processed) => {
                                console_log!("Successfully replaced descriptors with keys in policy");
                                processed
                            },
                            Err(e) => {
                                console_log!("Failed to replace descriptors: {}", e);
                                return Err(format!("Descriptor processing failed: {}", e));
                            }
                        }
                    }
                },
                Err(e) => {
                    console_log!("Failed to parse descriptors in policy: {}", e);
                    return Err(format!("Descriptor parsing failed: {}", e));
                }
            }
        }
    } else {
        trimmed.to_string()
    };
    
    // Now I need to handle the Taproot context properly for XOnlyPublicKey
    if context == "taproot" {
        // First try parsing as XOnlyPublicKey for 64-char keys
        match processed_policy.parse::<Concrete<XOnlyPublicKey>>() {
            Ok(xonly_policy) => {
                return compile_taproot_policy_xonly(xonly_policy, network);
            },
            Err(_) => {
                // Fall through to try PublicKey parsing
            }
        }
    }
    
    // First try parsing with DescriptorPublicKey to support xpub descriptors  
    match processed_policy.parse::<Concrete<DescriptorPublicKey>>() {
        Ok(descriptor_policy) => {
            // Translate DescriptorPublicKey to PublicKey using our translator
            let mut translator = DescriptorKeyTranslator::new();
            let concrete_policy = match descriptor_policy.translate_pk(&mut translator) {
                Ok(policy) => policy,
                Err(_) => return Err("Failed to translate descriptor keys to concrete keys".to_string())
            };
            
            match context {
                "legacy" => compile_legacy_policy(concrete_policy, network),
                "taproot" => compile_taproot_policy(concrete_policy, network),
                _ => compile_segwit_policy(concrete_policy, network),
            }
        },
        Err(_) => {
            // If descriptor parsing fails, try parsing as regular Concrete<PublicKey>
            match processed_policy.parse::<Concrete<PublicKey>>() {
                Ok(concrete_policy) => {
                    match context {
                        "legacy" => compile_legacy_policy(concrete_policy, network),
                        "taproot" => compile_taproot_policy(concrete_policy, network),
                        _ => compile_segwit_policy(concrete_policy, network),
                    }
                },
                Err(e) => Err(format!("Policy parsing failed: {}", e))
            }
        }
    }
}


/// Compile policy for Legacy context
fn compile_legacy_policy(
    policy: Concrete<PublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Legacy>() {
        Ok(ms) => {
            let compiled_miniscript = ms.to_string();
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            let desc = Descriptor::new_sh(ms.clone())
                .map_err(|e| format!("Descriptor creation failed: {}", e))?;
            let max_weight = desc.max_weight_to_satisfy()
                .map_err(|e| format!("Weight calculation failed: {}", e))?;
            
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
                compiled_miniscript,
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        }
        Err(e) => Err(format!("Policy compilation failed for Legacy: {}", e))
    }
}

/// Compile policy for Segwit context
fn compile_segwit_policy(
    policy: Concrete<PublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Segwitv0>() {
        Ok(ms) => {
            let compiled_miniscript = ms.to_string();
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            let desc = Descriptor::new_wsh(ms.clone())
                .map_err(|e| format!("Descriptor creation failed: {}", e))?;
            let total_weight = desc.max_weight_to_satisfy()
                .map_err(|e| format!("Weight calculation failed: {}", e))?;
            
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
                compiled_miniscript,
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        }
        Err(e) => Err(format!("Policy compilation failed for Segwit v0: {}", e))
    }
}

/// Compile policy for Taproot context with XOnlyPublicKey
fn compile_taproot_policy_xonly(
    policy: Concrete<XOnlyPublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Tap>() {
        Ok(ms) => {
            let compiled_miniscript = ms.to_string();
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            let miniscript_str = ms.to_string();
            let (max_satisfaction_size, max_weight_to_satisfy) = if miniscript_str.starts_with("pk(") {
                (Some(64), Some(64u64))
            } else {
                (None, None)
            };
            
            let sanity_check = ms.sanity_check().is_ok();
            let is_non_malleable = ms.is_non_malleable();
            
            // Determine internal key based on compiled miniscript type
            // Use the new descriptor approach
            let internal_key = get_taproot_internal_key(&compiled_miniscript);
            let address = Some(generate_taproot_address_descriptor(&ms, internal_key, network)
                .unwrap_or_else(|| {
                    console_log!("Failed to generate Taproot address");
                    "Address generation failed".to_string()
                }));
            
            Ok((
                script_hex,
                script_asm,
                address,
                script_size,
                "Taproot".to_string(),
                compiled_miniscript,
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        }
        Err(e) => Err(format!("Policy compilation failed for Taproot: {}", e))
    }
}

/// Compile policy for Taproot context (with PublicKey conversion)
fn compile_taproot_policy(
    policy: Concrete<PublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    // Convert PublicKey policy to XOnlyPublicKey policy
    let mut translator = PublicKeyToXOnlyTranslator::new();
    let xonly_policy = policy.translate_pk(&mut translator)
        .map_err(|_| "Failed to translate policy keys to X-only format")?;
    
    match xonly_policy.compile::<Tap>() {
        Ok(ms) => {
            let compiled_miniscript = ms.to_string();
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            let miniscript_str = ms.to_string();
            let (max_satisfaction_size, max_weight_to_satisfy) = if miniscript_str.starts_with("pk(") {
                (Some(64), Some(64u64))
            } else {
                (None, None)
            };
            
            let sanity_check = ms.sanity_check().is_ok();
            let is_non_malleable = ms.is_non_malleable();
            
            // Determine internal key based on compiled miniscript type
            // Use the new descriptor approach  
            let internal_key = get_taproot_internal_key(&compiled_miniscript);
            let address = Some(generate_taproot_address_descriptor(&ms, internal_key, network)
                .unwrap_or_else(|| {
                    console_log!("Failed to generate Taproot address");
                    "Address generation failed".to_string()
                }));
            
            Ok((
                script_hex,
                script_asm,
                address,
                script_size,
                "Taproot".to_string(),
                compiled_miniscript,
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        }
        Err(e) => Err(format!("Policy compilation failed for Taproot: {}", e))
    }
}

// ============================================================================
// Lifting Functions
// ============================================================================

/// Lift a Bitcoin script to miniscript
#[wasm_bindgen]
pub fn lift_to_miniscript(bitcoin_script: &str) -> JsValue {
    console_log!("Lifting Bitcoin script to miniscript: {}", bitcoin_script);
    
    let result = match perform_lift_to_miniscript(bitcoin_script) {
        Ok(miniscript) => LiftResult {
            success: true,
            error: None,
            miniscript: Some(miniscript),
            policy: None,
        },
        Err(e) => LiftResult {
            success: false,
            error: Some(e),
            miniscript: None,
            policy: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Lift a miniscript to policy
#[wasm_bindgen]
pub fn lift_to_policy(miniscript: &str) -> JsValue {
    console_log!("Lifting miniscript to policy: {}", miniscript);
    
    let result = match perform_lift_to_policy(miniscript) {
        Ok(policy) => LiftResult {
            success: true,
            error: None,
            miniscript: None,
            policy: Some(policy),
        },
        Err(e) => LiftResult {
            success: false,
            error: Some(e),
            miniscript: None,
            policy: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Internal function to perform lift to miniscript
fn perform_lift_to_miniscript(bitcoin_script: &str) -> Result<String, String> {
    if bitcoin_script.trim().is_empty() {
        return Err("Empty Bitcoin script".to_string());
    }
    
    let trimmed = bitcoin_script.trim();
    console_log!("Processing Bitcoin script ASM: {}", trimmed);
    
    // Parse script from hex or ASM
    let script = if trimmed.len() % 2 == 0 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        match hex::decode(trimmed) {
            Ok(bytes) => ScriptBuf::from_bytes(bytes),
            Err(_) => return Err("Invalid hex script".to_string()),
        }
    } else {
        parse_asm_to_script(trimmed)?
    };
    
    console_log!("Successfully parsed Bitcoin script, length: {} bytes", script.len());
    
    // Try to lift for different contexts
    let mut context_errors = Vec::new();
    
    // Try Legacy
    match try_lift_script_to_miniscript::<miniscript::Legacy>(script.as_script()) {
        Ok(ms) => return Ok(ms),
        Err(e) => {
            context_errors.push(("Legacy", e));
            console_log!("Legacy lift failed");
        }
    }
    
    // Try Segwit
    match try_lift_script_to_miniscript::<miniscript::Segwitv0>(script.as_script()) {
        Ok(ms) => return Ok(ms),
        Err(e) => {
            context_errors.push(("Segwit", e));
            console_log!("Segwit lift failed");
        }
    }
    
    // Try Taproot
    match try_lift_script_to_miniscript::<miniscript::Tap>(script.as_script()) {
        Ok(ms) => return Ok(ms),
        Err(e) => {
            context_errors.push(("Taproot", e));
            console_log!("Taproot lift failed");
        }
    }
    
    // Format error message
    format_lift_error(context_errors)
}

/// Try to lift script to miniscript for a specific context
fn try_lift_script_to_miniscript<Ctx>(script: &bitcoin::Script) -> Result<String, String> 
where 
    Ctx: miniscript::ScriptContext,
    for<'a> Ctx::Key: std::fmt::Display + std::str::FromStr,
    <Ctx::Key as std::str::FromStr>::Err: std::fmt::Display,
{
    console_log!("Attempting to lift script to miniscript...");
    
    // Try parse_insane first (accepts non-standard but valid miniscripts)
    match Miniscript::<Ctx::Key, Ctx>::parse_insane(script) {
        Ok(ms) => {
            let ms_string = ms.to_string();
            console_log!("Successfully lifted to miniscript using parse_insane: {}", ms_string);
            Ok(ms_string)
        }
        Err(insane_err) => {
            console_log!("parse_insane failed: {}", insane_err);
            // Fallback to regular parse
            match Miniscript::<Ctx::Key, Ctx>::parse(script) {
                Ok(ms) => {
                    let ms_string = ms.to_string();
                    console_log!("Successfully lifted to miniscript using parse: {}", ms_string);
                    Ok(ms_string)
                }
                Err(parse_err) => {
                    console_log!("Both parse_insane and parse failed");
                    Err(format!("parse_insane: {}, parse: {}", insane_err, parse_err))
                }
            }
        }
    }
}

/// Format lift error message
fn format_lift_error(context_errors: Vec<(&str, String)>) -> Result<String, String> {
    let mut error_msg = String::from("❌ Script is not liftable to Miniscript\n\n");
    error_msg.push_str("This Bitcoin script cannot be lifted to miniscript. Attempted lifting with both standard and non-standard parsers across all contexts:\n\n");
    
    for (context_name, error) in context_errors {
        error_msg.push_str(&format!("📍 {} Context:\n", context_name));
        
        // Extract detailed errors if available
        if let Some(pos) = error.find("parse_insane: ") {
            let after = &error[pos + 14..];
            if let Some(comma_pos) = after.find(", parse: ") {
                let insane_err = &after[..comma_pos];
                let parse_err = &after[comma_pos + 9..];
                error_msg.push_str(&format!("   • parse_insane: ❌ {}\n", insane_err));
                error_msg.push_str(&format!("   • parse: ❌ {}\n\n", parse_err));
            } else {
                error_msg.push_str(&format!("   • Error: ❌ {}\n\n", error));
            }
        } else {
            error_msg.push_str(&format!("   • Error: ❌ {}\n\n", error));
        }
    }
    
    error_msg.push_str("Note: Scripts containing raw public key hashes (P2PKH) or certain non-miniscript constructs cannot be lifted.");
    
    Err(error_msg)
}

/// Internal function to perform lift to policy
fn perform_lift_to_policy(miniscript: &str) -> Result<String, String> {
    if miniscript.trim().is_empty() {
        return Err("Empty miniscript".to_string());
    }
    
    let trimmed = miniscript.trim();
    console_log!("Attempting to lift miniscript to policy: {}", trimmed);
    
    // Try different contexts
    let mut errors = Vec::new();
    
    // Try Legacy
    match lift_miniscript_to_policy::<miniscript::Legacy>(trimmed) {
        Ok(policy) => return Ok(policy),
        Err(e) => errors.push(("Legacy", e))
    }
    
    // Try Segwit
    match lift_miniscript_to_policy::<miniscript::Segwitv0>(trimmed) {
        Ok(policy) => return Ok(policy),
        Err(e) => errors.push(("Segwit", e))
    }
    
    // Try Taproot
    match lift_miniscript_to_policy::<miniscript::Tap>(trimmed) {
        Ok(policy) => return Ok(policy),
        Err(e) => errors.push(("Taproot", e))
    }
    
    // Format error message
    let mut error_msg = String::from("Failed to lift miniscript to policy:\n");
    for (context, err) in errors {
        error_msg.push_str(&format!("  {} context: {}\n", context, err));
    }
    
    Err(error_msg)
}

/// Lift miniscript to policy for a specific context
fn lift_miniscript_to_policy<Ctx>(miniscript: &str) -> Result<String, String>
where
    Ctx: miniscript::ScriptContext,
    for<'a> Ctx::Key: std::fmt::Display + std::str::FromStr,
    <Ctx::Key as std::str::FromStr>::Err: std::fmt::Display + std::fmt::Debug,
{
    match miniscript.parse::<Miniscript<Ctx::Key, Ctx>>() {
        Ok(ms) => {
            match ms.lift() {
                Ok(semantic_policy) => {
                    let policy_str = semantic_policy.to_string();
                    console_log!("Successfully lifted to policy: {}", policy_str);
                    Ok(policy_str)
                }
                Err(e) => Err(format!("Policy lifting failed: {}", e))
            }
        }
        Err(e) => Err(format!("Miniscript parsing failed: {}", e))
    }
}

// ============================================================================
// Address Generation
// ============================================================================

/// Generate address for a specific network
#[wasm_bindgen]
pub fn generate_address_for_network(script_hex: &str, script_type: &str, network: &str) -> JsValue {
    console_log!("Generating address for network: {}", network);
    console_log!("Script type: {}", script_type);
    
    let result = match perform_address_generation(script_hex, script_type, network) {
        Ok(address) => AddressResult {
            success: true,
            error: None,
            address: Some(address),
        },
        Err(e) => AddressResult {
            success: false,
            error: Some(e),
            address: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Generate taproot address for a specific network with miniscript
#[wasm_bindgen]
pub fn generate_taproot_address_for_network(miniscript: &str, network_str: &str) -> JsValue {
    console_log!("Generating taproot address for network: {} with miniscript: {}", network_str, miniscript);
    
    let result = match perform_taproot_address_generation(miniscript, network_str) {
        Ok(address) => AddressResult {
            success: true,
            error: None,
            address: Some(address),
        },
        Err(e) => AddressResult {
            success: false,
            error: Some(e),
            address: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Internal function to generate address
fn perform_address_generation(script_hex: &str, script_type: &str, network_str: &str) -> Result<String, String> {
    // Parse network
    let network = match network_str {
        "mainnet" | "bitcoin" => Network::Bitcoin,
        "testnet" => Network::Testnet,
        "regtest" => Network::Regtest,
        "signet" => Network::Signet,
        _ => return Err(format!("Invalid network: {}", network_str))
    };
    
    // Decode script hex
    let script_bytes = hex::decode(script_hex)
        .map_err(|e| format!("Invalid script hex: {}", e))?;
    let script = ScriptBuf::from_bytes(script_bytes.clone());
    
    // Generate address based on script type
    let address = match script_type {
        "Legacy" => {
            Address::p2sh(&script, network)
                .map_err(|e| format!("Failed to generate P2SH address: {}", e))?
        },
        "Segwit v0" => {
            Address::p2wsh(&script, network)
        },
        "Taproot" => {
            // For Taproot, we need to create a simple tr() descriptor with NUMS point
            // Since we only have the script hex, we'll create a basic P2TR address
            console_log!("Generating Taproot address for network switch");
            
            // Use NUMS point for network switching
            let nums_point = XOnlyPublicKey::from_str(
                "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0"
            ).map_err(|e| format!("Invalid NUMS point: {}", e))?;
            
            // Create a simple key-path only P2TR address with NUMS point
            // This is a limitation - we can't recreate the exact script-path address
            // without the original miniscript expression
            Address::p2tr(&Secp256k1::verification_only(), nums_point, None, network)
        },
        _ => return Err(format!("Unknown script type: {}", script_type))
    };
    
    Ok(address.to_string())
}

/// Internal function to generate taproot address using miniscript
fn perform_taproot_address_generation(miniscript: &str, network_str: &str) -> Result<String, String> {
    // Parse network
    let network = match network_str {
        "mainnet" | "bitcoin" => Network::Bitcoin,
        "testnet" => Network::Testnet,
        "regtest" => Network::Regtest,
        "signet" => Network::Signet,
        _ => return Err(format!("Invalid network: {}", network_str))
    };
    
    console_log!("Generating taproot address with miniscript: {} for network: {:?}", miniscript, network);
    
    // Build tr() descriptor with NUMS point - exact same approach as compile_taproot_miniscript
    let nums_point = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";
    let tr_descriptor = format!("tr({},{})", nums_point, miniscript);
    console_log!("Built tr() descriptor for network switch: {}", tr_descriptor);
    
    // Parse as descriptor to get proper taproot address
    match tr_descriptor.parse::<Descriptor<XOnlyPublicKey>>() {
        Ok(descriptor) => {
            console_log!("Successfully parsed tr() descriptor for network switch");
            
            // Generate address from descriptor
            descriptor.address(network)
                .map(|addr| addr.to_string())
                .map_err(|e| format!("Failed to generate address from descriptor: {}", e))
        }
        Err(e) => {
            console_log!("Failed to parse tr() descriptor for network switch: {}", e);
            Err(format!("Failed to create tr() descriptor: {}", e))
        }
    }
}

// ============================================================================
// Main Function (for testing)
// ============================================================================

pub fn main() {
    console_log!("Miniscript compiler library loaded");
}