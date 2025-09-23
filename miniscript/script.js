/**
 * @file script.js
 * @description Main entry point for the Miniscript Compiler application
 *
 * This file orchestrates the modular architecture:
 * - Imports the core MiniscriptCompiler class
 * - Loads window functions for HTML event handlers
 * - Re-exports the compiler for potential external usage
 *
 * @version 1.2.0
 * @since 2025-01-24
 */

import { MiniscriptCompiler } from "./modules/compiler-core.js";
import "./modules/window-functions.js";

// Re-export for external module usage
export { MiniscriptCompiler };
