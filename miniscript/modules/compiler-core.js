import init, { compile_unified, lift_to_miniscript, generate_address_for_network, get_taproot_branches, get_taproot_miniscript_branches, get_taproot_branch_weights, get_wasm_build_info, analyze_policy, analyze_miniscript } from '../pkg/miniscript_wasm.js';
import { CONSTANTS } from './constants.js';

/**
 * MiniscriptCompiler - Core compiler for Bitcoin Miniscript
 *
 * @class MiniscriptCompiler
 * @description Main compiler class handling policy to miniscript compilation,
 * miniscript to Bitcoin script conversion, key management, and UI interactions
 *
 * @version 1.2.0
 * @since 2025-01-18
 */
export class MiniscriptCompiler {
    /**
     * Initialize a new MiniscriptCompiler instance
     * Sets up default variables, undo/redo stacks, and key pools
     */
    constructor() {
        this.wasm = null;
        this.keyVariables = new Map();
        this.DEFAULT_VARIABLES_VERSION = '1.2.0'; // Increment when adding new variables
        
        // Single shared map of default variables
        this.defaultVariables = new Map();
        this.initializeDefaultVariables();
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
        this.policyLifted = false; // Flag to track if current policy was lifted from miniscript
        this.init();
    }

    /**
     * Initialize the WASM module and set up event listeners
     * @async
     * @returns {Promise<void>}
     * @throws {Error} If WASM module fails to initialize
     */
    async init() {
        try {
            this.wasm = await init();
            console.log('WASM module initialized');

            // Print WASM build info on page load
            try {
                const buildInfo = get_wasm_build_info();
                console.log('=== WASM BUILD INFO ===');
                console.log('Version:', buildInfo.version);
                console.log('Has descriptor support:', buildInfo.has_descriptor_support);
                console.log('Has x-only conversion:', buildInfo.has_xonly_conversion);
                console.log('Build ID:', buildInfo.build_id);
                console.log('=======================');
            } catch (e) {
                console.error('Error calling get_wasm_build_info:', e);
                console.error('Error message:', e.message);
                console.error('Error stack:', e.stack);
            }

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
            }, CONSTANTS.INIT_DELAY_MS);
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

        // Policy info button
        document.getElementById('policy-info-btn').addEventListener('click', () => {
            this.showPolicyInfo();
        });

        // Compile button
        document.getElementById('compile-btn').addEventListener('click', () => {
            this.compileExpression();
        });

        // Save policy button  
        document.getElementById('save-policy-btn').addEventListener('click', () => {
            this.showSavePolicyModal();
        });

        // Load policy button
        document.getElementById('load-policy-btn').addEventListener('click', () => {
            this.showSavedPoliciesModal();
        });

        // Save button
        document.getElementById('save-btn').addEventListener('click', () => {
            this.showSaveModal();
        });

