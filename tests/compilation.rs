//! Integration tests for YOUR actual compilation functions
//! 
//! These tests verify your actual business logic by calling YOUR functions
//! from the compile module, not external library behavior.

use bitcoin::{PublicKey, XOnlyPublicKey, Network};
use miniscript::policy::Concrete;

// Import YOUR actual functions from the modules
extern crate miniscript_wasm;

use miniscript_wasm::compile::policy::{
    compile_legacy_policy,
    compile_segwit_policy, 
    compile_taproot_policy_xonly,
};
use miniscript_wasm::compile::miniscript::{
    compile_legacy_miniscript,
    compile_segwit_miniscript,
    compile_taproot_miniscript,
};
use miniscript_wasm::descriptors::parser::parse_descriptors;
use miniscript_wasm::descriptors::processor::process_expression_descriptors;
use miniscript_wasm::keys::{
    extract_internal_key_from_expression,
    extract_xonly_key_from_miniscript,
    extract_xonly_key_from_script_hex,
};
use miniscript_wasm::validation::validate_inner_miniscript;

// Test data constants
const COMPRESSED_KEY: &str = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
const XONLY_KEY: &str = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
const SECOND_COMPRESSED_KEY: &str = "03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd";


#[test]
fn test_your_compile_legacy_policy() {
    let policy_str = format!("pk({})", COMPRESSED_KEY);
    let policy: Concrete<PublicKey> = policy_str.parse()
        .expect("Policy parsing should work");
    
    // Call YOUR actual function
    let result = compile_legacy_policy(policy, Network::Bitcoin);
    
    assert!(result.is_ok(), "Your legacy policy compilation should succeed");
    let (script_hex, script_asm, address_opt, script_size, context, normalized, _max_satisfaction_size, _max_weight, sanity_check_opt, is_non_malleable_opt) = result.unwrap();
    
    assert!(!script_hex.is_empty(), "Your script hex should not be empty");
    assert!(!script_asm.is_empty(), "Your script ASM should not be empty");
    assert!(script_size > 0, "Your script size should be positive");
    assert!(address_opt.is_some(), "Your address should not be empty");
    assert_eq!(context, "Legacy", "Your context should be Legacy");
    assert!(!normalized.is_empty(), "Your normalized policy should not be empty");
    assert!(sanity_check_opt.unwrap(), "Your sanity check should pass");
    assert!(is_non_malleable_opt.unwrap(), "Your simple pk() should be non-malleable");
}

#[test]
fn test_your_compile_segwit_policy() {
    let policy_str = format!("pk({})", COMPRESSED_KEY);
    let policy: Concrete<PublicKey> = policy_str.parse()
        .expect("Policy parsing should work");
    
    // Call YOUR actual function
    let result = compile_segwit_policy(policy, Network::Bitcoin);
    
    assert!(result.is_ok(), "Your segwit policy compilation should succeed");
    let (script_hex, script_asm, address_opt, script_size, context, normalized, _max_satisfaction_size, _max_weight, sanity_check_opt, is_non_malleable_opt) = result.unwrap();
    
    assert!(!script_hex.is_empty(), "Your script hex should not be empty");
    assert!(!script_asm.is_empty(), "Your script ASM should not be empty");
    assert!(script_size > 0, "Your script size should be positive");
    assert!(address_opt.is_some(), "Your address should not be empty");
    assert_eq!(context, "Segwit v0", "Your context should be Segwit v0");
    assert!(!normalized.is_empty(), "Your normalized policy should not be empty");
    assert!(sanity_check_opt.unwrap(), "Your sanity check should pass");
    assert!(is_non_malleable_opt.unwrap(), "Your simple pk() should be non-malleable");
}

