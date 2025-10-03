/**
 * @module constants
 * @description Application-wide constants for the Miniscript Compiler
 *
 * These values are extracted from the codebase to centralize configuration
 * and eliminate magic numbers throughout the application.
 */

/**
 * @constant {Object} CONSTANTS
 * @description Central configuration object containing all magic numbers and constants
 */
export const CONSTANTS = {
    // Timing constants
    HIGHLIGHT_DELAY_MS: 500,          // Delay for syntax highlighting
    INIT_DELAY_MS: 100,               // Initialization delay
    UNDO_TIMEOUT_MS: 1000,            // Undo state save timeout

    // Bitcoin constants
    SIGNATURE_WEIGHT_UNITS: 66,       // Bitcoin signature weight units
    COMPRESSED_PUBKEY_BYTES: 33,      // Compressed public key size in bytes
    SIGNATURE_SIZE_BYTES: 73,         // Maximum signature size in bytes

    // Key format constants
    XONLY_KEY_LENGTH: 64,             // X-only key hex string length
    COMPRESSED_KEY_LENGTH: 66,        // Compressed key hex string length

    // Taproot constants
    NUMS_KEY: '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0', // NUMS point for unspendable key path

    // Stack limits
    MAX_UNDO_STATES: 50,              // Maximum undo history states

    // Default timelock
    DEFAULT_TIMELOCK_BLOCKS: 144      // Default timelock in blocks (1 day)
};