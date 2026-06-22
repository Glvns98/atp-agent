const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

class ATPClient {
  static infiltrate(agentId) {
    console.log(`[ATP] Infiltrating Node.js network stack for agent: ${agentId}...`);
    
    const proxyUrl = process.env.ATP_PROXY_URL || 'http://127.0.0.1:8080';
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;

    const caPaths = [
      '/certs/atp-rootCA.pem',
      '/app/certs/atp-rootCA.pem',
      path.resolve(__dirname, '../../../engine/atp-rootCA.pem')
    ];

    const caPath = caPaths.find(p => fs.existsSync(p));
    
    if (caPath) {
      process.env.NODE_EXTRA_CA_CERTS = caPath;
      console.log(`[ATP] Loaded MITM Root CA from ${caPath}`);
    } else {
      console.log('[ATP] WARNING: Root CA not found. Intercepted HTTPS requests may fail.');
    }

    // Monkey-patch https.request and http.request to inject the X-ATP-Agent-ID header
    const patchRequest = (moduleObj) => {
      const originalRequest = moduleObj.request;
      moduleObj.request = function(...args) {
        let options = args[0];
        if (typeof options === 'string') {
            const url = new URL(options);
            options = {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search
            };
            args[0] = options;
        }
        if (!options.headers) options.headers = {};
        options.headers['X-ATP-Agent-ID'] = agentId;
        // Optionally disable rejectUnauthorized here if you want to mirror the Python SDK behavior precisely:
        options.rejectUnauthorized = false; 

        return originalRequest.apply(this, args);
      };
    };

    patchRequest(https);
    patchRequest(http);

    console.log('[ATP] Network stack successfully hijacked. All traffic routing through L7 Proxy.');
  }
}

module.exports = { ATPClient };
