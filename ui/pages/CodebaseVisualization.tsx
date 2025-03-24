import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import brain from "brain";
import { CodebaseVisualizer } from "components/CodebaseVisualizer";

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

export default function CodebaseVisualization() {
  const navigate = useNavigate();
  const [codebaseData, setCodebaseData] = useState<CodebaseResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useLocalData, setUseLocalData] = useState(false);

  // Function to fetch codebase data
  const fetchCodebaseData = async () => {
    setIsLoading(true);
    setError(null);
    setUseLocalData(false);

    try {
      const response = await brain.scan_codebase();
      if (!response.ok) {
        throw new Error(`Error fetching codebase data: ${response.statusText}`);
      }
      const data = await response.json();
      setCodebaseData(data);
      toast.success("Codebase successfully scanned");
    } catch (err) {
      console.error("Failed to fetch codebase data:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch codebase data");
      toast.error("Failed to fetch codebase data");
      
      // Try to use history instead
      await fetchCodebaseHistory();
    } finally {
      setIsLoading(false);
    }
  };
  
  // Function to fetch codebase history as fallback
  const fetchCodebaseHistory = async () => {
    setIsLoading(true);
    try {
      const response = await brain.get_codebase_history();
      if (!response.ok) {
        throw new Error(`Error fetching codebase history: ${response.statusText}`);
      }
      const data = await response.json();
      
      if (data.structure && data.stats) {
        console.log("Using codebase history as fallback");
        setCodebaseData(data);
        setUseLocalData(true);
        toast.info("Using cached codebase data");
      } else {
        toast.error("No codebase data available. Please scan first.");
      }
    } catch (err) {
      console.error("Failed to fetch codebase history:", err);
      // If both methods fail, show clear error
      setError("Could not retrieve codebase data. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };

  // Function to format bytes into a readable format
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  // Format timestamp to readable date
  const formatDate = (timestamp?: number) => {
    if (!timestamp) return "Unknown";
    return new Date(timestamp * 1000).toLocaleString();
  };

  // Visualize the codebase data using D3
  const visualizeCodebase = (data: CodebaseResponse) => {
    if (!svgRef.current || !data?.structure) return;

    // Clear previous visualization
    while (svgRef.current.firstChild) {
      svgRef.current.removeChild(svgRef.current.firstChild);
    }

    // We'll load D3 from CDN and implement the visualization
    const script = document.createElement("script");
    script.src = "https://d3js.org/d3.v7.min.js";
    script.onload = () => {
      // Now D3 is loaded, we can create the visualization
      createVisualization(data.structure);
    };
    document.head.appendChild(script);
  };

  // Create D3 visualization
  const createVisualization = (data: FileNode) => {
    // This function will be defined once D3 is loaded
    if (!window.d3 || !svgRef.current) return;
    
    const d3 = window.d3;
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight || 700;
    
    // Clear any existing SVG content
    d3.select(svgRef.current).selectAll("*").remove();
    
    // Create hierarchy
    const hierarchy = d3.hierarchy(data)
      .sum(d => (d.type === "file" ? d.size : 0))
      .sort((a, b) => b.value! - a.value!);
    
    // Create pack layout
    const pack = d3.pack<FileNode>()
      .size([width, height])
      .padding(3);
    
    // Apply pack layout
    const root = pack(hierarchy);
    
    // Color scale based on file type/language
    const fileTypeColor = d3.scaleOrdinal(d3.schemeCategory10);
    
    // Create SVG container
    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "max-width: 100%; height: auto; font: 10px sans-serif;");
    
    // Create a group for all nodes
    const g = svg.append("g");
    
    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    
    svg.call(zoom as any);
    
    // Add nodes
    const node = g.selectAll(".node")
      .data(root.descendants())
      .join("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${d.x},${d.y})`);
    
    // Add circles for nodes
    node.append("circle")
      .attr("r", d => d.r)
      .attr("fill", d => {
        if (!d.data) return "#ccc";
        if (d.data.type === "directory") return "rgba(200, 200, 200, 0.5)";
        return fileTypeColor(d.data.language || "unknown");
      })
      .attr("fill-opacity", d => d.data.type === "directory" ? 0.3 : 0.7)
      .attr("stroke", d => d.data.type === "directory" ? "#999" : fileTypeColor(d.data.language || "unknown"))
      .attr("stroke-width", 1)
      .on("click", (event, d) => {
        // On click, show node details
        event.stopPropagation();
        setSelectedNode(d.data);
      });
    
    // Add labels to nodes
    node.filter(d => d.r > 10)
      .append("text")
      .attr("dy", "0.3em")
      .attr("text-anchor", "middle")
      .attr("font-size", d => Math.min(d.r / 3, 12))
      .text(d => d.data.name)
      .attr("pointer-events", "none")
      .attr("fill", "#333");
    
    // Force simulation for better layout
    const simulation = d3.forceSimulation(root.descendants() as any)
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("charge", d3.forceManyBody().strength(-30))
      .force("collide", d3.forceCollide().radius(d => (d as any).r + 2).iterations(2))
      .on("tick", () => {
        node.attr("transform", d => `translate(${d.x},${d.y})`);
      });
    
    // Stop simulation after some iterations
    setTimeout(() => simulation.stop(), 2000);
  };

  // Initial fetch on component mount
  useEffect(() => {
    fetchCodebaseData();
  }, []);

  return (
    <div className="w-full px-4 py-6 flex flex-col gap-4" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Codebase Visualization</h1>
          <p className="text-muted-foreground">Interactive visualization of your app's key structural components</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>
            Back
          </Button>
          <Button onClick={fetchCodebaseData} disabled={isLoading}>
            {isLoading ? "Loading..." : "Refresh"}
          </Button>
        </div>
      </div>

      <Separator />

      {error && (
        <div className="p-4 bg-red-50 text-red-500 rounded-md border border-red-200">
          {error}
        </div>
      )}

      {/* Stats Section at the top */}
<div className="w-full bg-secondary/10 p-4 rounded-lg mb-6">
  <div className="flex justify-between items-center mb-2">
    <h2 className="text-lg font-medium">Codebase Statistics</h2>
    {useLocalData && <span className="text-xs text-muted-foreground">Using cached data. Click Refresh for latest data.</span>}
  </div>
  
  {codebaseData ? (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
      <div className="p-3 bg-secondary/40 rounded-lg">
        <h3 className="text-xs font-medium text-muted-foreground">Files</h3>
        <p className="text-xl font-bold">{codebaseData.stats.total_files}</p>
      </div>
      <div className="p-3 bg-secondary/40 rounded-lg">
        <h3 className="text-xs font-medium text-muted-foreground">Directories</h3>
        <p className="text-xl font-bold">{codebaseData.stats.total_directories}</p>
      </div>
      <div className="p-3 bg-secondary/40 rounded-lg">
        <h3 className="text-xs font-medium text-muted-foreground">Total Size</h3>
        <p className="text-xl font-bold">{formatBytes(codebaseData.stats.total_size_bytes)}</p>
      </div>
      <div className="p-3 bg-secondary/40 rounded-lg">
        <h3 className="text-xs font-medium text-muted-foreground">File Types</h3>
        <p className="text-xl font-bold">{Object.keys(codebaseData.stats.file_types).length}</p>
      </div>
      
      {/* Show top file types inline */}
      {Object.entries(codebaseData.stats.file_types)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([ext, count]) => (
          <div key={ext} className="p-3 bg-secondary/40 rounded-lg">
            <h3 className="text-xs font-medium text-muted-foreground">{ext || "no ext"}</h3>
            <p className="text-xl font-bold">{count}</p>
          </div>
        ))}
    </div>
  ) : (
    <div className="text-center py-2 text-muted-foreground">
      {isLoading ? "Loading data..." : "No data available"}
    </div>
  )}
</div>

{/* Visualization with scrollable height */}
<div className="w-full bg-card rounded-lg border shadow-sm overflow-hidden" style={{ minHeight: '700px' }}>
  <div className="p-4 border-b flex justify-between items-center">
    <div>
      <h2 className="text-lg font-bold tracking-tight">File Structure Visualization</h2>
      <p className="text-sm text-muted-foreground">Circle size represents relative importance</p>
    </div>
  </div>
  <div className="w-full" style={{ height: '800px' }}>
    <CodebaseVisualizer 
      data={codebaseData} 
      onNodeSelect={setSelectedNode} 
      height="100%"
    />
  </div>
</div>

      {/* Portal-based modal with guaranteed opacity */}
      {selectedNode && ReactDOM.createPortal(
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setSelectedNode(null)}
        >
          <div 
            style={{
              backgroundColor: 'white',
              color: 'black',
              borderRadius: '8px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              width: '100%',
              maxWidth: '800px',
              maxHeight: '90vh',
              overflow: 'auto',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#f8fafc'
            }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: '0' }}>{selectedNode.name}</h2>
                <p style={{ fontSize: '0.875rem', marginTop: '4px', color: '#64748b' }}>
                  {selectedNode.type === "directory" ? "Directory" : selectedNode.language || "File"}
                </p>
              </div>
              <button 
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.5rem',
                  color: '#64748b'
                }}
                onClick={() => setSelectedNode(null)}
              >
                ✕
              </button>
            </div>
            
            {/* Content */}
            <div style={{ padding: '24px' }}>
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>Path</h3>
                <div style={{
                  fontFamily: 'monospace',
                  padding: '12px',
                  backgroundColor: '#f1f5f9',
                  borderRadius: '4px',
                  overflowX: 'auto',
                  fontSize: '0.875rem'
                }}>
                  {selectedNode.path}
                </div>
              </div>
              
              {selectedNode.type === "file" && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                      <h3 style={{ margin: '0', fontSize: '1rem' }}>Size</h3>
                    </div>
                    <div style={{ padding: '16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 'bold' }}>
                      {formatBytes(selectedNode.size)}
                    </div>
                  </div>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                      <h3 style={{ margin: '0', fontSize: '1rem' }}>Last Modified</h3>
                    </div>
                    <div style={{ padding: '16px', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {formatDate(selectedNode.last_modified)}
                    </div>
                  </div>
                </div>
              )}
              
              {selectedNode.type === "file" && selectedNode.imports && selectedNode.imports.length > 0 && (
                <div style={{ marginBottom: '24px', border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                    <h3 style={{ margin: '0', fontSize: '1rem' }}>Imports ({selectedNode.imports.length})</h3>
                  </div>
                  <div style={{ padding: '16px' }}>
                    <div style={{ maxHeight: '200px', overflowY: 'auto', backgroundColor: '#f1f5f9', padding: '12px', borderRadius: '4px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {selectedNode.imports.map((imp, idx) => {
                          // Determine import type badge color
                          const typeColors = {
                            'external': '#9333ea', // purple
                            'module': '#2563eb', // blue
                            'direct': '#059669', // green
                            'require': '#d97706', // amber
                            'internal': '#475569'  // slate
                          };
                          const color = typeColors[imp.type] || '#64748b';
                          
                          return (
                            <div key={idx} style={{
                              fontFamily: 'monospace',
                              fontSize: '0.875rem',
                              padding: '8px 12px',
                              backgroundColor: 'white',
                              border: '1px solid #e2e8f0',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between'
                            }}>
                              <div style={{ wordBreak: 'break-all' }}>{imp.path}</div>
                              <div style={{
                                backgroundColor: color,
                                color: 'white',
                                fontSize: '0.75rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                marginLeft: '8px',
                                fontWeight: 'bold',
                                textTransform: 'uppercase'
                              }}>
                                {imp.type}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {selectedNode.type === "directory" && selectedNode.children && (
                <div style={{ marginBottom: '24px', border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                    <h3 style={{ margin: '0', fontSize: '1rem' }}>Directory Contents</h3>
                  </div>
                  <div style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '32px', padding: '12px' }}>
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: '1.875rem', fontWeight: 'bold', display: 'block' }}>
                          {selectedNode.children.filter(c => c.type === "file").length}
                        </span>
                        <span style={{ fontSize: '0.875rem', color: '#64748b' }}>Files</span>
                      </div>
                      <div style={{ width: '1px', height: '40px', backgroundColor: '#e2e8f0' }}></div>
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: '1.875rem', fontWeight: 'bold', display: 'block' }}>
                          {selectedNode.children.filter(c => c.type === "directory").length}
                        </span>
                        <span style={{ fontSize: '0.875rem', color: '#64748b' }}>Directories</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div style={{ padding: '16px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                style={{
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
                onClick={() => setSelectedNode(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}


    </div>
  );
}

// Add d3 to window type
declare global {
  interface Window {
    d3: any;
  }
}