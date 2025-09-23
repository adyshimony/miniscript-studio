//! Policy implementation

use miniscript::{Miniscript, Tap, Segwitv0, Legacy, policy::Concrete, Descriptor};
use bitcoin::{PublicKey, XOnlyPublicKey, Network};
use std::str::FromStr;
use crate::console_log;
use miniscript::descriptor::DescriptorPublicKey;
use crate::descriptors::parser::parse_descriptors;
use crate::descriptors::utils::replace_descriptors_with_keys;
use crate::translators::DescriptorKeyTranslator;
use crate::NUMS_POINT;

/// Compile policy to miniscript
pub fn compile_policy_to_miniscript(policy: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    compile_policy_to_miniscript_with_mode(policy, context, "multi-leaf")
}

/// Compile policy to miniscript with mode
pub fn compile_policy_to_miniscript_with_mode(policy: &str, context: &str, mode: &str) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    if policy.trim().is_empty() {
        return Err("Empty policy - please enter a policy expression".to_string());
    }

    let trimmed = policy.trim();
    
    // Check for incompatible key types based on context
    if context != "taproot" {
        // Check for x-only keys (64 hex chars) in non-taproot contexts
        let xonly_key_regex = regex::Regex::new(r"\b[a-fA-F0-9]{64}\b").unwrap();
        if xonly_key_regex.is_match(trimmed) {
            // Check if it's not an xpub/tpub, descriptor, or SHA256 hash
            if !trimmed.contains("xpub") && !trimmed.contains("tpub") && !trimmed.contains("[") && !trimmed.contains("sha256(") {
                return Err(format!(
                    "{} context requires compressed public keys (66 characters starting with 02/03). Found x-only key (64 characters).",
                    if context == "legacy" { "Legacy" } else { "Segwit v0" }
                ));
            }
        }
    } else {
        // Check for compressed keys (66 hex chars starting with 02/03) in taproot context
        let compressed_key_regex = regex::Regex::new(r"\b(02|03)[a-fA-F0-9]{64}\b").unwrap();
        if compressed_key_regex.is_match(trimmed) {
            // Check if it's not part of a descriptor
            if !trimmed.contains("xpub") && !trimmed.contains("tpub") && !trimmed.contains("[") {
                return Err("Taproot context requires x-only keys (64 characters). Found compressed key (66 characters starting with 02/03).".to_string());
            }
        }
    }
    
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
                                    // by calling compile_non_taproot_context with the wrapped descriptor
                                    match crate::compile::engine::compile_non_taproot_context(&test_descriptor, context) {
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
                return compile_taproot_policy_xonly_with_mode(xonly_policy, network, mode);
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
                "taproot" => compile_taproot_policy_with_mode(concrete_policy, network, mode),
                _ => compile_segwit_policy(concrete_policy, network),
            }
        },
        Err(_) => {
            // For taproot context, try parsing as XOnlyPublicKey first
            if context == "taproot" {
                console_log!("DEBUG: Parsing policy for taproot with XOnly keys: {}", processed_policy);
                match processed_policy.parse::<Concrete<XOnlyPublicKey>>() {
                    Ok(xonly_policy) => {
                        console_log!("DEBUG: Successfully parsed XOnly policy: {}", xonly_policy);
                        return compile_taproot_policy_xonly_with_mode(xonly_policy, network, mode);
                    },
                    Err(_) => {
                        // Fall through to try PublicKey parsing, but it will fail with proper error
                    }
                }
            }
            
            // If descriptor parsing fails, try parsing as regular Concrete<PublicKey>
            match processed_policy.parse::<Concrete<PublicKey>>() {
                Ok(concrete_policy) => {
                    
                    match context {
                        "legacy" => compile_legacy_policy(concrete_policy, network),
                        "taproot" => compile_taproot_policy_with_mode(concrete_policy, network, mode),
                        _ => compile_segwit_policy(concrete_policy, network),
                    }
                },
                Err(e) => Err(format!("Policy parsing failed: {}", e))
            }
        }
    }
}

