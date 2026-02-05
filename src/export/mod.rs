//! Export module for Miniscript Studio
//!
//! Provides export functionality for compilation results in multiple formats:
//! - Bitcoin Core `importdescriptors` JSON format
//! - Generic descriptor format (Sparrow/Liana compatible)
//! - Developer comprehensive JSON

use serde::{Deserialize, Serialize};
use wasm_bindgen::JsValue;

use crate::console_log;
use crate::compile::options::{CompileOptions, InputType, CompileContext, CompileMode};
use crate::compile::engine::compile_unified;
use crate::address::{generate_address, AddressInput};
use crate::types::CompilationResult;

/// Get current ISO 8601 timestamp from JavaScript
fn get_current_timestamp() -> String {
    // Use js_sys to get the current date from JavaScript
    let date = js_sys::Date::new_0();
    date.to_iso_string().as_string().unwrap_or_else(|| "unknown".to_string())
}

/// Export options from JavaScript
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    /// Include analysis data (from analyze_miniscript/analyze_policy)
    #[serde(default)]
    pub include_analysis: bool,
    /// Include all networks (mainnet, testnet, signet, regtest)
    #[serde(default)]
    pub include_all_networks: bool,
    /// Include satisfaction paths
    #[serde(default)]
    pub include_satisfaction_paths: bool,
    /// HD descriptor range start (default: 0)
    #[serde(default)]
    pub range_start: Option<u32>,
    /// HD descriptor range end (default: 100)
    #[serde(default)]
    pub range_end: Option<u32>,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            include_analysis: true,
            include_all_networks: false,
            include_satisfaction_paths: true,
            range_start: Some(0),
            range_end: Some(100),
        }
    }
}

/// Bitcoin Core importdescriptors format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BitcoinCoreDescriptor {
    pub desc: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<[u32; 2]>,
    pub watchonly: bool,
    pub active: bool,
    pub internal: bool,
}

/// Addresses for all networks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkAddresses {
    pub mainnet: Option<String>,
    pub testnet: Option<String>,
    pub signet: Option<String>,
    pub regtest: Option<String>,
}

/// Taproot-specific export data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaprootExportData {
    pub internal_key: Option<String>,
    pub internal_key_type: Option<String>,
    pub merkle_root: Option<String>,
}

/// Satisfaction path information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SatisfactionPath {
    pub description: String,
    pub required: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timelock: Option<TimelockExport>,
    pub witness_size: Option<usize>,
}

/// Timelock export format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelockExport {
    #[serde(rename = "type")]
    pub timelock_type: String,
    pub value: u32,
    pub human: String,
}

/// Analysis export data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisExport {
    pub is_sane: bool,
    pub is_non_malleable: bool,
    pub has_mixed_timelocks: bool,
}

/// Export metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportMeta {
    pub generator: String,
    pub version: String,
    pub generated_at: String,
}

/// Input information for export
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportInput {
    #[serde(rename = "type")]
    pub input_type: String,
    pub expression: String,
    pub context: String,
}

/// Compilation export data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompilationExport {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub descriptor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub miniscript: Option<String>,
    pub script_hex: String,
    pub script_asm: String,
    pub script_size: usize,
}

/// Comprehensive export result (Developer JSON)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<ExportMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<ExportInput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compilation: Option<CompilationExport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub addresses: Option<NetworkAddresses>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub taproot: Option<TaprootExportData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub satisfaction: Option<SatisfactionExport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis: Option<AnalysisExport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitcoin_core: Option<BitcoinCoreExport>,
}

/// Satisfaction paths export container
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SatisfactionExport {
    pub paths: Vec<SatisfactionPath>,
}

/// Bitcoin Core export container
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BitcoinCoreExport {
    pub importdescriptors: Vec<BitcoinCoreDescriptor>,
}

