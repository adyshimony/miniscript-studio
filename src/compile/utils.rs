//! Compile utilities

use crate::console_log;

/// Transform top-level OR patterns to tree notation for Taproot
pub fn transform_or_to_tree(miniscript: &str) -> String {
    let trimmed = miniscript.trim();

    // Only transform if it starts with or_d, or_c, or or_i
    if trimmed.starts_with("or_d(") || trimmed.starts_with("or_c(") || trimmed.starts_with("or_i(") {
        console_log!("Transforming OR pattern to tree notation: {}", trimmed);

        // Find the opening parenthesis
        if let Some(start_idx) = trimmed.find('(') {
            let inner = &trimmed[start_idx + 1..];

            // Find the comma at the correct depth
            let mut depth = 0;
            let mut comma_pos = None;

            for (i, ch) in inner.chars().enumerate() {
                match ch {
                    '(' => depth += 1,
                    ')' => {
                        if depth == 0 {
                            // Found the closing parenthesis of the OR
                            if comma_pos.is_none() {
                                console_log!("WARNING: No comma found in OR pattern");
                                return miniscript.to_string();
                            }
                            break;
                        }
                        depth -= 1;
                    },
                    ',' if depth == 0 => {
                        comma_pos = Some(i);
                        // Continue to find the closing parenthesis
                    },
                    _ => {}
                }
            }

            if let Some(comma_idx) = comma_pos {
                // Extract left and right branches
                let left_branch = inner[..comma_idx].trim();

                // Find the end of the right branch
                let mut depth = 0;
                let mut right_end = inner.len();
                for (i, ch) in inner[comma_idx + 1..].chars().enumerate() {
                    match ch {
                        '(' => depth += 1,
                        ')' => {
                            if depth == 0 {
                                right_end = comma_idx + 1 + i;
                                break;
                            }
                            depth -= 1;
                        },
                        _ => {}
                    }
                }

                let right_branch = inner[comma_idx + 1..right_end].trim();

                let result = format!("{{{},{}}}", left_branch, right_branch);
                console_log!("Transformed to tree notation: {}", result);
                return result;
            }
        }
    }

    // No transformation needed
    miniscript.to_string()
}