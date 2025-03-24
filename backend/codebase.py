import os
import json
import re
import databutton as db
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List, Optional, Any

router = APIRouter()

class CodebaseStats(BaseModel):
    total_files: int
    total_directories: int
    total_size_bytes: int
    file_types: Dict[str, int]

class ImportInfo(BaseModel):
    path: str
    type: str

class FileNode(BaseModel):
    name: str
    path: str
    type: str  # 'file' or 'directory'
    size: int  # size in bytes for files
    last_modified: Optional[float] = None  # timestamp
    children: Optional[List[Any]] = None  # List of FileNode
    imports: Optional[List[ImportInfo]] = None  # List of import info objects
    language: Optional[str] = None  # Programming language

class CodebaseLink(BaseModel):
    source: str  # Source file path
    target: str  # Target file path (imported file)
    type: str    # Type of import

class CodebaseResponse(BaseModel):
    structure: FileNode
    stats: CodebaseStats
    links: List[CodebaseLink] = []

# Function to get file extension
def get_file_extension(file_path):
    _, ext = os.path.splitext(file_path)
    return ext.lower()[1:] if ext else ""  # Remove the dot

# Function to get programming language based on extension
def get_language(file_path):
    ext = get_file_extension(file_path)
    language_map = {
        'py': 'Python',
        'js': 'JavaScript',
        'jsx': 'JavaScript (React)',
        'ts': 'TypeScript',
        'tsx': 'TypeScript (React)',
        'html': 'HTML',
        'css': 'CSS',
        'json': 'JSON',
        'md': 'Markdown',
        'yml': 'YAML',
        'yaml': 'YAML',
        'txt': 'Text',
    }
    return language_map.get(ext, ext.upper() if ext else 'Unknown')

# Function to extract imports from a file with better metadata
def extract_imports(file_path, content, root_path="/app"):
    imports = []
    ext = get_file_extension(file_path)
    
    if ext in ['js', 'jsx', 'ts', 'tsx']:
        # JavaScript/TypeScript import regex patterns
        import_patterns = [
            # import X from 'Y'
            (r'import\s+.*?\s+from\s+[\'"](.*?)[\'"](;)?', 'module'),
            # import 'Y'
            (r'import\s+[\'"](.*?)[\'"](;)?', 'direct'),
            # require('Y')
            (r'require\s*?\(\s*[\'"](.*?)[\'"](;)?\)', 'require'),
        ]
        
        for pattern, import_type in import_patterns:
            matches = re.findall(pattern, content)
            for match in matches:
                import_path = match[0] if isinstance(match, tuple) else match
                if import_path:
                    # Normalize import paths for components, utils, etc.
                    if import_path.startswith('components/'):
                        normalized_path = f"/ui/src/{import_path}"
                        imports.append({'path': normalized_path, 'type': import_type})
                    elif import_path.startswith('utils/'):
                        normalized_path = f"/ui/src/{import_path}"
                        imports.append({'path': normalized_path, 'type': import_type})
                    elif import_path.startswith('@/'):
                        # Shadcn imports - these have special path in our system
                        normalized_path = f"/ui/src/{import_path[2:]}"
                        imports.append({'path': normalized_path, 'type': import_type})
                    elif not (import_path.startswith('.') or import_path.startswith('/')):
                        # Try to resolve absolute imports based on common patterns
                        if import_path in ['react', 'react-dom', 'react-router-dom', 'app', 'brain']:
                            imports.append({'path': import_path, 'type': 'external'})
                        else:
                            imports.append({'path': import_path, 'type': import_type})
                    else:
                        # Relative imports - try to resolve
                        dirname = os.path.dirname(file_path)
                        if import_path.startswith('.'):
                            # Attempt to resolve relative path
                            source_dir = os.path.dirname(os.path.join(root_path, file_path.lstrip('/')))
                            if import_path.startswith('./'):
                                full_path = os.path.normpath(os.path.join(source_dir, import_path[2:]))
                            elif import_path.startswith('../'):
                                full_path = os.path.normpath(os.path.join(source_dir, import_path))
                            else:
                                full_path = os.path.normpath(os.path.join(dirname, import_path))
                                
                            # Convert to relative path from root
                            if full_path.startswith(root_path):
                                rel_path = full_path[len(root_path):]
                                imports.append({'path': rel_path, 'type': import_type})
                            else:
                                imports.append({'path': import_path, 'type': import_type})
                        else:
                            imports.append({'path': import_path, 'type': import_type})
    
    elif ext == 'py':
        # Python import regex patterns
        import_patterns = [
            # import X
            (r'import\s+([\w\.]+)', 'module'),
            # from X import ...
            (r'from\s+([\w\.]+)\s+import', 'from'),
        ]
        
        for pattern, import_type in import_patterns:
            matches = re.findall(pattern, content)
            for match in matches:
                if match:
                    # Handle Python module paths
                    if match == 'app' or match.startswith('app.'):
                        module_path = match[4:] if match.startswith('app.') else ''
                        if module_path.startswith('apis.'):
                            # This is importing from another API
                            api_name = module_path[5:]
                            imports.append({'path': f"/src/app/apis/{api_name}", 'type': import_type})
                        else:
                            imports.append({'path': match, 'type': 'internal'})
                    elif match in ['databutton', 'fastapi', 'pydantic']:
                        imports.append({'path': match, 'type': 'external'})
                    else:
                        imports.append({'path': match, 'type': import_type})
    
    return imports