/// Generate Bitcoin Core importdescriptors format
pub fn export_for_bitcoin_core(descriptor: &str, options_js: JsValue) -> JsValue {
    console_log!("Exporting for Bitcoin Core: {}", descriptor);

    let options: ExportOptions = serde_wasm_bindgen::from_value(options_js)
        .unwrap_or_default();

    let range_start = options.range_start.unwrap_or(0);
    let range_end = options.range_end.unwrap_or(100);

    // Check if descriptor has wildcard (*) for HD derivation
    let has_wildcard = descriptor.contains("/*");

    let bitcoin_core_desc = BitcoinCoreDescriptor {
        desc: add_checksum(descriptor),
        timestamp: "now".to_string(),
        range: if has_wildcard { Some([range_start, range_end]) } else { None },
        watchonly: true,
        active: true,
        internal: false,
    };

    let result = vec![bitcoin_core_desc];

    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Generate comprehensive export data (Developer JSON)
pub fn export_comprehensive(
    expression: &str,
    context: &str,
    input_type: &str,
    options_js: JsValue
) -> JsValue {
    console_log!("Exporting comprehensive data for: {} (context: {}, type: {})",
                 expression, context, input_type);

    let options: ExportOptions = serde_wasm_bindgen::from_value(options_js)
        .unwrap_or_default();

    // Determine input type
    let input_type_enum = if input_type == "policy" {
        InputType::Policy
    } else {
        InputType::Miniscript
    };

    // Parse context
    let compile_context = match context.to_lowercase().as_str() {
        "legacy" => CompileContext::Legacy,
        "segwit" => CompileContext::Segwit,
        "taproot" | "taproot-multi" | "taproot-keypath" => CompileContext::Taproot,
        _ => CompileContext::Segwit,
    };

    // Determine mode for taproot
    let compile_mode = match context.to_lowercase().as_str() {
        "taproot-multi" => CompileMode::MultiLeaf,
        "taproot-keypath" => CompileMode::ScriptPath,
        "taproot" => CompileMode::SingleLeaf,
        _ => CompileMode::Default,
    };

    // Create compile options
    let compile_options = CompileOptions {
        input_type: input_type_enum,
        context: compile_context.clone(),
        mode: compile_mode,
        network_str: "testnet".to_string(),
        nums_key: None,
        verbose_debug: false,
    };

    // Compile the expression
    let compilation_result = match compile_unified(expression, compile_options) {
        Ok(result) => result,
        Err(e) => {
            let error_result = ExportResult {
                success: false,
                error: Some(e),
                meta: None,
                input: None,
                compilation: None,
                addresses: None,
                taproot: None,
                satisfaction: None,
                analysis: None,
                bitcoin_core: None,
            };
            return serde_wasm_bindgen::to_value(&error_result).unwrap();
        }
    };

    if !compilation_result.success {
        let error_result = ExportResult {
            success: false,
            error: compilation_result.error,
            meta: None,
            input: None,
            compilation: None,
            addresses: None,
            taproot: None,
            satisfaction: None,
            analysis: None,
            bitcoin_core: None,
        };
        return serde_wasm_bindgen::to_value(&error_result).unwrap();
    }

    // Build metadata
    let meta = ExportMeta {
        generator: "Miniscript Studio".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        generated_at: get_current_timestamp(),
    };

    // Build input info
    let input_info = ExportInput {
        input_type: input_type.to_string(),
        expression: expression.to_string(),
        context: context.to_string(),
    };

    // Build compilation info
    let compilation = CompilationExport {
        descriptor: build_descriptor(&compilation_result, context),
        miniscript: compilation_result.compiled_miniscript.clone(),
        script_hex: compilation_result.script.clone().unwrap_or_default(),
        script_asm: compilation_result.script_asm.clone().unwrap_or_default(),
        script_size: compilation_result.script_size.unwrap_or(0),
    };

    // Generate addresses for all networks if requested
    let addresses = generate_network_addresses(
        &compilation_result,
        context,
        options.include_all_networks
    );

    // Build taproot-specific data if applicable
    let taproot = if context.contains("taproot") {
        Some(TaprootExportData {
            internal_key: None, // Would need to be extracted from compilation
            internal_key_type: if context == "taproot" {
                Some("NUMS".to_string())
            } else {
                Some("extracted".to_string())
            },
            merkle_root: None,
        })
    } else {
        None
    };

    // Build analysis data
    let analysis = Some(AnalysisExport {
        is_sane: compilation_result.sanity_check.unwrap_or(false),
        is_non_malleable: compilation_result.is_non_malleable.unwrap_or(false),
        has_mixed_timelocks: false, // Would need to be determined from analysis
    });

    // Build Bitcoin Core export
    let bitcoin_core = build_bitcoin_core_export(&compilation_result, context);

    let result = ExportResult {
        success: true,
        error: None,
        meta: Some(meta),
        input: Some(input_info),
        compilation: Some(compilation),
        addresses: Some(addresses),
        taproot,
        satisfaction: None, // Would be populated from analysis
        analysis,
        bitcoin_core: Some(bitcoin_core),
    };

    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Compute descriptor checksum per BIP 380
fn descriptor_checksum(desc: &str) -> Result<String, String> {
    const INPUT_CHARSET: &str = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
    const CHECKSUM_CHARSET: &[u8] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";

    fn polymod(c: u64, val: u64) -> u64 {
        let c0 = c >> 35;
        let c = ((c & 0x7ffffffff) << 5) ^ val;
        let c = if c0 & 1 != 0 { c ^ 0xf5dee51989 } else { c };
        let c = if c0 & 2 != 0 { c ^ 0xa9fdca3312 } else { c };
        let c = if c0 & 4 != 0 { c ^ 0x1bab10e32d } else { c };
        let c = if c0 & 8 != 0 { c ^ 0x3706b1677a } else { c };
        if c0 & 16 != 0 { c ^ 0x644d626ffd } else { c }
    }

    let mut c = 1u64;
    let mut cls = 0u64;
    let mut clscount = 0u64;

    for ch in desc.chars() {
        let pos = INPUT_CHARSET.find(ch)
            .ok_or_else(|| format!("Invalid character '{}' in descriptor", ch))? as u64;
        c = polymod(c, pos & 31);
        cls = cls * 3 + (pos >> 5);
        clscount += 1;
        if clscount == 3 {
            c = polymod(c, cls);
            cls = 0;
            clscount = 0;
        }
    }

    if clscount > 0 {
        c = polymod(c, cls);
    }

    (0..8).for_each(|_| c = polymod(c, 0));
    c ^= 1;

    let checksum: String = (0..8)
        .map(|j| CHECKSUM_CHARSET[((c >> (5 * (7 - j))) & 31) as usize] as char)
        .collect();

    Ok(checksum)
}

/// Append BIP 380 checksum to a descriptor string
fn add_checksum(desc: &str) -> String {
    // If already has a checksum, return as-is
    if desc.contains('#') {
        console_log!("add_checksum: descriptor already has checksum: {}", desc);
        return desc.to_string();
    }
    match descriptor_checksum(desc) {
        Ok(checksum) => {
            console_log!("add_checksum: computed checksum '{}' for descriptor", checksum);
            format!("{}#{}", desc, checksum)
        },
        Err(e) => {
            console_log!("add_checksum: ERROR computing checksum: {}", e);
            desc.to_string()
        },
    }
}

/// Build descriptor string from compilation result
fn build_descriptor(result: &CompilationResult, context: &str) -> Option<String> {
    let miniscript = result.compiled_miniscript.as_ref()?;

    // Strip |LEAF_ASM: suffix if present (taproot single-leaf format)
    let clean_ms = if miniscript.contains("|LEAF_ASM:") {
        miniscript.split("|LEAF_ASM:").next().unwrap_or(miniscript)
    } else {
        miniscript.as_str()
    };

    let desc = match context.to_lowercase().as_str() {
        "legacy" => format!("sh({})", clean_ms),
        "segwit" => format!("wsh({})", clean_ms),
        "taproot" | "taproot-multi" | "taproot-keypath" => {
            // For taproot, compiled_miniscript may already be a full tr() descriptor
            if clean_ms.starts_with("tr(") {
                clean_ms.to_string()
            } else {
                format!("tr(UNSPECIFIED,{{{}}})", clean_ms)
            }
        },
        _ => return None,
    };

    Some(add_checksum(&desc))
}

/// Generate addresses for all requested networks
fn generate_network_addresses(
    result: &CompilationResult,
    context: &str,
    include_all: bool
) -> NetworkAddresses {
    let script_hex = result.script.clone().unwrap_or_default();

    let script_type = match context.to_lowercase().as_str() {
        "legacy" => "Legacy",
        "segwit" => "Segwit v0",
        "taproot" | "taproot-multi" | "taproot-keypath" => "Taproot",
        _ => "Segwit v0",
    };

    // For Taproot, we use the address from compilation result
    if context.contains("taproot") {
        let address = result.address.clone();
        return NetworkAddresses {
            mainnet: None, // Would need to regenerate for mainnet
            testnet: address.clone(),
            signet: if include_all { address.clone() } else { None },
            regtest: if include_all { address } else { None },
        };
    }

    // For Legacy/Segwit, generate addresses for each network
    let generate_for_network = |network: &str| -> Option<String> {
        let input = AddressInput {
            script_or_miniscript: script_hex.clone(),
            script_type: script_type.to_string(),
            network: network.to_string(),
            internal_key: None,
            use_single_leaf: None,
        };

        generate_address(input).ok().map(|r| r.address)
    };

    NetworkAddresses {
        mainnet: generate_for_network("mainnet"),
        testnet: generate_for_network("testnet"),
        signet: if include_all { generate_for_network("signet") } else { None },
        regtest: if include_all { generate_for_network("regtest") } else { None },
    }
}

/// Build Bitcoin Core importdescriptors export
fn build_bitcoin_core_export(result: &CompilationResult, context: &str) -> BitcoinCoreExport {
    let descriptor = build_descriptor(result, context)
        .unwrap_or_else(|| "INVALID".to_string());

    // Check for HD wildcard
    let has_wildcard = descriptor.contains("/*");

    let desc = BitcoinCoreDescriptor {
        desc: descriptor,
        timestamp: "now".to_string(),
        range: if has_wildcard { Some([0, 100]) } else { None },
        watchonly: true,
        active: true,
        internal: false,
    };

    BitcoinCoreExport {
        importdescriptors: vec![desc],
    }
}

/// Generate a simple descriptor export (Sparrow/Liana compatible)
pub fn export_descriptor(expression: &str, context: &str, input_type: &str) -> JsValue {
    console_log!("=== EXPORT DESCRIPTOR ===");
    console_log!("Expression: '{}'", expression);
    console_log!("Context: '{}'", context);
    console_log!("Input type: '{}'", input_type);

    // Check for empty expression
    if expression.trim().is_empty() {
        console_log!("ERROR: Empty expression");
        return serde_wasm_bindgen::to_value(&serde_json::json!({
            "success": false,
            "error": "Empty expression - please enter a miniscript or policy"
        })).unwrap_or_else(|_| JsValue::NULL);
    }

    // Determine input type
    let input_type_enum = if input_type == "policy" {
        InputType::Policy
    } else {
        InputType::Miniscript
    };

    // Parse context
    let compile_context = match context.to_lowercase().as_str() {
        "legacy" => CompileContext::Legacy,
        "segwit" => CompileContext::Segwit,
        "taproot" | "taproot-multi" | "taproot-keypath" => CompileContext::Taproot,
        _ => CompileContext::Segwit,
    };

    console_log!("Parsed context: {:?}", compile_context);

    // Create compile options
    let compile_options = CompileOptions {
        input_type: input_type_enum,
        context: compile_context,
        mode: CompileMode::Default,
        network_str: "testnet".to_string(),
        nums_key: None,
        verbose_debug: false,
    };

    // Compile
    console_log!("Calling compile_unified...");
    let result = match compile_unified(expression, compile_options) {
        Ok(r) => {
            console_log!("Compilation succeeded: {}", r.success);
            r
        },
        Err(e) => {
            console_log!("Compilation error: {}", e);
            return serde_wasm_bindgen::to_value(&serde_json::json!({
                "success": false,
                "error": e
            })).unwrap_or_else(|_| JsValue::NULL);
        }
    };

    if !result.success {
        let error_msg = result.error.clone().unwrap_or_else(|| "Unknown error".to_string());
        console_log!("Compilation failed: {}", error_msg);
        return serde_wasm_bindgen::to_value(&serde_json::json!({
            "success": false,
            "error": error_msg
        })).unwrap_or_else(|_| JsValue::NULL);
    }

    let descriptor = build_descriptor(&result, context)
        .unwrap_or_else(|| "INVALID".to_string());

    console_log!("Generated descriptor: {}", descriptor);

    serde_wasm_bindgen::to_value(&serde_json::json!({
        "success": true,
        "descriptor": descriptor
    })).unwrap_or_else(|_| JsValue::NULL)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_export_options_default() {
        let options = ExportOptions::default();
        assert!(options.include_analysis);
        assert!(!options.include_all_networks);
        assert!(options.include_satisfaction_paths);
        assert_eq!(options.range_start, Some(0));
        assert_eq!(options.range_end, Some(100));
    }

    #[test]
    fn test_descriptor_checksum() {
        // Test with a known descriptor - Bitcoin Core reference
        let desc = "wsh(pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9))";
        let result = descriptor_checksum(desc);
        println!("Checksum for '{}': {:?}", desc, result);
        assert!(result.is_ok(), "Checksum computation should succeed, got: {:?}", result);
        let checksum = result.unwrap();
        assert_eq!(checksum.len(), 8, "Checksum should be 8 characters, got: '{}'", checksum);
        println!("Checksum: #{}", checksum);
    }

    #[test]
    fn test_add_checksum_fn() {
        let desc = "wsh(pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9))";
        let with_checksum = add_checksum(desc);
        println!("With checksum: {}", with_checksum);
        assert!(with_checksum.contains('#'), "Should contain checksum separator #");
        assert!(with_checksum.len() > desc.len(), "Should be longer than input");
    }
}
