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