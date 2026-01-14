# Miniscript Studio - Improvement Suggestions

## Current State Summary

Miniscript Studio is a comprehensive, browser-based tool for Bitcoin script development with:
- Policy & Miniscript compilation across Legacy, Segwit, Taproot contexts
- HD wallet descriptor support (xpub/tpub with BIP389 multipath)
- Lift functionality (Script → Miniscript → Policy)
- Key management with auto-extraction
- Rich analysis module (spending paths, timelocks, security checks)
- 20+ educational examples
- Save/share functionality

---

## Suggested Improvements

### 1. Natural Language Policy Description (NLM Support)

**Problem**: Policies like `or(99@pk(Alice),and(pk(Bob),older(144)))` are hard for non-technical users to understand at a glance.

**Solution**: Add a "Plain English" panel that describes the policy in human-readable terms.

**Example output**:
```
This script can be spent in 2 ways:
  1. Alice signs (preferred, 99% weight)
  2. Bob signs AFTER waiting 144 blocks (~1 day)
```

**Implementation**:
- Add `describe_policy(policy)` Rust function returning structured description
- Render in collapsible panel below policy editor
- Include timelock conversions (blocks → hours/days)

---

### 2. Visual Policy Builder (Drag & Drop)

**Problem**: Users must learn policy syntax before they can use the tool.

**Solution**: Add a visual interface where users can:
- Drag building blocks: `pk()`, `and()`, `or()`, `thresh()`, `after()`, `older()`
- Connect them visually to build policies
- See the text policy update in real-time

**Benefit**: Lower barrier to entry for non-developers.

---

### 3. PSBT Support

**Problem**: Users can create scripts but can't easily test spending them.

**Solution**: Add PSBT (Partially Signed Bitcoin Transaction) support:
- Parse PSBT to show which script conditions are satisfied
- Highlight which signatures/timelocks are still needed
- Show progress toward complete satisfaction

**Use case**: "I have this PSBT, what else do I need to sign it?"

---

### 4. Wallet Compatibility Checker

**Problem**: Not all wallets support all script types.

**Solution**: Add a "Wallet Compatibility" panel showing:
- Which popular wallets can spend this script (Sparrow, Electrum, Bitcoin Core, etc.)
- Which hardware wallets support it (Ledger, Trezor, Coldcard)
- BIP compliance indicators (BIP-379, BIP-389, etc.)

---

### 5. Script Templates Library

**Problem**: Users want common patterns but may not know how to construct them.

**Solution**: Expand examples into categorized templates:
- **Custody**: Single-sig, multisig, corporate treasury
- **Recovery**: Timelock backup, social recovery, inheritance
- **Trading**: Atomic swaps, escrow, payment channels
- **DeFi**: DLCs, vaults, covenants (where possible)

Each template includes:
- Editable parameters (keys, timelocks)
- Security considerations
- Recommended contexts (Legacy/Segwit/Taproot)

---

### 6. Fee Estimation Integration

**Problem**: Users see weight units but don't know real-world cost.

**Solution**: Add fee estimation:
- Fetch current fee rates from mempool.space API (optional)
- Show estimated cost in sats/USD for each spending path
- Compare paths: "Path 1 costs ~500 sats, Path 2 costs ~800 sats"

---

### 7. Script Diff Tool

**Problem**: Users can't easily compare two policies or scripts.

**Solution**: Add a "Compare" mode:
- Side-by-side policy/miniscript/script comparison
- Highlight differences
- Show size/weight differences
- Useful for: "What changed if I add a timelock?"

---

### 8. Export to Wallet Formats

**Problem**: Users create descriptors but need to import them manually.

**Solution**: Add export buttons for:
- Bitcoin Core `importdescriptors` JSON
- Sparrow wallet format
- Electrum format
- Generic SLIP-132 format
- QR code for mobile wallets

---

### 9. Interactive Tutorial Mode

**Problem**: New users don't know where to start.

**Solution**: Add guided tutorials:
- Step-by-step walkthrough for first-time users
- Highlight UI elements as users progress
- Explain concepts inline (what is a timelock? what is thresh?)
- Progressive examples: simple → complex

---

### 10. Miniscript Optimization Suggestions

**Problem**: Users may write inefficient policies.

