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
}
