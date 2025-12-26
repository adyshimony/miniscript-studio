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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debug_info_leaves: Option<Vec<LeafDebugInfo>>,
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

/// Debug information for a single TapTree leaf (Taproot only)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeafDebugInfo {
    pub depth: u8,                     // Tree depth (0 = leftmost/rightmost leaves)
    pub script: String,                // The miniscript expression for this leaf
    pub script_asm: String,            // The compiled script in ASM format
    pub script_hex: String,            // The compiled script in HEX format
    pub debug_info: DebugInfo,         // Full debug analysis for this leaf
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
    // Satisfaction size as (witness_size, scriptsig_size)
    pub max_sat_size: Option<(usize, usize)>,
    pub max_dissat_size: Option<(usize, usize)>,
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

/// Result structure for script/policy analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub success: bool,
    pub error: Option<String>,

    /// The semantic policy string (from lift)
    pub spending_logic: Option<String>,

    /// Human-readable spending paths
    pub spending_paths: Option<Vec<String>>,

    /// Key information
    pub keys: Option<KeyAnalysis>,

    /// Timelock information
    pub timelocks: Option<TimelockAnalysis>,

    /// Hashlock information
    pub hashlocks: Option<HashlockAnalysis>,

    /// Complexity analysis (depth, paths, thresholds)
    pub complexity: Option<ComplexityAnalysis>,

    /// Security properties
    pub security: Option<SecurityAnalysis>,

    /// Size and weight information (only available from miniscript, not policy)
    pub size: Option<SizeAnalysis>,

    /// Tree structure as nested JSON for JS rendering
    pub tree_structure: Option<PolicyTreeNode>,

    /// Warnings (e.g., trivially satisfiable, unsatisfiable, etc.)
    pub warnings: Option<Vec<String>>,

    /// Source type: "miniscript" or "policy"
    pub source: Option<String>,
}

/// Tree node for policy visualization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyTreeNode {
    /// Node type: "and", "or", "thresh", "pk", "after", "older", "sha256", etc.
    #[serde(rename = "type")]
    pub node_type: String,

    /// Raw value (key hex, timelock number, hash, or k/n for thresh)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,

    /// For thresh nodes: k value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub k: Option<usize>,

    /// For thresh nodes: n value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<usize>,

    /// Child nodes
    pub children: Vec<PolicyTreeNode>,
}

impl PolicyTreeNode {
    /// Check if this tree contains a node matching the given pattern
    /// Searches node_type (case-insensitive), value, formatted representations,
    /// and recursively searches children
    pub fn contains(&self, pattern: &str) -> bool {
        let pattern_lower = pattern.to_lowercase();

        // Check node_type (case-insensitive)
        if self.node_type.to_lowercase().contains(&pattern_lower) {
            return true;
        }

        // Check value
        if let Some(ref val) = self.value {
            if val.to_lowercase().contains(&pattern_lower) {
                return true;
            }
            // Check formatted representation like "pk(Alice)", "after(800000)"
            let formatted = format!("{}({})", self.node_type, val);
            if formatted.to_lowercase().contains(&pattern_lower) {
                return true;
            }
        }

        // Check thresh formatted representation like "THRESH(2/3)"
        if self.node_type == "thresh" {
            if let (Some(k), Some(n)) = (self.k, self.n) {
                let thresh_fmt = format!("thresh({}/{})", k, n);
                if thresh_fmt.to_lowercase().contains(&pattern_lower) {
                    return true;
                }
            }
        }

        // Check children recursively
        for child in &self.children {
            if child.contains(pattern) {
                return true;
            }
        }
        false
    }
}

/// Key analysis information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyAnalysis {
    pub total_references: usize,
    pub unique_keys: Vec<String>,
    /// Min signatures needed across all paths
    pub min_signatures: Option<usize>,
    /// Max signatures needed across all paths
    pub max_signatures: Option<usize>,
}

/// Complexity analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplexityAnalysis {
    /// Maximum tree depth
    pub depth: usize,
    /// Number of spending paths
    pub num_paths: usize,
    /// Threshold conditions found (e.g., ["2-of-3", "1-of-1"])
    pub thresholds: Vec<String>,
}

/// Timelock analysis information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelockAnalysis {
    pub relative: Vec<TimelockInfo>,
    pub absolute: Vec<TimelockInfo>,
    pub has_mixed: bool,
}

/// Individual timelock information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelockInfo {
    pub value: u32,
}

/// Hashlock analysis information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashlockAnalysis {
    pub sha256_count: usize,
    pub hash256_count: usize,
    pub ripemd160_count: usize,
    pub hash160_count: usize,
}

/// Security analysis information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityAnalysis {
    pub is_non_malleable: bool,
    pub requires_signature: bool,
    pub has_repeated_keys: bool,
    pub within_resource_limits: bool,
    pub passes_sanity_check: bool,
    pub is_safe: bool,
}

/// Size and weight analysis information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SizeAnalysis {
    pub script_bytes: Option<usize>,
    pub max_witness_bytes: Option<usize>,
    pub witness_elements: Option<usize>,
    pub opcodes: Option<usize>,
    pub pk_cost: Option<usize>,
}