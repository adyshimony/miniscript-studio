# Export Feature - Ralph Loop Prompt

## Task

Implement an **Export** button for Miniscript Studio that outputs compilation results in formats ready for:
1. Bitcoin Core (`importdescriptors` RPC)
2. Sparrow / Liana / Generic wallets
3. Developer testing (comprehensive JSON)

---

## User Requirements

| Category | Selection |
|----------|-----------|
| Bitcoin Core | `importdescriptors` JSON format |
| Wallets | Sparrow, Liana, Generic descriptor |
| Dev data | Comprehensive: addresses (all networks), script details, satisfaction paths |

---

## Export Formats

### 1. Bitcoin Core `importdescriptors`

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

```
tr([C8FE8D4F/86h/0h/0h]xpub.../0/*)#checksum
```

### 3. Developer Comprehensive JSON

```json
{
  "meta": {
    "generator": "Miniscript Studio",
    "version": "1.0",
    "generated_at": "2025-01-11T12:00:00Z"
  },
  "input": {
    "type": "policy|miniscript",
    "expression": "or(pk(Alice),and(pk(Bob),older(144)))",
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
        "timelock": {"type": "relative_blocks", "value": 144, "human": "~1 day"},
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
    "importdescriptors": [{"desc": "...", "timestamp": "now", ...}]
  }
}
```

---

## Implementation

### Backend (Rust)

**New file**: `src/export/mod.rs`

```rust
// New WASM exports in src/lib.rs
#[wasm_bindgen]
pub fn export_for_bitcoin_core(descriptor: &str, options: JsValue) -> Result<String, JsValue>

#[wasm_bindgen]
pub fn export_comprehensive(expression: &str, context: &str, options: JsValue) -> Result<JsValue, JsValue>
```

**Files to modify**:
- `src/lib.rs` - Add WASM exports
- `src/types.rs` - Add `ExportResult`, `BitcoinCoreDescriptor` structs

**Leverage existing**:
- `compile_unified()` for compilation
- `analyze_miniscript()` / `analyze_policy()` for analysis
- Address generation already exists

### Frontend (JavaScript)

**New UI**: Export button + modal

**Files to modify**:
- `miniscript/index.html` - Add Export button to toolbars
- `miniscript/modules/compiler-core.js` - Add `exportResults()` method
- `miniscript/modules/window-functions.js` - Add click handlers

**Export Modal Options**:
```
Format:  [Bitcoin Core] [Sparrow/Liana] [Developer JSON]
Network: [Mainnet] [Testnet] [Signet] [Regtest]
[x] Include analysis
[x] Include satisfaction paths
[Download JSON] [Copy to Clipboard] [Show QR Code]
```

**QR Code**: Use `qrcode` JS library for mobile wallet import (Sparrow, BlueWallet)

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/lib.rs` | Add `export_for_bitcoin_core()`, `export_comprehensive()` |
| `src/types.rs` | Add export-related structs |
| `src/export/mod.rs` | New module with export logic |
| `miniscript/index.html` | Add Export button |
| `miniscript/modules/compiler-core.js` | Add `exportResults()` method |
| `miniscript/modules/window-functions.js` | Add button handlers |

---

## Effort Estimate

- Backend (Rust): ~300 lines - aggregating existing data into export formats
- Frontend (JS): ~200 lines - modal, options, download/copy logic
- Total: Medium effort

---

## Decisions Made

- **HD descriptor range**: Default [0, 100] (standard gap limit)
- **QR code**: Yes, include QR code export for mobile wallets
- **Checksum**: Use rust-miniscript's built-in checksum computation

---

## UI Design

### Button Placement

Add below compilation success message - appears only after successful compile:

```
✅ Policy Segwit v0 (p2WSH) compilation successful
[📦 Export]  [📋 Copy All]
```

### Modal Design

```
┌─────────────────────────────────────────┐
│  📦 Export                              │
├─────────────────────────────────────────┤
│  Format:                                │
│  ○ Bitcoin Core (importdescriptors)     │
│  ○ Sparrow / Liana (descriptor)         │
│  ● Developer JSON (comprehensive)       │
│                                         │
│  Include contexts:                      │
│  ☑ Current only                         │
│  ☐ All (Legacy, Segwit, Taproot)        │
│                                         │
│  Include networks:                      │
│  ☑ Mainnet & Testnet                    │
│  ☐ All (+ Signet, Regtest)              │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Preview (first 10 lines):       │    │
│  │ {                               │    │
│  │   "meta": { ...                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  [📋 Copy] [💾 Download] [QR Code]      │
└─────────────────────────────────────────┘
```

### Filename Convention

```
miniscript-export-{policy-summary}-{context}-{date}.json
```
Example: `miniscript-export-thresh-2-of-3-segwit-2026-01-14.json`

### Feedback

- Toast: "✅ Copied to clipboard" / "✅ Downloaded export.json"
- Don't auto-close modal after action

### Edge Cases

- No compilation yet → Button disabled, tooltip "Compile first"
- Compilation error → Button hidden
- Large output (>1MB) → Warn, offer minified only

### Keyboard Shortcut

`Ctrl+Shift+E` to open export modal (after compilation)

---

## Dependencies

- **QR Code library**: CDN `qrcode.min.js` or npm package
- **rust-miniscript**: Already available, provides checksum computation

---

## Completion Criteria

The task is complete when ALL of these are true:

1. **Backend**: `src/export/mod.rs` exists with export logic
2. **WASM exports**: `export_for_bitcoin_core()` and `export_comprehensive()` work
3. **Frontend**: Export button appears after successful compilation
4. **Modal**: Shows format options (Bitcoin Core, Sparrow/Liana, Developer JSON)
5. **Actions**: Copy to clipboard, Download JSON, and QR code all work
6. **Build passes**: `wasm-pack build --target web` succeeds

## Verification Steps

1. **Compile a policy** → Export button appears
2. **Export Bitcoin Core format** → Valid `importdescriptors` JSON
3. **Export descriptor** → Valid descriptor with checksum
4. **Export Developer JSON** → Contains addresses, scripts, satisfaction paths
5. **QR code** → Generates scannable QR
6. **Edge cases** → Button disabled before compile, hidden on error

## Completion Promise

When all criteria above are met and verified, output:

```
<promise>EXPORT FEATURE COMPLETE</promise>
```

---

## Ralph Loop Usage

```bash
/ralph-loop "$(cat docs/miniscript-studio-export-feature.md)" --completion-promise "EXPORT FEATURE COMPLETE" --max-iterations 30
```