**Solution**: Add optimization hints:
- Detect suboptimal patterns and suggest improvements
- Show before/after script sizes
- Example: "Moving the most likely branch first saves X bytes"

---

### 11. Test Vector Generator

**Problem**: Developers need test cases for their implementations.

**Solution**: Add "Generate Test Vectors" button:
- Output JSON with: policy, miniscript, script hex, addresses for all networks
- Include satisfaction witnesses for testing
- Useful for wallet developers and protocol implementers

---

### 12. BIP-379 Miniscript Standard Reference

**Problem**: Users may want to understand the underlying standard.

**Solution**: Add inline BIP-379 references:
- Link specific operators to their BIP definition
- Show type requirements (B, V, K, W) with explanations
- "Learn more" links to official documentation

---

### 13. Collaborative Editing / Comments

**Problem**: Teams need to discuss policies together.

**Solution**: Add basic collaboration features:
- Shareable links with embedded comments/notes
- "Annotate" mode to add explanations to policy parts
- Export policy with annotations as documentation

---

### 14. Script Simulator / Debugger

**Problem**: Users can't test script execution.

**Solution**: Add a script execution simulator:
- Step through script opcodes
- Visualize stack operations
- Test with mock signatures/preimages
- Show why a spend would succeed or fail

---

### 15. API / CLI Tool

**Problem**: Developers want to integrate compilation into their workflow.

**Solution**: Provide:
- REST API (or document how to use WASM directly)
- CLI tool for batch compilation
- npm package for Node.js integration

---

## Priority Recommendations

### High Priority (High Impact, Reasonable Effort)
1. **Natural Language Description** - Makes tool accessible to non-technical users
2. **Script Templates Library** - Immediate value, mostly content work
3. **Export to Wallet Formats** - Practical utility, clear scope
4. **Interactive Tutorial** - Reduces friction for new users

### Medium Priority (High Impact, More Effort)
5. **PSBT Support** - Very useful but significant implementation
6. **Visual Policy Builder** - Game-changer for UX but complex
7. **Fee Estimation** - Adds real-world context

### Lower Priority (Nice to Have)
8. **Script Diff Tool**
9. **Wallet Compatibility Checker**
10. **Optimization Suggestions**
11. **API/CLI**

---

## User Preferences

- **Focus**: All categories (UX, Integration, Dev Tools, Education)
- **Primary Audience**: Wallet Developers
- **Connectivity**: Optional online features acceptable

---

## Refined Priority for Wallet Developers

### Tier 1: Essential for Wallet Developers

| Feature | Why It Matters | Effort |
|---------|----------------|--------|
| **Test Vector Generator** | Wallet devs need test cases to verify their implementations | Medium |
| **Export to Wallet Formats** | Direct integration with Bitcoin Core, Sparrow, Electrum | Medium |
| **PSBT Analysis** | Debug signing flows, understand what's missing | High |
| **Wallet Compatibility Matrix** | Know which wallets support which script types | Low |

### Tier 2: High Value Additions

| Feature | Why It Matters | Effort |
|---------|----------------|--------|
| **Natural Language Description** | Explain scripts to non-technical stakeholders | Medium |
| **Script Templates (Custody Focus)** | Common patterns for custody products | Low |
| **Fee Estimation (via mempool.space)** | Real-world cost analysis | Low |
| **API/CLI Tool** | Integrate into CI/CD, batch processing | Medium |

### Tier 3: Nice to Have

| Feature | Why It Matters | Effort |
|---------|----------------|--------|
| **Visual Policy Builder** | Great for demos and learning | High |
| **Script Diff Tool** | Compare policy iterations | Medium |
| **Script Simulator** | Debug execution step-by-step | High |
| **BIP-379 Inline References** | Quick spec lookups | Low |

---

## Recommended Implementation Order

1. **Test Vector Generator** - Immediately useful, builds on existing compilation
2. **Export to Wallet Formats** - Practical bridge to real wallets
3. **Wallet Compatibility Matrix** - Quick win, content-based
4. **Natural Language Description** - Makes tool accessible to non-devs
5. **Fee Estimation** - Simple API integration
6. **PSBT Analysis** - Bigger project but high value
7. **API/CLI** - For power users and automation

---

## Feature Deep Dive: Test Vector Generator

