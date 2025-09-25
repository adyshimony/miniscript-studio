//! Key translators for converting between different key types

use miniscript::{Translator, DescriptorPublicKey, MiniscriptKey, ToPublicKey};
use bitcoin::{PublicKey, XOnlyPublicKey};


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

/// Translator for converting DescriptorPublicKey to XOnlyPublicKey (for Taproot)
pub struct XOnlyDescriptorKeyTranslator;

impl XOnlyDescriptorKeyTranslator {
    pub fn new() -> Self {
        Self
    }
}

impl Translator<DescriptorPublicKey, XOnlyPublicKey, ()> for XOnlyDescriptorKeyTranslator {
    fn pk(&mut self, pk: &DescriptorPublicKey) -> Result<XOnlyPublicKey, ()> {
        pk.clone()
            .at_derivation_index(0)
            .map(|key| {
                let pubkey = key.to_public_key();
                // Convert compressed PublicKey to XOnlyPublicKey by extracting x-coordinate
                XOnlyPublicKey::from(pubkey)
            })
            .map_err(|_| ())
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


