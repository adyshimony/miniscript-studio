//! Debug information extraction for miniscript

use miniscript::{Miniscript, MiniscriptKey, ScriptContext};
use crate::types::{DebugInfo, TypeProperties, ExtendedProperties};
use crate::console_log;

/// Extract debug information from a miniscript
pub fn extract_debug_info<Pk: MiniscriptKey, Ctx: ScriptContext>(
    ms: &Miniscript<Pk, Ctx>,
    verbose: bool,
) -> Option<DebugInfo> {
    if !verbose {
        return None;
    }

    // Get the full debug output
    let raw_output = format!("{:#?}", ms);

    // Log to console for debugging
    console_log!("=== VERBOSE MINISCRIPT DEBUG INFO ===");
    console_log!("{}", raw_output);

    // Extract annotated expression from debug output
    let annotated_expression = extract_annotated_expression(&raw_output);

    // Extract type properties
    let type_properties = extract_type_properties(ms);

    // Extract extended properties
    let extended_properties = extract_extended_properties(ms);

    // Generate type legend
    let type_legend = generate_type_legend();

    Some(DebugInfo {
        annotated_expression,
        type_legend,
        type_properties,
        extended_properties,
        raw_output,
    })
}

/// Extract the annotated expression from debug output
fn extract_annotated_expression(debug_output: &str) -> String {
    // For now, return the miniscript string representation
    // In a full implementation, we'd parse the debug output to extract
    // the expression with type annotations like [B/onduesm]
    debug_output.lines()
        .take(20)  // Take first 20 lines as summary
        .collect::<Vec<_>>()
        .join("\n")
}

/// Extract type properties from miniscript
fn extract_type_properties<Pk: MiniscriptKey, Ctx: ScriptContext>(
    ms: &Miniscript<Pk, Ctx>
) -> TypeProperties {
    // Extract from ms.ty (Type struct with corr and mall properties)
    use miniscript::miniscript::types::{Base, Input};

    // Check base type
    let base = matches!(ms.ty.corr.base, Base::B);
    let verify = matches!(ms.ty.corr.base, Base::V);

    // Check input type
    let one_arg = matches!(ms.ty.corr.input, Input::One);
    let zero_arg = matches!(ms.ty.corr.input, Input::Zero);

    // Correctness properties
    let dissatisfiable = ms.ty.corr.dissatisfiable;
    let unit = ms.ty.corr.unit;

    // Malleability properties
    let safe = ms.ty.mall.safe;
    let non_zero = ms.ty.mall.non_malleable; // non_malleable implies non-zero

    // From ext data
    let expression = true; // If it parsed, it's a valid expression
    let forced = !ms.ty.corr.dissatisfiable; // Forced means not dissatisfiable
    let has_max_size = ms.ext.max_sat_size.is_some();

    console_log!("Type Properties from ms.ty:");
    console_log!("  base: {}, verify: {}", base, verify);
    console_log!("  one_arg: {}, zero_arg: {}", one_arg, zero_arg);
    console_log!("  non_zero: {}, dissatisfiable: {}", non_zero, dissatisfiable);
    console_log!("  unit: {}, safe: {}", unit, safe);

    TypeProperties {
        base,
        verify,
        one_arg,
        non_zero,
        dissatisfiable,
        unit,
        expression,
        safe,
        forced,
        has_max_size,
        zero_arg,
    }
}

