//! Compilation engine - unified interface preserving all existing logic
//!
//! This engine provides a single entry point for all compilation while
//! carefully preserving all existing behavior including special cases
//! for taproot, descriptors, ranges, etc.

use crate::compile::options::{CompileOptions, InputType, CompileContext};
use crate::types::CompilationResult;
use crate::console_log;
use bitcoin::Network;
use crate::parse::helpers::{detect_network, needs_descriptor_processing, is_descriptor_wrapper};
use crate::descriptors::parser::parse_descriptors;
use crate::validation;
#[allow(unused_imports)] // Used in function parameters
use std::collections::HashMap;
#[allow(unused_imports)] // Used in function parameters
use crate::descriptors::types::ParsedDescriptor;
use miniscript::{Descriptor, DescriptorPublicKey};
use std::str::FromStr;

/// Unified compilation entry point
///
/// This function routes to the appropriate compilation logic based on options
/// while preserving ALL existing behavior including:
/// - Taproot mode selection (single-leaf, multi-leaf, script-path)
/// - Descriptor processing (ranges, wildcards, etc.)
/// - Network detection and address generation
/// - Key type validation
pub fn compile_unified(expression: &str, options: CompileOptions) -> Result<CompilationResult, String> {
    console_log!("=== UNIFIED COMPILE ===");
    console_log!("Expression: {}", expression);
    console_log!("Options: input_type={:?}, context={}, mode={}, network={:?}",
        options.input_type, options.context.as_str(), options.mode.as_str(), options.network());

    // Route based on input type
    match options.input_type {
        InputType::Policy => compile_policy_unified(expression, options),
        InputType::Miniscript => compile_miniscript_unified(expression, options),
    }
}

/// Compile policy with unified options
fn compile_policy_unified(policy: &str, options: CompileOptions) -> Result<CompilationResult, String> {
    // Preserve exact logic from compile_policy_to_miniscript_with_mode
    let context_str = options.context.as_str();
    let mode_str = options.mode.as_str();

    // Call the existing policy compilation function to preserve all logic
    match crate::compile::policy::compile_policy_to_miniscript_with_mode(policy, context_str, mode_str) {
        Ok((script, script_asm, address, script_size, ms_type, compiled_miniscript,
            max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable)) => {
            Ok(CompilationResult {
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
            })
        },
        Err(e) => Ok(CompilationResult {
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
        })
    }
}

/// Compile miniscript with unified options
fn compile_miniscript_unified(expression: &str, options: CompileOptions) -> Result<CompilationResult, String> {
    let context_str = options.context.as_str();

    // For taproot context, use the mode-specific compilation with network support
    if options.context == CompileContext::Taproot {
        let mode_str = options.mode.as_str();
        let nums_key = options.nums_key.clone().unwrap_or_else(|| crate::NUMS_POINT.to_string());
        let network = options.network();

        // Direct implementation of taproot mode compilation with network support
        match compile_taproot_with_mode_network(expression, mode_str, &nums_key, network) {
            Ok((script, script_asm, address, script_size, ms_type,
                max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable, normalized_miniscript)) => {
                Ok(CompilationResult {
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
                })
            },
            Err(e) => Ok(CompilationResult {
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
            })
        }
    } else {
        // For non-taproot contexts, use direct compilation
        match compile_non_taproot_context(expression, context_str) {
            Ok((script, script_asm, address, script_size, ms_type,
                max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable, normalized_miniscript)) => {
                Ok(CompilationResult {
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
                })
            },
            Err(e) => Ok(CompilationResult {
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
            })
        }
    }
}

