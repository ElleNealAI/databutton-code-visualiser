import React, { useEffect, useRef, useState, useMemo } from "react";

// Debugging helper function that will help us diagnose connection issues
const getPathInfo = (path) => {
  if (!path) return 'undefined-path';
  return {
    path,
    basename: path.split('/').pop() || '',
    normalized: path.replace(/\.(tsx|ts|jsx|js|py)$/i, '').toLowerCase(),
    isApi: path.includes('/apis/') || path.includes('app/apis/')
  };
};

interface ImportInfo {
  path: string;
  type: string;
}

interface FileNode {
  name: string;
  path: string;
  type: string;
  size: number;
  last_modified?: number;
  children?: FileNode[];
  imports?: ImportInfo[];
  language?: string;
}

interface CodebaseLink {
  source: string;  // Source file path
  target: string;  // Target file path (imported file)
  type: string;    // Type of import
}

interface CodebaseStats {
  total_files: number;
  total_directories: number;
  total_size_bytes: number;
  file_types: Record<string, number>;
}

interface CodebaseResponse {
  structure: FileNode;
  stats: CodebaseStats;
  links?: CodebaseLink[];
}

interface Props {
  data: CodebaseResponse | null;
  onNodeSelect?: (node: FileNode) => void;
  width?: number;
  height?: number;
}

