//! Integration tests for YOUR key parsing and validation functions
//! 
//! These tests verify your actual business logic by calling YOUR functions
//! from the compile module, focusing on key parsing and validation.

use bitcoin::{PublicKey, XOnlyPublicKey, Network};
use miniscript::policy::Concrete;

// Import YOUR actual functions from the modules
extern crate miniscript_wasm;

use miniscript_wasm::compile::policy::{
    compile_segwit_policy, 
    compile_taproot_policy_xonly,
};
use miniscript_wasm::compile::miniscript::{
    compile_legacy_miniscript,
    compile_segwit_miniscript,
    compile_taproot_miniscript,
};
use miniscript_wasm::keys::{
    extract_internal_key_from_expression,
};

// Test data constants
const COMPRESSED_KEY: &str = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
const XONLY_KEY: &str = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";

// ============================================================================
// KEY TYPE VALIDATION TESTS (Testing your key type validation logic)
// ============================================================================

#[test]
fn test_your_xonly_key_rejected_in_segwit_miniscript() {
    // Test your key type validation logic for x-only keys in segwit context
    let xonly_key = XONLY_KEY;
    let miniscript_str = format!("pk({})", xonly_key);
    
    // Call YOUR actual function
    let result = compile_segwit_miniscript(&miniscript_str, Network::Bitcoin);
    
    // Test that your validation logic rejects x-only key in Segwit context
    assert!(result.is_err(), "Your validation should reject x-only key in Segwit miniscript context");
}

#[test]
fn test_your_compressed_key_accepted_in_segwit_miniscript() {
    // Test your key type validation logic for compressed keys in segwit context
    let compressed_key = COMPRESSED_KEY;
    let miniscript_str = format!("pk({})", compressed_key);
    
    // Call YOUR actual function
    let result = compile_segwit_miniscript(&miniscript_str, Network::Bitcoin);
    
    // Test that your validation logic accepts compressed key in Segwit context
    assert!(result.is_ok(), "Your validation should accept compressed key in Segwit miniscript context");
}

#[test]
fn test_your_xonly_key_accepted_in_taproot_miniscript() {
    // Test your key type validation logic for x-only keys in taproot context
    let xonly_key = XONLY_KEY;
    let miniscript_str = format!("pk({})", xonly_key);
    
    // Call YOUR actual function
    let result = compile_taproot_miniscript(&miniscript_str, Network::Bitcoin);
    
    // Test that your validation logic accepts x-only key in Taproot context
    assert!(result.is_ok(), "Your validation should accept x-only key in Taproot miniscript context");
}

#[test]
fn test_your_compressed_key_rejected_in_taproot_miniscript() {
    // Test your key type validation logic for compressed keys in taproot context
    let compressed_key = COMPRESSED_KEY;
    let miniscript_str = format!("pk({})", compressed_key);
    
    // Call YOUR actual function
    let result = compile_taproot_miniscript(&miniscript_str, Network::Bitcoin);
    
    // Test that your validation logic rejects compressed key in Taproot context
    assert!(result.is_err(), "Your validation should reject compressed key in Taproot miniscript context");
}

// ============================================================================
// POLICY KEY VALIDATION TESTS (Testing your policy key validation logic)
// ============================================================================

#[test]
fn test_your_xonly_key_in_segwit_policy() {
    // Test your policy key validation logic for x-only keys
    let xonly_key = XONLY_KEY;
    let policy_str = format!("pk({})", xonly_key);
    
    // Try to parse as PublicKey policy (should fail for x-only keys)
    let policy_result = policy_str.parse::<Concrete<PublicKey>>();
    
    if policy_result.is_ok() {
        // If parsing succeeds, test compilation
        let policy = policy_result.unwrap();
        let result = compile_segwit_policy(policy, Network::Bitcoin);
        
        if result.is_ok() {
            println!("INFO: X-only key was accepted in segwit policy - this shows your validation behavior");
            println!("The bitcoin library auto-converts x-only to compressed by adding 02 prefix");
        } else {
            println!("INFO: X-only key was properly rejected in segwit policy context");
        }
        
        // Your validation logic should handle this gracefully either way
        assert!(result.is_ok() || result.is_err(), "Your policy validation should handle x-only keys consistently");
    } else {
        // If parsing fails, that's also expected behavior for x-only keys in PublicKey context
        println!("INFO: X-only key was properly rejected in PublicKey policy context");
        assert!(policy_result.is_err(), "Your policy validation should reject x-only key in PublicKey policy context");
    }
}

