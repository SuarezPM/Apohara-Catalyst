//! Dependency graph module for tracking file-to-dependency relationships
//!
//! Provides a graph data structure for tracking transitive imports across a codebase.

use std::collections::HashMap;
use std::path::PathBuf;
use tracing::{debug, warn};

/// A directed graph representing file dependencies
///
/// Stores a mapping from source files to their direct dependencies,
/// supporting various import resolution strategies (relative paths, npm packages, Rust crate paths).
#[derive(Debug, Clone, Default)]
pub struct DependencyGraph {
    /// Map from file path to its direct dependencies (outgoing edges)
    edges: HashMap<PathBuf, Vec<PathBuf>>,
    /// Set of all files in the graph (nodes)
    nodes: HashMap<PathBuf, ()>,
}

impl DependencyGraph {
    /// Create a new empty dependency graph
    pub fn new() -> Self {
        Self {
            edges: HashMap::new(),
            nodes: HashMap::new(),
        }
    }

    /// Add a file node to the graph
    ///
    /// If the file already exists, this is a no-op.
    pub fn add_file(&mut self, file: impl Into<PathBuf>) {
        let path = file.into();
        self.nodes.insert(path.clone(), ());
        // Ensure the file has an entry in edges even with no dependencies yet
        self.edges.entry(path).or_insert_with(Vec::new);
    }

    /// Add a dependency edge from a source file to a target file
    ///
    /// Both files are added as nodes if they don't exist.
    /// Handles duplicate edges gracefully.
    pub fn add_dependency(&mut self, source: impl Into<PathBuf>, target: impl Into<PathBuf>) {
        let source = source.into();
        let target = target.into();
        
        // Ensure both nodes exist
        self.nodes.insert(source.clone(), ());
        self.nodes.insert(target.clone(), ());
        
        // Add the edge
        self.edges
            .entry(source.clone())
            .or_insert_with(Vec::new);
        
        // Avoid duplicate dependencies
        let edges = self.edges.get_mut(&source).unwrap();
        if !edges.contains(&target) {
            edges.push(target);
        }
    }

    /// Get direct dependencies of a file
    ///
    /// Returns an empty vector if the file is not in the graph.
    pub fn get_direct_dependencies(&self, file: impl Into<PathBuf>) -> Vec<PathBuf> {
        let file = file.into();
        self.edges.get(&file).cloned().unwrap_or_default()
    }

    /// Get the blast radius of a module: all files that transitively import it
    ///
    /// This is the inverse of the dependency graph - finds all files that depend on
    /// the given target, either directly or indirectly.
    ///
    /// Returns an empty set if the target is not in the graph.
    /// Uses iterative BFS to handle large graphs efficiently.
    /// Implements cycle detection via visited set to handle circular dependencies.
    pub fn get_blast_radius(&self, target: impl Into<PathBuf>) -> Vec<PathBuf> {
        let target = target.into();
        
        debug!("Computing blast radius for target: {:?}", target);
        
        if !self.nodes.contains_key(&target) {
            debug!("Target {:?} not in graph, returning empty", target);
            return Vec::new();
        }
        
        // Build reverse graph (dependencies -> dependents)
        let mut reverse_edges: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
        for (source, deps) in &self.edges {
            for dep in deps {
                // Detect self-loops
                if source == dep {
                    warn!("Self-loop detected: {:?} imports itself", source);
                }
                reverse_edges
                    .entry(dep.clone())
                    .or_insert_with(Vec::new)
                    .push(source.clone());
            }
        }
        
        // If target has no dependents, return empty
        let Some(initial_dependents) = reverse_edges.get(&target) else {
            debug!("Target {:?} has no dependents", target);
            return Vec::new();
        };
        
        // BFS to find all transitively dependent files
        let mut visited: HashMap<PathBuf, ()> = HashMap::new();
        let mut queue: Vec<PathBuf> = initial_dependents.clone();
        let mut depth: usize = 0;
        
        // Mark initial dependents as visited
        for dep in initial_dependents {
            visited.insert(dep.clone(), ());
        }
        
        debug!("Starting BFS traversal with {} initial dependents", initial_dependents.len());
        
        while let Some(current) = queue.pop() {
            // Get dependents of current node
            if let Some(dependents) = reverse_edges.get(&current) {
                for dep in dependents {
                    if !visited.contains_key(dep) {
                        visited.insert(dep.clone(), ());
                        queue.push(dep.clone());
                        depth += 1;
                    }
                }
            }
        }
        
        debug!("BFS traversal complete: visited {} files at depth {}", visited.len(), depth);
        
        // Convert to sorted vector for deterministic output
        let mut result: Vec<PathBuf> = visited.into_keys().collect();
        result.sort();
        result
    }

    /// Get all files in the graph
    pub fn files(&self) -> Vec<PathBuf> {
        let mut files: Vec<PathBuf> = self.nodes.keys().cloned().collect();
        files.sort();
        files
    }

    /// Get the total number of files (nodes) in the graph
    pub fn file_count(&self) -> usize {
        self.nodes.len()
    }

    /// Get the total number of dependency edges in the graph
    pub fn edge_count(&self) -> usize {
        self.edges.values().map(|v| v.len()).sum()
    }