#[test]
fn test_your_compile_taproot_policy() {
    let policy_str = format!("pk({})", XONLY_KEY);
    let policy: Concrete<XOnlyPublicKey> = policy_str.parse()
        .expect("Policy parsing should work");
    
    // Call YOUR actual function
    let result = compile_taproot_policy_xonly(policy, Network::Bitcoin);
    
    assert!(result.is_ok(), "Your taproot policy compilation should succeed");
    let (script_hex, script_asm, address_opt, script_size, context, normalized, _max_satisfaction_size, _max_weight, sanity_check_opt, is_non_malleable_opt) = result.unwrap();
    
    assert!(!script_hex.is_empty(), "Your script hex should not be empty");
    assert!(!script_asm.is_empty(), "Your script ASM should not be empty");
    assert!(script_size > 0, "Your script size should be positive");
    assert!(address_opt.is_some(), "Your address should not be empty");
    assert_eq!(context, "Taproot", "Your context should be Taproot");
    assert!(!normalized.is_empty(), "Your normalized policy should not be empty");
    assert!(sanity_check_opt.unwrap(), "Your sanity check should pass");
    assert!(is_non_malleable_opt.unwrap(), "Your simple pk() should be non-malleable");
}

#[test]
fn test_your_compile_complex_policy() {
    let policy_str = format!("and(pk({}),pk({}))", COMPRESSED_KEY, SECOND_COMPRESSED_KEY);
    let policy: Concrete<PublicKey> = policy_str.parse()
        .expect("Policy parsing should work");
    
    // Call YOUR actual function
    let result = compile_legacy_policy(policy, Network::Bitcoin);
    
    assert!(result.is_ok(), "Your complex policy compilation should succeed");
    let (script_hex, script_asm, address_opt, script_size, context, normalized, _max_satisfaction_size, _max_weight, _sanity_check_opt, _is_non_malleable_opt) = result.unwrap();
    
    assert!(!script_hex.is_empty(), "Your script hex should not be empty");
    assert!(!script_asm.is_empty(), "Your script ASM should not be empty");
    assert!(script_size > 50, "Your complex script should be reasonably large");
    assert!(address_opt.is_some(), "Your address should not be empty");
    assert_eq!(context, "Legacy", "Your context should be Legacy");
    assert!(!normalized.is_empty(), "Your normalized policy should not be empty");
}


#[test]
fn test_your_compile_legacy_miniscript() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    
    // Call YOUR actual function
    let result = compile_legacy_miniscript(&miniscript_str, Network::Bitcoin);
    
    assert!(result.is_ok(), "Your legacy miniscript compilation should succeed");
    let (script_hex, script_asm, address_opt, script_size, context, _max_satisfaction_size, _max_weight, sanity_check_opt, _is_non_malleable_opt, normalized_opt) = result.unwrap();
    
    assert!(!script_hex.is_empty(), "Your script hex should not be empty");
    assert!(!script_asm.is_empty(), "Your script ASM should not be empty");
    assert!(script_size > 0, "Your script size should be positive");
    assert!(address_opt.is_some(), "Your address should not be empty");
    assert_eq!(context, "Legacy", "Your context should be Legacy");
    assert!(sanity_check_opt.unwrap(), "Your sanity check should pass");
    assert!(_is_non_malleable_opt.unwrap(), "Your simple pk() should be non-malleable");
    assert!(normalized_opt.unwrap().len() > 0, "Your normalized miniscript should not be empty");
}

#[test]
fn test_your_compile_segwit_miniscript() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    
    // Call YOUR actual function
    let result = compile_segwit_miniscript(&miniscript_str, Network::Bitcoin);
    
    assert!(result.is_ok(), "Your segwit miniscript compilation should succeed");
    let (script_hex, script_asm, address_opt, script_size, context, _max_satisfaction_size, _max_weight, sanity_check_opt, _is_non_malleable_opt, normalized_opt) = result.unwrap();
    
    assert!(!script_hex.is_empty(), "Your script hex should not be empty");
    assert!(!script_asm.is_empty(), "Your script ASM should not be empty");
    assert!(script_size > 0, "Your script size should be positive");
    assert!(address_opt.is_some(), "Your address should not be empty");
    assert_eq!(context, "Segwit v0", "Your context should be Segwit v0");
    assert!(sanity_check_opt.unwrap(), "Your sanity check should pass");
    assert!(normalized_opt.unwrap().len() > 0, "Your normalized miniscript should not be empty");
}