### Overview

A "Generate Test Vectors" button that exports comprehensive JSON test data for wallet developers to verify their miniscript/descriptor implementations.

### Why Wallet Developers Need This

1. **Implementation Verification** - When building a wallet that supports miniscript, devs need known-good test cases
2. **Regression Testing** - Automated CI/CD pipelines need test fixtures
3. **Cross-Implementation Compatibility** - Ensure their wallet produces same results as rust-miniscript
4. **Edge Case Coverage** - Complex policies with timelocks, thresholds, taproot branches

### Output Format (JSON)

```json
{
  "meta": {
    "generator": "Miniscript Studio v1.0",
    "rust_miniscript_version": "12.3.0",
    "generated_at": "2025-01-04T12:00:00Z",
    "bip379_compliant": true
  },
  "input": {
    "policy": "or(99@pk(Alice),and(pk(Bob),older(144)))",
    "context": "taproot",
    "mode": "single-leaf",
    "key_variables": {
      "Alice": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      "Bob": "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"
    }
  },
  "compilation": {
    "miniscript": "or_d(pk(Alice),and_v(v:pk(Bob),older(144)))",
    "miniscript_type": "Bdu",
    "script_hex": "2079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ac6476a914...",
    "script_asm": "OP_PUSHBYTES_32 79be667e... OP_CHECKSIG OP_IFDUP OP_NOTIF...",
    "script_size_bytes": 71
  },
  "addresses": {
    "mainnet": "bc1p...",
    "testnet": "tb1p...",
    "signet": "tb1p...",
    "regtest": "bcrt1p..."
  },
  "taproot_specific": {
    "internal_key": "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0",
    "internal_key_type": "NUMS (unspendable)",
    "merkle_root": "a1b2c3...",
    "descriptor": "tr(NUMS,{or_d(pk(Alice),and_v(v:pk(Bob),older(144)))})"
  },
  "satisfaction": {
    "paths": [
      {
        "description": "Alice signs (primary path)",
        "weight": 99,
        "required": ["sig(Alice)"],
        "witness_template": ["<sig_alice>", "<script>", "<control_block>"],
        "estimated_witness_size": 65,
        "estimated_weight_units": 260
      },
      {
        "description": "Bob signs after 144 blocks",
        "weight": 1,
        "required": ["sig(Bob)", "older(144)"],
        "witness_template": ["<sig_bob>", "OP_TRUE", "<script>", "<control_block>"],
        "timelock": {
          "type": "relative_blocks",
          "value": 144,
          "human_readable": "~1 day"
        },
        "estimated_witness_size": 66,
        "estimated_weight_units": 264
      }
    ]
  },
  "analysis": {
    "is_sane": true,
    "is_non_malleable": true,
    "has_mixed_timelocks": false,
    "has_repeated_keys": false,
    "max_ops": 12,
    "max_stack_size": 4
  },
  "all_contexts": {
    "legacy": {
      "script_hex": "...",
      "address_mainnet": "3...",
      "address_testnet": "2..."
    },
    "segwit_v0": {
      "script_hex": "...",
      "address_mainnet": "bc1q...",
      "address_testnet": "tb1q..."
    },
    "taproot": {
      "script_hex": "...",
      "address_mainnet": "bc1p...",
      "address_testnet": "tb1p..."
    }
  }
}
```

### UI Implementation

**Location**: Add button to both Policy and Miniscript toolbars

**Button**: `📦 Export Test Vector` or `🧪 Test Vector`

**Behavior**:
1. Click button → generates JSON
2. Options modal:
   - Include all contexts? (Legacy/Segwit/Taproot)
   - Include all networks? (mainnet/testnet/signet/regtest)
   - Pretty print or minified?
3. Download as `.json` file or copy to clipboard

### Backend Implementation

**New Rust function** in `src/lib.rs`:

```rust
#[wasm_bindgen]
pub fn generate_test_vector(
    expression: &str,
    context: &str,
    options: JsValue  // TestVectorOptions
) -> Result<JsValue, JsValue>
```

**Leverages existing code**:
- `compile_unified()` for compilation
- `analyze_miniscript()` / `analyze_policy()` for analysis
- Address generation already exists
- Just need to aggregate into structured output

### Files to Modify

