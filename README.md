# Miniscript Compiler

A WebAssembly-powered miniscript compiler that runs in the browser. This tool allows you to compile Bitcoin policies and miniscripts to Bitcoin Script bytecode, supporting Legacy (P2SH), Segwit v0 (P2WSH), and Taproot contexts.

## Features

- **Policy Compilation**: Convert high-level Bitcoin policies to miniscript expressions
- **Miniscript Compilation**: Compile miniscript expressions to Bitcoin Script bytecode
- **Reverse Engineering (Lift)**: Convert Bitcoin Script bytecode back to miniscript, and miniscript back to policy
- **Multiple Script Contexts**: Support for Legacy, Segwit v0, and Taproot script contexts
- **Address Generation**: Generate Bitcoin addresses for compiled scripts with mainnet/testnet toggle
- **Key Variable Management**: Define and reuse named public keys across expressions with auto-extraction
- **Expression Storage**: Save and load frequently used policies and expressions
- **Copy & Export**: One-click copying of expressions and policies to clipboard
- **Interactive Web Interface**: User-friendly browser-based interface with examples
- **Mobile Responsive**: Works seamlessly on desktop, tablet, and mobile devices
- **Local Storage**: All data persists locally in your browser - no server required

## Key Variables

The compiler allows you to define reusable key variables instead of typing full public keys repeatedly:

### How to Use Key Variables

1. **Add Variables**: In the "Key variables" section, enter a name (e.g., `Alice`) and corresponding public key
2. **Auto-Extract Keys**: Use the "🔑 Extract keys to variables" button to automatically detect and convert keys in your expressions to named variables
3. **Generate Keys**: Use the "🎲 Generate" button to create random test keys appropriate for the current script context
4. **Use in Expressions**: Reference keys by name in policies: `pk(Alice)` instead of `pk(03a34b99...)`
5. **Toggle Display**: Use "Show key names" checkbox to switch between showing full keys or variable names
6. **Restore Defaults**: Use "Restore defaults" button to reset to Alice, Bob, Charlie, and David
7. **Clear All**: Use "Clear all" button to remove all key variables (with confirmation)

### Auto-Extract Keys to Variables

The "🔑 Extract keys to variables" feature automatically converts long hex keys to named variables:

- **Detection**: Automatically finds public keys, xpubs, tpubs, and x-only keys in your expressions
- **Variable Generation**: Suggests meaningful names for detected keys (Alice, Bob, Charlie, etc.)
- **Key Type Selection**: For each detected key, choose the appropriate type:
  - **Compressed** (66 chars): For Legacy and Segwit v0 contexts
  - **X-only** (64 chars): For Taproot context
  - **xpub/tpub**: For extended public keys and derivation paths
- **Duplicate Prevention**: Avoids creating duplicate variables for keys that already exist
- **Batch Processing**: Handles multiple keys in complex expressions like `thresh(2,pk(Alice),pk(Bob),pk(Charlie))`

### Key Types and Context Detection

The compiler automatically detects the appropriate script context based on the key types used:

- **Compressed Keys** (66 characters, starting with 02/03): Used for Legacy and Segwit v0 contexts
  - Example: `02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9`
  - Visual indicator: Blue color with "compressed" badge
- **X-only Keys** (64 characters): Used for Taproot context
  - Example: `f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9`
  - Visual indicator: Purple color with "x-only" badge

### Context-Aware Features

- **Smart Key Generation**: The "🎲 Generate" button creates keys appropriate for the selected script context
- **Auto-Context Detection**: When loading saved expressions, policies, or examples, the script context automatically switches based on the key types detected
- **Duplicate Prevention**: Generated keys avoid duplicates with existing key variables
- **Visual Differentiation**: Key variables are color-coded and badged to easily distinguish between compressed and X-only keys

### Benefits

- **Readability**: `or(pk(Alice),pk(Bob))` is clearer than hex strings
- **Reusability**: Define once, use in multiple expressions
- **Error Reduction**: Avoid typos in long hex keys
- **Testing**: Generate random keys for experimentation
- **Context Awareness**: Automatic detection and switching of script contexts based on key formats

## Reverse Engineering (Lift Features)

The compiler supports "lifting" - reverse engineering Bitcoin scripts back to higher-level representations:

### Lift Bitcoin Script to Miniscript

Convert raw Bitcoin Script bytecode (hex or ASM format) back to miniscript expressions:

- **Input**: Bitcoin Script in hex format (e.g., `21022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4501ac`)
- **Input**: Bitcoin Script in ASM format (e.g., `022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4501 OP_CHECKSIG`)
- **Output**: Miniscript expression (e.g., `pk(022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4501)`)
- **Usage**: Paste script into the "Script HEX" or "Script ASM" fields and they will automatically lift to miniscript

### Lift Miniscript to Policy

Convert miniscript expressions back to high-level policy language:

- **Input**: Miniscript expression (e.g., `or_d(pk(Alice),and_v(v:pk(Bob),older(144)))`)
- **Output**: Policy expression (e.g., `or(pk(Alice),and(pk(Bob),older(144)))`)
- **Usage**: Compile any miniscript to see its policy equivalent in the results

### Benefits of Lifting

- **Script Analysis**: Understand what existing Bitcoin scripts do
- **Policy Recovery**: Extract the policy logic from deployed scripts
- **Educational**: Learn by reverse-engineering real Bitcoin scripts
- **Migration**: Convert legacy scripts to modern miniscript format
- **Debugging**: Verify scripts compile to expected bytecode

### Example Workflow

