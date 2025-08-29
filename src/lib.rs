use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use miniscript::{Miniscript, Tap, Segwitv0, Legacy, policy::Concrete, Descriptor, DescriptorPublicKey, Translator, ToPublicKey, ScriptContext};
use miniscript::policy::Liftable;
use bitcoin::{Address, Network, PublicKey, XOnlyPublicKey, secp256k1::Secp256k1, ScriptBuf};
use bitcoin::blockdata::script::{Builder, PushBytesBuf};
use bitcoin::blockdata::opcodes;
// use bitcoin::opcodes::Opcode; // Commented out - not needed after fixing parse_asm_to_script
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
    pub max_satisfaction_size: Option<usize>,
    pub max_weight_to_satisfy: Option<u64>,
    pub sanity_check: Option<bool>,
    pub is_non_malleable: Option<bool>,
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

// Translator for converting DescriptorPublicKey to PublicKey
struct DescriptorKeyTranslator {
    secp: Secp256k1<bitcoin::secp256k1::VerifyOnly>,
}

impl DescriptorKeyTranslator {
    fn new() -> Self {
        Self {
            secp: Secp256k1::verification_only(),
        }
    }
}

impl Translator<DescriptorPublicKey, PublicKey, ()> for DescriptorKeyTranslator {
    fn pk(&mut self, pk: &DescriptorPublicKey) -> Result<PublicKey, ()> {
        // Derive the key at index 0 to get a concrete key
        match pk.clone().at_derivation_index(0) {
            Ok(definite_key) => Ok(definite_key.to_public_key()),
            Err(_) => Err(())
        }
    }
    
    // Implement hash functions to pass through unchanged
    fn sha256(&mut self, hash: &<DescriptorPublicKey as miniscript::MiniscriptKey>::Sha256) -> Result<<PublicKey as miniscript::MiniscriptKey>::Sha256, ()> {
        Ok(*hash)
    }

    fn hash256(&mut self, hash: &<DescriptorPublicKey as miniscript::MiniscriptKey>::Hash256) -> Result<<PublicKey as miniscript::MiniscriptKey>::Hash256, ()> {
        Ok(*hash)
    }

    fn ripemd160(&mut self, hash: &<DescriptorPublicKey as miniscript::MiniscriptKey>::Ripemd160) -> Result<<PublicKey as miniscript::MiniscriptKey>::Ripemd160, ()> {
        Ok(*hash)
    }

    fn hash160(&mut self, hash: &<DescriptorPublicKey as miniscript::MiniscriptKey>::Hash160) -> Result<<PublicKey as miniscript::MiniscriptKey>::Hash160, ()> {
        Ok(*hash)
    }
}

// Translator for converting DescriptorPublicKey to XOnlyPublicKey (for Taproot)
struct XOnlyKeyTranslator {
    secp: Secp256k1<bitcoin::secp256k1::VerifyOnly>,
}

impl XOnlyKeyTranslator {
    fn new() -> Self {
        Self {
            secp: Secp256k1::verification_only(),
        }
    }
}

impl Translator<DescriptorPublicKey, XOnlyPublicKey, ()> for XOnlyKeyTranslator {
    fn pk(&mut self, pk: &DescriptorPublicKey) -> Result<XOnlyPublicKey, ()> {
        // Derive the key at index 0 to get a concrete key, then convert to X-only
        match pk.clone().at_derivation_index(0) {
            Ok(definite_key) => {
                let full_pk = definite_key.to_public_key();
                Ok(XOnlyPublicKey::from(full_pk))
            },
            Err(_) => Err(())
        }
    }
    
    // Implement hash functions to pass through unchanged
    fn sha256(&mut self, hash: &<DescriptorPublicKey as miniscript::MiniscriptKey>::Sha256) -> Result<<XOnlyPublicKey as miniscript::MiniscriptKey>::Sha256, ()> {
        Ok(*hash)
    }

    fn hash256(&mut self, hash: &<DescriptorPublicKey as miniscript::MiniscriptKey>::Hash256) -> Result<<XOnlyPublicKey as miniscript::MiniscriptKey>::Hash256, ()> {
        Ok(*hash)
    }

    fn ripemd160(&mut self, hash: &<DescriptorPublicKey as miniscript::MiniscriptKey>::Ripemd160) -> Result<<XOnlyPublicKey as miniscript::MiniscriptKey>::Ripemd160, ()> {
        Ok(*hash)
    }

