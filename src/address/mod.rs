use wasm_bindgen::JsValue;
use crate::console_log;
use bitcoin::{Address, Network, ScriptBuf, XOnlyPublicKey, secp256k1::Secp256k1, Script};
use miniscript::{Miniscript, Tap, Descriptor};
use std::str::FromStr;
use std::sync::Arc;
use miniscript::descriptor::TapTree;

pub(crate) fn generate_address_for_network(script_hex: &str, script_type: &str, network: &str) -> JsValue {
    console_log!("Generating address for network: {}", network);
    console_log!("Script type: {}", script_type);
    
    let result = match perform_address_generation(script_hex, script_type, network) {
        Ok(address) => crate::AddressResult {
            success: true,
            error: None,
            address: Some(address),
        },
        Err(e) => crate::AddressResult {
            success: false,
            error: Some(e),
            address: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Generate taproot address for network switching
/// 
/// # Deprecated
/// This function is deprecated and no longer used by the JavaScript interface.
/// The JavaScript now uses `compile_miniscript_with_mode_and_network()` for taproot addresses.
#[deprecated(since = "0.1.0", note = "Use compile_miniscript_with_mode_and_network() instead")]
pub(crate) fn generate_taproot_address_for_network(miniscript: &str, network_str: &str) -> JsValue {
    console_log!("Generating taproot address for network: {} with miniscript: {}", network_str, miniscript);
    
    let result = match perform_taproot_address_generation(miniscript, network_str) {
        Ok(address) => crate::AddressResult {
            success: true,
            error: None,
            address: Some(address),
        },
        Err(e) => crate::AddressResult {
            success: false,
            error: Some(e),
            address: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Generate taproot address using TaprootBuilder approach
/// 
/// # Deprecated
/// This function is deprecated and no longer used by the JavaScript interface.
/// The JavaScript now uses `compile_miniscript_with_mode_and_network()` for taproot addresses.
#[deprecated(since = "0.1.0", note = "Use compile_miniscript_with_mode_and_network() instead")]
pub(crate) fn generate_taproot_address_with_builder(miniscript: &str, network_str: &str, internal_key: Option<String>) -> JsValue {
    console_log!("Generating taproot address with builder: {} for network: {} with internal_key: {:?}", miniscript, network_str, internal_key);
    
    // Use the new descriptor-based approach for cleaner code
    let result = match perform_descriptor_address_generation(miniscript, network_str, internal_key) {
        Ok(address) => crate::AddressResult {
            success: true,
            error: None,
            address: Some(address),
        },
        Err(e) => crate::AddressResult {
            success: false,
            error: Some(e),
            address: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Internal function to generate address
fn perform_address_generation(script_hex: &str, script_type: &str, network_str: &str) -> Result<String, String> {
    // Parse network
    let network = match network_str {
        "mainnet" | "bitcoin" => Network::Bitcoin,
        "testnet" => Network::Testnet,
        "regtest" => Network::Regtest,
        "signet" => Network::Signet,
        _ => return Err(format!("Invalid network: {}", network_str))
    };
    
    // Decode script hex
    let script_bytes = hex::decode(script_hex)
        .map_err(|e| format!("Invalid script hex: {}", e))?;
    let script = ScriptBuf::from_bytes(script_bytes.clone());
    
    // Generate address based on script type
    let address = match script_type {
        "Legacy" => {
            Address::p2sh(&script, network)
                .map_err(|e| format!("Failed to generate P2SH address: {}", e))?
        },
        "Segwit v0" => {
            Address::p2wsh(&script, network)
        },
        "Taproot" => {
            // For Taproot, we need to create a simple tr() descriptor with NUMS point
            // Since we only have the script hex, we'll create a basic P2TR address
            console_log!("Generating Taproot address for network switch");
            
            // Use NUMS point for network switching
            let nums_point = XOnlyPublicKey::from_str(
                crate::NUMS_POINT
            ).map_err(|e| format!("Invalid NUMS point: {}", e))?;
            
            // Create a simple key-path only P2TR address with NUMS point
            // This is a limitation - we can't recreate the exact script-path address
            // without the original miniscript expression
            Address::p2tr(&Secp256k1::verification_only(), nums_point, None, network)
        },
        _ => return Err(format!("Unknown script type: {}", script_type))
    };
    
    Ok(address.to_string())
}

/// Internal function to generate taproot address using miniscript
fn perform_taproot_address_generation(miniscript: &str, network_str: &str) -> Result<String, String> {
    // Parse network
    let network = match network_str {
        "mainnet" | "bitcoin" => Network::Bitcoin,
        "testnet" => Network::Testnet,
        "regtest" => Network::Regtest,
        "signet" => Network::Signet,
        _ => return Err(format!("Invalid network: {}", network_str))
    };
    
    console_log!("Generating taproot address with miniscript: {} for network: {:?}", miniscript, network);
    
    // Build tr() descriptor with extracted internal key - same as compile_taproot_miniscript
    let internal_key = crate::keys::extract_internal_key_from_expression(miniscript);
    let tr_descriptor = format!("tr({},{})", internal_key, miniscript);
    console_log!("Built tr() descriptor for network switch: {}", tr_descriptor);
    
    // Parse as descriptor to get proper taproot address
    match tr_descriptor.parse::<Descriptor<XOnlyPublicKey>>() {
        Ok(descriptor) => {
            console_log!("Successfully parsed tr() descriptor for network switch");
            
            // Generate address from descriptor
            descriptor.address(network)
                .map(|addr| addr.to_string())
                .map_err(|e| format!("Failed to generate address from descriptor: {}", e))
        }
        Err(e) => {
            console_log!("Failed to parse tr() descriptor for network switch: {}", e);
            Err(format!("Failed to create tr() descriptor: {}", e))
        }
    }
}

/// Internal function using Descriptor approach (cleaner than TaprootBuilder)
fn perform_descriptor_address_generation(miniscript: &str, network_str: &str, internal_key: Option<String>) -> Result<String, String> {
    // Parse network
    let network = match network_str {
        "mainnet" | "bitcoin" => Network::Bitcoin,
        "testnet" => Network::Testnet,
        "regtest" => Network::Regtest,
        "signet" => Network::Signet,
        _ => return Err(format!("Invalid network: {}", network_str))
    };
    
    console_log!("Building taproot address with Descriptor for network: {:?}", network);
    
    // Parse as XOnlyPublicKey miniscript for Taproot
    match miniscript.parse::<Miniscript<XOnlyPublicKey, Tap>>() {
        Ok(ms) => {
            // Require internal key to be provided
            let internal_key_str = match internal_key {
                Some(key) => key,
                None => return Err("Internal key is required for taproot address generation".to_string())
            };
            
            console_log!("Using internal key for address generation: {}", internal_key_str);
            
            let internal_xonly_key = match XOnlyPublicKey::from_str(&internal_key_str) {
                Ok(key) => key,
                Err(_) => return Err(format!("Failed to parse internal key: {}", internal_key_str))
            };
            
            // Create the tree with the miniscript
            let tree = TapTree::Leaf(Arc::new(ms));
            
            // Create descriptor and get address directly
            match Descriptor::<XOnlyPublicKey>::new_tr(internal_xonly_key, Some(tree)) {
                Ok(descriptor) => {
                    match descriptor.address(network) {
                        Ok(addr) => {
                            console_log!("Generated taproot address with Descriptor: {}", addr);
                            Ok(addr.to_string())
                        },
                        Err(e) => Err(format!("Address generation failed: {:?}", e))
                    }
                },
                Err(e) => Err(format!("Descriptor creation failed: {:?}", e))
            }
        },
        Err(e) => Err(format!("Miniscript parsing failed: {}", e))
    }
}


// ============================================================================
// Taproot Address Generation Functions
// ============================================================================

/// Generate a Taproot address with a specific internal key and script
pub fn generate_taproot_address_with_key(script: &Script, internal_key: XOnlyPublicKey, network: Network) -> Option<String> {
    use bitcoin::taproot::TaprootBuilder;
    
    // For simple pk(key), just use key-path only
    let script_bytes = script.as_bytes();
    if script_bytes.len() == 34 && script_bytes[0] == 0x20 && script_bytes[33] == 0xac {
        // This is a simple pk() script (32-byte key push + OP_CHECKSIG)
        return Some(Address::p2tr(&Secp256k1::verification_only(), internal_key, None, network).to_string());
    }
    
    // For complex scripts, create a taproot tree with the script
    match TaprootBuilder::new()
        .add_leaf(0, script.to_owned())
        .map(|builder| builder.finalize(&Secp256k1::verification_only(), internal_key))
    {
        Ok(Ok(spend_info)) => {
            // Create the P2TR address with both key-path and script-path
            let output_key = spend_info.output_key();
            let address = Address::p2tr(&Secp256k1::verification_only(), output_key.to_x_only_public_key(), None, network);
            Some(address.to_string())
        },
        _ => {
            console_log!("Failed to create Taproot spend info");
            None
        }
    }
}

/// Generate a Taproot address from a script (fallback for complex scripts)
pub fn generate_taproot_address(_script: &Script, _network: Network) -> Option<String> {
    // This is now only used as a fallback if no x-only key is found
    console_log!("No x-only key found for Taproot address generation");
    None
}

/// Generate a Taproot address using the descriptor approach (correct method)
/// Uses tr(internal_key, taptree) descriptor to generate deterministic address
pub fn generate_taproot_address_descriptor(
    miniscript: &Miniscript<XOnlyPublicKey, Tap>,
    internal_key: XOnlyPublicKey,
    network: Network
) -> Option<String> {
    console_log!("Generating Taproot address using descriptor approach");
    console_log!("Internal key: {}", internal_key);
    console_log!("Miniscript: {}", miniscript);
    
    // Create a TapTree with the miniscript as a leaf
    let taptree = TapTree::Leaf(Arc::new(miniscript.clone()));
    
    // Build the tr() descriptor
    match Descriptor::new_tr(internal_key, Some(taptree)) {
        Ok(descriptor) => {
            // Generate the address from the descriptor
            match descriptor.address(network) {
                Ok(address) => {
                    console_log!("Successfully generated Taproot address: {}", address);
                    Some(address.to_string())
                },
                Err(_e) => {
                    console_log!("Failed to generate address from descriptor: {}", _e);
                    None
                }
            }
        },
        Err(_e) => {
            console_log!("Failed to create tr() descriptor: {}", _e);
            None
        }
    }
}

/// OLD VERSION - Generate a Taproot address with a specific internal key and script
/// Keeping this for rollback if needed
pub fn generate_taproot_address_with_key_old(script: &Script, internal_key: XOnlyPublicKey, network: Network) -> Option<String> {
    use bitcoin::taproot::TaprootBuilder;
    
    // For simple pk(key), just use key-path only
    let script_bytes = script.as_bytes();
    if script_bytes.len() == 34 && script_bytes[0] == 0x20 && script_bytes[33] == 0xac {
        // This is a simple pk() script (32-byte key push + OP_CHECKSIG)
        return Some(Address::p2tr(&Secp256k1::verification_only(), internal_key, None, network).to_string());
    }
    
    // For complex scripts, create a taproot tree with the script
    match TaprootBuilder::new()
        .add_leaf(0, script.to_owned())
        .map(|builder| builder.finalize(&Secp256k1::verification_only(), internal_key))
    {
        Ok(Ok(spend_info)) => {
            // Create the P2TR address with both key-path and script-path
            let output_key = spend_info.output_key();
            let address = Address::p2tr(&Secp256k1::verification_only(), output_key.to_x_only_public_key(), None, network);
            Some(address.to_string())
        },
        _ => {
            console_log!("Failed to create Taproot spend info");
            None
        }
    }
}