import init, { compile_miniscript, compile_policy } from './pkg/miniscript_wasm.js';
// Cache buster - updated 2025-01-18 v2

class MiniscriptCompiler {
    constructor() {
        this.wasm = null;
        this.keyVariables = new Map();
        this.undoStacks = {
            policy: [],
            miniscript: []
        };
        this.redoStacks = {
            policy: [],
            miniscript: []
        };
        this.isUndoing = false;
        this.saveStateTimeouts = {
            policy: null,
            miniscript: null
        };
        this.init();
    }

    async init() {
        try {
            this.wasm = await init();
            console.log('WASM module initialized');
            this.setupEventListeners();
            this.loadSavedExpressions();
            this.loadSavedPolicies();
            this.loadKeyVariables();
            this.setupReplaceKeysCheckbox();
            
            // Initialize undo stacks with initial state
            setTimeout(() => {
                console.log('Initializing undo stacks');
                this.saveState('policy');
                this.saveState('miniscript');
                console.log('Policy undo stack:', this.undoStacks.policy);
                console.log('Miniscript undo stack:', this.undoStacks.miniscript);
            }, 100);
        } catch (error) {
            console.error('Failed to initialize WASM module:', error);
            this.showError('Failed to load compiler module. Please refresh the page.');
        }
    }

    setupEventListeners() {
        // Policy compile button
        document.getElementById('compile-policy-btn').addEventListener('click', () => {
            this.compilePolicy();
        });

        // Clear policy button
        document.getElementById('clear-policy-btn').addEventListener('click', () => {
            this.clearPolicy();
        });

        // Compile button
        document.getElementById('compile-btn').addEventListener('click', () => {
            this.compileExpression();
        });

        // Save policy button  
        document.getElementById('save-policy-btn').addEventListener('click', () => {
            this.showSavePolicyModal();
        });

        // Save button
        document.getElementById('save-btn').addEventListener('click', () => {
            this.showSaveModal();
        });

        // Clear button
        document.getElementById('clear-btn').addEventListener('click', () => {
            this.clearExpression();
        });

        // Save modal buttons
        document.getElementById('confirm-save').addEventListener('click', () => {
            this.saveExpression();
        });

        document.getElementById('cancel-save').addEventListener('click', () => {
            this.hideSaveModal();
        });

        // Save policy modal buttons
        document.getElementById('confirm-save-policy').addEventListener('click', () => {
            this.savePolicy();
        });

        document.getElementById('cancel-save-policy').addEventListener('click', () => {
            this.hideSavePolicyModal();
        });

        // Close modal when clicking outside
        document.getElementById('save-modal').addEventListener('click', (e) => {
            if (e.target.id === 'save-modal') {
                this.hideSaveModal();
            }
        });

        document.getElementById('save-policy-modal').addEventListener('click', (e) => {
            if (e.target.id === 'save-policy-modal') {
                this.hideSavePolicyModal();
            }
        });

        // Enter key in textarea compiles
        document.getElementById('expression-input').addEventListener('keydown', (e) => {
            // Only log when ctrl/cmd is pressed
            if (e.ctrlKey || e.metaKey) {
                console.log(`Miniscript keydown: key=${e.key}, ctrl=${e.ctrlKey}, meta=${e.metaKey}, shift=${e.shiftKey}`);
            }
            
            if (e.ctrlKey && e.key === 'Enter') {
                this.compileExpression();
            }
            // Handle undo/redo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                console.log('Miniscript: Triggering undo (Ctrl+Z)');
                e.preventDefault();
                e.stopPropagation();
                this.undo('miniscript');
                return false;
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'Z' && e.shiftKey) {
                // Capital Z indicates Shift+Z
                console.log('Miniscript: Triggering redo (Ctrl+Shift+Z)');
                e.preventDefault();
                e.stopPropagation();
                this.redo('miniscript');
                return false;
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                console.log('Miniscript: Triggering redo (Ctrl+Y)');
                e.preventDefault();
                e.stopPropagation();
                this.redo('miniscript');
                return false;
            }
        }, true); // Use capture phase