    fn hash160(&mut self, hash: &<DescriptorPublicKey as miniscript::MiniscriptKey>::Hash160) -> Result<<XOnlyPublicKey as miniscript::MiniscriptKey>::Hash160, ()> {
        Ok(*hash)
    }
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
        Ok((script, script_asm, address, script_size, ms_type, miniscript, max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable)) => CompilationResult {
            success: true,
            error: None,
            script: Some(script),
            script_asm: Some(script_asm),
            address,
            script_size: Some(script_size),
            miniscript_type: Some(ms_type),
            compiled_miniscript: Some(miniscript),
            max_satisfaction_size,
            max_weight_to_satisfy,
            sanity_check,
            is_non_malleable,
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

#[wasm_bindgen]
pub fn compile_miniscript(expression: &str, context: &str) -> JsValue {
    console_log!("=== COMPILE_MINISCRIPT PUBLIC FUNCTION CALLED ===");
    console_log!("Compiling miniscript: {} with context: {}", expression, context);
    
    let result = match compile_expression(expression, context) {
        Ok((script, script_asm, address, script_size, ms_type, max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable)) => CompilationResult {
            success: true,
            error: None,
            script: Some(script),
            script_asm: Some(script_asm),
            address,
            script_size: Some(script_size),
            miniscript_type: Some(ms_type),
            compiled_miniscript: None,
            max_satisfaction_size,
            max_weight_to_satisfy,
            sanity_check,
            is_non_malleable,
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

fn compile_expression(expression: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    console_log!("=== COMPILE_EXPRESSION CALLED ===");
    console_log!("Expression length: {}", expression.len());
    console_log!("Expression: {}", expression);
    console_log!("Context: {}", context);
    
    if expression.trim().is_empty() {
        return Err("Empty expression - please enter a miniscript".to_string());
    }

    let trimmed = expression.trim();
    console_log!("Trimmed expression: {}", trimmed);
    
    // Detect network based on key type
    let network = if trimmed.contains("tpub") {
        Network::Testnet
    } else {
        Network::Bitcoin
    };
    
    // Wrap miniscript with appropriate descriptor based on context
    let descriptor_expr = if trimmed.contains("tpub") || trimmed.contains("xpub") {
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
                    
                    // Calculate weight using descriptor for Legacy
                    console_log!("Creating Legacy descriptor for weight calculation");
                    let desc = Descriptor::new_sh(ms.clone()).map_err(|e| format!("Descriptor creation failed: {}", e))?;
                    let max_weight = desc.max_weight_to_satisfy().map_err(|e| format!("Weight calculation failed: {}", e))?;
                    console_log!("Legacy max_weight_to_satisfy: {} WU", max_weight.to_wu());
                    let max_satisfaction_size = Some((max_weight.to_wu() as f64 / 4.0) as usize); // Convert WU to bytes estimate
                    let max_weight_to_satisfy = Some(max_weight.to_wu());
                    let sanity_check = ms.sanity_check().is_ok();
                    let is_non_malleable = ms.is_non_malleable();
                    
                    let address = match Address::p2sh(&script, network) {
                        Ok(addr) => Some(addr.to_string()),
                        Err(_) => None,
                    };
                    
                    Ok((script_hex, script_asm, address, script_size, "Legacy".to_string(), max_satisfaction_size, max_weight_to_satisfy, Some(sanity_check), Some(is_non_malleable)))
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
                            Ok((validation_msg.clone(), validation_msg, None, 0, "Segwit v0 Descriptor".to_string(), None, None, None, None))
                        } else {
                            // For concrete descriptors, derive to get concrete keys  
                            let derived_desc = desc.at_derivation_index(0).map_err(|e| format!("Derivation failed: {}", e))?;
                            let script = derived_desc.script_pubkey();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            
                            let address = Some(Address::p2wsh(&script, network).to_string());
                            
                            Ok((script_hex, script_asm, address, script_size, "Segwit v0".to_string(), None, None, None, None))
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
                    
                    let address = Some(Address::p2wsh(&script, network).to_string());
                    
                    Ok((script_hex, script_asm, address, script_size, "Segwit v0".to_string(), None, None, None, None))
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
                    let address = generate_taproot_address(&script, network);
                    
                    Ok((script_hex, script_asm, address, script_size, "Taproot".to_string(), None, None, None, None))
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
    
    // First try parsing with DescriptorPublicKey to support xpub descriptors
    match trimmed.parse::<Concrete<DescriptorPublicKey>>() {
        Ok(descriptor_policy) => {
            // Translate DescriptorPublicKey to PublicKey using our translator
            let mut translator = DescriptorKeyTranslator::new();
            let concrete_policy = match descriptor_policy.translate_pk(&mut translator) {
                Ok(policy) => policy,
                Err(_) => return Err("Failed to translate descriptor keys to concrete keys".to_string())
            };
            
            match context {
                "legacy" => {
                    match concrete_policy.compile::<Legacy>() {
                        Ok(ms) => {
                            let script = ms.encode();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            let miniscript_str = ms.to_string();
                            
                            // For Legacy context compiled as P2SH, just use the Legacy descriptor
                            console_log!("Creating Legacy P2SH descriptor for weight calculation");
                            let desc = Descriptor::new_sh(ms.clone()).map_err(|e| format!("Descriptor creation failed: {}", e))?;
                            let max_weight = desc.max_weight_to_satisfy().map_err(|e| format!("Weight calculation failed: {}", e))?;
                            console_log!("Legacy P2SH max_weight_to_satisfy: {} WU", max_weight.to_wu());
                            let max_satisfaction_size = Some((max_weight.to_wu() as f64 / 4.0) as usize); // Convert WU to bytes estimate
                            let max_weight_to_satisfy = Some(max_weight.to_wu());
                            let sanity_check = ms.sanity_check().is_ok();
                            let is_non_malleable = ms.is_non_malleable();
                            
                            let address = match Address::p2sh(&script, network) {
                                Ok(addr) => Some(addr.to_string()),
                                Err(_) => None,
                            };
                            
                            Ok((script_hex, script_asm, address, script_size, "Legacy".to_string(), miniscript_str, max_satisfaction_size, max_weight_to_satisfy, Some(sanity_check), Some(is_non_malleable)))
                        }
                        Err(e) => Err(format!("Legacy compilation failed: {}", e))
                    }
                },
                "segwit" => {
                    match concrete_policy.compile::<Segwitv0>() {
                        Ok(ms) => {
                            let script = ms.encode();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            let miniscript_str = ms.to_string();
                            
                            // Calculate weight using descriptor max_weight_to_satisfy method
                            console_log!("Creating Segwit descriptor for weight calculation");
                            let desc = Descriptor::new_wsh(ms.clone()).map_err(|e| format!("Descriptor creation failed: {}", e))?;
                            let total_weight = desc.max_weight_to_satisfy().map_err(|e| format!("Weight calculation failed: {}", e))?;
                            console_log!("Segwit total max_weight_to_satisfy: {} WU", total_weight.to_wu());
                            console_log!("Script size: {} bytes", script_size);
                            
                            // Use ONLY what the library returns - no hardcoding or custom logic
                            console_log!("Using library total weight: {} WU", total_weight.to_wu());
                            
                            // Return the raw library values
                            let max_satisfaction_size = Some(total_weight.to_wu() as usize);
                            let max_weight_to_satisfy = Some(total_weight.to_wu());
                            let sanity_check = ms.sanity_check().is_ok();
                            let is_non_malleable = ms.is_non_malleable();
                            
                            let address = Some(Address::p2wsh(&script, network).to_string());
                            
                            Ok((script_hex, script_asm, address, script_size, "Segwit v0".to_string(), miniscript_str, max_satisfaction_size, max_weight_to_satisfy, Some(sanity_check), Some(is_non_malleable)))
                        }
                        Err(e) => Err(format!("Segwit v0 compilation failed: {}", e))
                    }
                },
                "taproot" => {
                    // For Taproot, we need XOnlyPublicKey, so create a separate translator
                    let mut xonly_translator = XOnlyKeyTranslator::new();
                    let xonly_policy = match descriptor_policy.translate_pk(&mut xonly_translator) {
                        Ok(policy) => policy,
                        Err(_) => return Err("Failed to translate descriptor keys to X-only keys".to_string())
                    };
                    
                    match xonly_policy.compile::<Tap>() {
                        Ok(ms) => {
                            let script = ms.encode();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            let miniscript_str = ms.to_string();
                            
                            // For Taproot, estimate satisfaction size based on miniscript pattern
                            console_log!("Estimating Taproot satisfaction size");
                            let miniscript_str_check = ms.to_string();
                            let (max_satisfaction_size, max_weight_to_satisfy) = if miniscript_str_check.starts_with("pk(") {
                                // For pk(), it's just a signature (64 bytes for Schnorr)
                                console_log!("Taproot pk() detected, estimating 64 bytes");
                                (Some(64), Some(64u64))
                            } else {
                                console_log!("Taproot complex script, cannot estimate");
                                (None, None)
                            };
                            let sanity_check = ms.sanity_check().is_ok();
                            let is_non_malleable = ms.is_non_malleable();
                            
                            let address = generate_taproot_address(&script, network);
                            
                            Ok((script_hex, script_asm, address, script_size, "Taproot".to_string(), miniscript_str, max_satisfaction_size, max_weight_to_satisfy, Some(sanity_check), Some(is_non_malleable)))
                        }
                        Err(e) => Err(format!("Taproot compilation failed: {}", e))
                    }
                },
                _ => Err(format!("Invalid context: {}. Use 'legacy', 'segwit', or 'taproot'", context))
            }
        }
        Err(_) => {
            // Fallback to original PublicKey parsing for simple keys
            match context {
                "legacy" => {
                    match trimmed.parse::<Concrete<PublicKey>>() {
                        Ok(policy) => {
                            match policy.compile::<Legacy>() {
                                Ok(ms) => {
                                    let script = ms.encode();
                                    let script_hex = hex::encode(script.as_bytes());
                                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                                    let script_size = script.len();
                                    let miniscript_str = ms.to_string();
                                    
                                    // Calculate additional metrics
                                    let max_satisfaction_size = ms.max_satisfaction_size().ok();
                                    let max_weight_to_satisfy = ms.max_satisfaction_size().ok().map(|size| size as u64);
                                    let sanity_check = ms.sanity_check().is_ok();
                                    let is_non_malleable = ms.is_non_malleable();
                                    
                                    let address = match Address::p2sh(&script, network) {
                                        Ok(addr) => Some(addr.to_string()),
                                        Err(_) => None,
                                    };
                                    
                                    Ok((script_hex, script_asm, address, script_size, "Legacy".to_string(), miniscript_str, max_satisfaction_size, max_weight_to_satisfy, Some(sanity_check), Some(is_non_malleable)))
                                }
                                Err(e) => Err(format!("Legacy compilation failed: {}", e))
                            }
                        }
                        Err(e) => {
                            let error_msg = format!("{}", e);
                            if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                                Err(format!("Legacy policy parsing failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Legacy requires compressed public keys (66 characters).", e))
                            } else {
                                Err(format!("Policy parsing failed: {}", e))
                            }
                        }
                    }
                },
                "segwit" => {
                    match trimmed.parse::<Concrete<PublicKey>>() {
                        Ok(policy) => {
                            match policy.compile::<Segwitv0>() {
                                Ok(ms) => {
                                    let script = ms.encode();
                                    let script_hex = hex::encode(script.as_bytes());
                                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                                    let script_size = script.len();
                                    let miniscript_str = ms.to_string();
                                    
                                    // Calculate additional metrics
                                    let max_satisfaction_size = ms.max_satisfaction_size().ok();
                                    let max_weight_to_satisfy = ms.max_satisfaction_size().ok().map(|size| size as u64);
                                    let sanity_check = ms.sanity_check().is_ok();
                                    let is_non_malleable = ms.is_non_malleable();
                                    
                                    let address = Some(Address::p2wsh(&script, network).to_string());
                                    
                                    Ok((script_hex, script_asm, address, script_size, "Segwit v0".to_string(), miniscript_str, max_satisfaction_size, max_weight_to_satisfy, Some(sanity_check), Some(is_non_malleable)))
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
                        Ok(policy) => {
                            match policy.compile::<Tap>() {
                                Ok(ms) => {
                                    let script = ms.encode();
                                    let script_hex = hex::encode(script.as_bytes());
                                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                                    let script_size = script.len();
                                    let miniscript_str = ms.to_string();
                                    
                                    // For Taproot, estimate satisfaction size based on miniscript pattern
                                    console_log!("Estimating Taproot satisfaction size (policy compilation)");
                                    let miniscript_str_check = ms.to_string();
                                    let (max_satisfaction_size, max_weight_to_satisfy) = if miniscript_str_check.starts_with("pk(") {
                                        // For pk(), it's just a signature (64 bytes for Schnorr)
                                        console_log!("Taproot pk() detected, estimating 64 bytes");
                                        (Some(64), Some(64u64))
                                    } else {
                                        console_log!("Taproot complex script, cannot estimate");
                                        (None, None)
                                    };
                                    let sanity_check = ms.sanity_check().is_ok();
                                    let is_non_malleable = ms.is_non_malleable();
                                    
                                    // Generate Taproot address
                                    let address = generate_taproot_address(&script, network);
                                    
                                    Ok((script_hex, script_asm, address, script_size, "Taproot".to_string(), miniscript_str, max_satisfaction_size, max_weight_to_satisfy, Some(sanity_check), Some(is_non_malleable)))
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
    }
}

fn generate_taproot_address(_script: &bitcoin::Script, network: Network) -> Option<String> {
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
            let address = Address::p2tr(&Secp256k1::verification_only(), internal_key, None, network);
            Some(address.to_string())
        }
        Err(_) => None
    }
}

#[derive(Serialize, Deserialize)]
pub struct LiftResult {
    pub success: bool,
    pub error: Option<String>,
    pub miniscript: Option<String>,
    pub policy: Option<String>,
}

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

fn parse_asm_to_script(asm: &str) -> Result<ScriptBuf, String> {
    let mut builder = Builder::new();
    let parts: Vec<&str> = asm.split_whitespace().collect();
    let mut i = 0;
    
    while i < parts.len() {
        let part = parts[i];
        match part.to_uppercase().as_str() {
            // Basic opcodes
            "OP_0" | "OP_FALSE" | "OP_PUSHNUM_0" => builder = builder.push_opcode(opcodes::all::OP_PUSHBYTES_0),
            "OP_1" | "OP_TRUE" | "OP_PUSHNUM_1" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_1),
            "OP_2" | "OP_PUSHNUM_2" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_2),
            "OP_3" | "OP_PUSHNUM_3" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_3),
            "OP_4" | "OP_PUSHNUM_4" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_4),
            "OP_5" | "OP_PUSHNUM_5" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_5),
            "OP_6" | "OP_PUSHNUM_6" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_6),
            "OP_7" | "OP_PUSHNUM_7" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_7),
            "OP_8" | "OP_PUSHNUM_8" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_8),
            "OP_9" | "OP_PUSHNUM_9" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_9),
            "OP_10" | "OP_PUSHNUM_10" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_10),
            "OP_11" | "OP_PUSHNUM_11" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_11),
            "OP_12" | "OP_PUSHNUM_12" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_12),
            "OP_13" | "OP_PUSHNUM_13" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_13),
            "OP_14" | "OP_PUSHNUM_14" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_14),
            "OP_15" | "OP_PUSHNUM_15" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_15),
            "OP_16" | "OP_PUSHNUM_16" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_16),
            "OP_PUSHNUM_NEG1" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_NEG1),
            
            // Common opcodes
            "OP_DUP" => builder = builder.push_opcode(opcodes::all::OP_DUP),
            "OP_HASH160" => builder = builder.push_opcode(opcodes::all::OP_HASH160),
            "OP_HASH256" => builder = builder.push_opcode(opcodes::all::OP_HASH256),
            "OP_SHA256" => builder = builder.push_opcode(opcodes::all::OP_SHA256),
            "OP_RIPEMD160" => builder = builder.push_opcode(opcodes::all::OP_RIPEMD160),
            "OP_EQUAL" => builder = builder.push_opcode(opcodes::all::OP_EQUAL),
            "OP_EQUALVERIFY" => builder = builder.push_opcode(opcodes::all::OP_EQUALVERIFY),
            "OP_CHECKSIG" => builder = builder.push_opcode(opcodes::all::OP_CHECKSIG),
            "OP_CHECKSIGVERIFY" => builder = builder.push_opcode(opcodes::all::OP_CHECKSIGVERIFY),
            "OP_CHECKMULTISIG" => builder = builder.push_opcode(opcodes::all::OP_CHECKMULTISIG),
            "OP_CHECKMULTISIGVERIFY" => builder = builder.push_opcode(opcodes::all::OP_CHECKMULTISIGVERIFY),
            "OP_CHECKLOCKTIMEVERIFY" | "OP_CLTV" => builder = builder.push_opcode(opcodes::all::OP_CLTV),
            "OP_CHECKSEQUENCEVERIFY" | "OP_CSV" => builder = builder.push_opcode(opcodes::all::OP_CSV),
            "OP_CHECKSIGADD" => builder = builder.push_opcode(opcodes::all::OP_CHECKSIGADD),
            
            // Control flow
            "OP_IF" => builder = builder.push_opcode(opcodes::all::OP_IF),
            "OP_NOTIF" => builder = builder.push_opcode(opcodes::all::OP_NOTIF),
            "OP_ELSE" => builder = builder.push_opcode(opcodes::all::OP_ELSE),
            "OP_ENDIF" => builder = builder.push_opcode(opcodes::all::OP_ENDIF),
            "OP_VERIFY" => builder = builder.push_opcode(opcodes::all::OP_VERIFY),
            "OP_RETURN" => builder = builder.push_opcode(opcodes::all::OP_RETURN),
            
            // Stack operations
            "OP_SIZE" => builder = builder.push_opcode(opcodes::all::OP_SIZE),
            "OP_SWAP" => builder = builder.push_opcode(opcodes::all::OP_SWAP),
            "OP_DROP" => builder = builder.push_opcode(opcodes::all::OP_DROP),
            "OP_OVER" => builder = builder.push_opcode(opcodes::all::OP_OVER),
            "OP_PICK" => builder = builder.push_opcode(opcodes::all::OP_PICK),
            "OP_ROLL" => builder = builder.push_opcode(opcodes::all::OP_ROLL),
            "OP_ROT" => builder = builder.push_opcode(opcodes::all::OP_ROT),
            "OP_2DUP" => builder = builder.push_opcode(opcodes::all::OP_2DUP),
            "OP_2DROP" => builder = builder.push_opcode(opcodes::all::OP_2DROP),
            "OP_NIP" => builder = builder.push_opcode(opcodes::all::OP_NIP),
            "OP_TUCK" => builder = builder.push_opcode(opcodes::all::OP_TUCK),
            "OP_FROMALTSTACK" => builder = builder.push_opcode(opcodes::all::OP_FROMALTSTACK),
            "OP_TOALTSTACK" => builder = builder.push_opcode(opcodes::all::OP_TOALTSTACK),
            "OP_IFDUP" => builder = builder.push_opcode(opcodes::all::OP_IFDUP),
            "OP_DEPTH" => builder = builder.push_opcode(opcodes::all::OP_DEPTH),
            "OP_2OVER" => builder = builder.push_opcode(opcodes::all::OP_2OVER),
            "OP_2ROT" => builder = builder.push_opcode(opcodes::all::OP_2ROT),
            "OP_2SWAP" => builder = builder.push_opcode(opcodes::all::OP_2SWAP),
            "OP_3DUP" => builder = builder.push_opcode(opcodes::all::OP_3DUP),
            
            // Arithmetic
            "OP_ADD" => builder = builder.push_opcode(opcodes::all::OP_ADD),
            "OP_SUB" => builder = builder.push_opcode(opcodes::all::OP_SUB),
            "OP_MUL" => builder = builder.push_opcode(opcodes::all::OP_MUL),
            "OP_DIV" => builder = builder.push_opcode(opcodes::all::OP_DIV),
            "OP_MOD" => builder = builder.push_opcode(opcodes::all::OP_MOD),
            "OP_LSHIFT" => builder = builder.push_opcode(opcodes::all::OP_LSHIFT),
            "OP_RSHIFT" => builder = builder.push_opcode(opcodes::all::OP_RSHIFT),
            "OP_BOOLAND" => builder = builder.push_opcode(opcodes::all::OP_BOOLAND),
            "OP_BOOLOR" => builder = builder.push_opcode(opcodes::all::OP_BOOLOR),
            "OP_NUMEQUAL" => builder = builder.push_opcode(opcodes::all::OP_NUMEQUAL),
            "OP_NUMEQUALVERIFY" => builder = builder.push_opcode(opcodes::all::OP_NUMEQUALVERIFY),
            "OP_NUMNOTEQUAL" => builder = builder.push_opcode(opcodes::all::OP_NUMNOTEQUAL),
            "OP_LESSTHAN" => builder = builder.push_opcode(opcodes::all::OP_LESSTHAN),
            "OP_GREATERTHAN" => builder = builder.push_opcode(opcodes::all::OP_GREATERTHAN),
            "OP_LESSTHANOREQUAL" => builder = builder.push_opcode(opcodes::all::OP_LESSTHANOREQUAL),
            "OP_GREATERTHANOREQUAL" => builder = builder.push_opcode(opcodes::all::OP_GREATERTHANOREQUAL),
            "OP_MIN" => builder = builder.push_opcode(opcodes::all::OP_MIN),
            "OP_MAX" => builder = builder.push_opcode(opcodes::all::OP_MAX),
            "OP_WITHIN" => builder = builder.push_opcode(opcodes::all::OP_WITHIN),
            "OP_1NEGATE" => builder = builder.push_opcode(opcodes::all::OP_PUSHNUM_NEG1), // Alias
            "OP_NEGATE" => builder = builder.push_opcode(opcodes::all::OP_NEGATE),
            "OP_ABS" => builder = builder.push_opcode(opcodes::all::OP_ABS),
            "OP_NOT" => builder = builder.push_opcode(opcodes::all::OP_NOT),
            "OP_0NOTEQUAL" => builder = builder.push_opcode(opcodes::all::OP_0NOTEQUAL),
            
            // String/byte operations
            "OP_CAT" => builder = builder.push_opcode(opcodes::all::OP_CAT),
            "OP_SUBSTR" => builder = builder.push_opcode(opcodes::all::OP_SUBSTR),
            "OP_LEFT" => builder = builder.push_opcode(opcodes::all::OP_LEFT),
            "OP_RIGHT" => builder = builder.push_opcode(opcodes::all::OP_RIGHT),
            "OP_INVERT" => builder = builder.push_opcode(opcodes::all::OP_INVERT),
            "OP_AND" => builder = builder.push_opcode(opcodes::all::OP_AND),
            "OP_OR" => builder = builder.push_opcode(opcodes::all::OP_OR),
            "OP_XOR" => builder = builder.push_opcode(opcodes::all::OP_XOR),
            
            // Reserved words (these will fail script execution but are valid opcodes)
            "OP_RESERVED" => builder = builder.push_opcode(opcodes::all::OP_RESERVED),
            "OP_VER" => builder = builder.push_opcode(opcodes::all::OP_VER),
            "OP_VERIF" => builder = builder.push_opcode(opcodes::all::OP_VERIF),
            "OP_VERNOTIF" => builder = builder.push_opcode(opcodes::all::OP_VERNOTIF),
            "OP_RESERVED1" => builder = builder.push_opcode(opcodes::all::OP_RESERVED1),
            "OP_RESERVED2" => builder = builder.push_opcode(opcodes::all::OP_RESERVED2),
            
            // Alternative hash functions (disabled by default)
            "OP_SHA1" => builder = builder.push_opcode(opcodes::all::OP_SHA1),
            "OP_MD5" => builder = builder.push_opcode(opcodes::all::OP_HASH160), // MD5 not in bitcoin lib, using HASH160 as fallback
            
            // NOP operations
            "OP_NOP" => builder = builder.push_opcode(opcodes::all::OP_NOP),
            "OP_NOP1" => builder = builder.push_opcode(opcodes::all::OP_NOP1),
            "OP_NOP4" => builder = builder.push_opcode(opcodes::all::OP_NOP4),
            "OP_NOP5" => builder = builder.push_opcode(opcodes::all::OP_NOP5),
            "OP_NOP6" => builder = builder.push_opcode(opcodes::all::OP_NOP6),
            "OP_NOP7" => builder = builder.push_opcode(opcodes::all::OP_NOP7),
            "OP_NOP8" => builder = builder.push_opcode(opcodes::all::OP_NOP8),
            "OP_NOP9" => builder = builder.push_opcode(opcodes::all::OP_NOP9),
            "OP_NOP10" => builder = builder.push_opcode(opcodes::all::OP_NOP10),
            
            // Additional push operations
            "OP_PUSHDATA1" => builder = builder.push_opcode(opcodes::all::OP_PUSHDATA1),
            "OP_PUSHDATA2" => builder = builder.push_opcode(opcodes::all::OP_PUSHDATA2),
            "OP_PUSHDATA4" => builder = builder.push_opcode(opcodes::all::OP_PUSHDATA4),
            
            // Handle OP_PUSHBYTES_* opcodes - these should be followed by hex data
            pushbytes if pushbytes.starts_with("OP_PUSHBYTES_") => {
                // OP_PUSHBYTES_33 means "push next 33 bytes"
                if let Ok(expected_size) = pushbytes.strip_prefix("OP_PUSHBYTES_").unwrap().parse::<usize>() {
                    if expected_size <= 75 {
                        // Get the next token which should be the hex data
                        if i + 1 < parts.len() {
                            let hex_data = parts[i + 1];
                            if hex_data.len() % 2 == 0 && hex_data.chars().all(|c| c.is_ascii_hexdigit()) {
                                let bytes = hex::decode(hex_data).map_err(|_| "Invalid hex data after OP_PUSHBYTES")?;
                                if bytes.len() == expected_size {
                                    let push_bytes = PushBytesBuf::try_from(bytes).map_err(|_| "Invalid push bytes")?;
                                    builder = builder.push_slice(push_bytes);
                                    i += 1; // Skip the next token since we consumed it
                                } else {
                                    return Err(format!("OP_PUSHBYTES_{} expects {} bytes, got {} bytes", expected_size, expected_size, bytes.len()));
                                }
                            } else {
                                return Err(format!("Expected hex data after {}, got: {}", pushbytes, hex_data));
                            }
                        } else {
                            return Err(format!("Missing hex data after {}", pushbytes));
                        }
                    } else {
                        return Err(format!("Invalid pushbytes size: {}", expected_size));
                    }
                } else {
                    return Err(format!("Invalid OP_PUSHBYTES format: {}", pushbytes));
                }
            },
            
            // If it looks like hex data, treat it as a data push
            hex_data if hex_data.len() > 2 && hex_data.len() % 2 == 0 && hex_data.chars().all(|c| c.is_ascii_hexdigit()) => {
                let bytes = hex::decode(hex_data).map_err(|_| "Invalid hex in ASM")?;
                let push_bytes = PushBytesBuf::try_from(bytes).map_err(|_| "Invalid push bytes")?;
                builder = builder.push_slice(push_bytes);
            },
            
            // Try to parse as number
            num_str => {
                if let Ok(num) = num_str.parse::<i64>() {
                    builder = builder.push_int(num);
                } else {
                    return Err(format!("Unsupported opcode or invalid data: {}", part));
                }
            }
        }
        i += 1; // Move to next token
    }
    
    Ok(builder.into_script())
}

