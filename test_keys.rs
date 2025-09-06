use bitcoin::{PublicKey, XOnlyPublicKey};
use miniscript::{Miniscript, Segwitv0};
use std::str::FromStr;

fn main() {
    // Test x-only key (32 bytes / 64 hex chars)
    let xonly_key = "c7c4dbc99177c2c6cf17f9f1b08fc5224c7c52e11c3a1b0819e44c986f2c2e6e";
    
    // Try parsing miniscript with x-only key in Segwit context
    let miniscript_str = format!("pk({})", xonly_key);
    println!("Trying to parse: {}", miniscript_str);
    
    match miniscript_str.parse::<Miniscript<PublicKey, Segwitv0>>() {
        Ok(ms) => {
            println!("SUCCESS: Parsed as Segwit miniscript: {}", ms);
            println!("This should NOT happen - x-only keys should be rejected!");
        }
        Err(e) => {
            println!("EXPECTED: Failed to parse: {}", e);
        }
    }
    
    // Try parsing as XOnlyPublicKey miniscript
    match miniscript_str.parse::<Miniscript<XOnlyPublicKey, Segwitv0>>() {
        Ok(ms) => {
            println!("Parsed as XOnly in Segwit: {} (This shouldn't compile)", ms);
        }
        Err(e) => {
            println!("Failed XOnly in Segwit: {}", e);
        }
    }
}
