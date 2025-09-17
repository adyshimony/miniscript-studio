use regex::Regex;

// Re-export descriptor types from the main types module
pub use crate::types::{DescriptorInfo, ParsedDescriptor};

/// Container for descriptor regex patterns
pub struct DescriptorPatterns {
    // Full descriptors with fingerprint
    pub full_multipath: Regex,           // [fp/path]xpub/<0;1>/*
    pub full_wildcard_single: Regex,     // [fp/path]xpub/*
    pub full_wildcard_double: Regex,     // [fp/path]xpub/*/*
    pub full_fixed_wildcard: Regex,      // [fp/path]xpub/0/*
    pub full_wildcard_fixed: Regex,      // [fp/path]xpub/*/0
    pub full_fixed_single: Regex,        // [fp/path]xpub/0
    pub full_fixed_double: Regex,        // [fp/path]xpub/0/0

    // Bare extended keys
    pub bare_multipath: Regex,           // xpub/<0;1>/*
    pub bare_wildcard_single: Regex,     // xpub/*
    pub bare_wildcard_double: Regex,     // xpub/*/*
    pub bare_fixed_wildcard: Regex,      // xpub/0/*
    pub bare_wildcard_fixed: Regex,      // xpub/*/0
    pub bare_fixed_single: Regex,        // xpub/0
    pub bare_fixed_double: Regex,        // xpub/0/0
}
