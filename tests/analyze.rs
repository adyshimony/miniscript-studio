//! Tests for our analyze module functions
//!
//! These tests verify the analyze module's helper functions and output.
//! The main WASM functions (analyze_miniscript, analyze_policy) return JsValue
//! so we test the underlying logic through the public helper functions.

#[cfg(test)]
mod analyze_tests {
    use miniscript::policy::{Concrete, Liftable};
    use miniscript::{Miniscript, Segwitv0};
    use miniscript_wasm::analyze::{semantic_to_tree, enumerate_spending_paths};

    // ========================================
    // Tests for semantic_to_tree()
    // ========================================

    #[test]
    fn test_tree_simple_pk() {
        let policy: Concrete<String> = "pk(Alice)".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let tree = semantic_to_tree(&semantic, 0);

        assert!(tree.contains("pk(Alice)"));
    }

    #[test]
    fn test_tree_and_policy() {
        let policy: Concrete<String> = "and(pk(Alice),pk(Bob))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let tree = semantic_to_tree(&semantic, 0);

        // Should have thresh(2/2) at root with two pk children
        assert!(tree.contains("thresh(2/2)") || tree.contains("AND"));
        assert!(tree.contains("pk(Alice)"));
        assert!(tree.contains("pk(Bob)"));
    }

    #[test]
    fn test_tree_or_policy() {
        let policy: Concrete<String> = "or(pk(Alice),pk(Bob))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let tree = semantic_to_tree(&semantic, 0);

        // Should have thresh(1/2) or OR at root
        assert!(tree.contains("thresh(1/2)") || tree.contains("OR"));
        assert!(tree.contains("pk(Alice)"));
        assert!(tree.contains("pk(Bob)"));
    }

    #[test]
    fn test_tree_thresh_policy() {
        let policy: Concrete<String> = "thresh(2,pk(Alice),pk(Bob),pk(Charlie))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let tree = semantic_to_tree(&semantic, 0);

        assert!(tree.contains("thresh(2/3)"));
        assert!(tree.contains("pk(Alice)"));
        assert!(tree.contains("pk(Bob)"));
        assert!(tree.contains("pk(Charlie)"));
    }

    #[test]
    fn test_tree_with_timelock() {
        let policy: Concrete<String> = "and(pk(Alice),older(144))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let tree = semantic_to_tree(&semantic, 0);

        assert!(tree.contains("pk(Alice)"));
        assert!(tree.contains("older(144)"));
    }

    #[test]
    fn test_tree_complex_nested() {
        // and(pk(Alice), or(pk(Bob), and(pk(Charlie), older(144))))
        let policy: Concrete<String> = "and(pk(Alice),or(pk(Bob),and(pk(Charlie),older(144))))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let tree = semantic_to_tree(&semantic, 0);

        assert!(tree.contains("pk(Alice)"));
        assert!(tree.contains("pk(Bob)"));
        assert!(tree.contains("pk(Charlie)"));
        assert!(tree.contains("older(144)"));
    }

    #[test]
    fn test_tree_has_children() {
        let policy: Concrete<String> = "and(pk(Alice),pk(Bob))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let tree = semantic_to_tree(&semantic, 0);

        // Tree should have children for compound policies
        assert!(!tree.children.is_empty(), "Tree should have children");
        assert_eq!(tree.children.len(), 2, "AND should have 2 children");
    }

    // ========================================
    // Tests for enumerate_spending_paths()
    // ========================================

    #[test]
    fn test_paths_simple_pk() {
        let policy: Concrete<String> = "pk(Alice)".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let paths = enumerate_spending_paths(&semantic);

        assert_eq!(paths.len(), 1);
        assert!(paths[0].contains("Alice"));
    }

    #[test]
    fn test_paths_and_policy() {
        let policy: Concrete<String> = "and(pk(Alice),pk(Bob))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let paths = enumerate_spending_paths(&semantic);

        // AND means one path with both keys
        assert_eq!(paths.len(), 1);
        assert!(paths[0].contains("Alice"));
        assert!(paths[0].contains("Bob"));
    }

