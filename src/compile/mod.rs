//! Compilation functionality for Bitcoin Miniscript
//!
//! This module contains all compilation logic for converting policies to miniscripts
//! and miniscripts to Bitcoin scripts, with support for different contexts (legacy,
//! segwit, taproot) and compilation modes.

pub mod policy;
pub mod miniscript;
pub mod types;
pub mod modes;
pub mod engine;
pub mod options;
pub mod utils;
pub mod debug;

