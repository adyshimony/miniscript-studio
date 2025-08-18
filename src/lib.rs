use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use miniscript::{Miniscript, Tap, Segwitv0, Legacy, policy::Concrete, Descriptor, DescriptorPublicKey};
use bitcoin::{Address, Network, PublicKey, XOnlyPublicKey, secp256k1::Secp256k1};
use bitcoin::bip32::{Xpub, DerivationPath, Fingerprint, ChildNumber};
use regex::Regex;
use std::str::FromStr;
use std::collections::HashMap;

#[derive(Serialize, Deserialize)]
pub struct CompilationResult {
    pub success: bool,
    pub error: Option<String>,
    pub script: Option<String>,
    pub script_asm: Option<String>,
    pub address: Option<String>,
    pub script_size: Option<usize>,
    pub miniscript_type: Option<String>,
    pub compiled_miniscript: Option<String>,
}

#[derive(Debug, Clone)]
struct DescriptorInfo {
    #[allow(dead_code)]
    fingerprint: Fingerprint,
    #[allow(dead_code)]
    derivation_path: DerivationPath,
    xpub: Xpub,
    child_paths: Vec<u32>, // For <m;n> ranges
    #[allow(dead_code)]
    is_wildcard: bool,     // For /* endings
}

#[derive(Debug, Clone)]
struct ParsedDescriptor {
    #[allow(dead_code)]
    original: String,
    info: DescriptorInfo,
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

// Parse HD wallet descriptors from miniscript expressions
fn parse_descriptors(expression: &str) -> Result<HashMap<String, ParsedDescriptor>, String> {
    let mut descriptors = HashMap::new();
    
    console_log!("Parsing descriptors from expression of length: {}", expression.len());
    
    // Regex patterns for different descriptor formats:
    // 1. Full descriptor: [fingerprint/path]xpub/<range>/*
    let full_descriptor_re = Regex::new(r"\[([A-Fa-f0-9]{8})/([0-9h'/]+)\]([xyzt]pub[A-Za-z0-9]+)/<([0-9;]+)>/\*")
        .map_err(|e| format!("Full descriptor regex error: {}", e))?;
    
    // 2. Bare extended key with range: xpub/<range>/*
    let bare_extended_re = Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/<([0-9;]+)>/\*")
        .map_err(|e| format!("Bare extended regex error: {}", e))?;
    
    // 3. Extended key with single derivation: xpub/0/*
    let single_deriv_re = Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/([0-9]+)/\*")
        .map_err(|e| format!("Single derivation regex error: {}", e))?;
    
    // 4. Extended key with fixed double derivation: xpub/0/0
    let fixed_double_deriv_re = Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/([0-9]+)/([0-9]+)")
        .map_err(|e| format!("Fixed double derivation regex error: {}", e))?;
    
    console_log!("All regex patterns created successfully");
    console_log!("Expression to parse: '{}'", expression);
    
    // Process full descriptors first
    for caps in full_descriptor_re.captures_iter(expression) {
        let fingerprint_str = caps.get(1).unwrap().as_str();
        let path_str = caps.get(2).unwrap().as_str();
        let xpub_str = caps.get(3).unwrap().as_str();
        let range_str = caps.get(4).map(|m| m.as_str()); // The <range> part
        let wildcard = true; // Always true since our regex requires /*
        
        console_log!("Captured path_str: '{}' (len: {})", path_str, path_str.len());
        console_log!("Captured range_str: {:?}", range_str);
        console_log!("Path chars: {:?}", path_str.chars().collect::<Vec<_>>());
        
        // Parse fingerprint
        let fingerprint_bytes = hex::decode(fingerprint_str)
            .map_err(|e| format!("Invalid fingerprint hex: {}", e))?;
        if fingerprint_bytes.len() != 4 {
            return Err("Fingerprint must be 4 bytes".to_string());
        }
        let mut fp_array = [0u8; 4];
        fp_array.copy_from_slice(&fingerprint_bytes);
        let fingerprint = Fingerprint::from(fp_array);
        
        // Parse derivation path - convert 'h' suffix to "'" and add leading slash if missing
        let mut normalized_path = if path_str.starts_with("/") {
            path_str.to_string()
        } else {
            format!("m/{}", path_str)  // Try 'm/' prefix instead of just '/'
        };
        
        // Convert 'h' hardened notation to "'" notation using regex
        console_log!("Before regex replacement: '{}'", normalized_path);
        let hardened_re = Regex::new(r"(\d+)h").unwrap();
        let temp_result = hardened_re.replace_all(&normalized_path, "$1'");
        normalized_path = temp_result.to_string();
        console_log!("After regex replacement: '{}'", normalized_path);
        
        // Debug: print each character with its code
        for (i, ch) in normalized_path.chars().enumerate() {
            console_log!("Char {}: '{}' (code: {})", i, ch, ch as u32);
        }
        
        console_log!("Original path: '{}', Normalized path: '{}'", path_str, normalized_path);
        console_log!("Normalized path length: {}, ends with: '{}'", normalized_path.len(), normalized_path.chars().last().unwrap_or(' '));
        
        // Try parsing the derivation path with detailed error info
        console_log!("Attempting to parse derivation path: '{}'", normalized_path);
        let derivation_path = match DerivationPath::from_str(&normalized_path) {
            Ok(path) => {
                console_log!("Successfully parsed derivation path");
                path
            },
            Err(e) => {
                console_log!("Failed to parse derivation path '{}': {}", normalized_path, e);
                return Err(format!("Invalid derivation path '{}': {}", normalized_path, e));
            }
        };
        
        // Parse extended public key
        let xpub = Xpub::from_str(xpub_str)
            .map_err(|e| format!("Invalid extended public key: {}", e))?;
        
        // Parse child paths from range like 10;11 (already without < >)
        let child_paths = if let Some(range) = range_str {
            console_log!("Parsing range: '{}'", range);
            if range.contains(';') {
                range.split(';')
                    .map(|s| {
                        console_log!("Parsing range component: '{}'", s.trim());
                        s.trim().parse::<u32>()
                    })
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| format!("Invalid range numbers: {}", e))?
            } else {
                vec![range.trim().parse::<u32>()
                    .map_err(|e| format!("Invalid range number: {}", e))?]
            }
        } else {
            vec![]
        };
        
        let descriptor_info = DescriptorInfo {
            fingerprint,
            derivation_path,
            xpub,
            child_paths,
            is_wildcard: wildcard,
        };
        
        // Get the full match including range and wildcard
        let full_match = caps.get(0).unwrap().as_str();
        let parsed_descriptor = ParsedDescriptor {
            original: full_match.to_string(),
            info: descriptor_info,
        };
        
        console_log!("Full descriptor match: '{}'", full_match);
        descriptors.insert(full_match.to_string(), parsed_descriptor);
    }
    