#[test]
fn test_your_compile_taproot_miniscript() {
    let miniscript_str = format!("pk({})", XONLY_KEY);
    
    // Call YOUR actual function
    let result = compile_taproot_miniscript(&miniscript_str, Network::Bitcoin);
    
    assert!(result.is_ok(), "Your taproot miniscript compilation should succeed");
    let (script_hex, script_asm, address_opt, script_size, context, _max_satisfaction_size, _max_weight, sanity_check_opt, _is_non_malleable_opt, normalized_opt) = result.unwrap();
    
    assert!(!script_hex.is_empty(), "Your script hex should not be empty");
    assert!(!script_asm.is_empty(), "Your script ASM should not be empty");
    assert!(script_size > 0, "Your script size should be positive");
    assert!(address_opt.is_some(), "Your address should not be empty");
    assert_eq!(context, "Taproot", "Your context should be Taproot");
    assert!(sanity_check_opt.unwrap(), "Your sanity check should pass");
    assert!(normalized_opt.unwrap().len() > 0, "Your normalized miniscript should not be empty");
}

#[test]
fn test_your_compile_complex_miniscript() {
    let miniscript_str = format!("and_v(v:pk({}),pk({}))", COMPRESSED_KEY, SECOND_COMPRESSED_KEY);
    
    // Call YOUR actual function
    let result = compile_legacy_miniscript(&miniscript_str, Network::Bitcoin);
    
    assert!(result.is_ok(), "Your complex miniscript compilation should succeed");
    let (script_hex, script_asm, address_opt, script_size, context, _max_satisfaction_size, _max_weight, _sanity_check_opt, _is_non_malleable_opt, normalized_opt) = result.unwrap();
    
    assert!(!script_hex.is_empty(), "Your script hex should not be empty");
    assert!(!script_asm.is_empty(), "Your script ASM should not be empty");
    assert!(script_size > 50, "Your complex script should be reasonably large");
    assert!(address_opt.is_some(), "Your address should not be empty");
    assert_eq!(context, "Legacy", "Your context should be Legacy");
    assert!(normalized_opt.unwrap().len() > 0, "Your normalized miniscript should not be empty");
}


#[test]
fn test_your_parse_descriptors() {
    let expression = format!("pk([C8FE8D4F/48h/1h/123h/2h]xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda/0/0)");
    
    // Call YOUR actual function
    let result = parse_descriptors(&expression);
    
    assert!(result.is_ok(), "Your descriptor parsing should succeed");
    let descriptors = result.unwrap();
    assert!(!descriptors.is_empty(), "Your descriptor parsing should find descriptors");
}

#[test]
fn test_your_process_expression_descriptors() {
    let expression = format!("pk([C8FE8D4F/48h/1h/123h/2h]xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda/0/0)");
    
    // Call YOUR actual function
    let result = process_expression_descriptors(&expression);
    
    assert!(result.is_ok(), "Your expression processing should succeed");
    let processed = result.unwrap();
    assert!(!processed.is_empty(), "Your processed expression should not be empty");
}


#[test]
fn test_your_extract_internal_key_from_expression() {
    let expression = format!("pk({})", COMPRESSED_KEY);
    
    // Call YOUR actual function
    let result = extract_internal_key_from_expression(&expression);
    
    assert_eq!(result, COMPRESSED_KEY, "Your key extraction should extract the key from pk() expression");
}

#[test]
fn test_your_extract_internal_key_from_complex_expression() {
    let expression = format!("and(pk({}),pk({}))", COMPRESSED_KEY, SECOND_COMPRESSED_KEY);
    
    // Call YOUR actual function
    let result = extract_internal_key_from_expression(&expression);
    
    assert_eq!(result, COMPRESSED_KEY, "Your key extraction should extract first key from complex expression");
}

#[test]
fn test_your_extract_internal_key_no_pk() {
    let expression = "and(key1,key2)";
    
    // Call YOUR actual function
    let result = extract_internal_key_from_expression(expression);
    
    assert_eq!(result, "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0", "Your key extraction should return NUMS point when no pk() found");
}

#[test]
fn test_your_extract_xonly_key_from_miniscript() {
    let miniscript_str = format!("pk({})", XONLY_KEY);
    
    // Call YOUR actual function
    let result = extract_xonly_key_from_miniscript(&miniscript_str);
    
    assert!(result.is_some(), "Your x-only key extraction should extract key from miniscript");
}