// Previous complex parser - commented out
/*
fn parse_asm_to_script_old(asm: &str) -> Result<ScriptBuf, String> {
    // ... old implementation
}
*/


// Helper function to extract parse_insane and parse errors from combined error message
fn extract_parse_errors(error_msg: &str) -> Option<(String, String)> {
    // The error format is: "Script lift failed - parse_insane: <error1>, parse: <error2>"
    if let Some(pos) = error_msg.find("parse_insane: ") {
        let after_insane = &error_msg[pos + 14..]; // Skip "parse_insane: "
        if let Some(comma_pos) = after_insane.find(", parse: ") {
            let insane_err = after_insane[..comma_pos].to_string();
            let parse_err = after_insane[comma_pos + 9..].to_string(); // Skip ", parse: "
            return Some((insane_err, parse_err));
        }
    }
    None
}

fn perform_lift_to_miniscript(bitcoin_script: &str) -> Result<String, String> {
    if bitcoin_script.trim().is_empty() {
        return Err("Empty Bitcoin script".to_string());
    }
    
    let trimmed = bitcoin_script.trim();
    console_log!("Processing Bitcoin script ASM: {}", trimmed);
    
    // For ASM input, we need to convert it to a script
    // For simplicity, let's try to parse the hex directly if it looks like hex
    // Or handle some common ASM patterns
    
    let script = if trimmed.len() % 2 == 0 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        // Looks like hex, try to decode as script bytes
        match hex::decode(trimmed) {
            Ok(bytes) => ScriptBuf::from_bytes(bytes),
            Err(_) => return Err("Invalid hex script".to_string()),
        }
    } else {
        // Try to parse as ASM
        match parse_asm_to_script(trimmed) {
            Ok(script) => script,
            Err(e) => return Err(format!("Failed to parse ASM: {}", e)),
        }
    };
    
    console_log!("Successfully parsed Bitcoin script, length: {} bytes", script.len());
    
    // Structure to hold detailed error info for each context
    struct ContextError {
        parse_insane_err: String,
        parse_err: String,
    }
    
    let mut context_errors = Vec::new();
    
    // Try to lift the script to miniscript for different contexts
    // Start with Legacy context
    match try_lift_script_to_miniscript::<miniscript::Legacy>(script.as_script()) {
        Ok(ms) => return Ok(ms),
        Err(e) => {
            // Extract the detailed errors from the combined error message
            if let Some((insane_err, parse_err)) = extract_parse_errors(&e) {
                context_errors.push(("Legacy", ContextError {
                    parse_insane_err: insane_err,
                    parse_err: parse_err,
                }));
            } else {
                context_errors.push(("Legacy", ContextError {
                    parse_insane_err: e.clone(),
                    parse_err: e.clone(),
                }));
            }
            console_log!("Legacy lift failed: {}", e);
        }
    }
    
    // Try Segwit context
    match try_lift_script_to_miniscript::<miniscript::Segwitv0>(script.as_script()) {
        Ok(ms) => return Ok(ms),
        Err(e) => {
            if let Some((insane_err, parse_err)) = extract_parse_errors(&e) {
                context_errors.push(("Segwit", ContextError {
                    parse_insane_err: insane_err,
                    parse_err: parse_err,
                }));
            } else {
                context_errors.push(("Segwit", ContextError {
                    parse_insane_err: e.clone(),
                    parse_err: e.clone(),
                }));
            }
            console_log!("Segwit lift failed: {}", e);
        }
    }
    
    // Try Taproot context  
    match try_lift_script_to_miniscript::<miniscript::Tap>(script.as_script()) {
        Ok(ms) => return Ok(ms),
        Err(e) => {
            if let Some((insane_err, parse_err)) = extract_parse_errors(&e) {
                context_errors.push(("Taproot", ContextError {
                    parse_insane_err: insane_err,
                    parse_err: parse_err,
                }));
            } else {
                context_errors.push(("Taproot", ContextError {
                    parse_insane_err: e.clone(),
                    parse_err: e.clone(),
                }));
            }
            console_log!("Taproot lift failed: {}", e);
        }
    }
    
    // Format the error message with better structure
    let mut error_msg = String::from("❌ Script is not liftable to Miniscript\n\n");
    error_msg.push_str("This Bitcoin script cannot be lifted to miniscript. Attempted lifting with both standard and non-standard parsers across all contexts:\n\n");
    
    for (context_name, errors) in context_errors {
        error_msg.push_str(&format!("📍 {} Context:\n", context_name));
        error_msg.push_str(&format!("   • parse_insane: ❌ {}\n", errors.parse_insane_err));
        error_msg.push_str(&format!("   • parse: ❌ {}\n\n", errors.parse_err));
    }
    
    error_msg.push_str("Note: Scripts containing raw public key hashes (P2PKH) or certain non-miniscript constructs cannot be lifted.");
    
    Err(error_msg)
}