        // Enter key in save input saves
        document.getElementById('save-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.saveExpression();
            }
        });

        document.getElementById('save-policy-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.savePolicy();
            }
        });

        // Enter key in policy input compiles
        document.getElementById('policy-input').addEventListener('keydown', (e) => {
            // Only log when ctrl/cmd is pressed
            if (e.ctrlKey || e.metaKey) {
                console.log(`Policy keydown: key=${e.key}, ctrl=${e.ctrlKey}, meta=${e.metaKey}, shift=${e.shiftKey}`);
                if (e.key === 'z') {
                    console.log('Z key pressed with modifiers:', {
                        ctrl: e.ctrlKey,
                        meta: e.metaKey,
                        shift: e.shiftKey,
                        isUndo: !e.shiftKey,
                        isRedo: e.shiftKey
                    });
                }
                if (e.key === 'y') {
                    console.log('Y key pressed with modifiers - this should be redo');
                }
            }
            
            if (e.ctrlKey && e.key === 'Enter') {
                this.compilePolicy();
            }
            // Handle undo/redo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                console.log('Policy: Triggering undo (Ctrl+Z)');
                e.preventDefault();
                e.stopPropagation();
                this.undo('policy');
                return false;
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'Z' && e.shiftKey) {
                // Capital Z indicates Shift+Z
                console.log('Policy: Triggering redo (Ctrl+Shift+Z)');
                e.preventDefault();
                e.stopPropagation();
                this.redo('policy');
                return false;
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                console.log('Policy: Triggering redo (Ctrl+Y)');
                e.preventDefault();
                e.stopPropagation();
                this.redo('policy');
                return false;
            }
        }, true); // Use capture phase

        // Policy input syntax highlighting
        const policyInput = document.getElementById('policy-input');
        let policyHighlightTimeout = null;
        
        // Prevent default undo/redo on contenteditable
        policyInput.addEventListener('beforeinput', (e) => {
            if (e.inputType === 'historyUndo') {
                console.log('Intercepting browser undo on policy input');
                e.preventDefault();
                this.undo('policy');
                return false;
            } else if (e.inputType === 'historyRedo') {
                console.log('Intercepting browser redo on policy input (right-click menu)');
                e.preventDefault();
                this.redo('policy');
                return false;
            } else if (e.inputType.includes('delete') || e.inputType.includes('insert')) {
                // Save state before destructive operations
                if (!this.isUndoing) {
                    this.saveState('policy');
                }
            }
        });
        
        policyInput.addEventListener('input', () => {
            // Save state for undo if not currently undoing (debounced)
            if (!this.isUndoing) {
                if (this.saveStateTimeouts.policy) {
                    clearTimeout(this.saveStateTimeouts.policy);
                }
                this.saveStateTimeouts.policy = setTimeout(() => {
                    this.saveState('policy');
                }, 300); // Save state after 300ms of no input
            }
            // Debounce syntax highlighting to preserve undo history
            if (policyHighlightTimeout) {
                clearTimeout(policyHighlightTimeout);
            }
            policyHighlightTimeout = setTimeout(() => {
                this.highlightPolicySyntax();
            }, 500); // Delay highlighting by 500ms
        });
        
        policyInput.addEventListener('paste', (e) => {
            // Handle paste event to maintain highlighting
            if (policyHighlightTimeout) {
                clearTimeout(policyHighlightTimeout);
            }
            policyHighlightTimeout = setTimeout(() => {
                this.highlightPolicySyntax();
            }, 500);
        });

        // Miniscript input syntax highlighting
        const expressionInput = document.getElementById('expression-input');
        let miniscriptHighlightTimeout = null;
        
        // Prevent default undo/redo on contenteditable
        expressionInput.addEventListener('beforeinput', (e) => {
            if (e.inputType === 'historyUndo') {
                console.log('Intercepting browser undo on miniscript input');
                e.preventDefault();
                this.undo('miniscript');
                return false;
            } else if (e.inputType === 'historyRedo') {
                console.log('Intercepting browser redo on miniscript input');
                e.preventDefault();
                this.redo('miniscript');
                return false;
            } else if (e.inputType.includes('delete') || e.inputType.includes('insert')) {
                // Save state before destructive operations
                if (!this.isUndoing) {
                    this.saveState('miniscript');
                }
            }
        });
        
        expressionInput.addEventListener('input', () => {
            // Save state for undo if not currently undoing (debounced)
            if (!this.isUndoing) {
                if (this.saveStateTimeouts.miniscript) {
                    clearTimeout(this.saveStateTimeouts.miniscript);
                }
                this.saveStateTimeouts.miniscript = setTimeout(() => {
                    this.saveState('miniscript');
                }, 300); // Save state after 300ms of no input
            }
            // Debounce syntax highlighting to preserve undo history
            if (miniscriptHighlightTimeout) {
                clearTimeout(miniscriptHighlightTimeout);
            }
            miniscriptHighlightTimeout = setTimeout(() => {
                this.highlightMiniscriptSyntax();
            }, 500); // Delay highlighting by 500ms
        });
        
        expressionInput.addEventListener('paste', (e) => {
            // Handle paste event to maintain highlighting
            if (miniscriptHighlightTimeout) {
                clearTimeout(miniscriptHighlightTimeout);
            }
            miniscriptHighlightTimeout = setTimeout(() => {
                this.highlightMiniscriptSyntax();
            }, 500);
        });

        // Add key button
        document.getElementById('add-key-btn').addEventListener('click', () => {
            this.addKeyVariable();
        });

        // Generate key button - using onclick in HTML

        // Enter key in key inputs adds key
        document.getElementById('key-name-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('key-value-input').focus();
            }
        });

        document.getElementById('key-value-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.addKeyVariable();
            }
        });

    }

    compileExpression() {
        const expression = document.getElementById('expression-input').textContent.trim();
        const context = document.querySelector('input[name="context"]:checked').value;
        
        // Clear previous messages
        this.clearMiniscriptMessages();
        
        if (!expression) {
            this.showMiniscriptError('Please enter a miniscript expression.');
            return;
        }

        if (!this.wasm) {
            this.showMiniscriptError('Compiler not ready, please wait and try again.');
            return;
        }

        // Show loading state
        const compileBtn = document.getElementById('compile-btn');
        const originalText = compileBtn.textContent;
        compileBtn.textContent = '⏳ Compiling...';
        compileBtn.disabled = true;

        try {
            // Replace key variables in expression
            const processedExpression = this.replaceKeyVariables(expression);
            
            // Call the WASM function with context
            const result = compile_miniscript(processedExpression, context);
            
            // Reset button
            compileBtn.textContent = originalText;
            compileBtn.disabled = false;

            if (result.success) {
                // Debug: Log all available fields
                console.log('=== ALL COMPILATION RESULT FIELDS ===');
                console.log('success:', result.success);
                console.log('error:', result.error);
                console.log('script:', result.script ? `"${result.script.substring(0, 50)}..." (length: ${result.script.length})` : result.script);
                console.log('script_asm:', result.script_asm ? `"${result.script_asm.substring(0, 50)}..." (length: ${result.script_asm.length})` : result.script_asm);
                console.log('address:', result.address);
                console.log('script_size:', result.script_size);
                console.log('miniscript_type:', result.miniscript_type);
                console.log('compiled_miniscript:', result.compiled_miniscript);
                console.log('=====================================');
                
                // Simple success message for now
                this.showMiniscriptSuccess(`Compilation successful - ${result.miniscript_type}, ${result.script_size} bytes`);
                // Display results (without the info box since we show it in the success message)
                this.displayResults(result);
            } else {
                this.showMiniscriptError(result.error);
                // Clear results
                document.getElementById('results').innerHTML = '';
            }
            
        } catch (error) {
            console.error('Compilation error:', error);
            compileBtn.textContent = originalText;
            compileBtn.disabled = false;
            this.showMiniscriptError(`Compilation failed: ${error.message}`);
        }
    }

    compilePolicy() {
        const policy = document.getElementById('policy-input').textContent.trim();
        const context = document.querySelector('input[name="context"]:checked').value;
        
        // Clear previous errors
        this.clearPolicyErrors();
        
        if (!policy) {
            this.showPolicyError('Please enter a policy expression.');
            return;
        }

        if (!this.wasm) {
            this.showPolicyError('Compiler not ready, please wait and try again.');
            return;
        }

        // Show loading state
        const compilePolicyBtn = document.getElementById('compile-policy-btn');
        const originalText = compilePolicyBtn.textContent;
        compilePolicyBtn.textContent = '⏳ Compiling...';
        compilePolicyBtn.disabled = true;

        try {
            // Replace key variables in policy
            const processedPolicy = this.replaceKeyVariables(policy);
            
            // Call the WASM function with context
            const result = compile_policy(processedPolicy, context);
            
            // Reset button
            compilePolicyBtn.textContent = originalText;
            compilePolicyBtn.disabled = false;

            if (result.success && result.compiled_miniscript) {
                // Success: fill the miniscript field and show results
                document.getElementById('expression-input').textContent = result.compiled_miniscript;
                this.highlightMiniscriptSyntax();
                
                // Check if the compiled miniscript contains key names (like ALICE, BOB) or hex keys
                const containsKeyNames = this.containsKeyNames(result.compiled_miniscript);
                
                // Set toggle button state based on content
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
                
                // Show green success message in miniscript messages area
                this.showMiniscriptSuccess(`Compilation successful - ${result.miniscript_type}, ${result.script_size} bytes`);
                
                // Don't display the compiled_miniscript in results since it's now in the text box
                result.compiled_miniscript = null;
                // Display results (script, asm, address)
                this.displayResults(result);
            } else {
                // Error: show policy-specific error
                this.showPolicyError(result.error || 'Policy compilation failed');
                // Clear results and miniscript messages
                document.getElementById('results').innerHTML = '';
                this.clearMiniscriptMessages();
            }
            
        } catch (error) {
            console.error('Policy compilation error:', error);
            compilePolicyBtn.textContent = originalText;
            compilePolicyBtn.disabled = false;
            this.showPolicyError(`Policy compilation failed: ${error.message}`);
        }
    }

    clearPolicy() {
        document.getElementById('policy-input').innerHTML = '';
        document.getElementById('expression-input').innerHTML = '';
        document.getElementById('results').innerHTML = '';
        this.clearPolicyErrors();
        
        // Reset the "Show key names" checkbox since we cleared the miniscript
        const toggleBtn = document.getElementById('key-names-toggle');
        if (toggleBtn) {
            toggleBtn.style.color = 'var(--text-secondary)';
            toggleBtn.title = 'Show key names';
            toggleBtn.dataset.active = 'false';
        }
        
        // Hide description panel
        const policyPanel = document.querySelector('.policy-description-panel');
        if (policyPanel) policyPanel.style.display = 'none';
    }

    showPolicyError(message) {
        const policyErrorsDiv = document.getElementById('policy-errors');
        let additionalHelp = '';
        
        // Check if this is a missing key variable error
        const keyLengthMatch = message.match(/pubkey string should be (?:66|130) (?:or \d+ )?digits(?: long)?, got: (\d+)/);
        if (keyLengthMatch) {
            const gotLength = parseInt(keyLengthMatch[1]);
            // Check if this looks like a key name (short length, likely under 20 chars)
            if (gotLength < 20) {
                // Try to find what key name might be missing from the policy
                const policyText = document.getElementById('policy-input').textContent || '';
                // Common key names that match this length
                const commonKeys = ['Alice', 'Bob', 'Charlie', 'David', 'Eva', 'Frank', 'Lara', 'Helen', 'Ivan', 'Julia', 'Karl', 'TestnetKey', 'MainnetKey'];
                const missingKey = commonKeys.find(key => key.length === gotLength && policyText.includes(key));
                
                if (missingKey) {
                    additionalHelp = `
                        <div style="margin-top: 15px; padding: 12px; background: var(--warning-bg, rgba(251, 191, 36, 0.1)); border: 1px solid var(--warning-border, rgba(251, 191, 36, 0.3)); border-radius: 6px;">
                            <strong>💡 Tip:</strong> The key variable "<strong>${missingKey}</strong>" appears to be missing or undefined.
                            <br>→ Check the <strong>Key variables</strong> section to see if it exists
                            <br>→ Click <strong>"Restore defaults"</strong> to add common keys (Alice, Bob, Charlie, etc.)
                            <br>→ Or add it manually with a valid 66-character public key
                        </div>
                    `;
                } else if (gotLength <= 15) {
                    // Generic help for short strings that look like variable names
                    additionalHelp = `
                        <div style="margin-top: 15px; padding: 12px; background: var(--warning-bg, rgba(251, 191, 36, 0.1)); border: 1px solid var(--warning-border, rgba(251, 191, 36, 0.3)); border-radius: 6px;">
                            <strong>💡 Tip:</strong> This looks like a missing key variable (got ${gotLength} characters instead of a public key).
                            <br>→ Check the <strong>Key variables</strong> section
                            <br>→ Click <strong>"Restore defaults"</strong> to add common keys
                            <br>→ Or define your custom key with a valid 66-character public key
                        </div>
                    `;
                }
            }
        }
        
        policyErrorsDiv.innerHTML = `
            <div class="result-box error" style="margin: 0;">
                <h4>❌ Policy error</h4>
                <div style="margin-top: 10px;">${message}</div>
                ${additionalHelp}
            </div>
        `;
    }

    clearPolicyErrors() {
        document.getElementById('policy-errors').innerHTML = '';
    }

    highlightPolicySyntax() {
        const policyInput = document.getElementById('policy-input');
        const text = policyInput.textContent || '';
        
        // Only apply highlighting if the text content has actually changed
        if (policyInput.dataset.lastHighlightedText === text) {
            return;
        }
        
        // Save cursor position as offset from start of text
        const selection = window.getSelection();
        let caretOffset = 0;
        
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(policyInput);
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            caretOffset = preCaretRange.toString().length;
        }
        
        // Apply syntax highlighting
        const highlightedHTML = this.applySyntaxHighlighting(text);
        
        // Only update HTML if it actually changed
        if (policyInput.innerHTML !== highlightedHTML) {
            policyInput.innerHTML = highlightedHTML;
            // Restore cursor position
            this.restoreCursor(policyInput, caretOffset);
        }
        
        // Store the last highlighted text
        policyInput.dataset.lastHighlightedText = text;
    }

    applySyntaxHighlighting(text) {
        // Policy language syntax patterns
        return text
            // HD wallet descriptors: [fingerprint/path]xpub/<range>/*
            .replace(/(\[)([A-Fa-f0-9]{8})(\/)([0-9h'/]+)(\])([xt]pub[A-Za-z0-9]+)(<[0-9;]+>)?(\/\*)?/g, 
                '<span class="syntax-descriptor-bracket">$1</span>' +
                '<span class="syntax-fingerprint">$2</span>' +
                '<span class="syntax-descriptor-bracket">$3</span>' +
                '<span class="syntax-derivation-path">$4</span>' +
                '<span class="syntax-descriptor-bracket">$5</span>' +
                '<span class="syntax-xpub">$6</span>' +
                '<span class="syntax-range">$7</span>' +
                '<span class="syntax-wildcard">$8</span>')
            // Functions (pk, and, or, thresh, etc.)
            .replace(/\b(pk|and|or|thresh|older|after|sha256|hash256|ripemd160|hash160)\b/g, '<span class="syntax-function">$1</span>')
            // Numbers 
            .replace(/\b\d+\b/g, '<span class="syntax-number">$&</span>')
            // Key variables (capitalized words)
            .replace(/\b[A-Z][a-zA-Z]*\b/g, '<span class="syntax-key">$&</span>')
            // Parentheses
            .replace(/[()]/g, '<span class="syntax-parenthesis">$&</span>')
            // Commas
            .replace(/,/g, '<span class="syntax-comma">$&</span>');
    }

    highlightMiniscriptSyntax() {
        const expressionInput = document.getElementById('expression-input');
        const text = expressionInput.textContent || '';
        
        // Only apply highlighting if the text content has actually changed
        if (expressionInput.dataset.lastHighlightedText === text) {
            return;
        }
        
        // Save cursor position as offset from start of text
        const selection = window.getSelection();
        let caretOffset = 0;
        
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(expressionInput);
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            caretOffset = preCaretRange.toString().length;
        }
        
        // Apply syntax highlighting
        const highlightedHTML = this.applyMiniscriptSyntaxHighlighting(text);
        
        // Only update HTML if it actually changed
        if (expressionInput.innerHTML !== highlightedHTML) {
            expressionInput.innerHTML = highlightedHTML;
            // Restore cursor position
            this.restoreCursor(expressionInput, caretOffset);
        }
        
        // Store the last highlighted text
        expressionInput.dataset.lastHighlightedText = text;
    }

    applyMiniscriptSyntaxHighlighting(text) {
        // Miniscript syntax patterns (based on official spec: https://bitcoin.sipa.be/miniscript/)
        return text
            // HD wallet descriptors: [fingerprint/path]xpub/<range>/*
            .replace(/(\[)([A-Fa-f0-9]{8})(\/)([0-9h'/]+)(\])([xt]pub[A-Za-z0-9]+)(\/<[0-9;]+>\/\*)/g, 
                '<span class="syntax-descriptor-bracket">$1</span>' +
                '<span class="syntax-fingerprint">$2</span>' +
                '<span class="syntax-descriptor-bracket">$3</span>' +
                '<span class="syntax-derivation-path">$4</span>' +
                '<span class="syntax-descriptor-bracket">$5</span>' +
                '<span class="syntax-xpub">$6</span>' +
                '<span class="syntax-range">$7</span>')
            // Compressed public keys (66 hex characters starting with 02 or 03)
            .replace(/\b(0[23][a-fA-F0-9]{62})\b/g, '<span class="syntax-pubkey">$1</span>')
            // Basic fragments - literals
            .replace(/\b(0|1)\b/g, '<span class="syntax-number">$1</span>')
            // Basic fragments - key checks
            .replace(/\b(pk|pk_k|pk_h|pkh)\b/g, '<span class="syntax-fragment">$1</span>')
            // Basic fragments - timelocks
            .replace(/\b(older|after)\b/g, '<span class="syntax-fragment">$1</span>')
            // Hash fragments  
            .replace(/\b(sha256|hash256|ripemd160|hash160)\b/g, '<span class="syntax-hash-fragment">$1</span>')
            // AND combinators
            .replace(/\b(and_v|and_b|and_n)\b/g, '<span class="syntax-fragment">$1</span>')
            // OR combinators
            .replace(/\b(or_b|or_c|or_d|or_i)\b/g, '<span class="syntax-fragment">$1</span>')
            // AND-OR combinator
            .replace(/\b(andor)\b/g, '<span class="syntax-fragment">$1</span>')
            // Threshold and multisig
            .replace(/\b(thresh)\b/g, '<span class="syntax-threshold">$1</span>')
            .replace(/\b(multi|multi_a)\b/g, '<span class="syntax-multisig">$1</span>')
            // Wrappers (all official wrappers from spec)
            .replace(/\b([acstdvjlnu]):/g, '<span class="syntax-wrapper">$1:</span>')
            // Numbers 
            .replace(/\b\d+\b/g, '<span class="syntax-number">$&</span>')
            // Key variables (capitalized words)
            .replace(/\b[A-Z][a-zA-Z]*\b/g, '<span class="syntax-key">$&</span>')
            // Parentheses
            .replace(/[()]/g, '<span class="syntax-parenthesis">$&</span>')
            // Commas
            .replace(/,/g, '<span class="syntax-comma">$&</span>');
    }

    saveState(type, force = false) {
        const element = type === 'policy' ? 
            document.getElementById('policy-input') : 
            document.getElementById('expression-input');
        
        const currentContent = element.textContent || '';
        const undoStack = this.undoStacks[type];
        
        // Don't save if content hasn't changed (unless forced)
        if (!force && undoStack.length > 0 && undoStack[undoStack.length - 1] === currentContent) {
            console.log(`Not saving state for ${type}: content unchanged`);
            return;
        }
        
        if (force) {
            console.log(`🔥 FORCED saving state for ${type}: "${currentContent.substring(0, 50)}..." (stack size will be: ${undoStack.length + 1})`);
        } else {
            console.log(`Saving state for ${type}: "${currentContent.substring(0, 50)}..." (stack size will be: ${undoStack.length + 1})`);
        }
        
        // Add to undo stack
        undoStack.push(currentContent);
        
        console.log(`Current undo stack for ${type}:`, undoStack.map(s => s.substring(0, 20) + '...'));
        
        // Limit undo stack size to 50 states
        if (undoStack.length > 50) {
            undoStack.shift();
        }
        
        // Clear redo stack when new content is added
        this.redoStacks[type] = [];
    }

    undo(type) {
        console.log(`Undo called for ${type}`);
        const element = type === 'policy' ? 
            document.getElementById('policy-input') : 
            document.getElementById('expression-input');
        
        const undoStack = this.undoStacks[type];
        const redoStack = this.redoStacks[type];
        
        console.log(`Undo stack:`, undoStack);
        console.log(`Undo stack length: ${undoStack.length}`);
        
        if (undoStack.length === 0) {
            console.log('No undo history available');
            return;
        }
        
        if (undoStack.length === 1) {
            // Only initial state in stack, restore it
            const initialState = undoStack[0];
            console.log(`Restoring to initial state: "${initialState}"`);
            this.isUndoing = true;
            element.textContent = initialState;
            if (type === 'policy') {
                this.highlightPolicySyntax();
            } else {
                this.highlightMiniscriptSyntax();
            }
            
            this.isUndoing = false;
            
            // Set cursor to end of content
            setTimeout(() => {
                element.focus();
                const range = document.createRange();
                const selection = window.getSelection();
                range.selectNodeContents(element);
                range.collapse(false); // Collapse to end
                selection.removeAllRanges();
                selection.addRange(range);
            }, 100);
            return;
        }
        
        // Current state goes to redo stack
        const currentContent = element.textContent || '';
        redoStack.push(currentContent);
        
        // Remove current state from undo stack
        undoStack.pop();
        
        // Get previous state (now the last item)
        const previousContent = undoStack[undoStack.length - 1] || '';
        
        console.log(`Restoring content: "${previousContent.substring(0, 50)}..."`);
        
        // Apply previous state
        this.isUndoing = true;
        element.textContent = previousContent;
        
        // Apply syntax highlighting
        if (type === 'policy') {
            this.highlightPolicySyntax();
        } else {
            this.highlightMiniscriptSyntax();
        }
        
        this.isUndoing = false;
        
        // Update context menu state first, then set cursor
        setTimeout(() => {
            this.updateContextMenuState();
            
            // Set cursor to end of content after context menu update
            setTimeout(() => {
                element.focus();
                const range = document.createRange();
                const selection = window.getSelection();
                range.selectNodeContents(element);
                range.collapse(false); // Collapse to end
                selection.removeAllRanges();
                selection.addRange(range);
            }, 10);
        }, 50);
    }

    redo(type) {
        console.log(`Redo called for ${type}`);
        const element = type === 'policy' ? 
            document.getElementById('policy-input') : 
            document.getElementById('expression-input');
        
        const undoStack = this.undoStacks[type];
        const redoStack = this.redoStacks[type];
        
        console.log(`Redo stack:`, redoStack);
        console.log(`Redo stack length: ${redoStack.length}`);
        
        if (redoStack.length === 0) {
            console.log('No redo history available');
            return;
        }
        
        // Save current state to undo stack
        const currentContent = element.textContent || '';
        undoStack.push(currentContent);
        
        // Get next state
        const nextContent = redoStack.pop();
        
        // Apply next state
        this.isUndoing = true;
        element.textContent = nextContent;
        
        // Apply syntax highlighting
        if (type === 'policy') {
            this.highlightPolicySyntax();
        } else {
            this.highlightMiniscriptSyntax();
        }
        
        this.isUndoing = false;
        
        // Update context menu state first, then set cursor
        setTimeout(() => {
            this.updateContextMenuState();
            
            // Set cursor to end of content after context menu update
            setTimeout(() => {
                element.focus();
                const range = document.createRange();
                const selection = window.getSelection();
                range.selectNodeContents(element);
                range.collapse(false); // Collapse to end
                selection.removeAllRanges();
                selection.addRange(range);
            }, 10);
        }, 50);
    }

    updateContextMenuState() {
        // Enable/disable browser context menu redo based on our redo stacks
        const policyElement = document.getElementById('policy-input');
        const miniscriptElement = document.getElementById('expression-input');
        
        // Check if we have redo history
        const policyHasRedo = this.redoStacks.policy.length > 0;
        const miniscriptHasRedo = this.redoStacks.miniscript.length > 0;
        
        // Create invisible browser undo history to enable context menu
        if (policyHasRedo) {
            this.enableContextMenuRedo(policyElement);
        }
        if (miniscriptHasRedo) {
            this.enableContextMenuRedo(miniscriptElement);
        }
    }
    
    enableContextMenuRedo(element) {
        // Trick: Create a tiny invisible change that can be undone to enable redo in context menu
        const originalContent = element.innerHTML;
        
        // Temporarily disable our event listeners
        const wasUndoing = this.isUndoing;
        this.isUndoing = true;
        
        // Make a tiny invisible change
        element.innerHTML = originalContent + '<span style="display:none;"></span>';
        
        // Use execCommand to create browser undo history
        document.execCommand('insertText', false, '');
        document.execCommand('undo');
        
        // Restore original content and listeners
        element.innerHTML = originalContent;
        this.isUndoing = wasUndoing;
    }

    restoreCursor(element, offset) {
        const selection = window.getSelection();
        const range = document.createRange();
        
        let currentOffset = 0;
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let node;
        while (node = walker.nextNode()) {
            const nodeLength = node.textContent.length;
            if (currentOffset + nodeLength >= offset) {
                const targetOffset = offset - currentOffset;
                range.setStart(node, Math.min(targetOffset, nodeLength));
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }
            currentOffset += nodeLength;
        }
        
        // If we couldn't find the exact position, place cursor at end
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    replaceKeyVariables(text) {
        let processedText = text;
        for (const [name, value] of this.keyVariables) {
            // Replace key variables in pk(), using word boundaries to avoid partial matches
            const regex = new RegExp('\\b' + name + '\\b', 'g');
            processedText = processedText.replace(regex, value);
        }
        return processedText;
    }

    generateKey() {
        console.log('Generate key button clicked!');
        
        // Get selected key type from radio buttons
        const selectedType = document.querySelector('input[name="keyType"]:checked')?.value || 'compressed';
        console.log('Selected key type:', selectedType);
        
        // Define all key pools (20 keys each)
        const keyPools = {
            compressed: [
                '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
                '03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd',
                '03defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34',
                '034cf034640859162ba19ee5a5a33e713a86e2e285b79cdaf9d5db4a07aa59f765',
                '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
                '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
                '03774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb',
                '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13',
                '03d01115d548e7561b15c38f004d734633687cf4419620095bc5b0f47070afe85a',
                '02791ca97e3d5c1dc6bc7e7e1a1e5fc19b90e0e8b1f9f0f1b2c3d4e5f6a7b8c9',
                '03581c63a4f65b4dfb3baf7d5c3e5a6d4f0e7b2c8a9f1d3e4b2a5c6d7e8f9a0b',
                '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
                '02bf0e7b0c8a7b1f9a3e4d2c5b6a8f9d0e7c1b4a3f6e9d2c5b8a1f4e7d0c3b6a',
                '032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991',
                '020e46e79a2a8d12b9b21b533e2f1c6d5a7f8e9c0b1d2a3f4e5c6b7a8f9d0e3c',
                '03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556',
                '025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357',
                '03d30199d74fb5a22d47b6e054e2f378cedacffcb89904a61d75d0dbd407143e65',
                '023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb',
                '03acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe'
            ],
            xonly: [
                'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
                'a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd',
                'defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34',
                '4cf034640859162ba19ee5a5a33e713a86e2e285b79cdaf9d5db4a07aa59f765',
                '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
                'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
                '774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb',
                'e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13',
                'd01115d548e7561b15c38f004d734633687cf4419620095bc5b0f47070afe85a',
                '791ca97e3d5c1dc6bc7e7e1a1e5fc19b90e0e8b1f9f0f1b2c3d4e5f6a7b8c9',
                '581c63a4f65b4dfb3baf7d5c3e5a6d4f0e7b2c8a9f1d3e4b2a5c6d7e8f9a0b',
                '2f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
                'bf0e7b0c8a7b1f9a3e4d2c5b6a8f9d0e7c1b4a3f6e9d2c5b8a1f4e7d0c3b6a',
                '2c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991',
                '0e46e79a2a8d12b9b21b533e2f1c6d5a7f8e9c0b1d2a3f4e5c6b7a8f9d0e3c',
                'fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556',
                '5476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357',
                'd30199d74fb5a22d47b6e054e2f378cedacffcb89904a61d75d0dbd407143e65',
                '3da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb',
                'acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe'
            ],
            xpub: [
                'xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda',
                'xpub6DVwZpXox5Ufcug1ub1LXSuYzej9yTY26asDVveSYJA3d31JhFp25ofUC6cS37YvhWGH26oTbpUdipBYfCc47hWobdezL1cQLKDhCVFqez8',
                'xpub6DJEDKjse8S92yvQx7JkXLk5aAhkJWXZa5XckxrPy28EwLB6jUzrCS77tAEpRWq3QqF2RivtzDt9ExsyxrqkG75xJty3fwVDvDdFBpmMwfu',
                'xpub6DX4uxi4koKfkHVJLMDEoeTwQJJYJXM49LcpKpHKgVpSJTRZ8wkYKVtFGRffCDZfzccW9k8qmTcyG3PTFoxapSzv8mu5NzkzgLZTrb2F47N',
                'xpub6CAyrJvsVeEBuz1GyKquKxdiYjmA9HbhKmPfSX8mCg1JmP7VFMbvKXzze6gsUQ97cYcMD7DG2oge2gMzUY64mkeUGQv2KqtBpi4gw2tL5Wp',
                'xpub6By2dbMpSdtCVycBc2MjC949ksbuE6tHwVNk53zKEGfUrE2PGF3a3D2YLeokHJPDLHAnm7aGoxT47dWb6m3BmXmhbbKT7dqRXaAridfmRqq',
                'xpub6CaYzGvBpwvxQ92DMxS3HfVNJ3fZhpn6uVV1JLbLFSMDutjCtBv9NnbKJMgHUvwVmYzYNYTSvgHEdNi4QG7fSUCrB39VdUDzDYVNZKnK54X',
                'xpub6C4dEw4P295tXPETX4BRbP6Ytt1cstZn2CssjGNmTpSC34PChubYotfBhBvtEG5XzKrDLvELhd9FydP5x19K4KHBXv837zzMiYzX48MhS12',
                'xpub6DRQCUpZfs7b5vkVobwvSF2cH4BnnU8VjcLJw1WUGdSAbspFhqHRFRw8PDqgKFjL2xXSyyQc9nszDnRaPHsU4U36L6HsQPFxfUQM5o5rX7G',
                'xpub6CX2v8gD4Lx1tQDrWfDk4RjDsWrqn1SX6Q2p8ACtWsjwSEtyA1HYGVpUNJExtjmsmpTh68h2BrVcRfFFBhJcSSz8SmXcF4crr3zNhKvRTRM',
                'xpub6Cxu6NiSPeqcCnWTrHFGKgvFN4FM3oJsrSvKHJvsd7X8VUpt1ySe9qFCxfYk1s5yp8bkyhVLDFkH885qSehrnAPjpUZdQ1hh6HowiKg6XvB',
                'xpub6Bv82ixJNjgxru2C64FdNMT2zcpDtGCXwvbUwAajMjG2xspFuEws2a1FNCDbHfSYPJkE82bLdAKauQ3e4Ro5ToX2zGM9v8RRE9FUyVgtDw7',
                'xpub6BgdVUWuikQxoNZPZzUeH4wdHbrs3cShA6N2QpvVQRxqVgLkY73kyXd7v6F2fmxgjBunRndwTMdoFGB81tq431cmDXpBdU3FpSyYKPCdFqd',
                'xpub6CFvZzxtB9b9dxhnMa7E6LhSwLXHsvKXtzpQgvYJh9miAftECi2mnnzEz5KLGEyz1MmetXTLhj93cQR4aeuW2oMnK5aczoLXuK57bbZBcN4',
                'xpub6BhHskPWuUeDWvoyFV2JiDaoH8bQg2pdzxDuKWcSUU55X7L3dpDv7MAD4YD5M7HHVjTvXRr8KXNupYUVTTmbnSNAqspwgnNe1X8AVdKj5eh',
                'xpub6Cst8ZhGHGuRCVntQ4rWRffvjc22xobzDEMFj4b5B2pELo6dsXjn3TRCD4dyXGLw2V6V5pG6RSWgyH3bniULoD8frDHmY1XW4iKtPHnjrrZ',
                'xpub6BoHFYfB5bxrATp6XJkN8WCA5qRg6F8nnvw8vNEJq9fLx6m2wko4zyQuaJzQKH5o2JSTh7kEZs9AamxZUXwPkXq4umrr6wJqojdwMd7nvDg',
                'xpub6DFEv2BRUtXrNBMHzePBNEqDKSFDDBEgxnvne2ZgwReegyVFFGqthqJ8oyL9NzGtpWbSn5a2EdC4ffZELCFWW75794954to7uf7yeDFQypf',
                'xpub6DFEv2BRUtXrNBMHzePBNEqDKSFDDBEgxnvne2ZgwReegyVFFGqthqJ8oyL9NzGtpWbSn5a2EdC4ffZELCFWW75794954to7uf7yeDFQypf',
                'xpub6BogqrbNGr4oC7TSMSxeAjWYGvCZ6ykK3m9XWUbH1B3wvs3JNNrXDKXjPSgfnHfyS1xJ6gis8Ngy5KCxkAD77zUjUMaM3CtrbDmUPFNoUAJ'
            ],
            tpub: [
                'tpubDCqmaqe5U2vTX1o22an5Xs2249Q7oXuKATftGBjEyYFKJPo6A6Jmf7RZmHTwS7gv1KoqctnbhypL49aYDvMzNywn7wdqYbFagxdGdsNgGPT',
                'tpubDCUSNNGv9a4ii4vjbdB1vB466uuo9LhSAJdyzJGYNXZHEYcVBXshtMXBcUVF5UjHYoU1Paj7CoqVn8MwYZ23wkU1kRCFZ7cgVBrkctnqzy3',
                'tpubDDEprh91LAyzRYSdCwm1FHNofRxnu7HBXmVWAx6HRLxauhJ7j3eJb2RH9EXmbGMFk59yDfo2HVPttgfgpmqNjJnkvPon2YnhXmxDw7tvj1P',
                'tpubDDiJf7V97vkpJpZnr9KpxwNNrVckiYU89VsvtvT9j5miupxtzrpD5w7GpM5R2nPMgvszhXHXzeiC4GTLGJ7UpaQDAi7BEWuCANJMt1Kw2Lw',
                'tpubDCa93YebgDGSupE8E1Bo9cG4E1RXnqDtK7mtfKZxrFrR7Y4e6FqzwymmtHjg3pbFAGDjuAYssMaQpvEYVSyrGmdU4req5c6acrShh3Y7xQb',
                'tpubDCXMUmB2ZGXdPw5wT3Rkh11LLL5gPgPP31T8yy4jSNLy16AUEAwZzM854Pdim97Qnwsi4eKfFsNpshQgaJu2ZMQrhdtXBtgSt5GMMrAWP91',
                'tpubDCs2bP5EMwpgCXPsjByMvQDJChqiU1nFWAsz4LTSXTtKFMdjQ4fsF2xtDMkyysTUaGcW2QHra8AQkhpt7DduR9s8GTr7sAMTrdYkq3LqvJg',
                'tpubDDhjkCPc8X9Xew4xtiu5b3QYA7GBVss3ZadMkoJj6y7Gpg9qgUdWSS8HtQ7xvyXPGrC2t9BSwcZCkVGGuBgUXjb8f9LZ6on783wBrCpRnTf',
                'tpubDDUcubxexsYBR9Sv1VBjRtmokycLZJgXtPVpdoZMaj3tXBr4gk9AtFTgNNWdGJ5fJtuXoyjXbDj2NJvKsdzzuPQmdueQn7mAEE2NbdoSYY4',
                'tpubDDHMijCf2MkCZiyFkDtk1fsjuehjjpE754Uw7QjS24fWtTP8fnQUrr2hAxksRPm1sVEiUhAAxKMa23HS2esAfsPNNP24XWcQDECsj1i5Cen',
                'tpubDD3as1pSz2mBRHcuDoQ8hvjpFF5xN3gr1uPcA17Cd7F1vxjAw4UuNQ1DYkVh3tJYfikWACsHeD3mkz9cKRRPuqoE9kXGhRAWdnkHBqnE6mv',
                'tpubDD2Jkdt363ZtTdnvaa4cMhiU2mg7ZjpEHRuw8ViEimfXZRd2FmDhk3XJ3butR1sGGRDasyLSMRi5fGwG8CeTyN9U6tVDkGUjNQq3VJdeA62',
                'tpubDC8Anx4AbMFdpAygLRf4NqUrmKZysVXSodQBbqmKhmaLgjFCR9xHYsgGytkKDTj8n8abDRsYQmv2voqnxdPekdLWHsyt99yqttghUyCYYE8',
                'tpubDCm2QWdEdVCC9t4j2E9pJA2u3CfTasqi3RteSzJuzjYsLGYj7gRi2FZAh1GWiyTPpeVFypohde8ziJCRJKn9juATVZs2GPn3RNwHVfxLM6t',
                'tpubDDK5oGLzXWSUG5H4iyM2vhKaBhygLfJF4iiNG2QqeMRehm71Q6MYtvM165CS1pS27aeTyD9YAsfDcbTzXzCeViLrNUiNNx2GyLN5wKepq7x',
                'tpubDCdvro24FvfG6WypbAwFfGwT4LzeT54JspmJgr3yYz8WmDV62iXGiiTyAQAPTbDLUT8jZZhb5Bjn6KyqPqwEY8ft54yEMdayby4naEXh7jw',
                'tpubDDmjDSgRTDBRkjzquEPpgjH7Ky4PUzJ4HceuxbD7YJTQDWYjLuRWhw3Go9H8WqGSfo86wfJ8kC8pW5hKoXYEwAmqy8fnKiciMS5dHMrcJDs',
                'tpubDCZgEW2jYXbjwu46iz7X9UWWSEE9tpSFtnVAkvw9x2rbPLmZZ3F7TDEQVdskYamiqmKvmYaQu2jwPBasRFMdJP7w6sP1hnvv4VpNe9wGCAr',
                'tpubDC9mKxZjqKo6nsurSjgnaaxQS3WSWqm8MVRwnnqjYzXRSfKjUxuvjLgMRAix2BLW8NfoPyUDTjkZgb9jENiihS3AoL3cwG18YLDmZmq1VWP',
                'tpubDC5H7ejMEWt2JF3AF2kdKKokQsAHcksHoHHMgw6S9x5sTs8mZ4rpNPpuNYSJr7RuwiqUgJpYnA6XftMUNW5hGkTduGCtFfBdyj2hXJKN2Xf'
            ]
        };
        
        // Get the key pool for the selected type
        const keyPool = keyPools[selectedType];
        console.log('Selected key type:', selectedType, 'Pool size:', keyPool.length);
        
        // Get already used keys
        const usedKeys = Array.from(this.keyVariables.values());
        
        // Filter out already used keys from the appropriate pool
        const availableKeys = keyPool.filter(key => !usedKeys.includes(key));
        
        // If all keys are used, return a random one anyway
        const keysToUse = availableKeys.length > 0 ? availableKeys : keyPool;
        
        // Simple random selection from available keys
        const randomIndex = Math.floor(Math.random() * keysToUse.length);
        const publicKey = keysToUse[randomIndex];
        
        console.log('Selected key type:', selectedType);
        console.log('Key pool length:', keyPool.length);
        console.log('Generated public key:', publicKey);
        console.log('Key length:', publicKey.length);
        console.log('Available keys:', availableKeys.length, 'Used keys:', usedKeys.length);
        
        // Set the generated key in the value input
        const valueInput = document.getElementById('key-value-input');
        if (valueInput) {
            valueInput.value = publicKey;
            console.log('Set value input to:', publicKey);
        } else {
            console.error('Could not find key-value-input element');
        }
        
        // Set a descriptive name based on key type if name input is empty
        const nameInput = document.getElementById('key-name-input');
        if (nameInput && !nameInput.value.trim()) {
            const typeLabels = {
                'compressed': 'CompressedKey',
                'xonly': 'XOnlyKey', 
                'xpub': 'ExtendedKey',
                'tpub': 'TestnetKey'
            };
            
            const baseLabel = typeLabels[selectedType] || 'Key';
            let counter = 1;
            let keyName = baseLabel;
            
            // Find next available number if name already exists
            while (this.keyVariables.has(keyName)) {
                counter++;
                keyName = `${baseLabel}${counter}`;
            }
            
            nameInput.value = keyName;
            nameInput.focus();
        }
    }

    generateCompressedPublicKey(privateKey) {
        // 66-character compressed keys for Legacy/Segwit v0 (20 keys)
        const compressedKeys = [
            '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
            '03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd',
            '03defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34',
            '034cf034640859162ba19ee5a5a33e713a86e2e285b79cdaf9d5db4a07aa59f765',
            '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
            '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
            '03774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb',
            '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13',
            '03d01115d548e7561b15c38f004d734633687cf4419620095bc5b0f47070afe85a',
            '02791ca97e3d5c1dc6bc7e7e1a1e5fc19b90e0e8b1f9f0f1b2c3d4e5f6a7b8c9',
            '03581c63a4f65b4dfb3baf7d5c3e5a6d4f0e7b2c8a9f1d3e4b2a5c6d7e8f9a0b',
            '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
            '02bf0e7b0c8a7b1f9a3e4d2c5b6a8f9d0e7c1b4a3f6e9d2c5b8a1f4e7d0c3b6a',
            '032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991',
            '020e46e79a2a8d12b9b21b533e2f1c6d5a7f8e9c0b1d2a3f4e5c6b7a8f9d0e3c',
            '03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556',
            '025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357',
            '03d30199d74fb5a22d47b6e054e2f378cedacffcb89904a61d75d0dbd407143e65',
            '023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb',
            '03acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe'
        ];
        
        // 64-character X-only keys for Taproot (20 keys)
        const xOnlyKeys = [
            'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
            'a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd',
            'defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34',
            '4cf034640859162ba19ee5a5a33e713a86e2e285b79cdaf9d5db4a07aa59f765',
            '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
            'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
            '774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb',
            'e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13',
            'd01115d548e7561b15c38f004d734633687cf4419620095bc5b0f47070afe85a',
            '791ca97e3d5c1dc6bc7e7e1a1e5fc19b90e0e8b1f9f0f1b2c3d4e5f6a7b8c9',
            '581c63a4f65b4dfb3baf7d5c3e5a6d4f0e7b2c8a9f1d3e4b2a5c6d7e8f9a0b',
            '2f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
            'bf0e7b0c8a7b1f9a3e4d2c5b6a8f9d0e7c1b4a3f6e9d2c5b8a1f4e7d0c3b6a',
            '2c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991',
            '0e46e79a2a8d12b9b21b533e2f1c6d5a7f8e9c0b1d2a3f4e5c6b7a8f9d0e3c',
            'fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556',
            '5476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357',
            'd30199d74fb5a22d47b6e054e2f378cedacffcb89904a61d75d0dbd407143e65',
            '3da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb',
            'acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe'
        ];
        
        // Get selected context
        const selectedContext = document.querySelector('input[name="context"]:checked')?.value || 'segwit';
        
        // Choose key pool based on context
        let keyPool;
        if (selectedContext === 'taproot') {
            keyPool = xOnlyKeys; // 64-character X-only keys for Taproot
        } else {
            keyPool = compressedKeys; // 66-character compressed keys for Legacy/Segwit
        }
        
        // Get already used keys
        const usedKeys = Array.from(this.keyVariables.values());
        
        // Filter out already used keys from the appropriate pool
        const availableKeys = keyPool.filter(key => !usedKeys.includes(key));
        
        // If all keys are used, return a random one anyway
        const keysToUse = availableKeys.length > 0 ? availableKeys : keyPool;
        
        // Use private key bytes to deterministically select from available keys
        const index = privateKey.reduce((acc, byte) => acc + byte, 0) % keysToUse.length;
        return keysToUse[index];
    }

    addKeyVariable() {
        const name = document.getElementById('key-name-input').value.trim();
        const value = document.getElementById('key-value-input').value.trim();

        if (!name || !value) {
            alert('Please enter both key name and value.');
            return;
        }

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            alert('Key name must start with a letter or underscore and contain only letters, numbers, and underscores.');
            return;
        }

        // Add or update key variable
        this.keyVariables.set(name, value);
        this.saveKeyVariables();
        this.displayKeyVariables();

        // Clear inputs
        document.getElementById('key-name-input').value = '';
        document.getElementById('key-value-input').value = '';
        document.getElementById('key-name-input').focus();
    }

    deleteKeyVariable(name) {
        if (!confirm(`Are you sure you want to delete key variable "${name}"?`)) {
            return;
        }
        
        this.keyVariables.delete(name);
        this.saveKeyVariables();
        this.displayKeyVariables();
    }

    displayKeyVariables() {
        const listDiv = document.getElementById('key-variables-list');
        
        if (this.keyVariables.size === 0) {
            listDiv.innerHTML = '<p style="color: var(--text-muted); font-style: italic; font-size: 14px;">No key variables defined.</p>';
            return;
        }

        listDiv.innerHTML = Array.from(this.keyVariables.entries()).map(([name, value]) => {
            let keyClass, badgeText;
            
            if (value.startsWith('xpub')) {
                keyClass = 'xpub';
                badgeText = 'xpub';
            } else if (value.startsWith('tpub')) {
                keyClass = 'tpub';
                badgeText = 'tpub';
            } else if (value.length === 64) {
                keyClass = 'xonly';
                badgeText = 'x-only';
            } else {
                keyClass = 'compressed';
                badgeText = 'compressed';
            }
            
            return `
            <div class="key-variable-item">
                <div class="key-info">
                    <div class="key-name">${this.escapeHtml(name)}</div>
                    <div class="key-value ${keyClass}">
                        <span>${this.escapeHtml(value)}</span>
                        <span class="key-badge ${keyClass}">${badgeText}</span>
                    </div>
                </div>
                <button onclick="compiler.deleteKeyVariable('${this.escapeHtml(name)}')" class="danger-btn" style="padding: 4px 8px; font-size: 10px; flex-shrink: 0;">Del</button>
            </div>
            `;
        }).join('');
    }

    loadKeyVariables() {
        try {
            const saved = localStorage.getItem('miniscript-key-variables');
            if (saved) {
                const keyVars = JSON.parse(saved);
                this.keyVariables = new Map(Object.entries(keyVars));
            } else {
                // Add default keys if none exist
                this.addDefaultKeys();
            }
            this.displayKeyVariables();
        } catch (error) {
            console.error('Failed to load key variables:', error);
            this.keyVariables = new Map();
            this.addDefaultKeys();
        }
    }

    addDefaultKeys() {
        // Default keys used in examples
        // Compressed keys (for Legacy/Segwit)
        this.keyVariables.set('Alice', '03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd');
        this.keyVariables.set('Bob', '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9');
        this.keyVariables.set('Charlie', '03defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34');
        this.keyVariables.set('Eva', '034cf034640859162ba19ee5a5a33e713a86e2e285b79cdaf9d5db4a07aa59f765');
        this.keyVariables.set('Frank', '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
        this.keyVariables.set('Lara', '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
        
        // X-only keys (for Taproot) - unique keys, not related to compressed keys above
        this.keyVariables.set('David', '0b432b2677937381aef05bb02a66ecd012773062cf3fa2549e44f58ed2401710');
        this.keyVariables.set('Helen', '5cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc');
        this.keyVariables.set('Ivan', '6aebca40ba255960a3178d6d861a54dba813d0b813fde7b5a5082628087264da');
        this.keyVariables.set('Julia', 'c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9');
        this.keyVariables.set('Karl', 'dd308afec5777e13121fa72b9cc1b7cc0139715309b086c960e18fd969774eb8');
        
        // Complex descriptor keys
        this.keyVariables.set('TestnetKey', '[C8FE8D4F/48h/1h/123h/2h]tpubDET9Lf3UsPRZP7TVNV8w91Kz8g29sVihfr96asYsJqUsx5pM7cDvSCDAsidkQY9bgfPyB28bCA4afiJcJp6bxZhrzmjFYDUm92LG3s3tmP7/1/1');
        this.keyVariables.set('MainnetKey', '[C8FE8D4F/48h/1h/123h/2h]xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda/0/0');
        this.keyVariables.set('RangeKey', '[C8FE8D4F/48h/1h/123h/2h]tpubDET9Lf3UsPRZP7TVNV8w91Kz8g29sVihfr96asYsJqUsx5pM7cDvSCDAsidkQY9bgfPyB28bCA4afiJcJp6bxZhrzmjFYDUm92LG3s3tmP7/<1;0>/*');
        
        // Vault keys for complex multi-signature examples
        this.keyVariables.set('VaultKey1', '[7FBA5C83/48h/1h/123h/2h]tpubDE5BZRXogAy3LHDKYhfuw2gCasYxsfKPLrfdsS9GxAV45v7u2DAcBGCVKPYjLgYeMMKq29aAHy2xovHL9KTd8VvpMHfPiDA9jzBwCg73N5H/<6;7>/*');
        this.keyVariables.set('VaultKey2', '[CB6FE460/48h/1h/123h/2h]tpubDFJbyzFGfyGhwjc2CP7YHjD3hK53AoQWU2Q5eABX2VXcnEBxWVVHjtZhzg9PQLnoHe6iKjR3TamW3N9RVAY5WBbK5DBAs1D86wi2DEgMwpN/<12;13>/*');
        this.keyVariables.set('VaultKey3', '[9F996716/48h/1h/0h/2h]tpubDFCY8Uy2eRq7meifV2Astvt8AsTLsrMX7vj7cLtZ6aPRcYGsAL4PXY1JZR2SfD3i2CRAwy9fm9Cq3xVeuWsvAcRnz9oc1umGL68Wn9QeT3q/<16;17>/*');
        this.keyVariables.set('VaultKey4', '[0A4E923E/48h/1h/123h/2h]tpubDFNEWRT6uX3mjWE2c6CnbdQ7awvvnGub5s9ntaSyoQ4SSNmhHEc6RJ4Exwd2aLfGppDhvvey7gvYc7jiYfDFWtYG2sKXjKthhSs1X9yBkSy/<16;17>/*');
        
        this.saveKeyVariables();
        this.displayKeyVariables();
    }

    restoreDefaultKeys() {
        if (confirm('This will restore 14 default key variables: Alice, Bob, Charlie, Eva, Frank, Lara, David, Helen, Ivan, Julia, Karl, TestnetKey, MainnetKey, RangeKey. Continue?')) {
            this.addDefaultKeys();
        }
    }

    clearAllKeys() {
        if (confirm('Are you sure you want to delete ALL key variables? This cannot be undone.')) {
            this.keyVariables.clear();
            this.saveKeyVariables();
            this.displayKeyVariables();
            
            // Hide description panels
            const policyPanel = document.querySelector('.policy-description-panel');
            const miniscriptPanel = document.querySelector('.miniscript-description-panel');
            if (policyPanel) policyPanel.style.display = 'none';
            if (miniscriptPanel) miniscriptPanel.style.display = 'none';
        }
    }

    saveKeyVariables() {
        try {
            const keyVars = Object.fromEntries(this.keyVariables);
            localStorage.setItem('miniscript-key-variables', JSON.stringify(keyVars));
        } catch (error) {
            console.error('Failed to save key variables:', error);
        }
    }


    displayResults(result) {
        const resultsDiv = document.getElementById('results');
        resultsDiv.innerHTML = '';

        if (!result.success) {
            return;
        }

        // Show compiled miniscript (for policy compilation)
        if (result.compiled_miniscript) {
            const miniscriptDiv = document.createElement('div');
            miniscriptDiv.className = 'result-box info';
            miniscriptDiv.innerHTML = `
                <h4>🔄 Compiled miniscript</h4>
                <textarea readonly style="width: 100%; min-height: 60px; margin-top: 10px; font-family: monospace; background: var(--info-bg); padding: 10px; border-radius: 4px; border: 1px solid var(--border-color); resize: vertical; color: var(--text-color); box-sizing: border-box;">${result.compiled_miniscript}</textarea>
            `;
            resultsDiv.appendChild(miniscriptDiv);
        }

        // Show script hex
        if (result.script) {
            const scriptDiv = document.createElement('div');
            scriptDiv.className = 'result-box info';
            scriptDiv.innerHTML = `
                <h4>📜 Generated script (hex)</h4>
                <textarea readonly style="width: 100%; min-height: 60px; margin-top: 10px; font-family: monospace; background: var(--info-bg); padding: 10px; border-radius: 4px; border: 1px solid var(--border-color); resize: vertical; color: var(--text-color); box-sizing: border-box;">${result.script}</textarea>
            `;
            resultsDiv.appendChild(scriptDiv);
        }

        // Show script ASM
        if (result.script_asm) {
            const scriptAsmDiv = document.createElement('div');
            scriptAsmDiv.className = 'result-box info';
            
            const simplifiedAsm = this.simplifyAsm(result.script_asm);
            const currentAsm = document.getElementById('hide-pushbytes') && document.getElementById('hide-pushbytes').checked ? 
                simplifiedAsm : result.script_asm;
                
            scriptAsmDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h4 style="margin: 0;">⚡ Bitcoin script (ASM)</h4>
                    <label style="display: flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer; font-weight: normal;">
                        <input type="checkbox" id="hide-pushbytes" ${document.getElementById('hide-pushbytes') && document.getElementById('hide-pushbytes').checked ? 'checked' : ''} style="margin: 0;">
                        Hide pushbytes
                    </label>
                </div>
                <textarea readonly id="script-asm-display" style="width: 100%; min-height: 80px; font-family: monospace; background: var(--info-bg); padding: 10px; border-radius: 4px; border: 1px solid var(--border-color); resize: vertical; color: var(--text-color); box-sizing: border-box;">${currentAsm}</textarea>
            `;
            
            // Add event listener for checkbox
            const checkbox = scriptAsmDiv.querySelector('#hide-pushbytes');
            const display = scriptAsmDiv.querySelector('#script-asm-display');
            checkbox.addEventListener('change', () => {
                display.value = checkbox.checked ? simplifiedAsm : result.script_asm;
            });
            
            resultsDiv.appendChild(scriptAsmDiv);
        }

        // Show address if available
        if (result.address) {
            const addressDiv = document.createElement('div');
            addressDiv.className = 'result-box info';
            addressDiv.innerHTML = `
                <h4>🏠 Generated address</h4>
                <div style="word-break: break-all; margin-top: 10px; font-family: monospace; background: var(--info-bg); padding: 10px; border-radius: 4px; border: 1px solid var(--border-color);">
                    ${result.address}
                </div>
            `;
            resultsDiv.appendChild(addressDiv);
        } else {
            const noAddressDiv = document.createElement('div');
            noAddressDiv.className = 'result-box info';
            noAddressDiv.innerHTML = `
                <h4>ℹ️ Note</h4>
                <div style="margin-top: 10px;">
                    Address generation not available for this miniscript type without additional context.
                </div>
            `;
            resultsDiv.appendChild(noAddressDiv);
        }
    }

    showError(message) {
        const resultsDiv = document.getElementById('results');
        resultsDiv.innerHTML = `
            <div class="result-box error">
                <h4>❌ Error</h4>
                <div style="margin-top: 10px;">${message}</div>
            </div>
        `;
    }

    showMiniscriptError(message) {
        const messagesDiv = document.getElementById('miniscript-messages');
        let additionalHelp = '';
        
        // Check if this is a missing key variable error (same logic as policy errors)
        const keyLengthMatch = message.match(/pubkey string should be (?:66|130) (?:or \d+ )?digits(?: long)?, got: (\d+)/);
        if (keyLengthMatch) {
            const gotLength = parseInt(keyLengthMatch[1]);
            // Check if this looks like a key name (short length, likely under 20 chars)
            if (gotLength < 20) {
                // Try to find what key name might be missing from the expression
                const expressionText = document.getElementById('expression-input').textContent || '';
                // Common key names that match this length
                const commonKeys = ['Alice', 'Bob', 'Charlie', 'David', 'Eva', 'Frank', 'Lara', 'Helen', 'Ivan', 'Julia', 'Karl', 'TestnetKey', 'MainnetKey'];
                const missingKey = commonKeys.find(key => key.length === gotLength && expressionText.includes(key));
                
                if (missingKey) {
                    additionalHelp = `
                        <div style="margin-top: 15px; padding: 12px; background: var(--warning-bg, rgba(251, 191, 36, 0.1)); border: 1px solid var(--warning-border, rgba(251, 191, 36, 0.3)); border-radius: 6px;">
                            <strong>💡 Tip:</strong> The key variable "<strong>${missingKey}</strong>" appears to be missing or undefined.
                            <br>→ Check the <strong>Key variables</strong> section to see if it exists
                            <br>→ Click <strong>"Restore defaults"</strong> to add common keys (Alice, Bob, Charlie, etc.)
                            <br>→ Or add it manually with a valid 66-character public key
                        </div>
                    `;
                } else if (gotLength <= 15) {
                    // Generic help for short strings that look like variable names
                    additionalHelp = `
                        <div style="margin-top: 15px; padding: 12px; background: var(--warning-bg, rgba(251, 191, 36, 0.1)); border: 1px solid var(--warning-border, rgba(251, 191, 36, 0.3)); border-radius: 6px;">
                            <strong>💡 Tip:</strong> This looks like a missing key variable (got ${gotLength} characters instead of a public key).
                            <br>→ Check the <strong>Key variables</strong> section
                            <br>→ Click <strong>"Restore defaults"</strong> to add common keys
                            <br>→ Or define your custom key with a valid 66-character public key
                        </div>
                    `;
                }
            }
        }
        
        messagesDiv.innerHTML = `
            <div class="result-box error" style="margin: 0;">
                <h4>❌ Miniscript error</h4>
                <div style="margin-top: 10px;">${message}</div>
                ${additionalHelp}
            </div>
        `;
    }

    showMiniscriptSuccess(message) {
        const messagesDiv = document.getElementById('miniscript-messages');
        messagesDiv.innerHTML = `
            <div class="result-box success" style="margin: 0;">
                <h4>✅ Success</h4>
                <div style="margin-top: 10px;">${message}</div>
            </div>
        `;
    }

    clearMiniscriptMessages() {
        document.getElementById('miniscript-messages').innerHTML = '';
    }

    handleReplaceKeysToggle(isChecked) {
        console.log('=== handleReplaceKeysToggle START ===');
        console.log('isChecked:', isChecked);
        
        const expressionInput = document.getElementById('expression-input');
        if (!expressionInput) {
            console.error('Expression input not found!');
            return;
        }
        
        let expression = expressionInput.textContent;
        console.log('Current expression:', `"${expression}"`);
        console.log('Expression length:', expression.length);
        
        console.log('this.keyVariables type:', typeof this.keyVariables);
        console.log('this.keyVariables size:', this.keyVariables ? this.keyVariables.size : 'undefined');
        console.log('Key variables entries:', Array.from(this.keyVariables.entries()));

        if (!expression.trim()) {
            console.log('Expression is empty, returning');
            return;
        }

        let originalExpression = expression;
        
        if (isChecked) {
            console.log('=== REPLACING KEYS WITH NAMES ===');
            expression = this.replaceKeysWithNames(expression);
        } else {
            console.log('=== REPLACING NAMES WITH KEYS ===');
            expression = this.replaceNamesWithKeys(expression);
        }

        console.log('Original expression:', `"${originalExpression}"`);
        console.log('New expression:     ', `"${expression}"`);
        console.log('Changed:', originalExpression !== expression);
        
        expressionInput.textContent = expression;
        this.highlightMiniscriptSyntax();
        console.log('=== handleReplaceKeysToggle END ===');
    }

    replaceKeysWithNames(text) {
        let processedText = text;
        // Sort by key length (descending) to replace longer keys first
        // This prevents partial matches with shorter keys
        const sortedVariables = Array.from(this.keyVariables.entries())
            .sort((a, b) => b[1].length - a[1].length);
        
        // Two-pass replacement to avoid collisions
        // First pass: Replace keys with unique temporary markers
        const tempMarkers = new Map();
        let tempIndex = 0;
        for (const [name, value] of sortedVariables) {
            const marker = `__TEMP_KEY_${tempIndex}__`;
            tempMarkers.set(marker, name);
            processedText = processedText.split(value).join(marker);
            tempIndex++;
        }
        
        // Second pass: Replace markers with actual names
        for (const [marker, name] of tempMarkers) {
            processedText = processedText.split(marker).join(name);
        }
        
        return processedText;
    }

    replaceNamesWithKeys(text) {
        let processedText = text;
        // Sort by name length (descending) to replace longer names first
        const sortedVariables = Array.from(this.keyVariables.entries())
            .sort((a, b) => b[0].length - a[0].length);
        
        for (const [name, value] of sortedVariables) {
            // Use word boundaries for variable names to avoid partial matches
            const regex = new RegExp('\\b' + this.escapeRegex(name) + '\\b', 'g');
            processedText = processedText.replace(regex, value);
        }
        return processedText;
    }

    containsKeyNames(text) {
        // Check if text contains any of our key variable names (like ALICE, BOB, etc.)
        for (const [name] of this.keyVariables) {
            const regex = new RegExp('\\b' + name + '\\b', 'i');
            if (regex.test(text)) {
                return true;
            }
        }
        return false;
    }

    handlePolicyReplaceKeysToggle(isChecked) {
        console.log('=== handlePolicyReplaceKeysToggle START ===');
        console.log('isChecked:', isChecked);
        
        const policyInput = document.getElementById('policy-input');
        if (!policyInput) {
            console.error('Policy input not found!');
            return;
        }
        
        let policy = policyInput.textContent;
        console.log('Current policy:', `"${policy}"`);
        
        if (!policy.trim()) {
            console.log('Policy is empty, returning');
            return;
        }

        let originalPolicy = policy;
        
        if (isChecked) {
            console.log('=== REPLACING KEYS WITH NAMES ===');
            policy = this.replaceKeysWithNames(policy);
        } else {
            console.log('=== REPLACING NAMES WITH KEYS ===');
            policy = this.replaceNamesWithKeys(policy);
        }

        console.log('Processed policy:', policy);
        
        policyInput.textContent = policy;
        this.highlightPolicySyntax();
        console.log('=== handlePolicyReplaceKeysToggle END ===');
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    setupReplaceKeysCheckbox() {
        console.log('Setting up replace keys buttons');
        // Initialize both toggle button states
        setTimeout(() => {
            const miniscriptToggleBtn = document.getElementById('key-names-toggle');
            if (miniscriptToggleBtn) {
                miniscriptToggleBtn.dataset.active = 'false';
                console.log('Miniscript toggle button initialized');
            }
            
            const policyToggleBtn = document.getElementById('policy-key-names-toggle');
            if (policyToggleBtn) {
                policyToggleBtn.dataset.active = 'false';
                console.log('Policy toggle button initialized');
            }
        }, 100);
    }

    clearExpression() {
        document.getElementById('expression-input').innerHTML = '';
        document.getElementById('results').innerHTML = '';
        this.clearMiniscriptMessages();
        
        // Clear and uncheck the "Show key names" checkbox
        const toggleBtn = document.getElementById('key-names-toggle');
        if (toggleBtn) {
            toggleBtn.style.color = 'var(--text-secondary)';
            toggleBtn.title = 'Show key names';
            toggleBtn.dataset.active = 'false';
        }
        
        // Hide description panel
        const miniscriptPanel = document.querySelector('.miniscript-description-panel');
        if (miniscriptPanel) miniscriptPanel.style.display = 'none';
    }

    showSaveModal() {
        const expression = document.getElementById('expression-input').textContent.trim();
        if (!expression) {
            this.showMiniscriptError('Please enter an expression to save.');
            return;
        }
        
        document.getElementById('save-modal').style.display = 'block';
        document.getElementById('save-name').focus();
    }

    hideSaveModal() {
        document.getElementById('save-modal').style.display = 'none';
        document.getElementById('save-name').value = '';
        // Remove any existing error messages
        const errorDiv = document.querySelector('#save-modal .modal-error');
        if (errorDiv) errorDiv.remove();
    }

    saveExpression() {
        const name = document.getElementById('save-name').value.trim();
        const expression = document.getElementById('expression-input').textContent.trim();

        if (!name) {
            this.showModalError('Please enter a name for the expression.');
            return;
        }

        if (name.length > 50) {
            this.showModalError('Expression name must be 50 characters or less.');
            return;
        }

        if (!expression) {
            this.showModalError('No expression to save.');
            return;
        }

        // Get existing expressions
        const savedExpressions = this.getSavedExpressions();
        
        // Check storage limits (keep max 20 expressions)
        if (savedExpressions.length >= 20 && !savedExpressions.some(expr => expr.name === name)) {
            this.showModalError('Maximum 20 expressions allowed. Please delete some first.');
            return;
        }
        
        // Check if name already exists
        if (savedExpressions.some(expr => expr.name === name)) {
            if (!confirm(`An expression named "${this.escapeHtml(name)}" already exists. Overwrite?`)) {
                return;
            }
            // Remove existing
            savedExpressions.splice(savedExpressions.findIndex(expr => expr.name === name), 1);
        }

        // Add new expression with context
        const context = document.querySelector('input[name="context"]:checked').value;
        savedExpressions.push({
            name: name,
            expression: expression,
            context: context,
            timestamp: new Date().toISOString()
        });

        // Save to localStorage
        this.setSavedExpressions(savedExpressions);
        
        // Refresh the list
        this.loadSavedExpressions();
        
        // Hide modal
        this.hideSaveModal();
        
        // Show success message
        this.showSuccess(`Expression "${this.escapeHtml(name)}" has been saved!`);
    }

    showModalError(message) {
        const modalContent = document.querySelector('#save-modal .modal-content');
        let errorDiv = modalContent.querySelector('.modal-error');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'modal-error';
            errorDiv.style.cssText = 'background: #fed7d7; border: 1px solid #fc8181; color: #c53030; padding: 10px; border-radius: 4px; margin: 10px 0; font-size: 14px;';
            modalContent.insertBefore(errorDiv, modalContent.querySelector('.button-group'));
        }
        errorDiv.textContent = message;
        setTimeout(() => errorDiv.remove(), 3000);
    }

    showSuccess(message) {
        const resultsDiv = document.getElementById('results');
        const successDiv = document.createElement('div');
        successDiv.className = 'result-box success';
        successDiv.innerHTML = `<h4>✅ Success</h4><div>${message}</div>`;
        resultsDiv.appendChild(successDiv);
        
        // Auto-remove success message after 3 seconds
        setTimeout(() => successDiv.remove(), 3000);
    }

    loadSavedExpressions() {
        const expressions = this.getSavedExpressions();
        const listDiv = document.getElementById('expressions-list');
        
        if (expressions.length === 0) {
            listDiv.innerHTML = '<p style="color: #718096; font-style: italic;">No saved expressions yet.</p>';
            return;
        }

        listDiv.innerHTML = expressions.map(expr => `
            <div class="expression-item">
                <div class="expression-info">
                    <div class="expression-name">${this.escapeHtml(expr.name)}</div>
                    <div class="expression-preview">${this.escapeHtml(expr.expression)}</div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px; flex-shrink: 0;">
                    <button onclick="compiler.loadExpression('${this.escapeHtml(expr.name)}')" class="secondary-btn" style="padding: 4px 8px; font-size: 10px;">Load</button>
                    <button onclick="compiler.deleteExpression('${this.escapeHtml(expr.name)}')" class="danger-btn" style="padding: 4px 8px; font-size: 10px;">Del</button>
                </div>
            </div>
        `).join('');
    }

    loadExpression(name) {
        const expressions = this.getSavedExpressions();
        const savedExpr = expressions.find(expr => expr.name === name);
        
        if (savedExpr) {
            document.getElementById('expression-input').textContent = savedExpr.expression;
            this.highlightMiniscriptSyntax();
            
            // Update toggle button state based on loaded content
            const containsKeyNames = this.containsKeyNames(savedExpr.expression);
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
            
            // Auto-detect context based on key formats in the expression
            const detectedContext = this.detectContextFromExpression(savedExpr.expression);
            const context = detectedContext || savedExpr.context || 'segwit';
            document.querySelector(`input[name="context"][value="${context}"]`).checked = true;
            
            // Clear previous results and messages
            document.getElementById('results').innerHTML = '';
            this.clearMiniscriptMessages();
            
            // Hide description panel
            const miniscriptPanel = document.querySelector('.miniscript-description-panel');
            if (miniscriptPanel) miniscriptPanel.style.display = 'none';
            
            // Reset the "Show key names" checkbox
            const checkbox = document.getElementById('replace-keys-checkbox');
            if (checkbox) {
                checkbox.checked = false;
            }
        }
    }

    deleteExpression(name) {
        if (!confirm(`Are you sure you want to delete "${name}"?`)) {
            return;
        }

        const expressions = this.getSavedExpressions();
        const filteredExpressions = expressions.filter(expr => expr.name !== name);
        this.setSavedExpressions(filteredExpressions);
        this.loadSavedExpressions();
    }

    getSavedExpressions() {
        try {
            const saved = localStorage.getItem('miniscript-expressions');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Failed to load saved expressions:', error);
            return [];
        }
    }

    setSavedExpressions(expressions) {
        try {
            localStorage.setItem('miniscript-expressions', JSON.stringify(expressions));
        } catch (error) {
            console.error('Failed to save expressions:', error);
            alert('Failed to save expression. Local storage might be full.');
        }
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    simplifyAsm(scriptAsm) {
        // Remove only the pushbytes operations, keep the hex data (keys) and other ops
        return scriptAsm
            .replace(/OP_PUSHBYTES_\d+\s+/g, '')
            .replace(/OP_PUSHDATA\d?\s+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    detectContextFromExpression(expression) {
        // First check for direct hex keys in the expression
        const hexPattern = /[0-9a-fA-F]{64,66}/g;
        const hexMatches = expression.match(hexPattern);
        
        // Also check for key variable names that might reference our known keys
        const keyVariablePattern = /[A-Za-z_][A-Za-z0-9_]*/g;
        const variableMatches = expression.match(keyVariablePattern);
        
        let hasXOnlyKeys = false;
        let hasCompressedKeys = false;
        
        // Check direct hex keys
        if (hexMatches) {
            for (const match of hexMatches) {
                if (match.length === 64) {
                    hasXOnlyKeys = true;
                } else if (match.length === 66 && (match.startsWith('02') || match.startsWith('03'))) {
                    hasCompressedKeys = true;
                }
            }
        }
        
        // Check key variable names against our known keys
        if (variableMatches && this.keyVariables) {
            for (const variable of variableMatches) {
                if (this.keyVariables.has(variable)) {
                    const keyValue = this.keyVariables.get(variable);
                    if (keyValue.length === 64) {
                        hasXOnlyKeys = true;
                    } else if (keyValue.length === 66 && (keyValue.startsWith('02') || keyValue.startsWith('03'))) {
                        hasCompressedKeys = true;
                    }
                }
            }
        }
        
        // Determine context based on key types found
        if (hasXOnlyKeys && !hasCompressedKeys) {
            return 'taproot';
        } else if (hasCompressedKeys && !hasXOnlyKeys) {
            // For compressed keys, default to segwit (user can manually switch to legacy if needed)
            return 'segwit';
        } else if (hasXOnlyKeys && hasCompressedKeys) {
            // Mixed key types - this is unusual, default to segwit
            return 'segwit';
        }
        
        return null; // No clear determination
    }

    // Policy saving methods (identical to expression saving)
    showSavePolicyModal() {
        const policy = document.getElementById('policy-input').textContent.trim();
        if (!policy) {
            this.showPolicyError('Please enter a policy to save.');
            return;
        }
        
        document.getElementById('save-policy-modal').style.display = 'block';
        document.getElementById('save-policy-name').focus();
    }

    hideSavePolicyModal() {
        document.getElementById('save-policy-modal').style.display = 'none';
        document.getElementById('save-policy-name').value = '';
        // Remove any existing error messages
        const errorDiv = document.querySelector('#save-policy-modal .modal-error');
        if (errorDiv) errorDiv.remove();
    }

    savePolicy() {
        const name = document.getElementById('save-policy-name').value.trim();
        const policy = document.getElementById('policy-input').textContent.trim();

        if (!name) {
            this.showPolicyModalError('Please enter a name for the policy.');
            return;
        }

        if (name.length > 50) {
            this.showPolicyModalError('Policy name must be 50 characters or less.');
            return;
        }

        if (!policy) {
            this.showPolicyModalError('No policy to save.');
            return;
        }

        // Get existing policies
        const savedPolicies = this.getSavedPolicies();
        
        // Check storage limits (keep max 20 policies)
        if (savedPolicies.length >= 20 && !savedPolicies.some(pol => pol.name === name)) {
            this.showPolicyModalError('Maximum 20 policies allowed. Please delete some first.');
            return;
        }
        
        // Check if name already exists
        if (savedPolicies.some(pol => pol.name === name)) {
            if (!confirm(`A policy named "${this.escapeHtml(name)}" already exists. Overwrite?`)) {
                return;
            }
            // Remove existing
            savedPolicies.splice(savedPolicies.findIndex(pol => pol.name === name), 1);
        }

        // Add new policy with context
        const context = document.querySelector('input[name="context"]:checked').value;
        savedPolicies.push({
            name: name,
            expression: policy,
            context: context,
            timestamp: new Date().toISOString()
        });

        // Save to localStorage
        this.setSavedPolicies(savedPolicies);
        
        // Refresh the list
        this.loadSavedPolicies();
        
        // Hide modal
        this.hideSavePolicyModal();
        
        // Show success message
        this.showSuccess(`Policy "${this.escapeHtml(name)}" has been saved!`);
    }

    showPolicyModalError(message) {
        const modalContent = document.querySelector('#save-policy-modal .modal-content');
        let errorDiv = modalContent.querySelector('.modal-error');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'modal-error';
            errorDiv.style.cssText = 'background: var(--error-bg); border: 1px solid var(--error-border); color: var(--error-text); padding: 10px; border-radius: 4px; margin: 10px 0; font-size: 14px;';
            modalContent.insertBefore(errorDiv, modalContent.querySelector('.button-group'));
        }
        errorDiv.textContent = message;
        setTimeout(() => errorDiv.remove(), 3000);
    }

    loadSavedPolicies() {
        const policies = this.getSavedPolicies();
        const listDiv = document.getElementById('policies-list');
        
        if (policies.length === 0) {
            listDiv.innerHTML = '<p style="color: var(--text-muted); font-style: italic; font-size: 14px;">No saved policies yet.</p>';
            return;
        }

        listDiv.innerHTML = policies.map(policy => `
            <div class="expression-item">
                <div class="expression-info">
                    <div class="expression-name">${this.escapeHtml(policy.name)}</div>
                    <div class="expression-preview">${this.escapeHtml(policy.expression)}</div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px; flex-shrink: 0;">
                    <button onclick="compiler.loadPolicy('${this.escapeHtml(policy.name)}')" class="secondary-btn" style="padding: 4px 8px; font-size: 10px;">Load</button>
                    <button onclick="compiler.deletePolicy('${this.escapeHtml(policy.name)}')" class="danger-btn" style="padding: 4px 8px; font-size: 10px;">Del</button>
                </div>
            </div>
        `).join('');
    }

    loadPolicy(name) {
        const policies = this.getSavedPolicies();
        const savedPolicy = policies.find(policy => policy.name === name);
        
        if (savedPolicy) {
            document.getElementById('policy-input').textContent = savedPolicy.expression;
            this.highlightPolicySyntax();
            
            // Update policy toggle button state based on loaded content
            const containsKeyNames = this.containsKeyNames(savedPolicy.expression);
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
            
            // Auto-detect context based on key formats in the policy
            const detectedContext = this.detectContextFromExpression(savedPolicy.expression);
            const context = detectedContext || savedPolicy.context || 'segwit';
            document.querySelector(`input[name="context"][value="${context}"]`).checked = true;
            
            // Clear previous results
            document.getElementById('results').innerHTML = '';
            this.clearPolicyErrors();
            
            // Hide description panel
            const policyPanel = document.querySelector('.policy-description-panel');
            if (policyPanel) policyPanel.style.display = 'none';
            
            // Reset the "Show key names" checkbox
            const checkbox = document.getElementById('replace-keys-checkbox');
            if (checkbox) {
                checkbox.checked = false;
            }
        }
    }

    deletePolicy(name) {
        if (!confirm(`Are you sure you want to delete policy "${name}"?`)) {
            return;
        }

        const policies = this.getSavedPolicies();
        const filteredPolicies = policies.filter(policy => policy.name !== name);
        this.setSavedPolicies(filteredPolicies);
        this.loadSavedPolicies();
    }

    getSavedPolicies() {
        try {
            const saved = localStorage.getItem('miniscript-policies');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Failed to load saved policies:', error);
            return [];
        }
    }

    setSavedPolicies(policies) {
        try {
            localStorage.setItem('miniscript-policies', JSON.stringify(policies));
        } catch (error) {
            console.error('Failed to save policies:', error);
            alert('Failed to save policy. Local storage might be full.');
        }
    }
}

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
window.loadExample = function(example) {
    document.getElementById('expression-input').textContent = example;
    if (window.compiler && window.compiler.highlightMiniscriptSyntax) {
        window.compiler.highlightMiniscriptSyntax();
    }
    document.getElementById('results').innerHTML = '';
    if (window.compiler && window.compiler.clearMiniscriptMessages) {
        window.compiler.clearMiniscriptMessages();
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
    
    // Auto-detect context based on key formats in the example (only if compiler is ready)
    if (window.compiler && window.compiler.detectContextFromExpression) {
        const detectedContext = window.compiler.detectContextFromExpression(example);
        const context = detectedContext || 'segwit';
        document.querySelector(`input[name="context"][value="${context}"]`).checked = true;
    }
    
    // Reset the "Show key names" checkbox
    const checkbox = document.getElementById('replace-keys-checkbox');
    if (checkbox) {
        checkbox.checked = false;
    }
};

// Global function to load policy examples
window.loadPolicyExample = function(example) {
    console.log('🚀 loadPolicyExample (from script.js) called with:', example);
    
    document.getElementById('policy-input').textContent = example;
    document.getElementById('expression-input').innerHTML = '';
    document.getElementById('results').innerHTML = '';
    document.getElementById('policy-errors').innerHTML = '';
    
    if (window.compiler && window.compiler.highlightPolicySyntax) {
        window.compiler.highlightPolicySyntax();
    }
    
    // SAVE STATE FOR UNDO
    if (window.compiler && window.compiler.saveState) {
        console.log('🚀 Saving policy state for undo');
        window.compiler.saveState('policy', true);
        window.compiler.saveState('miniscript', true);
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
    
    // Auto-detect context based on key formats in the example (only if compiler is ready)
    if (window.compiler && window.compiler.detectContextFromExpression) {
        const detectedContext = window.compiler.detectContextFromExpression(example);
        const context = detectedContext || 'segwit';
        document.querySelector(`input[name="context"][value="${context}"]`).checked = true;
    }
    
    // Reset the "Show key names" checkbox since we cleared the miniscript
    const checkbox = document.getElementById('replace-keys-checkbox');
    if (checkbox) {
        checkbox.checked = false;
    }
};

// Global function to show policy descriptions
window.showPolicyDescription = function(exampleId) {
    const panel = document.getElementById('policy-description');
    const contentDiv = panel.querySelector('.description-content');
    
    const descriptions = {
        'single': {
            title: '📄 Single Key Policy',
            conditions: '🔓 Alice: Immediate spending (no restrictions)',
            useCase: 'Personal wallet with single owner. Simple and efficient for individual use.',
            security: '⚠️ Single point of failure - if Alice loses her key, funds are lost'
        },
        'or': {
            title: '📄 OR Keys Policy',
            conditions: '🔓 Alice: Can spend immediately\n🔓 Bob: Can spend immediately',
            useCase: 'Shared wallet where either party can spend. Useful for joint accounts or backup access.',
            security: '💡 Either key compromise results in fund loss'
        },
        'and': {
            title: '📄 AND Keys Policy',
            conditions: '🔓 Alice + Bob: Both signatures required',
            useCase: '2-of-2 multisig. Both parties must agree to spend. Common for business partnerships.',
            security: '💡 More secure but requires cooperation of both parties'
        },
        'threshold': {
            title: '📄 2-of-3 Threshold Policy',
            conditions: '🔓 Any 2 of: Alice, Bob, Charlie',
            useCase: 'Board of directors or family trust. Prevents single point of failure while requiring majority.',
            security: '💡 Balanced security - survives 1 key loss, prevents 1 key compromise'
        },
        'timelock': {
            title: '📄 Timelock Policy',
            conditions: '🔓 Alice: Immediate spending\n⏰ Bob: After 144 blocks (~1 day)',
            useCase: 'Emergency access with delay. Alice has daily control, Bob can recover after waiting period.',
            security: '💡 Cooling-off period prevents rushed decisions'
        },
        'xonly': {
            title: '📄 Taproot X-only Key',
            conditions: '🔓 David: Immediate spending (Taproot context)',
            useCase: 'Demonstrates Taproot X-only public keys (64 characters). More efficient and private.',
            security: '💡 Taproot provides better privacy and efficiency'
        },
        'testnet_xpub': {
            title: '📄 Testnet Extended Public Key',
            conditions: '🔓 TestnetKey: HD wallet extended public key (testnet)',
            useCase: 'Demonstrates policy compilation with extended public keys (xpub/tpub). The compiler derives concrete keys from the descriptor.',
            security: '💡 HD wallets allow deterministic key generation from a single seed'
        },
        'corporate': {
            title: '📄 Corporate Wallet Policy',
            conditions: '🔓 Any 2 of: Alice, Bob, Charlie (board)\n⏰ Eva (CEO): After January 1, 2025',
            useCase: 'Corporate treasury with board oversight and emergency CEO access after specific date.',
            security: '💡 Board control with time-delayed executive override'
        },
        'recovery': {
            title: '📄 Emergency Recovery Policy',
            conditions: '🔓 Alice: Immediate spending (95% probability weight)\n⏰ Bob + Charlie + Eva: 2-of-3 after 1008 blocks (~1 week)',
            useCase: 'Personal wallet with family/friends emergency recovery. Alice controls daily, family can recover if needed. The 95@ weight tells miniscript compiler to optimize for Alice\'s path.',
            security: '💡 Probability weight helps wallets optimize fees and witness sizes for common usage'
        },
        'twofa': {
            title: '📄 2FA + Backup Policy',
            conditions: '🔓 Alice + (Bob + secret OR wait 1 year)',
            useCase: 'Two-factor authentication wallet. Alice + second device, or Alice alone after 1 year backup delay.',
            security: '💡 Strong 2FA security with long-term recovery option'
        },
        'inheritance': {
            title: '📄 Taproot Inheritance Policy',
            conditions: '🔓 David: Immediate spending\n⏰ Helen + Ivan + Julia: 2-of-3 after 26280 blocks (~6 months)',
            useCase: 'Estate planning. David controls funds, beneficiaries can inherit after extended waiting period.',
            security: '💡 Long delay ensures David has opportunity to intervene'
        },
        'delayed': {
            title: '📄 Taproot 2-of-2 OR Delayed',
            conditions: '🔓 Julia + Karl: Immediate 2-of-2 spending\n⏰ David: After 144 blocks (~1 day)',
            useCase: 'Joint account with single-party emergency access. Both parties agree, or one party after delay.',
            security: '💡 Cooperative control with individual fallback'
        }
    };
    
    const desc = descriptions[exampleId];
    if (desc) {
        contentDiv.innerHTML = `
            <h5 style="margin: 0 0 12px 0; color: var(--accent-color); font-size: 14px;">${desc.title}</h5>
            <div style="margin-bottom: 10px;">
                <strong style="color: var(--text-color); font-size: 12px;">Spending Conditions:</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); white-space: pre-line;">${desc.conditions}</div>
            </div>
            <div style="margin-bottom: 10px;">
                <strong style="color: var(--text-color); font-size: 12px;">Use Case:</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.useCase}</div>
            </div>
            <div>
                <strong style="color: var(--text-color); font-size: 12px;">Security Notes:</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.security}</div>
            </div>
        `;
        panel.style.display = 'block';
    }
};

// Global function to show miniscript descriptions
window.showMiniscriptDescription = function(exampleId) {
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
            title: '⚙️ Complex AND/OR Miniscript',
            structure: 'and_v(v:pk(Alice),or_b(pk(Bob),s:pk(Charlie))) → Alice AND (Bob OR Charlie)',
            bitcoinScript: 'Alice verified first, then Bob OR Charlie evaluated',
            useCase: 'Alice must always sign, plus either Bob or Charlie. Useful for primary + backup authorization.',
            technical: '💡 Nested structure demonstrates miniscript composition'
        },
        'timelock': {
            title: '⚙️ Timelock Miniscript',
            structure: 'and_v(v:pk(Alice),and_v(v:older(144),pk(Bob))) → Alice AND (144 blocks + Bob)',
            bitcoinScript: 'Verifies Alice, then checks timelock and Bob signature',
            useCase: 'Alice must sign, plus Bob can only sign after 144 blocks (~1 day). Prevents rushed decisions.',
            technical: '💡 Relative timelock using CSV (CHECKSEQUENCEVERIFY)'
        },
        'xonly': {
            title: '⚙️ Taproot X-only Key',
            structure: 'pk(David) → X-only public key (64 chars)',
            bitcoinScript: 'Compiles to Taproot-compatible script using 32-byte keys',
            useCase: 'Demonstrates Taproot X-only public keys for improved efficiency and privacy.',
            technical: '💡 Taproot uses Schnorr signatures with X-only keys'
        },
        'multisig': {
            title: '⚙️ 1-of-3 Multisig Miniscript',
            structure: 'or_d(pk(Alice),or_d(pk(Bob),pk(Charlie))) → Nested OR with DUP',
            bitcoinScript: 'Conditional execution using DUP IF pattern for each branch',
            useCase: 'Any of three parties can spend. More flexible than traditional CHECKMULTISIG.',
            technical: '💡 or_d uses DUP IF for efficient conditional branching'
        },
        'recovery': {
            title: '⚙️ Recovery Wallet Miniscript',
            structure: 'or_d(pk(Alice),and_v(v:pk(Bob),older(1008))) → Alice OR (Bob + delay)',
            bitcoinScript: 'Alice immediate, or Bob after 1008 blocks verification',
            useCase: 'Alice has daily control, Bob can recover funds after ~1 week waiting period.',
            technical: '💡 Combines immediate access with time-delayed recovery'
        },
        'hash': {
            title: '⚙️ Hash + Timelock Miniscript',
            structure: 'and_v(v:pk(Alice),or_d(pk(Bob),and_v(v:hash160(...),older(144))))',
            bitcoinScript: 'Alice AND (Bob OR (secret + timelock))',
            useCase: 'Alice + Bob normally, or Alice + secret after delay. Two-factor authentication pattern.',
            technical: '💡 hash160 requires RIPEMD160(SHA256(preimage))'
        },
        'inheritance': {
            title: '⚙️ Taproot Inheritance Miniscript',
            structure: 'and_v(v:pk(David),or_d(pk(Helen),and_v(v:pk(Ivan),older(52560))))',
            bitcoinScript: 'David AND (Helen OR (Ivan + 1 year))',
            useCase: 'David controls funds, Helen can inherit immediately, or Ivan after extended delay.',
            technical: '💡 Long timelock (52560 blocks ≈ 1 year) for inheritance planning'
        },
        'delayed': {
            title: '⚙️ Taproot Immediate OR Delayed',
            structure: 'or_d(pk(Julia),and_v(v:pk(Karl),older(144))) → Julia OR (Karl + delay)',
            bitcoinScript: 'Julia immediate OR Karl after 144 blocks',
            useCase: 'Julia can spend immediately, Karl can spend after 1-day cooling period.',
            technical: '💡 Demonstrates Taproot miniscript with short timelock'
        },
        'htlc_time': {
            title: '⚙️ Time-based HTLC (Hashed Timelock Contract)',
            structure: 'and_v(v:pk(Alice),or_d(pk(Bob),and_v(v:hash160(...),older(144))))',
            bitcoinScript: 'Alice AND (Bob immediate OR secret + timelock)',
            useCase: 'HTLC: Alice approves, Bob can claim immediately, or secret holder after delay.',
            technical: '💡 Proper HTLC pattern where pk(Bob) is dissatisfiable for or_d type compatibility'
        },
        'htlc_hash': {
            title: '⚙️ Hash-based HTLC (Hashed Timelock Contract)',
            structure: 'or_d(pk(Alice),and_v(v:hash160(...),and_v(v:pk(Bob),older(144))))',
            bitcoinScript: 'Alice immediately OR (secret + Bob + timelock)',
            useCase: 'HTLC variant: Alice can claim anytime, or secret holder + Bob after delay.',
            technical: '💡 pk(Alice) is dissatisfiable, satisfying or_d requirements'
        },
        'full_descriptor': {
            title: '⚙️ Full Extended Key Descriptor',
            structure: 'pk([C8FE8D4F/48h/1h/123h/2h]xpub.../0/0) → Full BIP32 path',
            bitcoinScript: 'Uses derived key from extended public key with full derivation path',
            useCase: 'HD wallet integration with complete key derivation metadata and fingerprint.',
            technical: '💡 BIP32 extended keys with origin path information'
        },
        'range_descriptor': {
            title: '⚙️ Multipath Range Descriptor',
            structure: 'pk([...]/tpub.../<1;0>/*) → Multipath derivation',
            bitcoinScript: 'Template for multiple derived keys using range notation',
            useCase: 'BIP389 multipath descriptors for generating multiple related addresses.',
            technical: '💡 <1;0> creates two derivation paths: .../1/* and .../0/*'
        },
        'vault_complex': {
            title: '🏦 Complex Multi-Signature Vault',
            structure: 'or_i(or_i(or_i(or_i(and_v(...), and_v(...)), and_v(...)), and_v(...)), and_v(...))',
            bitcoinScript: 'Hierarchical vault with multiple timelock conditions and threshold signatures',
            useCase: 'Enterprise Bitcoin custody with progressive security layers: Immediate 2-of-2 multisig for daily operations, degrading to 3-of-5 threshold after 2 months, 2-of-4 after 4 months, 2-of-3 after 6 months, and finally 2-of-2 emergency recovery after 8 months. Each timelock represents realistic business continuity scenarios: normal operations, executive departure, key compromise recovery, and long-term succession planning.',
            technical: '💡 Implements time-based degraded multisig: starts restrictive (requires specific key pairs), becomes more permissive with longer delays. Uses nested or_i for multiple spending paths, thresh() for m-of-n signatures, and pkh() for key hash verification. Critical for institutional custody where immediate spending needs tight control but recovery scenarios need flexibility.'
        }
    };
    
    const desc = descriptions[exampleId];
    if (desc) {
        contentDiv.innerHTML = `
            <h5 style="margin: 0 0 12px 0; color: var(--accent-color); font-size: 14px;">${desc.title}</h5>
            <div style="margin-bottom: 10px;">
                <strong style="color: var(--text-color); font-size: 12px;">Structure:</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); line-height: 1.4; font-family: monospace; background: var(--hover-bg); padding: 6px; border-radius: 4px;">${desc.structure}</div>
            </div>
            <div style="margin-bottom: 10px;">
                <strong style="color: var(--text-color); font-size: 12px;">Bitcoin Script:</strong>
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
        panel.style.display = 'block';
    }
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
    const panel = document.getElementById('policy-description');
    const contentDiv = panel.querySelector('.description-content');
    
    const descriptions = {
        'single': {
            title: '📄 Single Key Policy',
            conditions: '🔓 Alice: Immediate spending (no restrictions)',
            useCase: 'Personal wallet with single owner. Simple and efficient for individual use.',
            security: '⚠️ Single point of failure - if Alice loses her key, funds are lost'
        },
        'or': {
            title: '📄 OR Keys Policy',
            conditions: '🔓 Alice: Can spend immediately\n🔓 Bob: Can spend immediately',
            useCase: 'Shared wallet where either party can spend. Useful for joint accounts or backup access.',
            security: '💡 Either key compromise results in fund loss'
        },
        'and': {
            title: '📄 AND Keys Policy',
            conditions: '🔓 Alice + Bob: Both signatures required',
            useCase: '2-of-2 multisig. Both parties must agree to spend. Common for business partnerships.',
            security: '💡 More secure but requires cooperation of both parties'
        },
        'threshold': {
            title: '📄 2-of-3 Threshold Policy',
            conditions: '🔓 Any 2 of: Alice, Bob, Charlie',
            useCase: 'Board of directors or family trust. Prevents single point of failure while requiring majority.',
            security: '💡 Balanced security - survives 1 key loss, prevents 1 key compromise'
        },
        'timelock': {
            title: '📄 Timelock Policy',
            conditions: '🔓 Alice: Immediate spending\n⏰ Bob: After 144 blocks (~1 day)',
            useCase: 'Emergency access with delay. Alice has daily control, Bob can recover after waiting period.',
            security: '💡 Cooling-off period prevents rushed decisions'
        },
        'xonly': {
            title: '📄 Taproot X-only Key',
            conditions: '🔓 David: Immediate spending (Taproot context)',
            useCase: 'Demonstrates Taproot X-only public keys (64 characters). More efficient and private.',
            security: '💡 Taproot provides better privacy and efficiency'
        },
        'testnet_xpub': {
            title: '📄 Testnet Extended Public Key',
            conditions: '🔓 TestnetKey: HD wallet extended public key (testnet)',
            useCase: 'Demonstrates policy compilation with extended public keys (xpub/tpub). The compiler derives concrete keys from the descriptor.',
            security: '💡 HD wallets allow deterministic key generation from a single seed'
        },
        'corporate': {
            title: '📄 Corporate Wallet Policy',
            conditions: '🔓 Any 2 of: Alice, Bob, Charlie (board)\n⏰ Eva (CEO): After January 1, 2025',
            useCase: 'Corporate treasury with board oversight and emergency CEO access after specific date.',
            security: '💡 Board control with time-delayed executive override'
        },
        'recovery': {
            title: '📄 Emergency Recovery Policy',
            conditions: '🔓 Alice: Immediate spending (95% probability weight)\n⏰ Bob + Charlie + Eva: 2-of-3 after 1008 blocks (~1 week)',
            useCase: 'Personal wallet with family/friends emergency recovery. Alice controls daily, family can recover if needed. The 95@ weight tells miniscript compiler to optimize for Alice\'s path.',
            security: '💡 Probability weight helps wallets optimize fees and witness sizes for common usage'
        },
        'twofa': {
            title: '📄 2FA + Backup Policy',
            conditions: '🔓 Alice + (Bob + secret OR wait 1 year)',
            useCase: 'Two-factor authentication wallet. Alice + second device, or Alice alone after 1 year backup delay.',
            security: '💡 Strong 2FA security with long-term recovery option'
        },
        'inheritance': {
            title: '📄 Taproot Inheritance Policy',
            conditions: '🔓 David: Immediate spending\n⏰ Helen + Ivan + Julia: 2-of-3 after 26280 blocks (~6 months)',
            useCase: 'Estate planning. David controls funds, beneficiaries can inherit after extended waiting period.',
            security: '💡 Long delay ensures David has opportunity to intervene'
        },
        'delayed': {
            title: '📄 Taproot 2-of-2 OR Delayed',
            conditions: '🔓 Julia + Karl: Immediate 2-of-2 spending\n⏰ David: After 144 blocks (~1 day)',
            useCase: 'Joint account with single-party emergency access. Both parties agree, or one party after delay.',
            security: '💡 Cooperative control with individual fallback'
        }
    };
    
    const desc = descriptions[exampleId];
    if (desc) {
        contentDiv.innerHTML = `
            <h5 style="margin: 0 0 12px 0; color: var(--accent-color); font-size: 14px;">${desc.title}</h5>
            <div style="margin-bottom: 10px;">
                <strong style="color: var(--text-color); font-size: 12px;">Spending Conditions:</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); white-space: pre-line;">${desc.conditions}</div>
            </div>
            <div style="margin-bottom: 10px;">
                <strong style="color: var(--text-color); font-size: 12px;">Use Case:</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.useCase}</div>
            </div>
            <div>
                <strong style="color: var(--text-color); font-size: 12px;">Security Notes:</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); line-height: 1.4;">${desc.security}</div>
            </div>
        `;
        panel.style.display = 'block';
    }
};

window.showMiniscriptDescription = function(exampleId) {
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
            title: '⚙️ Complex AND/OR Miniscript',
            structure: 'and_v(v:pk(Alice),or_b(pk(Bob),s:pk(Charlie))) → Alice AND (Bob OR Charlie)',
            bitcoinScript: 'Alice verified first, then Bob OR Charlie evaluated',
            useCase: 'Alice must always sign, plus either Bob or Charlie. Useful for primary + backup authorization.',
            technical: '💡 Nested structure demonstrates miniscript composition'
        },
        'timelock': {
            title: '⚙️ Timelock Miniscript',
            structure: 'and_v(v:pk(Alice),and_v(v:older(144),pk(Bob))) → Alice AND (144 blocks + Bob)',
            bitcoinScript: 'Verifies Alice, then checks timelock and Bob signature',
            useCase: 'Alice must sign, plus Bob can only sign after 144 blocks (~1 day). Prevents rushed decisions.',
            technical: '💡 Relative timelock using CSV (CHECKSEQUENCEVERIFY)'
        },
        'xonly': {
            title: '⚙️ Taproot X-only Key',
            structure: 'pk(David) → X-only public key (64 chars)',
            bitcoinScript: 'Compiles to Taproot-compatible script using 32-byte keys',
            useCase: 'Demonstrates Taproot X-only public keys for improved efficiency and privacy.',
            technical: '💡 Taproot uses Schnorr signatures with X-only keys'
        },
        'multisig': {
            title: '⚙️ 1-of-3 Multisig Miniscript',
            structure: 'or_d(pk(Alice),or_d(pk(Bob),pk(Charlie))) → Nested OR with DUP',
            bitcoinScript: 'Conditional execution using DUP IF pattern for each branch',
            useCase: 'Any of three parties can spend. More flexible than traditional CHECKMULTISIG.',
            technical: '💡 or_d uses DUP IF for efficient conditional branching'
        },
        'recovery': {
            title: '⚙️ Recovery Wallet Miniscript',
            structure: 'or_d(pk(Alice),and_v(v:pk(Bob),older(1008))) → Alice OR (Bob + delay)',
            bitcoinScript: 'Alice immediate, or Bob after 1008 blocks verification',
            useCase: 'Alice has daily control, Bob can recover funds after ~1 week waiting period.',
            technical: '💡 Combines immediate access with time-delayed recovery'
        },
        'hash': {
            title: '⚙️ Hash + Timelock Miniscript',
            structure: 'and_v(v:pk(Alice),or_d(pk(Bob),and_v(v:hash160(...),older(144))))',
            bitcoinScript: 'Alice AND (Bob OR (secret + timelock))',
            useCase: 'Alice + Bob normally, or Alice + secret after delay. Two-factor authentication pattern.',
            technical: '💡 hash160 requires RIPEMD160(SHA256(preimage))'
        },
        'inheritance': {
            title: '⚙️ Taproot Inheritance Miniscript',
            structure: 'and_v(v:pk(David),or_d(pk(Helen),and_v(v:pk(Ivan),older(52560))))',
            bitcoinScript: 'David AND (Helen OR (Ivan + 1 year))',
            useCase: 'David controls funds, Helen can inherit immediately, or Ivan after extended delay.',
            technical: '💡 Long timelock (52560 blocks ≈ 1 year) for inheritance planning'
        },
        'delayed': {
            title: '⚙️ Taproot Immediate OR Delayed',
            structure: 'or_d(pk(Julia),and_v(v:pk(Karl),older(144))) → Julia OR (Karl + delay)',
            bitcoinScript: 'Julia immediate OR Karl after 144 blocks',
            useCase: 'Julia can spend immediately, Karl can spend after 1-day cooling period.',
            technical: '💡 Demonstrates Taproot miniscript with short timelock'
        },
        'htlc_time': {
            title: '⚙️ Time-based HTLC (Hashed Timelock Contract)',
            structure: 'and_v(v:pk(Alice),or_d(pk(Bob),and_v(v:hash160(...),older(144))))',
            bitcoinScript: 'Alice AND (Bob immediate OR secret + timelock)',
            useCase: 'HTLC: Alice approves, Bob can claim immediately, or secret holder after delay.',
            technical: '💡 Proper HTLC pattern where pk(Bob) is dissatisfiable for or_d type compatibility'
        },
        'htlc_hash': {
            title: '⚙️ Hash-based HTLC (Hashed Timelock Contract)',
            structure: 'or_d(pk(Alice),and_v(v:hash160(...),and_v(v:pk(Bob),older(144))))',
            bitcoinScript: 'Alice immediately OR (secret + Bob + timelock)',
            useCase: 'HTLC variant: Alice can claim anytime, or secret holder + Bob after delay.',
            technical: '💡 pk(Alice) is dissatisfiable, satisfying or_d requirements'
        },
        'full_descriptor': {
            title: '⚙️ Full Extended Key Descriptor',
            structure: 'pk([C8FE8D4F/48h/1h/123h/2h]xpub.../0/0) → Full BIP32 path',
            bitcoinScript: 'Uses derived key from extended public key with full derivation path',
            useCase: 'HD wallet integration with complete key derivation metadata and fingerprint.',
            technical: '💡 BIP32 extended keys with origin path information'
        },
        'range_descriptor': {
            title: '⚙️ Multipath Range Descriptor',
            structure: 'pk([...]/tpub.../<1;0>/*) → Multipath derivation',
            bitcoinScript: 'Template for multiple derived keys using range notation',
            useCase: 'BIP389 multipath descriptors for generating multiple related addresses.',
            technical: '💡 <1;0> creates two derivation paths: .../1/* and .../0/*'
        },
        'vault_complex': {
            title: '🏦 Complex Multi-Signature Vault',
            structure: 'or_i(or_i(or_i(or_i(and_v(...), and_v(...)), and_v(...)), and_v(...)), and_v(...))',
            bitcoinScript: 'Hierarchical vault with multiple timelock conditions and threshold signatures',
            useCase: 'Enterprise Bitcoin custody with progressive security layers: Immediate 2-of-2 multisig for daily operations, degrading to 3-of-5 threshold after 2 months, 2-of-4 after 4 months, 2-of-3 after 6 months, and finally 2-of-2 emergency recovery after 8 months. Each timelock represents realistic business continuity scenarios: normal operations, executive departure, key compromise recovery, and long-term succession planning.',
            technical: '💡 Implements time-based degraded multisig: starts restrictive (requires specific key pairs), becomes more permissive with longer delays. Uses nested or_i for multiple spending paths, thresh() for m-of-n signatures, and pkh() for key hash verification. Critical for institutional custody where immediate spending needs tight control but recovery scenarios need flexibility.'
        }
    };
    
    const desc = descriptions[exampleId];
    if (desc) {
        contentDiv.innerHTML = `
            <h5 style="margin: 0 0 12px 0; color: var(--accent-color); font-size: 14px;">${desc.title}</h5>
            <div style="margin-bottom: 10px;">
                <strong style="color: var(--text-color); font-size: 12px;">Structure:</strong>
                <div style="margin-top: 4px; font-size: 12px; color: var(--secondary-text); line-height: 1.4; font-family: monospace; background: var(--hover-bg); padding: 6px; border-radius: 4px;">${desc.structure}</div>
            </div>
            <div style="margin-bottom: 10px;">
                <strong style="color: var(--text-color); font-size: 12px;">Bitcoin Script:</strong>
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
    expressionInput.textContent = cleanedExpression;
    
    // Update syntax highlighting
    if (window.compiler && window.compiler.highlightMiniscriptSyntax) {
        window.compiler.highlightMiniscriptSyntax();
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
    policyInput.textContent = cleanedPolicy;
    
    // Update syntax highlighting
    if (window.compiler && window.compiler.highlightPolicySyntax) {
        window.compiler.highlightPolicySyntax();
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