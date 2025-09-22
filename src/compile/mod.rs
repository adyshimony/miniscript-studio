pub mod policy;
pub mod miniscript;
pub mod types;
pub mod modes;
pub mod engine;

pub(crate) fn compile_policy_to_miniscript(policy: &str, context: &str) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
	crate::compile_policy_to_miniscript(policy, context)
}

pub(crate) fn compile_policy_to_miniscript_with_mode(policy: &str, context: &str, mode: &str) -> Result<(String, String, Option<String>, usize, String, String, Option<usize>, Option<u64>, Option<bool>, Option<bool>), String> {
	crate::compile_policy_to_miniscript_with_mode(policy, context, mode)
}
