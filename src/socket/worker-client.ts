import { io, Socket } from 'socket.io-client';
import { WorkerInfo, TaskAssignment, TaskLog } from '../types';
import { Executor } from '../executors/executor';
import { Config } from '../config';

interface ActiveTask {
  taskId: string;
  startedAt: Date;
  timeout: NodeJS.Timeout;
  progressInterval: NodeJS.Timeout;
}

interface PackageManager {
  name: string;
  installCmd: (pkg: string) => string;
  packageMap: Record<string, string>;
}

export class WorkerClient {
  private socket: Socket | null = null;
  private config: Config;
  private executor: Executor;
  private workerInfo: WorkerInfo;
  private activeTasks: Map<string, ActiveTask> = new Map();
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 10;
  private readonly reconnectDelay: number = 3000;

  constructor(config: Config) {
    this.config = config;
    this.executor = new Executor(config);
    this.executor.setLogCallback((log: TaskLog) => {
      this.sendLog(log);
    });
    this.workerInfo = {
      workerId: this.config.workerId,
      hostname: this.config.hostname,
      ip: this.config.ip,
      capabilities: this.config.capabilities,
    };
  }

  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  getStatus(): 'idle' | 'working' {
    return this.activeTasks.size === 0 ? 'idle' : 'working';
  }

  private hasAutoInstalled: boolean = false;

