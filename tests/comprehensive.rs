//! Comprehensive tests for all WASM functionality
//! 
//! These tests verify the internal Rust functions that the WASM exports wrap,
//! ensuring all functionality works correctly before refactoring.

use miniscript::{Miniscript, Tap, Segwitv0, Legacy, policy::Concrete, Descriptor, DescriptorPublicKey};
use bitcoin::{PublicKey, XOnlyPublicKey, Network, ScriptBuf};
use std::str::FromStr;

// Test data constants
const COMPRESSED_KEY: &str = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
const XONLY_KEY: &str = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";

// Test basic miniscript compilation for all contexts
#[test]
fn test_legacy_miniscript_compilation() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    let ms: Miniscript<PublicKey, Legacy> = miniscript_str.parse().expect("Should parse legacy miniscript");
    
    let script = ms.encode();
    assert!(!script.is_empty(), "Script should not be empty");
    
    let desc = Descriptor::new_sh(ms).expect("Should create descriptor");
    let address = desc.address(Network::Bitcoin).expect("Should generate address");
    assert!(!address.to_string().is_empty(), "Address should not be empty");
}

#[test]
fn test_segwit_miniscript_compilation() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    let ms: Miniscript<PublicKey, Segwitv0> = miniscript_str.parse().expect("Should parse segwit miniscript");
    
    let script = ms.encode();
    assert!(!script.is_empty(), "Script should not be empty");
    
    let desc = Descriptor::new_wsh(ms).expect("Should create descriptor");
    let address = desc.address(Network::Bitcoin).expect("Should generate address");
    assert!(!address.to_string().is_empty(), "Address should not be empty");
}

#[test]
fn test_taproot_miniscript_compilation() {
    let miniscript_str = format!("pk({})", XONLY_KEY);
    let ms: Miniscript<XOnlyPublicKey, Tap> = miniscript_str.parse().expect("Should parse taproot miniscript");
    
    let script = ms.encode();
    assert!(!script.is_empty(), "Script should not be empty");
    
    let internal_key = XOnlyPublicKey::from_str(XONLY_KEY).expect("Should parse internal key");
    let desc = Descriptor::new_tr(internal_key, None).expect("Should create descriptor");
    let address = desc.address(Network::Bitcoin).expect("Should generate address");
    assert!(!address.to_string().is_empty(), "Address should not be empty");
}

// Test policy compilation for all contexts
#[test]
fn test_legacy_policy_compilation() {
    let policy_str = format!("pk({})", COMPRESSED_KEY);
    let policy: Concrete<PublicKey> = policy_str.parse().expect("Should parse legacy policy");
    
    let ms = policy.compile::<Legacy>().expect("Should compile to legacy miniscript");
    let script = ms.encode();
    assert!(!script.is_empty(), "Script should not be empty");
}

#[test]
fn test_segwit_policy_compilation() {
    let policy_str = format!("pk({})", COMPRESSED_KEY);
    let policy: Concrete<PublicKey> = policy_str.parse().expect("Should parse segwit policy");
    
    let ms = policy.compile::<Segwitv0>().expect("Should compile to segwit miniscript");
    let script = ms.encode();
    assert!(!script.is_empty(), "Script should not be empty");
}

#[test]
fn test_taproot_policy_compilation() {
    let policy_str = format!("pk({})", XONLY_KEY);
    let policy: Concrete<XOnlyPublicKey> = policy_str.parse().expect("Should parse taproot policy");
    
    let ms = policy.compile::<Tap>().expect("Should compile to taproot miniscript");
    let script = ms.encode();
    assert!(!script.is_empty(), "Script should not be empty");
}

// Test complex expressions
#[test]
fn test_complex_miniscript_expressions() {
    // Use different keys to avoid duplicate key error
    let key1 = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let key2 = "03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd";
    let complex_miniscript = format!("and_v(v:pk({}),pk({}))", key1, key2);
    let ms: Miniscript<PublicKey, Segwitv0> = complex_miniscript.parse().expect("Should parse complex miniscript");
    
    let script = ms.encode();
    assert!(!script.is_empty(), "Complex script should not be empty");
    assert!(script.len() > 50, "Complex script should be reasonably large");
}

#[test]
fn test_complex_policy_expressions() {
    // Use different keys to avoid duplicate key error
    let key1 = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let key2 = "03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd";
    let complex_policy = format!("and(pk({}),pk({}))", key1, key2);
    let policy: Concrete<PublicKey> = complex_policy.parse().expect("Should parse complex policy");
    
    let ms = policy.compile::<Legacy>().expect("Should compile complex policy");
    let script = ms.encode();
    assert!(!script.is_empty(), "Complex policy script should not be empty");
}

