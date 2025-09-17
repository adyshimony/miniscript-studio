use regex::Regex;
use std::collections::HashMap;
use crate::descriptors::types::{DescriptorPatterns, ParsedDescriptor};
use crate::console_log;

/// Create regex patterns for descriptor parsing
pub fn create_descriptor_regex_patterns() -> Result<DescriptorPatterns, String> {
    Ok(DescriptorPatterns {
        // Full descriptors with fingerprint
        full_multipath: Regex::new(r"\[([A-Fa-f0-9]{8})/([0-9h'/]+)\]([xyzt]pub[A-Za-z0-9]+)/<([0-9;]+)>/\*")
            .map_err(|e| format!("Full multipath regex error: {}", e))?,
        full_wildcard_single: Regex::new(r"\[([A-Fa-f0-9]{8})/([0-9h'/]+)\]([xyzt]pub[A-Za-z0-9]+)/\*")
            .map_err(|e| format!("Full wildcard single regex error: {}", e))?,
        full_wildcard_double: Regex::new(r"\[([A-Fa-f0-9]{8})/([0-9h'/]+)\]([xyzt]pub[A-Za-z0-9]+)/\*/\*")
            .map_err(|e| format!("Full wildcard double regex error: {}", e))?,
        full_fixed_wildcard: Regex::new(r"\[([A-Fa-f0-9]{8})/([0-9h'/]+)\]([xyzt]pub[A-Za-z0-9]+)/([0-9]+)/\*")
            .map_err(|e| format!("Full fixed wildcard regex error: {}", e))?,
        full_wildcard_fixed: Regex::new(r"\[([A-Fa-f0-9]{8})/([0-9h'/]+)\]([xyzt]pub[A-Za-z0-9]+)/\*/([0-9]+)")
            .map_err(|e| format!("Full wildcard fixed regex error: {}", e))?,
        full_fixed_single: Regex::new(r"\[([A-Fa-f0-9]{8})/([0-9h'/]+)\]([xyzt]pub[A-Za-z0-9]+)/([0-9]+)")
            .map_err(|e| format!("Full fixed single regex error: {}", e))?,
        full_fixed_double: Regex::new(r"\[([A-Fa-f0-9]{8})/([0-9h'/]+)\]([xyzt]pub[A-Za-z0-9]+)/([0-9]+)/([0-9]+)")
            .map_err(|e| format!("Full fixed double regex error: {}", e))?,

        // Bare extended keys
        bare_multipath: Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/<([0-9;]+)>/\*")
            .map_err(|e| format!("Bare multipath regex error: {}", e))?,
        bare_wildcard_single: Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/\*")
            .map_err(|e| format!("Bare wildcard single regex error: {}", e))?,
        bare_wildcard_double: Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/\*/\*")
            .map_err(|e| format!("Bare wildcard double regex error: {}", e))?,
        bare_fixed_wildcard: Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/([0-9]+)/\*")
            .map_err(|e| format!("Bare fixed wildcard regex error: {}", e))?,
        bare_wildcard_fixed: Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/\*/([0-9]+)")
            .map_err(|e| format!("Bare wildcard fixed regex error: {}", e))?,
        bare_fixed_single: Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/([0-9]+)")
            .map_err(|e| format!("Bare fixed single regex error: {}", e))?,
        bare_fixed_double: Regex::new(r"([xyzt]pub[A-Za-z0-9]+)/([0-9]+)/([0-9]+)")
            .map_err(|e| format!("Bare fixed double regex error: {}", e))?,
    })
}

/// Parse descriptors from an expression
pub fn parse_descriptors(expression: &str) -> Result<HashMap<String, ParsedDescriptor>, String> {
    let mut descriptors = HashMap::new();
    
    console_log!("Parsing descriptors from expression of length: {}", expression.len());
    
    // Create regex patterns for different descriptor formats
    let patterns = create_descriptor_regex_patterns()?;
    
    // Process each pattern type
    crate::descriptors::processor::process_comprehensive_descriptors(expression, &patterns, &mut descriptors)?;
    
    console_log!("Found {} descriptors total", descriptors.len());
    Ok(descriptors)
}
