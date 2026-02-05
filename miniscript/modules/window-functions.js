/**
 * @module window-functions
 * @description Global window functions for HTML event handlers
 *
 * This module exports all functions to the global window object
 * to maintain compatibility with onclick handlers in the HTML.
 * All 24 window functions are preserved exactly as they were.
 */

import { MiniscriptCompiler } from './compiler-core.js';
import { CONSTANTS } from './constants.js';
import { compile_unified } from '../pkg/miniscript_wasm.js';

// Initialize the compiler
const compiler = new MiniscriptCompiler();

// Make compiler globally available for onclick handlers
window.compiler = compiler;

// Global function for generate key button
window.generateKey = function() {
    console.log('Global generateKey called');
    if (window.compiler && typeof window.compiler.generateKey === 'function') {
        window.compiler.generateKey();
    } else {
        console.error('Compiler or generateKey method not available');
    }
};

// Global function to load examples
window.loadExample = function(example, exampleId, explicitContext) {
    const expressionInput = document.getElementById('expression-input');
    const isMobile = window.innerWidth <= 768;
    
    // Reset taproot mode to default
    window.currentTaprootMode = 'single-leaf';
    
    // Set the content
    expressionInput.textContent = example;
    
    // Store original template and example ID for sharing
    if (exampleId) {
        expressionInput.dataset.originalTemplate = example;
        expressionInput.dataset.exampleId = 'miniscript-' + exampleId;
        
        // Clear policy template data since we're loading a miniscript
        const policyInput = document.getElementById('policy-input');
        if (policyInput) {
            delete policyInput.dataset.originalTemplate;
            delete policyInput.dataset.exampleId;
        }
        
    }
    
    // Clear the "last highlighted text" to force re-highlighting
    delete expressionInput.dataset.lastHighlightedText;
    
    if (window.compiler && window.compiler.highlightMiniscriptSyntax) {
        window.compiler.highlightMiniscriptSyntax(true); // Skip cursor restore when loading examples
    }
    
    // Position cursor at end after highlighting
    if (window.compiler && window.compiler.positionCursorAtEnd) {
        setTimeout(() => {
            window.compiler.positionCursorAtEnd(expressionInput);
            // Blur on mobile to prevent keyboard popup
            if (isMobile) {
                setTimeout(() => expressionInput.blur(), 10);
            }
        }, 600); // After the 500ms delayed highlighting
    }

    // Check if auto-compile is enabled
    const autoCompile = document.getElementById('auto-compile-setting');
    const shouldPreserveResults = autoCompile && autoCompile.checked;

    // Always clear taproot descriptor when loading new examples
    const taprootDescriptor = document.getElementById('taproot-descriptor');
    if (taprootDescriptor) {
        taprootDescriptor.style.display = 'none';
    }

    // Always clear ONLY Taproot Structure when loading new examples (preserve other messages)
    // Targeted removal - only specific Taproot elements, not the entire page!

    // Method 1: Remove .taproot-info class elements only
    const taprootInfos = document.querySelectorAll('.taproot-info');
    taprootInfos.forEach(el => {
        console.log('Removing .taproot-info element');
        el.remove();
    });

    // Method 2: Look for the specific text node containing "🌿 Taproot Structure" and remove its parent
    const miniscriptMessages = document.getElementById('miniscript-messages');
    if (miniscriptMessages) {
        const walker = document.createTreeWalker(
            miniscriptMessages,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        while (node = walker.nextNode()) {
            if (node.nodeValue && node.nodeValue.includes('🌿 Taproot Structure')) {
                // Remove the parent element of this text node
                const parentEl = node.parentElement;
                if (parentEl) {
                    console.log('Removing element containing 🌿 Taproot Structure');
                    parentEl.remove();
                    break;
                }
            }
        }
    }

    // // Method 3: Remove "Taproot Structure:" from policy area only
    // const policyErrors = document.getElementById('policy-errors');
    // if (policyErrors) {
    //     const divs = policyErrors.querySelectorAll('div');
    //     divs.forEach(div => {
    //         if (div.textContent && div.textContent.includes('Taproot Structure:') &&
    //             !div.querySelector('div')) { // Make sure it's a leaf element
    //             // Find the container to remove
    //             let container = div;
    //             while (container.parentElement && container.parentElement.id !== 'policy-errors') {
    //                 container = container.parentElement;
    //                 if (container.style && container.style.marginBottom) {
    //                     console.log('Removing policy Taproot Structure container');
    //                     container.remove();
    //                     break;
    //                 }
    //             }
    //         }
    //     });
    // }

    if (!shouldPreserveResults) {
        // Only clear if auto-compile is disabled
        const resultsDiv = document.getElementById('results');
        if (resultsDiv) resultsDiv.innerHTML = '';
        
        if (window.compiler && window.compiler.initializeEmptyResults) {
            window.compiler.initializeEmptyResults();
        }
        if (window.compiler && window.compiler.clearMiniscriptMessages) {
            window.compiler.clearMiniscriptMessages();
        }
        
        // Clear script fields when loading new miniscript example and restore placeholders
        const scriptHexDisplay = document.getElementById('script-hex-display');
        const scriptAsmDisplay = document.getElementById('script-asm-display');
        if (scriptHexDisplay) {
            scriptHexDisplay.value = '';
            scriptHexDisplay.placeholder = 'Hex script will appear here after compilation, or paste your own and lift it...';
        }
        if (scriptAsmDisplay) {
            scriptAsmDisplay.value = '';
            scriptAsmDisplay.placeholder = 'ASM script will appear here after compilation, or paste your own and lift it...';
        }
        
        // Clear address field and restore placeholder
        const addressDisplay = document.getElementById('address-display');
        if (addressDisplay) {
            addressDisplay.innerHTML = 'Address will appear here after compilation';
            addressDisplay.style.color = 'var(--text-muted)';
            addressDisplay.style.fontStyle = 'italic';
        }
    }
    
    // Update toggle button state based on loaded content
    if (window.compiler && window.compiler.containsKeyNames) {
        const containsKeyNames = window.compiler.containsKeyNames(example);
        const toggleBtn = document.getElementById('key-names-toggle');
        if (toggleBtn) {
            if (containsKeyNames) {
                toggleBtn.style.color = 'var(--success-border)';
                toggleBtn.title = 'Hide key names';
                toggleBtn.dataset.active = 'true';
            } else {
                toggleBtn.style.color = 'var(--text-secondary)';
                toggleBtn.title = 'Show key names';
                toggleBtn.dataset.active = 'false';
            }
        }
    }
    
    // Reset miniscript format button state since loaded content is unformatted
    const formatBtn = document.getElementById('format-miniscript-btn');
    if (formatBtn) {
        formatBtn.style.color = 'var(--text-secondary)';
        formatBtn.title = 'Format expression with indentation';
        formatBtn.dataset.formatted = 'false';
    }
    
    // Use explicit context if provided, otherwise auto-detect
    let context = explicitContext;
    if (!context && window.compiler && window.compiler.detectContextFromExpression) {
        const detectedContext = window.compiler.detectContextFromExpression(example);
        context = detectedContext || 'segwit';
    }
    console.log(`Loading miniscript example: ${example.substring(0, 30)}... | Context: ${context} (explicit: ${explicitContext})`);

    // Set only miniscript context (lower radio buttons)
    if (context) {
        const miniscriptRadio = document.querySelector(`input[name="context"][value="${context}"]`);
        if (miniscriptRadio) {
            miniscriptRadio.checked = true;
            console.log(`✓ Set miniscript context to: ${context}`);
        } else {
            console.log(`✗ Could not find miniscript radio for: ${context}`);
        }
    } else {
        console.log('Context detection not available or compiler not ready');
    }
    
    // Reset the "Show key names" checkbox
    const checkbox = document.getElementById('replace-keys-checkbox');
    if (checkbox) {
        checkbox.checked = false;
    }
    
    // Auto-compile if enabled
    autoCompileIfEnabled('miniscript');
};

// Global function to load policy examples
window.loadPolicyExample = function(example, exampleId, explicitContext) {
    console.log('🚀 loadPolicyExample (from script.js) called with:', example, exampleId, explicitContext);

    const policyInput = document.getElementById('policy-input');
    const isMobile = window.innerWidth <= 768;

    // Clear policyLifted flag when loading an example
    if (window.compiler) {
        window.compiler.policyLifted = false;
    }

    // Reset taproot mode to default
    window.currentTaprootMode = 'single-leaf';
    
    // Set the content
    policyInput.textContent = example;
    
    // Store original template and example ID for sharing
    if (exampleId) {
        policyInput.dataset.originalTemplate = example;
        policyInput.dataset.exampleId = 'policy-' + exampleId;
    }
    
    if (isMobile) {
        // Mobile approach - focus, position cursor at end, then blur to prevent keyboard
        policyInput.focus();
        const range = document.createRange();
        const sel = window.getSelection();
        sel.removeAllRanges();
        range.selectNodeContents(policyInput);
        range.collapse(false);
        sel.addRange(range);
        setTimeout(() => policyInput.blur(), 0);
    } else {
        // Desktop - focus and position cursor at end
        policyInput.focus();
        const range = document.createRange();
        const sel = window.getSelection();
        sel.removeAllRanges();
        range.selectNodeContents(policyInput);
        range.collapse(false);
        sel.addRange(range);
    }
    
    // Clear the "last highlighted text" to force re-highlighting
    delete policyInput.dataset.lastHighlightedText;
    
    // Check if auto-compile is enabled
    const autoCompile = document.getElementById('auto-compile-setting');
    const shouldPreserveResults = autoCompile && autoCompile.checked;
    
    if (!shouldPreserveResults) {
        // Only clear if auto-compile is disabled
        document.getElementById('policy-errors').innerHTML = '';
    }
    
    if (window.compiler && window.compiler.highlightPolicySyntax) {
        window.compiler.highlightPolicySyntax();
    }
    
    // SAVE STATE FOR UNDO
    if (window.compiler && window.compiler.saveState) {
        console.log('🚀 Saving policy state for undo');
        window.compiler.saveState('policy', true);
        console.log('🚀 State saved successfully');
    } else {
        console.log('🚀 Compiler or saveState not available');
    }
    
    // Update policy toggle button state based on loaded content
    if (window.compiler && window.compiler.containsKeyNames) {
        const containsKeyNames = window.compiler.containsKeyNames(example);
        const policyToggleBtn = document.getElementById('policy-key-names-toggle');
        if (policyToggleBtn) {
            if (containsKeyNames) {
                policyToggleBtn.style.color = 'var(--success-border)';
                policyToggleBtn.title = 'Hide key names';
                policyToggleBtn.dataset.active = 'true';
            } else {
                policyToggleBtn.style.color = 'var(--text-secondary)';
                policyToggleBtn.title = 'Show key names';
                policyToggleBtn.dataset.active = 'false';
            }
        }
    }
    
    // Reset policy format button state since loaded content is unformatted
    const policyFormatBtn = document.getElementById('policy-format-toggle');
    if (policyFormatBtn) {
        policyFormatBtn.style.color = 'var(--text-secondary)';
        policyFormatBtn.title = 'Format expression with indentation';
        policyFormatBtn.dataset.formatted = 'false';
    }
    
    // Use explicit context if provided, otherwise auto-detect
    let context = explicitContext;
    if (!context && window.compiler && window.compiler.detectContextFromExpression) {
        const detectedContext = window.compiler.detectContextFromExpression(example);
        context = detectedContext || 'segwit';
    }
    console.log(`Loading policy example: ${example.substring(0, 30)}... | Context: ${context} (explicit: ${explicitContext})`);

    // Set both policy and miniscript context
    if (context) {
        const policyRadio = document.querySelector(`input[name="policy-context"][value="${context}"]`);
        if (policyRadio) {
            policyRadio.checked = true;
            console.log(`✓ Set policy context to: ${context}`);
        } else {
            console.log(`✗ Could not find policy radio for: ${context}`);
        }
        
        const miniscriptRadio = document.querySelector(`input[name="context"][value="${context}"]`);
        if (miniscriptRadio) {
            miniscriptRadio.checked = true;
            console.log(`✓ Set miniscript context to: ${context}`);
        } else {
            console.log(`✗ Could not find miniscript radio for: ${context}`);
        }
    } else {
        console.log('Policy context detection not available or compiler not ready');
    }
    
    // Reset the "Show key names" checkbox since we cleared the miniscript
    const checkbox = document.getElementById('replace-keys-checkbox');
    if (checkbox) {
        checkbox.checked = false;
    }
    
    // Auto-compile if enabled
    autoCompileIfEnabled('policy');
};


// Global function to handle replace keys checkbox
// Global function for miniscript toggle button
window.toggleKeyNames = function() {
    const button = document.getElementById('key-names-toggle');
    const isCurrentlyShowing = button.dataset.active === 'true';
    const newState = !isCurrentlyShowing;
    
    // Update button visual state
    if (newState) {
        button.style.color = 'var(--success-border)';
        button.title = 'Hide key names';
        button.dataset.active = 'true';
    } else {
        button.style.color = 'var(--text-secondary)';
        button.title = 'Show key names';
        button.dataset.active = 'false';
    }
    
    // Call the actual toggle logic
    if (window.compiler && typeof window.compiler.handleReplaceKeysToggle === 'function') {
        window.compiler.handleReplaceKeysToggle(newState);
    } else {
        console.error('Compiler or handleReplaceKeysToggle method not available');
    }
};

// Global function for policy toggle button
window.togglePolicyKeyNames = function() {
    const button = document.getElementById('policy-key-names-toggle');
    const isCurrentlyShowing = button.dataset.active === 'true';
    const newState = !isCurrentlyShowing;
    
    // Update button visual state
    if (newState) {
        button.style.color = 'var(--success-border)';
        button.title = 'Hide key names';
        button.dataset.active = 'true';
    } else {
        button.style.color = 'var(--text-secondary)';
        button.title = 'Show key names';
        button.dataset.active = 'false';
    }
    
    // Call the actual policy toggle logic
    if (window.compiler && typeof window.compiler.handlePolicyReplaceKeysToggle === 'function') {
        window.compiler.handlePolicyReplaceKeysToggle(newState);
    } else {
        console.error('Compiler or handlePolicyReplaceKeysToggle method not available');
    }
};

window.handleReplaceKeysChange = function(isChecked) {
    console.log('Global handleReplaceKeysChange called with:', isChecked);
    if (window.compiler && typeof window.compiler.handleReplaceKeysToggle === 'function') {
        window.compiler.handleReplaceKeysToggle(isChecked);
    } else {
        console.error('Compiler or handleReplaceKeysToggle method not available');
    }
};

// Make description functions globally available
window.showPolicyDescription = function(exampleId) {
    // Check if descriptions are disabled
    if (localStorage.getItem('showDescriptions') === 'false') {
        return;
    }
    
    const panel = document.getElementById('policy-description');
    const contentDiv = panel.querySelector('.description-content');
    
    const descriptions = {
        'single': {
            title: '📄 Single Key Policy - Direct Ownership',
            conditions: '🔓 Alice: Immediate spending (no restrictions)',
            useCase: 'Personal wallet with single owner. Simple and efficient for individual use. Compiles to basic pk(key) in miniscript.',
            security: '⚠️ Single point of failure - if Alice loses her key, funds are lost. Most efficient option: ~72 bytes witness data in SegWit, ~64 bytes in Taproot.'
        },
        'or': {
            title: '📄 OR Keys Policy - Either Party Access',
            conditions: '🔓 Alice: Can spend immediately\n🔓 Bob: Can spend immediately (independent access)',
            useCase: '**Shared Access Wallet:** Either person can spend independently. Common for couples, business partners, or backup access scenarios. Think "joint checking account" where either person can write checks.',
            examples: '💡 **Real-world examples:** Joint family account, business petty cash, emergency fund shared between spouses, backup key for solo traders',
            efficiency: '⚡ **Efficiency:** Slightly larger than single key (~105 bytes witness in SegWit). Spender chooses which key to use, so no coordination needed.',
            security: '⚠️ **Security trade-offs:** Weakest-link security - compromise of ANY key results in fund loss. However, provides redundancy against key loss (lose one, still have the other).',
            bestFor: '✅ **Best for:** Trusted partnerships, backup access, situations where convenience matters more than maximum security, emergency access scenarios'
        },
        'and': {
            title: '📄 AND Keys Policy - Dual Authorization',
            conditions: '🔓 Alice + Bob: Both signatures required (no unilateral spending)',
            useCase: '**2-of-2 Multisig:** Both parties must agree to every transaction. Perfect for business partnerships, joint investments, or married couples who want shared financial control. Like requiring two signatures on a check.',
            examples: '💡 **Real-world examples:** Business partnership funds, joint investment account, high-value couple\'s savings, parent-child shared control, corporate treasury requiring dual approval',
            efficiency: '⚡ **Efficiency:** ~144 bytes witness data in SegWit (two signatures). Requires coordination between parties for every transaction, but maximum security.',
            security: '✅ **Security benefits:** Strongest security - requires compromise of BOTH keys to steal funds. Protects against single key compromise, impulsive spending, and unauthorized transactions.',
            bestFor: '✅ **Best for:** High-value storage, business partnerships, situations requiring mutual consent, protection against single-person compromise or coercion'
        },
        'threshold': {
            title: '📄 2-of-3 Threshold Policy - Majority Consensus',
            conditions: '🔓 Any 2 of: Alice, Bob, Charlie (flexible majority control)',
            useCase: '**Majority Multisig:** Any 2 out of 3 parties can approve transactions. Perfect for small boards, family trusts, or adding redundancy while maintaining control. Like corporate voting where majority wins.',
            examples: '💡 **Real-world examples:** Board of directors treasury, family trust with multiple trustees, business with 3 partners, estate planning with beneficiaries, crypto startup founder funds',
            efficiency: '⚡ **Efficiency:** Variable witness size depending on which 2 keys sign (~180-185 bytes in SegWit, varies by which 2 signatures are used). Good balance of security and usability.',
            security: '✅ **Security benefits:** Survives 1 key loss or compromise. Prevents single-person control while allowing majority decisions. More resilient than 2-of-2 but less than single key.',
            bestFor: '✅ **Best for:** Small group control, estate planning, business partnerships with 3+ people, backup scenarios where 1 key might be lost, decision-making that benefits from consensus'
        },
        'timelock': {
            title: '📄 Timelock Policy - Immediate vs Delayed Access',
            conditions: '🔓 Alice: Immediate spending (instant access)\n⏰ Bob: After 144 blocks (~1 day) delay',
            useCase: '**Emergency Recovery with Cooling Period:** Alice has daily control, Bob can recover funds but must wait. Prevents rushed decisions and provides time for Alice to intervene if needed. Like a bank account with both owner access and emergency power of attorney.',
            examples: '💡 **Real-world examples:** Personal wallet with family backup, business owner with partner recovery, elderly parent with adult child backup, trader with emergency contact access',
            efficiency: '⚡ **Efficiency:** Alice\'s path in SegWit (~72 bytes), Bob\'s path is larger (~105 bytes) due to timelock verification.',
            security: '✅ **Security benefits:** Alice retains full control while providing recovery option. 24-hour delay gives Alice time to move funds if Bob\'s key is compromised. Prevents immediate theft through Bob\'s key.',
            bestFor: '✅ **Best for:** Personal wallets needing backup, elderly users with trusted family, business continuity planning, any scenario where primary user wants emergency recovery with built-in warning time'
        },
        'alice_or_bob_timelock': {
            title: '📄 Alice or (Bob + 1 Day) Policy - Simple Recovery Pattern',
            conditions: '🔓 Alice: Immediate spending (instant access)\n⏰ Bob: Can spend after 144 blocks (~1 day) delay',
            useCase: '**Basic Recovery Wallet:** Alice has normal control, Bob can recover funds after waiting 1 day. This or() pattern creates two independent spending paths. Compiles to or_d structure where Alice\'s path uses DUP-IF for efficiency.',
            examples: '💡 **Real-world examples:** Personal wallet with trusted backup, spouse recovery access, business partner emergency key, parent-child shared wallet with safety delay',
            efficiency: '⚡ **Efficiency:** Alice\'s path is optimized in SegWit (~72 bytes). Bob\'s path requires both signature and timelock verification (~105 bytes). The or_d pattern allows Alice\'s path to "consume" the condition immediately.',
            security: '✅ **Security benefits:** Simple two-path design. Alice maintains full daily control. 24-hour delay prevents immediate compromise if Bob\'s key is stolen. Bob cannot spend without waiting the full delay period.',
            bestFor: '✅ **Best for:** Beginners learning timelock concepts, simple backup scenarios, situations requiring straightforward recovery without complex multisig, demonstrating basic or() and older() usage'
        },
        'xonly': {
            title: '📄 Taproot X-only Key - Next-Gen Single Key',
            conditions: '🔓 David: Immediate spending (Taproot/Schnorr context)',
            useCase: '**Modern Single Key:** Uses Taproot\'s X-only public keys (32 bytes vs 33 bytes) with Schnorr signatures. More efficient, more private, and enables advanced scripting. The future of single-key Bitcoin wallets.',
            examples: '💡 **Real-world examples:** Modern hardware wallets, Lightning Network wallets, privacy-focused personal wallets, wallets that might later upgrade to complex scripts',
            efficiency: '⚡ **Efficiency:** Smaller keys (32 vs 33 bytes), smaller signatures (~64 vs ~72 bytes), better batch verification, and identical on-chain appearance regardless of underlying complexity.',
            security: '✅ **Security benefits:** Same security as regular pubkeys but with better privacy (all Taproot outputs look identical). Enables "pay-to-contract" and other advanced features.',
            bestFor: '✅ **Best for:** Modern applications, privacy-conscious users, wallets that might later add complex conditions, Lightning Network, applications requiring batch signature verification'
        },
        'testnet_xpub': {
            title: '📄 Testnet Extended Public Key - HD Wallet Demo',
            conditions: '🔓 TestnetKey: HD wallet extended public key (testnet environment)',
            useCase: '**Hierarchical Deterministic Wallet:** Demonstrates how modern wallets derive multiple addresses from a single seed. The xpub/tpub allows generating receive addresses without exposing private keys. Essential for business accounting and privacy.',
            examples: '💡 **Real-world examples:** Business wallets generating customer payment addresses, exchange deposit systems, accounting software, wallet address generation for e-commerce',
            efficiency: '⚡ **Efficiency:** Same as single key once derived, but enables generating unlimited addresses from one seed. Reduces backup complexity from many keys to one seed.',
            security: '✅ **Security benefits:** Extended public keys can generate addresses without private key exposure. If one address is compromised, others remain secure. Enables "watching-only" wallets for monitoring.',
            bestFor: '✅ **Best for:** Businesses receiving many payments, privacy-conscious users (new address per transaction), development and testing, wallets requiring address pre-generation'
        },
        'corporate': {
            title: '📄 Corporate Wallet Policy - Board + Executive Override',
            conditions: '🔓 Any 2 of: Alice, Bob, Charlie (board majority)\n⏰ Eva (CEO): After January 1, 2026 (time-delayed executive access)',
            useCase: '**Corporate Treasury:** Daily operations require board majority (2-of-3), but CEO gets emergency access after a specific date. Perfect for businesses with board governance but executive emergency powers.',
            examples: '💡 **Real-world examples:** Startup treasury with founder override, nonprofit with board control plus executive director emergency access, family business with multiple decision-makers',
            efficiency: '⚡ **Efficiency:** Board path uses threshold efficiency in SegWit (~180-185 bytes), CEO path adds timelock verification (~105 bytes in SegWit).',
            security: '✅ **Security benefits:** Board control prevents single-person decisions, time-delayed CEO access provides emergency recovery without immediate risk, specific date prevents indefinite executive power.',
            bestFor: '✅ **Best for:** Corporate treasuries, nonprofits, family businesses, any organization needing board control with executive emergency access, succession planning'
        },
        'recovery': {
            title: '📄 Emergency Recovery Policy - Weighted Priority',
            conditions: '🔓 Alice: Immediate spending (95% probability weight - primary path)\n⏰ Bob + Charlie + Eva: 2-of-3 after 1008 blocks (~1 week) emergency consensus',
            useCase: '**Personal Wallet with Family Recovery:** Alice controls daily spending, but family/friends can recover funds if Alice is unavailable for a week. The 95@ weight tells the compiler to optimize for Alice\'s path since it\'s used 95% of the time.',
            examples: '💡 **Real-world examples:** Individual with trusted family backup, solo business owner with partner emergency access, crypto enthusiast with friend/family recovery network, elderly user with adult children backup',
            efficiency: '⚡ **Efficiency:** Alice\'s path is highly optimized due to probability weight (~72 bytes in SegWit). Recovery path is larger in SegWit (~200+ bytes, 2-of-3 threshold plus timelock) but rarely used.',
            security: '✅ **Security benefits:** Alice retains full control, 1-week delay gives Alice time to respond to unauthorized recovery attempts, requires 2-of-3 consensus prevents single family member compromise.',
            bestFor: '✅ **Best for:** Individual wallets with trusted emergency contacts, estate planning, any scenario where primary user wants family backup without compromising daily control'
        },
        'emergency_recovery': {
            title: '📄 Emergency Recovery Policy - 95% Alice Priority',
            conditions: '🔓 Alice: Immediate spending (95@ probability weight - highly optimized)\n⏰ Bob + Charlie + Eva: 2-of-3 consensus after 1008 blocks (~1 week)',
            useCase: '**Weighted Recovery Wallet:** Alice has complete daily control with 95@ probability weighting for maximum efficiency. Family can recover funds through 2-of-3 consensus after 1 week delay. The high weight ratio (95@) tells the compiler Alice\'s path will be used 95% of the time.',
            examples: '💡 **Real-world examples:** Solo trader with family emergency backup, individual crypto holder with trusted recovery network, business owner with partner emergency access, crypto enthusiast with friend circle recovery',
            efficiency: '⚡ **Efficiency:** Alice\'s path is extremely optimized (~72 bytes in SegWit) due to 95@ weight. Recovery path is larger in SegWit (~200+ bytes, 2-of-3 threshold plus timelock). The @ syntax enables compiler optimization based on expected usage.',
            security: '✅ **Security benefits:** Alice maintains full control with no restrictions. 1-week delay provides substantial protection against unauthorized recovery. Requires 2-of-3 family consensus prevents single compromised key from triggering recovery.',
            bestFor: '✅ **Best for:** Advanced users understanding probability weights, scenarios with clear primary user (95% usage), situations requiring family backup without daily interference, demonstrating @ weight syntax optimization'
        },
        'twofa': {
            title: '📄 2FA + Backup Policy - Multi-Factor Security',
            conditions: '🔓 Alice + (Bob + secret OR wait 1 year)',
            useCase: '**Two-Factor Authentication Wallet:** Alice must always sign, plus either Bob (second device/key) with a secret hash, or Alice alone after waiting 1 year. Like 2FA on your crypto wallet - primary key plus second factor, with long-term recovery.',
            examples: '💡 **Real-world examples:** High-security personal wallet, crypto trader with hardware + mobile 2FA, business owner with primary + backup key + secret, paranoid holder with multiple security layers',
            efficiency: '⚡ **Efficiency:** Alice+Bob path in SegWit (~144 bytes for two signatures), Alice+secret path adds hash verification (~170 bytes in SegWit), Alice-alone path after 1 year includes timelock (~105 bytes in SegWit).',
            security: '✅ **Security benefits:** Alice always required prevents device compromise, secret hash prevents Bob device compromise, 1-year delay prevents rushed recovery, multiple security factors.',
            bestFor: '✅ **Best for:** High-value wallets, users comfortable with complexity, scenarios requiring strong 2FA, professional traders, anyone wanting multiple security layers with recovery options'
        },
        'inheritance': {
            title: '📄 Taproot Inheritance Policy - Estate Planning',
            conditions: '🔓 David: Immediate spending (full control while alive)\n⏰ Helen + Ivan + Julia: 2-of-3 after 26280 blocks (~6 months) beneficiary inheritance',
            useCase: '**Digital Estate Planning:** David controls funds normally, but if inactive for 6 months, beneficiaries can inherit with majority consensus. Long delay ensures David can intervene if needed and provides time for proper estate proceedings.',
            examples: '💡 **Real-world examples:** Retirement savings with family inheritance, crypto holder with beneficiaries, business owner with succession plan, elderly user planning estate distribution',
            efficiency: '⚡ **Efficiency:** David\'s path is efficient Taproot (~64 bytes), inheritance path is larger (~200+ bytes) but only used after death/incapacitation.',
            security: '✅ **Security benefits:** 6-month delay prevents premature inheritance claims, 2-of-3 consensus prevents single beneficiary compromise, David maintains full control while active, Taproot privacy.',
            bestFor: '✅ **Best for:** Estate planning, retirement accounts, high-value long-term storage, family wealth transfer, business succession planning, anyone wanting crypto inheritance without trusted third parties'
        },
        'hodl': {
            title: '📄 HODL Wallet Policy - Long-term Savings with Family Backup',
            conditions: '🔓 Alice: Immediate spending (9@ probability weight - optimized for daily use)\n⏰ Bob + Charlie + Eva + Frank: 3-of-4 after 1 year (family consensus for emergency)',
            useCase: '**Long-term Savings with Deterrent:** Alice controls daily spending but faces family oversight for emergency recovery. The 9@ weight optimizes for Alice while the 1-year delay discourages frequent spending and provides substantial family intervention time. Compiles to or_d structure with Alice\'s path prioritized in the DUP-IF pattern.',
            examples: '💡 **Real-world examples:** Retirement savings account, long-term investment fund, addiction recovery wallet with family oversight, high-value HODL strategy with family safety net',
            efficiency: '⚡ **Efficiency:** Alice\'s path is highly optimized in SegWit (~72 bytes) due to 9@ weight, family recovery path is larger in SegWit (~250+ bytes, 3-of-4 threshold plus timelock) but designed for rare use. The @ syntax tells the compiler the probability ratio for optimization.',
            security: '✅ **Security benefits:** Alice maintains control, 1-year delay prevents impulsive family intervention, 3-of-4 consensus prevents single family member compromise, probability weight optimizes for expected usage.',
            bestFor: '✅ **Best for:** Long-term savings, retirement planning, addiction recovery scenarios, high-value HODL strategies, family wealth management, anyone wanting spending deterrents with family backup'
        },
        'timelocked_thresh': {
            title: '📄 Timelocked Multisig Policy - Scheduled Activation',
            conditions: '⏰ Any 2 of: Alice, Bob, Charlie (activated ONLY after January 1, 2026)',
            useCase: '**Scheduled Fund Release:** Funds cannot be spent by anyone until a specific date, then require 2-of-3 consensus. Perfect for vesting schedules, trust fund releases, planned distributions, or any scenario requiring future activation.',
            examples: '💡 **Real-world examples:** Employee vesting schedule, trust fund release to beneficiaries, scheduled charity donations, escrow for future projects, company bonus pool release date',
            efficiency: '⚡ **Efficiency:** All paths require timelock verification plus threshold logic (~200+ bytes in SegWit), but prevents any spending before activation date.',
            security: '✅ **Security benefits:** Absolute prevention of early spending (even with all signatures), requires majority consensus after activation, immutable schedule prevents coercion or impulsive changes.',
            bestFor: '✅ **Best for:** Vesting schedules, trust funds, scheduled distributions, escrow services, any scenario requiring guaranteed future activation with group control, regulatory compliance requiring time delays'
        },
        'multi_branch': {
            title: '📄 Multi-Branch OR Policy - Taproot Key-Path Optimization',
            conditions: '🔓 David: Key-path spending (most efficient - just a signature)\n🔓 Helen: Script-path spending (reveal script + signature)\n🔓 Uma: Script-path spending (reveal script + signature)',
            useCase: '**Taproot Smart Optimization:** This policy demonstrates how Taproot automatically optimizes OR conditions. Instead of 3 script leaves, it creates: David as the internal key (key-path spending) + Helen/Uma as script leaves. David gets the most efficient spending path, while Helen/Uma share the script tree.',
            examples: '💡 **Perfect Optimization:** The compiler chooses David for key-path spending (no script revelation needed) and puts Helen/Uma in the script tree. This is more efficient than forcing all three into script paths. Switch to "Taproot compilation (multi-leaf TapTree)" mode to see the tr(David,{pk(Helen),pk(Uma)}) structure.',
            efficiency: '⚡ **Efficiency:** David spends with just 64 bytes (signature only). Helen/Uma each need ~34 bytes script + 64 bytes signature + control block = ~110 bytes. Key-path spending is the most efficient option in Taproot. Total possible: key-path (64B) vs script-path (~110B).',
            security: '✅ **Security benefits:** David\'s spending reveals no scripts or other participants. Helen/Uma spending only reveals their specific script, not David\'s key or the other person\'s script. Maximum privacy through selective revelation.',
            bestFor: '✅ **Best for:** Scenarios where one party (David) is primary/preferred and others are alternatives, inheritance with preferred heir + backups, business with primary signer + emergency alternatives, demonstrating Taproot\'s intelligent optimization over naive 3-leaf structures'
        },
        'lightning_channel': {
            title: '📄 Lightning Channel Policy - Cooperative vs Dispute Resolution',
            conditions: '🔓 David AND Helen: Cooperative channel close (immediate)\n🔓 DavidTimeout + 1 week: Unilateral close with timelock\n🔓 HelenTimeout + 1 week: Unilateral close with timelock',
            useCase: '**Lightning Network Channels:** This represents a simplified Lightning Network payment channel structure. Both parties can cooperatively close the channel instantly (David AND Helen), or either party can force-close unilaterally after a 1-week dispute resolution period using their timeout keys (DavidTimeout, HelenTimeout). The timelock prevents immediate unilateral closes, giving the other party time to dispute fraud attempts.',
            examples: '💡 **Real-world Lightning:** In actual Lightning channels, this pattern secures bidirectional payment channels. Cooperative closes use the main keys (David, Helen) and are instant and cheap. Unilateral closes use separate timeout keys (DavidTimeout, HelenTimeout) and trigger dispute windows where the other party can publish penalty transactions if fraud is detected. The 1008 block (~1 week) timelock is typical for Lightning dispute resolution.',
            efficiency: '⚡ **Taproot Benefits:** When compiled for Taproot contexts, the cooperative path (David AND Helen) becomes key-path spending - just 64 bytes and maximum privacy. Dispute scenarios using timeout keys (DavidTimeout, HelenTimeout) go to script-path. **Try switching to "Taproot (Key + script path)" context to see this optimization - cooperative closes reveal nothing about the dispute mechanisms!**',
            security: '✅ **Security model:** Cooperative case requires both main signatures (David + Helen - strongest security). Unilateral cases use separate timeout keys (DavidTimeout, HelenTimeout) with built-in delays for dispute resolution. The asymmetric timelock ensures both parties have equal dispute rights - neither can force-close without giving the other party response time.',
            bestFor: '✅ **Best for:** Lightning Network implementations, payment channels, any scenario requiring cooperative-first design with dispute fallbacks, bidirectional payment protocols, demonstrating how Taproot optimizes the "happy path" while keeping complex dispute logic private'
        },
        'inheritance_vault': {
            title: '📄 Inheritance Vault Policy - Long-term Family Wealth Transfer',
            conditions: '🔓 David (Owner): Immediate access anytime\n🔓 2-of-3 Heirs: Access after 6 months (26,280 blocks)\n🔓 Heirs: Uma, VaultXOnly1, VaultXOnly2',
            useCase: '**Family Inheritance Planning:** David maintains full control during his lifetime with immediate spending rights. If David becomes incapacitated or passes away, a 2-of-3 threshold of heirs (Uma, VaultXOnly1, VaultXOnly2) can access the funds after a substantial 6-month waiting period. All keys are X-only format for optimal Taproot usage.',
            examples: '💡 **Estate Planning with X-only Keys:** The 6-month timelock serves multiple purposes: gives David time to recover lost keys, prevents immediate family disputes during emotional periods, allows legal processes to unfold, and ensures David can always override heir attempts during his lifetime. All heir keys (VaultXOnly1, VaultXOnly2) are X-only format, perfect for Taproot scripts.',
            efficiency: '⚡ **Taproot Optimization:** Perfect use case for Taproot! David\'s normal spending uses key-path spending - just 64 bytes, maximum privacy, reveals nothing about heirs or inheritance structure. All keys are X-only format for optimal Taproot efficiency. **Switch to "Taproot (Key + script path)" to see how David\'s key becomes the internal key, with the complex inheritance logic hidden until needed.**',
            security: '✅ **Long-term Security:** 26,280 blocks ≈ 26 weeks provides substantial buffer against attacks, accidents, or family conflicts. David cannot be locked out by heirs. Heirs cannot be disinherited by single key loss (2-of-3 redundancy with Uma, VaultXOnly1, VaultXOnly2). Time delay prevents emotional or fraudulent inheritance attempts.',
            bestFor: '✅ **Best for:** Family wealth preservation with Taproot optimization, estate planning using X-only keys, long-term savings with inheritance provisions, business succession planning, any scenario where immediate control is desired but eventual family access is crucial, showcasing Taproot\'s privacy benefits with proper X-only key usage'
        },
        'atomic_swap': {
            title: '📄 Atomic Swap Policy - Cross-Chain Trading with Hash Preimages',
            conditions: '🔓 Alice: Must provide signature + wait for Bob or timeout\n🔓 Bob + Secret: Can spend by revealing SHA256 preimage\n🔓 Alice + Timeout: Can recover funds after 1 day if Bob doesn\'t claim',
            useCase: '**Cross-Chain Atomic Swaps:** Alice wants to trade Bitcoin for another cryptocurrency with Bob. Alice locks Bitcoin requiring both her signature AND either: Bob provides the secret preimage (completing the swap), or Alice recovers after 1 day timeout. Bob creates a matching contract on the other chain with the same secret hash, enabling trustless cross-chain trading.',
            examples: '💡 **Hash Time-Locked Contracts (HTLCs):** The SHA256 preimage acts as a cryptographic key that unlocks both sides of the trade. When Bob reveals the secret to claim Alice\'s Bitcoin, Alice can use that same secret to claim Bob\'s altcoins. If Bob doesn\'t participate, Alice gets her Bitcoin back after the timeout. No trusted third party needed!',
            efficiency: '⚡ **Segwit Optimization:** This policy works best in Segwit contexts because the SHA256 preimage (32 bytes) goes in the witness data, benefiting from the witness discount. **Compile this in "Segwit v0 (p2WSH)" context for optimal efficiency - the hash preimage only costs 1 WU per byte instead of 4 WU in Legacy contexts.**',
            security: '✅ **Trustless Security:** Alice cannot lose funds (timeout protection). Bob cannot claim without revealing the secret (which Alice can then use on other chains). The 144-block timeout (~1 day) provides sufficient window for Bob to act while preventing indefinite fund lockup. SHA256 ensures cryptographically secure secret revelation.',
            bestFor: '✅ **Best for:** Cross-chain trading, atomic swaps between Bitcoin and altcoins, any protocol requiring cryptographic secret revelation, demonstrating hash-based contracts, trustless exchange mechanisms, showcasing Segwit witness discount benefits for preimage data'
        }
    };
    
    const desc = descriptions[exampleId];
    if (desc) {
        // Update the title
        const titleElement = document.getElementById('policy-title');
        if (titleElement) {
            titleElement.textContent = desc.title;
        }
        
        // Update the content in the collapsible area
        const descContent = document.getElementById('policy-content');
        if (descContent) {
            descContent.innerHTML = `
            <div style="margin-bottom: 8px;">
                <strong style="color: var(--text-color); font-size: 12px;">Spending Conditions:</strong>
                <div style="margin-top: 3px; font-size: 12px; color: var(--secondary-text); white-space: pre-line; font-family: monospace; background: var(--hover-bg); padding: 6px; border-radius: 4px;">${desc.conditions}</div>
            </div>
            <div style="margin-bottom: 8px;">
                <strong style="color: var(--text-color); font-size: 12px;">Use Case & Scenario:</strong>
                <div style="margin-top: 3px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.useCase}</div>
            </div>
            ${desc.examples ? `<div style="margin-bottom: 8px;">
                <div style="margin-top: 3px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.examples}</div>
            </div>` : ''}
            ${desc.efficiency ? `<div style="margin-bottom: 8px;">
                <div style="margin-top: 3px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.efficiency}</div>
            </div>` : ''}
            <div style="margin-bottom: 8px;">
                <strong style="color: var(--text-color); font-size: 12px;">Security Analysis:</strong>
                <div style="margin-top: 3px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.security}</div>
            </div>
            ${desc.bestFor ? `<div>
                <div style="margin-top: 3px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.bestFor}</div>
            </div>` : ''}
        `;
        }
        panel.style.display = 'block';
    }
};

window.showMiniscriptDescription = function(exampleId) {
    // Check if descriptions are disabled
    if (localStorage.getItem('showDescriptions') === 'false') {
        return;
    }
    
    const panel = document.getElementById('miniscript-description');
    const contentDiv = panel.querySelector('.description-content');
    
    const descriptions = {
        'single': {
            title: '⚙️ Single Key Miniscript',
            structure: 'pk(Alice) → Direct public key check',
            bitcoinScript: 'Compiles to: <Alice> CHECKSIG',
            useCase: 'Simplest miniscript - requires a signature from Alice to spend.',
            technical: '💡 Most efficient single-key pattern'
        },
        'and': {
            title: '⚙️ 2-of-2 AND Miniscript',
            structure: 'and_v(v:pk(Alice),pk(Bob)) → Verify Alice, then check Bob',
            bitcoinScript: 'Compiles to: <Alice> CHECKSIGVERIFY <Bob> CHECKSIG',
            useCase: 'Both Alice and Bob must provide signatures. Common for joint accounts or business partnerships.',
            technical: '💡 Uses VERIFY wrapper for efficient sequential checking'
        },
        'or': {
            title: '⚙️ OR Keys Miniscript',
            structure: 'or_b(pk(Alice),s:pk(Bob)) → Boolean OR with stack swap',
            bitcoinScript: 'Compiles to: <Alice> CHECKSIG SWAP <Bob> CHECKSIG BOOLOR',
            useCase: 'Either Alice or Bob can spend. Useful for backup access or shared control.',
            technical: '💡 s: wrapper swaps stack elements for proper evaluation'
        },
        'complex': {
            title: '⚙️ AND/OR: Why and_v + or_b + Wrappers',
            structure: 'and_v(v:pk(Alice),or_b(pk(Bob),s:pk(Charlie))) → Alice AND (Bob OR Charlie)',
            bitcoinScript: '<Alice> CHECKSIGVERIFY <Bob> CHECKSIG SWAP <Charlie> CHECKSIG BOOLOR',
            useCase: 'Alice must always sign, plus either Bob or Charlie. Demonstrates wrapper logic: v: for VERIFY, s: for stack SWAP.',
            technical: '💡 Why these choices? and_v = Alice must be verified first (fail fast). or_b = boolean OR needed for final result. v:pk(Alice) = convert signature to VERIFY (stack efficient). s:pk(Charlie) = SWAP for proper stack order in BOOLOR.'
        },
        'timelock': {
            title: '⚙️ Timelock: Why Double and_v Structure',
            structure: 'and_v(v:pk(Alice),and_v(v:older(144),pk(Bob))) → Alice AND (144 blocks AND Bob)',
            bitcoinScript: '<Alice> CHECKSIGVERIFY 144 CHECKSEQUENCEVERIFY <Bob> CHECKSIG',
            useCase: 'Alice must sign, plus Bob can only sign after 144 blocks (~1 day). Why this structure? Prevents rushed joint decisions.',
            technical: '💡 Double and_v structure: 1) Alice verified first (early failure if missing), 2) Timelock verified before Bob (no signature check if too early), 3) Bob\'s signature checked last. This ordering minimizes wasted computation when conditions aren\'t met.'
        },
        'xonly': {
            title: '⚙️ Taproot X-only Key',
            structure: 'pk(David) → X-only public key (64 chars)',
            bitcoinScript: 'Compiles to Taproot-compatible script using 32-byte keys',
            useCase: 'Demonstrates Taproot X-only public keys for improved efficiency and privacy.',
            technical: '💡 Taproot uses Schnorr signatures with X-only keys'
        },
        'multisig': {
            title: '⚙️ 1-of-3 Multisig Using or_d vs Traditional multi()',
            structure: 'or_d(pk(Alice),or_d(pk(Bob),pk(Charlie))) → Nested OR with DUP-IF pattern',
            bitcoinScript: 'DUP IF <Alice> CHECKSIG ELSE DUP IF <Bob> CHECKSIG ELSE <Charlie> CHECKSIG ENDIF ENDIF',
            useCase: 'Any of three parties can spend. Why or_d instead of multi(1,Alice,Bob,Charlie)? The or_d pattern allows different weight/probability per key and enables more complex nesting, while multi() treats all keys equally.',
            technical: '💡 or_d vs multi() vs or_i: or_d = efficient early exit with DUP-IF pattern, best for unequal probability. multi(1,3) = uses OP_CHECKMULTISIG, equal treatment of keys, slightly larger. or_i = IF-ELSE requires witness to specify branch. For 1-of-N with equal probability, use multi(). For weighted/nested cases, use or_d.'
        },
        'recovery': {
            title: '⚙️ Recovery Wallet Using or_d Logic',
            structure: 'or_d(pk(Alice),and_v(v:pk(Bob),older(1008))) → Alice OR (Bob + 1008 blocks)',
            bitcoinScript: 'DUP IF <Alice> CHECKSIG ELSE <Bob> CHECKSIGVERIFY 1008 CHECKSEQUENCEVERIFY ENDIF',
            useCase: 'Alice has daily control, Bob can recover after ~1 week. Why or_d? Because Alice\'s signature should immediately satisfy the condition without evaluating Bob\'s timelock.',
            technical: '💡 or_d logic: Alice\'s path "consumes" the script (early exit), Bob\'s path only evaluated if Alice fails. This prevents unnecessary timelock evaluation when Alice spends normally. and_v ensures Bob AND timelock both verified.'
        },
        'hash': {
            title: '⚙️ Hash + Timelock: 2FA Pattern with or_d',
            structure: 'and_v(v:pk(Alice),or_d(pk(Bob),and_v(v:hash160(...),older(144))))',
            bitcoinScript: '<Alice> CHECKSIGVERIFY DUP IF <Bob> CHECKSIG ELSE <hash> HASH160 EQUALVERIFY 144 CHECKSEQUENCEVERIFY ENDIF',
            useCase: 'Alice must approve, then either Bob can spend immediately OR secret holder after delay. Why or_d? Bob\'s cooperation path should exit immediately without evaluating hash/timelock.',
            technical: '💡 Two-factor auth pattern: or_d ensures happy case (Alice+Bob) never touches hash computation or timelock. Only when Bob fails to cooperate does script evaluate the secret hash and time constraint. hash160 = RIPEMD160(SHA256(preimage))'
        },
        'inheritance': {
            title: '⚙️ Inheritance (Taproot): Nested or_d for Estate Planning',
            structure: 'and_v(v:pk(David),or_d(pk(Helen),and_v(v:pk(Ivan),older(52560))))',
            bitcoinScript: '<David> CHECKSIGVERIFY DUP IF <Helen> CHECKSIG ELSE <Ivan> CHECKSIGVERIFY 52560 CHECKSEQUENCEVERIFY ENDIF',
            useCase: 'David must approve all spending. Helen can inherit immediately, or Ivan after 1 year. Why this structure? David maintains control while alive, Helen gets priority as primary beneficiary.',
            technical: '💡 Inheritance logic: and_v(v:pk(David),...) ensures David always required. or_d(pk(Helen),...) gives Helen immediate access without timelock evaluation. Ivan\'s path only evaluated if Helen unavailable. 52560 blocks ≈ 1 year provides sufficient time for Helen to claim. Try different Taproot contexts to see how the compiler optimizes this structure.'
        },
        'liquid_federation': {
            title: '⚙️ Liquid Federation (Taproot): Real-world Byzantine Fault Tolerance',
            structure: 'or_d(multi_a(5,Fed1,...,Fed7),and_v(v:multi_a(2,Emergency1,Emergency2,Emergency3),older(4032)))',
            bitcoinScript: 'DUP IF <Fed1> CHECKSIG <Fed2> CHECKSIGADD ... <5> NUMEQUAL ELSE <Emergency1> CHECKSIG <Emergency2> CHECKSIGADD <Emergency3> CHECKSIGADD <2> NUMEQUAL VERIFY 4032 CHECKSEQUENCEVERIFY ENDIF',
            useCase: 'Based on Blockstream Liquid federation. 5-of-7 functionaries control funds normally, but 2-of-3 emergency keys can recover after 28 days if federation fails. Why multi_a? Taproot-specific multisig using CHECKSIGADD for batch validation.',
            technical: '💡 Real production pattern: or_d ensures federation path (5-of-7) tried first - optimal for normal operation. Emergency recovery (2-of-3) only after 4032 blocks (28 days) prevents premature activation. multi_a uses Taproot\'s OP_CHECKSIGADD which accumulates signature validation results: each valid sig adds 1 to counter, then NUMEQUAL checks if threshold reached. This is more efficient than legacy OP_CHECKMULTISIG. Byzantine fault tolerant: survives 2 federation key losses. Try different Taproot contexts to see the script structure variations.'
        },
        'htlc_time': {
            title: '⚙️ Time-based HTLC: or_d for Efficient Cooperation',
            structure: 'and_v(v:pk(Alice),or_d(pk(Bob),and_v(v:hash160(...),older(144))))',
            bitcoinScript: '<Alice> CHECKSIGVERIFY DUP IF <Bob> CHECKSIG ELSE <hash> HASH160 EQUALVERIFY 144 CHECKSEQUENCEVERIFY ENDIF',
            useCase: 'Alice + Bob for normal cooperation, or Alice + hash secret after delay if Bob disappears. Why or_d? Bob\'s cooperation path should exit immediately without evaluating timelock.',
            technical: '💡 HTLC efficiency: or_d means happy case (Alice+Bob) never touches the hash or timelock logic. Only when Bob fails to cooperate does the script evaluate the hash160 and older conditions. This saves gas/fees in the common cooperative case.'
        },
        'htlc_hash': {
            title: '⚙️ Hash-based HTLC: or_d for Different Logic',
            structure: 'or_d(pk(Alice),and_v(v:hash160(...),and_v(v:pk(Bob),older(144))))',
            bitcoinScript: 'DUP IF <Alice> CHECKSIG ELSE <hash> HASH160 EQUALVERIFY <Bob> CHECKSIGVERIFY 144 CHECKSEQUENCEVERIFY ENDIF',
            useCase: 'Alice can claim immediately (refund), or Bob claims with hash preimage after delay. Why or_d? Alice\'s refund shouldn\'t require evaluating Bob\'s complex conditions.',
            technical: '💡 Different HTLC pattern: Alice gets immediate refund path (common in failed payments), Bob must prove hash knowledge AND wait. or_d ensures Alice\'s refund is simple and efficient, while Bob\'s claim requires all three conditions (hash + signature + time).'
        },
        'full_descriptor': {
            title: '⚙️ Full HD Wallet Descriptor with Origin Info',
            structure: 'pk([fingerprint/derivation]xpub.../path/index) → Complete BIP32 descriptor',
            bitcoinScript: 'Derives specific public key from xpub using BIP32 hierarchical deterministic derivation',
            useCase: 'Production wallet descriptor with full metadata: master key fingerprint (C8FE8D4F), hardened derivation path (48h/1h/123h/2h), and specific address index (0/0). Note: The derivation index field won\'t appear for this example because it uses a fixed path (0/0), not a wildcard (*). 💡 Use 🏷️ Hide key names to see the full raw descriptor.',
            technical: '💡 Complete descriptor anatomy: [fingerprint/origin_path]xpub_key/final_path. Fingerprint (8 hex chars) identifies master key. Origin path (48h/1h/123h/2h) shows BIP32 derivation from master to xpub, where h means hardened (BIP44/48/84). Final path (0/0) derives specific key from xpub. This metadata ensures wallet recovery even if software changes.'
        },
        'range_descriptor': {
            title: '⚙️ Multipath Range Descriptor (BIP389)',
            structure: 'pk([fingerprint/path]tpub.../<0;1>/*) → Multiple derivation paths in one descriptor',
            bitcoinScript: 'Single descriptor template that expands to multiple derived public keys for different address types',
            useCase: 'Advanced wallet pattern for generating both change (path 1) and receive (path 0) addresses from one descriptor. When you load this example, the derivation index field appears with an index number field plus a dropdown to select External (uses lower value: 0) or Change (uses higher value: 1). This lets you derive specific addresses from either path. 💡 Use 🏷️ Hide key names to see the full raw descriptor with <0;1>/* syntax.',
            technical: '💡 BIP389 multipath magic: <0;1>/* expands to TWO paths: .../0/* (external/receive addresses) and .../1/* (internal/change addresses). The derivation field shows an index number first, then a path selector dropdown (External/Change). External selects the lower value (0), Change selects the higher value (1), then your index derives the specific address from that path. This reduces descriptor storage by 50% while maintaining full HD wallet functionality. Learn more: https://bips.dev/389/'
        },
        'pkh': {
            title: '⚙️ Pay-to-pubkey-hash',
            structure: 'pkh(Alice) → Hash-based key reference',
            bitcoinScript: 'Compiles to: DUP HASH160 <Alice_hash> EQUALVERIFY CHECKSIG',
            useCase: 'Similar to P2PKH addresses. More private as public key is hidden until spending.',
            technical: '💡 Classic Bitcoin pattern - reveals pubkey only when spending'
        },
        'wrap': {
            title: '⚙️ Wrapped Key Fragment',
            structure: 'c:pk_k(Alice) → Check-wrapper around key fragment',
            bitcoinScript: 'Compiles with CHECKSIG wrapper for type correctness',
            useCase: 'Demonstrates miniscript wrapper system for fragment composition.',
            technical: '💡 c: wrapper converts signature to boolean, pk_k pushes key'
        },
        'or_i': {
            title: '⚙️ OR with If-Else (or_i vs or_d vs or_b)',
            structure: 'or_i(pk(Alice),pk(Bob)) → IF Alice ELSE Bob ENDIF',
            bitcoinScript: 'IF <Alice> CHECKSIG ELSE <Bob> CHECKSIG ENDIF',
            useCase: 'Either Alice or Bob can spend. Why or_i? When you want conditional execution where the spender chooses which branch to execute upfront.',
            technical: '💡 or_i vs others: or_i = spender picks branch (IF/ELSE), or_d = left branch consumes (DUP-IF), or_b = evaluate both then OR (boolean logic). or_i most efficient for simple 2-way choices.'
        },
        'after': {
            title: '⚙️ Absolute Timelock',
            structure: 'and_v(v:pk(Alice),after(1767225600)) → Alice + absolute time',
            bitcoinScript: 'Verifies Alice signature and checks absolute timestamp',
            useCase: 'Alice can only spend after specific date (Jan 1, 2026). Useful for scheduled payments.',
            technical: '💡 Uses CLTV (CheckLockTimeVerify) for absolute time constraints'
        },
        'vault_complex': {
            title: '🏦 Enterprise Multi-Tier Vault System with Range Descriptors',
            structure: 'Nested or_i structure: 5 spending paths from most secure (immediate) to most accessible (2-day delay)',
            bitcoinScript: '🚨 Emergency: VaultKey14+VaultKey19 (immediate) → 📅 Tier 1: VaultKey12 OR 2-of-3 keys (after 2 hours) → 📅 Tier 2: VaultKey16 OR 2-of-3 keys (after 4 hours) → 📅 Tier 3: VaultKey6 OR 2-of-5 keys (after 1 day) → 📅 Final: VaultKey1 OR VaultKey4 (after 2 days)',
            useCase: 'Advanced corporate treasury using range descriptors with graduated security model. Immediate access requires 2 executive keys (VaultKey14+VaultKey19). As time passes, recovery becomes easier but requires waiting longer. Each key uses range descriptors (/<10;11>/*) enabling multiple receive addresses while maintaining spending conditions. Perfect for balancing security vs. accessibility in enterprise custody with HD wallet support.',
            technical: '💡 Why or_i for vault design: Each or_i branch represents a different security/time tradeoff. Spender chooses which path to execute - immediate high security or delayed lower security. The nested structure creates 5 distinct spending conditions with clear priority ordering. Range descriptors allow each spending path to support multiple addresses from the same keys, enabling better privacy and address management without changing the security model.'
        },
        'joint_custody': {
            title: '🔐 3-Key Joint Custody: Negative Control System',
            structure: 'andor(multi(2,jcKey1,jcKey2,jcKey3), or_i(...), and_v(...)) → 4-layer custody with Principal/Agent cooperation',
            bitcoinScript: '🔒 Layer 1: 2-of-3 Principal multi (immediate) → 🕐 Layer 2: Single Agent + timelock (Jan 12, 2026) OR 2-of-3 Agent thresh + earlier timelock (Jan 1, 2026) → ⏰ Layer 3: 2-of-3 Recovery + later timelock (Feb 1, 2026)',
            useCase: 'Sophisticated joint custody with "Negative Control" - funds cannot move without both Principal and Agent layers cooperating. Principal keys (jcKey1-3) provide 2-of-3 multisig control. Agent layer provides oversight with timelocked fallbacks. Recovery layer provides ultimate fallback after longer delays.',
            technical: '💡 Why this structure: andor creates 3 distinct spending paths with different security models. First path (multi) requires 2-of-3 Principal signatures - most secure, immediate access. Second path (or_i) provides Agent oversight with time-based escalation. Third path (and_v) ensures recovery is possible but requires longest wait and 2-of-3 recovery keys. This prevents any single layer from unilaterally moving funds while providing multiple recovery mechanisms.<br><br>📋 Based on Blockstream MINT-005 Template<br><a href="https://github.com/Blockstream/miniscript-templates/blob/main/mint-005.md" target="_blank" style="color: var(--accent-color);">https://github.com/Blockstream/miniscript-templates/blob/main/mint-005.md</a>'
        },
        'liana_wallet': {
            title: '🦎 Liana Wallet: Multi-Tier Recovery Vault',
            structure: 'or_i(and_v(v:thresh(1,...),older(20)),or_i(and_v(v:pkh(...),older(19)),or_d(multi(2,...),and_v(v:pkh(...),older(18))))) → 4-path timelocked recovery system',
            bitcoinScript: '🔒 Path 1: Any 1-of-3 Primary keys after 20 blocks → 🕐 Path 2: Recovery Key after 19 blocks → 💰 Path 3: 2-of-2 Backup multisig (immediate) → ⏰ Path 4: Final Recovery key after 18 blocks',
            useCase: 'Professional Bitcoin custody solution with graduated recovery paths. Liana Wallet implements a sophisticated multi-tier system where different spending conditions become available over time. Primary keys provide flexible 1-of-3 access after short delay, recovery keys activate after medium delay, backup multisig works immediately, and final recovery ensures funds are never lost.',
            technical: '💡 Why this Liana structure: Nested or_i creates 4 distinct spending paths with different security/time tradeoffs. thresh(1,...) allows any single primary key after 20-block cooling period (prevents rushed decisions). Recovery paths activate at different times (19, 18 blocks) providing multiple fallback options. or_d ensures backup multisig can be used immediately without evaluating complex recovery conditions. This design balances security (time delays) with usability (multiple recovery options) and prevents single points of failure.<br><br>📋 Based on Liana Wallet Documentation<br><a href="https://github.com/wizardsardine/liana/blob/master/doc/USAGE.md" target="_blank" style="color: var(--accent-color);">https://github.com/wizardsardine/liana/blob/master/doc/USAGE.md</a>'
        },
        'taproot_multibranch': {
            title: '🌳 Taproot Multi-Branch: or_d + Timelock Optimization',
            structure: 'or_d(pk(Julia),and_v(v:pk(Karl),older(144))) → DUP-IF pattern with timelocked fallback',
            bitcoinScript: 'Taproot Single-leaf: DUP IF <Julia> CHECKSIG ELSE <Karl> CHECKSIGVERIFY 144 CHECKSEQUENCEVERIFY ENDIF<br>Taproot Multi-leaf: Julia gets key-path OR script-leaf, Karl gets separate timelock script-leaf',
            useCase: 'Perfect example of Taproot\'s smart optimization for OR conditions with different complexities. Julia (simple pk) vs Karl (complex pk + timelock). In single-leaf mode, creates traditional or_d logic. In multi-leaf mode, Taproot optimizes by giving Julia both key-path AND script-path options while Karl gets his own timelock script.',
            technical: '💡 Why or_d + Taproot brilliance: or_d uses DUP-IF pattern perfect for unequal branch complexity. Julia\'s simple pk() is optimal for either key-path or script-leaf spending. Karl\'s complex and_v(v:pk,older(144)) requires script revelation anyway. Taproot multi-leaf mode creates: 1) Julia as internal key (key-path spending), 2) Julia pk() as script-leaf, 3) Karl\'s timelock script as separate leaf. Result: Julia gets 2 spending methods (most efficient key-path + backup script-path), Karl gets timelock protection. This demonstrates Taproot\'s ability to optimize mixed complexity conditions. Try different Taproot contexts to see the optimization strategies.'
        },
        'hd_derivation': {
            title: '🗝️ HD Wallet Derivation: BIP32 Wildcard Patterns',
            structure: 'pk([C8FE8D4F/48h/1h/123h/2h]tpub.../1/*) → HD descriptor with derivable wildcard',
            bitcoinScript: 'The 🗝️ Derivation index field automatically appears below the compile button when simple wildcard patterns are detected in the expression',
            useCase: 'Demonstrates HD wallet derivation with BIP32 wildcards. When you load this example, the derivation index field appears automatically below the address field because it uses the /* wildcard pattern. Change the index number (0-2147483647) and click "🔨 Compile" to generate different addresses from the same template.',
            technical: '💡 Derivation field triggers: The field appears for these patterns: /* (simple wildcard), /n/* (fixed branch + wildcard), <0;1>/* (multipath with wildcard - shows path dropdown + index), /n (single fixed level), /n/n (double fixed level). It does NOT appear for: fixed paths like /0/0 or invalid patterns like */*. For multipath patterns, you get both a path selector (External/Change) and index field. The editor expression stays as a template while the success message shows the actual derived descriptor and address.'
        }
    };
    
    const desc = descriptions[exampleId];
    if (desc) {
        // Update the title
        const titleElement = document.getElementById('miniscript-title');
        if (titleElement) {
            titleElement.textContent = desc.title;
        }
        
        // Update the content in the collapsible area
        const descContent = document.getElementById('miniscript-content');
        if (descContent) {
            descContent.innerHTML = `
            <div style="margin-bottom: 10px;">
                <strong style="color: var(--text-color); font-size: 12px;">Structure:</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); line-height: 1.4; font-family: monospace; background: var(--hover-bg); padding: 6px; border-radius: 4px;">${desc.structure}</div>
            </div>
            <div style="margin-bottom: 10px;">
                <strong style="color: var(--text-color); font-size: 12px;">${['hd_derivation', 'full_descriptor', 'range_descriptor'].includes(exampleId) ? 'Editor feature:' : 'Bitcoin Script:'}</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.bitcoinScript}</div>
            </div>
            <div style="margin-bottom: 10px;">
                <strong style="color: var(--text-color); font-size: 12px;">Use Case:</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.useCase}</div>
            </div>
            <div>
                <strong style="color: var(--text-color); font-size: 12px;">Technical Notes:</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.technical}</div>
            </div>
        `;
        }
        panel.style.display = 'block';
    }
};

// Global function to copy miniscript expression
window.copyMiniscriptExpression = function() {
    const expressionInput = document.getElementById('expression-input');
    const expression = expressionInput.textContent.trim();
    
    if (!expression) {
        alert('No expression to copy');
        return;
    }
    
    // Find the button for visual feedback
    const button = event.target.closest('button');
    const originalTitle = button.title;
    
    // Copy to clipboard
    navigator.clipboard.writeText(expression).then(() => {
        // Visual feedback - temporarily change button
        button.textContent = '✅';
        button.title = 'Copied!';
        button.style.color = 'var(--success-border)';
        
        setTimeout(() => {
            button.textContent = '📋';
            button.title = originalTitle;
            button.style.color = 'var(--text-secondary)';
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy:', err);
        // Fallback for older browsers
        expressionInput.select();
        document.execCommand('copy');
        
        // Visual feedback for fallback
        button.textContent = '✅';
        button.title = 'Copied!';
        button.style.color = 'var(--success-border)';
        
        setTimeout(() => {
            button.textContent = '📋';
            button.title = originalTitle;
            button.style.color = 'var(--text-secondary)';
        }, 1500);
    });
};

// Global function to remove extra characters from miniscript expression
window.removeMiniscriptExtraChars = function() {
    const expressionInput = document.getElementById('expression-input');
    const expression = expressionInput.textContent;
    
    if (!expression) {
        return;
    }
    
    // Remove spaces, carriage returns, and newlines
    const cleanedExpression = expression.replace(/[\s\r\n]/g, '');
    
    // Only update if there's actually a change
    if (cleanedExpression === expression) {
        // No changes needed - just show feedback
        const button = event.target.closest('button');
        if (button) {
            const originalText = button.textContent;
            button.textContent = '✅';
            button.title = 'Already clean!';
            setTimeout(() => {
                button.textContent = originalText;
                button.title = 'Remove extra characters';
            }, 1000);
        }
        return;
    }
    
    // Preserve cursor position and update content
    const selection = window.getSelection();
    const cursorPos = selection.rangeCount > 0 ? selection.getRangeAt(0).startOffset : 0;
    
    expressionInput.textContent = cleanedExpression;
    
    // Reset format button state since expression is now cleaned/unformatted
    const formatButton = document.getElementById('format-miniscript-btn');
    if (formatButton) {
        formatButton.style.color = 'var(--text-secondary)';
        formatButton.title = 'Format expression with indentation';
        formatButton.dataset.formatted = 'false';
    }
    
    // Save state for undo
    if (window.compiler && window.compiler.saveState) {
        window.compiler.saveState('miniscript');
    }
    
    // Update syntax highlighting
    if (window.compiler && window.compiler.highlightMiniscriptSyntax) {
        window.compiler.highlightMiniscriptSyntax();
    }
    
    // Restore cursor position
    try {
        const range = document.createRange();
        const textNode = expressionInput.firstChild || expressionInput;
        const newPos = Math.min(cursorPos, cleanedExpression.length);
        range.setStart(textNode, newPos);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    } catch (e) {
        // If restoring cursor fails, just focus
        expressionInput.focus();
    }
    
    // Show feedback
    const button = event.target.closest('button');
    const originalTitle = button.title;
    button.textContent = '✨';
    button.title = 'Cleaned!';
    button.style.color = 'var(--success-border)';
    
    setTimeout(() => {
        button.textContent = '🧹';
        button.title = originalTitle;
        button.style.color = 'var(--text-secondary)';
    }, 1500);
};

// Global function to copy policy expression
window.removePolicyExtraChars = function() {
    const policyInput = document.getElementById('policy-input');
    const policy = policyInput.textContent;
    
    if (!policy) {
        return;
    }
    
    // Remove spaces, carriage returns, and newlines
    const cleanedPolicy = policy.replace(/[\s\r\n]/g, '');
    
    // Only update if there's actually a change
    if (cleanedPolicy === policy) {
        // No changes needed - just show feedback
        const button = event.target.closest('button');
        if (button) {
            const originalText = button.textContent;
            button.textContent = '✅';
            button.title = 'Already clean!';
            setTimeout(() => {
                button.textContent = originalText;
                button.title = 'Remove extra characters';
            }, 1000);
        }
        return;
    }
    
    // Preserve cursor position and update content
    const selection = window.getSelection();
    const cursorPos = selection.rangeCount > 0 ? selection.getRangeAt(0).startOffset : 0;
    
    policyInput.textContent = cleanedPolicy;
    
    // Reset format button state since expression is now cleaned/unformatted
    const formatButton = document.getElementById('policy-format-toggle');
    if (formatButton) {
        formatButton.style.color = 'var(--text-secondary)';
        formatButton.title = 'Format expression with indentation';
        formatButton.dataset.formatted = 'false';
    }
    
    // Save state for undo
    if (window.compiler && window.compiler.saveState) {
        window.compiler.saveState('policy');
    }
    
    // Update syntax highlighting
    if (window.compiler && window.compiler.highlightPolicySyntax) {
        window.compiler.highlightPolicySyntax();
    }
    
    // Restore cursor position
    try {
        const range = document.createRange();
        const textNode = policyInput.firstChild || policyInput;
        const newPos = Math.min(cursorPos, cleanedPolicy.length);
        range.setStart(textNode, newPos);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    } catch (e) {
        // If restoring cursor fails, just focus
        policyInput.focus();
    }
    
    // Show feedback
    const button = event.target.closest('button');
    const originalTitle = button.title;
    button.textContent = '✨';
    button.title = 'Cleaned!';
    button.style.color = 'var(--success-border)';
    
    setTimeout(() => {
        button.textContent = '🧹';
        button.title = originalTitle;
        button.style.color = 'var(--text-secondary)';
    }, 1500);
};

window.copyPolicyExpression = function() {
    const policyInput = document.getElementById('policy-input');
    const policy = policyInput.textContent.trim();
    
    if (!policy) {
        alert('No policy to copy');
        return;
    }
    
    // Find the button for visual feedback
    const button = event.target.closest('button');
    const originalTitle = button.title;
    
    // Copy to clipboard
    navigator.clipboard.writeText(policy).then(() => {
        // Visual feedback - temporarily change button
        button.textContent = '✅';
        button.title = 'Copied!';
        button.style.color = 'var(--success-border)';
        
        setTimeout(() => {
            button.textContent = '📋';
            button.title = originalTitle;
            button.style.color = 'var(--text-secondary)';
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy:', err);
        // Fallback for older browsers
        policyInput.select();
        document.execCommand('copy');
        
        // Visual feedback for fallback
        button.textContent = '✅';
        button.title = 'Copied!';
        button.style.color = 'var(--success-border)';
        
        setTimeout(() => {
            button.textContent = '📋';
            button.title = originalTitle;
            button.style.color = 'var(--text-secondary)';
        }, 1500);
    });
};

window.copyBitcoinScript = function() {
    const scriptDisplay = document.getElementById('script-asm-display');
    
    if (!scriptDisplay) {
        alert('No Bitcoin script to copy');
        return;
    }
    
    const script = scriptDisplay.value.trim();
    
    if (!script) {
        alert('No Bitcoin script to copy');
        return;
    }
    
    // Find the button for visual feedback
    const button = event.target.closest('button');
    const originalTitle = button.title;
    
    // Copy to clipboard
    navigator.clipboard.writeText(script).then(() => {
        // Visual feedback - temporarily change button
        button.textContent = '✅';
        button.title = 'Copied!';
        button.style.color = 'var(--success-border)';
        
        setTimeout(() => {
            button.textContent = '📋';
            button.title = originalTitle;
            button.style.color = 'var(--text-secondary)';
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy:', err);
        // Fallback for older browsers
        scriptDisplay.select();
        document.execCommand('copy');
        
        // Visual feedback for fallback
        button.textContent = '✅';
        button.title = 'Copied!';
        button.style.color = 'var(--success-border)';
        
        setTimeout(() => {
            button.textContent = '📋';
            button.title = originalTitle;
            button.style.color = 'var(--text-secondary)';
        }, 1500);
    });
};

window.togglePolicyFormat = function() {
    if (window.compiler && typeof window.compiler.togglePolicyFormat === 'function') {
        window.compiler.togglePolicyFormat();
    } else {
        console.error('Compiler or togglePolicyFormat method not available');
    }
};

window.liftMiniscriptToPolicy = function() {
    if (window.compiler && typeof window.compiler.liftMiniscriptToPolicy === 'function') {
        window.compiler.liftMiniscriptToPolicy();
    } else {
        console.error('Compiler or liftMiniscriptToPolicy method not available');
    }
};

// Get current key variables for sharing
function getKeyVariables() {
    if (window.compiler && window.compiler.keyVariables) {
        const keyObj = {};
        for (const [name, value] of window.compiler.keyVariables) {
            keyObj[name] = value;
        }
        return keyObj;
    }
    return {};
}

// Get only custom key variables (excluding defaults)
function getCustomKeyVariables() {
    if (window.compiler && window.compiler.keyVariables && window.compiler.defaultVariables) {
        const keyObj = {};
        for (const [name, value] of window.compiler.keyVariables) {
            // Only include if NOT a default variable
            if (!window.compiler.defaultVariables.has(name)) {
                keyObj[name] = value;
            }
        }
        return keyObj;
    }
    return {};
}

// Auto-compile helper function that respects the setting
function autoCompileIfEnabled(type) {
    const autoCompile = document.getElementById('auto-compile-setting');
    if (autoCompile && autoCompile.checked) {
        setTimeout(() => {
            // Set flag to preserve success messages during auto-compile
            if (window.compiler) {
                window.compiler.isAutoCompiling = true;
            }
            
            if (type === 'policy') {
                const compileBtn = document.getElementById('compile-policy-btn');
                if (compileBtn) compileBtn.click();
            } else if (type === 'miniscript') {
                const compileBtn = document.getElementById('compile-btn');
                if (compileBtn) compileBtn.click();
            }
            
            // Reset flag after a short delay
            setTimeout(() => {
                if (window.compiler) {
                    window.compiler.isAutoCompiling = false;
                }
            }, 100);
        }, 500);
    }
}

// Helper function to find matching example for sharing
function findMatchingExample() {
    const policyInput = document.getElementById('policy-input');
    const miniscriptInput = document.getElementById('expression-input');
    
    // Check if current content matches a stored example template
    const policyTemplate = policyInput?.dataset.originalTemplate;
    const policyExampleId = policyInput?.dataset.exampleId;
    const policyCurrentContent = policyInput?.textContent?.trim();
    
    const miniscriptTemplate = miniscriptInput?.dataset.originalTemplate;
    const miniscriptExampleId = miniscriptInput?.dataset.exampleId;
    const miniscriptCurrentContent = miniscriptInput?.textContent?.trim();
    
    // Check if policy content matches its original template (even with keys replaced)
    if (policyTemplate && policyExampleId && policyCurrentContent) {
        // If current content matches the original template, we can share the example ID
        if (policyCurrentContent === policyTemplate) {
            return policyExampleId;
        }
    }
    
    // Check if miniscript content matches its original template (even with keys replaced)
    if (miniscriptTemplate && miniscriptExampleId && miniscriptCurrentContent) {
        // If current content matches the original template, we can share the example ID
        if (miniscriptCurrentContent === miniscriptTemplate) {
            return miniscriptExampleId;
        }
    }
    
    return null; // No matching example found
}

// Share policy expression via URL
window.sharePolicyExpression = function(event) {
    const policyInput = document.getElementById('policy-input');
    const policy = policyInput.textContent.trim();
    
    if (!policy) {
        alert('No policy to share');
        return;
    }
    
    // Check if this matches a known example
    const exampleId = findMatchingExample();
    if (exampleId) {
        // Share as example with animation
        const shareUrl = `${window.location.origin}${window.location.pathname}#example=${exampleId}`;
        
        // Get button for animation
        const button = event.target.closest('button');
        const originalTitle = button.title;
        
        navigator.clipboard.writeText(shareUrl).then(() => {
            console.log('Example URL copied to clipboard:', shareUrl);
            // Visual feedback
            button.textContent = '✅';
            button.title = 'Example link copied!';
            button.style.color = 'var(--success-border)';
            
            setTimeout(() => {
                button.textContent = '🔗';
                button.title = originalTitle;
                button.style.color = 'var(--text-secondary)';
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy to clipboard:', err);
            alert(`Share this URL:\n${shareUrl}`);
        });
        return;
    }
    
    // Get share format setting for full content sharing
    const shareFormat = document.getElementById('share-format-setting').value;
    let shareUrl;

    if (shareFormat === 'json') {
        // JSON format - includes only CUSTOM variables (not defaults)
        const state = {
            policy: policy,
            keys: getCustomKeyVariables() // Changed to get only custom variables
        };
        const jsonString = JSON.stringify(state);
        const encoded = btoa(jsonString); // Base64 encode
        shareUrl = `${window.location.origin}${window.location.pathname}#state=${encoded}`;
    } else if (shareFormat === 'base64') {
        // Base64 format - just the policy, no keys
        const encoded = btoa(policy); // Base64 encode
        shareUrl = `${window.location.origin}${window.location.pathname}#policy64=${encoded}`;
    } else {
        // URL format - just the policy
        const encoded = encodeURIComponent(policy);
        shareUrl = `${window.location.origin}${window.location.pathname}#policy=${encoded}`;
    }
    
    // Debug: log what we're encoding
    console.log('Original policy:', policy);
    console.log('Share format:', shareFormat);
    console.log('Full URL:', shareUrl);
    
    // Find the button for visual feedback
    const button = event.target.closest('button');
    const originalTitle = button.title;
    
    // Copy share URL to clipboard
    navigator.clipboard.writeText(shareUrl).then(() => {
        // Visual feedback
        button.textContent = '✅';
        button.title = 'Share link copied!';
        button.style.color = 'var(--success-border)';
        
        setTimeout(() => {
            button.textContent = '🔗';
            button.title = originalTitle;
            button.style.color = 'var(--text-secondary)';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy share link:', err);
        alert('Failed to copy share link');
    });
};

// Share miniscript expression via URL
window.shareMiniscriptExpression = function(event) {
    const expressionInput = document.getElementById('expression-input');
    const miniscript = expressionInput.textContent.trim();
    
    if (!miniscript) {
        alert('No miniscript to share');
        return;
    }
    
    // Check if this matches a known example
    const exampleId = findMatchingExample();
    if (exampleId) {
        // Share as example with animation
        const shareUrl = `${window.location.origin}${window.location.pathname}#example=${exampleId}`;
        
        // Get button for animation
        const button = event.target.closest('button');
        const originalTitle = button.title;
        
        navigator.clipboard.writeText(shareUrl).then(() => {
            console.log('Example URL copied to clipboard:', shareUrl);
            // Visual feedback
            button.textContent = '✅';
            button.title = 'Example link copied!';
            button.style.color = 'var(--success-border)';
            
            setTimeout(() => {
                button.textContent = '🔗';
                button.title = originalTitle;
                button.style.color = 'var(--text-secondary)';
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy to clipboard:', err);
            alert(`Share this URL:\n${shareUrl}`);
        });
        return;
    }
    
    // Get share format setting
    const shareFormat = document.getElementById('share-format-setting').value;
    let shareUrl;

    if (shareFormat === 'json') {
        // JSON format - includes only CUSTOM variables (not defaults)
        const state = {
            miniscript: miniscript,
            keys: getCustomKeyVariables() // Changed to get only custom variables
        };
        const jsonString = JSON.stringify(state);
        const encoded = btoa(jsonString); // Base64 encode
        shareUrl = `${window.location.origin}${window.location.pathname}#state=${encoded}`;
    } else if (shareFormat === 'base64') {
        // Base64 format - just the miniscript, no keys
        const encoded = btoa(miniscript); // Base64 encode
        shareUrl = `${window.location.origin}${window.location.pathname}#miniscript64=${encoded}`;
    } else {
        // URL format - just the miniscript
        const encoded = encodeURIComponent(miniscript);
        shareUrl = `${window.location.origin}${window.location.pathname}#miniscript=${encoded}`;
    }
    
    // Debug: log what we're encoding
    console.log('Original miniscript:', miniscript);
    console.log('Share format:', shareFormat);
    console.log('Full URL:', shareUrl);
    
    // Find the button for visual feedback
    const button = event.target.closest('button');
    const originalTitle = button.title;
    
    // Copy share URL to clipboard
    navigator.clipboard.writeText(shareUrl).then(() => {
        // Visual feedback
        button.textContent = '✅';
        button.title = 'Share link copied!';
        button.style.color = 'var(--success-border)';
        
        setTimeout(() => {
            button.textContent = '🔗';
            button.title = originalTitle;
            button.style.color = 'var(--text-secondary)';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy share link:', err);
        alert('Failed to copy share link');
    });
};

// Function to update tree display when settings change
function updateTreeDisplay() {
    // Find the last successful compilation result
    const miniscriptMessages = document.getElementById('miniscript-messages');
    if (!miniscriptMessages || !miniscriptMessages.innerHTML.includes('compilation successful')) {
        return; // No successful compilation to update
    }
    
    // Get the current expression from the miniscript input
    const expressionInput = document.getElementById('expression-input');
    const expression = expressionInput ? expressionInput.textContent.trim() : '';
    
    if (!expression || !window.compiler) {
        return;
    }
    
    // Extract the original message text without the tree structure
    const successBox = miniscriptMessages.querySelector('.result-box.success');
    if (!successBox) return;
    
    const messageDiv = successBox.querySelector('div[style*="margin-top: 10px"]');
    if (!messageDiv) return;
    
    // Get text content before any tree structure div
    let messageText = '';
    const childNodes = messageDiv.childNodes;
    for (let node of childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            messageText += node.textContent;
        } else if (node.tagName && node.tagName.toLowerCase() !== 'div') {
            messageText += node.outerHTML;
        } else if (node.tagName === 'BR') {
            messageText += '<br>';
        } else {
            // Stop at the first div (likely the tree structure)
            break;
        }
    }
    
    // Re-render with the extracted message
    if (messageText) {
        window.compiler.showMiniscriptSuccess(messageText, expression);
    }
}

// Load shared content from URL on page load
window.addEventListener('DOMContentLoaded', function() {
    // Initialize key names toggle to show names by default
    const keyNamesToggle = document.getElementById('key-names-toggle');
    const policyKeyNamesToggle = document.getElementById('policy-key-names-toggle');

    if (keyNamesToggle && !keyNamesToggle.dataset.active) {
        keyNamesToggle.dataset.active = 'true';
        keyNamesToggle.style.color = 'var(--success-border)';
        keyNamesToggle.title = 'Hide key names';
    }

    if (policyKeyNamesToggle && !policyKeyNamesToggle.dataset.active) {
        policyKeyNamesToggle.dataset.active = 'true';
        policyKeyNamesToggle.style.color = 'var(--success-border)';
        policyKeyNamesToggle.title = 'Hide key names';
    }

    // Initialize derivation index functionality
    // Disabled old derivation index - now using addDerivationIndexField() in displayResults()
    // if (window.compiler && typeof window.compiler.initDerivationIndex === 'function') {
    //     window.compiler.initDerivationIndex();
    // }
    
    // Handle mobile vs desktop tree display settings
    const isMobile = window.innerWidth <= 768 || 
                      /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i.test(navigator.userAgent) ||
                      ('ontouchstart' in window) ||
                      (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
    const treeDisplaySetting = document.getElementById('tree-display-setting');
    const visualHierarchyOption = document.getElementById('visual-hierarchy-option');
    
    console.log('Screen width:', window.innerWidth);
    console.log('User agent:', navigator.userAgent);
    console.log('Touch support:', 'ontouchstart' in window);
    console.log('Mobile detected:', isMobile);
    
    if (isMobile) {
        // Hide the entire tree display setting on mobile and force Script Compilation
        const treeSettingItem = treeDisplaySetting ? treeDisplaySetting.closest('.setting-item') : null;
        if (treeSettingItem) {
            treeSettingItem.style.display = 'none';
        }
        if (treeDisplaySetting) {
            treeDisplaySetting.value = 'script-compilation';
        }
        console.log('Mobile detected - hiding tree settings, using script-compilation');
    } else {
        // Set Visual Hierarchy as default on desktop
        if (treeDisplaySetting) {
            treeDisplaySetting.value = 'visual-hierarchy';
        }
        console.log('Desktop detected - using visual-hierarchy');
    }
    
    // Add event listener to update tree display when setting changes
    if (treeDisplaySetting) {
        treeDisplaySetting.addEventListener('change', function() {
            updateTreeDisplay();
        });
    }
    
    // Parse hash fragment
    const hash = window.location.hash.substring(1); // Remove the #
    
    // Check if it's a JSON state or regular URL parameters
    if (hash.startsWith('state=')) {
        // JSON format with base64 encoded state
        const encoded = hash.substring(6); // Remove 'state='
        try {
            const jsonString = atob(encoded); // Base64 decode
            const state = JSON.parse(jsonString);
            
            console.log('Loaded JSON state:', state);
            
            // Load key variables first
            if (state.keys && window.compiler) {
                for (const [name, value] of Object.entries(state.keys)) {
                    window.compiler.keyVariables.set(name, value);
                }
                // Refresh key variables display
                if (typeof window.loadKeyVariables === 'function') {
                    window.loadKeyVariables();
                }
            }
            
            // Load policy or miniscript
            if (state.policy) {
                const policyInput = document.getElementById('policy-input');
                if (policyInput) {
                    policyInput.textContent = state.policy;
                    console.log('Loaded policy from JSON state');
                    
                    // Apply syntax highlighting for policy
                    if (window.compiler && window.compiler.highlightPolicySyntax) {
                        window.compiler.highlightPolicySyntax();
                    }
                    
                    // Set button state based on content AFTER initialization
                    setTimeout(() => {
                        const policyToggleBtn = document.getElementById('policy-key-names-toggle');
                        if (policyToggleBtn && window.compiler && window.compiler.containsKeyNames) {
                            const containsKeyNames = window.compiler.containsKeyNames(state.policy);
                            if (containsKeyNames) {
                                // Content shows key names (Alice, Bob, etc.) - button should say "Hide"
                                policyToggleBtn.style.color = 'var(--success-border)';
                                policyToggleBtn.title = 'Hide key names';
                                policyToggleBtn.dataset.active = 'true';
                            } else {
                                // Content shows hex keys - button should say "Show"
                                policyToggleBtn.style.color = 'var(--success-border)';
                                policyToggleBtn.title = 'Show key names';
                                policyToggleBtn.dataset.active = 'false';
                            }
                        }
                    }, 150);
                }
            }
            
            if (state.miniscript) {
                const expressionInput = document.getElementById('expression-input');
                if (expressionInput) {
                    expressionInput.textContent = state.miniscript;
                    console.log('Loaded miniscript from JSON state');
                    
                    // Apply syntax highlighting for miniscript
                    if (window.compiler && window.compiler.highlightMiniscriptSyntax) {
                        window.compiler.highlightMiniscriptSyntax();
                    }
                    
                    // Set button state based on content AFTER initialization
                    setTimeout(() => {
                        const toggleBtn = document.getElementById('key-names-toggle');
                        if (toggleBtn && window.compiler && window.compiler.containsKeyNames) {
                            const containsKeyNames = window.compiler.containsKeyNames(state.miniscript);
                            if (containsKeyNames) {
                                // Content shows key names (Alice, Bob, etc.) - button should say "Hide"
                                toggleBtn.style.color = 'var(--success-border)';
                                toggleBtn.title = 'Hide key names';
                                toggleBtn.dataset.active = 'true';
                            } else {
                                // Content shows hex keys - button should say "Show"
                                toggleBtn.style.color = 'var(--success-border)';
                                toggleBtn.title = 'Show key names';
                                toggleBtn.dataset.active = 'false';
                            }
                        }
                    }, 150);
                }
            }
            
            // Auto-compile if setting is enabled
            const autoCompile = document.getElementById('auto-compile-setting');
            if (autoCompile && autoCompile.checked) {
                setTimeout(() => {
                    if (state.policy) {
                        const compileBtn = document.getElementById('compile-policy-btn');
                        if (compileBtn) compileBtn.click();
                    } else if (state.miniscript) {
                        const compileBtn = document.getElementById('compile-btn');
                        if (compileBtn) compileBtn.click();
                    }
                }, 500);
            }
            
        } catch (err) {
            console.error('Failed to parse JSON state:', err);
        }
    } else {
        // URL format with URL parameters
        const params = new URLSearchParams(hash);
        const sharedPolicy = params.get('policy');
        const sharedMiniscript = params.get('miniscript');
        const exampleParam = params.get('example');
        
        if (exampleParam) {
            // Load example by ID
            console.log('Loading example:', exampleParam);
            
            // Map of example IDs to button clicks (complete mapping)
            const exampleMap = {
                // Policy examples
                'policy-single': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('single');
                    if (window.loadPolicyExample) window.loadPolicyExample('pk(Alice)', 'single');
                },
                'policy-or': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('or');
                    if (window.loadPolicyExample) window.loadPolicyExample('or(pk(Alice),pk(Bob))', 'or');
                },
                'policy-and': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('and');
                    if (window.loadPolicyExample) window.loadPolicyExample('and(pk(Alice),pk(Bob))', 'and');
                },
                'policy-threshold': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('threshold');
                    if (window.loadPolicyExample) window.loadPolicyExample('thresh(2,pk(Alice),pk(Bob),pk(Charlie))', 'threshold');
                },
                'policy-alice_or_bob_timelock': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('alice_or_bob_timelock');
                    if (window.loadPolicyExample) window.loadPolicyExample('or(pk(Alice),and(pk(Bob),older(144)))', 'alice_or_bob_timelock');
                },
                'policy-xonly': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('xonly');
                    if (window.loadPolicyExample) window.loadPolicyExample('pk(David)', 'xonly', 'taproot-multi');
                },
                'policy-testnet_xpub': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('testnet_xpub');
                    if (window.loadPolicyExample) window.loadPolicyExample('pk(TestnetKey)', 'testnet_xpub');
                },
                'policy-corporate': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('corporate');
                    if (window.loadPolicyExample) window.loadPolicyExample('or(thresh(2,pk(Alice),pk(Bob),pk(Charlie)),and(pk(Eva),after(1767225600)))', 'corporate');
                },
                'policy-emergency_recovery': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('emergency_recovery');
                    if (window.loadPolicyExample) window.loadPolicyExample('or(95@pk(Alice),and(thresh(2,pk(Bob),pk(Charlie),pk(Eva)),older(1008)))', 'emergency_recovery');
                },
                'policy-twofa': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('twofa');
                    if (window.loadPolicyExample) window.loadPolicyExample('and(pk(Alice),or(and(pk(Bob),hash160(6c60f404f8167a38fc70eaf8aa17ac351023bef8)),older(52560)))', 'twofa');
                },
                'policy-hodl': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('hodl');
                    if (window.loadPolicyExample) window.loadPolicyExample('or(9@pk(Alice),and(thresh(3,pk(Bob),pk(Charlie),pk(Eva),pk(Frank)),older(52560)))', 'hodl');
                },
                'policy-timelocked_thresh': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('timelocked_thresh');
                    if (window.loadPolicyExample) window.loadPolicyExample('and(thresh(2,pk(Alice),pk(Bob),pk(Charlie)),after(1767225600))', 'timelocked_thresh');
                },
                'policy-multi_branch': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('multi_branch');
                    if (window.loadPolicyExample) window.loadPolicyExample('or(pk(David),or(pk(Helen),pk(Uma)))', 'multi_branch', 'taproot-multi');
                },
                'policy-lightning_channel': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('lightning_channel');
                    if (window.loadPolicyExample) window.loadPolicyExample('or(and(pk(David),pk(Helen)),or(and(pk(DavidTimeout),older(1008)),and(pk(HelenTimeout),older(1008))))', 'lightning_channel', 'taproot-multi');
                },
                'policy-inheritance_vault': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('inheritance_vault');
                    if (window.loadPolicyExample) window.loadPolicyExample('or(pk(David),and(thresh(2,pk(Uma),pk(VaultXOnly1),pk(VaultXOnly2)),older(26280)))', 'inheritance_vault', 'taproot-multi');
                },
                'policy-atomic_swap': () => {
                    if (window.showPolicyDescription) window.showPolicyDescription('atomic_swap');
                    if (window.loadPolicyExample) window.loadPolicyExample('and(pk(Alice),or(and(pk(Bob),sha256(2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae)),older(144)))', 'atomic_swap');
                },

                // Miniscript examples
                'miniscript-pkh': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('pkh');
                    if (window.loadExample) window.loadExample('pkh(Alice)', 'pkh');
                },
                'miniscript-wrap': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('wrap');
                    if (window.loadExample) window.loadExample('c:pk_k(Alice)', 'wrap');
                },
                'miniscript-or_i': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('or_i');
                    if (window.loadExample) window.loadExample('or_i(pk(Alice),pk(Bob))', 'or_i');
                },
                'miniscript-complex': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('complex');
                    if (window.loadExample) window.loadExample('and_v(v:pk(Alice),or_b(pk(Bob),s:pk(Charlie)))', 'complex');
                },
                'miniscript-timelock': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('timelock');
                    if (window.loadExample) window.loadExample('and_v(v:pk(Alice),and_v(v:older(144),pk(Bob)))', 'timelock');
                },
                'miniscript-after': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('after');
                    if (window.loadExample) window.loadExample('and_v(v:pk(Alice),after(1767225600))', 'after');
                },
                'miniscript-multisig': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('multisig');
                    if (window.loadExample) window.loadExample('or_d(pk(Alice),or_d(pk(Bob),pk(Charlie)))', 'multisig');
                },
                'miniscript-recovery': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('recovery');
                    if (window.loadExample) window.loadExample('or_d(pk(Alice),and_v(v:pk(Bob),older(1008)))', 'recovery');
                },
                'miniscript-hash': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('hash');
                    if (window.loadExample) window.loadExample('and_v(v:pk(Alice),or_d(pk(Bob),and_v(v:hash160(6c60f404f8167a38fc70eaf8aa17ac351023bef8),older(144))))', 'hash');
                },
                'miniscript-inheritance': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('inheritance');
                    if (window.loadExample) window.loadExample('and_v(v:pk(David),or_d(pk(Helen),and_v(v:pk(Ivan),older(52560))))', 'inheritance', 'taproot-multi');
                },
                'miniscript-htlc_time': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('htlc_time');
                    if (window.loadExample) window.loadExample('and_v(v:pk(Alice),or_d(pk(Bob),and_v(v:hash160(6c60f404f8167a38fc70eaf8aa17ac351023bef8),older(144))))', 'htlc_time');
                },
                'miniscript-htlc_hash': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('htlc_hash');
                    if (window.loadExample) window.loadExample('or_d(pk(Alice),and_v(v:hash160(6c60f404f8167a38fc70eaf8aa17ac351023bef8),and_v(v:pk(Bob),older(144))))', 'htlc_hash');
                },
                'miniscript-joint_custody': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('joint_custody');
                    if (window.loadExample) window.loadExample('andor(multi(2,jcKey1,jcKey2,jcKey3),or_i(and_v(v:pkh(saKey),after(1768176000)),thresh(2,pk(jcAg1),s:pk(jcAg2),s:pk(jcAg3),snl:after(1767225600))),and_v(v:thresh(2,pkh(recKey1),a:pkh(recKey2),a:pkh(recKey3)),after(1769817600)))', 'joint_custody');
                },
                'miniscript-liana_wallet': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('liana_wallet');
                    if (window.loadExample) window.loadExample('or_i(and_v(v:thresh(1,pkh(LianaDesc1),a:pkh(LianaDesc2),a:pkh(LianaDesc3)),older(20)),or_i(and_v(v:pkh(LianaDesc4),older(19)),or_d(multi(2,LianaDesc5,LianaDesc6),and_v(v:pkh(LianaDesc7),older(18)))))', 'liana_wallet');
                },
                'miniscript-full_descriptor': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('full_descriptor');
                    if (window.loadExample) window.loadExample('pk(MainnetKey)', 'full_descriptor');
                },
                'miniscript-range_descriptor': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('range_descriptor');
                    if (window.loadExample) window.loadExample('pk(RangeKey)', 'range_descriptor');
                },
                'miniscript-vault_complex': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('vault_complex');
                    if (window.loadExample) window.loadExample('or_i(or_i(or_i(or_i(and_v(vc:or_i(pk_h(VaultKey1),pk_h(VaultKey4)),after(1753305229)),and_v(or_c(pkh(VaultKey6),v:thresh(2,pkh(VaultKey10),a:pkh(VaultKey15),a:pkh(VaultKey7),a:pkh(VaultKey2),a:pkh(VaultKey5))),after(1753298029))),and_v(or_c(pkh(VaultKey16),v:thresh(2,pkh(VaultKey11),a:pkh(VaultKey17),a:pkh(VaultKey8),a:pkh(VaultKey3))),after(1753290829))),and_v(or_c(pkh(VaultKey12),v:thresh(2,pkh(VaultKey13),a:pkh(VaultKey18),a:pkh(VaultKey9))),after(1753283629))),and_v(v:pk(VaultKey14),pk(VaultKey19)))', 'vault_complex');
                },
                'miniscript-liquid_federation': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('liquid_federation');
                    if (window.loadExample) window.loadExample('or_d(multi_a(5,Fed1,Fed2,Fed3,Fed4,Fed5,Fed6,Fed7),and_v(v:multi_a(2,Emergency1,Emergency2,Emergency3),older(4032)))', 'liquid_federation', 'taproot-multi');
                }
            };
            
            const loadExample = exampleMap[exampleParam];
            if (loadExample) {
                // Wait for compiler to be fully ready before loading example
                const loadWhenReady = () => {
                    loadExample();
                    console.log('Example loaded:', exampleParam);
                };

                // Check if compiler is already ready (has keyVariables loaded)
                if (window.compiler && window.compiler.keyVariables && window.compiler.keyVariables.size > 0) {
                    loadWhenReady();
                } else {
                    // Wait for compilerReady event
                    window.addEventListener('compilerReady', loadWhenReady, { once: true });
                }
            } else {
                console.warn('Unknown example:', exampleParam);
            }
            
        } else if (sharedPolicy) {
            // Load policy from URL - wait for compiler to be ready
            const loadSharedPolicy = () => {
                const policyInput = document.getElementById('policy-input');
                if (policyInput) {
                    policyInput.textContent = decodeURIComponent(sharedPolicy);
                    console.log('Loaded shared policy:', sharedPolicy);

                    // Apply syntax highlighting after setting content
                    if (window.compiler && window.compiler.highlightPolicySyntax) {
                        window.compiler.highlightPolicySyntax();
                    }

                    // Set button state based on content
                    const policyToggleBtn = document.getElementById('policy-key-names-toggle');
                    if (policyToggleBtn && window.compiler && window.compiler.containsKeyNames) {
                        const decodedPolicy = decodeURIComponent(sharedPolicy);
                        const containsKeyNames = window.compiler.containsKeyNames(decodedPolicy);
                        if (containsKeyNames) {
                            policyToggleBtn.style.color = 'var(--success-border)';
                            policyToggleBtn.title = 'Hide key names';
                            policyToggleBtn.dataset.active = 'true';
                        } else {
                            policyToggleBtn.style.color = 'var(--success-border)';
                            policyToggleBtn.title = 'Show key names';
                            policyToggleBtn.dataset.active = 'false';
                        }
                    }

                    // Auto-compile if setting is enabled
                    const autoCompile = document.getElementById('auto-compile-setting');
                    if (autoCompile && autoCompile.checked) {
                        setTimeout(() => {
                            const compileBtn = document.getElementById('compile-policy-btn');
                            if (compileBtn) compileBtn.click();
                        }, 100);
                    }
                }
            };

            if (window.compiler && window.compiler.keyVariables && window.compiler.keyVariables.size > 0) {
                loadSharedPolicy();
            } else {
                window.addEventListener('compilerReady', loadSharedPolicy, { once: true });
            }
        } else if (sharedMiniscript) {
            // Load miniscript from URL - wait for compiler to be ready
            const loadSharedMiniscript = () => {
                const expressionInput = document.getElementById('expression-input');
                if (expressionInput) {
                    expressionInput.textContent = decodeURIComponent(sharedMiniscript);
                    console.log('Loaded shared miniscript:', sharedMiniscript);

                    // Apply syntax highlighting after setting content
                    if (window.compiler && window.compiler.highlightMiniscriptSyntax) {
                        window.compiler.highlightMiniscriptSyntax();
                    }

                    // Set button state based on content
                    const toggleBtn = document.getElementById('key-names-toggle');
                    if (toggleBtn && window.compiler && window.compiler.containsKeyNames) {
                        const decodedMiniscript = decodeURIComponent(sharedMiniscript);
                        const containsKeyNames = window.compiler.containsKeyNames(decodedMiniscript);
                        if (containsKeyNames) {
                            toggleBtn.style.color = 'var(--success-border)';
                            toggleBtn.title = 'Hide key names';
                            toggleBtn.dataset.active = 'true';
                        } else {
                            toggleBtn.style.color = 'var(--success-border)';
                            toggleBtn.title = 'Show key names';
                            toggleBtn.dataset.active = 'false';
                        }
                    }

                    // Auto-compile if setting is enabled
                    const autoCompile = document.getElementById('auto-compile-setting');
                    if (autoCompile && autoCompile.checked) {
                        setTimeout(() => {
                            const compileBtn = document.getElementById('compile-btn');
                            if (compileBtn) compileBtn.click();
                        }, 100);
                    }
                }
            };

            if (window.compiler && window.compiler.keyVariables && window.compiler.keyVariables.size > 0) {
                loadSharedMiniscript();
            } else {
                window.addEventListener('compilerReady', loadSharedMiniscript, { once: true });
            }
        } else if (hash.startsWith('policy64=')) {
            // Base64 encoded policy only (no keys)
            const encoded = hash.substring(9); // Remove 'policy64='
            try {
                const policy = atob(encoded); // Base64 decode
                const policyInput = document.getElementById('policy-input');
                if (policyInput) {
                    policyInput.textContent = policy;
                    console.log('Loaded policy from base64 format');

                    // Apply syntax highlighting
                    if (window.compiler && window.compiler.highlightPolicySyntax) {
                        window.compiler.highlightPolicySyntax();
                    }

                    // Auto-compile if setting is enabled
                    const autoCompile = document.getElementById('auto-compile-setting');
                    if (autoCompile && autoCompile.checked) {
                        setTimeout(() => {
                            const compileBtn = document.getElementById('compile-policy-btn');
                            if (compileBtn) compileBtn.click();
                        }, 500);
                    }
                }
            } catch (e) {
                console.error('Failed to decode base64 policy:', e);
            }
        } else if (hash.startsWith('miniscript64=')) {
            // Base64 encoded miniscript only (no keys)
            const encoded = hash.substring(13); // Remove 'miniscript64='
            try {
                const miniscript = atob(encoded); // Base64 decode
                const expressionInput = document.getElementById('expression-input');
                if (expressionInput) {
                    expressionInput.textContent = miniscript;
                    console.log('Loaded miniscript from base64 format');

                    // Apply syntax highlighting
                    if (window.compiler && window.compiler.highlightMiniscriptSyntax) {
                        window.compiler.highlightMiniscriptSyntax();
                    }

                    // Auto-compile if setting is enabled
                    const autoCompile = document.getElementById('auto-compile-setting');
                    if (autoCompile && autoCompile.checked) {
                        setTimeout(() => {
                            const compileBtn = document.getElementById('compile-btn');
                            if (compileBtn) compileBtn.click();
                        }, 500);
                    }
                }
            } catch (e) {
                console.error('Failed to decode base64 miniscript:', e);
            }
        }
    }
});

