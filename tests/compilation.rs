//! Integration tests for miniscript and policy compilation

// Note: These tests would normally test the WASM functions, but since
// we're in a regular Rust test environment, we'll test the underlying
// Rust functions that the WASM wraps.

use miniscript::{Miniscript, Segwitv0, Tap, Legacy, policy::Concrete};
use bitcoin::{PublicKey, XOnlyPublicKey};

#[test]
fn test_compile_segwit_miniscript_with_compressed_key() {
    let compressed_key = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let miniscript = format!("pk({})", compressed_key);
    
    // Should parse successfully
    let result = miniscript.parse::<Miniscript<PublicKey, Segwitv0>>();
    assert!(result.is_ok(), "Should compile compressed key in Segwit context");
}

#[test]
fn test_compile_segwit_miniscript_with_xonly_key() {
    let xonly_key = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let miniscript = format!("pk({})", xonly_key);
    
    // Should fail - x-only keys not valid for Segwit
    let result = miniscript.parse::<Miniscript<PublicKey, Segwitv0>>();
    assert!(result.is_err(), "Should reject x-only key in Segwit context");
}

#[test]
fn test_compile_taproot_miniscript_with_xonly_key() {
    let xonly_key = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let miniscript = format!("pk({})", xonly_key);
    
    // Should parse successfully
    let result = miniscript.parse::<Miniscript<XOnlyPublicKey, Tap>>();
    assert!(result.is_ok(), "Should compile x-only key in Taproot context");
}

#[test]
fn test_compile_taproot_miniscript_with_compressed_key() {
    let compressed_key = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let miniscript = format!("pk({})", compressed_key);
    
    // Should fail - compressed keys not valid for Taproot
    let result = miniscript.parse::<Miniscript<XOnlyPublicKey, Tap>>();
    assert!(result.is_err(), "Should reject compressed key in Taproot context");
}

#[test]
fn test_compile_legacy_miniscript_with_compressed_key() {
    let compressed_key = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let miniscript = format!("pk({})", compressed_key);
    
    // Should parse successfully
    let result = miniscript.parse::<Miniscript<PublicKey, Legacy>>();
    assert!(result.is_ok(), "Should compile compressed key in Legacy context");
}

#[test]
fn test_compile_legacy_miniscript_with_xonly_key() {
    let xonly_key = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let miniscript = format!("pk({})", xonly_key);
    
    // Should fail - x-only keys not valid for Legacy
    let result = miniscript.parse::<Miniscript<PublicKey, Legacy>>();
    assert!(result.is_err(), "Should reject x-only key in Legacy context");
}

#[test]
fn test_complex_miniscript_segwit() {
    let key1 = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let key2 = "03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd";
    
    let miniscript = format!("and_v(v:pk({}),pk({}))", key1, key2);
    let result = miniscript.parse::<Miniscript<PublicKey, Segwitv0>>();
    assert!(result.is_ok(), "Should compile complex miniscript with compressed keys");
}

#[test]
fn test_complex_miniscript_taproot() {
    let key1 = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let key2 = "a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd";
    
    let miniscript = format!("and_v(v:pk({}),pk({}))", key1, key2);
    let result = miniscript.parse::<Miniscript<XOnlyPublicKey, Tap>>();
    assert!(result.is_ok(), "Should compile complex miniscript with x-only keys");
}

#[test]
fn test_policy_with_compressed_keys() {
    let key1 = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let key2 = "03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd";
    
    let policy = format!("and(pk({}),pk({}))", key1, key2);
    let result = policy.parse::<Concrete<PublicKey>>();
    assert!(result.is_ok(), "Should parse policy with compressed keys");
}

#[test]
fn test_policy_with_xonly_keys() {
    let key1 = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let key2 = "a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd";
    
    let policy = format!("and(pk({}),pk({}))", key1, key2);
    let result = policy.parse::<Concrete<XOnlyPublicKey>>();
    assert!(result.is_ok(), "Should parse policy with x-only keys for Taproot");
}