use wasm_bindgen::JsValue;
use crate::console_log;
use miniscript::{Miniscript, Legacy, Segwitv0, Tap, policy::Liftable};
use bitcoin::{ScriptBuf, Script};

pub(crate) fn lift_to_miniscript(bitcoin_script: &str) -> JsValue {
    console_log!("Lifting Bitcoin script to miniscript: {}", bitcoin_script);
    
    let result = match perform_lift_to_miniscript(bitcoin_script) {
        Ok(miniscript) => crate::LiftResult {
            success: true,
            error: None,
            miniscript: Some(miniscript),
            policy: None,
        },
        Err(e) => crate::LiftResult {
            success: false,
            error: Some(e),
            miniscript: None,
            policy: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

pub(crate) fn lift_to_policy(miniscript: &str) -> JsValue {
    console_log!("Lifting miniscript to policy: {}", miniscript);
    
    let result = match perform_lift_to_policy(miniscript) {
        Ok(policy) => crate::LiftResult {
            success: true,
            error: None,
            miniscript: None,
            policy: Some(policy),
        },
        Err(e) => crate::LiftResult {
            success: false,
            error: Some(e),
            miniscript: None,
            policy: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Internal function to perform lift to miniscript
fn perform_lift_to_miniscript(bitcoin_script: &str) -> Result<String, String> {
    if bitcoin_script.trim().is_empty() {
        return Err("Empty Bitcoin script".to_string());
    }
    
    let trimmed = bitcoin_script.trim();
    console_log!("Processing Bitcoin script ASM: {}", trimmed);
    
    // Parse script from hex or ASM
    let script = if trimmed.len() % 2 == 0 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        match hex::decode(trimmed) {
            Ok(bytes) => ScriptBuf::from_bytes(bytes),
            Err(_) => return Err("Invalid hex script".to_string()),
        }
    } else {
        parse_asm_to_script(trimmed)?
    };
    
    console_log!("Successfully parsed Bitcoin script, length: {} bytes", script.len());
    
    // Try to lift for different contexts
    let mut context_errors = Vec::new();
    
    // Try Legacy
    match try_lift_script_to_miniscript::<Legacy>(script.as_script()) {
        Ok(ms) => return Ok(ms),
        Err(e) => {
            context_errors.push(("Legacy", e));
            console_log!("Legacy lift failed");
        }
    }
    
    // Try Segwit
    match try_lift_script_to_miniscript::<Segwitv0>(script.as_script()) {
        Ok(ms) => return Ok(ms),
        Err(e) => {
            context_errors.push(("Segwit", e));
            console_log!("Segwit lift failed");
        }
    }
    
    // Try Taproot
    match try_lift_script_to_miniscript::<Tap>(script.as_script()) {
        Ok(ms) => return Ok(ms),
        Err(e) => {
            context_errors.push(("Taproot", e));
            console_log!("Taproot lift failed");
        }
    }
    
    // Format error message
    format_lift_error(context_errors)
}

/// Try to lift script to miniscript for a specific context
fn try_lift_script_to_miniscript<Ctx>(script: &Script) -> Result<String, String> 
where 
    Ctx: miniscript::ScriptContext,
    for<'a> Ctx::Key: std::fmt::Display + std::str::FromStr,
    <Ctx::Key as std::str::FromStr>::Err: std::fmt::Display,
{
    console_log!("Attempting to lift script to miniscript...");
    
    // Try parse_insane first (accepts non-standard but valid miniscripts)
    match Miniscript::<Ctx::Key, Ctx>::parse_insane(script) {
        Ok(ms) => {
            let ms_string = ms.to_string();
            console_log!("Successfully lifted to miniscript using parse_insane: {}", ms_string);
            Ok(ms_string)
        }
        Err(insane_err) => {
            console_log!("parse_insane failed: {}", insane_err);
            // Fallback to regular parse
            match Miniscript::<Ctx::Key, Ctx>::parse(script) {
                Ok(ms) => {
                    let ms_string = ms.to_string();
                    console_log!("Successfully lifted to miniscript using parse: {}", ms_string);
                    Ok(ms_string)
                }
                Err(parse_err) => {
                    console_log!("Both parse_insane and parse failed");
                    Err(format!("parse_insane: {}, parse: {}", insane_err, parse_err))
                }
            }
        }
    }
}

/// Format lift error message
fn format_lift_error(context_errors: Vec<(&str, String)>) -> Result<String, String> {
    let mut error_msg = String::from("❌ Script is not liftable to Miniscript\n\n");
    error_msg.push_str("This Bitcoin script cannot be lifted to miniscript. Attempted lifting with both standard and non-standard parsers across all contexts:\n\n");
    
    for (context_name, error) in context_errors {
        error_msg.push_str(&format!("📍 {} Context:\n", context_name));
        
        // Extract detailed errors if available
        if let Some(pos) = error.find("parse_insane: ") {
            let after = &error[pos + 14..];
            if let Some(comma_pos) = after.find(", parse: ") {
                let insane_err = &after[..comma_pos];
                let parse_err = &after[comma_pos + 9..];
                error_msg.push_str(&format!("   • parse_insane: ❌ {}\n", insane_err));
                error_msg.push_str(&format!("   • parse: ❌ {}\n\n", parse_err));
            } else {
                error_msg.push_str(&format!("   • Error: ❌ {}\n\n", error));
            }
        } else {
            error_msg.push_str(&format!("   • Error: ❌ {}\n\n", error));
        }
    }
    
    error_msg.push_str("Note: Scripts containing raw public key hashes (P2PKH) or certain non-miniscript constructs cannot be lifted.");
    
    Err(error_msg)
}

/// Internal function to perform lift to policy
fn perform_lift_to_policy(miniscript: &str) -> Result<String, String> {
    if miniscript.trim().is_empty() {
        return Err("Empty miniscript".to_string());
    }
    
    let trimmed = miniscript.trim();
    console_log!("Attempting to lift miniscript to policy: {}", trimmed);
    
    // Try different contexts
    let mut errors = Vec::new();
    
    // Try Legacy
    match lift_miniscript_to_policy::<Legacy>(trimmed) {
        Ok(policy) => return Ok(policy),
        Err(e) => errors.push(("Legacy", e))
    }
    
    // Try Segwit
    match lift_miniscript_to_policy::<Segwitv0>(trimmed) {
        Ok(policy) => return Ok(policy),
        Err(e) => errors.push(("Segwit", e))
    }
    
    // Try Taproot
    match lift_miniscript_to_policy::<Tap>(trimmed) {
        Ok(policy) => return Ok(policy),
        Err(e) => errors.push(("Taproot", e))
    }
    
    // Format error message
    let mut error_msg = String::from("Failed to lift miniscript to policy:\n");
    for (context, err) in errors {
        error_msg.push_str(&format!("  {} context: {}\n", context, err));
    }
    
    Err(error_msg)
}

/// Lift miniscript to policy for a specific context
fn lift_miniscript_to_policy<Ctx>(miniscript: &str) -> Result<String, String>
where
    Ctx: miniscript::ScriptContext,
    for<'a> Ctx::Key: std::fmt::Display + std::str::FromStr,
    <Ctx::Key as std::str::FromStr>::Err: std::fmt::Display + std::fmt::Debug,
{
    match miniscript.parse::<Miniscript<Ctx::Key, Ctx>>() {
        Ok(ms) => {
            match ms.lift() {
                Ok(semantic_policy) => {
                    let policy_str = semantic_policy.to_string();
                    console_log!("Successfully lifted to policy: {}", policy_str);
                    Ok(policy_str)
                }
                Err(e) => Err(format!("Policy lifting failed: {}", e))
            }
        }
        Err(e) => Err(format!("Miniscript parsing failed: {}", e))
    }
}

/// Parse ASM to script (helper function)
fn parse_asm_to_script(_asm: &str) -> Result<ScriptBuf, String> {
    // This is a simplified ASM parser - in a real implementation you'd want a more robust one
    // For now, we'll just return an error for non-hex input
    Err("ASM parsing not implemented - please provide hex script".to_string())
}