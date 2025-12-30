//! Bitcoin Script opcode mapping and parsing utilities

use bitcoin::blockdata::script::{Builder, PushBytesBuf, ScriptBuf};
use bitcoin::blockdata::opcodes::all;
use std::collections::HashMap;
use lazy_static::lazy_static;


lazy_static! {
    /// Static mapping of opcode strings to their corresponding Bitcoin opcodes  
    pub static ref OPCODE_MAP: HashMap<&'static str, bitcoin::blockdata::opcodes::Opcode> = {
        let mut m = HashMap::new();
        
        // Numbers
        m.insert("OP_0", all::OP_PUSHBYTES_0);
        m.insert("OP_FALSE", all::OP_PUSHBYTES_0);
        m.insert("OP_PUSHNUM_0", all::OP_PUSHBYTES_0);
        m.insert("OP_1", all::OP_PUSHNUM_1);
        m.insert("OP_TRUE", all::OP_PUSHNUM_1);
        m.insert("OP_PUSHNUM_1", all::OP_PUSHNUM_1);
        m.insert("OP_PUSHNUM_NEG1", all::OP_PUSHNUM_NEG1);
        m.insert("OP_1NEGATE", all::OP_PUSHNUM_NEG1);
        
        m.insert("OP_2", all::OP_PUSHNUM_2);
        m.insert("OP_PUSHNUM_2", all::OP_PUSHNUM_2);
        m.insert("OP_3", all::OP_PUSHNUM_3);
        m.insert("OP_PUSHNUM_3", all::OP_PUSHNUM_3);
        m.insert("OP_4", all::OP_PUSHNUM_4);
        m.insert("OP_PUSHNUM_4", all::OP_PUSHNUM_4);
        m.insert("OP_5", all::OP_PUSHNUM_5);
        m.insert("OP_PUSHNUM_5", all::OP_PUSHNUM_5);
        m.insert("OP_6", all::OP_PUSHNUM_6);
        m.insert("OP_PUSHNUM_6", all::OP_PUSHNUM_6);
        m.insert("OP_7", all::OP_PUSHNUM_7);
        m.insert("OP_PUSHNUM_7", all::OP_PUSHNUM_7);
        m.insert("OP_8", all::OP_PUSHNUM_8);
        m.insert("OP_PUSHNUM_8", all::OP_PUSHNUM_8);
        m.insert("OP_9", all::OP_PUSHNUM_9);
        m.insert("OP_PUSHNUM_9", all::OP_PUSHNUM_9);
        m.insert("OP_10", all::OP_PUSHNUM_10);
        m.insert("OP_PUSHNUM_10", all::OP_PUSHNUM_10);
        m.insert("OP_11", all::OP_PUSHNUM_11);
        m.insert("OP_PUSHNUM_11", all::OP_PUSHNUM_11);
        m.insert("OP_12", all::OP_PUSHNUM_12);
        m.insert("OP_PUSHNUM_12", all::OP_PUSHNUM_12);
        m.insert("OP_13", all::OP_PUSHNUM_13);
        m.insert("OP_PUSHNUM_13", all::OP_PUSHNUM_13);
        m.insert("OP_14", all::OP_PUSHNUM_14);
        m.insert("OP_PUSHNUM_14", all::OP_PUSHNUM_14);
        m.insert("OP_15", all::OP_PUSHNUM_15);
        m.insert("OP_PUSHNUM_15", all::OP_PUSHNUM_15);
        m.insert("OP_16", all::OP_PUSHNUM_16);
        m.insert("OP_PUSHNUM_16", all::OP_PUSHNUM_16);
        
        // Crypto
        m.insert("OP_DUP", all::OP_DUP);
        m.insert("OP_HASH160", all::OP_HASH160);
        m.insert("OP_HASH256", all::OP_HASH256);
        m.insert("OP_SHA256", all::OP_SHA256);
        m.insert("OP_SHA1", all::OP_SHA1);
        m.insert("OP_RIPEMD160", all::OP_RIPEMD160);
        
        // Comparison
        m.insert("OP_EQUAL", all::OP_EQUAL);
        m.insert("OP_EQUALVERIFY", all::OP_EQUALVERIFY);
        
        // Signature verification
        m.insert("OP_CHECKSIG", all::OP_CHECKSIG);
        m.insert("OP_CHECKSIGVERIFY", all::OP_CHECKSIGVERIFY);
        m.insert("OP_CHECKMULTISIG", all::OP_CHECKMULTISIG);
        m.insert("OP_CHECKMULTISIGVERIFY", all::OP_CHECKMULTISIGVERIFY);
        m.insert("OP_CHECKSIGADD", all::OP_CHECKSIGADD);
        
        // Timelocks
        m.insert("OP_CHECKLOCKTIMEVERIFY", all::OP_CLTV);
        m.insert("OP_CLTV", all::OP_CLTV);
        m.insert("OP_CHECKSEQUENCEVERIFY", all::OP_CSV);
        m.insert("OP_CSV", all::OP_CSV);
        
        // Control flow
        m.insert("OP_IF", all::OP_IF);
        m.insert("OP_NOTIF", all::OP_NOTIF);
        m.insert("OP_ELSE", all::OP_ELSE);
        m.insert("OP_ENDIF", all::OP_ENDIF);
        m.insert("OP_VERIFY", all::OP_VERIFY);
        m.insert("OP_RETURN", all::OP_RETURN);
        
        // Stack operations
        m.insert("OP_SIZE", all::OP_SIZE);
        m.insert("OP_SWAP", all::OP_SWAP);
        m.insert("OP_DROP", all::OP_DROP);
        m.insert("OP_OVER", all::OP_OVER);
        m.insert("OP_PICK", all::OP_PICK);
        m.insert("OP_ROLL", all::OP_ROLL);
        m.insert("OP_ROT", all::OP_ROT);
        m.insert("OP_2DUP", all::OP_2DUP);
        m.insert("OP_2DROP", all::OP_2DROP);
        m.insert("OP_NIP", all::OP_NIP);
        m.insert("OP_TUCK", all::OP_TUCK);
        m.insert("OP_FROMALTSTACK", all::OP_FROMALTSTACK);
        m.insert("OP_TOALTSTACK", all::OP_TOALTSTACK);
        m.insert("OP_IFDUP", all::OP_IFDUP);
        m.insert("OP_DEPTH", all::OP_DEPTH);
        m.insert("OP_2OVER", all::OP_2OVER);
        m.insert("OP_2ROT", all::OP_2ROT);
        m.insert("OP_2SWAP", all::OP_2SWAP);
        m.insert("OP_3DUP", all::OP_3DUP);
        
        // Arithmetic
        m.insert("OP_ADD", all::OP_ADD);
        m.insert("OP_SUB", all::OP_SUB);
        m.insert("OP_MUL", all::OP_MUL);
        m.insert("OP_DIV", all::OP_DIV);
        m.insert("OP_MOD", all::OP_MOD);
        m.insert("OP_LSHIFT", all::OP_LSHIFT);
        m.insert("OP_RSHIFT", all::OP_RSHIFT);
        m.insert("OP_BOOLAND", all::OP_BOOLAND);
        m.insert("OP_BOOLOR", all::OP_BOOLOR);
        m.insert("OP_NUMEQUAL", all::OP_NUMEQUAL);
        m.insert("OP_NUMEQUALVERIFY", all::OP_NUMEQUALVERIFY);
        m.insert("OP_NUMNOTEQUAL", all::OP_NUMNOTEQUAL);
        m.insert("OP_LESSTHAN", all::OP_LESSTHAN);
        m.insert("OP_GREATERTHAN", all::OP_GREATERTHAN);
        m.insert("OP_LESSTHANOREQUAL", all::OP_LESSTHANOREQUAL);
        m.insert("OP_GREATERTHANOREQUAL", all::OP_GREATERTHANOREQUAL);
        m.insert("OP_MIN", all::OP_MIN);
        m.insert("OP_MAX", all::OP_MAX);
        m.insert("OP_WITHIN", all::OP_WITHIN);
        m.insert("OP_NEGATE", all::OP_NEGATE);
        m.insert("OP_ABS", all::OP_ABS);
        m.insert("OP_NOT", all::OP_NOT);
        m.insert("OP_0NOTEQUAL", all::OP_0NOTEQUAL);
        
        // Bitwise operations
        m.insert("OP_CAT", all::OP_CAT);
        m.insert("OP_SUBSTR", all::OP_SUBSTR);
        m.insert("OP_LEFT", all::OP_LEFT);
        m.insert("OP_RIGHT", all::OP_RIGHT);
        m.insert("OP_INVERT", all::OP_INVERT);
        m.insert("OP_AND", all::OP_AND);
        m.insert("OP_OR", all::OP_OR);
        m.insert("OP_XOR", all::OP_XOR);
        
        // Reserved/NOPs
        m.insert("OP_RESERVED", all::OP_RESERVED);
        m.insert("OP_VER", all::OP_VER);
        m.insert("OP_VERIF", all::OP_VERIF);
        m.insert("OP_VERNOTIF", all::OP_VERNOTIF);
        m.insert("OP_RESERVED1", all::OP_RESERVED1);
        m.insert("OP_RESERVED2", all::OP_RESERVED2);
        m.insert("OP_NOP", all::OP_NOP);
        m.insert("OP_NOP1", all::OP_NOP1);
        m.insert("OP_NOP4", all::OP_NOP4);
        m.insert("OP_NOP5", all::OP_NOP5);
        m.insert("OP_NOP6", all::OP_NOP6);
        m.insert("OP_NOP7", all::OP_NOP7);
        m.insert("OP_NOP8", all::OP_NOP8);
        m.insert("OP_NOP9", all::OP_NOP9);
        m.insert("OP_NOP10", all::OP_NOP10);
        
        // Push data
        m.insert("OP_PUSHDATA1", all::OP_PUSHDATA1);
        m.insert("OP_PUSHDATA2", all::OP_PUSHDATA2);
        m.insert("OP_PUSHDATA4", all::OP_PUSHDATA4);
        
        m
    };
}