1. **Start with Script**: Paste hex script: `21022f...ac`
2. **Auto-Lift**: Script automatically converts to miniscript: `pk(022f...)`
3. **Extract Keys**: Use 🔑 button to convert keys to variables: `pk(Alice)`
4. **Compile to Policy**: See the high-level policy: `pk(Alice)`

## Save & Load System

The compiler provides persistent storage for your work:

### Saved Policies

- **Save**: Enter a policy, click "💾 Save" next to the compile button
- **Load**: Click "Load" on any saved policy to restore it
- **Manage**: Use "Del" to remove policies you no longer need
- **Auto-compile**: Loaded policies automatically populate the policy field

### Saved Expressions

- **Save**: After compiling, click "💾 Save" to store the miniscript expression
- **Load**: Click "Load" on saved expressions to restore them
- **Context Preserved**: Script context (Legacy/Segwit/Taproot) is saved with expressions
- **Quick Access**: Reuse complex expressions without retyping

### Storage Features

- **Local Storage**: All data stays in your browser (no server required)
- **Persistent**: Survives browser restarts and page refreshes
- **Limit**: Up to 20 saved policies and 20 saved expressions
- **Export**: Use the copy buttons (📋) to export expressions to external tools

## Share Feature

Share your work with colleagues or save it for later using shareable URLs:

### How to Share

- **Create Share Link**: Click the 🔗 button next to any policy or miniscript expression
- **What's Included**: The URL contains only your policy or miniscript expression
- **Automatic Loading**: When someone opens your link, the expression is loaded into the appropriate input field
- **Format Options**: Choose between URL encoding or compact JSON format in Settings

### Share URL Formats

- **URL Encoded**: Human-readable format that preserves special characters

  - Example: `?policy=or(pk(Alice),pk(Bob))`
  - Best for: Simple expressions, readability in URL bar
- **JSON (Compact)**: Base64-encoded format for complex expressions

  - Example: `?state=eyJwb2xpY3kiOiJvcihwa...`
  - Best for: Complex expressions, shorter URLs

### Use Cases

- **Collaboration**: Share your work with team members
- **Documentation**: Include links in documentation or tutorials
- **Backup**: Save URLs as bookmarks for important expressions
- **Templates**: Create reusable template URLs for common patterns

## Settings

Configure the compiler's behavior through the Settings section:

### Auto-compile on Load

Control whether expressions compile automatically when loaded:

- **Enabled** (default): When you load an example or saved expression, it automatically compiles to show results immediately
- **Disabled**: Expressions load into the input fields but wait for manual compilation
- **Applies to**: Example buttons, saved expressions, saved policies
- **Does NOT apply to**: Shared URLs (never auto-compile)

## Interface Guide

### Main Sections

The compiler interface is organized into collapsible sections for easy navigation:

- **🔑 Key variables**: Define and manage reusable public key names
- **💾 Saved policies**: Store and reload frequently used policy expressions
- **📝 Saved expressions**: Store and reload compiled miniscript expressions
- **📘 Policy reference**: Complete policy language documentation
- **📚 Miniscript reference**: Detailed miniscript syntax guide
- **💡 Tips & Quick Help**: Usage tips and feature explanations
- **⚙️ Settings**: Configure auto-compile and share format preferences

### Input Areas

- **Policy (optional)**: Enter high-level policy expressions that compile to miniscript
- **Miniscript expression**: Enter or view miniscript expressions for compilation
- **Script context**: Choose between Legacy (P2SH), Segwit v0 (P2WSH), or Taproot

### Interactive Features

- **Example buttons**: Quick-load common patterns for both policies and miniscripts
- **Show key names**: Toggle between displaying full public keys or variable names
- **Copy buttons**: One-click copying of expressions to clipboard with visual feedback
- **Real-time compilation**: Immediate feedback on compilation success or errors

## Building from Source

### Prerequisites

- Rust (latest stable version)
- `wasm-pack` for building WebAssembly modules

### Build Steps

```bash
# Install wasm-pack if not already installed
cargo install wasm-pack

# Build the WebAssembly module
wasm-pack build --target web

# Serve the application (WebAssembly requires HTTP server)
python -m http.server 8000
# Then open http://localhost:8000 in your browser
```

## Project Structure

```
miniscript-compiler/
├── src/
│   └── lib.rs              # Main Rust WASM module
├── pkg/                    # Generated WASM bindings (after build)
├── Cargo.toml              # Rust dependencies
├── index.html              # Web interface
└── script.js              # JavaScript frontend logic
```

## Script Contexts

The compiler supports three Bitcoin script contexts:

- **Legacy**: Traditional Bitcoin scripts using P2SH addresses
- **Segwit v0**: Native Segwit scripts using P2WSH addresses
- **Taproot**: Next-generation scripts for Bitcoin's Taproot upgrade

## Dependencies

This project uses the following Rust crates:

- [`miniscript`](https://crates.io/crates/miniscript) - Bitcoin miniscript library
- [`bitcoin`](https://crates.io/crates/bitcoin) - Bitcoin protocol implementation
- [`wasm-bindgen`](https://crates.io/crates/wasm-bindgen) - WebAssembly bindings
- [`serde`](https://crates.io/crates/serde) - Serialization framework
- [`hex`](https://crates.io/crates/hex) - Hex encoding utilities

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Resources

- [Miniscript Official Website](https://bitcoin.sipa.be/miniscript/)
- [Bitcoin Improvement Proposals](https://github.com/bitcoin/bips)
- [rust-miniscript Documentation](https://docs.rs/miniscript/)
- [rust-bitcoin Documentation](https://docs.rs/bitcoin/)