// Memory storage for description states
window.descriptionStates = {
    policyCollapsed: false,
    miniscriptCollapsed: false
};

// Helper function to reset description states to default (expanded)
window.resetDescriptionStates = function() {
    // Reset policy description
    const policyContent = document.getElementById('policy-content');
    const policyToggle = document.getElementById('policy-toggle');
    const policyHint = document.getElementById('policy-expand-hint');
    
    if (policyContent && policyToggle) {
        policyContent.style.display = 'block';
        if (policyHint) policyHint.style.display = 'none';
        policyToggle.textContent = '[-]';
        window.descriptionStates.policyCollapsed = false;
    }
    
    // Reset miniscript description
    const miniscriptContent = document.getElementById('miniscript-content');
    const miniscriptToggle = document.getElementById('miniscript-toggle');
    const miniscriptHint = document.getElementById('miniscript-expand-hint');
    
    if (miniscriptContent && miniscriptToggle) {
        miniscriptContent.style.display = 'block';
        if (miniscriptHint) miniscriptHint.style.display = 'none';
        miniscriptToggle.textContent = '[-]';
        window.descriptionStates.miniscriptCollapsed = false;
    }
};

// Policy Description Toggle
window.togglePolicyDescription = function() {
    const content = document.getElementById('policy-content');
    const toggle = document.getElementById('policy-toggle');
    const hint = document.getElementById('policy-expand-hint');
    
    if (content && toggle) {
        const isCollapsed = content.style.display === 'none';
        
        if (isCollapsed) {
            content.style.display = 'block';
            if (hint) hint.style.display = 'none';
            toggle.textContent = '[-]';
            window.descriptionStates.policyCollapsed = false;
        } else {
            content.style.display = 'none';
            if (hint) hint.style.display = 'block';
            toggle.textContent = '[+]';
            window.descriptionStates.policyCollapsed = true;
        }
    }
};

