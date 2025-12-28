//! Script and policy analysis module
//!
//! Provides semantic analysis of miniscripts and policies, extracting
//! spending paths, key information, timelocks, hashlocks, and security properties.

use std::collections::HashSet;
use std::sync::Arc;
use wasm_bindgen::JsValue;
use miniscript::{Miniscript, MiniscriptKey, ScriptContext, Legacy, Segwitv0, Tap};
use miniscript::policy::{Liftable, semantic::Policy as SemanticPolicy};

use crate::types::{
    AnalysisResult, KeyAnalysis, TimelockAnalysis, TimelockInfo,
    HashlockAnalysis, SecurityAnalysis, SizeAnalysis, PolicyTreeNode,
    ComplexityAnalysis, SpendingPathGroup,
};
use crate::console_log;

/// Analyze a miniscript expression and return rich analysis data
pub fn analyze_miniscript(expression: &str, context: &str) -> JsValue {
    console_log!("Analyzing miniscript: {} with context: {}", expression, context);

    let result = match context.to_lowercase().as_str() {
        "legacy" | "p2sh" => perform_miniscript_analysis::<Legacy>(expression),
        "segwit" | "segwitv0" | "p2wsh" => perform_miniscript_analysis::<Segwitv0>(expression),
        "taproot" | "tap" | "p2tr" => perform_miniscript_analysis::<Tap>(expression),
        _ => Err(format!("Unknown context: {}. Use legacy, segwit, or taproot.", context)),
    };

    let analysis = match result {
        Ok(mut a) => {
            a.source = Some("miniscript".to_string());
            a
        }
        Err(e) => AnalysisResult {
            success: false,
            error: Some(e),
            spending_logic: None,
            spending_paths: None,
            spending_paths_grouped: None,
            keys: None,
            timelocks: None,
            hashlocks: None,
            complexity: None,
            security: None,
            size: None,
            tree_structure: None,
            warnings: None,
            source: Some("miniscript".to_string()),
        },
    };

    serde_wasm_bindgen::to_value(&analysis).unwrap()
}

/// Analyze a policy expression and return rich analysis data
pub fn analyze_policy(policy_str: &str) -> JsValue {
    console_log!("Analyzing policy: {}", policy_str);

    let result = perform_policy_analysis(policy_str);

    let analysis = match result {
        Ok(mut a) => {
            a.source = Some("policy".to_string());
            a
        }
        Err(e) => AnalysisResult {
            success: false,
            error: Some(e),
            spending_logic: None,
            spending_paths: None,
            spending_paths_grouped: None,
            keys: None,
            timelocks: None,
            hashlocks: None,
            complexity: None,
            security: None,
            size: None,
            tree_structure: None,
            warnings: None,
            source: Some("policy".to_string()),
        },
    };

    serde_wasm_bindgen::to_value(&analysis).unwrap()
}

/// Internal function to analyze a miniscript for a specific context
fn perform_miniscript_analysis<Ctx>(expression: &str) -> Result<AnalysisResult, String>
where
    Ctx: ScriptContext,
    Ctx::Key: MiniscriptKey + std::fmt::Display + std::str::FromStr,
    <Ctx::Key as std::str::FromStr>::Err: std::fmt::Display,
{
    // Parse the miniscript
    let ms: Miniscript<String, Ctx> = expression
        .parse()
        .map_err(|e| format!("Failed to parse miniscript: {}", e))?;

    // Lift to semantic policy
    let semantic = ms.lift()
        .map_err(|e| format!("Failed to lift miniscript: {}", e))?;

    // Extract analysis from semantic policy
    let spending_logic = semantic.to_string();
    let spending_paths = enumerate_spending_paths(&semantic);
    let spending_paths_grouped = get_grouped_paths(&semantic);
    let keys = extract_key_analysis(&semantic, &spending_paths);
    let has_mixed = ms.has_mixed_timelocks();
    let timelocks = extract_timelock_analysis(&semantic, has_mixed);
    let hashlocks = extract_hashlock_analysis(&semantic);
    let complexity = extract_complexity(&semantic, spending_paths.len());
    let tree_structure = semantic_to_tree(&semantic, 0);
    let mut warnings = extract_warnings(&semantic);
    // Note: This warning is effectively unreachable - rust-miniscript rejects mixed
    // timelocks at parse time, so has_mixed will always be false for valid miniscript.
    // Kept as defensive code in case future library versions change this behavior.
    if has_mixed {
        warnings.push("❌ Invalid timelock combination. Mixed height-based and time-based locks are not allowed in this spending path".to_string());
    }

    // Extract security info from miniscript
    let is_non_malleable = ms.is_non_malleable();
    let requires_signature = ms.requires_sig();
    let security = Some(SecurityAnalysis {
        is_non_malleable,
        requires_signature,
        has_repeated_keys: ms.has_repeated_keys(),
        within_resource_limits: ms.within_resource_limits(),
        passes_sanity_check: ms.sanity_check().is_ok(),
        is_safe: ms.ty.mall.safe,
    });

    // Add security warnings
    if !requires_signature {
        let has_timelocks = !timelocks.relative.is_empty() || !timelocks.absolute.is_empty();
        let has_hashlocks = hashlocks.sha256_count > 0 || hashlocks.hash256_count > 0
            || hashlocks.ripemd160_count > 0 || hashlocks.hash160_count > 0;

        let warning_msg = match (has_timelocks, has_hashlocks) {
            (true, true) => "⚠️ SECURITY: Some spending paths do not require a signature. Anyone with knowledge of the hash preimage or after the timelock expires could spend these funds without authorization.",
            (true, false) => "⚠️ SECURITY: Some spending paths do not require a signature. Anyone after the timelock expires could spend these funds without authorization.",
            (false, true) => "⚠️ SECURITY: Some spending paths do not require a signature. Anyone with knowledge of the hash preimage could spend these funds without authorization.",
            (false, false) => "⚠️ SECURITY: Some spending paths do not require a signature. Anyone could spend these funds without authorization.",
        };
        warnings.push(warning_msg.to_string());
    }
    if !is_non_malleable {
        warnings.push("⚠️ MALLEABLE: This script is malleable. Third parties could modify the transaction witness without invalidating it, which may cause issues with protocols that rely on transaction IDs (e.g., Lightning, payment channels).".to_string());
    }

    // Extract size info from miniscript
    let size = Some(SizeAnalysis {
        script_bytes: Some(ms.script_size()),
        max_witness_bytes: ms.max_satisfaction_size().ok(),
        witness_elements: ms.max_satisfaction_witness_elements().ok(),
        opcodes: Some(ms.ext.ops.count),
        pk_cost: Some(ms.ext.pk_cost),
    });

    Ok(AnalysisResult {
        success: true,
        error: None,
        spending_logic: Some(spending_logic),
        spending_paths: Some(spending_paths),
        spending_paths_grouped: Some(spending_paths_grouped),
        keys: Some(keys),
        timelocks: Some(timelocks),
        hashlocks: Some(hashlocks),
        complexity: Some(complexity),
        security,
        size,
        tree_structure: Some(tree_structure),
        warnings: if warnings.is_empty() { None } else { Some(warnings) },
        source: None, // Set by caller
    })
}