/// Extract extended properties from miniscript
fn extract_extended_properties<Pk: MiniscriptKey, Ctx: ScriptContext>(
    ms: &Miniscript<Pk, Ctx>
) -> ExtendedProperties {
    // Call actual rust-miniscript methods
    let has_mixed_timelocks = ms.has_mixed_timelocks();
    let has_repeated_keys = ms.has_repeated_keys();
    let requires_sig = ms.requires_sig();
    let within_resource_limits = ms.within_resource_limits();

    // contains_raw_pkh is only available for Legacy context
    // We'll set it to false for now as it's context-specific
    let contains_raw_pkh = false;

    // Extract extended properties directly from ms.ext (all from rust-miniscript)
    let pk_cost = Some(ms.ext.pk_cost);
    let ops_count_static = Some(ms.ext.ops.count);
    let stack_elements_sat = ms.ext.stack_elem_count_sat;
    let stack_elements_dissat = ms.ext.stack_elem_count_dissat;

    // Get satisfaction/dissatisfaction size ranges from rust-miniscript
    let max_sat_size = ms.ext.max_sat_size;
    let max_dissat_size = ms.ext.max_dissat_size;

    console_log!("Extended Properties:");
    console_log!("  has_mixed_timelocks: {}", has_mixed_timelocks);
    console_log!("  has_repeated_keys: {}", has_repeated_keys);
    console_log!("  requires_sig: {}", requires_sig);
    console_log!("  within_resource_limits: {}", within_resource_limits);
    console_log!("  pk_cost: {:?}", pk_cost);
    console_log!("  ops_count_static: {:?}", ops_count_static);
    console_log!("  stack_elements_sat: {:?}", stack_elements_sat);
    console_log!("  stack_elements_dissat: {:?}", stack_elements_dissat);
    console_log!("  max_sat_size: {:?}", max_sat_size);
    console_log!("  max_dissat_size: {:?}", max_dissat_size);

    ExtendedProperties {
        has_mixed_timelocks,
        has_repeated_keys,
        requires_sig,
        within_resource_limits,
        contains_raw_pkh,
        pk_cost,
        ops_count_static,
        stack_elements_sat,
        stack_elements_dissat,
        max_sat_size,
        max_dissat_size,
    }
}

/// Generate a legend explaining type codes
fn generate_type_legend() -> String {
    "[B/onduesm] = B:Base o:one-arg n:non-zero d:dissatisfiable u:unit e:expression s:safe m:has-max-size | [V/...] = V:Verify | [z/...] = z:zero-arg | [f/...] = f:forced".to_string()
}

/// Extract debug info for descriptors (Taproot)
pub fn extract_descriptor_debug_info<Pk: MiniscriptKey>(
    descriptor: &str,
    verbose: bool,
) -> Option<DebugInfo> {
    if !verbose {
        return None;
    }

    // For descriptors, we need to parse and format with {:#?} to get type annotations
    console_log!("=== VERBOSE DESCRIPTOR DEBUG INFO ===");

    // Try to parse as a descriptor or miniscript to get the typed output
    use bitcoin::secp256k1::XOnlyPublicKey;
    use miniscript::{Descriptor, Miniscript, Tap};

    // Try to extract extended properties from parsed miniscript
    let extended_properties = if let Ok(parsed_ms) = descriptor.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        extract_extended_properties(&parsed_ms)
    } else {
        // Fallback to defaults if we can't parse
        ExtendedProperties {
            has_mixed_timelocks: false,
            has_repeated_keys: false,
            requires_sig: true,
            within_resource_limits: true,
            contains_raw_pkh: false,
            pk_cost: None,
            ops_count_static: None,
            stack_elements_sat: None,
            stack_elements_dissat: None,
            max_sat_size: None,
            max_dissat_size: None,
        }
    };

    let debug_output = if let Ok(parsed_desc) = descriptor.parse::<Descriptor<XOnlyPublicKey>>() {
        // Successfully parsed as descriptor - format with {:#?} to get type annotations
        let formatted = format!("{:#?}", parsed_desc);
        console_log!("Parsed as Descriptor: {:#?}", parsed_desc);
        formatted
    } else if let Ok(parsed_ms) = descriptor.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        // Try parsing as miniscript directly
        let formatted = format!("{:#?}", parsed_ms);
        console_log!("Parsed as Miniscript: {:#?}", parsed_ms);
        formatted
    } else {
        // Fallback to string if parsing fails
        console_log!("Could not parse descriptor, using string: {}", descriptor);
        descriptor.to_string()
    };

    // Extract type properties if we can parse the descriptor
    let type_properties = if let Ok(parsed_ms) = descriptor.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        extract_type_properties(&parsed_ms)
    } else {
        // Fallback to defaults if we can't parse
        TypeProperties {
            base: false,
            verify: false,
            one_arg: false,
            non_zero: false,
            dissatisfiable: false,
            unit: false,
            expression: false,
            safe: false,
            forced: false,
            has_max_size: false,
            zero_arg: false,
        }
    };

    Some(DebugInfo {
        annotated_expression: descriptor.to_string(),
        type_legend: generate_type_legend(),
        type_properties,
        extended_properties,
        raw_output: format!("=== DESCRIPTOR DEBUG ===\n{}", debug_output),
    })
}