// Miniscript Description Toggle
window.toggleMiniscriptDescription = function() {
    const content = document.getElementById('miniscript-content');
    const toggle = document.getElementById('miniscript-toggle');
    const hint = document.getElementById('miniscript-expand-hint');
    
    if (content && toggle) {
        const isCollapsed = content.style.display === 'none';
        
        if (isCollapsed) {
            content.style.display = 'block';
            if (hint) hint.style.display = 'none';
            toggle.textContent = '[-]';
            window.descriptionStates.miniscriptCollapsed = false;
        } else {
            content.style.display = 'none';
            if (hint) hint.style.display = 'block';
            toggle.textContent = '[+]';
            window.descriptionStates.miniscriptCollapsed = true;
        }
    }
};

// Taproot Mode Switching from Miniscript - REMOVED: Mode selection now handled by Script context radio buttons

// Taproot Mode Switching from Policy - REMOVED: Mode selection now handled by Script context radio buttons

// Branch Loading for Taproot Multi-leaf
window.loadBranchMiniscript = function(miniscript) {
    console.log(`Loading branch miniscript: ${miniscript}`);
    
    // Remove any tr() wrapper if it exists using helper function
    let cleanMiniscript = miniscript;
    if (cleanMiniscript.startsWith('tr(')) {
        const parsed = window.compiler.parseTrDescriptor(cleanMiniscript);
        if (parsed && parsed.treeScript) {
            cleanMiniscript = parsed.treeScript;
        }
    }
    
    const miniscriptInput = document.getElementById('expression-input');
    if (miniscriptInput) {
        miniscriptInput.textContent = cleanMiniscript;
        window.compiler.highlightMiniscriptSyntax(true);
        window.compiler.positionCursorAtEnd(miniscriptInput);
        
        // Don't auto-compile, just load the text for user review
        console.log('Branch loaded. User can manually compile when ready.');
    }
};

