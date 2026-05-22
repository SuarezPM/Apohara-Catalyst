//! Minimal token parser for Apohara integration test fixtures.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token { Word(String), Number(i64) }

pub fn parse_input(input: &str) -> Vec<Token> {
    input
        .split_whitespace()
        .map(|s| s.parse::<i64>().map(Token::Number).unwrap_or_else(|_| Token::Word(s.to_string())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_words_and_numbers() {
        let toks = parse_input("hello 42 world");
        assert_eq!(toks, vec![
            Token::Word("hello".into()),
            Token::Number(42),
            Token::Word("world".into()),
        ]);
    }
}
