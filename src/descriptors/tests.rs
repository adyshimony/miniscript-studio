//! Tests for descriptor processing functionality
//! 
//! This module tests the descriptor parsing, processing, and expansion functionality
//! that was refactored into the descriptors module.

#[cfg(test)]
mod tests {
    use crate::descriptors::parser::parse_descriptors;
    use crate::descriptors::processor::process_expression_descriptors;
    use crate::descriptors::utils::{expand_descriptor, replace_descriptors_with_keys};
    use crate::keys::{extract_xonly_key_from_miniscript, extract_internal_key_from_expression, extract_xonly_key_from_script_hex};
    use crate::validation::validate_inner_miniscript;

    // Real Bitcoin descriptors for testing - these are the exact descriptors the user mentioned
    const COMPLEX_DESCRIPTOR_FIXED: &str = "pk([C8FE8D4F/48h/1h/123h/2h]xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda/0/0)";
    const COMPLEX_DESCRIPTOR_WILDCARD: &str = "pk([C8FE8D4F/48h/1h/123h/2h]xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda/0/*)";

        // DESCRIPTOR PARSING TESTS
    
    #[test]
    fn test_parse_descriptors_fixed() {
        // Test parsing a fixed descriptor
        let descriptors = parse_descriptors(COMPLEX_DESCRIPTOR_FIXED).unwrap();
        
        // Debug: print what we actually found
        println!("Found {} descriptors:", descriptors.len());
        for (i, (desc_str, parsed_desc)) in descriptors.iter().enumerate() {
            println!("  {}: '{}' -> fingerprint: {}, wildcard: {}, paths: {:?}", 
                i, desc_str, parsed_desc.info.fingerprint, parsed_desc.info.is_wildcard, parsed_desc.info.child_paths);
        }
        
        // Find the main descriptor (should be the full one with fingerprint and double path)
        let main_descriptor = descriptors.iter()
            .find(|(desc_str, parsed_desc)| 
                desc_str.contains("[C8FE8D4F/48h/1h/123h/2h]") && 
                desc_str.contains("/0/0") &&
                parsed_desc.info.child_paths == vec![0, 0]);
        
        assert!(main_descriptor.is_some(), "Should find the main descriptor with fingerprint and double path");
        let (descriptor_str, parsed_descriptor) = main_descriptor.unwrap();
        assert!(descriptor_str.contains("[C8FE8D4F/48h/1h/123h/2h]"), "Should contain fingerprint and derivation path");
        assert!(descriptor_str.contains("/0/0"), "Should contain double child path");
        assert!(!parsed_descriptor.info.is_wildcard, "Fixed descriptor should not be wildcard");
        assert_eq!(parsed_descriptor.info.child_paths, vec![0, 0], "Should have fixed child paths [0, 0]");
        assert_eq!(parsed_descriptor.info.fingerprint.to_string().to_uppercase(), "C8FE8D4F", "Should extract correct fingerprint");
        assert_eq!(parsed_descriptor.info.derivation_path.to_string(), "48'/1'/123'/2'", "Should extract correct derivation path");
    }

    #[test]
    fn test_parse_descriptors_wildcard() {
        // Test parsing a wildcard descriptor
        let descriptors = parse_descriptors(COMPLEX_DESCRIPTOR_WILDCARD).unwrap();
        
        // Find the main wildcard descriptor (should be the full one with fingerprint and wildcard)
        let main_descriptor = descriptors.iter()
            .find(|(desc_str, parsed_desc)| 
                desc_str.contains("[C8FE8D4F/48h/1h/123h/2h]") && 
                desc_str.contains("/*") &&
                parsed_desc.info.is_wildcard);
        
        assert!(main_descriptor.is_some(), "Should find the main wildcard descriptor");
        let (descriptor_str, parsed_descriptor) = main_descriptor.unwrap();
        assert!(descriptor_str.contains("[C8FE8D4F/48h/1h/123h/2h]"), "Should contain fingerprint and derivation path");
        assert!(descriptor_str.contains("/*"), "Should contain wildcard");
        assert!(parsed_descriptor.info.is_wildcard, "Wildcard descriptor should be wildcard");
        assert_eq!(parsed_descriptor.info.child_paths, vec![0], "Should have child path [0]");
        assert_eq!(parsed_descriptor.info.fingerprint.to_string().to_uppercase(), "C8FE8D4F", "Should extract correct fingerprint");
    }