fn try_lift_script_to_miniscript<Ctx>(script: &bitcoin::Script) -> Result<String, String> 
where 
    Ctx: miniscript::ScriptContext,
    for<'a> Ctx::Key: std::fmt::Display + std::str::FromStr,
    <Ctx::Key as std::str::FromStr>::Err: std::fmt::Display,
{
    console_log!("Attempting to lift script to miniscript...");
    
    // First try parse_insane which accepts non-standard but valid miniscripts
    match Miniscript::<Ctx::Key, Ctx>::parse_insane(script) {
        Ok(ms) => {
            let ms_string = ms.to_string();
            console_log!("Successfully lifted to miniscript using parse_insane: {}", ms_string);
            Ok(ms_string)
        }
        Err(insane_err) => {
            console_log!("parse_insane failed: {}", insane_err);
            // Fallback to regular parse - might catch some edge cases
            match Miniscript::<Ctx::Key, Ctx>::parse(script) {
                Ok(ms) => {
                    let ms_string = ms.to_string();
                    console_log!("Successfully lifted to miniscript using parse (note: analysis failed with parse_insane): {}", ms_string);
                    console_log!("parse_insane error was: {}", insane_err);
                    Ok(ms_string)
                }
                Err(parse_err) => {
                    console_log!("Both parse_insane and parse failed");
                    Err(format!("Script lift failed - parse_insane: {}, parse: {}", insane_err, parse_err))
                }
            }
        }
    }
}

