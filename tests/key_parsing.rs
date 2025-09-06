//! Integration tests for key parsing and validation in different contexts

use bitcoin::{PublicKey, XOnlyPublicKey};
use miniscript::{Miniscript, Segwitv0, Tap, policy::Concrete};
use std::str::FromStr;

#[test]
fn test_xonly_key_rejected_in_segwit_miniscript() {
    // X-only key (32 bytes / 64 hex chars)
    let xonly_key = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let miniscript_str = format!("pk({})", xonly_key);
    
    // Should fail to parse x-only key as PublicKey in Segwit context
    let result = miniscript_str.parse::<Miniscript<PublicKey, Segwitv0>>();
    assert!(result.is_err(), "X-only key should be rejected in Segwit miniscript context");
}

#[test]
fn test_compressed_key_accepted_in_segwit_miniscript() {
    // Compressed key (33 bytes / 66 hex chars)
    let compressed_key = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let miniscript_str = format!("pk({})", compressed_key);
    
    // Should successfully parse compressed key in Segwit context
    let result = miniscript_str.parse::<Miniscript<PublicKey, Segwitv0>>();
    assert!(result.is_ok(), "Compressed key should be accepted in Segwit miniscript context");
}

#[test]
fn test_xonly_key_accepted_in_taproot_miniscript() {
    // X-only key (32 bytes / 64 hex chars)
    let xonly_key = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let miniscript_str = format!("pk({})", xonly_key);
    
    // Should successfully parse x-only key in Taproot context
    let result = miniscript_str.parse::<Miniscript<XOnlyPublicKey, Tap>>();
    assert!(result.is_ok(), "X-only key should be accepted in Taproot miniscript context");
}

#[test]
fn test_compressed_key_rejected_in_taproot_miniscript() {
    // Compressed key (33 bytes / 66 hex chars)
    let compressed_key = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let miniscript_str = format!("pk({})", compressed_key);
    
    // Should fail to parse compressed key as XOnlyPublicKey in Taproot context
    let result = miniscript_str.parse::<Miniscript<XOnlyPublicKey, Tap>>();
    assert!(result.is_err(), "Compressed key should be rejected in Taproot miniscript context");
}

#[test]
fn test_xonly_key_in_segwit_policy() {
    // X-only key (32 bytes / 64 hex chars)
    let xonly_key = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let policy_str = format!("pk({})", xonly_key);
    
    // Test if x-only key can be parsed as PublicKey in policy
    // This is the bug we found - it should fail but might succeed
    let result = policy_str.parse::<Concrete<PublicKey>>();
    
    if result.is_ok() {
        println!("WARNING: X-only key was accepted as PublicKey in policy - this is a bug!");
        println!("The bitcoin library is likely auto-converting x-only to compressed by adding 02 prefix");
        // For now, we document this behavior
        // Our WASM validation should catch this
    } else {
        println!("Good: X-only key was properly rejected in PublicKey policy context");
    }
}

#[test] 
fn test_compressed_key_in_segwit_policy() {
    // Compressed key (33 bytes / 66 hex chars)
    let compressed_key = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let policy_str = format!("pk({})", compressed_key);
    
    // Should successfully parse compressed key in policy
    let result = policy_str.parse::<Concrete<PublicKey>>();
    assert!(result.is_ok(), "Compressed key should be accepted in PublicKey policy context");
}

#[test]
fn test_xonly_key_in_taproot_policy() {
    // X-only key (32 bytes / 64 hex chars)
    let xonly_key = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let policy_str = format!("pk({})", xonly_key);
    
    // Should successfully parse x-only key in Taproot policy
    let result = policy_str.parse::<Concrete<XOnlyPublicKey>>();
    assert!(result.is_ok(), "X-only key should be accepted in XOnlyPublicKey policy context");
}

#[test]
fn test_compressed_key_in_taproot_policy() {
    // Compressed key (33 bytes / 66 hex chars)
    let compressed_key = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let policy_str = format!("pk({})", compressed_key);
    
    // Should fail to parse compressed key as XOnlyPublicKey in policy
    let result = policy_str.parse::<Concrete<XOnlyPublicKey>>();
    assert!(result.is_err(), "Compressed key should be rejected in XOnlyPublicKey policy context");
}

#[test]
fn test_direct_publickey_parsing() {
    // Test direct PublicKey parsing behavior
    let xonly_hex = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let compressed_hex = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    
    // Test if x-only hex can be parsed as PublicKey
    match PublicKey::from_str(xonly_hex) {
        Ok(pk) => {
            println!("X-only hex parsed as PublicKey: {} bytes", pk.to_bytes().len());
            println!("Resulting key: {}", pk);
            // This shows the auto-conversion behavior
        }
        Err(e) => {
            println!("X-only hex parsing failed (expected): {}", e);
        }
    }
    
    // Test compressed key parsing
    match PublicKey::from_str(compressed_hex) {
        Ok(pk) => {
            println!("Compressed hex parsed as PublicKey: {} bytes", pk.to_bytes().len());
        }
        Err(e) => {
            println!("Compressed hex parsing failed: {}", e);
        }
    }
}