    #[test]
    fn test_parse_descriptors_multiple() {
        // Test parsing multiple descriptors in one expression
        let expression = format!("{} + {}", COMPLEX_DESCRIPTOR_FIXED, COMPLEX_DESCRIPTOR_WILDCARD);
        let descriptors = parse_descriptors(&expression).unwrap();
        
        // Should find multiple descriptors (both fixed and wildcard, plus their sub-components)
        assert!(descriptors.len() >= 2, "Should find at least two main descriptors");
        
        // Check that both main descriptor types are found
        let has_fixed_descriptor = descriptors.iter().any(|(desc_str, parsed_desc)| 
            desc_str.contains("[C8FE8D4F/48h/1h/123h/2h]") && 
            desc_str.contains("/0/0") &&
            !parsed_desc.info.is_wildcard);
        
        let has_wildcard_descriptor = descriptors.iter().any(|(desc_str, parsed_desc)| 
            desc_str.contains("[C8FE8D4F/48h/1h/123h/2h]") && 
            desc_str.contains("/*") &&
            parsed_desc.info.is_wildcard);
        
        assert!(has_fixed_descriptor, "Should find fixed descriptor");
        assert!(has_wildcard_descriptor, "Should find wildcard descriptor");
    }

    #[test]
    fn test_parse_descriptors_invalid() {
        // Test parsing invalid descriptor - function is resilient and parses what it can
        let invalid_descriptor = "pk([INVALID_FINGERPRINT/48h/1h/123h/2h]xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda/0/0)";
        let result = parse_descriptors(invalid_descriptor);
        println!("Result for invalid descriptor: {:?}", result);
        
        // Function should succeed and parse the valid parts (bare xpub)
        assert!(result.is_ok(), "Should parse valid parts even from invalid descriptor");
        let descriptors = result.unwrap();
        
        // Should find the bare xpub parts (without fingerprint)
        let has_bare_xpub = descriptors.iter().any(|(desc_str, parsed_desc)| 
            desc_str.contains("xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda") &&
            parsed_desc.info.fingerprint.to_string() == "00000000");
        assert!(has_bare_xpub, "Should find bare xpub parts");
    }

        // DESCRIPTOR PROCESSING TESTS
    
    #[test]
    fn test_process_expression_descriptors_fixed_only() {
        // Test processing expression with only fixed descriptors
        let expression = format!("{} + {}", COMPLEX_DESCRIPTOR_FIXED, COMPLEX_DESCRIPTOR_FIXED);
        let result = process_expression_descriptors(&expression).unwrap();
        println!("Processed fixed-only expression: {}", result);
        
        // Should replace descriptors with derived public keys (not xpub keys)
        assert!(!result.contains("xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda"), "Should not contain xpub keys");
        assert!(!result.starts_with("wsh("), "Should not wrap in wsh for fixed descriptors");
        
        // Should contain derived public keys (66-character hex strings)
        let key_regex = regex::Regex::new(r"\b[0-9a-fA-F]{66}\b").unwrap();
        let keys: Vec<&str> = key_regex.find_iter(&result).map(|m| m.as_str()).collect();
        assert!(!keys.is_empty(), "Should contain derived public keys");
    }

    #[test]
    fn test_process_expression_descriptors_with_wildcards() {
        // Test processing expression with wildcard descriptors
        let expression = format!("{} + {}", COMPLEX_DESCRIPTOR_FIXED, COMPLEX_DESCRIPTOR_WILDCARD);
        let result = process_expression_descriptors(&expression).unwrap();
        
        // Should wrap in wsh() for wildcard descriptors
        assert!(result.starts_with("wsh("), "Should wrap in wsh for wildcard descriptors");
        assert!(result.ends_with(")"), "Should end with closing parenthesis");
    }

    #[test]
    fn test_process_expression_descriptors_no_descriptors() {
        // Test processing expression with no descriptors
        let expression = "pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9)";
        let result = process_expression_descriptors(expression).unwrap();
        
        // Should return the original expression unchanged
        assert_eq!(result, expression, "Should return original expression unchanged");
    }

    #[test]
    fn test_process_expression_descriptors_invalid() {
        // Test processing invalid descriptor expression - function is resilient
        let expression = "pk([INVALID_FINGERPRINT/48h/1h/123h/2h]xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda/0/0)";
        
        let result = process_expression_descriptors(expression);
        println!("Result for invalid expression: {:?}", result);
        
        // Function should succeed and process the valid parts
        assert!(result.is_ok(), "Should process valid parts even from invalid descriptor");
        let processed = result.unwrap();
        
        // Should contain derived public keys (not xpub)
        let key_regex = regex::Regex::new(r"\b[0-9a-fA-F]{66}\b").unwrap();
        let keys: Vec<&str> = key_regex.find_iter(&processed).map(|m| m.as_str()).collect();
        assert!(!keys.is_empty(), "Should contain derived public keys");
    }

