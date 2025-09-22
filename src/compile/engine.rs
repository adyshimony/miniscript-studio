//! Compilation engine - dispatches to appropriate compilation functions
//! 
//! This engine routes compilation requests to the correct function based on
//! context and mode, preserving all existing behavior.

use crate::compile::types::{CompileRequest, CompileResponse, Context, Mode};
use crate::compile::modes::*;
use bitcoin::Network;

/// Main compilation engine
pub fn compile(request: CompileRequest) -> Result<CompileResponse, String> {
    let network = parse_network(&request.input.network)?;
    
    match request.input.context {
        Context::Taproot => {
            match request.input.mode {
                Some(Mode::MultiLeaf) => {
                    compile_taproot_multi_leaf(&request.input.expression, network)
                },
                Some(Mode::SingleLeaf) => {
                    let nums_key = request.input.nums_key.unwrap_or_else(|| crate::NUMS_POINT.to_string());
                    compile_taproot_single_leaf(&request.input.expression, &nums_key, network)
                },
                Some(Mode::ScriptPath) => {
                    let nums_key = request.input.nums_key.unwrap_or_else(|| crate::NUMS_POINT.to_string());
                    compile_taproot_script_path(&request.input.expression, &nums_key, network)
                },
                None => {
                    // Default to multi-leaf for taproot
                    compile_taproot_multi_leaf(&request.input.expression, network)
                }
            }
        },
        Context::Legacy => {
            // TODO: Move legacy compilation here
            todo!("Move legacy compilation logic here")
        },
        Context::Segwit => {
            // TODO: Move segwit compilation here
            todo!("Move segwit compilation logic here")
        }
    }
}

fn parse_network(network_str: &str) -> Result<Network, String> {
    match network_str {
        "mainnet" | "bitcoin" => Ok(Network::Bitcoin),
        "testnet" => Ok(Network::Testnet),
        "regtest" => Ok(Network::Regtest),
        "signet" => Ok(Network::Signet),
        _ => Err(format!("Unknown network: {}", network_str))
    }
}
