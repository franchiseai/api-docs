#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { WebSocketServer } = require("ws");

const CONFIG = {
  port: 3004,
  wsPort: 3005,
  yamlFile: "api.yaml",
  outputFile: "index.html",
  buildCommand: "npx",
  buildArgs: [
    "@redocly/cli",
    "build-docs",
    "api.yaml",
    "--output",
    "index.html",
  ],
};

console.log("🚀 Starting OpenAPI dev server...");

// Create WebSocket server for live reload
const wss = new WebSocketServer({ port: CONFIG.wsPort });
const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("📡 Browser connected for live reload");

  ws.on("close", () => {
    clients.delete(ws);
  });
});

// Function to notify all connected browsers to reload
function notifyReload() {
  clients.forEach((client) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      client.send("reload");
    }
  });
}

// Function to build the documentation
function buildDocs() {
  console.log("🔨 Building documentation...");

  const build = spawn(CONFIG.buildCommand, CONFIG.buildArgs, {
    stdio: "pipe",
  });

  let output = "";
  let errorOutput = "";

  build.stdout.on("data", (data) => {
    output += data.toString();
  });

  build.stderr.on("data", (data) => {
    errorOutput += data.toString();
  });

  build.on("close", (code) => {
    if (code === 0) {
      console.log("✅ Documentation built successfully");

      // Inject live reload script into the HTML
      injectLiveReload();

      // Notify browsers to reload
      setTimeout(() => {
        notifyReload();
        console.log("🔄 Page reloaded in browser");
      }, 100);
    } else {
      console.error("❌ Build failed:");
      console.error(errorOutput);
    }
  });
}

// Function to inject live reload script into HTML
function injectLiveReload() {
  try {
    let html = fs.readFileSync(CONFIG.outputFile, "utf8");

    // Remove existing live reload script if present
    html = html.replace(
      /<script id="live-reload-script">[\s\S]*?<\/script>/g,
      ""
    );

    const liveReloadScript = `
    <script id="live-reload-script">
      (function() {
        const ws = new WebSocket('ws://localhost:${CONFIG.wsPort}');
        ws.onmessage = function(event) {
          if (event.data === 'reload') {
            console.log('🔄 Reloading page due to file changes...');
            window.location.reload();
          }
        };
        ws.onopen = function() {
          console.log('📡 Connected to live reload server');
        };
        ws.onerror = function() {
          console.log('❌ Live reload connection failed');
        };
      })();
    </script>`;

    // Inject before closing </body> tag, or at the end if no </body>
    if (html.includes("</body>")) {
      html = html.replace("</body>", liveReloadScript + "\n</body>");
    } else {
      html += liveReloadScript;
    }

    fs.writeFileSync(CONFIG.outputFile, html);
  } catch (error) {
    console.warn("⚠️  Could not inject live reload script:", error.message);
  }
}

// File watcher
function setupWatcher() {
  console.log(`👀 Watching ${CONFIG.yamlFile} for changes...`);

  let timeout;

  fs.watchFile(CONFIG.yamlFile, { interval: 100 }, (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
      console.log(`📝 ${CONFIG.yamlFile} changed`);

      // Debounce rapid changes
      clearTimeout(timeout);
      timeout = setTimeout(buildDocs, 200);
    }
  });
}

// HTTP server to serve the documentation
function createServer() {
  const server = http.createServer((req, res) => {
    let filePath = req.url === "/" ? CONFIG.outputFile : req.url.slice(1);

    // Security: prevent directory traversal
    filePath = path.resolve(filePath);
    const serverRoot = process.cwd();
    if (!filePath.startsWith(serverRoot)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    // Determine content type
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    };

    const contentType = contentTypes[ext] || "text/plain";

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch (error) {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });

  server.listen(CONFIG.port, () => {
    console.log(`🌐 Server running at http://localhost:${CONFIG.port}`);
    console.log(`📚 Documentation will be available once built`);
    console.log("");
    console.log("💡 Tips:");
    console.log("  - Edit your api.yaml file to see live updates");
    console.log("  - Press Ctrl+C to stop the server");
    console.log("");
  });

  return server;
}

// Graceful shutdown
function setupGracefulShutdown(server) {
  process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down dev server...");

    fs.unwatchFile(CONFIG.yamlFile);
    wss.close();
    server.close(() => {
      console.log("👋 Dev server stopped");
      process.exit(0);
    });
  });
}

// Check if YAML file exists
if (!fs.existsSync(CONFIG.yamlFile)) {
  console.error(`❌ Error: ${CONFIG.yamlFile} not found`);
  console.log(
    "Make sure your OpenAPI spec file exists in the current directory"
  );
  process.exit(1);
}

// Initialize everything
const server = createServer();
setupGracefulShutdown(server);
setupWatcher();

// Initial build
buildDocs();
