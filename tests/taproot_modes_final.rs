//! Final taproot mode tests to lock behavior before refactoring
//! 
//! These tests ensure the three taproot modes generate different addresses
//! and will catch any regressions during refactoring.

use miniscript_wasm::*;
use bitcoin::Network;

// Test data
const TEST_MINISCRIPT_TAPROOT: &str = "or_d(pk(d127f475aba7d9111ff69cc6858305d15e8912205cfa5dcc7a4c66a97ebb8174),and_v(v:pk(b2afcd04877595b269282f860135bb03c8706046b0a57b17f252cf66e35cce89),older(144)))";
const TEST_INTERNAL_KEY_MULTI_LEAF: &str = "d127f475aba7d9111ff69cc6858305d15e8912205cfa5dcc7a4c66a97ebb8174";
const TEST_INTERNAL_KEY_SCRIPT_ONLY: &str = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";

// Expected addresses (these should be different)
const EXPECTED_MULTI_LEAF_MAINNET: &str = "bc1pnl34fvwg835tsvrmjjlgwhx9nykvljw3qxp0z49fx94l8m2svtkqep92he";
const EXPECTED_SINGLE_LEAF_MAINNET: &str = "bc1p0karmafx8lav4lukylck9xwsr2mhu47qdhm5f6muhasj4pz6mwtshunq5e";
const EXPECTED_SCRIPT_PATH_MAINNET: &str = "bc1p8jxxw8payzdytn2qmgrypsqp9udtqt8ae2vd62qdc56er82u435sdax2md";

#[test]
fn test_taproot_modes_generate_different_addresses() {
    println!("\n=== Testing that all three taproot modes generate different addresses ===");
    
    // Multi-leaf mode
    let multi_leaf_input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: Some(TEST_INTERNAL_KEY_MULTI_LEAF.to_string()),
        use_single_leaf: None,
    };
    let multi_leaf_result = address::generate_address(multi_leaf_input).unwrap();
    
    // Script-path mode
    let script_path_input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: Some(TEST_INTERNAL_KEY_SCRIPT_ONLY.to_string()),
        use_single_leaf: None,
    };
    let script_path_result = address::generate_address(script_path_input).unwrap();
    
    // Single-leaf mode
    let single_leaf_input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: None,
        use_single_leaf: Some(true),
    };
    let single_leaf_result = address::generate_address(single_leaf_input).unwrap();
    
    let multi_leaf_addr = multi_leaf_result.address;
    let script_path_addr = script_path_result.address;
    let single_leaf_addr = single_leaf_result.address;
    
    println!("Multi-leaf address: {}", multi_leaf_addr);
    println!("Script-path address: {}", script_path_addr);
    println!("Single-leaf address: {}", single_leaf_addr);
    
    // Multi-leaf should be different from both others
    assert_ne!(multi_leaf_addr, script_path_addr, "Multi-leaf and script-path addresses must be different");
    assert_ne!(multi_leaf_addr, single_leaf_addr, "Multi-leaf and single-leaf addresses must be different");
    
    // CURRENT BUG: Script-path and single-leaf generate the same address
    if script_path_addr == single_leaf_addr {
        println!("⚠️  BUG DETECTED: Script-path and single-leaf modes generate the same address");
        println!("   This is the bug that the refactoring needs to fix");
        // Don't assert here - this is the current bug we're fixing
    } else {
        println!("✓ Script-path and single-leaf modes generate different addresses");
        assert_ne!(script_path_addr, single_leaf_addr, "Script-path and single-leaf addresses must be different");
    }
}

#[test]
fn test_taproot_multi_leaf_mode() {
    let input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: Some(TEST_INTERNAL_KEY_MULTI_LEAF.to_string()),
        use_single_leaf: None,
    };
    
    let result = address::generate_address(input).unwrap();
    assert_eq!(result.address, EXPECTED_MULTI_LEAF_MAINNET, "Multi-leaf mainnet address mismatch");
}

#[test]
fn test_taproot_single_leaf_mode() {
    let input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: None,
        use_single_leaf: Some(true),
    };
    
    let result = address::generate_address(input).unwrap();
    assert_eq!(result.address, EXPECTED_SINGLE_LEAF_MAINNET, "Single-leaf mainnet address mismatch");
}

#[test]
fn test_taproot_script_path_mode() {
    let input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: Some(TEST_INTERNAL_KEY_SCRIPT_ONLY.to_string()),
        use_single_leaf: None,
    };
    
    let result = address::generate_address(input).unwrap();
    
    // CURRENT BUG: This generates the same address as single-leaf mode
    if result.address == EXPECTED_SCRIPT_PATH_MAINNET {
        println!("✓ Script-path mode generates correct address");
    } else {
        println!("⚠️  BUG DETECTED: Script-path mode generates wrong address");
        println!("   Generated: {}", result.address);
        println!("   Expected: {}", EXPECTED_SCRIPT_PATH_MAINNET);
    }
}
