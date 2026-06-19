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
    connect(): void;
    private isRunningInContainer;
    private detectPackageManager;
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