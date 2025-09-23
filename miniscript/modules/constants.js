// Constants for the Miniscript Compiler
// These magic numbers are extracted for better maintainability

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

    // Stack limits
    MAX_UNDO_STATES: 50,              // Maximum undo history states

    // Default timelock
    DEFAULT_TIMELOCK_BLOCKS: 144      // Default timelock in blocks (1 day)
};