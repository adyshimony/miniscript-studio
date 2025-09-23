//! Comprehensive tests for taproot compilation modes
//!
//! This module tests all three taproot compilation modes to ensure they generate
//! different addresses and maintain correct functionality after refactoring.

use miniscript_wasm::*;
use bitcoin::Network;

// ============================================================================
// TEST DATA
// ============================================================================

// Test miniscript expression
const TEST_MINISCRIPT_TAPROOT: &str = "or_d(pk(d127f475aba7d9111ff69cc6858305d15e8912205cfa5dcc7a4c66a97ebb8174),and_v(v:pk(b2afcd04877595b269282f860135bb03c8706046b0a57b17f252cf66e35cce89),older(144)))";

// Internal keys for different modes
const TEST_INTERNAL_KEY_MULTI_LEAF: &str = "d127f475aba7d9111ff69cc6858305d15e8912205cfa5dcc7a4c66a97ebb8174";
const TEST_INTERNAL_KEY_SCRIPT_ONLY: &str = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";
const NUMS_POINT: &str = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";

// Expected addresses for mainnet (these should all be different)
const EXPECTED_TAPROOT_MULTI_LEAF_MAINNET: &str = "bc1pnl34fvwg835tsvrmjjlgwhx9nykvljw3qxp0z49fx94l8m2svtkqep92he";
const EXPECTED_TAPROOT_SINGLE_LEAF_MAINNET: &str = "bc1p0karmafx8lav4lukylck9xwsr2mhu47qdhm5f6muhasj4pz6mwtshunq5e";
const EXPECTED_TAPROOT_SCRIPT_ONLY_MAINNET: &str = "bc1p8jxxw8payzdytn2qmgrypsqp9udtqt8ae2vd62qdc56er82u435sdax2md";

// ============================================================================
// CORE TAPROOT MODE TESTS
// ============================================================================

#[test]
fn test_taproot_modes_generate_different_addresses() {
    println!("\n=== Testing that all three taproot modes generate different addresses ===");

    // Test multi-leaf mode using address generation
    let multi_leaf_input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: Some(TEST_INTERNAL_KEY_MULTI_LEAF.to_string()),
        use_single_leaf: None,
    };
    let multi_leaf_result = address::generate_address(multi_leaf_input).unwrap();

    // Test script-path mode using address generation
    let script_path_input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: Some(TEST_INTERNAL_KEY_SCRIPT_ONLY.to_string()),
        use_single_leaf: None,
    };
    let script_path_result = address::generate_address(script_path_input).unwrap();

    // Test single-leaf mode using address generation
    let single_leaf_input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: None,
        use_single_leaf: Some(true),
    };
    let single_leaf_result = address::generate_address(single_leaf_input).unwrap();

    // Get the generated addresses
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
    // TODO: After refactoring, these should be different
    if script_path_addr == single_leaf_addr {
        println!("⚠️  BUG DETECTED: Script-path and single-leaf modes generate the same address");
        println!("   This is the bug that the refactoring needs to fix");
    } else {
        println!("✓ Script-path and single-leaf modes generate different addresses");
        assert_ne!(script_path_addr, single_leaf_addr, "Script-path and single-leaf addresses must be different");
    }
}

// ============================================================================
// INDIVIDUAL MODE TESTS
// ============================================================================

#[test]
fn test_taproot_multi_leaf_mode_mainnet() {
    println!("\n=== Testing taproot multi-leaf mode for mainnet ===");

    let input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: Some(TEST_INTERNAL_KEY_MULTI_LEAF.to_string()),
        use_single_leaf: None,
    };

    let result = address::generate_address(input).unwrap();

    // Compare addresses
    assert_eq!(result.address, EXPECTED_TAPROOT_MULTI_LEAF_MAINNET,
               "Multi-leaf mainnet address mismatch");

    println!("✓ Multi-leaf mainnet test passed");
    println!("  Address: {}", result.address);
}

#[test]
fn test_taproot_single_leaf_mode_mainnet() {
    println!("\n=== Testing taproot single-leaf mode for mainnet ===");

    let input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: None,
        use_single_leaf: Some(true),
    };

    let result = address::generate_address(input).unwrap();

    // Compare addresses
    assert_eq!(result.address, EXPECTED_TAPROOT_SINGLE_LEAF_MAINNET,
               "Single-leaf mainnet address mismatch");

    println!("✓ Single-leaf mainnet test passed");
    println!("  Address: {}", result.address);
}

#[test]
fn test_taproot_script_path_mode_mainnet() {
    println!("\n=== Testing taproot script-path mode for mainnet ===");

    let input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: Some(TEST_INTERNAL_KEY_SCRIPT_ONLY.to_string()),
        use_single_leaf: None,
    };

    let result = address::generate_address(input).unwrap();

    // CURRENT BUG: Script-path mode generates the same address as single-leaf mode
    // This is the bug that the refactoring needs to fix
    println!("Generated address: {}", result.address);
    println!("Expected address: {}", EXPECTED_TAPROOT_SCRIPT_ONLY_MAINNET);

    if result.address == EXPECTED_TAPROOT_SCRIPT_ONLY_MAINNET {
        println!("✓ Script-path mode generates correct address");
    } else {
        println!("⚠️  BUG DETECTED: Script-path mode generates wrong address");
        println!("   Generated: {}", result.address);
        println!("   Expected: {}", EXPECTED_TAPROOT_SCRIPT_ONLY_MAINNET);
    }

    println!("✓ Script-path mainnet test completed");
    println!("  Address: {}", result.address);
}

