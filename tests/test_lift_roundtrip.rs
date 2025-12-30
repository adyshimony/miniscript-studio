use miniscript::bitcoin::ScriptBuf;
use miniscript::{Miniscript, Segwitv0};

// Import our crate's parse_asm_to_script
#[path = "../src/opcodes.rs"]
mod opcodes;

#[test]
fn test_compile_and_check_asm() {
    let expression = "or_d(pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9),and_v(and_v(v:hash160(6c60f404f8167a38fc70eaf8aa17ac351023bef8),v:pk(03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd)),older(144)))";

    // Parse miniscript
    let ms: Miniscript<miniscript::bitcoin::PublicKey, Segwitv0> = expression.parse().unwrap();

    // Encode to script
    let script = ms.encode();

    // Get hex
    let hex = hex::encode(script.as_bytes());
    println!("\n=== COMPILATION ===");
    println!("HEX: {}", hex);

    // Get ASM using different methods
    println!("\n=== ASM FORMATS ===");

    // to_asm_string() - Bitcoin crate's method
    println!("to_asm_string():\n{}", script.to_asm_string());

    // Debug format
    println!("\nDebug {:?}:\n{:?}", "", script);

    // Display format
    println!("\nDisplay {}:\n{}", "", script);

    // Now try to parse back from hex
    println!("\n=== LIFT FROM HEX ===");
    let bytes = hex::decode(&hex).unwrap();
    let script_from_hex = ScriptBuf::from_bytes(bytes);

    // Try to parse as miniscript
    match Miniscript::<miniscript::bitcoin::PublicKey, Segwitv0>::parse(&script_from_hex) {
        Ok(ms_lifted) => {
            println!("Lifted miniscript: {}", ms_lifted);
            assert_eq!(ms.to_string(), ms_lifted.to_string(), "Roundtrip should match");
        }
        Err(e) => {
            println!("Failed to lift: {}", e);
            panic!("Should be able to lift from hex");
        }
    }

    // Check specific bytes around OP_SIZE
    println!("\n=== BYTE ANALYSIS ===");
    let bytes = script.as_bytes();
    for (i, byte) in bytes.iter().enumerate() {
        if *byte == 0x82 { // OP_SIZE
            println!("Found OP_SIZE at position {}", i);
            if i + 1 < bytes.len() {
                println!("  Next byte: 0x{:02x} (decimal {})", bytes[i+1], bytes[i+1]);
            }
            if i + 2 < bytes.len() {
                println!("  Byte after: 0x{:02x} (decimal {})", bytes[i+2], bytes[i+2]);
            }
        }
    }

    // NOW THE FULL ROUNDTRIP: ASM -> parse_asm_to_script -> lift to miniscript
    println!("\n=== FULL ROUNDTRIP TEST ===");
    let asm = script.to_asm_string();
    println!("ASM from compilation: {}", asm);

    // Parse ASM back to script using our parser
    match opcodes::parse_asm_to_script(&asm) {
        Ok(parsed_script) => {
            println!("Parsed script hex: {}", hex::encode(parsed_script.as_bytes()));
            println!("Original script hex: {}", hex);

            // Check if they match
            if parsed_script.as_bytes() == script.as_bytes() {
                println!("Scripts match!");
            } else {
                println!("Scripts DON'T match!");
                println!("Original len: {}, Parsed len: {}", script.len(), parsed_script.len());
            }

            // Try to lift the parsed script back to miniscript
            match Miniscript::<miniscript::bitcoin::PublicKey, Segwitv0>::parse(&parsed_script) {
                Ok(ms_lifted) => {
                    println!("Lifted miniscript: {}", ms_lifted);
                }
                Err(e) => {
                    println!("Failed to lift parsed script: {}", e);
                }
            }
        }
        Err(e) => {
            println!("Failed to parse ASM: {}", e);
        }
    }
}

#[test]
fn test_what_is_20_in_asm() {
    // Create a simple script with OP_SIZE followed by a push
    // OP_SIZE = 0x82
    // OP_PUSHBYTES_1 = 0x01
    // 0x20 = 32 decimal

    let script_bytes = vec![0x82, 0x01, 0x20]; // OP_SIZE OP_PUSHBYTES_1 0x20
    let script = ScriptBuf::from_bytes(script_bytes);

    println!("\n=== WHAT IS 20? ===");
    println!("Script bytes: 82 01 20");
    println!("to_asm_string(): {}", script.to_asm_string());
    println!("Display: {}", script);

    // The question: does to_asm_string show "20" or "32"?
}

