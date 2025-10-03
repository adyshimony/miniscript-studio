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
                debug_info: None,
                debug_info_leaves: None,
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
            debug_info: None,
            debug_info_leaves: None,
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

        match compile_taproot_with_mode_network_debug(expression, mode_str, &nums_key, network, options.verbose_debug) {
            Ok((script, script_asm, address, script_size, ms_type,
                max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable, normalized_miniscript, debug_info, debug_info_leaves)) => {
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
                    debug_info,
                    debug_info_leaves,
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
                debug_info: None,
                debug_info_leaves: None,
            })
        }
    } else {
        // For non-taproot contexts, use direct compilation
        match compile_non_taproot_context_debug(expression, context_str, options.verbose_debug) {
            Ok((script, script_asm, address, script_size, ms_type,
                max_satisfaction_size, max_weight_to_satisfy, sanity_check, is_non_malleable, normalized_miniscript, debug_info)) => {
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
                    debug_info,
                    debug_info_leaves: None,
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
                debug_info: None,
                debug_info_leaves: None,
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
    compile_taproot_with_mode_network_debug(expression, mode, nums_key, network, false).map(|(a,b,c,d,e,f,g,h,i,j,_,_)| (a,b,c,d,e,f,g,h,i,j))
}

// Taproot compilation with mode, network and debug support
fn compile_taproot_with_mode_network_debug(
    expression: &str,
    mode: &str,
    nums_key: &str,
    network: Network,
    verbose_debug: bool
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>, Option<crate::types::DebugInfo>, Option<Vec<crate::types::LeafDebugInfo>>), String> {
    console_log!("=== COMPILE_TAPROOT_WITH_MODE_NETWORK ===\nExpression: {}\nMode: {}\nNetwork: {:?}", expression, mode, network);

    let mut response = compile_taproot_with_mode(expression, mode, nums_key, network)?;
    console_log!("DEBUG: response.compiled_miniscript after compile_taproot_with_mode: {:?}", response.compiled_miniscript);

    if network != Network::Bitcoin {
        console_log!("Regenerating taproot address for different network: {:?}", network);

        if let Some(ref _script_hex) = response.script {
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
                response.address = Some(addr_result.address);
                console_log!("Successfully regenerated address for network: {}", response.address.as_ref().unwrap());
            }
        }
    }

    // Generate debug info if verbose mode enabled (only if not already populated)
    console_log!("DEBUG: About to extract debug info. response.compiled_miniscript = {:?}", response.compiled_miniscript);
    let debug_info = if verbose_debug && response.debug_info.is_none() {
        // Use the compiled descriptor instead of the original expression to ensure correct internal key
        let descriptor_for_debug = response.compiled_miniscript.as_deref().unwrap_or(expression);
        console_log!("DEBUG INFO EXTRACTION: Using descriptor: {}", descriptor_for_debug);
        // Use XOnlyPublicKey for taproot descriptors
        use bitcoin::secp256k1::XOnlyPublicKey;
        crate::compile::debug::extract_descriptor_debug_info::<XOnlyPublicKey>(descriptor_for_debug, true)
    } else {
        response.debug_info
    };

    Ok((
        response.script.unwrap_or_default(),
        response.script_asm.unwrap_or_default(),
        response.address,
        response.script_size.unwrap_or(0),
        response.miniscript_type.unwrap_or_default(),
        response.max_satisfaction_size,
        response.max_weight_to_satisfy,
        response.sanity_check,
        response.is_non_malleable,
        response.compiled_miniscript,
        debug_info,
        response.debug_info_leaves,
    ))
}

// Taproot compilation with mode
fn compile_taproot_with_mode(
    expression: &str,
    mode: &str,
    nums_key: &str,
    network: Network
) -> Result<crate::compile::types::CompileResponse, String> {
    console_log!("=== COMPILE_TAPROOT_WITH_MODE ===\nExpression: {}\nMode: {}\nNetwork: {:?}", expression, mode, network);

    match mode {
        "multi-leaf" => {
            console_log!("Using multi-leaf compilation");
            crate::compile::modes::compile_taproot_multi_leaf(expression, network, true)
        },
        "single-leaf" => {
            console_log!("Using single-leaf compilation");
            crate::compile::modes::compile_taproot_single_leaf(expression, nums_key, network, false)
        },
        "script-path" => {
            console_log!("Using script-path compilation");
            crate::compile::modes::compile_taproot_script_path(expression, nums_key, network, true)
        },
        "default" | _ => {
            console_log!("Using default taproot compilation with multi-leaf detection");
            crate::compile::modes::compile_taproot_multi_leaf(expression, network, true)
        }
    }
}

// Non-taproot context compilation (legacy/segwit)
pub(crate) fn compile_non_taproot_context(
    expression: &str,
    context: &str
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>), String> {
    compile_non_taproot_context_debug(expression, context, false).map(|(a,b,c,d,e,f,g,h,i,j,_)| (a,b,c,d,e,f,g,h,i,j))
}

// Non-taproot context compilation with debug support
pub(crate) fn compile_non_taproot_context_debug(
    expression: &str,
    context: &str,
    verbose_debug: bool
) -> Result<(String, String, Option<String>, usize, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>, Option<String>, Option<crate::types::DebugInfo>), String> {
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
        let desc_result = compile_descriptor(&processed_expr, context)?;
        // Add debug info placeholder for descriptors
        let debug_info = if verbose_debug {
            crate::compile::debug::extract_descriptor_debug_info::<bitcoin::PublicKey>(&processed_expr, true)
        } else {
            None
        };
        return Ok((desc_result.0, desc_result.1, desc_result.2, desc_result.3, desc_result.4, desc_result.5, desc_result.6, desc_result.7, desc_result.8, desc_result.9, debug_info));
    }

    let result = match context {
        "legacy" => crate::compile::miniscript::compile_legacy_miniscript_with_debug(&processed_expr, network, verbose_debug),
        "segwit" => crate::compile::miniscript::compile_segwit_miniscript_with_debug(&processed_expr, network, verbose_debug),
        "taproot" => crate::compile::miniscript::compile_taproot_miniscript_with_debug(&processed_expr, network, verbose_debug),
        _ => Err(format!("Invalid context: {}. Use 'legacy', 'segwit', or 'taproot'", context))
    }?;

    // Extract debug output from result (it's the 11th element, index 10)
    let actual_debug_output = if verbose_debug {
        result.10.clone()
    } else {
        None
    };

    // Generate debug info if verbose mode enabled - parse miniscript to extract real values
    let debug_info = if verbose_debug {
        // Parse the miniscript to get actual debug info with real values
        let parsed_debug_info = match context {
            "legacy" => {
                use miniscript::{Miniscript, Legacy};
                use bitcoin::PublicKey;
                match processed_expr.parse::<Miniscript<PublicKey, Legacy>>() {
                    Ok(ms) => crate::compile::debug::extract_debug_info(&ms, true),
                    Err(_) => None,
                }
            },
            "segwit" => {
                use miniscript::{Miniscript, Segwitv0};
                use bitcoin::PublicKey;
                match processed_expr.parse::<Miniscript<PublicKey, Segwitv0>>() {
                    Ok(ms) => crate::compile::debug::extract_debug_info(&ms, true),
                    Err(_) => None,
                }
            },
            "taproot" => {
                use miniscript::{Miniscript, Tap};
                use bitcoin::XOnlyPublicKey;
                match processed_expr.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
                    Ok(ms) => crate::compile::debug::extract_debug_info(&ms, true),
                    Err(_) => None,
                }
            },
            _ => None,
        };

        // Use the parsed debug info or create a fallback
        if let Some(mut debug) = parsed_debug_info {
            // Append expression info to raw output
            if let Some(ref debug_str) = actual_debug_output {
                debug.raw_output = format!("=== RUST-MINISCRIPT DEBUG OUTPUT ===\n\n{}\n\n=== EXPRESSION INFO ===\nExpression: {}\nContext: {}", debug_str, processed_expr, context);
            }
            Some(debug)
        } else {
            // Fallback if parsing fails
            Some(crate::types::DebugInfo {
                annotated_expression: format!("Miniscript expression: {}", processed_expr),
                type_legend: "".to_string(),
                type_properties: crate::types::TypeProperties {
                    base: true,
                    verify: false,
                    one_arg: false,
                    non_zero: false,
                    dissatisfiable: false,
                    unit: false,
                    expression: false,
                    safe: true,
                    forced: false,
                    has_max_size: true,
                    zero_arg: false,
                },
                extended_properties: crate::types::ExtendedProperties {
                    has_mixed_timelocks: false,
                    has_repeated_keys: false,
                    requires_sig: false,
                    within_resource_limits: true,
                    contains_raw_pkh: false,
                    pk_cost: None,
                    ops_count_static: None,
                    stack_elements_sat: None,
                    stack_elements_dissat: None,
                    max_sat_size: None,
                    max_dissat_size: None,
                },
                raw_output: format!("=== MINISCRIPT COMPILATION DEBUG ===\nExpression: {}\nContext: {}\n\nDebug output not available", processed_expr, context),
            })
        }
    } else {
        None
    };

    Ok((result.0, result.1, result.2, result.3, result.4, result.5, result.6, result.7, result.8, result.9, debug_info))
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

