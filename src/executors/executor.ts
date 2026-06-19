import { spawn, ChildProcess } from 'child_process';
import { WHITELISTED_COMMANDS, TaskLog } from '../types';
import { Config } from '../config';

export class Executor {
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private onLog: ((log: TaskLog) => void) | null = null;

  constructor(_config: Config) {}

  setLogCallback(cb: (log: TaskLog) => void): void {
    this.onLog = cb;
  }

  public async execute(task: any): Promise<any> {
    const taskId = task.taskId || task.id;
    const { type, command } = task;

    let logCount = 0;
    let rawOutput = '';
    let errorOutput = '';

    // Validate that task has required properties
    if (!taskId || !type || !command) {
      throw new Error('Invalid task: missing required properties');
    }

    // Validate command against whitelist
    const commandName = this.extractCommandName(command);
    const whitelistedCommand = WHITELISTED_COMMANDS.find(c => c.name === commandName);

    if (!whitelistedCommand) {
      throw new Error(`Command '${commandName}' is not allowed`);
    }

    if (!whitelistedCommand.allowed) {
      throw new Error(`Command '${commandName}' is not permitted`);
    }

    // Log task start
    this.sendLog({
      taskId,
      message: `Starting task: ${type}`,
      level: 'info',
      timestamp: new Date().toISOString(),
    });
    logCount++;

    this.sendLog({
      taskId,
      message: `Executing command: ${command}`,
      level: 'info',
      timestamp: new Date().toISOString(),
    });
    logCount++;

    return new Promise<any>((resolve, reject) => {
      const startTime = Date.now();

      const process = spawn(commandName, this.parseCommandArgs(command));

      this.activeProcesses.set(taskId, process);

      process.stdout.on('data', (data) => {
        const output = data.toString();
        rawOutput += output;
        const log = {
          taskId,
          message: output.trim(),
          level: 'info' as const,
          timestamp: new Date().toISOString(),
        };
        this.sendLog(log);
        logCount++;
      });

      process.stderr.on('data', (data) => {
        const error = data.toString();
        errorOutput += error;
        const log = {
          taskId,
          message: error.trim(),
          level: 'error' as const,
          timestamp: new Date().toISOString(),
        };
        this.sendLog(log);
        logCount++;
      });

      process.on('close', (code) => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        if (code === 0) {
          this.sendLog({
            taskId,
            message: `Task completed successfully in ${duration}s`,
            level: 'info',
            timestamp: new Date().toISOString(),
          });
          logCount++;

          resolve({
            taskId,
            rawOutput,
            summary: `Task completed in ${duration}s with ${logCount} log entries`,
          });
        } else {
          this.sendLog({
            taskId,
            message: `Task failed with exit code ${code} after ${duration}s`,
            level: 'error',
            timestamp: new Date().toISOString(),
          });
          logCount++;

          reject(new Error(errorOutput || `Command exited with code ${code}`));
        }

        this.activeProcesses.delete(taskId);
      });

      process.on('error', (error) => {
        this.sendLog({
          taskId,
          message: `Process error: ${error.message}`,
          level: 'error',
          timestamp: new Date().toISOString(),
        });
        logCount++;

        reject(error);
        this.activeProcesses.delete(taskId);
      });
    });
  }

  public async cancel(taskId: string): Promise<void> {
    const process = this.activeProcesses.get(taskId);
    if (process) {
      process.kill('SIGTERM');
      
      // Wait a bit and then force kill if needed
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!process.killed) {
        process.kill('SIGKILL');
      }
      
      this.activeProcesses.delete(taskId);
    }
  }

  private extractCommandName(command: string): string {
    const match = command.match(/^(\w+)/);
    return match ? match[1] : 'unknown';
  }

  private parseCommandArgs(command: string): string[] {
    const parts = command.split(' ').slice(1);
    return parts.filter(part => part.length > 0);
  }

  private sendLog(log: TaskLog): void {
    if (this.onLog) {
      this.onLog(log);
    }
    console.log(`[${log.level.toUpperCase()}] [${log.taskId}] ${log.message}`);
  }

  public getActiveTaskId(): string | null {
    return Array.from(this.activeProcesses.keys())[0] || null;
  }
}