    #[test]
    fn test_paths_or_policy() {
        let policy: Concrete<String> = "or(pk(Alice),pk(Bob))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let paths = enumerate_spending_paths(&semantic);

        // OR means two separate paths
        assert_eq!(paths.len(), 2);
    }

    #[test]
    fn test_paths_thresh_2_of_3() {
        let policy: Concrete<String> = "thresh(2,pk(Alice),pk(Bob),pk(Charlie))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let paths = enumerate_spending_paths(&semantic);

        // 2-of-3 has 3 combinations: AB, AC, BC
        assert_eq!(paths.len(), 3);
    }

    #[test]
    fn test_paths_with_timelock() {
        let policy: Concrete<String> = "and(pk(Alice),older(144))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let paths = enumerate_spending_paths(&semantic);

        assert_eq!(paths.len(), 1);
        assert!(paths[0].contains("Alice"));
        assert!(paths[0].contains("144") || paths[0].contains("wait"));
    }

    #[test]
    fn test_paths_with_hashlock() {
        let policy: Concrete<String> = "and(pk(Alice),sha256(0000000000000000000000000000000000000000000000000000000000000001))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let paths = enumerate_spending_paths(&semantic);

        assert_eq!(paths.len(), 1);
        assert!(paths[0].contains("Alice"));
        assert!(paths[0].contains("SHA256") || paths[0].contains("hash") || paths[0].contains("preimage"));
    }

    #[test]
    fn test_paths_complex_or_and() {
        // or(pk(Alice), and(pk(Bob), older(144)))
        let policy: Concrete<String> = "or(pk(Alice),and(pk(Bob),older(144)))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let paths = enumerate_spending_paths(&semantic);

        assert_eq!(paths.len(), 2);
    }

    #[test]
    fn test_paths_format() {
        let policy: Concrete<String> = "or(pk(Alice),and(pk(Bob),older(144)))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let paths = enumerate_spending_paths(&semantic);

        // Check that paths are formatted with "Path X:" prefix
        for (i, path) in paths.iter().enumerate() {
            assert!(path.starts_with(&format!("Path {}:", i + 1)));
        }
    }

    #[test]
    fn test_tree_with_absolute_timelock() {
        let policy: Concrete<String> = "and(pk(Alice),after(800000))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let tree = semantic_to_tree(&semantic, 0);

        assert!(tree.contains("after(800000)"));
    }

    #[test]
    fn test_paths_with_absolute_timelock() {
        let policy: Concrete<String> = "and(pk(Alice),after(800000))".parse().unwrap();
        let semantic = policy.lift().unwrap();
        let paths = enumerate_spending_paths(&semantic);

        assert_eq!(paths.len(), 1);
        assert!(paths[0].contains("block 800000") || paths[0].contains("800000"));
    }

    #[test]
    fn test_miniscript_lifts_correctly() {
        // Test that we can also work with lifted miniscript
        let ms: Miniscript<String, Segwitv0> = "or_d(pk(Alice),and_v(v:pk(Bob),older(144)))".parse().unwrap();
        let semantic = ms.lift().unwrap();

        let tree = semantic_to_tree(&semantic, 0);
        assert!(tree.contains("OR"));
        assert!(tree.contains("pk(Alice)"));

        let paths = enumerate_spending_paths(&semantic);
        assert_eq!(paths.len(), 2);
    }

    #[test]
    fn test_deeply_nested_policy() {
        // or(pk(A), or(pk(B), or(pk(C), pk(D))))
        let policy: Concrete<String> = "or(pk(A),or(pk(B),or(pk(C),pk(D))))".parse().unwrap();
        let semantic = policy.lift().unwrap();

        let paths = enumerate_spending_paths(&semantic);
        // Should have 4 separate paths (one for each key)
        assert_eq!(paths.len(), 4);

        let tree = semantic_to_tree(&semantic, 0);
        assert!(tree.contains("pk(A)"));
        assert!(tree.contains("pk(B)"));
        assert!(tree.contains("pk(C)"));
        assert!(tree.contains("pk(D)"));
    }