/// Internal function to analyze a concrete policy
fn perform_policy_analysis(policy_str: &str) -> Result<AnalysisResult, String> {
    use miniscript::policy::Concrete;

    // Parse the concrete policy
    let policy: Concrete<String> = policy_str
        .parse()
        .map_err(|e| format!("Policy analysis failed: {}", e))?;

    // Lift concrete policy to semantic policy
    let semantic = policy.lift()
        .map_err(|e| format!("Policy analysis failed: {}", e))?;

    // Extract analysis from semantic policy
    let spending_logic = semantic.to_string();
    let spending_paths = enumerate_spending_paths(&semantic);
    let spending_paths_grouped = get_grouped_paths(&semantic);
    let keys = extract_key_analysis(&semantic, &spending_paths);

    // For policy, check for height-vs-time mixing using check_timelocks()
    // This detects when height-based locks (< 500M) are mixed with time-based locks (>= 500M)
    // in the same spending path, which is a Bitcoin consensus issue
    let has_mixed = policy.check_timelocks().is_err();
    let timelocks = extract_timelock_analysis(&semantic, has_mixed);
    let hashlocks = extract_hashlock_analysis(&semantic);
    let complexity = extract_complexity(&semantic, spending_paths.len());
    let tree_structure = semantic_to_tree(&semantic, 0);
    let mut warnings = extract_warnings(&semantic);
    // Note: This warning is effectively unreachable - rust-miniscript rejects mixed
    // timelocks at parse time, so has_mixed will always be false for valid policies.
    // Kept as defensive code in case future library versions change this behavior.
    if has_mixed {
        warnings.push("❌ Invalid timelock combination. Mixed height-based and time-based locks are not allowed in this spending path".to_string());
    }

    // Extract basic security info from policy using both concrete and semantic
    let (is_safe, is_non_malleable) = policy.is_safe_nonmalleable();

    // Use semantic.minimum_n_keys() to determine if signature is required
    // Returns Some(n) where n is minimum keys needed, or None if unsatisfiable
    let requires_signature = semantic.minimum_n_keys().map(|n| n > 0).unwrap_or(false);

    let security = Some(SecurityAnalysis {
        is_non_malleable,
        requires_signature,
        has_repeated_keys: policy.check_duplicate_keys().is_err(),
        within_resource_limits: true, // Not known until compiled
        passes_sanity_check: policy.is_valid().is_ok(),
        is_safe,
    });

    // Add security warnings
    if !requires_signature {
        let has_timelocks = !timelocks.relative.is_empty() || !timelocks.absolute.is_empty();
        let has_hashlocks = hashlocks.sha256_count > 0 || hashlocks.hash256_count > 0
            || hashlocks.ripemd160_count > 0 || hashlocks.hash160_count > 0;

        let warning_msg = match (has_timelocks, has_hashlocks) {
            (true, true) => "⚠️ SECURITY: Some spending paths do not require a signature. Anyone with knowledge of the hash preimage or after the timelock expires could spend these funds without authorization.",
            (true, false) => "⚠️ SECURITY: Some spending paths do not require a signature. Anyone after the timelock expires could spend these funds without authorization.",
            (false, true) => "⚠️ SECURITY: Some spending paths do not require a signature. Anyone with knowledge of the hash preimage could spend these funds without authorization.",
            (false, false) => "⚠️ SECURITY: Some spending paths do not require a signature. Anyone could spend these funds without authorization.",
        };
        warnings.push(warning_msg.to_string());
    }
    if !is_non_malleable {
        warnings.push("⚠️ MALLEABLE: This policy may compile to a malleable script. Third parties could modify the transaction witness without invalidating it, which may cause issues with protocols that rely on transaction IDs (e.g., Lightning, payment channels).".to_string());
    }

    Ok(AnalysisResult {
        success: true,
        error: None,
        spending_logic: Some(spending_logic),
        spending_paths: Some(spending_paths),
        spending_paths_grouped: Some(spending_paths_grouped),
        keys: Some(keys),
        timelocks: Some(timelocks),
        hashlocks: Some(hashlocks),
        complexity: Some(complexity),
        security,
        size: None, // No size info for policy (not compiled)
        tree_structure: Some(tree_structure),
        warnings: if warnings.is_empty() { None } else { Some(warnings) },
        source: None, // Set by caller
    })
}

