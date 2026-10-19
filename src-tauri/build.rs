fn main() {
    // Bundle the same production frontend for the offline browser launcher.
    let root = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../dist");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut entries = Vec::new();
    fn visit(root: &std::path::Path, folder: &std::path::Path, entries: &mut Vec<String>) {
        if let Ok(files) = std::fs::read_dir(folder) {
            for file in files.flatten() {
                let path = file.path();
                if path.is_dir() { visit(root, &path, entries); }
                else {
                    let name = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                    entries.push(format!("({:?}, include_bytes!({:?}) as &'static [u8])", format!("/{name}"), path));
                }
            }
        }
    }
    visit(&root, &root, &mut entries);
    entries.sort();
    let output = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("web_assets.rs");
    std::fs::write(output, format!("const ASSETS: &[(&str, &[u8])] = &[{}];", entries.join(","))).unwrap();
    tauri_build::build()
}