  public connect(): void {
    if (this.socket) return;

    console.log(`Connecting to manager at ${this.config.managerUrl}`);

    this.socket = io(this.config.managerUrl, {
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

    this.socket.on('task:assign', async (data: TaskAssignment) => {
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

    this.socket.on('worker:approval', (data: { approved: boolean }) => {
      if (!data.approved) {
        console.warn('⚠ Worker pending approval — contact admin to approve this worker');
      } else {
        console.log('✅ Worker approved — ready to receive tasks');
      }
    });

    this.socket.on('worker:install-capability', async (data: { capability: string }) => {
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
          const { execSync } = await import('child_process');
          const companionPackages: Record<string, string> = {
            gobuster: 'wordlists', dirb: 'wordlists', dirbuster: 'wordlists',
            ffuf: 'wordlists', wfuzz: 'wordlists', hydra: 'wordlists', john: 'wordlists',
          };
          const companion = companionPackages[data.capability];
          if (companion) {
            try {
              execSync(pm.installCmd(companion), { stdio: 'pipe', timeout: 60000 });
              console.log(`📚 Companion package installed: ${companion}`);
            } catch (e: any) {
              console.warn(`⚠ Companion package ${companion} failed: ${e.message}`);
            }
          }
        } else if (ok && pm.name !== 'apt') {
          console.log('ℹ Companion wordlists not installed (wordlists package not available on this distro).');
          console.log('  Tools like gobuster/dirb need wordlists. Download manually:');
          console.log('  curl -o /usr/share/wordlists/dirb/common.txt https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/common.txt');
        }

        await this.reportCapabilities();
      } catch (err: any) {
        console.error(`❌ Failed to install ${data.capability}:`, err.message);
      }
    });

    this.socket.on('worker:verify-capability', async (data: { capability: string }) => {
      console.log(`🔍 Verifying capability: ${data.capability}`);
      await this.reportCapabilities();
    });
  }

  private async isRunningInContainer(): Promise<boolean> {
    try {
      const fs = await import('fs');
      return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
    } catch {
      return false;
    }
  }

  private async detectPackageManager(): Promise<PackageManager> {
    const { execSync } = await import('child_process');
    const which = (bin: string): boolean => {
      try { execSync(`which ${bin}`, { stdio: 'pipe' }); return true; } catch { return false; }
    };

    if (which('apt-get')) {
      return {
        name: 'apt',
        installCmd: (pkg: string) => `apt-get update -qq && apt-get install -y -qq ${pkg} 2>&1`,
        packageMap: {},
      };
    }
    if (which('apk')) {
      return {
        name: 'apk',
        installCmd: (pkg: string) => `apk update && apk add --no-cache ${pkg} 2>&1`,
        packageMap: {
          dig: 'bind-tools',
          netcat: 'netcat-openbsd',
        },
      };
    }
    if (which('dnf')) {
      return {
        name: 'dnf',
        installCmd: (pkg: string) => `dnf install -y ${pkg} 2>&1`,
        packageMap: {},
      };
    }
    if (which('yum')) {
      return {
        name: 'yum',
        installCmd: (pkg: string) => `yum install -y ${pkg} 2>&1`,
        packageMap: {},
      };
    }
    throw new Error('No supported package manager found (apt-get, apk, dnf, yum)');
  }

  private async autoInstallCapabilities(): Promise<void> {
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

    let pm: PackageManager;
    try {
      pm = await this.detectPackageManager();
    } catch (err: any) {
      console.warn(`⚠ Cannot auto-install: ${err.message}`);
      return;
    }

    let installedCount = 0;

    for (const cap of missing) {
      const ok = await this.installTool(cap, pm);
      if (ok) installedCount++;
    }

    console.log(`🔧 Auto-install complete: ${installedCount}/${missing.length} installed`);

    // Re-report capabilities after install
    await this.reportCapabilities();
  }

  /**
   * Install a single tool, trying package manager first, then fallback methods.
   * Returns true if installed successfully.
   */
  private async installTool(capability: string, pm: PackageManager): Promise<boolean> {
    const { execSync } = await import('child_process');
    const pkgName = pm.packageMap[capability] || capability;

    // ── Step 1: try package manager ──
    try {
      console.log(`  📦 Installing ${capability}${pkgName !== capability ? ` (as ${pkgName})` : ''}...`);
      execSync(pm.installCmd(pkgName), { stdio: 'pipe', timeout: 120000 });
      console.log(`  ✅ ${capability} installed`);
      return true;
    } catch (err: any) {
      const errMsg = err.stderr?.toString().substring(0, 120) || err.message?.substring(0, 120) || 'unknown';
      console.warn(`  ⚠ ${capability} (pkg) failed: ${errMsg}`);
    }

    // ── Step 2: try pip fallback (Python tools) ──
    const pipTools: Record<string, string> = { sqlmap: 'sqlmap' };
    if (pipTools[capability]) {
      try {
        console.log(`  📦 Installing ${capability} via pip...`);
        // Ensure python3 + pip are present, then install
        if (pm.name === 'apk') {
          execSync('apk add --no-cache python3 py3-pip 2>&1', { stdio: 'pipe', timeout: 60000 });
        } else {
          execSync('apt-get install -y -qq python3 python3-pip 2>&1', { stdio: 'pipe', timeout: 60000 });
        }
        execSync(`pip3 install --break-system-packages ${pipTools[capability]} 2>&1`, {
          stdio: 'pipe',
          timeout: 120000,
        });
        console.log(`  ✅ ${capability} installed (via pip)`);
        return true;
      } catch (err: any) {
        console.warn(`  ⚠ ${capability} (pip) failed: ${err.stderr?.toString().substring(0, 120) || err.message?.substring(0, 120)}`);
      }
    }

    // ── Step 3: hint for tools not available on this distro ──
    console.warn(`  ℹ ${capability}: not available via ${pm.name}. Use the Kali Docker image for full tool suite.`);
    return false;
  }

  private async register(): Promise<void> {
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

  private async reportCapabilities(): Promise<void> {
    const actualCaps = await this.config.detectActualCapabilities();
    const capabilityHealth = await this.config.checkCapabilityHealth();
    this.socket?.emit('worker:capability-report', {
      workerId: this.workerInfo.workerId,
      capabilities: actualCaps,
      capabilityHealth,
    });
  }

  // ── Handle a single task assignment ──
  private async handleTaskAssignment(data: TaskAssignment): Promise<void> {
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

    const active: ActiveTask = { taskId, startedAt: new Date(), timeout, progressInterval };
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

    } catch (error) {
      clearInterval(progressInterval);
      clearTimeout(timeout);
      this.activeTasks.delete(taskId);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.failTask(taskId, errorMessage);
    }
  }

  private failTask(taskId: string, errorMessage: string): void {
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

  private requestTaskIfNeeded(): void {
    if (this.activeTasks.size < this.config.maxConcurrentTasks) {
      this.requestTask();
    }
  }

  public async cancelTask(taskId: string): Promise<void> {
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
      } catch (error) {
        console.error('Error cancelling task:', error);
        this.activeTasks.delete(taskId);
      }
      this.requestTaskIfNeeded();
    }
  }

  private cancelAllTasks(): void {
    for (const [, active] of this.activeTasks) {
      clearInterval(active.progressInterval);
      clearTimeout(active.timeout);
    }
    this.activeTasks.clear();
  }

  private shutdown(): void {
    console.log('Shutting down worker...');
    this.cancelAllTasks();
    this.socket?.disconnect();
    process.exit(0);
  }

  private handleReconnect(): void {
    this.reconnectAttempts++;
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      console.log(`Reconnecting... attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('Max reconnection attempts reached');
      process.exit(1);
    }
  }

  public emitStatus(): void {
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

  public emitHeartbeat(): void {
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

  public requestTask(): void {
    this.socket?.emit('task:request', {
      workerId: this.workerInfo.workerId,
      capabilities: this.workerInfo.capabilities,
      activeTaskCount: this.activeTasks.size,
      maxConcurrentTasks: this.config.maxConcurrentTasks,
    });
  }

  public sendLog(log: TaskLog): void {
    this.socket?.emit('task:log', {
      ...log,
      workerId: this.workerInfo.workerId,
      timestamp: new Date().toISOString(),
    });
  }

  public sendProgress(taskId: string, progress: number, message?: string): void {
    this.socket?.emit('task:progress', {
      taskId,
      workerId: this.workerInfo.workerId,
      progress,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  public destroy(): void {
    this.cancelAllTasks();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