/// Extract key analysis from semantic policy
fn extract_key_analysis<Pk: MiniscriptKey + std::fmt::Display>(policy: &SemanticPolicy<Pk>, spending_paths: &[String]) -> KeyAnalysis {
    let mut keys: Vec<String> = Vec::new();
    let mut unique: HashSet<String> = HashSet::new();

    // Traverse the policy tree to collect keys
    collect_keys(policy, &mut keys, &mut unique);

    // Calculate min/max signatures from spending paths
    let (min_sigs, max_sigs) = calculate_signature_range(spending_paths);

    KeyAnalysis {
        total_references: keys.len(),
        unique_keys: unique.into_iter().collect(),
        min_signatures: min_sigs,
        max_signatures: max_sigs,
    }
}

/// Calculate min and max signatures needed across spending paths
fn calculate_signature_range(spending_paths: &[String]) -> (Option<usize>, Option<usize>) {
    if spending_paths.is_empty() {
        return (None, None);
    }

    let mut min_sigs = usize::MAX;
    let mut max_sigs = 0usize;

    for path in spending_paths {
        // Count "signs" occurrences in the path
        let sig_count = path.matches(" signs").count();
        if sig_count > 0 {
            min_sigs = min_sigs.min(sig_count);
            max_sigs = max_sigs.max(sig_count);
        }
    }

    if min_sigs == usize::MAX {
        (None, None)
    } else {
        (Some(min_sigs), Some(max_sigs))
    }
}

/// Recursively collect keys from semantic policy
fn collect_keys<Pk: MiniscriptKey + std::fmt::Display>(
    policy: &SemanticPolicy<Pk>,
    keys: &mut Vec<String>,
    unique: &mut HashSet<String>,
) {
    match policy {
        SemanticPolicy::Key(pk) => {
            let key_str = pk.to_string();
            keys.push(key_str.clone());
            unique.insert(key_str);
        }
        SemanticPolicy::Thresh(thresh) => {
            for sub in thresh.iter() {
                collect_keys(sub, keys, unique);
            }
        }
        _ => {}
    }
}

/// Extract timelock analysis from semantic policy
fn extract_timelock_analysis<Pk: MiniscriptKey>(
    policy: &SemanticPolicy<Pk>,
    has_mixed: bool,
) -> TimelockAnalysis {
    let relative_values = policy.relative_timelocks();
    let absolute_values = policy.absolute_timelocks();

    let relative: Vec<TimelockInfo> = relative_values
        .into_iter()
        .map(|v| TimelockInfo { value: v })
        .collect();

    let absolute: Vec<TimelockInfo> = absolute_values
        .into_iter()
        .map(|v| TimelockInfo { value: v })
        .collect();

    TimelockAnalysis {
        relative,
        absolute,
        has_mixed,
    }
}

/// Extract hashlock analysis from semantic policy
fn extract_hashlock_analysis<Pk: MiniscriptKey>(policy: &SemanticPolicy<Pk>) -> HashlockAnalysis {
    let mut sha256_count = 0;
    let mut hash256_count = 0;
    let mut ripemd160_count = 0;
    let mut hash160_count = 0;

    count_hashlocks(policy, &mut sha256_count, &mut hash256_count, &mut ripemd160_count, &mut hash160_count);

    HashlockAnalysis {
        sha256_count,
        hash256_count,
        ripemd160_count,
        hash160_count,
    }
}

/// Recursively count hashlocks in semantic policy
fn count_hashlocks<Pk: MiniscriptKey>(
    policy: &SemanticPolicy<Pk>,
    sha256: &mut usize,
    hash256: &mut usize,
    ripemd160: &mut usize,
    hash160: &mut usize,
) {
    match policy {
        SemanticPolicy::Sha256(_) => *sha256 += 1,
        SemanticPolicy::Hash256(_) => *hash256 += 1,
        SemanticPolicy::Ripemd160(_) => *ripemd160 += 1,
        SemanticPolicy::Hash160(_) => *hash160 += 1,
        SemanticPolicy::Thresh(thresh) => {
            for sub in thresh.iter() {
                count_hashlocks(sub, sha256, hash256, ripemd160, hash160);
            }
        }
        _ => {}
    }
}

/// Extract warnings from semantic policy
fn extract_warnings<Pk: MiniscriptKey>(policy: &SemanticPolicy<Pk>) -> Vec<String> {
    let mut warnings = Vec::new();

    if policy.is_trivial() {
        warnings.push("⚠️ Trivially satisfiable - anyone can spend!".to_string());
    }

    if policy.is_unsatisfiable() {
        warnings.push("❌ Unsatisfiable - can never be spent!".to_string());
    }

    // Check if no signature is required (potential security issue)
    if let Some(min_keys) = policy.minimum_n_keys() {
        if min_keys == 0 && !policy.is_trivial() && !policy.is_unsatisfiable() {
            warnings.push("⚠️ No signature required - spendable without private keys".to_string());
        }
    }

    warnings
}

