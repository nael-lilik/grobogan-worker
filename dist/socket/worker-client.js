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
exports.WorkerClient = void 0;
const socket_io_client_1 = require("socket.io-client");
const executor_1 = require("../executors/executor");
class WorkerClient {
    constructor(config) {
        this.socket = null;
        this.activeTasks = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 3000;
        this.hasAutoInstalled = false;
        this.config = config;
        this.executor = new executor_1.Executor(config);
        this.executor.setLogCallback((log) => {
            this.sendLog(log);
        });
        this.workerInfo = {
            workerId: this.config.workerId,
            hostname: this.config.hostname,
            ip: this.config.ip,
            capabilities: this.config.capabilities,
        };
    }
    getActiveTaskCount() {
        return this.activeTasks.size;
    }
    getStatus() {
        return this.activeTasks.size === 0 ? 'idle' : 'working';
    }
    connect() {
        if (this.socket)
            return;
        console.log(`Connecting to manager at ${this.config.managerUrl}`);
        this.socket = (0, socket_io_client_1.io)(this.config.managerUrl, {
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: this.reconnectDelay,
            reconnectionDelayMax: 30000,
            timeout: 10000,
        });
        this.socket.on('connect', async () => {
            console.log('Connected to manager');
            this.reconnectAttempts = 0;
            await this.register();
            this.emitStatus();
            await this.reportCapabilities();
            // Auto-install missing capabilities (first connect only)
            if (!this.hasAutoInstalled) {
                this.hasAutoInstalled = true;
                await this.autoInstallCapabilities();
            }
        });
        this.socket.on('disconnect', (reason) => {
            console.log('Disconnected from manager:', reason);
            this.cancelAllTasks();
        });
        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error.message);
            this.handleReconnect();
        });
        this.socket.on('task:assign', async (data) => {
            console.log(`Task assigned: ${data.taskId}`);
            await this.handleTaskAssignment(data);
        });
        this.socket.on('task:cancel', async (data) => {
            await this.cancelTask(data.taskId);
        });
        this.socket.on('worker:shutdown', async () => {
            console.log('Shutdown requested');
            this.shutdown();
        });
        this.socket.on('worker:approval', (data) => {
            if (!data.approved) {
                console.warn('⚠ Worker pending approval — contact admin to approve this worker');
            }
            else {
                console.log('✅ Worker approved — ready to receive tasks');
            }
        });
        this.socket.on('worker:install-capability', async (data) => {
            console.log(`📦 Installing capability: ${data.capability}`);
            try {
                const isContainer = await this.isRunningInContainer();
                if (isContainer) {
                    console.warn('⚠ Running in container — installed tools will be lost on restart');
                }
                const pm = await this.detectPackageManager();
                const ok = await this.installTool(data.capability, pm);
                // Install companion wordlists/dependencies for certain tools (apt only)
                if (ok && pm.name === 'apt') {
                    const { execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
                    const companionPackages = {
                        gobuster: 'wordlists', dirb: 'wordlists', dirbuster: 'wordlists',
                        ffuf: 'wordlists', wfuzz: 'wordlists', hydra: 'wordlists', john: 'wordlists',
                    };
                    const companion = companionPackages[data.capability];
                    if (companion) {
                        try {
                            execSync(pm.installCmd(companion), { stdio: 'pipe', timeout: 60000 });
                            console.log(`📚 Companion package installed: ${companion}`);
                        }
                        catch (e) {
                            console.warn(`⚠ Companion package ${companion} failed: ${e.message}`);
                        }
                    }
                }
                else if (ok && pm.name !== 'apt') {
                    console.log('ℹ Companion wordlists not installed (wordlists package not available on this distro).');
                    console.log('  Tools like gobuster/dirb need wordlists. Download manually:');
                    console.log('  curl -o /usr/share/wordlists/dirb/common.txt https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/common.txt');
                }
                await this.reportCapabilities();
            }
            catch (err) {
                console.error(`❌ Failed to install ${data.capability}:`, err.message);
            }
        });
        this.socket.on('worker:verify-capability', async (data) => {
            console.log(`🔍 Verifying capability: ${data.capability}`);
            await this.reportCapabilities();
        });
    }
    async isRunningInContainer() {
        try {
            const fs = await Promise.resolve().then(() => __importStar(require('fs')));
            return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
        }
        catch {
            return false;
        }
    }
    async detectPackageManager() {
        const { execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
        const which = (bin) => {
            try {
                execSync(`which ${bin}`, { stdio: 'pipe' });
                return true;
            }
            catch {
                return false;
            }
        };
        if (which('apt-get')) {
            return {
                name: 'apt',
                installCmd: (pkg) => `apt-get update -qq && apt-get install -y -qq ${pkg} 2>&1`,
                packageMap: {},
            };
        }
        if (which('apk')) {
            return {
                name: 'apk',
                installCmd: (pkg) => `apk update && apk add --no-cache ${pkg} 2>&1`,
                packageMap: {
                    dig: 'bind-tools',
                    netcat: 'netcat-openbsd',
                },
            };
        }
        if (which('dnf')) {
            return {
                name: 'dnf',
                installCmd: (pkg) => `dnf install -y ${pkg} 2>&1`,
                packageMap: {},
            };
        }
        if (which('yum')) {
            return {
                name: 'yum',
                installCmd: (pkg) => `yum install -y ${pkg} 2>&1`,
                packageMap: {},
            };
        }
        throw new Error('No supported package manager found (apt-get, apk, dnf, yum)');
    }
    async autoInstallCapabilities() {
        const isContainer = await this.isRunningInContainer();
        const actualCaps = await this.config.detectActualCapabilities();
        const missing = this.config.capabilities.filter(c => !actualCaps.includes(c));
        if (missing.length === 0) {
            console.log('✅ All capabilities already installed');
            return;
        }
        console.log(`🔧 Auto-installing ${missing.length} missing capabilities: ${missing.join(', ')}`);
        if (isContainer) {
            console.warn('⚠ Running in container — installed tools will be lost on restart');
        }
        let pm;
        try {
            pm = await this.detectPackageManager();
        }
        catch (err) {
            console.warn(`⚠ Cannot auto-install: ${err.message}`);
            return;
        }
        let installedCount = 0;
        for (const cap of missing) {
            const ok = await this.installTool(cap, pm);
            if (ok)
                installedCount++;
        }
        console.log(`🔧 Auto-install complete: ${installedCount}/${missing.length} installed`);
        // Re-report capabilities after install
        await this.reportCapabilities();
    }
    /**
     * Install a single tool, trying package manager first, then fallback methods.
     * Returns true if installed successfully.
     */
    async installTool(capability, pm) {
        const { execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
        const pkgName = pm.packageMap[capability] || capability;
        // ── Step 1: try package manager ──
        try {
            console.log(`  📦 Installing ${capability}${pkgName !== capability ? ` (as ${pkgName})` : ''}...`);
            execSync(pm.installCmd(pkgName), { stdio: 'pipe', timeout: 120000 });
            console.log(`  ✅ ${capability} installed`);
            // Post-install: fix binary name mismatches (e.g. nikto → nikto.pl on Alpine)
            const binaryFixes = {
                nikto: pm.name === 'apk' ? '/usr/bin/nikto.pl' : '', // Alpine installs nikto.pl, not nikto
            };
            const sourcePath = binaryFixes[capability];
            if (sourcePath && pm.name === 'apk') {
                try {
                    execSync(`ln -sf ${sourcePath} /usr/bin/${capability} 2>&1`, { stdio: 'pipe' });
                }
                catch { /* non-critical */ }
            }
            return true;
        }
        catch (err) {
            const errMsg = err.stderr?.toString().substring(0, 120) || err.message?.substring(0, 120) || 'unknown';
            console.warn(`  ⚠ ${capability} (pkg) failed: ${errMsg}`);
        }
        // ── Step 2: try pip fallback (Python tools) ──
        const pipTools = { sqlmap: 'sqlmap' };
        if (pipTools[capability]) {
            try {
                console.log(`  📦 Installing ${capability} via pip...`);
                // Ensure python3 + pip are present, then install
                if (pm.name === 'apk') {
                    execSync('apk add --no-cache python3 py3-pip 2>&1', { stdio: 'pipe', timeout: 60000 });
                }
                else {
                    execSync('apt-get install -y -qq python3 python3-pip 2>&1', { stdio: 'pipe', timeout: 60000 });
                }
                execSync(`pip3 install --break-system-packages ${pipTools[capability]} 2>&1`, {
                    stdio: 'pipe',
                    timeout: 120000,
                });
                console.log(`  ✅ ${capability} installed (via pip)`);
                return true;
            }
            catch (err) {
                console.warn(`  ⚠ ${capability} (pip) failed: ${err.stderr?.toString().substring(0, 120) || err.message?.substring(0, 120)}`);
            }
        }
        // ── Step 3: hint for tools not available on this distro ──
        console.warn(`  ℹ ${capability}: not available via ${pm.name}. Use the Kali Docker image for full tool suite.`);
        return false;
    }
    async register() {
        const actualCaps = await this.config.detectActualCapabilities();
        const capabilityHealth = await this.config.checkCapabilityHealth();
        const workerInfoWithResources = {
            ...this.workerInfo,
            actualCapabilities: actualCaps,
            capabilityHealth,
            resources: {
                cpu: { usage: 25, cores: 4 },
                memory: { usage: 40, total: 8192, available: 4915 },
                disk: { usage: 60, total: 200000, available: 80000 },
            },
            maxConcurrentTasks: this.config.maxConcurrentTasks,
        };
        this.socket?.emit('worker:register', workerInfoWithResources);
        console.log(`Worker registered (max ${this.config.maxConcurrentTasks} concurrent tasks)`);
        if (actualCaps.length < this.config.capabilities.length) {
            const missing = this.config.capabilities.filter(c => !actualCaps.includes(c));
            console.warn(`⚠ Missing capabilities: ${missing.join(', ')} — install via dashboard`);
        }
    }
    async reportCapabilities() {
        const actualCaps = await this.config.detectActualCapabilities();
        const capabilityHealth = await this.config.checkCapabilityHealth();
        this.socket?.emit('worker:capability-report', {
            workerId: this.workerInfo.workerId,
            capabilities: actualCaps,
            capabilityHealth,
        });
    }
    // ── Handle a single task assignment ──
    async handleTaskAssignment(data) {
        const taskId = data.taskId;
        // Check capacity
        if (this.activeTasks.size >= this.config.maxConcurrentTasks) {
            this.socket?.emit('task:rejected', {
                taskId,
                reason: `At capacity (${this.activeTasks.size}/${this.config.maxConcurrentTasks})`,
                workerId: this.workerInfo.workerId,
            });
            return;
        }
        console.log(`Executing task: ${taskId} - ${data.task.type} (${this.activeTasks.size + 1}/${this.config.maxConcurrentTasks})`);
        // Emit started
        this.socket?.emit('task:started', {
            taskId,
            workerId: this.workerInfo.workerId,
            targetId: data.task.options?.targetId || '',
            type: data.task.type,
            startedAt: new Date().toISOString(),
        });
        // Set timeout (30 min per task)
        const taskTimeoutMs = 30 * 60 * 1000;
        const timeout = setTimeout(() => {
            if (this.activeTasks.has(taskId)) {
                console.warn(`Task ${taskId} timed out after ${taskTimeoutMs}ms`);
                this.failTask(taskId, 'Task execution timed out');
            }
        }, taskTimeoutMs);
        // Progress simulation
        const progressInterval = setInterval(() => {
            if (this.activeTasks.has(taskId)) {
                const progress = Math.min(100, Math.floor(Math.random() * 90) + 10);
                this.sendProgress(taskId, progress, 'Task in progress');
            }
        }, 2000);
        const active = { taskId, startedAt: new Date(), timeout, progressInterval };
        this.activeTasks.set(taskId, active);
        try {
            const result = await this.executor.execute(data.task);
            // Cleanup intervals
            clearInterval(progressInterval);
            clearTimeout(timeout);
            this.activeTasks.delete(taskId);
            // Emit completion
            this.sendProgress(taskId, 100, 'Task completed successfully');
            this.socket?.emit('task:completed', {
                taskId,
                workerId: this.workerInfo.workerId,
                status: 'completed',
                summary: result.summary,
                rawOutput: result.rawOutput,
                finishedAt: new Date().toISOString(),
                resultId: data.resultId,
            });
            console.log(`Task ${taskId} completed. Active: ${this.activeTasks.size}`);
            this.requestTaskIfNeeded();
        }
        catch (error) {
            clearInterval(progressInterval);
            clearTimeout(timeout);
            this.activeTasks.delete(taskId);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.failTask(taskId, errorMessage);
        }
    }
    failTask(taskId, errorMessage) {
        this.socket?.emit('task:completed', {
            taskId,
            workerId: this.workerInfo.workerId,
            status: 'failed',
            error: errorMessage,
            finishedAt: new Date().toISOString(),
        });
        console.log(`Task ${taskId} failed: ${errorMessage}. Active: ${this.activeTasks.size}`);
        this.requestTaskIfNeeded();
    }
    requestTaskIfNeeded() {
        if (this.activeTasks.size < this.config.maxConcurrentTasks) {
            this.requestTask();
        }
    }
    async cancelTask(taskId) {
        const active = this.activeTasks.get(taskId);
        if (active) {
            try {
                console.log(`Cancelling task ${taskId}`);
                await this.executor.cancel(taskId);
                clearInterval(active.progressInterval);
                clearTimeout(active.timeout);
                this.activeTasks.delete(taskId);
                this.socket?.emit('task:completed', {
                    taskId,
                    workerId: this.workerInfo.workerId,
                    status: 'cancelled',
                    finishedAt: new Date().toISOString(),
                });
            }
            catch (error) {
                console.error('Error cancelling task:', error);
                this.activeTasks.delete(taskId);
            }
            this.requestTaskIfNeeded();
        }
    }
    cancelAllTasks() {
        for (const [, active] of this.activeTasks) {
            clearInterval(active.progressInterval);
            clearTimeout(active.timeout);
        }
        this.activeTasks.clear();
    }
    shutdown() {
        console.log('Shutting down worker...');
        this.cancelAllTasks();
        this.socket?.disconnect();
        process.exit(0);
    }
    handleReconnect() {
        this.reconnectAttempts++;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            console.log(`Reconnecting... attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
        }
        else {
            console.error('Max reconnection attempts reached');
            process.exit(1);
        }
    }
    emitStatus() {
        this.socket?.emit('worker:status', {
            workerId: this.workerInfo.workerId,
            status: this.getStatus(),
            capabilities: this.workerInfo.capabilities,
            hostname: this.workerInfo.hostname,
            ip: this.workerInfo.ip,
            activeTasks: this.activeTasks.size,
            maxConcurrentTasks: this.config.maxConcurrentTasks,
        });
    }
    emitHeartbeat() {
        this.socket?.emit('worker:heartbeat', {
            workerId: this.workerInfo.workerId,
            hostname: this.workerInfo.hostname,
            ip: this.workerInfo.ip,
            capabilities: this.workerInfo.capabilities,
            currentTaskCount: this.activeTasks.size,
            resources: {
                cpu: { usage: Math.floor(Math.random() * 30) + 10, cores: 4 },
                memory: { usage: Math.floor(Math.random() * 30) + 20, total: 8192, available: 4915 },
                disk: { usage: 60, total: 200000, available: 80000 },
            },
            timestamp: new Date().toISOString(),
        });
    }
    requestTask() {
        this.socket?.emit('task:request', {
            workerId: this.workerInfo.workerId,
            capabilities: this.workerInfo.capabilities,
            activeTaskCount: this.activeTasks.size,
            maxConcurrentTasks: this.config.maxConcurrentTasks,
        });
    }
    sendLog(log) {
        this.socket?.emit('task:log', {
            ...log,
            workerId: this.workerInfo.workerId,
            timestamp: new Date().toISOString(),
        });
    }
    sendProgress(taskId, progress, message) {
        this.socket?.emit('task:progress', {
            taskId,
            workerId: this.workerInfo.workerId,
            progress,
            message,
            timestamp: new Date().toISOString(),
        });
    }
    destroy() {
        this.cancelAllTasks();
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }
}
exports.WorkerClient = WorkerClient;
//# sourceMappingURL=worker-client.js.map