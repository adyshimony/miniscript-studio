//! Compilation options and configuration types
//!
//! Defines the options structure for compilation operations including
//! input type, context, mode, and network selection.

use bitcoin::Network;
use serde::{Serialize, Deserialize};

// Unified compilation options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileOptions {
    // Type of input expression
    pub input_type: InputType,
    // Compilation context (Legacy, Segwit, Taproot)
    pub context: CompileContext,
    // Compilation mode (mainly for taproot)
    pub mode: CompileMode,
    // Bitcoin network for address generation (as string for JS compatibility)
    #[serde(default = "default_network_string")]
    pub network_str: String,
    // Optional NUMS key for taproot
    pub nums_key: Option<String>,
    // Enable verbose debug output
    #[serde(default)]
    pub verbose_debug: bool,
}

fn default_network_string() -> String {
    "bitcoin".to_string()
}

impl CompileOptions {
    // Get the parsed Network enum
    pub fn network(&self) -> Network {
        match self.network_str.to_lowercase().as_str() {
            "testnet" => Network::Testnet,
            "signet" => Network::Signet,
            "regtest" => Network::Regtest,
            _ => Network::Bitcoin,
        }
    }
}

impl Default for CompileOptions {
    fn default() -> Self {
        Self {
            input_type: InputType::Miniscript,
            context: CompileContext::Segwit,
            mode: CompileMode::Default,
            network_str: "bitcoin".to_string(),
            nums_key: None,
            verbose_debug: false,
        }
    }
}

// Type of input expression
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InputType {
    Policy,
    Miniscript,
}

// Compilation context
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompileContext {
    Legacy,
    Segwit,
    Taproot,
}

impl CompileContext {
    // Parse context from string (for backward compatibility)
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "legacy" => Ok(CompileContext::Legacy),
            "segwit" => Ok(CompileContext::Segwit),
            "taproot" => Ok(CompileContext::Taproot),
            _ => Err(format!("Invalid context: {}. Use 'legacy', 'segwit', or 'taproot'", s))
        }
    }

    // Convert to string representation
    pub fn as_str(&self) -> &str {
        match self {
            CompileContext::Legacy => "legacy",
            CompileContext::Segwit => "segwit",
            CompileContext::Taproot => "taproot",
        }
    }
}

// Compilation mode (mainly for taproot)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompileMode {
    #[serde(alias = "Default")]
    Default,
    #[serde(alias = "SingleLeaf")]
    SingleLeaf,
    #[serde(alias = "MultiLeaf")]
    MultiLeaf,
    #[serde(alias = "ScriptPath")]
    ScriptPath,
}

impl CompileMode {
    // Parse mode from string (for backward compatibility)
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "default" | "" => Ok(CompileMode::Default),
            "single-leaf" => Ok(CompileMode::SingleLeaf),
            "multi-leaf" => Ok(CompileMode::MultiLeaf),
            "script-path" => Ok(CompileMode::ScriptPath),
            _ => Err(format!("Invalid mode: {}", s))
        }
    }

    // Convert to string representation
    pub fn as_str(&self) -> &str {
        match self {
            CompileMode::Default => "default",
            CompileMode::SingleLeaf => "single-leaf",
            CompileMode::MultiLeaf => "multi-leaf",
            CompileMode::ScriptPath => "script-path",
        }
    }
}

impl CompileOptions {
    // Create options for policy compilation
    pub fn for_policy(context: &str, mode: Option<&str>, network: Option<Network>) -> Result<Self, String> {
        let network_str = network.map(|n| match n {
            Network::Testnet => "testnet",
            Network::Signet => "signet",
            Network::Regtest => "regtest",
            _ => "bitcoin",
        }).unwrap_or("bitcoin").to_string();

        Ok(Self {
            input_type: InputType::Policy,
            context: CompileContext::from_str(context)?,
            mode: mode.map(CompileMode::from_str).transpose()?.unwrap_or(CompileMode::Default),
            network_str,
            nums_key: None,
            verbose_debug: false,
        })
    }

    // Create options for miniscript compilation
    pub fn for_miniscript(context: &str, mode: Option<&str>, nums_key: Option<String>, network: Option<Network>) -> Result<Self, String> {
        let network_str = network.map(|n| match n {
            Network::Testnet => "testnet",
            Network::Signet => "signet",
            Network::Regtest => "regtest",
            _ => "bitcoin",
        }).unwrap_or("bitcoin").to_string();

        Ok(Self {
            input_type: InputType::Miniscript,
            context: CompileContext::from_str(context)?,
            mode: mode.map(CompileMode::from_str).transpose()?.unwrap_or(CompileMode::Default),
            network_str,
            nums_key,
            verbose_debug: false,
        })
    }
}