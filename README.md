# Miniscript Compiler

A WebAssembly-powered miniscript compiler that runs in the browser. This tool allows you to compile Bitcoin policies and miniscripts to Bitcoin Script bytecode, supporting Legacy (P2SH), Segwit v0 (P2WSH), and Taproot contexts.

## Features

- **Policy Compilation**: Convert high-level Bitcoin policies to miniscript expressions
- **Miniscript Compilation**: Compile miniscript expressions to Bitcoin Script bytecode  
- **Multiple Script Contexts**: Support for Legacy, Segwit v0, and Taproot script contexts
- **Address Generation**: Generate Bitcoin addresses for compiled scripts (where applicable)
- **Key Variable Management**: Define and reuse named public keys across expressions
- **Expression Storage**: Save and load frequently used policies and expressions
- **Interactive Web Interface**: User-friendly browser-based interface with examples

## Quick Start

1. Open `index.html` in your web browser
2. Define key variables (e.g., `Alice`, `Bob`) using the sidebar
3. Enter a policy expression like `or(pk(Alice),and(pk(Bob),older(144)))`
4. Click "Compile" to generate the corresponding miniscript and Bitcoin Script
5. View the compiled script, assembly code, and Bitcoin address

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

# Open index.html in your browser
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

## Policy Language

The policy language provides a high-level way to express Bitcoin spending conditions:

### Basic Functions

- `pk(key)` - Requires a signature from the specified public key
- `pkh(key)` - Requires revealing and signing with a key hash
- `older(n)` - Requires n blocks/seconds to pass since input creation  
- `after(n)` - Requires block height or time n to be reached
- `sha256(h)`, `hash256(h)`, `ripemd160(h)`, `hash160(h)` - Hash preimage conditions

### Logical Operators

- `and(X,Y)` - Both conditions must be satisfied
- `or(X,Y)` - Either condition must be satisfied  
- `thresh(k,X,Y,Z,...)` - At least k out of n conditions must be satisfied

### Multisignature

- `multi(k,key1,key2,...)` - Traditional k-of-n multisig
- `multi_a(k,key1,key2,...)` - Modern k-of-n multisig using CHECKSIGADD

### Examples

```
# Alice can spend, or Bob can spend after 1 day
or(pk(Alice),and(pk(Bob),older(144)))

# 2-of-3 multisignature between Alice, Bob, and Charlie  
thresh(2,pk(Alice),pk(Bob),pk(Charlie))

# Alice and either Bob or Charlie must sign
and(pk(Alice),or(pk(Bob),pk(Charlie)))
```

## Miniscript

For direct miniscript compilation, the tool supports the full miniscript language including:

- Basic fragments: `pk()`, `pkh()`, `older()`, `after()`, hash conditions
- AND combinators: `and_v()`, `and_b()`, `and_n()`
- OR combinators: `or_b()`, `or_c()`, `or_d()`, `or_i()`  
- Threshold: `thresh()`, `multi()`, `multi_a()`
- Wrappers: `a:`, `s:`, `c:`, `t:`, `d:`, `v:`, `j:`, `n:`, `l:`, `u:`

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

- [Miniscript Website](https://bitcoin.sipa.be/miniscript/)
- [Bitcoin Improvement Proposals](https://github.com/bitcoin/bips)
- [rust-miniscript Documentation](https://docs.rs/miniscript/)
- [rust-bitcoin Documentation](https://docs.rs/bitcoin/)