/// Parse Bitcoin Script ASM to ScriptBuf
pub fn parse_asm_to_script(asm: &str) -> Result<ScriptBuf, String> {
    let mut builder = Builder::new();
    let parts: Vec<&str> = asm.split_whitespace().collect();
    let mut i = 0;
    
    while i < parts.len() {
        let part = parts[i];
        let upper = part.to_uppercase();
        
        // Check if it's a known opcode
        if let Some(&opcode) = OPCODE_MAP.get(upper.as_str()) {
            builder = builder.push_opcode(opcode);
        }
        // Handle OP_PUSHBYTES_* opcodes
        else if upper.starts_with("OP_PUSHBYTES_") {
            builder = handle_pushbytes_opcode(builder, &upper, &parts, &mut i)?;
        }
        // Handle hex data
        else if is_hex_data(part) {
            builder = push_hex_data(builder, part)?;
        }
        // Try to parse as number
        else if let Ok(num) = part.parse::<i64>() {
            builder = builder.push_int(num);
        }
        else {
            return Err(format!("Unsupported opcode or invalid data: {}", part));
        }
        
        i += 1;
    }
    
    Ok(builder.into_script())
}

// Handle OP_PUSHBYTES_* opcodes
fn handle_pushbytes_opcode(builder: Builder, opcode: &str, parts: &[&str], index: &mut usize) -> Result<Builder, String> {
    let expected_size = opcode.strip_prefix("OP_PUSHBYTES_")
        .and_then(|s| s.parse::<usize>().ok())
        .ok_or_else(|| format!("Invalid OP_PUSHBYTES format: {}", opcode))?;

    if expected_size > 75 {
        return Err(format!("Invalid pushbytes size: {}", expected_size));
    }

    if *index + 1 >= parts.len() {
        return Err(format!("Missing hex data after {}", opcode));
    }

    let hex_data = parts[*index + 1];
    if !is_hex_data(hex_data) {
        return Err(format!("Expected hex data after {}, got: {}", opcode, hex_data));
    }

    let bytes = hex::decode(hex_data)
        .map_err(|_| "Invalid hex data after OP_PUSHBYTES")?;

    if bytes.len() != expected_size {
        return Err(format!(
            "OP_PUSHBYTES_{} expects {} bytes, got {} bytes",
            expected_size, expected_size, bytes.len()
        ));
    }

    let push_bytes = PushBytesBuf::try_from(bytes)
        .map_err(|_| "Invalid push bytes")?;

    *index += 1; // Skip the hex data token
    Ok(builder.push_slice(push_bytes))
}

// Check if a string is valid hex data
fn is_hex_data(s: &str) -> bool {
    s.len() >= 2 && s.len() % 2 == 0 && s.chars().all(|c| c.is_ascii_hexdigit())
}

// Push hex data to script builder
fn push_hex_data(builder: Builder, hex: &str) -> Result<Builder, String> {
    let bytes = hex::decode(hex)
        .map_err(|_| "Invalid hex in ASM")?;
    let push_bytes = PushBytesBuf::try_from(bytes)
        .map_err(|_| "Invalid push bytes")?;
    Ok(builder.push_slice(push_bytes))
}