fn perform_lift_to_policy(miniscript: &str) -> Result<String, String> {
    if miniscript.trim().is_empty() {
        return Err("Empty miniscript".to_string());
    }
    
    let trimmed = miniscript.trim();
    console_log!("Processing miniscript for policy lift: {}", trimmed);
    
    // Try to parse the miniscript and lift it to policy using concrete implementations
    
    // Try Legacy context first
    match trimmed.parse::<Miniscript<PublicKey, Legacy>>() {
        Ok(ms) => {
            console_log!("Attempting to lift miniscript to policy (Legacy)");
            match ms.lift() {
                Ok(policy) => {
                    let policy_string = policy.to_string();
                    console_log!("Successfully lifted miniscript to policy (Legacy): {}", policy_string);
                    return Ok(policy_string);
                }
                Err(e) => console_log!("Legacy miniscript->policy lift failed: {}", e),
            }
        }
        Err(e) => console_log!("Legacy miniscript parsing failed: {}", e),
    }
    
    // Try Segwit context
    match trimmed.parse::<Miniscript<PublicKey, Segwitv0>>() {
        Ok(ms) => {
            console_log!("Attempting to lift miniscript to policy (Segwit)");
            match ms.lift() {
                Ok(policy) => {
                    let policy_string = policy.to_string();
                    console_log!("Successfully lifted miniscript to policy (Segwit): {}", policy_string);
                    return Ok(policy_string);
                }
                Err(e) => console_log!("Segwit miniscript->policy lift failed: {}", e),
            }
        }
        Err(e) => console_log!("Segwit miniscript parsing failed: {}", e),
    }
    
    // Try Taproot context with XOnlyPublicKey
    match trimmed.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        Ok(ms) => {
            console_log!("Attempting to lift miniscript to policy (Taproot)");
            match ms.lift() {
                Ok(policy) => {
                    let policy_string = policy.to_string();
                    console_log!("Successfully lifted miniscript to policy (Taproot): {}", policy_string);
                    return Ok(policy_string);
                }
                Err(e) => console_log!("Taproot miniscript->policy lift failed: {}", e),
            }
        }
        Err(e) => console_log!("Taproot miniscript parsing failed: {}", e),
    }
    
    Err("Cannot lift this miniscript to policy in any context (Legacy, Segwit, Taproot). The miniscript may not be liftable or may have parsing issues.".to_string())
}


