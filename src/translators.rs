//! Key translators for converting between different key types

use miniscript::{Translator, DescriptorPublicKey, MiniscriptKey, ToPublicKey};
use bitcoin::{PublicKey, XOnlyPublicKey};

// ============================================================================
// Descriptor to PublicKey Translator
// ============================================================================

/// Translator for converting DescriptorPublicKey to PublicKey
pub struct DescriptorKeyTranslator;

impl DescriptorKeyTranslator {
    pub fn new() -> Self {
        Self
    }
}

impl Translator<DescriptorPublicKey, PublicKey, ()> for DescriptorKeyTranslator {
    fn pk(&mut self, pk: &DescriptorPublicKey) -> Result<PublicKey, ()> {
        pk.clone()
            .at_derivation_index(0)
            .map(|key| key.to_public_key())
            .map_err(|_| ())
    }
    
    fn sha256(&mut self, hash: &<DescriptorPublicKey as MiniscriptKey>::Sha256) -> Result<<PublicKey as MiniscriptKey>::Sha256, ()> {
        Ok(*hash)
    }

    fn hash256(&mut self, hash: &<DescriptorPublicKey as MiniscriptKey>::Hash256) -> Result<<PublicKey as MiniscriptKey>::Hash256, ()> {
        Ok(*hash)
    }

    fn ripemd160(&mut self, hash: &<DescriptorPublicKey as MiniscriptKey>::Ripemd160) -> Result<<PublicKey as MiniscriptKey>::Ripemd160, ()> {
        Ok(*hash)
    }

    fn hash160(&mut self, hash: &<DescriptorPublicKey as MiniscriptKey>::Hash160) -> Result<<PublicKey as MiniscriptKey>::Hash160, ()> {
        Ok(*hash)
    }
}

// ============================================================================
// Descriptor to XOnlyPublicKey Translator
// ============================================================================

/// Translator for converting DescriptorPublicKey to XOnlyPublicKey (for Taproot)
pub struct XOnlyKeyTranslator;

impl XOnlyKeyTranslator {
    pub fn new() -> Self {
        Self
    }
}

impl Translator<DescriptorPublicKey, XOnlyPublicKey, ()> for XOnlyKeyTranslator {
    fn pk(&mut self, pk: &DescriptorPublicKey) -> Result<XOnlyPublicKey, ()> {
        let key = pk.clone()
            .at_derivation_index(0)
            .map_err(|_| ())?;
        
        let pk = key.to_public_key();
        // Only allow actual x-only keys (32 bytes), reject compressed keys (33 bytes)
        if pk.to_bytes().len() == 32 {
            // This should be an actual x-only key
            XOnlyPublicKey::from_slice(&pk.to_bytes()).map_err(|_| ())
        } else {
            // Reject compressed keys - don't convert them
            Err(())
        }
    }
    
    fn sha256(&mut self, hash: &<DescriptorPublicKey as MiniscriptKey>::Sha256) -> Result<<XOnlyPublicKey as MiniscriptKey>::Sha256, ()> {
        Ok(*hash)
    }

    fn hash256(&mut self, hash: &<DescriptorPublicKey as MiniscriptKey>::Hash256) -> Result<<XOnlyPublicKey as MiniscriptKey>::Hash256, ()> {
        Ok(*hash)
    }

    fn ripemd160(&mut self, hash: &<DescriptorPublicKey as MiniscriptKey>::Ripemd160) -> Result<<XOnlyPublicKey as MiniscriptKey>::Ripemd160, ()> {
        Ok(*hash)
    }

    fn hash160(&mut self, hash: &<DescriptorPublicKey as MiniscriptKey>::Hash160) -> Result<<XOnlyPublicKey as MiniscriptKey>::Hash160, ()> {
        Ok(*hash)
    }
}

// ============================================================================
// PublicKey to XOnlyPublicKey Translator
// ============================================================================

/// Translator for converting PublicKey to XOnlyPublicKey (for Taproot policy compilation)
pub struct PublicKeyToXOnlyTranslator;

impl PublicKeyToXOnlyTranslator {
    pub fn new() -> Self {
        Self
    }
}

impl Translator<PublicKey, XOnlyPublicKey, ()> for PublicKeyToXOnlyTranslator {
    fn pk(&mut self, pk: &PublicKey) -> Result<XOnlyPublicKey, ()> {
        // Only allow actual x-only keys (32 bytes), reject compressed keys (33 bytes)  
        if pk.to_bytes().len() == 32 {
            XOnlyPublicKey::from_slice(&pk.to_bytes()).map_err(|_| ())
        } else {
            // Reject compressed keys - don't convert them
            Err(())
        }
    }
    
    fn sha256(&mut self, hash: &<PublicKey as MiniscriptKey>::Sha256) -> Result<<XOnlyPublicKey as MiniscriptKey>::Sha256, ()> {
        Ok(*hash)
    }

    fn hash256(&mut self, hash: &<PublicKey as MiniscriptKey>::Hash256) -> Result<<XOnlyPublicKey as MiniscriptKey>::Hash256, ()> {
        Ok(*hash)
    }

    fn ripemd160(&mut self, hash: &<PublicKey as MiniscriptKey>::Ripemd160) -> Result<<XOnlyPublicKey as MiniscriptKey>::Ripemd160, ()> {
        Ok(*hash)
    }

    fn hash160(&mut self, hash: &<PublicKey as MiniscriptKey>::Hash160) -> Result<<XOnlyPublicKey as MiniscriptKey>::Hash160, ()> {
        Ok(*hash)
    }
}