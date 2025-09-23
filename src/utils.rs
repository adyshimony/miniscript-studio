//! Utility functions and macros for the miniscript compiler

use wasm_bindgen::prelude::*;


#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}

#[cfg(target_arch = "wasm32")]
#[macro_export]
macro_rules! console_log {
    ($($t:tt)*) => {
        $crate::utils::log(&format_args!($($t)*).to_string())
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[macro_export]
macro_rules! console_log {
    ($($t:tt)*) => {
        // No-op for native Rust tests
        ()
    }
}