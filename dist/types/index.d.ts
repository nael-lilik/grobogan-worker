/**
 * Worker types and interfaces
 */
export interface WorkerInfo {
    workerId: string;
    hostname: string;
    ip: string;
    capabilities: string[];
}
export interface Task {
    id: string;
    type: string;
    command: string;
    options?: Record<string, any>;
}
export interface TaskAssignment {
    taskId: string;
    task: Task;
    resultId?: string;
}
export interface TaskLog {
    taskId: string;
    message: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    timestamp: string;
}
export interface TaskResult {
    taskId: string;
    rawOutput: string;
    parsed?: Record<string, any>;
    summary: string;
    error?: string;
}
export interface WorkerStatus {
    workerId: string;
    status: 'idle' | 'busy';
    capabilities: string[];
    hostname?: string;
    ip?: string;
}
export interface WhitelistCommand {
    name: string;
    description: string;
    allowed: boolean;
}
export declare const WHITELISTED_COMMANDS: WhitelistCommand[];
//# sourceMappingURL=index.d.ts.map