//! Data structures for the miniscript compiler

use serde::{Deserialize, Serialize};
use bitcoin::bip32::{Xpub, DerivationPath, Fingerprint};


/// Result structure returned to JavaScript for compilation operations
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debug_info: Option<DebugInfo>,
}

/// Debug information for verbose mode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebugInfo {
    pub annotated_expression: String,  // Expression with type annotations
    pub type_legend: String,           // Explanation of type codes
    pub type_properties: TypeProperties,
    pub extended_properties: ExtendedProperties,
    pub raw_output: String,            // Full Debug output
}

/// Type properties extracted from miniscript
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeProperties {
    pub base: bool,
    pub verify: bool,
    pub one_arg: bool,
    pub non_zero: bool,
    pub dissatisfiable: bool,
    pub unit: bool,
    pub expression: bool,
    pub safe: bool,
    pub forced: bool,
    pub has_max_size: bool,
    pub zero_arg: bool,
}

/// Extended properties from miniscript analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtendedProperties {
    pub has_mixed_timelocks: bool,
    pub has_repeated_keys: bool,
    pub requires_sig: bool,
    pub within_resource_limits: bool,
    pub contains_raw_pkh: bool,
    pub pk_cost: Option<usize>,
    pub ops_count_static: Option<usize>,
    pub stack_elements_sat: Option<usize>,
    pub stack_elements_dissat: Option<usize>,
}

/// Result structure for lift operations
#[derive(Serialize, Deserialize)]
pub struct LiftResult {
    pub success: bool,
    pub error: Option<String>,
    pub miniscript: Option<String>,
    pub policy: Option<String>,
}

/// Result structure for address generation
#[derive(Serialize, Deserialize)]
pub struct AddressResult {
    pub success: bool,
    pub error: Option<String>,
    pub address: Option<String>,
}


/// Information about a parsed HD wallet descriptor
#[derive(Debug, Clone)]
pub struct DescriptorInfo {
    pub fingerprint: Fingerprint,
    pub derivation_path: DerivationPath,
    pub xpub: Xpub,
    pub child_paths: Vec<u32>,
    pub is_wildcard: bool,
}

/// Parsed descriptor with original string and extracted info
#[derive(Debug, Clone)]
pub struct ParsedDescriptor {
    pub original: String,
    pub info: DescriptorInfo,
}