/// Extract complexity analysis from semantic policy
fn extract_complexity<Pk: MiniscriptKey>(policy: &SemanticPolicy<Pk>, num_paths: usize) -> ComplexityAnalysis {
    let mut thresholds = Vec::new();
    let depth = calculate_depth(policy, 0, &mut thresholds);

    ComplexityAnalysis {
        depth,
        num_paths,
        thresholds,
    }
}

/// Calculate tree depth and collect threshold descriptions
fn calculate_depth<Pk: MiniscriptKey>(
    policy: &SemanticPolicy<Pk>,
    current_depth: usize,
    thresholds: &mut Vec<String>,
) -> usize {
    match policy {
        SemanticPolicy::Thresh(thresh) => {
            let k = thresh.k();
            let n = thresh.n();

            // Add threshold description if it's a real threshold (not simple and/or)
            if k != n && k != 1 {
                thresholds.push(format!("{}-of-{}", k, n));
            } else if k == n && n > 1 {
                // This is an AND with multiple children - could still be useful to note
            }

            let mut max_child_depth = current_depth;
            for sub in thresh.iter() {
                let child_depth = calculate_depth(sub, current_depth + 1, thresholds);
                max_child_depth = max_child_depth.max(child_depth);
            }
            max_child_depth
        }
        _ => current_depth,
    }
}


/// Convert semantic policy to tree structure for JS rendering
pub fn semantic_to_tree<Pk: MiniscriptKey + std::fmt::Display>(
    policy: &SemanticPolicy<Pk>,
    _indent: usize,
) -> PolicyTreeNode {
    build_tree_node(policy)
}

/// Recursively build tree node structure
fn build_tree_node<Pk: MiniscriptKey + std::fmt::Display>(
    policy: &SemanticPolicy<Pk>,
) -> PolicyTreeNode {
    match policy {
        SemanticPolicy::Unsatisfiable => PolicyTreeNode {
            node_type: "unsatisfiable".to_string(),
            value: None,
            k: None,
            n: None,
            children: vec![],
        },
        SemanticPolicy::Trivial => PolicyTreeNode {
            node_type: "trivial".to_string(),
            value: None,
            k: None,
            n: None,
            children: vec![],
        },
        SemanticPolicy::Key(pk) => PolicyTreeNode {
            node_type: "pk".to_string(),
            value: Some(pk.to_string()),
            k: None,
            n: None,
            children: vec![],
        },
        SemanticPolicy::After(t) => PolicyTreeNode {
            node_type: "after".to_string(),
            value: Some(t.to_string()),
            k: None,
            n: None,
            children: vec![],
        },
        SemanticPolicy::Older(t) => PolicyTreeNode {
            node_type: "older".to_string(),
            value: Some(t.to_string()),
            k: None,
            n: None,
            children: vec![],
        },
        SemanticPolicy::Sha256(h) => PolicyTreeNode {
            node_type: "sha256".to_string(),
            value: Some(h.to_string()),
            k: None,
            n: None,
            children: vec![],
        },
        SemanticPolicy::Hash256(h) => PolicyTreeNode {
            node_type: "hash256".to_string(),
            value: Some(h.to_string()),
            k: None,
            n: None,
            children: vec![],
        },
        SemanticPolicy::Ripemd160(h) => PolicyTreeNode {
            node_type: "ripemd160".to_string(),
            value: Some(h.to_string()),
            k: None,
            n: None,
            children: vec![],
        },
        SemanticPolicy::Hash160(h) => PolicyTreeNode {
            node_type: "hash160".to_string(),
            value: Some(h.to_string()),
            k: None,
            n: None,
            children: vec![],
        },
        SemanticPolicy::Thresh(thresh) => {
            let k = thresh.k();
            let n = thresh.n();

            // Determine node type based on k/n relationship
            let node_type = if k == n {
                "and"
            } else if k == 1 {
                "or"
            } else {
                "thresh"
            };

            let children: Vec<PolicyTreeNode> = thresh.iter()
                .map(|child| build_tree_node(child.as_ref()))
                .collect();

            PolicyTreeNode {
                node_type: node_type.to_string(),
                value: None,
                k: Some(k),
                n: Some(n),
                children,
            }
        }
    }
}


/// Enumerate all spending paths from semantic policy
pub fn enumerate_spending_paths<Pk: MiniscriptKey + std::fmt::Display>(
    policy: &SemanticPolicy<Pk>,
) -> Vec<String> {
    let paths = get_all_paths(policy);

    // Format paths as human-readable strings
    // Add warning for paths that don't require a signature
    paths.into_iter()
        .enumerate()
        .map(|(i, conditions)| {
            let path_str = conditions.join(" + ");
            let has_signature = path_str.contains(" signs");
            if has_signature {
                format!("Path {}: {}", i + 1, path_str)
            } else {
                format!("Path {}: {} ⚠️ (no signature required)", i + 1, path_str)
            }
        })
        .collect()
}

