# Export/Integration Feature Specification

## Context

This document describes a new **Export** feature for Miniscript Studio. After researching how wallet developers actually test miniscript implementations, we discovered:

- **BIP-379 has NO official test vectors** - Miniscript is implementation-agnostic
- **Real testing workflow**: Import descriptor into Bitcoin Core → generate addresses → test spending via PSBT on regtest
- **Static test vectors aren't useful** - Integration with Bitcoin Core is the standard

Therefore, instead of generic "test vectors", we're building practical export functionality.

---

## Feature Overview

Add an **Export** button that outputs compilation results in formats ready for:

1. **Bitcoin Core** - `importdescriptors` RPC JSON
2. **Wallets** - Sparrow, Liana, generic descriptor format
3. **Developer testing** - Comprehensive JSON with all data
4. **Mobile import** - QR code generation

---

## Export Formats

### 1. Bitcoin Core `importdescriptors`

Ready-to-use format for `bitcoin-cli importdescriptors`:

```json
[
  {
    "desc": "tr([fingerprint/path]xpub.../0/*)#checksum",
    "timestamp": "now",
    "range": [0, 100],
    "watchonly": true,
    "active": true,
    "internal": false
  }
]
```

### 2. Generic Descriptor (Sparrow/Liana compatible)

Plain descriptor string with checksum:

```
tr([C8FE8D4F/86h/0h/0h]xpub6ABC.../0/*)#abc123
```

### 3. Developer Comprehensive JSON

Full compilation + analysis data:

```json
{
  "meta": {
    "generator": "Miniscript Studio",
    "version": "1.0",
    "generated_at": "2025-01-11T12:00:00Z"
  },
  "input": {
    "type": "policy",
    "expression": "or(99@pk(Alice),and(pk(Bob),older(144)))",
    "context": "taproot"
  },
  "compilation": {
    "descriptor": "tr(NUMS,{or_d(pk(A),and_v(v:pk(B),older(144)))})#checksum",
    "miniscript": "or_d(pk(A),and_v(v:pk(B),older(144)))",
    "script_hex": "20a1b2c3...",
    "script_asm": "OP_PUSHBYTES_32 ... OP_CHECKSIG",
    "script_size": 71
  },
  "addresses": {
    "mainnet": "bc1p...",
    "testnet": "tb1p...",
    "signet": "tb1p...",
    "regtest": "bcrt1p..."
  },
  "taproot": {
    "internal_key": "50929b74...",
    "internal_key_type": "NUMS|extracted",
    "merkle_root": "a1b2c3..."
  },
  "satisfaction": {
    "paths": [
      {
        "description": "Alice signs",
        "required": ["sig(Alice)"],
        "witness_size": 65
      },
      {
        "description": "Bob signs after 144 blocks",
        "required": ["sig(Bob)", "older(144)"],
        "timelock": {
          "type": "relative_blocks",
          "value": 144,
          "human": "~1 day"
        },
        "witness_size": 66
      }
    ]
  },
  "analysis": {
    "is_sane": true,
    "is_non_malleable": true,
    "has_mixed_timelocks": false
  },
  "bitcoin_core": {
    "importdescriptors": [{"desc": "...", "timestamp": "now", "range": [0, 100], "watchonly": true}]
  }
}
```

---

## UI Design

### Button Location
- Add "📤 Export" button to both Policy and Miniscript toolbars

### Export Modal

```
┌─────────────────────────────────────────────┐
│  Export Compilation Results                 │
├─────────────────────────────────────────────┤
│  Format:                                    │
│  ○ Bitcoin Core (importdescriptors)         │
│  ○ Sparrow / Liana (descriptor)             │
│  ○ Developer JSON (comprehensive)           │
│                                             │
│  Network:                                   │
│  ○ Mainnet  ○ Testnet  ○ Signet  ○ Regtest │
│                                             │
│  Options:                                   │
│  ☑ Include analysis                         │
│  ☑ Include satisfaction paths               │
│                                             │
│  [Download JSON] [Copy to Clipboard] [QR]   │
└─────────────────────────────────────────────┘
```

---

## Implementation Plan

### Backend (Rust) - ~300 lines

**New file**: `src/export/mod.rs`

**New WASM exports in `src/lib.rs`**:

```rust
#[wasm_bindgen]
pub fn export_for_bitcoin_core(
    descriptor: &str,
    options: JsValue
) -> Result<String, JsValue>

#[wasm_bindgen]
pub fn export_comprehensive(
    expression: &str,
    context: &str,
    options: JsValue
) -> Result<JsValue, JsValue>
```

**New structs in `src/types.rs`**:
- `ExportOptions` - format, network, flags
- `BitcoinCoreDescriptor` - importdescriptors format
- `ComprehensiveExport` - full developer JSON

**Leverage existing code**:
- `compile_unified()` for compilation
- `analyze_miniscript()` / `analyze_policy()` for analysis
- Address generation already exists
- rust-miniscript provides checksum computation

### Frontend (JavaScript) - ~200 lines

**Files to modify**:

| File | Changes |
|------|---------|
| `miniscript/index.html` | Add Export button to toolbars |
| `miniscript/modules/compiler-core.js` | Add `exportResults()` method |
| `miniscript/modules/window-functions.js` | Add button click handlers |

**Dependencies**:
- QR Code library (CDN or npm) for mobile wallet import

---

## Decisions Made

| Decision | Choice |
|----------|--------|
| HD descriptor range | Default [0, 100] (standard gap limit) |
| QR code export | Yes, for mobile wallet import |
| Checksum | Use rust-miniscript built-in |
| Wallets to support | Sparrow, Liana, Generic (not Electrum) |

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/lib.rs` | Add `export_for_bitcoin_core()`, `export_comprehensive()` WASM exports |
| `src/types.rs` | Add `ExportOptions`, `BitcoinCoreDescriptor`, `ComprehensiveExport` structs |
| `src/export/mod.rs` | New module with export logic |
| `miniscript/index.html` | Add Export button to toolbars |
| `miniscript/modules/compiler-core.js` | Add `exportResults()` method |
| `miniscript/modules/window-functions.js` | Add button handlers, modal logic |

---

## Effort Estimate

- **Backend (Rust)**: ~300 lines - aggregating existing data into export formats
- **Frontend (JS)**: ~200 lines - modal, options, download/copy/QR logic
- **Total**: Medium effort

---

## Why This Approach

### What we learned from research:

1. **Bitcoin Core** uses C++ test framework, not JSON test vectors
2. **BIP-379** has no official test vectors (unlike BIP-341 Taproot)
3. **Real wallet testing** happens via regtest + PSBT workflows
4. **Wallet developers need**: `importdescriptors` format for direct Bitcoin Core integration

### This feature enables:

1. **Direct Bitcoin Core integration** - Copy JSON, paste into `bitcoin-cli`
2. **Wallet import** - Export descriptor for Sparrow/Liana
3. **Mobile import** - QR code for BlueWallet, etc.
4. **Developer verification** - Comprehensive JSON to compare implementations
5. **Documentation** - Export full compilation details for records

---

## Reference: Bitcoin Core Workflow

After export, users can test on regtest:

```bash
# 1. Import the descriptor
bitcoin-cli importdescriptors '[<exported JSON>]'

# 2. Generate addresses
bitcoin-cli deriveaddresses "tr(...)#checksum" "[0,10]"

# 3. Get new address
bitcoin-cli getnewaddress "" "bech32m"

# 4. Create PSBT to test spending
bitcoin-cli walletcreatefundedpsbt ...

# 5. Sign and verify
bitcoin-cli walletprocesspsbt ...
```
