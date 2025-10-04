//! Branches implementation

use wasm_bindgen::JsValue;
use crate::console_log;
use serde::Serialize;
use miniscript::{Miniscript, Tap, policy::Concrete, Descriptor, policy::Liftable};
use bitcoin::XOnlyPublicKey;
use std::str::FromStr;


// Collect all leaf miniscripts under a subtree
fn collect_leaf_miniscripts<'a>(
    t: &'a miniscript::descriptor::TapTree<XOnlyPublicKey>,
    out: &mut Vec<&'a Miniscript<XOnlyPublicKey, Tap>>,
) {
    use miniscript::descriptor::TapTree;
    match t {
        TapTree::Leaf(ms) => out.push(ms),
        TapTree::Tree { left, right, .. } => {
            collect_leaf_miniscripts(&left, out);
            collect_leaf_miniscripts(&right, out);
        }
    }
}

// Convert a subtree (branch) to ONE valid Miniscript by OR-ing all leaf policies
fn branch_to_miniscript(
    subtree: &miniscript::descriptor::TapTree<XOnlyPublicKey>,
) -> Result<Miniscript<XOnlyPublicKey, Tap>, String> {
        
    // gather leaves
    let mut leaves = Vec::new();
    collect_leaf_miniscripts(subtree, &mut leaves);
    if leaves.is_empty() {
        return Err("Subtree has no scripts".to_string());
    }

    // If only one leaf, return it as-is
    if leaves.len() == 1 {
        return Ok(leaves[0].clone());
    }

    // OR the lifted policies (string form)
    let mut policy_parts = Vec::new();
    for ms in leaves {
        match ms.lift() {
            Ok(policy) => {
                policy_parts.push(policy.to_string());
            }
            Err(_) => {
                // Fallback: use the miniscript string directly as a policy atom
                policy_parts.push(ms.to_string());
            }
        }
    }
    
    // Build nested OR structure for valid policy
    let policy_str = if policy_parts.len() == 2 {
        format!("or({},{})", policy_parts[0], policy_parts[1])
    } else {
        // For more than 2, build nested ORs
        let mut result = policy_parts[0].clone();
        for i in 1..policy_parts.len() {
            result = format!("or({},{})", result, policy_parts[i]);
        }
        result
    };

    // Compile to Miniscript (Tap context)
    match policy_str.parse::<Concrete<XOnlyPublicKey>>() {
        Ok(conc) => {
            match conc.compile::<Tap>() {
                Ok(ms) => Ok(ms),
                Err(e) => Err(format!("Failed to compile branch miniscript: {}", e))
            }
        }
        Err(e) => Err(format!("Failed to parse branch policy: {}", e))
    }
}


// Return the Miniscript for the root's direct branches (L and R) - RESTORED ORIGINAL
fn get_taproot_branches_as_miniscript(
    descriptor_str: &str
) -> Result<Vec<(String, String)>, String> {
    use miniscript::descriptor::TapTree;
    
    // Parse the descriptor
    let desc: Descriptor<XOnlyPublicKey> = descriptor_str.parse()
        .map_err(|e| format!("Failed to parse descriptor: {}", e))?;
    
    // Get the TapTree
    let tree = match desc {
        Descriptor::Tr(ref tr) => {
            tr.tap_tree().clone()
                .ok_or_else(|| "No script paths (key-only descriptor)".to_string())?
        }
        _ => return Err("Not a taproot descriptor".to_string())
    };
    
    // Process based on tree structure
    let mut out = Vec::new();
    match tree {
        TapTree::Leaf(ms) => {
            // Single leaf at root
            out.push(("root".to_string(), ms.to_string()));
        }
        TapTree::Tree { left, right, .. } => {
            // Get miniscript for each branch
            let l_ms = branch_to_miniscript(&left)?;
            let r_ms = branch_to_miniscript(&right)?;
            out.push(("L".to_string(), l_ms.to_string()));
            out.push(("R".to_string(), r_ms.to_string()));
        }
    }
    
    Ok(out)
}