#[derive(Serialize, Deserialize)]
pub struct AddressResult {
    pub success: bool,
    pub address: Option<String>,
    pub error: Option<String>,
}

#[wasm_bindgen]
pub fn generate_address_for_network(script_hex: &str, script_type: &str, network: &str) -> JsValue {
    console_log!("Generating address for script: {} type: {} network: {}", script_hex, script_type, network);
    
    // Parse network
    let network_enum = match network.to_lowercase().as_str() {
        "mainnet" | "bitcoin" => Network::Bitcoin,
        "testnet" => Network::Testnet,
        _ => {
            let result = AddressResult {
                success: false,
                address: None,
                error: Some("Invalid network. Use 'mainnet' or 'testnet'".to_string()),
            };
            return serde_wasm_bindgen::to_value(&result).unwrap();
        }
    };
    
    // Decode hex script
    let script_bytes = match hex::decode(script_hex) {
        Ok(bytes) => bytes,
        Err(_) => {
            let result = AddressResult {
                success: false,
                address: None,
                error: Some("Invalid hex script".to_string()),
            };
            return serde_wasm_bindgen::to_value(&result).unwrap();
        }
    };
    
    let script = ScriptBuf::from_bytes(script_bytes);
    
    // Generate address based on script type
    let address = match script_type {
        "Legacy" => {
            match Address::p2sh(&script, network_enum) {
                Ok(addr) => Some(addr.to_string()),
                Err(_) => None,
            }
        },
        "Segwit v0" => {
            Some(Address::p2wsh(&script, network_enum).to_string())
        },
        "Taproot" => {
            generate_taproot_address(&script, network_enum)
        },
        _ => None,
    };
    
    let success = address.is_some();
    let error = if !success {
        Some(format!("Failed to generate {} address for {}", script_type, network))
    } else {
        None
    };
    
    let result = AddressResult {
        success,
        address,
        error,
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

#[wasm_bindgen(start)]
pub fn main() {
    console_log!("=== REAL MINISCRIPT WASM MODULE LOADED ===");
    console_log!("Module initialization complete");
}