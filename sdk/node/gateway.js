const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function infiltrate(agentId) {
    console.log(`[ATP] Infiltrating Node.js network stack for agent: ${agentId}...`);

    const proxyUrl = process.env.ATP_PROXY_URL || "http://127.0.0.1:8080";
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;

    const caPaths = [
        "/certs/atp-rootCA.pem",
        "/app/certs/atp-rootCA.pem",
        path.resolve(__dirname, '../../../engine/atp-rootCA.pem')
    ];

    let caCert;
    for (const p of caPaths) {
        if (fs.existsSync(p)) {
            caCert = fs.readFileSync(p);
            console.log(`[ATP] Loaded MITM Root CA from ${p}`);
            process.env.NODE_EXTRA_CA_CERTS = p;
            break;
        }
    }

    if (!caCert) {
        console.log("[ATP] WARNING: Root CA not found. Intercepted HTTPS requests may fail.");
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; 
    }

    // Monkey-patch request to globally inject the X-ATP-Agent-ID header
    const originalHttpsRequest = https.request;
    https.request = function(options, cb) {
        if (typeof options === 'string') {
            options = new URL(options);
        }
        options.headers = options.headers || {};
        options.headers['X-ATP-Agent-ID'] = agentId;
        return originalHttpsRequest.call(this, options, cb);
    };

    const originalHttpRequest = http.request;
    http.request = function(options, cb) {
        if (typeof options === 'string') {
            options = new URL(options);
        }
        options.headers = options.headers || {};
        options.headers['X-ATP-Agent-ID'] = agentId;
        return originalHttpRequest.call(this, options, cb);
    };

    console.log("[ATP] Node.js Network stack successfully hijacked. All traffic routing through L7 Proxy.");
}

module.exports = { infiltrate };