/// Get all possible spending paths from a policy
/// Returns a vector of paths, where each path is a vector of conditions
fn get_all_paths<Pk: MiniscriptKey + std::fmt::Display>(
    policy: &SemanticPolicy<Pk>,
) -> Vec<Vec<String>> {
    match policy {
        SemanticPolicy::Unsatisfiable => {
            // No valid paths
            vec![]
        }
        SemanticPolicy::Trivial => {
            // One path with no conditions (always satisfiable)
            vec![vec!["(always true)".to_string()]]
        }
        SemanticPolicy::Key(pk) => {
            vec![vec![format!("{} signs", pk)]]
        }
        SemanticPolicy::After(t) => {
            // Check if it's a block height or timestamp
            if t.is_block_height() {
                vec![vec![format!("wait until block {}", t.to_consensus_u32())]]
            } else {
                // Time-based: convert Unix timestamp to human-readable date
                let timestamp = t.to_consensus_u32() as i64;
                let date = format_unix_timestamp(timestamp);
                vec![vec![format!("wait until {}", date)]]
            }
        }
        SemanticPolicy::Older(t) => {
            // Check if it's height-locked (blocks) or time-locked (seconds)
            if t.is_height_locked() {
                vec![vec![format!("wait {} blocks", t.to_consensus_u32())]]
            } else {
                // Time-based: convert seconds to human-readable duration
                let seconds = t.to_consensus_u32();
                let duration = format_duration_seconds(seconds);
                vec![vec![format!("wait {}", duration)]]
            }
        }
        SemanticPolicy::Sha256(h) => {
            let hash_str = h.to_string();
            vec![vec![format!("provide SHA256 preimage for {}", &hash_str[..8.min(hash_str.len())])]]
        }
        SemanticPolicy::Hash256(h) => {
            let hash_str = h.to_string();
            vec![vec![format!("provide HASH256 preimage for {}", &hash_str[..8.min(hash_str.len())])]]
        }
        SemanticPolicy::Ripemd160(h) => {
            let hash_str = h.to_string();
            vec![vec![format!("provide RIPEMD160 preimage for {}", &hash_str[..8.min(hash_str.len())])]]
        }
        SemanticPolicy::Hash160(h) => {
            let hash_str = h.to_string();
            vec![vec![format!("provide HASH160 preimage for {}", &hash_str[..8.min(hash_str.len())])]]
        }
        SemanticPolicy::Thresh(thresh) => {
            let k = thresh.k();
            let n = thresh.n();
            let children: Vec<Arc<SemanticPolicy<Pk>>> = thresh.iter().cloned().collect();

            // Get all paths for each child
            let child_paths: Vec<Vec<Vec<String>>> = children
                .iter()
                .map(|child| get_all_paths(child.as_ref()))
                .collect();

            if k == n {
                // AND: Need all children satisfied
                // Compute cartesian product of all child paths
                cartesian_product(&child_paths)
            } else if k == 1 {
                // OR: Any one child can satisfy
                // Concatenate all child paths
                child_paths.into_iter().flatten().collect()
            } else {
                // THRESH(k, n): k-of-n children must be satisfied
                // Generate all k-combinations, then cartesian product for each
                let combinations = generate_combinations(n, k);
                let mut result = Vec::new();

                for combo in combinations {
                    let selected_child_paths: Vec<Vec<Vec<String>>> = combo
                        .iter()
                        .filter_map(|&idx| child_paths.get(idx).cloned())
                        .collect();

                    let combo_paths = cartesian_product(&selected_child_paths);
                    result.extend(combo_paths);
                }

                result
            }
        }
    }
}

/// Compute cartesian product of path sets
/// Given [[a, b], [c, d]], returns [[a, c], [a, d], [b, c], [b, d]]
fn cartesian_product(path_sets: &[Vec<Vec<String>>]) -> Vec<Vec<String>> {
    if path_sets.is_empty() {
        return vec![vec![]];
    }

    let mut result = vec![vec![]];

    for path_set in path_sets {
        if path_set.is_empty() {
            continue;
        }

        let mut new_result = Vec::new();
        for existing in &result {
            for path in path_set {
                let mut combined = existing.clone();
                combined.extend(path.clone());
                new_result.push(combined);
            }
        }
        result = new_result;
    }

    result
}

/// Generate k-of-n combinations (indices)
fn generate_combinations(n: usize, k: usize) -> Vec<Vec<usize>> {
    let mut result = Vec::new();
    let mut combination = vec![0; k];

    fn generate(n: usize, k: usize, start: usize, idx: usize, combination: &mut Vec<usize>, result: &mut Vec<Vec<usize>>) {
        if idx == k {
            result.push(combination.clone());
            return;
        }

        for i in start..=(n - k + idx) {
            combination[idx] = i;
            generate(n, k, i + 1, idx + 1, combination, result);
        }
    }

    if k <= n {
        generate(n, k, 0, 0, &mut combination, &mut result);
    }

    result
}

/// Format Unix timestamp to human-readable date string
fn format_unix_timestamp(timestamp: i64) -> String {
    // Simple date formatting without external crates
    // Calculate year, month, day from timestamp
    let secs = timestamp;
    let days_since_epoch = secs / 86400;

    // Approximate calculation (not accounting for leap seconds perfectly)
    let mut year = 1970;
    let mut remaining_days = days_since_epoch;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let is_leap = is_leap_year(year);
    let days_in_months = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 0;
    for (i, &days) in days_in_months.iter().enumerate() {
        if remaining_days < days {
            month = i + 1;
            break;
        }
        remaining_days -= days;
    }

    let day = remaining_days + 1;

    format!("{}/{}/{}", month, day, year)
}