// Initialize policy description state (default expanded)
document.addEventListener('DOMContentLoaded', function() {
    const content = document.getElementById('policy-content');
    const toggle = document.getElementById('policy-toggle');
    const hint = document.getElementById('policy-expand-hint');
    
    if (content && toggle) {
        // Always start expanded
        content.style.display = 'block';
        if (hint) hint.style.display = 'none';
        toggle.textContent = '[-]';
        window.descriptionStates.policyCollapsed = false;
    }
});

// Initialize miniscript description state (default expanded)
document.addEventListener('DOMContentLoaded', function() {
    const content = document.getElementById('miniscript-content');
    const toggle = document.getElementById('miniscript-toggle');
    const hint = document.getElementById('miniscript-expand-hint');
    
    if (content && toggle) {
        // Always start expanded
        content.style.display = 'block';
        if (hint) hint.style.display = 'none';
        toggle.textContent = '[-]';
        window.descriptionStates.miniscriptCollapsed = false;
    }
});

// Corner buttons setting handler
document.addEventListener('DOMContentLoaded', function() {
    const hideCornerButtonsSetting = document.getElementById('hide-corner-buttons-setting');
    const beerButton = document.querySelector('a[href*="coinos.io"]');
    const githubButton = document.querySelector('a[href*="github.com"]');
    
    // Load saved setting
    const hideCornerButtons = localStorage.getItem('hideCornerButtons') === 'true';
    if (hideCornerButtonsSetting) {
        hideCornerButtonsSetting.checked = hideCornerButtons;
    }
    
    // Apply initial state
    function updateCornerButtonsVisibility(hide) {
        if (beerButton) beerButton.style.display = hide ? 'none' : 'block';
        if (githubButton) githubButton.style.display = hide ? 'none' : 'block';
    }
    
    updateCornerButtonsVisibility(hideCornerButtons);
    
    // Handle setting changes
    if (hideCornerButtonsSetting) {
        hideCornerButtonsSetting.addEventListener('change', function() {
            const hide = this.checked;
            localStorage.setItem('hideCornerButtons', hide);
            updateCornerButtonsVisibility(hide);
        });
    }
    
    // Synchronize policy context to miniscript context (unidirectional)
    const policyContextRadios = document.querySelectorAll('input[name="policy-context"]');
    const miniscriptContextRadios = document.querySelectorAll('input[name="context"]');
    
    // Function to sync policy context changes to miniscript context
    function syncPolicyToMiniscriptContext() {
        policyContextRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                if (this.checked) {
                    console.log(`Policy context changed: ${this.value} → syncing to miniscript context`);
                    miniscriptContextRadios.forEach(targetRadio => {
                        if (targetRadio.value === this.value) {
                            targetRadio.checked = true;
                        }
                    });
                }
            });
        });
    }
    
    // Set up unidirectional synchronization (policy → miniscript only)
    if (policyContextRadios.length > 0 && miniscriptContextRadios.length > 0) {
        syncPolicyToMiniscriptContext();
        console.log('Unidirectional context synchronization initialized (policy → miniscript)');
    }

    // Add context change listeners to clear Taproot Structure when switching to non-Taproot contexts
    function clearTaprootStructureOnContextChange() {
        const allContextRadios = [...policyContextRadios, ...miniscriptContextRadios];

        allContextRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                if (this.checked) {
                    const isTaprootContext = this.value === 'taproot' || this.value === 'taproot-multi' || this.value === 'taproot-keypath';

                    if (!isTaprootContext) {
                        // Clear Taproot Structure from policy messages area
                        const policyErrorsDiv = document.getElementById('policy-errors');
                        if (policyErrorsDiv) {
                            const taprootElements = policyErrorsDiv.querySelectorAll('*');
                            taprootElements.forEach(element => {
                                if (element.textContent && element.textContent.includes('Taproot Structure:')) {
                                    // Remove the parent div containing the Taproot Structure
                                    let parentToRemove = element;
                                    while (parentToRemove && !parentToRemove.style.marginBottom) {
                                        parentToRemove = parentToRemove.parentElement;
                                    }
                                    if (parentToRemove) {
                                        parentToRemove.remove();
                                    }
                                }
                            });
                        }

                        // Clear 🌿 Taproot Structure from miniscript messages area
                        const miniscriptMessagesDiv = document.getElementById('miniscript-messages');
                        if (miniscriptMessagesDiv) {
                            const taprootInfo = miniscriptMessagesDiv.querySelector('.taproot-info');
                            if (taprootInfo) {
                                taprootInfo.remove();
                            }
                        }

                        console.log(`Context changed to ${this.value}: Cleared any existing Taproot Structure`);
                    }
                }
            });
        });
    }

    // Initialize Taproot Structure clearing
    if (policyContextRadios.length > 0 || miniscriptContextRadios.length > 0) {
        clearTaprootStructureOnContextChange();
        console.log('Taproot Structure clearing on context change initialized');
    }
});