| File | Changes |
|------|---------|
| `src/lib.rs` | Add `generate_test_vector()` WASM export |
| `src/types.rs` | Add `TestVectorResult` struct |
| `src/test_vectors/mod.rs` | New module for test vector generation logic |
| `miniscript/modules/compiler-core.js` | Add `generateTestVector()` method |
| `miniscript/modules/window-functions.js` | Add button click handler |
| `miniscript/index.html` | Add button to toolbars |

### Effort Estimate

- **Backend (Rust)**: ~200 lines - mostly aggregating existing data
- **Frontend (JS)**: ~100 lines - button, modal, download logic
- **Total**: Medium effort, high value

### Example Use Cases

1. **Wallet Developer**: "I'm implementing BIP-379 support in my wallet. I need test vectors to verify my parsing and compilation match rust-miniscript."

2. **CI Pipeline**: "Every PR runs our test suite against known-good vectors from Miniscript Studio."

3. **Protocol Designer**: "I designed a new vault policy. Export test vectors to share with my team for implementation."

4. **Auditor**: "Generate test vectors for this custody setup to verify the production wallet matches expected behavior."

---

### UX Recommendations for Test Vector Generator

*Based on live site analysis of adys.dev/miniscript*

#### Button Placement & Design

**Recommendation**: Add as a **standalone button** rather than a toolbar icon.

**Why**:
- This is a power-user feature, not a frequent action like Copy/Format
- Toolbar already has 6 icons - adding more increases cognitive load
- A labeled button makes the feature discoverable

**Suggested placement options**:

1. **Option A (Recommended)**: Add below the compilation success message
   ```
   ✅ Policy Segwit v0 (p2WSH) compilation successful
   [📦 Export Test Vector]  [📋 Copy All]
   ```
   - Appears only after successful compilation
   - Contextually relevant - user just compiled, now can export

2. **Option B**: Add to the action buttons row
   ```
   [🔨 Compile] [🔍 Analyze] [💾 Save] [📂 Load] [🗑️ Clear] [📦 Test Vector]
   ```
   - Always visible
   - Consistent with other actions

3. **Option C**: Add to a new "Developer Tools" collapsible panel
   - Groups power-user features together
   - Keeps main UI clean for beginners

#### Modal Design

**Keep it simple** - don't overwhelm with options:

```
┌─────────────────────────────────────────┐
│  📦 Export Test Vector                  │
├─────────────────────────────────────────┤
│                                         │
│  Include contexts:                      │
│  ☑ Current (Segwit v0)                  │
│  ☐ All contexts (Legacy, Segwit, Taproot)│
│                                         │
│  Include networks:                      │
│  ☑ Mainnet & Testnet                    │
│  ☐ All (+ Signet, Regtest)              │
│                                         │
│  Format:                                │
│  ○ Pretty (readable)                    │
│  ● Minified (smaller)                   │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Preview (first 10 lines):       │    │
│  │ {                               │    │
│  │   "meta": {                     │    │
│  │     "generator": "Miniscript...│    │
│  │ ...                             │    │
│  └─────────────────────────────────┘    │
│                                         │
│  [📋 Copy to Clipboard] [💾 Download JSON]│
│                            [Cancel]     │
└─────────────────────────────────────────┘
```

**Key UX decisions**:
- **Default to current context only** - most users want what they just compiled
- **Show preview** - builds confidence before export
- **Two export options** - clipboard for quick paste, download for files
- **Remember preferences** - store last choices in localStorage

#### Filename Convention

When downloading, suggest a descriptive filename:
```
miniscript-testvector-thresh-2-of-3-segwit-2026-01-14.json
```

Pattern: `miniscript-testvector-{policy-summary}-{context}-{date}.json`

#### Success Feedback

After export:
- Toast: "✅ Test vector copied to clipboard" or "✅ Downloaded testvector.json"
- Don't close modal automatically - let user export both ways if needed

#### Edge Cases

1. **No compilation yet**: Button disabled with tooltip "Compile first to generate test vector"
2. **Compilation error**: Button hidden or disabled
3. **Very large output**: Warn if JSON > 1MB, offer minified only

#### Alternative: Keyboard Shortcut

For power users: `Ctrl+Shift+T` to export test vector (after compilation)
