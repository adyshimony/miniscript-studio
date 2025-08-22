MINISCRIPT COMPILER PROJECT - SESSION GUIDE (UPDATED)

  🏗️ Project Structure

  /home/adys-x1/Sources/miniscript-compiler/
  ├── miniscript/
  │   ├── index.html          # Main UI file - work here
  │   ├── script.js           # Main JavaScript - work here
  │   └── pkg/               # WASM files
  ├── script.js              # ROOT COPY - deployment needs this
  ├── index.html             # ROOT COPY - deployment needs this
  └── src/                   # Rust source

  🚨 CRITICAL DEPLOYMENT RULE

  ALWAYS copy files to root after changes:
  cp miniscript/script.js script.js
  cp miniscript/index.html index.html  # if HTML changed
  Deployment breaks without root copies!

  🔧 WASM BUILD COMMAND

  ⚠️ IMPORTANT: ONLY USER RUNS WASM BUILD - NOT CLAUDE ⚠️

  After ANY Rust changes in src/, USER must run:
  wasm-pack build --target web
  cp -r pkg/* miniscript/pkg/

  Claude should TELL user when to run WASM build, never run it directly.
  This builds the WASM module that powers the compiler. Without running this,
  Rust changes won't take effect in the browser!

  📝 Code Architecture

  Duplicate JavaScript Functions
  - script.js has DUPLICATE functions that override HTML definitions
  - When adding descriptions, update BOTH locations in script.js:
    - Line ~2279: window.showPolicyDescription
    - Line ~2625: window.showPolicyDescription (second copy)
    - Line ~2392: window.showMiniscriptDescription
    - Line ~2737: window.showMiniscriptDescription (second copy)

  Example Button Structure
  - Policy buttons: onclick="showPolicyDescription('id'); 
  loadPolicyExample('code')"
  - Miniscript buttons: onclick="showMiniscriptDescription('id'); 
  loadExample('code')"

  Description Object Structure

  Policy descriptions need:
  'id': {
      title: '📄 Title',
      conditions: '🔓 Spending conditions',
      useCase: 'When to use this',
      security: '💡 Security notes'
  }

  Miniscript descriptions need:
  'id': {
      title: '⚙️ Title',
      structure: 'miniscript → explanation',
      bitcoinScript: 'How it compiles',
      useCase: 'When to use this',
      technical: '💡 Technical notes'
  }

  ⚠️ Common Syntax Issues
  - NO unescaped apostrophes in strings: Alice's breaks JavaScript
  - Use: Alice or Alice\\'s or avoid apostrophes entirely
  - Always check for syntax errors in browser console

  🚀 LIFT FUNCTIONALITY (FIXED!)

  What it does:
  - Lift button (⬆️) in ASM script editor
  - Converts Bitcoin scripts to Miniscript and Policy
  - Supports both hex and ASM formats
  - NO MORE auto-cleaning! Now works with pushbytes intact

  Current Implementation:
  // In src/lib.rs
  #[wasm_bindgen]
  pub fn lift_to_miniscript(bitcoin_script: &str) -> JsValue
  #[wasm_bindgen]
  pub fn lift_to_policy(miniscript: &str) -> JsValue

  // Fixed ASM parser properly handles OP_PUSHBYTES_X followed by hex data
  // Supports all major opcodes including:
  // OP_PUSHNUM_0-16, OP_CSV, OP_CLTV, OP_IFDUP, OP_PUSHBYTES_*, etc.

  JavaScript Changes:
  // NO MORE auto-cleaning! Sends ASM with pushbytes intact:
  const miniscriptResult = lift_to_miniscript(asmScript);

  Enhanced Error Reporting:
  - Now shows specific rust-miniscript library errors for each context
  - Format: "Cannot lift... Errors: Legacy: [error]; Segwit: [error];
  Taproot: [error]"
  - Better console logging for debugging lift operations

  User Experience:
  1. User compiles policy/miniscript → gets ASM output
  2. User can edit the ASM script manually
  3. User clicks lift button (⬆️) to reverse-engineer back to
  Miniscript/Policy
  4. Auto-cleaning: pushbytes are automatically cleaned before lift (display
  unchanged)
  5. Better errors: Shows detailed miniscript library errors

  Supported Opcodes:
  - Numbers: OP_0-OP_16, OP_PUSHNUM_0-OP_PUSHNUM_16
  - Hashing: OP_DUP, OP_HASH160, OP_SHA256, OP_RIPEMD160
  - Verification: OP_EQUAL, OP_EQUALVERIFY, OP_CHECKSIG, OP_CHECKSIGVERIFY
  - Timelocks: OP_CHECKLOCKTIMEVERIFY/OP_CLTV, OP_CHECKSEQUENCEVERIFY/OP_CSV
  - Control: OP_IF, OP_ELSE, OP_ENDIF, OP_VERIFY, OP_RETURN
  - Stack: OP_SIZE, OP_SWAP, OP_DROP, OP_IFDUP, etc.
  - Data: OP_PUSHBYTES_* (0-75), hex data detection

  🔄 Typical Workflow

  1. Edit miniscript/index.html or miniscript/script.js
  2. Test changes locally
  3. For Rust changes: wasm-pack build --target web
  4. MANDATORY: cp miniscript/script.js script.js
  5. If HTML changed: cp miniscript/index.html index.html
  6. Verify deployment works

  🎯 Current State (Updated)

  ✅ Policy Examples: All have descriptions (single, or, and, threshold,
  timelock, xonly, testnet_xpub, corporate, recovery, twofa, hodl,
  timelocked_thresh, inheritance, delayed)

  ✅ Miniscript Examples: All have descriptions (pkh, wrap, or_i, complex,
  timelock, after, multisig, recovery, hash, inheritance, delayed, htlc_time,
   htlc_hash, full_descriptor, range_descriptor, vault_complex)

  ✅ JavaScript: Syntax errors fixed, all descriptions working

  ✅ Lift Functionality (ENHANCED):
  - Lift button implemented and working
  - Rust functions exported to WASM
  - JavaScript handlers connected
  - NEW: Comprehensive ASM parsing (not just hex)
  - NEW: Auto-cleaning with existing simplifyAsm()
  - NEW: Detailed error reporting from rust-miniscript
  - NEW: Support for all major Bitcoin opcodes

  ✅ Key Names Enhancement:
  - When compiling policy, miniscript result automatically shows variable names
  - Toggle button automatically set to "Hide Key Names" state after compilation

  🐛 Debugging

  - Check browser console for JavaScript errors
  - Verify descriptions exist in both script.js function locations
  - Check for unescaped quotes/apostrophes
  - Ensure root files are up to date
  - For lift issues: Check WASM build succeeded
  - NEW: Check browser console for detailed lift error messages
  - NEW: Verify unsupported opcodes in ASM parser error messages

  🔧 Development Notes

  - WASM Build: Required after ANY Rust changes: wasm-pack build --target web
  - ASM Parsing: Fully implemented with comprehensive opcode support
  - Error Handling: Lift functions try Legacy → Segwit → Taproot contexts
  with detailed errors
  - Script Types: Both hex and ASM support working
  - Auto-cleaning: JavaScript automatically cleans pushbytes before sending
  to Rust
  - Display unchanged: Cleaning happens behind the scenes, UI shows original

  Dependencies:
  # Current working set - no bitcoin-explorer (WASM incompatible)
  bitcoin = "0.32"
  miniscript = { version = "12.0", features = ["compiler", "std"] }

  Recent Fixes (Latest Session):
  - ✅ FIXED: ASM parser now correctly handles OP_PUSHBYTES_X data sequences
  - ✅ REMOVED: Auto-cleaning before lift (now works with pushbytes intact)
  - ✅ IMPROVED: Better error messages and console logging for lift operations
  - ✅ ENHANCED: ASM script formatting with proper line wrapping and indentation
  - ✅ ADDED: Copy button for Bitcoin script results (👁️ icon for hide pushbytes)
  - ✅ FIXED: Policy compilation now auto-shows key names in miniscript result
  
  📋 PENDING UX IMPROVEMENTS (Next Session Tasks)

  1. **Clear Policy Behavior**
     - Modify clear policy to only clear the policy field, leave miniscript intact

  2. **ASM Script Enhancements** 
     - Add "Show key names" toggle button to ASM script section
     - Make ASM script editor visible before compilation (currently only shows after)

  3. **Key Management Improvements**
     - Auto-generate key variables when user pastes expressions with names (not just raw keys)
     - Detect patterns like `Alice`, `Bob`, etc. in pasted text and suggest key creation

  4. **Error Messages & Tips**
     - Better error message positioning and visibility  
     - Auto-clear error messages when appropriate
     - Update and expand help tips throughout interface

  5. **Address Generation**
     - Add testnet/mainnet selection for address generation

  6. **Repository Separation** 
     - Split into two repos: Miniscript compiler standalone + personal site separate

  ---
  Remember: The user gets frustrated when you forget the copy step, 
  forget the WASM build step, or make things overly complicated! 
  The lift functionality is now robust and provides detailed feedback.
  USER RUNS WASM BUILD - NOT CLAUDE!