// Global function to toggle miniscript debug info
window.toggleMiniscriptDebugInfo = function(button) {
    const resultBox = button.closest('.result-box');
    if (!resultBox) return;

    // Check if debug info already exists
    let debugDiv = resultBox.querySelector('.debug-info-container');

    if (debugDiv) {
        // Debug info exists, toggle visibility
        if (debugDiv.style.display === 'none') {
            debugDiv.style.display = 'block';
            button.style.backgroundColor = 'var(--success-bg)';
        } else {
            debugDiv.style.display = 'none';
            button.style.backgroundColor = 'transparent';
        }
    } else {
        // Debug info doesn't exist, create it
        button.style.backgroundColor = 'var(--success-bg)';

        // Get the current expression and context to recompile with debug info
        const expressionEditor = document.getElementById('expression-input');
        const expression = expressionEditor ? expressionEditor.textContent.trim() : '';
        const context = document.querySelector('input[name="context"]:checked')?.value || 'legacy';

        if (expression) {
            try {
                // Process the expression the same way as regular compilation
                const cleanedExpression = compiler.cleanExpression(expression);
                const processedExpression = compiler.replaceKeyVariables(cleanedExpression, context);

                // Determine the correct mode, especially for Taproot
                let mode = "Default";
                if (context === 'taproot' || context === 'taproot-multi' || context === 'taproot-keypath') {
                    // Determine mode based on context (same logic as in compileMiniscript)
                    const currentMode = context === 'taproot-keypath' ? 'multi-leaf' :
                                      context === 'taproot-multi' ? 'script-path' :
                                      window.currentTaprootMode || 'single-leaf';
                    mode = currentMode; // Use the mode string directly: 'multi-leaf', 'script-path', or 'single-leaf'
                }

                // Use the NUMS key from compiler's default variables
                const numsKey = compiler.defaultVariables.get('NUMS') || '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';

                // Just recompile with verbose_debug enabled using the same logic as before
                const options = {
                    input_type: "Miniscript",
                    context: context === 'legacy' ? "Legacy" : context === 'segwit' ? "Segwit" : "Taproot",
                    mode: mode,
                    network_str: "bitcoin",
                    nums_key: numsKey,
                    verbose_debug: true
                };

                const result = compile_unified(processedExpression, options);

                if (result.success) {
                    // Store the mode in result for debug info formatting
                    result.taprootMode = mode;

                    // Create debug info container
                    debugDiv = document.createElement('div');
                    debugDiv.className = 'debug-info-container';
                    debugDiv.style.marginTop = '15px';

                    const debugText = compiler.formatDebugInfo(result);
                    debugDiv.innerHTML = `
                        <div style="margin-top: 10px; word-wrap: break-word; word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap; hyphens: none; max-width: 100%; overflow-x: auto; font-size: 13px;">🔍 Debug Info</div>
                        <div class="debug-text-display" style="margin-top: 8px;">
                            <pre>${debugText}</pre>
                        </div>
                    `;

                    // Insert after the last child of result-box
                    resultBox.appendChild(debugDiv);
                } else {
                    console.error('Debug compilation failed:', result.error);
                    button.style.backgroundColor = 'transparent';
                }
            } catch (error) {
                console.error('Failed to compile with debug info:', error);
                button.style.backgroundColor = 'transparent';
            }
        }
    }
};

