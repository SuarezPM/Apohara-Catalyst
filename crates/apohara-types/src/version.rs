use serde::{Deserialize, Serialize};

pub struct ApoharaVersion;

impl ApoharaVersion {
    pub const CURRENT: &'static str = "1.0.0-dev";

    pub fn is_compatible(other: &str) -> bool {
        let (major_self, _) = parse_major(Self::CURRENT);
        let (major_other, _) = parse_major(other);
        major_self == major_other
    }
}

fn parse_major(v: &str) -> (u32, &str) {
    let trimmed = v.trim_start_matches('v');
    let dot = trimmed.find('.').unwrap_or(trimmed.len());
    let major: u32 = trimmed[..dot].parse().unwrap_or(0);
    (major, &trimmed[dot..])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_majors() {
        assert_eq!(parse_major("1.0.0"), (1, ".0.0"));
        assert_eq!(parse_major("v2.5.1"), (2, ".5.1"));
    }
}