/// Check if a year is a leap year
fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Format duration in seconds to human-readable string
fn format_duration_seconds(seconds: u32) -> String {
    // RelLockTime time-based values are in 512-second units
    // But the raw value passed here is already the consensus value
    // which for time-based locks has bit 22 set

    // For relative time locks, the value encodes seconds / 512
    // after removing the type flag (bit 22)
    let time_value = seconds & 0x0000FFFF; // Mask out flags
    let actual_seconds = (time_value as u64) * 512;

    if actual_seconds < 60 {
        format!("{} seconds", actual_seconds)
    } else if actual_seconds < 3600 {
        format!("~{} minutes", actual_seconds / 60)
    } else if actual_seconds < 86400 {
        format!("~{} hours", actual_seconds / 3600)
    } else {
        format!("~{} days", actual_seconds / 86400)
    }
}

/// Maximum number of paths to enumerate in a group before collapsing to summary
const MAX_PATHS_TO_ENUMERATE: usize = 10;

/// Number of preview paths to show when group has too many paths
const PREVIEW_PATHS_COUNT: usize = 3;

/// Format a path with optional warning if no signature is required
fn format_path_with_warning(conditions: &[String]) -> String {
    let path_str = conditions.join(" + ");
    let has_signature = path_str.contains(" signs");
    if has_signature {
        path_str
    } else {
        format!("{} ⚠️ (no signature required)", path_str)
    }
}

/// Generate grouped spending paths from semantic policy
/// Groups paths by top-level OR branches for better UX
pub fn get_grouped_paths<Pk: MiniscriptKey + std::fmt::Display>(
    policy: &SemanticPolicy<Pk>,
) -> Vec<SpendingPathGroup> {
    get_grouped_paths_recursive(policy, 1).groups
}

/// Internal result type for recursive grouped path generation
struct GroupedPathsResult {
    groups: Vec<SpendingPathGroup>,
    flat_paths: Vec<Vec<String>>,
}