// ==================== EXPORT FEATURE ====================

/**
 * Open export modal for policy compilation results
 */
window.openPolicyExportModal = function() {
    if (window.compiler && typeof window.compiler.openExportModal === 'function') {
        window.compiler.openExportModal('policy');
    } else {
        console.error('Compiler or openExportModal method not available');
    }
};

/**
 * Open export modal for miniscript compilation results
 */
window.openMiniscriptExportModal = function() {
    if (window.compiler && typeof window.compiler.openExportModal === 'function') {
        window.compiler.openExportModal('miniscript');
    } else {
        console.error('Compiler or openExportModal method not available');
    }
};

// Keyboard shortcut for export (Ctrl+Shift+E)
window.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();

        // Determine which tab is active
        const policyInput = document.getElementById('policy-input');
        const expressionInput = document.getElementById('expression-input');

        // Check if there's a successful compilation
        const policySuccess = document.querySelector('#policy-errors .result-box.success');
        const miniscriptSuccess = document.querySelector('#miniscript-messages .result-box.success, #results .result-box.success');

        if (policySuccess && policyInput?.textContent?.trim()) {
            window.openPolicyExportModal();
        } else if (miniscriptSuccess && expressionInput?.textContent?.trim()) {
            window.openMiniscriptExportModal();
        } else {
            console.log('No successful compilation to export');
        }
    }
});