        // DESCRIPTOR EXPANSION TESTS
    
    #[test]
    fn test_expand_descriptor_wildcard() {
        // Test expanding a wildcard descriptor
        let descriptors = parse_descriptors(COMPLEX_DESCRIPTOR_WILDCARD).unwrap();
        
        // Find the wildcard descriptor
        let wildcard_descriptor = descriptors.iter()
            .find(|(desc_str, parsed_desc)| 
                desc_str.contains("[C8FE8D4F/48h/1h/123h/2h]") && 
                desc_str.contains("/*") &&
                parsed_desc.info.is_wildcard);
        
        assert!(wildcard_descriptor.is_some(), "Should find wildcard descriptor");
        let parsed_descriptor = wildcard_descriptor.unwrap().1;
        
        let expanded = expand_descriptor(parsed_descriptor, 5).unwrap();
        println!("Expanded descriptor: {}", expanded);
        
        // Should expand to a derived public key (not the xpub itself)
        assert_eq!(expanded.len(), 66, "Should be a 66-character compressed public key");
        assert!(expanded.starts_with("02") || expanded.starts_with("03"), "Should be a valid compressed public key");
        assert!(!expanded.contains("*"), "Should not contain wildcard after expansion");
    }

    #[test]
    fn test_expand_descriptor_fixed() {
        // Test expanding a fixed descriptor (should return derived public key)
        let descriptors = parse_descriptors(COMPLEX_DESCRIPTOR_FIXED).unwrap();
        
        // Find the fixed descriptor
        let fixed_descriptor = descriptors.iter()
            .find(|(desc_str, parsed_desc)| 
                desc_str.contains("[C8FE8D4F/48h/1h/123h/2h]") && 
                desc_str.contains("/0/0") &&
                !parsed_desc.info.is_wildcard);
        
        assert!(fixed_descriptor.is_some(), "Should find fixed descriptor");
        let parsed_descriptor = fixed_descriptor.unwrap().1;
        
        let expanded = expand_descriptor(parsed_descriptor, 5).unwrap();
        println!("Expanded fixed descriptor: {}", expanded);
        
        // Should expand to a derived public key
        assert_eq!(expanded.len(), 66, "Should be a 66-character compressed public key");
        assert!(expanded.starts_with("02") || expanded.starts_with("03"), "Should be a valid compressed public key");
    }

        // DESCRIPTOR REPLACEMENT TESTS
    
    #[test]
    fn test_replace_descriptors_with_keys() {
        // Test replacing descriptors with concrete keys
        let expression = format!("{} + {}", COMPLEX_DESCRIPTOR_FIXED, COMPLEX_DESCRIPTOR_WILDCARD);
        let descriptors = parse_descriptors(&expression).unwrap();
        
        let replaced = replace_descriptors_with_keys(&expression, &descriptors).unwrap();
        println!("Replaced expression: {}", replaced);
        
        // Should replace descriptors with derived public keys (not xpub keys)
        assert!(!replaced.contains("[C8FE8D4F/48h/1h/123h/2h]"), "Should not contain fingerprint/derivation path");
        assert!(!replaced.contains("xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda"), "Should not contain xpub keys");
        
        // Should contain derived public keys (66-character hex strings)
        let key_regex = regex::Regex::new(r"\b[0-9a-fA-F]{66}\b").unwrap();
        let keys: Vec<&str> = key_regex.find_iter(&replaced).map(|m| m.as_str()).collect();
        assert!(!keys.is_empty(), "Should contain derived public keys");
    }

        // KEY EXTRACTION TESTS
    
    #[test]
    fn test_extract_xonly_key_from_miniscript() {
        // Test extracting x-only key from miniscript (using 64-char x-only key)
        let miniscript = "pk(f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9)";
        let key = extract_xonly_key_from_miniscript(miniscript);
        println!("Extracted key from miniscript '{}': {:?}", miniscript, key);
        assert!(key.is_some(), "Should extract x-only key from miniscript");
        
        // Test with invalid miniscript
        let invalid_miniscript = "pk(invalid_key)";
        let key = extract_xonly_key_from_miniscript(invalid_miniscript);
        println!("Extracted key from invalid miniscript '{}': {:?}", invalid_miniscript, key);
        assert!(key.is_none(), "Should return None for invalid miniscript");
    }

