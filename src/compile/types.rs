//! Types and enums for the compile module

use serde::{Deserialize, Serialize};

/// Compilation context
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Context {
    Legacy,
    Segwit,
    Taproot,
}

/// Compilation mode for taproot
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Mode {
    MultiLeaf,
    SingleLeaf,
    ScriptPath,
}

/// Compilation input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Input {
    pub expression: String,
    pub context: Context,
    pub mode: Option<Mode>,
    pub nums_key: Option<String>,
    pub network: String,
}

/// Compilation request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileRequest {
    pub input: Input,
}

/// Compilation response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileResponse {
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
    pub debug_info: Option<crate::types::DebugInfo>,
}
