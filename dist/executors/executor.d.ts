import { TaskLog } from '../types';
import { Config } from '../config';
export declare class Executor {
    private activeProcesses;
    private onLog;
    private taskOutputs;
    constructor(_config: Config);
    setLogCallback(cb: (log: TaskLog) => void): void;
    execute(task: any): Promise<any>;
    private executeBashScript;
    private spawnProcess;
    cancel(taskId: string): Promise<void>;
    private extractCommandName;
    private parseCommandArgs;
    private sendLog;
    getActiveTaskId(): string | null;
}
//# sourceMappingURL=executor.d.ts.map