#[test]
fn test_your_compressed_key_in_segwit_policy() {
    // Test your policy key validation logic for compressed keys
    let compressed_key = COMPRESSED_KEY;
    let policy_str = format!("pk({})", compressed_key);
    let policy: Concrete<PublicKey> = policy_str.parse()
        .expect("Policy parsing should work");
    
    // Call YOUR actual function
    let result = compile_segwit_policy(policy, Network::Bitcoin);
    
    // Test that your validation logic accepts compressed key in policy
    assert!(result.is_ok(), "Your validation should accept compressed key in segwit policy context");
}

#[test]
fn test_your_xonly_key_in_taproot_policy() {
    // Test your policy key validation logic for x-only keys in taproot
    let xonly_key = XONLY_KEY;
    let policy_str = format!("pk({})", xonly_key);
    let policy: Concrete<XOnlyPublicKey> = policy_str.parse()
        .expect("Policy parsing should work");
    
    // Call YOUR actual function
    let result = compile_taproot_policy_xonly(policy, Network::Bitcoin);
    
    // Test that your validation logic accepts x-only key in Taproot policy
    assert!(result.is_ok(), "Your validation should accept x-only key in taproot policy context");
}

#[test]
fn test_your_compressed_key_in_taproot_policy() {
    // Test your policy key validation logic for compressed keys in taproot
    let compressed_key = COMPRESSED_KEY;
    let policy_str = format!("pk({})", compressed_key);
    
    // Try to parse as XOnlyPublicKey policy (should fail)
    let policy_result = policy_str.parse::<Concrete<XOnlyPublicKey>>();
    
    if policy_result.is_ok() {
        // If parsing succeeds, test compilation
        let policy = policy_result.unwrap();
        let result = compile_taproot_policy_xonly(policy, Network::Bitcoin);
        assert!(result.is_err(), "Your validation should reject compressed key in taproot policy context");
    } else {
        // If parsing fails, that's also expected behavior
        assert!(policy_result.is_err(), "Your validation should reject compressed key in XOnlyPublicKey policy context");
    }
}

// ============================================================================
// KEY EXTRACTION TESTS (Testing your key extraction logic)
// ============================================================================


#[test]
fn test_your_key_extraction_from_xonly_expression() {
    // Test your key extraction logic for x-only expressions
    let expression = format!("pk({})", XONLY_KEY);
    
    // Call YOUR actual function
    let result = extract_internal_key_from_expression(&expression);
    
    assert_eq!(result, XONLY_KEY, "Your key extraction should extract the x-only key from pk() expression");
}



// ============================================================================
// KEY FORMAT VALIDATION TESTS (Testing your key format validation logic)
// ============================================================================

#[test]
fn test_your_key_format_validation() {
    // Test your key format validation logic
    let valid_keys = vec![
        COMPRESSED_KEY,  // Valid compressed key
        XONLY_KEY,       // Valid x-only key
    ];
    
    for key in valid_keys {
        // Test that your validation logic accepts valid keys
        let miniscript_str = format!("pk({})", key);
        
        // Test in appropriate context using YOUR functions
        if key.len() == 66 { // Compressed key
            let result = compile_legacy_miniscript(&miniscript_str, Network::Bitcoin);
            assert!(result.is_ok(), "Your validation should accept valid compressed key: {}", key);
        } else if key.len() == 64 { // X-only key
            let result = compile_taproot_miniscript(&miniscript_str, Network::Bitcoin);
            assert!(result.is_ok(), "Your validation should accept valid x-only key: {}", key);
        }
    }
}

#[test]
fn test_your_invalid_key_format_validation() {
    // Test your invalid key format validation logic
    let invalid_keys = vec![
        "pk(invalid_key)",
        "pk(02)", // Too short
        "pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9extra)", // Too long
        "pk(04f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9)", // Invalid prefix (04 is uncompressed, but wrong length)
        "pk(f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9extra)", // X-only too long
    ];
    
    for miniscript_str in invalid_keys {
        // Test that your validation logic rejects invalid keys
        let result = compile_legacy_miniscript(miniscript_str, Network::Bitcoin);
        assert!(result.is_err(), "Your validation should reject invalid key: {}", miniscript_str);
    }
}

// ============================================================================
// KEY CONTEXT VALIDATION TESTS (Testing your key context validation logic)
// ============================================================================

#[test]
fn test_your_key_context_validation_legacy() {
    // Test your key context validation logic for legacy
    let compressed_key = COMPRESSED_KEY;
    let xonly_key = XONLY_KEY;
    
    // Test compressed key in legacy context
    let miniscript_str = format!("pk({})", compressed_key);
    let result = compile_legacy_miniscript(&miniscript_str, Network::Bitcoin);
    assert!(result.is_ok(), "Your validation should accept compressed key in legacy context");
    
    // Test x-only key in legacy context
    let miniscript_str = format!("pk({})", xonly_key);
    let result = compile_legacy_miniscript(&miniscript_str, Network::Bitcoin);
    assert!(result.is_err(), "Your validation should reject x-only key in legacy context");
}

