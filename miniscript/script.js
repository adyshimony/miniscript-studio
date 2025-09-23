// Main entry point for the Miniscript Compiler
// This file imports all modules and maintains the same interface

// Import the compiler core (exports MiniscriptCompiler class)
import { MiniscriptCompiler } from "./modules/compiler-core.js";

// Import window functions and initialization  
// This will create window.compiler and all window.* functions
import "./modules/window-functions.js";

// Re-export the compiler class for external use if needed
export { MiniscriptCompiler };
