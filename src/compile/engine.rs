//! Compilation engine - unified interface preserving all existing logic
//!
//! This engine provides a single entry point for all compilation while
//! carefully preserving all existing behavior including special cases
//! for taproot, descriptors, ranges, etc.

use crate::compile::options::{CompileOptions, InputType, CompileContext, CompileMode};
use crate::compile::types::CompileResponse;
use crate::types::CompilationResult;
use bitcoin::Network;
use crate::console_log;

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

    // For taproot context, use the mode-specific compilation
    if options.context == CompileContext::Taproot {
        let mode_str = options.mode.as_str();
        let nums_key = options.nums_key.clone().unwrap_or_else(|| crate::NUMS_POINT.to_string());
        let network = options.network();

        // Call existing compile_expression_with_mode_network to preserve all logic
        match crate::compile_expression_with_mode_network(
            expression,
            context_str,
            mode_str,
            &nums_key,
            network
        ) {
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
        // For non-taproot contexts, use regular compilation
        match crate::compile_expression(expression, context_str) {
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