    // Process bare extended keys with range: xpub/<range>/*
    for caps in bare_extended_re.captures_iter(expression) {
        let xpub_str = caps.get(1).unwrap().as_str();
        let range_str = caps.get(2).map(|m| m.as_str()); // The range part
        
        console_log!("Processing bare extended key: '{}'", xpub_str);
        console_log!("Range: '{:?}'", range_str);
        
        // Parse extended public key
        let xpub = Xpub::from_str(xpub_str)
            .map_err(|e| format!("Invalid extended public key: {}", e))?;
        
        // Parse child paths from range
        let child_paths = if let Some(range) = range_str {
            if range.contains(';') {
                range.split(';')
                    .map(|s| s.trim().parse::<u32>())
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| format!("Invalid range numbers: {}", e))?
            } else {
                vec![range.trim().parse::<u32>()
                    .map_err(|e| format!("Invalid range number: {}", e))?]
            }
        } else {
            vec![]
        };
        
        // Create descriptor info with dummy fingerprint and path for bare keys
        let dummy_fingerprint = Fingerprint::from([0u8; 4]);
        let dummy_path = DerivationPath::from_str("m/0")
            .map_err(|e| format!("Failed to create dummy path: {}", e))?;
        
        let descriptor_info = DescriptorInfo {
            fingerprint: dummy_fingerprint,
            derivation_path: dummy_path,
            xpub,
            child_paths,
            is_wildcard: true,
        };
        
