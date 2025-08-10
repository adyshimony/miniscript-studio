use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use miniscript::{Miniscript, Tap, Segwitv0, Legacy, policy::Concrete};
use bitcoin::{Address, Network, PublicKey};

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
                Err(e) => Err(format!("Legacy parsing failed: {}", e))
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
                Err(e) => Err(format!("Segwit v0 parsing failed: {}", e))
            }
        },
        "taproot" => {
            match trimmed.parse::<Miniscript<PublicKey, Tap>>() {
                Ok(ms) => {
                    let script = ms.encode();
                    let script_hex = hex::encode(script.as_bytes());
                    let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                    let script_size = script.len();
                    
                    // Taproot addresses require more complex logic
                    Ok((script_hex, script_asm, None, script_size, "Taproot".to_string()))
                }
                Err(e) => Err(format!("Taproot parsing failed: {}", e))
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
                        Err(e) => Err(format!("Legacy compilation failed: {}", e))
                    }
                }
                Err(e) => Err(format!("Policy parsing failed: {}", e))
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
                        Err(e) => Err(format!("Segwit v0 compilation failed: {}", e))
                    }
                }
                Err(e) => Err(format!("Policy parsing failed: {}", e))
            }
        },
        "taproot" => {
            match trimmed.parse::<Concrete<PublicKey>>() {
                Ok(concrete_policy) => {
                    match concrete_policy.compile::<Tap>() {
                        Ok(ms) => {
                            let script = ms.encode();
                            let script_hex = hex::encode(script.as_bytes());
                            let script_asm = format!("{:?}", script).replace("Script(", "").trim_end_matches(')').to_string();
                            let script_size = script.len();
                            let miniscript_str = ms.to_string();
                            
                            Ok((script_hex, script_asm, None, script_size, "Taproot".to_string(), miniscript_str))
                        }
                        Err(e) => Err(format!("Taproot compilation failed: {}", e))
                    }
                }
                Err(e) => Err(format!("Policy parsing failed: {}", e))
            }
        },
        _ => Err(format!("Invalid context: {}. Use 'legacy', 'segwit', or 'taproot'", context))
    }
}

#[wasm_bindgen(start)]
pub fn main() {
    console_log!("Real Miniscript WASM module loaded");
}