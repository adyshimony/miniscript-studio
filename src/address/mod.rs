//! Bitcoin address generation

use wasm_bindgen::JsValue;
use crate::console_log;
use bitcoin::{Address, Network, ScriptBuf, XOnlyPublicKey, secp256k1::Secp256k1, Script, PublicKey};
use miniscript::{Miniscript, Tap, Segwitv0, Descriptor};
use std::sync::Arc;
use miniscript::descriptor::TapTree;


/// Parse network string to Network enum
/// Centralized network parsing to eliminate duplication
pub fn parse_network(network_str: &str) -> Result<Network, String> {
    match network_str {
        "mainnet" | "bitcoin" => Ok(Network::Bitcoin),
        "testnet" => Ok(Network::Testnet),
        "regtest" => Ok(Network::Regtest),
        "signet" => Ok(Network::Signet),
        _ => Err(format!("Invalid network: {}", network_str))
    }
}


/// Address generation result for internal use
#[derive(Debug)]
pub struct AddressGenerationResult {
    pub address: String,
    pub script_type: String,
    pub network: Network,
}

/// Address generation error type
#[derive(Debug)]
pub enum AddressError {
    NetworkParse(String),
    ScriptDecode(String),
    AddressCreation(String),
    DescriptorParse(String),
    KeyParse(String),
    InternalKeyMissing,
}

impl std::fmt::Display for AddressError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AddressError::NetworkParse(msg) => write!(f, "Network parsing error: {}", msg),
            AddressError::ScriptDecode(msg) => write!(f, "Script decode error: {}", msg),
            AddressError::AddressCreation(msg) => write!(f, "Address creation error: {}", msg),
            AddressError::DescriptorParse(msg) => write!(f, "Descriptor parse error: {}", msg),
            AddressError::KeyParse(msg) => write!(f, "Key parse error: {}", msg),
            AddressError::InternalKeyMissing => write!(f, "Internal key is required for taproot address generation"),
        }
    }
}

impl std::error::Error for AddressError {}

impl From<String> for AddressError {
    fn from(msg: String) -> Self {
        AddressError::NetworkParse(msg)
    }
}


/// Input parameters for address generation
#[derive(Debug)]
pub struct AddressInput {
    /// Script hex (for Legacy/Segwit) or miniscript expression (for Taproot)
    pub script_or_miniscript: String,
    /// Script type: "Legacy", "Segwit v0", or "Taproot"
    pub script_type: String,
    /// Network: "mainnet", "testnet", "regtest", "signet"
    pub network: String,
    /// Internal key for Taproot (optional, will be extracted if not provided)
    pub internal_key: Option<String>,
    /// Use single leaf approach for Taproot (uses NUMS point instead of extracted key)
    pub use_single_leaf: Option<bool>,
}