    #[test]
    fn test_extract_internal_key_from_expression() {
        // Test extracting internal key from expression
        let expression = "pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9)";
        let key = extract_internal_key_from_expression(expression);
        assert_eq!(key, "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9", "Should extract key from pk()");
        
        // Test with expression with pk() but non-hex key (function takes first pk() match)
        let expression_with_pk = "and(pk(key1), pk(key2))";
        let key = extract_internal_key_from_expression(expression_with_pk);
        assert_eq!(key, "key1", "Should extract first pk() content even if not hex");
        
        // Test with expression without pk()
        let expression_no_pk = "and(key1, key2)";
        let key = extract_internal_key_from_expression(expression_no_pk);
        assert_eq!(key, crate::taproot::utils::NUMS_POINT, "Should return NUMS point when no pk() found");
    }

    #[test]
    fn test_extract_xonly_key_from_script_hex() {
        // Test extracting x-only key from script hex (20 = OP_PUSHBYTES_32, followed by 64-char x-only key)
        let script_hex = "20f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ac";
        let key = extract_xonly_key_from_script_hex(script_hex);
        assert!(key.is_some(), "Should extract x-only key from script hex");
        
        // Test with invalid script hex
        let invalid_script = "invalid_hex";
        let key = extract_xonly_key_from_script_hex(invalid_script);
        assert!(key.is_none(), "Should return None for invalid script hex");
    }

        // VALIDATION TESTS
    
    #[test]
    fn test_validate_inner_miniscript_legacy() {
        // Test validating miniscript in legacy context
        let miniscript = "pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9)";
        let result = validate_inner_miniscript(miniscript, "legacy");
        assert!(result.is_ok(), "Should validate miniscript in legacy context");
    }

    #[test]
    fn test_validate_inner_miniscript_segwit() {
        // Test validating miniscript in segwit context
        let miniscript = "pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9)";
        let result = validate_inner_miniscript(miniscript, "segwit");
        assert!(result.is_ok(), "Should validate miniscript in segwit context");
    }

    #[test]
    fn test_validate_inner_miniscript_taproot() {
        // Test validating miniscript in taproot context
        let miniscript = "pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9)";
        let result = validate_inner_miniscript(miniscript, "taproot");
        assert!(result.is_ok(), "Should validate miniscript in taproot context");
    }

    #[test]
    fn test_validate_inner_miniscript_invalid() {
        // Test validating invalid miniscript
        let invalid_miniscript = "invalid_miniscript";
        let result = validate_inner_miniscript(invalid_miniscript, "legacy");
        assert!(result.is_err(), "Should return error for invalid miniscript");
    }

        // EDGE CASES AND ERROR HANDLING
    
    #[test]
    fn test_edge_case_empty_expression() {
        // Test edge case with empty expression
        let result = process_expression_descriptors("");
        assert!(result.is_ok(), "Should handle empty expression gracefully");
        assert_eq!(result.unwrap(), "", "Should return empty string");
    }

    #[test]
    fn test_edge_case_whitespace_only() {
        // Test edge case with whitespace only
        let result = process_expression_descriptors("   \t\n  ");
        assert!(result.is_ok(), "Should handle whitespace gracefully");
    }

    #[test]
    fn test_performance_large_expression() {
        // Test performance with large expression containing many descriptors
        let mut expression = String::new();
        for i in 0..10 {
            expression.push_str(&format!("pk([C8FE8D4F/48h/1h/123h/2h]xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda/{}/0) + ", i));
        }
        expression.pop(); // Remove trailing " + "
        
        let descriptors = parse_descriptors(&expression).unwrap();
        // Should find multiple descriptors per input (bare + full versions)
        assert!(descriptors.len() >= 10, "Should parse at least 10 main descriptors");
        
        // Check that we found descriptors with the expected fingerprint
        let has_expected_descriptors = descriptors.iter().any(|(desc_str, parsed_desc)| 
            desc_str.contains("[C8FE8D4F/48h/1h/123h/2h]") && 
            parsed_desc.info.fingerprint.to_string().to_uppercase() == "C8FE8D4F");
        assert!(has_expected_descriptors, "Should find descriptors with expected fingerprint");
        
        let result = process_expression_descriptors(&expression).unwrap();
        println!("Processed large expression: {}", result);
        
        // Should contain derived public keys (not xpub keys)
        let key_regex = regex::Regex::new(r"\b[0-9a-fA-F]{66}\b").unwrap();
        let keys: Vec<&str> = key_regex.find_iter(&result).map(|m| m.as_str()).collect();
        assert!(!keys.is_empty(), "Should contain derived public keys");
    }
}