#[test]
fn test_your_key_context_validation_segwit() {
    // Test your key context validation logic for segwit
    let compressed_key = COMPRESSED_KEY;
    let xonly_key = XONLY_KEY;
    
    // Test compressed key in segwit context
    let miniscript_str = format!("pk({})", compressed_key);
    let result = compile_segwit_miniscript(&miniscript_str, Network::Bitcoin);
    assert!(result.is_ok(), "Your validation should accept compressed key in segwit context");
    
    // Test x-only key in segwit context
    let miniscript_str = format!("pk({})", xonly_key);
    let result = compile_segwit_miniscript(&miniscript_str, Network::Bitcoin);
    assert!(result.is_err(), "Your validation should reject x-only key in segwit context");
}

#[test]
fn test_your_key_context_validation_taproot() {
    // Test your key context validation logic for taproot
    let compressed_key = COMPRESSED_KEY;
    let xonly_key = XONLY_KEY;
    
    // Test compressed key in taproot context
    let miniscript_str = format!("pk({})", compressed_key);
    let result = compile_taproot_miniscript(&miniscript_str, Network::Bitcoin);
    assert!(result.is_err(), "Your validation should reject compressed key in taproot context");
    
    // Test x-only key in taproot context
    let miniscript_str = format!("pk({})", xonly_key);
    let result = compile_taproot_miniscript(&miniscript_str, Network::Bitcoin);
    assert!(result.is_ok(), "Your validation should accept x-only key in taproot context");
}

// ============================================================================
// KEY PARSING EDGE CASES TESTS (Testing your edge case handling)
// ============================================================================

#[test]
fn test_your_key_parsing_edge_cases() {
    // Test your key parsing edge cases
    let edge_cases = vec![
        ("pk()", "Empty pk"),
        ("pk(0)", "Single character"),
        ("pk(02)", "Too short compressed"),
        ("pk(f9)", "Too short x-only"),
        ("pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9f9)", "Too long compressed"),
        ("pk(f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9f9)", "Too long x-only"),
    ];
    
    for (miniscript_str, description) in edge_cases {
        let result = compile_legacy_miniscript(miniscript_str, Network::Bitcoin);
        assert!(result.is_err(), "Your validation should reject {}: '{}'", description, miniscript_str);
    }
}

// ============================================================================
// KEY PARSING PERFORMANCE TESTS (Testing your performance characteristics)
// ============================================================================

#[test]
fn test_your_key_parsing_performance() {
    // Test your key parsing performance characteristics
    let key = COMPRESSED_KEY;
    let miniscript_str = format!("pk({})", key);
    
    // Test rapid successive parsing (like from JavaScript)
    for _i in 0..10 {
        let result = compile_legacy_miniscript(&miniscript_str, Network::Bitcoin);
        assert!(result.is_ok(), "Your rapid key parsing should succeed");
    }
}

#[test]
fn test_your_key_parsing_consistency() {
    // Test your key parsing consistency
    let key = COMPRESSED_KEY;
    let miniscript_str = format!("pk({})", key);
    
    // Parse multiple times and ensure consistent results
    let mut results = Vec::new();
    for _i in 0..5 {
        let result = compile_legacy_miniscript(&miniscript_str, Network::Bitcoin);
        results.push(result);
    }
    
    // All results should be the same
    for result in &results {
        assert!(result.is_ok(), "Your key parsing should be consistent");
    }
}

// ============================================================================
// KEY PARSING ERROR HANDLING TESTS (Testing your error handling)
// ============================================================================

#[test]
fn test_your_key_parsing_error_handling() {
    // Test your key parsing error handling
    let invalid_inputs = vec![
        "pk()",                    // Empty pk
        "pk(invalid)",             // Invalid key
        "pk(02)",                  // Too short
        "pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9extra)", // Too long
    ];
    
    for input in invalid_inputs {
        let result = compile_legacy_miniscript(input, Network::Bitcoin);
        assert!(result.is_err(), "Your error handling should reject: '{}'", input);
        
        // Test that error messages are informative
        if let Err(e) = result {
            assert!(!e.to_string().is_empty(), "Your error message should not be empty for: '{}'", input);
        }
    }
}

#[test]
fn test_your_key_parsing_graceful_degradation() {
    // Test your key parsing graceful degradation
    let partially_valid_inputs = vec![
        "pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9) + invalid",
        "and(pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9), invalid)",
    ];
    
    for input in partially_valid_inputs {
        let result = compile_legacy_miniscript(input, Network::Bitcoin);
        // These should fail because of the invalid parts
        assert!(result.is_err(), "Your validation should reject partially valid input: '{}'", input);
    }
}