/// THE ONLY ADDRESS GENERATION FUNCTION YOU NEED
/// 
/// This single function handles ALL address generation scenarios:
/// - Legacy P2SH addresses from script hex
/// - Segwit v0 P2WSH addresses from script hex  
/// - Taproot addresses from miniscript expressions
/// - Taproot addresses with explicit internal keys
pub fn generate_address(input: AddressInput) -> Result<AddressGenerationResult, AddressError> {
    let network = parse_network(&input.network).map_err(|e| AddressError::NetworkParse(e))?;
    
    match input.script_type.as_str() {
        "Legacy" => {
            // Handle Legacy P2SH addresses from miniscript or script hex
            let address = if input.script_or_miniscript.starts_with("pk(") || input.script_or_miniscript.contains("(") {
                // It's a miniscript expression - parse and compile it
                console_log!("Generating Legacy address from miniscript: {}", input.script_or_miniscript);
                
                let ms = input.script_or_miniscript.parse::<Miniscript<PublicKey, Segwitv0>>()
                    .map_err(|e| AddressError::DescriptorParse(e.to_string()))?;
                
                let script = ms.encode();
                Address::p2sh(&script, network)
                    .map_err(|e| AddressError::AddressCreation(format!("P2SH: {}", e)))?
            } else {
                // It's script hex - decode and use directly
                let script_bytes = hex::decode(&input.script_or_miniscript)
                    .map_err(|e| AddressError::ScriptDecode(e.to_string()))?;
                let script = ScriptBuf::from_bytes(script_bytes);
                Address::p2sh(&script, network)
                    .map_err(|e| AddressError::AddressCreation(format!("P2SH: {}", e)))?
            };
            
            Ok(AddressGenerationResult {
                address: address.to_string(),
                script_type: input.script_type,
                network,
            })
        },
        
        "Segwit v0" => {
            // Handle Segwit v0 P2WSH addresses from miniscript or script hex
            let address = if input.script_or_miniscript.starts_with("pk(") || input.script_or_miniscript.contains("(") {
                // It's a miniscript expression - parse and compile it
                console_log!("Generating Segwit address from miniscript: {}", input.script_or_miniscript);
                
                let ms = input.script_or_miniscript.parse::<Miniscript<PublicKey, Segwitv0>>()
                    .map_err(|e| AddressError::DescriptorParse(e.to_string()))?;
                
                let script = ms.encode();
                Address::p2wsh(&script, network)
            } else {
                // It's script hex - decode and use directly
                let script_bytes = hex::decode(&input.script_or_miniscript)
                    .map_err(|e| AddressError::ScriptDecode(e.to_string()))?;
                let script = ScriptBuf::from_bytes(script_bytes);
                Address::p2wsh(&script, network)
            };
            
            Ok(AddressGenerationResult {
                address: address.to_string(),
                script_type: input.script_type,
                network,
            })
        },
        
        "Taproot" => {
            // Handle Taproot addresses from miniscript
            console_log!("Generating Taproot address with miniscript: {} for network: {:?}", 
                        input.script_or_miniscript, network);
            
            // Determine the taproot mode based on input parameters
            let mode = if let Some(key) = input.internal_key {
                if key == crate::NUMS_POINT {
                    console_log!("Using script-path mode (NUMS key provided)");
                    "script-path"
                } else {
                    console_log!("Using multi-leaf mode (custom internal key provided)");
                    "multi-leaf"
                }
            } else if input.use_single_leaf.unwrap_or(false) {
                console_log!("Using single-leaf mode (use_single_leaf=true)");
                "single-leaf"
            } else {
                console_log!("Using multi-leaf mode (extract internal key from miniscript)");
                "multi-leaf"
            };
            
            // Dispatch to the appropriate taproot compilation function
            let result = match mode {
                "multi-leaf" => {
                    crate::compile::modes::compile_taproot_multi_leaf(&input.script_or_miniscript, network)
                },
                "single-leaf" => {
                    crate::compile::modes::compile_taproot_single_leaf(&input.script_or_miniscript, crate::NUMS_POINT, network)
                },
                "script-path" => {
                    crate::compile::modes::compile_taproot_script_path(&input.script_or_miniscript, crate::NUMS_POINT, network)
                },
                _ => return Err(AddressError::DescriptorParse("Invalid taproot mode".to_string()))
            };
            
            let compilation_result = result.map_err(|e| AddressError::DescriptorParse(e))?;
            
            let address = compilation_result.address
                .ok_or_else(|| AddressError::AddressCreation("No address generated".to_string()))?;
            
            console_log!("Generated Taproot address: {}", address);
            
            Ok(AddressGenerationResult {
                address,
                script_type: "Taproot".to_string(),
                network,
            })
        },
        
        _ => Err(AddressError::AddressCreation(format!("Unknown script type: {}", input.script_type)))
    }
}