/// Direct implementation of taproot compilation with mode and network support
/// Replaces the deprecated compile_expression_with_mode_network function
fn compile_taproot_with_mode_network(
    expression: &str,
    mode: &str,
    nums_key: &str,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("=== COMPILE_TAPROOT_WITH_MODE_NETWORK ===\nExpression: {}\nMode: {}\nNetwork: {:?}", expression, mode, network);

    // First compile with the appropriate mode
    let mut result = compile_taproot_with_mode(expression, mode, nums_key, network)?;

    // If it's taproot and we need a different network, regenerate the address
    if network != Network::Bitcoin {
        console_log!("Regenerating taproot address for different network: {:?}", network);

        // Use the address module's generate_address function to get network-specific address
        if let Some(ref _script_hex) = result.0.get(0..result.0.len().min(200)) {
            // Try to regenerate address with network-specific function
            let address_input = crate::address::AddressInput {
                script_or_miniscript: expression.to_string(),
                script_type: "Taproot".to_string(),
                network: match network {
                    Network::Bitcoin => "mainnet".to_string(),
                    Network::Testnet => "testnet".to_string(),
                    Network::Regtest => "regtest".to_string(),
                    Network::Signet => "signet".to_string(),
                    _ => "mainnet".to_string(),
                },
                internal_key: None,
                use_single_leaf: None,
            };

            if let Ok(addr_result) = crate::address::generate_address(address_input) {
                result.2 = Some(addr_result.address);
                console_log!("Successfully regenerated address for network: {}", result.2.as_ref().unwrap());
            }
        }
    }

    Ok(result)
}

/// Direct implementation of taproot compilation with mode
/// Replaces the deprecated compile_expression_with_mode function for taproot context
fn compile_taproot_with_mode(
    expression: &str,
    mode: &str,
    nums_key: &str,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("=== COMPILE_TAPROOT_WITH_MODE ===\nExpression: {}\nMode: {}\nNetwork: {:?}", expression, mode, network);

    // For taproot context, handle different compilation modes
    match mode {
        "multi-leaf" => {
            console_log!("Using multi-leaf compilation");
            let result = crate::compile::modes::compile_taproot_multi_leaf(expression, network)?;
            Ok((
                result.script.unwrap_or_default(),
                result.script_asm.unwrap_or_default(),
                result.address,
                result.script_size.unwrap_or(0),
                result.miniscript_type.unwrap_or_default(),
                result.max_satisfaction_size,
                result.max_weight_to_satisfy,
                result.sanity_check,
                result.is_non_malleable,
                result.compiled_miniscript,
            ))
        },
        "single-leaf" => {
            console_log!("Using single-leaf compilation");
            let result = crate::compile::modes::compile_taproot_single_leaf(expression, nums_key, network)?;
            Ok((
                result.script.unwrap_or_default(),
                result.script_asm.unwrap_or_default(),
                result.address,
                result.script_size.unwrap_or(0),
                result.miniscript_type.unwrap_or_default(),
                result.max_satisfaction_size,
                result.max_weight_to_satisfy,
                result.sanity_check,
                result.is_non_malleable,
                result.compiled_miniscript,
            ))
        },
        "script-path" => {
            console_log!("Using script-path compilation");
            let result = crate::compile::modes::compile_taproot_script_path(expression, nums_key, network)?;
            Ok((
                result.script.unwrap_or_default(),
                result.script_asm.unwrap_or_default(),
                result.address,
                result.script_size.unwrap_or(0),
                result.miniscript_type.unwrap_or_default(),
                result.max_satisfaction_size,
                result.max_weight_to_satisfy,
                result.sanity_check,
                result.is_non_malleable,
                result.compiled_miniscript,
            ))
        },
        _ => {
            console_log!("Unknown mode, falling back to default taproot compilation");
            crate::compile::miniscript::compile_taproot_miniscript(expression, network)
        }
    }
}

/// Direct implementation of non-taproot context compilation
/// Replaces the deprecated compile_expression function for legacy/segwit contexts
pub(crate) fn compile_non_taproot_context(
    expression: &str,
    context: &str
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("=== COMPILE_NON_TAPROOT_CONTEXT ===\nExpression: {}\nContext: {}", expression, context);

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

    // Compile based on context using direct implementations
    match context {
        "legacy" => crate::compile::miniscript::compile_legacy_miniscript(&processed_expr, network),
        "segwit" => crate::compile::miniscript::compile_segwit_miniscript(&processed_expr, network),
        "taproot" => crate::compile::miniscript::compile_taproot_miniscript(&processed_expr, network),
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

/// Compile descriptor expressions
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
    validation::validate_inner_miniscript(inner_miniscript, context)
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
                Some(desc_str),
            ))
        },
        Err(e) => {
            console_log!("Failed to parse descriptor: {}", e);
            Err(format!("Invalid descriptor format: {}", e))
        }
    }
}