import init, { compile_miniscript, compile_miniscript_with_mode, compile_policy, lift_to_miniscript, lift_to_policy, generate_address_for_network, generate_taproot_address_for_network, generate_taproot_address_with_builder, get_taproot_leaves } from './pkg/miniscript_wasm.js';
// Cache buster - updated 2025-01-18 v3

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
        this.lastSuggestedKeyName = null; // Track auto-suggested names
        this.isGeneratingKey = false; // Flag to prevent clearing suggestion during generation
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
            // Initialize empty results sections on page load
            this.initializeEmptyResults();
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

        // Extract keys buttons
        document.getElementById('extract-policy-keys-btn').addEventListener('click', () => {
            this.extractKeysFromPolicy();
        });

        document.getElementById('extract-keys-btn').addEventListener('click', () => {
            this.extractKeysFromMiniscript();
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

        // Extract keys modal buttons
        document.getElementById('confirm-extract').addEventListener('click', () => {
            this.confirmExtractKeys();
        });

        document.getElementById('cancel-extract').addEventListener('click', () => {
            this.hideExtractModal();
        });

        document.getElementById('select-all-keys').addEventListener('click', () => {
            this.selectAllKeys(true);
        });

        document.getElementById('deselect-all-keys').addEventListener('click', () => {
            this.selectAllKeys(false);
        });

        // Format buttons
        document.getElementById('format-miniscript-btn').addEventListener('click', () => {
            this.toggleMiniscriptFormat();
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

        document.getElementById('extract-keys-modal').addEventListener('click', (e) => {
            if (e.target.id === 'extract-keys-modal') {
                this.hideExtractModal();
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

        // Track when user manually edits the key name input
        document.getElementById('key-name-input').addEventListener('input', (e) => {
            // If user types anything manually, clear the last suggested name
            // so future generate calls will suggest new names
            if (!this.isGeneratingKey) {
                this.lastSuggestedKeyName = null;
            }
        });

        document.getElementById('key-value-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.addKeyVariable();
            }
        });
        
        // Setup focus events for border styling
        this.setupFocusEvents();
        
        // Override innerHTML for contenteditable elements to ensure styling persists
        this.overrideInnerHTMLForStyling();
    }
    
    overrideInnerHTMLForStyling() {
        const policyInput = document.getElementById('policy-input');
        const expressionInput = document.getElementById('expression-input');
        
        [policyInput, expressionInput].forEach(element => {
            if (element) {
                const originalDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
                Object.defineProperty(element, 'innerHTML', {
                    set: function(value) {
                        originalDescriptor.set.call(this, value);
                        // Force reapply styling after innerHTML change
                        if (window.compiler && window.compiler.enforceElementStyling) {
                            setTimeout(() => window.compiler.enforceElementStyling(this), 0);
                        }
                    },
                    get: originalDescriptor.get,
                    configurable: true
                });
            }
        });

    }
    
    setupFocusEvents() {
        // Add focus/blur events for all editable elements to handle border styling
        const elements = [
            'policy-input',
            'expression-input', 
            'script-hex-display',
            'script-asm-display'
        ];
        
        elements.forEach(elementId => {
            // Use event delegation since script textareas are created dynamically
            document.addEventListener('focusin', (e) => {
                if (e.target.id === elementId) {
                    this.handleElementFocus(e.target, true);
                }
            });
            
            document.addEventListener('focusout', (e) => {
                if (e.target.id === elementId) {
                    this.handleElementFocus(e.target, false);
                }
            });
        });
    }
    
    handleElementFocus(element, isFocused) {
        if (document.documentElement.getAttribute('data-theme') === 'light') {
            const isMainInput = element.id === 'policy-input' || element.id === 'expression-input';
            const isScriptField = element.id === 'script-hex-display' || element.id === 'script-asm-display';
            
            if (isFocused) {
                // Focus state - bolder border
                if (isMainInput) {
                    element.style.setProperty('border', '2px solid #4299e1', 'important');
                    element.style.setProperty('box-shadow', '0 0 0 3px rgba(66, 153, 225, 0.1)', 'important');
                } else if (isScriptField) {
                    element.style.setProperty('border', '1px solid #4299e1', 'important');
                    element.style.setProperty('box-shadow', '0 0 0 2px rgba(66, 153, 225, 0.1)', 'important');
                }
            } else {
                // Blur state - normal border
                if (isMainInput) {
                    element.style.setProperty('border', '2px solid #cbd5e0', 'important');
                    element.style.removeProperty('box-shadow');
                } else if (isScriptField) {
                    element.style.setProperty('border', '1px solid #cbd5e0', 'important');
                    element.style.removeProperty('box-shadow');
                }
            }
        }
    }

    compileExpression() {
        // Prevent concurrent compilations
        if (this.isCompiling) {
            console.log('Compilation already in progress, skipping duplicate call');
            return;
        }
        this.isCompiling = true;
        
        const expression = document.getElementById('expression-input').textContent.trim();
        const context = document.querySelector('input[name="context"]:checked').value;
        
        // Clear previous messages (preserve success if this is from auto-compile)
        const isAutoCompile = this.isAutoCompiling || false;
        this.clearMiniscriptMessages(isAutoCompile);
        
        if (!expression) {
            this.showMiniscriptError('Please enter a miniscript expression.');
            this.isCompiling = false;
            return;
        }

        if (!this.wasm) {
            this.showMiniscriptError('Compiler not ready, please wait and try again.');
            this.isCompiling = false;
            return;
        }

        // Show loading state
        const compileBtn = document.getElementById('compile-btn');
        const originalText = compileBtn.textContent;
        compileBtn.textContent = '⏳ Compiling...';
        compileBtn.disabled = true;

        try {
            // Clean extra characters and replace key variables in expression
            const cleanedExpression = this.cleanExpression(expression);
            const processedExpression = this.replaceKeyVariables(cleanedExpression, context);
            
            // Call the WASM function with context and mode
            let result;
            if (context === 'taproot') {
                const currentMode = window.currentTaprootMode || 'single-leaf';
                console.log(`Compiling miniscript in taproot context, mode: ${currentMode}`);
                result = compile_miniscript_with_mode(processedExpression, context, currentMode);
                if (result.success) {
                    result.taprootMode = currentMode;
                }
            } else {
                // Non-taproot contexts: use regular compilation
                result = compile_miniscript(processedExpression, context);
            }
            
            // Reset button
            compileBtn.textContent = originalText;
            compileBtn.disabled = false;

            if (result.success) {
                // Add the processed expression (with actual keys) for taproot network switching
                result.processedMiniscript = processedExpression;
                // Update the input display to show cleaned expression and reset format button
                const expressionInput = document.getElementById('expression-input');
                const formatButton = document.getElementById('format-miniscript-btn');
                
                expressionInput.textContent = cleanedExpression;
                
                // Update format button state to reflect unformatted state
                formatButton.style.color = 'var(--text-secondary)';
                formatButton.title = 'Format expression with indentation';
                formatButton.dataset.formatted = 'false';
                
                // Re-apply syntax highlighting
                delete expressionInput.dataset.lastHighlightedText;
                this.highlightMiniscriptSyntax();
                
                // Position cursor at end after compilation
                this.positionCursorAtEnd(expressionInput);
                
                
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
                
                // Success message with spending cost analysis format
                console.log('Debug result:', result);
                console.log('max_weight_to_satisfy:', result.max_weight_to_satisfy);
                console.log('max_satisfaction_size:', result.max_satisfaction_size);
                
                // Check if this is a descriptor validation (range descriptors)
                const isDescriptorValidation = result.miniscript_type === 'Descriptor';
                
                let successMsg = '';
                if (isDescriptorValidation && result.compiled_miniscript) {
                    // For descriptor validation, build the message using original expression from editor
                    successMsg = `Valid descriptor: wsh(${expression})`;
                } else {
                    successMsg = `Compilation successful - ${result.miniscript_type}, ${result.script_size} bytes<br>`;
                    
                    if (result.max_weight_to_satisfy && result.max_satisfaction_size) {
                        const scriptWeight = result.script_size;
                        const inputWeight = result.max_satisfaction_size; // Use satisfaction size for input weight
                        const totalWeight = scriptWeight + inputWeight; // Calculate total as script + input
                        
                        successMsg += `Script: ${scriptWeight} WU<br>`;
                        successMsg += `Input: ${inputWeight}.000000 WU<br>`;
                        successMsg += `Total: ${totalWeight}.000000 WU<br><br>`;
                    } else if (result.max_satisfaction_size) {
                        // Fallback - show satisfaction size
                        successMsg += `Input: ${result.max_satisfaction_size}.000000 WU<br>`;
                        successMsg += `Total: ${result.script_size + result.max_satisfaction_size}.000000 WU<br><br>`;
                    } else {
                        // No weight details available, add extra line break
                        successMsg += `<br>`;
                    }
                    
                    // Add hex, asm, and address
                    if (result.script) {
                        successMsg += `HEX:<br>${result.script}<br><br>`;
                    }
                    if (result.script_asm) {
                        // Create simplified version with key names (same as script field)
                        const simplifiedAsm = this.simplifyAsm(result.script_asm);
                        let finalAsm = simplifiedAsm;
                        if (this.keyVariables.size > 0) {
                            finalAsm = this.replaceKeysWithNames(simplifiedAsm);
                        }
                        successMsg += `ASM:<br>${finalAsm}<br><br>`;
                    }
                    if (result.address) {
                        successMsg += `Address:<br>${result.address}`;
                        
                        // Add Taproot descriptor for Taproot context
                        if (result.miniscript_type === 'Taproot' && result.compiled_miniscript) {
                            successMsg += `<br><br>Taproot descriptor:<br><code style="padding: 8px; border-radius: 4px; display: block; margin: 8px 0; word-break: break-all; font-family: monospace;">${result.compiled_miniscript}</code>`;
                        }
                    }
                }
                
                // Skip problematic metrics for now - they show false warnings
                // TODO: Fix sanity_check and is_non_malleable implementation
                
                // Pass the original expression for tree visualization
                let treeExpression = expression;
                
                this.showMiniscriptSuccess(successMsg, treeExpression);
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
        } finally {
            this.isCompiling = false;
        }
    }

    compilePolicy() {
        const policy = document.getElementById('policy-input').textContent.trim();
        const context = document.querySelector('input[name="context"]:checked').value;
        
        // Clear previous errors (preserve success if this is from auto-compile)
        const isAutoCompile = this.isAutoCompiling || false;
        this.clearPolicyErrors(isAutoCompile);
        
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
            // Clean extra characters and replace key variables in policy
            const cleanedPolicy = this.cleanExpression(policy);
            const processedPolicy = this.replaceKeyVariables(cleanedPolicy, context);
            console.log('Original policy:', policy);
            console.log('Cleaned policy:', cleanedPolicy);
            console.log('Processed policy:', processedPolicy);
            console.log('Context:', context);
            
            // Update the policy input display to show cleaned expression and reset format button
            const policyInput = document.getElementById('policy-input');
            const policyFormatButton = document.getElementById('policy-format-toggle');
            
            policyInput.textContent = cleanedPolicy;
            
            // Update policy format button state to reflect unformatted state
            if (policyFormatButton) {
                policyFormatButton.style.color = 'var(--text-secondary)';
                policyFormatButton.title = 'Format expression with indentation';
                policyFormatButton.dataset.formatted = 'false';
            }
            
            // Re-apply policy syntax highlighting
            delete policyInput.dataset.lastHighlightedText;
            this.highlightPolicySyntax();
            
            // Call the WASM function with context
            const result = compile_policy(processedPolicy, context);
            
            // Reset button
            compilePolicyBtn.textContent = originalText;
            compilePolicyBtn.disabled = false;

            if (result.success && result.compiled_miniscript) {
                // Success: fill the miniscript field and show results
                const expressionInput = document.getElementById('expression-input');
                const formatButton = document.getElementById('format-miniscript-btn');
                
                // Replace keys with names in the compiled miniscript if we have key variables
                let displayMiniscript = result.compiled_miniscript;
                if (this.keyVariables.size > 0) {
                    displayMiniscript = this.replaceKeysWithNames(result.compiled_miniscript);
                }
                
                // For tr() descriptors, extract only the miniscript part for the editor
                let editorMiniscript = displayMiniscript;
                if (displayMiniscript && displayMiniscript.startsWith('tr(')) {
                    const parsed = this.parseTrDescriptor(displayMiniscript);
                    if (parsed && parsed.treeScript) {
                        editorMiniscript = parsed.treeScript;
                        console.log('Extracted miniscript from tr() descriptor for editor:', editorMiniscript);
                    }
                }
                
                expressionInput.textContent = editorMiniscript;
                
                // Reset format button state since compiled miniscript is always clean/unformatted
                formatButton.style.color = 'var(--text-secondary)';
                formatButton.title = 'Format expression with indentation';
                formatButton.dataset.formatted = 'false';
                
                // Clear the highlighting cache and re-highlight
                delete expressionInput.dataset.lastHighlightedText;
                this.highlightMiniscriptSyntax();
                
                // Position cursor at end after policy compilation puts miniscript
                this.positionCursorAtEnd(expressionInput);
                
                
                // Always set toggle button to "Hide Key Names" state after compilation if we replaced keys
                const toggleBtn = document.getElementById('key-names-toggle');
                if (toggleBtn) {
                    if (this.keyVariables.size > 0 && displayMiniscript !== result.compiled_miniscript) {
                        // We replaced keys with names, so show "Hide Key Names" state
                        toggleBtn.style.color = 'var(--success-border)';
                        toggleBtn.title = 'Hide key names';
                        toggleBtn.dataset.active = 'true';
                    } else {
                        // No replacements made or no key variables
                        toggleBtn.style.color = 'var(--text-secondary)';
                        toggleBtn.title = 'Show key names';
                        toggleBtn.dataset.active = 'false';
                    }
                }
                
                // Show policy success message 
                this.showPolicySuccess(displayMiniscript, result);
                
                // Check if this is a descriptor validation from policy compilation
                const isDescriptorValidation = result.miniscript_type === 'Descriptor';
                
                let successMsg = '';
                if (isDescriptorValidation && result.script && result.script.startsWith('Valid descriptor:')) {
                    // For descriptor validation from policy, build the message using compiled miniscript from editor
                    successMsg = `Valid descriptor: wsh(${displayMiniscript})`;
                    // Fix the script field for results display - should show "No single script..." not validation message
                    result.script = "No single script - this descriptor defines multiple paths";
                } else {
                    // Show normal compilation success message with spending cost analysis format
                    successMsg = `Compilation successful - ${result.miniscript_type}, ${result.script_size} bytes<br>`;
                    
                    if (result.max_weight_to_satisfy && result.max_satisfaction_size) {
                        const scriptWeight = result.script_size;
                        const inputWeight = result.max_satisfaction_size; // Use satisfaction size for input weight
                        const totalWeight = scriptWeight + inputWeight; // Calculate total as script + input
                        
                        successMsg += `Script: ${scriptWeight} WU<br>`;
                        successMsg += `Input: ${inputWeight}.000000 WU<br>`;
                        successMsg += `Total: ${totalWeight}.000000 WU<br><br>`;
                    } else if (result.max_satisfaction_size) {
                        // Fallback - show satisfaction size
                        successMsg += `Input: ${result.max_satisfaction_size}.000000 WU<br>`;
                        successMsg += `Total: ${result.script_size + result.max_satisfaction_size}.000000 WU<br><br>`;
                    } else {
                        // No weight details available, add extra line break
                        successMsg += `<br>`;
                    }
                    
                    // Add hex, asm, and address
                    if (result.script) {
                        successMsg += `HEX:<br>${result.script}<br><br>`;
                    }
                    if (result.script_asm) {
                        // Create simplified version with key names (same as script field)
                        const simplifiedAsm = this.simplifyAsm(result.script_asm);
                        let finalAsm = simplifiedAsm;
                        if (this.keyVariables.size > 0) {
                            finalAsm = this.replaceKeysWithNames(simplifiedAsm);
                        }
                        successMsg += `ASM:<br>${finalAsm}<br><br>`;
                    }
                    if (result.address) {
                        successMsg += `Address:<br>${result.address}`;
                    }
                }
                
                // Pass the compiled miniscript expression for tree visualization
                let treeExpression = displayMiniscript;
                this.showMiniscriptSuccess(successMsg, treeExpression);
                
                // Store the compiled miniscript (with actual keys) for network switching
                result.processedMiniscript = result.compiled_miniscript;
                
                // After putting miniscript in editor, compile it fresh with current mode
                // This ensures proper mode handling (single-leaf vs multi-leaf)
                this.compileExpression();
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
        this.clearPolicyErrors();
        
        // Reset taproot mode to default
        window.currentTaprootMode = 'single-leaf';
        
        // Hide policy description panel
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
                const commonKeys = ['Alice', 'Bob', 'Charlie', 'David', 'Eva', 'Frank', 'Lara', 'Helen', 'Ivan', 'Julia', 'Karl', 'TestnetKey', 'MainnetKey', 'jcKey1', 'jcKey2', 'jcKey3', 'saKey', 'jcAg1', 'jcAg2', 'jcAg3', 'recKey1', 'recKey2', 'recKey3'];
                const missingKey = commonKeys.find(key => key.length === gotLength && policyText.includes(key));
                
                if (missingKey) {
                    additionalHelp = `
<div style="margin-top: 15px; padding: 12px; background: var(--container-bg); border: 1px solid var(--error-border); border-radius: 6px; text-align: left; color: var(--text-color);">
<strong>💡 Tip:</strong> The key variable "<strong>${missingKey}</strong>" appears to be missing or undefined.
<br><br>
<strong>Your options:</strong>
<br><br>
<div>→ <strong>Extract keys:</strong> Auto-detects all undefined variables/keys in your policy and lets you assign key variables to them</div>
<div>→ <strong>Check Key variables section:</strong> Look below to see if "${missingKey}" already exists with a different value</div>
<div>→ <strong>Add manually:</strong> Define "${missingKey}" yourself in the Key variables section with any valid key type</div>
<div>→ <strong>Restore defaults:</strong> Restore common test keys (Alice, Bob, Charlie, etc.) with pre-generated public keys.<br>&nbsp;&nbsp;Useful for examples that stopped working, usually due to a key deletion</div>
<div style="margin-top: 10px; display: flex; gap: 10px;">
<button onclick="compiler.extractKeysFromPolicy()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Automatically scan your policy expression to find undefined variables and convert them to reusable key variables. Select which variables to extract and choose the appropriate key type for each.">🔑 Extract keys</button>
<button onclick="compiler.restoreDefaultKeys()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Add 56 commonly used test keys (Alice, Bob, Charlie, David, Eva, Frank, NUMS, etc.) plus VaultKey1-19 range descriptors with pre-generated public keys for each type. This won't overwrite existing keys with the same names.">🔄 Restore defaults</button>
</div>
</div>
                    `;
                } else if (gotLength <= 15) {
                    // Generic help for short strings that look like variable names
                    additionalHelp = `
<div style="margin-top: 15px; padding: 12px; background: var(--container-bg); border: 1px solid var(--error-border); border-radius: 6px; text-align: left; color: var(--text-color);">
<strong>💡 Tip:</strong> This looks like a missing key variable (got ${gotLength} characters instead of a public key).
<br><br>
<strong>Your options:</strong>
<br><br>
<div>→ <strong>Extract keys:</strong> Auto-detects all undefined variables/keys in your policy and lets you assign key variables to them</div>
<div>→ <strong>Check Key variables section:</strong> Look below to see if this variable exists or needs to be added</div>
<div>→ <strong>Add manually:</strong> Define your custom variable in the Key variables section with any valid key type</div>
<div>→ <strong>Restore defaults:</strong> Restore common test keys (Alice, Bob, Charlie, etc.) with pre-generated public keys.<br>&nbsp;&nbsp;Useful for examples that stopped working, usually due to a key deletion</div>
<div style="margin-top: 10px; display: flex; gap: 10px;">
<button onclick="compiler.extractKeysFromPolicy()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Automatically scan your policy expression to find undefined variables and convert them to reusable key variables. Select which variables to extract and choose the appropriate key type for each.">🔑 Extract keys</button>
<button onclick="compiler.restoreDefaultKeys()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Add 56 commonly used test keys (Alice, Bob, Charlie, David, Eva, Frank, NUMS, etc.) plus VaultKey1-19 range descriptors with pre-generated public keys for each type. This won't overwrite existing keys with the same names.">🔄 Restore defaults</button>
</div>
</div>
                    `;
                }
            }
        }
        
        policyErrorsDiv.innerHTML = `
            <div class="result-box error" style="margin: 0; text-align: left;">
                <h4>❌ Policy error</h4>
                <div style="margin-top: 10px; text-align: left;">${message}</div>
                ${additionalHelp}
            </div>
        `;
    }

    showPolicySuccess(miniscript, result = null) {
        const policyErrorsDiv = document.getElementById('policy-errors');
        
        // Check if we should update existing success message during auto-compile
        if (this.isAutoCompiling) {
            const existingSuccess = policyErrorsDiv.querySelector('.result-box.success');
            if (existingSuccess) {
                // Update the content for auto-compile
                this.updatePolicySuccessContent(existingSuccess, miniscript, result);
                return; // Don't replace the entire message box
            }
        }
        
        // Normal behavior - create new message
        const content = this.generatePolicySuccessContent(miniscript, result);
        policyErrorsDiv.innerHTML = `
            <div class="result-box success" style="margin: 0; text-align: left;">
                <h4>✅ Policy compilation successful</h4>
                ${content}
            </div>
        `;
    }
    
    generatePolicySuccessContent(miniscript, result = null) {
        // Check if this is a taproot descriptor
        if (miniscript.startsWith('tr(')) {
            return this.generateTaprootPolicyContent(miniscript, result);
        } else {
            // Standard miniscript display
            return `
                <div style="margin-top: 10px; text-align: left;">
                    <strong>Generated Miniscript:</strong><br>
                    <code style="padding: 8px; border-radius: 4px; display: block; margin: 8px 0; word-break: break-all; font-family: monospace;">${miniscript}</code>
                    <div style="color: var(--text-secondary); font-size: 13px; margin-top: 10px;">
                        💡 Check the miniscript below for script hex, ASM, and address details.
                    </div>
                </div>
            `;
        }
    }
    
    generateTaprootPolicyContent(descriptor, result = null) {
        console.log(`=== TAPROOT PARSING DEBUG ===`);
        console.log(`Input descriptor: "${descriptor}"`);
        
        // Parse using helper function
        const parsed = this.parseTrDescriptor(descriptor);
        if (!parsed) {
            console.error('Taproot parsing failed:', descriptor);
            return this.generateStandardContent(descriptor);
        }
        
        const { internalKey, treeScript } = parsed;
        
        // Check current mode (default to multi-leaf if not set) - define at top level
        const currentMode = window.currentTaprootMode || 'multi-leaf';
        
        let content = `
            <div style="margin-top: 10px; text-align: left;">
        `;
        
        // Only show mode selection if there's a tree script (multiple spending paths)
        if (treeScript) {
            
            content += `
                <div style="margin-bottom: 15px; padding: 10px; background: var(--success-bg); border-radius: 6px; border: 1px solid var(--success-border);">
                    <div style="margin-bottom: 10px;"><strong>Compilation Mode:</strong></div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <label style="display: flex; align-items: center; cursor: pointer;">
                            <input type="radio" name="taproot-mode" value="single-leaf" ${currentMode === 'single-leaf' ? 'checked' : ''} 
                                   onchange="window.switchTaprootMode('single-leaf')" 
                                   style="margin-right: 8px; accent-color: var(--accent-color); transform: scale(1.1);">
                            <span style="font-size: 13px;"><strong>Miniscript compilation</strong> (single script)</span>
                        </label>
                        <label style="display: flex; align-items: center; cursor: pointer;">
                            <input type="radio" name="taproot-mode" value="multi-leaf" ${currentMode === 'multi-leaf' ? 'checked' : ''} 
                                   onchange="window.switchTaprootMode('multi-leaf')" 
                                   style="margin-right: 8px; accent-color: var(--accent-color); transform: scale(1.1);">
                            <span style="font-size: 13px;"><strong>Taproot compilation</strong> (multi-leaf TapTree)</span>
                        </label>
                    </div>
                </div>
            `;
            
            // Show different content based on compilation mode
            if (currentMode === 'single-leaf') {
                // Single-leaf mode: show the same format as direct miniscript compilation
                const displayMiniscript = treeScript || `pk(${internalKey})`;
                content += `
                    <div style="margin-bottom: 15px;">
                        <strong>Generated Miniscript:</strong><br>
                        <code style="padding: 8px; border-radius: 4px; display: block; margin: 8px 0; word-break: break-all; font-family: monospace;">${displayMiniscript}</code>
                    </div>
                    
                    <div style="color: var(--text-secondary); font-size: 13px;">
                        💡 The detailed compilation info (HEX, ASM, Address, Weight) is shown in the miniscript success message below.
                    </div>
                </div>`;
                return content;
            }
        } else {
            // No tree script (key-path only) - no mode selection needed, show simple message
            content += `
                <div style="margin-bottom: 15px; color: var(--text-secondary); font-size: 13px;">
                    💡 This is a key-path only taproot output. Only ${internalKey} can spend using a single signature.
                </div>
            </div>`;
            return content;
        }
        
        // Multi-leaf mode: full taproot information
        content += `
                <div style="margin-bottom: 15px;">
                    <strong>Descriptor:</strong><br>
                    <code style="padding: 8px; border-radius: 4px; display: block; margin: 8px 0; word-break: break-all; font-family: monospace;">${descriptor}</code>
                </div>`;
        
        // Add weight information if available from compilation result
        if (result) {
            if (result.script_size && result.max_weight_to_satisfy) {
                const scriptWeight = result.script_size;
                const totalWeight = result.max_weight_to_satisfy;
                const inputWeight = totalWeight - scriptWeight;
                
                content += `
                <div style="margin-bottom: 15px;">
                    <strong>Weight Information:</strong><br>
                    <div style="margin: 4px 0; font-family: monospace; font-size: 13px;">
                        Script: ${scriptWeight} WU<br>
                        Input: ${inputWeight}.000000 WU<br>
                        Total: ${totalWeight}.000000 WU
                    </div>
                </div>`;
            } else if (result.max_satisfaction_size) {
                content += `
                <div style="margin-bottom: 15px;">
                    <strong>Weight Information:</strong><br>
                    <div style="margin: 4px 0; font-family: monospace; font-size: 13px;">
                        Input: ${result.max_satisfaction_size}.000000 WU<br>
                        Total: ${result.script_size + result.max_satisfaction_size}.000000 WU
                    </div>
                </div>`;
            }
        }
        
        content += `
                <div style="margin-bottom: 15px;">
                    <strong>Taproot Structure:</strong><br>
                    <div style="margin: 8px 0 8px 16px; font-family: monospace; font-size: 13px;">
                        • Internal Key: <span class="key-tooltip" style="color: var(--accent-color); cursor: help; text-decoration: underline dotted;" title="${this.getKeyTooltip(internalKey)}">${internalKey}</span> (key-path spending)
        `;
        
        if (treeScript) {
            // Parse the tree to show branches
            const branches = this.parseTaprootBranches(treeScript);
            content += `<br>• Script Tree: ${branches.length} branch${branches.length !== 1 ? 'es' : ''} (script-path spending)`;
            content += `</div></div>`;
            
            // Handle auto-load behavior for single branches in multi-leaf mode
            if (branches.length === 1) {
                let cleanMiniscript;
                
                // Single branch case in multi-leaf mode
                cleanMiniscript = branches[0]; 
                console.log(`🔍 SINGLE BRANCH MODE - Using branch[0]: "${cleanMiniscript}"`);
                
                // Remove any tr() wrapper if it exists using helper function
                if (cleanMiniscript && cleanMiniscript.startsWith('tr(')) {
                    console.log(`Attempting to parse tr() descriptor...`);
                    const parsed = this.parseTrDescriptor(cleanMiniscript);
                    console.log(`Parse result:`, parsed);
                    if (parsed && parsed.treeScript) {
                        cleanMiniscript = parsed.treeScript;
                        console.log(`✅ Extracted from full tr(): "${cleanMiniscript}"`);
                    } else {
                        console.log(`❌ Failed to extract from tr() descriptor`);
                    }
                }
                
                console.log(`🎯 Final clean miniscript that will be loaded: "${cleanMiniscript}"`);
                console.log(`Final miniscript length: ${cleanMiniscript.length}`);
                
                // Auto-load into miniscript editor and compile
                setTimeout(() => {
                    const miniscriptInput = document.getElementById('expression-input');
                    if (miniscriptInput) {
                        console.log(`📝 Loading into editor: "${cleanMiniscript}"`);
                        miniscriptInput.textContent = cleanMiniscript;
                        console.log(`📋 Editor textContent after setting: "${miniscriptInput.textContent}"`);
                        window.compiler.highlightMiniscriptSyntax(true);
                        console.log(`🚀 About to compile expression...`);
                        window.compiler.compileExpression();
                    } else {
                        console.log(`❌ Could not find miniscript input element`);
                    }
                }, 100);
                
                // Show simplified single-branch message
                content += `
                    <div style="margin-bottom: 15px; padding: 10px; border: 1px solid var(--success-border); border-radius: 4px; background: var(--success-bg);">
                        <strong>✓ Single Branch Auto-loaded</strong><br>
                        <div style="margin: 8px 0; font-size: 13px;">
                            The miniscript: <code style="font-family: monospace; background: var(--success-bg); padding: 2px 4px; border-radius: 2px;">${branches[0]}</code> has been automatically loaded into the editor and compiled.
                        </div>
                    </div>
                `;
            } else {
                // Multiple branches - clear everything and show branch selection
                console.log(`Multiple branches detected (${branches.length}), clearing editors`);
                setTimeout(() => {
                    this.clearAllEditors();
                }, 100);
                
                // Add branch details with clickable names
                branches.forEach((branch, index) => {
                    // Replace key names if available
                    let displayMiniscript = branch;
                    if (this.keyVariables && this.keyVariables.size > 0) {
                        displayMiniscript = this.replaceKeysWithNames(branch);
                    }
                    
                    content += `
                    <div style="margin-bottom: 12px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; background: transparent;">
                        <strong><button class="branch-loader" 
                               onclick="window.loadBranchMiniscript('${branch.replace(/'/g, "\\'")}')" 
                               style="background: none; border: none; color: var(--accent-color); cursor: pointer; 
                                      text-decoration: underline; font-size: inherit; font-weight: bold; padding: 0;">
                               Branch ${index + 1}
                        </button>:</strong><br>
                        <div style="margin: 8px 0;">
                            <strong>Miniscript:</strong><br>
                            <code style="padding: 6px; border-radius: 3px; display: block; margin: 4px 0; font-family: monospace; font-size: 12px; background: rgba(0,0,0,0.1);">${displayMiniscript}</code>
                        </div>
                        <div style="font-size: 11px; color: var(--text-secondary);">
                            💡 Click "Branch ${index + 1}" above to load this miniscript into the editor
                        </div>
                    </div>
                    `;
                });
                
                content += `
                    <div style="color: var(--text-secondary); font-size: 13px; margin-top: 15px;">
                        💡 This creates an optimized taproot output where ${internalKey} can spend directly with just a signature, while other parties require revealing only their specific branch script.
                    </div>
                `;
            }
        } else {
            // No tree script (key-path only) - no mode selection needed, show simple message
            content += `
                <div style="margin-bottom: 15px; color: var(--text-secondary); font-size: 13px;">
                    💡 This is a key-path only taproot output. Only ${internalKey} can spend using a single signature.
                </div>
            </div>`;
            return content;
        }
        
        content += `</div>`;
        return content;
    }
    
    getKeyTooltip(keyName) {
        // Get the actual key value for tooltip display
        if (this.keyVariables && this.keyVariables.has(keyName)) {
            const keyValue = this.keyVariables.get(keyName);
            return `${keyName}: ${keyValue.slice(0, 16)}...${keyValue.slice(-8)}`;
        }
        return `Variable: ${keyName} (hover to see full key when available)`;
    }
    
    parseTrDescriptor(descriptor) {
        // Helper function to parse tr() descriptors with proper parentheses handling
        console.log(`Parsing tr() descriptor: ${descriptor}`);
        
        // Remove checksum first if present
        let cleanDescriptor = descriptor;
        const checksumMatch = descriptor.match(/#[a-zA-Z0-9]+$/);
        if (checksumMatch) {
            cleanDescriptor = descriptor.replace(/#[a-zA-Z0-9]+$/, '');
        }
        
        // Validate tr() format
        if (!cleanDescriptor.startsWith('tr(') || !cleanDescriptor.endsWith(')')) {
            console.error('Invalid tr() format:', descriptor);
            return null;
        }
        
        // Extract content between tr( and )
        const trContent = cleanDescriptor.slice(3, -1);
        
        // Find the first comma that's not inside parentheses
        let commaIndex = -1;
        let parenCount = 0;
        for (let i = 0; i < trContent.length; i++) {
            if (trContent[i] === '(') parenCount++;
            else if (trContent[i] === ')') parenCount--;
            else if (trContent[i] === ',' && parenCount === 0) {
                commaIndex = i;
                break;
            }
        }
        
        let internalKey, treeScript;
        if (commaIndex === -1) {
            // No comma found, key-path only: tr(key)
            internalKey = trContent.trim();
            treeScript = undefined;
        } else {
            // Split at the comma
            internalKey = trContent.slice(0, commaIndex).trim();
            treeScript = trContent.slice(commaIndex + 1).trim();
        }
        
        console.log(`Parsed - Internal key: "${internalKey}", Tree script: "${treeScript}"`);
        return { internalKey, treeScript };
    }
    
    clearAllEditors() {
        // Clear miniscript editor
        const miniscriptInput = document.getElementById('expression-input');
        if (miniscriptInput) {
            miniscriptInput.value = '';
            miniscriptInput.innerHTML = '';
        }
        
        // Clear all script outputs
        const scriptHex = document.getElementById('script-hex');
        const scriptAsm = document.getElementById('script-asm');
        const addressOutput = document.getElementById('address-output');
        const treeVisualization = document.getElementById('tree-visualization');
        const miniscriptSuccess = document.getElementById('miniscript-success-message');
        
        if (scriptHex) scriptHex.value = '';
        if (scriptAsm) scriptAsm.value = '';
        if (addressOutput) addressOutput.value = '';
        if (treeVisualization) treeVisualization.innerHTML = '';
        if (miniscriptSuccess) miniscriptSuccess.style.display = 'none';
        
        console.log('Cleared all editors and outputs for multi-branch taproot');
    }
    
    parseTaprootBranches(treeScript) {
        console.log(`parseTaprootBranches called with: ${treeScript}`);
        if (!treeScript) return [];
        
        // Handle {pk(A),pk(B)} format
        if (treeScript.startsWith('{') && treeScript.endsWith('}')) {
            const inner = treeScript.slice(1, -1);
            const branches = [];
            
            // Simple parsing - split on commas at depth 0
            let depth = 0;
            let parenDepth = 0;
            let start = 0;
            
            for (let i = 0; i < inner.length; i++) {
                const ch = inner[i];
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
                else if (ch === '(') parenDepth++;
                else if (ch === ')') parenDepth--;
                else if (ch === ',' && depth === 0 && parenDepth === 0) {
                    branches.push(inner.slice(start, i).trim());
                    start = i + 1;
                }
            }
            
            // Add the last branch
            if (start < inner.length) {
                branches.push(inner.slice(start).trim());
            }
            
            return branches;
        }
        
        // Single branch - remove any tr() wrapper using helper function
        let singleBranch = treeScript;
        if (singleBranch.startsWith('tr(')) {
            const parsed = this.parseTrDescriptor(singleBranch);
            if (parsed && parsed.treeScript) {
                singleBranch = parsed.treeScript;
            }
        }
        return [singleBranch];
    }
    
    updatePolicySuccessContent(existingSuccess, miniscript, result = null) {
        // Update the content for auto-compile scenarios
        const contentDiv = existingSuccess.querySelector('div[style*="margin-top: 10px"]');
        if (contentDiv) {
            const newContent = this.generatePolicySuccessContent(miniscript, result);
            contentDiv.outerHTML = newContent;
        }
    }

    clearPolicyErrors(preserveSuccess = false) {
        if (preserveSuccess) {
            const errorsDiv = document.getElementById('policy-errors');
            const successBox = errorsDiv.querySelector('.result-box.success');
            if (successBox) {
                // Keep the success message, only clear errors
                const errors = errorsDiv.querySelectorAll('.result-box.error');
                errors.forEach(error => error.remove());
                return;
            }
        }
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
            // Force reapply styling after innerHTML change
            this.enforceElementStyling(policyInput);
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

    highlightMiniscriptSyntax(skipCursorRestore = false) {
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
            // Force reapply styling after innerHTML change
            this.enforceElementStyling(expressionInput);
            // Restore cursor position only if not skipping
            if (!skipCursorRestore) {
                this.restoreCursor(expressionInput, caretOffset);
            }
        }
        
        // Store the last highlighted text
        expressionInput.dataset.lastHighlightedText = text;
    }
    
    enforceElementStyling(element) {
        // Force reapply CSS styles that might be lost after innerHTML changes
        console.log('Enforcing styling for element:', element.id, 'theme:', document.documentElement.getAttribute('data-theme'));
        
        if (document.documentElement.getAttribute('data-theme') === 'light') {
            // Force light theme styling for contenteditable elements
            if (element.id === 'policy-input' || element.id === 'expression-input') {
                console.log('Applying light theme styles to:', element.id);
                element.style.setProperty('border', '2px solid #cbd5e0', 'important');
                element.style.setProperty('background', '#e2e8f0', 'important');
                element.style.setProperty('filter', 'brightness(1)', 'important');
                element.style.setProperty('border-radius', '8px', 'important');
                element.style.setProperty('padding', '10px 15px', 'important');
                
                // Force a repaint
                element.offsetHeight;
            } else if (element.id === 'script-hex-display' || element.id === 'script-asm-display') {
                console.log('Applying light theme styles to script field:', element.id);
                element.style.setProperty('border', '1px solid #cbd5e0', 'important');
                element.style.setProperty('background', '#e2e8f0', 'important');
                element.style.setProperty('filter', 'brightness(1)', 'important');
                element.style.setProperty('border-radius', '4px', 'important');
                element.style.setProperty('padding', '10px', 'important');
                
                // Force a repaint
                element.offsetHeight;
            } else if (element.id === 'address-display') {
                console.log('Applying light theme styles to address display:', element.id);
                element.style.setProperty('border', '1px solid #cbd5e0', 'important');
                element.style.setProperty('background', '#e2e8f0', 'important');
                element.style.setProperty('border-radius', '4px', 'important');
                element.style.setProperty('padding', '10px', 'important');
                
                // Force a repaint
                element.offsetHeight;
            }
        }
    }

    applyMiniscriptSyntaxHighlighting(text) {
        // Miniscript syntax patterns (based on official spec: https://bitcoin.sipa.be/miniscript/)
        return text
            // HD wallet descriptors: [fingerprint/path]xpub/<range>/* or [fingerprint/path]xpub/path/index or [fingerprint/path]xpub/<range>/index
            .replace(/(\[)([A-Fa-f0-9]{8})(\/)([0-9h'/]+)(\])([xt]pub[A-Za-z0-9]+)((?:\/<[0-9;]+>\/(?:\*|[0-9]+)|\/[0-9]+\/[0-9*]+))/g, 
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

    positionCursorAtEnd(element) {
        const selection = window.getSelection();
        const range = document.createRange();
        selection.removeAllRanges();
        
        // Find the last text node to ensure we're at the very end
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        let lastTextNode = null;
        while (walker.nextNode()) {
            lastTextNode = walker.currentNode;
        }
        
        if (lastTextNode) {
            range.setStart(lastTextNode, lastTextNode.textContent.length);
            range.setEnd(lastTextNode, lastTextNode.textContent.length);
        } else {
            range.selectNodeContents(element);
            range.collapse(false);
        }
        
        selection.addRange(range);
    }

    replaceKeyVariables(text, context = null) {
        let processedText = text;
        
        // Get current context if not provided
        if (!context) {
            const contextRadio = document.querySelector('input[name="context"]:checked');
            context = contextRadio ? contextRadio.value : 'legacy';
        }
        
        for (const [name, value] of this.keyVariables) {
            // Use the key value as-is without any conversion
            // Users must select appropriate key types for their context
            const keyToUse = value;
            
            // Replace key variables in pk(), using word boundaries to avoid partial matches
            const regex = new RegExp('\\b' + name + '\\b', 'g');
            processedText = processedText.replace(regex, keyToUse);
        }
        return processedText;
    }

    generateKey() {
        console.log('Generate key button clicked!');
        this.isGeneratingKey = true; // Set flag to prevent clearing suggestion
        
        // Get selected key type from radio buttons
        const selectedType = document.querySelector('input[name="keyType"]:checked')?.value || 'compressed';
        console.log('Selected key type:', selectedType);
        
        // Define all key pools (compressed: 60 keys, others: 20 keys each)
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
        
        // Set a descriptive name based on key type
        const nameInput = document.getElementById('key-name-input');
        if (nameInput) {
            const currentName = nameInput.value.trim();
            
            // Update name if: 
            // 1. Input is empty, OR
            // 2. Current name matches our last suggested name (user didn't edit it)
            const shouldUpdateName = !currentName || currentName === this.lastSuggestedKeyName;
            
            if (shouldUpdateName) {
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
                this.lastSuggestedKeyName = keyName; // Remember this suggestion
                nameInput.focus();
            }
        }
        
        this.isGeneratingKey = false; // Clear flag after generation
    }

    generateCompressedPublicKey(privateKey) {
        // 66-character compressed keys for Legacy/Segwit v0 (60 keys total)
        const compressedKeys = [
            // Original 20 keys
            '03da6a0f9b14e0c82b2e3b0e9f9f3b4a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f',
            '02c8a5c2e3b4a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3',
            '03b7a0766e8b6b29700c970dbb0b48ac195cd8aedaa3d73152d01c0771c2874aa9',
            '02f8073b09f6e6f0342456b8c27fb0187d618653cad737f3117bf5ce5dbb781325',
            '03889b5a28cfeb2958873df03119a43536c12c52a6484fd4afe71229a5ae06b55c',
            '021208140fbad9c4df73936df2e7e4a9333ad4925af7532f0c555b37399300e696',
            '0242b595b5feeb32e4c5a86971542dc6d0ac1627165f22d37332085fc527d1c13f',
            '02c98f1ee625379323ecaa58806f70f784256d5fc0fe84179935590a2156b233ef',
            '030bf2c8353ed6360cc76ae447d20f3e52988ebb325057f551a6156c254b9fb9ab',
            '02cb48e9d06a6baf071d581e7844e9a62a560aca3512edff68623d5003549fcef0',
            '03f4c1a73d0bd7dbc0c25aa361684bcb158c274ad76477eb145faea3858dc2fd4f',
            '02318f455a1ef51763e1acb573449e4a52e8fcada49f8a0fea8387a4f4b146b3ac',
            '03681ff8dd97a900012dc58dcb4b9ab3e40b29b96bc3e014ae1eba4f7b80abb3c8',
            '0230efbeba3e9b9321c1cbcf93f416c25fbcb96c322b3ecc73e0dfd6db558ca682',
            '03996553edf7dc7702e4f4ed8e2feadb5dbbd1f3c55c64c7ee943b32e870d1f2a0',
            '0288c70836e9cb416570e2d693518d6cbee339f72b434630abdca636914bbc123f',
            '021683fe7f8ebfabf5fb633742d62bec545832b8e4b5cc5edb587d08f8b4f02910',
            '02d5c06cb7ff25d38cecd81aaa1bf773adeb6617d6eb003fd9f094633f3b4960a6',
            '03d9be1c4959365a8dcea4aefa16fd59d2dd2283a60f3026e26cf75a431119f8f4',
            '0391ca383cf8c5c6d6a35f444034acc271987648f3b4f729520fb208683b2b9ef1',
            // Your new 20 keys
            '03ba2ce74b3c84c71dce4a26a1333279115584cf87faad02f828668d3e7c47bc3c',
            '02ffa28c77cae4923aa5eb52795e3fc9e448046064b3d7a765ce7bff73a073f3ed',
            '0391ca383cf8c5c6d6a35f444034acc271987648f3b4f729520fb208683b2b9ef1',
            '03b7a0766e8b6b29700c970dbb0b48ac195cd8aedaa3d73152d01c0771c2874aa9',
            '03d9be1c4959365a8dcea4aefa16fd59d2dd2283a60f3026e26cf75a431119f8f4',
            '021683fe7f8ebfabf5fb633742d62bec545832b8e4b5cc5edb587d08f8b4f02910',
            '02d5c06cb7ff25d38cecd81aaa1bf773adeb6617d6eb003fd9f094633f3b4960a6',
            '03681ff8dd97a900012dc58dcb4b9ab3e40b29b96bc3e014ae1eba4f7b80abb3c8',
            '0230efbeba3e9b9321c1cbcf93f416c25fbcb96c322b3ecc73e0dfd6db558ca682',
            '03996553edf7dc7702e4f4ed8e2feadb5dbbd1f3c55c64c7ee943b32e870d1f2a0',
            '0288c70836e9cb416570e2d693518d6cbee339f72b434630abdca636914bbc123f',
            '03889b5a28cfeb2958873df03119a43536c12c52a6484fd4afe71229a5ae06b55c',
            '02f8073b09f6e6f0342456b8c27fb0187d618653cad737f3117bf5ce5dbb781325',
            '02f4c1a73d0bd7dbc0c25aa361684bcb158c274ad76477eb145faea3858dc2fd4f',
            '0318f455a1ef51763e1acb573449e4a52e8fcada49f8a0fea8387a4f4b146b3ac7',
            '021208140fbad9c4df73936df2e7e4a9333ad4925af7532f0c555b37399300e696',
            '0242b595b5feeb32e4c5a86971542dc6d0ac1627165f22d37332085fc527d1c13f',
            '02c98f1ee625379323ecaa58806f70f784256d5fc0fe84179935590a2156b233ef',
            '030bf2c8353ed6360cc76ae447d20f3e52988ebb325057f551a6156c254b9fb9ab',
            '02cb48e9d06a6baf071d581e7844e9a62a560aca3512edff68623d5003549fcef0',
            // Third batch - 20 additional keys
            '03e4c0b897a93b6aec22d8a7a5675788bfe87733bd171f4f55f26b02bcc60b9967',
            '02cc96023563fe38b3215c38977a7bbf643a1f5922da6a21f8ed193540351c276e',
            '03d0d9724554e4055798bcbc06a1fc4d84e7167e6ff5993d3dd45f6274f8b21276',
            '021fa9c19bbed79d9cd8d19daa786c7580b1dc49fb6bee3f8232185b4e6ddb4bc1',
            '03d295974ab5949100b3da2d3cf4bc5ebab7abfaa698b3db21095f5ce99dc853fd',
            '03f2cd034586b5b6e91aad965728dde595399ac08c41919bf6b1a4cd1b343ea808',
            '02462eb2f8570e25c294bb41d2ce07c0fae64cb339d51e41705516e34db3dbab52',
            '02384ffe04b898c398ed623bde4a6021e626e5e3672f347b4a3c5cb70f562221cd',
            '0321866a6d38bc813e9b07c7677d387ac500ed9a40b6914ac4fb028612de948cc6',
            '02ceed6104e12d65a7f400e2324a76b997012958501795d428b6b98e2a260114df',
            '032acc58ef59d3184ef0c3062520c02cb0259f65b32cd454e7d0f0bc4cfd99ec18',
            '03689fe598aad546b0d80a1fae9995a4503d8d01d35432943205ff7a43e401541a',
            '033709f80850266879dda370543a0d2d1cd6c9862a722614d466dd93f7f47eb50a',
            '03a32f7874fe61b2d785836c6b3afb4352f4936c153d8dbb58302aa21cb241cfdf',
            '029aac123da5c0460e644ac9ba9c0f9347d69f24120120f9b4a2bff3a64f4c34da',
            '02b126e068fbd19934fa1f1683053dc3841d37b6fd892b544a61a51213e26c0f69',
            '03a6ae2758f0d081a22a9331487269b58cc117fa24114b16bc682a61c19b2bdb5e',
            '03ab2e75bcde03002722d44821b3d7bc61ebfddb488d928edf95d842ca699e1bb9',
            '02bffe09fc5f0204a8bef65eef4a1cb0d847f03aeb36b56306602d5fd325fbaa19',
            '021bd9dc0dd14fd7f34ec501892a8bcb725362f20a1541b216721e64f3f4e0b73e'
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
        // Default keys used in examples - using appropriate key types for different contexts
        
        // Legacy/Segwit keys (compressed, 66-char, starting with 02/03) - for general examples
        this.keyVariables.set('Alice', '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9');
        this.keyVariables.set('Bob', '03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd');
        this.keyVariables.set('Charlie', '03defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34');
        this.keyVariables.set('Eva', '034cf034640859162ba19ee5a5a33e713a86e2e285b79cdaf9d5db4a07aa59f765');
        this.keyVariables.set('Frank', '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
        this.keyVariables.set('Lara', '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
        this.keyVariables.set('Mike', '03774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb');
        this.keyVariables.set('Nina', '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13');
        this.keyVariables.set('Oliver', '03d01115d548e7561b15c38f004d734633687cf4419620095bc5b0f47070afe85a');
        this.keyVariables.set('Paul', '02791ca97e3d5c1dc6bc7e7e1a1e5fc19b90e0e8b1f9f0f1b2c3d4e5f6a7b8c9');
        this.keyVariables.set('Quinn', '03581c63a4f65b4dfb3baf7d5c3e5a6d4f0e7b2c8a9f1d3e4b2a5c6d7e8f9a0b');
        this.keyVariables.set('Rachel', '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4');
        this.keyVariables.set('Sam', '02bf0e7b0c8a7b1f9a3e4d2c5b6a8f9d0e7c1b4a3f6e9d2c5b8a1f4e7d0c3b6a');
        this.keyVariables.set('Tina', '032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991');
        this.keyVariables.set('Uma', '020e46e79a2a8d12b9b21b533e2f1c6d5a7f8e9c0b1d2a3f4e5c6b7a8f9d0e3c');
        
        // Taproot keys (x-only, 64-char) - for Taproot examples
        this.keyVariables.set('NUMS', '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0');
        this.keyVariables.set('David', 'fae4284884079a8134f553af138f5206584de24c44f2ba1b2d9215a32fc6b188');
        this.keyVariables.set('Helen', '96b6d68aefbcb7fd24c8847f98ec1d48bc24c3afd7d4fffda8ca3657ba6ab829');
        this.keyVariables.set('Ivan', 'ad9b3c720375428bb4f1e894b900f196537895d3c83878bcac7f008be7deedc2');
        this.keyVariables.set('Julia', 'd127f475aba7d9111ff69cc6858305d15e8912205cfa5dcc7a4c66a97ebb8174');
        this.keyVariables.set('Karl', 'b2afcd04877595b269282f860135bb03c8706046b0a57b17f252cf66e35cce89');
        
        // Complex descriptor keys
        this.keyVariables.set('TestnetKey', '[C8FE8D4F/48h/1h/123h/2h]tpubDDEe6Dc3LW1JEUzExDRZ3XBzcAzYxMTfVU5KojsTwXoJ4st6LzqgbFZ1HhDBdTptjXH9MwgdYG4K7MNJBfQktc6AoS8WeAWFDHwDTu99bZa/1/1');
        this.keyVariables.set('MainnetKey', '[C8FE8D4F/48h/1h/123h/2h]xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda/0/0');
        this.keyVariables.set('RangeKey', '[C8FE8D4F/48h/1h/123h/2h]tpubDDEe6Dc3LW1JEUzExDRZ3XBzcAzYxMTfVU5KojsTwXoJ4st6LzqgbFZ1HhDBdTptjXH9MwgdYG4K7MNJBfQktc6AoS8WeAWFDHwDTu99bZa/<1;0>/*');
        
        // Vault keys for complex vault examples with range descriptors
        this.keyVariables.set('VaultKey1', '[C8FE8D4F/48h/1h/123h/2h]tpubDET9Lf3UsPRZP7TVNV8w91Kz8g29sVihfr96asYsJqUsx5pM7cDvSCDAsidkQY9bgfPyB28bCA4afiJcJp6bxZhrzmjFYDUm92LG3s3tmP7/<10;11>/*');
        this.keyVariables.set('VaultKey2', '[C8FE8D4F/48h/1h/123h/2h]tpubDET9Lf3UsPRZP7TVNV8w91Kz8g29sVihfr96asYsJqUsx5pM7cDvSCDAsidkQY9bgfPyB28bCA4afiJcJp6bxZhrzmjFYDUm92LG3s3tmP7/<8;9>/*');
        this.keyVariables.set('VaultKey3', '[C8FE8D4F/48h/1h/123h/2h]tpubDET9Lf3UsPRZP7TVNV8w91Kz8g29sVihfr96asYsJqUsx5pM7cDvSCDAsidkQY9bgfPyB28bCA4afiJcJp6bxZhrzmjFYDUm92LG3s3tmP7/<6;7>/*');
        this.keyVariables.set('VaultKey4', '[7FBA5C83/48h/1h/123h/2h]tpubDE5BZRXogAy3LHDKYhfuw2gCasYxsfKPLrfdsS9GxAV45v7u2DAcBGCVKPYjLgYeMMKq29aAHy2xovHL9KTd8VvpMHfPiDA9jzBwCg73N5H/<6;7>/*');
        this.keyVariables.set('VaultKey5', '[7FBA5C83/48h/1h/123h/2h]tpubDE5BZRXogAy3LHDKYhfuw2gCasYxsfKPLrfdsS9GxAV45v7u2DAcBGCVKPYjLgYeMMKq29aAHy2xovHL9KTd8VvpMHfPiDA9jzBwCg73N5H/<4;5>/*');
        this.keyVariables.set('VaultKey6', '[CB6FE460/48h/1h/123h/2h]tpubDFJbyzFGfyGhwjc2CP7YHjD3hK53AoQWU2Q5eABX2VXcnEBxWVVHjtZhzg9PQLnoHe6iKjR3TamW3N9RVAY5WBbK5DBAs1D86wi2DEgMwpN/<12;13>/*');
        this.keyVariables.set('VaultKey7', '[CB6FE460/48h/1h/123h/2h]tpubDFJbyzFGfyGhwjc2CP7YHjD3hK53AoQWU2Q5eABX2VXcnEBxWVVHjtZhzg9PQLnoHe6iKjR3TamW3N9RVAY5WBbK5DBAs1D86wi2DEgMwpN/<10;11>/*');
        this.keyVariables.set('VaultKey8', '[CB6FE460/48h/1h/123h/2h]tpubDFJbyzFGfyGhwjc2CP7YHjD3hK53AoQWU2Q5eABX2VXcnEBxWVVHjtZhzg9PQLnoHe6iKjR3TamW3N9RVAY5WBbK5DBAs1D86wi2DEgMwpN/<8;9>/*');
        this.keyVariables.set('VaultKey9', '[CB6FE460/48h/1h/123h/2h]tpubDFJbyzFGfyGhwjc2CP7YHjD3hK53AoQWU2Q5eABX2VXcnEBxWVVHjtZhzg9PQLnoHe6iKjR3TamW3N9RVAY5WBbK5DBAs1D86wi2DEgMwpN/<6;7>/*');
        this.keyVariables.set('VaultKey10', '[9F996716/48h/1h/0h/2h]tpubDFCY8Uy2eRq7meifV2Astvt8AsTLsrMX7vj7cLtZ6aPRcYGsAL4PXY1JZR2SfD3i2CRAwy9fm9Cq3xVeuWsvAcRnz9oc1umGL68Wn9QeT3q/<16;17>/*');
        this.keyVariables.set('VaultKey11', '[9F996716/48h/1h/0h/2h]tpubDFCY8Uy2eRq7meifV2Astvt8AsTLsrMX7vj7cLtZ6aPRcYGsAL4PXY1JZR2SfD3i2CRAwy9fm9Cq3xVeuWsvAcRnz9oc1umGL68Wn9QeT3q/<14;15>/*');
        this.keyVariables.set('VaultKey12', '[9F996716/48h/1h/0h/2h]tpubDFCY8Uy2eRq7meifV2Astvt8AsTLsrMX7vj7cLtZ6aPRcYGsAL4PXY1JZR2SfD3i2CRAwy9fm9Cq3xVeuWsvAcRnz9oc1umGL68Wn9QeT3q/<12;13>/*');
        this.keyVariables.set('VaultKey13', '[9F996716/48h/1h/0h/2h]tpubDFCY8Uy2eRq7meifV2Astvt8AsTLsrMX7vj7cLtZ6aPRcYGsAL4PXY1JZR2SfD3i2CRAwy9fm9Cq3xVeuWsvAcRnz9oc1umGL68Wn9QeT3q/<10;11>/*');
        this.keyVariables.set('VaultKey14', '[9F996716/48h/1h/0h/2h]tpubDFCY8Uy2eRq7meifV2Astvt8AsTLsrMX7vj7cLtZ6aPRcYGsAL4PXY1JZR2SfD3i2CRAwy9fm9Cq3xVeuWsvAcRnz9oc1umGL68Wn9QeT3q/<8;9>/*');
        this.keyVariables.set('VaultKey15', '[0A4E923E/48h/1h/123h/2h]tpubDFNEWRT6uX3mjWE2c6CnbdQ7awvvnGub5s9ntaSyoQ4SSNmhHEc6RJ4Exwd2aLfGppDhvvey7gvYc7jiYfDFWtYG2sKXjKthhSs1X9yBkSy/<16;17>/*');
        this.keyVariables.set('VaultKey16', '[0A4E923E/48h/1h/123h/2h]tpubDFNEWRT6uX3mjWE2c6CnbdQ7awvvnGub5s9ntaSyoQ4SSNmhHEc6RJ4Exwd2aLfGppDhvvey7gvYc7jiYfDFWtYG2sKXjKthhSs1X9yBkSy/<14;15>/*');
        this.keyVariables.set('VaultKey17', '[0A4E923E/48h/1h/123h/2h]tpubDFNEWRT6uX3mjWE2c6CnbdQ7awvvnGub5s9ntaSyoQ4SSNmhHEc6RJ4Exwd2aLfGppDhvvey7gvYc7jiYfDFWtYG2sKXjKthhSs1X9yBkSy/<12;13>/*');
        this.keyVariables.set('VaultKey18', '[0A4E923E/48h/1h/123h/2h]tpubDFNEWRT6uX3mjWE2c6CnbdQ7awvvnGub5s9ntaSyoQ4SSNmhHEc6RJ4Exwd2aLfGppDhvvey7gvYc7jiYfDFWtYG2sKXjKthhSs1X9yBkSy/<10;11>/*');
        this.keyVariables.set('VaultKey19', '[0A4E923E/48h/1h/123h/2h]tpubDFNEWRT6uX3mjWE2c6CnbdQ7awvvnGub5s9ntaSyoQ4SSNmhHEc6RJ4Exwd2aLfGppDhvvey7gvYc7jiYfDFWtYG2sKXjKthhSs1X9yBkSy/<8;9>/*');
        
        // Joint custody keys for 3-key joint custody example
        this.keyVariables.set('jcKey1', '03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556');
        this.keyVariables.set('jcKey2', '025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357');
        this.keyVariables.set('jcKey3', '03d30199d74fb5a22d47b6e054e2f378cedacffcb89904a61d75d0dbd407143e65');
        this.keyVariables.set('saKey', '023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb');
        this.keyVariables.set('jcAg1', '03acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe');
        this.keyVariables.set('jcAg2', '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9');
        this.keyVariables.set('jcAg3', '03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd');
        this.keyVariables.set('recKey1', '03defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34');
        this.keyVariables.set('recKey2', '034cf034640859162ba19ee5a5a33e713a86e2e285b79cdaf9d5db4a07aa59f765');
        this.keyVariables.set('recKey3', '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
        
        // Liana wallet descriptor keys for multi-tier recovery vault example
        this.keyVariables.set('LianaDesc1', '[b883f127/48\'/1\'/2\'/2\']tpubDEP7MLK6TGe1EWhKGpMWdQQCvMmS6pRjCyN7PW24afniPJYdfeMMUb2fau3xTku6EPgA68oGuR4hSCTUpu2bqaoYrLn2UmhkytXXSzxcaqt/0/0');
        this.keyVariables.set('LianaDesc2', '[636adf3f/48\'/1\'/2\'/2\']tpubDFnPUtXZhnftEFD5vg4LfVoApf5ZVB8Nkrf8CNe9pT9j1EEPXssJnMgAjmvbTChHugnkfVfsmGafFnE6gwoifJNybSasAJ316dRpsP86EFb/0/0');
        this.keyVariables.set('LianaDesc3', '[b883f127/48\'/1\'/3\'/2\']tpubDFPMBua4idthySDayX1GxgXgPbpaEVfU7GwMc1HAfneknhqov5syrNuq4NVdSVWa2mPVP3BD6f2pGB98pMsbnVvWqrxcLgwv9PbEWyLJ6cW/0/0');
        this.keyVariables.set('LianaDesc4', '[636adf3f/48\'/1\'/1\'/2\']tpubDDvF2khuoBBj8vcSjQfa7iKaxsQZE7YjJ7cJL8A8eaneadMPKbHSpoSr4JD1F5LUvWD82HCxdtSppGfrMUmiNbFxrA2EHEVLnrdCFNFe75D/0/0');
        this.keyVariables.set('LianaDesc5', '[636adf3f/48\'/1\'/0\'/2\']tpubDEE9FvWbG4kg4gxDNrALgrWLiHwNMXNs8hk6nXNPw4VHKot16xd2251vwi2M6nsyQTkak5FJNHVHkCcuzmvpSbWHdumX3DxpDm89iTfSBaL/0/0');
        this.keyVariables.set('LianaDesc6', '[b883f127/48\'/1\'/0\'/2\']tpubDET11c81MZjJvsqBikGXfn1YUzXofoYQ4HkueCrH7kE94MYkdyBvGzyikBd2KrcBAFZWDB6nLmTa8sJ381rWSQj8qFvqiidxqn6aQv1wrJw/0/0');
        this.keyVariables.set('LianaDesc7', '[b883f127/48\'/1\'/1\'/2\']tpubDEA6SKh5epTZXebgZtcNxpLj6CeZ9UhgHGoGArACFE7QHCgx76vwkzJMP5wQ9yYEc6g9qSGW8EVzn4PhRxiFz1RUvAXBg7txFnvZFv62uFL/0/0');
        
        this.saveKeyVariables();
        this.displayKeyVariables();
    }

    restoreDefaultKeys() {
        if (confirm('This will restore 56 default key variables: Alice, Bob, Charlie, Eva, Frank, Lara, Helen, Ivan, Julia, Karl, David, Mike, Nina, Oliver, Paul, Quinn, Rachel, Sam, Tina, Uma, plus joint custody keys (jcKey1, jcKey2, jcKey3, saKey, jcAg1, jcAg2, jcAg3, recKey1, recKey2, recKey3), plus descriptor keys (TestnetKey, MainnetKey, RangeKey, VaultKey1-19), plus Liana wallet keys (LianaDesc1-7). Continue?')) {
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

    extractKeysFromPolicy() {
        const policyInput = document.getElementById('policy-input');
        const expression = policyInput.textContent || policyInput.innerText || '';
        
        if (!expression.trim()) {
            this.showPolicyError('Please enter a policy expression first');
            return;
        }
        
        // Extract all keys from expression (auto-detect hex vs variables)
        const allKeys = this.extractKeysFromExpression(expression);
        if (allKeys.length === 0) {
            this.showPolicyError('All keys in this expression are already defined as variables. No new keys to extract.');
            return;
        }
        
        // Check for existing variables
        const existingVariableErrors = this.checkForExistingVariables(expression);
        
        // Filter out keys that correspond to existing variables
        const newKeys = allKeys.filter(key => {
            return !existingVariableErrors.includes(key.name);
        });
        
        if (newKeys.length === 0) {
            this.showPolicyError('All keys in this expression are already defined as variables (' + existingVariableErrors.join(', ') + '). No new keys to extract.');
            return;
        }
        
        // Show modal with only the new keys
        if (existingVariableErrors.length > 0) {
            // Show info that some keys already exist
            console.log(`${existingVariableErrors.length} keys already exist as variables: ${existingVariableErrors.join(', ')}`);
        }
        
        this.showExtractModal(newKeys, expression);
    }

    extractKeysFromMiniscript() {
        const expressionInput = document.getElementById('expression-input');
        const expression = expressionInput.textContent || expressionInput.innerText || '';
        
        if (!expression.trim()) {
            this.showMiniscriptError('Please enter a miniscript expression first');
            return;
        }
        
        // Extract all keys from expression (auto-detect hex vs variables)
        const allKeys = this.extractKeysFromExpression(expression);
        if (allKeys.length === 0) {
            this.showMiniscriptError('All keys in this expression are already defined as variables. No new keys to extract.');
            return;
        }
        
        // Check for existing variables
        const existingVariableErrors = this.checkForExistingVariables(expression);
        
        // Filter out keys that correspond to existing variables
        const newKeys = allKeys.filter(key => {
            return !existingVariableErrors.includes(key.name);
        });
        
        if (newKeys.length === 0) {
            this.showMiniscriptError('Found existing variables in expression: ' + existingVariableErrors.join(', ') + '. These variables are already defined and cannot be extracted again.');
            return;
        }
        
        // Show modal with only the new keys
        if (existingVariableErrors.length > 0) {
            // Show info that some keys already exist
            console.log(`${existingVariableErrors.length} keys already exist as variables: ${existingVariableErrors.join(', ')}`);
        }
        
        this.showExtractModal(newKeys, expression);
    }

    checkForExistingVariables(expression) {
        const existingVariables = [];
        
        // Use the same patterns as in extractKeysFromExpression to find variables
        const variablePatterns = [
            // pk(VarName), pkh(VarName), pk_k(VarName), pk_h(VarName)
            /\b(?:pk|pkh|pk_k|pk_h)\(([A-Za-z_][A-Za-z0-9_]*)\)/g,
            // multi(threshold,VarName1,VarName2,...)
            /\bmulti\([0-9]+,([A-Za-z_][A-Za-z0-9_,\s]*)\)/g,
            // Inside thresh(), and(), or() - look for bare variable names
            /\b(?:thresh|and|or)\([^)]*\b([A-Za-z_][A-Za-z0-9_]*)\b[^)]*\)/g
        ];
        
        const foundVariables = new Set();
        
        for (const pattern of variablePatterns) {
            let match;
            while ((match = pattern.exec(expression)) !== null) {
                if (pattern.source.includes('multi')) {
                    // Special handling for multi() - split the variable list
                    const variables = match[1].split(',').map(v => v.trim());
                    variables.forEach(variable => {
                        if (this.isValidVariableName(variable)) {
                            foundVariables.add(variable);
                        }
                    });
                } else {
                    const variable = match[1].trim();
                    if (this.isValidVariableName(variable)) {
                        foundVariables.add(variable);
                    }
                }
            }
        }
        
        // Check if any found variables already exist
        for (const variable of foundVariables) {
            if (this.keyVariables.has(variable)) {
                existingVariables.push(variable);
            }
        }
        
        return existingVariables;
    }

    extractKeysFromExpression(expression) {
        const keys = [];
        const descriptorKeys = new Set(); // Track which keys are part of descriptors
        const baseKeyGroups = new Map(); // Group descriptors by their base key
        
        // First, find all full descriptors and their embedded keys
        const descriptorPattern = /\[[0-9a-fA-F]{8}\/[0-9h'\/]+\][xt]pub[A-Za-z0-9]+(?:\/[0-9<>;*\/]+)?/g;
        const descriptorMatches = expression.match(descriptorPattern);
        
        if (descriptorMatches) {
            // Group descriptors by their base key
            descriptorMatches.forEach(descriptor => {
                if (!this.keyVariables.has(descriptor)) {
                    const embeddedKeyMatch = descriptor.match(/[xt]pub[A-Za-z0-9]+/);
                    if (embeddedKeyMatch) {
                        const baseKey = embeddedKeyMatch[0];
                        if (!baseKeyGroups.has(baseKey)) {
                            baseKeyGroups.set(baseKey, []);
                        }
                        baseKeyGroups.get(baseKey).push(descriptor);
                        descriptorKeys.add(baseKey);
                    }
                }
            });
            
            // Add base keys first (unselected by default when there are multiple descriptors)
            for (const [baseKey, descriptors] of baseKeyGroups) {
                if (!this.keyVariables.has(baseKey)) {
                    const hasMultipleDescriptors = descriptors.length > 1;
                    keys.push({
                        value: baseKey,
                        type: 'base',
                        isDefault: false, // Base keys are unselected by default
                        descriptorCount: descriptors.length,
                        parentDescriptors: descriptors
                    });
                }
            }
            
            // Then add individual descriptors (selected by default)
            for (const [baseKey, descriptors] of baseKeyGroups) {
                descriptors.forEach(descriptor => {
                    keys.push({
                        value: descriptor,
                        type: 'descriptor',
                        isDefault: true, // Descriptors are selected by default
                        baseKey: baseKey
                    });
                });
            }
        }
        
        // Then find individual keys that are not part of descriptors
        const individualKeyPatterns = [
            // X-only keys (64 hex chars)
            /\b[0-9a-fA-F]{64}\b/g,
            // Compressed keys (66 hex chars starting with 02 or 03)
            /\b0[23][0-9a-fA-F]{64}\b/g,
            // Uncompressed keys (130 hex chars starting with 04)
            /\b04[0-9a-fA-F]{128}\b/g,
            // xpub keys
            /\bxpub[A-Za-z0-9]{107,108}\b/g,
            // tpub keys
            /\btpub[A-Za-z0-9]{107,108}\b/g
        ];
        
        for (const pattern of individualKeyPatterns) {
            const matches = expression.match(pattern);
            if (matches) {
                matches.forEach(key => {
                    // Skip if this key is already a variable name we know
                    // or if it's already been added as part of a descriptor
                    if (!this.keyVariables.has(key) && !descriptorKeys.has(key)) {
                        keys.push({
                            value: key,
                            type: 'individual',
                            isDefault: true // Individual keys are selected by default
                        });
                    }
                });
            }
        }
        
        // Finally, find key variables in miniscript/policy functions
        const variablePatterns = [
            // pk(VarName), pkh(VarName), pk_k(VarName), pk_h(VarName)
            /\b(?:pk|pkh|pk_k|pk_h)\(([A-Za-z_][A-Za-z0-9_]*)\)/g,
            // multi(threshold,VarName1,VarName2,...)
            /\bmulti\([0-9]+,([A-Za-z_][A-Za-z0-9_,\s]*)\)/g
        ];
        
        const foundVariables = new Set();
        
        for (const pattern of variablePatterns) {
            let match;
            while ((match = pattern.exec(expression)) !== null) {
                if (pattern.source.includes('multi')) {
                    // Special handling for multi() - split the variable list
                    const variables = match[1].split(',').map(v => v.trim());
                    variables.forEach(variable => {
                        if (this.isValidVariableName(variable)) {
                            foundVariables.add(variable);
                        }
                    });
                } else {
                    const variable = match[1].trim();
                    if (this.isValidVariableName(variable)) {
                        foundVariables.add(variable);
                    }
                }
            }
        }
        
        // Add undefined variables to the keys array
        for (const variable of foundVariables) {
            // Only add if it's not already defined and not a hex key
            if (!this.keyVariables.has(variable) && !this.isHexString(variable)) {
                keys.push({
                    value: variable,
                    type: 'variable',
                    isDefault: true, // Variables are selected by default
                    keyType: this.suggestKeyTypeForContext() // Default key type based on current context
                });
            }
        }
        
        return keys;
    }
    
    isValidVariableName(name) {
        // Check if it's a valid variable name (not a number, not a hex string, reasonable length)
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && 
               name.length <= 20 && 
               !this.isHexString(name) &&
               isNaN(name);
    }
    
    isHexString(str) {
        return /^[0-9a-fA-F]+$/.test(str) && (str.length === 64 || str.length === 66 || str.length === 130);
    }
    
    suggestKeyTypeForContext() {
        // Get current context from radio buttons
        const contextRadio = document.querySelector('input[name="context"]:checked');
        const context = contextRadio ? contextRadio.value : 'segwit';
        
        // Suggest appropriate key type for context
        switch (context) {
            case 'taproot':
                return 'x-only';
            case 'legacy':
            case 'segwit':
            default:
                return 'compressed';
        }
    }

    suggestKeyName(keyValue, existingNames = []) {
        // Determine key type
        let prefix = 'Key';
        if (keyValue.startsWith('xpub')) {
            prefix = 'MainnetKey';
        } else if (keyValue.startsWith('tpub')) {
            prefix = 'TestnetKey';
        } else if (keyValue.length === 64) {
            prefix = 'TaprootKey';
        } else if (keyValue.length === 66 && (keyValue.startsWith('02') || keyValue.startsWith('03'))) {
            prefix = 'Key';
        } else if (keyValue.includes('[') && keyValue.includes(']')) {
            prefix = 'VaultKey';
        }
        
        // Find a unique name
        let counter = 1;
        let suggestedName = prefix + counter;
        
        while (this.keyVariables.has(suggestedName) || existingNames.includes(suggestedName)) {
            counter++;
            suggestedName = prefix + counter;
        }
        
        return suggestedName;
    }

    getUnusedKeyFromPool(keyType, temporarilyUsedKeys = []) {
        // Define all key pools (same as in generateKey function)
        const keyPools = {
            compressed: [
                // Original 20 keys
                '03da6a0f9b14e0c82b2e3b0e9f9f3b4a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f',
                '02c8a5c2e3b4a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3',
                '03b7a0766e8b6b29700c970dbb0b48ac195cd8aedaa3d73152d01c0771c2874aa9',
                '02f8073b09f6e6f0342456b8c27fb0187d618653cad737f3117bf5ce5dbb781325',
                '03889b5a28cfeb2958873df03119a43536c12c52a6484fd4afe71229a5ae06b55c',
                '021208140fbad9c4df73936df2e7e4a9333ad4925af7532f0c555b37399300e696',
                '0242b595b5feeb32e4c5a86971542dc6d0ac1627165f22d37332085fc527d1c13f',
                '02c98f1ee625379323ecaa58806f70f784256d5fc0fe84179935590a2156b233ef',
                '030bf2c8353ed6360cc76ae447d20f3e52988ebb325057f551a6156c254b9fb9ab',
                '02cb48e9d06a6baf071d581e7844e9a62a560aca3512edff68623d5003549fcef0',
                '03f4c1a73d0bd7dbc0c25aa361684bcb158c274ad76477eb145faea3858dc2fd4f',
                '02318f455a1ef51763e1acb573449e4a52e8fcada49f8a0fea8387a4f4b146b3ac',
                '03681ff8dd97a900012dc58dcb4b9ab3e40b29b96bc3e014ae1eba4f7b80abb3c8',
                '0230efbeba3e9b9321c1cbcf93f416c25fbcb96c322b3ecc73e0dfd6db558ca682',
                '03996553edf7dc7702e4f4ed8e2feadb5dbbd1f3c55c64c7ee943b32e870d1f2a0',
                '0288c70836e9cb416570e2d693518d6cbee339f72b434630abdca636914bbc123f',
                '021683fe7f8ebfabf5fb633742d62bec545832b8e4b5cc5edb587d08f8b4f02910',
                '02d5c06cb7ff25d38cecd81aaa1bf773adeb6617d6eb003fd9f094633f3b4960a6',
                '03d9be1c4959365a8dcea4aefa16fd59d2dd2283a60f3026e26cf75a431119f8f4',
                '0391ca383cf8c5c6d6a35f444034acc271987648f3b4f729520fb208683b2b9ef1',
                // Your new 20 keys
                '03ba2ce74b3c84c71dce4a26a1333279115584cf87faad02f828668d3e7c47bc3c',
                '02ffa28c77cae4923aa5eb52795e3fc9e448046064b3d7a765ce7bff73a073f3ed',
                '0391ca383cf8c5c6d6a35f444034acc271987648f3b4f729520fb208683b2b9ef1',
                '03b7a0766e8b6b29700c970dbb0b48ac195cd8aedaa3d73152d01c0771c2874aa9',
                '03d9be1c4959365a8dcea4aefa16fd59d2dd2283a60f3026e26cf75a431119f8f4',
                '021683fe7f8ebfabf5fb633742d62bec545832b8e4b5cc5edb587d08f8b4f02910',
                '02d5c06cb7ff25d38cecd81aaa1bf773adeb6617d6eb003fd9f094633f3b4960a6',
                '03681ff8dd97a900012dc58dcb4b9ab3e40b29b96bc3e014ae1eba4f7b80abb3c8',
                '0230efbeba3e9b9321c1cbcf93f416c25fbcb96c322b3ecc73e0dfd6db558ca682',
                '03996553edf7dc7702e4f4ed8e2feadb5dbbd1f3c55c64c7ee943b32e870d1f2a0',
                '0288c70836e9cb416570e2d693518d6cbee339f72b434630abdca636914bbc123f',
                '03889b5a28cfeb2958873df03119a43536c12c52a6484fd4afe71229a5ae06b55c',
                '02f8073b09f6e6f0342456b8c27fb0187d618653cad737f3117bf5ce5dbb781325',
                '02f4c1a73d0bd7dbc0c25aa361684bcb158c274ad76477eb145faea3858dc2fd4f',
                '0318f455a1ef51763e1acb573449e4a52e8fcada49f8a0fea8387a4f4b146b3ac7',
                '021208140fbad9c4df73936df2e7e4a9333ad4925af7532f0c555b37399300e696',
                '0242b595b5feeb32e4c5a86971542dc6d0ac1627165f22d37332085fc527d1c13f',
                '02c98f1ee625379323ecaa58806f70f784256d5fc0fe84179935590a2156b233ef',
                '030bf2c8353ed6360cc76ae447d20f3e52988ebb325057f551a6156c254b9fb9ab',
                '02cb48e9d06a6baf071d581e7844e9a62a560aca3512edff68623d5003549fcef0'
            ],
            'x-only': [
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
        const keyPool = keyPools[keyType];
        if (!keyPool) {
            console.error('Invalid key type:', keyType);
            return null;
        }
        
        // Get already used keys (both from storage and temporarily allocated)
        const usedKeys = Array.from(this.keyVariables.values());
        const allUsedKeys = [...usedKeys, ...temporarilyUsedKeys];
        
        // Filter out already used keys from the appropriate pool
        const availableKeys = keyPool.filter(key => !allUsedKeys.includes(key));
        
        // If no keys available, return null
        if (availableKeys.length === 0) {
            console.warn('No unused keys available in pool for type:', keyType);
            return null;
        }
        
        // Return the first available key
        return availableKeys[0];
    }

    showExtractModal(keys, originalExpression) {
        const modal = document.getElementById('extract-keys-modal');
        const listDiv = document.getElementById('extract-keys-list');
        const errorDiv = document.getElementById('extract-error-message');
        
        // Hide error message initially
        errorDiv.style.display = 'none';
        errorDiv.textContent = '';
        
        // Store extraction data for later use
        this.extractionData = {
            keys: keys,
            originalExpression: originalExpression,
            mappings: []
        };
        
        // Check for existing keys
        const existingKeys = [];
        keys.forEach(keyObj => {
            // Check if this exact key value already exists in variables
            for (const [name, value] of this.keyVariables) {
                if (value === keyObj.value) {
                    existingKeys.push({ key: keyObj.value, name: name });
                    break;
                }
            }
        });
        
        // Clear and populate the list
        listDiv.innerHTML = '';
        
        keys.forEach((keyObj, index) => {
            const key = keyObj.value;
            const existingVar = existingKeys.find(e => e.key === key);
            const isExisting = !!existingVar;
            // For variables, use the exact variable name; for raw keys, suggest a name
            const suggestedName = isExisting ? existingVar.name : 
                                  (keyObj.type === 'variable' ? key : this.suggestKeyName(key, this.extractionData.mappings.map(m => m.name)));
            this.extractionData.mappings.push({ key: key, name: suggestedName });
            
            // Determine key type for display based on the new structure
            let keyType = 'Unknown';
            let keyClass = '';
            let specialNote = '';
            
            if (keyObj.type === 'variable') {
                // Key variable - needs type selection
                keyType = 'Variable';
                keyClass = 'variable';
                specialNote = `<span style="color: var(--text-muted); font-size: 11px; margin-left: 10px;">🏷️ Key variable</span>`;
            } else if (keyObj.type === 'base') {
                // Base key (tpub/xpub)
                if (key.startsWith('xpub')) {
                    keyType = 'Base xpub';
                    keyClass = 'xpub';
                } else if (key.startsWith('tpub')) {
                    keyType = 'Base tpub';
                    keyClass = 'tpub';
                }
                specialNote = `<span style="color: var(--text-muted); font-size: 11px; margin-left: 10px;">🔑 Used in ${keyObj.descriptorCount} descriptor${keyObj.descriptorCount > 1 ? 's' : ''}</span>`;
            } else if (keyObj.type === 'descriptor') {
                keyType = 'Full Descriptor';
                keyClass = 'descriptor';
                specialNote = `<span style="color: var(--text-muted); font-size: 11px; margin-left: 10px;">📋 Based on ${keyObj.baseKey.substring(0, 15)}...</span>`;
            } else {
                // Individual keys (legacy handling)
                if (key.startsWith('xpub')) {
                    keyType = 'xpub';
                    keyClass = 'xpub';
                } else if (key.startsWith('tpub')) {
                    keyType = 'tpub';
                    keyClass = 'tpub';
                } else if (key.length === 64) {
                    keyType = 'X-only';
                    keyClass = 'xonly';
                } else if (key.length === 66 && (key.startsWith('02') || key.startsWith('03'))) {
                    keyType = 'Compressed';
                    keyClass = 'compressed';
                } else if (key.includes('[') && key.includes(']')) {
                    keyType = 'Descriptor';
                    keyClass = 'descriptor';
                }
            }
            
            const itemDiv = document.createElement('div');
            itemDiv.style.cssText = 'margin-bottom: 15px; padding: 10px; background: var(--secondary-bg); border-radius: 8px; border: 1px solid var(--border-color);';
            
            const warningText = isExisting ? `<span style="color: var(--warning-color); font-size: 11px; margin-left: 10px;">⚠️ Already exists as "${existingVar.name}"</span>` : '';
            
            // Determine checkbox state: checked if not existing AND is default selection
            const shouldBeChecked = !isExisting && keyObj.isDefault;
            
            itemDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                    <input type="checkbox" 
                           id="extract-checkbox-${index}" 
                           ${shouldBeChecked ? 'checked' : ''}
                           style="cursor: pointer;">
                    <span class="key-badge ${keyClass}" style="font-size: 11px; padding: 3px 8px; background: var(--accent-color); color: white; border-radius: 4px;">${keyType}</span>
                    <code style="font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${key.substring(0, 20)}...${key.substring(key.length - 10)}</code>
                    ${warningText}${specialNote}
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <label style="color: var(--text-secondary); min-width: 50px;">Name:</label>
                    <input type="text" 
                           id="extract-name-${index}" 
                           value="${suggestedName}" 
                           placeholder="Enter variable name"
                           ${isExisting ? 'disabled' : ''}
                           style="flex: 1; padding: 6px; background: ${isExisting ? 'var(--disabled-bg)' : 'var(--bg-color)'}; border: 1px solid var(--border-color); border-radius: 4px; color: ${isExisting ? 'var(--text-muted)' : 'var(--text-primary)'};">
                    ${keyObj.type === 'variable' && !isExisting ? `
                    <label style="color: var(--text-secondary); min-width: 40px;">Type:</label>
                    <select id="extract-type-${index}" 
                            style="padding: 6px; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);">
                        <option value="compressed" ${keyObj.suggestedType === 'compressed' ? 'selected' : ''}>Compressed (66 chars)</option>
                        <option value="x-only" ${keyObj.suggestedType === 'x-only' ? 'selected' : ''}>X-Only (64 chars)</option>
                        <option value="xpub" ${keyObj.suggestedType === 'xpub' ? 'selected' : ''}>xpub (mainnet)</option>
                        <option value="tpub" ${keyObj.suggestedType === 'tpub' ? 'selected' : ''}>tpub (testnet)</option>
                    </select>` : ''}
                </div>
            `;
            
            listDiv.appendChild(itemDiv);
        });
        
        // Show warning if some keys already exist
        if (existingKeys.length > 0) {
            errorDiv.style.display = 'block';
            errorDiv.style.background = 'var(--warning-bg, #FEF3C7)';
            errorDiv.style.borderColor = 'var(--warning-border, #F59E0B)';
            errorDiv.style.color = 'var(--warning-text, #92400E)';
            errorDiv.textContent = `⚠️ ${existingKeys.length} key${existingKeys.length > 1 ? 's' : ''} already exist${existingKeys.length > 1 ? '' : 's'} as variable${existingKeys.length > 1 ? 's' : ''}. They are unchecked by default.`;
        }
        
        modal.style.display = 'block';
    }

    hideExtractModal() {
        document.getElementById('extract-keys-modal').style.display = 'none';
        this.extractionData = null;
    }

    toggleMiniscriptFormat() {
        const expressionInput = document.getElementById('expression-input');
        const button = document.getElementById('format-miniscript-btn');
        
        if (!expressionInput.textContent.trim()) {
            this.showError('No miniscript expression to format');
            return;
        }
        
        const isCurrentlyFormatted = button.dataset.formatted === 'true';
        
        if (isCurrentlyFormatted) {
            // Remove formatting (compact)
            const compactExpression = this.compactMiniscript(expressionInput.textContent);
            expressionInput.textContent = compactExpression;
            button.style.color = 'var(--text-secondary)';
            button.title = 'Format expression with indentation';
            button.dataset.formatted = 'false';
        } else {
            // Add formatting (indent)
            const formattedExpression = this.formatMiniscript(expressionInput.textContent);
            expressionInput.textContent = formattedExpression;
            button.style.color = 'var(--success-border)';
            button.title = 'Remove formatting (compact)';
            button.dataset.formatted = 'true';
        }
        
        // Re-apply syntax highlighting
        delete expressionInput.dataset.lastHighlightedText;
        this.highlightMiniscriptSyntax();
    }

    togglePolicyFormat() {
        const policyInput = document.getElementById('policy-input');
        const button = document.getElementById('policy-format-toggle');
        
        if (!policyInput.textContent.trim()) {
            this.showError('No policy expression to format');
            return;
        }
        
        const isCurrentlyFormatted = button.dataset.formatted === 'true';
        
        if (isCurrentlyFormatted) {
            // Remove formatting (compact)
            const compactExpression = this.compactPolicy(policyInput.textContent);
            policyInput.textContent = compactExpression;
            button.style.color = 'var(--text-secondary)';
            button.title = 'Format expression with indentation';
            button.dataset.formatted = 'false';
        } else {
            // Add formatting (indent)
            const formattedExpression = this.formatPolicy(policyInput.textContent);
            policyInput.textContent = formattedExpression;
            button.style.color = 'var(--success-border)';
            button.title = 'Remove formatting (compact)';
            button.dataset.formatted = 'true';
        }
        
        // Re-apply syntax highlighting
        delete policyInput.dataset.lastHighlightedText;
        this.highlightPolicySyntax();
    }

    formatMiniscript(expression) {
        if (!expression) {
            return expression; // Return empty expressions as-is
        }
        
        // Clean the expression first
        const cleanExpr = this.cleanExpression(expression);
        
        // Parse into tokens
        const tokens = this.parseMiniscriptTokens(cleanExpr);
        
        // Format the tokens
        return this.formatTokens(tokens);
    }

    parseMiniscriptTokens(expression) {
        const tokens = [];
        let i = 0;
        let currentToken = '';
        
        while (i < expression.length) {
            const char = expression[i];
            
            if (char === '(' || char === ')' || char === ',') {
                // Push current token if it exists
                if (currentToken.trim()) {
                    tokens.push({ type: 'function', value: currentToken.trim() });
                    currentToken = '';
                }
                // Push delimiter
                tokens.push({ type: char === '(' ? 'open' : char === ')' ? 'close' : 'comma', value: char });
            } else {
                currentToken += char;
            }
            
            i++;
        }
        
        // Push final token if it exists
        if (currentToken.trim()) {
            tokens.push({ type: 'function', value: currentToken.trim() });
        }
        
        return tokens;
    }

    formatTokens(tokens) {
        let result = '';
        let depth = 0;
        const indent = (level) => '  '.repeat(level);
        
        // Functions that should format with multiple lines
        const multiLineOperators = ['and', 'or', 'thresh', 'and_v', 'or_c', 'or_d', 'or_i', 'andor'];
        
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const nextToken = tokens[i + 1];
            const prevToken = tokens[i - 1];
            
            if (token.type === 'function') {
                result += token.value;
                
            } else if (token.type === 'open') {
                result += token.value;
                depth++;
                
                // Check if the previous function should be multiline
                const prevFunction = prevToken?.value || '';
                const shouldBeMultiLine = multiLineOperators.some(op => 
                    prevFunction === op || prevFunction.endsWith(':' + op) || prevFunction.includes('_' + op)
                );
                
                // Add newline and indent after opening paren for multiline functions
                if (shouldBeMultiLine && nextToken?.type !== 'close') {
                    result += '\n' + indent(depth);
                }
                
            } else if (token.type === 'close') {
                depth--;
                
                // Check if we need newline before closing paren
                if (prevToken?.type === 'close') {
                    result += '\n' + indent(depth);
                }
                
                result += token.value;
                
            } else if (token.type === 'comma') {
                result += token.value;
                
                // Add newline and indent after comma if we're in a multiline context
                if (depth > 0 && nextToken) {
                    result += '\n' + indent(depth);
                }
            }
        }
        
        return result;
    }

    compactMiniscript(expression) {
        // Remove extra whitespace and newlines, then clean completely
        return this.cleanExpression(expression);
    }

    formatPolicy(expression) {
        if (!expression) {
            return expression; // Return empty expressions as-is
        }
        
        // Clean the expression first
        const cleanExpr = this.cleanExpression(expression);
        
        // Parse into tokens
        const tokens = this.parsePolicyTokens(cleanExpr);
        
        // Format the tokens
        return this.formatPolicyTokens(tokens);
    }

    parsePolicyTokens(expression) {
        const tokens = [];
        let i = 0;
        let currentToken = '';
        
        while (i < expression.length) {
            const char = expression[i];
            
            if (char === '(' || char === ')' || char === ',') {
                // Push current token if it exists
                if (currentToken.trim()) {
                    tokens.push({ type: 'function', value: currentToken.trim() });
                    currentToken = '';
                }
                // Push delimiter
                tokens.push({ type: char === '(' ? 'open' : char === ')' ? 'close' : 'comma', value: char });
            } else {
                currentToken += char;
            }
            
            i++;
        }
        
        // Push final token if it exists
        if (currentToken.trim()) {
            tokens.push({ type: 'function', value: currentToken.trim() });
        }
        
        return tokens;
    }

    formatPolicyTokens(tokens) {
        let result = '';
        let depth = 0;
        const indent = (level) => '  '.repeat(level);
        
        // Functions that should format with multiple lines (policy operators)
        const multiLineOperators = ['and', 'or', 'thresh', 'threshold'];
        
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const nextToken = tokens[i + 1];
            const prevToken = tokens[i - 1];
            
            if (token.type === 'function') {
                result += token.value;
                
            } else if (token.type === 'open') {
                result += token.value;
                depth++;
                
                // Check if the previous function should be multiline
                const prevFunction = prevToken?.value || '';
                const shouldBeMultiLine = multiLineOperators.some(op => 
                    prevFunction === op || prevFunction.endsWith(':' + op) || prevFunction.includes('_' + op)
                );
                
                // Add newline and indent after opening paren for multiline functions
                if (shouldBeMultiLine && nextToken?.type !== 'close') {
                    result += '\n' + indent(depth);
                }
                
            } else if (token.type === 'close') {
                depth--;
                
                // Check if we need newline before closing paren
                if (prevToken?.type === 'close') {
                    result += '\n' + indent(depth);
                }
                
                result += token.value;
                
            } else if (token.type === 'comma') {
                result += token.value;
                
                // Add newline and indent after comma if we're in a multiline context
                if (depth > 0 && nextToken) {
                    result += '\n' + indent(depth);
                }
            }
        }
        
        return result;
    }

    compactPolicy(expression) {
        // Remove extra whitespace and newlines, then clean completely
        return this.cleanExpression(expression);
    }

    toggleScriptFormat(button, display) {
        const script = display.value;
        const isCurrentlyFormatted = button.dataset.formatted === 'true';
        
        if (isCurrentlyFormatted) {
            // Remove formatting (compact)
            const compactScript = this.compactScript(script);
            display.value = compactScript;
            button.style.color = 'var(--text-secondary)';
            button.title = 'Format script with indentation';
            button.dataset.formatted = 'false';
        } else {
            // Add formatting (indent)
            const formattedScript = this.formatBitcoinScript(script);
            display.value = formattedScript;
            button.style.color = 'var(--success-border)';
            button.title = 'Remove formatting (compact)';
            button.dataset.formatted = 'true';
        }
    }

    liftMiniscriptToPolicy() {
        const expressionInput = document.getElementById('expression-input');
        const miniscript = expressionInput.textContent.trim();
        
        if (!miniscript) {
            this.showMiniscriptError('No miniscript expression to lift');
            return;
        }
        
        if (!this.wasm) {
            this.showMiniscriptError('Compiler not ready, please wait and try again.');
            return;
        }
        
        // Show loading state
        const button = document.getElementById('lift-miniscript-btn');
        const originalText = button.innerHTML;
        button.innerHTML = '⏳';
        button.disabled = true;
        button.title = 'Lifting...';
        
        try {
            // Replace any key variable names with their actual values before lifting
            let processedMiniscript = miniscript;
            if (this.keyVariables.size > 0) {
                for (const [keyName, keyValue] of this.keyVariables.entries()) {
                    // Replace key names with hex values
                    const regex = new RegExp(`\\b${keyName}\\b`, 'g');
                    processedMiniscript = processedMiniscript.replace(regex, keyValue);
                }
            }
            
            console.log('Lifting miniscript to policy:', processedMiniscript);
            
            // Lift miniscript to policy
            const policyResult = lift_to_policy(processedMiniscript);
            
            if (policyResult.success && policyResult.policy) {
                // Replace keys with names in the policy result if we have key variables
                let displayPolicy = policyResult.policy;
                if (this.keyVariables.size > 0) {
                    displayPolicy = this.replaceKeysWithNames(policyResult.policy);
                }
                
                // Fill policy textarea
                const policyInput = document.getElementById('policy-input');
                policyInput.textContent = displayPolicy;
                
                // Reset policy format button state
                const policyFormatBtn = document.getElementById('policy-format-toggle');
                if (policyFormatBtn) {
                    policyFormatBtn.style.color = 'var(--text-secondary)';
                    policyFormatBtn.title = 'Format expression with indentation';
                    policyFormatBtn.dataset.formatted = 'false';
                }
                
                // Update the "Show key names" toggle button for policy to active state
                const policyToggleBtn = document.getElementById('policy-key-names-toggle');
                if (policyToggleBtn && this.keyVariables.size > 0) {
                    policyToggleBtn.style.color = 'var(--success-border)';
                    policyToggleBtn.title = 'Hide key names';
                    policyToggleBtn.dataset.active = 'true';
                }
                
                // Re-apply policy syntax highlighting
                delete policyInput.dataset.lastHighlightedText;
                this.highlightPolicySyntax();
                
                console.log('Successfully lifted to policy:', displayPolicy);
                this.showMiniscriptSuccess('✅ Lifted to Policy!');
            } else {
                console.log('Policy lift failed:', policyResult.error);
                this.showMiniscriptError(`Cannot lift miniscript: ${policyResult.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Lift error:', error);
            this.showMiniscriptError(`Lift failed: ${error.message}`);
        } finally {
            // Reset button
            button.innerHTML = originalText;
            button.disabled = false;
            button.title = 'Lift to Policy';
        }
    }

    liftBitcoinScript(button, display) {
        let asmScript = display.value.trim();
        
        if (!asmScript) {
            this.showLiftError('No Bitcoin script to lift');
            return;
        }
        
        if (!this.wasm) {
            this.showLiftError('Compiler not ready, please wait and try again.');
            return;
        }
        
        // Show loading state
        const originalText = button.textContent;
        button.textContent = '⏳';
        button.disabled = true;
        button.title = 'Lifting...';
        
        try {
            // Replace any key variable names with their actual values before lifting
            if (this.keyVariables.size > 0) {
                for (const [keyName, keyValue] of this.keyVariables.entries()) {
                    // Replace key names that appear after OP_PUSHBYTES_XX or standalone
                    const regexWithPushbytes = new RegExp(`(OP_PUSHBYTES_\\d+\\s+)${keyName}(?=\\s|$)`, 'g');
                    const regexStandalone = new RegExp(`\\b${keyName}\\b`, 'g');
                    
                    asmScript = asmScript.replace(regexWithPushbytes, `$1${keyValue}`);
                    asmScript = asmScript.replace(regexStandalone, keyValue);
                }
            }
            
            console.log('Lifting Bitcoin script (with keys replaced):', asmScript);
            
            // Lift ASM to Miniscript with pushbytes intact (no more auto-cleaning)
            const miniscriptResult = lift_to_miniscript(asmScript);
            
            // Fallback to cleaned ASM (commented out - testing new parser)
            /*
            if (!miniscriptResult.success) {
                console.log('Failed with pushbytes, trying cleaned ASM...');
                const cleanedAsm = this.simplifyAsm(asmScript);
                console.log('Cleaned ASM for lifting:', cleanedAsm);
                miniscriptResult = lift_to_miniscript(cleanedAsm);
            }
            */
            
            if (miniscriptResult.success && miniscriptResult.miniscript) {
                // Replace keys with names in the miniscript result if we have key variables
                let displayMiniscript = miniscriptResult.miniscript;
                if (this.keyVariables.size > 0) {
                    displayMiniscript = this.replaceKeysWithNames(miniscriptResult.miniscript);
                }
                
                // Fill miniscript textarea
                const expressionInput = document.getElementById('expression-input');
                expressionInput.textContent = displayMiniscript;
                
                // Reset miniscript format button state
                const miniscriptFormatBtn = document.getElementById('format-miniscript-btn');
                if (miniscriptFormatBtn) {
                    miniscriptFormatBtn.style.color = 'var(--text-secondary)';
                    miniscriptFormatBtn.title = 'Format expression with indentation';
                    miniscriptFormatBtn.dataset.formatted = 'false';
                }
                
                // Update the "Show key names" toggle button for miniscript to active state
                const miniscriptToggleBtn = document.getElementById('key-names-toggle');
                if (miniscriptToggleBtn && this.keyVariables.size > 0) {
                    miniscriptToggleBtn.style.color = 'var(--success-border)';
                    miniscriptToggleBtn.title = 'Hide key names';
                    miniscriptToggleBtn.dataset.active = 'true';
                }
                
                // Re-apply miniscript syntax highlighting
                delete expressionInput.dataset.lastHighlightedText;
                this.highlightMiniscriptSyntax();
                
                console.log('Step 1 success - Miniscript:', miniscriptResult.miniscript);
                
                // Step 2: Try to lift Miniscript to Policy
                try {
                    const policyResult = lift_to_policy(miniscriptResult.miniscript);
                    
                    if (policyResult.success && policyResult.policy) {
                        // Replace keys with names in the policy result if we have key variables
                        let displayPolicy = policyResult.policy;
                        if (this.keyVariables.size > 0) {
                            displayPolicy = this.replaceKeysWithNames(policyResult.policy);
                        }
                        
                        // Fill policy textarea
                        const policyInput = document.getElementById('policy-input');
                        policyInput.textContent = displayPolicy;
                        
                        // Reset policy format button state
                        const policyFormatBtn = document.getElementById('policy-format-toggle');
                        if (policyFormatBtn) {
                            policyFormatBtn.style.color = 'var(--text-secondary)';
                            policyFormatBtn.title = 'Format expression with indentation';
                            policyFormatBtn.dataset.formatted = 'false';
                        }
                        
                        // Update the "Show key names" toggle button for policy to active state
                        const policyToggleBtn = document.getElementById('policy-key-names-toggle');
                        if (policyToggleBtn && this.keyVariables.size > 0) {
                            policyToggleBtn.style.color = 'var(--success-border)';
                            policyToggleBtn.title = 'Hide key names';
                            policyToggleBtn.dataset.active = 'true';
                        }
                        
                        // Re-apply policy syntax highlighting
                        delete policyInput.dataset.lastHighlightedText;
                        this.highlightPolicySyntax();
                        
                        console.log('Step 2 success - Policy:', policyResult.policy);
                        this.showSuccess('✅ Lifted to both Policy and Miniscript!');
                    } else {
                        // Only miniscript worked
                        document.getElementById('policy-input').textContent = '';
                        console.log('Step 2 partial - Policy lift failed:', policyResult.error);
                        this.showInfo('✅ Lifted to Miniscript (Policy conversion not possible for this script)');
                    }
                } catch (policyError) {
                    // Policy lift failed, but miniscript succeeded
                    document.getElementById('policy-input').textContent = '';
                    console.log('Policy lift error:', policyError);
                    this.showInfo('✅ Lifted to Miniscript (Policy conversion not possible for this script)');
                }
            } else {
                console.log('Miniscript lift failed:', miniscriptResult.error);
                this.showLiftError(`Cannot lift Bitcoin script: ${miniscriptResult.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Lift error:', error);
            this.showLiftError(`Lift failed: ${error.message}`);
        } finally {
            // Reset button
            button.textContent = originalText;
            button.disabled = false;
            button.title = 'Lift to Miniscript and Policy';
        }
    }

    formatBitcoinScript(script) {
        if (!script || script.length < 100) {
            return script; // Don't format short scripts
        }
        
        const opcodes = script.split(/\s+/);
        let result = '';
        let depth = 0;
        const indent = (level) => '  '.repeat(level); // 2 spaces per level
        let currentLineLength = 0;
        const MAX_LINE_LENGTH = 80; // Target line length for wrapping
        
        for (let i = 0; i < opcodes.length; i++) {
            const opcode = opcodes[i];
            const nextOpcode = i < opcodes.length - 1 ? opcodes[i + 1] : null;
            const prevOpcode = i > 0 ? opcodes[i - 1] : null;
            
            // Special case: OP_IFDUP should NOT cause a block increase by itself
            // Only OP_IF and OP_NOTIF should increase depth
            if (opcode === 'OP_IF' || opcode === 'OP_NOTIF') {
                // IF/NOTIF can stay on same line or go on new line based on context
                if (result && !result.endsWith('\n')) {
                    result += ' ';
                }
                result += opcode;
                
                // Always start new block after IF/NOTIF
                result += '\n';
                depth++;
                result += indent(depth);
                currentLineLength = indent(depth).length;
                
            } else if (opcode === 'OP_IFDUP') {
                // IFDUP stays on same line, doesn't create new block by itself
                if (result && !result.endsWith('\n')) {
                    result += ' ';
                    currentLineLength += 1;
                }
                result += opcode;
                currentLineLength += opcode.length;
                
            } else if (opcode === 'OP_ELSE') {
                // ELSE goes on its own line at the previous depth
                depth--;
                if (!result.endsWith('\n')) {
                    result += '\n';
                }
                result += indent(depth) + opcode;
                depth++;
                if (nextOpcode && nextOpcode !== 'OP_ENDIF') {
                    result += '\n' + indent(depth);
                    currentLineLength = indent(depth).length;
                } else {
                    result += '\n';
                    currentLineLength = 0;
                }
            } else if (opcode === 'OP_ENDIF') {
                // ENDIF goes on its own line at the previous depth
                depth--;
                if (!result.endsWith('\n')) {
                    result += '\n';
                }
                result += indent(depth) + opcode;
                // Add newline if there are more opcodes
                if (nextOpcode) {
                    result += '\n';
                    if (depth > 0) {
                        result += indent(depth);
                        currentLineLength = indent(depth).length;
                    } else {
                        currentLineLength = 0;
                    }
                }
            } else {
                // Regular opcodes - handle line wrapping based on logical breaks
                const opcodeLength = opcode.length;
                
                // Logical break points based on your target pattern:
                // 1. After OP_TOALTSTACK (end of complete sequence)
                // 2. After OP_CHECKSIG when line is long and not followed by OP_TOALTSTACK
                // 3. When line would be too long (80+ chars)
                const shouldBreak = depth > 0 && (
                    (currentLineLength > 0 && currentLineLength + opcodeLength + 1 > MAX_LINE_LENGTH) ||
                    (prevOpcode === 'OP_TOALTSTACK') ||
                    (prevOpcode === 'OP_CHECKSIG' && nextOpcode !== 'OP_TOALTSTACK' && currentLineLength > 70)
                );
                
                if (shouldBreak && currentLineLength > indent(depth).length) {
                    // Add newline and indent for continuation
                    result += '\n' + indent(depth);
                    currentLineLength = indent(depth).length;
                } else if (result && !result.endsWith('\n') && !result.endsWith(' ')) {
                    // Add space between opcodes on same line
                    result += ' ';
                    currentLineLength += 1;
                }
                
                result += opcode;
                currentLineLength += opcodeLength;
            }
        }
        
        return result.trim();
    }

    compactScript(script) {
        // First, normalize all whitespace (including newlines and indentation) to single spaces
        // This ensures opcodes are properly separated
        return script.replace(/\s+/g, ' ').trim();
    }

    cleanExpression(text) {
        // Remove spaces, carriage returns, and newlines (same logic as removeExtraChars)
        return text.replace(/[\s\r\n]/g, '');
    }

    selectAllKeys(select) {
        if (!this.extractionData) return;
        
        const { keys } = this.extractionData;
        keys.forEach((keyObj, index) => {
            const checkbox = document.getElementById(`extract-checkbox-${index}`);
            const nameInput = document.getElementById(`extract-name-${index}`);
            
            // Only change checkbox state if the input is not disabled (not existing)
            if (checkbox && !nameInput.disabled) {
                checkbox.checked = select;
            }
        });
    }

    confirmExtractKeys() {
        if (!this.extractionData) return;
        
        const { keys, originalExpression } = this.extractionData;
        const errorDiv = document.getElementById('extract-error-message');
        let updatedExpression = originalExpression;
        let addedCount = 0;
        let errors = [];
        
        // First, collect all selected keys and check for conflicts
        const selectedKeys = [];
        const temporarilyUsedKeys = []; // Track keys being allocated in this extraction
        keys.forEach((keyObj, index) => {
            const key = keyObj.value;
            const checkbox = document.getElementById(`extract-checkbox-${index}`);
            const nameInput = document.getElementById(`extract-name-${index}`);
            
            if (checkbox && checkbox.checked) {
                const name = nameInput.value.trim();
                
                if (!name) {
                    errors.push(`Key ${index + 1}: Name cannot be empty`);
                    return;
                }
                
                // For variable keys, get the selected type and pull from pool
                let actualKey = key;
                if (keyObj.type === 'variable') {
                    const typeSelect = document.getElementById(`extract-type-${index}`);
                    const keyType = typeSelect ? typeSelect.value : 'compressed';
                    
                    // Get an unused key from the pool based on type selection
                    const poolKey = this.getUnusedKeyFromPool(keyType, temporarilyUsedKeys);
                    if (!poolKey) {
                        errors.push(`No unused ${keyType} keys available in the pool for "${name}"`);
                        return;
                    }
                    actualKey = poolKey;
                    // Add this key to temporarily used list so next variable gets a different one
                    temporarilyUsedKeys.push(poolKey);
                }
                
                // Check if name already exists with different value
                if (this.keyVariables.has(name) && this.keyVariables.get(name) !== actualKey) {
                    errors.push(`"${name}" already exists with a different key value`);
                    return;
                }
                
                // Check for duplicate names in current selection
                const duplicate = selectedKeys.find(sk => sk.name === name);
                if (duplicate && duplicate.actualKey !== actualKey) {
                    errors.push(`Duplicate name "${name}" for different keys`);
                    return;
                }
                
                selectedKeys.push({ key, name, index, actualKey, isVariable: keyObj.type === 'variable' });
            }
        });
        
        // If there are errors, show them and don't proceed
        if (errors.length > 0) {
            errorDiv.style.display = 'block';
            errorDiv.style.background = 'var(--error-bg, #FED7D7)';
            errorDiv.style.borderColor = 'var(--error-border, #F87171)';
            errorDiv.style.color = 'var(--error-text, #991B1B)';
            errorDiv.innerHTML = '❌ Cannot extract keys:<br>' + errors.join('<br>');
            return;
        }
        
        // No errors, proceed with extraction
        // Sort by key length (longest first) to replace descriptors before embedded keys
        selectedKeys.sort((a, b) => b.key.length - a.key.length);
        
        selectedKeys.forEach(({ key, name, actualKey, isVariable }) => {
            // Add the key variable with the actual generated key
            this.keyVariables.set(name, actualKey);
            addedCount++;
            
            // Replace the original key (or variable pattern) with the variable name in the expression
            if (isVariable) {
                // For variables, keep the function wrapper, just replace the variable inside
                // e.g., pk(Nadav) stays as pk(Nadav) where Nadav is now a defined variable
                updatedExpression = updatedExpression.replace(new RegExp(`\\b((?:pk|pkh|pk_k|pk_h)\\()${key}(\\))`, 'g'), `$1${name}$2`);
            } else {
                // For raw keys, replace the key with the variable name
                updatedExpression = updatedExpression.split(key).join(name);
            }
        });
        
        if (addedCount > 0) {
            // Save the updated key variables
            this.saveKeyVariables();
            this.displayKeyVariables();
            
            // Update the expression in the input field
            let updatedPolicy = false;
            let updatedMiniscript = false;
            
            if (document.getElementById('policy-input').textContent || document.getElementById('policy-input').innerText) {
                if (originalExpression === (document.getElementById('policy-input').textContent || document.getElementById('policy-input').innerText)) {
                    document.getElementById('policy-input').textContent = updatedExpression;
                    // Clear the highlighting cache and re-highlight
                    delete document.getElementById('policy-input').dataset.lastHighlightedText;
                    this.highlightPolicySyntax();
                    updatedPolicy = true;
                }
            }
            
            if (document.getElementById('expression-input').textContent || document.getElementById('expression-input').innerText) {
                if (originalExpression === (document.getElementById('expression-input').textContent || document.getElementById('expression-input').innerText)) {
                    document.getElementById('expression-input').textContent = updatedExpression;
                    // Clear the highlighting cache and re-highlight
                    delete document.getElementById('expression-input').dataset.lastHighlightedText;
                    this.highlightMiniscriptSyntax();
                    updatedMiniscript = true;
                }
            }
            
            // Update toggle button states if expressions were updated
            if (updatedPolicy) {
                const policyToggleBtn = document.getElementById('policy-key-names-toggle');
                if (policyToggleBtn) {
                    const containsKeyNames = this.containsKeyNames(updatedExpression);
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
            
            if (updatedMiniscript) {
                const miniscriptToggleBtn = document.getElementById('key-names-toggle');
                if (miniscriptToggleBtn) {
                    const containsKeyNames = this.containsKeyNames(updatedExpression);
                    if (containsKeyNames) {
                        miniscriptToggleBtn.style.color = 'var(--success-border)';
                        miniscriptToggleBtn.title = 'Hide key names';
                        miniscriptToggleBtn.dataset.active = 'true';
                    } else {
                        miniscriptToggleBtn.style.color = 'var(--text-secondary)';
                        miniscriptToggleBtn.title = 'Show key names';
                        miniscriptToggleBtn.dataset.active = 'false';
                    }
                }
            }
            
            this.showSuccess(`Extracted ${addedCount} key variable${addedCount > 1 ? 's' : ''}`);
        } else {
            this.showError('No keys were selected for extraction');
        }
        
        this.hideExtractModal();
    }

    saveKeyVariables() {
        try {
            const keyVars = Object.fromEntries(this.keyVariables);
            localStorage.setItem('miniscript-key-variables', JSON.stringify(keyVars));
        } catch (error) {
            console.error('Failed to save key variables:', error);
        }
    }


    initializeEmptyResults() {
        const resultsDiv = document.getElementById('results');
        if (resultsDiv.innerHTML.trim() !== '') {
            // Results already displayed, don't initialize empty
            return;
        }
        
        // Show empty script hex section
        const scriptDiv = document.createElement('div');
        scriptDiv.className = 'result-box info';
        scriptDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0;">📜 Script HEX</h4>
                <div style="display: flex; align-items: center; gap: 0px;">
                    <button id="lift-hex-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Lift to Miniscript and Policy" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                        ⬆️
                    </button>
                    <button id="copy-hex-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Copy hex script" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                        📋
                    </button>
                </div>
            </div>
            <textarea id="script-hex-display" placeholder="Hex script will appear here after compilation, or paste your own and lift it..." class="textarea-like" spellcheck="false"></textarea>
        `;
        resultsDiv.appendChild(scriptDiv);
        
        // Show empty ASM section
        const scriptAsmDiv = document.createElement('div');
        scriptAsmDiv.className = 'result-box info';
        scriptAsmDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0;">⚡ Script ASM</h4>
                <div style="display: flex; align-items: center; gap: 0px;">
                    <button id="asm-key-names-toggle" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Show key names" data-active="false" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                        🏷️
                    </button>
                    <button id="format-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Format script with indentation" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                        📐
                    </button>
                    <button id="hide-pushbytes-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Hide pushbytes" data-active="false" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                        👁️
                    </button>
                    <button id="lift-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Lift to Miniscript and Policy" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                        ⬆️
                    </button>
                    <button id="copy-script-btn" onclick="copyBitcoinScript()" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Copy Bitcoin script" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                        📋
                    </button>
                </div>
            </div>
            <textarea id="script-asm-display" placeholder="ASM script will appear here after compilation, or paste your own and lift it..." class="textarea-like" style="min-height: 80px;" spellcheck="false"></textarea>
        `;
        resultsDiv.appendChild(scriptAsmDiv);
        
        // Show empty address section
        const addressDiv = document.createElement('div');
        addressDiv.className = 'result-box info';
        addressDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0;">🏠 Generated address</h4>
                <div style="display: flex; align-items: center; gap: 0px;">
                    <button id="network-toggle-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Switch to Testnet" data-network="mainnet" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'" disabled>
                        🌐
                    </button>
                </div>
            </div>
            <div id="address-display" style="word-break: break-all; font-family: monospace; background: var(--input-bg); padding: 10px; border-radius: 4px; border: 1px solid var(--border-color); color: var(--text-muted); font-style: italic;">
                Address will appear here after compilation
            </div>
        `;
        resultsDiv.appendChild(addressDiv);
        
        // Apply light theme styling to newly created elements
        if (document.documentElement.getAttribute('data-theme') === 'light') {
            const scriptHex = document.getElementById('script-hex-display');
            const scriptAsm = document.getElementById('script-asm-display');
            const addressDisplay = document.getElementById('address-display');
            if (scriptHex) this.enforceElementStyling(scriptHex);
            if (scriptAsm) this.enforceElementStyling(scriptAsm);
            if (addressDisplay) this.enforceElementStyling(addressDisplay);
        }
        
        // Add event listeners for the empty sections
        this.attachEmptyResultsListeners();
    }

    attachEmptyResultsListeners() {
        // Attach lift button listener for hex
        const liftHexButton = document.getElementById('lift-hex-script-btn');
        const hexDisplay = document.getElementById('script-hex-display');
        if (liftHexButton && hexDisplay) {
            liftHexButton.addEventListener('click', () => {
                this.liftBitcoinScript(liftHexButton, hexDisplay);
            });
        }
        
        // Attach copy button listener for hex
        const copyHexButton = document.getElementById('copy-hex-script-btn');
        if (copyHexButton && hexDisplay) {
            copyHexButton.addEventListener('click', () => {
                this.copyHexScript(hexDisplay);
            });
        }
        
        // Attach lift button listener for ASM
        const liftAsmButton = document.getElementById('lift-script-btn');
        const asmDisplay = document.getElementById('script-asm-display');
        if (liftAsmButton && asmDisplay) {
            liftAsmButton.addEventListener('click', () => {
                this.liftBitcoinScript(liftAsmButton, asmDisplay);
            });
        }
    }

    displayResults(result) {
        const resultsDiv = document.getElementById('results');
        resultsDiv.innerHTML = '';

        if (!result.success) {
            return;
        }

        // Show compiled miniscript (for policy compilation)

        // Show script hex
        if (result.script) {
            const scriptDiv = document.createElement('div');
            scriptDiv.className = 'result-box info';
            scriptDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h4 style="margin: 0;">📜 Script HEX</h4>
                    <div style="display: flex; align-items: center; gap: 0px;">
                        <button id="lift-hex-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Lift to Miniscript and Policy" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                            ⬆️
                        </button>
                        <button id="copy-hex-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Copy hex script" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                            📋
                        </button>
                    </div>
                </div>
                <textarea id="script-hex-display" placeholder="Hex script will appear here after compilation, or paste your own and lift it..." class="textarea-like" spellcheck="false">${result.script}</textarea>
            `;
            
            // Add event listeners for the buttons
            const liftHexButton = scriptDiv.querySelector('#lift-hex-script-btn');
            const copyHexButton = scriptDiv.querySelector('#copy-hex-script-btn');
            const hexDisplay = scriptDiv.querySelector('#script-hex-display');
            
            // Add event listener for lift button
            liftHexButton.addEventListener('click', () => {
                this.liftBitcoinScript(liftHexButton, hexDisplay);
            });
            
            // Add event listener for copy button
            copyHexButton.addEventListener('click', () => {
                this.copyHexScript(hexDisplay);
            });
            
            resultsDiv.appendChild(scriptDiv);
        }

        // Show script ASM
        if (result.script_asm) {
            const scriptAsmDiv = document.createElement('div');
            scriptAsmDiv.className = 'result-box info';
            
            // Store the original ASM
            const originalAsm = result.script_asm;
            
            // Create simplified version (without OP_PUSHBYTES_XX prefixes)
            const simplifiedAsm = this.simplifyAsm(result.script_asm);
            
            // Apply key names by default if we have key variables
            let showKeyNames = false;
            let originalWithKeyNames = originalAsm;
            let simplifiedWithKeyNames = simplifiedAsm;
            
            if (this.keyVariables.size > 0) {
                showKeyNames = true;
                // Replace keys with names in both original and simplified versions
                for (const [keyName, keyValue] of this.keyVariables.entries()) {
                    // For original (with OP_PUSHBYTES_XX)
                    const regexOriginal = new RegExp(`(OP_PUSHBYTES_\\d+\\s+)${keyValue}(?=\\s|$)`, 'g');
                    originalWithKeyNames = originalWithKeyNames.replace(regexOriginal, `$1${keyName}`);
                    
                    // For simplified (without OP_PUSHBYTES_XX, just the hex values)
                    const regexSimplified = new RegExp(`\\b${keyValue}\\b`, 'g');
                    simplifiedWithKeyNames = simplifiedWithKeyNames.replace(regexSimplified, keyName);
                }
            }
            
            // By default, hide pushbytes after compilation
            const shouldHidePushbytes = true; // Always hide pushbytes by default
            
            // Determine what to display initially
            let currentAsm;
            if (shouldHidePushbytes) {
                currentAsm = showKeyNames ? simplifiedWithKeyNames : simplifiedAsm;
            } else {
                currentAsm = showKeyNames ? originalWithKeyNames : originalAsm;
            }
                
            scriptAsmDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h4 style="margin: 0;">⚡ Script ASM</h4>
                    <div style="display: flex; align-items: center; gap: 0px;">
                        <button id="asm-key-names-toggle" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: ${showKeyNames ? 'var(--success-border)' : 'var(--text-secondary)'}; display: flex; align-items: center; border-radius: 3px;" title="${showKeyNames ? 'Hide key names' : 'Show key names'}" data-active="${showKeyNames}" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                            🏷️
                        </button>
                        <button id="format-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Format script with indentation" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                            📐
                        </button>
                        <button id="hide-pushbytes-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--success-border); display: flex; align-items: center; border-radius: 3px;" title="Show pushbytes" data-active="true" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                            👁️
                        </button>
                        <button id="lift-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Lift to Miniscript and Policy" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                            ⬆️
                        </button>
                        <button id="copy-script-btn" onclick="copyBitcoinScript()" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Copy Bitcoin script" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                            📋
                        </button>
                    </div>
                </div>
                <textarea id="script-asm-display" placeholder="ASM script will appear here after compilation, or paste your own and lift it..." class="textarea-like" style="min-height: 80px;" spellcheck="false">${currentAsm}</textarea>
            `;
            
            // Add event listener for toggle button
            const toggleButton = scriptAsmDiv.querySelector('#hide-pushbytes-btn');
            const display = scriptAsmDiv.querySelector('#script-asm-display');
            const formatButton = scriptAsmDiv.querySelector('#format-script-btn');
            const keyNamesToggle = scriptAsmDiv.querySelector('#asm-key-names-toggle');
            
            // Store all versions for quick access
            display.dataset.originalAsm = originalAsm;
            display.dataset.simplifiedAsm = simplifiedAsm;
            display.dataset.originalWithKeyNames = originalWithKeyNames;
            display.dataset.simplifiedWithKeyNames = simplifiedWithKeyNames;
            
            // Add event listener for key names toggle button
            keyNamesToggle.addEventListener('click', () => {
                const isActive = keyNamesToggle.dataset.active === 'true';
                const isHidingPushbytes = toggleButton.dataset.active === 'true';
                
                if (isActive) {
                    // Hide key names - show actual keys
                    display.value = isHidingPushbytes ? display.dataset.simplifiedAsm : display.dataset.originalAsm;
                    keyNamesToggle.style.color = 'var(--text-secondary)';
                    keyNamesToggle.title = 'Show key names';
                    keyNamesToggle.dataset.active = 'false';
                } else {
                    // Show key names - use pre-computed versions
                    display.value = isHidingPushbytes ? display.dataset.simplifiedWithKeyNames : display.dataset.originalWithKeyNames;
                    keyNamesToggle.style.color = 'var(--success-border)';
                    keyNamesToggle.title = 'Hide key names';
                    keyNamesToggle.dataset.active = 'true';
                }
                
                // Reset format state when toggling key names
                formatButton.dataset.formatted = 'false';
                formatButton.style.color = 'var(--text-secondary)';
                formatButton.title = 'Format script with indentation';
            });
            
            // Button is already initialized as active in the HTML since we hide pushbytes by default
            // No need to change the state here as it's already set correctly
            
            toggleButton.addEventListener('click', () => {
                const isCurrentlyHiding = toggleButton.dataset.active === 'true';
                const isShowingKeyNames = keyNamesToggle.dataset.active === 'true';
                
                if (isCurrentlyHiding) {
                    // Show pushbytes
                    display.value = isShowingKeyNames ? display.dataset.originalWithKeyNames : display.dataset.originalAsm;
                    toggleButton.style.color = 'var(--text-secondary)';
                    toggleButton.title = 'Hide pushbytes';
                    toggleButton.dataset.active = 'false';
                } else {
                    // Hide pushbytes
                    display.value = isShowingKeyNames ? display.dataset.simplifiedWithKeyNames : display.dataset.simplifiedAsm;
                    toggleButton.style.color = 'var(--success-border)';
                    toggleButton.title = 'Show pushbytes';
                    toggleButton.dataset.active = 'true';
                }
                
                // Reset format state when toggling hide-pushbytes
                formatButton.dataset.formatted = 'false';
                formatButton.style.color = 'var(--text-secondary)';
                formatButton.title = 'Format script with indentation';
            });
            
            // Add event listener for format button
            formatButton.addEventListener('click', () => {
                this.toggleScriptFormat(formatButton, display);
            });
            
            // Add event listener for lift button
            const liftButton = scriptAsmDiv.querySelector('#lift-script-btn');
            liftButton.addEventListener('click', () => {
                this.liftBitcoinScript(liftButton, display);
            });
            
            resultsDiv.appendChild(scriptAsmDiv);
        }

        // Show address if available
        if (result.address) {
            // Detect current network from address prefix
            const isTestnet = result.address.startsWith('tb1') || result.address.startsWith('2') || result.address.startsWith('m') || result.address.startsWith('n');
            
            const addressDiv = document.createElement('div');
            addressDiv.className = 'result-box info';
            addressDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h4 style="margin: 0;">🏠 Generated address</h4>
                    <div style="display: flex; align-items: center; gap: 0px;">
                        <button id="network-toggle-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: ${isTestnet ? 'var(--success-border)' : 'var(--text-secondary)'}; display: flex; align-items: center; border-radius: 3px;" title="${isTestnet ? 'Switch to Mainnet' : 'Switch to Testnet'}" data-network="${isTestnet ? 'testnet' : 'mainnet'}" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                            🌐
                        </button>
                    </div>
                </div>
                <div id="address-display" style="word-break: break-all; font-family: monospace; background: var(--input-bg); padding: 10px; border-radius: 4px; border: 1px solid var(--border-color);" data-placeholder="Address will appear here after compilation">
                    ${result.address}
                </div>
            `;
            
            // Store script info for network switching
            const addressDisplay = addressDiv.querySelector('#address-display');
            addressDisplay.dataset.scriptHex = result.script;
            addressDisplay.dataset.scriptType = result.miniscript_type || 'Unknown';
            // Store the processed miniscript for taproot network switching
            addressDisplay.dataset.miniscript = result.processedMiniscript || '';
            
            // Add event listener for network toggle
            const networkToggleBtn = addressDiv.querySelector('#network-toggle-btn');
            networkToggleBtn.addEventListener('click', () => {
                this.toggleAddressNetwork(networkToggleBtn, addressDisplay);
            });
            
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
        
        // Apply light theme styling to newly created script elements
        if (document.documentElement.getAttribute('data-theme') === 'light') {
            const scriptHex = document.getElementById('script-hex-display');
            const scriptAsm = document.getElementById('script-asm-display');
            const addressDisplay = document.getElementById('address-display');
            if (scriptHex) this.enforceElementStyling(scriptHex);
            if (scriptAsm) this.enforceElementStyling(scriptAsm);
            if (addressDisplay) this.enforceElementStyling(addressDisplay);
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
                const commonKeys = ['Alice', 'Bob', 'Charlie', 'David', 'Eva', 'Frank', 'Lara', 'Helen', 'Ivan', 'Julia', 'Karl', 'TestnetKey', 'MainnetKey', 'jcKey1', 'jcKey2', 'jcKey3', 'saKey', 'jcAg1', 'jcAg2', 'jcAg3', 'recKey1', 'recKey2', 'recKey3'];
                const missingKey = commonKeys.find(key => key.length === gotLength && expressionText.includes(key));
                
                if (missingKey) {
                    additionalHelp = `
<div style="margin-top: 15px; padding: 12px; background: var(--container-bg); border: 1px solid var(--error-border); border-radius: 6px; text-align: left; color: var(--text-color);">
<strong>💡 Tip:</strong> The key variable "<strong>${missingKey}</strong>" appears to be missing or undefined.
<br><br>
<strong>Your options:</strong>
<br><br>
<div>→ <strong>Extract keys:</strong> Auto-detects all undefined variables/keys in your policy and lets you assign key variables to them</div>
<div>→ <strong>Check Key variables section:</strong> Look below to see if "${missingKey}" already exists with a different value</div>
<div>→ <strong>Add manually:</strong> Define "${missingKey}" yourself in the Key variables section with any valid key type</div>
<div>→ <strong>Restore defaults:</strong> Restore common test keys (Alice, Bob, Charlie, etc.) with pre-generated public keys.<br>&nbsp;&nbsp;Useful for examples that stopped working, usually due to a key deletion</div>
<div style="margin-top: 10px; display: flex; gap: 10px;">
<button onclick="compiler.extractKeysFromPolicy()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Automatically scan your policy expression to find undefined variables and convert them to reusable key variables. Select which variables to extract and choose the appropriate key type for each.">🔑 Extract keys</button>
<button onclick="compiler.restoreDefaultKeys()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Add 56 commonly used test keys (Alice, Bob, Charlie, David, Eva, Frank, NUMS, etc.) plus VaultKey1-19 range descriptors with pre-generated public keys for each type. This won't overwrite existing keys with the same names.">🔄 Restore defaults</button>
</div>
</div>
                    `;
                } else if (gotLength <= 15) {
                    // Generic help for short strings that look like variable names
                    additionalHelp = `
<div style="margin-top: 15px; padding: 12px; background: var(--container-bg); border: 1px solid var(--error-border); border-radius: 6px; text-align: left; color: var(--text-color);">
<strong>💡 Tip:</strong> This looks like a missing key variable (got ${gotLength} characters instead of a public key).
<br><br>
<strong>Your options:</strong>
<br><br>
<div>→ <strong>Extract keys:</strong> Auto-detects all undefined variables/keys in your policy and lets you assign key variables to them</div>
<div>→ <strong>Check Key variables section:</strong> Look below to see if this variable exists or needs to be added</div>
<div>→ <strong>Add manually:</strong> Define your custom variable in the Key variables section with any valid key type</div>
<div>→ <strong>Restore defaults:</strong> Restore common test keys (Alice, Bob, Charlie, etc.) with pre-generated public keys.<br>&nbsp;&nbsp;Useful for examples that stopped working, usually due to a key deletion</div>
<div style="margin-top: 10px; display: flex; gap: 10px;">
<button onclick="compiler.extractKeysFromPolicy()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Automatically scan your policy expression to find undefined variables and convert them to reusable key variables. Select which variables to extract and choose the appropriate key type for each.">🔑 Extract keys</button>
<button onclick="compiler.restoreDefaultKeys()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Add 56 commonly used test keys (Alice, Bob, Charlie, David, Eva, Frank, NUMS, etc.) plus VaultKey1-19 range descriptors with pre-generated public keys for each type. This won't overwrite existing keys with the same names.">🔄 Restore defaults</button>
</div>
</div>
                    `;
                }
            }
        }
        
        messagesDiv.innerHTML = `
            <div class="result-box error" style="margin: 0; text-align: left;">
                <h4>❌ Miniscript error</h4>
                <div style="margin-top: 10px; text-align: left;">${message}</div>
                ${additionalHelp}
            </div>
        `;
    }

    // Tree parsing functions
    parseMiniscriptTree(expression) {
        // Remove whitespace for parsing
        expression = expression.trim();
        
        // Check if this is a tr() descriptor
        if (expression.startsWith('tr(')) {
            return this.parseTaprootDescriptor(expression);
        }
        
        // Parse the expression into a tree structure
        const tree = this.parseNode(expression);
        return tree;
    }
    
    parseTaprootDescriptor(descriptor) {
        // Parse tr(internal_key,{tree}) format
        const match = descriptor.match(/^tr\(([^,)]+)(?:,(.+))?\)(?:#[a-z0-9]+)?$/);
        if (!match) return null;
        
        const internalKey = match[1];
        const treeScript = match[2];
        
        const tree = {
            type: 'taproot',
            internalKey: internalKey,
            children: []
        };
        
        if (treeScript) {
            // Parse the tree structure
            if (treeScript.startsWith('{') && treeScript.endsWith('}')) {
                // Multi-leaf tree: {pk(A),pk(B)} or {pk(A),{pk(B),pk(C)}}
                const innerTree = this.parseTaprootTree(treeScript);
                if (innerTree) {
                    tree.children.push(innerTree);
                }
            } else {
                // Single leaf
                tree.children.push({
                    type: 'leaf',
                    miniscript: treeScript
                });
            }
        }
        
        return tree;
    }
    
    parseTaprootTree(treeStr) {
        // Remove outer braces
        const inner = treeStr.slice(1, -1);
        
        // Find the top-level comma
        let depth = 0;
        let parenDepth = 0;
        let commaPos = -1;
        
        for (let i = 0; i < inner.length; i++) {
            const ch = inner[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            else if (ch === '(') parenDepth++;
            else if (ch === ')') parenDepth--;
            else if (ch === ',' && depth === 0 && parenDepth === 0) {
                commaPos = i;
                break;
            }
        }
        
        if (commaPos === -1) {
            // Single leaf
            return {
                type: 'leaf',
                miniscript: inner.trim()
            };
        }
        
        // Branch with left and right
        const left = inner.slice(0, commaPos).trim();
        const right = inner.slice(commaPos + 1).trim();
        
        const branch = {
            type: 'branch',
            children: []
        };
        
        // Parse left side
        if (left.startsWith('{') && left.endsWith('}')) {
            branch.children.push(this.parseTaprootTree(left));
        } else {
            branch.children.push({
                type: 'leaf',
                miniscript: left
            });
        }
        
        // Parse right side
        if (right.startsWith('{') && right.endsWith('}')) {
            branch.children.push(this.parseTaprootTree(right));
        } else {
            branch.children.push({
                type: 'leaf',
                miniscript: right
            });
        }
        
        return branch;
    }
    
    parseNode(expr) {
        expr = expr.trim();
        if (!expr) return null;
        
        // Check for wrappers (v:, s:, a:, c:, d:, j:, n:, l:, u:, t:, etc.)
        // Multiple wrappers can be combined like "snl:" or "vc:"
        const wrapperMatch = expr.match(/^([vscdjnltua]+):/);
        if (wrapperMatch) {
            const wrapper = wrapperMatch[1];
            const rest = expr.substring(wrapper.length + 1);
            return {
                type: 'wrapper',
                wrapper: wrapper + ':',
                child: this.parseNode(rest)
            };
        }
        
        // Check for function/fragment with arguments (including underscores for pk_k, pk_h, etc.)
        const funcMatch = expr.match(/^([a-z_]+)\((.*)\)$/);
        if (funcMatch) {
            const funcName = funcMatch[1];
            const argsStr = funcMatch[2];
            
            // Special handling for different fragment types
            const fragmentInfo = this.getFragmentInfo(funcName);
            
            // Parse arguments
            const args = this.parseArguments(argsStr);
            
            return {
                type: 'fragment',
                name: funcName,
                scriptOp: fragmentInfo.scriptOp,
                args: args
            };
        }
        
        // Terminal node (key variable, number, hash, etc.)
        return {
            type: 'terminal',
            value: expr
        };
    }
    
    parseArguments(argsStr) {
        const args = [];
        let current = '';
        let depth = 0;
        
        for (let i = 0; i < argsStr.length; i++) {
            const char = argsStr[i];
            if (char === '(' ) depth++;
            else if (char === ')') depth--;
            
            if (char === ',' && depth === 0) {
                args.push(this.parseNode(current.trim()));
                current = '';
            } else {
                current += char;
            }
        }
        
        if (current.trim()) {
            args.push(this.parseNode(current.trim()));
        }
        
        return args;
    }
    
    getFragmentInfo(name) {
        // Map miniscript fragments to their Bitcoin Script representations
        // Only show non-obvious mappings
        const fragmentMap = {
            'and_v': { scriptOp: null },
            'and_b': { scriptOp: null },
            'and_n': { scriptOp: null },
            'andor': { scriptOp: null },
            'or_b': { scriptOp: null },
            'or_c': { scriptOp: null },
            'or_d': { scriptOp: null },
            'or_i': { scriptOp: '[if]' },  // Uses OP_IF/OP_ELSE/OP_ENDIF
            'thresh': { scriptOp: null },  // Will show (X of Y) instead
            'multi': { scriptOp: '[checkmultisig]' },  // Uses OP_CHECKMULTISIG
            'pk': { scriptOp: null },
            'pk_k': { scriptOp: null },
            'pk_h': { scriptOp: null },
            'pkh': { scriptOp: null },
            'older': { scriptOp: '[csv]' },  // OP_CHECKSEQUENCEVERIFY
            'after': { scriptOp: '[cltv]' },  // OP_CHECKLOCKTIMEVERIFY
            'sha256': { scriptOp: null },
            'hash256': { scriptOp: null },
            'ripemd160': { scriptOp: null },
            'hash160': { scriptOp: null }
        };
        
        return fragmentMap[name] || { scriptOp: null };
    }
    
    formatTreeAsScriptCompilation(tree, indent = 0) {
        if (!tree) return '';
        
        const spaces = '    '.repeat(indent);
        
        if (tree.type === 'wrapper') {
            // Split multiple wrappers (e.g., "vc:" -> "v: c:")
            const wrappers = tree.wrapper.replace(':', '').split('').join(': ') + ':';
            
            // Format child
            if (tree.child.type === 'fragment') {
                // Check if it's a simple key function that should be inline
                if ((tree.child.name === 'pk_k' || tree.child.name === 'pk_h' || tree.child.name === 'pk' || tree.child.name === 'pkh') 
                    && tree.child.args && tree.child.args.length === 1 && tree.child.args[0].type === 'terminal') {
                    // Format inline: a: pkh(VaultKey19)
                    return `${wrappers} ${tree.child.name}(${tree.child.args[0].value})`;
                }
                
                // For thresh with wrapper, special formatting
                if (tree.child.name === 'thresh' && tree.child.args && tree.child.args.length > 0) {
                    const threshold = tree.child.args[0].type === 'terminal' ? tree.child.args[0].value : '?';
                    const total = tree.child.args.length - 1;
                    const scriptOp = tree.child.scriptOp ? ` ${tree.child.scriptOp}` : '';
                    let output = `${wrappers} ${tree.child.name}(${threshold} of ${total})${scriptOp}`;
                    
                    // Add the key arguments (skip first one which is the threshold)
                    for (let i = 1; i < tree.child.args.length; i++) {
                        output += '\n' + spaces + '    ' + this.formatTreeAsScriptCompilation(tree.child.args[i], indent + 1);
                    }
                    return output;
                }
                
                // For other wrapped fragments, show wrapper and fragment name on same line
                const scriptOp = tree.child.scriptOp ? ` ${tree.child.scriptOp}` : '';
                let output = `${wrappers} ${tree.child.name}${scriptOp}`;
                
                // Add fragment arguments indented
                if (tree.child.args && tree.child.args.length > 0) {
                    for (const arg of tree.child.args) {
                        output += '\n' + spaces + '    ' + this.formatTreeAsScriptCompilation(arg, indent + 1);
                    }
                }
                return output;
            } else {
                // For wrapped terminals or other wrappers
                const childFormatted = this.formatTreeAsScriptCompilation(tree.child, indent);
                return `${wrappers} ${childFormatted}`;
            }
        } else if (tree.type === 'fragment') {
            const scriptOp = tree.scriptOp ? ` ${tree.scriptOp}` : '';
            
            // For simple terminal functions (pk, pkh, pk_k, pk_h), format inline
            if ((tree.name === 'pk_k' || tree.name === 'pk_h' || tree.name === 'pk' || tree.name === 'pkh') 
                && tree.args && tree.args.length === 1 && tree.args[0].type === 'terminal') {
                return `${tree.name}(${tree.args[0].value})`;
            }
            
            // For thresh, show count inline
            if (tree.name === 'thresh' && tree.args && tree.args.length > 0) {
                const threshold = tree.args[0].type === 'terminal' ? tree.args[0].value : '?';
                const total = tree.args.length - 1;
                let output = `${tree.name}(${threshold} of ${total})${scriptOp}`;
                
                // Add the key arguments (skip first one which is the threshold)
                for (let i = 1; i < tree.args.length; i++) {
                    output += '\n' + spaces + '    ' + this.formatTreeAsScriptCompilation(tree.args[i], indent + 1);
                }
                return output;
            }
            
            // For multi, show count inline like thresh
            if (tree.name === 'multi' && tree.args && tree.args.length > 0) {
                const threshold = tree.args[0].type === 'terminal' ? tree.args[0].value : '?';
                const total = tree.args.length - 1;
                let output = `${tree.name}(${threshold} of ${total})${scriptOp}`;
                
                // Add the key arguments (skip first one which is the threshold)
                for (let i = 1; i < tree.args.length; i++) {
                    output += '\n' + spaces + '    ' + this.formatTreeAsScriptCompilation(tree.args[i], indent + 1);
                }
                return output;
            }
            
            // For after/older with single number argument, format inline
            if ((tree.name === 'after' || tree.name === 'older') 
                && tree.args && tree.args.length === 1 && tree.args[0].type === 'terminal') {
                return `${tree.name}(${tree.args[0].value})${scriptOp}`;
            }
            
            // Special case for andor (3 arguments) - show the [or] and [and] structure
            if (tree.name === 'andor' && tree.args && tree.args.length === 3) {
                let output = `${tree.name} [or]\n`;
                // First show the [and] branch with first two arguments
                output += spaces + '    andor [and]\n';
                output += spaces + '        ' + this.formatTreeAsScriptCompilation(tree.args[0], indent + 2) + '\n';
                output += spaces + '        ' + this.formatTreeAsScriptCompilation(tree.args[1], indent + 2) + '\n';
                // Then show the third argument (the "else" branch)
                output += spaces + '    ' + this.formatTreeAsScriptCompilation(tree.args[2], indent + 1);
                return output;
            }
            
            // Default fragment formatting
            let output = `${tree.name}${scriptOp}`;
            if (tree.args && tree.args.length > 0) {
                for (const arg of tree.args) {
                    output += '\n' + spaces + '    ' + this.formatTreeAsScriptCompilation(arg, indent + 1);
                }
            }
            return output;
        } else if (tree.type === 'terminal') {
            return tree.value;
        }
        
        return '';
    }
    
    formatTreeAsVerticalHierarchy(tree) {
        // First, build the tree structure with positioning
        const nodeInfo = this.calculateNodePositions(tree, 0, 0);
        const lines = this.renderBinaryTree(nodeInfo);
        return lines.join('\n');
    }
    
    calculateNodePositions(tree, depth, position) {
        if (!tree) return null;
        
        // Handle taproot tree structure
        if (tree.type === 'taproot') {
            const rootNode = {
                type: 'taproot_root',
                text: `taproot`, // Remove tr(NUMS) display
                depth: depth,
                position: position,
                children: []
            };
            
            // Add tree children if they exist
            if (tree.children && tree.children.length > 0) {
                tree.children.forEach((child, index) => {
                    const childNode = this.calculateNodePositions(child, depth + 1, index);
                    if (childNode) {
                        rootNode.children.push(childNode);
                    }
                });
            }
            
            return rootNode;
        }
        
        if (tree.type === 'branch') {
            const branchNode = {
                type: 'taproot_branch',
                text: 'Branch',
                depth: depth,
                position: position,
                children: []
            };
            
            tree.children.forEach((child, index) => {
                const childNode = this.calculateNodePositions(child, depth + 1, index);
                if (childNode) {
                    branchNode.children.push(childNode);
                }
            });
            
            return branchNode;
        }
        
        if (tree.type === 'leaf') {
            // Replace key names if available
            let displayMiniscript = tree.miniscript;
            if (this.keyVariables && this.keyVariables.size > 0) {
                displayMiniscript = this.replaceKeysWithNames(tree.miniscript);
            }
            
            return {
                type: 'taproot_leaf',
                text: displayMiniscript,
                depth: depth,
                position: position,
                children: []
            };
        }
        
        // Helper to format node text (original logic for non-taproot trees)
        const formatNode = (node) => {
            if (node.type === 'wrapper') {
                const wrappers = node.wrapper.replace(':', '').split('').join(': ') + ':';
                if (node.child.type === 'fragment' && 
                    (node.child.name === 'pk_k' || node.child.name === 'pk_h' || node.child.name === 'pk' || node.child.name === 'pkh') &&
                    node.child.args && node.child.args.length === 1 && node.child.args[0].type === 'terminal') {
                    return `${wrappers} ${node.child.name}(${node.child.args[0].value})`;
                }
                return wrappers + ' ' + formatNode(node.child);
            } else if (node.type === 'fragment') {
                if ((node.name === 'pk_k' || node.name === 'pk_h' || node.name === 'pk' || node.name === 'pkh') 
                    && node.args && node.args.length === 1 && node.args[0].type === 'terminal') {
                    return `${node.name}(${node.args[0].value})`;
                } else if ((node.name === 'thresh' || node.name === 'multi') && node.args && node.args.length > 0) {
                    const threshold = node.args[0].type === 'terminal' ? node.args[0].value : '?';
                    const total = node.args.length - 1;
                    return `${node.name}(${threshold}/${total})`;
                } else if ((node.name === 'after' || node.name === 'older') 
                    && node.args && node.args.length === 1 && node.args[0].type === 'terminal') {
                    return `${node.name}(${node.args[0].value})`;
                }
                return node.name;
            } else if (node.type === 'terminal') {
                return node.value;
            }
            return '';
        };
        
        const nodeText = formatNode(tree);
        
        // Get children
        let children = [];
        if (tree.type === 'wrapper' && tree.child.type === 'fragment' && tree.child.args) {
            if (!((tree.child.name === 'pk_k' || tree.child.name === 'pk_h' || tree.child.name === 'pk' || tree.child.name === 'pkh') 
                && tree.child.args.length === 1)) {
                children = tree.child.args;
            }
        } else if (tree.type === 'fragment' && tree.args) {
            if (tree.name === 'thresh' || tree.name === 'multi') {
                children = tree.args.slice(1);
            } else if (!((tree.name === 'pk_k' || tree.name === 'pk_h' || tree.name === 'pk' || tree.name === 'pkh' || 
                         tree.name === 'after' || tree.name === 'older') && tree.args.length === 1)) {
                children = tree.args;
            }
        }
        
        const childNodes = [];
        let nextPosition = position;
        
        for (let i = 0; i < children.length; i++) {
            const childNode = this.calculateNodePositions(children[i], depth + 1, nextPosition);
            if (childNode) {
                childNodes.push(childNode);
                nextPosition = childNode.rightmostPosition + 4; // spacing between siblings
            }
        }
        
        // Calculate this node's position based on children
        let nodePosition = position;
        if (childNodes.length > 0) {
            const leftmost = childNodes[0].position;
            const rightmost = childNodes[childNodes.length - 1].position;
            nodePosition = Math.floor((leftmost + rightmost) / 2);
        }
        
        return {
            text: nodeText,
            position: nodePosition,
            rightmostPosition: Math.max(nodePosition + nodeText.length, nextPosition - 4),
            depth: depth,
            children: childNodes
        };
    }
    
    renderBinaryTree(nodeInfo) {
        if (!nodeInfo) return [];
        
        // Find the maximum depth and width
        const allNodes = this.flattenNodes(nodeInfo);
        const maxDepth = Math.max(...allNodes.map(n => n.depth));
        const maxWidth = Math.max(...allNodes.map(n => n.position + n.text.length));
        
        // Create lines array
        const lines = [];
        for (let d = 0; d <= maxDepth * 2; d++) {
            lines[d] = ' '.repeat(maxWidth + 10);
        }
        
        // Place all nodes
        this.placeNodesInLines(nodeInfo, lines);
        
        // Draw connectors
        this.drawConnectors(nodeInfo, lines);
        
        // Clean up lines (remove trailing spaces)
        return lines.map(line => line.replace(/\s+$/, ''));
    }
    
    flattenNodes(nodeInfo) {
        if (!nodeInfo) return [];
        
        let nodes = [nodeInfo];
        for (const child of nodeInfo.children) {
            nodes = nodes.concat(this.flattenNodes(child));
        }
        return nodes;
    }
    
    placeNodesInLines(nodeInfo, lines) {
        if (!nodeInfo) return;
        
        const lineIndex = nodeInfo.depth * 2;
        const pos = nodeInfo.position;
        
        // Place the node text
        for (let i = 0; i < nodeInfo.text.length; i++) {
            if (pos + i < lines[lineIndex].length) {
                lines[lineIndex] = lines[lineIndex].substring(0, pos + i) + 
                                  nodeInfo.text[i] + 
                                  lines[lineIndex].substring(pos + i + 1);
            }
        }
        
        // Place children
        for (const child of nodeInfo.children) {
            this.placeNodesInLines(child, lines);
        }
    }
    
    drawConnectors(nodeInfo, lines) {
        if (!nodeInfo || nodeInfo.children.length === 0) return;
        
        const parentLineIndex = nodeInfo.depth * 2;
        const connectorLineIndex = parentLineIndex + 1;
        const parentPos = nodeInfo.position + Math.floor(nodeInfo.text.length / 2);
        
        if (nodeInfo.children.length === 1) {
            // Single child - draw vertical line
            const childPos = nodeInfo.children[0].position + Math.floor(nodeInfo.children[0].text.length / 2);
            const pos = Math.min(parentPos, childPos);
            if (pos < lines[connectorLineIndex].length) {
                lines[connectorLineIndex] = lines[connectorLineIndex].substring(0, pos) + '│' + lines[connectorLineIndex].substring(pos + 1);
            }
        } else if (nodeInfo.children.length > 1) {
            // Multiple children - draw connector
            const leftChild = nodeInfo.children[0];
            const rightChild = nodeInfo.children[nodeInfo.children.length - 1];
            const leftPos = leftChild.position + Math.floor(leftChild.text.length / 2);
            const rightPos = rightChild.position + Math.floor(rightChild.text.length / 2);
            
            // Draw horizontal line
            for (let pos = leftPos; pos <= rightPos; pos++) {
                if (pos < lines[connectorLineIndex].length) {
                    if (pos === leftPos) {
                        lines[connectorLineIndex] = lines[connectorLineIndex].substring(0, pos) + '┌' + lines[connectorLineIndex].substring(pos + 1);
                    } else if (pos === rightPos) {
                        lines[connectorLineIndex] = lines[connectorLineIndex].substring(0, pos) + '┐' + lines[connectorLineIndex].substring(pos + 1);
                    } else if (pos === parentPos) {
                        lines[connectorLineIndex] = lines[connectorLineIndex].substring(0, pos) + '┼' + lines[connectorLineIndex].substring(pos + 1);
                    } else {
                        lines[connectorLineIndex] = lines[connectorLineIndex].substring(0, pos) + '─' + lines[connectorLineIndex].substring(pos + 1);
                    }
                }
            }
            
            // Draw vertical lines to middle children
            for (let i = 1; i < nodeInfo.children.length - 1; i++) {
                const childPos = nodeInfo.children[i].position + Math.floor(nodeInfo.children[i].text.length / 2);
                if (childPos < lines[connectorLineIndex].length) {
                    lines[connectorLineIndex] = lines[connectorLineIndex].substring(0, childPos) + '┬' + lines[connectorLineIndex].substring(childPos + 1);
                }
            }
        }
        
        // Draw connectors for children
        for (const child of nodeInfo.children) {
            this.drawConnectors(child, lines);
        }
    }

    showMiniscriptSuccess(message, expression = null) {
        const messagesDiv = document.getElementById('miniscript-messages');
        
        // Check if we should update existing success message during auto-compile
        if (this.isAutoCompiling) {
            const existingSuccess = messagesDiv.querySelector('.result-box.success');
            if (existingSuccess) {
                // Update the existing message content
                const messageContent = existingSuccess.querySelector('div[style*="margin-top: 10px"]');
                if (messageContent) {
                    messageContent.innerHTML = message;
                }
                
                // Update or generate tree visualization
                if (expression) {
                    try {
                        const treeDisplaySetting = document.getElementById('tree-display-setting');
                        const isMobile = window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                        const defaultMode = isMobile ? 'script-compilation' : 'visual-hierarchy';
                        const treeDisplayMode = treeDisplaySetting ? treeDisplaySetting.value : defaultMode;
                        
                        if (treeDisplayMode !== 'hidden') {
                            const tree = this.parseMiniscriptTree(expression);
                            let treeFormatted = '';
                            let treeTitle = '';
                            
                            if (treeDisplayMode === 'script-compilation') {
                                treeFormatted = this.formatTreeAsScriptCompilation(tree);
                                treeTitle = 'Script Compilation View';
                            } else if (treeDisplayMode === 'visual-hierarchy') {
                                treeFormatted = this.formatTreeAsVerticalHierarchy(tree);
                                treeTitle = 'Visual Hierarchy View';
                            }
                            
                            if (treeFormatted) {
                                // Look for existing tree area
                                let treeArea = existingSuccess.querySelector('div[style*="margin-top: 15px"]');
                                if (treeArea && treeArea.querySelector('strong')) {
                                    // Update existing tree
                                    treeArea.querySelector('strong').textContent = `Tree structure (${treeTitle})`;
                                    const pre = treeArea.querySelector('pre');
                                    if (pre) {
                                        pre.textContent = treeFormatted;
                                    }
                                } else {
                                    // Add new tree area
                                    const treeHtml = `
                                        <div style="margin-top: 15px;">
                                            <strong>Tree structure (${treeTitle})</strong>
                                            <pre style="margin-top: 8px; padding: 12px; border: 1px solid var(--border-color); border-radius: 4px; overflow-x: auto; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 12px; line-height: 1.4; background: transparent;">${treeFormatted}</pre>
                                        </div>
                                    `;
                                    existingSuccess.insertAdjacentHTML('beforeend', treeHtml);
                                }
                            }
                        }
                        
                        // Add/Update/Remove Taproot info for auto-compile updates
                        const context = document.querySelector('input[name="context"]:checked')?.value;
                        const existingTaprootInfo = existingSuccess.querySelector('.taproot-info');
                        
                        if (context === 'taproot') {
                            const taprootInfo = this.generateTaprootInfo(expression);
                            if (taprootInfo) {
                                if (existingTaprootInfo) {
                                    // Replace existing taproot info with new one
                                    existingTaprootInfo.outerHTML = taprootInfo;
                                } else {
                                    // Add new taproot info
                                    existingSuccess.insertAdjacentHTML('beforeend', taprootInfo);
                                }
                            }
                        } else if (existingTaprootInfo) {
                            // Remove taproot info if context is no longer taproot
                            existingTaprootInfo.remove();
                        }
                    } catch (error) {
                        console.error('Error generating tree:', error);
                    }
                }
                return; // Don't replace the entire message box
            }
        }
        
        // Normal behavior - create new message
        let treeHtml = '';
        let taprootInfoHtml = '';
        
        // Generate tree visualization if expression is provided
        if (expression) {
            try {
                // Get tree display setting from select dropdown
                const treeDisplaySetting = document.getElementById('tree-display-setting');
                // Default depends on device type
                const isMobile = window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                const defaultMode = isMobile ? 'script-compilation' : 'visual-hierarchy';
                const treeDisplayMode = treeDisplaySetting ? treeDisplaySetting.value : defaultMode;
                
                if (treeDisplayMode !== 'hidden') {
                    const tree = this.parseMiniscriptTree(expression);
                    let treeFormatted = '';
                    let treeTitle = '';
                    
                    if (treeDisplayMode === 'script-compilation') {
                        treeFormatted = this.formatTreeAsScriptCompilation(tree);
                        treeTitle = 'Script Compilation View';
                    } else if (treeDisplayMode === 'visual-hierarchy') {
                        treeFormatted = this.formatTreeAsVerticalHierarchy(tree);
                        treeTitle = 'Visual Hierarchy View';
                    }
                    
                    if (treeFormatted) {
                        treeHtml = `
                            <div style="margin-top: 15px;">
                                <strong>Tree structure (${treeTitle})</strong>
                                <pre style="margin-top: 8px; padding: 12px; border: 1px solid var(--border-color); border-radius: 4px; overflow-x: auto; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 12px; line-height: 1.4; background: transparent;">${treeFormatted}</pre>
                            </div>
                        `;
                    }
                }
                
                // Generate Taproot info if context is taproot
                const context = document.querySelector('input[name="context"]:checked')?.value;
                if (context === 'taproot') {
                    taprootInfoHtml = this.generateTaprootInfo(expression);
                }
            } catch (error) {
                console.error('Error generating tree:', error);
            }
        }
        
        // Check if this is Taproot context and add mode selection if needed
        const context = document.querySelector('input[name="context"]:checked')?.value;
        let modeSelectionHtml = '';
        
        if (context === 'taproot' && expression && !expression.startsWith('tr(')) {
            // Get current mode (default to single-leaf for direct miniscript)
            const currentMode = window.currentTaprootMode || 'single-leaf';
            
            modeSelectionHtml = `
                <div style="margin-top: 15px; margin-bottom: 15px; padding: 10px; background: var(--success-bg); border-radius: 6px; border: 1px solid var(--success-border);">
                    <div style="margin-bottom: 10px;"><strong>Compilation Mode:</strong></div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <label style="display: flex; align-items: center; cursor: pointer;">
                            <input type="radio" name="taproot-miniscript-mode" value="single-leaf" ${currentMode === 'single-leaf' ? 'checked' : ''} 
                                   onchange="window.switchTaprootModeFromMiniscript('single-leaf')" 
                                   style="margin-right: 8px; accent-color: var(--accent-color); transform: scale(1.1);">
                            <span style="font-size: 13px;"><strong>Miniscript compilation</strong> (single script)</span>
                        </label>
                        <label style="display: flex; align-items: center; cursor: pointer;">
                            <input type="radio" name="taproot-miniscript-mode" value="multi-leaf" ${currentMode === 'multi-leaf' ? 'checked' : ''} 
                                   onchange="window.switchTaprootModeFromMiniscript('multi-leaf')" 
                                   style="margin-right: 8px; accent-color: var(--accent-color); transform: scale(1.1);">
                            <span style="font-size: 13px;"><strong>Taproot compilation</strong> (multi-leaf TapTree)</span>
                        </label>
                    </div>
                </div>
            `;
        }
        
        messagesDiv.innerHTML = `
            <div class="result-box success" style="margin: 0;">
                <h4>✅ Success</h4>
                ${modeSelectionHtml}
                <div style="margin-top: 10px; word-wrap: break-word; word-break: break-all; overflow-wrap: break-word; white-space: pre-wrap;">${message}</div>
                ${treeHtml}
                ${taprootInfoHtml}
            </div>
        `;
    }

    generateTaprootInfo(expression) {
        try {
            // Parse the expression to understand taproot structure
            const isTaprootDescriptor = expression && expression.trim().startsWith('tr(');
            
            // Get current taproot mode for display
            const currentMode = window.currentTaprootMode || 'single-leaf';
            
            // Try to get taproot leaves from WASM
            let leavesHtml = '';
            if (this.wasm && get_taproot_leaves) {
                try {
                    // First replace key variables for the WASM call
                    const context = document.querySelector('input[name="context"]:checked').value;
                    const processedExpression = this.replaceKeyVariables(expression, context);
                    const leaves = get_taproot_leaves(processedExpression);
                    
                    if (leaves && leaves.length > 0) {
                        leavesHtml = `
                            <div style="margin-top: 12px;">
                                <strong>Script Tree Leaves (${leaves.length}):</strong>
                        `;
                        
                        leaves.forEach((leaf, index) => {
                            // Replace keys back with names for display
                            let displayMiniscript = leaf.miniscript;
                            if (this.keyVariables.size > 0) {
                                displayMiniscript = this.replaceKeysWithNames(leaf.miniscript);
                            }
                            
                            // Handle special cases
                            let scriptHex, scriptAsm;
                            if (leaf.script_hex === "requires_key_conversion") {
                                scriptHex = "Key conversion needed";
                                scriptAsm = "PublicKey format - needs x-only conversion for taproot";
                            } else {
                                scriptHex = leaf.script_hex;
                                scriptAsm = leaf.script_asm || "Not available";
                            }
                            
                            leavesHtml += `
                                <div style="margin-top: 10px; padding: 8px; border: 1px solid var(--border-color); border-radius: 3px; background: transparent;">
                                    <div><strong>Leaf #${leaf.leaf_index} (${leaf.branch_path})</strong></div>
                                    <div style="margin-top: 6px;">
                                        <strong>Miniscript:</strong><br>
                                        <span style="font-family: monospace; word-break: break-all; color: var(--text-secondary);">${displayMiniscript}</span>
                                    </div>
                                    <div style="margin-top: 6px;">
                                        <strong>Script (Hex):</strong><br>
                                        <span style="font-family: monospace; word-break: break-all; color: var(--text-secondary); font-size: 11px;">${scriptHex}</span>
                                    </div>
                                    <div style="margin-top: 6px;">
                                        <strong>Script (ASM):</strong><br>
                                        <span style="font-family: monospace; word-break: break-all; color: var(--text-secondary); font-size: 11px;">${scriptAsm}</span>
                                    </div>
                                </div>
                            `;
                        });
                        
                        leavesHtml += `
                            </div>
                        `;
                    }
                } catch (e) {
                    console.error('Failed to get taproot leaves:', e);
                }
            }
            
            if (!isTaprootDescriptor) {
                // For non-tr() expressions in taproot context, show info based on mode
                if (currentMode === 'single-leaf') {
                    // Single-leaf mode: no taproot details needed
                    return '';
                } else {
                    // Multi-leaf mode: show tree structure with leaves
                    return `
                        <div class="taproot-info" style="margin-top: 15px; padding: 12px; border: 1px solid var(--border-color); border-radius: 4px; background: transparent;">
                            <strong>🌿 Taproot Details</strong>
                            <div style="margin-top: 8px; font-size: 12px; line-height: 1.6;">
                                <div><strong>Script Type:</strong> Multi-leaf TapTree</div>
                                <div><strong>Internal Key:</strong> NUMS point (unspendable)</div>
                                <div><strong>Spend Path:</strong> Script path only</div>
                                <div style="margin-top: 8px; color: var(--text-secondary);">
                                    ℹ️ This miniscript is optimized into multiple tapscript leaves for efficient spending paths.
                                </div>
                                ${leavesHtml}
                            </div>
                        </div>
                    `;
                }
            }
            
            // Parse tr() descriptor to extract internal key and tree structure
            const trMatch = expression.match(/^tr\(([^,)]+)(?:,(.+))?\)$/);
            if (!trMatch) {
                return ''; // Invalid tr() format
            }
            
            const internalKey = trMatch[1];
            const treeScript = trMatch[2] || '';
            
            // Determine if internal key is NUMS or a real key
            const isNUMS = internalKey.includes('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0');
            const keyType = isNUMS ? 'NUMS point (unspendable)' : 'User-provided key';
            const spendPaths = [];
            
            if (!isNUMS) {
                spendPaths.push('Key path (signature only)');
            }
            if (treeScript) {
                spendPaths.push('Script path (reveal script + witness)');
            }
            
            // Count tree leaves if there's a tree
            let leafCount = 0;
            if (treeScript) {
                // Simple heuristic: count occurrences of pk, pkh, and other leaf-like patterns
                // This is simplified - a full parser would be better
                leafCount = (treeScript.match(/\bpk[h]?\(/g) || []).length;
                if (leafCount === 0) leafCount = 1; // At least one leaf if there's a tree
            }
            
            let taprootHtml = `
                <div class="taproot-info" style="margin-top: 15px; padding: 12px; border: 1px solid var(--border-color); border-radius: 4px; background: transparent;">
                    <strong>🌿 Taproot Details</strong>
                    <div style="margin-top: 8px; font-size: 12px; line-height: 1.6;">
                        <div><strong>Internal Key:</strong> ${keyType}</div>
                        <div><strong>Spend Paths:</strong> ${spendPaths.join(', ') || 'None'}</div>
            `;
            
            if (treeScript) {
                taprootHtml += `
                        <div><strong>Script Tree:</strong> ${leafCount} leaf${leafCount !== 1 ? 'ves' : ''}</div>
                `;
            }
            
            // Add informational note
            if (isNUMS && treeScript) {
                taprootHtml += `
                        <div style="margin-top: 8px; color: var(--text-secondary);">
                            ℹ️ Using NUMS point ensures this can only be spent via script path, not key path.
                        </div>
                `;
            } else if (!isNUMS && !treeScript) {
                taprootHtml += `
                        <div style="margin-top: 8px; color: var(--text-secondary);">
                            ℹ️ Key-path only spending - most efficient taproot usage.
                        </div>
                `;
            } else if (!isNUMS && treeScript) {
                taprootHtml += `
                        <div style="margin-top: 8px; color: var(--text-secondary);">
                            ℹ️ Dual spending paths: efficient key path or flexible script path.
                        </div>
                `;
            }
            
            taprootHtml += `
                    </div>
                    ${leavesHtml}
                </div>
            `;
            
            return taprootHtml;
        } catch (error) {
            console.error('Error generating taproot info:', error);
            return '';
        }
    }

    clearMiniscriptMessages(preserveSuccess = false) {
        if (preserveSuccess) {
            const messagesDiv = document.getElementById('miniscript-messages');
            const successBox = messagesDiv.querySelector('.result-box.success');
            if (successBox) {
                // Keep the success message, only clear errors
                const errors = messagesDiv.querySelectorAll('.result-box.error');
                errors.forEach(error => error.remove());
                return;
            }
        }
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
        // Clear highlighting cache to ensure re-highlighting even if content didn't change
        delete expressionInput.dataset.lastHighlightedText;
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
            
            // For descriptor keys (containing [ or / or '), use exact string matching
            // For simple hex keys, use word boundaries
            const escapedValue = this.escapeRegex(value);
            let regex;
            if (value.includes('[') || value.includes('/') || value.includes("'") || value.includes('<') || value.includes('>')) {
                // Descriptor key - use exact matching without word boundaries
                regex = new RegExp(escapedValue, 'g');
            } else {
                // Simple hex key - use word boundaries
                regex = new RegExp('\\b' + escapedValue + '\\b', 'g');
            }
            
            processedText = processedText.replace(regex, marker);
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
        // Clear highlighting cache to ensure re-highlighting even if content didn't change
        delete policyInput.dataset.lastHighlightedText;
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
        // Clear results first, then reinitialize
        document.getElementById('results').innerHTML = '';
        this.initializeEmptyResults();
        this.clearMiniscriptMessages();
        
        // Reset taproot mode to default
        window.currentTaprootMode = 'single-leaf';
        
        // Reset description states to default (expanded)
        if (window.resetDescriptionStates) {
            window.resetDescriptionStates();
        }
        
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
        
        // Remove previous lift messages (success, info, error)
        const existingLiftMessages = resultsDiv.querySelectorAll('.lift-message');
        existingLiftMessages.forEach(el => el.remove());
        
        const successDiv = document.createElement('div');
        successDiv.className = 'result-box success lift-message';
        successDiv.innerHTML = `<h4>✅ Success</h4><div>${message}</div>`;
        resultsDiv.appendChild(successDiv);
        
        // Auto-remove success message after 3 seconds (for non-lift success messages)
        if (!message.includes('Lifted')) {
            setTimeout(() => successDiv.remove(), 3000);
        }
    }

    showInfo(message) {
        const resultsDiv = document.getElementById('results');
        
        // Remove previous lift messages (success, info, error)
        const existingLiftMessages = resultsDiv.querySelectorAll('.lift-message');
        existingLiftMessages.forEach(el => el.remove());
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'result-box info lift-message';
        infoDiv.innerHTML = `<h4>ℹ️ Info</h4><div>${message}</div>`;
        resultsDiv.appendChild(infoDiv);
        
        // Auto-remove info message after 4 seconds (for non-lift info messages)
        if (!message.includes('Lifted')) {
            setTimeout(() => infoDiv.remove(), 4000);
        }
    }

    showLiftError(message) {
        const resultsDiv = document.getElementById('results');
        
        // Remove previous lift messages (success, info, error)
        const existingLiftMessages = resultsDiv.querySelectorAll('.lift-message');
        existingLiftMessages.forEach(el => el.remove());
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'result-box error lift-message';
        errorDiv.innerHTML = `<h4>❌ Lift Error</h4><div>${message}</div>`;
        resultsDiv.appendChild(errorDiv);
        
        // Lift error messages persist until user action (no auto-removal)
    }

    copyHexScript(hexDisplay) {
        if (!hexDisplay) {
            alert('No hex script to copy');
            return;
        }
        
        const script = hexDisplay.value.trim();
        
        if (!script) {
            alert('No hex script to copy');
            return;
        }
        
        // Find the button for visual feedback
        const button = document.getElementById('copy-hex-script-btn');
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
            console.error('Failed to copy: ', err);
            // Fallback for older browsers
            hexDisplay.select();
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
    }

    toggleAddressNetwork(button, addressDisplay) {
        const currentNetwork = button.dataset.network;
        const scriptHex = addressDisplay.dataset.scriptHex;
        const scriptType = addressDisplay.dataset.scriptType;
        const miniscript = addressDisplay.dataset.miniscript;
        
        if (!scriptHex || !scriptType) {
            console.error('Missing script information for network toggle');
            return;
        }
        
        if (!this.wasm) {
            console.error('WASM not ready');
            return;
        }
        
        // Determine new network
        const newNetwork = currentNetwork === 'mainnet' ? 'testnet' : 'mainnet';
        
        // Show loading state
        const originalContent = addressDisplay.textContent;
        addressDisplay.textContent = 'Generating address...';
        button.disabled = true;
        
        try {
            console.log(`Switching from ${currentNetwork} to ${newNetwork} for ${scriptType} script`);
            
            // For Taproot, use TaprootBuilder approach (same as compilation)
            let result;
            if (scriptType === 'Taproot' && miniscript) {
                console.log('DEBUG: Using TaprootBuilder for miniscript:', miniscript);
                result = generate_taproot_address_with_builder(miniscript, newNetwork);
            } else {
                // Call original WASM function for other script types
                result = generate_address_for_network(scriptHex, scriptType, newNetwork);
            }
            
            if (result.success && result.address) {
                // Update address display
                addressDisplay.textContent = result.address;
                
                // Update button state
                button.dataset.network = newNetwork;
                if (newNetwork === 'testnet') {
                    button.style.color = 'var(--success-border)';
                    button.title = 'Switch to Mainnet';
                } else {
                    button.style.color = 'var(--text-secondary)';
                    button.title = 'Switch to Testnet';
                }
                
                console.log(`Successfully switched to ${newNetwork}: ${result.address}`);
            } else {
                console.error('Failed to generate address:', result.error);
                addressDisplay.textContent = originalContent;
                alert(`Failed to generate ${newNetwork} address: ${result.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Network toggle error:', error);
            addressDisplay.textContent = originalContent;
            alert(`Error switching networks: ${error.message}`);
        } finally {
            button.disabled = false;
        }
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
        
        // Reset taproot mode to default
        window.currentTaprootMode = 'single-leaf';
        
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
            
            // Reset format button state since loaded content is unformatted
            const formatBtn = document.getElementById('format-miniscript-btn');
            if (formatBtn) {
                formatBtn.style.color = 'var(--text-secondary)';
                formatBtn.title = 'Format expression with indentation';
                formatBtn.dataset.formatted = 'false';
            }
            
            // Auto-detect context based on key formats in the expression
            const detectedContext = this.detectContextFromExpression(savedExpr.expression);
            const context = detectedContext || savedExpr.context || 'segwit';
            document.querySelector(`input[name="context"][value="${context}"]`).checked = true;
            
            // Clear previous results and messages
            this.initializeEmptyResults();
            this.clearMiniscriptMessages();
            
            // Clear script fields when loading saved miniscript and restore placeholders
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
            
            // Hide description panel
            const miniscriptPanel = document.querySelector('.miniscript-description-panel');
            if (miniscriptPanel) miniscriptPanel.style.display = 'none';
            
            // Reset the "Show key names" checkbox
            const checkbox = document.getElementById('replace-keys-checkbox');
            if (checkbox) {
                checkbox.checked = false;
            }
            
            // Auto-compile if enabled
            autoCompileIfEnabled('miniscript');
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
        
        // Reset taproot mode to default
        window.currentTaprootMode = 'single-leaf';
        
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
            
            // Reset policy format button state since loaded content is unformatted
            const policyFormatBtn = document.getElementById('policy-format-toggle');
            if (policyFormatBtn) {
                policyFormatBtn.style.color = 'var(--text-secondary)';
                policyFormatBtn.title = 'Format expression with indentation';
                policyFormatBtn.dataset.formatted = 'false';
            }
            
            // Auto-detect context based on key formats in the policy
            const detectedContext = this.detectContextFromExpression(savedPolicy.expression);
            const context = detectedContext || savedPolicy.context || 'segwit';
            document.querySelector(`input[name="context"][value="${context}"]`).checked = true;
            
            // Clear previous results
            this.initializeEmptyResults();
            this.clearPolicyErrors();
            
            // Hide description panel
            const policyPanel = document.querySelector('.policy-description-panel');
            if (policyPanel) policyPanel.style.display = 'none';
            
            // Reset the "Show key names" checkbox
            const checkbox = document.getElementById('replace-keys-checkbox');
            if (checkbox) {
                checkbox.checked = false;
            }
            
            // Auto-compile if enabled
            autoCompileIfEnabled('policy');
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
window.loadExample = function(example, exampleId) {
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
    
    // Auto-compile if enabled
    autoCompileIfEnabled('miniscript');
};

// Global function to load policy examples
window.loadPolicyExample = function(example, exampleId) {
    console.log('🚀 loadPolicyExample (from script.js) called with:', example, exampleId);
    
    const policyInput = document.getElementById('policy-input');
    const isMobile = window.innerWidth <= 768;
    
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
    
    // Auto-compile if enabled
    autoCompileIfEnabled('policy');
};

// Global function to show policy descriptions
window.showPolicyDescription = function(exampleId) {
    // Check if descriptions are disabled
    if (localStorage.getItem('showDescriptions') === 'false') {
        return;
    }
    
    const panel = document.getElementById('policy-description');
    const contentDiv = panel.querySelector('.description-content');
    
        const descriptions = {
        'single': {
            title: '📄 Single Key Policy NEW',
            conditions: '🔓 Alice: Immediate spending (no restrictions)',
            useCase: '**Personal Wallet:** The simplest Bitcoin wallet structure - one person, one key. Perfect for individual users who want straightforward control over their funds. Most mobile wallets and hardware wallets use this pattern by default.',
            examples: '💡 **Real-world examples:** Personal savings account, daily spending wallet, individual trading account',
            efficiency: '⚡ **Efficiency:** Minimal transaction size (~73 bytes witness), lowest fees, fastest signing process',
            security: '⚠️ **Security trade-offs:** Single point of failure - if Alice loses her key or gets compromised, funds are permanently lost. No redundancy or recovery options built-in.',
            bestFor: '✅ **Best for:** Individual users, small amounts, frequent transactions, users comfortable with full self-custody responsibility'
        },
        'or': {
            title: '📄 OR Keys Policy - Either Party Access',
            conditions: '🔓 Alice: Can spend immediately\n🔓 Bob: Can spend immediately (independent access)',
            useCase: '**Shared Access Wallet:** Either person can spend independently. Common for couples, business partners, or backup access scenarios. Think "joint checking account" where either person can write checks.',
            examples: '💡 **Real-world examples:** Joint family account, business petty cash, emergency fund shared between spouses, backup key for solo traders',
            efficiency: '⚡ **Efficiency:** Slightly larger than single key (~105 bytes witness). Spender chooses which key to use, so no coordination needed.',
            security: '⚠️ **Security trade-offs:** Weakest-link security - compromise of ANY key results in fund loss. However, provides redundancy against key loss (lose one, still have the other).',
            bestFor: '✅ **Best for:** Trusted partnerships, backup access, situations where convenience matters more than maximum security, emergency access scenarios'
        },
        'and': {
            title: '📄 AND Keys Policy - Dual Authorization',
            conditions: '🔓 Alice + Bob: Both signatures required (no unilateral spending)',
            useCase: '**2-of-2 Multisig:** Both parties must agree to every transaction. Perfect for business partnerships, joint investments, or married couples who want shared financial control. Like requiring two signatures on a check.',
            examples: '💡 **Real-world examples:** Business partnership funds, joint investment account, high-value couple\'s savings, parent-child shared control, corporate treasury requiring dual approval',
            efficiency: '⚡ **Efficiency:** ~137 bytes witness data. Requires coordination between parties for every transaction, but maximum security.',
            security: '✅ **Security benefits:** Strongest security - requires compromise of BOTH keys to steal funds. Protects against single key compromise, impulsive spending, and unauthorized transactions.',
            bestFor: '✅ **Best for:** High-value storage, business partnerships, situations requiring mutual consent, protection against single-person compromise or coercion'
        },
        'threshold': {
            title: '📄 2-of-3 Threshold Policy - Majority Consensus',
            conditions: '🔓 Any 2 of: Alice, Bob, Charlie (flexible majority control)',
            useCase: '**Majority Multisig:** Any 2 out of 3 parties can approve transactions. Perfect for small boards, family trusts, or adding redundancy while maintaining control. Like corporate voting where majority wins.',
            examples: '💡 **Real-world examples:** Board of directors treasury, family trust with multiple trustees, business with 3 partners, estate planning with beneficiaries, crypto startup founder funds',
            efficiency: '⚡ **Efficiency:** Variable witness size depending on which 2 keys sign (~170-200 bytes). Good balance of security and usability.',
            security: '✅ **Security benefits:** Survives 1 key loss or compromise. Prevents single-person control while allowing majority decisions. More resilient than 2-of-2 but less than single key.',
            bestFor: '✅ **Best for:** Small group control, estate planning, business partnerships with 3+ people, backup scenarios where 1 key might be lost, decision-making that benefits from consensus'
        },
        'timelock': {
            title: '📄 Timelock Policy - Immediate vs Delayed Access',
            conditions: '🔓 Alice: Immediate spending (instant access)\n⏰ Bob: After 144 blocks (~1 day) delay',
            useCase: '**Emergency Recovery with Cooling Period:** Alice has daily control, Bob can recover funds but must wait. Prevents rushed decisions and provides time for Alice to intervene if needed. Like a bank account with both owner access and emergency power of attorney.',
            examples: '💡 **Real-world examples:** Personal wallet with family backup, business owner with partner recovery, elderly parent with adult child backup, trader with emergency contact access',
            efficiency: '⚡ **Efficiency:** Alice\'s path is efficient (~73 bytes), Bob\'s path is larger (~105 bytes) due to timelock verification.',
            security: '✅ **Security benefits:** Alice retains full control while providing recovery option. 24-hour delay gives Alice time to move funds if Bob\'s key is compromised. Prevents immediate theft through Bob\'s key.',
            bestFor: '✅ **Best for:** Personal wallets needing backup, elderly users with trusted family, business continuity planning, any scenario where primary user wants emergency recovery with built-in warning time'
        },
        'xonly': {
            title: '📄 Taproot X-only Key - Next-Gen Single Key',
            conditions: '🔓 David: Immediate spending (Taproot/Schnorr context)',
            useCase: '**Modern Single Key:** Uses Taproot\'s X-only public keys (32 bytes vs 33 bytes) with Schnorr signatures. More efficient, more private, and enables advanced scripting. The future of single-key Bitcoin wallets.',
            examples: '💡 **Real-world examples:** Modern hardware wallets, Lightning Network wallets, privacy-focused personal wallets, wallets that might later upgrade to complex scripts',
            efficiency: '⚡ **Efficiency:** Smaller keys (32 vs 33 bytes), smaller signatures (~64 vs 71 bytes), better batch verification, and identical on-chain appearance regardless of underlying complexity.',
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
            efficiency: '⚡ **Efficiency:** Board path uses threshold efficiency (~170-200 bytes), CEO path adds timelock verification (~105 bytes).',
            security: '✅ **Security benefits:** Board control prevents single-person decisions, time-delayed CEO access provides emergency recovery without immediate risk, specific date prevents indefinite executive power.',
            bestFor: '✅ **Best for:** Corporate treasuries, nonprofits, family businesses, any organization needing board control with executive emergency access, succession planning'
        },
        'recovery': {
            title: '📄 Emergency Recovery Policy - Weighted Priority',
            conditions: '🔓 Alice: Immediate spending (95% probability weight - primary path)\n⏰ Bob + Charlie + Eva: 2-of-3 after 1008 blocks (~1 week) emergency consensus',
            useCase: '**Personal Wallet with Family Recovery:** Alice controls daily spending, but family/friends can recover funds if Alice is unavailable for a week. The 95@ weight tells the compiler to optimize for Alice\'s path since it\'s used 95% of the time.',
            examples: '💡 **Real-world examples:** Individual with trusted family backup, solo business owner with partner emergency access, crypto enthusiast with friend/family recovery network, elderly user with adult children backup',
            efficiency: '⚡ **Efficiency:** Alice\'s path is highly optimized due to probability weight. Recovery path is larger (~200+ bytes) but rarely used.',
            security: '✅ **Security benefits:** Alice retains full control, 1-week delay gives Alice time to respond to unauthorized recovery attempts, requires 2-of-3 consensus prevents single family member compromise.',
            bestFor: '✅ **Best for:** Individual wallets with trusted emergency contacts, estate planning, any scenario where primary user wants family backup without compromising daily control'
        },
        'twofa': {
            title: '📄 2FA + Backup Policy - Multi-Factor Security',
            conditions: '🔓 Alice + (Bob + secret OR wait 1 year)',
            useCase: '**Two-Factor Authentication Wallet:** Alice must always sign, plus either Bob (second device/key) with a secret hash, or Alice alone after waiting 1 year. Like 2FA on your crypto wallet - primary key plus second factor, with long-term recovery.',
            examples: '💡 **Real-world examples:** High-security personal wallet, crypto trader with hardware + mobile 2FA, business owner with primary + backup key + secret, paranoid holder with multiple security layers',
            efficiency: '⚡ **Efficiency:** Alice+Bob path is moderate (~137 bytes), Alice+secret path adds hash verification (~170 bytes), Alice-alone path after 1 year includes timelock (~105 bytes).',
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
        'delayed': {
            title: '📄 Taproot 2-of-2 OR Delayed - Cooperative + Emergency',
            conditions: '🔓 Julia + Karl: Immediate 2-of-2 spending (cooperative path)\n⏰ David: After 144 blocks (~1 day) single-party emergency',
            useCase: '**Joint Account with Emergency Access:** Julia and Karl must both agree for immediate spending, but David can spend alone after 1 day. Perfect for joint accounts where cooperation is preferred but emergency access is needed.',
            examples: '💡 **Real-world examples:** Couple\'s shared savings with emergency contact, business partnership with mediator access, joint investment account with trusted third party override',
            efficiency: '⚡ **Efficiency:** Cooperative path requires both signatures (~137 bytes), David\'s emergency path includes timelock verification (~105 bytes).',
            security: '✅ **Security benefits:** Cooperative path prevents single-party spending, 24-hour delay gives Julia/Karl time to respond to unauthorized David access, balanced control between cooperation and emergency needs.',
            bestFor: '✅ **Best for:** Joint accounts with trusted mediator, cooperative funds with emergency provisions, business partnerships with dispute resolution, any scenario balancing cooperation with emergency access'
        },
        'hodl': {
            title: '📄 HODL Wallet Policy - Long-term Savings with Family Backup',
            conditions: '🔓 Alice: Immediate spending (9x probability weight - optimized for daily use)\n⏰ Bob + Charlie + Eva + Frank: 3-of-4 after 1 year (family consensus for emergency)',
            useCase: '**Long-term Savings with Deterrent:** Alice controls daily spending but faces family oversight for emergency recovery. The 9@ weight optimizes for Alice while the 1-year delay discourages frequent spending and provides substantial family intervention time.',
            examples: '💡 **Real-world examples:** Retirement savings account, long-term investment fund, addiction recovery wallet with family oversight, high-value HODL strategy with family safety net',
            efficiency: '⚡ **Efficiency:** Alice\'s path is highly optimized (~64 bytes) due to 9x weight, family recovery path is larger (~250+ bytes) but designed for rare use.',
            security: '✅ **Security benefits:** Alice maintains control, 1-year delay prevents impulsive family intervention, 3-of-4 consensus prevents single family member compromise, probability weight optimizes for expected usage.',
            bestFor: '✅ **Best for:** Long-term savings, retirement planning, addiction recovery scenarios, high-value HODL strategies, family wealth management, anyone wanting spending deterrents with family backup'
        },
        'timelocked_thresh': {
            title: '📄 Timelocked Multisig Policy - Scheduled Activation',
            conditions: '⏰ Any 2 of: Alice, Bob, Charlie (activated ONLY after January 1, 2026)',
            useCase: '**Scheduled Fund Release:** Funds cannot be spent by anyone until a specific date, then require 2-of-3 consensus. Perfect for vesting schedules, trust fund releases, planned distributions, or any scenario requiring future activation.',
            examples: '💡 **Real-world examples:** Employee vesting schedule, trust fund release to beneficiaries, scheduled charity donations, escrow for future projects, company bonus pool release date',
            efficiency: '⚡ **Efficiency:** All paths require timelock verification plus threshold logic (~200+ bytes), but prevents any spending before activation date.',
            security: '✅ **Security benefits:** Absolute prevention of early spending (even with all signatures), requires majority consensus after activation, immutable schedule prevents coercion or impulsive changes.',
            bestFor: '✅ **Best for:** Vesting schedules, trust funds, scheduled distributions, escrow services, any scenario requiring guaranteed future activation with group control, regulatory compliance requiring time delays'
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
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); white-space: pre-line; font-family: monospace; background: var(--hover-bg); padding: 6px; border-radius: 4px;">${desc.conditions}</div>
            </div>
            <div style="margin-bottom: 8px;">
                <strong style="color: var(--text-color); font-size: 12px;">Use Case & Scenario:</strong>
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); line-height: 1.4;">${desc.useCase}</div>
            </div>
            ${desc.examples ? `<div style="margin-bottom: 8px;">
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); line-height: 1.4;">${desc.examples}</div>
            </div>` : ''}
            ${desc.efficiency ? `<div style="margin-bottom: 8px;">
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); line-height: 1.4;">${desc.efficiency}</div>
            </div>` : ''}
            <div style="margin-bottom: 8px;">
                <strong style="color: var(--text-color); font-size: 12px;">Security Analysis:</strong>
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); line-height: 1.4;">${desc.security}</div>
            </div>
            ${desc.bestFor ? `<div>
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); line-height: 1.4;">${desc.bestFor}</div>
            </div>` : ''}
        `;
        }
        panel.style.display = 'block';
    }
};


// Global function to show miniscript descriptions
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
            title: '⚙️ 1-of-3 Multisig Using or_d',
            structure: 'or_d(pk(Alice),or_d(pk(Bob),pk(Charlie))) → Nested OR with DUP-IF pattern',
            bitcoinScript: 'DUP IF <Alice> CHECKSIG ELSE DUP IF <Bob> CHECKSIG ELSE <Charlie> CHECKSIG ENDIF ENDIF',
            useCase: 'Any of three parties can spend. Why or_d? Because we want the first successful signature to consume the condition, not evaluate all possibilities.',
            technical: '💡 or_d chosen over or_i/or_b because: 1) More efficient for multiple options (early exit), 2) DUP-IF pattern is cheaper than boolean operations for N>2 cases, 3) Left branch "consumes" the condition when satisfied'
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
            title: '⚙️ Taproot Inheritance: Nested or_d for Estate Planning',
            structure: 'and_v(v:pk(David),or_d(pk(Helen),and_v(v:pk(Ivan),older(52560))))',
            bitcoinScript: '<David> CHECKSIGVERIFY DUP IF <Helen> CHECKSIG ELSE <Ivan> CHECKSIGVERIFY 52560 CHECKSEQUENCEVERIFY ENDIF',
            useCase: 'David must approve all spending. Helen can inherit immediately, or Ivan after 1 year. Why this structure? David maintains control while alive, Helen gets priority as primary beneficiary.',
            technical: '💡 Inheritance logic: and_v(v:pk(David),...) ensures David always required. or_d(pk(Helen),...) gives Helen immediate access without timelock evaluation. Ivan\'s path only evaluated if Helen unavailable. 52560 blocks ≈ 1 year provides sufficient time for Helen to claim.'
        },
        'delayed': {
            title: '⚙️ Taproot Immediate OR Delayed: or_d for Cooling Period',
            structure: 'or_d(pk(Julia),and_v(v:pk(Karl),older(144))) → Julia OR (Karl + delay)',
            bitcoinScript: 'DUP IF <Julia> CHECKSIG ELSE <Karl> CHECKSIGVERIFY 144 CHECKSEQUENCEVERIFY ENDIF',
            useCase: 'Julia can spend immediately, Karl must wait 1 day. Why or_d? Julia\'s immediate access shouldn\'t evaluate Karl\'s timelock - pure efficiency.',
            technical: '💡 Cooling period pattern: or_d ensures Julia\'s path is completely independent of timelock logic. When Julia spends, script never touches the 144-block delay or Karl\'s signature verification. Only when Julia doesn\'t spend does Karl\'s delayed path activate.'
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
            useCase: 'Production wallet descriptor with full metadata: master key fingerprint (C8FE8D4F), hardened derivation path (48h/1h/123h/2h), and specific address index (0/0). 💡 Use 🏷️ Hide key names to see the full raw descriptor.',
            technical: '💡 Complete descriptor anatomy: [fingerprint/origin_path]xpub_key/final_path. Fingerprint identifies master key, origin shows derivation from master to xpub, final path derives specific key. Essential for wallet interoperability and backup recovery.'
        },
        'range_descriptor': {
            title: '⚙️ Multipath Range Descriptor (BIP389)',
            structure: 'pk([fingerprint/path]tpub.../<1;0>/*) → Multiple derivation paths in one descriptor',
            bitcoinScript: 'Single descriptor template that expands to multiple derived public keys for different address types',
            useCase: 'Advanced wallet pattern for generating both change (path 1) and receive (path 0) addresses from one descriptor. Why multipath? Eliminates need for separate descriptors. 💡 Use 🏷️ Hide key names to see the full raw descriptor with <1;0>/* syntax.',
            technical: '💡 BIP389 multipath magic: <1;0>/* expands to TWO paths: .../1/* (change addresses) and .../0/* (receive addresses). Single descriptor = dual functionality. Reduces descriptor storage and simplifies wallet architecture. Testnet tpub ensures testnet address generation.'
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
        }
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
    // Check if descriptions are disabled
    if (localStorage.getItem('showDescriptions') === 'false') {
        return;
    }
    
    const panel = document.getElementById('policy-description');
    const contentDiv = panel.querySelector('.description-content');
    
    const descriptions = {
        'single': {
            title: '📄 Single Key Policy NEW',
            conditions: '🔓 Alice: Immediate spending (no restrictions)',
            useCase: 'Personal wallet with single owner. Simple and efficient for individual use.',
            security: '⚠️ Single point of failure - if Alice loses her key, funds are lost'
        },
        'or': {
            title: '📄 OR Keys Policy - Either Party Access',
            conditions: '🔓 Alice: Can spend immediately\n🔓 Bob: Can spend immediately (independent access)',
            useCase: '**Shared Access Wallet:** Either person can spend independently. Common for couples, business partners, or backup access scenarios. Think "joint checking account" where either person can write checks.',
            examples: '💡 **Real-world examples:** Joint family account, business petty cash, emergency fund shared between spouses, backup key for solo traders',
            efficiency: '⚡ **Efficiency:** Slightly larger than single key (~105 bytes witness). Spender chooses which key to use, so no coordination needed.',
            security: '⚠️ **Security trade-offs:** Weakest-link security - compromise of ANY key results in fund loss. However, provides redundancy against key loss (lose one, still have the other).',
            bestFor: '✅ **Best for:** Trusted partnerships, backup access, situations where convenience matters more than maximum security, emergency access scenarios'
        },
        'and': {
            title: '📄 AND Keys Policy - Dual Authorization',
            conditions: '🔓 Alice + Bob: Both signatures required (no unilateral spending)',
            useCase: '**2-of-2 Multisig:** Both parties must agree to every transaction. Perfect for business partnerships, joint investments, or married couples who want shared financial control. Like requiring two signatures on a check.',
            examples: '💡 **Real-world examples:** Business partnership funds, joint investment account, high-value couple\'s savings, parent-child shared control, corporate treasury requiring dual approval',
            efficiency: '⚡ **Efficiency:** ~137 bytes witness data. Requires coordination between parties for every transaction, but maximum security.',
            security: '✅ **Security benefits:** Strongest security - requires compromise of BOTH keys to steal funds. Protects against single key compromise, impulsive spending, and unauthorized transactions.',
            bestFor: '✅ **Best for:** High-value storage, business partnerships, situations requiring mutual consent, protection against single-person compromise or coercion'
        },
        'threshold': {
            title: '📄 2-of-3 Threshold Policy - Majority Consensus',
            conditions: '🔓 Any 2 of: Alice, Bob, Charlie (flexible majority control)',
            useCase: '**Majority Multisig:** Any 2 out of 3 parties can approve transactions. Perfect for small boards, family trusts, or adding redundancy while maintaining control. Like corporate voting where majority wins.',
            examples: '💡 **Real-world examples:** Board of directors treasury, family trust with multiple trustees, business with 3 partners, estate planning with beneficiaries, crypto startup founder funds',
            efficiency: '⚡ **Efficiency:** Variable witness size depending on which 2 keys sign (~170-200 bytes). Good balance of security and usability.',
            security: '✅ **Security benefits:** Survives 1 key loss or compromise. Prevents single-person control while allowing majority decisions. More resilient than 2-of-2 but less than single key.',
            bestFor: '✅ **Best for:** Small group control, estate planning, business partnerships with 3+ people, backup scenarios where 1 key might be lost, decision-making that benefits from consensus'
        },
        'timelock': {
            title: '📄 Timelock Policy - Immediate vs Delayed Access',
            conditions: '🔓 Alice: Immediate spending (instant access)\n⏰ Bob: After 144 blocks (~1 day) delay',
            useCase: '**Emergency Recovery with Cooling Period:** Alice has daily control, Bob can recover funds but must wait. Prevents rushed decisions and provides time for Alice to intervene if needed. Like a bank account with both owner access and emergency power of attorney.',
            examples: '💡 **Real-world examples:** Personal wallet with family backup, business owner with partner recovery, elderly parent with adult child backup, trader with emergency contact access',
            efficiency: '⚡ **Efficiency:** Alice\'s path is efficient (~73 bytes), Bob\'s path is larger (~105 bytes) due to timelock verification.',
            security: '✅ **Security benefits:** Alice retains full control while providing recovery option. 24-hour delay gives Alice time to move funds if Bob\'s key is compromised. Prevents immediate theft through Bob\'s key.',
            bestFor: '✅ **Best for:** Personal wallets needing backup, elderly users with trusted family, business continuity planning, any scenario where primary user wants emergency recovery with built-in warning time'
        },
        'xonly': {
            title: '📄 Taproot X-only Key - Next-Gen Single Key',
            conditions: '🔓 David: Immediate spending (Taproot/Schnorr context)',
            useCase: '**Modern Single Key:** Uses Taproot\'s X-only public keys (32 bytes vs 33 bytes) with Schnorr signatures. More efficient, more private, and enables advanced scripting. The future of single-key Bitcoin wallets.',
            examples: '💡 **Real-world examples:** Modern hardware wallets, Lightning Network wallets, privacy-focused personal wallets, wallets that might later upgrade to complex scripts',
            efficiency: '⚡ **Efficiency:** Smaller keys (32 vs 33 bytes), smaller signatures (~64 vs 71 bytes), better batch verification, and identical on-chain appearance regardless of underlying complexity.',
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
            efficiency: '⚡ **Efficiency:** Board path uses threshold efficiency (~170-200 bytes), CEO path adds timelock verification (~105 bytes).',
            security: '✅ **Security benefits:** Board control prevents single-person decisions, time-delayed CEO access provides emergency recovery without immediate risk, specific date prevents indefinite executive power.',
            bestFor: '✅ **Best for:** Corporate treasuries, nonprofits, family businesses, any organization needing board control with executive emergency access, succession planning'
        },
        'recovery': {
            title: '📄 Emergency Recovery Policy - Weighted Priority',
            conditions: '🔓 Alice: Immediate spending (95% probability weight - primary path)\n⏰ Bob + Charlie + Eva: 2-of-3 after 1008 blocks (~1 week) emergency consensus',
            useCase: '**Personal Wallet with Family Recovery:** Alice controls daily spending, but family/friends can recover funds if Alice is unavailable for a week. The 95@ weight tells the compiler to optimize for Alice\'s path since it\'s used 95% of the time.',
            examples: '💡 **Real-world examples:** Individual with trusted family backup, solo business owner with partner emergency access, crypto enthusiast with friend/family recovery network, elderly user with adult children backup',
            efficiency: '⚡ **Efficiency:** Alice\'s path is highly optimized due to probability weight. Recovery path is larger (~200+ bytes) but rarely used.',
            security: '✅ **Security benefits:** Alice retains full control, 1-week delay gives Alice time to respond to unauthorized recovery attempts, requires 2-of-3 consensus prevents single family member compromise.',
            bestFor: '✅ **Best for:** Individual wallets with trusted emergency contacts, estate planning, any scenario where primary user wants family backup without compromising daily control'
        },
        'twofa': {
            title: '📄 2FA + Backup Policy - Multi-Factor Security',
            conditions: '🔓 Alice + (Bob + secret OR wait 1 year)',
            useCase: '**Two-Factor Authentication Wallet:** Alice must always sign, plus either Bob (second device/key) with a secret hash, or Alice alone after waiting 1 year. Like 2FA on your crypto wallet - primary key plus second factor, with long-term recovery.',
            examples: '💡 **Real-world examples:** High-security personal wallet, crypto trader with hardware + mobile 2FA, business owner with primary + backup key + secret, paranoid holder with multiple security layers',
            efficiency: '⚡ **Efficiency:** Alice+Bob path is moderate (~137 bytes), Alice+secret path adds hash verification (~170 bytes), Alice-alone path after 1 year includes timelock (~105 bytes).',
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
        'delayed': {
            title: '📄 Taproot 2-of-2 OR Delayed - Cooperative + Emergency',
            conditions: '🔓 Julia + Karl: Immediate 2-of-2 spending (cooperative path)\n⏰ David: After 144 blocks (~1 day) single-party emergency',
            useCase: '**Joint Account with Emergency Access:** Julia and Karl must both agree for immediate spending, but David can spend alone after 1 day. Perfect for joint accounts where cooperation is preferred but emergency access is needed.',
            examples: '💡 **Real-world examples:** Couple\'s shared savings with emergency contact, business partnership with mediator access, joint investment account with trusted third party override',
            efficiency: '⚡ **Efficiency:** Cooperative path requires both signatures (~137 bytes), David\'s emergency path includes timelock verification (~105 bytes).',
            security: '✅ **Security benefits:** Cooperative path prevents single-party spending, 24-hour delay gives Julia/Karl time to respond to unauthorized David access, balanced control between cooperation and emergency needs.',
            bestFor: '✅ **Best for:** Joint accounts with trusted mediator, cooperative funds with emergency provisions, business partnerships with dispute resolution, any scenario balancing cooperation with emergency access'
        },
        'hodl': {
            title: '📄 HODL Wallet Policy - Long-term Savings with Family Backup',
            conditions: '🔓 Alice: Immediate spending (9x probability weight - optimized for daily use)\n⏰ Bob + Charlie + Eva + Frank: 3-of-4 after 1 year (family consensus for emergency)',
            useCase: '**Long-term Savings with Deterrent:** Alice controls daily spending but faces family oversight for emergency recovery. The 9@ weight optimizes for Alice while the 1-year delay discourages frequent spending and provides substantial family intervention time.',
            examples: '💡 **Real-world examples:** Retirement savings account, long-term investment fund, addiction recovery wallet with family oversight, high-value HODL strategy with family safety net',
            efficiency: '⚡ **Efficiency:** Alice\'s path is highly optimized (~64 bytes) due to 9x weight, family recovery path is larger (~250+ bytes) but designed for rare use.',
            security: '✅ **Security benefits:** Alice maintains control, 1-year delay prevents impulsive family intervention, 3-of-4 consensus prevents single family member compromise, probability weight optimizes for expected usage.',
            bestFor: '✅ **Best for:** Long-term savings, retirement planning, addiction recovery scenarios, high-value HODL strategies, family wealth management, anyone wanting spending deterrents with family backup'
        },
        'timelocked_thresh': {
            title: '📄 Timelocked Multisig Policy - Scheduled Activation',
            conditions: '⏰ Any 2 of: Alice, Bob, Charlie (activated ONLY after January 1, 2026)',
            useCase: '**Scheduled Fund Release:** Funds cannot be spent by anyone until a specific date, then require 2-of-3 consensus. Perfect for vesting schedules, trust fund releases, planned distributions, or any scenario requiring future activation.',
            examples: '💡 **Real-world examples:** Employee vesting schedule, trust fund release to beneficiaries, scheduled charity donations, escrow for future projects, company bonus pool release date',
            efficiency: '⚡ **Efficiency:** All paths require timelock verification plus threshold logic (~200+ bytes), but prevents any spending before activation date.',
            security: '✅ **Security benefits:** Absolute prevention of early spending (even with all signatures), requires majority consensus after activation, immutable schedule prevents coercion or impulsive changes.',
            bestFor: '✅ **Best for:** Vesting schedules, trust funds, scheduled distributions, escrow services, any scenario requiring guaranteed future activation with group control, regulatory compliance requiring time delays'
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
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); white-space: pre-line; font-family: monospace; background: var(--hover-bg); padding: 6px; border-radius: 4px;">${desc.conditions}</div>
            </div>
            <div style="margin-bottom: 8px;">
                <strong style="color: var(--text-color); font-size: 12px;">Use Case & Scenario:</strong>
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); line-height: 1.4;">${desc.useCase}</div>
            </div>
            ${desc.examples ? `<div style="margin-bottom: 8px;">
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); line-height: 1.4;">${desc.examples}</div>
            </div>` : ''}
            ${desc.efficiency ? `<div style="margin-bottom: 8px;">
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); line-height: 1.4;">${desc.efficiency}</div>
            </div>` : ''}
            <div style="margin-bottom: 8px;">
                <strong style="color: var(--text-color); font-size: 12px;">Security Analysis:</strong>
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); line-height: 1.4;">${desc.security}</div>
            </div>
            ${desc.bestFor ? `<div>
                <div style="margin-top: 3px; font-size: 11px; color: var(--secondary-text); line-height: 1.4;">${desc.bestFor}</div>
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
            title: '⚙️ 1-of-3 Multisig Using or_d',
            structure: 'or_d(pk(Alice),or_d(pk(Bob),pk(Charlie))) → Nested OR with DUP-IF pattern',
            bitcoinScript: 'DUP IF <Alice> CHECKSIG ELSE DUP IF <Bob> CHECKSIG ELSE <Charlie> CHECKSIG ENDIF ENDIF',
            useCase: 'Any of three parties can spend. Why or_d? Because we want the first successful signature to consume the condition, not evaluate all possibilities.',
            technical: '💡 or_d chosen over or_i/or_b because: 1) More efficient for multiple options (early exit), 2) DUP-IF pattern is cheaper than boolean operations for N>2 cases, 3) Left branch "consumes" the condition when satisfied'
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
            title: '⚙️ Taproot Inheritance: Nested or_d for Estate Planning',
            structure: 'and_v(v:pk(David),or_d(pk(Helen),and_v(v:pk(Ivan),older(52560))))',
            bitcoinScript: '<David> CHECKSIGVERIFY DUP IF <Helen> CHECKSIG ELSE <Ivan> CHECKSIGVERIFY 52560 CHECKSEQUENCEVERIFY ENDIF',
            useCase: 'David must approve all spending. Helen can inherit immediately, or Ivan after 1 year. Why this structure? David maintains control while alive, Helen gets priority as primary beneficiary.',
            technical: '💡 Inheritance logic: and_v(v:pk(David),...) ensures David always required. or_d(pk(Helen),...) gives Helen immediate access without timelock evaluation. Ivan\'s path only evaluated if Helen unavailable. 52560 blocks ≈ 1 year provides sufficient time for Helen to claim.'
        },
        'delayed': {
            title: '⚙️ Taproot Immediate OR Delayed: or_d for Cooling Period',
            structure: 'or_d(pk(Julia),and_v(v:pk(Karl),older(144))) → Julia OR (Karl + delay)',
            bitcoinScript: 'DUP IF <Julia> CHECKSIG ELSE <Karl> CHECKSIGVERIFY 144 CHECKSEQUENCEVERIFY ENDIF',
            useCase: 'Julia can spend immediately, Karl must wait 1 day. Why or_d? Julia\'s immediate access shouldn\'t evaluate Karl\'s timelock - pure efficiency.',
            technical: '💡 Cooling period pattern: or_d ensures Julia\'s path is completely independent of timelock logic. When Julia spends, script never touches the 144-block delay or Karl\'s signature verification. Only when Julia doesn\'t spend does Karl\'s delayed path activate.'
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
            useCase: 'Production wallet descriptor with full metadata: master key fingerprint (C8FE8D4F), hardened derivation path (48h/1h/123h/2h), and specific address index (0/0). 💡 Use 🏷️ Hide key names to see the full raw descriptor.',
            technical: '💡 Complete descriptor anatomy: [fingerprint/origin_path]xpub_key/final_path. Fingerprint identifies master key, origin shows derivation from master to xpub, final path derives specific key. Essential for wallet interoperability and backup recovery.'
        },
        'range_descriptor': {
            title: '⚙️ Multipath Range Descriptor (BIP389)',
            structure: 'pk([fingerprint/path]tpub.../<1;0>/*) → Multiple derivation paths in one descriptor',
            bitcoinScript: 'Single descriptor template that expands to multiple derived public keys for different address types',
            useCase: 'Advanced wallet pattern for generating both change (path 1) and receive (path 0) addresses from one descriptor. Why multipath? Eliminates need for separate descriptors. 💡 Use 🏷️ Hide key names to see the full raw descriptor with <1;0>/* syntax.',
            technical: '💡 BIP389 multipath magic: <1;0>/* expands to TWO paths: .../1/* (change addresses) and .../0/* (receive addresses). Single descriptor = dual functionality. Reduces descriptor storage and simplifies wallet architecture. Testnet tpub ensures testnet address generation.'
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
        // JSON format - includes all state
        const state = {
            policy: policy,
            keys: getKeyVariables() // Get current key variables
        };
        const jsonString = JSON.stringify(state);
        const encoded = btoa(jsonString); // Base64 encode
        shareUrl = `${window.location.origin}${window.location.pathname}#state=${encoded}`;
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
        // JSON format - includes all state
        const state = {
            miniscript: miniscript,
            keys: getKeyVariables() // Get current key variables
        };
        const jsonString = JSON.stringify(state);
        const encoded = btoa(jsonString); // Base64 encode
        shareUrl = `${window.location.origin}${window.location.pathname}#state=${encoded}`;
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
    if (!miniscriptMessages || !miniscriptMessages.innerHTML.includes('✅ Success')) {
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
                    if (window.loadPolicyExample) window.loadPolicyExample('pk(David)', 'xonly');
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
                    if (window.loadExample) window.loadExample('and_v(v:pk(David),or_d(pk(Helen),and_v(v:pk(Ivan),older(52560))))', 'inheritance');
                },
                'miniscript-delayed': () => {
                    if (window.showMiniscriptDescription) window.showMiniscriptDescription('delayed');
                    if (window.loadExample) window.loadExample('or_d(pk(Julia),and_v(v:pk(Karl),older(144)))', 'delayed');
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
                }
            };
            
            const loadExample = exampleMap[exampleParam];
            if (loadExample) {
                setTimeout(() => {
                    loadExample();
                    console.log('Example loaded:', exampleParam);
                }, 100); // Small delay to ensure functions are available
            } else {
                console.warn('Unknown example:', exampleParam);
            }
            
        } else if (sharedPolicy) {
            // Load policy from URL
            const policyInput = document.getElementById('policy-input');
            if (policyInput) {
                policyInput.textContent = decodeURIComponent(sharedPolicy);
                console.log('Loaded shared policy:', sharedPolicy);
                
                // Apply syntax highlighting after setting content
                if (window.compiler && window.compiler.highlightPolicySyntax) {
                    window.compiler.highlightPolicySyntax();
                }
                
                // Set button state based on content AFTER initialization
                setTimeout(() => {
                    const policyToggleBtn = document.getElementById('policy-key-names-toggle');
                    if (policyToggleBtn && window.compiler && window.compiler.containsKeyNames) {
                        const decodedPolicy = decodeURIComponent(sharedPolicy);
                        const containsKeyNames = window.compiler.containsKeyNames(decodedPolicy);
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
                
                // Auto-compile if setting is enabled
                const autoCompile = document.getElementById('auto-compile-setting');
                if (autoCompile && autoCompile.checked) {
                    setTimeout(() => {
                        const compileBtn = document.getElementById('compile-policy-btn');
                        if (compileBtn) compileBtn.click();
                    }, 500);
                }
            }
        } else if (sharedMiniscript) {
            // Load miniscript from URL
            const expressionInput = document.getElementById('expression-input');
            if (expressionInput) {
                expressionInput.textContent = decodeURIComponent(sharedMiniscript);
                console.log('Loaded shared miniscript:', sharedMiniscript);
                
                // Apply syntax highlighting after setting content
                if (window.compiler && window.compiler.highlightMiniscriptSyntax) {
                    window.compiler.highlightMiniscriptSyntax();
                }
                
                // Set button state based on content AFTER initialization
                setTimeout(() => {
                    const toggleBtn = document.getElementById('key-names-toggle');
                    if (toggleBtn && window.compiler && window.compiler.containsKeyNames) {
                        const decodedMiniscript = decodeURIComponent(sharedMiniscript);
                        const containsKeyNames = window.compiler.containsKeyNames(decodedMiniscript);
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
                
                // Auto-compile if setting is enabled
                const autoCompile = document.getElementById('auto-compile-setting');
                if (autoCompile && autoCompile.checked) {
                    setTimeout(() => {
                        const compileBtn = document.getElementById('compile-btn');
                        if (compileBtn) compileBtn.click();
                    }, 500);
                }
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

// Taproot Mode Switching from Miniscript
window.switchTaprootModeFromMiniscript = function(mode) {
    console.log(`Switching to taproot mode from miniscript: ${mode}`);
    
    // Update radio button states
    const radioButtons = document.querySelectorAll('input[name="taproot-miniscript-mode"]');
    radioButtons.forEach(radio => {
        if (radio.value === mode) {
            radio.checked = true;
        }
    });
    
    // Store the selected mode globally
    window.currentTaprootMode = mode;
    
    // Re-compile the current miniscript with the new mode
    if (window.compiler) {
        window.compiler.compileExpression();
    }
};

// Taproot Mode Switching from Policy
window.switchTaprootMode = function(mode) {
    console.log(`Switching to taproot mode: ${mode}`);
    
    // Update radio button states (they handle themselves, but ensure consistency)
    const radioButtons = document.querySelectorAll('input[name="taproot-mode"]');
    radioButtons.forEach(radio => {
        if (radio.value === mode) {
            radio.checked = true;
        }
    });
    
    // Store the selected mode globally
    window.currentTaprootMode = mode;
    
    // Re-compile the current policy with the new mode
    const policyInput = document.getElementById('policy-input');
    if (policyInput && policyInput.textContent && policyInput.textContent.trim()) {
        // Need to add flag to Rust compilation
        console.log(`Re-compiling policy with ${mode} mode`);
        window.compiler.compilePolicy();
    } else {
        console.log('No policy to re-compile or policy input is empty');
    }
};

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
});