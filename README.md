# Miniscript Studio

A WebAssembly-powered Bitcoin Miniscript compiler that runs in the browser. What started as a 2-hour hackathon experiment evolved into a comprehensive learning tool packed with every feature needed for mastering Miniscript.

## Features

- **Policy Editor**: Write spending conditions with syntax highlighting and auto-compilation
- **Miniscript Editor**: Work with raw miniscript or compile from policies
- **Lift**: Convert back Bitcoin Script → Miniscript → Policy
- **Taproot Support**: Full support with branch selection and script path analysis
- **HD Wallet Descriptors**: Range descriptors with index field and multipath support
- **Spending Analysis**: Detailed cost analysis and satisfaction paths
- **Context Switching**: Legacy, Segwit v0, and Taproot with automatic detection
- **Address Generation**: Bitcoin addresses with mainnet/testnet toggle
- **Key Management**: Auto-extract, generate, and manage key variables
- **Save & Share**: Local storage and shareable URLs
- **Rich Examples**: 20+ examples with educational descriptions
- **Local-First**: All data stays in your browser - no server required

## Policy Editor

- Write high-level spending conditions with syntax highlighting
- Auto-compilation on load (configurable)
- Example descriptions (collapsible in settings)
- Indent expressions for readability
- Auto-clean invalid characters before compiling

## Miniscript Editor

- Works standalone or with Policy editor
- Detailed compilation messages with spending analysis
- Branch selection for Taproot OR conditions
- Shows satisfaction paths and weight units
- Load examples with rich educational descriptions

## Script Output

- Bitcoin Script in HEX and ASM formats
- **Editable fields** for lifting operations
- Bitcoin addresses with network toggle (mainnet/testnet)
- Show/hide pushbytes operations
- Show/hide key names to see actual values

## Key Variables

Manage public keys with friendly names:

### Extract Keys 🔑
- **Missing variables**: Write `or(pk(Nadav),pk(Aviv))` → auto-generate keys for undefined variables
- **Hex to variables**: Convert long hex keys to named variables automatically
- **From errors**: Generate missing keys directly from error messages

### Key Management
- **Add/Edit/Delete**: Full control over key variables
- **Generate**: 🎲 creates context-appropriate test keys
- **Toggle Display**: Show names or actual key values
- **Restore Defaults**: Reset to default keys anytime
- **Key Types**: Compressed (66 chars) for Legacy/Segwit, X-only (64 chars) for Taproot
- **Local Storage**: Keys saved in browser, never sent to server

## Lift (Reverse Engineering) 

The **Script HEX and ASM fields are editable** - paste any Bitcoin Script to reverse engineer it:

### Bitcoin Script → Miniscript
- **Input**: Paste hex or ASM format into the editable script fields
- **Output**: Automatically lifts to readable miniscript
- **Example**: `21022f...ac` → `pk(022f...)`

### Miniscript → Policy
- **Input**: Any miniscript expression
- **Output**: High-level policy representation
- **Example**: `or_d(pk(Alice),older(144))` → `or(pk(Alice),older(144))`

**Note**: Not all scripts can be lifted (e.g., scripts with public key hashes)


## Script Contexts

- **Legacy (P2SH)**: Traditional Bitcoin scripts, max compatibility
- **Segwit v0 (P2WSH)**: Native witness scripts, lower fees
- **Taproot**: Privacy-enhanced scripts with multiple sub-contexts:
  - **Single Leaf**: Simple script in taproot tree
  - **Script Path**: Multiple branches with cost analysis
  - **Script + Key Path**: Combined key and script spending paths

## Taproot Features

### Branch Selection
- **OR Conditions**: Choose which branch to compile from policy
- **Script Paths**: Visualize different spending paths with costs
- **Context Options**:
  - Single Leaf: Simple script in taproot tree
  - Script Path: Multiple branches with analysis
  - Script + Key Path: Combined spending options

### Spending Analysis
- **Weight Units**: Fee estimation for each path
- **Satisfaction Paths**: All ways to spend the script
- **Descriptors**: Full taproot descriptor display
- **Cost Comparison**: Compare different contexts


## HD Wallet Descriptors

Full support for xpub/tpub descriptors with range patterns:

### Derivation Index Field
- **Auto-appears**: When using wildcard patterns (`/*`)
- **Index input**: Enter 0-2147483647 for specific derivations
- **No expression editing**: Change index without modifying the descriptor
- **Real-time**: Instant address generation on index change

### Multipath Support
- **Range descriptors**: `<0;1>/*` for external/change branches
- **Path selector**: Dropdown to choose External or Change
- **BIP389 Compliant**: Modern HD wallet patterns
- **All contexts**: Works in Legacy, Segwit, and Taproot


## Save & Load

Persistent local storage for your work:

- **Save Policies**: 💾 button stores policy expressions (up to 20)
- **Save Expressions**: 💾 button stores compiled miniscript (up to 20)
- **Load**: Click "Load" to restore saved items with context preserved
- **Local Storage**: All data stays in your browser
- **Export**: 📋 button copies expressions to clipboard

## Share

Create shareable URLs for collaboration:

- **Create Link**: 🔗 button generates shareable URL
- **Formats**: URL encoded (`?policy=...`) or compact JSON (`?state=...`)
- **Auto-load**: Links automatically load expressions when opened
- **Use Cases**: Team collaboration, documentation, bookmarking templates

## Settings

- **🎨 Theme**: Dark/Light mode switcher
- **🏃 Auto-compile**: Automatically compile when loading examples or saved expressions
- **📖 Show descriptions**: Display helpful descriptions for example buttons
- **💡 Editor tips**: Show/hide helpful placeholder text in empty editors
- **🔗 Share format**: Choose between URL encoded or JSON format for share links
- **👁️ Hide corner buttons**: Hide GitHub and donation buttons (web only)
- **🌳 Tree display**: Script Compilation, Visual Hierarchy, or Hidden

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
├── miniscript/
│   ├── index.html          # Main web interface
│   ├── script.js           # Entry point, imports modules
│   ├── modules/
│   │   ├── compiler-core.js     # MiniscriptCompiler class
│   │   ├── window-functions.js  # Global window functions
│   │   └── constants.js         # Shared constants
│   └── pkg/                # Generated WASM bindings
├── src/
│   ├── lib.rs              # WASM exports
│   ├── compile/            # Compilation logic
│   ├── descriptors/        # HD wallet descriptors
│   ├── taproot/            # Taproot-specific logic
│   ├── lift/               # Script lifting
│   ├── keys/               # Key management
│   ├── address/            # Address generation
│   └── validation/         # Input validation
├── tests/                  # Rust tests
├── Cargo.toml              # Rust dependencies
└── README.md               # This file
```

## Dependencies

- [`miniscript`](https://crates.io/crates/miniscript) - Bitcoin miniscript library
- [`bitcoin`](https://crates.io/crates/bitcoin) - Bitcoin protocol implementation
- [`wasm-bindgen`](https://crates.io/crates/wasm-bindgen) - WebAssembly bindings
- [`serde`](https://crates.io/crates/serde) - Serialization framework

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Resources

- [Miniscript Official Website](https://bitcoin.sipa.be/miniscript/)
- [Bitcoin Improvement Proposals](https://github.com/bitcoin/bips)
- [rust-miniscript Documentation](https://docs.rs/miniscript/)
- [rust-bitcoin Documentation](https://docs.rs/bitcoin/)