    #[test]
    fn test_check_timelocks_behavior() {
        // check_timelocks() detects height-based vs time-based mixing
        // Height-based: value < 500_000_000
        // Time-based: value >= 500_000_000

        // Valid: Both height-based (relative + absolute)
        let policy1: Concrete<String> = "and(after(100),older(144))".parse().unwrap();
        assert!(policy1.check_timelocks().is_ok(), "Both height-based should be OK");

        // Valid: Only one timelock type
        let policy2: Concrete<String> = "and(pk(Alice),older(144))".parse().unwrap();
        assert!(policy2.check_timelocks().is_ok(), "Single timelock should be OK");

        // This parses but has mixed timelocks - older(144) is height-based, after(500000001) is time-based
        // But check_timelocks DOES NOT detect this!
        let policy3: Concrete<String> = "thresh(2,pk(Bob),older(144),after(500000001))".parse().unwrap();
        println!("thresh(2,pk(Bob),older(144),after(500000001)) check_timelocks: {:?}", policy3.check_timelocks());

        // Verify it parses but check_timelocks doesn't catch it
        // This is a limitation of check_timelocks - it only checks within same type (after vs after, older vs older)
        // not across types (after vs older)
    }

    #[test]
    fn test_large_thresh_parsing() {
        // Test a 2-of-15 multisig with hex keys
        let policy_str = "thresh(2,pk(03da6a0f9b14e0c82b2e3b0e9f9f3b4a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f),pk(02c8a5c2e3b4a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3),pk(03b7a0766e8b6b29700c970dbb0b48ac195cd8aedaa3d73152d01c0771c2874aa9),pk(02f8073b09f6e6f0342456b8c27fb0187d618653cad737f3117bf5ce5dbb781325),pk(03889b5a28cfeb2958873df03119a43536c12c52a6484fd4afe71229a5ae06b55c),pk(021208140fbad9c4df73936df2e7e4a9333ad4925af7532f0c555b37399300e696),pk(0242b595b5feeb32e4c5a86971542dc6d0ac1627165f22d37332085fc527d1c13f),pk(02c98f1ee625379323ecaa58806f70f784256d5fc0fe84179935590a2156b233ef),pk(030bf2c8353ed6360cc76ae447d20f3e52988ebb325057f551a6156c254b9fb9ab),pk(02cb48e9d06a6baf071d581e7844e9a62a560aca3512edff68623d5003549fcef0),pk(03f4c1a73d0bd7dbc0c25aa361684bcb158c274ad76477eb145faea3858dc2fd4f),pk(02318f455a1ef51763e1acb573449e4a52e8fcada49f8a0fea8387a4f4b146b3ac),pk(03681ff8dd97a900012dc58dcb4b9ab3e40b29b96bc3e014ae1eba4f7b80abb3c8),pk(0230efbeba3e9b9321c1cbcf93f416c25fbcb96c322b3ecc73e0dfd6db558ca682),pk(03996553edf7dc7702e4f4ed8e2feadb5dbbd1f3c55c64c7ee943b32e870d1f2a0))";

        let result: Result<Concrete<String>, _> = policy_str.parse();
        println!("Parse result: {:?}", result);
        assert!(result.is_ok(), "Should parse 2-of-15 multisig");
    }

    #[test]
    fn test_specific_key_validity() {
        use bitcoin::secp256k1::PublicKey;

        let key_hex = "02318f455a1ef51763e1acb573449e4a52e8fcada49f8a0fea8387a4f4b146b3ac";
        let bytes = hex::decode(key_hex).unwrap();
        match PublicKey::from_slice(&bytes) {
            Ok(pk) => println!("Valid key: {}", pk),
            Err(e) => println!("Invalid key: {}", e),
        }
    }

