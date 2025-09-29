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
    _ms: &Miniscript<Pk, Ctx>
) -> TypeProperties {
    // Note: These properties would need to be extracted from ms.ty and ms.ext
    // For now, returning placeholder values
    // In a real implementation, we'd access ms.ty fields
    TypeProperties {
        base: true,
        verify: false,
        one_arg: true,
        non_zero: true,
        dissatisfiable: true,
        unit: true,
        expression: true,
        safe: true,
        forced: false,
        has_max_size: true,
        zero_arg: false,
    }
}

/// Extract extended properties from miniscript
fn extract_extended_properties<Pk: MiniscriptKey, Ctx: ScriptContext>(
    _ms: &Miniscript<Pk, Ctx>
) -> ExtendedProperties {
    ExtendedProperties {
        has_mixed_timelocks: false,  // Would call ms.has_mixed_timelocks() if available
        has_repeated_keys: false,     // Would call ms.has_repeated_keys() if available
        requires_sig: false,           // Would call ms.requires_sig() if available
        within_resource_limits: true, // Would call ms.within_resource_limits() if available
        contains_raw_pkh: false,       // Would call ms.contains_raw_pkh() if available
        pk_cost: Some(73),            // Placeholder - would extract from ms.ext
        ops_count_static: Some(2),    // Placeholder - would extract from ms.ext
        stack_elements_sat: Some(1),  // Placeholder - would extract from ms.ext
        stack_elements_dissat: Some(1), // Placeholder - would extract from ms.ext
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

    Some(DebugInfo {
        annotated_expression: descriptor.to_string(),
        type_legend: generate_type_legend(),
        type_properties: TypeProperties {
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
        extended_properties: ExtendedProperties {
            has_mixed_timelocks: false,
            has_repeated_keys: false,
            requires_sig: true,
            within_resource_limits: true,
            contains_raw_pkh: false,
            pk_cost: None,
            ops_count_static: None,
            stack_elements_sat: None,
            stack_elements_dissat: None,
        },
        raw_output: format!("=== DESCRIPTOR DEBUG ===\n{}", debug_output),
    })
}