        let full_match = caps.get(0).unwrap().as_str();
        let parsed_descriptor = ParsedDescriptor {
            original: full_match.to_string(),
            info: descriptor_info,
        };
        
        console_log!("Bare extended key match: '{}'", full_match);
        descriptors.insert(full_match.to_string(), parsed_descriptor);
    }
    
    // Process extended keys with single derivation: xpub/0/*
    for caps in single_deriv_re.captures_iter(expression) {
        let xpub_str = caps.get(1).unwrap().as_str();
        let deriv_str = caps.get(2).unwrap().as_str();
        
        console_log!("Processing single derivation extended key: '{}'", xpub_str);
        console_log!("Derivation: '{}'", deriv_str);
        
        // Parse extended public key
        let xpub = Xpub::from_str(xpub_str)
            .map_err(|e| format!("Invalid extended public key: {}", e))?;
        
        // Parse single derivation index
        let deriv_index = deriv_str.parse::<u32>()
            .map_err(|e| format!("Invalid derivation index: {}", e))?;
        
        // Create descriptor info with dummy fingerprint and path for bare keys
        let dummy_fingerprint = Fingerprint::from([0u8; 4]);
        let dummy_path = DerivationPath::from_str("m/0")
            .map_err(|e| format!("Failed to create dummy path: {}", e))?;
        
        let descriptor_info = DescriptorInfo {
            fingerprint: dummy_fingerprint,
            derivation_path: dummy_path,
            xpub,
            child_paths: vec![deriv_index],
            is_wildcard: true,
        };
        
        let full_match = caps.get(0).unwrap().as_str();
        let parsed_descriptor = ParsedDescriptor {
            original: full_match.to_string(),
            info: descriptor_info,
        };
        
        console_log!("Single derivation match: '{}'", full_match);
        descriptors.insert(full_match.to_string(), parsed_descriptor);
    }
    
    // Process extended keys with fixed double derivation: xpub/0/0
    for caps in fixed_double_deriv_re.captures_iter(expression) {
        let xpub_str = caps.get(1).unwrap().as_str();
        let first_deriv_str = caps.get(2).unwrap().as_str();
        let second_deriv_str = caps.get(3).unwrap().as_str();
        
        console_log!("Processing fixed double derivation extended key: '{}'", xpub_str);
        console_log!("First derivation: '{}', Second derivation: '{}'", first_deriv_str, second_deriv_str);
        
        // Parse extended public key
        let xpub = Xpub::from_str(xpub_str)
            .map_err(|e| format!("Invalid extended public key: {}", e))?;
        
        // Parse both derivation indices
        let first_deriv = first_deriv_str.parse::<u32>()
            .map_err(|e| format!("Invalid first derivation index: {}", e))?;
        let second_deriv = second_deriv_str.parse::<u32>()
            .map_err(|e| format!("Invalid second derivation index: {}", e))?;
        
        // Create descriptor info with dummy fingerprint and path for bare keys
        let dummy_fingerprint = Fingerprint::from([0u8; 4]);
        let dummy_path = DerivationPath::from_str("m/0")
            .map_err(|e| format!("Failed to create dummy path: {}", e))?;
        
        let descriptor_info = DescriptorInfo {
            fingerprint: dummy_fingerprint,
            derivation_path: dummy_path,
            xpub,
            child_paths: vec![first_deriv, second_deriv], // Store both derivation indices
            is_wildcard: false, // No wildcard for fixed derivation
        };
        
        let full_match = caps.get(0).unwrap().as_str();
        let parsed_descriptor = ParsedDescriptor {
            original: full_match.to_string(),
            info: descriptor_info,
        };
        
        console_log!("Fixed double derivation match: '{}'", full_match);
        descriptors.insert(full_match.to_string(), parsed_descriptor);
    }
    
    Ok(descriptors)
}

