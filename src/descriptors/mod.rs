pub mod types;
pub mod parser;
pub mod processor;
pub mod utils;
pub mod compiler;

#[cfg(test)]
mod tests;

// Re-export main functions for easy access
pub use parser::parse_descriptors;