#[test]
fn test_lift_with_and_without_pushbytes() {
    // Use actual public keys
    let alice = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    let bob = "03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd";
    let charlie = "03dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659";

    // Version WITHOUT OP_PUSHBYTES (simplified ASM)
    let asm_without_pushbytes = format!(
        "{} OP_CHECKSIGVERIFY {} OP_CHECKSIG OP_SWAP {} OP_CHECKSIG OP_BOOLOR",
        alice, bob, charlie
    );

    // Version WITH OP_PUSHBYTES
    let asm_with_pushbytes = format!(
        "OP_PUSHBYTES_33 {} OP_CHECKSIGVERIFY OP_PUSHBYTES_33 {} OP_CHECKSIG OP_SWAP OP_PUSHBYTES_33 {} OP_CHECKSIG OP_BOOLOR",
        alice, bob, charlie
    );

    println!("\n=== TEST WITHOUT OP_PUSHBYTES ===");
    println!("ASM: {}", asm_without_pushbytes);
    match opcodes::parse_asm_to_script(&asm_without_pushbytes) {
        Ok(script) => {
            println!("Parsed to script, hex: {}", hex::encode(script.as_bytes()));
            match Miniscript::<miniscript::bitcoin::PublicKey, Segwitv0>::parse(&script) {
                Ok(ms) => println!("Lifted to miniscript: {}", ms),
                Err(e) => println!("Failed to lift: {}", e),
            }
        }
        Err(e) => println!("Failed to parse ASM: {}", e),
    }

    println!("\n=== TEST WITH OP_PUSHBYTES ===");
    println!("ASM: {}", asm_with_pushbytes);
    match opcodes::parse_asm_to_script(&asm_with_pushbytes) {
        Ok(script) => {
            println!("Parsed to script, hex: {}", hex::encode(script.as_bytes()));
            match Miniscript::<miniscript::bitcoin::PublicKey, Segwitv0>::parse(&script) {
                Ok(ms) => println!("Lifted to miniscript: {}", ms),
                Err(e) => println!("Failed to lift: {}", e),
            }
        }
        Err(e) => println!("Failed to parse ASM: {}", e),
    }
}

/// Test using ONLY rust-miniscript - no custom code
/// Compile miniscript -> get ASM -> parse ASM back -> lift to miniscript
#[test]
fn test_roundtrip_pure_rust_miniscript() {
    use miniscript::bitcoin::script::Builder;
    use miniscript::bitcoin::blockdata::opcodes::all;
    use miniscript::bitcoin::blockdata::script::PushBytesBuf;

    let expression = "or_d(pk(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9),and_v(and_v(v:hash160(6c60f404f8167a38fc70eaf8aa17ac351023bef8),v:pk(03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd)),older(144)))";

    println!("\n=== PURE RUST-MINISCRIPT ROUNDTRIP TEST ===");
    println!("Original miniscript: {}", expression);

    // Step 1: Parse miniscript
    let ms: Miniscript<miniscript::bitcoin::PublicKey, Segwitv0> = expression.parse().unwrap();
    println!("Parsed miniscript");

    // Step 2: Encode to script
    let script = ms.encode();
    let hex = hex::encode(script.as_bytes());
    println!("Script HEX: {}", hex);

    // Step 3: Get ASM
    let asm = script.to_asm_string();
    println!("Script ASM: {}", asm);

    // Step 4: Parse ASM back to script using Bitcoin crate's from_asm_str (if available)
    // or parse from hex
    println!("\n--- Testing lift from HEX ---");
    let bytes = hex::decode(&hex).unwrap();
    let script_from_hex = ScriptBuf::from_bytes(bytes);

    match Miniscript::<miniscript::bitcoin::PublicKey, Segwitv0>::parse(&script_from_hex) {
        Ok(ms_lifted) => {
            println!("Lifted from HEX: {}", ms_lifted);
            assert_eq!(ms.to_string(), ms_lifted.to_string());
        }
        Err(e) => {
            println!("❌ Failed to lift from HEX: {}", e);
            panic!("Should lift from hex");
        }
    }

    // Step 5: Try to use Script::from_str or similar if available
    println!("\n--- Testing ScriptBuf::from_asm_str (if available) ---");

    // Bitcoin crate doesn't have from_asm_str, so let's check what methods exist
    // Instead, let's verify the ASM format is correct by checking specific parts

    // Check that OP_PUSHBYTES_1 20 appears in ASM
    if asm.contains("OP_PUSHBYTES_1 20") {
        println!("ASM contains 'OP_PUSHBYTES_1 20' (hex 0x20 = decimal 32)");
    } else {
        println!("ASM does not contain 'OP_PUSHBYTES_1 20'");
    }

    // The key insight: the ASM shows "20" which is HEX (0x20 = 32 decimal)
    // If we strip OP_PUSHBYTES_1 and just have "20", it's ambiguous
    println!("\n--- Key insight ---");
    println!("The '20' after OP_PUSHBYTES_1 is HEX 0x20 = decimal 32");
    println!("This is used by OP_SIZE to check signature size (32 bytes for Schnorr, 33 for ECDSA)");
}