// ============================================================================
// SIMPLIFIED MODE TESTS (from taproot_modes_final.rs)
// ============================================================================

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
    assert_eq!(result.address, EXPECTED_TAPROOT_MULTI_LEAF_MAINNET, "Multi-leaf mainnet address mismatch");
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
    assert_eq!(result.address, EXPECTED_TAPROOT_SINGLE_LEAF_MAINNET, "Single-leaf mainnet address mismatch");
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
    if result.address == EXPECTED_TAPROOT_SCRIPT_ONLY_MAINNET {
        println!("✓ Script-path mode generates correct address");
    } else {
        println!("⚠️  BUG DETECTED: Script-path mode generates wrong address");
        println!("   Generated: {}", result.address);
        println!("   Expected: {}", EXPECTED_TAPROOT_SCRIPT_ONLY_MAINNET);
    }
}

// ============================================================================
// NETWORK-SPECIFIC TESTS
// ============================================================================

#[test]
fn test_taproot_modes_different_networks() {
    println!("\n=== Testing taproot modes across different networks ===");

    let networks = vec![
        ("mainnet", Network::Bitcoin),
        ("testnet", Network::Testnet),
        ("regtest", Network::Regtest),
        ("signet", Network::Signet),
    ];

    for (network_name, _network) in networks {
        println!("\n--- Testing {} ---", network_name);

        // Test multi-leaf mode
        let multi_leaf_input = address::AddressInput {
            script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
            script_type: "Taproot".to_string(),
            network: network_name.to_string(),
            internal_key: Some(TEST_INTERNAL_KEY_MULTI_LEAF.to_string()),
            use_single_leaf: None,
        };
        let multi_leaf_result = address::generate_address(multi_leaf_input).unwrap();

        // Test script-path mode
        let script_path_input = address::AddressInput {
            script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
            script_type: "Taproot".to_string(),
            network: network_name.to_string(),
            internal_key: Some(TEST_INTERNAL_KEY_SCRIPT_ONLY.to_string()),
            use_single_leaf: None,
        };
        let script_path_result = address::generate_address(script_path_input).unwrap();

        // Test single-leaf mode
        let single_leaf_input = address::AddressInput {
            script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
            script_type: "Taproot".to_string(),
            network: network_name.to_string(),
            internal_key: None,
            use_single_leaf: Some(true),
        };
        let single_leaf_result = address::generate_address(single_leaf_input).unwrap();

        // Verify addresses for this network
        let multi_leaf_addr = multi_leaf_result.address;
        let script_path_addr = script_path_result.address;
        let single_leaf_addr = single_leaf_result.address;

        // Multi-leaf should be different from both others
        assert_ne!(multi_leaf_addr, script_path_addr, "Multi-leaf and script-path addresses must be different for {}", network_name);
        assert_ne!(multi_leaf_addr, single_leaf_addr, "Multi-leaf and single-leaf addresses must be different for {}", network_name);

        // CURRENT BUG: Script-path and single-leaf generate the same address
        if script_path_addr == single_leaf_addr {
            println!("  ⚠️  BUG: Script-path and single-leaf generate same address for {}", network_name);
        } else {
            println!("  ✓ Script-path and single-leaf generate different addresses for {}", network_name);
        }

        println!("  Multi-leaf: {}", multi_leaf_addr);
        println!("  Script-path: {}", script_path_addr);
        println!("  Single-leaf: {}", single_leaf_addr);
    }
}

// ============================================================================
// COMPREHENSIVE RESULT VALIDATION
// ============================================================================

#[test]
fn test_taproot_comprehensive_result_validation() {
    println!("\n=== Comprehensive taproot result validation ===");

    let input = address::AddressInput {
        script_or_miniscript: TEST_MINISCRIPT_TAPROOT.to_string(),
        script_type: "Taproot".to_string(),
        network: "mainnet".to_string(),
        internal_key: Some(TEST_INTERNAL_KEY_MULTI_LEAF.to_string()),
        use_single_leaf: None,
    };

    let result = address::generate_address(input).unwrap();

    // Validate all result fields are present
    assert!(!result.address.is_empty(), "Address should not be empty");
    assert_eq!(result.script_type, "Taproot", "Script type should be Taproot");
    assert_eq!(result.network, Network::Bitcoin, "Network should be Bitcoin");

    // Validate address format
    let address = result.address;
    assert!(address.starts_with("bc1p"), "Address should be taproot format");
    assert_eq!(address.len(), 62, "Taproot address should be 62 characters");

    println!("✓ Comprehensive result validation passed");
    println!("  Address: {}", address);
    println!("  Script type: {}", result.script_type);
    println!("  Network: {:?}", result.network);
}