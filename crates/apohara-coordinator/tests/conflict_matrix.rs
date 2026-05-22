use apohara_coordinator::conflict_matrix::{check, ConflictKind};
use apohara_coordinator::manifest::{SymbolKind, SymbolRef, TaskSymbolManifest};

fn sym(file: &str, name: &str) -> SymbolRef {
    SymbolRef { file: file.into(), symbol: name.into(), kind: SymbolKind::Function }
}

#[test]
fn read_read_does_not_conflict() {
    let a = TaskSymbolManifest { reads: vec![sym("a.ts", "foo")], writes: vec![], renames: vec![] };
    let b = TaskSymbolManifest { reads: vec![sym("a.ts", "foo")], writes: vec![], renames: vec![] };
    assert_eq!(check(&a, &b), ConflictKind::None);
}

#[test]
fn write_write_conflicts() {
    let a = TaskSymbolManifest { reads: vec![], writes: vec![sym("a.ts", "foo")], renames: vec![] };
    let b = TaskSymbolManifest { reads: vec![], writes: vec![sym("a.ts", "foo")], renames: vec![] };
    match check(&a, &b) {
        ConflictKind::WriteWrite { .. } => (),
        other => panic!("expected WriteWrite, got {:?}", other),
    }
}

#[test]
fn rename_conflicts_with_any_overlap() {
    let a = TaskSymbolManifest { reads: vec![], writes: vec![], renames: vec![sym("a.ts", "foo")] };
    let b = TaskSymbolManifest { reads: vec![sym("a.ts", "foo")], writes: vec![], renames: vec![] };
    match check(&a, &b) {
        ConflictKind::RenameVsRead { .. } => (),
        other => panic!("expected RenameVsRead, got {:?}", other),
    }
}

#[test]
fn write_read_conflicts() {
    let a = TaskSymbolManifest { reads: vec![], writes: vec![sym("a.ts", "foo")], renames: vec![] };
    let b = TaskSymbolManifest { reads: vec![sym("a.ts", "foo")], writes: vec![], renames: vec![] };
    match check(&a, &b) {
        ConflictKind::WriteRead { .. } => (),
        other => panic!("expected WriteRead, got {:?}", other),
    }
}

#[test]
fn disjoint_manifests_no_conflict() {
    let a = TaskSymbolManifest {
        reads: vec![sym("a.ts", "foo")],
        writes: vec![sym("b.ts", "bar")],
        renames: vec![],
    };
    let b = TaskSymbolManifest {
        reads: vec![sym("c.ts", "baz")],
        writes: vec![sym("d.ts", "qux")],
        renames: vec![],
    };
    assert_eq!(check(&a, &b), ConflictKind::None);
}
