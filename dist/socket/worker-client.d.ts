import { TaskLog } from '../types';
import { Config } from '../config';
export declare class WorkerClient {
    private socket;
    private config;
    private executor;
    private workerInfo;
    private activeTasks;
    private reconnectAttempts;
    private readonly maxReconnectAttempts;
    private readonly reconnectDelay;
    constructor(config: Config);
    getActiveTaskCount(): number;
    getStatus(): 'idle' | 'working';
    private hasAutoInstalled;
    connect(): void;
    private detectEnvironment;
    /** Legacy wrapper — still used in autoInstallCapabilities */
    private isRunningInContainer;
    private detectPackageManager;
    private autoInstallCapabilities;
    /**
     * Install a single tool, trying package manager first, then fallback methods.
     * Returns true if installed successfully.
     */
    private installTool;
    private register;
    private reportCapabilities;
    private handleTaskAssignment;
    private failTask;
    private requestTaskIfNeeded;
    cancelTask(taskId: string): Promise<void>;
    private cancelAllTasks;
    private shutdown;
    private handleReconnect;
    emitStatus(): void;
    emitHeartbeat(): void;
    requestTask(): void;
    sendLog(log: TaskLog): void;
    sendProgress(taskId: string, progress: number, message?: string): void;
    destroy(): void;
}
//# sourceMappingURL=worker-client.d.ts.map