/// Get miniscript branches for taproot descriptors using YOUR WORKING CODE
pub(crate) fn get_taproot_miniscript_branches(descriptor: &str) -> JsValue {
    use miniscript::descriptor::{TapTree, Tr};
        
    #[derive(Serialize)]
    struct BranchInfo {
        miniscript: String,
        hex: String,
        asm: String,
        sig_wu: u64,         // Signature component (always 66)
        script_wu: u64,      // Script size + 1
        control_wu: u64,     // Control block component (always 34)
        total_wu: u64,       // Complete Taproot witness weight
    }
    
    #[derive(Serialize)]
    struct MiniscriptBranchResult {
        success: bool,
        internal_key: String,
        branches: Vec<BranchInfo>,
        error: Option<String>,
    }
    
    // Parse the descriptor
    let desc: Descriptor<XOnlyPublicKey> = match descriptor.parse() {
        Ok(d) => d,
        Err(e) => {
            return serde_wasm_bindgen::to_value(&MiniscriptBranchResult {
                success: false,
                internal_key: String::new(),
                branches: vec![],
                error: Some(format!("Failed to parse descriptor: {}", e)),
            }).unwrap_or(JsValue::NULL);
        }
    };
    
    let tr: &Tr<XOnlyPublicKey> = match &desc {
        Descriptor::Tr(tr) => tr,
        _ => {
            return serde_wasm_bindgen::to_value(&MiniscriptBranchResult {
                success: false,
                internal_key: String::new(),
                branches: vec![],
                error: Some("Not a taproot descriptor".to_string()),
            }).unwrap_or(JsValue::NULL);
        }
    };
    
    // Get the internal key
    let internal_key = tr.internal_key().to_string();
    let _nums_key = *tr.internal_key(); // Use the actual internal key for weight calculations
    
    // Get the tree
    let tree = match tr.tap_tree().clone() {
        Some(t) => t,
        None => {
            return serde_wasm_bindgen::to_value(&MiniscriptBranchResult {
                success: true,
                internal_key,
                branches: vec![],
                error: None,
            }).unwrap_or(JsValue::NULL);
        }
    };
    
    let mut branches = Vec::new();
    
    // YOUR EXACT LOGIC
    match &tree {
        TapTree::Leaf(ms) => {
            // COMMENTED OUT: Don't split OR patterns into multiple branches - treat as single leaf
            // if let Ok(policy) = ms.lift() {
            //     let pol_str = policy.to_string();
            //     if let Ok(conc) = Concrete::<XOnlyPublicKey>::from_str(&pol_str) {
            //         if let Concrete::Or(or_branches) = conc {
            //             for (_w, subp) in or_branches.iter() {
            //                 let sub_conc: Concrete<XOnlyPublicKey> = (**subp).clone();
            //                 if let Ok(sub_ms) = sub_conc.compile::<Tap>() {
            //                     let script = sub_ms.encode();
            //                     let hex = script.to_hex_string();
            //                     let asm = script.to_asm_string();
            //
            //                     // Calculate proper Taproot witness weight breakdown
            //                     let (sig_wu, script_wu, control_wu, total_wu) = crate::taproot::weights::taproot_witness_breakdown(&sub_ms, script.len(), 0);
            //
            //                     branches.push(BranchInfo {
            //                         miniscript: sub_ms.to_string(),
            //                         hex,
            //                         asm,
            //                         sig_wu,
            //                         script_wu,
            //                         control_wu,
            //                         total_wu,
            //                     });
            //                 }
            //             }
            //             return serde_wasm_bindgen::to_value(&MiniscriptBranchResult {
            //                 success: true,
            //                 internal_key,
            //                 branches,
            //                 error: None,
            //             }).unwrap_or(JsValue::NULL);
            //         }
            //     }
            // }
            // Always treat as single leaf (no OR splitting)
            let script = ms.encode();
            let hex = script.to_hex_string();
            let asm = script.to_asm_string();
            
            // Calculate proper Taproot witness weight breakdown
            let (sig_wu, script_wu, control_wu, total_wu) = crate::taproot::weights::taproot_witness_breakdown(&ms, script.len(), 0);
            
            branches.push(BranchInfo {
                miniscript: ms.to_string(),
                hex,
                asm,
                sig_wu,
                script_wu,
                control_wu,
                total_wu,
            });
        }
        TapTree::Tree { .. } => {
            // Collect and print each leaf miniscript as its own branch
            let mut leaves = Vec::new();
            collect_leaf_miniscripts(&tree, &mut leaves);
            for ms in leaves.into_iter() {
                let script = ms.encode();
                let hex = script.to_hex_string();
                let asm = script.to_asm_string();
                
                // Calculate proper Taproot witness weight breakdown
                let (sig_wu, script_wu, control_wu, total_wu) = crate::taproot::weights::taproot_witness_breakdown(&ms, script.len(), 1);
                
                branches.push(BranchInfo {
                    miniscript: ms.to_string(),
                    hex,
                    asm,
                    sig_wu,
                    script_wu,
                    control_wu,
                    total_wu,
                });
            }
        }
    }
    
    serde_wasm_bindgen::to_value(&MiniscriptBranchResult {
        success: true,
        internal_key,
        branches,
        error: None,
    }).unwrap_or(JsValue::NULL)
}