// Expand descriptor to actual public key
fn expand_descriptor(descriptor: &ParsedDescriptor, child_index: u32) -> Result<String, String> {
    let secp = Secp256k1::verification_only();
    
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
    } else {
        // Single derivation case: use first child path or provided index
        let child_num = if !descriptor.info.child_paths.is_empty() {
            descriptor.info.child_paths[0]
        } else {
            child_index
        };
        
        let child_number = ChildNumber::from_normal_idx(child_num)
            .map_err(|e| format!("Invalid child number: {}", e))?;
        
        console_log!("Single derivation: {}", child_num);
        descriptor.info.xpub
            .derive_pub(&secp, &[child_number])
            .map_err(|e| format!("Single key derivation failed: {}", e))?
    };
    
    // Return just the compressed public key (33 bytes = 66 hex chars)
    let compressed_key = final_key.public_key.serialize();
    let hex_key = hex::encode(&compressed_key);
    console_log!("Derived key bytes: {} bytes", compressed_key.len());
    console_log!("Derived key hex: {} chars", hex_key.len());
    console_log!("Derived key: {}", hex_key);
    Ok(hex_key)
}

// Replace descriptors in expression with actual keys
fn replace_descriptors_with_keys(expression: &str, descriptors: &HashMap<String, ParsedDescriptor>) -> Result<String, String> {
    let mut result = expression.to_string();
    
    for (original, descriptor) in descriptors {
        // For simplicity, use child index 0 for all expansions
        let public_key = expand_descriptor(descriptor, 0)?;
        console_log!("Replacing '{}' with '{}' (len: {})", original, public_key, public_key.len());
        result = result.replace(original, &public_key);
    }
    
    console_log!("Final processed expression: {}", result);
    Ok(result)
}