def scan_directory(base_path, current_path="", max_depth=5, all_files_map=None):
    """Recursively scan a directory and build a file tree structure"""
    if max_depth <= 0:
        return None
    
    if all_files_map is None:
        all_files_map = {}
    
    full_path = os.path.join(base_path, current_path)
    if not os.path.exists(full_path):
        return None
    
    # Get the actual name - handle special cases for API directories
    name = os.path.basename(current_path) or os.path.basename(base_path)
    
    # Special handling for API directories: If this is an API directory with __init__.py,
    # use the directory name as the name instead of the file
    if name == '__init__.py' and '/apis/' in current_path:
        # Extract the API name from the path
        api_dir = os.path.dirname(current_path)
        name = os.path.basename(api_dir) + '.py'  # Append .py to clearly show it's a Python file
    
    # Skip directories that are likely to cause performance issues
    excluded_dirs = ['.git', 'node_modules', '__pycache__', 'venv', '.venv', 'dist', 'build', '.next', '.idea']
    if name in excluded_dirs:
        return FileNode(
            name=name,
            path=current_path or "/",
            type="directory",
            size=0,
            children=[],
            last_modified=os.path.getmtime(full_path) if os.path.exists(full_path) else None
        )
    
    # For directories
    if os.path.isdir(full_path):
        children = []
        total_size = 0
        
        try:
            items = os.listdir(full_path)
            # Limit the number of items to scan to prevent excessive processing
            max_items = 100
            if len(items) > max_items:
                items = items[:max_items]
                
            for item in items:
                item_path = os.path.join(current_path, item)
                child_node = scan_directory(base_path, item_path, max_depth - 1, all_files_map)
                if child_node:
                    children.append(child_node)
                    if child_node.size:
                        total_size += child_node.size
                        
                    # Add file node to map for quick lookup
                    if child_node.type == "file":
                        all_files_map[child_node.path] = child_node
        except PermissionError:
            # Skip directories we can't access
            pass
        
        return FileNode(
            name=name,
            path=current_path or "/",
            type="directory",
            size=total_size,
            children=children,
            last_modified=os.path.getmtime(full_path) if os.path.exists(full_path) else None
        )
    
    # For files
    else:
        try:
            size = os.path.getsize(full_path)
            last_modified = os.path.getmtime(full_path)
            file_language = get_language(full_path)
            
            # Read file contents for import extraction (if appropriate file type)
            imports = []
            if get_file_extension(full_path) in ['js', 'jsx', 'ts', 'tsx', 'py']:
                try:
                    with open(full_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                        imports = extract_imports(current_path, content, base_path)
                except Exception as e:
                    # Skip files we can't read
                    print(f"Error reading {full_path}: {str(e)}")
                    pass
            
            file_node = FileNode(
                name=name,
                path=current_path,
                type="file",
                size=size,
                last_modified=last_modified,
                imports=imports,
                language=file_language
            )
            
            # Add file to map for quick lookup
            all_files_map[current_path] = file_node
            
            return file_node
        except (PermissionError, FileNotFoundError):
            # Skip files we can't access
            return None

def calculate_stats(structure):
    """Calculate statistics from the file structure"""
    stats = {
        "total_files": 0,
        "total_directories": 0,
        "total_size_bytes": 0,
        "file_types": {}
    }
    
    def traverse(node):
        if node.type == "directory":
            stats["total_directories"] += 1
            if node.children:
                for child in node.children:
                    traverse(child)
        else:  # file
            stats["total_files"] += 1
            stats["total_size_bytes"] += node.size
            
            # Get file extension
            ext = get_file_extension(node.path)
            if ext:
                stats["file_types"][ext] = stats["file_types"].get(ext, 0) + 1
            else:
                stats["file_types"]["no_extension"] = stats["file_types"].get("no_extension", 0) + 1
    
    traverse(structure)
    return CodebaseStats(**stats)

@router.get("/scan")
def scan_codebase():
    """Scans the codebase structure and returns a tree representation focusing on key app areas with file relationships"""
    try:
        # Use the current directory as the base path
        base_path = "/app"  # Assuming /app is the root of the project
        
        # Create a map to store all file nodes for quick reference
        all_files_map = {}
        
        # Define focused structure with key app areas
        structure = FileNode(
            name="Taskflow App",
            path="/",
            type="directory",
            size=0,
            children=[],
            last_modified=None
        )
        
        # Initialize categories with proper hierarchy
        categories = {
            "Pages": FileNode(
                name="Pages",
                path="/ui/src/pages",
                type="directory",
                size=0,
                children=[],
                last_modified=None
            ),
            "UI Components": FileNode(
                name="UI Components",
                path="/ui/src/components",
                type="directory",
                size=0,
                children=[],
                last_modified=None
            ),
            "UI Files": FileNode(
                name="UI Files",
                path="/ui/src/utils",
                type="directory",
                size=0,
                children=[],
                last_modified=None
            ),
            "APIs": FileNode(
                name="APIs",
                path="/src/app/apis",
                type="directory",
                size=0,
                children=[],
                last_modified=None
            ),
            "Media": FileNode(
                name="Media (Public)",
                path="/static-assets",
                type="directory",
                size=0,
                children=[],
                last_modified=None
            ),
            "Storage": FileNode(
                name="Internal Storage",
                path="/storage",
                type="directory",
                size=0,
                children=[],
                last_modified=None
            )
        }
        
        # Scan specific directories and build file map
        category_paths = {
            "Pages": "ui/src/pages",
            "UI Components": "ui/src/components",
            "UI Files": "ui/src/utils",
            "APIs": "src/app/apis"
        }
        
        for category, path in category_paths.items():
            dir_path = os.path.join(base_path, path)
            if os.path.exists(dir_path) and os.path.isdir(dir_path):
                node = scan_directory(base_path, path, all_files_map=all_files_map)
                if node:
                    categories[category].children = node.children
                    categories[category].size = node.size
                    structure.size += node.size
        
        # Add scanned categories to main structure
        for _, category_node in categories.items():
            if category_node.children:
                structure.children.append(category_node)
            elif category_node.name in ["Media (Public)", "Internal Storage"]:
                # Add empty placeholders for these categories
                simple_node = FileNode(
                    name=f"(No {category_node.name})",
                    path=category_node.path,
                    type="file",
                    size=100,  # Small size for visualization
                    language="Text"
                )
                category_node.children = [simple_node]
                structure.children.append(category_node)
        
        if not structure or not structure.children:
            raise HTTPException(status_code=500, detail="Failed to scan codebase structure")
        
        # Calculate stats
        stats = calculate_stats(structure)
        
        # Now build links based on imports
        links = []
        for file_path, file_node in all_files_map.items():
            if file_node.imports:
                for import_info in file_node.imports:
                    # ImportInfo objects have direct attributes
                    target_path = import_info.path
                    import_type = import_info.type
                    
                    # Skip external dependencies
                    if import_type == 'external':
                        continue
                    
                    # For standard imports in our app structure
                    link = CodebaseLink(
                        source=file_path,
                        target=target_path,
                        type=import_type
                    )
                    links.append(link)
        
        # Special handling for brain client API usage
        # Connect pages that use brain.X_method to the corresponding API files
        for file_path, file_node in all_files_map.items():
            # Check if this is a frontend file that might use brain methods
            if file_path.endswith(('.tsx', '.ts', '.jsx', '.js')) and file_node.imports:
                # Look for files that import the brain client
                brain_import = any(imp.path == 'brain' and imp.type == 'external' for imp in file_node.imports)
                
                if brain_import:
                    # Search file content for brain.X method calls
                    try:
                        with open(os.path.join(base_path, file_path), 'r', encoding='utf-8') as f:
                            content = f.read()
                            
                            # Look for calls to scan_codebase and get_codebase_history
                            if 'brain.scan_codebase' in content:
                                # Connect to codebase API
                                link = CodebaseLink(
                                    source=file_path,
                                    target="src/app/apis/codebase",
                                    type="api-usage"
                                )
                                links.append(link)
                                
                            if 'brain.get_codebase_history' in content:
                                # Connect to codebase API
                                link = CodebaseLink(
                                    source=file_path,
                                    target="src/app/apis/codebase",
                                    type="api-usage"
                                )
                                links.append(link)
                    except Exception:
                        # Skip if file can't be read
                        pass
        
        # Create response with links
        response = CodebaseResponse(
            structure=structure, 
            stats=stats,
            links=links
        )
        
        # Save a snapshot to storage
        snapshot_data = response.dict()
        db.storage.json.put("codebase-snapshot-latest", snapshot_data)
        
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error scanning codebase: {str(e)}")

@router.get("/history")
def get_codebase_history():
    """Gets the latest snapshot of the codebase structure"""
    try:
        # Try to get the latest snapshot
        snapshot = db.storage.json.get("codebase-snapshot-latest", default=None)
        if not snapshot:
            return {"message": "No codebase snapshot available. Please scan first."}
        
        return snapshot
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving codebase history: {str(e)}")