        // Load miniscript button
        document.getElementById('load-btn').addEventListener('click', () => {
            this.showSavedMiniscriptsModal();
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
            // Clear policyLifted flag when user edits the policy
            this.policyLifted = false;

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
            }, CONSTANTS.HIGHLIGHT_DELAY_MS); // Delay highlighting
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
            }, CONSTANTS.HIGHLIGHT_DELAY_MS); // Delay highlighting
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

    /**
     * Compile a miniscript expression to Bitcoin script
     * Handles both legacy/segwit and taproot contexts
     * @returns {void}
     */
    compileExpression() {
        // Prevent concurrent compilations
        if (this.isCompiling) {
            console.log('Compilation already in progress, skipping duplicate call');
            return;
        }
        this.isCompiling = true;
        
        const expression = document.getElementById('expression-input').textContent.trim();
        const context = document.querySelector('input[name="context"]:checked').value;
        console.log(`DEBUG MINISCRIPT: Read context="${context}" from radio button`);

        // Store original expression for network switching
        this.originalExpression = expression;
        
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
            
            // Call the WASM function with unified options
            let result;
            const numsKey = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';

            if (context === 'taproot' || context === 'taproot-multi' || context === 'taproot-keypath') {
                // Determine mode based on context
                const currentMode = context === 'taproot-keypath' ? 'multi-leaf' : context === 'taproot-multi' ? 'script-path' : 'single-leaf';
                window.currentTaprootMode = currentMode; // Update the global mode
                console.log(`Compiling miniscript in taproot context, mode: ${currentMode}`);

                // Check debug mode
                const debugMode = document.getElementById('miniscript-debug-mode')?.checked || false;

                // Use unified compile with options
                const options = {
                    input_type: "Miniscript",
                    context: "Taproot",
                    mode: currentMode, // Use the mode string directly: 'multi-leaf', 'script-path', or 'single-leaf'
                    network_str: "bitcoin",
                    nums_key: numsKey,
                    verbose_debug: debugMode
                };
                console.log(`DEBUG FRONTEND: context=${context}, currentMode=${currentMode}, sending mode=${options.mode}`);
                result = compile_unified(processedExpression, options);
                if (result.success) {
                    result.taprootMode = currentMode;
                    result.context = context; // Store the original context
                }
            } else {
                // Non-taproot contexts: use unified compile
                const contextStr = context === 'legacy' ? "Legacy" : "Segwit";
                const debugMode = document.getElementById('miniscript-debug-mode')?.checked || false;

                const options = {
                    input_type: "Miniscript",
                    context: contextStr,
                    mode: "Default",
                    network_str: "bitcoin",
                    nums_key: numsKey,
                    verbose_debug: debugMode
                };
                result = compile_unified(processedExpression, options);
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
                    // For all contexts, don't show script size (not meaningful for display)
                    const currentMode = window.currentTaprootMode || 'single-leaf';
                    const isTaprootContext = result.miniscript_type === 'Taproot';

                    // Show miniscript expression for all contexts
                    const showKeyNames = document.getElementById('key-names-toggle')?.dataset.active === 'true';
                    let displayExpression = expression;
                    if (showKeyNames && this.keyVariables && this.keyVariables.size > 0) {
                        displayExpression = this.replaceKeysWithNames(expression);
                    }
                    successMsg = `Miniscript expression:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${displayExpression}</span>`;
                    
                    if (isTaprootContext && result.compiled_miniscript) {
                        // Show descriptor for all Taproot contexts
                        let rawDescriptor = result.compiled_miniscript;
                        
                        // Clean the descriptor by removing |LEAF_ASM: suffix if present
                        if (rawDescriptor.includes('|LEAF_ASM:')) {
                            rawDescriptor = rawDescriptor.split('|LEAF_ASM:')[0];
                        }
                        
                        let displayDescriptor = rawDescriptor;
                        const showKeyNames = document.getElementById('key-names-toggle')?.dataset.active === 'true';
                        if (showKeyNames && this.keyVariables && this.keyVariables.size > 0) {
                            displayDescriptor = this.replaceKeysWithNames(rawDescriptor);
                        }
                        
                        // Special handling for Single leaf / Key mode
                        if (currentMode === 'single-leaf') {
                            // Check if the miniscript is exactly pk(KEY)
                            const isPureKey = /^pk\([^)]+\)$/.test(expression.trim());

                            if (isPureKey) {
                                // Simple pk(KEY) - optimized to key-only Taproot
                                // Extract key and checksum from tr(NUMS,pk(KEY))#checksum to tr(KEY)#checksum
                                const keyOnlyDescriptor = displayDescriptor.replace(/^tr\([^,]+,pk\(([^)]+)\)\)(#[a-z0-9]+)?$/, 'tr($1)$2');
                                successMsg += `<br>Taproot descriptor:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${keyOnlyDescriptor}</span><br>`;
                                successMsg += `Optimized to key-only Taproot. Most efficient spend (66 WU, no script revealed).<br><br>`;
                            } else {
                                // More complex miniscript - single script leaf
                                successMsg += `<br>Taproot descriptor:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${displayDescriptor}</span><br>`;
                            }
                        } else {
                            // Other Taproot modes
                            successMsg += `<br>Taproot descriptor:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${displayDescriptor}</span><br>`;
                        }
                        
                        // Add Data field for all Taproot contexts
                        if (result.script) {
                            // Remove OP_1 (51) + push32 (20) prefix to show just the tweaked key
                            const tweakedKey = result.script.substring(4);
                            successMsg += `Data (tweaked public key):<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${tweakedKey}</span><br>`;
                        }
                    } else if (result.max_weight_to_satisfy && result.max_satisfaction_size) {
                        // Different calculation for Legacy vs Segwit contexts
                        if (context === 'legacy') {
                            // Helper functions for precise calculation
                            const cs = (n) => n < 253 ? 1 : (n <= 0xffff ? 3 : (n <= 0xffffffff ? 5 : 9));
                            const pushOv = (n) => n <= 75 ? 1 : (n <= 255 ? 2 : (n <= 65535 ? 3 : 5));
                            
                            // P2SH satisfaction cost calculation
                            const scriptSize = result.script_size;               // e.g. 25 bytes for pkh(Alice)
                            const sigLen = 73;                                   // worst-case DER + hashtype (71-73 typical)
                            const pubkeyLen = 33;                                 // compressed pubkey

                            // P2SH scriptSig content: signatures + pubkeys + redeemScript + push-ops
                            // For pkh: sig(73) + pubkey(33) + redeemScript(25) + pushops(3) = 134 bytes
                            const witnessSize = sigLen + pubkeyLen;              // signatures + pubkeys
                            const content = pushOv(sigLen) + sigLen + pushOv(pubkeyLen) + pubkeyLen + pushOv(scriptSize) + scriptSize;
                            const p2shSatisfactionWU = 4 * (cs(content) + content);
                            
                            // For display: also show the overhead
                            const overheadBytes = 36 + 4;                        // outpoint (36) + nSequence (4) = 40
                            const overheadWU = overheadBytes * 4;                // 40 * 4 = 160 WU
                            const totalWU = p2shSatisfactionWU + overheadWU;
                            
                            successMsg += `<br>Spending cost analysis (P2SH):<br>`;
                            successMsg += `Satisfaction cost (scriptSig content): ${p2shSatisfactionWU} WU<br>`;
                            successMsg += `Input overhead (outpoint + nSequence): ${overheadWU} WU<br>`;
                            successMsg += `Per-input total: ${totalWU} WU<br><br>`;
                        } else if (context === 'segwit') {
                            // For Segwit v0 (P2WSH)
                            const scriptBytes = result.script_size;              // e.g. 77 (script size in bytes)
                            const maxSat = result.max_satisfaction_size;         // e.g. 152 (full witness bytes including script)

                            // Signature weight includes ECDSA signature + sighash byte
                            const sigWeight = maxSat - (1 + scriptBytes);        // 152 - (1 + 77) = 74
                            const scriptWeight = scriptBytes + 1;                // 77 + 1 = 78 (script + length byte)
                            const satisfactionTotal = sigWeight + scriptWeight;  // 74 + 78 = 152
                            const inputOverhead = 160;                           // outpoint (36) + nSequence (4) = 40 bytes × 4
                            const perInputTotal = satisfactionTotal + inputOverhead; // 152 + 160 = 312

                            successMsg += `<br>Spending cost analysis:<br>`;
                            successMsg += `Signature (ECDSA + sighash): ${sigWeight} WU<br>`;
                            successMsg += `Script (witnessScript): ${scriptWeight} WU (${scriptBytes} B script + 1 B length)<br>`;
                            successMsg += `Satisfaction (witness): ${satisfactionTotal} WU<br>`;
                            successMsg += `Input overhead (non-witness: outpoint + nSequence): ${inputOverhead} WU<br>`;
                            successMsg += `Per-input total: ${perInputTotal} WU<br><br>`;
                        } else {
                            // For other contexts (taproot_single_leaf, etc.) - keep the simpler format
                            const scriptWeight = result.script_size;            // e.g. 35
                            const maxSat = result.max_satisfaction_size;        // e.g. 109 (full witness bytes)
                            
                            const inputWeight = maxSat - (1 + scriptWeight);    // 109 - (1 + 35) = 73
                            const totalWeight = scriptWeight + inputWeight;     // 35 + 73 = 108
                            
                            successMsg += `<br>Spending cost analysis:<br>`;
                            successMsg += `Script: ${scriptWeight} WU<br>`;
                            successMsg += `Input: ${inputWeight}.000000 WU<br>`;
                            successMsg += `Total: ${totalWeight}.000000 WU<br><br>`;
                        }
                    } else if (result.max_satisfaction_size) {
                        // Fallback - show satisfaction size
                        successMsg += `<br>Spending cost analysis:<br>`;
                        successMsg += `Input: ${result.max_satisfaction_size}.000000 WU<br>`;
                        successMsg += `Total: ${result.script_size + result.max_satisfaction_size}.000000 WU<br><br>`;
                    } else {
                        // No weight details available, add extra line break
                        successMsg += `<br>`;
                    }
                    
                    // Add hex, asm, and address
                    if (result.script) {
                        if (isTaprootContext) {
                            // For Taproot contexts, show complete scriptPubKey as-is
                            successMsg += `HEX:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${result.script}</span><br>`;
                        } else {
                            // For non-Taproot contexts, show original script in HEX
                            successMsg += `HEX:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${result.script}</span><br>`;
                        }
                    }
                    if (result.script_asm) {
                        // Create simplified version with key names (same as script field)
                        const simplifiedAsm = this.simplifyAsm(result.script_asm);
                        let finalAsm = simplifiedAsm;
                        // Only replace keys with names if toggle is active
                        const showKeyNames = document.getElementById('key-names-toggle')?.dataset.active === 'true';
                        if (showKeyNames && this.keyVariables.size > 0) {
                            finalAsm = this.replaceKeysWithNames(simplifiedAsm);
                        }
                        
                        if (isTaprootContext) {
                            // Check if this is a pure key case (pk(KEY))
                            const isPureKey = /^pk\([^)]+\)$/.test(expression.trim());

                            if (!isPureKey) {
                                // For complex scripts, show both leaf and scriptPubKey ASM
                                // Parse leaf ASM from compiled_miniscript if available
                                let leafAsm = '';
                                if (result.compiled_miniscript && result.compiled_miniscript.includes('|LEAF_ASM:')) {
                                    const parts = result.compiled_miniscript.split('|LEAF_ASM:');
                                    if (parts.length > 1) {
                                        leafAsm = parts[1];
                                        // Replace keys with names in leaf ASM if toggle is active
                                        if (showKeyNames && this.keyVariables.size > 0) {
                                            leafAsm = this.replaceKeysWithNames(leafAsm);
                                        }
                                    }
                                }

                                if (leafAsm) {
                                    successMsg += `ASM (leaf):<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${leafAsm}</span><br>`;
                                }
                            }

                            successMsg += `ASM (scriptPubKey):<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${finalAsm}</span><br>`;
                        } else {
                            // For other contexts, show normal ASM
                            successMsg += `ASM:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${finalAsm}</span><br>`;
                        }
                    }
                    if (result.address) {
                        successMsg += `Address:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${result.address}</span>`;
                        
                    }
                }
                
                // Skip problematic metrics for now - they show false warnings
                // TODO: Fix sanity_check and is_non_malleable implementation
                
                // Pass the original expression for tree visualization
                let treeExpression = expression;
                
                // For taproot contexts, also store the descriptor for branch extraction
                if (result.miniscript_type === 'Taproot' && result.compiled_miniscript) {
                    window.lastCompiledDescriptor = result.compiled_miniscript;
                    window.lastCompiledResult = result;  // Store the full result for later use
                }
                
                this.showMiniscriptSuccess(successMsg, treeExpression);
                // Display results (without the info box since we show it in the success message)
                console.log('🚀 About to call displayResults with result:', result);
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
        const context = document.querySelector('input[name="policy-context"]:checked').value;
        
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
            
            // Call the WASM function with unified options
            let result;
            if (context === 'taproot' || context === 'taproot-multi' || context === 'taproot-keypath') {
                // Determine mode based on context
                const mode = context === 'taproot-keypath' ? 'multi-leaf' : context === 'taproot-multi' ? 'script-path' : 'single-leaf';
                window.currentTaprootMode = mode; // Update the global mode
                console.log('Compiling policy with mode:', mode);

                // Check debug mode
                const debugMode = document.getElementById('policy-debug-mode')?.checked || false;

                // Use unified compile with options
                const options = {
                    input_type: "Policy",
                    context: "Taproot",
                    mode: mode, // Use the mode string directly: 'multi-leaf', 'script-path', or 'single-leaf'
                    network_str: "bitcoin",
                    nums_key: null,
                    verbose_debug: debugMode
                };
                result = compile_unified(processedPolicy, options);
            } else {
                // Non-taproot contexts: use unified compile
                const contextStr = context === 'legacy' ? "Legacy" : "Segwit";
                const debugMode = document.getElementById('policy-debug-mode')?.checked || false;

                const options = {
                    input_type: "Policy",
                    context: contextStr,
                    mode: "Default",
                    network_str: "bitcoin",
                    nums_key: null,
                    verbose_debug: debugMode
                };
                result = compile_unified(processedPolicy, options);
            }
            
            // Reset button
            compilePolicyBtn.textContent = originalText;
            compilePolicyBtn.disabled = false;

            if (result.success && result.compiled_miniscript) {
                // Success: fill the miniscript field and show results
                const expressionInput = document.getElementById('expression-input');
                const formatButton = document.getElementById('format-miniscript-btn');
                
                // Store the last compiled descriptor for branch parsing
                this.lastCompiledDescriptor = result.compiled_miniscript;
                
                // Replace keys with names in the compiled miniscript if toggle is active
                // Check POLICY toggle for policy compilation
                let displayMiniscript = result.compiled_miniscript;
                const policyToggle = document.getElementById('policy-key-names-toggle');
                const showKeyNames = policyToggle?.dataset.active !== 'false'; // Default to true if not set
                
                if (showKeyNames && this.keyVariables && this.keyVariables.size > 0) {
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
                
                // Check if result is in JSON-like policy format with curly braces like {pk(Helen),pk(Uma)}
                // If so, don't load it into the miniscript editor and clear everything
                const isPolicyResult = editorMiniscript && editorMiniscript.match(/^\s*\{.*\}\s*$/);
                
                if (!isPolicyResult) {
                    expressionInput.textContent = editorMiniscript;

                    // Hide the miniscript description panel when loading compiled miniscript
                    const miniscriptDescPanel = document.getElementById('miniscript-description');
                    if (miniscriptDescPanel) {
                        miniscriptDescPanel.style.display = 'none';
                    }
                } else {
                    console.log('Policy compilation returned multiple miniscripts, clearing miniscript editor:', editorMiniscript);
                    // Clear the miniscript editor
                    expressionInput.textContent = '';

                    // Clear hex and ASM fields
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
                    
                    // Clear the address field
                    const addressField = document.getElementById('address');
                    if (addressField) {
                        addressField.textContent = '';
                    }
                    
                    // Clear taproot descriptor if visible
                    const taprootDescriptor = document.getElementById('taproot-descriptor');
                    if (taprootDescriptor) {
                        taprootDescriptor.style.display = 'none';
                    }
                    
                    // Clear miniscript success/error messages
                    this.clearMiniscriptMessages();
                }
                
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
                
                // Show policy success message with context (normalize taproot-multi to taproot)
                const normalizedContext = (context === 'taproot-multi' || context === 'taproot-keypath') ? 'taproot' : context;
                this.showPolicySuccess(displayMiniscript, result, normalizedContext);
                
                // Check if this is a descriptor validation from policy compilation
                const isDescriptorValidation = result.miniscript_type === 'Descriptor';
                
                let successMsg = '';
                if (isDescriptorValidation && result.script && result.script.startsWith('Valid descriptor:')) {
                    // For descriptor validation from policy, build the message using compiled miniscript from editor
                    successMsg = `Valid descriptor: wsh(${displayMiniscript})`;
                    // Fix the script field for results display - should show "No single script..." not validation message
                    result.script = "No single script - this descriptor defines multiple paths. Choose derivation index below to derive";
                    result.script_asm = "No single script - this descriptor defines multiple paths. Choose derivation index below to derive";
                } else {
                    // Show normal compilation success message with spending cost analysis format
                    // Show the compiled miniscript expression
                    const showKeyNames = document.getElementById('key-names-toggle')?.dataset.active === 'true';
                    let displayMiniscriptExpr = displayMiniscript;
                    if (showKeyNames && this.keyVariables && this.keyVariables.size > 0) {
                        displayMiniscriptExpr = this.replaceKeysWithNames(displayMiniscript);
                    }
                    successMsg = `Miniscript expression:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${displayMiniscriptExpr}</span>`;
                    
                    if (result.max_weight_to_satisfy && result.max_satisfaction_size) {
                        // Different calculation for Legacy vs Segwit contexts
                        if (context === 'legacy') {
                            // Helper functions for precise calculation
                            const cs = (n) => n < 253 ? 1 : (n <= 0xffff ? 3 : (n <= 0xffffffff ? 5 : 9));
                            const pushOv = (n) => n <= 75 ? 1 : (n <= 255 ? 2 : (n <= 65535 ? 3 : 5));
                            
                            // P2SH satisfaction cost calculation
                            const scriptSize = result.script_size;               // e.g. 25 bytes for pkh(Alice)
                            const sigLen = 73;                                   // worst-case DER + hashtype (71-73 typical)
                            const pubkeyLen = 33;                                 // compressed pubkey

                            // P2SH scriptSig content: signatures + pubkeys + redeemScript + push-ops
                            // For pkh: sig(73) + pubkey(33) + redeemScript(25) + pushops(3) = 134 bytes
                            const witnessSize = sigLen + pubkeyLen;              // signatures + pubkeys
                            const content = pushOv(sigLen) + sigLen + pushOv(pubkeyLen) + pubkeyLen + pushOv(scriptSize) + scriptSize;
                            const p2shSatisfactionWU = 4 * (cs(content) + content);
                            
                            // For display: also show the overhead
                            const overheadBytes = 36 + 4;                        // outpoint (36) + nSequence (4) = 40
                            const overheadWU = overheadBytes * 4;                // 40 * 4 = 160 WU
                            const totalWU = p2shSatisfactionWU + overheadWU;
                            
                            successMsg += `<br>Spending cost analysis (P2SH):<br>`;
                            successMsg += `Satisfaction cost (scriptSig content): ${p2shSatisfactionWU} WU<br>`;
                            successMsg += `Input overhead (outpoint + nSequence): ${overheadWU} WU<br>`;
                            successMsg += `Per-input total: ${totalWU} WU<br><br>`;
                        } else if (context === 'segwit') {
                            // For Segwit v0 (P2WSH)
                            const scriptBytes = result.script_size;              // e.g. 77 (script size in bytes)
                            const maxSat = result.max_satisfaction_size;         // e.g. 152 (full witness bytes including script)

                            // Signature weight includes ECDSA signature + sighash byte
                            const sigWeight = maxSat - (1 + scriptBytes);        // 152 - (1 + 77) = 74
                            const scriptWeight = scriptBytes + 1;                // 77 + 1 = 78 (script + length byte)
                            const satisfactionTotal = sigWeight + scriptWeight;  // 74 + 78 = 152
                            const inputOverhead = 160;                           // outpoint (36) + nSequence (4) = 40 bytes × 4
                            const perInputTotal = satisfactionTotal + inputOverhead; // 152 + 160 = 312

                            successMsg += `<br>Spending cost analysis:<br>`;
                            successMsg += `Signature (ECDSA + sighash): ${sigWeight} WU<br>`;
                            successMsg += `Script (witnessScript): ${scriptWeight} WU (${scriptBytes} B script + 1 B length)<br>`;
                            successMsg += `Satisfaction (witness): ${satisfactionTotal} WU<br>`;
                            successMsg += `Input overhead (non-witness: outpoint + nSequence): ${inputOverhead} WU<br>`;
                            successMsg += `Per-input total: ${perInputTotal} WU<br><br>`;
                        } else {
                            // For other contexts (taproot_single_leaf, etc.) - keep the simpler format
                            const scriptWeight = result.script_size;            // e.g. 35
                            const maxSat = result.max_satisfaction_size;        // e.g. 109 (full witness bytes)
                            
                            const inputWeight = maxSat - (1 + scriptWeight);    // 109 - (1 + 35) = 73
                            const totalWeight = scriptWeight + inputWeight;     // 35 + 73 = 108
                            
                            successMsg += `<br>Spending cost analysis:<br>`;
                            successMsg += `Script: ${scriptWeight} WU<br>`;
                            successMsg += `Input: ${inputWeight}.000000 WU<br>`;
                            successMsg += `Total: ${totalWeight}.000000 WU<br><br>`;
                        }
                    } else if (result.max_satisfaction_size) {
                        // Fallback - show satisfaction size
                        successMsg += `<br>Spending cost analysis:<br>`;
                        successMsg += `Input: ${result.max_satisfaction_size}.000000 WU<br>`;
                        successMsg += `Total: ${result.script_size + result.max_satisfaction_size}.000000 WU<br><br>`;
                    } else {
                        // No weight details available, add extra line break
                        successMsg += `<br>`;
                    }
                    
                    // Add hex, asm, and address
                    if (result.script) {
                        successMsg += `HEX:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${result.script}</span><br>`;
                    }
                    if (result.script_asm) {
                        // Create simplified version with key names (same as script field)
                        const simplifiedAsm = this.simplifyAsm(result.script_asm);
                        let finalAsm = simplifiedAsm;
                        // Only replace keys with names if toggle is active
                        const showKeyNames = document.getElementById('key-names-toggle')?.dataset.active === 'true';
                        if (showKeyNames && this.keyVariables.size > 0) {
                            finalAsm = this.replaceKeysWithNames(simplifiedAsm);
                        }
                        successMsg += `ASM:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${finalAsm}</span><br>`;
                    }
                    if (result.address) {
                        successMsg += `Address:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${result.address}</span>`;
                    }
                }
                
                // Store the compiled miniscript (with actual keys) for network switching
                result.processedMiniscript = result.compiled_miniscript;
                
                // Only show miniscript success and auto-compile if we actually loaded a miniscript into the editor
                if (!isPolicyResult) {
                    // Pass the compiled miniscript expression for tree visualization
                    let treeExpression = displayMiniscript;
                    this.showMiniscriptSuccess(successMsg, treeExpression);
                    
                    // After putting miniscript in editor, compile it fresh with current mode
                    // This ensures proper mode handling (single-leaf vs multi-leaf)
                    this.compileExpression();
                } else {
                    // Clear/hide miniscript messages when policy returns policy result
                    this.clearMiniscriptMessages();
                }
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

        // Clear policyLifted flag
        this.policyLifted = false;

        // Reset taproot mode to default
        window.currentTaprootMode = 'single-leaf';

        // Hide policy description panel
        const policyPanel = document.querySelector('.policy-description-panel');
        if (policyPanel) policyPanel.style.display = 'none';
    }

    /**
     * Show policy analysis information (ℹ️ Info button)
     * Calls WASM analyze_policy and displays results in policy-errors div
     */
    showPolicyInfo() {
        const policy = document.getElementById('policy-input').textContent.trim();

        // Clear previous errors/success messages
        this.clearPolicyErrors();

        if (!policy) {
            this.showPolicyError('Please enter a policy expression to analyze.');
            return;
        }

        if (!this.wasm) {
            this.showPolicyError('Compiler not ready, please wait and try again.');
            return;
        }

        // Show loading state
        const infoBtn = document.getElementById('policy-info-btn');
        const originalText = infoBtn.textContent;
        infoBtn.textContent = '⏳ Analyzing...';
        infoBtn.disabled = true;

        try {
            // Clean and process policy
            const cleanedPolicy = this.cleanExpression(policy);
            const context = document.querySelector('input[name="policy-context"]:checked').value;
            const processedPolicy = this.replaceKeyVariables(cleanedPolicy, context);

            // Call WASM analyze_policy function
            const result = analyze_policy(processedPolicy);

            // Reset button
            infoBtn.textContent = originalText;
            infoBtn.disabled = false;

            if (result.success) {
                this.displayAnalysisResult(result, false); // false = no warning for policy info
            } else {
                this.showPolicyError(result.error || 'Policy analysis failed');
            }

        } catch (error) {
            console.error('Policy analysis error:', error);
            infoBtn.textContent = originalText;
            infoBtn.disabled = false;
            this.showPolicyError(`Policy analysis failed: ${error.message}`);
        }
    }

    /**
     * Display analysis result in policy-errors div
     * @param {Object} result - AnalysisResult from WASM
     * @param {boolean} showWarning - Whether to show "semantic only" warning
     * @param {string} targetDivId - Target div ID for displaying result (default: 'policy-errors')
     */
    displayAnalysisResult(result, showWarning = false, targetDivId = 'policy-errors') {
        const targetDiv = document.getElementById(targetDivId);

        // Check if we should show key names based on toggle state (check both toggles)
        const policyToggle = document.getElementById('policy-key-names-toggle');
        const miniscriptToggle = document.getElementById('miniscript-key-names-toggle');
        const activeToggle = targetDivId === 'policy-errors' ? policyToggle : miniscriptToggle;
        const showKeyNames = activeToggle?.dataset.active !== 'false' && this.keyVariables && this.keyVariables.size > 0;

        // Helper to optionally replace keys with names
        const maybeReplaceKeys = (text) => showKeyNames ? this.replaceKeysWithNames(text) : text;

        // Use error styling if there are warnings
        const hasWarnings = result.warnings && result.warnings.length > 0;
        const boxClass = hasWarnings ? 'result-box error' : 'result-box success';

        let content = `<div class="${boxClass}" style="margin: 0; text-align: left;">`;
        content += `<h4>ℹ️ Policy Analysis</h4>`;
        content += `<div style="margin-top: 10px; word-wrap: break-word; word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap; hyphens: none; max-width: 100%; overflow-x: auto; font-size: 13px;">`;

        // Warning for miniscript lift (not for policy info)
        if (showWarning) {
            content += `<div style="color: #ffffff; font-weight: bold; margin-bottom: 10px; padding: 12px; border: 1px solid var(--border-color); border-radius: 4px;">⚠️ Lifted Policy from Miniscript - for analysis purposes only. May differ from the original, may not be compilable back to Miniscript, and probability information cannot be recovered.</div>`;
        }

        // Spending Logic
        if (result.spending_logic) {
            content += `Spending Logic:<br><span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${this.escapeHtml(maybeReplaceKeys(result.spending_logic))}</span><br>`;
        }

        // Spending Paths
        if (result.spending_paths && result.spending_paths.length > 0) {
            content += `Spending Paths:<br>`;
            result.spending_paths.forEach(path => {
                content += `<div style="margin-left: 10px;">${this.escapeHtml(maybeReplaceKeys(path))}</div>`;
            });
        }

        // Keys
        if (result.keys) {
            const displayKeys = result.keys.unique_keys.map(key => maybeReplaceKeys(key)).join(', ') || 'none';
            content += `Keys: ${result.keys.total_references} references, ${result.keys.unique_keys.length} unique (${displayKeys})`;
            if (result.keys.min_signatures != null && result.keys.max_signatures != null) {
                if (result.keys.min_signatures === result.keys.max_signatures) {
                    content += `, signatures per path: ${result.keys.min_signatures}`;
                } else {
                    content += `, signatures per path: ${result.keys.min_signatures}-${result.keys.max_signatures}`;
                }
            }
            content += `<br>`;
        }

        // Complexity
        if (result.complexity) {
            const parts = [];
            parts.push(`depth: ${result.complexity.depth}`);
            parts.push(`paths: ${result.complexity.num_paths}`);
            if (result.complexity.thresholds && result.complexity.thresholds.length > 0) {
                parts.push(`thresholds: ${result.complexity.thresholds.join(', ')}`);
            }
            content += `Complexity: ${parts.join(', ')}<br>`;
        }

        // Timelocks
        // Note: has_mixed is effectively always false - rust-miniscript rejects mixed
        // timelocks at parse time. The warning is handled in the Warnings section if ever triggered.
        {
            const hasRelative = result.timelocks?.relative && result.timelocks.relative.length > 0;
            const hasAbsolute = result.timelocks?.absolute && result.timelocks.absolute.length > 0;

            content += `Timelocks: `;
            if (hasRelative || hasAbsolute) {
                if (hasRelative) {
                    content += result.timelocks.relative.map(t => `relative ${t.value} blocks ${this.blocksToHumanTime(t.value)}`).join(', ');
                }
                if (hasRelative && hasAbsolute) content += `, `;
                if (hasAbsolute) {
                    content += result.timelocks.absolute.map(t => `absolute ${this.formatAbsoluteTimelock(t.value)}`).join(', ');
                }
            } else {
                content += `none`;
            }
            content += `<br>`;
        }

        // Hashlocks
        {
            const parts = [];
            if (result.hashlocks?.sha256_count > 0) parts.push(`SHA256: ${result.hashlocks.sha256_count}`);
            if (result.hashlocks?.hash256_count > 0) parts.push(`HASH256: ${result.hashlocks.hash256_count}`);
            if (result.hashlocks?.ripemd160_count > 0) parts.push(`RIPEMD160: ${result.hashlocks.ripemd160_count}`);
            if (result.hashlocks?.hash160_count > 0) parts.push(`HASH160: ${result.hashlocks.hash160_count}`);
            content += `Hashlocks: ${parts.length > 0 ? parts.join(', ') : 'none'}<br>`;
        }

        // Security
        if (result.security) {
            const secParts = [];
            secParts.push(result.security.is_non_malleable ? 'non-malleable' : 'malleable');
            // Show requires_signature for both miniscript and policy (now accurate for both)
            secParts.push(result.security.requires_signature ? 'requires sig' : 'no sig required');
            if (result.security.has_repeated_keys) secParts.push('repeated keys');
            if (result.source === 'miniscript' && !result.security.within_resource_limits) secParts.push('exceeds limits');
            content += `Security: ${secParts.join(', ')}<br>`;
        }

        content += `</div>`;

        // Tree Structure
        if (result.tree_structure) {
            const treeFormatted = this.formatPolicyTreeAsVerticalHierarchy(result.tree_structure, showKeyNames);
            content += `
                <div style="margin-top: 15px;">
                    Tree structure
                    <pre style="margin-top: 8px; padding: 12px; border: 1px solid var(--border-color); border-radius: 4px; overflow-x: auto; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 12px; line-height: 1.4; background: transparent;">${this.escapeHtml(treeFormatted)}</pre>
                </div>
            `;
        }

        // Warnings - only show if there are warnings
        if (result.warnings && result.warnings.length > 0) {
            content += `<div style="margin-top: 10px; font-size: 13px;">Warnings: ${result.warnings.map(w => this.escapeHtml(w)).join(', ')}</div>`;
        }

        content += '</div>';

        targetDiv.innerHTML = content;
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
<div style="margin-top: 15px; padding: 12px; background: rgba(255, 107, 107, 0.1); border: 1px solid var(--error-border); border-radius: 6px; text-align: left; color: var(--text-color);">
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
<button onclick="compiler.restoreDefaultKeys()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Add 60 commonly used test keys (Alice, Bob, Charlie, David, Eva, Frank, NUMS, etc.) plus VaultKey1-19 range descriptors, VaultXOnly1-2 X-only keys, and DavidTimeout/HelenTimeout timeout keys with pre-generated public keys for each type. This won't overwrite existing keys with the same names.">🔄 Restore defaults</button>
</div>
</div>
                    `;
                } else if (gotLength <= 15) {
                    // Generic help for short strings that look like variable names
                    additionalHelp = `
<div style="margin-top: 15px; padding: 12px; background: rgba(255, 107, 107, 0.1); border: 1px solid var(--error-border); border-radius: 6px; text-align: left; color: var(--text-color);">
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
<button onclick="compiler.restoreDefaultKeys()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Add 60 commonly used test keys (Alice, Bob, Charlie, David, Eva, Frank, NUMS, etc.) plus VaultKey1-19 range descriptors, VaultXOnly1-2 X-only keys, and DavidTimeout/HelenTimeout timeout keys with pre-generated public keys for each type. This won't overwrite existing keys with the same names.">🔄 Restore defaults</button>
</div>
</div>
                    `;
                }
            }
        }

        // Add note if this policy was lifted from miniscript (only for actual compilation errors, not context/setup errors)
        let liftedPolicyNote = '';
        const isContextError = message.includes('Please enter a policy') ||
                               message.includes('Compiler not ready') ||
                               message.includes('please wait') ||
                               message.includes('check your compile context') ||
                               message.includes('requires x-only keys') ||
                               message.includes('Found compressed key');
        if (this.policyLifted && !isContextError) {
            liftedPolicyNote = `
<div style="margin-top: 15px; padding: 12px; background: rgba(255, 107, 107, 0.1); border: 1px solid var(--error-border); border-radius: 6px; color: var(--text-color);">
<strong>💡 Note:</strong> This policy was lifted from Miniscript for analysis and may not be directly compilable or analyzable. Manual edits may be required.
</div>`;
        }

        policyErrorsDiv.innerHTML = `
            <div class="result-box error" style="margin: 0; text-align: left;">
                <h4>❌ Policy error</h4>
                <div style="margin-top: 10px; text-align: left;">${message}</div>
                ${additionalHelp}
                ${liftedPolicyNote}
            </div>
        `;
    }

    showPolicySuccess(miniscript, result = null, context = null) {
        const policyErrorsDiv = document.getElementById('policy-errors');
        
        // Check if we should update existing success message during auto-compile
        if (this.isAutoCompiling) {
            const existingSuccess = policyErrorsDiv.querySelector('.result-box.success');
            if (existingSuccess) {
                // Update the content for auto-compile
                this.updatePolicySuccessContent(existingSuccess, miniscript, result, context);
                return; // Don't replace the entire message box
            }
        }
        
        // Normal behavior - create new message
        const content = this.generatePolicySuccessContent(miniscript, result, context);
        // Get current context for display 
        const currentContext = document.querySelector('input[name="policy-context"]:checked')?.value || 'legacy';
        const contextDisplay = this.getContextDisplayName(currentContext);
        
        policyErrorsDiv.innerHTML = `
            <div class="result-box success" style="margin: 0; text-align: left;">
                <h4>✅ Policy ${contextDisplay} compilation successful</h4>
                ${content}
            </div>
        `;
    }
    
    generatePolicySuccessContent(miniscript, result = null, context = null) {
        // Check if this is taproot context or a taproot descriptor
        if (context === 'taproot' || context === 'taproot-multi' || context === 'taproot-keypath' || miniscript.startsWith('tr(')) {
            return this.generateTaprootPolicyContent(miniscript, result);
        } else {
            // Standard miniscript display
            return `
                <div style="margin-top: 10px; text-align: left; font-size: 13px;">
                    Generated Miniscript:
                    <code style="display: block; margin: 0; word-break: break-word; overflow-wrap: anywhere; hyphens: none; max-width: 100%; overflow-x: auto; font-family: monospace; font-size: 12px;">${miniscript}</code>
                    <div style="color: var(--text-secondary); font-size: 13px; margin-top: 10px;">
                        ${miniscript.match(/^\s*\{.*\}\s*$/) ? 
                            '💡 Policy compiled into multiple miniscript expressions. Cannot load into miniscript editor. Switch to Taproot compilation (multi-leaf TapTree) mode to select your miniscript expression.' :
                            '💡 Check the miniscript below for script hex, ASM, and address details.'
                        }
                    </div>
                </div>
            `;
        }
    }
    
    generateTaprootPolicyContent(descriptor, result = null) {
        console.log(`=== TAPROOT PARSING DEBUG ===`);
        console.log(`Input descriptor: "${descriptor}"`);
        
        // Parse using helper function if it's a tr() descriptor
        let internalKey = null;
        let treeScript = null;
        
        if (descriptor.startsWith('tr(')) {
            const parsed = this.parseTrDescriptor(descriptor);
            if (parsed) {
                internalKey = parsed.internalKey;
                treeScript = parsed.treeScript;
            }
        } else {
            // For non-tr() descriptors in taproot context (single-leaf mode result)
            // The descriptor itself is the miniscript
            treeScript = descriptor;
        }
        
        // Check current mode based on context
        const contextRadio = document.querySelector('input[name="context"]:checked');
        const context = contextRadio ? contextRadio.value : 'segwit';
        const currentMode = context === 'taproot-multi' ? 'multi-leaf' : context === 'taproot-keypath' ? 'key-script-path' : 'single-leaf';
        
        let content = `
            <div style="margin-top: 10px; text-align: left;">
        `;
        
        // Show different content based on compilation mode
        if (currentMode === 'single-leaf') {
            // Single-leaf mode: show the same format as direct miniscript compilation
            const displayMiniscript = treeScript || `pk(${internalKey})`;
            content += `
                <div style="margin-bottom: 15px;">
                    Generated Miniscript:
                    <code style="display: block; margin: 0; word-break: break-all; font-family: monospace;">${displayMiniscript}</code>
                </div>
                
                <div style="color: var(--text-secondary); font-size: 13px;">
                    ${displayMiniscript.match(/^\s*\{.*\}\s*$/) ? 
                        '💡 Policy compiled into multiple miniscript expressions. Cannot load into miniscript editor. Switch to Taproot (multi-leaf) in Script context to select your miniscript expression.' :
                        '💡 Check the miniscript below for script hex, ASM, and address details.'
                    }
                </div>
            </div>`;
            return content;
        }
        
        // Multi-leaf mode: full taproot information
        content += `
                <div style="margin-bottom: 15px; font-size: 13px;">
                    Descriptor:<br>
                    <div style="margin: 4px 0; font-family: monospace; font-size: 12px; word-break: break-all; overflow-wrap: anywhere;">
                        ${descriptor}
                    </div>
                </div>`;
        
        // Add weight information if available from compilation result
        // Skip overall weight for taproot modes (script-path and key+script-path)
        const skipWeight = context === 'taproot-multi' || context === 'taproot-keypath';
        if (result && !skipWeight) {
            if (result.script_size && result.max_weight_to_satisfy) {
                const scriptWeight = result.script_size;
                const totalWeight = result.max_weight_to_satisfy;
                const inputWeight = totalWeight - scriptWeight;
                
                content += `
                <div style="margin-bottom: 15px; font-size: 13px;">
                    <strong>Weight Information:</strong><br>
                    <div style="margin: 4px 0; font-family: monospace; font-size: 12px;">
                        Script: ${scriptWeight} WU<br>
                        Input: ${inputWeight}.000000 WU<br>
                        Total: ${totalWeight}.000000 WU
                    </div>
                </div>`;
            } else if (result.max_satisfaction_size) {
                content += `
                <div style="margin-bottom: 15px; font-size: 13px;">
                    <strong>Weight Information:</strong><br>
                    <div style="margin: 4px 0; font-family: monospace; font-size: 12px;">
                        Input: ${result.max_satisfaction_size}.000000 WU<br>
                        Total: ${result.script_size + result.max_satisfaction_size}.000000 WU
                    </div>
                </div>`;
            }
        }
        
        // Check if we should show key names or raw keys
        const showKeyNames = document.getElementById('key-names-toggle')?.dataset.active === 'true';
        let displayInternalKey = internalKey;
        if (showKeyNames && this.keyVariables && this.keyVariables.size > 0 && internalKey) {
            displayInternalKey = this.replaceKeysWithNames(internalKey);
        }
        
        // Check if internal key is NUMS
        const isNUMSKey = internalKey && (internalKey.includes('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0') || displayInternalKey === 'NUMS');
        
        content += `
                <div style="margin-bottom: 15px; font-size: 13px;">
                    Taproot Structure:<br>
                    <div style="margin: 4px 0; font-family: monospace; font-size: 12px;">
                        • Internal Key: ${displayInternalKey}${isNUMSKey ? ' ("Nothing Up My Sleeve") - unspendable key, disables key-path spending' : ' (key-path spending)'}
        `;
        
        if (treeScript) {
            // Parse the tree to show branches
            const branches = this.parseTaprootBranches(treeScript);
            content += `<br>        • Script Tree: ${branches.length} branch${branches.length !== 1 ? 'es' : ''} (script-path spending)`;
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
                }, CONSTANTS.INIT_DELAY_MS);
                
                // Show simplified single-branch message
                content += `
                    <div style="margin-bottom: 15px; padding: 10px; border: 1px solid var(--success-border); border-radius: 4px; background: var(--success-bg);">
                        ✓ Single Branch Auto-loaded<br>
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
                }, CONSTANTS.INIT_DELAY_MS);
                
                // Get per-branch weight information if in script-path mode
                let branchWeights = null;
                const isScriptPathMode = context === 'taproot-multi';
                if (isScriptPathMode && result && typeof get_taproot_branch_weights !== 'undefined') {
                    try {
                        const weightResult = get_taproot_branch_weights(descriptor);
                        if (weightResult && weightResult.success) {
                            branchWeights = weightResult.branches;
                            console.log('Got branch weights:', branchWeights);
                        }
                    } catch (e) {
                        console.log('Could not get branch weights:', e);
                    }
                }
                
                // Add branch details with clickable names
                branches.forEach((branch, index) => {
                    // Replace key names if available and toggle is active
                    let displayMiniscript = branch;
                    if (showKeyNames && this.keyVariables && this.keyVariables.size > 0) {
                        displayMiniscript = this.replaceKeysWithNames(branch);
                    }
                    
                    // Get weight info for this branch if available
                    let weightInfo = '';
                    if (branchWeights && branchWeights[index]) {
                        const weight = branchWeights[index];
                        weightInfo = `
                        <div style="margin-top: 8px; padding: 8px; background: var(--container-bg); border-radius: 4px; font-family: monospace; font-size: 12px;">
                            <strong style="color: var(--text-primary);">Weight Breakdown:</strong><br>
                            <div style="margin-left: 10px; color: var(--text-secondary);">
                                Script size: ${weight.script_size} bytes<br>
                                Control block: ${weight.control_block_size} bytes<br>
                                Witness: ${weight.max_witness_size} bytes<br>
                                <strong style="color: var(--accent-color);">Total spend cost: ${weight.total_weight} WU</strong>
                            </div>
                        </div>`;
                    }
                    
                    content += `
                    <div style="margin-bottom: 12px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; background: transparent;">
                        Branch ${index + 1}:<br>
                        Miniscript:
                        <a href="#" onclick="window.loadBranchMiniscript('${displayMiniscript.replace(/'/g, "\\'")}')"
                           style="color: var(--accent-color); text-decoration: underline; font-family: monospace; font-size: 13px; word-break: break-all; overflow-wrap: anywhere; display: inline-block; max-width: 100%;">
                           ${displayMiniscript}
                        </a>
                        ${weightInfo}
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 8px;">
                            💡 Click the Miniscript above to load it into the Miniscript editor
                        </div>
                    </div>
                    `;
                });
                
                // Check if this is script-path mode (taproot-multi) with NUMS key
                const isNUMS = internalKey && (internalKey.includes('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0') || displayInternalKey === 'NUMS');
                
                if (isScriptPathMode && isNUMS) {
                    content += `
                        <div style="color: var(--text-secondary); font-size: 13px; margin-top: 15px;">
                            💡 This creates a taproot output that can ONLY be spent through script paths. The NUMS key is an unspendable internal key, ensuring all spending must reveal and satisfy one of the branch scripts. You can replace the NUMS key in settings if needed.
                        </div>
                    `;
                } else {
                    content += `
                        <div style="color: var(--text-secondary); font-size: 13px; margin-top: 15px;">
                            💡 This creates an optimized taproot output where ${displayInternalKey} can spend directly with just a signature, while other parties require revealing only their specific branch script.
                        </div>
                    `;
                }
            }
        } else {
            // No tree script (key-path only) - no mode selection needed, show simple message
            content += `
                <div style="margin-bottom: 15px; color: var(--text-secondary); font-size: 13px;">
                    💡 This is a key-path only taproot output. Only ${displayInternalKey} can spend using a single signature.
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
        
        // Try to use the new WASM branch-to-miniscript function first
        console.log('DEBUG: Available WASM functions:', Object.keys(window).filter(k => k.startsWith('get_') || k.includes('taproot') || k.includes('test')));
        console.log('DEBUG: get_taproot_branches type:', typeof get_taproot_branches);
        console.log('DEBUG: window.get_taproot_branches type:', typeof window.get_taproot_branches);
        console.log('DEBUG: test_taproot_branches type:', typeof test_taproot_branches);
        
        // Try the test function
        if (typeof test_taproot_branches !== 'undefined') {
            try {
                const testResult = test_taproot_branches();
                console.log('DEBUG: Test function result:', testResult);
            } catch (e) {
                console.log('DEBUG: Test function error:', e);
            }
        }
        
        if (typeof get_taproot_branches !== 'undefined') {
            try {
                // Build a complete descriptor to pass to the WASM function
                // We need to find the internal key from the context
                let descriptor = '';
                const descriptorInput = document.getElementById('expression-input');
                if (descriptorInput && descriptorInput.textContent) {
                    const fullDescriptor = descriptorInput.textContent.trim();
                    if (fullDescriptor.startsWith('tr(')) {
                        descriptor = fullDescriptor;
                    }
                }
                
                // If no full descriptor, try to construct one
                if (!descriptor) {
                    // Find the last compiled descriptor from recent compilation
                    const lastDescriptor = this.lastCompiledDescriptor;
                    if (lastDescriptor && lastDescriptor.startsWith('tr(')) {
                        descriptor = lastDescriptor;
                    } else {
                        // Fallback: use NUMS point
                        descriptor = `tr(50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0,${treeScript})`;
                    }
                }
                
                console.log(`DEBUG: Calling get_taproot_branches from parseTaprootBranches with: ${descriptor}`);
                const result = get_taproot_branches(descriptor);
                console.log(`DEBUG: get_taproot_branches result from parseTaprootBranches:`, result);
                
                if (result && result.success && result.branches) {
                    return result.branches.map(branch => branch.miniscript);
                }
            } catch (e) {
                console.error('DEBUG: Error in parseTaprootBranches WASM call:', e);
            }
        }
        
        // Fallback to old parsing method
        console.log('DEBUG: Using fallback parsing method');
        
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
    
    updatePolicySuccessContent(existingSuccess, miniscript, result = null, context = null) {
        // Update the content for auto-compile scenarios
        const contentDiv = existingSuccess.querySelector('div[style*="margin-top: 10px"]');
        if (contentDiv) {
            const newContent = this.generatePolicySuccessContent(miniscript, result, context);
            contentDiv.outerHTML = newContent;
        }
        
        // Update title with current context
        const titleElement = existingSuccess.querySelector('h4');
        if (titleElement) {
            const currentContext = document.querySelector('input[name="policy-context"]:checked')?.value || 'legacy';
            const contextDisplay = this.getContextDisplayName(currentContext);
            titleElement.innerHTML = `✅ Policy ${contextDisplay} compilation successful`;
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
        // First escape only the problematic characters that could be interpreted as HTML
        // We need to be careful to only escape what's necessary to prevent HTML injection
        // while preserving the ability to read the original text back
        let result = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Apply syntax highlighting - the patterns need to account for escaped < and >
        result = result
            // HD wallet descriptors: [fingerprint/path]xpub/<range>/*
            .replace(/(\[)([A-Fa-f0-9]{8})(\/)([0-9h'\/]+)(\])([xt]pub[A-Za-z0-9]+)(&lt;[0-9;]+&gt;)?(\/\*)?/g, 
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
            .replace(/\b[A-Z][a-zA-Z0-9]*\b/g, '<span class="syntax-key">$&</span>')
            // Parentheses
            .replace(/[()]/g, '<span class="syntax-parenthesis">$&</span>')
            // Commas
            .replace(/,/g, '<span class="syntax-comma">$&</span>');

        return result;
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
        // First escape only the problematic characters that could be interpreted as HTML
        // We need to be careful to only escape what's necessary to prevent HTML injection
        // while preserving the ability to read the original text back
        let result = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Miniscript syntax patterns (based on official spec: https://bitcoin.sipa.be/miniscript/)
        // Apply syntax highlighting - the patterns need to account for escaped < and >
        result = result
            // HD wallet descriptors: [fingerprint/path]xpub/<range>/* or [fingerprint/path]xpub/path/index or [fingerprint/path]xpub/<range>/index
            .replace(/(\[)([A-Fa-f0-9]{8})(\/)([0-9h'\/]+)(\])([xt]pub[A-Za-z0-9]+)((?:\/&lt;[0-9;]+&gt;\/(?:\*|[0-9]+)|\/[0-9]+\/[0-9*]+))/g, 
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
            .replace(/\b[A-Z][a-zA-Z0-9]*\b/g, '<span class="syntax-key">$&</span>')
            // Parentheses
            .replace(/[()]/g, '<span class="syntax-parenthesis">$&</span>')
            // Commas
            .replace(/,/g, '<span class="syntax-comma">$&</span>');

        return result;
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
        if (undoStack.length > CONSTANTS.MAX_UNDO_STATES) {
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
            }, CONSTANTS.INIT_DELAY_MS);
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
            ],
            xonly: [
                'a3a3d9fe61d93ac31ec9699e0407b84e7f23c5bb638f0d755f6053646c1997df',
                '7a6f3dbd569d59ee017341b96166b4f7e3dafbb31ec2212656af2fd907ca8572',
                'd392b6f1f367f211f42f9f78b70b3b0b396ceee8d7b271f098d253ead0991d23',
                '6807e6f3055807b9fac782114835be3627a6adbcf78624748eff45ab3ef05834',
                'bc2ee26fb95878c997c000b2fefb9d46cc83abf904214396a7c2c1ced8e1cbe2',
                'd5d3a9a02cf7362288af2c602be92d81ac058b2aefa7e067ef6bb824814460d8',
                '6973ee26249a5bf1477f16b16676e26bc65fdae799c50f6b69e7a78f817525da',
                '1ea6a146008c42b2489cb90c33eb2760fe3442a1e6a43782819ec14f10fe2eda',
                '54311aa0b1046a7992a08cf5fd798ff22b913081b120fb0a4adab87af276071c',
                '3a810842fba0133e13a903567dc2c02bfe2b1b95fecc54dda12a1c0905bfb260',
                'faa19fc368d13652b6152a4a52caf8a5fa45d07420783a956ccc6cf0e62ef3c8',
                '475f47a4cf3d7bdf9115e0c982c17cab2cfe05d5c7a7771d1923bb1a03600e2b',
                '2ae7ed98011ea2d21f750b1e096aea8ad6e214599543b2e46b031aa179d7ec03',
                'b0f78c954e7ab83fb9f0c858eb9c7c2d80782671c33fc0556b7dc3ded16a72d4',
                'e2bbd26b5f191ef157220e7a0d12c617639b5689aa3fabb652a9a3714a03ead4',
                '1e42ec3b91786fe0f2a96f50f0b38b92629b2f45f0d0e2ac51a8b0087377ca12',
                'fd3d63a4221d8f6c32709c893109f6a57f24258a4b43780174cdd106e3f61df6',
                'a37059fdb73c1971372f00b2ace2adaf8dddfcd7a0322e6e2c5ab96d84116f0b',
                'a8a7479a38cd3c291599cbc4c8f44bbb4078d05e014699ca9860df22f1f6203a',
                'ea85fef522b648c8525f913d50348b555093d64871439862789746c9901c484f',
                '70bdbf8ea4d5e36e91f3a05f864d9425703e31db6458ed43816e11b4430ad156',
                '6485993fe4fd4abc3d7d12ab6366ce431699b48661a16d499bcbfa4601ed4e3f',
                '75332ee973fe08ba83d03587de45b2ab5d02fb80015036623d97fbc06c5ac3c1',
                '0352bed66a6cf595c3e2adcdc751b6e3c0673acc2290a5334eeeba831d728b4a',
                '38918a29f4ae72699eb5b37160b850e18d7f1a23fda9755490143e03a2221e27',
                'd24c4047f6c73b00b619c757d1abd797fb440f6ad310a243fa3411773403d416',
                '09d760b0f253df4aa988d5294b06e9e9f3919f25decd0b10ae37139a280cfa9c',
                '205966f31cd4bab0d7c4a1d375c580b0293a2e40dff73c4ad3c132ea5d914577',
                'f14579c13316f603f95829ad4e7a812eea3a397b5c8f1bfe8540f21fde298d87',
                'fd4a3eac167dff950d66d47bb7ec076945a73edcf73a02e8f4de23f36de84bc6',
                'e12140d67080141bf903661569241a92c38defb17f60e88f49cbc8013486b93f',
                'e8b7c6f6dd065c7610640f5c73f8879173c1dd7c3479ff614b85f73b16c7da34',
                'f17c345219018fcb6b291f7a6ff0c43e78194b7ed8c800eb5f9658031c406257',
                '5637591c5e67043175acb7b1e43a3bed757f93d6a417503ed5e47da1ce49ee04',
                'f45580854a575d9849fe0fc63b6a3ccdc9f575c22f29bc25904656f5309dfc38',
                '470f1a0444b01a9a99ea732f1b0c6efb5105c86ea51d366bf02f623cf82ffb17',
                '2c8dd3a08b2b3db00db86385f387fbaa339055d9d721d394489239775ba24eec',
                '9d289e56cf2949c11a298570f0ccdbce5ea7e45d73d6ae740edbb70656f107ed',
                'da91cfd22366a1b1348c6e664d2d5d573b882ce3cac794d4cfbed0eeef3a9222',
                'cd1e443ecabdf030256b158018d5b06956d7b12f2142e3d539536d86ae8d88d6',
                '55e9394572f998cb85a824bbe5845f4e6f02127b3c875eedf4bcd357388e56b6',
                '047c8ffec24585e45518d913b1cbb60fbc586c2295c01f1de3c9b1a8b0f9e5ed',
                '8b4a352170c60173797320f715848d8034ae4edc341330cae66328853c6060b7',
                '609134981b05b2774fee31f354fb29545a21ddb47acea399aa68c83cc1467797',
                'b6ae2990fa177a6427796130a08f450ec618922659dc2dc5a21fe2887e40bb04',
                '0157901a7c651d67445ab927bffee90dbf6667580b4f4fe512e3bbcecea9dbc6',
                '13a25e15b38d361e794a30f02cd845cfc5e06f89aa5439645354681d7924155d',
                '776000a6eb83088d6019abbeee41949e5ac51718b565968e4d0b9b8689c80c6d',
                '2f889067e0fea526c70c7bc8ea3b022199a59d77d8d4fd79319559bc8bc32250',
                '093a2ea20de202d9ce8c4e14868b1a952d7c3130ab90a287d5f7b8ed427a09db',
                'fe17129ee7517f06d90e80b42eb7307471a701a28ce80be044ccb6fd60f77af4',
                '0e096bf8395d5bd101f2aa8d0d836020df593abe0ffc51dc7c4dce82e42d02bf',
                '21a8f84b84c2d925651a151c38179c984f78b17541f244bd3806612b5b5d81c6',
                '69483624d610f703315563932debae12ea541d8ea50c7f2de9030f096c6cf8f6',
                '2754ad8b203856331eac1087905ea916f8b71dbda5df95cf2ee561006cbe0cf3',
                'ebd0571cb4e49c4d459fceea4d0767fc46832c986493c2e3526448154be412aa',
                '92ceee56b2189cbea7568a7d500673e8baa72958ac95b74e854305f589a95a40',
                'c5c82d657eb3a51013b2ba28df1686cff3cdde896a793ca07ae3415dde5d7db2',
                '52c98024feca5596ef686e22042f6e9f750eadaf3ceb0930644823069b65ea92',
                '95b870e26464797b20d7eb59af2b4a04d31f727b9bfa496e72e029c1634a47b1'
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
            const storedVersion = localStorage.getItem('defaultVariablesVersion');
            
            if (saved) {
                // Load existing variables
                const keyVars = JSON.parse(saved);
                this.keyVariables = new Map(Object.entries(keyVars));
                
                // Check if we need to add new defaults (only if version doesn't exist or is lower)
                if (!storedVersion || this.compareVersions(storedVersion, this.DEFAULT_VARIABLES_VERSION) < 0) {
                    console.log('Updating default variables from version', storedVersion || 'none', 'to', this.DEFAULT_VARIABLES_VERSION);
                    const success = this.addMissingDefaults();
                    if (success) {
                        localStorage.setItem('defaultVariablesVersion', this.DEFAULT_VARIABLES_VERSION);
                    }
                }
            } else {
                // First time - add all defaults
                console.log('First time setup - adding all default variables');
                this.addDefaultKeys();
                localStorage.setItem('defaultVariablesVersion', this.DEFAULT_VARIABLES_VERSION);
            }
            
            this.displayKeyVariables();
        } catch (error) {
        // Seed from shared defaultVariables map (single source of truth)
        for (const [keyName, keyValue] of this.defaultVariables.entries()) {
            this.keyVariables.set(keyName, keyValue);
        }

            console.error('Failed to load key variables:', error);
            this.keyVariables = new Map();
            this.addDefaultKeys();
            localStorage.setItem('defaultVariablesVersion', this.DEFAULT_VARIABLES_VERSION);
        }
    }

    initializeDefaultVariables() {
        // Initialize default keys map - single source of truth
        
        // Legacy/Segwit keys (compressed, 66-char, starting with 02/03) - for general examples
        // Using user-provided keys from the list
        this.defaultVariables.set('Alice', '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9');
        this.defaultVariables.set('Bob', '03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd');
        this.defaultVariables.set('Charlie', '03defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34');
        this.defaultVariables.set('Eva', '034cf034640859162ba19ee5a5a33e713a86e2e285b79cdaf9d5db4a07aa59f765');
        this.defaultVariables.set('Frank', '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
        this.defaultVariables.set('Lara', '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
        this.defaultVariables.set('Mike', '03774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb');
        this.defaultVariables.set('Nina', '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13');
        this.defaultVariables.set('Oliver', '03d01115d548e7561b15c38f004d734633687cf4419620095bc5b0f47070afe85a');
        this.defaultVariables.set('Paul', '02791ca97e3d5c1dc6bc7e7e1a1e5fc19b90e0e8b1f9f0f1b2c3d4e5f6a7b8c9');
        this.defaultVariables.set('Quinn', '03581c63a4f65b4dfb3baf7d5c3e5a6d4f0e7b2c8a9f1d3e4b2a5c6d7e8f9a0b');
        this.defaultVariables.set('Rachel', '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4');
        this.defaultVariables.set('Sam', '02bf0e7b0c8a7b1f9a3e4d2c5b6a8f9d0e7c1b4a3f6e9d2c5b8a1f4e7d0c3b6a');
        this.defaultVariables.set('Tina', '032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991');
        this.defaultVariables.set('Uma', '020e46e79a2a8d12b9b21b533e2f1c6d5a7f8e9c0b1d2a3f4e5c6b7a8f9d0e3c');
        
        // Taproot keys (x-only, 64-char) - for Taproot examples
        // NUMS is always the standard "Nothing Up My Sleeve" point
        this.defaultVariables.set('NUMS', '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0');
        
        // Using user-provided x-only keys
        this.defaultVariables.set('David', 'fae4284884079a8134f553af138f5206584de24c44f2ba1b2d9215a32fc6b188');
        this.defaultVariables.set('Helen', '96b6d68aefbcb7fd24c8847f98ec1d48bc24c3afd7d4fffda8ca3657ba6ab829');
        this.defaultVariables.set('Ivan', 'ad9b3c720375428bb4f1e894b900f196537895d3c83878bcac7f008be7deedc2');
        this.defaultVariables.set('Julia', 'd127f475aba7d9111ff69cc6858305d15e8912205cfa5dcc7a4c66a97ebb8174');
        this.defaultVariables.set('Karl', 'b2afcd04877595b269282f860135bb03c8706046b0a57b17f252cf66e35cce89');
        
        // Complex descriptor keys
        this.defaultVariables.set('TestnetKey', '[C8FE8D4F/48h/1h/123h/2h]tpubDDEe6Dc3LW1JEUzExDRZ3XBzcAzYxMTfVU5KojsTwXoJ4st6LzqgbFZ1HhDBdTptjXH9MwgdYG4K7MNJBfQktc6AoS8WeAWFDHwDTu99bZa/1/1');
        this.defaultVariables.set('MainnetKey', '[C8FE8D4F/48h/1h/123h/2h]xpub6Ctf53JHVC5K4JHwatPdJyXjzADFQt7pazJdQ4rc7j1chsQW6KcJUHFDbBn6e5mvGDEnFhFBCkX383uvzq14Y9Ado5qn5Y7qBiXi5DtVBda/0/0');
        this.defaultVariables.set('RangeKey', '[C8FE8D4F/48h/1h/123h/2h]tpubDDEe6Dc3LW1JEUzExDRZ3XBzcAzYxMTfVU5KojsTwXoJ4st6LzqgbFZ1HhDBdTptjXH9MwgdYG4K7MNJBfQktc6AoS8WeAWFDHwDTu99bZa/<0;1>/*');
        
        // Vault keys for complex vault examples with range descriptors
        this.defaultVariables.set('VaultKey1', '[C8FE8D4F/48h/1h/123h/2h]tpubDET9Lf3UsPRZP7TVNV8w91Kz8g29sVihfr96asYsJqUsx5pM7cDvSCDAsidkQY9bgfPyB28bCA4afiJcJp6bxZhrzmjFYDUm92LG3s3tmP7/<10;11>/*');
        this.defaultVariables.set('VaultKey2', '[C8FE8D4F/48h/1h/123h/2h]tpubDET9Lf3UsPRZP7TVNV8w91Kz8g29sVihfr96asYsJqUsx5pM7cDvSCDAsidkQY9bgfPyB28bCA4afiJcJp6bxZhrzmjFYDUm92LG3s3tmP7/<8;9>/*');
        this.defaultVariables.set('VaultKey3', '[C8FE8D4F/48h/1h/123h/2h]tpubDET9Lf3UsPRZP7TVNV8w91Kz8g29sVihfr96asYsJqUsx5pM7cDvSCDAsidkQY9bgfPyB28bCA4afiJcJp6bxZhrzmjFYDUm92LG3s3tmP7/<6;7>/*');
        this.defaultVariables.set('VaultKey4', '[7FBA5C83/48h/1h/123h/2h]tpubDE5BZRXogAy3LHDKYhfuw2gCasYxsfKPLrfdsS9GxAV45v7u2DAcBGCVKPYjLgYeMMKq29aAHy2xovHL9KTd8VvpMHfPiDA9jzBwCg73N5H/<6;7>/*');
        this.defaultVariables.set('VaultKey5', '[7FBA5C83/48h/1h/123h/2h]tpubDE5BZRXogAy3LHDKYhfuw2gCasYxsfKPLrfdsS9GxAV45v7u2DAcBGCVKPYjLgYeMMKq29aAHy2xovHL9KTd8VvpMHfPiDA9jzBwCg73N5H/<4;5>/*');
        this.defaultVariables.set('VaultKey6', '[CB6FE460/48h/1h/123h/2h]tpubDFJbyzFGfyGhwjc2CP7YHjD3hK53AoQWU2Q5eABX2VXcnEBxWVVHjtZhzg9PQLnoHe6iKjR3TamW3N9RVAY5WBbK5DBAs1D86wi2DEgMwpN/<12;13>/*');
        this.defaultVariables.set('VaultKey7', '[CB6FE460/48h/1h/123h/2h]tpubDFJbyzFGfyGhwjc2CP7YHjD3hK53AoQWU2Q5eABX2VXcnEBxWVVHjtZhzg9PQLnoHe6iKjR3TamW3N9RVAY5WBbK5DBAs1D86wi2DEgMwpN/<10;11>/*');
        this.defaultVariables.set('VaultKey8', '[CB6FE460/48h/1h/123h/2h]tpubDFJbyzFGfyGhwjc2CP7YHjD3hK53AoQWU2Q5eABX2VXcnEBxWVVHjtZhzg9PQLnoHe6iKjR3TamW3N9RVAY5WBbK5DBAs1D86wi2DEgMwpN/<8;9>/*');
        this.defaultVariables.set('VaultKey9', '[CB6FE460/48h/1h/123h/2h]tpubDFJbyzFGfyGhwjc2CP7YHjD3hK53AoQWU2Q5eABX2VXcnEBxWVVHjtZhzg9PQLnoHe6iKjR3TamW3N9RVAY5WBbK5DBAs1D86wi2DEgMwpN/<6;7>/*');
        this.defaultVariables.set('VaultKey10', '[9F996716/48h/1h/0h/2h]tpubDFCY8Uy2eRq7meifV2Astvt8AsTLsrMX7vj7cLtZ6aPRcYGsAL4PXY1JZR2SfD3i2CRAwy9fm9Cq3xVeuWsvAcRnz9oc1umGL68Wn9QeT3q/<16;17>/*');
        this.defaultVariables.set('VaultKey11', '[9F996716/48h/1h/0h/2h]tpubDFCY8Uy2eRq7meifV2Astvt8AsTLsrMX7vj7cLtZ6aPRcYGsAL4PXY1JZR2SfD3i2CRAwy9fm9Cq3xVeuWsvAcRnz9oc1umGL68Wn9QeT3q/<14;15>/*');
        this.defaultVariables.set('VaultKey12', '[9F996716/48h/1h/0h/2h]tpubDFCY8Uy2eRq7meifV2Astvt8AsTLsrMX7vj7cLtZ6aPRcYGsAL4PXY1JZR2SfD3i2CRAwy9fm9Cq3xVeuWsvAcRnz9oc1umGL68Wn9QeT3q/<12;13>/*');
        this.defaultVariables.set('VaultKey13', '[9F996716/48h/1h/0h/2h]tpubDFCY8Uy2eRq7meifV2Astvt8AsTLsrMX7vj7cLtZ6aPRcYGsAL4PXY1JZR2SfD3i2CRAwy9fm9Cq3xVeuWsvAcRnz9oc1umGL68Wn9QeT3q/<10;11>/*');
        this.defaultVariables.set('VaultKey14', '[9F996716/48h/1h/0h/2h]tpubDFCY8Uy2eRq7meifV2Astvt8AsTLsrMX7vj7cLtZ6aPRcYGsAL4PXY1JZR2SfD3i2CRAwy9fm9Cq3xVeuWsvAcRnz9oc1umGL68Wn9QeT3q/<8;9>/*');
        this.defaultVariables.set('VaultKey15', '[0A4E923E/48h/1h/123h/2h]tpubDFNEWRT6uX3mjWE2c6CnbdQ7awvvnGub5s9ntaSyoQ4SSNmhHEc6RJ4Exwd2aLfGppDhvvey7gvYc7jiYfDFWtYG2sKXjKthhSs1X9yBkSy/<16;17>/*');
        this.defaultVariables.set('VaultKey16', '[0A4E923E/48h/1h/123h/2h]tpubDFNEWRT6uX3mjWE2c6CnbdQ7awvvnGub5s9ntaSyoQ4SSNmhHEc6RJ4Exwd2aLfGppDhvvey7gvYc7jiYfDFWtYG2sKXjKthhSs1X9yBkSy/<14;15>/*');
        this.defaultVariables.set('VaultKey17', '[0A4E923E/48h/1h/123h/2h]tpubDFNEWRT6uX3mjWE2c6CnbdQ7awvvnGub5s9ntaSyoQ4SSNmhHEc6RJ4Exwd2aLfGppDhvvey7gvYc7jiYfDFWtYG2sKXjKthhSs1X9yBkSy/<12;13>/*');
        this.defaultVariables.set('VaultKey18', '[0A4E923E/48h/1h/123h/2h]tpubDFNEWRT6uX3mjWE2c6CnbdQ7awvvnGub5s9ntaSyoQ4SSNmhHEc6RJ4Exwd2aLfGppDhvvey7gvYc7jiYfDFWtYG2sKXjKthhSs1X9yBkSy/<10;11>/*');
        this.defaultVariables.set('VaultKey19', '[0A4E923E/48h/1h/123h/2h]tpubDFNEWRT6uX3mjWE2c6CnbdQ7awvvnGub5s9ntaSyoQ4SSNmhHEc6RJ4Exwd2aLfGppDhvvey7gvYc7jiYfDFWtYG2sKXjKthhSs1X9yBkSy/<8;9>/*');
        
        // X-only vault keys for Taproot inheritance scenarios
        // Using user-provided x-only keys
        this.defaultVariables.set('VaultXOnly1', 'a3a3d9fe61d93ac31ec9699e0407b84e7f23c5bb638f0d755f6053646c1997df');
        this.defaultVariables.set('VaultXOnly2', '7a6f3dbd569d59ee017341b96166b4f7e3dafbb31ec2212656af2fd907ca8572');
        
        // Timeout keys for Lightning Channel scenarios (x-only keys)
        this.defaultVariables.set('DavidTimeout', 'd392b6f1f367f211f42f9f78b70b3b0b396ceee8d7b271f098d253ead0991d23');
        this.defaultVariables.set('HelenTimeout', '6807e6f3055807b9fac782114835be3627a6adbcf78624748eff45ab3ef05834');
        
        // Federation keys for Liquid Federation example (x-only for Taproot)
        // Using user-provided x-only keys
        this.defaultVariables.set('Fed1', 'bc2ee26fb95878c997c000b2fefb9d46cc83abf904214396a7c2c1ced8e1cbe2');
        this.defaultVariables.set('Fed2', 'd5d3a9a02cf7362288af2c602be92d81ac058b2aefa7e067ef6bb824814460d8');
        this.defaultVariables.set('Fed3', '6973ee26249a5bf1477f16b16676e26bc65fdae799c50f6b69e7a78f817525da');
        this.defaultVariables.set('Fed4', '1ea6a146008c42b2489cb90c33eb2760fe3442a1e6a43782819ec14f10fe2eda');
        this.defaultVariables.set('Fed5', '54311aa0b1046a7992a08cf5fd798ff22b913081b120fb0a4adab87af276071c');
        this.defaultVariables.set('Fed6', '3a810842fba0133e13a903567dc2c02bfe2b1b95fecc54dda12a1c0905bfb260');
        this.defaultVariables.set('Fed7', 'faa19fc368d13652b6152a4a52caf8a5fa45d07420783a956ccc6cf0e62ef3c8');
        
        // Emergency keys for Liquid Federation example (x-only for Taproot)
        this.defaultVariables.set('Emergency1', '475f47a4cf3d7bdf9115e0c982c17cab2cfe05d5c7a7771d1923bb1a03600e2b');
        this.defaultVariables.set('Emergency2', '2ae7ed98011ea2d21f750b1e096aea8ad6e214599543b2e46b031aa179d7ec03');
        this.defaultVariables.set('Emergency3', 'b0f78c954e7ab83fb9f0c858eb9c7c2d80782671c33fc0556b7dc3ded16a72d4');
        
        // Joint custody keys for 3-key joint custody example (compressed keys)
        // Using user-provided compressed keys
        this.defaultVariables.set('jcKey1', '03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556');
        this.defaultVariables.set('jcKey2', '025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357');
        this.defaultVariables.set('jcKey3', '03d30199d74fb5a22d47b6e054e2f378cedacffcb89904a61d75d0dbd407143e65');
        this.defaultVariables.set('saKey', '023da092f6980e58d2c037173180e9a465476026ee50f96695963e8efe436f54eb');
        this.defaultVariables.set('jcAg1', '03acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe');
        this.defaultVariables.set('jcAg2', '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9');
        this.defaultVariables.set('jcAg3', '03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd');
        this.defaultVariables.set('recKey1', '03defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34');
        this.defaultVariables.set('recKey2', '034cf034640859162ba19ee5a5a33e713a86e2e285b79cdaf9d5db4a07aa59f765');
        this.defaultVariables.set('recKey3', '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
        
        // Liana wallet descriptor keys for multi-tier recovery vault example
        this.defaultVariables.set('LianaDesc1', '[b883f127/48\'/1\'/2\'/2\']tpubDEP7MLK6TGe1EWhKGpMWdQQCvMmS6pRjCyN7PW24afniPJYdfeMMUb2fau3xTku6EPgA68oGuR4hSCTUpu2bqaoYrLn2UmhkytXXSzxcaqt/0/0');
        this.defaultVariables.set('LianaDesc2', '[636adf3f/48\'/1\'/2\'/2\']tpubDFnPUtXZhnftEFD5vg4LfVoApf5ZVB8Nkrf8CNe9pT9j1EEPXssJnMgAjmvbTChHugnkfVfsmGafFnE6gwoifJNybSasAJ316dRpsP86EFb/0/0');
        this.defaultVariables.set('LianaDesc3', '[b883f127/48\'/1\'/3\'/2\']tpubDFPMBua4idthySDayX1GxgXgPbpaEVfU7GwMc1HAfneknhqov5syrNuq4NVdSVWa2mPVP3BD6f2pGB98pMsbnVvWqrxcLgwv9PbEWyLJ6cW/0/0');
        this.defaultVariables.set('LianaDesc4', '[636adf3f/48\'/1\'/1\'/2\']tpubDDvF2khuoBBj8vcSjQfa7iKaxsQZE7YjJ7cJL8A8eaneadMPKbHSpoSr4JD1F5LUvWD82HCxdtSppGfrMUmiNbFxrA2EHEVLnrdCFNFe75D/0/0');
        this.defaultVariables.set('LianaDesc5', '[636adf3f/48\'/1\'/0\'/2\']tpubDEE9FvWbG4kg4gxDNrALgrWLiHwNMXNs8hk6nXNPw4VHKot16xd2251vwi2M6nsyQTkak5FJNHVHkCcuzmvpSbWHdumX3DxpDm89iTfSBaL/0/0');
        this.defaultVariables.set('LianaDesc6', '[b883f127/48\'/1\'/0\'/2\']tpubDET11c81MZjJvsqBikGXfn1YUzXofoYQ4HkueCrH7kE94MYkdyBvGzyikBd2KrcBAFZWDB6nLmTa8sJ381rWSQj8qFvqiidxqn6aQv1wrJw/0/0');
        this.defaultVariables.set('LianaDesc7', '[b883f127/48\'/1\'/1\'/2\']tpubDEA6SKh5epTZXebgZtcNxpLj6CeZ9UhgHGoGArACFE7QHCgx76vwkzJMP5wQ9yYEc6g9qSGW8EVzn4PhRxiFz1RUvAXBg7txFnvZFv62uFL/0/0');
    }

    addMissingDefaults() {
        // Use the shared defaultVariables map instead of calling getDefaultKeys()
        const existingValues = new Set([...this.keyVariables.values()]); // Get all current values
        let addedCount = 0;
        let skippedConflicts = 0;
        
        this.defaultVariables.forEach((defaultValue, keyName) => {
            // Only add if key name doesn't exist
            if (!this.keyVariables.has(keyName)) {
                // Check if the value conflicts with existing values
                if (existingValues.has(defaultValue)) {
                    console.log(`Skipping ${keyName}: value already exists for another key`);
                    skippedConflicts++;
                } else {
                    this.keyVariables.set(keyName, defaultValue);
                    existingValues.add(defaultValue); // Track the new value
                    addedCount++;
                    console.log(`Added missing default: ${keyName}`);
                }
            }
        });
        
        if (addedCount > 0 || skippedConflicts > 0) {
            console.log(`Smart merge completed: Added ${addedCount} new variables, skipped ${skippedConflicts} conflicts`);
            this.saveKeyVariables();
        }
        
        return addedCount > 0; // Return success if any were added
    }

    compareVersions(v1, v2) {
        // Compare version strings like "1.1.0" vs "1.2.0"
        // Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const part1 = parts1[i] || 0;
            const part2 = parts2[i] || 0;
            if (part1 < part2) return -1;
            if (part1 > part2) return 1;
        }
        return 0;
    }

    addDefaultKeys() {
        // Default keys used in examples - using appropriate key types for different contexts
        
        // Legacy/Segwit keys (compressed, 66-char, starting with 02/03) - for general examples
        // Seed from shared defaultVariables map (single source of truth)
        for (const [keyName, keyValue] of this.defaultVariables.entries()) {
            this.keyVariables.set(keyName, keyValue);
        }
        
        this.saveKeyVariables();
        this.displayKeyVariables();
    }

    restoreDefaultKeys() {
        if (confirm('This will restore 70 default key variables: Alice, Bob, Charlie, Eva, Frank, Lara, Helen, Ivan, Julia, Karl, David, Mike, Nina, Oliver, Paul, Quinn, Rachel, Sam, Tina, Uma, plus joint custody keys (jcKey1, jcKey2, jcKey3, saKey, jcAg1, jcAg2, jcAg3, recKey1, recKey2, recKey3), plus descriptor keys (TestnetKey, MainnetKey, RangeKey, VaultKey1-19), plus X-only vault keys (VaultXOnly1, VaultXOnly2), plus timeout keys (DavidTimeout, HelenTimeout), plus federation keys (Fed1-7), plus emergency keys (Emergency1-3), plus Liana wallet keys (LianaDesc1-7). Continue?')) {
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
                    // Special handling for multi() and multi_a() - split the variable list
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
            // multi(threshold,VarName1,VarName2,...) and multi_a(threshold,VarName1,VarName2,...)
            /\b(?:multi|multi_a)\([0-9]+,([A-Za-z_][A-Za-z0-9_,\s]*)\)/g
        ];
        
        const foundVariables = new Set();
        
        for (const pattern of variablePatterns) {
            let match;
            while ((match = pattern.exec(expression)) !== null) {
                if (pattern.source.includes('multi')) {
                    // Special handling for multi() and multi_a() - split the variable list
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
                const suggestedType = this.suggestKeyTypeForContext();
                console.log(`Adding variable ${variable} with suggested type: ${suggestedType}`);
                keys.push({
                    value: variable,
                    type: 'variable',
                    isDefault: true, // Variables are selected by default
                    suggestedType: suggestedType // Default key type based on current context
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
        // Get current context from radio buttons - check miniscript context first (for miniscript extraction)
        const miniscriptContextRadio = document.querySelector('input[name="context"]:checked');
        const policyContextRadio = document.querySelector('input[name="policy-context"]:checked');
        
        // Use miniscript context if available, otherwise policy context
        const context = miniscriptContextRadio ? miniscriptContextRadio.value : 
                       (policyContextRadio ? policyContextRadio.value : 'segwit');
        
        console.log('Detected context for key extraction:', context);
        
        // Suggest appropriate key type for context
        // X-only keys for ANY taproot context
        if (context.includes('taproot')) {
            console.log('Suggesting x-only keys for taproot context');
            return 'x-only';
        }
        
        // Compressed keys for legacy and segwit
        console.log('Suggesting compressed keys for non-taproot context');
        return 'compressed';
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
                'a3a3d9fe61d93ac31ec9699e0407b84e7f23c5bb638f0d755f6053646c1997df',
                '7a6f3dbd569d59ee017341b96166b4f7e3dafbb31ec2212656af2fd907ca8572',
                'd392b6f1f367f211f42f9f78b70b3b0b396ceee8d7b271f098d253ead0991d23',
                '6807e6f3055807b9fac782114835be3627a6adbcf78624748eff45ab3ef05834',
                'bc2ee26fb95878c997c000b2fefb9d46cc83abf904214396a7c2c1ced8e1cbe2',
                'd5d3a9a02cf7362288af2c602be92d81ac058b2aefa7e067ef6bb824814460d8',
                '6973ee26249a5bf1477f16b16676e26bc65fdae799c50f6b69e7a78f817525da',
                '1ea6a146008c42b2489cb90c33eb2760fe3442a1e6a43782819ec14f10fe2eda',
                '54311aa0b1046a7992a08cf5fd798ff22b913081b120fb0a4adab87af276071c',
                '3a810842fba0133e13a903567dc2c02bfe2b1b95fecc54dda12a1c0905bfb260',
                'faa19fc368d13652b6152a4a52caf8a5fa45d07420783a956ccc6cf0e62ef3c8',
                '475f47a4cf3d7bdf9115e0c982c17cab2cfe05d5c7a7771d1923bb1a03600e2b',
                '2ae7ed98011ea2d21f750b1e096aea8ad6e214599543b2e46b031aa179d7ec03',
                'b0f78c954e7ab83fb9f0c858eb9c7c2d80782671c33fc0556b7dc3ded16a72d4',
                'e2bbd26b5f191ef157220e7a0d12c617639b5689aa3fabb652a9a3714a03ead4',
                '1e42ec3b91786fe0f2a96f50f0b38b92629b2f45f0d0e2ac51a8b0087377ca12',
                'fd3d63a4221d8f6c32709c893109f6a57f24258a4b43780174cdd106e3f61df6',
                'a37059fdb73c1971372f00b2ace2adaf8dddfcd7a0322e6e2c5ab96d84116f0b',
                'a8a7479a38cd3c291599cbc4c8f44bbb4078d05e014699ca9860df22f1f6203a',
                'ea85fef522b648c8525f913d50348b555093d64871439862789746c9901c484f',
                '70bdbf8ea4d5e36e91f3a05f864d9425703e31db6458ed43816e11b4430ad156',
                '6485993fe4fd4abc3d7d12ab6366ce431699b48661a16d499bcbfa4601ed4e3f',
                '75332ee973fe08ba83d03587de45b2ab5d02fb80015036623d97fbc06c5ac3c1',
                '0352bed66a6cf595c3e2adcdc751b6e3c0673acc2290a5334eeeba831d728b4a',
                '38918a29f4ae72699eb5b37160b850e18d7f1a23fda9755490143e03a2221e27',
                'd24c4047f6c73b00b619c757d1abd797fb440f6ad310a243fa3411773403d416',
                '09d760b0f253df4aa988d5294b06e9e9f3919f25decd0b10ae37139a280cfa9c',
                '205966f31cd4bab0d7c4a1d375c580b0293a2e40dff73c4ad3c132ea5d914577',
                'f14579c13316f603f95829ad4e7a812eea3a397b5c8f1bfe8540f21fde298d87',
                'fd4a3eac167dff950d66d47bb7ec076945a73edcf73a02e8f4de23f36de84bc6',
                'e12140d67080141bf903661569241a92c38defb17f60e88f49cbc8013486b93f',
                'e8b7c6f6dd065c7610640f5c73f8879173c1dd7c3479ff614b85f73b16c7da34',
                'f17c345219018fcb6b291f7a6ff0c43e78194b7ed8c800eb5f9658031c406257',
                '5637591c5e67043175acb7b1e43a3bed757f93d6a417503ed5e47da1ce49ee04',
                'f45580854a575d9849fe0fc63b6a3ccdc9f575c22f29bc25904656f5309dfc38',
                '470f1a0444b01a9a99ea732f1b0c6efb5105c86ea51d366bf02f623cf82ffb17',
                '2c8dd3a08b2b3db00db86385f387fbaa339055d9d721d394489239775ba24eec',
                '9d289e56cf2949c11a298570f0ccdbce5ea7e45d73d6ae740edbb70656f107ed',
                'da91cfd22366a1b1348c6e664d2d5d573b882ce3cac794d4cfbed0eeef3a9222',
                'cd1e443ecabdf030256b158018d5b06956d7b12f2142e3d539536d86ae8d88d6',
                '55e9394572f998cb85a824bbe5845f4e6f02127b3c875eedf4bcd357388e56b6',
                '047c8ffec24585e45518d913b1cbb60fbc586c2295c01f1de3c9b1a8b0f9e5ed',
                '8b4a352170c60173797320f715848d8034ae4edc341330cae66328853c6060b7',
                '609134981b05b2774fee31f354fb29545a21ddb47acea399aa68c83cc1467797',
                'b6ae2990fa177a6427796130a08f450ec618922659dc2dc5a21fe2887e40bb04',
                '0157901a7c651d67445ab927bffee90dbf6667580b4f4fe512e3bbcecea9dbc6',
                '13a25e15b38d361e794a30f02cd845cfc5e06f89aa5439645354681d7924155d',
                '776000a6eb83088d6019abbeee41949e5ac51718b565968e4d0b9b8689c80c6d',
                '2f889067e0fea526c70c7bc8ea3b022199a59d77d8d4fd79319559bc8bc32250',
                '093a2ea20de202d9ce8c4e14868b1a952d7c3130ab90a287d5f7b8ed427a09db',
                'fe17129ee7517f06d90e80b42eb7307471a701a28ce80be044ccb6fd60f77af4',
                '0e096bf8395d5bd101f2aa8d0d836020df593abe0ffc51dc7c4dce82e42d02bf',
                '21a8f84b84c2d925651a151c38179c984f78b17541f244bd3806612b5b5d81c6',
                '69483624d610f703315563932debae12ea541d8ea50c7f2de9030f096c6cf8f6',
                '2754ad8b203856331eac1087905ea916f8b71dbda5df95cf2ee561006cbe0cf3',
                'ebd0571cb4e49c4d459fceea4d0767fc46832c986493c2e3526448154be412aa',
                '92ceee56b2189cbea7568a7d500673e8baa72958ac95b74e854305f589a95a40',
                'c5c82d657eb3a51013b2ba28df1686cff3cdde896a793ca07ae3415dde5d7db2',
                '52c98024feca5596ef686e22042f6e9f750eadaf3ceb0930644823069b65ea92',
                '95b870e26464797b20d7eb59af2b4a04d31f727b9bfa496e72e029c1634a47b1'
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
                    ${keyObj.type === 'variable' && !isExisting ? (() => {
                        console.log(`Variable ${keyObj.value} has suggestedType: ${keyObj.suggestedType}`);
                        return `
                    <label style="color: var(--text-secondary); min-width: 40px;">Type:</label>
                    <select id="extract-type-${index}" 
                            style="padding: 6px; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);">
                        <option value="compressed" ${keyObj.suggestedType === 'compressed' ? 'selected' : ''}>Compressed (66 chars)</option>
                        <option value="x-only" ${keyObj.suggestedType === 'x-only' ? 'selected' : ''}>X-Only (64 chars)</option>
                        <option value="xpub" ${keyObj.suggestedType === 'xpub' ? 'selected' : ''}>xpub (mainnet)</option>
                        <option value="tpub" ${keyObj.suggestedType === 'tpub' ? 'selected' : ''}>tpub (testnet)</option>
                    </select>`;
                    })() : ''}
                </div>
            `;
            
            listDiv.appendChild(itemDiv);
        });
        
        // Show warning if some keys already exist
        if (existingKeys.length > 0) {
            errorDiv.style.display = 'block';
            errorDiv.style.background = 'var(--error-bg, #FED7D7)';
            errorDiv.style.borderColor = 'var(--error-border, #F87171)';
            errorDiv.style.color = 'var(--error-text, #991B1B)';
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
        button.title = 'Analyzing...';

        try {
            // Get the current context and normalize taproot variants
            let context = document.querySelector('input[name="context"]:checked').value;
            if (context.startsWith('taproot')) {
                context = 'taproot';
            }

            // Replace any key variable names with their actual values before analyzing
            let processedMiniscript = miniscript;
            if (this.keyVariables.size > 0) {
                for (const [keyName, keyValue] of this.keyVariables.entries()) {
                    // Replace key names with hex values
                    const regex = new RegExp(`\\b${keyName}\\b`, 'g');
                    processedMiniscript = processedMiniscript.replace(regex, keyValue);
                }
            }

            // Analyze miniscript (includes lift to policy)
            const result = analyze_miniscript(processedMiniscript, context);

            // Reset button
            button.innerHTML = originalText;
            button.disabled = false;
            button.title = 'Lift to Policy for Analysis';

            if (result.success) {
                // Load the policy into the policy editor
                if (result.spending_logic) {
                    let displayPolicy = result.spending_logic;
                    if (this.keyVariables.size > 0) {
                        displayPolicy = this.replaceKeysWithNames(displayPolicy);
                    }

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

                    // Sync policy context with miniscript context
                    const miniscriptContext = document.querySelector('input[name="context"]:checked').value;
                    let policyContext = miniscriptContext;
                    // Map taproot variants to base taproot for policy
                    if (miniscriptContext.startsWith('taproot')) {
                        policyContext = 'taproot';
                    }
                    const policyContextRadio = document.querySelector(`input[name="policy-context"][value="${policyContext}"]`);
                    if (policyContextRadio) {
                        policyContextRadio.checked = true;
                    }

                    // Set policyLifted flag to indicate this policy was lifted from miniscript
                    this.policyLifted = true;
                }

                // Display analysis in policy area with warning
                this.displayAnalysisResult(result, true); // true = show warning, default target is policy-errors
            } else {
                this.showMiniscriptError(`Cannot analyze miniscript: ${result.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Analysis error:', error);
            button.innerHTML = originalText;
            button.disabled = false;
            button.title = 'Lift to Policy for Analysis';
            this.showMiniscriptError(`Analysis failed: ${error.message}`);
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
                
                console.log('Lifted to Miniscript:', miniscriptResult.miniscript);
                this.showSuccess('✅ Lifted to Miniscript!');
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
            button.title = 'Lift to Miniscript';
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
                    <button id="lift-hex-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Lift to Miniscript" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
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
                    <button id="lift-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Lift to Miniscript" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
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
            <div id="address-display" style="word-break: break-all; font-family: 'Consolas', 'Courier New', monospace; font-size: 14px; background: var(--input-bg); padding: 10px; border-radius: 4px; border: 1px solid var(--border-color); color: var(--text-muted); font-style: italic;">
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

        // Remove all children except derivation field (to preserve event listeners)
        const existingDerivationField = resultsDiv.querySelector('.derivation-container');

        // Remove all children first
        while (resultsDiv.firstChild) {
            if (resultsDiv.firstChild === existingDerivationField) {
                // Skip the derivation field, don't remove it
                break;
            }
            resultsDiv.removeChild(resultsDiv.firstChild);
        }

        // Remove remaining non-derivation children after the derivation field
        const children = Array.from(resultsDiv.children);
        children.forEach(child => {
            if (!child.classList.contains('derivation-container')) {
                resultsDiv.removeChild(child);
            }
        });

        if (existingDerivationField) {
            console.log('💾 Preserved derivation field with event listeners intact');
        }

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
                        <button id="lift-hex-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Lift to Miniscript" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
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

            // Insert derivation field before hex field if it exists but isn't already positioned
            const existingDerivationField = resultsDiv.querySelector('.derivation-container');
            if (existingDerivationField && !this.isDerivationFieldBeforeHex(resultsDiv)) {
                console.log('📍 Moving derivation field before hex field');
                // Remove from current position and insert before hex
                existingDerivationField.remove();
                resultsDiv.appendChild(existingDerivationField);
            }

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
                        <button id="lift-script-btn" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Lift to Miniscript" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
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
                <div id="address-display" style="word-break: break-all; font-family: 'Consolas', 'Courier New', monospace; font-size: 14px; background: var(--input-bg); padding: 10px; border-radius: 4px; border: 1px solid var(--border-color);" data-placeholder="Address will appear here after compilation">
                    ${result.address}
                </div>
            `;
            
            // Store script info for network switching
            const addressDisplay = addressDiv.querySelector('#address-display');
            addressDisplay.dataset.scriptHex = result.script;
            addressDisplay.dataset.scriptType = result.miniscript_type || 'Unknown';
            // Store the original miniscript (with key names) and mode for taproot network switching
            addressDisplay.dataset.miniscript = result.processedMiniscript || '';
            addressDisplay.dataset.originalExpression = this.originalExpression || '';
            addressDisplay.dataset.taprootMode = result.taprootMode || 'single-leaf';
            
            // Debug logging
            console.log('STORED DATA FOR NETWORK TOGGLE:');
            console.log('- scriptType:', result.miniscript_type);
            console.log('- originalExpression:', this.originalExpression);
            console.log('- processedMiniscript:', result.processedMiniscript);
            console.log('- taprootMode:', result.taprootMode);
            console.log('- currentTaprootMode:', window.currentTaprootMode);
            
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

        // Add derivation index field if needed
        this.addDerivationIndexField();

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

    // Method to compile miniscript with debug info enabled
    compileMiniscriptWithDebug(expression, context) {
        try {
            // Capitalize context to match WASM expectations
            const capitalizedContext = context.charAt(0).toUpperCase() + context.slice(1);

            const options = {
                input_type: 'Miniscript',
                context: capitalizedContext,
                mode: capitalizedContext === 'Taproot' ? 'SingleLeaf' : 'Default',
                network_str: 'bitcoin',
                nums_key: '',
                verbose_debug: true  // Always enable debug for this method
            };

            const result = compile_unified(expression, options);
            return result;
        } catch (error) {
            console.error('Debug compilation failed:', error);
            throw error;
        }
    }

    formatDebugInfo(result) {
        let debugText = '';

        // Compilation Overview
        debugText += '=== COMPILATION OVERVIEW ===\n\n';

        // For key-only Taproot (single-leaf mode with pk(KEY)), show simplified descriptor
        let displayCompiledMiniscript = result.compiled_miniscript || 'N/A';
        if (result.miniscript_type === 'Taproot' && result.taprootMode === 'single-leaf' && result.compiled_miniscript) {
            // Check if this is a key-only descriptor: tr(NUMS,pk(KEY))#checksum
            const keyOnlyMatch = result.compiled_miniscript.match(/^tr\([^,]+,pk\(([^)]+)\)\)(#[a-z0-9]+)?(\|LEAF_ASM:.*)?$/);
            if (keyOnlyMatch) {
                // Transform tr(NUMS,pk(KEY))#checksum|LEAF_ASM:... to tr(KEY)#checksum
                const key = keyOnlyMatch[1];
                const checksum = keyOnlyMatch[2] || '';
                displayCompiledMiniscript = `tr(${key})${checksum}`;
            }
        }

        debugText += `Compiled Miniscript: ${displayCompiledMiniscript}\n`;
        debugText += `Sanity Check: ${result.sanity_check ? 'PASS' : 'FAIL'}\n`;
        debugText += `Malleability: ${result.is_non_malleable ? 'Non-malleable' : 'Malleable'}\n`;
        debugText += `Miniscript Type: ${result.miniscript_type || 'N/A'}\n\n`;

        // Key Path Spending Info for Taproot with internal key (not NUMS)
        // Only show for 'multi-leaf' mode (Taproot Key path + script path context)
        const descriptorMatch = result.compiled_miniscript?.match(/^tr\(([^,]+)/);
        const internalKey = descriptorMatch ? descriptorMatch[1] : null;
        const hasInternalKey = internalKey && internalKey !== CONSTANTS.NUMS_KEY;

        if (result.miniscript_type === 'Taproot' && hasInternalKey && result.taprootMode === 'multi-leaf') {
            debugText += '=== KEY PATH SPENDING (Most Efficient) ===\n\n';

            debugText += `Internal Key: ${internalKey}\n`;
            debugText += 'Spending Method: Schnorr signature with tweaked public key\n';
            debugText += 'Total Weight: 66 WU (67 with sighash byte)\n\n';

            debugText += 'Breakdown:\n';
            debugText += '   Signature: 64 bytes (Schnorr)\n';
            debugText += '   Sighash byte: 1 byte\n';
            debugText += '   Witness count: 1 byte (varint)\n';
            debugText += '   Control Block: Not required ✓\n';
            debugText += '   Script: Not required ✓\n\n';

            // Calculate script path costs for comparison (if we have per-leaf info)
            if (result.debug_info_leaves && result.debug_info_leaves.length > 0) {
                debugText += 'Key Path vs Script Path Comparison:\n';
                debugText += '   Key Path:        66 WU (cheapest option)\n';

                result.debug_info_leaves.forEach((leaf, index) => {
                    const ext = leaf.debug_info?.extended_properties;
                    if (ext) {
                        // Estimate script path cost: signature (66 WU) + script size + control block (~34 WU)
                        const scriptSize = ext.pk_cost || 0;
                        const scriptPathCost = 66 + scriptSize + 34;
                        const percentIncrease = Math.round(((scriptPathCost - 66) / 66) * 100);
                        debugText += `   Script Path #${index + 1}:  ${scriptPathCost} WU (+${percentIncrease}% more expensive)\n`;
                    }
                });

                debugText += '\n';
            }
        }

        // Extended Properties from rust-miniscript library
        if (result.debug_info && result.debug_info.extended_properties) {
            const ext = result.debug_info.extended_properties;
            debugText += '=== MINISCRIPT ANALYSIS ===\n\n';

            // Script Properties
            debugText += 'Script Properties:\n';
            debugText += `   Has Mixed Timelocks: ${ext.has_mixed_timelocks ? '⚠️ Yes (potential conflict)' : '✓ No (safe)'}\n`;
            debugText += `   Has Repeated Keys: ${ext.has_repeated_keys ? '⚠️ Yes (suboptimal)' : '✓ No (optimized)'}\n`;
            debugText += `   Requires Signature: ${ext.requires_sig ? '✓ Yes (secure)' : '⚠️ No (may be insecure)'}\n`;
            debugText += `   Within Resource Limits: ${ext.within_resource_limits ? '✓ Yes (consensus-valid)' : '❌ No (exceeds limits)'}\n`;
            if (ext.contains_raw_pkh !== undefined && ext.contains_raw_pkh !== null) {
                debugText += `   Contains Raw PKH: ${ext.contains_raw_pkh ? '⚠️ Yes' : '✓ No'} (Legacy only)\n`;
            }
            debugText += '\n';

            // Script Analysis (raw values only from rust-miniscript)
            if (ext.pk_cost !== null || ext.ops_count_static !== null || ext.stack_elements_sat !== null) {
                debugText += 'Script Analysis:\n';

                if (ext.ops_count_static !== null && ext.ops_count_static !== undefined) {
                    debugText += `   Opcode Count: ${ext.ops_count_static}\n`;
                }

                if (ext.pk_cost !== null && ext.pk_cost !== undefined) {
                    debugText += `   Script Size: ${ext.pk_cost} bytes\n`;
                }

                debugText += '\n';
            }

        }

        // Script Output
        if (result.script) {
            debugText += '=== SCRIPT OUTPUT ===\n\n';
            debugText += `Script (hex): ${result.script}\n`;
            if (result.script_asm) {
                debugText += `Script ASM: ${result.script_asm}\n`;
            }
            if (result.address) {
                debugText += `Address: ${result.address}\n`;
            }
            debugText += '\n';
        }

        // For key-only Taproot (single-leaf mode with pk(KEY)), skip the rest of debug info
        if (result.miniscript_type === 'Taproot' && result.taprootMode === 'single-leaf' && result.compiled_miniscript) {
            const keyOnlyMatch = result.compiled_miniscript.match(/^tr\([^,]+,pk\(([^)]+)\)\)(#[a-z0-9]+)?(\|LEAF_ASM:.*)?$/);
            if (keyOnlyMatch) {
                // This is key-only Taproot - return here, skip the rest
                return debugText;
            }
        }

        // Miniscript Structure with enhanced parsing
        debugText += '=== MINISCRIPT STRUCTURE & TYPE SYSTEM ===\n\n';
        if (result.debug_info && result.debug_info.raw_output) {
            // Extract the meaningful parts of the debug output
            const rawOutput = result.debug_info.raw_output;

            // Extract the complete annotated expression - look for line starting with [type]
            // This captures the full expression from RUST-MINISCRIPT DEBUG OUTPUT
            const fullExpressionMatch = rawOutput.match(/^\[([BVWKonduesfmz/]+)\][^\n]+.*$/m);

            if (fullExpressionMatch) {
                const fullExpression = fullExpressionMatch[0];
                debugText += `Annotated Miniscript (with type annotations):\n${fullExpression}\n\n`;
            }

            // Extract original expression from EXPRESSION INFO section
            const expressionInfoMatch = rawOutput.match(/Expression:\s*([^\n]+)/);
            if (expressionInfoMatch) {
                debugText += `Original Expression:\n${expressionInfoMatch[1].trim()}\n\n`;
            }

            // Extract context
            const contextMatch = rawOutput.match(/Context:\s*([^\n]+)/);
            if (contextMatch) {
                debugText += `Context: ${contextMatch[1].trim()}\n\n`;
            }

            // Extract type annotations with better parsing
            const typeMatches = rawOutput.match(/\[([BVWKonduesfmz/]+)\]/g);
            if (typeMatches) {
                const uniqueTypes = [...new Set(typeMatches)];
                debugText += `Type Annotations Found: ${uniqueTypes.join(', ')}\n\n`;

                // Analyze the types for insights
                const hasBaseType = uniqueTypes.some(t => t.includes('B'));
                const hasVerifyType = uniqueTypes.some(t => t.includes('V'));
                const hasKeyType = uniqueTypes.some(t => t.includes('K'));
                const isSafe = uniqueTypes.some(t => t.includes('s'));
                const isNonMalleable = uniqueTypes.some(t => t.includes('m'));
                const isForced = uniqueTypes.some(t => t.includes('f'));

                debugText += `Type Analysis:\n`;
                debugText += `   [B] Base type: ${hasBaseType ? 'Present' : 'Not present'} - Complete script fragment\n`;
                debugText += `   [V] Verify type: ${hasVerifyType ? 'Present' : 'Not present'} - Always leaves 1 on stack or fails\n`;
                debugText += `   [K] Key type: ${hasKeyType ? 'Present' : 'Not present'} - Raw public key (rare)\n`;
                debugText += `   [W] Wrapper type: Not present - Must be wrapped to be used\n\n`;
                debugText += `Properties:\n`;
                debugText += `   [s] Safe: ${isSafe ? 'Yes' : 'No'} - Cannot be malleated\n`;
                debugText += `   [f] Forced: ${isForced ? 'Yes' : 'No'} - Must satisfy if parent satisfies\n`;
                debugText += `   [m] Bounded: ${isNonMalleable ? 'Yes' : 'No'} - Max satisfaction size is bounded\n\n`;
            }

        } else {
            debugText += `Miniscript: ${result.compiled_miniscript || 'N/A'}\n`;
            debugText += `Note: Compile with verbose debug mode for detailed structure analysis.\n\n`;
        }

        // Type System Reference
        debugText += '=== TYPE SYSTEM REFERENCE ===\n\n';
        debugText += `Miniscript uses a sophisticated type system to ensure script correctness:\n\n`;
        debugText += `Core Types:\n`;
        debugText += `   [B] Base - Complete script fragment\n`;
        debugText += `   [V] Verify - Always leaves 1 on stack or fails\n`;
        debugText += `   [W] Wrapper - Must be wrapped to be used\n\n`;
        debugText += `Properties:\n`;
        debugText += `   [o] One-arg - Consumes exactly one stack element\n`;
        debugText += `   [z] Zero-arg - Requires no stack arguments\n`;
        debugText += `   [n] Non-zero - Always produces non-zero result\n`;
        debugText += `   [d] Dissatisfiable - Can be provably false\n`;
        debugText += `   [u] Unit - Cleanly consumes inputs\n`;
        debugText += `   [s] Safe - Cannot be malleated\n`;
        debugText += `   [f] Forced - Must satisfy if parent satisfies\n`;
        debugText += `   [e] Expression - Valid Bitcoin script\n`;
        debugText += `   [m] Max-size - Bounded satisfaction size\n\n`;

        // Examples section
        // Per-leaf debug info for Taproot multi-leaf trees
        if (result.debug_info_leaves && result.debug_info_leaves.length > 0) {
            debugText += '=== TAPROOT SCRIPT PATHS DEBUG INFO (Per-Leaf) ===\n\n';
            debugText += `Total Leaves: ${result.debug_info_leaves.length}\n\n`;

            result.debug_info_leaves.forEach((leaf, index) => {
                debugText += `--- Leaf ${index + 1} (Depth: ${leaf.depth}) ---\n\n`;
                debugText += `Script: ${leaf.script}\n`;
                if (leaf.script_asm) {
                    debugText += `ASM: ${leaf.script_asm}\n`;
                }
                if (leaf.script_hex) {
                    debugText += `HEX: ${leaf.script_hex}\n`;
                }
                debugText += '\n';

                // Extended properties for this leaf
                if (leaf.debug_info && leaf.debug_info.extended_properties) {
                    const ext = leaf.debug_info.extended_properties;

                    debugText += 'Script Properties:\n';
                    debugText += `   Has Mixed Timelocks: ${ext.has_mixed_timelocks ? '⚠️ Yes' : '✓ No'}\n`;
                    debugText += `   Has Repeated Keys: ${ext.has_repeated_keys ? '⚠️ Yes' : '✓ No'}\n`;
                    debugText += `   Requires Signature: ${ext.requires_sig ? '✓ Yes' : '⚠️ No'}\n`;
                    debugText += `   Within Resource Limits: ${ext.within_resource_limits ? '✓ Yes' : '❌ No'}\n`;
                    debugText += '\n';

                    // Script analysis for this leaf
                    debugText += 'Script Analysis:\n';
                    if (ext.ops_count_static !== null && ext.ops_count_static !== undefined) {
                        debugText += `   Opcode Count: ${ext.ops_count_static}\n`;
                    }
                    if (ext.pk_cost !== null && ext.pk_cost !== undefined) {
                        debugText += `   Script Size: ${ext.pk_cost} bytes\n`;
                    }
                    debugText += '\n';
                }

                // Annotated miniscript with type annotations for this leaf
                if (leaf.debug_info && leaf.debug_info.raw_output) {
                    const rawOutput = leaf.debug_info.raw_output;

                    // Extract the full annotated expression from the debug output
                    // This captures the complete expression with all type annotations embedded
                    const fullExpressionMatch = rawOutput.match(/^\[([BVWKonduesfmz/]+)\][^\n]+.*$/m);

                    if (fullExpressionMatch) {
                        const fullExpression = fullExpressionMatch[0];
                        debugText += 'Annotated Miniscript (with type annotations):\n';
                        debugText += fullExpression + '\n\n';
                    } else {
                        // Fallback: just show the type if we can't extract the full expression
                        const typeMatch = rawOutput.match(/^\[([BVWKonduesfmz/]+)\]/m);
                        if (typeMatch) {
                            debugText += `Type: ${typeMatch[0]}\n\n`;
                        }
                    }
                }
            });
        }

        debugText += '=== TYPE EXAMPLES ===\n\n';
        debugText += `Example 1: pk(key) has type [B/onduesm]\n`;
        debugText += `   [B] = Base type - can be used as complete script\n`;
        debugText += `   [o] = One-arg - consumes one stack element (signature)\n`;
        debugText += `   [n] = Non-zero - always produces non-zero result when satisfied\n`;
        debugText += `   [d] = Dissatisfiable - can be proven false (no signature provided)\n`;
        debugText += `   [u] = Unit - cleanly consumes its inputs\n`;
        debugText += `   [e] = Expression - can be compiled to valid Bitcoin script\n`;
        debugText += `   [s] = Safe - cannot be malleated by third parties\n`;
        debugText += `   [m] = Max-size - satisfaction size is bounded\n\n`;

        debugText += `Example 2: thresh(2,pk(A),pk(B),pk(C)) has type [B/onduesm]\n`;
        debugText += `   Same properties as pk() but requires 2 out of 3 signatures\n`;
        debugText += `   The threshold makes it dissatisfiable and bounded in size\n\n`;

        debugText += `Example 3: sha256(H) has type [B/fsm]\n`;
        debugText += `   [B] = Base type\n`;
        debugText += `   [f] = Forced - must be satisfied if parent is satisfied\n`;
        debugText += `   [s] = Safe - cannot be malleated\n`;
        debugText += `   [m] = Max-size - satisfaction size is bounded (just the preimage)\n`;
        debugText += `   Note: Not [d] because it cannot be dissatisfied (preimage required)\n\n`;

        return debugText;
    }

    addDerivationIndexField() {
        console.log('🔍 addDerivationIndexField() CALLED');

        // Check if the miniscript expression has wildcards (ends with *)
        const expressionInput = document.getElementById('expression-input');
        const currentExpression = expressionInput ? expressionInput.textContent.trim() : '';

        console.log('=== DERIVATION INDEX DETECTION ===');
        console.log('Current expression:', currentExpression);
        console.log('Expression length:', currentExpression.length);

        // Check for wildcards in multiple formats:
        // 1. In show key names mode: pk(VaultKey1) where VaultKey1 contains /*
        // 2. In hide key names mode: pk([fingerprint/path]xpub.../*)
        // 3. Any wildcard pattern: /*), /*)), /*),), etc.
        let hasWildcardDescriptor = false;

        // Show derivation index for:
        // - Simple wildcards: /* (single level wildcard), /1/* (path followed by wildcard)
        // - Multipath descriptors: <0;1>/*, <12;13>/*, etc. with external/change selection
        if (/\/\*[),]*/.test(currentExpression) || /<\d+;\d+>\/\*/.test(currentExpression)) {
            hasWildcardDescriptor = true;
        }

        console.log('Has wildcard descriptor:', hasWildcardDescriptor);

        // Check if any key variables contain wildcards (for show key names mode)
        if (!hasWildcardDescriptor && this.keyVariables) {
            // Extract key names from expressions like pk(VaultKey1)
            const keyNameMatches = currentExpression.match(/pk\(([^)]+)\)|pkh\(([^)]+)\)/g);
            if (keyNameMatches) {
                for (const match of keyNameMatches) {
                    const keyName = match.match(/pk\(([^)]+)\)|pkh\(([^)]+)\)/)[1] || match.match(/pk\(([^)]+)\)|pkh\(([^)]+)\)/)[2];
                    if (keyName && this.keyVariables.has(keyName)) {
                        const keyValue = this.keyVariables.get(keyName);
                        // Show for wildcards including multipath patterns
                        if (keyValue && (keyValue.includes('/*') || /<\d+;\d+>\/\*/.test(keyValue))) {
                            hasWildcardDescriptor = true;
                            break;
                        }
                    }
                }
            }
        }

        const resultsDiv = document.getElementById('results');

        if (hasWildcardDescriptor) {
            // Check if current expression has multipath patterns (do this first)
            const hasMultipath = /<\d+;\d+>\/\*[),]*/.test(currentExpression);
            let hasMultipathInKeyVars = false;
            if (!hasMultipath && this.keyVariables) {
                const keyNameMatches = currentExpression.match(/pk\(([^)]+)\)|pkh\(([^)]+)\)/g);
                if (keyNameMatches) {
                    for (const match of keyNameMatches) {
                        const keyName = match.match(/pk\(([^)]+)\)|pkh\(([^)]+)\)/)[1] || match.match(/pk\(([^)]+)\)|pkh\(([^)]+)\)/)[2];
                        if (keyName && this.keyVariables.has(keyName)) {
                            const keyValue = this.keyVariables.get(keyName);
                            if (keyValue && /<\d+;\d+>\/\*/.test(keyValue)) {
                                hasMultipathInKeyVars = true;
                                break;
                            }
                        }
                    }
                }
            }

            const showPathSelection = hasMultipath || hasMultipathInKeyVars;

            // Check if derivation field container already exists
            let existingDerivationDiv = resultsDiv.querySelector('.derivation-container');
            let derivationDiv;

            // Store current user values before updating
            let currentIndex = '';
            let currentPathType = 'external';

            if (existingDerivationDiv) {
                console.log('Derivation field exists, checking if update needed');
                console.log('Current expression:', currentExpression);
                console.log('hasMultipath:', hasMultipath);
                console.log('hasMultipathInKeyVars:', hasMultipathInKeyVars);
                console.log('showPathSelection:', showPathSelection);

                const indexInput = existingDerivationDiv.querySelector('#derivation-index');
                const pathSelect = existingDerivationDiv.querySelector('#derivation-path-type');

                if (indexInput) currentIndex = indexInput.value;
                if (pathSelect) currentPathType = pathSelect.value;

                console.log('Current values - index:', currentIndex, 'pathType:', currentPathType);

                derivationDiv = existingDerivationDiv;

                // Check if field configuration needs to change
                const currentlyHasPathSelect = !!pathSelect;
                const nowNeedsPathSelect = showPathSelection;

                console.log('Field config check - currentlyHas:', currentlyHasPathSelect, 'nowNeeds:', nowNeedsPathSelect);

                if (currentlyHasPathSelect === nowNeedsPathSelect) {
                    console.log('🎯 Field configuration unchanged, skipping HTML recreation');
                    return; // Skip the rest of the function - field is already correct
                } else {
                    console.log('🔄 Field configuration changed, updating HTML');
                }
            } else {
                console.log('Creating new derivation field');
                derivationDiv = document.createElement('div');
                derivationDiv.className = 'result-box info derivation-container';
            }

            derivationDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <h4 style="margin: 0; font-size: 12px; letter-spacing: 0.5px;">🗝️ Derivation index</h4>
                </div>
                <div style="margin-bottom: 10px;">
                    <p style="margin: 0; font-size: 11px; color: var(--text-secondary); line-height: 1.3;">For range descriptors with wildcard patterns (/*) ${showPathSelection ? 'and multipath patterns (<0;1>/*)' : ''}, ${showPathSelection ? 'choose path type and ' : ''}enter a specific index to derive keys and generate addresses${showPathSelection ? '. External uses the lower value, change uses the higher value from the multipath range' : ''}</p>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <input type="text"
                           id="derivation-index"
                           placeholder="*"
                           value="${currentIndex}"
                           pattern="[0-9]*"
                           style="width: 90px; padding: 4px 8px; font-size: 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--container-bg); color: var(--text-color); text-align: center; filter: brightness(1.3);">
                    ${showPathSelection ? `
                        <select id="derivation-path-type"
                                style="padding: 4px 8px; font-size: 12px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 1px solid var(--border-color); border-radius: 4px; background: var(--container-bg); color: var(--text-color); filter: brightness(1.3); cursor: pointer;">
                            <option value="external" ${currentPathType === 'external' ? 'selected' : ''}>External (lower value)</option>
                            <option value="change" ${currentPathType === 'change' ? 'selected' : ''}>Change (higher value)</option>
                        </select>
                    ` : ''}
                    <button id="apply-derivation-btn"
                            title="Compile with derivation index to see specific address"
                            class="primary-btn"
                            style="padding: 6px 11px; font-size: 13px; transform: scale(0.893); transition: all 0.2s ease;"
                            onmouseover="this.style.transform='scale(0.893) translateY(-2px)'; this.style.boxShadow='0 5px 15px rgba(61, 69, 83, 0.3)'"
                            onmouseout="this.style.transform='scale(0.893) translateY(0px)'; this.style.boxShadow=''">
                        🔨 Compile
                    </button>
                </div>
            `;

            // Add event listeners for derivation index
            const derivationInput = derivationDiv.querySelector('#derivation-index');
            const applyButton = derivationDiv.querySelector('#apply-derivation-btn');

            // Validation for derivation input
            const validateDerivationInput = () => {
                const value = derivationInput.value.trim();
                const isValid = value === '*' || (value !== '' && !isNaN(value) && parseInt(value) >= 0 && parseInt(value) <= 2147483647);

                // Don't disable the button - let user always compile

                if (isValid) {
                    derivationInput.style.borderColor = 'var(--success-border)';
                } else if (value !== '') {
                    derivationInput.style.borderColor = 'var(--error-border)';
                } else {
                    derivationInput.style.borderColor = 'var(--border-color)';
                }
            };

            derivationInput.addEventListener('input', validateDerivationInput);

            applyButton.addEventListener('click', () => {
                const expressionInput = document.getElementById('expression-input');
                const originalExpression = expressionInput.textContent.trim();
                const index = derivationInput.value.trim();

                if (index === '*') return; // Don't compile if it's still *

                if (!index || isNaN(index)) return;

                // Check for multipath patterns and handle path selection
                let modifiedExpression = originalExpression;

                // Get selected path type (external/change) if combo box exists
                const pathTypeSelect = derivationDiv.querySelector('#derivation-path-type');
                const selectedPathType = pathTypeSelect?.value || 'external';
                console.log('Selected path type:', selectedPathType, 'pathTypeSelect:', pathTypeSelect);

                // Handle multipath patterns like <0;1>/*, <12;13>/*
                modifiedExpression = modifiedExpression.replace(/<(\d+);(\d+)>\/\*/g, (match, lower, higher) => {
                    const lowerNum = parseInt(lower);
                    const higherNum = parseInt(higher);
                    const selectedPath = selectedPathType === 'external' ? Math.min(lowerNum, higherNum) : Math.max(lowerNum, higherNum);
                    console.log('Multipath replacement:', {
                        match,
                        lower: lowerNum,
                        higher: higherNum,
                        selectedPathType,
                        selectedPath,
                        index,
                        'Math.min(lowerNum, higherNum)': Math.min(lowerNum, higherNum),
                        'Math.max(lowerNum, higherNum)': Math.max(lowerNum, higherNum),
                        'selectedPathType === "external"': selectedPathType === 'external'
                    });
                    return `${selectedPath}/${index}`;
                });

                // Handle simple wildcards (/* patterns)
                modifiedExpression = modifiedExpression.replace(/\/\*/g, `/${index}`);

                // Handle key variables that might contain multipath patterns
                if (compiler.keyVariables) {
                    compiler.keyVariables.forEach((keyValue, keyName) => {
                        if (keyValue && /<\d+;\d+>\/\*/.test(keyValue)) {
                            const updatedKeyValue = keyValue.replace(/<(\d+);(\d+)>\/\*/g, (match, lower, higher) => {
                                const lowerNum = parseInt(lower);
                                const higherNum = parseInt(higher);
                                const selectedPath = selectedPathType === 'external' ? Math.min(lowerNum, higherNum) : Math.max(lowerNum, higherNum);
                                return `${selectedPath}/${index}`;
                            });
                            // Temporarily replace key variables in the expression for compilation
                            const keyPattern = new RegExp(`\\b${keyName}\\b`, 'g');
                            if (modifiedExpression.match(keyPattern)) {
                                modifiedExpression = modifiedExpression.replace(keyPattern, `[TEMP_KEY_${keyName}]`);
                                modifiedExpression = modifiedExpression.replace(new RegExp(`\\[TEMP_KEY_${keyName}\\]`, 'g'), updatedKeyValue);
                            }
                        }
                    });
                }

                console.log('Derivation compilation:', {
                    original: originalExpression,
                    modified: modifiedExpression,
                    index: index
                });

                // Store current input value before compilation
                const currentInputValue = derivationInput.value;

                // Compile directly with the modified expression
                this.compileMiniscriptExpression(modifiedExpression, originalExpression);

                // Restore the input value
                setTimeout(() => {
                    const newDerivationInput = document.getElementById('derivation-index');
                    if (newDerivationInput) {
                        newDerivationInput.value = currentInputValue;
                    }
                }, CONSTANTS.INIT_DELAY_MS);

                // Show brief feedback
                applyButton.textContent = `✓ Compiled`;
                setTimeout(() => {
                    const newApplyButton = document.getElementById('apply-derivation-btn');
                    if (newApplyButton) {
                        newApplyButton.textContent = '🔨 Compile';
                    }
                }, 1000);
            });

            // Initial validation
            validateDerivationInput();

            // Only append if it's a new element, position it correctly from the start
            if (!existingDerivationDiv) {
                this.insertDerivationFieldAtCorrectPosition(resultsDiv, derivationDiv);
            }
        } else {
            // No wildcard descriptor - remove the derivation field if it exists
            const existingDerivationDiv = resultsDiv.querySelector('.derivation-container');
            if (existingDerivationDiv) {
                console.log('🗑️ Removing derivation field - no wildcards in expression');
                existingDerivationDiv.remove();
            }
        }
    }

    // Helper function to check if derivation field is positioned before hex field
    isDerivationFieldBeforeHex(resultsDiv) {
        const derivationField = resultsDiv.querySelector('.derivation-container');
        const hexField = resultsDiv.querySelector('#script-hex-display');

        if (!derivationField || !hexField) {
            return true; // If either doesn't exist, consider it "correctly positioned"
        }

        // Compare position in DOM - derivation should come before hex
        return derivationField.compareDocumentPosition(hexField) & Node.DOCUMENT_POSITION_FOLLOWING;
    }

    // Helper function to insert derivation field at the correct position (before hex field)
    insertDerivationFieldAtCorrectPosition(resultsDiv, derivationDiv) {
        const hexField = resultsDiv.querySelector('#script-hex-display');

        if (hexField) {
            // If hex field exists, insert derivation field before its parent container
            const hexContainer = hexField.closest('.result-box');
            if (hexContainer) {
                console.log('📍 Inserting derivation field before hex field');
                resultsDiv.insertBefore(derivationDiv, hexContainer);
                return;
            }
        }

        // Fallback: append at the end if no hex field found
        console.log('📍 Appending derivation field at end (no hex field found)');
        resultsDiv.appendChild(derivationDiv);
    }

    compileMiniscriptExpression(modifiedExpression, originalExpression) {
        // Compile the modified expression without touching the editor
        const context = document.querySelector('input[name="context"]:checked').value;

        // Use unified compile for consistency
        const contextStr = context === 'legacy' ? "Legacy" :
                          context === 'taproot' ? "Taproot" : "Segwit";
        const debugMode = document.getElementById('miniscript-debug-mode')?.checked || false;

        const options = {
            input_type: "Miniscript",
            context: contextStr,
            mode: context === 'taproot' ? "SingleLeaf" : "Default",
            network_str: "bitcoin",
            nums_key: null,
            verbose_debug: debugMode
        };
        const result = compile_unified(modifiedExpression, options);

        // Store the original expression for restoration
        this.originalExpression = originalExpression;

        // Display results with custom success message for derivation index
        if (result.success) {
            // For derivation index compilation, show the modified expression in success message
            // Build appropriate success message based on result type
            let successMsg = '';
            if (result.miniscript_type === 'Descriptor' && result.compiled_miniscript) {
                successMsg = `Valid descriptor: wsh(${modifiedExpression})`;
            } else {
                // For Segwit v0 and other types, show that it was derived from the modified expression
                successMsg = `Derived from: ${modifiedExpression}`;
            }

            this.showMiniscriptSuccess(successMsg, modifiedExpression);
            this.displayResults(result);
        } else {
            this.showError(result.error);
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
<div style="margin-top: 15px; padding: 12px; background: rgba(255, 107, 107, 0.1); border: 1px solid var(--error-border); border-radius: 6px; text-align: left; color: var(--text-color);">
<strong>💡 Tip:</strong> The key variable "<strong>${missingKey}</strong>" appears to be missing or undefined.
<br><br>
<strong>Your options:</strong>
<br><br>
<div>→ <strong>Extract keys:</strong> Auto-detects all undefined variables/keys in your miniscript and lets you assign key variables to them</div>
<div>→ <strong>Check Key variables section:</strong> Look below to see if "${missingKey}" already exists with a different value</div>
<div>→ <strong>Add manually:</strong> Define "${missingKey}" yourself in the Key variables section with any valid key type</div>
<div>→ <strong>Restore defaults:</strong> Restore common test keys (Alice, Bob, Charlie, etc.) with pre-generated public keys.<br>&nbsp;&nbsp;Useful for examples that stopped working, usually due to a key deletion</div>
<div style="margin-top: 10px; display: flex; gap: 10px;">
<button onclick="compiler.extractKeysFromMiniscript()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Automatically scan your miniscript expression to find undefined variables and convert them to reusable key variables. Select which variables to extract and choose the appropriate key type for each.">🔑 Extract keys</button>
<button onclick="compiler.restoreDefaultKeys()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Add 60 commonly used test keys (Alice, Bob, Charlie, David, Eva, Frank, NUMS, etc.) plus VaultKey1-19 range descriptors, VaultXOnly1-2 X-only keys, and DavidTimeout/HelenTimeout timeout keys with pre-generated public keys for each type. This won't overwrite existing keys with the same names.">🔄 Restore defaults</button>
</div>
</div>
                    `;
                } else if (gotLength <= 15) {
                    // Generic help for short strings that look like variable names
                    additionalHelp = `
<div style="margin-top: 15px; padding: 12px; background: rgba(255, 107, 107, 0.1); border: 1px solid var(--error-border); border-radius: 6px; text-align: left; color: var(--text-color);">
<strong>💡 Tip:</strong> This looks like a missing key variable (got ${gotLength} characters instead of a public key).
<br><br>
<strong>Your options:</strong>
<br><br>
<div>→ <strong>Extract keys:</strong> Auto-detects all undefined variables/keys in your miniscript and lets you assign key variables to them</div>
<div>→ <strong>Check Key variables section:</strong> Look below to see if this variable exists or needs to be added</div>
<div>→ <strong>Add manually:</strong> Define your custom variable in the Key variables section with any valid key type</div>
<div>→ <strong>Restore defaults:</strong> Restore common test keys (Alice, Bob, Charlie, etc.) with pre-generated public keys.<br>&nbsp;&nbsp;Useful for examples that stopped working, usually due to a key deletion</div>
<div style="margin-top: 10px; display: flex; gap: 10px;">
<button onclick="compiler.extractKeysFromMiniscript()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Automatically scan your miniscript expression to find undefined variables and convert them to reusable key variables. Select which variables to extract and choose the appropriate key type for each.">🔑 Extract keys</button>
<button onclick="compiler.restoreDefaultKeys()" class="secondary-btn" style="padding: 4px 8px; font-size: 12px; min-width: 120px;" title="Add 60 commonly used test keys (Alice, Bob, Charlie, David, Eva, Frank, NUMS, etc.) plus VaultKey1-19 range descriptors, VaultXOnly1-2 X-only keys, and DavidTimeout/HelenTimeout timeout keys with pre-generated public keys for each type. This won't overwrite existing keys with the same names.">🔄 Restore defaults</button>
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

    /**
     * Format a PolicyTreeNode (from Rust analysis) as a vertical hierarchy tree
     * Uses the same visual style as formatTreeAsVerticalHierarchy
     * @param {Object} tree - PolicyTreeNode with type, text, children
     * @param {boolean} replaceKeys - Whether to replace keys with variable names
     * @returns {string} Formatted tree string
     */
    formatPolicyTreeAsVerticalHierarchy(tree, replaceKeys = false) {
        if (!tree) return '';

        // Calculate node positions
        const nodeInfo = this.calculatePolicyNodePositions(tree, 0, 0, replaceKeys);
        const lines = this.renderBinaryTree(nodeInfo);
        return lines.join('\n');
    }

    /**
     * Format display text for a PolicyTreeNode from raw data
     */
    formatPolicyNodeText(node, replaceKeys = false) {
        if (!node) return '?';

        let text;
        const nodeType = node.type || '';

        switch (nodeType) {
            case 'and':
                text = 'and';
                break;
            case 'or':
                text = 'or';
                break;
            case 'thresh':
                text = `thresh(${node.k}/${node.n})`;
                break;
            case 'pk':
                text = `pk(${node.value || ''})`;
                break;
            case 'after':
                text = `after(${node.value || ''})`;
                break;
            case 'older':
                text = `older(${node.value || ''})`;
                break;
            case 'sha256':
            case 'hash256':
            case 'ripemd160':
            case 'hash160':
                text = `${nodeType}(${node.value || ''})`;
                break;
            case 'unsatisfiable':
                text = 'UNSATISFIABLE';
                break;
            case 'trivial':
                text = 'TRIVIAL';
                break;
            default:
                text = nodeType || '?';
        }

        // Replace keys with variable names if requested
        if (replaceKeys && this.keyVariables && this.keyVariables.size > 0) {
            text = this.replaceKeysWithNames(text);
        }

        return text;
    }

    /**
     * Convert blocks to human-readable time duration
     * @param {number} blocks - Number of blocks
     * @returns {string} Human-readable duration (e.g., "~1 days")
     */
    blocksToHumanTime(blocks) {
        const minutes = blocks * 10; // ~10 min per block
        if (blocks === 1) {
            return '~10 min';
        } else if (blocks < 6) {
            return `~${minutes} min`;
        } else if (blocks < 144) {
            return `~${Math.floor(minutes / 60)} hours`;
        } else {
            return `~${Math.floor(minutes / 60 / 24)} days`;
        }
    }

    /**
     * Format absolute timelock (block height or Unix timestamp)
     * @param {number} value - Block height or Unix timestamp
     * @returns {string} Formatted string
     */
    formatAbsoluteTimelock(value) {
        if (value >= 500000000) {
            // Unix timestamp
            const date = new Date(value * 1000);
            return `${value} (${date.toLocaleDateString()})`;
        } else {
            // Block height
            return `block ${value}`;
        }
    }

    /**
     * Calculate node positions for PolicyTreeNode structure
     */
    calculatePolicyNodePositions(tree, depth, position, replaceKeys = false) {
        if (!tree) return null;

        // Get display text from raw node data
        const displayText = this.formatPolicyNodeText(tree, replaceKeys);

        // If no children, this is a leaf node
        if (!tree.children || tree.children.length === 0) {
            return {
                text: displayText,
                position: position,
                rightmostPosition: position + displayText.length,
                depth: depth,
                children: []
            };
        }

        // Process children
        const childNodes = [];
        let nextPosition = position;

        for (let i = 0; i < tree.children.length; i++) {
            const childNode = this.calculatePolicyNodePositions(tree.children[i], depth + 1, nextPosition, replaceKeys);
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
            text: displayText,
            position: nodePosition,
            rightmostPosition: Math.max(nodePosition + displayText.length, nextPosition - 4),
            depth: depth,
            children: childNodes
        };
    }

    showMiniscriptSuccess(message, expression = null, showDebugButton = true) {
        const messagesDiv = document.getElementById('miniscript-messages');

        // Check if we should update existing success message during auto-compile
        if (this.isAutoCompiling) {
            const existingSuccess = messagesDiv.querySelector('.result-box.success');
            if (existingSuccess) {
                // Clear any existing debug info during auto-compile
                const existingDebugInfo = existingSuccess.querySelector('.debug-info-container');
                if (existingDebugInfo) {
                    existingDebugInfo.remove();
                }

                // Reset debug button state
                const debugButton = existingSuccess.querySelector('button[onclick="toggleMiniscriptDebugInfo(this)"]');
                if (debugButton) {
                    debugButton.style.backgroundColor = 'transparent';
                }

                // Update the existing message content
                const messageContent = existingSuccess.querySelector('div[style*="margin-top: 10px"]');
                if (messageContent) {
                    messageContent.innerHTML = message;
                }

                // Update title with current context
                const titleElement = existingSuccess.querySelector('h4');
                if (titleElement) {
                    const currentContext = document.querySelector('input[name="context"]:checked')?.value || 'legacy';
                    const contextDisplay = this.getContextDisplayName(currentContext);
                    const debugButtonHtml = showDebugButton ? `
                            <button onclick="toggleMiniscriptDebugInfo(this)" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Toggle debug info" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                                🐞
                            </button>` : '';
                    titleElement.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                            <span>✅ <strong>Miniscript ${contextDisplay} compilation successful</strong></span>
                            ${debugButtonHtml}
                        </div>
                    `;
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
                                if (treeArea) {
                                    // Update existing tree
                                    const titleElement = treeArea.firstChild;
                                    if (titleElement && titleElement.nodeType === Node.TEXT_NODE) {
                                        titleElement.textContent = `Tree structure (${treeTitle})`;
                                    }
                                    const pre = treeArea.querySelector('pre');
                                    if (pre) {
                                        pre.textContent = treeFormatted;
                                    }
                                } else {
                                    // Add new tree area
                                    const treeHtml = `
                                        <div style="margin-top: 15px;">
                                            Tree structure (${treeTitle})
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
                        
                        if (context === 'taproot' || context === 'taproot-multi' || context === 'taproot-keypath') {
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
                                Tree structure (${treeTitle})
                                <pre style="margin-top: 8px; padding: 12px; border: 1px solid var(--border-color); border-radius: 4px; overflow-x: auto; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 12px; line-height: 1.4; background: transparent;">${treeFormatted}</pre>
                            </div>
                        `;
                    }
                }
                
                // Generate Taproot info if context is taproot
                const context = document.querySelector('input[name="context"]:checked')?.value;
                if (context === 'taproot' || context === 'taproot-multi' || context === 'taproot-keypath') {
                    taprootInfoHtml = this.generateTaprootInfo(expression);
                }
            } catch (error) {
                console.error('Error generating tree:', error);
            }
        }
        
        // Get current context for display
        const context = document.querySelector('input[name="context"]:checked')?.value || 'legacy';
        const contextDisplay = this.getContextDisplayName(context);

        const debugButtonHtml = showDebugButton ? `
                        <button onclick="toggleMiniscriptDebugInfo(this)" style="background: none; border: none; padding: 4px; margin: 0; cursor: pointer; font-size: 16px; color: var(--text-secondary); display: flex; align-items: center; border-radius: 3px;" title="Toggle debug info" onmouseover="this.style.backgroundColor='var(--button-secondary-bg)'" onmouseout="this.style.backgroundColor='transparent'">
                            🐞
                        </button>` : '';

        messagesDiv.innerHTML = `
            <div class="result-box success" style="margin: 0;">
                <h4>
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <span>✅ <strong>Miniscript ${contextDisplay} compilation successful</strong></span>
                        ${debugButtonHtml}
                    </div>
                </h4>
                <div style="margin-top: 10px; word-wrap: break-word; word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap; hyphens: none; max-width: 100%; overflow-x: auto; font-size: 13px;">${message}</div>
                ${treeHtml}
                ${taprootInfoHtml}
            </div>
        `;
    }

    getContextDisplayName(context) {
        const contextMap = {
            'legacy': 'Legacy (p2SH)',
            'segwit': 'Segwit v0 (p2WSH)',  
            'taproot': 'Taproot (Single leaf / Key)',
            'taproot-multi': 'Taproot (Script path)',
            'taproot-keypath': 'Taproot (Key + script path)'
        };
        return contextMap[context] || context;
    }

    generateTaprootInfo(expression) {
        try {
            // Parse the expression to understand taproot structure
            const isTaprootDescriptor = expression && expression.trim().startsWith('tr(');
            
            // Get current taproot mode for display
            const currentMode = window.currentTaprootMode || 'single-leaf';
            
            // Try to get taproot branches from WASM (new approach)
            let branchesHtml = '';
            console.log('DEBUG: Checking get_taproot_branches availability:', typeof get_taproot_branches);
            console.log('DEBUG: this.wasm available:', !!this.wasm);
            
            if (this.wasm && typeof get_taproot_branches !== 'undefined') {
                try {
                    // First replace key variables for the WASM call
                    const context = document.querySelector('input[name="context"]:checked').value;
                    const processedExpression = this.replaceKeyVariables(expression, context);
                    console.log('DEBUG: Calling get_taproot_branches with expression:', processedExpression);
                    const result = get_taproot_branches(processedExpression);
                    console.log('DEBUG: get_taproot_branches result:', result);
                    
                    if (result && result.success && result.branches && result.branches.length > 0) {
                        branchesHtml = `
                            <div style="margin-top: 12px;">
                                <strong>Script paths (branches):</strong>
                        `;
                        
                        result.branches.forEach((branch) => {
                            // Replace keys back with names for display if toggle is active
                            let displayMiniscript = branch.miniscript;
                            const showKeyNames = document.getElementById('key-names-toggle')?.dataset.active === 'true';
                            if (showKeyNames && this.keyVariables.size > 0) {
                                displayMiniscript = this.replaceKeysWithNames(branch.miniscript);
                            }
                            
                            const branchLabel = branch.path === 'root' ? 'Root' : 
                                               branch.path === 'L' ? 'Branch L' : 
                                               branch.path === 'R' ? 'Branch R' : 
                                               `Branch ${branch.path}`;
                            
                            branchesHtml += `
                                <div style="margin-top: 10px; padding: 8px; border: 1px solid var(--border-color); border-radius: 3px; background: transparent;">
                                    <div style="display: flex; align-items: center; justify-content: space-between;">
                                        <strong>• ${branchLabel}</strong>
                                        <button 
                                            onclick="window.compiler.loadBranchMiniscript('${displayMiniscript.replace(/'/g, "\\'")}')"
                                            style="padding: 2px 8px; font-size: 11px; background: var(--accent-color); color: white; border: none; border-radius: 3px; cursor: pointer;"
                                            title="Load this branch miniscript into the editor"
                                        >
                                            Load
                                        </button>
                                    </div>
                                    <div style="margin-top: 6px;">
                                        <strong>Miniscript:</strong><br>
                                        <span style="font-family: monospace; word-break: break-all; color: var(--text-secondary); font-size: 12px;">${displayMiniscript}</span>
                                    </div>
                                </div>
                            `;
                        });
                        
                        branchesHtml += `
                            </div>
                        `;
                    } else if (result && result.error) {
                        if (result.error.includes("No script paths")) {
                            branchesHtml = `
                                <div style="margin-top: 12px; color: var(--text-secondary);">
                                    No script paths (key-only descriptor).
                                </div>
                            `;
                        }
                    }
                } catch (e) {
                    console.error('DEBUG: Failed to get taproot branches:', e);
                }
            } else {
                console.log('DEBUG: Skipping get_taproot_branches - WASM not available or function undefined');
            }
            
            if (!isTaprootDescriptor) {
                // For non-tr() expressions in taproot context, show info based on mode
                if (currentMode === 'single-leaf') {
                    // Single-leaf mode: no taproot details needed
                    return '';
                } else {
                    // Multi-leaf mode: show tree structure with leaves
                    
                    // For Key+Script mode, the internal key is the first key in the expression
                    // For Script-path mode, it's NUMS point
                    let actualInternalKey = 'NUMS point (unspendable)';
                    
                    const currentMode = window.currentTaprootMode || 'single-leaf';
                    if (currentMode === 'multi-leaf') {
                        // Key+Script mode - extract the first key as internal key
                        const keyMatch = expression.match(/pk\(([^)]+)\)/);
                        if (keyMatch) {
                            const showKeyNames = document.getElementById('key-names-toggle')?.dataset.active === 'true';
                            if (showKeyNames && this.keyVariables && this.keyVariables.size > 0) {
                                actualInternalKey = this.replaceKeysWithNames(keyMatch[1]);
                            } else {
                                actualInternalKey = keyMatch[1];
                            }
                        }
                    }
                    // else it stays as NUMS point for script-path mode
                    
                    // Get real branches from the new miniscript function
                    let branchesContent = '';
                    let branchCount = 0;
                    
                    // Get the descriptor from the compilation result
                    // It's stored when we compile taproot
                    let descriptor = window.lastCompiledDescriptor;

                    // If not available, try to get it from the compilation result directly
                    // This happens in Taproot (Key path + script path) context
                    if (!descriptor && window.lastCompiledResult) {
                        descriptor = window.lastCompiledResult.compiled_miniscript;
                    }
                    
                    if (typeof get_taproot_miniscript_branches !== 'undefined' && descriptor) {
                        try {
                            const result = get_taproot_miniscript_branches(descriptor);
                            
                            if (result && result.success && result.branches && result.branches.length > 0) {
                                branchCount = result.branches.length;
                                result.branches.forEach((branch, idx) => {
                                    let branchMiniscript = branch.miniscript;
                                    let branchAsm = branch.asm || '';
                                    const branchHex = branch.hex || '';
                                    
                                    const showKeyNames = document.getElementById('key-names-toggle')?.dataset.active === 'true';
                                    if (showKeyNames && this.keyVariables && this.keyVariables.size > 0) {
                                        branchMiniscript = this.replaceKeysWithNames(branchMiniscript);
                                        branchAsm = this.replaceKeysWithNames(branchAsm);
                                    }
                                    
                                    branchesContent += `
                                        <div>
                                            Script path #${idx + 1}
                                            <div style="margin-top: 6px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; background: transparent;">
                                                Miniscript: <span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${branchMiniscript}</span><br>
                                                ASM: <span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${branchAsm}</span><br>
                                                HEX: <span style="word-break: break-all; overflow-wrap: anywhere; font-family: monospace; display: block; font-size: 12px;">${branchHex}</span><br>
                                                Spending cost analysis:<br>
                                                Sig: ${branch.sig_wu || 'N/A'} WU<br>
                                                Script: ${branch.script_wu || 'N/A'} WU<br>
                                                Control: ${branch.control_wu || 'N/A'} WU<br>
                                                Total: ${branch.total_wu || 'N/A'} WU
                                            </div>
                                        </div>
                                    `;
                                });
                            }
                        } catch (e) {
                            console.log('ERROR: Could not get miniscript branches:', e);
                        }
                    }
                    
                    // Fallback if no branches found - don't show placeholder, show error message
                    if (!branchesContent) {
                        branchCount = 0;
                        branchesContent = `
                            <div style="margin-top: 12px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; background: transparent; color: var(--text-secondary);">
                                Unable to extract branch information. Compile the expression to see branch details.
                            </div>
                        `;
                    }

                    // Show the descriptor if available
                    let descriptorLine = '';
                    if (descriptor && descriptor.startsWith('tr(')) {
                        // Clean the descriptor by removing |LEAF_ASM: suffix if present
                        if (descriptor.includes('|LEAF_ASM:')) {
                            descriptor = descriptor.split('|LEAF_ASM:')[0];
                        }
                        // Replace keys with names if toggle is active
                        let displayDescriptor = descriptor;
                        const showKeyNames = document.getElementById('key-names-toggle')?.dataset.active === 'true';
                        if (showKeyNames && this.keyVariables && this.keyVariables.size > 0) {
                            displayDescriptor = this.replaceKeysWithNames(descriptor);
                        }
                        descriptorLine = `<div>Descriptor: <span style="font-family: monospace; word-break: break-all;">${displayDescriptor}</span></div>`;
                    }

                    return `
                        🌿 Taproot Structure
                        <div class="taproot-info" style="margin-top: 8px; padding: 12px; border: 1px solid var(--border-color); border-radius: 4px; background: transparent;">
                            <div style="font-size: 12px; line-height: 1.6;">
                                ${descriptorLine}
                                <div>Internal Key: ${actualInternalKey}</div>
                                ${currentMode === 'multi-leaf' ? '<div>Key path spending: 66 WU (67 with sighash byte)<br>⚡ Recommendation: Use key path spending for maximum efficiency</div>' : ''}
                                <div>Script paths: ${branchCount > 0 ? branchCount + (branchCount === 1 ? ' leaf' : ' leaves') : 'No branches available'}</div>
                                ${branchesContent}
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
            
            let keyType;
            if (isNUMS) {
                keyType = 'NUMS point (unspendable)';
            } else {
                // Show key name if toggle is active, otherwise show "User-provided key"
                const showKeyNames = document.getElementById('key-names-toggle')?.dataset.active === 'true';
                if (showKeyNames && this.keyVariables.size > 0) {
                    const keyWithNames = this.replaceKeysWithNames(internalKey);
                    keyType = keyWithNames !== internalKey ? keyWithNames : 'User-provided key';
                } else {
                    keyType = 'User-provided key';
                }
            }
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
                <strong>🌿 Taproot Structure</strong>
                <div class="taproot-info" style="margin-top: 8px; padding: 12px; border: 1px solid var(--border-color); border-radius: 4px; background: transparent;">
                    <div style="font-size: 12px; line-height: 1.6;">
                        <div><strong>Internal Key:</strong> ${keyType}${isNUMS ? '' : ' (key-path spending)'}</div>
                        <div><strong>Script Tree:</strong> 2 branches (script-path spending)</div>
                        
                        <div style="margin-top: 12px;">
                            <strong>Branch 1:</strong><br>
                            <strong>Miniscript:</strong> pk(David)<br>
                            <strong>ASM:</strong> script asm placeholder<br>
                            <strong>Script:</strong> 34 WU<br>
                            <strong>Input:</strong> 200.000000 WU<br>
                            <strong>Total:</strong> 234.000000 WU
                        </div>
                        
                        <div style="margin-top: 12px;">
                            <strong>Branch 2:</strong><br>
                            <strong>Miniscript:</strong> or_b(pk(Helen),s:pk(Uma))<br>
                            <strong>ASM:</strong> script asm placeholder<br>
                            <strong>Script:</strong> 34 WU<br>
                            <strong>Input:</strong> 200.000000 WU<br>
                            <strong>Total:</strong> 234.000000 WU
                        </div>
            `;
            
            // Disabled old tree script logic
            if (false) {
                // Old logic disabled
            }
            
            taprootHtml += `
                    </div>
                    ${branchesHtml}
                </div>
            `;
            
            return taprootHtml;
        } catch (error) {
            console.error('Error generating taproot info:', error);
            return '';
        }
    }

    loadBranchMiniscript(miniscript) {
        try {
            // Load the branch miniscript into the editor
            const expressionInput = document.getElementById('expression-input');
            if (expressionInput) {
                expressionInput.textContent = miniscript;

                // Hide the miniscript description panel when loading a branch
                const miniscriptDescPanel = document.getElementById('miniscript-description');
                if (miniscriptDescPanel) {
                    miniscriptDescPanel.style.display = 'none';
                }

                // Trigger syntax highlighting
                this.highlightMiniscriptSyntax(true); // Skip cursor restore since we're loading new content

                // Position cursor at the end
                this.positionCursorAtEnd(expressionInput);

                // Focus the input
                expressionInput.focus();

                console.log('Loaded branch miniscript into editor:', miniscript);
            }
        } catch (error) {
            console.error('Error loading branch miniscript:', error);
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
        }, CONSTANTS.INIT_DELAY_MS);
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
        successDiv.innerHTML = `<h4>✅ <strong>Success</strong></h4><div>${message}</div>`;
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
        const originalExpression = addressDisplay.dataset.originalExpression;
        const taprootMode = addressDisplay.dataset.taprootMode;
        
        // Debug logging
        console.log('NETWORK TOGGLE RETRIEVED DATA:');
        console.log('- currentNetwork:', currentNetwork);
        console.log('- scriptType:', scriptType);
        console.log('- originalExpression:', originalExpression);
        console.log('- miniscript:', miniscript);
        console.log('- taprootMode:', taprootMode);
        console.log('- keyVariables size:', this.keyVariables ? this.keyVariables.size : 'undefined');
        
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
                console.log('DEBUG: Using TaprootBuilder for taproot mode:', taprootMode);
                console.log('DEBUG: Original expression:', originalExpression);
                console.log('DEBUG: Processed miniscript:', miniscript);
                
                // Use the stored taproot mode or fallback to current mode
                const currentMode = taprootMode || window.currentTaprootMode || 'single-leaf';
                let internalKey;
                
                if (currentMode === 'multi-leaf') {
                    // For "Key path + script path" mode, extract internal key from ORIGINAL expression
                    // Look for the first pk() to use as internal key
                    const expressionToUse = originalExpression || miniscript;
                    const pkMatch = expressionToUse.match(/pk\(([^)]+)\)/);
                    if (pkMatch) {
                        // Get the actual key value for this key name
                        const keyName = pkMatch[1];
                        if (this.keyVariables && this.keyVariables.has(keyName)) {
                            internalKey = this.keyVariables.get(keyName);
                            console.log('Extracted internal key for multi-leaf mode:', keyName, '→', internalKey);
                        } else {
                            // Fallback to NUMS if key not found
                            internalKey = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';
                            console.log('Key name not found, using NUMS as fallback');
                        }
                    } else {
                        // Fallback to NUMS if no pk() found
                        internalKey = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';
                        console.log('No pk() found, using NUMS as fallback');
                    }
                } else {
                    // For "Script path" and "single-leaf" modes, use NUMS
                    internalKey = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';
                    console.log('Using NUMS for mode:', currentMode);
                }
                
                // Always pass the internal key to the Rust function
                console.log('CALLING generate_taproot_address_with_builder with:');
                console.log('- miniscript:', miniscript);
                console.log('- newNetwork:', newNetwork);
                console.log('- internalKey:', internalKey);
                
                try {
                    // Use unified compile with network parameter
                    const options = {
                        input_type: "Miniscript",
                        context: "Taproot",
                        mode: currentMode, // Use the mode string directly: 'multi-leaf', 'script-path', or 'single-leaf'
                        network_str: newNetwork,
                        nums_key: internalKey
                    };
                    result = compile_unified(miniscript, options);
                    console.log('NETWORK TOGGLE COMPILATION RESULT:', result);
                    
                    if (result.success && result.address) {
                        // Extract just the address for the toggle result
                        result = { 
                            success: true, 
                            address: result.address,
                            error: undefined 
                        };
                    } else {
                        result = { 
                            success: false, 
                            error: result.error || 'Address generation failed',
                            address: undefined 
                        };
                    }
                } catch (error) {
                    console.error('WASM FUNCTION ERROR:', error);
                    result = { success: false, error: error.message };
                }
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

    showSavedMiniscriptsModal() {
        const expressions = this.getSavedExpressions();
        
        // Create modal HTML
        const modalHtml = `
            <div id="saved-miniscripts-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;">
                <div style="background: var(--container-bg); border-radius: 8px; padding: 20px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; border: 1px solid var(--border-color);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h3 style="margin: 0; color: var(--text-primary);">📂 Saved Miniscripts</h3>
                        <button onclick="document.getElementById('saved-miniscripts-modal').remove()" style="background: none; border: none; color: var(--text-secondary); font-size: 24px; cursor: pointer; padding: 0;">×</button>
                    </div>
                    <div id="modal-miniscripts-list">
                        ${expressions.length === 0 ? 
                            '<p style="color: var(--text-muted); font-style: italic; font-size: 14px; text-align: center; padding: 20px;">No saved miniscripts yet.</p>' :
                            expressions.map(expr => `
                                <div class="expression-item" style="margin-bottom: 10px;">
                                    <div class="expression-info">
                                        <div class="expression-name">${this.escapeHtml(expr.name)}</div>
                                        <div class="expression-preview">${this.escapeHtml(expr.expression)}</div>
                                    </div>
                                    <div style="display: flex; gap: 8px; flex-shrink: 0;">
                                        <button onclick="compiler.loadMiniscriptFromModal('${this.escapeHtml(expr.name)}')" class="secondary-btn" style="padding: 6px 12px; font-size: 12px;">📂 Load</button>
                                        <button onclick="compiler.deleteMiniscriptFromModal('${this.escapeHtml(expr.name)}')" class="danger-btn" style="padding: 6px 12px; font-size: 12px;">🗑️</button>
                                    </div>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to the page
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Close modal on ESC key
        const closeOnEsc = (e) => {
            if (e.key === 'Escape') {
                const modal = document.getElementById('saved-miniscripts-modal');
                if (modal) modal.remove();
                document.removeEventListener('keydown', closeOnEsc);
            }
        };
        document.addEventListener('keydown', closeOnEsc);
        
        // Close modal on background click
        const modal = document.getElementById('saved-miniscripts-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        }
    }

    loadMiniscriptFromModal(name) {
        // Close the modal
        const modal = document.getElementById('saved-miniscripts-modal');
        if (modal) modal.remove();
        
        // Load the expression
        this.loadExpression(name);
    }

    deleteMiniscriptFromModal(name) {
        if (!confirm(`Are you sure you want to delete miniscript "${name}"?`)) {
            return;
        }

        const expressions = this.getSavedExpressions();
        const filteredExpressions = expressions.filter(expr => expr.name !== name);
        this.setSavedExpressions(filteredExpressions);
        
        // Update the modal content
        const modalList = document.getElementById('modal-miniscripts-list');
        if (modalList) {
            if (filteredExpressions.length === 0) {
                modalList.innerHTML = '<p style="color: var(--text-muted); font-style: italic; font-size: 14px; text-align: center; padding: 20px;">No saved miniscripts yet.</p>';
            } else {
                modalList.innerHTML = filteredExpressions.map(expr => `
                    <div class="expression-item" style="margin-bottom: 10px;">
                        <div class="expression-info">
                            <div class="expression-name">${this.escapeHtml(expr.name)}</div>
                            <div class="expression-preview">${this.escapeHtml(expr.expression)}</div>
                        </div>
                        <div style="display: flex; gap: 8px; flex-shrink: 0;">
                            <button onclick="compiler.loadMiniscriptFromModal('${this.escapeHtml(expr.name)}')" class="secondary-btn" style="padding: 6px 12px; font-size: 12px;">📂 Load</button>
                            <button onclick="compiler.deleteMiniscriptFromModal('${this.escapeHtml(expr.name)}')" class="danger-btn" style="padding: 6px 12px; font-size: 12px;">🗑️</button>
                        </div>
                    </div>
                `).join('');
            }
        }
        
        // Also update the main saved expressions list if it's visible
        this.loadSavedExpressions();
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
        const context = document.querySelector('input[name="policy-context"]:checked').value;
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

    showSavedPoliciesModal() {
        const policies = this.getSavedPolicies();
        
        // Create modal HTML
        const modalHtml = `
            <div id="saved-policies-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;">
                <div style="background: var(--container-bg); border-radius: 8px; padding: 20px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; border: 1px solid var(--border-color);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h3 style="margin: 0; color: var(--text-primary);">📂 Saved Policies</h3>
                        <button onclick="document.getElementById('saved-policies-modal').remove()" style="background: none; border: none; color: var(--text-secondary); font-size: 24px; cursor: pointer; padding: 0;">×</button>
                    </div>
                    <div id="modal-policies-list">
                        ${policies.length === 0 ? 
                            '<p style="color: var(--text-muted); font-style: italic; font-size: 14px; text-align: center; padding: 20px;">No saved policies yet.</p>' :
                            policies.map(policy => `
                                <div class="expression-item" style="margin-bottom: 10px;">
                                    <div class="expression-info">
                                        <div class="expression-name">${this.escapeHtml(policy.name)}</div>
                                        <div class="expression-preview">${this.escapeHtml(policy.expression)}</div>
                                    </div>
                                    <div style="display: flex; gap: 8px; flex-shrink: 0;">
                                        <button onclick="compiler.loadPolicyFromModal('${this.escapeHtml(policy.name)}')" class="secondary-btn" style="padding: 6px 12px; font-size: 12px;">📂 Load</button>
                                        <button onclick="compiler.deletePolicyFromModal('${this.escapeHtml(policy.name)}')" class="danger-btn" style="padding: 6px 12px; font-size: 12px;">🗑️</button>
                                    </div>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to the page
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Close modal on ESC key
        const closeOnEsc = (e) => {
            if (e.key === 'Escape') {
                const modal = document.getElementById('saved-policies-modal');
                if (modal) modal.remove();
                document.removeEventListener('keydown', closeOnEsc);
            }
        };
        document.addEventListener('keydown', closeOnEsc);
        
        // Close modal on background click
        const modal = document.getElementById('saved-policies-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        }
    }

    loadPolicyFromModal(name) {
        // Close the modal
        const modal = document.getElementById('saved-policies-modal');
        if (modal) modal.remove();
        
        // Load the policy
        this.loadPolicy(name);
    }

    deletePolicyFromModal(name) {
        if (!confirm(`Are you sure you want to delete policy "${name}"?`)) {
            return;
        }

        const policies = this.getSavedPolicies();
        const filteredPolicies = policies.filter(policy => policy.name !== name);
        this.setSavedPolicies(filteredPolicies);
        
        // Update the modal content
        const modalList = document.getElementById('modal-policies-list');
        if (modalList) {
            if (filteredPolicies.length === 0) {
                modalList.innerHTML = '<p style="color: var(--text-muted); font-style: italic; font-size: 14px; text-align: center; padding: 20px;">No saved policies yet.</p>';
            } else {
                modalList.innerHTML = filteredPolicies.map(policy => `
                    <div class="expression-item" style="margin-bottom: 10px;">
                        <div class="expression-info">
                            <div class="expression-name">${this.escapeHtml(policy.name)}</div>
                            <div class="expression-preview">${this.escapeHtml(policy.expression)}</div>
                        </div>
                        <div style="display: flex; gap: 8px; flex-shrink: 0;">
                            <button onclick="compiler.loadPolicyFromModal('${this.escapeHtml(policy.name)}')" class="secondary-btn" style="padding: 6px 12px; font-size: 12px;">📂 Load</button>
                            <button onclick="compiler.deletePolicyFromModal('${this.escapeHtml(policy.name)}')" class="danger-btn" style="padding: 6px 12px; font-size: 12px;">🗑️</button>
                        </div>
                    </div>
                `).join('');
            }
        }
        
        // Also update the main saved policies list if it's visible
        this.loadSavedPolicies();
    }

    loadPolicy(name) {
        const policies = this.getSavedPolicies();
        const savedPolicy = policies.find(policy => policy.name === name);

        // Clear policyLifted flag when loading saved policy
        this.policyLifted = false;

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
            // Set both policy and miniscript context radio buttons
            const policyRadio = document.querySelector(`input[name="policy-context"][value="${context}"]`);
            const miniscriptRadio = document.querySelector(`input[name="context"][value="${context}"]`);
            if (policyRadio) policyRadio.checked = true;
            if (miniscriptRadio) miniscriptRadio.checked = true;
            
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

    // Derivation index functionality for xpub/tpub descriptors
    initDerivationIndex() {
        const derivationContainer = document.getElementById('derivation-index-container');
        const derivationInput = document.getElementById('derivation-index');
        const applyButton = document.getElementById('apply-derivation-btn');
        const expressionInput = document.getElementById('expression-input');

        // Check for range descriptors when expression changes
        const checkForRangeDescriptor = () => {
            const expression = expressionInput.textContent.trim();
            const hasWildcard = /[xt]pub[A-Za-z0-9]+[^)]*\/\*/.test(expression);

            // Show always for now (for testing)
            derivationContainer.style.display = 'flex';

            // Show * in input field if it's a range descriptor
            if (hasWildcard) {
                derivationInput.value = '*';
                derivationInput.placeholder = '*';
            } else {
                if (derivationInput.value === '*') {
                    derivationInput.value = '';
                }
                derivationInput.placeholder = '0';
                applyButton.disabled = true;
                applyButton.textContent = 'Apply';
            }
        };

        // Validate derivation input
        const validateInput = () => {
            const value = derivationInput.value.trim();
            const isValid = value === '*' || (value !== '' && !isNaN(value) && parseInt(value) >= 0 && parseInt(value) <= 2147483647);

            applyButton.disabled = !isValid;

            if (isValid) {
                derivationInput.style.borderColor = 'var(--success-border)';
            } else if (value !== '') {
                derivationInput.style.borderColor = 'var(--error-border)';
            } else {
                derivationInput.style.borderColor = 'var(--border-color)';
            }
        };

        // Apply derivation index
        const applyDerivation = () => {
            const expression = expressionInput.textContent.trim();
            const index = derivationInput.value.trim();

            if (!index || isNaN(index)) return;

            // Replace wildcard with specific index
            const modifiedExpression = expression.replace(/\/\*/g, `/${index}`);

            // Update button state
            applyButton.disabled = true;
            applyButton.textContent = 'Applying...';

            // Set the modified expression temporarily for compilation
            const originalExpression = expression;
            expressionInput.textContent = modifiedExpression;

            // Trigger compilation
            this.compileExpression();

            // Set a small delay to allow compilation to complete, then restore original expression
            setTimeout(() => {
                // Restore original expression but keep the UI showing it's applied
                expressionInput.textContent = originalExpression;
                applyButton.textContent = `✓ Applied ${index}`;
                applyButton.style.backgroundColor = 'var(--success-bg)';
                applyButton.style.borderColor = 'var(--success-border)';
                applyButton.style.color = 'var(--success-text)';
            }, CONSTANTS.INIT_DELAY_MS);
        };

        // Reset applied state when input changes
        const resetAppliedState = () => {
            applyButton.textContent = 'Apply';
            applyButton.style.backgroundColor = 'var(--button-secondary-bg)';
            applyButton.style.borderColor = 'var(--border-color)';
            applyButton.style.color = 'var(--text-color)';
            validateInput();
        };

        // Event listeners
        if (expressionInput) {
            // Use MutationObserver to watch for content changes
            const observer = new MutationObserver(checkForRangeDescriptor);
            observer.observe(expressionInput, {
                childList: true,
                subtree: true,
                characterData: true
            });

            // Also check on input events
            expressionInput.addEventListener('input', checkForRangeDescriptor);
        }

        if (derivationInput) {
            derivationInput.addEventListener('input', resetAppliedState);
            derivationInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !applyButton.disabled) {
                    applyDerivation();
                }
            });
        }

        if (applyButton) {
            applyButton.addEventListener('click', applyDerivation);
        }

        // Initial check
        checkForRangeDescriptor();
    }
}