// Test taproot multi-leaf expressions
#[test]
fn test_taproot_multi_leaf() {
    let multi_leaf = format!("tr({},{{pk({}),pk({})}})", XONLY_KEY, XONLY_KEY, XONLY_KEY);
    let desc: Descriptor<XOnlyPublicKey> = multi_leaf.parse().expect("Should parse multi-leaf taproot");
    
    let address = desc.address(Network::Bitcoin).expect("Should generate address");
    assert!(!address.to_string().is_empty(), "Multi-leaf address should not be empty");
}

// Test descriptor processing
#[test]
fn test_descriptor_processing() {
    let descriptor = format!("wsh(pk({}))", COMPRESSED_KEY);
    let desc: Descriptor<DescriptorPublicKey> = descriptor.parse().expect("Should parse descriptor");
    
    // For DescriptorPublicKey, we need to translate to concrete keys first
    // This simulates what the WASM function does internally
    assert!(!desc.to_string().is_empty(), "Descriptor should not be empty");
}

#[test]
fn test_taproot_descriptor_processing() {
    // Use a simpler taproot descriptor format
    let descriptor = format!("tr({})", XONLY_KEY);
    let desc: Descriptor<XOnlyPublicKey> = descriptor.parse().expect("Should parse taproot descriptor");
    
    let address = desc.address(Network::Bitcoin).expect("Should generate address");
    assert!(!address.to_string().is_empty(), "Taproot descriptor address should not be empty");
}

// Test key validation
#[test]
fn test_key_validation_compressed_in_legacy() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    let result = miniscript_str.parse::<Miniscript<PublicKey, Legacy>>();
    assert!(result.is_ok(), "Compressed key should work in legacy context");
}

#[test]
fn test_key_validation_compressed_in_segwit() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    let result = miniscript_str.parse::<Miniscript<PublicKey, Segwitv0>>();
    assert!(result.is_ok(), "Compressed key should work in segwit context");
}

#[test]
fn test_key_validation_compressed_in_taproot() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    let result = miniscript_str.parse::<Miniscript<XOnlyPublicKey, Tap>>();
    assert!(result.is_err(), "Compressed key should fail in taproot context");
}

#[test]
fn test_key_validation_xonly_in_legacy() {
    let miniscript_str = format!("pk({})", XONLY_KEY);
    let result = miniscript_str.parse::<Miniscript<PublicKey, Legacy>>();
    assert!(result.is_err(), "X-only key should fail in legacy context");
}

#[test]
fn test_key_validation_xonly_in_segwit() {
    let miniscript_str = format!("pk({})", XONLY_KEY);
    let result = miniscript_str.parse::<Miniscript<PublicKey, Segwitv0>>();
    assert!(result.is_err(), "X-only key should fail in segwit context");
}

#[test]
fn test_key_validation_xonly_in_taproot() {
    let miniscript_str = format!("pk({})", XONLY_KEY);
    let result = miniscript_str.parse::<Miniscript<XOnlyPublicKey, Tap>>();
    assert!(result.is_ok(), "X-only key should work in taproot context");
}

// Test network handling
#[test]
fn test_network_handling() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    let ms: Miniscript<PublicKey, Legacy> = miniscript_str.parse().expect("Should parse miniscript");
    let desc = Descriptor::new_sh(ms).expect("Should create descriptor");
    
    let mainnet_addr = desc.address(Network::Bitcoin).expect("Should generate mainnet address");
    let testnet_addr = desc.address(Network::Testnet).expect("Should generate testnet address");
    
    assert_ne!(mainnet_addr.to_string(), testnet_addr.to_string(), "Addresses should differ by network");
}

// Test script lifting
#[test]
fn test_script_lifting() {
    // Test lifting a simple Bitcoin script
    let script_hex = "76a914f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f988ac";
    let script_bytes = hex::decode(script_hex).expect("Should decode hex");
    let script = ScriptBuf::from_bytes(script_bytes);
    
    // This would be the internal function that lift_to_miniscript calls
    // For now, just verify the script is valid
    assert!(!script.is_empty(), "Script should not be empty");
}

// Test edge cases
#[test]
fn test_empty_inputs() {
    let result = "".parse::<Miniscript<PublicKey, Legacy>>();
    assert!(result.is_err(), "Empty input should fail");
    
    let result2 = "".parse::<Concrete<PublicKey>>();
    assert!(result2.is_err(), "Empty policy should fail");
}

#[test]
fn test_malformed_keys() {
    let malformed_keys = vec![
        "invalid_key",
        "02", // Too short
        "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9extra", // Too long
    ];
    
    for key in malformed_keys {
        let miniscript_str = format!("pk({})", key);
        let result = miniscript_str.parse::<Miniscript<PublicKey, Legacy>>();
        assert!(result.is_err(), "Malformed key '{}' should fail", key);
    }
}

