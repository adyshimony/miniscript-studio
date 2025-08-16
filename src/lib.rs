use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use miniscript::{Miniscript, Tap, Segwitv0, Legacy, policy::Concrete};
use bitcoin::{Address, Network, PublicKey, XOnlyPublicKey, secp256k1::Secp256k1};

#[derive(Serialize, Deserialize)]
pub struct CompilationResult {
    pub success: bool,
    pub error: Option<String>,
    pub script: Option<String>,
    pub script_asm: Option<String>,
    pub address: Option<String>,
    pub script_size: Option<usize>,
    pub miniscript_type: Option<String>,
    pub compiled_miniscript: Option<String>,
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[wasm_bindgen]
pub fn compile_policy(policy: &str, context: &str) -> JsValue {
    console_log!("Compiling policy: {} with context: {}", policy, context);
    
    let result = match compile_policy_to_miniscript(policy, context) {
        Ok((script, script_asm, address, script_size, ms_type, miniscript)) => CompilationResult {
            success: true,
            error: None,
            script: Some(script),
            script_asm: Some(script_asm),
            address,
            script_size: Some(script_size),
            miniscript_type: Some(ms_type),
            compiled_miniscript: Some(miniscript),
        },
        Err(e) => CompilationResult {
            success: false,
            error: Some(e),
            script: None,
            script_asm: None,
            address: None,
            script_size: None,
            miniscript_type: None,
            compiled_miniscript: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

#[wasm_bindgen]
pub fn compile_miniscript(expression: &str, context: &str) -> JsValue {
    console_log!("Compiling miniscript: {} with context: {}", expression, context);
    
    let result = match compile_expression(expression, context) {
        Ok((script, script_asm, address, script_size, ms_type)) => CompilationResult {
            success: true,
            error: None,
            script: Some(script),
            script_asm: Some(script_asm),
            address,
            script_size: Some(script_size),
            miniscript_type: Some(ms_type),
            compiled_miniscript: None,
        },
        Err(e) => CompilationResult {
            success: false,
            error: Some(e),
            script: None,
            script_asm: None,
            address: None,
            script_size: None,
            miniscript_type: None,
            compiled_miniscript: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

fn compile_expression(expression: &str, context: &str) -> Result<(String, String, Option<String>, usize, String), String> {
    if expression.trim().is_empty() {
        return Err("Empty expression - please enter a miniscript".to_string());
    }

    let trimmed = expression.trim();
    
    match context {
        "legacy" => {
            match trimmed.parse::<Miniscript<PublicKey, Legacy>>() {
                Ok(ms) => {
                    let script = ms.encode();
                    let script_hex = hex::encode(script.as_bytes());
                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                    let script_size = script.len();
                    
                    let address = match Address::p2sh(&script, Network::Bitcoin) {
                        Ok(addr) => Some(addr.to_string()),
                        Err(_) => None,
                    };
                    
                    Ok((script_hex, script_asm, address, script_size, "Legacy".to_string()))
                }
                Err(e) => {
                    let error_msg = format!("{}", e);
                    if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                        Err(format!("Legacy parsing failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Legacy requires compressed public keys (66 characters).", e))
                    } else {
                        Err(format!("Legacy parsing failed: {}", e))
                    }
                }
            }
        },
        "segwit" => {
            match trimmed.parse::<Miniscript<PublicKey, Segwitv0>>() {
                Ok(ms) => {
                    let script = ms.encode();
                    let script_hex = hex::encode(script.as_bytes());
                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                    let script_size = script.len();
                    
                    let address = Some(Address::p2wsh(&script, Network::Bitcoin).to_string());
                    
                    Ok((script_hex, script_asm, address, script_size, "Segwit v0".to_string()))
                }
                Err(e) => {
                    let error_msg = format!("{}", e);
                    if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                        Err(format!("Segwit v0 parsing failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Segwit v0 requires compressed public keys (66 characters).", e))
                    } else {
                        Err(format!("Segwit v0 parsing failed: {}", e))
                    }
                }
            }
        },
        "taproot" => {
            match trimmed.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
                Ok(ms) => {
                    let script = ms.encode();
                    let script_hex = hex::encode(script.as_bytes());
                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                    let script_size = script.len();
                    
                    // Generate Taproot address
                    let address = generate_taproot_address(&script);
                    
                    Ok((script_hex, script_asm, address, script_size, "Taproot".to_string()))
                }
                Err(e) => {
                    let error_msg = format!("{}", e);
                    if error_msg.contains("malformed public key") {
                        Err(format!("Taproot parsing failed: {}. Note: Taproot requires X-only public keys (64 characters, no 02/03 prefix). Check that you're using the correct key format for Taproot context.", e))
                    } else {
                        Err(format!("Taproot parsing failed: {}", e))
                    }
                }
            }
        },
        _ => Err(format!("Invalid context: {}. Use 'legacy', 'segwit', or 'taproot'", context))
    }
}

fn compile_policy_to_miniscript(policy: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, String), String> {
    if policy.trim().is_empty() {
        return Err("Empty policy - please enter a policy expression".to_string());
    }

    let trimmed = policy.trim();
    
    match context {
        "legacy" => {
            match trimmed.parse::<Concrete<PublicKey>>() {
                Ok(concrete_policy) => {
                    match concrete_policy.compile::<Legacy>() {
                        Ok(ms) => {
                            let script = ms.encode();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            let miniscript_str = ms.to_string();
                            
                            let address = match Address::p2sh(&script, Network::Bitcoin) {
                                Ok(addr) => Some(addr.to_string()),
                                Err(_) => None,
                            };
                            
                            Ok((script_hex, script_asm, address, script_size, "Legacy".to_string(), miniscript_str))
                        }
                        Err(e) => {
                            let error_msg = format!("{}", e);
                            if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                                Err(format!("Legacy compilation failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Legacy requires compressed public keys (66 characters).", e))
                            } else {
                                Err(format!("Legacy compilation failed: {}", e))
                            }
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("{}", e);
                    if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                        Err(format!("Policy parsing failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Legacy requires compressed public keys (66 characters).", e))
                    } else {
                        Err(format!("Policy parsing failed: {}", e))
                    }
                }
            }
        },
        "segwit" => {
            match trimmed.parse::<Concrete<PublicKey>>() {
                Ok(concrete_policy) => {
                    match concrete_policy.compile::<Segwitv0>() {
                        Ok(ms) => {
                            let script = ms.encode();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            let miniscript_str = ms.to_string();
                            
                            let address = Some(Address::p2wsh(&script, Network::Bitcoin).to_string());
                            
                            Ok((script_hex, script_asm, address, script_size, "Segwit v0".to_string(), miniscript_str))
                        }
                        Err(e) => {
                            let error_msg = format!("{}", e);
                            if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                                Err(format!("Segwit v0 compilation failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Segwit v0 requires compressed public keys (66 characters).", e))
                            } else {
                                Err(format!("Segwit v0 compilation failed: {}", e))
                            }
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("{}", e);
                    if error_msg.contains("pubkey string should be 66 or 130") && error_msg.contains("got: 64") {
                        Err(format!("Segwit v0 policy parsing failed: {}. Note: You may be using an X-only key (64 characters) which is for Taproot context. Segwit v0 requires compressed public keys (66 characters).", e))
                    } else {
                        Err(format!("Policy parsing failed: {}", e))
                    }
                }
            }
        },
        "taproot" => {
            match trimmed.parse::<Concrete<XOnlyPublicKey>>() {
                Ok(concrete_policy) => {
                    match concrete_policy.compile::<Tap>() {
                        Ok(ms) => {
                            let script = ms.encode();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            let miniscript_str = ms.to_string();
                            
                            // Generate Taproot address
                            let address = generate_taproot_address(&script);
                            
                            Ok((script_hex, script_asm, address, script_size, "Taproot".to_string(), miniscript_str))
                        }
                        Err(e) => {
                            let error_msg = format!("{}", e);
                            if error_msg.contains("malformed public key") {
                                Err(format!("Taproot compilation failed: {}. Note: Taproot requires X-only public keys (64 characters, no 02/03 prefix). Check that you're using the correct key format for Taproot context.", e))
                            } else {
                                Err(format!("Taproot compilation failed: {}", e))
                            }
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("{}", e);
                    if error_msg.contains("malformed public key") {
                        Err(format!("Taproot policy parsing failed: {}. Note: Taproot requires X-only public keys (64 characters, no 02/03 prefix). Check that you're using the correct key format for Taproot context.", e))
                    } else {
                        Err(format!("Policy parsing failed: {}", e))
                    }
                }
            }
        },
        _ => Err(format!("Invalid context: {}. Use 'legacy', 'segwit', or 'taproot'", context))
    }
}

fn generate_taproot_address(_script: &bitcoin::Script) -> Option<String> {
    // Create a simple Taproot address using key-path spending
    // This uses a dummy internal key for demonstration purposes
    
    // Use a standard "nothing up my sleeve" internal key (hash of "TapRoot" repeated)
    let internal_key_bytes = [
        0x50, 0x92, 0x9b, 0x74, 0xc1, 0xa0, 0x49, 0x54, 0xb7, 0x8b, 0x4b, 0x60, 0x35, 0xe9, 0x7a, 0x5e,
        0x07, 0x8a, 0x5a, 0x0f, 0x28, 0xec, 0x96, 0xd5, 0x47, 0xbf, 0xee, 0x9a, 0xce, 0x80, 0x3a, 0xc0
    ];
    
    match XOnlyPublicKey::from_slice(&internal_key_bytes) {
        Ok(internal_key) => {
            // Create a simple key-path-only Taproot address
            // Note: This is simplified - in practice you'd want script-path spending
            let address = Address::p2tr(&Secp256k1::verification_only(), internal_key, None, Network::Bitcoin);
            Some(address.to_string())
        }
        Err(_) => None
    }
}

#[wasm_bindgen(start)]
pub fn main() {
    console_log!("Real Miniscript WASM module loaded");
}