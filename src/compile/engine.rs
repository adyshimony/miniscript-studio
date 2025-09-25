//! Unified compilation engine
//!
//! Single entry point for all compilation operations, routing to appropriate
//! compilation logic based on input type and options.

use crate::compile::options::{CompileOptions, InputType, CompileContext};
use crate::types::CompilationResult;
use crate::console_log;
use bitcoin::Network;
use crate::parse::helpers::{detect_network, needs_descriptor_processing, is_descriptor_wrapper};
use crate::descriptors::parser::parse_descriptors;
use crate::validation;

// Unified compilation entry point
pub fn compile_unified(expression: &str, options: CompileOptions) -> Result<CompilationResult, String> {
    console_log!("=== UNIFIED COMPILE ===");
    console_log!("Expression: {}", expression);
    console_log!("Options: input_type={:?}, context={}, mode={}, network={:?}",
        options.input_type, options.context.as_str(), options.mode.as_str(), options.network());

    match options.input_type {
        InputType::Policy => compile_policy_unified(expression, options),
        InputType::Miniscript => compile_miniscript_unified(expression, options),
    }
}

// Compile policy with unified options
fn compile_policy_unified(policy: &str, options: CompileOptions) -> Result<CompilationResult, String> {
    let context_str = options.context.as_str();
    let mode_str = options.mode.as_str();
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

// Compile miniscript with unified options
fn compile_miniscript_unified(expression: &str, options: CompileOptions) -> Result<CompilationResult, String> {
    let context_str = options.context.as_str();

    if options.context == CompileContext::Taproot {
        let mode_str = options.mode.as_str();
        let nums_key = options.nums_key.clone().unwrap_or_else(|| crate::taproot::utils::NUMS_POINT.to_string());
        let network = options.network();

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

// Taproot compilation with mode and network support
fn compile_taproot_with_mode_network(
    expression: &str,
    mode: &str,
    nums_key: &str,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("=== COMPILE_TAPROOT_WITH_MODE_NETWORK ===\nExpression: {}\nMode: {}\nNetwork: {:?}", expression, mode, network);

    let mut result = compile_taproot_with_mode(expression, mode, nums_key, network)?;

    if network != Network::Bitcoin {
        console_log!("Regenerating taproot address for different network: {:?}", network);

        if let Some(ref _script_hex) = result.0.get(0..result.0.len().min(200)) {
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

// Taproot compilation with mode
fn compile_taproot_with_mode(
    expression: &str,
    mode: &str,
    nums_key: &str,
    network: Network
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("=== COMPILE_TAPROOT_WITH_MODE ===\nExpression: {}\nMode: {}\nNetwork: {:?}", expression, mode, network);

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

// Non-taproot context compilation (legacy/segwit)
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

    let processed_expr = if needs_descriptor_processing(trimmed) {
        process_expression_descriptors(trimmed)?
    } else {
        trimmed.to_string()
    };

    if is_descriptor_wrapper(&processed_expr) {
        return compile_descriptor(&processed_expr, context);
    }

    match context {
        "legacy" => crate::compile::miniscript::compile_legacy_miniscript(&processed_expr, network),
        "segwit" => crate::compile::miniscript::compile_segwit_miniscript(&processed_expr, network),
        "taproot" => crate::compile::miniscript::compile_taproot_miniscript(&processed_expr, network),
        _ => Err(format!("Invalid context: {}. Use 'legacy', 'segwit', or 'taproot'", context))
    }
}

// Process descriptors in expression
fn process_expression_descriptors(expression: &str) -> Result<String, String> {
    console_log!("Detected descriptor keys in expression, processing...");

    match parse_descriptors(expression) {
        Ok(descriptors) => {
            if descriptors.is_empty() {
                console_log!("No descriptors found, using original expression");
                Ok(expression.to_string())
            } else {
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

// Process descriptors for taproot context (converts to x-only keys)
pub(crate) fn process_expression_descriptors_taproot(expression: &str) -> Result<String, String> {
    console_log!("Detected descriptor keys in taproot expression, processing with x-only conversion...");

    match parse_descriptors(expression) {
        Ok(descriptors) => {
            if descriptors.is_empty() {
                console_log!("No descriptors found, using original expression");
                Ok(expression.to_string())
            } else {
                let has_range_descriptors = descriptors.values().any(|desc| desc.info.is_wildcard);

                if has_range_descriptors {
                    console_log!("Found {} descriptors with ranges, wrapping in tr() for taproot descriptor parsing", descriptors.len());
                    // For taproot, we don't use wsh() wrapper, we'll handle this differently
                    Ok(format!("tr(NUMS_PLACEHOLDER,{})", expression))
                } else {
                    console_log!("Found {} fixed descriptors, replacing with x-only keys for taproot", descriptors.len());
                    match crate::descriptors::utils::replace_descriptors_with_xonly_keys(expression, &descriptors) {
                        Ok(processed) => {
                            console_log!("Successfully replaced descriptors with x-only keys for taproot");
                            Ok(processed)
                        },
                        Err(e) => {
                            console_log!("Failed to replace descriptors with x-only keys: {}", e);
                            Err(format!("Taproot descriptor processing failed: {}", e))
                        }
                    }
                }
            }
        },
        Err(e) => {
            console_log!("Failed to parse descriptors: {}", e);
            Err(format!("Taproot descriptor parsing failed: {}", e))
        }
    }
}

// Compile descriptor expressions
fn compile_descriptor(expression: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    console_log!("Detected descriptor format, extracting inner miniscript for proper validation");

    let inner_miniscript = if expression.starts_with("wsh(") && expression.ends_with(")") {
        &expression[4..expression.len()-1]
    } else {
        return crate::descriptors::compiler::parse_non_wsh_descriptor(expression);
    };

    console_log!("Parsing inner miniscript with proper validation: {}", inner_miniscript);

    validation::validate_inner_miniscript(inner_miniscript, context)
}