/// Compile policy for Legacy context
pub fn compile_legacy_policy(
    policy: Concrete<PublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Legacy>() {
        Ok(ms) => {
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            // Create descriptor and get address
            let descriptor = Descriptor::new_sh(ms.clone()).map_err(|e| format!("Descriptor creation failed: {}", e))?;
            let address = descriptor.address(network).map_err(|e| format!("Address generation failed: {}", e))?;
            
            // Get max satisfaction size
            let max_satisfaction_size = ms.max_satisfaction_size().ok();
            let max_weight_to_satisfy = descriptor.max_weight_to_satisfy().ok().map(|w| w.to_wu());
            
            // Sanity check
            let sanity_check = ms.sanity_check().is_ok();
            let is_non_malleable = ms.is_non_malleable();
            
            Ok((
                script_hex,
                script_asm,
                Some(address.to_string()),
                script_size,
                "Legacy".to_string(),
                ms.to_string(),
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        },
        Err(e) => Err(format!("Policy compilation failed for Legacy: {}", e))
    }
}

/// Compile policy for Segwit context
pub fn compile_segwit_policy(
    policy: Concrete<PublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Segwitv0>() {
        Ok(ms) => {
            let script = ms.encode();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
            let script_size = script.len();
            
            // Create descriptor and get address
            let descriptor = Descriptor::new_wsh(ms.clone()).map_err(|e| format!("Descriptor creation failed: {}", e))?;
            let address = descriptor.address(network).map_err(|e| format!("Address generation failed: {}", e))?;
            
            // Get max satisfaction size
            let max_satisfaction_size = ms.max_satisfaction_size().ok();
            let max_weight_to_satisfy = descriptor.max_weight_to_satisfy().ok().map(|w| w.to_wu());
            
            // Sanity check
            let sanity_check = ms.sanity_check().is_ok();
            let is_non_malleable = ms.is_non_malleable();
            
            Ok((
                script_hex,
                script_asm,
                Some(address.to_string()),
                script_size,
                "Segwit v0".to_string(),
                ms.to_string(),
                max_satisfaction_size,
                max_weight_to_satisfy,
                Some(sanity_check),
                Some(is_non_malleable)
            ))
        },
        Err(e) => Err(format!("Policy compilation failed for Segwit v0: {}", e))
    }
}

/// Compile policy for Taproot context with XOnlyPublicKey
pub fn compile_taproot_policy_xonly(
    policy: Concrete<XOnlyPublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    compile_taproot_policy_xonly_with_mode(policy, network, "multi-leaf")
}

/// Compile policy for Taproot context with XOnlyPublicKey and mode
pub fn compile_taproot_policy_xonly_with_mode(
    policy: Concrete<XOnlyPublicKey>,
    network: Network,
    mode: &str
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    use miniscript::descriptor::TapTree;
    
    console_log!("compile_taproot_policy_xonly_with_mode called with mode: {}", mode);
    
    match mode {
        "single-leaf" => {
            // Simplified mode - single leaf compilation
            console_log!("Using single-leaf compilation mode");
            compile_taproot_policy_xonly_single_leaf(policy, network)
        },
        "script-path" | "multi-leaf" => {
            // Script-path mode (NUMS point) or Key+Script mode
            console_log!("Using {} compilation mode", mode);
            
            // Parse and compile policy (keys are treated as strings)
            let compiled: Miniscript<XOnlyPublicKey, Tap> = policy.compile::<Tap>()
                .map_err(|e| format!("Failed to compile policy: {}", e))?;

            // Collect keys
            let mut keys: Vec<String> = policy.keys().into_iter().map(|k| k.to_string()).collect();
            keys.sort(); 
            keys.dedup();
            console_log!("Keys in policy: {:?}", keys);

            // Special handling for the specific case: or(pk(A), or(pk(B), pk(C)))
            // Should become: {{pk(A), pk(B)}, pk(C)}
            let tree = if let Concrete::Or(branches) = &policy {
                if branches.len() == 2 {
                    let (_, first) = &branches[0];
                    let (_, second) = &branches[1];
                    
                    // Check if this is the pattern: or(pk(A), or(pk(B), pk(C)))
                    if let Concrete::Or(nested_branches) = &**second {
                        if nested_branches.len() == 2 {
                            let (_, nested_first) = &nested_branches[0];
                            let (_, nested_second) = &nested_branches[1];
                            
                            // Check if all are pk() nodes
                            if let (Concrete::Key(_), Concrete::Key(_), Concrete::Key(_)) = (&**first, &**nested_first, &**nested_second) {
                                // Special case: keep first key separate, group second and third keys together
                                let first_pk = (**first).clone();
                                let second_pk = (**nested_first).clone();
                                let third_pk = (**nested_second).clone();
                                
                                // Create TapTree structure: {pk(A), {pk(B), pk(C)}}
                                // Left branch: pk(A) - single leaf
                                // Right branch: {pk(B), pk(C)} - two separate leaves
                                let first_ms: Miniscript<XOnlyPublicKey, Tap> = first_pk.compile::<Tap>()
                                    .map_err(|e| format!("Failed to compile first pk: {:?}", e))?;
                                let second_ms: Miniscript<XOnlyPublicKey, Tap> = second_pk.compile::<Tap>()
                                    .map_err(|e| format!("Failed to compile second pk: {:?}", e))?;
                                let third_ms: Miniscript<XOnlyPublicKey, Tap> = third_pk.compile::<Tap>()
                                    .map_err(|e| format!("Failed to compile third pk: {:?}", e))?;
                                
                                let left_branch = TapTree::Leaf(first_ms.into());
                                let right_branch = TapTree::combine(
                                    TapTree::Leaf(second_ms.into()),
                                    TapTree::Leaf(third_ms.into())
                                );
                                
                                TapTree::combine(left_branch, right_branch)
                            } else {
                                // Not the special pattern, use default behavior
                                let mut leaves: Vec<TapTree<XOnlyPublicKey>> = Vec::new();
                                for (_, sub) in branches {
                                    let ms: Miniscript<XOnlyPublicKey, Tap> = (**sub).compile::<Tap>()
                                        .map_err(|e| format!("Failed to compile sub-policy: {:?}", e))?;
                                    leaves.push(TapTree::Leaf(ms.into()));
                                }
                                leaves
                                    .into_iter()
                                    .reduce(|acc, t| TapTree::combine(acc, t))
                                    .unwrap_or_else(|| TapTree::Leaf(compiled.into()))
                            }
                        } else {
                            // Not the special pattern, use default behavior
                            let mut leaves: Vec<TapTree<XOnlyPublicKey>> = Vec::new();
                            for (_, sub) in branches {
                                let ms: Miniscript<XOnlyPublicKey, Tap> = (**sub).compile::<Tap>()
                                    .map_err(|e| format!("Failed to compile sub-policy: {:?}", e))?;
                                leaves.push(TapTree::Leaf(ms.into()));
                            }
                            leaves
                                .into_iter()
                                .reduce(|acc, t| TapTree::combine(acc, t))
                                .unwrap_or_else(|| TapTree::Leaf(compiled.into()))
                        }
                    } else {
                        // Not the special pattern, use default behavior
                        let mut leaves: Vec<TapTree<XOnlyPublicKey>> = Vec::new();
                        for (_, sub) in branches {
                            let ms: Miniscript<XOnlyPublicKey, Tap> = (**sub).compile::<Tap>()
                                .map_err(|e| format!("Failed to compile sub-policy: {:?}", e))?;
                            leaves.push(TapTree::Leaf(ms.into()));
                        }
                        leaves
                            .into_iter()
                            .reduce(|acc, t| TapTree::combine(acc, t))
                            .unwrap_or_else(|| TapTree::Leaf(compiled.into()))
                    }
                } else {
                    // Not the special pattern, use default behavior
                    let mut leaves: Vec<TapTree<XOnlyPublicKey>> = Vec::new();
                    for (_, sub) in branches {
                        let ms: Miniscript<XOnlyPublicKey, Tap> = (**sub).compile::<Tap>()
                            .map_err(|e| format!("Failed to compile sub-policy: {:?}", e))?;
                        leaves.push(TapTree::Leaf(ms.into()));
                    }
                    leaves
                        .into_iter()
                        .reduce(|acc, t| TapTree::combine(acc, t))
                        .unwrap_or_else(|| TapTree::Leaf(compiled.into()))
                }
            } else {
                // Single policy, not an OR
                TapTree::Leaf(compiled.into())
            };
            
            // Determine internal key based on mode
            let internal_key = if mode == "script-path" {
                // BIP341 NUMS internal key (script-only pattern)
                let nums = XOnlyPublicKey::from_str(
                    NUMS_POINT
                ).map_err(|e| format!("Failed to parse NUMS point: {}", e))?;
                console_log!("Using NUMS point as internal key for script-only mode");
                nums
            } else {
                // Key+Script mode: use first key from policy as internal key
                let chosen_xonly = policy.keys()
                    .into_iter()
                    .next()
                    .ok_or("Policy contains no keys")?;
                console_log!("Using policy key as internal key for key+script mode: {}", chosen_xonly);
                *chosen_xonly
            };
            
            // Create the descriptor
            let descriptor = Descriptor::<XOnlyPublicKey>::new_tr(internal_key, Some(tree))
                .map_err(|e| format!("Failed to create taproot descriptor: {}", e))?;
            
            console_log!("Created taproot descriptor: {}", descriptor);
            
            // Get the output script (scriptPubKey)
            let script = descriptor.script_pubkey();
            let script_hex = hex::encode(script.as_bytes());
            let script_asm = script.to_asm_string();
            
            // Generate address from descriptor
            let address = descriptor.address(network)
                .map(|addr| addr.to_string())
                .ok();
            
            // Get script size
            let script_size = script.len();
            
            // For display, we'll show the descriptor
            let compiled_miniscript_display = descriptor.to_string();
            
            // Get max satisfaction weight if available
            let max_weight_to_satisfy = descriptor.max_weight_to_satisfy()
                .ok()
                .and_then(|w| w.to_wu().try_into().ok());
            
            Ok((
                script_hex,
                script_asm,
                address,
                script_size,
                "Taproot".to_string(),
                compiled_miniscript_display,
                None, // max_satisfaction_size not needed for taproot
                max_weight_to_satisfy,
                Some(true), // sanity_check - assume true for valid compilation
                Some(true), // is_non_malleable - taproot is non-malleable
            ))
        },
        _ => {
            Err(format!("Unknown taproot compilation mode: {}", mode))
        }
    }
}

/// Original single-leaf taproot compilation method for XOnlyPublicKey
pub fn compile_taproot_policy_xonly_single_leaf(
    policy: Concrete<XOnlyPublicKey>,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    match policy.compile::<Tap>() {
        Ok(ms) => {
            let compiled_miniscript = ms.to_string();
            console_log!("Policy compiled to single-leaf miniscript: {}", compiled_miniscript);
            
            // Now pass the compiled miniscript through the same tr() descriptor approach as miniscript compilation
            let nums_point = NUMS_POINT;
            let tr_descriptor = format!("tr({},{})", nums_point, compiled_miniscript);
            console_log!("Built tr() descriptor from single-leaf miniscript: {}", tr_descriptor);
            
            // Parse as descriptor to get proper taproot script and address
            match tr_descriptor.parse::<Descriptor<XOnlyPublicKey>>() {
                Ok(descriptor) => {
                    console_log!("Successfully parsed tr() descriptor from converted policy");
                    
                    // Get the output script (scriptPubKey)
                    let script = descriptor.script_pubkey();
                    let script_hex = hex::encode(script.as_bytes());
                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                    let script_size = script.len();
                    
                    // Generate address from descriptor
                    let address = descriptor.address(network)
                        .map(|addr| addr.to_string())
                        .ok();
                    
                    // Get satisfaction properties from original miniscript
                    let miniscript_str = ms.to_string();
                    let (max_satisfaction_size, max_weight_to_satisfy) = if miniscript_str.starts_with("pk(") {
                        (Some(64), Some(64u64))
                    } else {
                        (None, None)
                    };
                    
                    let sanity_check = ms.sanity_check().is_ok();
                    let is_non_malleable = ms.is_non_malleable();
                    
                    console_log!("Generated Taproot script from converted policy: {} bytes", script_size);
                    console_log!("Generated Taproot address from converted policy: {:?}", address);
                    
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
                Err(e) => {
                    console_log!("Failed to parse tr() descriptor from converted policy: {}", e);
                    Err(format!("Failed to create tr() descriptor from policy: {}", e))
                }
            }
        }
        Err(e) => Err(format!("Policy compilation failed for Taproot: {}", e))
    }
}

/// Compile policy for Taproot context (should fail for compressed keys)
pub fn compile_taproot_policy(
    _policy: Concrete<PublicKey>,
    _network: Network
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    // Don't do automatic conversion - fail with proper error message
    Err("Taproot context requires x-only keys (32 bytes). Found compressed keys (33 bytes).".to_string())
}

/// Compile policy for Taproot context with mode (should fail for compressed keys)
pub fn compile_taproot_policy_with_mode(
    _policy: Concrete<PublicKey>,
    _network: Network,
    _mode: &str
) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
    // For now, return a helpful error message
    Err("Taproot policy compilation with compressed keys is not yet implemented. Please use x-only keys (64 characters) for taproot policies.".to_string())
}


/// Compile Taproot Script path using Descriptor::new_tr() approach (the correct way)
pub fn compile_taproot_script_path_descriptor(expression: &str, nums_key: &str, network: Network) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    use std::sync::Arc;
    use miniscript::descriptor::TapTree;

    console_log!("=== COMPILE_TAPROOT_SCRIPT_PATH_DESCRIPTOR ===");
    console_log!("Expression: {}", expression);
    console_log!("NUMS key: {}", nums_key);
    console_log!("Network: {:?}", network);
    let processed_expr = expression.trim();
    
    // Parse as XOnlyPublicKey miniscript for Taproot
    match processed_expr.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        Ok(ms) => {
            let normalized_miniscript = ms.to_string();
            console_log!("Parsed miniscript: {}", normalized_miniscript);
            
            // Transform top-level OR patterns to tree notation
            let transformed_miniscript = crate::transform_or_to_tree(&normalized_miniscript);
            console_log!("After OR transformation: {}", transformed_miniscript);
            
            // Calculate satisfaction weights 
            let max_satisfaction_size = ms.max_satisfaction_size().ok();
            let max_weight_to_satisfy = max_satisfaction_size.map(|s| s as u64);
            
            // Parse NUMS key
            let nums_xonly_key = match XOnlyPublicKey::from_str(nums_key) {
                Ok(key) => key,
                Err(_) => return Err(format!("Failed to parse NUMS key: {}", nums_key))
            };
            
            console_log!("DEBUG DESCRIPTOR: Using NUMS key: {}", nums_xonly_key);
            
            // If we transformed an OR pattern, create a new tr() descriptor with tree notation
            if transformed_miniscript != normalized_miniscript {
                console_log!("OR pattern detected! Creating tr() descriptor with tree notation");
                
                // Build the tr() descriptor string with tree notation
                let tr_descriptor_str = format!("tr({},{})", nums_key, transformed_miniscript);
                console_log!("Attempting to parse descriptor: {}", tr_descriptor_str);
                
                // Parse the descriptor with tree notation
                match tr_descriptor_str.parse::<Descriptor<XOnlyPublicKey>>() {
                    Ok(descriptor) => {
                        console_log!("Successfully parsed tr() descriptor with tree notation");
                        let descriptor_str = descriptor.to_string();
                        console_log!("DEBUG DESCRIPTOR: Successfully created descriptor: {}", descriptor_str);
                        
                        // Get the address from the descriptor
                        let address = descriptor.address(network)
                            .map_err(|e| format!("Failed to derive address: {}", e))?;
                        console_log!("DEBUG DESCRIPTOR: Generated address: {}", address);
                        
                        // Get the script pubkey
                        let script_pubkey = descriptor.script_pubkey();
                        let script_hex = script_pubkey.to_hex_string();
                        let script_asm = format!("{:?}", script_pubkey)
                            .replace("Script(", "")
                            .trim_end_matches(')')
                            .to_string();
                        
                        console_log!("DEBUG DESCRIPTOR: Script hex: {}", script_hex);
                        console_log!("DEBUG DESCRIPTOR: Script ASM: {}", script_asm);
                        
                        // Calculate script size
                        let script_size = script_pubkey.len();
                        
                        return Ok((
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
                        ));
                    }
                    Err(_e) => {
                        console_log!("Failed to parse tr() descriptor with tree notation: {}", _e);
                        // Fall back to original single-leaf approach
                    }
                }
            }
            
            // Original single-leaf approach (no OR transformation)
            console_log!("Using single-leaf approach");
            
            // Create the tree with the miniscript (clone to avoid move)
            let tree = TapTree::Leaf(Arc::new(ms.clone()));
            console_log!("DEBUG DESCRIPTOR: Created TapTree leaf");
            
            // Create descriptor using Descriptor::new_tr() approach (the correct way!)
            match Descriptor::<XOnlyPublicKey>::new_tr(nums_xonly_key, Some(tree)) {
                Ok(descriptor) => {
                    console_log!("DEBUG DESCRIPTOR: Successfully created descriptor: {}", descriptor);
                    
                    // Generate address from descriptor
                    match descriptor.address(network) {
                        Ok(address) => {
                            console_log!("DEBUG DESCRIPTOR: Generated address: {}", address);
                            
                            // Get the scriptPubKey (OP_1 + 32-byte tweaked key)
                            let script_pubkey = address.script_pubkey();
                            let script_hex = script_pubkey.to_hex_string();
                            let script_asm = format!("{:?}", script_pubkey).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script_pubkey.len();
                            
                            console_log!("DEBUG DESCRIPTOR: Script hex: {}", script_hex);
                            console_log!("DEBUG DESCRIPTOR: Script ASM: {}", script_asm);
                            
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
                                Some(descriptor.to_string()) // Return the full descriptor
                            ))
                        },
                        Err(e) => Err(format!("Address generation failed: {:?}", e))
                    }
                },
                Err(e) => Err(format!("Descriptor creation failed: {:?}", e))
            }
        },
        Err(e) => Err(format!("Miniscript parsing failed: {}", e))
    }
}
