pub(crate) fn is_descriptor_wrapper(expression: &str) -> bool {
	expression.starts_with("wsh(") || expression.starts_with("sh(") || expression.starts_with("wpkh(")
}

pub(crate) fn needs_descriptor_processing(expression: &str) -> bool {
	let trimmed = expression.trim();
	(trimmed.contains("tpub") || trimmed.contains("xpub") || trimmed.contains("[")) 
		&& !trimmed.starts_with("wsh(") 
		&& !trimmed.starts_with("sh(") 
		&& !trimmed.starts_with("wpkh(")
}

pub(crate) fn detect_network(expression: &str) -> bitcoin::Network {
	if expression.contains("tpub") {
		bitcoin::Network::Testnet
	} else {
		bitcoin::Network::Bitcoin
	}
}