    /// Check if a file exists in the graph
    pub fn contains_file(&self, file: impl Into<PathBuf>) -> bool {
        self.nodes.contains_key(&file.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_file() {
        let mut graph = DependencyGraph::new();
        graph.add_file("src/main.rs");
        
        assert!(graph.contains_file("src/main.rs"));
        assert_eq!(graph.file_count(), 1);
        assert_eq!(graph.edge_count(), 0);
    }

    #[test]
    fn test_add_dependency() {
        let mut graph = DependencyGraph::new();
        graph.add_file("src/main.rs");
        graph.add_file("src/utils.rs");
        graph.add_dependency("src/main.rs", "src/utils.rs");
        
        let deps = graph.get_direct_dependencies("src/main.rs");
        assert_eq!(deps.len(), 1);
        assert!(deps.contains(&PathBuf::from("src/utils.rs")));
    }

    #[test]
    fn test_get_direct_dependencies_empty() {
        let graph = DependencyGraph::new();
        let deps = graph.get_direct_dependencies("nonexistent.rs");
        assert!(deps.is_empty());
    }

    #[test]
    fn test_get_direct_dependencies_file_no_deps() {
        let mut graph = DependencyGraph::new();
        graph.add_file("src/main.rs");
        
        let deps = graph.get_direct_dependencies("src/main.rs");
        assert!(deps.is_empty());
    }

    #[test]
    fn test_get_blast_radius_direct() {
        let mut graph = DependencyGraph::new();
        graph.add_file("src/lib.rs");
        graph.add_file("src/main.rs");
        graph.add_file("src/cli.rs");
        
        // main.rs imports lib.rs
        graph.add_dependency("src/main.rs", "src/lib.rs");
        // cli.rs imports main.rs (transitive)
        graph.add_dependency("src/cli.rs", "src/main.rs");
        
        // lib.rs is imported by main.rs (direct)
        let blast = graph.get_blast_radius("src/lib.rs");
        assert!(blast.contains(&PathBuf::from("src/main.rs")));
    }

    #[test]
    fn test_get_blast_radius_transitive() {
        let mut graph = DependencyGraph::new();
        graph.add_file("src/lib.rs");
        graph.add_file("src/main.rs");
        graph.add_file("src/cli.rs");
        
        graph.add_dependency("src/main.rs", "src/lib.rs");
        graph.add_dependency("src/cli.rs", "src/main.rs");
        
        // Both main.rs and cli.rs should be in blast radius of lib.rs
        let blast = graph.get_blast_radius("src/lib.rs");
        assert_eq!(blast.len(), 2);
        assert!(blast.contains(&PathBuf::from("src/main.rs")));
        assert!(blast.contains(&PathBuf::from("src/cli.rs")));
    }

    #[test]
    fn test_get_blast_radius_no_dependents() {
        let mut graph = DependencyGraph::new();
        graph.add_file("src/lib.rs");
        
        // lib.rs has no dependents
        let blast = graph.get_blast_radius("src/lib.rs");
        assert!(blast.is_empty());
    }

    #[test]
    fn test_get_blast_radius_missing_file() {
        let graph = DependencyGraph::new();
        
        let blast = graph.get_blast_radius("nonexistent.rs");
        assert!(blast.is_empty());
    }

    #[test]
    fn test_no_duplicate_dependencies() {
        let mut graph = DependencyGraph::new();
        graph.add_file("src/main.rs");
        graph.add_file("src/utils.rs");
        
        // Add same dependency twice
        graph.add_dependency("src/main.rs", "src/utils.rs");
        graph.add_dependency("src/main.rs", "src/utils.rs");
        
        let deps = graph.get_direct_dependencies("src/main.rs");
        assert_eq!(deps.len(), 1);
    }

    #[test]
    fn test_graph_statistics() {
        let mut graph = DependencyGraph::new();
        graph.add_file("src/lib.rs");
        graph.add_file("src/main.rs");
        graph.add_file("src/utils.rs");
        
        graph.add_dependency("src/main.rs", "src/lib.rs");
        graph.add_dependency("src/main.rs", "src/utils.rs");
        graph.add_dependency("src/utils.rs", "src/lib.rs");
        
        assert_eq!(graph.file_count(), 3);
        assert_eq!(graph.edge_count(), 3);
    }

    #[test]
    fn test_self_loop_handling() {
        let mut graph = DependencyGraph::new();
        graph.add_file("src/cyclic.rs");
        
        // Self-loop: file imports itself
        graph.add_dependency("src/cyclic.rs", "src/cyclic.rs");
        
        // Should not cause infinite loop - visited set prevents it
        let deps = graph.get_direct_dependencies("src/cyclic.rs");
        assert_eq!(deps.len(), 1);
        assert!(deps.contains(&PathBuf::from("src/cyclic.rs")));
        
        // Blast radius of self-referencing file includes itself
        // (it transitively "depends" on itself via self-loop)
        let blast = graph.get_blast_radius("src/cyclic.rs");
        assert!(blast.contains(&PathBuf::from("src/cyclic.rs")));
    }

    #[test]
    fn test_circular_dependency_handling() {
        let mut graph = DependencyGraph::new();
        graph.add_file("src/a.rs");
        graph.add_file("src/b.rs");
        
        // Circular: a imports b, b imports a
        graph.add_dependency("src/a.rs", "src/b.rs");
        graph.add_dependency("src/b.rs", "src/a.rs");
        
        // Direct dependencies work
        let deps_a = graph.get_direct_dependencies("src/a.rs");
        let deps_b = graph.get_direct_dependencies("src/b.rs");
        assert_eq!(deps_a.len(), 1);
        assert_eq!(deps_b.len(), 1);
        
        // Blast radius of a should include b (and stop due to visited set)
        let blast = graph.get_blast_radius("src/a.rs");
        assert!(blast.contains(&PathBuf::from("src/b.rs")));
    }
}