/// Recursively generate grouped paths
fn get_grouped_paths_recursive<Pk: MiniscriptKey + std::fmt::Display>(
    policy: &SemanticPolicy<Pk>,
    branch_number: usize,
) -> GroupedPathsResult {
    match policy {
        SemanticPolicy::Unsatisfiable => GroupedPathsResult {
            groups: vec![],
            flat_paths: vec![],
        },
        SemanticPolicy::Trivial => {
            let paths = vec![vec!["(always true)".to_string()]];
            GroupedPathsResult {
                groups: vec![SpendingPathGroup {
                    label: format!("Branch {}", branch_number),
                    summary: Some("Always satisfiable".to_string()),
                    path_count: 1,
                    paths: Some(vec!["(always true)".to_string()]),
                    preview_paths: None,
                    children: None,
                }],
                flat_paths: paths,
            }
        }
        SemanticPolicy::Key(pk) => {
            let path = vec![format!("{} signs", pk)];
            GroupedPathsResult {
                groups: vec![SpendingPathGroup {
                    label: format!("Branch {}", branch_number),
                    summary: Some(format!("pk({})", pk)),
                    path_count: 1,
                    paths: Some(vec![format!("{} signs", pk)]),
                    preview_paths: None,
                    children: None,
                }],
                flat_paths: vec![path],
            }
        }
        SemanticPolicy::After(t) => {
            let condition = if t.is_block_height() {
                format!("wait until block {}", t.to_consensus_u32())
            } else {
                let timestamp = t.to_consensus_u32() as i64;
                let date = format_unix_timestamp(timestamp);
                format!("wait until {}", date)
            };
            GroupedPathsResult {
                groups: vec![SpendingPathGroup {
                    label: format!("Branch {}", branch_number),
                    summary: Some(format!("after({})", t.to_consensus_u32())),
                    path_count: 1,
                    paths: Some(vec![condition.clone()]),
                    preview_paths: None,
                    children: None,
                }],
                flat_paths: vec![vec![condition]],
            }
        }
        SemanticPolicy::Older(t) => {
            let condition = if t.is_height_locked() {
                format!("wait {} blocks", t.to_consensus_u32())
            } else {
                let seconds = t.to_consensus_u32();
                let duration = format_duration_seconds(seconds);
                format!("wait {}", duration)
            };
            GroupedPathsResult {
                groups: vec![SpendingPathGroup {
                    label: format!("Branch {}", branch_number),
                    summary: Some(format!("older({})", t.to_consensus_u32())),
                    path_count: 1,
                    paths: Some(vec![condition.clone()]),
                    preview_paths: None,
                    children: None,
                }],
                flat_paths: vec![vec![condition]],
            }
        }
        SemanticPolicy::Sha256(h) => {
            let hash_str = h.to_string();
            let short_hash = &hash_str[..8.min(hash_str.len())];
            let condition = format!("provide SHA256 preimage for {}", short_hash);
            GroupedPathsResult {
                groups: vec![SpendingPathGroup {
                    label: format!("Branch {}", branch_number),
                    summary: Some(format!("sha256({}...)", short_hash)),
                    path_count: 1,
                    paths: Some(vec![condition.clone()]),
                    preview_paths: None,
                    children: None,
                }],
                flat_paths: vec![vec![condition]],
            }
        }
        SemanticPolicy::Hash256(h) => {
            let hash_str = h.to_string();
            let short_hash = &hash_str[..8.min(hash_str.len())];
            let condition = format!("provide HASH256 preimage for {}", short_hash);
            GroupedPathsResult {
                groups: vec![SpendingPathGroup {
                    label: format!("Branch {}", branch_number),
                    summary: Some(format!("hash256({}...)", short_hash)),
                    path_count: 1,
                    paths: Some(vec![condition.clone()]),
                    preview_paths: None,
                    children: None,
                }],
                flat_paths: vec![vec![condition]],
            }
        }
        SemanticPolicy::Ripemd160(h) => {
            let hash_str = h.to_string();
            let short_hash = &hash_str[..8.min(hash_str.len())];
            let condition = format!("provide RIPEMD160 preimage for {}", short_hash);
            GroupedPathsResult {
                groups: vec![SpendingPathGroup {
                    label: format!("Branch {}", branch_number),
                    summary: Some(format!("ripemd160({}...)", short_hash)),
                    path_count: 1,
                    paths: Some(vec![condition.clone()]),
                    preview_paths: None,
                    children: None,
                }],
                flat_paths: vec![vec![condition]],
            }
        }
        SemanticPolicy::Hash160(h) => {
            let hash_str = h.to_string();
            let short_hash = &hash_str[..8.min(hash_str.len())];
            let condition = format!("provide HASH160 preimage for {}", short_hash);
            GroupedPathsResult {
                groups: vec![SpendingPathGroup {
                    label: format!("Branch {}", branch_number),
                    summary: Some(format!("hash160({}...)", short_hash)),
                    path_count: 1,
                    paths: Some(vec![condition.clone()]),
                    preview_paths: None,
                    children: None,
                }],
                flat_paths: vec![vec![condition]],
            }
        }
        SemanticPolicy::Thresh(thresh) => {
            let k = thresh.k();
            let n = thresh.n();
            let children: Vec<Arc<SemanticPolicy<Pk>>> = thresh.iter().cloned().collect();

            if k == 1 {
                // OR: Create separate groups for each branch
                let mut groups = Vec::new();
                let mut all_flat_paths = Vec::new();

                for (i, child) in children.iter().enumerate() {
                    let child_result = get_grouped_paths_recursive(child.as_ref(), i + 1);
                    all_flat_paths.extend(child_result.flat_paths);

                    // Generate a smart label for this branch
                    let label = generate_branch_label(child.as_ref(), i + 1);
                    let summary = generate_branch_summary(child.as_ref());
                    let child_path_count: usize = child_result.groups.iter().map(|g| g.path_count).sum();

                    // If child has multiple groups (nested OR), show as children
                    // Otherwise, flatten into a single group
                    if child_result.groups.len() > 1 {
                        groups.push(SpendingPathGroup {
                            label,
                            summary,
                            path_count: child_path_count,
                            paths: None,
                            preview_paths: None,
                            children: Some(child_result.groups),
                        });
                    } else if let Some(single_group) = child_result.groups.into_iter().next() {
                        // Single group from child - apply warning formatting to paths
                        // Check both for signature AND for existing warning to avoid duplicates
                        let (paths, preview_paths) = if child_path_count <= MAX_PATHS_TO_ENUMERATE {
                            // Apply warning to each path (if not already present)
                            let formatted_paths = single_group.paths.map(|ps| {
                                ps.iter().map(|p| {
                                    if p.contains(" signs") || p.contains("⚠️") {
                                        p.clone()
                                    } else {
                                        format!("{} ⚠️ (no signature required)", p)
                                    }
                                }).collect()
                            });
                            (formatted_paths, None)
                        } else {
                            // Apply warning to preview paths (if not already present)
                            let formatted_preview = single_group.preview_paths.map(|ps| {
                                ps.iter().map(|p| {
                                    if p.contains(" signs") || p.contains("⚠️") {
                                        p.clone()
                                    } else {
                                        format!("{} ⚠️ (no signature required)", p)
                                    }
                                }).collect()
                            });
                            (None, formatted_preview)
                        };
                        groups.push(SpendingPathGroup {
                            label,
                            summary,
                            path_count: child_path_count,
                            paths,
                            preview_paths,
                            children: None,
                        });
                    }
                }

                GroupedPathsResult {
                    groups,
                    flat_paths: all_flat_paths,
                }
            } else {
                // AND or THRESH: Combine into single group
                let child_paths: Vec<Vec<Vec<String>>> = children
                    .iter()
                    .map(|child| get_all_paths(child.as_ref()))
                    .collect();

                let flat_paths = if k == n {
                    // AND: cartesian product
                    cartesian_product(&child_paths)
                } else {
                    // THRESH(k, n): k-of-n combinations
                    let combinations = generate_combinations(n, k);
                    let mut result = Vec::new();
                    for combo in combinations {
                        let selected: Vec<Vec<Vec<String>>> = combo
                            .iter()
                            .filter_map(|&idx| child_paths.get(idx).cloned())
                            .collect();
                        result.extend(cartesian_product(&selected));
                    }
                    result
                };

                let path_count = flat_paths.len();
                let summary = generate_thresh_summary::<Pk>(&children, k, n);
                let (paths, preview_paths) = if path_count <= MAX_PATHS_TO_ENUMERATE {
                    (Some(flat_paths.iter().map(|p| format_path_with_warning(p)).collect()), None)
                } else {
                    // Show first 3 paths as preview
                    let preview: Vec<String> = flat_paths.iter()
                        .take(PREVIEW_PATHS_COUNT)
                        .map(|p| format_path_with_warning(p))
                        .collect();
                    (None, Some(preview))
                };

                GroupedPathsResult {
                    groups: vec![SpendingPathGroup {
                        label: format!("Branch {}", branch_number),
                        summary: Some(summary),
                        path_count,
                        paths,
                        preview_paths,
                        children: None,
                    }],
                    flat_paths,
                }
            }
        }
    }
}

