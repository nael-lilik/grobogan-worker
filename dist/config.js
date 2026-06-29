"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = exports.Config = void 0;
exports.ensureWordlists = ensureWordlists;
const dotenv = __importStar(require("dotenv"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
const child_process_1 = require("child_process");
dotenv.config();
function loadPersistentWorkerId() {
    const idFile = path.join(__dirname, '..', '.worker-id');
    try {
        if (fs.existsSync(idFile)) {
            const id = fs.readFileSync(idFile, 'utf-8').trim();
            if (id)
                return id;
        }
    }
    catch { /* ignore read errors */ }
    const id = `worker-${(0, uuid_1.v4)().substring(0, 8)}`;
    try {
        fs.writeFileSync(idFile, id, 'utf-8');
    }
    catch { /* ignore write errors — non-critical */ }
    return id;
}
/**
 * Auto-download wordlist files from GitHub SecLists if missing locally.
 * Returns true if at least one wordlist path now exists after attempted download.
 */
const WORDLIST_URLS = [
    {
        url: 'https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/common.txt',
        dest: '/usr/share/wordlists/dirb/common.txt',
    },
    {
        url: 'https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/common.txt',
        dest: '/usr/share/seclists/Discovery/Web-Content/common.txt',
    },
];
function ensureWordlists() {
    for (const { url, dest } of WORDLIST_URLS) {
        if (fs.existsSync(dest))
            continue; // already have it
        const dir = path.dirname(dest);
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            console.log(`📥 Downloading wordlist: ${path.basename(dest)} → ${dest}`);
            (0, child_process_1.execSync)(`curl -fsSL --connect-timeout 10 --max-time 30 -o "${dest}" "${url}"`, {
                stdio: 'pipe',
                timeout: 35000,
            });
            console.log(`✅ Wordlist saved: ${dest}`);
        }
        catch (e) {
            console.warn(`⚠ Failed to download wordlist to ${dest}: ${e.message}`);
        }
    }
    // Return true if at least one of the expected paths now exists
    return WORDLIST_URLS.some(({ dest }) => fs.existsSync(dest));
}
class Config {
    constructor() {
        this.managerUrl = process.env.MANAGER_URL || 'http://localhost:8080';
        this.workerId = (process.env.WORKER_ID && process.env.WORKER_ID !== "auto") ? process.env.WORKER_ID : loadPersistentWorkerId();
        this.hostname = process.env.HOSTNAME || os.hostname();
        this.ip = process.env.IP || this.getIPAddress();
        this.capabilities = this.parseCapabilities(process.env.CAPABILITIES);
        this.heartBeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10);
        this.taskRequestInterval = parseInt(process.env.TASK_REQUEST_INTERVAL || '5000', 10);
        this.maxConcurrentTasks = parseInt(process.env.MAX_CONCURRENT_TASKS || '1', 10);
    }
    getIPAddress() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1';
    }
    parseCapabilities(capabilitiesStr) {
        if (!capabilitiesStr) {
            return ['nmap', 'nikto', 'gobuster', 'sqlmap', 'curl', 'jq', 'whatweb', 'sslscan', 'dig'];
        }
        return capabilitiesStr.split(',').map(s => s.trim().toLowerCase());
    }
    /** Detect which capabilities are actually installed on the system */
    async detectActualCapabilities() {
        const { execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
        const configured = this.capabilities;
        const installed = [];
        for (const cap of configured) {
            try {
                execSync(`which ${cap} 2>/dev/null || command -v ${cap} 2>/dev/null`, { stdio: 'pipe' });
                installed.push(cap);
            }
            catch {
                // Tool not installed
            }
        }
        return installed;
    }
    /** Per-tool health: installed on PATH AND actually executable */
    async checkCapabilityHealth() {
        const { execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
        const results = [];
        // Mapping of tool name to the flag that prints version (non-interactive)
        // Empty string means run without arguments to get version
        const versionFlags = {
            nmap: '--version',
            nikto: '-Version',
            gobuster: '--version',
            sqlmap: '--version',
            curl: '--version',
            jq: '--version',
            whatweb: '',
            sslscan: '--version',
            dig: '-v',
            masscan: '--version',
            hydra: '-h',
            enum4linux: '-h',
            subfinder: '-version',
            amass: '-version',
            nuclei: '-version',
            httpx: '-version',
            wpscan: '--version',
        };
        // Tool-to-wordlist mapping for health check
        // A tool passes if at least one of the listed paths exists.
        const wordlistDeps = {
            gobuster: [
                '/usr/share/wordlists/dirb/common.txt',
                '/usr/share/seclists/Discovery/Web-Content/common.txt',
                '/opt/wordlists-extra/dirb/common.txt',
            ],
            dirb: [
                '/usr/share/wordlists/dirb/common.txt',
                '/usr/share/seclists/Discovery/Web-Content/common.txt',
                '/opt/wordlists-extra/dirb/common.txt',
            ],
            ffuf: [
                '/usr/share/wordlists/dirb/common.txt',
                '/usr/share/seclists/Discovery/Web-Content/common.txt',
            ],
            wfuzz: [
                '/usr/share/wordlists/dirb/common.txt',
                '/usr/share/seclists/Discovery/Web-Content/common.txt',
            ],
            hydra: [
                '/usr/share/wordlists/dirb/common.txt',
                '/usr/share/seclists/Discovery/Web-Content/common.txt',
                '/opt/wordlists-extra/dirb/common.txt',
            ],
        };
        for (const cap of this.capabilities) {
            const result = { name: cap, installed: false, working: false };
            // Step 1: check if tool exists on PATH
            try {
                execSync(`which ${cap} 2>/dev/null || command -v ${cap} 2>/dev/null`, {
                    stdio: 'pipe',
                    timeout: 3000,
                });
                result.installed = true;
            }
            catch {
                results.push(result);
                continue;
            }
            // Step 2: try to run it (--version or --help) to verify it actually works
            const flag = versionFlags[cap] !== undefined ? versionFlags[cap] : '--version';
            const cmd = flag ? `${cap} ${flag}` : cap;
            try {
                const out = execSync(`${cmd} 2>&1`, {
                    stdio: 'pipe',
                    timeout: 5000,
                }).toString().trim();
                result.working = true;
                result.version = out.split('\n')[0]?.substring(0, 80) || 'ok';
            }
            catch (e) {
                // Some tools produce version info but exit non-zero (e.g. nikto with SSL warnings)
                // Try to extract version from stdout/stderr even on failure
                const rawOutput = (e.stdout?.toString() || e.stderr?.toString() || '').trim();
                if (rawOutput) {
                    result.working = true;
                    result.version = rawOutput.split('\n')[0]?.substring(0, 80) || 'ok';
                }
                else {
                    result.working = false;
                    result.error = e.stderr?.toString().substring(0, 100) || e.message?.substring(0, 100) || 'execution failed';
                }
            }
            results.push(result);
            // Step 3: check companion wordlists — auto-download if missing
            const requiredWordlists = wordlistDeps[cap];
            if (requiredWordlists && result.working) {
                const found = requiredWordlists.some((p) => fs.existsSync(p));
                if (!found) {
                    const downloaded = ensureWordlists();
                    if (!downloaded) {
                        result.working = false;
                        result.error = `Missing wordlists: none of [${requiredWordlists.join(', ')}] found`;
                    }
                }
            }
        }
        return results;
    }
}
exports.Config = Config;
exports.config = new Config();
//# sourceMappingURL=config.js.map