/// Generate address for network switching (JavaScript interface)
pub(crate) fn generate_address_for_network(script_hex: &str, script_type: &str, network: &str) -> JsValue {
    console_log!("Generating address for network: {}", network);
    console_log!("Script type: {}", script_type);
    
    let input = AddressInput {
        script_or_miniscript: script_hex.to_string(),
        script_type: script_type.to_string(),
        network: network.to_string(),
        internal_key: None,
        use_single_leaf: None,
    };
    
    let result = match generate_address(input) {
        Ok(address_result) => crate::AddressResult {
            success: true,
            error: None,
            address: Some(address_result.address),
        },
        Err(e) => crate::AddressResult {
            success: false,
            error: Some(e.to_string()),
            address: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Generate taproot address for network switching (JavaScript interface)
/// 
/// # Deprecated
/// This function is deprecated and no longer used by the JavaScript interface.
/// The JavaScript now uses `compile_miniscript_with_mode_and_network()` for taproot addresses.
pub(crate) fn generate_taproot_address_for_network(miniscript: &str, network_str: &str) -> JsValue {
    console_log!("Generating taproot address for network: {} with miniscript: {}", network_str, miniscript);
    
    let input = AddressInput {
        script_or_miniscript: miniscript.to_string(),
        script_type: "Taproot".to_string(),
        network: network_str.to_string(),
        internal_key: None,
        use_single_leaf: None,
    };
    
    let result = match generate_address(input) {
        Ok(address_result) => crate::AddressResult {
            success: true,
            error: None,
            address: Some(address_result.address),
        },
        Err(e) => crate::AddressResult {
            success: false,
            error: Some(e.to_string()),
            address: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}

/// Generate taproot address using descriptor approach (JavaScript interface)
/// 
/// # Deprecated
/// This function is deprecated and no longer used by the JavaScript interface.
/// The JavaScript now uses `compile_miniscript_with_mode_and_network()` for taproot addresses.
pub(crate) fn generate_taproot_address_with_builder(miniscript: &str, network_str: &str, _internal_key: Option<String>) -> JsValue {
    console_log!("Generating taproot address with builder: {} for network: {} with internal_key: {:?}", miniscript, network_str, _internal_key);
    
    let input = AddressInput {
        script_or_miniscript: miniscript.to_string(),
        script_type: "Taproot".to_string(),
        network: network_str.to_string(),
        internal_key: None,
        use_single_leaf: None,
    };
    
    let result = match generate_address(input) {
        Ok(address_result) => crate::AddressResult {
            success: true,
            error: None,
            address: Some(address_result.address),
        },
        Err(e) => crate::AddressResult {
            success: false,
            error: Some(e.to_string()),
            address: None,
        }
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap()
}


// Internal function to generate address (legacy - use generate_address() instead)
fn perform_address_generation(script_hex: &str, script_type: &str, network_str: &str) -> Result<String, String> {
    let input = AddressInput {
        script_or_miniscript: script_hex.to_string(),
        script_type: script_type.to_string(),
        network: network_str.to_string(),
        internal_key: None,
        use_single_leaf: None,
    };
    
    generate_address(input)
        .map(|result| result.address)
        .map_err(|e| e.to_string())
}

// Internal function to generate taproot address using miniscript (legacy)
fn perform_taproot_address_generation(miniscript: &str, network_str: &str) -> Result<String, String> {
    let input = AddressInput {
        script_or_miniscript: miniscript.to_string(),
        script_type: "Taproot".to_string(),
        network: network_str.to_string(),
        internal_key: None,
        use_single_leaf: None,
    };
    
    generate_address(input)
        .map(|result| result.address)
        .map_err(|e| e.to_string())
}

// Internal function using Descriptor approach (legacy)
fn perform_descriptor_address_generation(miniscript: &str, network_str: &str, _internal_key: Option<String>) -> Result<String, String> {
    let input = AddressInput {
        script_or_miniscript: miniscript.to_string(),
        script_type: "Taproot".to_string(),
        network: network_str.to_string(),
        internal_key: None,
        use_single_leaf: None,
    };
    
    generate_address(input)
        .map(|result| result.address)
        .map_err(|e| e.to_string())
}


/// Generate a Taproot address with a specific internal key and script
/// This is for advanced use cases where you have a raw script and internal key
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

/// Generate a Taproot address using the descriptor approach (recommended method)
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