/// Generate a simple label for a branch
fn generate_branch_label<Pk: MiniscriptKey + std::fmt::Display>(
    _policy: &SemanticPolicy<Pk>,
    branch_num: usize,
) -> String {
    format!("Branch {}", branch_num)
}

/// Generate a summary description for a branch
fn generate_branch_summary<Pk: MiniscriptKey + std::fmt::Display>(
    policy: &SemanticPolicy<Pk>,
) -> Option<String> {
    match policy {
        SemanticPolicy::Key(pk) => Some(format!("pk({})", pk)),
        SemanticPolicy::Thresh(thresh) => {
            let k = thresh.k();
            let n = thresh.n();

            // Collect keys
            let mut keys: Vec<String> = Vec::new();
            let mut has_timelock = false;
            let mut timelock_desc = String::new();

            for child in thresh.iter() {
                match child.as_ref() {
                    SemanticPolicy::Key(pk) => keys.push(pk.to_string()),
                    SemanticPolicy::Older(t) => {
                        has_timelock = true;
                        if t.is_height_locked() {
                            let blocks = t.to_consensus_u32();
                            let days = blocks as f64 / 144.0;
                            timelock_desc = format!("+ wait {} blocks (~{:.0} days)", blocks, days);
                        } else {
                            let seconds = t.to_consensus_u32();
                            timelock_desc = format!("+ wait {}", format_duration_seconds(seconds));
                        }
                    }
                    SemanticPolicy::After(t) => {
                        has_timelock = true;
                        if t.is_block_height() {
                            timelock_desc = format!("+ after block {}", t.to_consensus_u32());
                        } else {
                            let date = format_unix_timestamp(t.to_consensus_u32() as i64);
                            timelock_desc = format!("+ after {}", date);
                        }
                    }
                    SemanticPolicy::Thresh(inner) => {
                        // Nested threshold - collect its keys
                        for inner_child in inner.iter() {
                            if let SemanticPolicy::Key(pk) = inner_child.as_ref() {
                                keys.push(pk.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }

            if keys.is_empty() {
                return Some(format!("{}-of-{}", k, n));
            }

            let keys_str = if keys.len() <= 5 {
                format!("{{{}}}", keys.join(", "))
            } else {
                format!("{{{}, ... ({} total)}}", keys[..3].join(", "), keys.len())
            };

            if k == n {
                // AND
                if has_timelock && keys.len() == 1 {
                    Some(format!("{} {}", keys[0], timelock_desc))
                } else if has_timelock {
                    Some(format!("{}-of-{} multisig: {} {}", k, keys.len(), keys_str, timelock_desc))
                } else {
                    Some(format!("{}-of-{} multisig: {}", k, keys.len(), keys_str))
                }
            } else if k == 1 {
                // OR (shouldn't get here normally)
                Some(format!("any of {}", keys_str))
            } else {
                // THRESH
                if has_timelock {
                    Some(format!("{}-of-{} multisig: {} {}", k, n, keys_str, timelock_desc))
                } else {
                    Some(format!("{}-of-{} multisig: {}", k, n, keys_str))
                }
            }
        }
        SemanticPolicy::Older(t) => {
            if t.is_height_locked() {
                let blocks = t.to_consensus_u32();
                let days = blocks as f64 / 144.0;
                Some(format!("wait {} blocks (~{:.0} days)", blocks, days))
            } else {
                Some(format!("wait {}", format_duration_seconds(t.to_consensus_u32())))
            }
        }
        SemanticPolicy::After(t) => {
            if t.is_block_height() {
                Some(format!("after block {}", t.to_consensus_u32()))
            } else {
                Some(format!("after {}", format_unix_timestamp(t.to_consensus_u32() as i64)))
            }
        }
        _ => None,
    }
}

/// Generate summary for a threshold (k-of-n) policy
fn generate_thresh_summary<Pk: MiniscriptKey + std::fmt::Display>(
    children: &[Arc<SemanticPolicy<Pk>>],
    k: usize,
    n: usize,
) -> String {
    // Collect all keys from children
    let mut keys: Vec<String> = Vec::new();
    for child in children {
        if let SemanticPolicy::Key(pk) = child.as_ref() {
            keys.push(pk.to_string());
        }
    }

    if keys.len() == n {
        // Pure multisig
        let keys_str = if keys.len() <= 7 {
            format!("{{{}}}", keys.join(", "))
        } else {
            format!("{{{}, ... ({} total)}}", keys[..5].join(", "), keys.len())
        };
        format!("{}-of-{} multisig: {}", k, n, keys_str)
    } else {
        format!("{}-of-{} threshold", k, n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_combinations() {
        let combos = generate_combinations(3, 2);
        assert_eq!(combos.len(), 3);
        assert!(combos.contains(&vec![0, 1]));
        assert!(combos.contains(&vec![0, 2]));
        assert!(combos.contains(&vec![1, 2]));
    }
}