    /// Test that extracts and validates all keys from the actual compiler-core.js key pools.
    /// This reads the JS file directly to ensure we're testing the real keys, not a copy.
    #[test]
    fn test_all_key_pool_validity() {
        use bitcoin::secp256k1::PublicKey;
        use bitcoin::key::XOnlyPublicKey;
        use std::fs;
        use regex::Regex;

        // Read the actual compiler-core.js file
        let js_content = fs::read_to_string("miniscript/modules/compiler-core.js")
            .expect("Failed to read compiler-core.js");

        // Extract all 66-char hex keys (compressed public keys starting with 02 or 03)
        let compressed_regex = Regex::new(r"'(0[23][a-fA-F0-9]{64})'").unwrap();
        let compressed_keys: Vec<String> = compressed_regex
            .captures_iter(&js_content)
            .map(|cap| cap[1].to_string())
            .collect();

        // Extract all 64-char hex keys (x-only public keys)
        let xonly_regex = Regex::new(r"'([a-fA-F0-9]{64})'").unwrap();
        let all_64char_keys: Vec<String> = xonly_regex
            .captures_iter(&js_content)
            .map(|cap| cap[1].to_string())
            .filter(|k| !k.starts_with("02") && !k.starts_with("03")) // Exclude compressed keys
            .collect();

        println!("\n=== VALIDATING COMPRESSED KEYS FROM compiler-core.js ===");
        println!("Found {} compressed keys (66 hex chars, 02/03 prefix)\n", compressed_keys.len());

        let mut invalid_compressed: Vec<(String, String)> = Vec::new();
        let mut valid_compressed_count = 0;

        for key_hex in &compressed_keys {
            match hex::decode(key_hex) {
                Ok(bytes) => {
                    match PublicKey::from_slice(&bytes) {
                        Ok(_) => {
                            valid_compressed_count += 1;
                        }
                        Err(e) => {
                            println!("❌ {}: {}", key_hex, e);
                            invalid_compressed.push((key_hex.clone(), format!("{}", e)));
                        }
                    }
                }
                Err(e) => {
                    println!("❌ {}: Hex decode error: {}", key_hex, e);
                    invalid_compressed.push((key_hex.clone(), format!("Hex decode error: {}", e)));
                }
            }
        }

        println!("\n=== VALIDATING X-ONLY KEYS FROM compiler-core.js ===");
        println!("Found {} x-only keys (64 hex chars)\n", all_64char_keys.len());

        let mut invalid_xonly: Vec<(String, String)> = Vec::new();
        let mut valid_xonly_count = 0;

        for key_hex in &all_64char_keys {
            match hex::decode(key_hex) {
                Ok(bytes) => {
                    let bytes_arr: [u8; 32] = match bytes.try_into() {
                        Ok(arr) => arr,
                        Err(_) => {
                            println!("❌ {}: Failed to convert to 32-byte array", key_hex);
                            invalid_xonly.push((key_hex.clone(), "Failed to convert to 32-byte array".to_string()));
                            continue;
                        }
                    };
                    match XOnlyPublicKey::from_slice(&bytes_arr) {
                        Ok(_) => {
                            valid_xonly_count += 1;
                        }
                        Err(e) => {
                            println!("❌ {}: {}", key_hex, e);
                            invalid_xonly.push((key_hex.clone(), format!("{}", e)));
                        }
                    }
                }
                Err(e) => {
                    println!("❌ {}: Hex decode error: {}", key_hex, e);
                    invalid_xonly.push((key_hex.clone(), format!("Hex decode error: {}", e)));
                }
            }
        }

        println!("\n=== SUMMARY ===");
        println!("Compressed keys: {} valid, {} invalid", valid_compressed_count, invalid_compressed.len());
        println!("X-only keys: {} valid, {} invalid", valid_xonly_count, invalid_xonly.len());

        if !invalid_compressed.is_empty() {
            println!("\n❌ INVALID COMPRESSED KEYS:");
            for (key, error) in &invalid_compressed {
                println!("  - {} -> {}", key, error);
            }
        }

        if !invalid_xonly.is_empty() {
            println!("\n❌ INVALID X-ONLY KEYS:");
            for (key, error) in &invalid_xonly {
                println!("  - {} -> {}", key, error);
            }
        }

        // Fail the test if any invalid keys are found
        assert!(invalid_compressed.is_empty(), "Found {} invalid compressed keys!", invalid_compressed.len());
        assert!(invalid_xonly.is_empty(), "Found {} invalid x-only keys!", invalid_xonly.len());
    }
}