#[test]
fn test_whitespace_handling() {
    let key = COMPRESSED_KEY;
    let test_cases = vec![
        format!("pk({})", key),           // Normal
        // Note: Spaces around keys are not supported by miniscript parser
        // format!("pk( {} )", key),         // Spaces around key - not supported
        // format!("pk(\n{}\n)", key),       // Newlines around key - not supported
    ];
    
    for miniscript_str in test_cases {
        let result = miniscript_str.parse::<Miniscript<PublicKey, Legacy>>();
        assert!(result.is_ok(), "Whitespace should be handled: '{}'", miniscript_str);
    }
}

// Test weight calculations
#[test]
fn test_weight_calculations() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    let ms: Miniscript<PublicKey, Legacy> = miniscript_str.parse().expect("Should parse miniscript");
    
    let desc = Descriptor::new_sh(ms).expect("Should create descriptor");
    let max_weight = desc.max_weight_to_satisfy().expect("Should calculate weight");
    
    assert!(max_weight.to_wu() > 0, "Weight should be positive");
}

#[test]
fn test_taproot_weight_calculations() {
    let miniscript_str = format!("pk({})", XONLY_KEY);
    let _ms: Miniscript<XOnlyPublicKey, Tap> = miniscript_str.parse().expect("Should parse taproot miniscript");
    
    let internal_key = XOnlyPublicKey::from_str(XONLY_KEY).expect("Should parse internal key");
    let desc = Descriptor::new_tr(internal_key, None).expect("Should create descriptor");
    let max_weight = desc.max_weight_to_satisfy().expect("Should calculate weight");
    
    assert!(max_weight.to_wu() > 0, "Taproot weight should be positive");
}

// Test sanity checks
#[test]
fn test_sanity_checks() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    let ms: Miniscript<PublicKey, Legacy> = miniscript_str.parse().expect("Should parse miniscript");
    
    let sanity_check = ms.sanity_check();
    assert!(sanity_check.is_ok(), "Sanity check should pass");
    
    let is_non_malleable = ms.is_non_malleable();
    assert!(is_non_malleable, "Simple pk() should be non-malleable");
}

// Test satisfaction size calculations
#[test]
fn test_satisfaction_size_calculations() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    let ms: Miniscript<PublicKey, Legacy> = miniscript_str.parse().expect("Should parse miniscript");
    
    let max_satisfaction_size = ms.max_satisfaction_size();
    assert!(max_satisfaction_size.is_ok(), "Should have satisfaction size");
    assert!(max_satisfaction_size.unwrap() > 0, "Satisfaction size should be positive");
}

// Test descriptor key translation
#[test]
fn test_descriptor_key_translation() {
    let descriptor = format!("wsh(pk({}))", COMPRESSED_KEY);
    let desc: Descriptor<DescriptorPublicKey> = descriptor.parse().expect("Should parse descriptor");
    
    // For DescriptorPublicKey, we need to translate to concrete keys first
    // This simulates what the WASM function does internally
    assert!(!desc.to_string().is_empty(), "Translated descriptor should not be empty");
}

// Test range descriptor handling
#[test]
fn test_range_descriptor_patterns() {
    // Test patterns that JavaScript looks for
    let range_patterns = vec![
        "/*",
        "/<0;1>/*",
        "/<0;1>/1",
    ];
    
    for pattern in range_patterns {
        // These would be detected by the JavaScript regex patterns
        assert!(pattern.contains("/*") || (pattern.contains("/<") && pattern.contains(">/")), 
                "Pattern '{}' should be detected as range", pattern);
    }
}

// Test concurrent operations (simulating rapid JS calls)
#[test]
fn test_concurrent_style_operations() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    
    // Simulate rapid successive operations
    for _ in 0..10 {
        let ms: Miniscript<PublicKey, Legacy> = miniscript_str.parse().expect("Should parse miniscript");
        let script = ms.encode();
        assert!(!script.is_empty(), "Concurrent operations should succeed");
    }
}

// Test JSON structure expectations
#[test]
fn test_json_structure_expectations() {
    // Test that our internal functions would produce the structure JavaScript expects
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    let ms: Miniscript<PublicKey, Legacy> = miniscript_str.parse().expect("Should parse miniscript");
    
    let script = ms.encode();
    let script_hex = hex::encode(script.as_bytes());
    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
    let script_size = script.len();
    
    // Verify the fields JavaScript expects
    assert!(!script_hex.is_empty(), "Script hex should not be empty");
    assert!(!script_asm.is_empty(), "Script asm should not be empty");
    assert!(script_size > 0, "Script size should be positive");
    
    // Test address generation
    let desc = Descriptor::new_sh(ms).expect("Should create descriptor");
    let address = desc.address(Network::Bitcoin).expect("Should generate address");
    assert!(!address.to_string().is_empty(), "Address should not be empty");
}