#[wasm_bindgen]
pub fn compile_policy(policy: &str, context: &str) -> JsValue {
    console_log!("Compiling policy: {} with context: {}", policy, context);
    
    let result = match compile_policy_to_miniscript(policy, context) {
        Ok((script, script_asm, address, script_size, ms_type, miniscript)) => CompilationResult {
            success: true,
            error: None,
            script: Some(script),
            script_asm: Some(script_asm),
            address,
            script_size: Some(script_size),
            miniscript_type: Some(ms_type),
            compiled_miniscript: Some(miniscript),
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
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

#[wasm_bindgen]
pub fn compile_miniscript(expression: &str, context: &str) -> JsValue {
    console_log!("=== COMPILE_MINISCRIPT PUBLIC FUNCTION CALLED ===");
    console_log!("Compiling miniscript: {} with context: {}", expression, context);
    
    let result = match compile_expression(expression, context) {
        Ok((script, script_asm, address, script_size, ms_type)) => CompilationResult {
            success: true,
            error: None,
            script: Some(script),
            script_asm: Some(script_asm),
            address,
            script_size: Some(script_size),
            miniscript_type: Some(ms_type),
            compiled_miniscript: None,
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
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

fn compile_expression(expression: &str, context: &str) -> Result<(String, String, Option<String>, usize, String), String> {
    console_log!("=== COMPILE_EXPRESSION CALLED ===");
    console_log!("Expression length: {}", expression.len());
    console_log!("Expression: {}", expression);
    console_log!("Context: {}", context);
    
    if expression.trim().is_empty() {
        return Err("Empty expression - please enter a miniscript".to_string());
    }

    let trimmed = expression.trim();
    console_log!("Trimmed expression: {}", trimmed);
    
    // Wrap miniscript with appropriate descriptor based on context
    let descriptor_expr = if trimmed.contains("tpub") || trimmed.contains("xpub") || trimmed.contains("ypub") || trimmed.contains("zpub") {
        match context {
            "legacy" => format!("sh({})", trimmed),
            "segwit" => format!("wsh({})", trimmed),
            "taproot" => format!("tr({},{{}})", trimmed), // tr requires internal key and optional script
            _ => trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };
    
    console_log!("Processing: {} -> {}", trimmed, descriptor_expr);
    
    match context {
        "legacy" => {
            match trimmed.parse::<Miniscript<PublicKey, Legacy>>() {
                Ok(ms) => {
                    let script = ms.encode();
                    let script_hex = hex::encode(script.as_bytes());
                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                    let script_size = script.len();
                    
                    let address = match Address::p2sh(&script, Network::Bitcoin) {
                        Ok(addr) => Some(addr.to_string()),
                        Err(_) => None,
                    };
                    
                    Ok((script_hex, script_asm, address, script_size, "Legacy".to_string()))
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
        },
        "segwit" => {
            if descriptor_expr.starts_with("wsh(") {
                match descriptor_expr.parse::<Descriptor<DescriptorPublicKey>>() {
                    Ok(desc) => {
                        // Descriptor parsed successfully - this validates the syntax
                        console_log!("Descriptor parsed successfully: {}", descriptor_expr);
                        console_log!("Is multipath: {}", desc.is_multipath());
                        console_log!("Has wildcard: {}", desc.has_wildcard());
                        
                        // Only return validation message for multipath or wildcard descriptors
                        if desc.is_multipath() || desc.has_wildcard() {
                            let validation_msg = "✅ Valid multipath/wildcard descriptor (cannot generate concrete script without derivation index)".to_string();
                            Ok((validation_msg.clone(), validation_msg, None, 0, "Segwit v0 Descriptor".to_string()))
                        } else {
                            // For concrete descriptors, derive to get concrete keys  
                            let derived_desc = desc.at_derivation_index(0).map_err(|e| format!("Derivation failed: {}", e))?;
                            let script = derived_desc.script_pubkey();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            
                            let address = Some(Address::p2wsh(&script, Network::Bitcoin).to_string());
                            
                            Ok((script_hex, script_asm, address, script_size, "Segwit v0".to_string()))
                        }
                    }
                    Err(e) => Err(format!("Descriptor parsing failed: {}", e))
                }
            } else {
                match trimmed.parse::<Miniscript<PublicKey, Segwitv0>>() {
                Ok(ms) => {
                    let script = ms.encode();
                    let script_hex = hex::encode(script.as_bytes());
                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                    let script_size = script.len();
                    
                    let address = Some(Address::p2wsh(&script, Network::Bitcoin).to_string());
                    
                    Ok((script_hex, script_asm, address, script_size, "Segwit v0".to_string()))
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
        },
        "taproot" => {
            match trimmed.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
                Ok(ms) => {
                    let script = ms.encode();
                    let script_hex = hex::encode(script.as_bytes());
                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                    let script_size = script.len();
                    
                    // Generate Taproot address
                    let address = generate_taproot_address(&script);
                    
                    Ok((script_hex, script_asm, address, script_size, "Taproot".to_string()))
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
        },
        _ => Err(format!("Invalid context: {}. Use 'legacy', 'segwit', or 'taproot'", context))
    }
}

fn compile_policy_to_miniscript(policy: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, String), String> {
    if policy.trim().is_empty() {
        return Err("Empty policy - please enter a policy expression".to_string());
    }

    let trimmed = policy.trim();
    
    console_log!("Processing policy directly: {}", trimmed);
    
    match context {
        "legacy" => {
            match trimmed.parse::<Concrete<PublicKey>>() {
                Ok(concrete_policy) => {
                    match concrete_policy.compile::<Legacy>() {
                        Ok(ms) => {
                            let script = ms.encode();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            let miniscript_str = ms.to_string();
                            
                            let address = match Address::p2sh(&script, Network::Bitcoin) {
                                Ok(addr) => Some(addr.to_string()),
                                Err(_) => None,
                            };
                            
                            Ok((script_hex, script_asm, address, script_size, "Legacy".to_string(), miniscript_str))
                        }
                        Err(e) => {
                            let error_msg = format!("{}", e);
                            if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                                Err(format!("Legacy compilation failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Legacy requires compressed public keys (66 characters).", e))
                            } else {
                                Err(format!("Legacy compilation failed: {}", e))
                            }
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("{}", e);
                    if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                        Err(format!("Policy parsing failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Legacy requires compressed public keys (66 characters).", e))
                    } else {
                        Err(format!("Policy parsing failed: {}", e))
                    }
                }
            }
        },
        "segwit" => {
            match trimmed.parse::<Concrete<PublicKey>>() {
                Ok(concrete_policy) => {
                    match concrete_policy.compile::<Segwitv0>() {
                        Ok(ms) => {
                            let script = ms.encode();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            let miniscript_str = ms.to_string();
                            
                            let address = Some(Address::p2wsh(&script, Network::Bitcoin).to_string());
                            
                            Ok((script_hex, script_asm, address, script_size, "Segwit v0".to_string(), miniscript_str))
                        }
                        Err(e) => {
                            let error_msg = format!("{}", e);
                            if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                                Err(format!("Segwit v0 compilation failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Segwit v0 requires compressed public keys (66 characters).", e))
                            } else {
                                Err(format!("Segwit v0 compilation failed: {}", e))
                            }
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("{}", e);
                    if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                        Err(format!("Segwit v0 policy parsing failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Segwit v0 requires compressed public keys (66 characters).", e))
                    } else {
                        Err(format!("Policy parsing failed: {}", e))
                    }
                }
            }
        },
        "taproot" => {
            match trimmed.parse::<Concrete<XOnlyPublicKey>>() {
                Ok(concrete_policy) => {
                    match concrete_policy.compile::<Tap>() {
                        Ok(ms) => {
                            let script = ms.encode();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            let miniscript_str = ms.to_string();
                            
                            // Generate Taproot address
                            let address = generate_taproot_address(&script);
                            
                            Ok((script_hex, script_asm, address, script_size, "Taproot".to_string(), miniscript_str))
                        }
                        Err(e) => {
                            let error_msg = format!("{}", e);
                            if error_msg.contains("malformed public key") {
                                Err(format!("Taproot compilation failed: {}. Note: Taproot requires X-only public keys (64 characters, no 02/03 prefix). Check that you're using the correct key format for Taproot context.", e))
                            } else {
                                Err(format!("Taproot compilation failed: {}", e))
                            }
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("{}", e);
                    if error_msg.contains("malformed public key") {
                        Err(format!("Taproot policy parsing failed: {}. Note: Taproot requires X-only public keys (64 characters, no 02/03 prefix). Check that you're using the correct key format for Taproot context.", e))
                    } else {
                        Err(format!("Policy parsing failed: {}", e))
                    }
                }
            }
        },
        _ => Err(format!("Invalid context: {}. Use 'legacy', 'segwit', or 'taproot'", context))
    }
}

fn generate_taproot_address(_script: &bitcoin::Script) -> Option<String> {
    // Create a simple Taproot address using key-path spending
    // This uses a dummy internal key for demonstration purposes
    
    // Use a standard "nothing up my sleeve" internal key (hash of "TapRoot" repeated)
    let internal_key_bytes = [
        0x50, 0x92, 0x9b, 0x74, 0xc1, 0xa0, 0x49, 0x54, 0xb7, 0x8b, 0x4b, 0x60, 0x35, 0xe9, 0x7a, 0x5e,
        0x07, 0x8a, 0x5a, 0x0f, 0x28, 0xec, 0x96, 0xd5, 0x47, 0xbf, 0xee, 0x9a, 0xce, 0x80, 0x3a, 0xc0
    ];
    
    match XOnlyPublicKey::from_slice(&internal_key_bytes) {
        Ok(internal_key) => {
            // Create a simple key-path-only Taproot address
            // Note: This is simplified - in practice you'd want script-path spending
            let address = Address::p2tr(&Secp256k1::verification_only(), internal_key, None, Network::Bitcoin);
            Some(address.to_string())
        }
        Err(_) => None
    }
}

#[wasm_bindgen(start)]
pub fn main() {
    console_log!("=== REAL MINISCRIPT WASM MODULE LOADED ===");
    console_log!("Module initialization complete");
}