export function CodebaseVisualizer({ data, onNodeSelect, width = 800, height = 600 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Format bytes to human-readable format
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  // Function to visualize the codebase
  const visualizeCodebase = () => {
    if (!svgRef.current || !data?.structure || !window.d3) return;

    const d3 = window.d3;
    const svg = d3.select(svgRef.current);

    // Clear previous visualization
    svg.selectAll("*").remove();

    // Set dimensions
    const svgWidth = width || svgRef.current.clientWidth || 800;
    let svgHeight = 600;
    
    // Check if height is a string with % (like "100%")
    if (typeof height === 'string' && height.includes('%')) {
      // Use container height if available, otherwise use a fallback
      svgHeight = containerRef.current?.clientHeight || svgRef.current.parentElement?.clientHeight || 600;
      console.log("Using responsive height:", svgHeight);
    } else {
      svgHeight = (typeof height === 'number') ? height : 600;
    }

    // Set SVG attributes with explicit centering
    svg
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", [0, 0, svgWidth, svgHeight])
      .attr("style", "font: 10px sans-serif; background-color: #ffffff;")
      
    // Force reset any transforms and center content
    svg.call(d3.zoom().transform, d3.zoomIdentity);

    // Add a defs section for markers (arrowheads)
    const defs = svg.append("defs");

    // Define colors for different import types (but no markers)
    const markerColors = {
      "external": "#9333ea", // purple
      "module": "#2563eb", // blue
      "direct": "#059669", // green
      "require": "#d97706", // amber
      "internal": "#475569",  // slate
      "from": "#475569",     // slate
      "default": "#000000"   // black
    };
    
    // We don't use arrowhead markers anymore to avoid any persistent visibility issues

    // Create a group for all nodes with explicit centering
    const g = svg.append("g")
      .attr("transform", `translate(${svgWidth / 2}, ${svgHeight / 2})`);
    
    // Log the center point for debugging
    console.log(`Centering visualization at ${svgWidth / 2}, ${svgHeight / 2}`);

    // Color scale based on categories and file types
    const categoryColors = {
      "Pages": "#4CAF50",
      "UI Components": "#2196F3",
      "UI Files": "#9C27B0",
      "APIs": "#FF5722",
      "Media (Public)": "#FFEB3B",
      "Internal Storage": "#607D8B",
      "Taskflow App": "#333333"
    };

    const fileColors = {
      "JavaScript": "#f1e05a",
      "TypeScript": "#3178c6",
      "Python": "#3572A5",
      "HTML": "#e34c26",
      "CSS": "#563d7c",
      "JSON": "#292929",
      "Markdown": "#083fa1",
      "YAML": "#cb171e",
      "Text": "#cccccc",
      "TSX": "#3178c6",
      "JSX": "#f1e05a"
    };

    const getColor = (node: any) => {
      // Check if this is a main category
      if (categoryColors[node.name]) {
        return categoryColors[node.name];
      }

      // If directory, use a semi-transparent color
      if (node.type === "directory") {
        return "rgba(100, 100, 100, 0.2)";
      }

      // Handle common aliases for files
      const language = node.language || "Unknown";
      if (language === "TypeScript (React)") return fileColors["TSX"];
      if (language === "JavaScript (React)") return fileColors["JSX"];

      // Look up in our colors map or return a default color
      return fileColors[language] || "#8a8a8a";
    };

    // Create hierarchical layout with centered sizing
    const packLayout = d3.pack()
      .size([svgWidth * 0.8, svgHeight * 0.8])
      .padding(4);

    // Create hierarchy with proper sizing
    const root = d3.hierarchy(data.structure)
      .sum(d => d.type === "file" ? Math.max(d.size, 500) : 0) // Set minimum size for better visibility
      .sort((a, b) => b.value! - a.value!);

    // Apply the pack layout
    packLayout(root);

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => {
        // Only transform the main content group, not the legend
        g.attr("transform", event.transform);
        
        // Make absolutely sure the legend stays on top
        // These operations ensure the legend is always visible
        legend.raise();
        svg.selectAll(".codebase-legend")
          .style("visibility", "visible")
          .style("opacity", "1");
      });

    svg.call(zoom as any);
    
    // Also explicitly raise the legend after everything is done
    setTimeout(() => {
      legend.raise();
      console.log("Legend raised after timeout");
    }, 100);

    // Create a map for organizing files by directory
    const dirGroups: Map<string, d3.HierarchyCircularNode<any>[]> = new Map();

    // Helper to get directory path
    const getDirPath = (path: string) => {
      const parts = path.split("/");
      return parts.slice(0, -1).join("/") || "/";
    };

    // Group nodes by directory
    root.descendants().forEach(node => {
      if (node.data.type === "file") {
        const dirPath = getDirPath(node.data.path);
        if (!dirGroups.has(dirPath)) {
          dirGroups.set(dirPath, []);
        }
        dirGroups.get(dirPath)!.push(node);
      }
    });

    // Draw directory boundaries
    const dirNodes = root.descendants().filter(d => d.data.type === "directory");

    // Add directory boundaries with labels
    const dirGroupElements = g.selectAll(".dir-group")
      .data(dirNodes)
      .join("g")
      .attr("class", "dir-group")
      .attr("transform", d => `translate(${d.x},${d.y})`);

    // Add boundary circles for directories
    dirGroupElements.append("circle")
      .attr("r", d => d.r)
      .attr("fill", d => {
        // Main categories have a light fill
        if (categoryColors[d.data.name]) {
          return d.data.name === "Taskflow App" 
            ? "rgba(50, 50, 50, 0.03)" 
            : `${getColor(d.data)}40`; // 40 is hex for 25% opacity
        }
        return "rgba(100, 100, 100, 0.03)";
      })
      .attr("stroke", d => categoryColors[d.data.name] || "#999")
      .attr("stroke-width", d => categoryColors[d.data.name] ? 2 : 1)
      .attr("stroke-dasharray", d => categoryColors[d.data.name] ? "none" : "2,2");

    // Add directory labels
    dirGroupElements.append("text")
      .attr("dy", d => -d.r + 12)
      .attr("text-anchor", "middle")
      .attr("font-size", d => Math.min(d.r / 5, 12))
      .attr("font-weight", "bold")
      .text(d => d.data.name)
      .attr("pointer-events", "none")
      .attr("fill", "#333");

    // Add all file nodes
    const fileNodes = root.descendants().filter(d => d.data.type === "file");

    const fileGroups = g.selectAll(".file-group")
      .data(fileNodes)
      .join("g")
      .attr("class", "file-group")
      .attr("transform", d => `translate(${d.x},${d.y})`);

    // Add circles for files
    fileGroups.append("circle")
      .attr("r", d => d.r)
      .attr("fill", d => getColor(d.data))
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 0.5)
      .attr("cursor", "pointer")
      .attr("opacity", 0.8)
      .attr("data-path", d => d.data.path) // Add path as data attribute for link targeting
      .on("click", (event, d) => {
        event.stopPropagation();
        if (onNodeSelect) {
          onNodeSelect(d.data);
        }
      });

    // Add text labels to files if they're big enough
    fileGroups.filter(d => d.r > 10)
      .append("text")
      .attr("dy", "0.3em")
      .attr("text-anchor", "middle")
      .attr("font-size", d => Math.min(d.r / 3, 10))
      .attr("fill", "#fff")
      .attr("pointer-events", "none")
      .text(d => d.data.name.length > 15 ? d.data.name.slice(0, 15) + "..." : d.data.name);
    // Create file relationship links if we have link data
    if (data.links && data.links.length > 0) {
      // Debug log to check links
      console.log(`Processing ${data.links.length} file relationships:`, data.links.slice(0, 5));
      
      // Create a temporary debugging output to verify links
      console.log("API usage links:", data.links.filter(link => link.type === "api-usage"));

      // Debug - view some file node paths to better understand what we're working with
      console.log("Sample file nodes:", fileNodes.slice(0, 5).map(node => node.data.path));
      
      // Initialize a lookup map with our file nodes
      const nodePathMap = new Map();
      const pathVariations = new Map();
      
      // Function to normalize paths (strip extensions, make lowercase, etc.)
      const normalizePath = (path) => {
        if (!path) return '';
        
        let result = path;
        // Remove extension if present
        result = result.replace(/\.(tsx|ts|jsx|js|py)$/i, '');
        // Remove leading slash if present
        if (result.startsWith('/')) result = result.substring(1);
        // Handle special API directory cases
        if (result.includes('app/apis/')) {
          // Make sure we properly handle API paths from __init__.py files
          result = result.replace(/__init__$/, '');
        }
        // Convert to lowercase for better matching
        result = result.toLowerCase();
        return result;
      };
      
      // Add all nodes to our lookup maps with normalized paths
      fileNodes.forEach(node => {
        const path = node.data.path;
        const nodeInfo = { x: node.x, y: node.y, r: node.r, node };
        
        // Add the original path
        nodePathMap.set(path, nodeInfo);
        
        // Log API files for debugging
        if (path.includes('/apis/')) {
          console.log("API file found in nodes:", path);
        }
        
        // Add normalized version
        const normalizedPath = normalizePath(path);
        pathVariations.set(normalizedPath, nodeInfo);
        
        // Generate common variations
        if (path.startsWith('/')) {
          nodePathMap.set(path.substring(1), nodeInfo);
        } else {
          nodePathMap.set('/' + path, nodeInfo);
        }
        
        // Handle /ui/src/ and /src/ variations which are common in our imports
        if (path.includes('ui/src/')) {
          // Try removing ui/src prefix
          const noPrefix = path.replace('ui/src/', '');
          nodePathMap.set(noPrefix, nodeInfo);
          pathVariations.set(normalizePath(noPrefix), nodeInfo);
          
          // Also try with leading slash
          nodePathMap.set('/' + noPrefix, nodeInfo);
        }
        
        if (path.includes('src/app/apis/')) {
          // Try various API path transformations
          // 1. Just the directory name 
          const noPrefix = path.replace('src/app/apis/', '');
          nodePathMap.set(noPrefix, nodeInfo);
          pathVariations.set(normalizePath(noPrefix), nodeInfo);
          
          // 2. For API __init__.py files, add a special alias with just the directory name
          if (path.endsWith('__init__.py')) {
            const apiName = path.replace('src/app/apis/', '').replace('/__init__.py', '');
            nodePathMap.set(apiName, nodeInfo);
            nodePathMap.set('src/app/apis/' + apiName, nodeInfo);
            pathVariations.set(normalizePath(apiName), nodeInfo);
            console.log("Added API mapping:", apiName, "→", path);
          }
        }
      });
      
      // Process links with enhanced path matching
      const processedLinks = data.links.map(link => {
        // Function to find the best match for a path
        const findNode = (path) => {
          // Try direct match
          if (nodePathMap.has(path)) {
            return nodePathMap.get(path);
          }
          
          // Try without leading slash
          if (path.startsWith('/') && nodePathMap.has(path.substring(1))) {
            return nodePathMap.get(path.substring(1));
          }
          
          // Try with leading slash
          if (!path.startsWith('/') && nodePathMap.has('/' + path)) {
            return nodePathMap.get('/' + path);
          }
          
          // Try normalized path
          const normalizedPath = normalizePath(path);
          if (pathVariations.has(normalizedPath)) {
            return pathVariations.get(normalizedPath);
          }
          
          // Try partial matching (file name only)
          const fileName = path.split('/').pop();
          if (fileName) {
            for (const [key, value] of nodePathMap.entries()) {
              if (key.endsWith('/' + fileName)) {
                return value;
              }
            }
          }
          
          return null;
        };
        
        const sourceNode = findNode(link.source);
        const targetNode = findNode(link.target);
        
        return {
          ...link,
          sourceNode,
          targetNode,
          isValid: sourceNode !== null && targetNode !== null
        };
      });
      
      // Filter out invalid links
      const validLinks = processedLinks.filter(link => link.isValid);
      
      // Debug
      console.log(`Found ${validLinks.length} valid links out of ${data.links.length} total links`);
      
      // Analyze by type to ensure we're capturing API usage links
      const apiLinks = validLinks.filter(link => link.type === "api-usage");
      console.log(`Found ${apiLinks.length} API usage links`);
      
      if (validLinks.length > 0) {
        console.log("Sample valid link:", validLinks[0]);
      }

      // Set link color based on type
      const linkTypeColor = {
        "external": "#9333ea", // purple
        "module": "#2563eb", // blue
        "direct": "#059669", // green
        "require": "#d97706", // amber
        "internal": "#475569", // slate
        "api-usage": "#f43f5e" // rose/red for API usage
      };
      
      // Special link widths for certain types
      const linkTypeWidth = {
        "api-usage": 3.5, // Thicker for API connections
        "default": 2.5
      };

      // IMPORTANT: We completely avoid creating any persistent connection elements
      // Remove any existing connections container to be 100% sure
      svg.selectAll('.links-layer').remove();
      svg.selectAll('.temp-connections').remove();
      
      // Save valid links in a variable scoped to visualization but don't create DOM elements
      const visualizationState = { validLinks, activeNode: null };
      svg.datum(visualizationState);

      // Helper function to fully clear all connections and reset node appearances
      const clearAllConnections = () => {
        // Aggressively remove ALL connection-related elements
        // Clear from both g and svg to be safe, but primarily from g since that's where we add them
        g.selectAll(".temp-connections").remove();
        g.selectAll(".connection-line").remove();
        g.selectAll(".connection-marker").remove();
        g.selectAll(".links-layer").remove();
        g.selectAll("path[id^='connection-']").remove();
        g.selectAll("circle[id^='marker-']").remove();
        
        // Also clean up from svg in case any old connections were added there
        svg.selectAll(".temp-connections").remove();
        svg.selectAll(".connection-line").remove();
        svg.selectAll(".connection-marker").remove();
        
        // Reset ALL nodes to default style
        fileGroups.select("circle")
          .attr("opacity", 0.8)
          .attr("stroke", "#ffffff")
          .attr("stroke-width", 0.5);
        
        // Reset the visualization state
        const state = svg.datum();
        if (state) {
          state.activeNode = null;
        }
      };
      
      // Ensure we always start with a clean slate
      clearAllConnections();
      
      // Also clean up whenever the visualization component updates
      document.addEventListener('visibilitychange', clearAllConnections);
      window.addEventListener('resize', clearAllConnections);
      
      // Complete rewrite of connection handling system using one-time connections
      fileGroups.on("mouseenter", function(event, d) {
        // Stop event propagation to prevent conflicts
        event.stopPropagation();
        
        // Log the hovered node to debug connection issues
        console.log("Mouse enter on node:", d.data.path);
        
        // CRITICAL: Fully clear all existing connections first
        clearAllConnections();
        
        // Update state to track the active node
        const state = svg.datum();
        if (state) {
          state.activeNode = d;
        }
        
        // Highlight the hovered node
        d3.select(this).select("circle")
          .attr("opacity", 1)
          .attr("stroke", "#333")
          .attr("stroke-width", 2.5);
          
        // Create a completely new, isolated connection layer INSIDE the same transformed group
        // CRITICAL: Append to 'g' (not 'svg') so connections share the same coordinate system as nodes
        const timestamp = Date.now();
        const connectionsLayer = g.append("g")
          .attr("class", `temp-connections temp-connections-${timestamp}`)
          .attr("pointer-events", "none")
          .style("isolation", "isolate") // CSS isolation
          .raise();
        
        // Only proceed if we have valid links
        if (!state || !state.validLinks || state.validLinks.length === 0) {
          console.log("No valid links available");
          return;
        }
        
        // Enhanced debug for finding connections
        console.log("Current node path:", d.data.path);
        
        // Find related links for this specific node only
        const relatedLinks = state.validLinks.filter(link => {
          const isSourceNode = link.sourceNode && link.sourceNode.node === d;
          const isTargetNode = link.targetNode && link.targetNode.node === d;
          const result = isSourceNode || isTargetNode;
          
          if (result) {
            console.log("Found matching link:", {
              type: link.type,
              source: link.source,
              target: link.target,
              isSourceNode,
              isTargetNode
            });
          }
          
          return result;
        });
        
        // Debug output
        console.log(`Node ${d.data.name} has ${relatedLinks.length} connections`);
        
        // Limit connections to prevent visual clutter
        const maxLinksToShow = 5;
        const visibleLinks = relatedLinks.slice(0, maxLinksToShow);
        console.log(`Showing ${visibleLinks.length} out of ${relatedLinks.length} connections for node ${d.data.name}`);
        
        // Draw each connection as a completely isolated entity
        visibleLinks.forEach((link, index) => {
          const source = link.sourceNode;
          const target = link.targetNode;
          const linkType = link.type || "default";
          
          if (!source || !target) return;
          
          // Calculate connection points and visual properties
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const linkColor = linkTypeColor[linkType] || "#666";
          
          // Generate truly unique IDs for this specific connection
          const connectionId = `connection-${timestamp}-${index}`;
          const markerId = `marker-${timestamp}-${index}`;
          
          // Determine precise connection points on circle boundaries
          const sourceAngle = Math.atan2(dy, dx);
          const targetAngle = Math.atan2(-dy, -dx);
          
          const sourceX = source.x + source.r * Math.cos(sourceAngle);
          const sourceY = source.y + source.r * Math.sin(sourceAngle);
          const targetX = target.x + target.r * Math.cos(targetAngle);
          const targetY = target.y + target.r * Math.sin(targetAngle);
          
          // Draw the connection line
          connectionsLayer.append("path")
            .attr("d", `M${sourceX},${sourceY}L${targetX},${targetY}`)
            .attr("id", connectionId)
            .attr("class", "connection-line")
            .attr("stroke", linkColor)
            .attr("stroke-opacity", 0.85)
            .attr("stroke-width", linkTypeWidth[linkType] || linkTypeWidth.default)
            .attr("fill", "none")
            .attr("pointer-events", "none");
          
          // Only add direction indicator if this isn't the source node
          if (link.targetNode.node !== d) {
            // Calculate position for direction indicator
            const arrowLen = 10;
            const totalDist = Math.sqrt(dx * dx + dy * dy);
            const ratio = (totalDist - target.r - arrowLen) / totalDist;
            
            const arrowX = source.x + dx * ratio;
            const arrowY = source.y + dy * ratio;
            
            // Add a simple circle as direction indicator
            connectionsLayer.append("circle")
              .attr("cx", arrowX)
              .attr("cy", arrowY)
              .attr("r", 4)
              .attr("id", markerId)
              .attr("class", "connection-marker")
              .attr("fill", linkColor)
              .attr("pointer-events", "none");
          }
            
          // Highlight the connected node
          const connectedNodeIndex = fileNodes.indexOf(
            link.sourceNode.node === d ? link.targetNode.node : link.sourceNode.node
          );
          
          if (connectedNodeIndex >= 0) {
            d3.select(fileGroups.nodes()[connectedNodeIndex])
              .select("circle")
              .attr("opacity", 1)
              .attr("stroke", linkColor)
              .attr("stroke-width", 2);
          }
        });
        
        // Dim other nodes slightly
        fileGroups.filter(n => n !== d && !visibleLinks.some(link => 
          link.sourceNode.node === n || link.targetNode.node === n
        ))
        .select("circle")
        .attr("opacity", 0.3);
      })
      .on("mouseleave", function(event) {
        // Completely stop event propagation
        event.stopPropagation();
        
        // Set a flag to track if we should clear connections
        let shouldClear = true;
        
        // Get the currently hovered element, if any
        const hoveredElement = document.querySelectorAll(".file-group:hover")[0];
        
        // If we're hovering over another node, don't clear yet
        if (hoveredElement) {
          shouldClear = false;
        }
        
        // Use a small delay to handle transition between nodes
        if (shouldClear) {
          // Create a new unique layer before removing to prevent visual flicker
          setTimeout(() => {
            // Double-check we're not over another node before clearing
            if (document.querySelectorAll(".file-group:hover").length === 0) {
              clearAllConnections();
            }
          }, 50);
        }
      });
      
      // Add even more cleanup handlers to guarantee no stray connections
      svg.on("click", function(event) {
        // Only trigger for clicks directly on the svg background
        if (event.target === this) {
          clearAllConnections();
        }
      })
      .on("mouseleave", function() {
        // Ensure everything is cleared when mouse leaves the entire visualization
        clearAllConnections();
      })
      .on("mousedown", function(event) {
        // When starting to drag/zoom, clear all connections
        if (event.target === this) {
          clearAllConnections();
        }
      })
      .on("mouseup", function() {
        // Clear connections after completing any drag or interaction
        clearAllConnections();
      })
      .on("mousemove", function(event) {
        // Only clear connections if we're not over a node
        if (event.target === this && document.querySelectorAll(".file-group:hover").length === 0) {
          clearAllConnections();
        }
      });
      
      // Additional global cleanup to catch any stray connections
      // Run a periodic cleanup to catch any missed connections
      const cleanupInterval = setInterval(() => {
        const state = svg.datum();
        if (!state || !state.activeNode) {
          // Only clear if we're not actively hovering a node
          if (document.querySelectorAll(".file-group:hover").length === 0) {
            clearAllConnections();
          }
        }
      }, 1000);
      
      // Clean up interval when component unmounts
      return () => {
        clearInterval(cleanupInterval);
        clearAllConnections();
        document.removeEventListener('visibilitychange', clearAllConnections);
        window.removeEventListener('resize', clearAllConnections);
      };

    }

    // Add legend for categories, file types and relationship types
    const legendGroups = [
      {
        title: "App Structure",
        items: Object.entries(categoryColors).filter(([key]) => key !== "Taskflow App")
      },
      {
        title: "File Types",
        items: Object.entries(fileColors).slice(0, 5) // Just top 5 file types
      }
    ];

    // Add import types to legend if we have links
    if (data.links && data.links.length > 0) {
      const importTypeColors = {
        "external": "#9333ea", // purple
        "module": "#2563eb", // blue
        "direct": "#059669", // green
        "require": "#d97706", // amber
        "internal": "#475569", // slate
        "api-usage": "#f43f5e" // rose/red for API usage
      };
      
      // Special note for API usage
      const importItems = Object.entries(importTypeColors);
      // Move API usage to the top of the list
      const apiIndex = importItems.findIndex(([key]) => key === "api-usage");
      if (apiIndex >= 0) {
        const apiItem = importItems.splice(apiIndex, 1)[0];
        importItems.unshift(apiItem);
      }

      // Add API usage explanation
      const apiLinks = data.links.filter(link => link.type === "api-usage");
      if (apiLinks.length > 0) {
        // Add API usage with custom text
        legendGroups.push({
          title: "Frontend-Backend Connections",
          items: [['API Usage (Frontend → Backend)', '#f43f5e']]
        });
      }
      
      legendGroups.push({
        title: "Import Types",
        items: importItems
      });
    }

    // Create legend for each group - initialize yOffset first
    let yOffset = 20; // Add padding at top
    
    // Calculate total height for all legend groups
    const totalLegendHeight = yOffset + legendGroups.reduce((sum, group) => {
      return sum + 20 + (group.items.length * 18) + 20; // title + items + padding
    }, 0);
    
    // IMPORTANT: Remove any existing legend to prevent duplicates
    svg.selectAll(".codebase-legend").remove();
    
    // Debug log to verify legend creation
    console.log("Creating legend with", legendGroups.length, "groups and height", totalLegendHeight);
    
    // Create legend container - make it fixed and extremely visible
    // Attach directly to the SVG (not the transformed group) to keep it fixed during zoom
    const legend = svg.append("g")
      .attr("class", "codebase-legend")
      .attr("transform", `translate(20, 20)`)
      .style("pointer-events", "none") // Prevent legend from blocking interactions
      .style("z-index", "9999")
      .style("visibility", "visible")
      .style("opacity", "1");
      
    // Add visible debugging border around the entire legend area
    legend.append("rect")
      .attr("width", 250)
      .attr("height", totalLegendHeight + 30) // Add more padding
      .attr("rx", 8)
      .attr("ry", 8)
      .attr("transform", "translate(-15, -15)") // Larger offset for better visibility
      .attr("fill", "#ff0000") // Very visible red (temporary for debugging)
      .attr("fill-opacity", 0.1)
      .attr("stroke", "#ff0000")
      .attr("stroke-width", 3)
      .attr("stroke-dasharray", "5,5");
      
    // Add outer box with shadow effect for better visibility
    legend.append("rect")
      .attr("width", 230)
      .attr("height", totalLegendHeight + 10) // Add some padding
      .attr("rx", 6)
      .attr("ry", 6)
      .attr("transform", "translate(-5, -5)") // Slightly offset for shadow effect
      .attr("fill", "#000000")
      .attr("fill-opacity", 0.5) // Higher opacity
      .attr("filter", "blur(3px)"); // Soft shadow
      
    // Add semi-transparent background to make legend text more readable
    legend.append("rect")
      .attr("width", 220)
      .attr("height", totalLegendHeight) // Use calculated height
      .attr("rx", 6)
      .attr("ry", 6)
      .attr("fill", "#ffffff")
      .attr("fill-opacity", 1) // Fully opaque
      .attr("stroke", "#000000")
      .attr("stroke-width", 2.5);
      
    // Make sure legend stays on top
    legend.raise();

    // Add a title for the legend
    legend.append("text")
      .attr("x", 110)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("font-size", 14)
      .attr("font-weight", "bold")
      .attr("fill", "#000000")
      .text("Codebase Map Legend");
      
    legendGroups.forEach(group => {
      // Add a background for the group header
      legend.append("rect")
        .attr("x", 5)
        .attr("y", yOffset - 15) // Position above the text
        .attr("width", 210)
        .attr("height", 20)
        .attr("rx", 4)
        .attr("fill", "#f0f0f0")
        .attr("stroke", "#cccccc")
        .attr("stroke-width", 1);
      
      // Group title - make more prominent
      legend.append("text")
        .attr("x", 10)
        .attr("y", yOffset)
        .attr("font-weight", "bold")
        .attr("font-size", 12)
        .attr("fill", "#000000") // Darker text
        .text(group.title);

      yOffset += 20;

      // Group items
      const groupLegend = legend.append("g")
        .attr("transform", `translate(10, ${yOffset})`);

      const legendItem = groupLegend.selectAll(".legend-item")
        .data(group.items)
        .join("g")
        .attr("class", "legend-item")
        .attr("transform", (d, i) => `translate(0, ${i * 18})`);

      legendItem.append("rect")
        .attr("width", 14)
        .attr("height", 14)
        .attr("rx", 3)
        .attr("fill", d => d[1])
        .attr("stroke", "#000000") // Darker border
        .attr("stroke-width", 0.5);

      legendItem.append("text")
        .attr("x", 24)
        .attr("y", 10)
        .attr("font-size", 11)
        .attr("font-weight", "medium")
        .attr("fill", "#000000") // Darker text
        .text(d => d[0]);

      yOffset += (group.items.length * 18) + 20; // Add more spacing between groups
    });
  };

  // Load D3 from CDN if not already loaded
  useEffect(() => {
    if (!window.d3 && !isInitialized) {
      setIsInitialized(true);
      const script = document.createElement("script");
      script.src = "https://d3js.org/d3.v7.min.js";
      script.onload = () => {
        if (data) visualizeCodebase();
      };
      document.head.appendChild(script);
    } else if (window.d3 && data) {
      visualizeCodebase();
    }
    
    // Cleanup function to ensure we don't leave any artifacts
    return () => {
      if (window.d3 && svgRef.current) {
        window.d3.select(svgRef.current).selectAll(".temp-connections").remove();
      }
    };
  }, [data, isInitialized]);

  // We removed statistics display from here - they're now shown only on the page level
  
  // Manual legend data for the React-based legend
  const legendData = [
    {
      title: "App Structure",
      items: [
        { name: "Pages", color: "#4CAF50" },
        { name: "UI Components", color: "#2196F3" },
        { name: "UI Files", color: "#9C27B0" },
        { name: "APIs", color: "#FF5722" },
        { name: "Media (Public)", color: "#FFEB3B" },
      ]
    },
    {
      title: "File Types",
      items: [
        { name: "JavaScript", color: "#f1e05a" },
        { name: "TypeScript", color: "#3178c6" },
        { name: "Python", color: "#3572A5" },
        { name: "HTML", color: "#e34c26" },
        { name: "CSS", color: "#563d7c" },
      ]
    },
    {
      title: "Import Types",
      items: [
        { name: "API Usage", color: "#f43f5e" },
        { name: "Module", color: "#2563eb" },
        { name: "Direct", color: "#059669" },
        { name: "Require", color: "#d97706" },
        { name: "External", color: "#9333ea" },
      ]
    }
  ];
  
  return (
    <div className="flex flex-col h-full" ref={containerRef}>
      <div className="relative flex-grow h-full" style={{ minHeight: "70vh" }}>
        {/* Clean React-based legend without debugging elements */}
        <div 
          className="absolute top-2 left-2 z-50 bg-white shadow-lg rounded-lg p-3 font-sans"
          style={{ width: "220px" }}
        >
          <div className="text-center font-bold mb-2 bg-gray-100 py-1 rounded text-sm">Codebase Map Legend</div>
          
          {legendData.map((group, groupIndex) => (
            <div key={groupIndex} className="mb-3">
              <div className="font-semibold bg-gray-50 px-2 py-0.5 border-b mb-1 text-xs">{group.title}</div>
              <div className="grid gap-y-1">
                {group.items.map((item, itemIndex) => (
                  <div key={itemIndex} className="flex items-center">
                    <div 
                      className="w-3 h-3 mr-2 rounded" 
                      style={{ backgroundColor: item.color, border: "1px solid rgba(0,0,0,0.2)" }}
                    ></div>
                    <span className="text-xs">{item.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        
        {!data ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">No codebase data available</p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="w-full h-full border rounded-md"
            style={{ minHeight: "600px" }}
          ></svg>
        )}
      </div>
      
      {/* Statistics section removed - now handled at page level */}
    </div>
  );
}

// Add d3 to window type
declare global {
  interface Window {
    d3: any;
  }
}