/// Get taproot branches - real implementation
pub(crate) fn get_taproot_branches(descriptor: &str) -> JsValue {
    console_log!("BRANCH FUNCTION CALLED: {}", descriptor);
    
    #[derive(Serialize)]
    struct BranchResult {
        success: bool,
        branches: Vec<BranchInfo>,
        error: Option<String>,
    }
    
    #[derive(Serialize)]
    struct BranchInfo {
        path: String,
        miniscript: String,
    }
    
    // Call the real implementation
    match get_taproot_branches_as_miniscript(descriptor) {
        Ok(branches) => {
            let branch_infos: Vec<BranchInfo> = branches
                .into_iter()
                .map(|(path, miniscript)| BranchInfo { path, miniscript })
                .collect();
            
            let result = BranchResult {
                success: true,
                branches: branch_infos,
                error: None,
            };
            
            serde_wasm_bindgen::to_value(&result).unwrap()
        }
        Err(e) => {
            console_log!("Error in get_taproot_branches: {}", e);
            let result = BranchResult {
                success: false,
                branches: vec![],
                error: Some(e),
            };
            
            serde_wasm_bindgen::to_value(&result).unwrap()
        }
    }
}


/// Calculate weight information for each taproot branch
pub(crate) fn get_taproot_branch_weights(descriptor: &str) -> JsValue {
    use miniscript::descriptor::TapTree;
    
    #[derive(Serialize)]
    struct BranchWeightInfo {
        branch_index: usize,
        miniscript: String,
        script_size: usize,
        control_block_size: usize,
        max_witness_size: usize,
        total_weight: usize,
    }
    
    #[derive(Serialize)]
    struct BranchWeightResult {
        success: bool,
        branches: Vec<BranchWeightInfo>,
        error: Option<String>,
    }
    
    console_log!("Calculating taproot branch weights for: {}", descriptor);
    
    // Parse the descriptor and extract tap tree
    let tap_tree = match descriptor.parse::<Descriptor<XOnlyPublicKey>>() {
        Ok(Descriptor::Tr(tr_desc)) => {
            // Get the tap tree from the Tr descriptor
            match tr_desc.tap_tree() {
                Some(tree) => tree.clone(),
                None => {
                    let result = BranchWeightResult {
                        success: false,
                        branches: vec![],
                        error: Some("No taproot tree found".to_string()),
                    };
                    return serde_wasm_bindgen::to_value(&result).unwrap();
                }
            }
        }
        Ok(_) => {
            let result = BranchWeightResult {
                success: false,
                branches: vec![],
                error: Some("Not a taproot descriptor".to_string()),
            };
            return serde_wasm_bindgen::to_value(&result).unwrap();
        }
        Err(e) => {
            let result = BranchWeightResult {
                success: false,
                branches: vec![],
                error: Some(format!("Failed to parse descriptor: {}", e)),
            };
            return serde_wasm_bindgen::to_value(&result).unwrap();
        }
    };
    
    // Collect all leaves with their depths
    fn collect_leaves_with_depth(
        tree: &miniscript::descriptor::TapTree<XOnlyPublicKey>,
        depth: usize,
        leaves: &mut Vec<(Miniscript<XOnlyPublicKey, Tap>, usize)>
    ) {
        match tree {
            TapTree::Leaf(ms_arc) => {
                // Dereference the Arc to get the Miniscript
                leaves.push(((**ms_arc).clone(), depth));
            }
            TapTree::Tree { left, right, .. } => {
                collect_leaves_with_depth(left, depth + 1, leaves);
                collect_leaves_with_depth(right, depth + 1, leaves);
            }
        }
    }
    
    let mut leaves_with_depth: Vec<(Miniscript<XOnlyPublicKey, Tap>, usize)> = Vec::new();
    collect_leaves_with_depth(&tap_tree, 0, &mut leaves_with_depth);
    
    let mut branch_infos: Vec<BranchWeightInfo> = Vec::new();
    
    for (i, (ms, depth)) in leaves_with_depth.into_iter().enumerate() {
        let script = ms.encode();
        let script_len = script.len();
        
        // Use the helper to compute detailed breakdown
        let (sig_wu, script_wu, control_wu, total_wu) = crate::taproot::weights::taproot_witness_breakdown(&ms, script_len, depth);
        
        let info = BranchWeightInfo {
            branch_index: i,
            miniscript: ms.to_string(),
            script_size: script_len,
            control_block_size: (33 + 32 * depth) as usize,
            max_witness_size: (sig_wu + script_wu + control_wu) as usize,
            total_weight: total_wu as usize,
        };
        branch_infos.push(info);
    }
    
    let result = BranchWeightResult {
        success: true,
        branches: branch_infos,
        error: None,
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}