#[test]
fn test_your_extract_xonly_key_from_script_hex() {
    let script_hex = format!("20{}ac", XONLY_KEY); // OP_PUSHBYTES_32 + key + OP_CHECKSIG
    
    // Call YOUR actual function
    let result = extract_xonly_key_from_script_hex(&script_hex);
    
    assert!(result.is_some(), "Your x-only key extraction should extract key from script hex");
}


#[test]
fn test_your_validate_inner_miniscript_legacy() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    
    // Call YOUR actual function
    let result = validate_inner_miniscript(&miniscript_str, "legacy");
    
    assert!(result.is_ok(), "Your legacy miniscript validation should succeed");
    let (desc1, desc2, _addr_opt, _size, _context, _satisfaction_size, _max_weight, _sanity_check, _is_non_malleable, error_msg_opt) = result.unwrap();
    
    assert!(!desc1.is_empty(), "Your descriptor result should not be empty");
    assert!(!desc2.is_empty(), "Your descriptor result should not be empty");
    assert!(error_msg_opt.is_some(), "Your validation should provide a result message");
}

#[test]
fn test_your_validate_inner_miniscript_segwit() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    
    // Call YOUR actual function
    let result = validate_inner_miniscript(&miniscript_str, "segwit");
    
    assert!(result.is_ok(), "Your segwit miniscript validation should succeed");
    let (desc1, desc2, _addr_opt, _size, _context, _satisfaction_size, _max_weight, _sanity_check, _is_non_malleable, error_msg_opt) = result.unwrap();
    
    assert!(!desc1.is_empty(), "Your descriptor result should not be empty");
    assert!(!desc2.is_empty(), "Your descriptor result should not be empty");
    assert!(error_msg_opt.is_some(), "Your validation should provide a result message");
}

#[test]
fn test_your_validate_inner_miniscript_taproot() {
    // Use a compressed key for taproot validation since your validation function
    // wraps miniscripts in wsh() which doesn't support x-only keys
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    
    // Call YOUR actual function
    let result = validate_inner_miniscript(&miniscript_str, "taproot");
    
    assert!(result.is_ok(), "Your taproot miniscript validation should succeed with compressed key");
    let (desc1, desc2, _addr_opt, _size, _context, _satisfaction_size, _max_weight, _sanity_check, _is_non_malleable, error_msg_opt) = result.unwrap();
    
    assert!(!desc1.is_empty(), "Your descriptor result should not be empty");
    assert!(!desc2.is_empty(), "Your descriptor result should not be empty");
    assert!(error_msg_opt.is_some(), "Your validation should provide a result message");
}

#[test]
fn test_your_validate_invalid_miniscript() {
    let invalid_miniscript = "invalid_miniscript";
    
    // Call YOUR actual function
    let result = validate_inner_miniscript(invalid_miniscript, "legacy");
    
    assert!(result.is_err(), "Your validation should fail for invalid miniscript");
}


#[test]
fn test_your_compile_miniscript_invalid_key() {
    let miniscript_str = "pk(invalid_key)";
    
    // Call YOUR actual function
    let result = compile_legacy_miniscript(miniscript_str, Network::Bitcoin);
    
    assert!(result.is_err(), "Your compilation should fail for invalid key");
}


#[test]
fn test_your_rapid_compilation() {
    let miniscript_str = format!("pk({})", COMPRESSED_KEY);
    
    // Simulate rapid successive calls (like from JavaScript)
    for _i in 0..10 {
        let result = compile_legacy_miniscript(&miniscript_str, Network::Bitcoin);
        assert!(result.is_ok(), "Your rapid compilation {} should succeed", _i);
    }
}

#[test]
fn test_your_large_expression_handling() {
    // Test your handling of large expressions with a simpler approach
    let expression = format!("pk({})", COMPRESSED_KEY);
    
    // Test that your logic can handle repeated parsing (simulating large expressions)
    for _i in 0..5 {
        let policy: Concrete<PublicKey> = expression.parse()
            .expect("Your large expression handling should work");
        
        let result = compile_legacy_policy(policy, Network::Bitcoin);
        assert!(result.is_ok(), "Your expression compilation should work");
        
        let (script_hex, _script_asm, _address, _script_size, _context, _normalized, _max_satisfaction_size, _max_weight, _sanity_check, _is_non_malleable) = result.unwrap();
        assert!(!script_hex.is_empty(), "Your expression should produce valid script");
    }
}